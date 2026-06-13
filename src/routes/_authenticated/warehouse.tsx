import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { rupiah } from "@/lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PackagePlus, History, Plus, Trash2, Pencil, Eye } from "lucide-react";

export const Route = createFileRoute("/_authenticated/warehouse")({
  ssr: false,
  component: WarehousePage,
});

function WarehousePage() {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["stock_entries"],
    queryFn: async () => (await supabase
      .from("stock_entries")
      .select("*, stock_movements(*, products(name))")
      .order("created_at", { ascending: false })
      .limit(20)).data ?? [],
  });

  type DraftLine = { product_id: string; quantity: string; initial_price: string };
  const emptyLine = (): DraftLine => ({ product_id: "", quantity: "", initial_price: "" });
  const [restockDate, setRestockDate] = useState(new Date().toISOString().slice(0, 10));
  const [shippingCost, setShippingCost] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [editingEntry, setEditingEntry] = useState<string | null>(null);

  const reset = () => {
    setRestockDate(new Date().toISOString().slice(0, 10));
    setShippingCost("");
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
      const validLines = lines.filter((line) => line.product_id && Number(line.quantity) > 0);
      if (validLines.length === 0) throw new Error("Tambahkan minimal satu produk");
      if (new Set(validLines.map((line) => line.product_id)).size !== validLines.length) throw new Error("Produk yang sama tidak boleh dipilih dua kali");
      const { data: u } = await supabase.auth.getUser();
      if (editingEntry) {
        const { error: entryError } = await supabase.from("stock_entries").update({ restock_date: restockDate, shipping_cost: Number(shippingCost || 0) }).eq("id", editingEntry);
        if (entryError) throw entryError;
        const { error: deleteError } = await supabase.from("stock_movements").delete().eq("stock_entry_id", editingEntry);
        if (deleteError) throw deleteError;
        const { error: lineError } = await supabase.from("stock_movements").insert(validLines.map((line) => ({
          stock_entry_id: editingEntry, product_id: line.product_id, quantity: Number(line.quantity), initial_price: Number(line.initial_price || 0), created_by: u.user?.id,
        })));
        if (lineError) throw lineError;
        return;
      }
      const { data: entry, error: entryError } = await supabase.from("stock_entries").insert({
        restock_date: restockDate, shipping_cost: Number(shippingCost || 0), created_by: u.user?.id,
      }).select("id").single();
      if (entryError) throw entryError;
      const { error: lineError } = await supabase.from("stock_movements").insert(validLines.map((line) => ({
        stock_entry_id: entry.id, product_id: line.product_id, quantity: Number(line.quantity), initial_price: Number(line.initial_price || 0), created_by: u.user?.id,
      })));
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
    onSuccess: () => { toast.success("Riwayat stok dihapus"); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const edit = (entry: any) => {
    setEditingEntry(entry.id);
    setRestockDate(entry.restock_date);
    setShippingCost(String(entry.shipping_cost));
    setLines(entry.stock_movements.map((movement: any) => ({ product_id: movement.product_id, quantity: String(movement.quantity), initial_price: String(movement.initial_price) })));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateLine = (index: number, patch: Partial<DraftLine>) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  const totalCapital = lines.reduce((total, line) => total + Number(line.quantity || 0) * Number(line.initial_price || 0), 0) + Number(shippingCost || 0);

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><PackagePlus className="h-4 w-4" /> {editingEntry ? "Edit Stok Masuk" : "Tambah Stok"}</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Tanggal Restock</Label><Input type="date" value={restockDate} onChange={(event) => setRestockDate(event.target.value)} required /></div>
              <div className="space-y-1.5"><Label>Ongkir Total (Rp)</Label><Input type="number" min="0" value={shippingCost} onChange={(event) => setShippingCost(event.target.value)} /></div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>Daftar Produk</Label><Button type="button" size="sm" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}><Plus className="h-3 w-3 mr-1" />Produk</Button></div>
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-[minmax(0,1fr)_80px_110px_auto] gap-2 items-end">
                  <div className="space-y-1"><Label className="text-xs">Produk</Label><Select value={line.product_id} onValueChange={(product_id) => updateLine(index, { product_id })}><SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1"><Label className="text-xs">Jumlah</Label><Input type="number" min="1" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Modal/pcs</Label><Input type="number" min="0" value={line.initial_price} onChange={(event) => updateLine(index, { initial_price: event.target.value })} /></div>
                  <Button type="button" size="icon" variant="ghost" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Total Modal</Label>
              <div className="rounded-md bg-muted p-2 font-semibold">{rupiah(totalCapital)}</div>
            </div>
            <div className="flex gap-2"><Button className="flex-1" type="submit" disabled={add.isPending}>Simpan Semua</Button>{editingEntry && <Button type="button" variant="outline" onClick={reset}>Batal</Button>}</div>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Riwayat Stok Masuk</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {entries.length === 0 && <p className="text-sm text-muted-foreground">Belum ada riwayat.</p>}
          {entries.map((entry: any) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card">
              <div>
                <div className="font-medium">{new Date(`${entry.restock_date}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</div>
                <div className="text-xs text-muted-foreground">
                  {entry.stock_movements.length} produk · {entry.stock_movements.reduce((sum: number, movement: any) => sum + movement.quantity, 0)} pcs · Ongkir {rupiah(entry.shipping_cost)}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" variant="ghost" onClick={() => setSelectedEntry(entry)} aria-label="Lihat detail"><Eye className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => edit(entry)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm("Hapus riwayat dan kurangi stok terkait?")) remove.mutate(entry.id); }} aria-label="Hapus"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Dialog open={!!selectedEntry} onOpenChange={(open) => { if (!open) setSelectedEntry(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Detail Stok Masuk</DialogTitle></DialogHeader>
          {selectedEntry && <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Tanggal restock</span><span>{new Date(`${selectedEntry.restock_date}T00:00:00`).toLocaleDateString("id-ID")}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Ongkir</span><span>{rupiah(selectedEntry.shipping_cost)}</span></div>
            <div className="border-t pt-2 space-y-2">{selectedEntry.stock_movements.map((movement: any) => <div key={movement.id} className="flex justify-between gap-4"><div><div className="font-medium">{movement.products?.name ?? "—"}</div><div className="text-xs text-muted-foreground">{movement.quantity} × {rupiah(movement.initial_price)}</div></div><span>{rupiah(movement.quantity * Number(movement.initial_price))}</span></div>)}</div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
