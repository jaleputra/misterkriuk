-- Add QRIS columns to printer_settings table
ALTER TABLE public.printer_settings ADD COLUMN IF NOT EXISTS qris_payload TEXT;
ALTER TABLE public.printer_settings ADD COLUMN IF NOT EXISTS qris_image_url TEXT;
