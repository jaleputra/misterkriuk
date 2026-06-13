import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rupiah } from "@/lib/format";
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
import { TrendingUp, ShoppingBag, DollarSign, Package, BadgeDollarSign } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 13);
      const [tx, items, prods] = await Promise.all([
        supabase.from("transactions").select("*").gte("created_at", since.toISOString()),
        supabase.from("transaction_items").select("*"),
        supabase.from("products").select("*"),
      ]);
      return {
        transactions: tx.data ?? [],
        items: items.data ?? [],
        products: prods.data ?? [],
      };
    },
    refetchInterval: 30000,
  });

  const txs = data?.transactions ?? [];
  const items = data?.items ?? [];
  const products = data?.products ?? [];

  const today = new Date().toISOString().slice(0, 10);
  const todayTx = txs.filter((t) => t.created_at.slice(0, 10) === today);
  const todayRevenue = todayTx.reduce((s, t) => s + Number(t.total), 0);
  const totalRevenue = txs.reduce((s, t) => s + Number(t.total), 0);
  const todayIds = new Set(todayTx.map((transaction) => transaction.id));
  const totalProfit = items.reduce(
    (sum, item) => sum + (Number(item.price) - Number(item.cost_price)) * item.quantity,
    0,
  );
  const todayProfit = items
    .filter((item) => todayIds.has(item.transaction_id))
    .reduce((sum, item) => sum + (Number(item.price) - Number(item.cost_price)) * item.quantity, 0);

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
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <Stat
          icon={DollarSign}
          label="Penjualan Hari Ini"
          value={rupiah(todayRevenue)}
          sub={`${todayTx.length} transaksi`}
        />
        <Stat
          icon={TrendingUp}
          label="Total 14 Hari"
          value={rupiah(totalRevenue)}
          sub={`${txs.length} transaksi`}
        />
        <Stat
          icon={BadgeDollarSign}
          label="Profit"
          value={rupiah(totalProfit)}
          sub={`hari ini ${rupiah(todayProfit)}`}
        />
        <Stat
          icon={ShoppingBag}
          label="Item Terjual"
          value={String(items.reduce((s, i) => s + i.quantity, 0))}
          sub="kumulatif"
        />
        <Stat icon={Package} label="Stok Menipis" value={String(lowStock)} sub="≤ 5 pcs" />
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
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
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
