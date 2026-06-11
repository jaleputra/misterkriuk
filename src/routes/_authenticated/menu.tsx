import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rupiah } from "@/lib/format";
import { Pencil, Trash2, Plus, ImagePlus, Drumstick, X } from "lucide-react";
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
  const [form, setForm] = useState({ name: "", price: "", stock: "", image_url: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setEditing(null); setForm({ name: "", price: "", stock: "", image_url: "" }); };

  const handleFile = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) { toast.error("Ukuran maks 2MB"); return; }
    // resize via canvas to keep base64 small
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result as string; };
      reader.onerror = reject;
      img.onload = () => {
        const max = 500;
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      reader.readAsDataURL(file);
    });
    setForm((f) => ({ ...f, image_url: dataUrl }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        price: Number(form.price),
        stock: Number(form.stock),
        image_url: form.image_url || null,
      };
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
              <Label>Foto Produk</Label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="relative h-20 w-20 rounded-xl border-2 border-dashed grid place-items-center bg-muted/30 hover:bg-muted/50 overflow-hidden shrink-0"
                >
                  {form.image_url ? (
                    <img src={form.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  )}
                </button>
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span>JPG/PNG, maks 2MB</span>
                  {form.image_url && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 justify-start"
                      onClick={() => setForm({ ...form, image_url: "" })}>
                      <X className="h-3 w-3 mr-1" />Hapus foto
                    </Button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
              </div>
            </div>
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
          {products.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card hover:bg-accent/20 transition">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-12 w-12 rounded-lg overflow-hidden bg-muted shrink-0 grid place-items-center">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <Drumstick className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{rupiah(p.price)} · Stok {p.stock}</div>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(p.id); setForm({ name: p.name, price: String(p.price), stock: String(p.stock), image_url: p.image_url ?? "" }); }}>
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
