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

// Default cabang locations jika belum disetel
export const DEFAULT_BRANCH_LOCATIONS: Record<string, BranchLocationConfig> = {
  "Cabang 1": {
    branch_name: "Cabang 1",
    latitude: -6.2088,
    longitude: 106.8456,
    radius_meters: 100,
    address: "Pusat - Cabang 1",
    updated_at: new Date().toISOString(),
  },
  "Cabang 2": {
    branch_name: "Cabang 2",
    latitude: -6.2150,
    longitude: 106.8500,
    radius_meters: 100,
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
 * Dapatkan konfigurasi lokasi untuk semua cabang
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
export function getBranchLocation(branchName: string): BranchLocationConfig {
  const all = getBranchLocations();
  if (all[branchName]) return all[branchName];

  // Cari case-insensitive
  const key = Object.keys(all).find((k) => k.toLowerCase() === branchName.toLowerCase());
  if (key && all[key]) return all[key];

  // Default fallback
  return {
    branch_name: branchName,
    latitude: -6.2088,
    longitude: 106.8456,
    radius_meters: 100,
    address: branchName,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Simpan konfigurasi lokasi cabang
 */
export function saveBranchLocation(config: BranchLocationConfig): void {
  if (typeof window === "undefined") return;
  try {
    const current = getBranchLocations();
    current[config.branch_name] = {
      ...config,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(BRANCH_CONFIG_KEY, JSON.stringify(current));
  } catch (err) {
    console.warn("Gagal menyimpan lokasi cabang:", err);
  }
}

/**
 * Format tanggal hari ini dalam format YYYY-MM-DD
 */
export function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Ambil semua riwayat absensi kasir
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
 * Catat absensi kasir baru
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
  const branchLoc = getBranchLocation(payload.branchName);
  const distance = calculateDistanceMeters(
    payload.latitude,
    payload.longitude,
    branchLoc.latitude,
    branchLoc.longitude
  );

  const isWithinRadius = distance <= branchLoc.radius_meters;
  const now = new Date();
  const today = getTodayDateString();
  const normalizedEmail = payload.userEmail.toLowerCase().trim();

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
  }

  // Coba simpan ke Supabase attendances table jika ada
  try {
    await supabase.from("attendances" as any).insert({
      id: record.id,
      user_id: record.user_id,
      user_email: record.user_email,
      branch_name: record.branch_name,
      date: record.date,
      clock_in_time: record.clock_in_time,
      latitude: record.latitude,
      longitude: record.longitude,
      distance_meters: record.distance_meters,
      status: record.status,
      is_within_radius: record.is_within_radius,
    } as any);
  } catch (err) {
    // Ignore if table does not exist
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
  const isWithinRadius = distance <= branchLoc.radius_meters;
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

  // Update Supabase jika tabel tersedia
  try {
    await supabase
      .from("attendances" as any)
      .update({
        clock_out_time: updatedRecord.clock_out_time,
        status: updatedRecord.status,
      } as any)
      .eq("id", updatedRecord.id);
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

