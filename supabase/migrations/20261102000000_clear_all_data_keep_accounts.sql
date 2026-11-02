-- ============================================================================
-- HAPUS SEMUA DATA OPERASIONAL (TRANSAKSI, STOK, LAPORAN, MENU, EVENT)
-- KECUALI DATA AKUN (auth.users, public.profiles, public.user_roles)
-- ============================================================================
-- Jalankan script ini di Supabase Dashboard -> SQL Editor -> New Query -> Run

BEGIN;

-- 1. Hapus semua item transaksi & riwayat transaksi penjualan
TRUNCATE TABLE public.transaction_items CASCADE;
TRUNCATE TABLE public.transactions CASCADE;

-- 2. Hapus semua pergerakan stok & riwayat pengeluaran/restock gudang
TRUNCATE TABLE public.stock_movements CASCADE;
TRUNCATE TABLE public.stock_entries CASCADE;

-- 3. Hapus semua item event & daftar event promo
TRUNCATE TABLE public.event_items CASCADE;
TRUNCATE TABLE public.events CASCADE;

-- 4. Hapus semua laporan kas harian & absensi harian
TRUNCATE TABLE public.daily_reports CASCADE;

-- 5. Hapus semua produk/menu (termasuk foto base64 berukuran besar)
TRUNCATE TABLE public.products CASCADE;

-- 6. Bersihkan riwayat absensi yang menumpuk di JSON shop_address pada tabel branches
--    namun tetap pertahankan data cabang & titik koordinat cabang
UPDATE public.branches
SET shop_address = (
  CASE
    WHEN shop_address IS NOT NULL AND shop_address LIKE '{%' THEN
      (shop_address::jsonb - 'attendances')::text
    ELSE
      shop_address
  END
),
updated_at = now();

-- 7. Bersihkan gambar QRIS base64 berukuran besar di printer_settings
--    (qris_payload teks EMVCo tetap dipertahankan agar QRIS Dinamis tetap jalan)
UPDATE public.printer_settings
SET qris_image_url = NULL,
    updated_at = now();

-- 8. Hapus file gambar di Supabase Storage (jika ada) untuk menghemat kuota
DELETE FROM storage.objects WHERE bucket_id = 'product-images';

-- CATATAN:
-- Tabel akun berikut TIDAK DIHAPUS sama sekali:
--   - auth.users (email & password login)
--   - public.profiles (nama & email profil pengguna)
--   - public.user_roles (role admin / cashier & penugasan cabang)

COMMIT;

