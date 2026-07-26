import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { rupiah } from "@/lib/format";
import { toast } from "sonner";
import { FileText, Save, Wallet, TrendingDown, TrendingUp, Calculator, CreditCard } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  ssr: false,
  component: ReportsPage,
});

function ReportsPage() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [initialCashInput, setInitialCashInput] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"harian" | "partner">("harian");


  useEffect(() => {
    if (!loading && role && role !== "admin" && role !== "cashier") {
      toast.error("Akses ditolak");
      navigate({ to: "/dashboard" });
    }
  }, [role, loading, navigate]);

  const { data: report } = useQuery({
    queryKey: ["daily_report", date],
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_reports")
        .select("*")
        .eq("report_date", date)
        .maybeSingle();
      return data;
    },
    enabled: role === "admin" || role === "cashier",
  });

  useEffect(() => {
    setInitialCashInput("");
    setNote(report?.note ?? "");
  }, [report, date]);

  const [dayStart, dayEnd] = useMemo(() => {
    const [year, month, day] = date.split("-").map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);
    return [start.toISOString(), end.toISOString()];
  }, [date]);

  const { data: txs = [] } = useQuery({
    queryKey: ["reports_txs", date],
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, total, payment_method, created_at, sale_category, partner_name, buyer_name")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd);
      return data ?? [];
    },
    enabled: role === "admin" || role === "cashier",
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["reports_entries", date],
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_entries")
        .select("id, shipping_cost, payment_method, restock_date, entry_type, stock_movements(quantity, initial_price)")
        .eq("restock_date", date);
      return data ?? [];
    },
    enabled: role === "admin" || role === "cashier",
  });

  // Transaksi partner dipisah dari laporan harian
  const partnerTxs = useMemo(() => (txs as any[]).filter((t) => t.sale_category === "partner"), [txs]);
  const salesTxs = useMemo(() => (txs as any[]).filter((t) => t.sale_category !== "partner"), [txs]);

  const cashIn = useMemo(
    () => salesTxs.filter((t: any) => t.payment_method === "cash").reduce((s: number, t: any) => s + Number(t.total), 0),
    [salesTxs],
  );
  const qrisIn = useMemo(
    () => salesTxs.filter((t: any) => t.payment_method === "qris").reduce((s: number, t: any) => s + Number(t.total), 0),
    [salesTxs],
  );
  const totalIn = cashIn + qrisIn;

  const entryTotal = (e: any) =>
    Number(e.shipping_cost ?? 0) +
    (e.stock_movements ?? []).reduce(
      (s: number, m: any) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0),
      0,
    );

  // Restok tidak mengurangi laporan harian
  const expenseEntries = useMemo(
    () => (entries as any[]).filter((e) => (e.entry_type ?? "expense") !== "restock"),
    [entries],
  );
  const restockEntries = useMemo(
    () => (entries as any[]).filter((e) => (e.entry_type ?? "expense") === "restock"),
    [entries],
  );
  const restockOut = useMemo(() => restockEntries.reduce((s, e) => s + entryTotal(e), 0), [restockEntries]);

  const cashOut = useMemo(
    () => expenseEntries.filter((e) => (e.payment_method ?? "cash") === "cash").reduce((s, e) => s + entryTotal(e), 0),
    [expenseEntries],
  );
  const qrisOut = useMemo(
    () => expenseEntries.filter((e) => e.payment_method === "qris").reduce((s, e) => s + entryTotal(e), 0),
    [expenseEntries],
  );
  const totalOut = cashOut + qrisOut;

  // Rekap partner
  const partnerCashIn = useMemo(
    () => partnerTxs.filter((t) => t.payment_method === "cash").reduce((s, t) => s + Number(t.total), 0),
    [partnerTxs],
  );
  const partnerQrisIn = useMemo(
    () => partnerTxs.filter((t) => t.payment_method === "qris").reduce((s, t) => s + Number(t.total), 0),
    [partnerTxs],
  );
  const partnerTotal = partnerCashIn + partnerQrisIn;
  const partnerGroups = useMemo(() => {
    const map: Record<string, { name: string; count: number; cash: number; qris: number; total: number }> = {};
    partnerTxs.forEach((t) => {
      const name = t.partner_name?.trim() || "Tanpa Nama";
      if (!map[name]) map[name] = { name, count: 0, cash: 0, qris: 0, total: 0 };
      const amount = Number(t.total);
      map[name].count += 1;
      map[name].total += amount;
      if (t.payment_method === "qris") map[name].qris += amount;
      else map[name].cash += amount;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [partnerTxs]);

  const initialCash = Number(report?.initial_cash ?? 0);
  const todayResult = initialCash + totalIn - totalOut;
  const totalCashResult = initialCash + cashIn - cashOut;
  const totalQrisResult = qrisIn - qrisOut;


  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const payload: any = {
        report_date: date,
        note: note || null,
        created_by: u.user?.id,
      };
      
      // Hanya simpan kas_awal jika belum pernah disimpan sebelumnya
      if (report?.initial_cash == null) {
        payload.initial_cash = Number(initialCashInput || 0);
      }
      
      const { error } = await supabase.from("daily_reports").upsert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Laporan disimpan");
      setInitialCashInput("");
      qc.invalidateQueries({ queryKey: ["daily_report", date] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || (role !== "admin" && role !== "cashier")) {
    return <div className="text-sm text-muted-foreground">Memuat…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <FileText className="h-5 w-5" /> Laporan Harian
        </h1>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Tanggal:</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[170px]" />
        </div>
      </div>

      {role === "admin" && (
        <div className="flex gap-2">
          <Button size="sm" variant={tab === "harian" ? "default" : "outline"} onClick={() => setTab("harian")}>
            Harian
          </Button>
          <Button size="sm" variant={tab === "partner" ? "default" : "outline"} onClick={() => setTab("partner")}>
            Partner
          </Button>
        </div>
      )}

      {tab === "partner" && role === "admin" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={Users} label="Transaksi Partner" value={`${partnerTxs.length} Tx`} tone="muted" />
            <StatCard icon={Wallet} label="Partner Cash" value={rupiah(partnerCashIn)} tone="success" />
            <StatCard icon={CreditCard} label="Partner QRIS" value={rupiah(partnerQrisIn)} tone="success" />
            <StatCard
              icon={Calculator}
              label="Total Partner"
              value={rupiah(partnerTotal)}
              sub="Tidak dihitung di laporan harian"
              tone="primary"
            />
          </div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Rekap per Partner
              </CardTitle>
            </CardHeader>
            <CardContent>
              {partnerGroups.length === 0 ? (
                <div className="text-sm text-muted-foreground">Belum ada transaksi partner pada tanggal ini.</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full text-sm border-collapse min-w-[420px]">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        <th className="px-4 py-3 text-left font-semibold">Partner</th>
                        <th className="px-4 py-3 text-center font-semibold">Tx</th>
                        <th className="px-4 py-3 text-center font-semibold">Cash</th>
                        <th className="px-4 py-3 text-center font-semibold">QRIS</th>
                        <th className="px-4 py-3 text-center font-semibold text-primary bg-primary/5">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-medium">
                      {partnerGroups.map((g) => (
                        <tr key={g.name} className="hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-3">{g.name}</td>
                          <td className="px-4 py-3 text-center">{g.count}</td>
                          <td className="px-4 py-3 text-center">{rupiah(g.cash)}</td>
                          <td className="px-4 py-3 text-center">{rupiah(g.qris)}</td>
                          <td className="px-4 py-3 text-center text-primary bg-primary/5 font-bold">{rupiah(g.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {tab === "harian" && (
        <>

      {role === "admin" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Wallet} label="Kas Awal" value={rupiah(initialCash)} tone="muted" />
          <StatCard
            icon={TrendingUp}
            label="Pemasukan"
            value={rupiah(totalIn)}
            sub={`Cash ${rupiah(cashIn)} · QRIS ${rupiah(qrisIn)}`}
            tone="success"
          />
          <StatCard
            icon={TrendingDown}
            label="Pengeluaran"
            value={rupiah(totalOut)}
            sub={`Cash ${rupiah(cashOut)} · QRIS ${rupiah(qrisOut)}`}
            tone="destructive"
          />
          <StatCard
            icon={Calculator}
            label="Hasil Hari Ini"
            value={rupiah(todayResult)}
            sub="Kas Awal + Pemasukan − Pengeluaran"
            tone="primary"
          />
        </div>
      )}

      {role === "admin" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Input Kas Awal & Catatan</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Kas Awal (Rp)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={initialCashInput}
                    onChange={(e) => setInitialCashInput(e.target.value)}
                    placeholder={report?.initial_cash != null ? rupiah(report.initial_cash) : "0"}
                    disabled={report?.initial_cash != null || save.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Catatan (opsional)</Label>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan hari ini" />
                </div>
              </div>
              <Button type="submit" disabled={save.isPending}>
                <Save className="h-4 w-4 mr-1" /> Simpan Laporan
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Input Kas Awal</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <div className="space-y-1.5 max-w-xs">
                <Label>Kas Awal (Rp)</Label>
                <Input
                  type="number"
                  min="0"
                  value={initialCashInput}
                  onChange={(e) => setInitialCashInput(e.target.value)}
                  placeholder={report?.initial_cash != null ? rupiah(report.initial_cash) : "0"}
                  disabled={report?.initial_cash != null || save.isPending}
                />
              </div>
              {report?.initial_cash == null && (
                <Button type="submit" disabled={save.isPending}>
                  <Save className="h-4 w-4 mr-1" /> Simpan Kas Awal
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {/* Cashier simplified cards for Total Cash and Total QRIS */}
      {role === "cashier" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total Cash</span>
                <Wallet className="h-4 w-4 text-primary" />
              </div>
              <div className="text-xl font-bold text-primary">{rupiah(totalCashResult)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total QRIS</span>
                <CreditCard className="h-4 w-4 text-primary" />
              </div>
              <div className="text-xl font-bold text-primary">{rupiah(totalQrisResult)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {role === "admin" && (
        <>
          {/* Ringkasan Kas & QRIS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Tabel Cash (Tunai) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  Aliran Kas (Tunai)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full text-sm text-left border-collapse min-w-[360px]">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        <th className="px-4 py-3 font-semibold text-center">Kas Awal</th>
                        <th className="px-4 py-3 font-semibold text-center text-emerald-600 dark:text-emerald-400">Pemasukan Cash</th>
                        <th className="px-4 py-3 font-semibold text-center text-destructive">Pengeluaran Cash</th>
                        <th className="px-4 py-3 font-semibold text-center text-primary bg-primary/5">Total Cash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-medium">
                      <tr className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-4 text-center">{rupiah(initialCash)}</td>
                        <td className="px-4 py-4 text-center text-emerald-600 dark:text-emerald-400">{rupiah(cashIn)}</td>
                        <td className="px-4 py-4 text-center text-destructive">{rupiah(cashOut)}</td>
                        <td className="px-4 py-4 text-center text-primary bg-primary/5 font-bold">{rupiah(totalCashResult)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Tabel QRIS (Non-Tunai) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  Aliran QRIS (Non-Tunai)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full text-sm text-left border-collapse min-w-[300px]">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        <th className="px-4 py-3 font-semibold text-center text-emerald-600 dark:text-emerald-400">Pemasukan QRIS</th>
                        <th className="px-4 py-3 font-semibold text-center text-destructive">Pengeluaran QRIS</th>
                        <th className="px-4 py-3 font-semibold text-center text-primary bg-primary/5">Total QRIS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-medium">
                      <tr className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-4 text-center text-emerald-600 dark:text-emerald-400">{rupiah(qrisIn)}</td>
                        <td className="px-4 py-4 text-center text-destructive">{rupiah(qrisOut)}</td>
                        <td className="px-4 py-4 text-center text-primary bg-primary/5 font-bold">{rupiah(totalQrisResult)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rincian Pemasukan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Cash" value={rupiah(cashIn)} />
                <Row label="QRIS" value={rupiah(qrisIn)} />
                <Row label={<b>Total</b>} value={<b>{rupiah(totalIn)}</b>} />
                <div className="text-xs text-muted-foreground pt-1">{txs.length} transaksi</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rincian Pengeluaran</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Cash" value={rupiah(cashOut)} />
                <Row label="QRIS" value={rupiah(qrisOut)} />
                <Row label={<b>Total</b>} value={<b>{rupiah(totalOut)}</b>} />
                <div className="text-xs text-muted-foreground pt-1">
                  {expenseEntries.length} entri pengeluaran
                  {restockEntries.length > 0 && ` · ${restockEntries.length} restok (${rupiah(restockOut)}) tidak dihitung`}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
        </>
      )}
    </div>

  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "muted",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: "muted" | "success" | "destructive" | "primary";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600"
      : tone === "destructive"
      ? "text-destructive"
      : tone === "primary"
      ? "text-primary"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${toneClass}`} />
        </div>
        <div className={`text-lg font-bold ${toneClass}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
