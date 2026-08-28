-- Add branch_name column to printer_settings table
ALTER TABLE public.printer_settings ADD COLUMN IF NOT EXISTS branch_name TEXT;
