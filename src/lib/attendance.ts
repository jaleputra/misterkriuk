import { supabase } from "@/integrations/supabase/client";

export interface BranchLocationConfig {
  branch_name: string;
  latitude: number;
  longitude: number;
  radius_meters: number; // default radius e.g. 100 meters
  address?: string;
  updated_at?: string;
}

export interface AttendanceBreak {
  id: string;
  start_time: string; // ISO string
  end_time?: string; // ISO string
  duration_minutes?: number;
}

export interface AttendanceRecord {
  id: string;
  user_id: string;
  user_email: string;
  cashier_name: string;
  branch_name: string;
  date: string; // YYYY-MM-DD
  clock_in_time: string; // ISO string
  clock_out_time?: string; // ISO string (hanya 1 kali per hari)
  clock_out_latitude?: number;
  clock_out_longitude?: number;
  clock_out_distance_meters?: number;
  clock_out_is_within_radius?: boolean;
  breaks?: AttendanceBreak[]; // sesi istirahat (bisa lebih dari 1 kali)
  latitude: number;
  longitude: number;
  branch_lat: number;
  branch_lng: number;
  distance_meters: number;
  status: "Hadir" | "Terlambat" | "Luar Radius" | "Selesai Shift";
  is_within_radius: boolean;
  notes?: string;
}

// Default cabang locations jika belum disetel di cloud
export const DEFAULT_BRANCH_LOCATIONS: Record<string, BranchLocationConfig> = {
  "Cabang 1": {
    branch_name: "Cabang 1",
    latitude: -6.2088,
    longitude: 106.8456,
    radius_meters: 150,
    address: "Pusat - Cabang 1",
    updated_at: new Date().toISOString(),
  },
  "Cabang 2": {
    branch_name: "Cabang 2",
    latitude: -6.2150,
    longitude: 106.8500,
    radius_meters: 150,
    address: "Cabang 2",
    updated_at: new Date().toISOString(),
  },
};

const BRANCH_CONFIG_KEY = "app_branch_attendance_locations";
const ATTENDANCE_RECORDS_KEY = "app_cashier_attendances";

/**
 * Hitung jarak antara 2 titik koordinat (dalam meter) menggunakan Haversine formula
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return 999999;
  const R = 6371e3; // Radius bumi dalam meter
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Validasi apakah kasir berada dalam radius cabang dengan memperhitungkan toleransi akurasi GPS
 * (Akurasi GPS perangkat smartphone/laptop dalam ruangan sering berdeviasi hingga 20-35 meter)
 */
export function isCashierWithinBranchRadius(
  cashierLat: number,
  cashierLon: number,
  branchLat: number,
  branchLon: number,
  radiusMeters: number,
  gpsAccuracy?: number
): { isWithin: boolean; distance: number; effectiveDistance: number } {
  const distance = calculateDistanceMeters(cashierLat, cashierLon, branchLat, branchLon);
  // Berikan toleransi akurasi GPS (buffer maksimal hingga 35m jika perangkat kasir di dalam ruko/gedung)
  const accuracyBuffer = Math.min(Math.max(0, gpsAccuracy || 0), 35);
  const effectiveDistance = Math.max(0, distance - accuracyBuffer);
  const isWithin = effectiveDistance <= (radiusMeters || 150);

  return {
    isWithin,
    distance,
    effectiveDistance,
  };
}

/**
 * Dapatkan konfigurasi lokasi untuk semua cabang dari cache lokal
 */
export function getBranchLocations(): Record<string, BranchLocationConfig> {
  if (typeof window === "undefined") return DEFAULT_BRANCH_LOCATIONS;
  try {
    const raw = localStorage.getItem(BRANCH_CONFIG_KEY);
    if (!raw) {
      localStorage.setItem(BRANCH_CONFIG_KEY, JSON.stringify(DEFAULT_BRANCH_LOCATIONS));
      return DEFAULT_BRANCH_LOCATIONS;
    }
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_BRANCH_LOCATIONS, ...parsed };
  } catch {
    return DEFAULT_BRANCH_LOCATIONS;
  }
}

/**
 * Dapatkan konfigurasi lokasi satu cabang
 */
/**
 * Dapatkan konfigurasi lokasi satu cabang
 */
export function getBranchLocation(branchName: string): BranchLocationConfig {
  const all = getBranchLocations();
  if (all[branchName]) return all[branchName];

  // Cari case-insensitive & trimmed
  const cleanName = (branchName || "").trim().toLowerCase();
  const key = Object.keys(all).find((k) => k.trim().toLowerCase() === cleanName);
  if (key && all[key]) return all[key];

  // Default fallback jika belum pernah disetel sama sekali
  if (cleanName.includes("2")) {
    return (
      DEFAULT_BRANCH_LOCATIONS["Cabang 2"] || {
        branch_name: "Cabang 2",
        latitude: -6.215,
        longitude: 106.85,
        radius_meters: 150,
        address: "Cabang 2",
        updated_at: new Date().toISOString(),
      }
    );
  }

  return (
    DEFAULT_BRANCH_LOCATIONS["Cabang 1"] || {
      branch_name: "Cabang 1",
      latitude: -6.2088,
      longitude: 106.8456,
      radius_meters: 150,
      address: "Cabang 1",
      updated_at: new Date().toISOString(),
    }
  );
}

/**
 * Sinkronisasi konfigurasi lokasi cabang ke Supabase (tabel branches per cabang unik)
 */
export async function syncBranchLocationToSupabase(config: BranchLocationConfig): Promise<boolean> {
  try {
    const geoPayload = JSON.stringify({
      addr: config.address || config.branch_name,
      lat: config.latitude,
      lng: config.longitude,
      radius: config.radius_meters || 150,
      updated_at: new Date().toISOString(),
    });

    const targetBranch = config.branch_name.trim();

    // 1. Simpan/Update di tabel branches untuk cabang ini secara spesifik
    const { data: existingBranches } = await supabase
      .from("branches")
      .select("id, branch_name, shop_address")
      .ilike("branch_name", targetBranch)
      .limit(1);

    if (existingBranches && existingBranches.length > 0) {
      await supabase
        .from("branches")
        .update({
          shop_address: geoPayload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingBranches[0].id);
    } else {
      await supabase.from("branches").insert({
        branch_name: targetBranch,
        shop_name: "AMI Fried Chicken",
        shop_address: geoPayload,
      });
    }

    // 2. Broadcast update ke semua perangkat kasir yang sedang aktif via Realtime Channel
    try {
      const channel = supabase.channel("attendance_realtime_sync");
      channel.send({
        type: "broadcast",
        event: "branch_location_changed",
        payload: config,
      });
    } catch {}

    return true;
  } catch (err) {
    console.warn("Sinkronisasi lokasi cabang ke Supabase diabaikan/gagal:", err);
    return false;
  }
}

/**
 * Simpan konfigurasi lokasi cabang secara lokal dan sinkronisasikan ke Supabase Cloud
 */
export async function saveBranchLocation(config: BranchLocationConfig): Promise<boolean> {
  const updatedConfig: BranchLocationConfig = {
    ...config,
    branch_name: config.branch_name.trim(),
    latitude: Number(config.latitude.toFixed(6)),
    longitude: Number(config.longitude.toFixed(6)),
    radius_meters: Number(config.radius_meters) || 150,
    updated_at: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    try {
      const current = getBranchLocations();
      current[updatedConfig.branch_name] = updatedConfig;
      localStorage.setItem(BRANCH_CONFIG_KEY, JSON.stringify(current));

      // Picu event lokal
      window.dispatchEvent(new CustomEvent("branch_location_updated", { detail: updatedConfig }));
      window.dispatchEvent(new Event("attendance_updated"));
      window.dispatchEvent(new Event("storage"));
    } catch (e) {
      console.warn("Gagal simpan ke localStorage:", e);
    }
  }

  // Sinkronkan ke cloud Supabase
  return await syncBranchLocationToSupabase(updatedConfig);
}

/**
 * Muat konfigurasi lokasi cabang dari database Supabase dan perbarui cache lokal
 */
export async function loadBranchLocationsFromSupabase(): Promise<Record<string, BranchLocationConfig>> {
  try {
    const localMap = getBranchLocations();
    let hasUpdates = false;

    // Ambil semua data cabang dari tabel branches secara ketat per nama cabang
    const { data: branchRows, error: branchErr } = await supabase.from("branches").select("*");
    if (!branchErr && branchRows && branchRows.length > 0) {
      branchRows.forEach((b: any) => {
        if (!b.branch_name) return;
        const bName = b.branch_name.trim();
        if (b.shop_address && b.shop_address.includes('"lat"')) {
          try {
            const parsed = JSON.parse(b.shop_address);
            if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
              localMap[bName] = {
                branch_name: bName,
                latitude: Number(parsed.lat),
                longitude: Number(parsed.lng),
                radius_meters: Number(parsed.radius) || 150,
                address: parsed.addr || b.shop_address,
                updated_at: parsed.updated_at || b.updated_at,
              };
              hasUpdates = true;
            }
          } catch {}
        }
      });
    }

    if (hasUpdates && typeof window !== "undefined") {
      localStorage.setItem(BRANCH_CONFIG_KEY, JSON.stringify(localMap));
      window.dispatchEvent(new Event("attendance_updated"));
    }

    return localMap;
  } catch (err) {
    console.warn("loadBranchLocationsFromSupabase warning:", err);
    return getBranchLocations();
  }
}

/**
 * Format tanggal hari ini dalam format YYYY-MM-DD (waktu lokal)
 */
export function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Ambil semua riwayat absensi kasir dari cache lokal
 */
export function getAttendanceRecords(): AttendanceRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ATTENDANCE_RECORDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Cek apakah kasir sudah absen hari ini
 */
export function hasCashierCheckedInToday(
  userId?: string | null,
  userEmail?: string | null
): boolean {
  if (!userId && !userEmail) return false;
  const today = getTodayDateString();
  const records = getAttendanceRecords();
  const normalizedEmail = userEmail?.toLowerCase().trim();
  return records.some((r) => {
    if (r.date !== today) return false;
    if (userId && r.user_id === userId) return true;
    if (normalizedEmail && r.user_email && r.user_email.toLowerCase().trim() === normalizedEmail) return true;
    return false;
  });
}

/**
 * Dapatkan rekaman absensi hari ini untuk kasir
 */
export function getTodayAttendance(
  userId?: string | null,
  userEmail?: string | null
): AttendanceRecord | null {
  if (!userId && !userEmail) return null;
  const today = getTodayDateString();
  const records = getAttendanceRecords();
  const normalizedEmail = userEmail?.toLowerCase().trim();
  return (
    records.find((r) => {
      if (r.date !== today) return false;
      if (userId && r.user_id === userId) return true;
      if (normalizedEmail && r.user_email && r.user_email.toLowerCase().trim() === normalizedEmail) return true;
      return false;
    }) || null
  );
}

/**
 * Sinkronisasi data absensi kasir hari ini dari Supabase Cloud (Multi-Device Sync)
 * Mengambil record absensi kasir berdasarkan akun di database sehingga jika kasir
 * pindah perangkat (misal dari HP ke laptop/komputer kasir), status absensi tetap aktif.
 */
export async function syncTodayAttendanceFromCloud(
  userId?: string | null,
  userEmail?: string | null
): Promise<AttendanceRecord | null> {
  if (!userId && !userEmail) return null;
  const today = getTodayDateString();
  const normalizedEmail = userEmail?.toLowerCase().trim();

  try {
    // 1. Coba cari di tabel daily_reports untuk hari ini
    const { data: reports } = await supabase
      .from("daily_reports")
      .select("*")
      .eq("report_date", today)
      .order("created_at", { ascending: false });

    if (reports && reports.length > 0) {
      for (const rep of reports) {
        if (rep.note && rep.note.includes('"clock_in_time"')) {
          try {
            const parsedAtt = JSON.parse(rep.note) as AttendanceRecord;
            const matchesUser =
              (userId && (parsedAtt.user_id === userId || rep.created_by === userId)) ||
              (normalizedEmail &&
                parsedAtt.user_email &&
                parsedAtt.user_email.toLowerCase().trim() === normalizedEmail);

            if (matchesUser && parsedAtt.date === today) {
              // Update local cache
              const currentList = getAttendanceRecords();
              const merged = [
                parsedAtt,
                ...currentList.filter(
                  (r) =>
                    !(
                      r.date === today &&
                      ((userId && r.user_id === userId) ||
                        (normalizedEmail && r.user_email?.toLowerCase().trim() === normalizedEmail))
                    )
                ),
              ];
              if (typeof window !== "undefined") {
                localStorage.setItem(ATTENDANCE_RECORDS_KEY, JSON.stringify(merged));
                window.dispatchEvent(new Event("attendance_updated"));
                window.dispatchEvent(new Event("storage"));
              }
              return parsedAtt;
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn("syncTodayAttendanceFromCloud error:", err);
  }

  return getTodayAttendance(userId, userEmail);
}

/**
 * Catat absensi kasir baru (Masuk Shift - Cukup 1 Kali Per Hari Saja)
 * Menyimpan ke cache lokal dan langsung menyinkronkan ke Supabase Cloud
 */
export async function recordAttendance(payload: {
  userId: string;
  userEmail: string;
  cashierName?: string;
  branchName: string;
  latitude: number;
  longitude: number;
  notes?: string;
}): Promise<AttendanceRecord> {
  const today = getTodayDateString();
  const normalizedEmail = payload.userEmail.toLowerCase().trim();

  // 1. Cek apakah kasir sudah pernah absen hari ini (baik di perangkat ini maupun di cloud)
  const existingLocal = getTodayAttendance(payload.userId, payload.userEmail);
  if (existingLocal) {
    return existingLocal;
  }

  const existingCloud = await syncTodayAttendanceFromCloud(payload.userId, payload.userEmail);
  if (existingCloud) {
    return existingCloud;
  }

  const branchLoc = getBranchLocation(payload.branchName);
  const distance = calculateDistanceMeters(
    payload.latitude,
    payload.longitude,
    branchLoc.latitude,
    branchLoc.longitude
  );

  const isWithinRadius = distance <= (branchLoc.radius_meters || 150);
  const now = new Date();

  const record: AttendanceRecord = {
    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: payload.userId,
    user_email: payload.userEmail,
    cashier_name: payload.cashierName || payload.userEmail.split("@")[0],
    branch_name: payload.branchName,
    date: today,
    clock_in_time: now.toISOString(),
    latitude: payload.latitude,
    longitude: payload.longitude,
    branch_lat: branchLoc.latitude,
    branch_lng: branchLoc.longitude,
    distance_meters: distance,
    status: isWithinRadius ? "Hadir" : "Luar Radius",
    is_within_radius: isWithinRadius,
    notes: payload.notes || undefined,
  };

  // Simpan ke localStorage
  if (typeof window !== "undefined") {
    const existing = getAttendanceRecords();
    const updated = [
      record,
      ...existing.filter(
        (r) =>
          !(
            r.date === today &&
            ((payload.userId && r.user_id === payload.userId) ||
              (r.user_email && r.user_email.toLowerCase().trim() === normalizedEmail))
          )
      ),
    ];
    localStorage.setItem(ATTENDANCE_RECORDS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event("attendance_updated"));
    window.dispatchEvent(new Event("storage"));
  }

  // Sinkronkan ke Supabase Cloud (daily_reports & realtime broadcast)
  try {
    const notePayload = JSON.stringify(record);

    // Coba update atau insert ke daily_reports per akun kasir
    const { data: existingReport } = await supabase
      .from("daily_reports")
      .select("id")
      .eq("report_date", today)
      .eq("created_by", payload.userId)
      .limit(1);

    if (existingReport && existingReport.length > 0 && existingReport[0].id) {
      await supabase
        .from("daily_reports")
        .update({
          note: notePayload,
          branch_name: payload.branchName,
          updated_at: now.toISOString(),
        })
        .eq("id", existingReport[0].id);
    } else {
      await supabase.from("daily_reports").insert({
        report_date: today,
        initial_cash: 0,
        note: notePayload,
        created_by: payload.userId,
        branch_name: payload.branchName,
      });
    }

    // Broadcast ke channel realtime
    const channel = supabase.channel("attendance_realtime_sync");
    channel.send({
      type: "broadcast",
      event: "cashier_attendance_updated",
      payload: record,
    });
  } catch (err) {
    console.warn("Cloud sync recordAttendance warning:", err);
  }

  return record;
}

/**
 * Hapus catatan absensi (untuk reset admin)
 */
export function clearAttendanceRecords(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(ATTENDANCE_RECORDS_KEY);
    window.dispatchEvent(new Event("attendance_updated"));
  }
}

/**
 * Catat absensi pulang untuk kasir (hanya 1 kali dalam sehari, wajib verifikasi lokasi GPS cabang)
 */
export async function recordClockOut(payload: {
  userId: string;
  userEmail: string;
  latitude: number;
  longitude: number;
  branchName?: string;
  notes?: string;
}): Promise<AttendanceRecord> {
  const today = getTodayDateString();
  const records = getAttendanceRecords();
  const normalizedEmail = payload.userEmail.toLowerCase().trim();

  const recordIndex = records.findIndex((r) => {
    if (r.date !== today) return false;
    if (payload.userId && r.user_id === payload.userId) return true;
    if (r.user_email && r.user_email.toLowerCase().trim() === normalizedEmail) return true;
    return false;
  });

  if (recordIndex === -1) {
    throw new Error("Anda belum melakukan absen masuk hari ini. Silakan absen masuk terlebih dahulu.");
  }

  const currentRec = records[recordIndex];
  if (currentRec.clock_out_time) {
    throw new Error(
      `Anda sudah melakukan absen pulang hari ini pada pukul ${new Date(currentRec.clock_out_time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}.`
    );
  }

  const targetBranch = currentRec.branch_name || payload.branchName || "Cabang 1";
  const branchLoc = getBranchLocation(targetBranch);
  const distance = calculateDistanceMeters(
    payload.latitude,
    payload.longitude,
    branchLoc.latitude,
    branchLoc.longitude
  );
  const isWithinRadius = distance <= (branchLoc.radius_meters || 150);
  const now = new Date();

  // Jika kasir masih berada dalam sesi istirahat saat absen pulang, otomatis selesaikan sesi istirahat tersebut
  let updatedBreaks = currentRec.breaks || [];
  const openBreakIndex = updatedBreaks.findIndex((b) => !b.end_time);
  if (openBreakIndex !== -1) {
    const ob = updatedBreaks[openBreakIndex];
    const duration = Math.max(1, Math.round((now.getTime() - new Date(ob.start_time).getTime()) / 60000));
    updatedBreaks = [
      ...updatedBreaks.slice(0, openBreakIndex),
      { ...ob, end_time: now.toISOString(), duration_minutes: duration },
      ...updatedBreaks.slice(openBreakIndex + 1),
    ];
  }

  const updatedRecord: AttendanceRecord = {
    ...currentRec,
    clock_out_time: now.toISOString(),
    clock_out_latitude: payload.latitude,
    clock_out_longitude: payload.longitude,
    clock_out_distance_meters: distance,
    clock_out_is_within_radius: isWithinRadius,
    status: isWithinRadius ? "Selesai Shift" : "Luar Radius",
    breaks: updatedBreaks,
    notes: payload.notes || currentRec.notes,
  };

  records[recordIndex] = updatedRecord;
  if (typeof window !== "undefined") {
    localStorage.setItem(ATTENDANCE_RECORDS_KEY, JSON.stringify(records));
    window.dispatchEvent(new Event("attendance_updated"));
  }

  // Update ke Supabase Cloud
  try {
    const notePayload = JSON.stringify(updatedRecord);
    const { data: existingReport } = await supabase
      .from("daily_reports")
      .select("id")
      .eq("report_date", today)
      .eq("created_by", payload.userId)
      .limit(1);

    if (existingReport && existingReport.length > 0 && existingReport[0].id) {
      await supabase
        .from("daily_reports")
        .update({
          note: notePayload,
          updated_at: now.toISOString(),
        })
        .eq("id", existingReport[0].id);
    }

    const channel = supabase.channel("attendance_realtime_sync");
    channel.send({
      type: "broadcast",
      event: "cashier_attendance_updated",
      payload: updatedRecord,
    });
  } catch {}

  return updatedRecord;
}

/**
 * Mulai sesi istirahat untuk kasir (bisa dilakukan lebih dari 1 kali per hari)
 */
export async function startBreak(payload: {
  userId: string;
  userEmail: string;
}): Promise<AttendanceRecord> {
  const today = getTodayDateString();
  const records = getAttendanceRecords();
  const normalizedEmail = payload.userEmail.toLowerCase().trim();

  const recordIndex = records.findIndex((r) => {
    if (r.date !== today) return false;
    if (payload.userId && r.user_id === payload.userId) return true;
    if (r.user_email && r.user_email.toLowerCase().trim() === normalizedEmail) return true;
    return false;
  });

  if (recordIndex === -1) {
    throw new Error("Anda belum melakukan absen masuk hari ini.");
  }

  const currentRec = records[recordIndex];
  if (currentRec.clock_out_time) {
    throw new Error("Anda sudah menyelesaikan absen pulang untuk shift hari ini.");
  }

  const breaks = currentRec.breaks || [];
  const openBreak = breaks.find((b) => !b.end_time);
  if (openBreak) {
    throw new Error("Anda sedang dalam sesi istirahat aktif.");
  }

  const newBreak: AttendanceBreak = {
    id: `brk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    start_time: new Date().toISOString(),
  };

  const updatedRecord: AttendanceRecord = {
    ...currentRec,
    breaks: [...breaks, newBreak],
  };

  records[recordIndex] = updatedRecord;
  if (typeof window !== "undefined") {
    localStorage.setItem(ATTENDANCE_RECORDS_KEY, JSON.stringify(records));
    window.dispatchEvent(new Event("attendance_updated"));
  }

  // Cloud sync
  try {
    const notePayload = JSON.stringify(updatedRecord);
    await supabase
      .from("daily_reports")
      .update({ note: notePayload })
      .eq("report_date", today)
      .eq("created_by", payload.userId);
  } catch {}

  return updatedRecord;
}

/**
 * Selesai / Kembali dari istirahat untuk kasir
 */
export async function endBreak(payload: {
  userId: string;
  userEmail: string;
}): Promise<AttendanceRecord> {
  const today = getTodayDateString();
  const records = getAttendanceRecords();
  const normalizedEmail = payload.userEmail.toLowerCase().trim();

  const recordIndex = records.findIndex((r) => {
    if (r.date !== today) return false;
    if (payload.userId && r.user_id === payload.userId) return true;
    if (r.user_email && r.user_email.toLowerCase().trim() === normalizedEmail) return true;
    return false;
  });

  if (recordIndex === -1) {
    throw new Error("Anda belum melakukan absen masuk hari ini.");
  }

  const currentRec = records[recordIndex];
  const breaks = currentRec.breaks || [];
  const openBreakIndex = breaks.findIndex((b) => !b.end_time);

  if (openBreakIndex === -1) {
    throw new Error("Tidak ada sesi istirahat yang sedang berjalan.");
  }

  const now = new Date();
  const openBreak = breaks[openBreakIndex];
  const duration = Math.max(1, Math.round((now.getTime() - new Date(openBreak.start_time).getTime()) / 60000));

  const updatedBreaks = [
    ...breaks.slice(0, openBreakIndex),
    {
      ...openBreak,
      end_time: now.toISOString(),
      duration_minutes: duration,
    },
    ...breaks.slice(openBreakIndex + 1),
  ];

  const updatedRecord: AttendanceRecord = {
    ...currentRec,
    breaks: updatedBreaks,
  };

  records[recordIndex] = updatedRecord;
  if (typeof window !== "undefined") {
    localStorage.setItem(ATTENDANCE_RECORDS_KEY, JSON.stringify(records));
    window.dispatchEvent(new Event("attendance_updated"));
  }

  // Cloud sync
  try {
    const notePayload = JSON.stringify(updatedRecord);
    await supabase
      .from("daily_reports")
      .update({ note: notePayload })
      .eq("report_date", today)
      .eq("created_by", payload.userId);
  } catch {}

  return updatedRecord;
}

/**
 * Dapatkan status sesi istirahat aktif kasir
 */
export function getActiveBreak(
  userId?: string | null,
  userEmail?: string | null
): AttendanceBreak | null {
  const todayRec = getTodayAttendance(userId, userEmail);
  if (!todayRec || !todayRec.breaks) return null;
  return todayRec.breaks.find((b) => !b.end_time) || null;
}

/**
 * Cek apakah kasir sudah absen pulang hari ini
 */
export function hasCashierClockedOutToday(
  userId?: string | null,
  userEmail?: string | null
): boolean {
  const todayRec = getTodayAttendance(userId, userEmail);
  return !!todayRec?.clock_out_time;
}

/**
 * Hitung total menit istirahat kasir
 */
export function getTotalBreakMinutes(breaks?: AttendanceBreak[]): number {
  if (!breaks || breaks.length === 0) return 0;
  return breaks.reduce((acc, b) => {
    if (typeof b.duration_minutes === "number") return acc + b.duration_minutes;
    if (b.start_time && b.end_time) {
      const diff = Math.max(0, Math.round((new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 60000));
      return acc + diff;
    }
    return acc;
  }, 0);
}


