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
import { PackagePlus, History } from "lucide-react";

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
  const { data: movements = [] } = useQuery({
    queryKey: ["stock_movements"],
    queryFn: async () => (await supabase
      .from("stock_movements")
      .select("*, products(name)")
      .order("created_at", { ascending: false })
      .limit(20)).data ?? [],
  });

  const [form, setForm] = useState({ product_id: "", quantity: "", initial_price: "", shipping_cost: "" });

  const add = useMutation({
    mutationFn: async () => {
      if (!form.product_id) throw new Error("Pilih produk");
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("stock_movements").insert({
        product_id: form.product_id,
        quantity: Number(form.quantity),
        initial_price: Number(form.initial_price || 0),
        shipping_cost: Number(form.shipping_cost || 0),
        created_by: u.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stok berhasil ditambahkan");
      setForm({ product_id: "", quantity: "", initial_price: "", shipping_cost: "" });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><PackagePlus className="h-4 w-4" /> Tambah Stok</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <div className="space-y-1.5">
              <Label>Produk</Label>
              <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} (stok: {p.stock})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Jumlah</Label>
              <Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Harga Awal / pcs (Rp)</Label>
              <Input type="number" min="0" value={form.initial_price} onChange={(e) => setForm({ ...form, initial_price: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Ongkir (Rp, opsional)</Label>
              <Input type="number" min="0" value={form.shipping_cost} onChange={(e) => setForm({ ...form, shipping_cost: e.target.value })} />
            </div>
            {form.quantity && form.initial_price && (
              <div className="text-xs text-muted-foreground p-2 rounded bg-muted">
                Total modal: <b className="text-foreground">{rupiah(Number(form.quantity) * Number(form.initial_price) + Number(form.shipping_cost || 0))}</b>
              </div>
            )}
            <Button className="w-full" type="submit" disabled={add.isPending}>Simpan</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Riwayat Stok Masuk</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {movements.length === 0 && <p className="text-sm text-muted-foreground">Belum ada riwayat.</p>}
          {movements.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div>
                <div className="font-medium">{m.products?.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(m.created_at).toLocaleString("id-ID")} · +{m.quantity} pcs
                </div>
              </div>
              <div className="text-right text-sm">
                <div>{rupiah(Number(m.initial_price) * m.quantity + Number(m.shipping_cost))}</div>
                {Number(m.shipping_cost) > 0 && <div className="text-xs text-muted-foreground">ongkir {rupiah(m.shipping_cost)}</div>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
