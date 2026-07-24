import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rupiah } from "@/lib/format";
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  BarChart3,
  ArrowLeft,
  Printer,
  Share2,
  Trash2,
  Save,
  ShoppingBag,
} from "lucide-react";
import { printReceiptThermalClient, isPrinterConnectedClient } from "@/lib/thermal-printer.actions";
import { printReceiptPdfClient, shareReceiptImageClient } from "@/lib/receipt-pdf.actions";
import { Receipt } from "@/components/Receipt";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [dateFilter, setDateFilter] = useState<"today" | "7" | "14" | "30" | "month" | "all">("14");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const customRange = !!(fromDate && toDate);
  const [detailModal, setDetailModal] = useState<{
    open: boolean;
    title: string;
    type: "pemasukan" | "pengeluaran" | "pendapatan" | null;
  }>({
    open: false,
    title: "",
    type: null,
  });

  const { data } = useQuery({
    queryKey: ["dashboard", dateFilter, fromDate, toDate],
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

      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const sinceDateStr = fmt(since);
      const untilDateStr = until ? fmt(until) : null;

      let txQ = supabase
        .from("transactions")
        .select("*")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .range(0, 9999);
      if (until) txQ = txQ.lte("created_at", until.toISOString());

      let seQ = supabase.from("stock_entries").select("*").gte("restock_date", sinceDateStr);
      if (untilDateStr) seQ = seQ.lte("restock_date", untilDateStr);

      const [txRes, productsRes, stockEntriesRes, stockMovementsRes] = await Promise.all([
        txQ,
        supabase.from("products").select("*"),
        seQ,
        supabase.from("stock_movements").select("*, products(name)"),
      ]);

      if (txRes.error) console.error("dashboard tx query error:", txRes.error);

      const txs = txRes.data ?? [];
      const txIds = txs.map((t) => t.id);

      let itemsData: any[] = [];
      if (txIds.length > 0) {
        // Chunk transaction IDs to avoid HTTP 414 Request-URI Too Long errors
        const chunkSize = 100;
        const chunks = [];
        for (let i = 0; i < txIds.length; i += chunkSize) {
          chunks.push(txIds.slice(i, i + chunkSize));
        }

        const results = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("transaction_items")
              .select("*")
              .in("transaction_id", chunk)
              .range(0, 19999)
          )
        );

        for (const res of results) {
          if (res.error) {
            console.error("dashboard items query error in chunk:", res.error);
          } else {
            itemsData.push(...(res.data ?? []));
          }
        }
      }

      return {
        transactions: txs,
        items: itemsData,
        products: productsRes.data ?? [],
        stockEntries: stockEntriesRes.data ?? [],
        stockMovements: stockMovementsRes.data ?? [],
      };
    },
    refetchInterval: 30000,
  });

  const [deletedTxIds, setDeletedTxIds] = useState<string[]>([]);
  const [localEditedTxs, setLocalEditedTxs] = useState<Record<string, any>>({});

  const txs = useMemo(() => {
    const rawTxs = data?.transactions ?? [];
    return rawTxs
      .filter((t) => !deletedTxIds.includes(t.id))
      .map((t) => {
        if (localEditedTxs[t.id]) {
          return { ...t, ...localEditedTxs[t.id] };
        }
        return t;
      });
  }, [data?.transactions, deletedTxIds, localEditedTxs]);

  const items = data?.items ?? [];
  const products = data?.products ?? [];
  const stockEntries = data?.stockEntries ?? [];
  const stockMovements = data?.stockMovements ?? [];

  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["printer_settings"],
    queryFn: async () => (await supabase.from("printer_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [selectedTxItems, setSelectedTxItems] = useState<any[]>([]);
  const [editForm, setEditForm] = useState({
    payment_method: "cash",
    house_block: "",
    cash_received: "",
    partner_name: "",
  });

  const handleSelectTx = async (t: any) => {
    setEditingTxId(t.id);
    setEditForm({
      payment_method: t.payment_method,
      house_block: t.house_block ?? "",
      cash_received: String(t.cash_received ?? ""),
      partner_name: t.partner_name ?? "",
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

  const deleteTransaction = useMutation({
    mutationFn: async (txId: string) => {
      const txItems = items.filter((item) => item.transaction_id === txId);
      
      // Kembalikan stok produk
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
      
      // Hapus items
      const { error: itemsErr } = await supabase
        .from("transaction_items")
        .delete()
        .eq("transaction_id", txId);
      if (itemsErr) throw itemsErr;
      
      // Hapus transaksi
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
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: Error) => {
      toast.error("Gagal menghapus transaksi: " + err.message);
    }
  });

  const editTransaction = useMutation({
    mutationFn: async () => {
      if (!editingTxId) return;
      const totalAmt = Number(txs.find((t) => t.id === editingTxId)?.total ?? 0);
      const isCash = editForm.payment_method === "cash";
      const cashVal = Number(editForm.cash_received) || 0;
      
      if (isCash && cashVal < totalAmt) {
        throw new Error("Uang tunai kurang");
      }
      
      const changeAmt = isCash ? Math.max(0, cashVal - totalAmt) : null;
      
      const { data: updatedTx, error } = await supabase
        .from("transactions")
        .update({
          payment_method: editForm.payment_method,
          house_block: editForm.house_block.trim() || null,
          cash_received: isCash ? cashVal : null,
          change_amount: changeAmt,
          partner_name: editForm.partner_name.trim() || null,
        })
        .eq("id", editingTxId)
        .select();
      if (error) throw error;
      if (!updatedTx || updatedTx.length === 0) {
        throw new Error("Gagal memperbarui transaksi. Baris data tidak ditemukan atau izin RLS ditolak.");
      }
    },
    onSuccess: () => {
      toast.success("Transaksi berhasil diperbarui");
      if (editingTxId) {
        setLocalEditedTxs((prev) => ({
          ...prev,
          [editingTxId]: {
            payment_method: editForm.payment_method,
            house_block: editForm.house_block.trim() || null,
            cash_received: editForm.payment_method === "cash" ? Number(editForm.cash_received) : null,
            change_amount: editForm.payment_method === "cash" ? Math.max(0, (Number(editForm.cash_received) || 0) - Number(txs.find((t) => t.id === editingTxId)?.total ?? 0)) : null,
            partner_name: editForm.partner_name.trim() || null,
          },
        }));
      }
      setEditingTxId(null);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err: Error) => {
      toast.error("Gagal memperbarui transaksi: " + err.message);
    }
  });

  const getReceiptTx = (tx: any, txItems?: any[]) => {
    let finalItems = txItems ?? selectedTxItems;
    if (finalItems.length === 0) {
      finalItems = items.filter((item) => item.transaction_id === tx.id);
    }
    return {
      ...tx,
      items: finalItems,
      payment_method: editForm.payment_method,
      cash_received: editForm.payment_method === "cash" ? Number(editForm.cash_received) || 0 : null,
      change_amount: editForm.payment_method === "cash" ? Math.max(0, (Number(editForm.cash_received) || 0) - Number(tx.total)) : null,
      house_block: editForm.house_block || null,
      partner_name: editForm.partner_name || null,
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
      toast.success("Struk berhasil dikirim ke printer");
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

  // Pemasukan
  const totalRevenue = useMemo(() => txs.reduce((s, t) => s + Number(t.total), 0), [txs]);
  const cashRevenue = useMemo(() => txs.filter((t) => t.payment_method === "cash").reduce((s, t) => s + Number(t.total), 0), [txs]);
  const qrisRevenue = useMemo(() => txs.filter((t) => t.payment_method === "qris").reduce((s, t) => s + Number(t.total), 0), [txs]);

  // Pengeluaran
  const totalExpenditure = useMemo(() => {
    const entryIds = new Set(stockEntries.map((e) => e.id));
    const shipping = stockEntries.reduce((s, e) => s + Number(e.shipping_cost ?? 0), 0);
    const materials = stockMovements
      .filter((m) => m.stock_entry_id && entryIds.has(m.stock_entry_id))
      .reduce((s, m) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0), 0);
    return shipping + materials;
  }, [stockEntries, stockMovements]);

  // Pengeluaran per metode pembayaran
  const cashExpenditure = useMemo(() => {
    const ids = new Set(stockEntries.filter((e: any) => (e.payment_method ?? "cash") === "cash").map((e) => e.id));
    const ship = stockEntries.filter((e: any) => (e.payment_method ?? "cash") === "cash").reduce((s, e) => s + Number(e.shipping_cost ?? 0), 0);
    const mat = stockMovements.filter((m) => m.stock_entry_id && ids.has(m.stock_entry_id))
      .reduce((s, m) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0), 0);
    return ship + mat;
  }, [stockEntries, stockMovements]);
  const qrisExpenditure = useMemo(() => {
    const ids = new Set(stockEntries.filter((e: any) => e.payment_method === "qris").map((e) => e.id));
    const ship = stockEntries.filter((e: any) => e.payment_method === "qris").reduce((s, e) => s + Number(e.shipping_cost ?? 0), 0);
    const mat = stockMovements.filter((m) => m.stock_entry_id && ids.has(m.stock_entry_id))
      .reduce((s, m) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0), 0);
    return ship + mat;
  }, [stockEntries, stockMovements]);

  // Pendapatan Bersih (Cash + QRIS net)
  const netCash = useMemo(() => cashRevenue - cashExpenditure, [cashRevenue, cashExpenditure]);
  const netQris = useMemo(() => qrisRevenue - qrisExpenditure, [qrisRevenue, qrisExpenditure]);
  const netIncome = useMemo(() => netCash + netQris, [netCash, netQris]);

  // Create product category lookup map
  const productCategoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    products.forEach((p) => {
      let cat = p.category || "customer";
      if (cat.startsWith("deleted_")) {
        cat = cat.replace("deleted_", "");
      }
      map[p.id] = cat;
    });
    return map;
  }, [products]);

  // Helper function to check if item is from partner transaction or is a partner product
  const isPartnerItem = (item: any, tx: any) => {
    if (tx?.sale_category === "partner") return true;
    
    let cat = "customer";
    if (item.product_id && productCategoryMap[item.product_id]) {
      cat = productCategoryMap[item.product_id];
    } else if (item.product_name?.startsWith("[GUDANG]")) {
      cat = "gudang";
    }
    return cat === "partner";
  };

  // Jumlah Produk Terjual (kecuali partner)
  const totalProductsSold = useMemo(() => {
    const txMap = new Map(txs.map((t) => [t.id, t]));
    return items
      .filter((item) => {
        const tx = txMap.get(item.transaction_id);
        if (!tx) return false;
        return !isPartnerItem(item, tx);
      })
      .reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
  }, [items, txs, productCategoryMap]);

  // Informasi Pack (4 dada, 2 paha atas, 2 paha bawah, 2 sayap = 1 pack)
  const packInfo = useMemo(() => {
    const txMap = new Map(txs.map((t) => [t.id, t]));
    const activeItems = items.filter((item) => {
      const tx = txMap.get(item.transaction_id);
      if (!tx) return false;
      return !isPartnerItem(item, tx);
    });

    let dada = 0;
    let pahaAtas = 0;
    let pahaBawah = 0;
    let sayap = 0;

    activeItems.forEach((item) => {
      const name = (item.product_name || "").toLowerCase();
      const qty = Number(item.quantity ?? 0);
      if (name.includes("dada")) {
        dada += qty;
      } else if (name.includes("paha atas")) {
        pahaAtas += qty;
      } else if (name.includes("paha bawah")) {
        pahaBawah += qty;
      } else if (name.includes("sayap")) {
        sayap += qty;
      }
    });

    const totalAyam = dada + pahaAtas + pahaBawah + sayap;
    const packs = Math.ceil(totalAyam / 10);

    return { packs, dada, pahaAtas, pahaBawah, sayap };
  }, [items, txs, productCategoryMap]);

  // Daily revenue line chart data
  const daily = useMemo(() => {
    const dailyMap: Record<string, number> = {};
    let daysCount = 14;
    if (dateFilter === "today") daysCount = 1;
    else if (dateFilter === "7") daysCount = 7;
    else if (dateFilter === "30") daysCount = 30;
    else if (dateFilter === "month") {
      const todayDate = new Date();
      daysCount = todayDate.getDate();
    } else if (dateFilter === "all") {
      daysCount = 60; // Show last 60 days
    }

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dailyMap[d.toISOString().slice(0, 10)] = 0;
    }
    txs.forEach((t) => {
      const day = t.created_at.slice(0, 10);
      if (day in dailyMap) dailyMap[day] += Number(t.total);
    });
    return Object.entries(dailyMap).map(([d, v]) => ({
      date: new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
      revenue: v,
    }));
  }, [txs, dateFilter]);

  // Payment split pie chart
  const payments = useMemo(() => {
    const payMap: Record<string, number> = { cash: 0, qris: 0 };
    txs.forEach((t) => {
      payMap[t.payment_method] = (payMap[t.payment_method] ?? 0) + Number(t.total);
    });
    return [
      { name: "Cash", value: payMap.cash },
      { name: "QRIS", value: payMap.qris },
    ];
  }, [txs]);
  const PIE_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)"];

  // Buyer house block bar chart data
  const blockChartData = useMemo(() => {
    const blockMap: Record<string, { block: string; count: number; revenue: number }> = {};
    txs.forEach((t) => {
      const block = t.house_block?.trim().toUpperCase() || "TANPA BLOK";
      if (!blockMap[block]) {
        blockMap[block] = { block, count: 0, revenue: 0 };
      }
      blockMap[block].count += 1;
      blockMap[block].revenue += Number(t.total);
    });
    return Object.values(blockMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [txs]);

  return (
    <div className="space-y-4">
      {/* Header and Filter */}
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-xl font-bold">Dashboard Ringkasan</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filter Waktu:</span>
          <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
            <SelectTrigger className="w-[150px]">
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

      {/* Custom date range filter (new) */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-muted-foreground">Rentang Kustom:</span>
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-[150px]" />
        <span className="text-muted-foreground">s/d</span>
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 w-[150px]" />
        {(fromDate || toDate) && (
          <Button size="sm" variant="ghost" className="h-8" onClick={() => { setFromDate(""); setToDate(""); }}>Reset</Button>
        )}
        {customRange && (
          <span className="text-[10px] text-primary">(Rentang kustom aktif — filter waktu di atas diabaikan)</span>
        )}
      </div>

      {/* Simplified Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          icon={DollarSign}
          label="Pemasukan"
          value={role === "cashier" ? "XXXXX" : rupiah(totalRevenue)}
          sub={role === "cashier" ? `${txs.length} Tx · Cash: XXXXX · QRIS: XXXXX` : `${txs.length} Tx · Cash: ${rupiah(cashRevenue)} · QRIS: ${rupiah(qrisRevenue)}`}
          onClick={() => navigate({ to: "/income-details", search: { dateFilter, fromDate: fromDate || undefined, toDate: toDate || undefined } })}
        />
        <Stat
          icon={TrendingUp}
          label="Pengeluaran"
          value={role === "cashier" ? "XXXXX" : rupiah(totalExpenditure)}
          sub={`${stockEntries.length} Restok Gudang`}
          onClick={() => navigate({ to: "/expense-details", search: { dateFilter, fromDate: fromDate || undefined, toDate: toDate || undefined } })}
        />
        <Stat
          icon={BarChart3}
          label="Pendapatan Bersih"
          value={role === "cashier" ? "XXXXX" : rupiah(netIncome)}
          sub={role === "cashier" ? "Cash: XXXXX · QRIS: XXXXX" : `Cash: ${rupiah(netCash)} · QRIS: ${rupiah(netQris)}`}
          onClick={() => setDetailModal({
            open: true,
            title: "Detail Pendapatan Bersih",
            type: "pendapatan",
          })}
        />
        <Stat
          icon={ShoppingBag}
          label="Jumlah Produk Terjual"
          value={`${totalProductsSold} Pcs (${packInfo.packs} Pack)`}
          sub={`Detail: D:${packInfo.dada} · PA:${packInfo.pahaAtas} · PB:${packInfo.pahaBawah} · S:${packInfo.sayap}`}
          onClick={() => navigate({ to: "/sold-products", search: { dateFilter, fromDate: fromDate || undefined, toDate: toDate || undefined } })}
        />
      </div>

      {role !== "cashier" && (
        <>
          {/* Revenue Over Time Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Grafik Pendapatan Harian</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={11} />
                  <YAxis
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => rupiah(v)}
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                    }}
                  />
                  <Bar
                    dataKey="revenue"
                    name="Pendapatan"
                    fill="var(--color-primary)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Bottom Chart Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Buyer House Block Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Grafik Blok Rumah Pembeli (Pendapatan)</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={blockChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis
                      type="category"
                      dataKey="block"
                      width={100}
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                    />
                    <Tooltip
                      formatter={(v: number) => rupiah(v)}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="revenue" name="Pemasukan" fill="var(--color-primary)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Payment Methods Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Metode Pembayaran</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={payments} dataKey="value" nameKey="name" outerRadius={80} label>
                      {payments.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => rupiah(v)}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Details Dialog */}
      <Dialog
        open={detailModal.open}
        onOpenChange={(open) => {
          if (!open) {
            setDetailModal((m) => ({ ...m, open: false }));
            setEditingTxId(null);
          }
        }}
      >
        <DialogContent className={detailModal.type === "pemasukan" && editingTxId ? "max-w-3xl" : "max-w-md"}>
          <DialogHeader>
            <DialogTitle>{detailModal.title}</DialogTitle>
          </DialogHeader>

          {detailModal.type === "pemasukan" && !editingTxId && (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {txs.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">Belum ada pemasukan di periode ini.</p>
              ) : (
                txs.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => handleSelectTx(t)}
                    className="flex justify-between items-center border-b pb-2 text-sm cursor-pointer hover:bg-muted/50 p-2 rounded transition active:scale-[0.98]"
                  >
                    <div>
                      <div className="font-semibold">
                        No: {t.id.slice(0, 8).toUpperCase()}
                        {t.partner_name ? ` · Partner: ${t.partner_name}` : t.buyer_name ? ` · ${t.buyer_name}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(t.created_at).toLocaleString("id-ID")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-success">{rupiah(t.total)}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">
                        {t.payment_method} {t.house_block ? `(Blok ${t.house_block})` : ""}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {detailModal.type === "pemasukan" && editingTxId && (() => {
            const selectedTx = txs.find((t) => t.id === editingTxId);
            if (!selectedTx) return null;
            const selectedItems = selectedTxItems;
            const totalAmt = Number(selectedTx.total);
            const isCash = editForm.payment_method === "cash";
            const cashVal = Number(editForm.cash_received) || 0;
            const changeAmt = isCash ? Math.max(0, cashVal - totalAmt) : 0;

            return (
              <div className="space-y-4 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingTxId(null)}
                  className="mb-2"
                >
                  <ArrowLeft className="h-4 w-4 mr-1" /> Kembali ke Daftar
                </Button>

                <div className="grid md:grid-cols-2 gap-4">
                  {/* Left Column: Struk Preview */}
                  <div className="border rounded-lg p-2 bg-muted/20">
                    <Receipt tx={{ ...selectedTx, items: selectedItems }} settings={settings} />
                  </div>

                  {/* Right Column: Edit Form & Actions */}
                  <div className="space-y-4">
                    <div className="space-y-3 border rounded-lg p-3 bg-card">
                      <h3 className="font-semibold text-sm">Edit Data Transaksi</h3>
                      
                      <div className="space-y-1.5">
                        <Label>Metode Pembayaran</Label>
                        <Select
                          value={editForm.payment_method}
                          onValueChange={(v) => setEditForm({ ...editForm, payment_method: v })}
                        >
                          <SelectTrigger>
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
                          <Label>Uang Tunai Diterima</Label>
                          <Input
                            type="number"
                            min="0"
                            value={editForm.cash_received}
                            onChange={(e) => setEditForm({ ...editForm, cash_received: e.target.value })}
                          />
                          <div className="text-xs text-muted-foreground flex justify-between mt-1">
                            <span>Tagihan: {rupiah(totalAmt)}</span>
                            <span className="text-success font-semibold">Kembalian: {rupiah(changeAmt)}</span>
                          </div>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label>Blok Rumah (opsional)</Label>
                        <Input
                          value={editForm.house_block}
                          onChange={(e) => setEditForm({ ...editForm, house_block: e.target.value })}
                          placeholder="Contoh: Blok A1"
                        />
                      </div>

                      {selectedTx.sale_category === "partner" && (
                        <div className="space-y-1.5">
                          <Label>Nama Partner</Label>
                          <Input
                            value={editForm.partner_name}
                            onChange={(e) => setEditForm({ ...editForm, partner_name: e.target.value })}
                            placeholder="Nama partner bisnis"
                          />
                        </div>
                      )}

                      <Button
                        className="w-full mt-2"
                        size="sm"
                        disabled={editTransaction.isPending}
                        onClick={() => editTransaction.mutate()}
                      >
                        <Save className="h-4 w-4 mr-1.5" /> Simpan Perubahan
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <h3 className="font-semibold text-xs text-muted-foreground px-1">Aksi Transaksi</h3>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePrintReceipt(selectedTx, selectedItems)}
                        >
                          <Printer className="h-4 w-4 mr-1.5" /> Cetak
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleShareReceipt(selectedTx, selectedItems)}
                        >
                          <Share2 className="h-4 w-4 mr-1.5" /> Bagikan Struk
                        </Button>
                      </div>
                      <Button
                        variant="destructive"
                        className="w-full mt-2"
                        size="sm"
                        disabled={deleteTransaction.isPending}
                        onClick={() => {
                          if (confirm("Apakah Anda yakin ingin menghapus transaksi ini? Stok produk akan dikembalikan otomatis dan data penjualan dihapus.")) {
                            deleteTransaction.mutate(selectedTx.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-1.5" /> Hapus Transaksi
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {detailModal.type === "pengeluaran" && (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {stockEntries.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">Belum ada pengeluaran di periode ini.</p>
              ) : (
                stockEntries.map((entry) => {
                  const movements = stockMovements.filter((m) => m.stock_entry_id === entry.id);
                  const subtotal = movements.reduce((s, m) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0), 0);
                  const groceryNames = movements
                    .map((m: any) => (m.products?.name ?? "").replace(/^\[GUDANG\]\s*/i, ""))
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <div key={entry.id} className="border-b pb-3 space-y-1 text-sm">
                      <div className="flex justify-between font-semibold gap-4">
                        <span className="truncate max-w-[200px] sm:max-w-xs">{groceryNames || `Pengeluaran #${entry.id.slice(0, 6).toUpperCase()}`}</span>
                        <span className="text-destructive font-bold shrink-0">{rupiah(subtotal + entry.shipping_cost)}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Tanggal: {entry.restock_date} | Ongkir: {rupiah(entry.shipping_cost)}
                      </div>
                      <div className="pl-2 border-l-2 border-primary/20 space-y-1 mt-1">
                        {movements.map((m: any) => {
                          const prodName = (m.products?.name ?? "").replace(/^\[GUDANG\]\s*/i, "");
                          return (
                            <div key={m.id} className="flex justify-between text-xs text-muted-foreground">
                              <span>{prodName || "—"} ({m.quantity} pcs)</span>
                              <span>{rupiah(m.quantity * m.initial_price)}</span>
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
              <div className="flex justify-between items-center border-b pb-2">
                <span className="text-muted-foreground">Total Pemasukan</span>
                <span className="font-semibold text-success">{role === "cashier" ? "XXXXX" : rupiah(totalRevenue)}</span>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <span className="text-muted-foreground">Total Pengeluaran</span>
                <span className="font-semibold text-destructive">{role === "cashier" ? "XXXXX" : rupiah(totalExpenditure)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 text-base font-bold">
                <span>Pendapatan Bersih</span>
                <span className={netIncome >= 0 ? "text-success" : "text-destructive"}>
                  {role === "cashier" ? "XXXXX" : rupiah(netIncome)}
                </span>
              </div>
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
      className={onClick ? "cursor-pointer hover:border-primary/50 hover:shadow-md transition active:scale-[0.98]" : ""}
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
