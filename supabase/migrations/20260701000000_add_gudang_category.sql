-- Drop the check constraint on products.category if it exists, and recreate it to include 'gudang' and support soft-deleted categories
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_category_check;
ALTER TABLE public.products ADD CONSTRAINT products_category_check CHECK (
  category IN ('customer', 'partner', 'gudang') OR 
  category LIKE 'deleted_%'
);
