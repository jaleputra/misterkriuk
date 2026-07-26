import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { rupiah } from "@/lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PackagePlus, History, Plus, Trash2, Pencil, Eye, Search } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/warehouse")({
  ssr: false,
  component: WarehousePage,
});

function WarehousePage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["stock_entries"],
    queryFn: async () =>
      (
        await supabase
          .from("stock_entries")
          .select("*, stock_movements(*, products(name))")
          .order("created_at", { ascending: false })
          .limit(20)
      ).data ?? [],
  });

  type DraftLine = { product_name: string; quantity: string; initial_price: string };
  const emptyLine = (): DraftLine => ({ product_name: "", quantity: "", initial_price: "" });
  const [restockDate, setRestockDate] = useState(new Date().toISOString().slice(0, 10));
  const [shippingCost, setShippingCost] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qris">("cash");
  const [entryType, setEntryType] = useState<"expense" | "restock">("expense");

  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filteredEntries = (() => {
    const term = search.trim().toLocaleLowerCase("id-ID");
    if (term.length < 3) return entries as any[];
    return (entries as any[]).filter((entry) => {
      const names = entry.stock_movements
        .map((m: any) => (m.products?.name ?? "").replace(/^\[GUDANG\]\s*/i, ""))
        .join(" ");
      const hay = [
        names,
        entry.restock_date,
        new Date(`${entry.restock_date}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
        String(entry.shipping_cost ?? ""),
      ]
        .join(" ")
        .toLocaleLowerCase("id-ID");
      return hay.includes(term);
    });
  })();

  const reset = () => {
    setRestockDate(new Date().toISOString().slice(0, 10));
    setShippingCost("");
    setPaymentMethod("cash");
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
      const validLines = lines.filter((line) => line.product_name.trim() && Number(line.quantity) > 0);
      if (validLines.length === 0) throw new Error("Tambahkan minimal satu produk");
      if (new Set(validLines.map((line) => line.product_name.trim().toLowerCase())).size !== validLines.length)
        throw new Error("Produk yang sama tidak boleh dimasukkan dua kali");
      const { data: u } = await supabase.auth.getUser();

      // Cari atau buat produk secara dinamis menggunakan kategori 'customer' dengan prefix '[GUDANG] '
      const resolvedMovements = [];
      for (const line of validLines) {
        const nameClean = line.product_name.trim();
        const prefixedName = `[GUDANG] ${nameClean}`;
        let { data: existingProd } = await supabase
          .from("products")
          .select("id")
          .eq("name", prefixedName)
          .eq("category", "customer")
          .maybeSingle();

        let prodId = existingProd?.id;
        if (!prodId) {
          const { data: newProd, error: newProdErr } = await supabase
            .from("products")
            .insert({
              name: prefixedName,
              category: "customer",
              price: 0,
              stock: 0,
            })
            .select("id")
            .single();
          if (newProdErr) throw newProdErr;
          prodId = newProd.id;
        }

        resolvedMovements.push({
          product_id: prodId,
          quantity: Number(line.quantity),
          initial_price: Number(line.initial_price || 0),
          created_by: u.user?.id,
        });
      }

      if (editingEntry) {
        const { error: entryError } = await supabase
          .from("stock_entries")
          .update({ restock_date: restockDate, shipping_cost: Number(shippingCost || 0), payment_method: paymentMethod })
          .eq("id", editingEntry);
        if (entryError) throw entryError;
        const { error: deleteError } = await supabase
          .from("stock_movements")
          .delete()
          .eq("stock_entry_id", editingEntry);
        if (deleteError) throw deleteError;
        const { error: lineError } = await supabase.from("stock_movements").insert(
          resolvedMovements.map((rm) => ({
            ...rm,
            stock_entry_id: editingEntry,
          })),
        );
        if (lineError) throw lineError;
        return;
      }

      const { data: entry, error: entryError } = await supabase
        .from("stock_entries")
        .insert({
          restock_date: restockDate,
          shipping_cost: Number(shippingCost || 0),
          payment_method: paymentMethod,
          created_by: u.user?.id,
        })
        .select("id")
        .single();
      if (entryError) throw entryError;

      const { error: lineError } = await supabase.from("stock_movements").insert(
        resolvedMovements.map((rm) => ({
          ...rm,
          stock_entry_id: entry.id,
        })),
      );
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
    onSuccess: () => {
      toast.success("Riwayat stok dihapus");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const edit = (entry: any) => {
    setEditingEntry(entry.id);
    setRestockDate(entry.restock_date);
    setShippingCost(String(entry.shipping_cost));
    setPaymentMethod((entry.payment_method as "cash" | "qris") ?? "cash");
    setLines(
      entry.stock_movements.map((movement: any) => ({
        product_name: (movement.products?.name ?? "").replace(/^\[GUDANG\]\s*/, ""),
        quantity: String(movement.quantity),
        initial_price: String(movement.initial_price),
      })),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );
  const totalCapital =
    lines.reduce(
      (total, line) => total + Number(line.quantity || 0) * Number(line.initial_price || 0),
      0,
    ) + Number(shippingCost || 0);

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PackagePlus className="h-4 w-4" /> {editingEntry ? "Edit Pengeluaran" : "Pengeluaran"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tanggal Restock</Label>
                <Input
                  type="date"
                  value={restockDate}
                  onChange={(event) => setRestockDate(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ongkir Total (Rp)</Label>
                <Input
                  type="number"
                  min="0"
                  value={shippingCost}
                  onChange={(event) => setShippingCost(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Metode Pembayaran</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={paymentMethod === "cash" ? "default" : "outline"}
                  onClick={() => setPaymentMethod("cash")}
                >
                  Cash
                </Button>
                <Button
                  type="button"
                  variant={paymentMethod === "qris" ? "default" : "outline"}
                  onClick={() => setPaymentMethod("qris")}
                >
                  QRIS
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Daftar Produk</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLines((current) => [...current, emptyLine()])}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Produk
                </Button>
              </div>
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_80px_110px_auto] gap-2 items-end"
                >
                  <div className="space-y-1">
                    <Label className="text-xs">Nama Belanjaan</Label>
                    <Input
                      value={line.product_name}
                      onChange={(event) => updateLine(index, { product_name: event.target.value })}
                      placeholder="Contoh: Ayam, Beras, Cup"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Jumlah</Label>
                    <Input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(event) => updateLine(index, { quantity: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Modal/pcs</Label>
                    <Input
                      type="number"
                      min="0"
                      value={line.initial_price}
                      onChange={(event) => updateLine(index, { initial_price: event.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Total Modal</Label>
              <div className="rounded-md bg-muted p-2 font-semibold">{rupiah(totalCapital)}</div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" type="submit" disabled={add.isPending}>
                Simpan Semua
              </Button>
              {editingEntry && (
                <Button type="button" variant="outline" onClick={reset}>
                  Batal
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> Riwayat Pengeluaran
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              placeholder="Ketik minimal 3 huruf untuk mencari riwayat (produk, tanggal, ongkir)"
            />
          </div>
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground">Belum ada riwayat.</p>
          )}
          {entries.length > 0 && filteredEntries.length === 0 && (
            <p className="text-sm text-muted-foreground">Tidak ada riwayat yang cocok.</p>
          )}
          {filteredEntries.map((entry: any) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card"
            >
              <div className="space-y-0.5">
                <div className="font-semibold text-sm sm:text-base text-foreground">
                  {entry.stock_movements
                    .map((m: any) => (m.products?.name ?? "").replace(/^\[GUDANG\]\s*/i, ""))
                    .filter(Boolean)
                    .join(", ")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(`${entry.restock_date}T00:00:00`).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {entry.stock_movements.length} produk ·{" "}
                  {entry.stock_movements.reduce(
                    (sum: number, movement: any) => sum + movement.quantity,
                    0,
                  )}{" "}
                  pcs
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="font-semibold text-sm sm:text-base text-foreground">
                  {rupiah(
                    Number(entry.shipping_cost ?? 0) +
                    entry.stock_movements.reduce(
                      (s: number, m: any) => s + Number(m.quantity ?? 0) * Number(m.initial_price ?? 0),
                      0
                    )
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setSelectedEntry(entry)}
                    aria-label="Lihat detail"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  {role === "admin" && (
                    <>
                      <Button size="icon" variant="ghost" onClick={() => edit(entry)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Hapus riwayat dan kurangi stok terkait?")) remove.mutate(entry.id);
                        }}
                        aria-label="Hapus"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Dialog
        open={!!selectedEntry}
        onOpenChange={(open) => {
          if (!open) setSelectedEntry(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detail Pengeluaran</DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tanggal restock</span>
                <span>
                  {new Date(`${selectedEntry.restock_date}T00:00:00`).toLocaleDateString("id-ID")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ongkir</span>
                <span>{rupiah(selectedEntry.shipping_cost)}</span>
              </div>
              <div className="border-t pt-2 space-y-2">
                {selectedEntry.stock_movements.map((movement: any) => (
                  <div key={movement.id} className="flex justify-between gap-4">
                    <div>
                      <div className="font-medium">
                        {(movement.products?.name ?? "—").replace(/^\[GUDANG\]\s*/, "")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {movement.quantity} × {rupiah(movement.initial_price)}
                      </div>
                    </div>
                    <span>{rupiah(movement.quantity * Number(movement.initial_price))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
