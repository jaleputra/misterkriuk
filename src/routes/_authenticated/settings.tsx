import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth, refreshAuthRole, inferBranchFromEmail } from "@/hooks/useAuth";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AttendanceLocationPickerMap } from "@/components/AttendanceLocationPickerMap";
import { cleanReceiptAddress } from "@/lib/format";
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
import {
  Printer,
  Users,
  Store,
  CalendarDays,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  Save,
  QrCode,
  AlertTriangle,
  Info,
  CheckCircle2,
  Pencil,
  MapPin,
  Navigation,
  Search,
  ShieldCheck,
  RefreshCw,
  Clock,
  Compass,
  Coffee,
  LogOut,
  Play,
  Timer,
  Check,
  CheckCheck,
} from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import jsQR from "jsqr";
import { rupiah } from "@/lib/format";
import {
  getBranchLocations,
  getBranchLocation,
  saveBranchLocation,
  isCashierWithinBranchRadius,
  loadBranchLocationsFromSupabase,
  getAttendanceRecords,
  clearAttendanceRecords,
  getTodayDateString,
  recordClockOut,
  startBreak,
  endBreak,
  getActiveBreak,
  hasCashierClockedOutToday,
  getTotalBreakMinutes,
  getTodayAttendance,
  syncTodayAttendanceFromCloud,
  loadAllAttendancesFromCloud,
  type AttendanceRecord,
  type AttendanceBreak,
  type BranchLocationConfig,
  calculateDistanceMeters,
} from "@/lib/attendance";
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
  const navigate = useNavigate();
  const { role, loading, user, branchName } = useAuth();
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
    const cleanAddr = cleanReceiptAddress(b.shop_address) || b.shop_address || "";
    setBranchForm({
      shop_name: b.shop_name || "AMI Fried Chicken",
      branch_name: b.branch_name || "",
      shop_address: cleanAddr.startsWith("{") ? "" : cleanAddr,
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
        let finalShopAddress = sAddress;
        try {
          const { data: curDb } = await supabase.from("branches").select("shop_address").eq("id", editingBranchId).limit(1);
          if (curDb && curDb[0]?.shop_address && curDb[0].shop_address.includes('"lat"')) {
            try {
              const geoObj = JSON.parse(curDb[0].shop_address);
              geoObj.addr = sAddress || geoObj.addr;
              finalShopAddress = JSON.stringify(geoObj);
            } catch {}
          }
        } catch {}

        try {
          await supabase.from("branches").update({
            shop_name: sName,
            branch_name: bName,
            shop_address: finalShopAddress,
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
            ? { ...item, shop_name: sName, branch_name: bName, shop_address: finalShopAddress, shop_phone: sPhone, whatsapp_number: sWa, updated_at: new Date().toISOString() }
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
        shop_address: cleanReceiptAddress(activeBranch?.shop_address),
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
        shop_address: cleanReceiptAddress(activeBranch?.shop_address),
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

  // ===== Pengaturan Absen & Map Titik Cabang =====
  const [selectedAttBranch, setSelectedAttBranch] = useState<string>("Cabang 1");
  const [attMapForm, setAttMapForm] = useState<BranchLocationConfig>(() => getBranchLocation("Cabang 1"));
  const [attGpsLoading, setAttGpsLoading] = useState(false);
  const [attRecords, setAttRecords] = useState<AttendanceRecord[]>(() => getAttendanceRecords());
  const [historySearch, setHistorySearch] = useState("");
  const [historyDateFilter, setHistoryDateFilter] = useState<"all" | "today" | "7" | "30">("all");
  const [historyBranchFilter, setHistoryBranchFilter] = useState<string>("all");

  // ===== State Absensi Kasir (Absen Pulang & Istirahat) =====
  const [todayCashierAtt, setTodayCashierAtt] = useState<AttendanceRecord | null>(() =>
    getTodayAttendance(user?.id, user?.email)
  );
  const [cashierCoords, setCashierCoords] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [cashierGeoLoading, setCashierGeoLoading] = useState(false);
  const [cashierGeoError, setCashierGeoError] = useState<string | null>(null);
  const [clockOutLoading, setClockOutLoading] = useState(false);
  const [breakLoading, setBreakLoading] = useState(false);
  const [breakTimerSeconds, setBreakTimerSeconds] = useState(0);

  // Sinkronisasi status absensi kasir saat event attendance_updated / storage terpicu
  useEffect(() => {
    const syncAttendance = () => {
      setTodayCashierAtt(getTodayAttendance(user?.id, user?.email));
      setAttRecords(getAttendanceRecords());
    };
    syncAttendance();

    // Tarik riwayat absensi lengkap dari cloud
    loadAllAttendancesFromCloud().then((cloudList) => {
      if (cloudList && cloudList.length > 0) {
        setAttRecords(cloudList);
        setTodayCashierAtt(getTodayAttendance(user?.id, user?.email));
      }
    });

    window.addEventListener("attendance_updated", syncAttendance);
    window.addEventListener("storage", syncAttendance);
    return () => {
      window.removeEventListener("attendance_updated", syncAttendance);
      window.removeEventListener("storage", syncAttendance);
    };
  }, [user?.id, user?.email]);

  // Cabang penugasan kasir sesuai akun yang disetting
  const cashierAssignedBranch = useMemo(() => {
    if (branchName?.trim()) return branchName.trim();
    if (user?.id && typeof window !== "undefined") {
      const stored = localStorage.getItem(`app_user_branch_${user.id}`);
      if (stored?.trim()) return stored.trim();
    }
    const inferred = inferBranchFromEmail(user?.email);
    if (inferred) return inferred;
    return "Cabang 1";
  }, [branchName, user?.id, user?.email]);

  const cashierBranchConfig = useMemo(() => {
    return getBranchLocation(cashierAssignedBranch);
  }, [cashierAssignedBranch]);

  const cashierRadiusCheck = useMemo(() => {
    if (!cashierCoords) return { isWithin: false, distance: null, effectiveDistance: null };
    return isCashierWithinBranchRadius(
      cashierCoords.latitude,
      cashierCoords.longitude,
      cashierBranchConfig.latitude,
      cashierBranchConfig.longitude,
      cashierBranchConfig.radius_meters,
      cashierCoords.accuracy
    );
  }, [cashierCoords, cashierBranchConfig]);

  const cashierDistance = cashierRadiusCheck.distance;
  const cashierIsWithinRadius = cashierRadiusCheck.isWithin;

  const detectCashierLocation = () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setCashierGeoError("Browser Anda tidak mendukung geolokasi GPS.");
      return;
    }
    setCashierGeoLoading(true);
    setCashierGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCashierCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
        setCashierGeoLoading(false);
      },
      (err) => {
        setCashierGeoLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setCashierGeoError("Izin lokasi GPS ditolak di browser. Harap izinkan akses lokasi untuk absen pulang.");
        } else {
          setCashierGeoError("Gagal mendeteksi lokasi GPS. Pastikan GPS aktif di perangkat Anda.");
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  };

  useEffect(() => {
    if (effectiveRole === "cashier") {
      detectCashierLocation();
    }
  }, [effectiveRole, cashierAssignedBranch]);

  // Sesi istirahat aktif kasir
  const activeBreak = useMemo(() => {
    if (!todayCashierAtt?.breaks) return null;
    return todayCashierAtt.breaks.find((b) => !b.end_time) || null;
  }, [todayCashierAtt]);

  // Live stopwatch selama istirahat aktif berjalan
  useEffect(() => {
    if (!activeBreak) {
      setBreakTimerSeconds(0);
      return;
    }
    const updateTimer = () => {
      const startMs = new Date(activeBreak.start_time).getTime();
      const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      setBreakTimerSeconds(elapsedSec);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeBreak]);

  const formatSeconds = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}j ${m}m ${s}d`;
    return `${m}m ${s}d`;
  };

  const handleCashierClockOut = async () => {
    if (!user) {
      toast.error("Sesi pengguna tidak valid.");
      return;
    }
    if (!cashierCoords) {
      toast.error("Lokasi GPS belum terdeteksi. Silakan klik Refresh GPS.");
      detectCashierLocation();
      return;
    }
    if (!cashierIsWithinRadius) {
      toast.error(
        `Anda berada di luar radius lokasi cabang ${cashierAssignedBranch} (${cashierDistance}m). Maksimal radius: ${cashierBranchConfig.radius_meters}m.`
      );
      return;
    }

    setClockOutLoading(true);
    try {
      const rec = await recordClockOut({
        userId: user.id,
        userEmail: user.email || "kasir@gmail.com",
        latitude: cashierCoords.latitude,
        longitude: cashierCoords.longitude,
        branchName: cashierAssignedBranch,
        notes: `Pulang jarak ${cashierDistance}m (Akurasi GPS ±${cashierCoords.accuracy ?? 0}m)`,
      });
      setTodayCashierAtt(rec);
      toast.success("Absen pulang berhasil dicatat. istirahatlah, besok mulai bekerja lagi", { duration: 5000 });
    } catch (err: any) {
      toast.error(err?.message || "Gagal mencatat absen pulang.");
    } finally {
      setClockOutLoading(false);
    }
  };

  const handleStartBreak = async () => {
    if (!user) return;
    setBreakLoading(true);
    try {
      const rec = await startBreak({
        userId: user.id,
        userEmail: user.email || "kasir@gmail.com",
      });
      setTodayCashierAtt(rec);
      toast.success("Sesi istirahat dimulai. Selamat beristirahat!");
    } catch (err: any) {
      toast.error(err?.message || "Gagal memulai sesi istirahat.");
    } finally {
      setBreakLoading(false);
    }
  };

  const handleEndBreak = async () => {
    if (!user) return;
    setBreakLoading(true);
    try {
      const rec = await endBreak({
        userId: user.id,
        userEmail: user.email || "kasir@gmail.com",
      });
      setTodayCashierAtt(rec);
      toast.success("Sesi istirahat selesai. Selamat kembali bekerja!");
    } catch (err: any) {
      toast.error(err?.message || "Gagal menyelesaikan sesi istirahat.");
    } finally {
      setBreakLoading(false);
    }
  };

  // Helper untuk memformat alamat OSM menjadi detail, rapi, dan terstruktur
  interface DetailedAddressItem {
    lat: string;
    lon: string;
    display_name: string;
    title: string;
    subtitle: string;
    fullAddress: string;
    categoryLabel: string;
  }

  const formatDetailedOsmAddress = (item: any): DetailedAddressItem => {
    if (!item) {
      return {
        lat: "0",
        lon: "0",
        display_name: "",
        title: "Lokasi",
        subtitle: "",
        fullAddress: "",
        categoryLabel: "Lokasi",
      };
    }

    const addr = item.address || {};

    // 1. Tentukan Nama Tempat / POI / Patokan Utama
    const mainName =
      item.name ||
      addr.amenity ||
      addr.shop ||
      addr.building ||
      addr.restaurant ||
      addr.fast_food ||
      addr.cafe ||
      addr.supermarket ||
      addr.marketplace ||
      addr.commercial ||
      addr.office ||
      addr.hotel ||
      addr.school ||
      addr.mosque ||
      addr.place_of_worship ||
      (addr.road ? `${addr.road}${addr.house_number ? " No. " + addr.house_number : ""}` : null) ||
      item.display_name?.split(",")[0]?.trim() ||
      "Lokasi Terpilih";

    // 2. Komponen Jalan & Nomor
    const roadPart = addr.road
      ? `${addr.road}${addr.house_number ? " No. " + addr.house_number : ""}`
      : "";

    // 3. Kelurahan / Desa
    const villagePart =
      addr.village ||
      addr.suburb ||
      addr.neighbourhood ||
      addr.hamlet ||
      addr.quarter ||
      "";

    // 4. Kecamatan
    const districtPart =
      addr.city_district ||
      addr.district ||
      addr.subdistrict ||
      "";

    // 5. Kota / Kabupaten
    const cityPart =
      addr.city ||
      addr.town ||
      addr.municipality ||
      addr.county ||
      "";

    // 6. Provinsi
    const statePart = addr.state || "";

    // 7. Kode Pos
    const postCode = addr.postcode || "";

    // 8. Tentukan Label Kategori Tempat
    let categoryLabel = "Lokasi";
    const typeStr = `${item.type || ""} ${item.class || ""}`.toLowerCase();
    if (
      typeStr.includes("shop") ||
      typeStr.includes("store") ||
      typeStr.includes("restaurant") ||
      typeStr.includes("fast_food") ||
      typeStr.includes("cafe") ||
      typeStr.includes("food")
    ) {
      categoryLabel = "Toko / Kuliner";
    } else if (
      typeStr.includes("building") ||
      typeStr.includes("commercial") ||
      typeStr.includes("office") ||
      typeStr.includes("hotel") ||
      typeStr.includes("residential")
    ) {
      categoryLabel = "Gedung / Ruko";
    } else if (
      typeStr.includes("highway") ||
      typeStr.includes("road") ||
      typeStr.includes("street")
    ) {
      categoryLabel = "Jalan / Gang";
    } else if (
      typeStr.includes("administrative") ||
      typeStr.includes("boundary") ||
      typeStr.includes("place")
    ) {
      categoryLabel = "Wilayah";
    }

    // Susun Subtitle & Full Address yang sangat rapi
    const subParts: string[] = [];
    if (roadPart && roadPart !== mainName) subParts.push(roadPart);
    if (villagePart) {
      subParts.push(
        villagePart.startsWith("Kel.") || villagePart.startsWith("Desa")
          ? villagePart
          : `Kel. ${villagePart}`
      );
    }
    if (districtPart) {
      subParts.push(
        districtPart.startsWith("Kec.")
          ? districtPart
          : `Kec. ${districtPart}`
      );
    }
    if (cityPart) subParts.push(cityPart);
    if (statePart) subParts.push(statePart);
    if (postCode) subParts.push(postCode);

    const subtitle = subParts.length > 0 ? subParts.join(", ") : item.display_name || "";

    const fullAddress =
      mainName && subtitle && !subtitle.includes(mainName)
        ? `${mainName}, ${subtitle}`
        : subtitle || mainName;

    return {
      lat: String(item.lat || "0"),
      lon: String(item.lon || "0"),
      display_name: item.display_name || "",
      title: mainName,
      subtitle,
      fullAddress,
      categoryLabel,
    };
  };

  // State untuk pencarian alamat interaktif
  const [addressSearchLoading, setAddressSearchLoading] = useState(false);
  const [addressSearchResults, setAddressSearchResults] = useState<DetailedAddressItem[]>([]);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);

  // Muat lokasi cabang terbaru dari Supabase saat settings dibuka
  useEffect(() => {
    loadBranchLocationsFromSupabase().then((locs) => {
      if (selectedAttBranch && locs[selectedAttBranch]) {
        setAttMapForm(locs[selectedAttBranch]);
      }
    });
  }, []);

  useEffect(() => {
    if (selectedAttBranch) {
      setAttMapForm(getBranchLocation(selectedAttBranch));
      setAddressSearchResults([]);
      setShowAddressDropdown(false);
    }
  }, [selectedAttBranch]);

  // Fungsi geocoding alamat ke koordinat peta via OpenStreetMap Nominatim dengan addressdetails lengkap
  const searchAddressCoordinates = async (query: string, autoSelectFirst = false) => {
    const q = query.trim();
    if (!q || q.length < 3) {
      setAddressSearchResults([]);
      setShowAddressDropdown(false);
      return;
    }

    setAddressSearchLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          q
        )}&addressdetails=1&extratags=1&namedetails=1&countrycodes=id&limit=8`,
        {
          headers: {
            Accept: "application/json",
          },
        }
      );
      if (!res.ok) throw new Error("Gagal menghubungi server pencarian peta");
      const rawData = await res.json();

      const formattedList: DetailedAddressItem[] = (rawData || []).map((item: any) =>
        formatDetailedOsmAddress(item)
      );

      setAddressSearchResults(formattedList);
      setShowAddressDropdown(formattedList.length > 0);

      if (autoSelectFirst && formattedList.length > 0) {
        selectAddressResult(formattedList[0]);
      }
    } catch (err: any) {
      console.warn("Geocoding search warning:", err);
    } finally {
      setAddressSearchLoading(false);
    }
  };

  const selectAddressResult = (item: DetailedAddressItem) => {
    const newLat = parseFloat(item.lat);
    const newLon = parseFloat(item.lon);
    setAttMapForm((prev) => ({
      ...prev,
      latitude: Number(newLat.toFixed(6)),
      longitude: Number(newLon.toFixed(6)),
      address: item.fullAddress,
    }));
    setShowAddressDropdown(false);
    toast.success(`Titik lokasi map disetel ke: ${item.title}`);
  };

  // Geser koordinat manual dengan presisi (arah mata angin)
  const shiftCoordinate = (deltaLat: number, deltaLng: number) => {
    setAttMapForm((prev) => ({
      ...prev,
      latitude: Number((prev.latitude + deltaLat).toFixed(6)),
      longitude: Number((prev.longitude + deltaLng).toFixed(6)),
    }));
  };

  const [attSaving, setAttSaving] = useState(false);
  const handleSaveBranchLocation = async () => {
    setAttSaving(true);
    try {
      const ok = await saveBranchLocation({
        ...attMapForm,
        branch_name: selectedAttBranch,
      });
      if (ok) {
        toast.success(`Titik lokasi absensi untuk ${selectedAttBranch} berhasil disimpan & disinkronkan ke Cloud!`);
      } else {
        toast.success(`Titik lokasi absensi untuk ${selectedAttBranch} disimpan di cache lokal & akan disinkronkan.`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Gagal menyimpan titik lokasi");
    } finally {
      setAttSaving(false);
    }
  };

  const handleGetAdminCurrentGps = () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      toast.error("Browser tidak mendukung geolokasi GPS");
      return;
    }
    if (
      !confirm(
        `Perhatian: Tombol ini akan menyetel titik toko ${selectedAttBranch} ke posisi GPS Anda saat ini. Gunakan hanya jika Anda sedang berada di lokasi toko fisik cabang!`
      )
    ) {
      return;
    }
    setAttGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lon = Number(pos.coords.longitude.toFixed(6));
        setAttMapForm((prev) => ({
          ...prev,
          latitude: lat,
          longitude: lon,
        }));
        setAttGpsLoading(false);
        toast.success("Koordinat GPS berhasil diambil dari lokasi Anda!");

        // Reverse geocode untuk melengkapi teks alamat secara otomatis
        try {
          const revRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
            { headers: { "Accept": "application/json" } }
          );
          if (revRes.ok) {
            const revData = await revRes.json();
            if (revData?.display_name) {
              setAttMapForm((prev) => ({ ...prev, address: revData.display_name }));
            }
          }
        } catch {}
      },
      (err) => {
        setAttGpsLoading(false);
        toast.error("Gagal mendeteksi lokasi GPS: " + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleRefreshAttendanceRecords = async () => {
    toast.info("Menyinkronkan riwayat absensi dari Cloud...");
    try {
      const cloudList = await loadAllAttendancesFromCloud();
      setAttRecords(cloudList);
      setTodayCashierAtt(getTodayAttendance(user?.id, user?.email));
      toast.success("Data riwayat absensi berhasil diperbarui dari Cloud!");
    } catch {
      setAttRecords(getAttendanceRecords());
      toast.info("Data riwayat absensi diperbarui");
    }
  };

  const handleClearAttendanceHistory = () => {
    if (confirm("Apakah Anda yakin ingin menghapus semua riwayat absensi kasir?")) {
      clearAttendanceRecords();
      setAttRecords([]);
      toast.success("Riwayat absensi kasir berhasil dibersihkan");
    }
  };

  const filteredHistoryRecords = useMemo(() => {
    return attRecords.filter((rec) => {
      if (historyBranchFilter !== "all" && rec.branch_name.toLowerCase() !== historyBranchFilter.toLowerCase()) {
        return false;
      }
      if (historyDateFilter !== "all") {
        const todayStr = getTodayDateString();
        if (historyDateFilter === "today" && rec.date !== todayStr) return false;
        if (historyDateFilter === "7") {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          if (new Date(rec.clock_in_time) < sevenDaysAgo) return false;
        }
        if (historyDateFilter === "30") {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          if (new Date(rec.clock_in_time) < thirtyDaysAgo) return false;
        }
      }
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase().trim();
        const hay = `${rec.cashier_name} ${rec.user_email} ${rec.branch_name} ${rec.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [attRecords, historyBranchFilter, historyDateFilter, historySearch]);

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
      <Tabs defaultValue="absen" className="space-y-4">
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="absen" className="text-xs sm:text-sm font-semibold">
            <Clock className="h-4 w-4 mr-1.5 text-primary" /> Absen & Istirahat
          </TabsTrigger>
          <TabsTrigger value="printer" className="text-xs sm:text-sm font-semibold">
            <Printer className="h-4 w-4 mr-1.5" /> Printer Thermal
          </TabsTrigger>
        </TabsList>

        {/* Tab Absen & Istirahat untuk Kasir */}
        <TabsContent value="absen" className="space-y-4">
          {/* Card Ringkasan Status Shift Kasir Hari Ini */}
          <Card className="border-border/80 shadow-xs bg-card/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" /> Status Shift Kasir Hari Ini
                </CardTitle>
                <div>
                  {!todayCashierAtt ? (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-xs">
                      Belum Absen Masuk
                    </Badge>
                  ) : todayCashierAtt.clock_out_time ? (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-xs font-semibold">
                      <CheckCheck className="h-3.5 w-3.5 mr-1" /> Selesai Shift
                    </Badge>
                  ) : activeBreak ? (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-xs font-semibold animate-pulse">
                      <Coffee className="h-3.5 w-3.5 mr-1" /> Sedang Istirahat
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Sedang Bertugas (Hadir)
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-0 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-muted/40 p-3.5 rounded-xl border border-border/60">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Cabang Tugas:</span>
                  <span className="font-bold text-foreground text-xs sm:text-sm flex items-center gap-1 mt-0.5">
                    <Store className="h-3.5 w-3.5 text-primary shrink-0" />
                    {cashierAssignedBranch}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Jam Masuk:</span>
                  <span className="font-bold text-foreground text-xs sm:text-sm flex items-center gap-1 mt-0.5">
                    <Clock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    {todayCashierAtt?.clock_in_time
                      ? new Date(todayCashierAtt.clock_in_time).toLocaleTimeString("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "-"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Jam Pulang:</span>
                  <span className="font-bold text-foreground text-xs sm:text-sm flex items-center gap-1 mt-0.5">
                    <LogOut className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                    {todayCashierAtt?.clock_out_time
                      ? new Date(todayCashierAtt.clock_out_time).toLocaleTimeString("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Belum Pulang"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Total Istirahat:</span>
                  <span className="font-bold text-foreground text-xs sm:text-sm flex items-center gap-1 mt-0.5">
                    <Coffee className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    {getTotalBreakMinutes(todayCashierAtt?.breaks)} m ({todayCashierAtt?.breaks?.length || 0}x)
                  </span>
                </div>
              </div>

              {!todayCashierAtt && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center justify-between flex-wrap gap-2 text-amber-800 dark:text-amber-300">
                  <span>Anda belum melakukan absen masuk untuk shift hari ini.</span>
                  <Button size="sm" asChild className="h-7 text-xs font-semibold">
                    <Link to="/attendance">Buka Halaman Absen Masuk</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card Manajemen Istirahat (Bisa Lebih dari 1 Kali Sehari) */}
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Coffee className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                Manajemen Waktu Istirahat
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0 text-xs">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Gunakan tombol di bawah untuk mencatat waktu istirahat shift. Istirahat dapat dilakukan{" "}
                <strong>lebih dari 1 kali dalam sehari</strong> dan setiap sesi akan otomatis tercatat waktunya.
              </p>

              {/* Status Banner Jika Sedang Istirahat */}
              {activeBreak ? (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 space-y-3">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="space-y-1">
                      <div className="font-bold text-sm flex items-center gap-2">
                        <Coffee className="h-4 w-4 animate-bounce text-amber-600 dark:text-amber-400" />
                        Sedang Dalam Masa Istirahat
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Mulai istirahat pukul:{" "}
                        <span className="font-semibold text-foreground font-mono">
                          {new Date(activeBreak.start_time).toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </p>
                    </div>
                    <div className="bg-background/80 px-3 py-1.5 rounded-lg border border-border shadow-xs text-right">
                      <span className="text-[10px] text-muted-foreground block">Durasi Berjalan:</span>
                      <span className="font-mono font-bold text-sm text-primary">
                        {formatSeconds(breakTimerSeconds)}
                      </span>
                    </div>
                  </div>

                  <Button
                    className="w-full h-10 font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
                    disabled={breakLoading}
                    onClick={handleEndBreak}
                  >
                    <CheckCheck className="h-4 w-4 mr-2" />
                    {breakLoading ? "Memproses..." : "Selesai & Kembali dari Istirahat (Lanjut Bekerja)"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Button
                    variant="outline"
                    className="w-full h-10 font-semibold border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-700 text-amber-800 dark:text-amber-300"
                    disabled={breakLoading || !todayCashierAtt || !!todayCashierAtt.clock_out_time}
                    onClick={handleStartBreak}
                  >
                    <Coffee className="h-4 w-4 mr-2 text-amber-600" />
                    {breakLoading ? "Memproses..." : "Mulai Istirahat"}
                  </Button>

                  {todayCashierAtt?.clock_out_time && (
                    <p className="text-[11px] text-muted-foreground text-center">
                      Shift kerja hari ini telah selesai (sudah absen pulang). Tombol istirahat tidak aktif.
                    </p>
                  )}
                </div>
              )}

              {/* Riwayat Sesi Istirahat Hari Ini */}
              <div className="space-y-2 pt-2 border-t border-border/60">
                <span className="text-[11px] font-semibold text-foreground block">
                  Riwayat Sesi Istirahat Hari Ini ({todayCashierAtt?.breaks?.length || 0}):
                </span>
                {!todayCashierAtt?.breaks || todayCashierAtt.breaks.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">Belum ada sesi istirahat hari ini.</p>
                ) : (
                  <div className="space-y-1.5">
                    {todayCashierAtt.breaks.map((b, idx) => (
                      <div
                        key={b.id || idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-muted/40 border border-border/60 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-5 w-5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span>
                            {new Date(b.start_time).toLocaleTimeString("id-ID", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            -{" "}
                            {b.end_time
                              ? new Date(b.end_time).toLocaleTimeString("id-ID", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "Sedang berjalan..."}
                          </span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          {typeof b.duration_minutes === "number" ? `${b.duration_minutes} menit` : "Aktif"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Card Absen Pulang (1 Kali Sehari, Validasi GPS Lokasi Cabang) */}
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <LogOut className="h-4 w-4 text-rose-500" />
                Absensi Pulang Kasir
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2.5"
                disabled={cashierGeoLoading}
                onClick={detectCashierLocation}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${cashierGeoLoading ? "animate-spin" : ""}`} />
                {cashierGeoLoading ? "Mendeteksi..." : "Refresh GPS"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-0 text-xs">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Absen pulang dilakukan saat shift kerja Anda selesai. Absen masuk dan pulang hanya dapat dilakukan{" "}
                <strong>1 kali dalam sehari</strong> dan wajib berada di titik lokasi cabang toko{" "}
                <strong>({cashierAssignedBranch})</strong>.
              </p>

              {/* Status Sudah Absen Pulang */}
              {todayCashierAtt?.clock_out_time ? (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-900 dark:text-emerald-300 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    Anda Sudah Melakukan Absen Pulang Hari Ini
                  </div>
                  <p className="text-xs leading-relaxed opacity-90">
                    Waktu absen pulang:{" "}
                    <span className="font-mono font-bold">
                      {new Date(todayCashierAtt.clock_out_time).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    . Shift kerja Anda hari ini telah selesai.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Status GPS Kasir */}
                  {cashierGeoError ? (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{cashierGeoError}</span>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 text-xs bg-background" onClick={detectCashierLocation}>
                        Coba Deteksi Ulang GPS
                      </Button>
                    </div>
                  ) : cashierCoords ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 bg-muted/40 p-3 rounded-lg border border-border/60">
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Koordinat Anda:</span>
                          <span className="font-mono font-medium text-foreground text-[11px]">
                            {cashierCoords.latitude.toFixed(6)}, {cashierCoords.longitude.toFixed(6)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Titik Target {cashierAssignedBranch}:</span>
                          <span className="font-medium text-foreground text-[11px]">
                            Jarak {cashierDistance ?? 0}m (Maks: {cashierBranchConfig.radius_meters}m)
                          </span>
                        </div>
                      </div>

                      <div
                        className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                          cashierIsWithinRadius
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                            : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300"
                        }`}
                      >
                        {cashierIsWithinRadius ? (
                          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        )}
                        <span>
                          {cashierIsWithinRadius
                            ? `Lokasi valid di dalam radius cabang ${cashierAssignedBranch} (${cashierDistance}m). Anda dapat absen pulang.`
                            : `Anda berada ${cashierDistance}m dari cabang ${cashierAssignedBranch}. Harus berada dalam radius ${cashierBranchConfig.radius_meters}m untuk absen pulang.`}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-4 text-center text-muted-foreground">
                      <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1.5 text-primary" />
                      <span>Sedang mendeteksi sinyal GPS perangkat Anda...</span>
                    </div>
                  )}

                  {/* Tombol Absen Pulang */}
                  <Button
                    className="w-full h-11 text-sm font-bold shadow-sm bg-rose-600 hover:bg-rose-700 text-white"
                    disabled={
                      clockOutLoading ||
                      !todayCashierAtt ||
                      !cashierCoords ||
                      !cashierIsWithinRadius
                    }
                    onClick={handleCashierClockOut}
                  >
                    {clockOutLoading ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Memproses Absen Pulang...
                      </>
                    ) : (
                      <>
                        <LogOut className="h-4 w-4 mr-2" /> Klik Absen Pulang (Selesai Shift)
                      </>
                    )}
                  </Button>

                  {!todayCashierAtt && (
                    <p className="text-[11px] text-center text-muted-foreground">
                      ⚠️ Anda belum melakukan absen masuk hari ini.
                    </p>
                  )}
                  {todayCashierAtt && !cashierIsWithinRadius && cashierCoords && (
                    <p className="text-[11px] text-center text-amber-600 dark:text-amber-400">
                      ⚠️ Anda harus berada di lokasi cabang ({cashierBranchConfig.radius_meters}m) untuk dapat absen pulang.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Printer Thermal untuk Kasir */}
        <TabsContent value="printer" className="space-y-4">
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
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <>
      <Tabs defaultValue="store" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="store"><Store className="h-4 w-4 mr-1.5" />Umum</TabsTrigger>
          <TabsTrigger value="absen"><MapPin className="h-4 w-4 mr-1.5" />Absen</TabsTrigger>
          <TabsTrigger value="event"><CalendarDays className="h-4 w-4 mr-1.5" />Event</TabsTrigger>
          <TabsTrigger value="users"><Users className="h-4 w-4 mr-1.5" />Akun</TabsTrigger>
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
                          {cleanReceiptAddress(b.shop_address) || <span className="text-muted-foreground">-</span>}
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

      {/* TAB PENGATURAN ABSEN & HISTORY */}
      <TabsContent value="absen" className="space-y-5">
        {/* Card Pengaturan Titik Map Cabang */}
        <Card className="border-border/80 shadow-xs">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" /> Pengaturan Titik Lokasi Absen (Geofencing)
              </CardTitle>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">
                Sesuai Pilihan Cabang
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Tentukan titik koordinat peta (Latitude & Longitude) dan batas radius toleransi per cabang. Kasir hanya dapat melakukan absen jika berada dalam batas radius titik ini.
            </p>

            <div className="grid sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Pilih Cabang yang Diatur</Label>
                <Select
                  value={selectedAttBranch}
                  onValueChange={(val) => {
                    setSelectedAttBranch(val);
                  }}
                >
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder="Pilih Cabang" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableBranches.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                    {!availableBranches.includes("Cabang 1") && <SelectItem value="Cabang 1">Cabang 1</SelectItem>}
                    {!availableBranches.includes("Cabang 2") && <SelectItem value="Cabang 2">Cabang 2</SelectItem>}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Batas Radius Toleransi Absen (Meter)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="10"
                    max="5000"
                    className="text-xs h-9"
                    value={attMapForm.radius_meters}
                    onChange={(e) =>
                      setAttMapForm({ ...attMapForm, radius_meters: Math.max(10, Number(e.target.value) || 100) })
                    }
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">meter</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs font-semibold">Latitude</Label>
                  <span className="text-[10px] text-muted-foreground">Contoh: -6.208800</span>
                </div>
                <Input
                  type="number"
                  step="0.000001"
                  className="text-xs h-9 font-mono"
                  value={attMapForm.latitude}
                  onChange={(e) =>
                    setAttMapForm({ ...attMapForm, latitude: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-xs font-semibold">Longitude</Label>
                  <span className="text-[10px] text-muted-foreground">Contoh: 106.845600</span>
                </div>
                <Input
                  type="number"
                  step="0.000001"
                  className="text-xs h-9 font-mono"
                  value={attMapForm.longitude}
                  onChange={(e) =>
                    setAttMapForm({ ...attMapForm, longitude: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>

              {/* Input Alamat yang langsung mencari koordinat dan merespon peta */}
              <div className="sm:col-span-2 space-y-1.5 relative">
                <div className="flex justify-between items-center">
                  <Label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <Search className="h-3.5 w-3.5 text-primary" /> Alamat / Patokan Cabang
                  </Label>
                  <span className="text-[10px] text-primary font-medium">Ketik langsung mengarahkan pin peta</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Input
                      placeholder="Ketik nama jalan / ruko / patokan, contoh: Jl. Boulevard Kelapa Gading / Monas..."
                      className="text-xs h-9 pr-8 bg-card"
                      value={attMapForm.address || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAttMapForm({ ...attMapForm, address: val });
                        if (val.trim().length >= 3) {
                          searchAddressCoordinates(val, false);
                        } else {
                          setShowAddressDropdown(false);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (attMapForm.address) {
                            searchAddressCoordinates(attMapForm.address, true);
                          }
                        }
                      }}
                    />
                    {addressSearchLoading && (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary absolute right-2.5 top-1/2 -translate-y-1/2" />
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-9 text-xs px-3 font-semibold shrink-0"
                    disabled={addressSearchLoading || !attMapForm.address?.trim()}
                    onClick={() => searchAddressCoordinates(attMapForm.address || "", true)}
                  >
                    <Search className="h-3.5 w-3.5 mr-1 text-primary" />
                    Cari di Peta
                  </Button>
                </div>

                {/* Dropdown Hasil Pencarian Alamat Otomatis */}
                {showAddressDropdown && addressSearchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover text-popover-foreground rounded-xl border border-border shadow-2xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-border">
                    <div className="p-2.5 bg-muted/80 text-[11px] font-semibold text-muted-foreground px-3.5 flex justify-between items-center sticky top-0 backdrop-blur-md z-10 border-b border-border/60">
                      <span className="flex items-center gap-1.5 text-foreground font-bold">
                        <Search className="h-3 w-3 text-primary" /> Pilih Patokan / Lokasi yang Sesuai ({addressSearchResults.length} Ditemukan):
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAddressDropdown(false)}
                        className="text-muted-foreground hover:text-foreground font-bold px-1.5 py-0.5 rounded hover:bg-muted"
                      >
                        ✕
                      </button>
                    </div>
                    {addressSearchResults.map((res, i) => (
                      <div
                        key={i}
                        onClick={() => selectAddressResult(res)}
                        className="p-3 text-xs hover:bg-primary/10 hover:text-primary cursor-pointer flex items-start gap-3 transition-colors group"
                      >
                        <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-0.5 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          <MapPin className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                              {res.title}
                            </span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-background border-border text-muted-foreground">
                              {res.categoryLabel}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                            {res.subtitle}
                          </div>
                          <div className="text-[10px] text-muted-foreground/70 font-mono pt-0.5 flex items-center gap-2">
                            <span>📍 {parseFloat(res.lat).toFixed(5)}, {parseFloat(res.lon).toFixed(5)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions for GPS */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs h-8"
                disabled={attGpsLoading}
                onClick={handleGetAdminCurrentGps}
              >
                <Navigation className={`h-3.5 w-3.5 mr-1.5 text-primary ${attGpsLoading ? "animate-spin" : ""}`} />
                {attGpsLoading ? "Mendeteksi..." : "Ambil Koordinat Lokasi Saya Saat Ini (GPS)"}
              </Button>
              <a
                href={`https://www.google.com/maps?q=${attMapForm.latitude},${attMapForm.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline px-2 py-1"
              >
                Buka di Google Maps ↗
              </a>
            </div>

            {/* Interactive Leaflet Map for Direct Manual Pointing and Geofencing */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-primary" /> Peta Interaktif Titik Absen {selectedAttBranch}:
                </span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {attMapForm.latitude.toFixed(6)}, {attMapForm.longitude.toFixed(6)} (Radius: {attMapForm.radius_meters}m)
                </span>
              </div>

              {/* Komponen Peta Interaktif dengan Klik Langsung & Draggable Marker */}
              <AttendanceLocationPickerMap
                latitude={attMapForm.latitude}
                longitude={attMapForm.longitude}
                radiusMeters={attMapForm.radius_meters}
                branchName={selectedAttBranch}
                address={attMapForm.address}
                onChangeCoordinates={({ latitude, longitude, address: newAddress }) => {
                  setAttMapForm((prev) => ({
                    ...prev,
                    latitude,
                    longitude,
                    ...(newAddress ? { address: newAddress } : {}),
                  }));
                }}
              />

              {/* Kontrol Geser Pin Peta Mikro (Fine-Tuning) */}
              <div className="flex items-center justify-between flex-wrap gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/80 text-xs">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  <Compass className="h-3.5 w-3.5 text-primary" /> Geser Titik Peta (±10 meter):
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                    title="Geser ke Atas (Utara)"
                    onClick={() => shiftCoordinate(0.0001, 0)}
                  >
                    ⬆️ Atas
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                    title="Geser ke Bawah (Selatan)"
                    onClick={() => shiftCoordinate(-0.0001, 0)}
                  >
                    ⬇️ Bawah
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                    title="Geser ke Kiri (Barat)"
                    onClick={() => shiftCoordinate(0, -0.0001)}
                  >
                    ⬅️ Kiri
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                    title="Geser ke Kanan (Timur)"
                    onClick={() => shiftCoordinate(0, 0.0001)}
                  >
                    ➡️ Kanan
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={handleSaveBranchLocation} disabled={attSaving} className="text-xs font-semibold">
                {attSaving ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> Menyimpan & Sinkronkan...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-1.5" /> Simpan Pengaturan Titik {selectedAttBranch}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Card Riwayat Absensi Kasir (History Absen Table) */}
        <Card className="border-border/80 shadow-xs">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Riwayat Absensi Kasir ({filteredHistoryRecords.length})
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs px-2.5"
                  onClick={handleRefreshAttendanceRecords}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
                </Button>
                {filteredHistoryRecords.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={handleClearAttendanceHistory}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Bersihkan
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {/* Filter Bar */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Cari kasir / email / cabang..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>

              <Select value={historyBranchFilter} onValueChange={(v) => setHistoryBranchFilter(v)}>
                <SelectTrigger className="w-[130px] h-8 text-xs">
                  <SelectValue placeholder="Cabang" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Cabang</SelectItem>
                  {availableBranches.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={historyDateFilter} onValueChange={(v: any) => setHistoryDateFilter(v)}>
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue placeholder="Tanggal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Waktu</SelectItem>
                  <SelectItem value="today">Hari Ini</SelectItem>
                  <SelectItem value="7">7 Hari Terakhir</SelectItem>
                  <SelectItem value="30">30 Hari Terakhir</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Tabel Riwayat */}
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Tanggal</TableHead>
                    <TableHead className="text-xs font-semibold">Kasir & Cabang</TableHead>
                    <TableHead className="text-xs font-semibold">Jam Masuk</TableHead>
                    <TableHead className="text-xs font-semibold">Jam Pulang</TableHead>
                    <TableHead className="text-xs font-semibold">Istirahat</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Status Shift</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHistoryRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">
                        Belum ada riwayat absensi kasir yang tercatat.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredHistoryRecords.map((rec) => {
                      const totalBreakMin = getTotalBreakMinutes(rec.breaks);
                      const hasActiveBreak = rec.breaks?.some((b) => !b.end_time);

                      return (
                        <TableRow key={rec.id} className="text-xs">
                          {/* Tanggal */}
                          <TableCell className="font-medium whitespace-nowrap">
                            <div className="font-semibold text-foreground">
                              {new Date(rec.clock_in_time).toLocaleDateString("id-ID", {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono">{rec.date}</div>
                          </TableCell>

                          {/* Kasir & Cabang */}
                          <TableCell>
                            <div className="font-semibold text-foreground">{rec.cashier_name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">{rec.user_email}</div>
                            <Badge variant="secondary" className="text-[10px] font-medium mt-1">
                              <Store className="h-3 w-3 mr-1" /> {rec.branch_name}
                            </Badge>
                          </TableCell>

                          {/* Jam Masuk */}
                          <TableCell className="whitespace-nowrap">
                            <div className="font-bold text-foreground text-xs flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                              {new Date(rec.clock_in_time).toLocaleTimeString("id-ID", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Jarak: <span className="font-medium text-foreground">{rec.distance_meters}m</span>
                            </div>
                            {rec.is_within_radius ? (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[9px] px-1 py-0 mt-0.5">
                                Valid
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-[9px] px-1 py-0 mt-0.5">
                                Luar Radius
                              </Badge>
                            )}
                          </TableCell>

                          {/* Jam Pulang */}
                          <TableCell className="whitespace-nowrap">
                            {rec.clock_out_time ? (
                              <div>
                                <div className="font-bold text-foreground text-xs flex items-center gap-1">
                                  <LogOut className="h-3.5 w-3.5 text-rose-500" />
                                  {new Date(rec.clock_out_time).toLocaleTimeString("id-ID", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  Jarak: <span className="font-medium text-foreground">{rec.clock_out_distance_meters ?? 0}m</span>
                                </div>
                                {rec.clock_out_is_within_radius ? (
                                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[9px] px-1 py-0 mt-0.5">
                                    Valid
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-[9px] px-1 py-0 mt-0.5">
                                    Luar Radius
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-[10px] font-medium">
                                <Clock className="h-3 w-3 mr-1 animate-pulse" /> Belum Pulang
                              </Badge>
                            )}
                          </TableCell>

                          {/* Istirahat */}
                          <TableCell>
                            {rec.breaks && rec.breaks.length > 0 ? (
                              <div className="space-y-1">
                                <div className="font-semibold text-foreground text-xs flex items-center gap-1">
                                  <Coffee className="h-3 w-3 text-amber-500" />
                                  {totalBreakMin}m ({rec.breaks.length}x)
                                </div>
                                {hasActiveBreak && (
                                  <Badge variant="secondary" className="text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300">
                                    Sedang Istirahat
                                  </Badge>
                                )}
                                <div className="text-[10px] text-muted-foreground space-y-0.5">
                                  {rec.breaks.map((b, bIdx) => (
                                    <div key={b.id || bIdx} className="font-mono text-[9px]">
                                      #{bIdx + 1}: {new Date(b.start_time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                                      {b.end_time ? ` - ${new Date(b.end_time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} (${b.duration_minutes ?? 0}m)` : " (Aktif)"}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-[11px]">-</span>
                            )}
                          </TableCell>

                          {/* Status Shift */}
                          <TableCell className="text-right whitespace-nowrap">
                            {rec.clock_out_time ? (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                                <CheckCheck className="h-3 w-3 mr-1" /> Selesai Shift
                              </Badge>
                            ) : hasActiveBreak ? (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-[10px]">
                                <Coffee className="h-3 w-3 mr-1" /> Istirahat
                              </Badge>
                            ) : rec.is_within_radius ? (
                              <Badge variant="outline" className="bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20 text-[10px]">
                                <ShieldCheck className="h-3 w-3 mr-1" /> Hadir (Aktif)
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20 text-[10px]">
                                <AlertTriangle className="h-3 w-3 mr-1" /> Luar Radius
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
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
