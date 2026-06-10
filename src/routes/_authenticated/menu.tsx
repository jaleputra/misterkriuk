import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rupiah } from "@/lib/format";
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/menu")({
  ssr: false,
  component: MenuPage,
});

function MenuPage() {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });

  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", price: "", stock: "" });

  const reset = () => { setEditing(null); setForm({ name: "", price: "", stock: "" }); };

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name.trim(), price: Number(form.price), stock: Number(form.stock) };
      if (!payload.name) throw new Error("Nama wajib diisi");
      if (editing) {
        const { error } = await supabase.from("products").update(payload).eq("id", editing);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Produk diperbarui" : "Produk ditambahkan");
      reset();
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Produk dihapus"); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2 lg:sticky lg:top-20 self-start">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" />{editing ? "Edit Produk" : "Tambah Produk"}</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="space-y-1.5">
              <Label>Nama Produk</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ayam Krispi Original" required />
            </div>
            <div className="space-y-1.5">
              <Label>Harga Jual (Rp)</Label>
              <Input type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Stok</Label>
              <Input type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} required />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={save.isPending}>Simpan</Button>
              {editing && <Button type="button" variant="outline" onClick={reset}>Batal</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader><CardTitle className="text-base">Daftar Menu ({products.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {products.length === 0 && <p className="text-sm text-muted-foreground">Belum ada produk.</p>}
          {products.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card hover:bg-accent/20 transition">
              <div className="min-w-0">
                <div className="font-semibold truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground">{rupiah(p.price)} · Stok {p.stock}</div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(p.id); setForm({ name: p.name, price: String(p.price), stock: String(p.stock) }); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Hapus ${p.name}?`)) del.mutate(p.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
