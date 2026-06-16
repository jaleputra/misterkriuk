import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Printer, Users, Store, CalendarDays, Trash2, Plus, ChevronDown, ChevronUp, Save } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { rupiah } from "@/lib/format";

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

  const [printerConnected, setPrinterConnected] = useState(false);
  const [printerBusy, setPrinterBusy] = useState(false);
  useEffect(() => {
    setPrinterConnected(isPrinterConnected());
    return subscribePrinter(() => setPrinterConnected(isPrinterConnected()));
  }, []);

  const handleConnectPrinter = async () => {
    if (!isBluetoothSupported()) { toast.error("Browser tidak mendukung Web Bluetooth"); return; }
    setPrinterBusy(true);
    try {
      const { name } = await connectPrinter();
      setForm((f) => ({ ...f, printer_name: name }));
      toast.success(`Terhubung: ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal terhubung");
    } finally {
      setPrinterBusy(false);
    }
  };
  const handleDisconnectPrinter = () => {
    disconnectPrinter();
    toast.info("Printer diputus");
  };
  const handleTestPrint = async () => {
    setPrinterBusy(true);
    try {
      await testPrint({
        shop_name: form.shop_name,
        shop_address: form.shop_address,
        shop_phone: form.shop_phone,
        paper_width: form.paper_width,
      });
      toast.success("Test print terkirim");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal test print");
    } finally {
      setPrinterBusy(false);
    }
  };

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

  // ===== Events =====
  const { data: events = [] } = useQuery({
    queryKey: ["events"],
    queryFn: async () => (await supabase.from("events").select("*").order("event_date", { ascending: false })).data ?? [],
  });

  const { data: productList = [] } = useQuery({
    queryKey: ["products_for_event"],
    queryFn: async () => (await supabase.from("products").select("id,name,price").order("name")).data ?? [],
  });

  const [evForm, setEvForm] = useState({
    name: "",
    event_date: new Date().toISOString().slice(0, 10),
    scope: "all" as "all" | "per_product",
    adjustment_type: "percent_discount" as "percent_discount" | "fixed_discount" | "set_price",
    adjustment_value: "",
  });
  const [perProductDrafts, setPerProductDrafts] = useState<Record<string, { enabled: boolean; type: string; value: string }>>({});

  const ensureDraft = (pid: string) =>
    perProductDrafts[pid] ?? { enabled: false, type: "percent_discount", value: "" };

  const addEvent = useMutation({
    mutationFn: async () => {
      if (!evForm.name.trim()) throw new Error("Nama event wajib diisi");

      if (evForm.scope === "all") {
        const val = Number(evForm.adjustment_value);
        if (Number.isNaN(val) || val < 0) throw new Error("Nilai diskon harus angka >= 0");
        const { error } = await supabase.from("events").insert({
          name: evForm.name.trim(),
          event_date: evForm.event_date,
          adjustment_type: evForm.adjustment_type,
          adjustment_value: val,
        });
        if (error) throw error;
        return;
      }

      // per_product: create event with no-op default, then upsert overrides
      const overrides = Object.entries(perProductDrafts)
        .filter(([, d]) => d.enabled)
        .map(([product_id, d]) => {
          const v = Number(d.value);
          if (Number.isNaN(v) || v < 0) throw new Error("Semua nilai produk harus angka >= 0");
          return { product_id, adjustment_type: d.type, adjustment_value: v };
        });
      if (overrides.length === 0) throw new Error("Pilih minimal satu produk untuk diberi harga khusus");

      const { data: ev, error: evErr } = await supabase.from("events").insert({
        name: evForm.name.trim(),
        event_date: evForm.event_date,
        adjustment_type: "fixed_discount",
        adjustment_value: 0,
      }).select("id").single();
      if (evErr) throw evErr;

      const { error: itErr } = await supabase.from("event_items").insert(
        overrides.map((o) => ({ ...o, event_id: ev.id })),
      );
      if (itErr) throw itErr;
    },
    onSuccess: () => {
      toast.success("Event ditambahkan");
      setEvForm({ ...evForm, name: "", adjustment_value: "" });
      setPerProductDrafts({});
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delEvent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Event dihapus"); qc.invalidateQueries({ queryKey: ["events"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const today = new Date().toISOString().slice(0, 10);
  const describe = (e: any) => {
    if (e.adjustment_type === "percent_discount") return `Diskon ${e.adjustment_value}%`;
    if (e.adjustment_type === "fixed_discount") return `Potongan ${rupiah(e.adjustment_value)}`;
    return `Harga jadi ${rupiah(e.adjustment_value)}`;
  };

  return (
    <Tabs defaultValue="store" className="space-y-4">
      <TabsList className="grid grid-cols-3 w-full max-w-md">
        <TabsTrigger value="store"><Store className="h-4 w-4 mr-2" />Umum</TabsTrigger>
        <TabsTrigger value="event"><CalendarDays className="h-4 w-4 mr-2" />Event</TabsTrigger>
        <TabsTrigger value="users"><Users className="h-4 w-4 mr-2" />Akun</TabsTrigger>
      </TabsList>

      <TabsContent value="store" className="space-y-4">
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
      </TabsContent>

      <TabsContent value="event" className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" />Tambah Event</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); addEvent.mutate(); }}>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Nama Event</Label>
                  <Input value={evForm.name} onChange={(e) => setEvForm({ ...evForm, name: e.target.value })} placeholder="Promo Hari Kemerdekaan" required />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Tanggal Berlaku</Label>
                  <Input type="date" value={evForm.event_date} onChange={(e) => setEvForm({ ...evForm, event_date: e.target.value })} required />
                </div>
              </div>

              {evForm.name.trim() && (
                <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                  <div className="space-y-2">
                    <Label>Berlaku Untuk</Label>
                    <RadioGroup
                      value={evForm.scope}
                      onValueChange={(v) => setEvForm({ ...evForm, scope: v as "all" | "per_product" })}
                      className="grid sm:grid-cols-2 gap-2"
                    >
                      <label className="flex items-start gap-2 p-3 rounded-md border bg-card cursor-pointer hover:bg-accent">
                        <RadioGroupItem value="all" className="mt-0.5" />
                        <div>
                          <div className="font-medium text-sm">Semua Produk</div>
                          <div className="text-xs text-muted-foreground">Diskon yang sama untuk semua produk.</div>
                        </div>
                      </label>
                      <label className="flex items-start gap-2 p-3 rounded-md border bg-card cursor-pointer hover:bg-accent">
                        <RadioGroupItem value="per_product" className="mt-0.5" />
                        <div>
                          <div className="font-medium text-sm">Per Produk</div>
                          <div className="text-xs text-muted-foreground">Pilih produk & atur harga/diskon masing-masing.</div>
                        </div>
                      </label>
                    </RadioGroup>
                  </div>

                  {evForm.scope === "all" ? (
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Jenis Penyesuaian</Label>
                        <Select value={evForm.adjustment_type} onValueChange={(v) => setEvForm({ ...evForm, adjustment_type: v as any })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percent_discount">Diskon Persen (%)</SelectItem>
                            <SelectItem value="fixed_discount">Potongan Nominal (Rp)</SelectItem>
                            <SelectItem value="set_price">Set Harga Tetap (Rp)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Nilai {evForm.adjustment_type === "percent_discount" ? "(%)" : "(Rp)"}</Label>
                        <Input type="number" min="0" value={evForm.adjustment_value} onChange={(e) => setEvForm({ ...evForm, adjustment_value: e.target.value })} required />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Centang produk yang ingin diubah harganya. Produk yang tidak dicentang tetap pada harga normal.
                      </p>
                      {productList.length === 0 && <p className="text-sm text-muted-foreground">Belum ada produk.</p>}
                      {productList.map((p: any) => {
                        const d = ensureDraft(p.id);
                        return (
                          <div
                            key={p.id}
                            className="grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_160px_140px] gap-2 items-center p-2 rounded-md bg-card border"
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-primary shrink-0"
                              checked={d.enabled}
                              onChange={(e) => setPerProductDrafts({ ...perProductDrafts, [p.id]: { ...d, enabled: e.target.checked } })}
                            />
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{p.name}</div>
                              <div className="text-xs text-muted-foreground">Normal: {rupiah(p.price)}</div>
                            </div>
                            <Select
                              value={d.type}
                              onValueChange={(v) => setPerProductDrafts({ ...perProductDrafts, [p.id]: { ...d, type: v } })}
                            >
                              <SelectTrigger className="h-9 text-xs col-span-2 sm:col-span-1" disabled={!d.enabled}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="percent_discount">Diskon %</SelectItem>
                                <SelectItem value="fixed_discount">Potongan Rp</SelectItem>
                                <SelectItem value="set_price">Harga Tetap</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              min="0"
                              placeholder={d.type === "percent_discount" ? "%" : "Rp"}
                              className="h-9 text-xs col-span-2 sm:col-span-1"
                              disabled={!d.enabled}
                              value={d.value}
                              onChange={(e) => setPerProductDrafts({ ...perProductDrafts, [p.id]: { ...d, value: e.target.value } })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <Button type="submit" disabled={addEvent.isPending}>Simpan Event</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Daftar Event ({events.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {events.length === 0 && <p className="text-sm text-muted-foreground">Belum ada event.</p>}
            {events.map((e: any) => (
              <EventRow key={e.id} ev={e} today={today} describe={describe} onDelete={() => { if (confirm(`Hapus event ${e.name}?`)) delEvent.mutate(e.id); }} />
            ))}
          </CardContent>
        </Card>
      </TabsContent>


      <TabsContent value="users">
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
      </TabsContent>
    </Tabs>
  );
}

function EventRow({ ev, today, describe, onDelete }: { ev: any; today: string; describe: (e: any) => string; onDelete: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["products_for_event"],
    queryFn: async () => (await supabase.from("products").select("id,name,price").order("name")).data ?? [],
  });
  const { data: items = [] } = useQuery({
    queryKey: ["event_items", ev.id],
    enabled: open,
    queryFn: async () => (await supabase.from("event_items").select("*").eq("event_id", ev.id)).data ?? [],
  });

  const [drafts, setDrafts] = useState<Record<string, { type: string; value: string; enabled: boolean }>>({});
  useEffect(() => {
    const d: Record<string, { type: string; value: string; enabled: boolean }> = {};
    products.forEach((p: any) => {
      const it = items.find((i: any) => i.product_id === p.id);
      d[p.id] = it
        ? { type: it.adjustment_type, value: String(it.adjustment_value), enabled: true }
        : { type: ev.adjustment_type, value: String(ev.adjustment_value), enabled: false };
    });
    setDrafts(d);
  }, [products, items, ev]);

  const saveItem = useMutation({
    mutationFn: async (productId: string) => {
      const d = drafts[productId];
      if (!d) return;
      if (!d.enabled) {
        const { error } = await supabase.from("event_items").delete().eq("event_id", ev.id).eq("product_id", productId);
        if (error) throw error;
        return;
      }
      const val = Number(d.value);
      if (Number.isNaN(val) || val < 0) throw new Error("Nilai harus angka >= 0");
      const { error } = await supabase.from("event_items").upsert({
        event_id: ev.id, product_id: productId, adjustment_type: d.type, adjustment_value: val,
      }, { onConflict: "event_id,product_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Disimpan"); qc.invalidateQueries({ queryKey: ["event_items", ev.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{ev.name}</span>
            {ev.event_date === today && <Badge className="bg-success text-success-foreground">Aktif Hari Ini</Badge>}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {new Date(ev.event_date).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · Default: {describe(ev)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp className="h-4 w-4 sm:mr-1" /> : <ChevronDown className="h-4 w-4 sm:mr-1" />}
            <span className="hidden sm:inline">Diskon per Produk</span>
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} aria-label="Hapus event">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
      {open && (
        <div className="border-t p-3 space-y-2 bg-muted/30">
          <p className="text-xs text-muted-foreground">
            Centang produk untuk memberi diskon/harga khusus yang berbeda dari default event. Produk yang tidak dicentang akan mengikuti default event.
          </p>
          {products.length === 0 && <p className="text-sm text-muted-foreground">Belum ada produk.</p>}
          {products.map((p: any) => {
            const d = drafts[p.id] ?? { type: ev.adjustment_type, value: "", enabled: false };
            return (
              <div
                key={p.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_140px_120px_auto] gap-2 items-center p-2 rounded-md bg-card border"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary shrink-0"
                  checked={d.enabled}
                  onChange={(e) => setDrafts({ ...drafts, [p.id]: { ...d, enabled: e.target.checked } })}
                />
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">Normal: {rupiah(p.price)}</div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="sm:hidden shrink-0"
                  onClick={() => saveItem.mutate(p.id)}
                  disabled={saveItem.isPending}
                  aria-label="Simpan"
                >
                  <Save className="h-3 w-3" />
                </Button>
                <Select
                  value={d.type}
                  onValueChange={(v) => setDrafts({ ...drafts, [p.id]: { ...d, type: v } })}
                >
                  <SelectTrigger className="h-8 text-xs col-span-2 sm:col-span-1" disabled={!d.enabled}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent_discount">Diskon %</SelectItem>
                    <SelectItem value="fixed_discount">Potongan Rp</SelectItem>
                    <SelectItem value="set_price">Harga Tetap</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  placeholder={d.type === "percent_discount" ? "%" : "Rp"}
                  className="h-8 text-xs col-span-2 sm:col-span-1"
                  disabled={!d.enabled}
                  value={d.value}
                  onChange={(e) => setDrafts({ ...drafts, [p.id]: { ...d, value: e.target.value } })}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="hidden sm:inline-flex shrink-0"
                  onClick={() => saveItem.mutate(p.id)}
                  disabled={saveItem.isPending}
                >
                  <Save className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
