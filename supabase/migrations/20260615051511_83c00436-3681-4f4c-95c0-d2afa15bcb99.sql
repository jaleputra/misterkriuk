ALTER TABLE public.transactions
  ADD COLUMN buyer_name TEXT,
  ADD COLUMN house_block TEXT;

COMMENT ON COLUMN public.transactions.buyer_name IS 'Nama pembeli yang dicantumkan pada struk';
COMMENT ON COLUMN public.transactions.house_block IS 'Blok rumah pembeli yang dicantumkan pada struk';