import { createFileRoute } from "@tanstack/react-router";
import { useAuth, refreshAuthRole } from "@/hooks/useAuth";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Printer, Users, Store, CalendarDays, Trash2, Plus, ChevronDown, ChevronUp, Save, QrCode, AlertTriangle, Info, CheckCircle2, Pencil } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import jsQR from "jsqr";
import { rupiah } from "@/lib/format";
import {
  connectPrinterClient,
  disconnectPrinterClient,
  getBluetoothDiagnosticClient,
  isBluetoothSupportedClient,
  isPrinterConnectedClient,
  subscribePrinterClient,
  testPrintClient,
} from "@/lib/thermal-printer.actions";
import { printReceiptPdfClient } from "@/lib/receipt-pdf.actions";

export const Route = createFileRoute("/_authenticated/settings")({
  ssr: false,
  component: SettingsPage,
});

function SettingsPage() {
  const { role, loading, user } = useAuth();
  const qc = useQueryClient();

  const isExplicitKasir = user?.email?.toLowerCase().trim() === "kasir@gmail.com" || user?.email?.toLowerCase().includes("kasir");
  const effectiveRole: "admin" | "cashier" = isExplicitKasir
    ? "cashier"
    : role || (user?.email?.toLowerCase().trim() === "jaleputra69@gmail.com" ? "admin" : "cashier");

  // Multi-branch storage in Supabase with local fallback
  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("branches").select("*").order("created_at", { ascending: true });
        if (error) {
          console.warn("Branches query fallback:", error);
          const localData = typeof window !== "undefined" ? localStorage.getItem("app_branches_data") : null;
          if (localData) {
            try { return JSON.parse(localData); } catch {}
          }
          return [];
        }
        if (typeof window !== "undefined" && data && data.length > 0) {
          localStorage.setItem("app_branches_data", JSON.stringify(data));
        }
        return data ?? [];
      } catch {
        const localData = typeof window !== "undefined" ? localStorage.getItem("app_branches_data") : null;
        if (localData) {
          try { return JSON.parse(localData); } catch {}
        }
        return [];
      }
    },
  });

  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [branchForm, setBranchForm] = useState({
    shop_name: "AMI Fried Chicken",
    branch_name: "",
    shop_address: "",
    shop_phone: "",
    whatsapp_number: "",
  });

  const clearBranchForm = () => {
    setBranchForm({
      shop_name: "AMI Fried Chicken",
      branch_name: "",
      shop_address: "",
      shop_phone: "",
      whatsapp_number: "",
    });
    setEditingBranchId(null);
  };

  const handleEditBranch = (b: any) => {
    if (effectiveRole !== "admin") {
      toast.error("Hanya admin yang dapat mengedit data cabang");
      return;
    }
    setBranchForm({
      shop_name: b.shop_name || "AMI Fried Chicken",
      branch_name: b.branch_name || "",
      shop_address: b.shop_address || "",
      shop_phone: b.shop_phone || "",
      whatsapp_number: b.whatsapp_number || "",
    });
    setEditingBranchId(b.id);
    toast.info(`Data ${b.branch_name} dimuat ke formulir untuk diedit`);
  };

  const saveBranch = useMutation({
    mutationFn: async () => {
      const sName = branchForm.shop_name.trim() || "AMI Fried Chicken";
      const bName = branchForm.branch_name.trim();
      const sAddress = branchForm.shop_address.trim() || null;
      const sPhone = branchForm.shop_phone.trim() || null;
      const sWa = branchForm.whatsapp_number.trim() || null;

      if (!bName) {
        throw new Error("Nama cabang wajib diisi!");
      }

      if (editingBranchId) {
        try {
          await supabase.from("branches").update({
            shop_name: sName,
            branch_name: bName,
            shop_address: sAddress,
            shop_phone: sPhone,
            whatsapp_number: sWa,
            updated_at: new Date().toISOString(),
          }).eq("id", editingBranchId);
        } catch (err) {
          console.warn("Supabase update branches fallback:", err);
        }

        const curList: any[] = JSON.parse(localStorage.getItem("app_branches_data") || "[]");
        const nextList = curList.map((item) =>
          item.id === editingBranchId
            ? { ...item, shop_name: sName, branch_name: bName, shop_address: sAddress, shop_phone: sPhone, whatsapp_number: sWa, updated_at: new Date().toISOString() }
            : item
        );
        localStorage.setItem("app_branches_data", JSON.stringify(nextList));
      } else {
        const newBranchId = crypto.randomUUID();
        const newBranchRecord = {
          id: newBranchId,
          shop_name: sName,
          branch_name: bName,
          shop_address: sAddress,
          shop_phone: sPhone,
          whatsapp_number: sWa,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        try {
          await supabase.from("branches").insert({
            id: newBranchId,
            shop_name: sName,
            branch_name: bName,
            shop_address: sAddress,
            shop_phone: sPhone,
            whatsapp_number: sWa,
          });
        } catch (err) {
          console.warn("Supabase insert branches fallback:", err);
        }

        const curList: any[] = JSON.parse(localStorage.getItem("app_branches_data") || "[]");
        curList.push(newBranchRecord);
        localStorage.setItem("app_branches_data", JSON.stringify(curList));
      }
    },
    onSuccess: () => {
      toast.success(editingBranchId ? "Informasi cabang berhasil diperbarui" : "Cabang baru berhasil disimpan");
      clearBranchForm();
      qc.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteBranch = useMutation({
    mutationFn: async (id: string) => {
      if (effectiveRole !== "admin") throw new Error("Hanya admin yang dapat menghapus cabang");
      try {
        await supabase.from("branches").delete().eq("id", id);
      } catch (err) {
        console.warn("Supabase delete branches fallback:", err);
      }

      const curList: any[] = JSON.parse(localStorage.getItem("app_branches_data") || "[]");
      const nextList = curList.filter((b) => b.id !== id);
      localStorage.setItem("app_branches_data", JSON.stringify(nextList));
    },
    onSuccess: () => {
      toast.success("Cabang berhasil dihapus");
      qc.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Printer & QRIS settings
  const { data: settings } = useQuery({
    queryKey: ["printer_settings"],
    queryFn: async () => (await supabase.from("printer_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  const [form, setForm] = useState({
    printer_name: "", 
    paper_width: 58,
    qris_payload: "",
    qris_image_url: "",
  });

  useEffect(() => {
    if (settings) {
      const localQrisPayload = localStorage.getItem("qris_payload") || "";
      const localQrisImageUrl = localStorage.getItem("qris_image_url") || "";
      setForm({
        printer_name: settings.printer_name ?? "",
        paper_width: settings.paper_width ?? 58,
        qris_payload: (settings as any).qris_payload ?? localQrisPayload,
        qris_image_url: (settings as any).qris_image_url ?? localQrisImageUrl,
      });
    }
  }, [settings]);

  const savePrinter = useMutation({
    mutationFn: async () => {
      try {
        const { error } = await supabase.from("printer_settings").upsert({
          id: 1,
          printer_name: form.printer_name,
          paper_width: form.paper_width,
          qris_payload: form.qris_payload || null,
          qris_image_url: form.qris_image_url || null,
          updated_at: new Date().toISOString(),
        } as any);
        if (error) throw error;
      } catch (err) {
        console.warn("Gagal simpan printer settings:", err);
      }
      localStorage.setItem("qris_payload", form.qris_payload || "");
      localStorage.setItem("qris_image_url", form.qris_image_url || "");
    },
    onSuccess: () => {
      toast.success("Pengaturan printer & QRIS disimpan");
      qc.invalidateQueries({ queryKey: ["printer_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleQrisImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        
        try {
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) {
            setForm((f) => ({
              ...f,
              qris_payload: code.data,
              qris_image_url: canvas.toDataURL("image/jpeg", 0.85),
            }));
            toast.success("QRIS berhasil didekode otomatis!");
          } else {
            setForm((f) => ({
              ...f,
              qris_image_url: canvas.toDataURL("image/jpeg", 0.85),
            }));
            toast.warning("QR Code tidak terbaca otomatis. Gambar disimpan, silakan isi Teks Payload QRIS manual jika ingin nominal dinamis.");
          }
        } catch (err) {
          console.error("Gagal membaca QR Code", err);
          setForm((f) => ({
            ...f,
            qris_image_url: canvas.toDataURL("image/jpeg", 0.85),
          }));
          toast.warning("Gagal memproses QR Code secara otomatis. Gambar berhasil disimpan.");
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const [printerConnected, setPrinterConnected] = useState(false);
  const [printerBusy, setPrinterBusy] = useState(false);
  const [btDiag, setBtDiag] = useState<{ supported: boolean; message: string }>({
    supported: true,
    message: "",
  });

  useEffect(() => {
    const diag = getBluetoothDiagnosticClient();
    setBtDiag(diag);
    setPrinterConnected(isPrinterConnectedClient());
    return subscribePrinterClient(() => setPrinterConnected(isPrinterConnectedClient()));
  }, []);

  const handleConnectPrinter = async () => {
    const diag = getBluetoothDiagnosticClient();
    if (!diag.supported) {
      toast.error(diag.message);
      return;
    }
    setPrinterBusy(true);
    try {
      const { name } = await connectPrinterClient();
      setForm((f) => ({ ...f, printer_name: name }));
      toast.success(`Terhubung: ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal terhubung ke printer");
    } finally {
      setPrinterBusy(false);
    }
  };
  const handleDisconnectPrinter = () => {
    disconnectPrinterClient();
    toast.info("Printer diputus");
  };
  const handleTestPrint = async () => {
    setPrinterBusy(true);
    try {
      const activeBranch = branches[0];
      await testPrintClient({
        shop_name: activeBranch?.shop_name || "AMI Fried Chicken",
        shop_address: activeBranch?.shop_address || "",
        shop_phone: activeBranch?.shop_phone || "",
        paper_width: form.paper_width,
      });
      toast.success("Test print terkirim ke printer Bluetooth");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal test print");
    } finally {
      setPrinterBusy(false);
    }
  };

  const handleTestPrintSystem = () => {
    try {
      const activeBranch = branches[0];
      const sampleTx = {
        id: "TEST-" + Math.floor(1000 + Math.random() * 9000),
        created_at: new Date().toISOString(),
        total: 35000,
        discount_amount: 0,
        payment_method: "cash",
        cash_received: 50000,
        change_amount: 15000,
        buyer_name: "Pelanggan Test",
        house_block: "A1",
        items: [
          { product_name: "Paket Ayam Geprek", price: 15000, quantity: 2, subtotal: 30000 },
          { product_name: "Es Teh Manis", price: 5000, quantity: 1, subtotal: 5000 },
        ],
      };
      printReceiptPdfClient(sampleTx as any, {
        shop_name: activeBranch?.shop_name || "AMI Fried Chicken",
        branch_name: activeBranch?.branch_name || "Cabang Utama",
        shop_address: activeBranch?.shop_address || "",
        shop_phone: activeBranch?.shop_phone || "",
        paper_width: form.paper_width,
      });
      toast.success("Membuka dialog cetak struk sistem...");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuka cetak sistem");
    }
  };

  const [customBranchDialog, setCustomBranchDialog] = useState<{
    open: boolean;
    userId: string;
    role: "admin" | "cashier";
    branchName: string;
  }>({
    open: false,
    userId: "",
    role: "cashier",
    branchName: "",
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles_roles"],
    queryFn: async () => {
      const [{ data: ps }, { data: rs }] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at"),
        supabase.from("user_roles").select("*"),
      ]);
      return (ps ?? []).map((p: any) => {
        const userRole = rs?.find((r: any) => r.user_id === p.id);
        const isKasirP = p.email?.toLowerCase().trim() === "kasir@gmail.com" || p.email?.toLowerCase().includes("kasir");
        const defaultRole = p.email === "jaleputra69@gmail.com" ? "admin" : "cashier";
        return {
          ...p,
          role: (isKasirP ? "cashier" : (userRole?.role ?? defaultRole)) as "admin" | "cashier",
          branch_name: (userRole?.branch_name ?? "") as string,
        };
      });
    },
  });

  const availableBranches = useMemo(() => {
    const list = new Set<string>();
    branches.forEach((b: any) => {
      if (b.branch_name?.trim()) list.add(b.branch_name.trim());
    });
    profiles.forEach((p: any) => {
      if (p.branch_name?.trim()) list.add(p.branch_name.trim());
    });
    return Array.from(list);
  }, [branches, profiles]);

  const setRole = useMutation({
    mutationFn: async ({
      userId,
      role,
      branch_name,
    }: {
      userId: string;
      role: "admin" | "cashier";
      branch_name?: string | null;
    }) => {
      const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (delErr) console.warn("Delete old user_roles warning:", delErr);

      const { error } = await supabase.from("user_roles").insert({
        user_id: userId,
        role,
        branch_name: branch_name || null,
      } as any);
      if (error) {
        // Fallback if branch_name column is not created on remote yet
        const { error: fallbackError } = await supabase.from("user_roles").insert({
          user_id: userId,
          role,
        } as any);
        if (fallbackError) throw fallbackError;
      }

      if (typeof window !== "undefined") {
        localStorage.setItem(`app_user_role_${userId}`, role);
        if (branch_name) localStorage.setItem(`app_user_branch_${userId}`, branch_name);
      }
    },
    onSuccess: () => {
      toast.success("Peran & cabang akun berhasil diperbarui");
      qc.invalidateQueries({ queryKey: ["profiles_roles"] });
      qc.invalidateQueries({ queryKey: ["user_roles_branch_map"] });
      refreshAuthRole();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ===== Events =====
  const { data: events = [] } = useQuery({
    queryKey: ["events"],
    queryFn: async () => (await supabase.from("events").select("*").order("event_date", { ascending: false })).data ?? [],
  });

  const { data: productList = [] } = useQuery({
    queryKey: ["products_for_event"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id,name,price,category").order("name");
      return (
        data?.filter(
          (p: any) =>
            !p.category?.startsWith("deleted_") && !p.name?.toUpperCase().startsWith("[GUDANG] ")
        ) ?? []
      );
    },
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
        Memuat pengaturan...
      </div>
    );
  }

  if (effectiveRole === "cashier") {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Printer className="h-4 w-4" /> Printer Thermal
              </CardTitle>
              {btDiag.supported ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Web Bluetooth Aktif
                </span>
              ) : (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Bluetooth Tidak Didukung
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!btDiag.supported && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 p-3.5 text-xs text-amber-900 dark:text-amber-300 space-y-1.5">
                <div className="font-semibold flex items-center gap-1.5 text-amber-800 dark:text-amber-400">
                  <Info className="h-4 w-4 shrink-0" />
                  Info Kompatibilitas Browser
                </div>
                <p className="leading-relaxed">
                  {btDiag.message || "Browser ini tidak mendukung Web Bluetooth."}
                </p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                  💡 <strong>Solusi:</strong> Gunakan <strong>Google Chrome</strong> atau <strong>Microsoft Edge</strong> di Laptop/PC/Android. Anda juga tetap bisa mencetak struk menggunakan opsi <strong>Cetak Struk Sistem (PDF)</strong>.
                </p>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nama Printer</Label>
                <Input value={form.printer_name} disabled placeholder="Belum terhubung" />
              </div>
              <div className="space-y-1.5">
                <Label>Lebar Kertas</Label>
                <Select value={String(form.paper_width)} disabled>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58">58 mm</SelectItem>
                    <SelectItem value="80">80 mm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {printerConnected ? (
                <Button variant="destructive" onClick={handleDisconnectPrinter} disabled={printerBusy}>
                  Putuskan Printer
                </Button>
              ) : (
                <Button variant="outline" onClick={handleConnectPrinter} disabled={printerBusy}>
                  Sambungkan Printer Bluetooth
                </Button>
              )}
              <Button variant="secondary" onClick={handleTestPrint} disabled={!printerConnected || printerBusy}>
                Test Bluetooth (ESC/POS)
              </Button>
              <Button variant="outline" onClick={handleTestPrintSystem}>
                Test Cetak Sistem (PDF)
              </Button>
              <span className={`text-xs px-2.5 py-1 rounded-md font-medium ${printerConnected ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                {printerConnected ? "Terhubung" : "Tidak terhubung"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Aktifkan Bluetooth di perangkat Anda dan printer, lalu klik "Sambungkan Printer Bluetooth". Saat transaksi kasir, struk akan otomatis langsung dicetak ke printer ini.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Tabs defaultValue="store" className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="store"><Store className="h-4 w-4 mr-2" />Umum</TabsTrigger>
          <TabsTrigger value="event"><CalendarDays className="h-4 w-4 mr-2" />Event</TabsTrigger>
          <TabsTrigger value="users"><Users className="h-4 w-4 mr-2" />Akun</TabsTrigger>
        </TabsList>

      <TabsContent value="store" className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Store className="h-4 w-4" /> {editingBranchId ? "Edit Informasi Cabang" : "Tambah Cabang Toko Baru"}
              </CardTitle>
              {editingBranchId && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 text-[11px] font-medium">
                  Mode Edit Cabang
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label>Nama Toko</Label>
                <Input 
                  placeholder="Contoh: AMI Fried Chicken" 
                  value={branchForm.shop_name} 
                  onChange={(e) => setBranchForm({ ...branchForm, shop_name: e.target.value })} 
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nama Cabang <span className="text-destructive">*</span></Label>
                <Input 
                  placeholder="Contoh: Cabang Utama / Cabang Boulevard / Aneen" 
                  value={branchForm.branch_name} 
                  onChange={(e) => setBranchForm({ ...branchForm, branch_name: e.target.value })} 
                />
              </div>
              <div className="space-y-1.5">
                <Label>Telepon</Label>
                <Input 
                  placeholder="08xxxxxxxxxx" 
                  value={branchForm.shop_phone} 
                  onChange={(e) => setBranchForm({ ...branchForm, shop_phone: e.target.value })} 
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nomor WhatsApp (untuk struk)</Label>
                <Input 
                  placeholder="6281234567890" 
                  value={branchForm.whatsapp_number} 
                  onChange={(e) => setBranchForm({ ...branchForm, whatsapp_number: e.target.value })} 
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Alamat Lengkap Cabang</Label>
                <Input 
                  placeholder="Alamat outlet / ruko / booth cabang ini" 
                  value={branchForm.shop_address} 
                  onChange={(e) => setBranchForm({ ...branchForm, shop_address: e.target.value })} 
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {editingBranchId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearBranchForm}
                  disabled={saveBranch.isPending}
                >
                  Batal
                </Button>
              )}
              <Button
                onClick={() => saveBranch.mutate()}
                disabled={saveBranch.isPending}
                className="flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                <span>{saveBranch.isPending ? "Menyimpan…" : editingBranchId ? "Perbarui Cabang" : "Simpan Cabang Baru"}</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabel Data Toko & Cabang Tersimpan */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Store className="h-4 w-4" /> Daftar Cabang Tersimpan ({branches.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Semua cabang tersimpan permanen di database backend Supabase.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-border/80 overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-semibold">Nama Toko</TableHead>
                    <TableHead className="font-semibold">Nama Cabang</TableHead>
                    <TableHead className="font-semibold">Telepon</TableHead>
                    <TableHead className="font-semibold">No. WhatsApp</TableHead>
                    <TableHead className="font-semibold">Alamat</TableHead>
                    {role === "admin" && (
                      <TableHead className="font-semibold text-right w-32">Aksi</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.length > 0 ? (
                    branches.map((b: any) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-semibold">
                          {b.shop_name || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-medium bg-primary/5 text-primary border-primary/20">
                            {b.branch_name}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {b.shop_phone || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          {b.whatsapp_number || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="max-w-xs break-words">
                          {b.shop_address || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        {role === "admin" && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-2.5 text-xs flex items-center gap-1 hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                                onClick={() => handleEditBranch(b)}
                                title="Edit Data Cabang"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Edit</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-2.5 text-xs flex items-center gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                                onClick={() => {
                                  if (confirm(`Apakah Anda yakin ingin menghapus cabang "${b.branch_name}"?`)) {
                                    deleteBranch.mutate(b.id);
                                  }
                                }}
                                disabled={deleteBranch.isPending}
                                title="Hapus Data Cabang"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Hapus</span>
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={role === "admin" ? 6 : 5} className="text-center py-6 text-muted-foreground text-sm">
                        Belum ada data cabang yang tersimpan di database. Silakan isi formulir di atas dan klik Simpan Cabang Baru.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Printer className="h-4 w-4" /> Printer Thermal
              </CardTitle>
              {btDiag.supported ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Web Bluetooth Aktif
                </span>
              ) : (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Bluetooth Tidak Didukung
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!btDiag.supported && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 p-3.5 text-xs text-amber-900 dark:text-amber-300 space-y-1.5">
                <div className="font-semibold flex items-center gap-1.5 text-amber-800 dark:text-amber-400">
                  <Info className="h-4 w-4 shrink-0" />
                  Info Kompatibilitas Browser
                </div>
                <p className="leading-relaxed">
                  {btDiag.message || "Browser ini tidak mendukung Web Bluetooth."}
                </p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                  💡 <strong>Solusi:</strong> Gunakan <strong>Google Chrome</strong> atau <strong>Microsoft Edge</strong> di Laptop/PC/Android. Anda juga tetap bisa mencetak struk menggunakan opsi <strong>Cetak Struk Sistem (PDF)</strong>.
                </p>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nama Printer</Label>
                <Input value={form.printer_name} onChange={(e) => setForm({ ...form, printer_name: e.target.value })} placeholder="Belum terhubung" />
              </div>
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
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {printerConnected ? (
                <Button variant="destructive" onClick={handleDisconnectPrinter} disabled={printerBusy}>
                  Putuskan Printer
                </Button>
              ) : (
                <Button variant="outline" onClick={handleConnectPrinter} disabled={printerBusy}>
                  Sambungkan Printer Bluetooth
                </Button>
              )}
              <Button variant="secondary" onClick={handleTestPrint} disabled={!printerConnected || printerBusy}>
                Test Bluetooth (ESC/POS)
              </Button>
              <Button variant="outline" onClick={handleTestPrintSystem}>
                Test Cetak Sistem (PDF)
              </Button>
              <span className={`text-xs px-2.5 py-1 rounded-md font-medium ${printerConnected ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                {printerConnected ? "Terhubung" : "Tidak terhubung"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Aktifkan Bluetooth lalu sambungkan printer thermal. Saat checkout, tombol "Cetak" akan langsung mengirim struk ke printer.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <QrCode className="h-4 w-4" /> Pengaturan QRIS Pembayaran
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Upload Gambar QRIS (JPG / PNG)</Label>
              <Input 
                type="file" 
                accept="image/*" 
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleQrisImageUpload(f);
                }} 
              />
              <p className="text-[11px] text-muted-foreground">
                Sistem akan membaca payload QRIS secara otomatis dari gambar yang Anda unggah.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Teks Payload QRIS (Dihasilkan Otomatis / Input Manual)</Label>
                <Input 
                  value={form.qris_payload} 
                  onChange={(e) => setForm({ ...form, qris_payload: e.target.value })} 
                  placeholder="000201010211..." 
                />
              </div>
            </div>

            {form.qris_image_url && (
              <div className="pt-2 flex flex-col items-center sm:items-start gap-2">
                <Label className="text-xs">Preview QRIS Terunggah:</Label>
                <img 
                  src={form.qris_image_url} 
                  alt="QRIS Preview" 
                  className="max-w-[150px] aspect-square object-contain border rounded p-1 bg-white" 
                />
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm" 
                  className="text-destructive h-8 text-xs px-2"
                  onClick={() => setForm({ ...form, qris_image_url: "", qris_payload: "" })}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Hapus QRIS
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={() => savePrinter.mutate()} disabled={savePrinter.isPending}>
            Simpan Pengaturan Printer & QRIS
          </Button>
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
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> Akun & Penugasan Cabang
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Tentukan peran (Admin/Kasir) dan cabang penugasan untuk setiap akun kasir.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {profiles.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">Belum ada akun terdaftar.</p>
            )}
            {profiles.map((p: any) => (
              <div
                key={p.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-3.5 rounded-xl border border-border/80 bg-card hover:bg-muted/25 transition-colors shadow-2xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate flex items-center gap-2 flex-wrap">
                    <span>{p.name || p.email}</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider ${
                        p.role === "cashier"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                          : "bg-primary/10 text-primary border border-primary/20"
                      }`}
                    >
                      <span>{p.role}</span>
                      <span className="opacity-40">•</span>
                      <span>{p.branch_name || "Semua Cabang (Pusat)"}</span>
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{p.email}</div>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap shrink-0">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Peran</span>
                    <Select
                      value={p.role}
                      onValueChange={(newRole) =>
                        setRole.mutate({
                          userId: p.id,
                          role: newRole as "admin" | "cashier",
                          branch_name: p.branch_name || null,
                        })
                      }
                    >
                      <SelectTrigger className="w-28 h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="cashier">Kasir</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cabang</span>
                    <Select
                      value={p.branch_name || "__all__"}
                      onValueChange={(val) => {
                        if (val === "__custom__") {
                          setCustomBranchDialog({
                            open: true,
                            userId: p.id,
                            role: p.role,
                            branchName: "",
                          });
                        } else if (val === "__all__") {
                          setRole.mutate({
                            userId: p.id,
                            role: p.role,
                            branch_name: null,
                          });
                        } else {
                          setRole.mutate({
                            userId: p.id,
                            role: p.role,
                            branch_name: val,
                          });
                        }
                      }}
                    >
                      <SelectTrigger className="w-40 sm:w-44 h-9 text-xs">
                        <SelectValue placeholder="Pilih Cabang" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Semua Cabang (Pusat)</SelectItem>
                        {availableBranches.map((b: string) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom__" className="text-primary font-medium">
                          + Tambah Cabang Lain...
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>

    <Dialog
      open={customBranchDialog.open}
      onOpenChange={(o: boolean) => setCustomBranchDialog((prev) => ({ ...prev, open: o }))}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Tentukan Nama Cabang Baru</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Nama Cabang</Label>
            <Input
              placeholder="Contoh: Cabang Boulevard / Aneen 2"
              value={customBranchDialog.branchName}
              onChange={(e) =>
                setCustomBranchDialog((prev) => ({ ...prev, branchName: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const bName = customBranchDialog.branchName.trim();
                  if (!bName) {
                    toast.error("Nama cabang tidak boleh kosong");
                    return;
                  }
                  setRole.mutate({
                    userId: customBranchDialog.userId,
                    role: customBranchDialog.role,
                    branch_name: bName,
                  });
                  setCustomBranchDialog({ open: false, userId: "", role: "cashier", branchName: "" });
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setCustomBranchDialog((prev) => ({ ...prev, open: false }))}
          >
            Batal
          </Button>
          <Button
            onClick={() => {
              const bName = customBranchDialog.branchName.trim();
              if (!bName) {
                toast.error("Nama cabang tidak boleh kosong");
                return;
              }
              setRole.mutate({
                userId: customBranchDialog.userId,
                role: customBranchDialog.role,
                branch_name: bName,
              });
              setCustomBranchDialog({ open: false, userId: "", role: "cashier", branchName: "" });
            }}
          >
            Simpan Cabang
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function EventRow({ ev, today, describe, onDelete }: { ev: any; today: string; describe: (e: any) => string; onDelete: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["products_for_event"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id,name,price,category").order("name");
      return (
        data?.filter(
          (p: any) =>
            !p.category?.startsWith("deleted_") && !p.name?.toUpperCase().startsWith("[GUDANG] ")
        ) ?? []
      );
    },
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
