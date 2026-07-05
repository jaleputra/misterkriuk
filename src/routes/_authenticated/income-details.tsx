import { createFileRoute, Link } from "@tanstack/react-router";
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
import { ArrowLeft, Printer, Share2, Trash2, Save, Plus, Minus, X } from "lucide-react";
import { printReceiptThermalClient, isPrinterConnectedClient } from "@/lib/thermal-printer.actions";
import { shareReceiptImageClient } from "@/lib/receipt-pdf.actions";
import { Receipt } from "@/components/Receipt";

export const Route = createFileRoute("/_authenticated/income-details")({
  ssr: false,
  component: IncomeDetails,
});

function IncomeDetails() {
  const [dateFilter, setDateFilter] = useState<"today" | "7" | "14" | "30" | "month" | "all">("14");
  const [search, setSearch] = useState("");
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["income-details", dateFilter],
    queryFn: async () => {
      const since = new Date();
      if (dateFilter === "today") since.setHours(0, 0, 0, 0);
      else if (dateFilter === "7") since.setDate(since.getDate() - 6);
      else if (dateFilter === "14") since.setDate(since.getDate() - 13);
      else if (dateFilter === "30") since.setDate(since.getDate() - 29);
      else if (dateFilter === "month") since.setDate(1);
      else since.setFullYear(2020, 0, 1);
      since.setHours(0, 0, 0, 0);

      const [tx, items, prods] = await Promise.all([
        supabase.from("transactions").select("*").gte("created_at", since.toISOString()).order("created_at", { ascending: false }),
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

  const { data: settings } = useQuery({
    queryKey: ["printer_settings"],
    queryFn: async () => (await supabase.from("printer_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  const allTxs = data?.transactions ?? [];
  const items = data?.items ?? [];
  const products = data?.products ?? [];

  const txs = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("id-ID");
    if (term.length < 3) return allTxs;
    return allTxs.filter((t) => {
      const itemNames = items
        .filter((i) => i.transaction_id === t.id)
        .map((i) => (i.product_name ?? "").toLocaleLowerCase("id-ID"))
        .join(" ");
      const hay = [
        t.id,
        t.buyer_name ?? "",
        t.house_block ?? "",
        t.partner_name ?? "",
        t.payment_method ?? "",
        String(t.total ?? ""),
        new Date(t.created_at).toLocaleString("id-ID"),
        itemNames,
      ]
        .join(" ")
        .toLocaleLowerCase("id-ID");
      return hay.includes(term);
    });
  }, [allTxs, items, search]);

  const totalRevenue = useMemo(() => txs.reduce((s, t) => s + Number(t.total), 0), [txs]);

  const [editForm, setEditForm] = useState({
    payment_method: "cash",
    house_block: "",
    cash_received: "",
    partner_name: "",
    buyer_name: "",
  });
  const [editItems, setEditItems] = useState<any[]>([]);

  const selectedTx = useMemo(() => txs.find((t) => t.id === selectedTxId) ?? null, [txs, selectedTxId]);

  const openTx = (t: any) => {
    setSelectedTxId(t.id);
    setEditForm({
      payment_method: t.payment_method,
      house_block: t.house_block ?? "",
      cash_received: String(t.cash_received ?? ""),
      partner_name: t.partner_name ?? "",
      buyer_name: t.buyer_name ?? "",
    });
    const txItems = items.filter((i) => i.transaction_id === t.id).map((i) => ({ ...i }));
    setEditItems(txItems);
  };

  const closeDialog = () => setSelectedTxId(null);

  const currentTotal = useMemo(
    () => editItems.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0),
    [editItems],
  );

  const updateQty = (idx: number, delta: number) => {
    setEditItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, quantity: Math.max(1, Number(it.quantity) + delta), subtotal: (Math.max(1, Number(it.quantity) + delta)) * Number(it.price) } : it)),
    );
  };

  const removeItem = (idx: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!selectedTxId || !selectedTx) return;
      if (editItems.length === 0) throw new Error("Minimal harus ada 1 produk");
      const totalAmt = currentTotal;
      const isCash = editForm.payment_method === "cash";
      const cashVal = Number(editForm.cash_received) || 0;
      if (isCash && cashVal < totalAmt) throw new Error("Uang tunai kurang");
      const changeAmt = isCash ? Math.max(0, cashVal - totalAmt) : null;

      // Restore stock from original items
      const originalItems = items.filter((i) => i.transaction_id === selectedTxId);
      for (const oi of originalItems) {
        if (oi.product_id) {
          const { data: prod } = await supabase.from("products").select("stock").eq("id", oi.product_id).single();
          if (prod) {
            await supabase.from("products").update({ stock: prod.stock + oi.quantity }).eq("id", oi.product_id);
          }
        }
      }

      // Delete old items and insert new
      const { error: delErr } = await supabase.from("transaction_items").delete().eq("transaction_id", selectedTxId);
      if (delErr) throw delErr;

      const rows = editItems.map((i) => ({
        transaction_id: selectedTxId,
        product_id: i.product_id,
        product_name: i.product_name,
        price: Number(i.price),
        quantity: Number(i.quantity),
        subtotal: Number(i.price) * Number(i.quantity),
        cost_price: i.cost_price ?? null,
      }));
      const { error: insErr } = await supabase.from("transaction_items").insert(rows);
      if (insErr) throw insErr;

      // Deduct new stock
      for (const ni of editItems) {
        if (ni.product_id) {
          const { data: prod } = await supabase.from("products").select("stock").eq("id", ni.product_id).single();
          if (prod) {
            await supabase.from("products").update({ stock: Math.max(0, prod.stock - Number(ni.quantity)) }).eq("id", ni.product_id);
          }
        }
      }

      const { error: txErr } = await supabase
        .from("transactions")
        .update({
          total: totalAmt,
          payment_method: editForm.payment_method,
          house_block: editForm.house_block.trim() || null,
          cash_received: isCash ? cashVal : null,
          change_amount: changeAmt,
          partner_name: editForm.partner_name.trim() || null,
          buyer_name: editForm.buyer_name.trim() || null,
        })
        .eq("id", selectedTxId);
      if (txErr) throw txErr;
    },
    onSuccess: () => {
      toast.success("Transaksi berhasil diperbarui");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["income-details"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTx = useMutation({
    mutationFn: async (txId: string) => {
      const txItems = items.filter((i) => i.transaction_id === txId);
      for (const item of txItems) {
        if (item.product_id) {
          const { data: prod } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
          if (prod) {
            await supabase.from("products").update({ stock: prod.stock + item.quantity }).eq("id", item.product_id);
          }
        }
      }
      await supabase.from("transaction_items").delete().eq("transaction_id", txId);
      await supabase.from("transactions").delete().eq("id", txId);
    },
    onSuccess: () => {
      toast.success("Transaksi dihapus & stok dikembalikan");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["income-details"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePrint = async (tx: any) => {
    const txItems = items.filter((i) => i.transaction_id === tx.id);
    if (!isPrinterConnectedClient()) {
      toast.warning("Printer Bluetooth belum terhubung.");
      return;
    }
    try {
      await printReceiptThermalClient({ ...tx, items: txItems }, settings ?? null);
      toast.success("Struk dikirim ke printer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencetak");
    }
  };

  const handleShare = async (tx: any) => {
    const txItems = items.filter((i) => i.transaction_id === tx.id);
    try {
      await shareReceiptImageClient({ ...tx, items: txItems }, settings ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membagikan");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link to="/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Detail Pemasukan</h1>
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

      <Card>
        <CardContent className="p-4 flex justify-between items-center">
          <div>
            <div className="text-xs text-muted-foreground">Total Pemasukan</div>
            <div className="text-2xl font-bold text-success">{rupiah(totalRevenue)}</div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {txs.length} transaksi
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2 md:p-4">
          {txs.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">Belum ada transaksi di periode ini.</p>
          ) : (
            <div className="divide-y">
              {txs.map((t) => (
                <div
                  key={t.id}
                  onClick={() => openTx(t)}
                  className="flex justify-between items-center py-3 px-2 text-sm cursor-pointer hover:bg-muted/50 rounded transition active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">
                      No: {t.id.slice(0, 8).toUpperCase()}
                      {t.buyer_name ? ` · ${t.buyer_name}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleString("id-ID")}
                    </div>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    <div className="font-bold text-success">{rupiah(t.total)}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">
                      {t.payment_method}
                      {t.house_block ? ` · Blok ${t.house_block}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail popup */}
      <Dialog open={!!selectedTxId} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detail Transaksi</DialogTitle>
          </DialogHeader>
          {selectedTx && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-lg p-2 bg-muted/20">
                <Receipt tx={{ ...selectedTx, items: editItems }} settings={settings} />
              </div>

              <div className="space-y-4">
                <div className="space-y-2 border rounded-lg p-3 bg-card">
                  <h3 className="font-semibold text-sm">Edit Pesanan</h3>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {editItems.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs border-b pb-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{it.product_name}</div>
                          <div className="text-muted-foreground">{rupiah(Number(it.price))} × {it.quantity}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => updateQty(idx, -1)}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-6 text-center font-semibold">{it.quantity}</span>
                          <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => updateQty(idx, 1)}>
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeItem(idx)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {editItems.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">Tidak ada item.</p>
                    )}
                  </div>
                  <div className="flex justify-between text-sm font-bold pt-1 border-t">
                    <span>Total</span>
                    <span className="text-success">{rupiah(currentTotal)}</span>
                  </div>
                </div>

                <div className="space-y-3 border rounded-lg p-3 bg-card">
                  <h3 className="font-semibold text-sm">Data Transaksi</h3>

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
                      <div className="text-xs flex justify-between mt-1">
                        <span className="text-muted-foreground">Tagihan: {rupiah(currentTotal)}</span>
                        <span className="text-success font-semibold">
                          Kembalian: {rupiah(Math.max(0, (Number(editForm.cash_received) || 0) - currentTotal))}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label>Nama Pembeli</Label>
                      <Input
                        value={editForm.buyer_name}
                        onChange={(e) => setEditForm({ ...editForm, buyer_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Blok Rumah</Label>
                      <Input
                        value={editForm.house_block}
                        onChange={(e) => setEditForm({ ...editForm, house_block: e.target.value })}
                      />
                    </div>
                  </div>

                  {selectedTx.sale_category === "partner" && (
                    <div className="space-y-1.5">
                      <Label>Nama Partner</Label>
                      <Input
                        value={editForm.partner_name}
                        onChange={(e) => setEditForm({ ...editForm, partner_name: e.target.value })}
                      />
                    </div>
                  )}

                  <Button
                    className="w-full"
                    size="sm"
                    disabled={saveEdit.isPending}
                    onClick={() => saveEdit.mutate()}
                  >
                    <Save className="h-4 w-4 mr-1.5" /> Simpan Perubahan
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={() => handlePrint(selectedTx)}>
                      <Printer className="h-4 w-4 mr-1.5" /> Cetak
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleShare(selectedTx)}>
                      <Share2 className="h-4 w-4 mr-1.5" /> Bagikan
                    </Button>
                  </div>
                  <Button
                    variant="destructive"
                    className="w-full"
                    size="sm"
                    disabled={deleteTx.isPending}
                    onClick={() => {
                      if (confirm("Hapus transaksi ini? Stok akan dikembalikan.")) {
                        deleteTx.mutate(selectedTx.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" /> Hapus Transaksi
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
