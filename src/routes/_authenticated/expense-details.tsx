import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { rupiah } from "@/lib/format";
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Save, Plus, Minus, X, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/expense-details")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      dateFilter: (search.dateFilter as "today" | "7" | "14" | "30" | "month" | "all") || undefined,
      fromDate: (search.fromDate as string) || undefined,
      toDate: (search.toDate as string) || undefined,
      type: (search.type as "expense" | "restock") || undefined,
    } as {
      dateFilter?: "today" | "7" | "14" | "30" | "month" | "all";
      fromDate?: string;
      toDate?: string;
      type?: "expense" | "restock";
    };
  },
  ssr: false,
  component: ExpenseDetails,
});

function ExpenseDetails() {
  const navigate = useNavigate();
  const { role: rawRole, user, branchName } = useAuth();
  const isExplicitKasir = user?.email?.toLowerCase().trim() === "kasir@gmail.com" || user?.email?.toLowerCase().includes("kasir");
  const role: "admin" | "cashier" = isExplicitKasir
    ? "cashier"
    : rawRole || (user?.email?.toLowerCase().trim() === "jaleputra69@gmail.com" ? "admin" : "cashier");
  const searchParams = Route.useSearch();
  const [dateFilter, setDateFilter] = useState<"today" | "7" | "14" | "30" | "month" | "all">(
    searchParams.dateFilter || "14"
  );
  const [fromDate, setFromDate] = useState<string>(searchParams.fromDate || "");
  const [toDate, setToDate] = useState<string>(searchParams.toDate || "");
  const customRange = !!(fromDate && toDate);
  const [search, setSearch] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const qc = useQueryClient();

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

  const { data } = useQuery({
    queryKey: ["expense-details", dateFilter, fromDate, toDate],
    queryFn: async () => {
      let sinceDateStr: string;
      let untilDateStr: string | null = null;
      if (customRange) {
        sinceDateStr = fromDate;
        untilDateStr = toDate;
      } else {
        const since = new Date();
        if (dateFilter === "today") since.setHours(0, 0, 0, 0);
        else if (dateFilter === "7") since.setDate(since.getDate() - 6);
        else if (dateFilter === "14") since.setDate(since.getDate() - 13);
        else if (dateFilter === "30") since.setDate(since.getDate() - 29);
        else if (dateFilter === "month") since.setDate(1);
        else since.setFullYear(2020, 0, 1);
        since.setHours(0, 0, 0, 0);
        sinceDateStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
      }

      let q = supabase.from("stock_entries").select("*").gte("restock_date", sinceDateStr);
      if (untilDateStr) q = q.lte("restock_date", untilDateStr);
      const { data: entriesData } = await q.order("restock_date", { ascending: false });

      const entries = entriesData ?? [];
      const entryIds = entries.map((e) => e.id);

      let movementsData: any[] = [];
      if (entryIds.length > 0) {
        // Chunk entry IDs to avoid HTTP 414 Request-URI Too Long errors
        const chunkSize = 100;
        const chunks = [];
        for (let i = 0; i < entryIds.length; i += chunkSize) {
          chunks.push(entryIds.slice(i, i + chunkSize));
        }

        const results = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("stock_movements")
              .select("*, products(name)")
              .in("stock_entry_id", chunk)
          )
        );

        for (const res of results) {
          if (res.error) {
            console.error("expense-details movements query error in chunk:", res.error);
          } else {
            movementsData.push(...(res.data ?? []));
          }
        }
      }

      const [prodsRes] = await Promise.all([
        supabase.from("products").select("*"),
      ]);

      return {
        entries,
        movements: movementsData,
        products: prodsRes.data ?? [],
      };
    },
    refetchInterval: 30000,
  });

  const allEntries = data?.entries ?? [];
  const movements = data?.movements ?? [];
  const products = data?.products ?? [];

  const typeFilter = searchParams.type;

  const filteredEntries = useMemo(() => {
    let result = allEntries;

    // Filter by branch for cashier
    if (role === "cashier") {
      const myBranch = branchName || cashierBranchMap[user?.id || ""] || "";
      result = result.filter((e: any) => {
        if (user?.id && e.created_by === user.id) return true;
        const eb = getEntryBranch(e);
        if (myBranch && eb) return branchMatch(eb, myBranch);
        return false;
      });
    }

    if (typeFilter === "restock") {
      result = result.filter((e: any) => e.entry_type === "restock");
    } else if (typeFilter === "expense") {
      result = result.filter((e: any) => (e.entry_type ?? "expense") !== "restock");
    }

    const term = search.trim().toLocaleLowerCase("id-ID");
    if (term.length < 3) return result;
    return result.filter((entry) => {
      const entryMovements = movements.filter((m) => m.stock_entry_id === entry.id);
      const productNames = entryMovements
        .map((m: any) => (m.products?.name ?? "").toLocaleLowerCase("id-ID"))
        .join(" ");
      const hay = [
        entry.id,
        entry.restock_date,
        String(entry.shipping_cost),
        productNames,
      ]
        .join(" ")
        .toLocaleLowerCase("id-ID");
      return hay.includes(term);
    });
  }, [allEntries, movements, search, typeFilter]);

  const totalExpense = useMemo(() => {
    return filteredEntries.reduce((sum, entry) => {
      const entryMovements = movements.filter((m) => m.stock_entry_id === entry.id);
      const subtotal = entryMovements.reduce((s, m) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0), 0);
      return sum + subtotal + Number(entry.shipping_cost);
    }, 0);
  }, [filteredEntries, movements]);

  const [editForm, setEditForm] = useState({
    restock_date: "",
    shipping_cost: "",
  });
  const [editItems, setEditItems] = useState<any[]>([]);

  const selectedEntry = useMemo(() => filteredEntries.find((e) => e.id === selectedEntryId) ?? null, [filteredEntries, selectedEntryId]);

  const openEntry = (entry: any) => {
    setSelectedEntryId(entry.id);
    setEditForm({
      restock_date: entry.restock_date,
      shipping_cost: String(entry.shipping_cost),
    });
    const entryMovements = movements.filter((m) => m.stock_entry_id === entry.id).map((m) => ({ ...m }));
    setEditItems(entryMovements);
  };

  const closeDialog = () => setSelectedEntryId(null);

  const currentTotal = useMemo(
    () => editItems.reduce((s, i) => s + Number(i.initial_price) * Number(i.quantity), 0) + (Number(editForm.shipping_cost) || 0),
    [editItems, editForm.shipping_cost],
  );

  const updateQty = (idx: number, delta: number) => {
    setEditItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, quantity: Math.max(1, Number(it.quantity) + delta) } : it)),
    );
  };

  const removeItem = (idx: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!selectedEntryId || !selectedEntry) return;
      if (editItems.length === 0) throw new Error("Minimal harus ada 1 produk");
      const shippingCostVal = Number(editForm.shipping_cost) || 0;

      // 1. Update stock entry
      const { data: updatedEntry, error: entryError } = await supabase
        .from("stock_entries")
        .update({
          restock_date: editForm.restock_date,
          shipping_cost: shippingCostVal,
        })
        .eq("id", selectedEntryId)
        .select();
      if (entryError) throw entryError;
      if (!updatedEntry || updatedEntry.length === 0) {
        throw new Error("Gagal memperbarui pengeluaran. Baris data tidak ditemukan atau Anda tidak memiliki izin RLS.");
      }

      // 2. Delete old movements (database trigger handles decreasing product stocks)
      const { error: deleteError } = await supabase
        .from("stock_movements")
        .delete()
        .eq("stock_entry_id", selectedEntryId);
      if (deleteError) throw deleteError;

      // 3. Insert new movements (database trigger handles increasing product stocks)
      const resolvedMovements = editItems.map((item) => ({
        stock_entry_id: selectedEntryId,
        product_id: item.product_id,
        quantity: Number(item.quantity),
        initial_price: Number(item.initial_price),
        shipping_cost: 0,
      }));

      const { data: insertedMvs, error: lineError } = await supabase
        .from("stock_movements")
        .insert(resolvedMovements)
        .select();
      if (lineError) throw lineError;
      if (!insertedMvs || insertedMvs.length === 0) {
        throw new Error("Gagal menyimpan rincian pengeluaran. Silakan periksa izin RLS Anda.");
      }
    },
    onSuccess: () => {
      toast.success(`${selectedEntry?.entry_type === "restock" ? "Restok" : "Pengeluaran"} berhasil diperbarui`);
      closeDialog();
      qc.invalidateQueries({ queryKey: ["expense-details"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stock_entries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("stock_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${selectedEntry?.entry_type === "restock" ? "Restok" : "Pengeluaran"} dihapus & stok dikembalikan`);
      closeDialog();
      qc.invalidateQueries({ queryKey: ["expense-details"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stock_entries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link to={role === "cashier" ? "/income-details" : "/dashboard"}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> {role === "cashier" ? "Pemasukan" : "Dashboard"}
            </Button>
          </Link>
          <h1 className="text-xl font-bold">
            {typeFilter === "restock" ? "Detail Restok" : "Detail Pengeluaran"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filter Tanggal:</span>
          <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
            <SelectTrigger className="w-[160px]">
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
          <span className="text-[10px] text-primary">(Rentang kustom aktif — filter tanggal di atas diabaikan)</span>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          placeholder="Ketik minimal 3 huruf untuk mencari (produk gudang, ID, tanggal, dll.)"
        />
      </div>

      <Card>
        <CardContent className="p-4 flex justify-between items-center">
          <div>
            <div className="text-xs text-muted-foreground">
              {typeFilter === "restock" ? "Total Restok" : "Total Pengeluaran"}
            </div>
            <div className="text-2xl font-bold text-destructive">{role === "cashier" ? "XXXXX" : rupiah(totalExpense)}</div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {filteredEntries.length} {typeFilter === "restock" ? "restok" : "pengeluaran"}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2 md:p-4">
          {filteredEntries.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">
              Belum ada {typeFilter === "restock" ? "restok" : "pengeluaran"} di periode ini.
            </p>
          ) : (
            <div className="divide-y">
              {filteredEntries.map((entry) => {
                const entryMovements = movements.filter((m) => m.stock_entry_id === entry.id);
                const subtotal = entryMovements.reduce((s, m) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0), 0);
                const totalAmt = subtotal + Number(entry.shipping_cost);
                const groceryNames = entryMovements
                  .map((m: any) => (m.products?.name ?? "").replace(/^\[GUDANG\]\s*/i, ""))
                  .filter(Boolean)
                  .join(", ");
                return (
                  <div
                    key={entry.id}
                    onClick={() => openEntry(entry)}
                    className="flex justify-between items-center py-3 px-2 text-sm cursor-pointer hover:bg-muted/50 rounded transition active:scale-[0.99]"
                  >
                    <div className="min-w-0 pr-4">
                      <div className="font-semibold truncate">
                        {groceryNames || `${entry.entry_type === "restock" ? "Restok" : "Pengeluaran"} #${entry.id.slice(0, 8).toUpperCase()}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Tanggal: {entry.restock_date}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-destructive">{rupiah(totalAmt)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Ongkir: {rupiah(entry.shipping_cost)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail popup */}
      <Dialog open={!!selectedEntryId} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Detail {selectedEntry?.entry_type === "restock" ? "Restok" : "Pengeluaran"}
            </DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <div className="grid md:grid-cols-2 gap-4">
              {/* Receipt Preview */}
              <div className="border rounded-lg p-3 bg-muted/20">
                <div className="border rounded-lg p-4 bg-background space-y-3 font-mono text-xs shadow-sm">
                  <div className="text-center font-bold text-sm">MR KRIUK AMI</div>
                  <div className="text-center text-[10px] text-muted-foreground border-b pb-2">
                    {selectedEntry?.entry_type === "restock" ? "NOTA RE-STOCK" : "NOTA PENGELUARAN"}
                  </div>
                  <div className="space-y-1">
                    <div>ID: #{selectedEntry.id.slice(0, 8).toUpperCase()}</div>
                    <div>Tanggal: {editForm.restock_date}</div>
                  </div>
                  <div className="border-t border-dashed my-2" />
                  <div className="space-y-1.5">
                    {editItems.map((it, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span>{(it.products?.name ?? it.product_name ?? "").replace(/^\[GUDANG\]\s*/i, "")} ({it.quantity} Pcs)</span>
                        <span>{rupiah(Number(it.initial_price) * Number(it.quantity))}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-dashed my-2" />
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Subtotal Produk:</span>
                      <span>{rupiah(editItems.reduce((s, i) => s + Number(i.initial_price) * Number(i.quantity), 0))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Ongkos Kirim:</span>
                      <span>{rupiah(Number(editForm.shipping_cost) || 0)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-sm text-destructive mt-1 border-t pt-1">
                      <span>TOTAL:</span>
                      <span>{rupiah(editItems.reduce((s, i) => s + Number(i.initial_price) * Number(i.quantity), 0) + (Number(editForm.shipping_cost) || 0))}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Editor panel */}
              <div className="space-y-4">
                <div className="space-y-2 border rounded-lg p-3 bg-card">
                  <h3 className="font-semibold text-sm">Edit Item</h3>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {editItems.map((it, idx) => (
                      <div key={idx} className="flex flex-col gap-1 border-b pb-2 pt-1 text-xs">
                        <div className="flex justify-between items-center">
                          <div className="font-medium truncate flex-1 min-w-0 pr-2">
                            {(it.products?.name ?? it.product_name ?? "").replace(/^\[GUDANG\]\s*/i, "")}
                          </div>
                          <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive shrink-0" onClick={() => removeItem(idx)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground mr-1">Harga:</span>
                            <Input
                              type="number"
                              className="h-6 w-20 text-[11px] px-1"
                              value={it.initial_price}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                setEditItems((prev) => prev.map((item, i) => i === idx ? { ...item, initial_price: val } : item));
                              }}
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => updateQty(idx, -1)}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-6 text-center font-semibold">{it.quantity}</span>
                            <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => updateQty(idx, 1)}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {editItems.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">Tidak ada item.</p>
                    )}
                  </div>
                  <div className="flex justify-between text-sm font-bold pt-1 border-t">
                    <span>Total {selectedEntry?.entry_type === "restock" ? "Restok" : "Pengeluaran"}</span>
                    <span className="text-destructive">{rupiah(currentTotal)}</span>
                  </div>
                </div>

                <div className="space-y-3 border rounded-lg p-3 bg-card">
                  <h3 className="font-semibold text-sm">
                    Data {selectedEntry?.entry_type === "restock" ? "Restok" : "Pengeluaran"}
                  </h3>
                  <div className="space-y-1.5">
                    <Label>Tanggal Restok</Label>
                    <Input
                      type="date"
                      value={editForm.restock_date}
                      onChange={(e) => setEditForm({ ...editForm, restock_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Ongkos Kirim</Label>
                    <Input
                      type="number"
                      min="0"
                      value={editForm.shipping_cost}
                      onChange={(e) => setEditForm({ ...editForm, shipping_cost: e.target.value })}
                    />
                  </div>

                  <Button
                    className="w-full mt-2"
                    size="sm"
                    disabled={saveEdit.isPending}
                    onClick={() => saveEdit.mutate()}
                  >
                    <Save className="h-4 w-4 mr-1.5" /> Simpan Perubahan
                  </Button>
                </div>

                <Button
                  variant="destructive"
                  className="w-full"
                  size="sm"
                  disabled={deleteEntry.isPending}
                  onClick={() => {
                    if (confirm(`Hapus ${selectedEntry?.entry_type === "restock" ? "restok" : "pengeluaran"} ini? Seluruh stok produk terhubung akan otomatis dikurangi kembali.`)) {
                      deleteEntry.mutate(selectedEntry.id);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" /> Hapus {selectedEntry?.entry_type === "restock" ? "Restok" : "Pengeluaran"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
