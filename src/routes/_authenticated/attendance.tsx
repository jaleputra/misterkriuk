import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth, inferBranchFromEmail } from "@/hooks/useAuth";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  MapPin,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Store,
  Clock,
  ArrowRight,
  Navigation,
  ShieldCheck,
  UserCheck,
  Cloud,
} from "lucide-react";
import {
  getBranchLocations,
  getBranchLocation,
  calculateDistanceMeters,
  isCashierWithinBranchRadius,
  loadBranchLocationsFromSupabase,
  recordAttendance,
  hasCashierCheckedInToday,
  getTodayAttendance,
  syncTodayAttendanceFromCloud,
  type AttendanceRecord,
  type BranchLocationConfig,
} from "@/lib/attendance";
import { AttendanceLocationPickerMap } from "@/components/AttendanceLocationPickerMap";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/attendance")({
  ssr: false,
  component: CashierAttendancePage,
});

function CashierAttendancePage() {
  const navigate = useNavigate();
  const { user, role: rawRole, branchName } = useAuth();
  const isExplicitKasir =
    user?.email?.toLowerCase().trim() === "kasir@gmail.com" ||
    user?.email?.toLowerCase().includes("kasir");
  const role: "admin" | "cashier" = isExplicitKasir
    ? "cashier"
    : rawRole || (user?.email?.toLowerCase().trim() === "jaleputra69@gmail.com" ? "admin" : "cashier");

  // Fetch branches from Supabase or fallback
  const { data: dbBranches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("branches").select("*").order("created_at", { ascending: true });
        if (error) {
          const localData = typeof window !== "undefined" ? localStorage.getItem("app_branches_data") : null;
          return localData ? JSON.parse(localData) : [];
        }
        return data ?? [];
      } catch {
        const localData = typeof window !== "undefined" ? localStorage.getItem("app_branches_data") : null;
        return localData ? JSON.parse(localData) : [];
      }
    },
  });

  const [branchVersion, setBranchVersion] = useState(0);
  const [cloudSyncing, setCloudSyncing] = useState(false);

  // Fungsi muat ulang lokasi dari Cloud
  const handleRefreshCloudLocations = async () => {
    setCloudSyncing(true);
    try {
      await loadBranchLocationsFromSupabase();
      if (user) {
        const cloudAtt = await syncTodayAttendanceFromCloud(user.id, user.email);
        if (cloudAtt) setTodayAtt(cloudAtt);
      }
      setBranchVersion((v) => v + 1);
      toast.success("Titik lokasi cabang & status absensi berhasil disinkronkan dari Cloud!");
    } catch {
      toast.info("Sinkronisasi cloud selesai.");
    } finally {
      setCloudSyncing(false);
    }
  };

  // Muat lokasi cabang terbaru dari Supabase dan status absensi kasir saat halaman dibuka
  useEffect(() => {
    loadBranchLocationsFromSupabase().then(() => {
      setBranchVersion((v) => v + 1);
    });

    if (user) {
      syncTodayAttendanceFromCloud(user.id, user.email).then((cloudRec) => {
        if (cloudRec) setTodayAtt(cloudRec);
      });
    }

    const handleSync = () => {
      setBranchVersion((v) => v + 1);
      setTodayAtt(getTodayAttendance(user?.id, user?.email));
    };

    window.addEventListener("branch_location_updated", handleSync);
    window.addEventListener("attendance_updated", handleSync);
    window.addEventListener("storage", handleSync);

    // Pasang Realtime Listener Supabase untuk menerima broadcast update titik lokasi & absensi
    const channel = supabase
      .channel("attendance_realtime_sync_listener")
      .on("broadcast", { event: "branch_location_changed" }, () => {
        loadBranchLocationsFromSupabase().then(() => setBranchVersion((v) => v + 1));
      })
      .on("broadcast", { event: "cashier_attendance_updated" }, () => {
        if (user) {
          syncTodayAttendanceFromCloud(user.id, user.email).then((r) => {
            if (r) setTodayAtt(r);
          });
        }
      })
      .subscribe();

    return () => {
      window.removeEventListener("branch_location_updated", handleSync);
      window.removeEventListener("attendance_updated", handleSync);
      window.removeEventListener("storage", handleSync);
      supabase.removeChannel(channel);
    };
  }, [user?.id, user?.email]);

  const branchLocations = useMemo(() => {
    return getBranchLocations();
  }, [branchVersion]);

  const availableBranchNames = useMemo(() => {
    const list = new Set<string>();
    // Dari DB branches
    dbBranches.forEach((b: any) => {
      if (b.branch_name?.trim()) list.add(b.branch_name.trim());
    });
    // Dari configs
    Object.keys(branchLocations).forEach((k) => list.add(k));
    // Default jika kosong
    if (list.size === 0) {
      list.add("Cabang 1");
      list.add("Cabang 2");
    }
    return Array.from(list);
  }, [dbBranches, branchLocations]);

  // Cabang penugasan otomatis disesuaikan dengan akun (tanpa perlu dipilih manual)
  const assignedBranch = useMemo(() => {
    if (branchName?.trim()) return branchName.trim();
    if (user?.id && typeof window !== "undefined") {
      const stored = localStorage.getItem(`app_user_branch_${user.id}`);
      if (stored?.trim()) return stored.trim();
    }
    const inferred = inferBranchFromEmail(user?.email);
    if (inferred) return inferred;
    return availableBranchNames[0] || "Cabang 1";
  }, [branchName, user?.id, user?.email, availableBranchNames]);

  const [selectedBranchOverride, setSelectedBranchOverride] = useState<string>("");
  const selectedBranch = selectedBranchOverride || assignedBranch;

  // GPS State
  const [coords, setCoords] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Status absen hari ini
  const [todayAtt, setTodayAtt] = useState<AttendanceRecord | null>(() =>
    getTodayAttendance(user?.id, user?.email)
  );

  const isCheckedIn = !!todayAtt;

  // Konfigurasi cabang yang aktif (selalu terupdate saat ada perubahan titik di tab settings)
  const currentBranchConfig: BranchLocationConfig = useMemo(() => {
    return getBranchLocation(selectedBranch);
  }, [selectedBranch, branchVersion]);

  // Hitung jarak kasir ke titik cabang dengan memperhitungkan toleransi akurasi GPS perangkat
  const radiusCheck = useMemo(() => {
    if (!coords) return { isWithin: false, distance: null, effectiveDistance: null };
    return isCashierWithinBranchRadius(
      coords.latitude,
      coords.longitude,
      currentBranchConfig.latitude,
      currentBranchConfig.longitude,
      currentBranchConfig.radius_meters || 150,
      coords.accuracy
    );
  }, [coords, currentBranchConfig]);

  const distanceToBranch = radiusCheck.distance;
  const isWithinRadius = radiusCheck.isWithin;

  // Fungsi deteksi GPS
  const detectLocation = () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGeoError("Browser Anda tidak mendukung geolokasi GPS.");
      return;
    }

    setGeoLoading(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
        });
        setGeoLoading(false);
      },
      (err) => {
        setGeoLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError("Izin lokasi ditolak. Harap izinkan akses lokasi (GPS) di pengaturan browser untuk melakukan absen.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGeoError("Informasi lokasi tidak tersedia pada perangkat ini. Pastikan GPS aktif.");
        } else {
          setGeoError("Waktu deteksi lokasi habis. Silakan klik tombol Coba Lagi.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 5000,
      }
    );
  };

  useEffect(() => {
    detectLocation();
  }, [selectedBranch]);

  // Fungsi klik Absen & Siap Menjadi Kasir
  const handleCheckIn = async () => {
    if (!user) {
      toast.error("Sesi pengguna tidak valid. Silakan login ulang.");
      return;
    }

    if (!coords) {
      toast.error("Lokasi GPS belum terdeteksi. Harap izinkan akses lokasi.");
      detectLocation();
      return;
    }

    if (!isWithinRadius && role !== "admin") {
      toast.error(
        `Anda berada di luar radius (${distanceToBranch}m dari titik cabang). Maksimal radius: ${currentBranchConfig.radius_meters}m.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const rec = await recordAttendance({
        userId: user.id,
        userEmail: user.email || "kasir@gmail.com",
        cashierName: user.user_metadata?.name || user.email?.split("@")[0] || "Kasir",
        branchName: selectedBranch,
        latitude: coords.latitude,
        longitude: coords.longitude,
        notes: `Jarak ${distanceToBranch}m (Akurasi GPS ±${coords.accuracy ?? 0}m)`,
      });

      setTodayAtt(rec);
      toast.success("Absen Berhasil! Anda siap menjadi kasir.");

      // Arahkan langsung ke halaman kasir tanpa reload
      setTimeout(() => {
        navigate({ to: "/transaction", replace: true });
      }, 500);
    } catch (err: any) {
      toast.error(err?.message || "Gagal melakukan absensi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-8">
      {/* Header Absen */}
      <div className="text-center space-y-1.5 pt-2">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-primary/10 text-primary mb-1 shadow-xs border border-primary/20">
          <MapPin className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Absensi Kasir</h1>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
          Lakukan verifikasi kehadiran di titik lokasi cabang toko sebelum memulai shift penjualan.
        </p>
      </div>

      {/* Info Akun Login */}
      <Card className="border-border/80 shadow-xs bg-card/60 backdrop-blur-xs">
        <CardContent className="p-3.5 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground font-semibold">
              <UserCheck className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold text-foreground text-sm">{user?.email || "kasir@gmail.com"}</div>
              <div className="text-muted-foreground capitalize">
                Peran: <span className="font-medium text-primary">{role}</span>
                {branchName ? ` • Terdaftar: ${branchName}` : ""}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshCloudLocations}
              disabled={cloudSyncing}
              className="h-7 text-[11px] px-2"
              title="Tarik titik lokasi cabang & absensi terbaru dari Cloud"
            >
              <Cloud className={`h-3 w-3 mr-1 text-primary ${cloudSyncing ? "animate-spin" : ""}`} />
              {cloudSyncing ? "Sinkron..." : "Sinkron Cloud"}
            </Button>
            {role === "admin" && (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                Admin Mode (Bebas Absen)
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* JIKA SUDAH ABSEN HARI INI */}
      {isCheckedIn && todayAtt && (
        <Card className="border-emerald-500/30 bg-emerald-500/5 shadow-md">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <CardTitle className="text-base font-bold">Sudah Absen Hari Ini</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-1 text-sm">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Anda telah tercatat absen untuk shift hari ini. Anda sudah siap melayani transaksi di kasir.
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs bg-card/80 p-3 rounded-lg border border-border">
              <div>
                <span className="text-muted-foreground block">Waktu Absen:</span>
                <span className="font-semibold flex items-center gap-1 mt-0.5">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  {new Date(todayAtt.clock_in_time).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Cabang:</span>
                <span className="font-semibold flex items-center gap-1 mt-0.5">
                  <Store className="h-3.5 w-3.5 text-primary" />
                  {todayAtt.branch_name}
                </span>
              </div>
              <div className="col-span-2 pt-1 border-t border-border/50 flex justify-between items-center">
                <span className="text-muted-foreground">Jarak ke Titik Cabang:</span>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
                  {todayAtt.distance_meters} meter ({todayAtt.status})
                </Badge>
              </div>
            </div>

            <Button
              className="w-full h-11 text-sm font-semibold shadow-sm"
              onClick={() => navigate({ to: "/transaction" })}
            >
              Buka Halaman Kasir Sekarang <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* FORM ABSEN KASIR */}
      {(!isCheckedIn || role === "admin") && (
        <div className="space-y-4">
          {/* Info Cabang Penugasan (Otomatis Sesuai Pengaturan Akun & Bisa Dipilih) */}
          <Card className="border-border/80 shadow-xs bg-card/80">
            <CardContent className="p-3.5 sm:p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-semibold shrink-0">
                    <Store className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground block">Cabang Toko Absensi:</span>
                    {availableBranchNames.length > 1 ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <Select
                          value={selectedBranch}
                          onValueChange={(val) => {
                            setSelectedBranchOverride(val);
                            if (user?.id && typeof window !== "undefined") {
                              localStorage.setItem(`app_user_branch_${user.id}`, val);
                            }
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs font-bold w-[160px] bg-background">
                            <SelectValue placeholder="Pilih Cabang" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableBranchNames.map((b) => (
                              <SelectItem key={b} value={b} className="text-xs">
                                {b}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <span className="font-bold text-sm text-foreground">{selectedBranch}</span>
                    )}
                  </div>
                </div>
                <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[11px] font-medium">
                  {selectedBranchOverride ? "Cabang Dipilih" : "Tersinkronisasi Akun"}
                </Badge>
              </div>

              {/* Titik Lokasi Target Cabang (Sesuai yang disetel di Map Settings) */}
              <div className="bg-muted/40 p-3 rounded-lg border border-border/60 space-y-1.5 text-muted-foreground">
                <div className="flex justify-between items-center text-foreground font-medium text-[11px]">
                  <span className="font-bold text-primary flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> Titik Target Absen {selectedBranch}:
                  </span>
                  <Badge variant="secondary" className="text-[10px] font-semibold">
                    Radius Toleransi: {currentBranchConfig.radius_meters}m
                  </Badge>
                </div>
                <div className="font-mono text-[11px] text-foreground font-semibold">
                  Lat: {currentBranchConfig.latitude.toFixed(6)}, Lng: {currentBranchConfig.longitude.toFixed(6)}
                </div>
                {currentBranchConfig.address && (
                  <p className="text-[11px] text-muted-foreground/80 truncate">
                    📍 {currentBranchConfig.address}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Status Deteksi GPS Kasir */}
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Navigation className="h-4 w-4 text-primary" />
                Lokasi GPS Anda Saat Ini
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2.5 cursor-pointer"
                disabled={geoLoading}
                onClick={detectLocation}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${geoLoading ? "animate-spin" : ""}`} />
                {geoLoading ? "Mendeteksi..." : "Refresh GPS"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 pt-0 text-xs">
              {geoError ? (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{geoError}</span>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs bg-background cursor-pointer" onClick={detectLocation}>
                    Coba Deteksi Ulang
                  </Button>
                </div>
              ) : coords ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 bg-muted/40 p-3 rounded-lg border border-border/60">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Koordinat Anda:</span>
                      <span className="font-mono font-medium text-foreground text-[11px]">
                        {coords.latitude.toFixed(6)}, {coords.longitude.toFixed(6)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Akurasi GPS Perangkat:</span>
                      <span className="font-medium text-foreground text-[11px]">
                        ±{coords.accuracy ?? 10} meter
                      </span>
                    </div>
                  </div>

                  {/* Indikator Validasi Radius Geofence */}
                  <div
                    className={`p-3.5 rounded-xl border transition-all ${
                      isWithinRadius
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-300"
                        : "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-300"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {isWithinRadius ? (
                        <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1">
                        <div className="font-bold text-sm">
                          {isWithinRadius
                            ? "Lokasi Valid (Di Dalam Radius Titik Toko)"
                            : "Di Luar Titik Cabang Toko"}
                        </div>
                        <p className="text-xs leading-relaxed opacity-90">
                          {isWithinRadius
                            ? `Jarak Anda ke ${selectedBranch} adalah ${distanceToBranch} meter (toleransi maks: ${currentBranchConfig.radius_meters}m). Anda siap melakukan absen.`
                            : `Jarak Anda ke ${selectedBranch} adalah ${distanceToBranch} meter. Anda harus berada dalam radius ${currentBranchConfig.radius_meters} meter dari titik toko untuk absen.`}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                  <span>Sedang mendeteksi sinyal GPS perangkat Anda...</span>
                </div>
              )}

              {/* Peta Interaktif Lengkap & Akurat (Preview Titik Toko & Posisi Kasir) */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="font-medium">Peta Titik Absensi {selectedBranch}:</span>
                  <span className="text-[10px]">🔴 Toko | 🔵 Posisi Anda</span>
                </div>
                <AttendanceLocationPickerMap
                  latitude={currentBranchConfig.latitude}
                  longitude={currentBranchConfig.longitude}
                  radiusMeters={currentBranchConfig.radius_meters}
                  branchName={selectedBranch}
                  address={currentBranchConfig.address}
                  readOnly={true}
                  cashierCoords={coords}
                  className="w-full h-56 sm:h-64"
                />
              </div>
            </CardContent>
          </Card>

          {/* Tombol Utama Absen Kasir */}
          <div className="pt-2">
            <Button
              className="w-full h-12 text-sm sm:text-base font-bold shadow-md transition-all active:scale-[0.99]"
              disabled={submitting || geoLoading || !coords || (!isWithinRadius && role !== "admin")}
              onClick={handleCheckIn}
            >
              {submitting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Memproses Absen...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 mr-2" /> Klik Absen & Siap Menjadi Kasir
                </>
              )}
            </Button>

            {!isWithinRadius && coords && role !== "admin" && (
              <p className="text-[11px] text-center text-amber-600 dark:text-amber-400 mt-2">
                ⚠️ Tombol absen akan aktif otomatis setelah Anda berada di lokasi cabang ({currentBranchConfig.radius_meters}m).
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
