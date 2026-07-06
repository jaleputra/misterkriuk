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
import { shareReceiptImageClient } from "@/lib/receipt-pdf.actions";
import { Receipt } from "@/components/Receipt";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [dateFilter, setDateFilter] = useState<"today" | "7" | "14" | "30" | "month" | "all">("14");
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
    queryKey: ["dashboard", dateFilter],
    queryFn: async () => {
      const since = new Date();
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

      const sinceDateStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;

      const [tx, items, prods, stockEntries, stockMovements] = await Promise.all([
        supabase.from("transactions").select("*").gte("created_at", since.toISOString()),
        supabase.from("transaction_items").select("*"),
        supabase.from("products").select("*"),
        supabase.from("stock_entries").select("*").gte("restock_date", sinceDateStr),
        supabase.from("stock_movements").select("*, products(name)"),
      ]);
      return {
        transactions: tx.data ?? [],
        items: items.data ?? [],
        products: prods.data ?? [],
        stockEntries: stockEntries.data ?? [],
        stockMovements: stockMovements.data ?? [],
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
  const [editForm, setEditForm] = useState({
    payment_method: "cash",
    house_block: "",
    cash_received: "",
    partner_name: "",
  });

  const handleSelectTx = (t: any) => {
    setEditingTxId(t.id);
    setEditForm({
      payment_method: t.payment_method,
      house_block: t.house_block ?? "",
      cash_received: String(t.cash_received ?? ""),
      partner_name: t.partner_name ?? "",
    });
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

  const handlePrintThermal = async (tx: any) => {
    const txItems = items.filter((item) => item.transaction_id === tx.id);
    if (!isPrinterConnectedClient()) {
      toast.warning("Printer Bluetooth belum terhubung. Silakan sambungkan di halaman Pengaturan.");
      return;
    }
    try {
      await printReceiptThermalClient({ ...tx, items: txItems }, settings ?? null);
      toast.success("Struk berhasil dikirim ke printer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencetak");
    }
  };

  const handleShareReceipt = async (tx: any, txItems: any) => {
    try {
      await shareReceiptImageClient({ ...tx, items: txItems }, settings ?? null);
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

  // Pendapatan Bersih
  const netIncome = useMemo(() => totalRevenue - totalExpenditure, [totalRevenue, totalExpenditure]);

  // Jumlah Produk Terjual
  const totalProductsSold = useMemo(() => {
    const txIds = new Set(txs.map((t) => t.id));
    return items
      .filter((item) => txIds.has(item.transaction_id))
      .reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
  }, [items, txs]);

  // Informasi Pack (4 dada, 2 paha atas, 2 paha bawah, 2 sayap = 1 pack)
  const packInfo = useMemo(() => {
    const txIds = new Set(txs.map((t) => t.id));
    const activeItems = items.filter((item) => txIds.has(item.transaction_id));

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

    const pDada = Math.floor(dada / 4);
    const pPahaAtas = Math.floor(pahaAtas / 2);
    const pPahaBawah = Math.floor(pahaBawah / 2);
    const pSayap = Math.floor(sayap / 2);

    const packs = Math.min(pDada, pPahaAtas, pPahaBawah, pSayap);

    return { packs, dada, pahaAtas, pahaBawah, sayap };
  }, [items, txs]);

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

      {/* Simplified Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          icon={DollarSign}
          label="Pemasukan"
          value={role === "cashier" ? "XXXXX" : rupiah(totalRevenue)}
          sub={role === "cashier" ? `${txs.length} Tx · Cash: XXXXX · QRIS: XXXXX` : `${txs.length} Tx · Cash: ${rupiah(cashRevenue)} · QRIS: ${rupiah(qrisRevenue)}`}
          onClick={() => navigate({ to: "/income-details" })}
        />
        <Stat
          icon={TrendingUp}
          label="Pengeluaran"
          value={role === "cashier" ? "XXXXX" : rupiah(totalExpenditure)}
          sub={`${stockEntries.length} Restok Gudang`}
          onClick={() => navigate({ to: "/expense-details" })}
        />
        <Stat
          icon={BarChart3}
          label="Pendapatan Bersih"
          value={role === "cashier" ? "XXXXX" : rupiah(netIncome)}
          sub="Pemasukan - Pengeluaran"
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
          onClick={() => navigate({ to: "/sold-products", search: { dateFilter } })}
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
                <LineChart data={daily}>
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
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    name="Pendapatan"
                    stroke="var(--color-primary)"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                </LineChart>
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
                      <div className="font-semibold">No: {t.id.slice(0, 8).toUpperCase()}</div>
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
            const selectedItems = items.filter((i) => i.transaction_id === editingTxId);
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
                          onClick={() => handlePrintThermal(selectedTx)}
                        >
                          <Printer className="h-4 w-4 mr-1.5" /> Cetak Thermal
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
