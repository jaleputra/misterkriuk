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
import { FileText, Save, Wallet, TrendingDown, TrendingUp, Calculator } from "lucide-react";

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

  useEffect(() => {
    if (!loading && role && role !== "admin") {
      toast.error("Halaman ini khusus admin");
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
    enabled: role === "admin",
  });

  useEffect(() => {
    setInitialCashInput(report?.initial_cash != null ? String(report.initial_cash) : "");
    setNote(report?.note ?? "");
  }, [report, date]);

  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59.999`;

  const { data: txs = [] } = useQuery({
    queryKey: ["reports_txs", date],
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("total, payment_method, created_at")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd);
      return data ?? [];
    },
    enabled: role === "admin",
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["reports_entries", date],
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_entries")
        .select("id, shipping_cost, payment_method, restock_date, stock_movements(quantity, initial_price)")
        .eq("restock_date", date);
      return data ?? [];
    },
    enabled: role === "admin",
  });

  const cashIn = useMemo(
    () => txs.filter((t: any) => t.payment_method === "cash").reduce((s: number, t: any) => s + Number(t.total), 0),
    [txs],
  );
  const qrisIn = useMemo(
    () => txs.filter((t: any) => t.payment_method === "qris").reduce((s: number, t: any) => s + Number(t.total), 0),
    [txs],
  );
  const totalIn = cashIn + qrisIn;

  const entryTotal = (e: any) =>
    Number(e.shipping_cost ?? 0) +
    (e.stock_movements ?? []).reduce(
      (s: number, m: any) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0),
      0,
    );
  const cashOut = useMemo(
    () => (entries as any[]).filter((e) => (e.payment_method ?? "cash") === "cash").reduce((s, e) => s + entryTotal(e), 0),
    [entries],
  );
  const qrisOut = useMemo(
    () => (entries as any[]).filter((e) => e.payment_method === "qris").reduce((s, e) => s + entryTotal(e), 0),
    [entries],
  );
  const totalOut = cashOut + qrisOut;

  const initialCash = Number(report?.initial_cash ?? 0);
  const todayResult = initialCash + totalIn - totalOut;

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("daily_reports").upsert({
        report_date: date,
        initial_cash: Number(initialCashInput || 0),
        note: note || null,
        created_by: u.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Laporan disimpan");
      qc.invalidateQueries({ queryKey: ["daily_report", date] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || role !== "admin") {
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
                  placeholder="0"
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
            <div className="text-xs text-muted-foreground pt-1">{entries.length} entri pengeluaran</div>
          </CardContent>
        </Card>
      </div>
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
