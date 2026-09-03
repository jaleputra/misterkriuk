import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { rupiah } from "@/lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PackagePlus, History, Plus, Trash2, Pencil, Eye, Search, Store } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/warehouse")({
  ssr: false,
  component: WarehousePage,
});

function WarehousePage() {
  const qc = useQueryClient();
  const { role: rawRole, branchName, user } = useAuth();
  const isExplicitKasir = user?.email?.toLowerCase().trim() === "kasir@gmail.com" || user?.email?.toLowerCase().includes("kasir");
  const role: "admin" | "cashier" = isExplicitKasir
    ? "cashier"
    : rawRole || (user?.email?.toLowerCase().trim() === "jaleputra69@gmail.com" ? "admin" : "cashier");
  const [dateFilter, setDateFilter] = useState<"today" | "7" | "14" | "30" | "month" | "all">("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const customRange = !!(fromDate && toDate);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("branches").select("*").order("created_at", { ascending: true });
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

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["stock_entries", dateFilter, fromDate, toDate],
    queryFn: async () => {
      let sinceDateStr: string | null = null;
      let untilDateStr: string | null = null;

      if (customRange) {
        sinceDateStr = fromDate;
        untilDateStr = toDate;
      } else if (dateFilter !== "all") {
        const since = new Date();
        if (dateFilter === "today") since.setHours(0, 0, 0, 0);
        else if (dateFilter === "7") since.setDate(since.getDate() - 6);
        else if (dateFilter === "14") since.setDate(since.getDate() - 13);
        else if (dateFilter === "30") since.setDate(since.getDate() - 29);
        else if (dateFilter === "month") since.setDate(1);
        since.setHours(0, 0, 0, 0);
        sinceDateStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
      }

      return await fetchAllRows<any>((from, to) => {
        let q = supabase
          .from("stock_entries")
          .select("*, stock_movements(*, products(name))")
          .order("restock_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(from, to);
        if (sinceDateStr) q = q.gte("restock_date", sinceDateStr);
        if (untilDateStr) q = q.lte("restock_date", untilDateStr);
        return q;
      });
    },
  });

  const { data: userRoles = [] } = useQuery({
    queryKey: ["user_roles_branch_map"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("user_id, role, branch_name");
      return data ?? [];
    },
  });

  const cashierBranchMap = useMemo(() => {
    const map: Record<string, string> = {};
    userRoles.forEach((ur: any) => {
      if (ur.user_id && ur.branch_name) {
        map[ur.user_id] = ur.branch_name;
      }
    });
    return map;
  }, [userRoles]);

  const branchMatch = (b1?: string | null, b2?: string | null) => {
    if (!b1 || !b2) return false;
    return b1.trim().toLowerCase() === b2.trim().toLowerCase();
  };

  const getEntryBranch = (e: any) => {
    if (e.branch_name?.trim()) return e.branch_name.trim();
    if (e.created_by && cashierBranchMap[e.created_by]) return cashierBranchMap[e.created_by];
    return null;
  };

  type DraftLine = { product_name: string; quantity: string; initial_price: string };
  const emptyLine = (): DraftLine => ({ product_name: "", quantity: "", initial_price: "" });
  const [restockDate, setRestockDate] = useState(new Date().toISOString().slice(0, 10));
  const [shippingCost, setShippingCost] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qris">("cash");
  const [entryType, setEntryType] = useState<"expense" | "restock">("expense");
  const [selectedBranch, setSelectedBranch] = useState<string>("");

  // Filter cabang khusus untuk Riwayat Pengeluaran (Admin)
  const [historyBranchFilter, setHistoryBranchFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("app_admin_selected_branch") || "all";
    }
    return "all";
  });

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    branches.forEach((b: any) => {
      if (b.branch_name?.trim()) set.add(b.branch_name.trim());
    });
    userRoles.forEach((ur: any) => {
      if (ur.branch_name?.trim()) set.add(ur.branch_name.trim());
    });
    (entries as any[]).forEach((e: any) => {
      const b = getEntryBranch(e);
      if (b?.trim()) set.add(b.trim());
    });
    return Array.from(set);
  }, [branches, userRoles, entries, cashierBranchMap]);

  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filteredEntries = useMemo(() => {
    let list = entries as any[];
    if (role === "cashier") {
      const myBranch = branchName || cashierBranchMap[user?.id || ""] || "";
      list = list.filter((e) => {
        if (user?.id && e.created_by === user.id) return true;
        const eb = getEntryBranch(e);
        if (myBranch && eb) return branchMatch(eb, myBranch);
        return false;
      });
    } else if (role === "admin" && historyBranchFilter !== "all") {
      list = list.filter((e) => branchMatch(getEntryBranch(e), historyBranchFilter));
    }

    const term = search.trim().toLocaleLowerCase("id-ID");
    if (term.length < 3) return list;
    return list.filter((entry) => {
      const names = entry.stock_movements
        .map((m: any) => (m.products?.name ?? "").replace(/^\[GUDANG\]\s*/i, ""))
        .join(" ");
      const bName = getEntryBranch(entry) ?? "";
      const hay = [
        names,
        entry.branch_name,
        bName,
        entry.restock_date,
        new Date(`${entry.restock_date}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
        String(entry.shipping_cost ?? ""),
      ]
        .join(" ")
        .toLocaleLowerCase("id-ID");
      return hay.includes(term);
    });
  }, [entries, role, branchName, cashierBranchMap, user?.id, historyBranchFilter, search]);

  const totalHistoryAmount = useMemo(() => {
    return filteredEntries.reduce((sum, entry) => {
      const movementsCost = (entry.stock_movements ?? []).reduce(
        (s: number, m: any) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0),
        0
      );
      return sum + Number(entry.shipping_cost ?? 0) + movementsCost;
    }, 0);
  }, [filteredEntries]);

  const reset = () => {
    setRestockDate(new Date().toISOString().slice(0, 10));
    setShippingCost("");
    setPaymentMethod("cash");
    setEntryType("expense");
    setSelectedBranch("");
    setLines([emptyLine()]);
    setEditingEntry(null);
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stock_entries"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const add = useMutation({
    mutationFn: async () => {
      const validLines = lines.filter((line) => line.product_name.trim() && Number(line.quantity) > 0);
      if (validLines.length === 0) throw new Error("Tambahkan minimal satu produk");
      if (new Set(validLines.map((line) => line.product_name.trim().toLowerCase())).size !== validLines.length)
        throw new Error("Produk yang sama tidak boleh dimasukkan dua kali");

      const assignedBranch = role === "cashier" ? (branchName || null) : (selectedBranch.trim() || null);
      if (role === "admin" && !selectedBranch.trim()) {
        throw new Error("Admin wajib memilih cabang untuk pengeluaran ini!");
      }

      const { data: u } = await supabase.auth.getUser();

      // Cari atau buat produk secara dinamis menggunakan kategori 'customer' dengan prefix '[GUDANG] '
      const resolvedMovements = [];
      for (const line of validLines) {
        const nameClean = line.product_name.trim();
        const prefixedName = `[GUDANG] ${nameClean}`;
        let { data: existingProd } = await supabase
          .from("products")
          .select("id")
          .eq("name", prefixedName)
          .eq("category", "customer")
          .maybeSingle();

        let prodId = existingProd?.id;
        if (!prodId) {
          const { data: newProd, error: newProdErr } = await supabase
            .from("products")
            .insert({
              name: prefixedName,
              category: "customer",
              price: 0,
              stock: 0,
            })
            .select("id")
            .single();
          if (newProdErr) throw newProdErr;
          prodId = newProd.id;
        }

        resolvedMovements.push({
          product_id: prodId,
          quantity: Number(line.quantity),
          initial_price: Number(line.initial_price || 0),
          created_by: u.user?.id,
        });
      }

      if (editingEntry) {
        const updatePayload: any = {
          restock_date: restockDate,
          shipping_cost: Number(shippingCost || 0),
          payment_method: paymentMethod,
          entry_type: entryType,
          branch_name: assignedBranch,
        };

        try {
          const { error: entryError } = await supabase
            .from("stock_entries")
            .update(updatePayload)
            .eq("id", editingEntry);
          if (entryError) throw entryError;
        } catch {
          const { branch_name, ...basicPayload } = updatePayload;
          const { error: entryError } = await supabase
            .from("stock_entries")
            .update(basicPayload)
            .eq("id", editingEntry);
          if (entryError) throw entryError;
        }

        const { error: deleteError } = await supabase
          .from("stock_movements")
          .delete()
          .eq("stock_entry_id", editingEntry);
        if (deleteError) throw deleteError;
        const { error: lineError } = await supabase.from("stock_movements").insert(
          resolvedMovements.map((rm) => ({
            ...rm,
            stock_entry_id: editingEntry,
          })),
        );
        if (lineError) throw lineError;
        return;
      }

      const insertPayload: any = {
        restock_date: restockDate,
        shipping_cost: Number(shippingCost || 0),
        payment_method: paymentMethod,
        entry_type: entryType,
        created_by: u.user?.id,
        branch_name: assignedBranch,
      };

      let entry: any = null;
      try {
        const { data: createdEntry, error: entryError } = await supabase
          .from("stock_entries")
          .insert(insertPayload)
          .select("id")
          .single();
        if (entryError) throw entryError;
        entry = createdEntry;
      } catch {
        const { branch_name, ...basicPayload } = insertPayload;
        const { data: createdEntry, error: entryError } = await supabase
          .from("stock_entries")
          .insert(basicPayload)
          .select("id")
          .single();
        if (entryError) throw entryError;
        entry = createdEntry;
      }

      const { error: lineError } = await supabase.from("stock_movements").insert(
        resolvedMovements.map((rm) => ({
          ...rm,
          stock_entry_id: entry.id,
        })),
      );
      if (lineError) {
        await supabase.from("stock_entries").delete().eq("id", entry.id);
        throw lineError;
      }
    },
    onSuccess: () => {
      toast.success(editingEntry ? "Riwayat stok diperbarui" : "Stok berhasil ditambahkan");
      reset();
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("stock_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Riwayat stok dihapus");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const edit = (entry: any) => {
    setEditingEntry(entry.id);
    setRestockDate(entry.restock_date);
    setShippingCost(String(entry.shipping_cost));
    setPaymentMethod((entry.payment_method as "cash" | "qris") ?? "cash");
    setEntryType((entry.entry_type as "expense" | "restock") ?? "expense");
    setSelectedBranch(entry.branch_name || "");

    setLines(
      entry.stock_movements.map((movement: any) => ({
        product_name: (movement.products?.name ?? "").replace(/^\[GUDANG\]\s*/, ""),
        quantity: String(movement.quantity),
        initial_price: String(movement.initial_price),
      })),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );
  const totalCapital =
    lines.reduce(
      (total, line) => total + Number(line.quantity || 0) * Number(line.initial_price || 0),
      0,
    ) + Number(shippingCost || 0);

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PackagePlus className="h-4 w-4" /> {editingEntry ? "Edit Pengeluaran" : "Pengeluaran"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            {/* Pilihan Cabang */}
            <div className="space-y-1.5">
              <Label>
                Cabang {role === "admin" && <span className="text-destructive">*</span>}
              </Label>
              {role === "admin" ? (
                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger>
                    <SelectValue placeholder="-- Pilih Cabang Pengeluaran --" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b: any) => (
                      <SelectItem key={b.id || b.branch_name} value={b.branch_name}>
                        {b.branch_name} {b.shop_name ? `(${b.shop_name})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={branchName || "Cabang Utama"}
                  disabled
                  className="bg-muted text-muted-foreground font-medium"
                />
              )}
              {role === "admin" && !selectedBranch && (
                <p className="text-[11px] text-muted-foreground">
                  Sebagai Admin, Anda harus menentukan cabang mana yang mengeluarkan biaya ini.
                </p>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tanggal Restock</Label>
                <Input
                  type="date"
                  value={restockDate}
                  onChange={(event) => setRestockDate(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ongkir Total (Rp)</Label>
                <Input
                  type="number"
                  min="0"
                  value={shippingCost}
                  onChange={(event) => setShippingCost(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Jenis Input</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={entryType === "expense" ? "default" : "outline"}
                  onClick={() => setEntryType("expense")}
                >
                  Pengeluaran
                </Button>
                <Button
                  type="button"
                  variant={entryType === "restock" ? "default" : "outline"}
                  onClick={() => setEntryType("restock")}
                >
                  Restok
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {entryType === "restock"
                  ? "Restok dihitung terpisah dan mengurangi pendapatan keseluruhan (bukan harian)."
                  : "Pengeluaran mengurangi pendapatan harian sesuai tanggal & metode pembayaran."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Metode Pembayaran</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={paymentMethod === "cash" ? "default" : "outline"}
                  onClick={() => setPaymentMethod("cash")}
                >
                  Cash
                </Button>
                <Button
                  type="button"
                  variant={paymentMethod === "qris" ? "default" : "outline"}
                  onClick={() => setPaymentMethod("qris")}
                >
                  QRIS
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Daftar Produk</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLines((current) => [...current, emptyLine()])}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Produk
                </Button>
              </div>
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_80px_110px_auto] gap-2 items-end"
                >
                  <div className="space-y-1">
                    <Label className="text-xs">Nama Belanjaan</Label>
                    <Input
                      value={line.product_name}
                      onChange={(event) => updateLine(index, { product_name: event.target.value })}
                      placeholder="Contoh: Ayam, Beras, Cup"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Jumlah</Label>
                    <Input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(event) => updateLine(index, { quantity: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Modal/pcs</Label>
                    <Input
                      type="number"
                      min="0"
                      value={line.initial_price}
                      onChange={(event) => updateLine(index, { initial_price: event.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Total Modal</Label>
              <div className="rounded-md bg-muted p-2 font-semibold">{rupiah(totalCapital)}</div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" type="submit" disabled={add.isPending}>
                Simpan Semua
              </Button>
              {editingEntry && (
                <Button type="button" variant="outline" onClick={reset}>
                  Batal
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between w-full flex-wrap gap-2">
            <span className="flex items-center gap-2">
              <History className="h-4 w-4" /> Riwayat Pengeluaran
            </span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs font-semibold text-destructive bg-destructive/5">
                Total: {rupiah(totalHistoryAmount)} ({filteredEntries.length} entri)
              </Badge>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2.5 border-b pb-3 mb-2">
            {/* Filter Cabang untuk Admin */}
            {role === "admin" && (
              <div className="flex items-center justify-between flex-wrap gap-2 p-2 bg-muted/40 rounded-lg border">
                <div className="flex items-center gap-1.5">
                  <Store className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">Filter Cabang:</span>
                </div>
                <Select
                  value={historyBranchFilter}
                  onValueChange={(val) => {
                    setHistoryBranchFilter(val);
                    if (typeof window !== "undefined") {
                      localStorage.setItem("app_admin_selected_branch", val);
                    }
                  }}
                >
                  <SelectTrigger className="w-[180px] h-8 text-xs bg-background">
                    <SelectValue placeholder="Pilih Cabang" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <span className="font-semibold">Semua Cabang</span>
                    </SelectItem>
                    {branchOptions.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Filter Tanggal:</span>
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
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-muted-foreground">Rentang Kustom:</span>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 w-[130px] text-xs"
              />
              <span className="text-muted-foreground">s/d</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 w-[130px] text-xs"
              />
              {(fromDate || toDate) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                  }}
                >
                  Reset
                </Button>
              )}
            </div>
            {customRange && (
              <span className="text-[10px] text-primary italic">
                (Rentang kustom aktif — filter tanggal di atas diabaikan)
              </span>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              placeholder="Ketik minimal 3 huruf untuk mencari riwayat (produk, tanggal, ongkir)"
            />
          </div>
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground">Belum ada riwayat.</p>
          )}
          {entries.length > 0 && filteredEntries.length === 0 && (
            <p className="text-sm text-muted-foreground">Tidak ada riwayat yang cocok.</p>
          )}
          {filteredEntries.map((entry: any) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card"
            >
              <div className="space-y-0.5">
                <div className="font-semibold text-sm sm:text-base text-foreground">
                  {entry.stock_movements
                    .map((m: any) => (m.products?.name ?? "").replace(/^\[GUDANG\]\s*/i, ""))
                    .filter(Boolean)
                    .join(", ")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(`${entry.restock_date}T00:00:00`).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                  <span
                    className={`px-1.5 py-0.5 rounded-full font-medium ${
                      (entry.entry_type ?? "expense") === "restock"
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {(entry.entry_type ?? "expense") === "restock" ? "Restok" : "Pengeluaran"}
                  </span>
                  {(entry.branch_name || getEntryBranch(entry)) && (
                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium flex items-center gap-1">
                      <Store className="h-2.5 w-2.5" />
                      {entry.branch_name || getEntryBranch(entry)}
                    </span>
                  )}
                  <span>
                    {entry.stock_movements.length} produk ·{" "}
                    {entry.stock_movements.reduce(
                      (sum: number, movement: any) => sum + movement.quantity,
                      0,
                    )}{" "}
                    pcs
                  </span>
                </div>

              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="font-semibold text-sm sm:text-base text-foreground">
                  {rupiah(
                    Number(entry.shipping_cost ?? 0) +
                    entry.stock_movements.reduce(
                      (s: number, m: any) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0),
                      0
                    )
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setSelectedEntry(entry)}
                    aria-label="Lihat detail"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  {role === "admin" && (
                    <>
                      <Button size="icon" variant="ghost" onClick={() => edit(entry)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Hapus riwayat dan kurangi stok terkait?")) remove.mutate(entry.id);
                        }}
                        aria-label="Hapus"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Dialog
        open={!!selectedEntry}
        onOpenChange={(open) => {
          if (!open) setSelectedEntry(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detail Pengeluaran</DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tanggal restock</span>
                <span>
                  {new Date(`${selectedEntry.restock_date}T00:00:00`).toLocaleDateString("id-ID")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ongkir</span>
                <span>{rupiah(selectedEntry.shipping_cost)}</span>
              </div>
              <div className="border-t pt-2 space-y-2">
                {selectedEntry.stock_movements.map((movement: any) => (
                  <div key={movement.id} className="flex justify-between gap-4">
                    <div>
                      <div className="font-medium">
                        {(movement.products?.name ?? "—").replace(/^\[GUDANG\]\s*/, "")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {movement.quantity} × {rupiah(movement.initial_price)}
                      </div>
                    </div>
                    <span>{rupiah(movement.quantity * Number(movement.initial_price))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
