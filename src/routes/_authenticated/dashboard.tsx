import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth, inferBranchFromEmail } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { rupiah } from "@/lib/format";
import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  BarChart3,
  Printer,
  Share2,
  Trash2,
  Save,
  ShoppingBag,
  Package,
  Users,
  Store,
  User,
  Search,
  Plus,
  Minus,
  X,
  CreditCard,
  Banknote,
  Receipt as ReceiptIcon,
} from "lucide-react";
import { printReceiptThermalClient, isPrinterConnectedClient } from "@/lib/thermal-printer.actions";
import { printReceiptPdfClient, shareReceiptImageClient } from "@/lib/receipt-pdf.actions";
import { Receipt } from "@/components/Receipt";
import { fetchAllRows, fetchAllByIds } from "@/lib/supabase-paginate";

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      dateFilter: (search.dateFilter as "today" | "7" | "14" | "30" | "month" | "all") || undefined,
      fromDate: (search.fromDate as string) || undefined,
      toDate: (search.toDate as string) || undefined,
      branch: (search.branch as string) || undefined,
      saleCategory: (search.saleCategory as string) || undefined,
    } as {
      dateFilter?: "today" | "7" | "14" | "30" | "month" | "all";
      fromDate?: string;
      toDate?: string;
      branch?: string;
      saleCategory?: string;
    };
  },
  ssr: false,
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const searchParams = Route.useSearch();
  const { role: rawRole, branchName, user } = useAuth();

  const isExplicitKasir =
    user?.email?.toLowerCase().trim() === "kasir@gmail.com" ||
    user?.email?.toLowerCase().includes("kasir");
  const role: "admin" | "cashier" = isExplicitKasir
    ? "cashier"
    : rawRole || (user?.email?.toLowerCase().trim() === "jaleputra69@gmail.com" ? "admin" : "cashier");

  const [dateFilter, setDateFilter] = useState<"today" | "7" | "14" | "30" | "month" | "all">(
    searchParams.dateFilter || "14"
  );
  const [fromDate, setFromDate] = useState<string>(searchParams.fromDate || "");
  const [toDate, setToDate] = useState<string>(searchParams.toDate || "");
  const customRange = !!(fromDate && toDate);

  // Cashier filters
  const [cashierSearch, setCashierSearch] = useState("");
  const [cashierPayMethod, setCashierPayMethod] = useState<"all" | "cash" | "qris">("all");

  // Filter Cabang (Hanya untuk Admin)
  const [selectedBranch, setSelectedBranch] = useState<string>(() => {
    if (searchParams.branch) return searchParams.branch;
    if (typeof window !== "undefined") {
      return localStorage.getItem("app_admin_selected_branch") || "all";
    }
    return "all";
  });

  useEffect(() => {
    if (searchParams.branch !== undefined) {
      setSelectedBranch(searchParams.branch);
    }
  }, [searchParams.branch]);

  const handleSelectBranch = (val: string) => {
    setSelectedBranch(val);
    if (typeof window !== "undefined") {
      localStorage.setItem("app_admin_selected_branch", val);
    }
  };

  const [detailModal, setDetailModal] = useState<{
    open: boolean;
    title: string;
    type: "pemasukan" | "pengeluaran" | "pendapatan" | null;
  }>({
    open: false,
    title: "",
    type: null,
  });

  // Query branches from database / fallback
  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    staleTime: 15 * 60 * 1000,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("branches").select("id, shop_name, branch_name, shop_address, shop_phone, whatsapp_number").order("created_at", { ascending: true });
        if (error) {
          const localData = typeof window !== "undefined" ? localStorage.getItem("app_branches_data") : null;
          return localData ? JSON.parse(localData) : [];
        }
        return data ?? [];
      } catch {
        const localData = typeof window !== "undefined" ? localStorage.getItem("app_branches_data") : null;
        return localData ? JSON.parse(localData) : [];
      }
    },
  });

  // Query user roles to map cashier user_id to branch_name
  const { data: userRoles = [] } = useQuery({
    queryKey: ["user_roles_branch_map"],
    staleTime: 15 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("user_id, role, branch_name");
      return data ?? [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles_for_transactions_dashboard"],
    staleTime: 15 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, email, name");
      return data ?? [];
    },
  });

  const profilesMap = useMemo(() => {
    const map: Record<string, { email?: string | null; name?: string | null }> = {};
    profiles.forEach((p: any) => {
      if (p?.id) map[p.id] = p;
    });
    return map;
  }, [profiles]);

  const userRolesMap = useMemo(() => {
    const map: Record<string, any> = {};
    userRoles.forEach((ur: any) => {
      if (ur?.user_id) map[ur.user_id] = ur;
    });
    return map;
  }, [userRoles]);

  const getCashierAccountDisplay = (cashierId?: string | null) => {
    if (!cashierId) return "admin";
    const prof = profilesMap[cashierId];
    const roleObj = userRolesMap[cashierId];
    const email = prof?.email?.trim().toLowerCase();

    if (email) {
      if (email === "jaleputra69@gmail.com") return "admin";
      return email;
    }
    if (roleObj?.role === "admin") return "admin";
    if (roleObj?.role === "cashier") return "kasir@gmail.com";
    return "admin";
  };

  const cashierBranchMap = useMemo(() => {
    const map: Record<string, string> = {};
    userRoles.forEach((ur: any) => {
      if (ur?.user_id && ur?.branch_name) {
        map[ur.user_id] = ur.branch_name;
      }
    });
    return map;
  }, [userRoles]);

  const { data } = useQuery({
    queryKey: ["dashboard", dateFilter, fromDate, toDate],
    staleTime: 3 * 60 * 1000,
    queryFn: async () => {
      let since: Date;
      let until: Date | null = null;
      if (customRange) {
        since = new Date(`${fromDate}T00:00:00`);
        until = new Date(`${toDate}T23:59:59.999`);
      } else {
        since = new Date();
        if (dateFilter === "today") {
          since.setHours(0, 0, 0, 0);
        } else if (dateFilter === "7") since.setDate(since.getDate() - 6);
        else if (dateFilter === "14") since.setDate(since.getDate() - 13);
        else if (dateFilter === "30") since.setDate(since.getDate() - 29);
        else if (dateFilter === "month") {
          since.setDate(1);
        } else {
          since.setFullYear(2020, 0, 1);
        }
        since.setHours(0, 0, 0, 0);
      }

      // Pastikan data minimal mencakup tanggal 1 awal bulan untuk Grafik Pendapatan Harian
      let fetchSince = since;
      if (!customRange) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        if (fetchSince > startOfMonth) {
          fetchSince = startOfMonth;
        }
      }

      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const sinceDateStr = fmt(fetchSince);
      const untilDateStr = until ? fmt(until) : null;

      const txs = await fetchAllRows<any>((from, to) => {
        let q = supabase
          .from("transactions")
          .select("id, branch_name, buyer_name, house_block, partner_name, sale_category, payment_method, total, discount_amount, cash_received, change_amount, cashier_id, created_at")
          .gte("created_at", fetchSince.toISOString())
          .order("created_at", { ascending: false })
          .range(from, to);
        if (until) q = q.lte("created_at", until.toISOString());
        return q;
      });

      const [stockEntries, products, stockMovements, allRestockEntries] = await Promise.all([
        fetchAllRows<any>((from, to) => {
          let q = supabase.from("stock_entries").select("id, branch_name, restock_date, shipping_cost, entry_type, payment_method, created_at, created_by").gte("restock_date", sinceDateStr).range(from, to);
          if (untilDateStr) q = q.lte("restock_date", untilDateStr);
          return q;
        }),
        fetchAllRows<any>((from, to) => supabase.from("products").select("id, name, price, stock, category").range(from, to)),
        fetchAllRows<any>((from, to) => supabase.from("stock_movements").select("id, product_id, quantity, initial_price, shipping_cost, created_at, products(name)").range(from, to)),
        fetchAllRows<any>((from, to) =>
          supabase
            .from("stock_entries")
            .select("id, restock_date, shipping_cost, entry_type, payment_method, stock_movements(quantity, initial_price)")
            .eq("entry_type", "restock")
            .range(from, to),
        ),
      ]);

      const txIds = txs.map((t) => t.id);
      const itemsData = txIds.length
        ? await fetchAllByIds<any>(txIds, (chunk, from, to) =>
            supabase.from("transaction_items").select("id, transaction_id, product_id, product_name, price, cost_price, quantity, subtotal").in("transaction_id", chunk).range(from, to),
          )
        : [];

      return {
        transactions: txs ?? [],
        items: itemsData ?? [],
        products: products ?? [],
        stockEntries: stockEntries ?? [],
        stockMovements: stockMovements ?? [],
        allRestockEntries: allRestockEntries ?? [],
      };
    },
  });

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    branches.forEach((b: any) => {
      if (b?.branch_name?.trim()) set.add(b.branch_name.trim());
    });
    userRoles.forEach((ur: any) => {
      if (ur?.branch_name?.trim()) set.add(ur.branch_name.trim());
    });
    (data?.transactions ?? []).forEach((t: any) => {
      if (t?.branch_name?.trim()) set.add(t.branch_name.trim());
    });
    (data?.stockEntries ?? []).forEach((e: any) => {
      if (e?.branch_name?.trim()) set.add(e.branch_name.trim());
    });
    set.add("Cabang 1");
    set.add("Cabang 2");
    return Array.from(set);
  }, [branches, userRoles, data?.transactions, data?.stockEntries]);

  const branchMatch = (b1?: string | null, b2?: string | null) => {
    if (!b1 || !b2) return false;
    return b1.trim().toLowerCase().replace(/\s+/g, "") === b2.trim().toLowerCase().replace(/\s+/g, "");
  };

  const getTxBranch = (t: any): string | null => {
    if (t?.cashier_id && cashierBranchMap[t.cashier_id]) return cashierBranchMap[t.cashier_id];
    if (t?.cashier_id && profilesMap[t.cashier_id]?.email) {
      const inf = inferBranchFromEmail(profilesMap[t.cashier_id]?.email);
      if (inf) return inf;
    }
    if (t?.branch_name?.trim()) return t.branch_name.trim();
    if (typeof window !== "undefined" && t?.cashier_id) {
      const cached = localStorage.getItem(`app_user_branch_${t.cashier_id}`);
      if (cached?.trim()) return cached.trim();
    }
    return null;
  };

  const getEntryBranch = (e: any) => {
    if (e?.branch_name?.trim()) return e.branch_name.trim();
    if (e?.created_by && cashierBranchMap[e.created_by]) return cashierBranchMap[e.created_by];
    return null;
  };

  const cashierAssignedBranch = useMemo(() => {
    return (
      branchName ||
      (user?.id ? cashierBranchMap[user.id] : null) ||
      inferBranchFromEmail(user?.email) ||
      "Cabang 1"
    );
  }, [branchName, user?.id, user?.email, cashierBranchMap]);

  const effectiveSelectedBranch = role === "cashier" ? cashierAssignedBranch : selectedBranch;

  const [deletedTxIds, setDeletedTxIds] = useState<string[]>([]);
  const [localEditedTxs, setLocalEditedTxs] = useState<Record<string, any>>({});

  const txs = useMemo(() => {
    const rawTxs = data?.transactions ?? [];
    return rawTxs
      .filter((t) => !deletedTxIds.includes(t.id))
      .filter((t) => {
        if (effectiveSelectedBranch === "all") return true;
        const b = getTxBranch(t);
        return branchMatch(b, effectiveSelectedBranch);
      })
      .filter((t) => {
        if (customRange || dateFilter === "all" || dateFilter === "month") return true;
        if (!t?.created_at) return true;
        const txDate = new Date(t.created_at);
        const threshold = new Date();
        if (dateFilter === "today") threshold.setHours(0, 0, 0, 0);
        else if (dateFilter === "7") { threshold.setDate(threshold.getDate() - 6); threshold.setHours(0, 0, 0, 0); }
        else if (dateFilter === "14") { threshold.setDate(threshold.getDate() - 13); threshold.setHours(0, 0, 0, 0); }
        else if (dateFilter === "30") { threshold.setDate(threshold.getDate() - 29); threshold.setHours(0, 0, 0, 0); }
        return txDate >= threshold;
      })
      .map((t) => {
        if (localEditedTxs[t.id]) {
          return { ...t, ...localEditedTxs[t.id] };
        }
        return t;
      });
  }, [data?.transactions, deletedTxIds, effectiveSelectedBranch, localEditedTxs, dateFilter, customRange, cashierBranchMap, profilesMap]);

  const items = data?.items ?? [];
  const products = data?.products ?? [];
  const stockEntries = data?.stockEntries ?? [];
  const stockMovements = data?.stockMovements ?? [];
  const allRestockEntries = data?.allRestockEntries ?? [];

  const cashierFilteredTxs = useMemo(() => {
    let list = txs;
    if (cashierPayMethod !== "all") {
      list = list.filter((t) => t.payment_method === cashierPayMethod);
    }
    if (cashierSearch.trim()) {
      const q = cashierSearch.toLowerCase().trim();
      list = list.filter((t) => {
        const idMatch = (t.id || "").toLowerCase().includes(q);
        const block = (t.house_block || "").toLowerCase();
        const buyer = (t.buyer_name || "").toLowerCase();
        const partner = (t.partner_name || "").toLowerCase();
        const txItems = items.filter((i: any) => i.transaction_id === t.id);
        const itemNames = txItems.map((i: any) => (i.product_name || "").toLowerCase()).join(" ");
        return idMatch || block.includes(q) || buyer.includes(q) || partner.includes(q) || itemNames.includes(q);
      });
    }
    return list;
  }, [txs, cashierPayMethod, cashierSearch, items]);

  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["printer_settings"],
    staleTime: 15 * 60 * 1000,
    queryFn: async () => (await supabase.from("printer_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [selectedTxItems, setSelectedTxItems] = useState<any[]>([]);
  const [editForm, setEditForm] = useState({
    payment_method: "cash",
    house_block: "",
    cash_received: "",
    partner_name: "",
    buyer_name: "",
  });

  const handleSelectTx = async (t: any) => {
    setEditingTxId(t.id);
    setEditForm({
      payment_method: t.payment_method,
      house_block: t.house_block ?? "",
      cash_received: String(t.cash_received ?? ""),
      partner_name: t.partner_name ?? "",
      buyer_name: t.buyer_name ?? "",
    });
    let txItems = items.filter((i) => i.transaction_id === t.id).map((i) => ({ ...i }));
    if (txItems.length === 0) {
      const { data: fresh } = await supabase
        .from("transaction_items")
        .select("*")
        .eq("transaction_id", t.id);
      txItems = (fresh ?? []).map((i) => ({ ...i }));
    }
    setSelectedTxItems(txItems);
  };

  const updateItemQty = (index: number, delta: number) => {
    setSelectedTxItems((prev) => {
      const copy = [...prev];
      const nextQty = copy[index].quantity + delta;
      if (nextQty <= 0) {
        copy.splice(index, 1);
      } else {
        copy[index] = { ...copy[index], quantity: nextQty };
      }
      return copy;
    });
  };

  const removeTxItem = (index: number) => {
    setSelectedTxItems((prev) => prev.filter((_, i) => i !== index));
  };

  const currentEditedTotal = useMemo(() => {
    return selectedTxItems.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0);
  }, [selectedTxItems]);

  const deleteTransaction = useMutation({
    mutationFn: async (txId: string) => {
      const txItems = items.filter((item) => item.transaction_id === txId);

      for (const item of txItems) {
        if (item.product_id) {
          const { data: prod } = await supabase
            .from("products")
            .select("stock")
            .eq("id", item.product_id)
            .single();
          if (prod) {
            await supabase
              .from("products")
              .update({ stock: prod.stock + item.quantity })
              .eq("id", item.product_id);
          }
        }
      }

      const { error: itemsErr } = await supabase
        .from("transaction_items")
        .delete()
        .eq("transaction_id", txId);
      if (itemsErr) throw itemsErr;

      const { error: txErr } = await supabase
        .from("transactions")
        .delete()
        .eq("id", txId);
      if (txErr) throw txErr;
    },
    onSuccess: (data, variables) => {
      toast.success("Transaksi berhasil dihapus & stok produk dikembalikan");
      setDeletedTxIds((prev) => [...prev, variables]);
      setEditingTxId(null);
      setDetailModal((m) => ({ ...m, open: false }));
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: Error) => {
      toast.error("Gagal menghapus transaksi: " + err.message);
    },
  });

  const editTransaction = useMutation({
    mutationFn: async () => {
      if (!editingTxId) return;
      const isCash = editForm.payment_method === "cash";
      const cashVal = Number(editForm.cash_received) || 0;

      if (isCash && cashVal < currentEditedTotal) {
        throw new Error("Uang tunai kurang dari total tagihan");
      }

      const changeAmt = isCash ? Math.max(0, cashVal - currentEditedTotal) : null;

      const origItems = items.filter((i) => i.transaction_id === editingTxId);
      const origMap = new Map(origItems.map((i) => [i.id, i]));
      for (const orig of origItems) {
        const still = selectedTxItems.find((i) => i.id === orig.id);
        if (!still && orig.product_id) {
          const { data: prod } = await supabase.from("products").select("stock").eq("id", orig.product_id).single();
          if (prod) {
            await supabase.from("products").update({ stock: prod.stock + orig.quantity }).eq("id", orig.product_id);
          }
        }
      }
      for (const it of selectedTxItems) {
        if (it.product_id) {
          const orig = origMap.get(it.id);
          const diff = it.quantity - (orig ? orig.quantity : 0);
          if (diff !== 0) {
            const { data: prod } = await supabase.from("products").select("stock").eq("id", it.product_id).single();
            if (prod) {
              await supabase.from("products").update({ stock: prod.stock - diff }).eq("id", it.product_id);
            }
          }
        }
      }

      await supabase.from("transaction_items").delete().eq("transaction_id", editingTxId);
      if (selectedTxItems.length > 0) {
        await supabase.from("transaction_items").insert(
          selectedTxItems.map((i) => ({
            transaction_id: editingTxId,
            product_id: i.product_id,
            product_name: i.product_name,
            price: Number(i.price),
            quantity: Number(i.quantity),
          }))
        );
      }

      const { data: updatedTx, error } = await supabase
        .from("transactions")
        .update({
          total: currentEditedTotal,
          payment_method: editForm.payment_method,
          house_block: editForm.house_block.trim() || null,
          cash_received: isCash ? cashVal : null,
          change_amount: changeAmt,
          partner_name: editForm.partner_name.trim() || null,
          buyer_name: editForm.buyer_name.trim() || null,
        })
        .eq("id", editingTxId)
        .select();
      if (error) throw error;
      if (!updatedTx || updatedTx.length === 0) {
        throw new Error("Gagal memperbarui transaksi. Baris data tidak ditemukan.");
      }
    },
    onSuccess: () => {
      toast.success("Transaksi berhasil diperbarui");
      if (editingTxId) {
        setLocalEditedTxs((prev) => ({
          ...prev,
          [editingTxId]: {
            total: currentEditedTotal,
            payment_method: editForm.payment_method,
            house_block: editForm.house_block.trim() || null,
            cash_received: editForm.payment_method === "cash" ? Number(editForm.cash_received) : null,
            change_amount:
              editForm.payment_method === "cash"
                ? Math.max(0, (Number(editForm.cash_received) || 0) - currentEditedTotal)
                : null,
            partner_name: editForm.partner_name.trim() || null,
            buyer_name: editForm.buyer_name.trim() || null,
          },
        }));
      }
      setEditingTxId(null);
      setDetailModal((m) => ({ ...m, open: false }));
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: Error) => {
      toast.error("Gagal memperbarui transaksi: " + err.message);
    },
  });

  const getReceiptTx = (tx: any, txItems?: any[]) => {
    let finalItems = txItems ?? selectedTxItems;
    if (finalItems.length === 0) {
      finalItems = items.filter((item) => item.transaction_id === tx.id);
    }
    const tot = finalItems.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0);
    return {
      ...tx,
      items: finalItems,
      total: tot > 0 ? tot : tx.total,
      payment_method: editForm.payment_method || tx.payment_method,
      cash_received: editForm.payment_method === "cash" ? Number(editForm.cash_received) || 0 : null,
      change_amount:
        editForm.payment_method === "cash"
          ? Math.max(0, (Number(editForm.cash_received) || 0) - (tot > 0 ? tot : tx.total))
          : null,
      house_block: editForm.house_block || tx.house_block || null,
      partner_name: editForm.partner_name || tx.partner_name || null,
      buyer_name: editForm.buyer_name || tx.buyer_name || null,
    };
  };

  const handlePrintReceipt = async (tx: any, txItems?: any[]) => {
    const printTx = getReceiptTx(tx, txItems);
    if (printTx.items.length === 0) {
      const { data: fresh } = await supabase
        .from("transaction_items")
        .select("*")
        .eq("transaction_id", tx.id);
      printTx.items = fresh ?? [];
    }

    if (!isPrinterConnectedClient()) {
      try {
        printReceiptPdfClient(printTx, settings ?? null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal mencetak PDF");
      }
      return;
    }
    try {
      await printReceiptThermalClient(printTx, settings ?? null);
      toast.success("Struk berhasil dikirim ke printer thermal");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencetak");
    }
  };

  const handleShareReceipt = async (tx: any, txItems?: any[]) => {
    const shareTx = getReceiptTx(tx, txItems);
    if (shareTx.items.length === 0) {
      const { data: fresh } = await supabase
        .from("transaction_items")
        .select("*")
        .eq("transaction_id", tx.id);
      shareTx.items = fresh ?? [];
    }
    try {
      await shareReceiptImageClient(shareTx, settings ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membagikan struk");
    }
  };

  // Calculations
  const partnerTxs = useMemo(() => txs.filter((t) => t?.sale_category === "partner"), [txs]);
  const salesTxs = useMemo(() => txs.filter((t) => t?.sale_category !== "partner"), [txs]);
  const partnerRevenue = useMemo(() => partnerTxs.reduce((s, t) => s + Number(t?.total || 0), 0), [partnerTxs]);

  const totalRevenue = useMemo(() => salesTxs.reduce((s, t) => s + Number(t?.total || 0), 0), [salesTxs]);
  const cashRevenue = useMemo(
    () => salesTxs.filter((t) => t.payment_method === "cash").reduce((s, t) => s + Number(t?.total || 0), 0),
    [salesTxs]
  );
  const qrisRevenue = useMemo(
    () => salesTxs.filter((t) => t.payment_method === "qris").reduce((s, t) => s + Number(t?.total || 0), 0),
    [salesTxs]
  );

  const overallCashRevenue = useMemo(
    () => txs.filter((t) => t.payment_method === "cash").reduce((s, t) => s + Number(t?.total || 0), 0),
    [txs]
  );
  const overallQrisRevenue = useMemo(
    () => txs.filter((t) => t.payment_method === "qris").reduce((s, t) => s + Number(t?.total || 0), 0),
    [txs]
  );
  const overallRevenue = useMemo(() => overallCashRevenue + overallQrisRevenue, [overallCashRevenue, overallQrisRevenue]);

  const partnerCashRevenue = useMemo(
    () => partnerTxs.filter((t) => t.payment_method === "cash").reduce((s, t) => s + Number(t?.total || 0), 0),
    [partnerTxs]
  );
  const partnerQrisRevenue = useMemo(
    () => partnerTxs.filter((t) => t.payment_method === "qris").reduce((s, t) => s + Number(t?.total || 0), 0),
    [partnerTxs]
  );

  const filteredStockEntries = useMemo(() => {
    const raw = stockEntries;
    if (effectiveSelectedBranch === "all") return raw;
    return raw.filter((e: any) => branchMatch(getEntryBranch(e), effectiveSelectedBranch));
  }, [stockEntries, effectiveSelectedBranch]);

  const filteredAllRestockEntries = useMemo(() => {
    const raw = allRestockEntries;
    if (effectiveSelectedBranch === "all") return raw;
    return raw.filter((e: any) => branchMatch(getEntryBranch(e), effectiveSelectedBranch));
  }, [allRestockEntries, effectiveSelectedBranch]);

  const expenseEntries = useMemo(
    () => filteredStockEntries.filter((e: any) => (e?.entry_type ?? "expense") !== "restock"),
    [filteredStockEntries]
  );

  const totalExpenditure = useMemo(() => {
    const entryIds = new Set(expenseEntries.map((e: any) => e?.id).filter(Boolean));
    const shipping = expenseEntries.reduce((s: number, e: any) => s + Number(e?.shipping_cost ?? 0), 0);
    const materials = stockMovements
      .filter((m: any) => m?.stock_entry_id && entryIds.has(m.stock_entry_id))
      .reduce((s: number, m: any) => s + Number(m?.quantity ?? 0) * Number(m?.initial_price ?? 0), 0);
    return shipping + materials;
  }, [expenseEntries, stockMovements]);

  const cashExpenditure = useMemo(() => {
    const ids = new Set(expenseEntries.filter((e: any) => (e?.payment_method ?? "cash") === "cash").map((e: any) => e?.id).filter(Boolean));
    const ship = expenseEntries.filter((e: any) => (e?.payment_method ?? "cash") === "cash").reduce((s: number, e: any) => s + Number(e?.shipping_cost ?? 0), 0);
    const mat = stockMovements
      .filter((m: any) => m?.stock_entry_id && ids.has(m.stock_entry_id))
      .reduce((s: number, m: any) => s + Number(m?.quantity ?? 0) * Number(m?.initial_price ?? 0), 0);
    return ship + mat;
  }, [expenseEntries, stockMovements]);

  const qrisExpenditure = useMemo(() => {
    const ids = new Set(expenseEntries.filter((e: any) => e?.payment_method === "qris").map((e: any) => e?.id).filter(Boolean));
    const ship = expenseEntries.filter((e: any) => e?.payment_method === "qris").reduce((s: number, e: any) => s + Number(e?.shipping_cost ?? 0), 0);
    const mat = stockMovements
      .filter((m: any) => m?.stock_entry_id && ids.has(m.stock_entry_id))
      .reduce((s: number, m: any) => s + Number(m?.quantity ?? 0) * Number(m?.initial_price ?? 0), 0);
    return ship + mat;
  }, [expenseEntries, stockMovements]);

  const restockTotal = useMemo(
    () =>
      (filteredAllRestockEntries as any[]).reduce(
        (s: number, e: any) =>
          s +
          Number(e?.shipping_cost ?? 0) +
          (Array.isArray(e?.stock_movements)
            ? e.stock_movements.reduce(
                (sum: number, m: any) => sum + Number(m?.quantity ?? 0) * Number(m?.initial_price ?? 0),
                0
              )
            : 0),
        0
      ),
    [filteredAllRestockEntries]
  );

  const netCash = useMemo(() => overallCashRevenue - cashExpenditure, [overallCashRevenue, cashExpenditure]);
  const netQris = useMemo(() => overallQrisRevenue - qrisExpenditure, [overallQrisRevenue, qrisExpenditure]);
  const netIncome = useMemo(() => netCash + netQris - restockTotal, [netCash, netQris, restockTotal]);

  const productCategoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    (products ?? []).forEach((p: any) => {
      if (!p?.id) return;
      let cat = p.category || "customer";
      if (typeof cat === "string" && cat.startsWith("deleted_")) {
        cat = cat.replace("deleted_", "");
      }
      map[p.id] = cat;
    });
    return map;
  }, [products]);

  const isPartnerItem = (item: any, tx: any) => {
    if (tx?.sale_category === "partner") return true;
    let cat = "customer";
    if (item?.product_id && productCategoryMap[item.product_id]) {
      cat = productCategoryMap[item.product_id];
    } else if (item?.product_name?.startsWith("[GUDANG]")) {
      cat = "gudang";
    }
    return cat === "partner";
  };

  const totalProductsSold = useMemo(() => {
    const txMap = new Map(txs.map((t) => [t.id, t]));
    return (items ?? [])
      .filter((item: any) => {
        const tx = txMap.get(item?.transaction_id);
        if (!tx) return false;
        return !isPartnerItem(item, tx);
      })
      .reduce((sum: number, item: any) => sum + Number(item?.quantity ?? 0), 0);
  }, [items, txs, productCategoryMap]);

  const packInfo = useMemo(() => {
    const txMap = new Map(txs.map((t) => [t.id, t]));
    const activeItems = (items ?? []).filter((item: any) => {
      const tx = txMap.get(item?.transaction_id);
      if (!tx) return false;
      return !isPartnerItem(item, tx);
    });

    let dada = 0;
    let pahaAtas = 0;
    let pahaBawah = 0;
    let sayap = 0;

    activeItems.forEach((item: any) => {
      const name = (item?.product_name || "").toLowerCase();
      const qty = Number(item?.quantity ?? 0);
      if (name.includes("dada")) dada += qty;
      else if (name.includes("paha atas")) pahaAtas += qty;
      else if (name.includes("paha bawah")) pahaBawah += qty;
      else if (name.includes("sayap")) sayap += qty;
    });

    const totalAyam = dada + pahaAtas + pahaBawah + sayap;
    const packs = Math.ceil(totalAyam / 10);
    return { packs, dada, pahaAtas, pahaBawah, sayap };
  }, [items, txs, productCategoryMap]);

  const daily = useMemo(() => {
    // Tentukan bulan dan tahun referensi
    const refDate = fromDate ? new Date(`${fromDate}T00:00:00`) : new Date();
    const year = refDate.getFullYear();
    const month = refDate.getMonth(); // 0-indexed (0 = Jan, 1 = Feb, ...)

    // Jumlah hari dalam bulan ini (tanggal 1 sampai akhir bulan: 28, 29, 30, atau 31)
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
    const currentDay = now.getDate();
    const isFutureMonth =
      year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());

    // Inisialisasi peta untuk tanggal 1 sampai akhir bulan
    const dailyMap: Record<string, number | null> = {};
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const k = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isFuture = isFutureMonth || (isCurrentMonth && d > currentDay);
      // Kosongkan bar (null) untuk tanggal yang belum dilewati
      dailyMap[k] = isFuture ? null : 0;
    }

    txs.forEach((t) => {
      // Hanya menampilkan pemasukan di luar transaksi partner
      if (t?.sale_category === "partner") return;
      if (t?.created_at) {
        const d = new Date(t.created_at);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (k in dailyMap && dailyMap[k] !== null) {
          dailyMap[k] = (dailyMap[k] as number) + Number(t.total || 0);
        }
      }
    });

    return Object.entries(dailyMap).map(([dStr, v]) => {
      const [y, m, d] = dStr.split("-").map(Number);
      const dateObj = new Date(y, m - 1, d);
      return {
        date: String(d),
        fullDate: dateObj.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
        revenue: v,
      };
    });
  }, [txs, fromDate]);

  const payments = useMemo(() => {
    const payMap: Record<string, number> = { cash: 0, qris: 0 };
    txs.forEach((t) => {
      const pm = t.payment_method === "qris" ? "qris" : "cash";
      payMap[pm] = (payMap[pm] ?? 0) + Number(t.total || 0);
    });
    return [
      { name: "Cash", value: payMap.cash },
      { name: "QRIS", value: payMap.qris },
    ];
  }, [txs]);
  const PIE_COLORS = ["#059669", "#2563eb"];

  const blockChartData = useMemo(() => {
    const blockMap: Record<string, { block: string; count: number; revenue: number }> = {};
    txs.forEach((t) => {
      const block = t.house_block?.trim().toUpperCase() || "TANPA BLOK";
      if (!blockMap[block]) {
        blockMap[block] = { block, count: 0, revenue: 0 };
      }
      blockMap[block].count += 1;
      blockMap[block].revenue += Number(t.total || 0);
    });
    return Object.values(blockMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [txs]);

  // Render Kasir UI
  if (role === "cashier") {
    return (
      <div className="space-y-4">
        {/* Cashier Header */}
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Detail Pemasukan</h1>
            <p className="text-xs text-primary font-medium mt-0.5 flex items-center gap-1">
              <Store className="h-3.5 w-3.5" />
              Cabang: <span className="font-semibold">{cashierAssignedBranch}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-foreground">Metode:</span>
            <Select value={cashierPayMethod} onValueChange={(v: any) => setCashierPayMethod(v)}>
              <SelectTrigger className="w-[110px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="qris">QRIS</SelectItem>
              </SelectContent>
            </Select>

            <span className="text-muted-foreground">Filter Waktu:</span>
            <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hari Ini</SelectItem>
                <SelectItem value="7">7 Hari Terakhir</SelectItem>
                <SelectItem value="14">14 Hari Terakhir</SelectItem>
                <SelectItem value="30">30 Hari Terakhir</SelectItem>
                <SelectItem value="month">Bulan Ini</SelectItem>
                <SelectItem value="all">Semua Waktu</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Date Filter Custom */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-muted-foreground">Rentang Kustom:</span>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 w-[140px] text-xs"
          />
          <span className="text-muted-foreground">s/d</span>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 w-[140px] text-xs"
          />
          {(fromDate || toDate) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setFromDate("");
                setToDate("");
              }}
            >
              Reset
            </Button>
          )}
          {customRange && (
            <span className="text-[10px] text-primary">(Rentang kustom aktif — filter waktu di atas diabaikan)</span>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={cashierSearch}
            onChange={(e) => setCashierSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
            placeholder="Cari transaksi (ID, nama pembeli, blok rumah, produk, dll)..."
          />
        </div>

        {/* Cashier Transactions Table */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <ReceiptIcon className="h-4 w-4 text-primary" />
                Rincian Transaksi Pemasukan ({cashierFilteredTxs.length})
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {cashierFilteredTxs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">
                Belum ada transaksi pemasukan pada periode ini.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-[180px] font-semibold text-xs">Transaksi / Waktu</TableHead>
                      <TableHead className="min-w-[200px] font-semibold text-xs">Rincian Item & Pelanggan</TableHead>
                      <TableHead className="w-[140px] text-center font-semibold text-xs">Metode Pembayaran</TableHead>
                      <TableHead className="w-[130px] text-right font-semibold text-xs">Total Tagihan</TableHead>
                      <TableHead className="w-[90px] text-center font-semibold text-xs">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashierFilteredTxs.map((t) => {
                      const txItems = items.filter((i: any) => i?.transaction_id === t.id);
                      const isCash = t.payment_method === "cash";
                      return (
                        <TableRow
                          key={t.id}
                          className="hover:bg-muted/50 cursor-pointer transition"
                          onClick={() => handleSelectTx(t)}
                        >
                          <TableCell className="align-middle py-3">
                            <div className="font-semibold text-xs text-foreground flex items-center gap-1 flex-wrap">
                              <span>#{t.id.slice(0, 8).toUpperCase()}</span>
                              {getTxBranch(t) && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1 py-0 h-4 font-normal bg-primary/10 text-primary border-primary/20"
                                >
                                  {getTxBranch(t)}
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {new Date(t.created_at).toLocaleString("id-ID")}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                              <User className="h-2.5 w-2.5" />
                              <span>{getCashierAccountDisplay(t.cashier_id)}</span>
                            </div>
                          </TableCell>

                          <TableCell className="align-middle py-3">
                            <div className="text-xs font-medium text-foreground">
                              {t.partner_name ? (
                                <>
                                  <span className="text-primary font-semibold">Partner: {t.partner_name}</span>
                                  {t.house_block && (
                                    <span className="text-muted-foreground font-normal text-[11px] ml-1">
                                      (Blok {t.house_block})
                                    </span>
                                  )}
                                </>
                              ) : t.buyer_name ? (
                                <>
                                  <span>{t.buyer_name}</span>
                                  {t.house_block && (
                                    <span className="text-muted-foreground font-normal text-[11px] ml-1">
                                      (Blok {t.house_block})
                                    </span>
                                  )}
                                </>
                              ) : t.house_block ? (
                                <span>Blok {t.house_block}</span>
                              ) : (
                                <span className="text-muted-foreground">Customer</span>
                              )}
                            </div>
                            {txItems.length > 0 && (
                              <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                                {txItems.map((it: any) => `${it.product_name} (${it.quantity})`).join(", ")}
                              </div>
                            )}
                          </TableCell>

                          {/* Kolom Tengah: Keterangan CASH / QRIS */}
                          <TableCell className="align-middle text-center py-3">
                            {isCash ? (
                              <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase px-2.5 py-0.5 shadow-sm inline-flex items-center gap-1">
                                <Banknote className="h-3 w-3" />
                                CASH
                              </Badge>
                            ) : (
                              <Badge className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase px-2.5 py-0.5 shadow-sm inline-flex items-center gap-1">
                                <CreditCard className="h-3 w-3" />
                                QRIS
                              </Badge>
                            )}
                          </TableCell>

                          <TableCell className="align-middle text-right py-3">
                            <div className="font-bold text-success text-sm">{rupiah(t.total)}</div>
                            {isCash && t.cash_received && Number(t.cash_received) > Number(t.total) && (
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                Kembalian: {rupiah(t.change_amount || Number(t.cash_received) - Number(t.total))}
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="align-middle text-center py-3" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => handleSelectTx(t)}
                            >
                              Detail
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transaction Detail & Edit Modal for Cashier */}
        <Dialog
          open={!!editingTxId}
          onOpenChange={(open) => {
            if (!open) {
              setEditingTxId(null);
            }
          }}
        >
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detail & Cetak Transaksi</DialogTitle>
            </DialogHeader>

            {(() => {
              const selectedTx = txs.find((t) => t.id === editingTxId);
              if (!selectedTx) return null;
              const isCash = editForm.payment_method === "cash";
              const cashVal = Number(editForm.cash_received) || 0;
              const changeAmt = isCash ? Math.max(0, cashVal - currentEditedTotal) : 0;

              return (
                <div className="space-y-4 py-1">
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Left Column: Struk Preview */}
                    <div className="border rounded-lg p-2 bg-muted/20">
                      <Receipt
                        tx={{
                          ...selectedTx,
                          items: selectedTxItems,
                          total: currentEditedTotal,
                          payment_method: editForm.payment_method,
                          cash_received: isCash ? cashVal : null,
                          change_amount: changeAmt,
                          buyer_name: editForm.buyer_name || null,
                          house_block: editForm.house_block || null,
                          partner_name: editForm.partner_name || null,
                        }}
                        settings={settings}
                      />
                    </div>

                    {/* Right Column: Edit Form & Actions */}
                    <div className="space-y-4">
                      <div className="space-y-3 border rounded-lg p-3 bg-card">
                        <div className="flex items-center justify-between border-b pb-2">
                          <h3 className="font-semibold text-sm">Edit Data Transaksi</h3>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[11px] font-medium text-foreground/85 border">
                            <User className="h-3 w-3 text-muted-foreground" />
                            Akun: <strong className="text-primary">{getCashierAccountDisplay(selectedTx.cashier_id)}</strong>
                          </span>
                        </div>

                        {/* Edit Items List */}
                        <div className="space-y-1.5 max-h-44 overflow-y-auto border rounded p-2 bg-muted/10">
                          <Label className="text-xs font-semibold">Daftar Item Pesanan</Label>
                          {selectedTxItems.map((it, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs border-b pb-1 pt-1">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{it.product_name}</div>
                                <div className="text-muted-foreground">
                                  {rupiah(Number(it.price))} × {it.quantity}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-6 w-6"
                                  onClick={() => updateItemQty(idx, -1)}
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="w-5 text-center font-semibold">{it.quantity}</span>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-6 w-6"
                                  onClick={() => updateItemQty(idx, 1)}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-destructive"
                                  onClick={() => removeTxItem(idx)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Metode Pembayaran</Label>
                          <Select
                            value={editForm.payment_method}
                            onValueChange={(v) => setEditForm({ ...editForm, payment_method: v })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Tunai (Cash)</SelectItem>
                              <SelectItem value="qris">QRIS</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {editForm.payment_method === "cash" && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Uang Tunai Diterima</Label>
                            <Input
                              type="number"
                              min="0"
                              className="h-8 text-xs"
                              value={editForm.cash_received}
                              onChange={(e) => setEditForm({ ...editForm, cash_received: e.target.value })}
                            />
                            <div className="text-xs text-muted-foreground flex justify-between mt-1">
                              <span>Total Tagihan: {rupiah(currentEditedTotal)}</span>
                              <span className="text-success font-semibold">Kembalian: {rupiah(changeAmt)}</span>
                            </div>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <Label className="text-xs">Blok Rumah (opsional)</Label>
                          <Input
                            className="h-8 text-xs"
                            value={editForm.house_block}
                            onChange={(e) => setEditForm({ ...editForm, house_block: e.target.value })}
                            placeholder="Contoh: Blok A1"
                          />
                        </div>

                        {selectedTx.sale_category === "partner" && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Nama Partner</Label>
                            <Input
                              className="h-8 text-xs"
                              value={editForm.partner_name}
                              onChange={(e) => setEditForm({ ...editForm, partner_name: e.target.value })}
                              placeholder="Nama partner bisnis"
                            />
                          </div>
                        )}

                        <Button
                          className="w-full mt-2 h-8 text-xs"
                          disabled={editTransaction.isPending}
                          onClick={() => editTransaction.mutate()}
                        >
                          <Save className="h-3.5 w-3.5 mr-1.5" /> Simpan Perubahan
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <h3 className="font-semibold text-xs text-muted-foreground px-1">Aksi Struk Transaksi</h3>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => handlePrintReceipt(selectedTx, selectedTxItems)}
                          >
                            <Printer className="h-3.5 w-3.5 mr-1.5" /> Cetak
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => handleShareReceipt(selectedTx, selectedTxItems)}
                          >
                            <Share2 className="h-3.5 w-3.5 mr-1.5" /> Bagikan Struk
                          </Button>
                        </div>
                        <Button
                          variant="destructive"
                          className="w-full mt-2 h-8 text-xs"
                          disabled={deleteTransaction.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                "Apakah Anda yakin ingin menghapus transaksi ini? Stok produk akan dikembalikan otomatis dan data penjualan dihapus."
                              )
                            ) {
                              deleteTransaction.mutate(selectedTx.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Hapus Transaksi
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Render Admin UI
  return (
    <div className="space-y-4">
      {/* Header and Filter */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard Ringkasan</h1>
          {selectedBranch === "all" ? (
            <p className="text-xs text-muted-foreground font-medium mt-0.5 flex items-center gap-1">
              <Store className="h-3.5 w-3.5 text-primary" />
              Menampilkan gabungan: <span className="font-semibold text-foreground">Semua Cabang</span>
            </p>
          ) : (
            <p className="text-xs text-primary font-medium mt-0.5 flex items-center gap-1">
              <Store className="h-3.5 w-3.5" />
              Menampilkan cabang: <span className="font-semibold">{selectedBranch}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Branch Filter (Only for Admin) */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Cabang:</span>
            <Select value={selectedBranch} onValueChange={(v) => handleSelectBranch(v)}>
              <SelectTrigger className="w-[170px] h-9">
                <SelectValue placeholder="Pilih Cabang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <span className="font-medium">Semua Cabang</span>
                </SelectItem>
                {branchOptions.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Date Filter */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-muted-foreground">Filter Waktu:</span>
        <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hari Ini</SelectItem>
            <SelectItem value="7">7 Hari Terakhir</SelectItem>
            <SelectItem value="14">14 Hari Terakhir</SelectItem>
            <SelectItem value="30">30 Hari Terakhir</SelectItem>
            <SelectItem value="month">Bulan Ini</SelectItem>
            <SelectItem value="all">Semua Waktu</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-muted-foreground ml-2">Rentang Kustom:</span>
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="h-8 w-[140px] text-xs"
        />
        <span className="text-muted-foreground">s/d</span>
        <Input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="h-8 w-[140px] text-xs"
        />
        {(fromDate || toDate) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
          >
            Reset
          </Button>
        )}
        {customRange && (
          <span className="text-[10px] text-primary">(Rentang kustom aktif — filter waktu di atas diabaikan)</span>
        )}
      </div>

      {/* Grafik Pendapatan Harian (Kiri) & 6 Stat Cards (Kanan 2 Kolom) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Revenue Over Time Chart (Kiri) */}
        <div className="lg:col-span-6 xl:col-span-6 flex flex-col">
          <Card className="h-full flex flex-col shadow-xs">
            <CardHeader className="py-3 px-4 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Grafik Pendapatan Harian</CardTitle>
                <span className="text-xs text-muted-foreground font-normal">
                  {new Date(fromDate ? `${fromDate}T00:00:00` : Date.now()).toLocaleDateString("id-ID", {
                    month: "long",
                    year: "numeric",
                  })} (Tgl 1 - Akhir Bulan)
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-0 flex-1 min-h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    stroke="var(--color-muted-foreground)"
                    fontSize={10}
                    interval={0}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="var(--color-muted-foreground)"
                    fontSize={10}
                    tickFormatter={(v) => `${(Number(v || 0) / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    labelFormatter={(_, payload) => {
                      if (payload && payload[0]?.payload?.fullDate) {
                        return payload[0].payload.fullDate;
                      }
                      return "";
                    }}
                    formatter={(v: any) =>
                      v !== null && v !== undefined ? rupiah(Number(v || 0)) : "Tanggal belum dilewati"
                    }
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="revenue" name="Pendapatan (Non-Partner)" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* 6 Stat Cards (Kanan dalam 2 Kolom) */}
        <div className="lg:col-span-6 xl:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Stat
            icon={DollarSign}
            label="Pemasukan Keseluruhan"
            value={rupiah(overallRevenue)}
            sub={`${txs.length} Tx · Cash: ${rupiah(overallCashRevenue)} · QRIS: ${rupiah(overallQrisRevenue)}`}
            onClick={() =>
              navigate({
                to: "/income-details",
                search: {
                  dateFilter,
                  fromDate: fromDate || undefined,
                  toDate: toDate || undefined,
                  saleCategory: "all",
                  branch: selectedBranch !== "all" ? selectedBranch : undefined,
                },
              })
            }
          />
          <Stat
            icon={TrendingUp}
            label="Pengeluaran"
            value={rupiah(totalExpenditure)}
            sub={`${expenseEntries.length} Input Pengeluaran`}
            onClick={() =>
              navigate({
                to: "/expense-details",
                search: {
                  dateFilter,
                  fromDate: fromDate || undefined,
                  toDate: toDate || undefined,
                  type: "expense",
                  branch: selectedBranch !== "all" ? selectedBranch : undefined,
                },
              })
            }
          />
          <Stat
            icon={Package}
            label="Restok (Keseluruhan)"
            value={rupiah(restockTotal)}
            sub={`${allRestockEntries.length} Restok · Mengurangi total`}
            onClick={() =>
              navigate({
                to: "/expense-details",
                search: {
                  dateFilter,
                  fromDate: fromDate || undefined,
                  toDate: toDate || undefined,
                  type: "restock",
                  branch: selectedBranch !== "all" ? selectedBranch : undefined,
                },
              })
            }
          />
          <Stat
            icon={Users}
            label="Penjualan Partner"
            value={rupiah(partnerRevenue)}
            sub={`${partnerTxs.length} Tx · Cash: ${rupiah(partnerCashRevenue)} · QRIS: ${rupiah(partnerQrisRevenue)}`}
            onClick={() =>
              navigate({
                to: "/income-details",
                search: {
                  dateFilter,
                  fromDate: fromDate || undefined,
                  toDate: toDate || undefined,
                  saleCategory: "partner",
                  branch: selectedBranch !== "all" ? selectedBranch : undefined,
                },
              })
            }
          />
          <Stat
            icon={ShoppingBag}
            label="Jumlah Produk Terjual"
            value={`${totalProductsSold} Pcs (${packInfo.packs} Pack)`}
            sub={`Detail: D:${packInfo.dada} · PA:${packInfo.pahaAtas} · PB:${packInfo.pahaBawah} · S:${packInfo.sayap}`}
            onClick={() =>
              navigate({
                to: "/sold-products",
                search: {
                  dateFilter,
                  fromDate: fromDate || undefined,
                  toDate: toDate || undefined,
                  branch: selectedBranch !== "all" ? selectedBranch : undefined,
                },
              })
            }
          />
          <Stat
            icon={BarChart3}
            label="Pendapatan Bersih"
            value={rupiah(netIncome)}
            sub={`Cash: ${rupiah(netCash)} · QRIS: ${rupiah(netQris)}`}
            onClick={() =>
              setDetailModal({
                open: true,
                title: "Detail Pendapatan Bersih",
                type: "pendapatan",
              })
            }
          />
        </div>
      </div>

        {/* Bottom Chart Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Buyer House Block Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Grafik Blok Rumah Pembeli (Pendapatan)</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              {blockChartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Belum ada data transaksi pembeli di periode ini.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={blockChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis
                      type="number"
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                      tickFormatter={(v) => `${(Number(v || 0) / 1000).toFixed(0)}k`}
                    />
                    <YAxis
                      type="category"
                      dataKey="block"
                      width={100}
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                    />
                    <Tooltip
                      formatter={(v: any) => rupiah(Number(v || 0))}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="revenue" name="Pemasukan" fill="var(--color-primary)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Payment Methods Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metode Pembayaran</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              {payments.every((p) => p.value === 0) ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Belum ada data pembayaran di periode ini.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={payments} dataKey="value" nameKey="name" outerRadius={80} label>
                      {payments.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any) => rupiah(Number(v || 0))}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

      {/* Admin Details Dialog */}
      <Dialog
        open={detailModal.open}
        onOpenChange={(open) => {
          if (!open) {
            setDetailModal((m) => ({ ...m, open: false }));
            setEditingTxId(null);
          }
        }}
      >
        <DialogContent className={detailModal.type === "pemasukan" && editingTxId ? "max-w-3xl" : "max-w-3xl"}>
          <DialogHeader>
            <DialogTitle>{detailModal.title}</DialogTitle>
          </DialogHeader>

          {detailModal.type === "pemasukan" && !editingTxId && (
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              {txs.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">Belum ada pemasukan di periode ini.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-[170px] font-semibold text-xs">Transaksi / Waktu</TableHead>
                      <TableHead className="min-w-[150px] font-semibold text-xs">Rincian & Pelanggan</TableHead>
                      <TableHead className="w-[120px] text-center font-semibold text-xs">Metode</TableHead>
                      <TableHead className="w-[120px] text-right font-semibold text-xs">Total</TableHead>
                      <TableHead className="w-[70px] text-center font-semibold text-xs">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txs.map((t) => {
                      const isCash = t.payment_method === "cash";
                      return (
                        <TableRow
                          key={t.id}
                          onClick={() => handleSelectTx(t)}
                          className="cursor-pointer hover:bg-muted/50 transition"
                        >
                          <TableCell className="align-middle py-2.5">
                            <div className="font-semibold text-xs flex items-center gap-1 flex-wrap">
                              <span>#{t.id.slice(0, 8).toUpperCase()}</span>
                              {getTxBranch(t) && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1 py-0 h-4 font-normal bg-primary/10 text-primary border-primary/20"
                                >
                                  {getTxBranch(t)}
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {new Date(t.created_at).toLocaleString("id-ID")}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                              <User className="h-2.5 w-2.5" />
                              <span>{getCashierAccountDisplay(t.cashier_id)}</span>
                            </div>
                          </TableCell>

                          <TableCell className="align-middle py-2.5">
                            <div className="text-xs font-medium">
                              {t.partner_name ? (
                                <>
                                  <span className="text-primary font-semibold">Partner: {t.partner_name}</span>
                                  {t.house_block && (
                                    <span className="text-muted-foreground font-normal text-[11px] ml-1">
                                      (Blok {t.house_block})
                                    </span>
                                  )}
                                </>
                              ) : t.buyer_name ? (
                                <>
                                  <span>{t.buyer_name}</span>
                                  {t.house_block && (
                                    <span className="text-muted-foreground font-normal text-[11px] ml-1">
                                      (Blok {t.house_block})
                                    </span>
                                  )}
                                </>
                              ) : t.house_block ? (
                                <span>Blok {t.house_block}</span>
                              ) : (
                                <span className="text-muted-foreground">Customer</span>
                              )}
                            </div>
                          </TableCell>

                          {/* Kolom Tengah: Keterangan CASH / QRIS */}
                          <TableCell className="align-middle text-center py-2.5">
                            {isCash ? (
                              <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] uppercase px-2 py-0.5 shadow-sm inline-flex items-center gap-1">
                                <Banknote className="h-3 w-3" />
                                CASH
                              </Badge>
                            ) : (
                              <Badge className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] uppercase px-2 py-0.5 shadow-sm inline-flex items-center gap-1">
                                <CreditCard className="h-3 w-3" />
                                QRIS
                              </Badge>
                            )}
                          </TableCell>

                          <TableCell className="align-middle text-right py-2.5">
                            <div className="font-bold text-success text-xs">{rupiah(t.total)}</div>
                          </TableCell>

                          <TableCell className="align-middle text-center py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[11px] px-2"
                              onClick={() => handleSelectTx(t)}
                            >
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )}

          {detailModal.type === "pengeluaran" && (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {stockEntries.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">Belum ada pengeluaran di periode ini.</p>
              ) : (
                stockEntries.map((entry: any) => {
                  const movements = (stockMovements ?? []).filter((m: any) => m?.stock_entry_id === entry?.id);
                  const subtotal = movements.reduce(
                    (s: number, m: any) => s + Number(m?.quantity ?? 0) * Number(m?.initial_price ?? 0),
                    0
                  );
                  const groceryNames = movements
                    .map((m: any) => (m.products?.name ?? "").replace(/^\[GUDANG\]\s*/i, ""))
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <div key={entry.id} className="border-b pb-3 space-y-1 text-sm">
                      <div className="flex justify-between font-semibold gap-4">
                        <span className="truncate max-w-[200px] sm:max-w-xs">
                          {groceryNames || `Pengeluaran #${entry.id.slice(0, 6).toUpperCase()}`}
                        </span>
                        <span className="text-destructive font-bold shrink-0">
                          {rupiah(subtotal + (entry.shipping_cost || 0))}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Tanggal: {entry.restock_date} | Ongkir: {rupiah(entry.shipping_cost || 0)}
                      </div>
                      <div className="pl-2 border-l-2 border-primary/20 space-y-1 mt-1">
                        {movements.map((m: any) => {
                          const prodName = (m.products?.name ?? "").replace(/^\[GUDANG\]\s*/i, "");
                          return (
                            <div key={m.id} className="flex justify-between text-xs text-muted-foreground">
                              <span>
                                {prodName || "—"} ({m.quantity} pcs)
                              </span>
                              <span>{rupiah((m.quantity || 0) * (m.initial_price || 0))}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {detailModal.type === "pendapatan" && (
            <div className="space-y-3 py-2 text-sm">
              <div className="flex justify-between items-center bg-muted/50 p-2.5 rounded-lg border text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Store className="h-3.5 w-3.5 text-primary" /> Filter Cabang Aktif:
                </span>
                <span className="font-semibold text-primary">
                  {selectedBranch === "all" ? "Semua Cabang" : selectedBranch}
                </span>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <div>
                  <span className="text-muted-foreground">Total Pemasukan</span>
                  <div className="text-[11px] text-muted-foreground">
                    Cash: {rupiah(overallCashRevenue)} · QRIS: {rupiah(overallQrisRevenue)}
                  </div>
                </div>
                <span className="font-semibold text-success">{rupiah(overallRevenue)}</span>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <div>
                  <span className="text-muted-foreground">Total Pengeluaran</span>
                  <div className="text-[11px] text-muted-foreground">
                    Cash: {rupiah(cashExpenditure)} · QRIS: {rupiah(qrisExpenditure)}
                  </div>
                </div>
                <span className="font-semibold text-destructive">{rupiah(totalExpenditure)}</span>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <div>
                  <span className="text-muted-foreground">Total Restok</span>
                  <div className="text-[11px] text-muted-foreground">Mengurangi pendapatan bersih keseluruhan</div>
                </div>
                <span className="font-semibold text-destructive">{`-${rupiah(restockTotal)}`}</span>
              </div>
              <div className="flex justify-between items-center pt-2 text-base font-bold">
                <span>Pendapatan Bersih</span>
                <span className={netIncome >= 0 ? "text-success" : "text-destructive"}>{rupiah(netIncome)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                * Data pendapatan bersih di atas telah disesuaikan dengan filter:{" "}
                <strong>{selectedBranch === "all" ? "Semua Cabang" : selectedBranch}</strong>.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className={
        onClick ? "cursor-pointer hover:border-primary/50 hover:shadow-md transition active:scale-[0.98]" : ""
      }
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-bold mt-1">{value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
          </div>
          <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
