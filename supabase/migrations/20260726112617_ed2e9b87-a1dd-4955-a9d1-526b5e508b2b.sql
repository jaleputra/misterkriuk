ALTER TABLE public.stock_entries
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'expense';

ALTER TABLE public.stock_entries
  DROP CONSTRAINT IF EXISTS stock_entries_entry_type_check;

ALTER TABLE public.stock_entries
  ADD CONSTRAINT stock_entries_entry_type_check CHECK (entry_type IN ('expense', 'restock'));

CREATE INDEX IF NOT EXISTS stock_entries_entry_type_idx ON public.stock_entries (entry_type);