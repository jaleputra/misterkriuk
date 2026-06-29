import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rupiah } from "@/lib/format";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { TrendingUp, DollarSign, Package, BadgeDollarSign } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  component: Dashboard,
});

function Dashboard() {
  const [detailModal, setDetailModal] = useState<{
    open: boolean;
    title: string;
    type: "pemasukan_hari_ini" | "pemasukan_14_hari" | "pengeluaran_hari_ini" | "pengeluaran_14_hari" | "profit_14_hari" | "stok_menipis" | null;
  }>({
    open: false,
    title: "",
    type: null,
  });

  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 13);
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

  const today = new Date().toISOString().slice(0, 10);
  
  // Pemasukan
  const todayTx = txs.filter((t) => t.created_at.slice(0, 10) === today);
  const todayRevenue = todayTx.reduce((s, t) => s + Number(t.total), 0);
  const totalRevenue = txs.reduce((s, t) => s + Number(t.total), 0);

  // Pengeluaran
  const todayEntries = stockEntries.filter((e) => e.restock_date === today);
  const todayEntryIds = new Set(todayEntries.map((e) => e.id));
  const todayExpenditure = todayEntries.reduce((s, e) => s + Number(e.shipping_cost ?? 0), 0) +
    stockMovements
      .filter((m) => m.stock_entry_id && todayEntryIds.has(m.stock_entry_id))
      .reduce((s, m) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0), 0);

  const entryIds14Days = new Set(stockEntries.map((e) => e.id));
  const totalExpenditure = stockEntries.reduce((s, e) => s + Number(e.shipping_cost ?? 0), 0) +
    stockMovements
      .filter((m) => m.stock_entry_id && entryIds14Days.has(m.stock_entry_id))
      .reduce((s, m) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0), 0);

  // Profit/Loss
  const profit14Days = totalRevenue - totalExpenditure;
  const todayProfit = todayRevenue - todayExpenditure;

  // daily revenue last 14 days
  const dailyMap: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dailyMap[d.toISOString().slice(0, 10)] = 0;
  }
  txs.forEach((t) => {
    const day = t.created_at.slice(0, 10);
    if (day in dailyMap) dailyMap[day] += Number(t.total);
  });
  const daily = Object.entries(dailyMap).map(([d, v]) => ({
    date: d.slice(5),
    revenue: v,
  }));

  // top products
  const prodMap: Record<string, { name: string; qty: number; revenue: number }> = {};
  items.forEach((it) => {
    const key = it.product_name;
    if (!prodMap[key]) prodMap[key] = { name: key, qty: 0, revenue: 0 };
    prodMap[key].qty += it.quantity;
    prodMap[key].revenue += Number(it.subtotal);
  });
  const top = Object.values(prodMap)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // payment split
  const payMap: Record<string, number> = { cash: 0, qris: 0 };
  txs.forEach((t) => {
    payMap[t.payment_method] = (payMap[t.payment_method] ?? 0) + Number(t.total);
  });
  const payments = [
    { name: "Cash", value: payMap.cash },
    { name: "QRIS", value: payMap.qris },
  ];
  const PIE_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)"];

  const lowStock = products.filter((p) => p.stock <= 5).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat
          icon={DollarSign}
          label="Pemasukan Hari Ini"
          value={rupiah(todayRevenue)}
          sub={`${todayTx.length} transaksi`}
          onClick={() => setDetailModal({
            open: true,
            title: "Detail Pemasukan Hari Ini",
            type: "pemasukan_hari_ini",
          })}
        />
        <Stat
          icon={TrendingUp}
          label="Pemasukan 14 Hari"
          value={rupiah(totalRevenue)}
          sub={`${txs.length} transaksi`}
          onClick={() => setDetailModal({
            open: true,
            title: "Detail Pemasukan 14 Hari Terakhir",
            type: "pemasukan_14_hari",
          })}
        />
        <Stat
          icon={DollarSign}
          label="Pengeluaran Hari Ini"
          value={rupiah(todayExpenditure)}
          sub={`${todayEntries.length} transaksi`}
          onClick={() => setDetailModal({
            open: true,
            title: "Detail Pengeluaran Hari Ini",
            type: "pengeluaran_hari_ini",
          })}
        />
        <Stat
          icon={TrendingUp}
          label="Pengeluaran 14 Hari"
          value={rupiah(totalExpenditure)}
          sub={`${stockEntries.length} transaksi`}
          onClick={() => setDetailModal({
            open: true,
            title: "Detail Pengeluaran 14 Hari Terakhir",
            type: "pengeluaran_14_hari",
          })}
        />
        <Stat
          icon={BadgeDollarSign}
          label="Profit Bersih (14 Hari)"
          value={rupiah(profit14Days)}
          sub={`hari ini ${rupiah(todayProfit)}`}
          onClick={() => setDetailModal({
            open: true,
            title: "Detail Profit 14 Hari Terakhir",
            type: "profit_14_hari",
          })}
        />
        <Stat 
          icon={Package} 
          label="Stok Menipis" 
          value={String(lowStock)} 
          sub="≤ 5 pcs" 
          onClick={() => setDetailModal({
            open: true,
            title: "Produk Stok Menipis (≤ 5)",
            type: "stok_menipis",
          })}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pendapatan 14 Hari Terakhir</CardTitle>
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
                stroke="var(--color-primary)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Produk Terlaris</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={100}
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="qty" fill="var(--color-primary)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
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
          
          {detailModal.type === "pemasukan_hari_ini" && (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {todayTx.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">Belum ada pemasukan hari ini.</p>
              ) : (
                todayTx.map((t) => (
                  <div key={t.id} className="flex justify-between items-center border-b pb-2 text-sm">
                    <div>
                      <div className="font-semibold">No: {t.id.slice(0, 8).toUpperCase()}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(t.created_at).toLocaleTimeString("id-ID")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-success">{rupiah(t.total)}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">{t.payment_method}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {detailModal.type === "pemasukan_14_hari" && (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {daily.map((day) => (
                <div key={day.date} className="flex justify-between items-center border-b pb-2 text-sm">
                  <span className="font-medium">Tanggal {day.date}</span>
                  <span className="font-bold text-success">{rupiah(day.revenue)}</span>
                </div>
              ))}
            </div>
          )}

          {detailModal.type === "pengeluaran_hari_ini" && (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {todayEntries.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">Belum ada pengeluaran hari ini.</p>
              ) : (
                todayEntries.map((entry) => {
                  const movements = stockMovements.filter((m) => m.stock_entry_id === entry.id);
                  const subtotal = movements.reduce((s, m) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0), 0);
                  return (
                    <div key={entry.id} className="border-b pb-3 space-y-1 text-sm">
                      <div className="flex justify-between font-semibold">
                        <span>Pengeluaran #{entry.id.slice(0, 6).toUpperCase()}</span>
                        <span className="text-destructive font-bold">{rupiah(subtotal + entry.shipping_cost)}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">Ongkir: {rupiah(entry.shipping_cost)}</div>
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

          {detailModal.type === "pengeluaran_14_hari" && (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {(() => {
                const dailyExpMap: Record<string, number> = {};
                for (let i = 13; i >= 0; i--) {
                  const d = new Date();
                  d.setDate(d.getDate() - i);
                  dailyExpMap[d.toISOString().slice(0, 10)] = 0;
                }
                stockEntries.forEach((e) => {
                  const day = e.restock_date;
                  if (day in dailyExpMap) {
                    dailyExpMap[day] += Number(e.shipping_cost ?? 0);
                    const movements = stockMovements.filter((m) => m.stock_entry_id === e.id);
                    movements.forEach((m) => {
                      dailyExpMap[day] += Number(m.quantity ?? 0) * Number(m.initial_price ?? 0);
                    });
                  }
                });
                return Object.entries(dailyExpMap).map(([date, amount]) => {
                  const formattedDate = new Date(date).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
                  return (
                    <div key={date} className="flex justify-between items-center border-b pb-2 text-sm">
                      <span className="font-medium">Tanggal {formattedDate}</span>
                      <span className="font-bold text-destructive">{rupiah(amount)}</span>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {detailModal.type === "profit_14_hari" && (
            <div className="space-y-3 py-2 text-sm">
              <div className="flex justify-between items-center border-b pb-2">
                <span className="text-muted-foreground">Total Pemasukan (14 Hari)</span>
                <span className="font-semibold text-success">{rupiah(totalRevenue)}</span>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <span className="text-muted-foreground">Total Pengeluaran (14 Hari)</span>
                <span className="font-semibold text-destructive">{rupiah(totalExpenditure)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 text-base font-bold">
                <span>Profit Bersih</span>
                <span className={profit14Days >= 0 ? "text-success" : "text-destructive"}>
                  {rupiah(profit14Days)}
                </span>
              </div>
            </div>
          )}

          {detailModal.type === "stok_menipis" && (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {products.filter((p) => p.stock <= 5).length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">Stok semua produk aman.</p>
              ) : (
                products
                  .filter((p) => p.stock <= 5)
                  .map((p) => (
                    <div key={p.id} className="flex justify-between items-center border-b pb-2 text-sm">
                      <div>
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground capitalize">Kategori: {p.category}</div>
                      </div>
                      <span className="font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded text-xs">
                        Stok: {p.stock} pcs
                      </span>
                    </div>
                  ))
              )}
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
