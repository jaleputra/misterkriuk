import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import {
  FileText,
  Save,
  Wallet,
  TrendingDown,
  TrendingUp,
  Calculator,
  CreditCard,
  Users,
  Store,
  Lock,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  ssr: false,
  component: ReportsPage,
});

function ReportsPage() {
  const { role, branchName, loading, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getLocalDateStr = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [date, setDate] = useState(() => getLocalDateStr());
  const [initialCashInput, setInitialCashInput] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"harian" | "partner">("harian");

  // Pilihan cabang untuk Admin (Kasir otomatis terkunci ke cabangnya)
  const [selectedBranch, setSelectedBranch] = useState<string>("all");

  useEffect(() => {
    if (!loading && role && role !== "admin" && role !== "cashier") {
      toast.error("Akses ditolak");
      navigate({ to: "/dashboard" });
    }
  }, [role, loading, navigate]);

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

  const { data: userRoles = [] } = useQuery({
    queryKey: ["user_roles_branch_map"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("user_id, role, branch_name");
      return data ?? [];
    },
  });

  const branchMatch = (b1?: string | null, b2?: string | null) => {
    if (!b1 || !b2) return false;
    return b1.trim().toLowerCase() === b2.trim().toLowerCase();
  };

  const cashierBranchMap = useMemo(() => {
    const map: Record<string, string> = {};
    userRoles.forEach((ur: any) => {
      if (ur.user_id && ur.branch_name) {
        map[ur.user_id] = ur.branch_name;
      }
    });
    return map;
  }, [userRoles]);

  const [dayStart, dayEnd] = useMemo(() => {
    const [year, month, day] = date.split("-").map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);
    return [start.toISOString(), end.toISOString()];
  }, [date]);

  const { data: dailyReports = [] } = useQuery({
    queryKey: ["daily_reports", date],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("daily_reports")
          .select("*")
          .eq("report_date", date);
        if (error) {
          const localData = typeof window !== "undefined" ? localStorage.getItem(`app_daily_reports_${date}`) : null;
          return localData ? JSON.parse(localData) : [];
        }
        return data ?? [];
      } catch {
        const localData = typeof window !== "undefined" ? localStorage.getItem(`app_daily_reports_${date}`) : null;
        return localData ? JSON.parse(localData) : [];
      }
    },
    enabled: role === "admin" || role === "cashier",
  });

  const { data: txs = [] } = useQuery({
    queryKey: ["reports_txs", date],
    queryFn: async () => {
      try {
        return await fetchAllRows<any>((from, to) =>
          supabase
            .from("transactions")
            .select("*")
            .gte("created_at", dayStart)
            .lte("created_at", dayEnd)
            .order("created_at", { ascending: false })
            .range(from, to),
        );
      } catch {
        const { data } = await supabase
          .from("transactions")
          .select("*")
          .gte("created_at", dayStart)
          .lte("created_at", dayEnd);
        return data ?? [];
      }
    },
    enabled: role === "admin" || role === "cashier",
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["reports_entries", date],
    queryFn: async () => {
      try {
        return await fetchAllRows<any>((from, to) =>
          supabase
            .from("stock_entries")
            .select("*, stock_movements(quantity, initial_price)")
            .eq("restock_date", date)
            .range(from, to),
        );
      } catch {
        const { data } = await supabase
          .from("stock_entries")
          .select("*, stock_movements(quantity, initial_price)")
          .eq("restock_date", date);
        return data ?? [];
      }
    },
    enabled: role === "admin" || role === "cashier",
  });

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    branches.forEach((b: any) => {
      if (b.branch_name?.trim()) set.add(b.branch_name.trim());
    });
    userRoles.forEach((ur: any) => {
      if (ur.branch_name?.trim()) set.add(ur.branch_name.trim());
    });
    (txs as any[]).forEach((t: any) => {
      if (t.branch_name?.trim()) set.add(t.branch_name.trim());
    });
    (entries as any[]).forEach((e: any) => {
      if (e.branch_name?.trim()) set.add(e.branch_name.trim());
    });
    (dailyReports as any[]).forEach((r: any) => {
      if (r.branch_name?.trim()) set.add(r.branch_name.trim());
    });
    return Array.from(set);
  }, [branches, userRoles, txs, entries, dailyReports]);

  const getTxBranch = (t: any) => {
    if (t.branch_name?.trim()) return t.branch_name.trim();
    if (t.cashier_id && cashierBranchMap[t.cashier_id]) return cashierBranchMap[t.cashier_id];
    return null;
  };

  const getEntryBranch = (e: any) => {
    if (e.branch_name?.trim()) return e.branch_name.trim();
    if (e.created_by && cashierBranchMap[e.created_by]) return cashierBranchMap[e.created_by];
    return null;
  };

  // State untuk memilih cabang yang akan diinputkan kas awal oleh Admin
  const [adminInputBranch, setAdminInputBranch] = useState<string>("");
  const activeAdminInputBranch = adminInputBranch || (selectedBranch !== "all" ? selectedBranch : (branchOptions[0] || ""));

  const handleSelectBranchFilter = (val: string) => {
    setSelectedBranch(val);
    if (val !== "all") {
      setAdminInputBranch(val);
    }
  };

  // Laporan yang relevan dengan form input saat ini
  const currentFormReport = useMemo(() => {
    if (role === "cashier") {
      return (dailyReports as any[]).find(
        (r) =>
          branchMatch(r.branch_name, branchName) ||
          (user?.id && r.created_by === user.id) ||
          (!r.branch_name && (dailyReports as any[]).length === 1),
      );
    }
    return (dailyReports as any[]).find(
      (r) =>
        branchMatch(r.branch_name, activeAdminInputBranch) ||
        (!r.branch_name &&
          (dailyReports as any[]).length === 1 &&
          (branchOptions.length <= 1 || branchMatch(activeAdminInputBranch, branchOptions[0]))),
    );
  }, [dailyReports, role, branchName, activeAdminInputBranch, user?.id, branchOptions]);

  const isInitialCashLocked = currentFormReport?.initial_cash != null;

  useEffect(() => {
    if (currentFormReport?.initial_cash != null) {
      setInitialCashInput(String(currentFormReport.initial_cash));
    } else {
      setInitialCashInput("");
    }
    setNote(currentFormReport?.note ?? "");
  }, [currentFormReport, date, activeAdminInputBranch]);

  // Filter transaksi berdasarkan role dan pilihan cabang
  const filteredTxs = useMemo(() => {
    if (role === "cashier") {
      if (!branchName) return txs as any[];
      return (txs as any[]).filter((t) => branchMatch(getTxBranch(t), branchName));
    }
    if (selectedBranch === "all") return txs as any[];
    return (txs as any[]).filter((t) => branchMatch(getTxBranch(t), selectedBranch));
  }, [txs, role, branchName, selectedBranch, cashierBranchMap]);

  // Filter pengeluaran berdasarkan role dan pilihan cabang
  const filteredEntries = useMemo(() => {
    if (role === "cashier") {
      if (!branchName) return entries as any[];
      return (entries as any[]).filter((e) => branchMatch(getEntryBranch(e), branchName));
    }
    if (selectedBranch === "all") return entries as any[];
    return (entries as any[]).filter((e) => branchMatch(getEntryBranch(e), selectedBranch));
  }, [entries, role, branchName, selectedBranch, cashierBranchMap]);

  // Transaksi partner dipisah dari laporan harian
  const partnerTxs = useMemo(
    () => filteredTxs.filter((t) => t.sale_category === "partner"),
    [filteredTxs],
  );
  const salesTxs = useMemo(
    () => filteredTxs.filter((t) => t.sale_category !== "partner"),
    [filteredTxs],
  );

  const cashIn = useMemo(
    () =>
      salesTxs
        .filter((t: any) => t.payment_method === "cash")
        .reduce((s: number, t: any) => s + Number(t.total), 0),
    [salesTxs],
  );
  const qrisIn = useMemo(
    () =>
      salesTxs
        .filter((t: any) => t.payment_method === "qris")
        .reduce((s: number, t: any) => s + Number(t.total), 0),
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
    () => filteredEntries.filter((e) => (e.entry_type ?? "expense") !== "restock"),
    [filteredEntries],
  );
  const restockEntries = useMemo(
    () => filteredEntries.filter((e) => (e.entry_type ?? "expense") === "restock"),
    [filteredEntries],
  );
  const restockOut = useMemo(
    () => restockEntries.reduce((s, e) => s + entryTotal(e), 0),
    [restockEntries],
  );

  const cashOut = useMemo(
    () =>
      expenseEntries
        .filter((e) => (e.payment_method ?? "cash") === "cash")
        .reduce((s, e) => s + entryTotal(e), 0),
    [expenseEntries],
  );
  const qrisOut = useMemo(
    () =>
      expenseEntries
        .filter((e) => e.payment_method === "qris")
        .reduce((s, e) => s + entryTotal(e), 0),
    [expenseEntries],
  );
  const totalOut = cashOut + qrisOut;

  // Rekap partner
  const partnerCashIn = useMemo(
    () =>
      partnerTxs
        .filter((t) => t.payment_method === "cash")
        .reduce((s, t) => s + Number(t.total), 0),
    [partnerTxs],
  );
  const partnerQrisIn = useMemo(
    () =>
      partnerTxs
        .filter((t) => t.payment_method === "qris")
        .reduce((s, t) => s + Number(t.total), 0),
    [partnerTxs],
  );
  const partnerTotal = partnerCashIn + partnerQrisIn;
  const partnerGroups = useMemo(() => {
    const map: Record<
      string,
      { name: string; count: number; cash: number; qris: number; total: number }
    > = {};
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

  // Kas Awal sesuai filter yang dipilih
  const initialCash = useMemo(() => {
    if (role === "cashier") {
      const rep = (dailyReports as any[]).find(
        (r) =>
          branchMatch(r.branch_name, branchName) ||
          (user?.id && r.created_by === user.id) ||
          (!r.branch_name && (dailyReports as any[]).length === 1),
      );
      return Number(rep?.initial_cash ?? 0);
    }
    if (selectedBranch !== "all") {
      const rep = (dailyReports as any[]).find(
        (r) =>
          branchMatch(r.branch_name, selectedBranch) ||
          (!r.branch_name &&
            (dailyReports as any[]).length === 1 &&
            (branchOptions.length <= 1 || branchMatch(selectedBranch, branchOptions[0]))),
      );
      return Number(rep?.initial_cash ?? 0);
    }
    // Semua Cabang: akumulasikan kas awal dari semua cabang
    return (dailyReports as any[]).reduce((sum: number, r: any) => sum + Number(r.initial_cash ?? 0), 0);
  }, [dailyReports, role, branchName, selectedBranch, user?.id, branchOptions]);

  const todayResult = initialCash + totalIn - totalOut;
  const totalCashResult = initialCash + cashIn - cashOut;
  const totalQrisResult = qrisIn - qrisOut;

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const targetBranch = role === "cashier" ? (branchName || null) : (activeAdminInputBranch || null);
      if (role === "admin" && !targetBranch) {
        throw new Error("Admin wajib memilih cabang untuk menyimpan kas awal!");
      }

      const existing = (dailyReports as any[]).find(
        (r) => branchMatch(r.branch_name, targetBranch) || (!r.branch_name && !targetBranch),
      );

      const isLocked = existing?.initial_cash != null;
      if (isLocked && role === "cashier") {
        throw new Error("Kas awal sudah tersimpan dan tidak dapat diubah lagi.");
      }

      const cashVal = isLocked ? Number(existing.initial_cash) : Number(initialCashInput !== "" ? initialCashInput : 0);

      if (existing?.id) {
        const updatePayload: any = {
          initial_cash: cashVal,
          note: role === "admin" ? (note || null) : (existing.note || null),
          branch_name: targetBranch,
        };
        try {
          const { error } = await supabase.from("daily_reports").update(updatePayload).eq("id", existing.id);
          if (error) throw error;
        } catch {
          const { branch_name, ...basic } = updatePayload;
          const { error } = await supabase.from("daily_reports").update(basic).eq("report_date", date);
          if (error) throw error;
        }
      } else {
        const insertPayload: any = {
          report_date: date,
          branch_name: targetBranch,
          initial_cash: cashVal,
          note: role === "admin" ? (note || null) : null,
          created_by: u.user?.id,
        };
        try {
          const { error } = await supabase.from("daily_reports").insert(insertPayload);
          if (error) throw error;
        } catch {
          const { branch_name, ...basic } = insertPayload;
          const { error } = await supabase.from("daily_reports").upsert(basic);
          if (error) throw error;
        }
      }

      // Local storage sync
      try {
        const localKey = `app_daily_reports_${date}`;
        const prev: any[] = JSON.parse(localStorage.getItem(localKey) || "[]");
        const filtered = prev.filter((p: any) => !branchMatch(p.branch_name, targetBranch));
        filtered.push({
          report_date: date,
          branch_name: targetBranch,
          initial_cash: cashVal,
          note: role === "admin" ? (note || null) : null,
        });
        localStorage.setItem(localKey, JSON.stringify(filtered));
      } catch {}
    },
    onSuccess: () => {
      toast.success("Kas awal & laporan berhasil disimpan");
      qc.invalidateQueries({ queryKey: ["daily_reports", date] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || (role !== "admin" && role !== "cashier")) {
    return <div className="text-sm text-muted-foreground">Memuat…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileText className="h-5 w-5" /> Laporan Harian
          </h1>
          {role === "admin" && selectedBranch !== "all" && (
            <p className="text-xs text-primary font-medium mt-0.5 flex items-center gap-1">
              <Store className="h-3.5 w-3.5" />
              Menampilkan cabang: <span className="font-semibold">{selectedBranch}</span>
            </p>
          )}
          {role === "cashier" && (
            <p className="text-xs text-muted-foreground font-medium mt-0.5 flex items-center gap-1">
              <Store className="h-3.5 w-3.5 text-primary" />
              Cabang: <span className="font-semibold text-foreground">{branchName || "Cabang Utama"}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Pilihan Cabang (Khusus Admin) */}
          {role === "admin" && (
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Cabang:</Label>
              <Select value={selectedBranch} onValueChange={handleSelectBranchFilter}>
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
          )}

          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Tanggal:</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-[150px] h-9"
            />
          </div>
        </div>
      </div>

      {role === "admin" && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={tab === "harian" ? "default" : "outline"}
            onClick={() => setTab("harian")}
          >
            Harian
          </Button>
          <Button
            size="sm"
            variant={tab === "partner" ? "default" : "outline"}
            onClick={() => setTab("partner")}
          >
            Partner
          </Button>
        </div>
      )}

      {tab === "partner" && role === "admin" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={Users}
              label="Transaksi Partner"
              value={`${partnerTxs.length} Tx`}
              tone="muted"
            />
            <StatCard
              icon={Wallet}
              label="Partner Cash"
              value={rupiah(partnerCashIn)}
              tone="success"
            />
            <StatCard
              icon={CreditCard}
              label="Partner QRIS"
              value={rupiah(partnerQrisIn)}
              tone="success"
            />
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
                <div className="text-sm text-muted-foreground">
                  Belum ada transaksi partner pada tanggal ini.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full text-sm border-collapse min-w-[420px]">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        <th className="px-4 py-3 text-left font-semibold">Partner</th>
                        <th className="px-4 py-3 text-center font-semibold">Tx</th>
                        <th className="px-4 py-3 text-center font-semibold">Cash</th>
                        <th className="px-4 py-3 text-center font-semibold">QRIS</th>
                        <th className="px-4 py-3 text-center font-semibold text-primary bg-primary/5">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-medium">
                      {partnerGroups.map((g) => (
                        <tr key={g.name} className="hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-3">{g.name}</td>
                          <td className="px-4 py-3 text-center">{g.count}</td>
                          <td className="px-4 py-3 text-center">{rupiah(g.cash)}</td>
                          <td className="px-4 py-3 text-center">{rupiah(g.qris)}</td>
                          <td className="px-4 py-3 text-center text-primary bg-primary/5 font-bold">
                            {rupiah(g.total)}
                          </td>
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

      {tab === "harian" && role === "cashier" && (
        <>
          {/* 3 Kartu Ringkas Kasir */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard icon={Wallet} label="Kas Awal" value={rupiah(initialCash)} tone="muted" />
            <StatCard
              icon={Wallet}
              label="Total Cash"
              value={rupiah(totalCashResult)}
              sub="Kas Awal + Cash Masuk − Cash Keluar"
              tone="primary"
            />
            <StatCard
              icon={CreditCard}
              label="Total QRIS"
              value={rupiah(totalQrisResult)}
              sub="QRIS Masuk − QRIS Keluar"
              tone="primary"
            />
          </div>

          {/* Form Input Kas Awal Kasir */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" /> Input Kas Awal ({branchName || "Cabang Utama"})
                </CardTitle>
                {isInitialCashLocked && (
                  <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs">
                    <Lock className="h-3 w-3" /> Kas Awal Terkunci
                  </Badge>
                )}
              </div>
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
                    value={
                      currentFormReport?.initial_cash != null && initialCashInput === ""
                        ? currentFormReport.initial_cash
                        : initialCashInput
                    }
                    onChange={(e) => setInitialCashInput(e.target.value)}
                    placeholder="0"
                    disabled={isInitialCashLocked || save.isPending}
                  />
                  {isInitialCashLocked && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                      <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      Kas awal sudah disimpan dan tidak dapat diubah lagi.
                    </p>
                  )}
                </div>
                {!isInitialCashLocked && (
                  <Button type="submit" disabled={save.isPending}>
                    <Save className="h-4 w-4 mr-1" /> Simpan Kas Awal
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>
        </>
      )}

      {tab === "harian" && role === "admin" && (
        <>
          {/* 4 Stat Cards Utama Admin */}
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

          {/* Form Input Kas Awal Admin */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" /> Input Kas Awal & Catatan Cabang
                </CardTitle>
                {isInitialCashLocked && (
                  <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs">
                    <Lock className="h-3 w-3" /> Kas Awal Cabang Ini Terkunci
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>
                      Pilih Cabang <span className="text-destructive">*</span>
                    </Label>
                    <Select value={activeAdminInputBranch} onValueChange={setAdminInputBranch}>
                      <SelectTrigger>
                        <SelectValue placeholder="-- Pilih Cabang --" />
                      </SelectTrigger>
                      <SelectContent>
                        {branchOptions.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Kas Awal (Rp)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={
                        currentFormReport?.initial_cash != null && initialCashInput === ""
                          ? currentFormReport.initial_cash
                          : initialCashInput
                      }
                      onChange={(e) => setInitialCashInput(e.target.value)}
                      placeholder="0"
                      disabled={isInitialCashLocked || save.isPending}
                    />
                    {isInitialCashLocked && (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1 pt-0.5">
                        <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                        Kas awal sudah disimpan dan terkunci.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Catatan (opsional)</Label>
                    <Input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Catatan hari ini"
                      disabled={save.isPending}
                    />
                  </div>
                </div>
                <Button type="submit" disabled={save.isPending}>
                  <Save className="h-4 w-4 mr-1" /> {isInitialCashLocked ? "Simpan Catatan" : "Simpan Kas Awal & Catatan"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Ringkasan Aliran Kas & QRIS */}
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
                        <th className="px-4 py-3 font-semibold text-center text-emerald-600 dark:text-emerald-400">
                          Pemasukan Cash
                        </th>
                        <th className="px-4 py-3 font-semibold text-center text-destructive">
                          Pengeluaran Cash
                        </th>
                        <th className="px-4 py-3 font-semibold text-center text-primary bg-primary/5">
                          Total Cash
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-medium">
                      <tr className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-4 text-center">{rupiah(initialCash)}</td>
                        <td className="px-4 py-4 text-center text-emerald-600 dark:text-emerald-400">
                          {rupiah(cashIn)}
                        </td>
                        <td className="px-4 py-4 text-center text-destructive">
                          {rupiah(cashOut)}
                        </td>
                        <td className="px-4 py-4 text-center text-primary bg-primary/5 font-bold">
                          {rupiah(totalCashResult)}
                        </td>
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
                        <th className="px-4 py-3 font-semibold text-center text-emerald-600 dark:text-emerald-400">
                          Pemasukan QRIS
                        </th>
                        <th className="px-4 py-3 font-semibold text-center text-destructive">
                          Pengeluaran QRIS
                        </th>
                        <th className="px-4 py-3 font-semibold text-center text-primary bg-primary/5">
                          Total QRIS
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-medium">
                      <tr className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-4 text-center text-emerald-600 dark:text-emerald-400">
                          {rupiah(qrisIn)}
                        </td>
                        <td className="px-4 py-4 text-center text-destructive">
                          {rupiah(qrisOut)}
                        </td>
                        <td className="px-4 py-4 text-center text-primary bg-primary/5 font-bold">
                          {rupiah(totalQrisResult)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Rincian Pemasukan & Pengeluaran */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rincian Pemasukan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Cash" value={rupiah(cashIn)} />
                <Row label="QRIS" value={rupiah(qrisIn)} />
                <Row label={<b>Total</b>} value={<b>{rupiah(totalIn)}</b>} />
                <div className="text-xs text-muted-foreground pt-1">{filteredTxs.length} transaksi</div>
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
                  {restockEntries.length > 0 &&
                    ` · ${restockEntries.length} restok (${rupiah(restockOut)}) tidak dihitung`}
                </div>
              </CardContent>
            </Card>
          </div>
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
