-- Add discount_amount column to transactions table
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0;
