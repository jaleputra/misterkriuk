-- Drop any check constraints on products.category dynamically to ensure we get the correct constraint name
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conrelid = 'public.products'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%category%'
    LOOP
        EXECUTE 'ALTER TABLE public.products DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

-- Add the updated constraint that allows 'gudang' and 'deleted_%'
ALTER TABLE public.products ADD CONSTRAINT products_category_check CHECK (
  category IN ('customer', 'partner', 'gudang') OR 
  category LIKE 'deleted_%'
);
