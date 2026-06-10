import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { Printer, Users, Store } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  ssr: false,
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["printer_settings"],
    queryFn: async () => (await supabase.from("printer_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  const [form, setForm] = useState({
    shop_name: "", shop_address: "", shop_phone: "", whatsapp_number: "", printer_name: "", paper_width: 58,
  });
  useEffect(() => {
    if (settings) setForm({
      shop_name: settings.shop_name ?? "",
      shop_address: settings.shop_address ?? "",
      shop_phone: settings.shop_phone ?? "",
      whatsapp_number: settings.whatsapp_number ?? "",
      printer_name: settings.printer_name ?? "",
      paper_width: settings.paper_width ?? 58,
    });
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("printer_settings")
        .update({ ...form, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Pengaturan disimpan"); qc.invalidateQueries({ queryKey: ["printer_settings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const connectPrinter = async () => {
    const nav = navigator as any;
    if (!nav.bluetooth) { toast.error("Browser tidak mendukung Web Bluetooth"); return; }
    try {
      const device = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ["000018f0-0000-1000-8000-00805f9b34fb"] });
      setForm({ ...form, printer_name: device.name ?? "Thermal Printer" });
      toast.success(`Terhubung: ${device.name ?? "Printer"}`);
    } catch (e: any) {
      toast.error(e.message ?? "Gagal terhubung");
    }
  };

  // Users & roles
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles_roles"],
    queryFn: async () => {
      const [{ data: ps }, { data: rs }] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at"),
        supabase.from("user_roles").select("*"),
      ]);
      return (ps ?? []).map((p: any) => ({
        ...p, role: rs?.find((r: any) => r.user_id === p.id)?.role ?? "cashier",
      }));
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "admin" | "cashier" }) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Peran diperbarui"); qc.invalidateQueries({ queryKey: ["profiles_roles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Store className="h-4 w-4" /> Informasi Toko</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Nama Toko</Label><Input value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Telepon</Label><Input value={form.shop_phone} onChange={(e) => setForm({ ...form, shop_phone: e.target.value })} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Alamat</Label><Input value={form.shop_address} onChange={(e) => setForm({ ...form, shop_address: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Nomor WhatsApp (untuk struk)</Label><Input placeholder="6281234567890" value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Printer className="h-4 w-4" /> Printer Thermal</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Nama Printer</Label><Input value={form.printer_name} onChange={(e) => setForm({ ...form, printer_name: e.target.value })} placeholder="Belum terhubung" /></div>
            <div className="space-y-1.5">
              <Label>Lebar Kertas</Label>
              <Select value={String(form.paper_width)} onValueChange={(v) => setForm({ ...form, paper_width: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="58">58 mm</SelectItem>
                  <SelectItem value="80">80 mm</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="outline" onClick={connectPrinter}>Sambungkan Printer Bluetooth</Button>
          <p className="text-xs text-muted-foreground">Untuk mencetak struk, gunakan tombol "Cetak" di akhir transaksi. Browser akan membuka jendela cetak.</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Simpan Pengaturan</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Akun & Peran</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {profiles.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
              <div className="min-w-0">
                <div className="font-medium truncate">{p.name ?? p.email}</div>
                <div className="text-xs text-muted-foreground truncate">{p.email}</div>
              </div>
              <Select value={p.role} onValueChange={(v) => setRole.mutate({ userId: p.id, role: v as any })}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="cashier">Kasir</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
