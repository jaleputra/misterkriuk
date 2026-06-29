import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rupiah } from "@/lib/format";
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
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
import { TrendingUp, DollarSign, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  component: Dashboard,
});

function Dashboard() {
  const [dateFilter, setDateFilter] = useState<"7" | "14" | "30" | "month" | "all">("14");
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
      if (dateFilter === "7") since.setDate(since.getDate() - 6);
      else if (dateFilter === "14") since.setDate(since.getDate() - 13);
      else if (dateFilter === "30") since.setDate(since.getDate() - 29);
      else if (dateFilter === "month") {
        since.setDate(1);
      } else {
        since.setFullYear(2020, 0, 1);
      }
      since.setHours(0, 0, 0, 0);

      const [tx, items, prods, stockEntries, stockMovements] = await Promise.all([
        supabase.from("transactions").select("*").gte("created_at", since.toISOString()),
        supabase.from("transaction_items").select("*"),
        supabase.from("products").select("*"),
        supabase.from("stock_entries").select("*").gte("restock_date", since.toISOString().slice(0, 10)),
        supabase.from("stock_movements").select("*"),
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

  const txs = data?.transactions ?? [];
  const items = data?.items ?? [];
  const products = data?.products ?? [];
  const stockEntries = data?.stockEntries ?? [];
  const stockMovements = data?.stockMovements ?? [];

  // Pemasukan
  const totalRevenue = useMemo(() => txs.reduce((s, t) => s + Number(t.total), 0), [txs]);

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

  // Daily revenue line chart data
  const daily = useMemo(() => {
    const dailyMap: Record<string, number> = {};
    let daysCount = 14;
    if (dateFilter === "7") daysCount = 7;
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat
          icon={DollarSign}
          label="Pemasukan"
          value={rupiah(totalRevenue)}
          sub={`${txs.length} Transaksi`}
          onClick={() => setDetailModal({
            open: true,
            title: "Detail Pemasukan",
            type: "pemasukan",
          })}
        />
        <Stat
          icon={TrendingUp}
          label="Pengeluaran"
          value={rupiah(totalExpenditure)}
          sub={`${stockEntries.length} Restok Gudang`}
          onClick={() => setDetailModal({
            open: true,
            title: "Detail Pengeluaran",
            type: "pengeluaran",
          })}
        />
        <Stat
          icon={BarChart3}
          label="Pendapatan Bersih"
          value={rupiah(netIncome)}
          sub="Pemasukan - Pengeluaran"
          onClick={() => setDetailModal({
            open: true,
            title: "Detail Pendapatan Bersih",
            type: "pendapatan",
          })}
        />
      </div>

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

      {/* Details Dialog */}
      <Dialog
        open={detailModal.open}
        onOpenChange={(open) => {
          if (!open) setDetailModal((m) => ({ ...m, open: false }));
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{detailModal.title}</DialogTitle>
          </DialogHeader>

          {detailModal.type === "pemasukan" && (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {txs.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">Belum ada pemasukan di periode ini.</p>
              ) : (
                txs.map((t) => (
                  <div key={t.id} className="flex justify-between items-center border-b pb-2 text-sm">
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

          {detailModal.type === "pengeluaran" && (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {stockEntries.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">Belum ada pengeluaran di periode ini.</p>
              ) : (
                stockEntries.map((entry) => {
                  const movements = stockMovements.filter((m) => m.stock_entry_id === entry.id);
                  const subtotal = movements.reduce((s, m) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0), 0);
                  return (
                    <div key={entry.id} className="border-b pb-3 space-y-1 text-sm">
                      <div className="flex justify-between font-semibold">
                        <span>Pengeluaran #{entry.id.slice(0, 6).toUpperCase()}</span>
                        <span className="text-destructive font-bold">{rupiah(subtotal + entry.shipping_cost)}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Tanggal: {entry.restock_date} | Ongkir: {rupiah(entry.shipping_cost)}
                      </div>
                      <div className="pl-2 border-l-2 border-primary/20 space-y-1 mt-1">
                        {movements.map((m) => {
                          const prod = products.find((p) => p.id === m.product_id);
                          return (
                            <div key={m.id} className="flex justify-between text-xs text-muted-foreground">
                              <span>{prod?.name ?? "—"} ({m.quantity} pcs)</span>
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
                <span className="font-semibold text-success">{rupiah(totalRevenue)}</span>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <span className="text-muted-foreground">Total Pengeluaran</span>
                <span className="font-semibold text-destructive">{rupiah(totalExpenditure)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 text-base font-bold">
                <span>Pendapatan Bersih</span>
                <span className={netIncome >= 0 ? "text-success" : "text-destructive"}>
                  {rupiah(netIncome)}
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
