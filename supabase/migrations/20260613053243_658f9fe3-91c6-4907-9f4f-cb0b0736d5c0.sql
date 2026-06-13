ALTER TABLE public.products
  ADD COLUMN category text NOT NULL DEFAULT 'customer'
  CHECK (category IN ('customer', 'partner'));

ALTER TABLE public.transactions
  ADD COLUMN sale_category text NOT NULL DEFAULT 'customer'
    CHECK (sale_category IN ('customer', 'partner')),
  ADD COLUMN partner_name text;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_partner_name_required
  CHECK (sale_category = 'customer' OR nullif(btrim(partner_name), '') IS NOT NULL);

ALTER TABLE public.transaction_items
  ADD COLUMN cost_price numeric(12,2) NOT NULL DEFAULT 0;

UPDATE public.transaction_items ti
SET cost_price = COALESCE((
  SELECT sm.initial_price
  FROM public.stock_movements sm
  JOIN public.transactions t ON t.id = ti.transaction_id
  WHERE sm.product_id = ti.product_id
    AND sm.created_at <= t.created_at
  ORDER BY sm.created_at DESC
  LIMIT 1
), 0);

CREATE TABLE public.stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restock_date date NOT NULL DEFAULT CURRENT_DATE,
  shipping_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_entries TO authenticated;
GRANT ALL ON public.stock_entries TO service_role;
ALTER TABLE public.stock_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Stock entries readable by authenticated" ON public.stock_entries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert stock entries" ON public.stock_entries
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update stock entries" ON public.stock_entries
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete stock entries" ON public.stock_entries
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_stock_entries_updated_at
  BEFORE UPDATE ON public.stock_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.stock_movements
  ADD COLUMN stock_entry_id uuid REFERENCES public.stock_entries(id) ON DELETE CASCADE,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

GRANT UPDATE, DELETE ON public.stock_movements TO authenticated;
CREATE POLICY "Admins update stock movements" ON public.stock_movements
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete stock movements" ON public.stock_movements
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_stock_movements_updated_at
  BEFORE UPDATE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.products
      SET stock = stock + NEW.quantity, updated_at = now()
      WHERE id = NEW.product_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.product_id = NEW.product_id THEN
      UPDATE public.products
        SET stock = GREATEST(0, stock + NEW.quantity - OLD.quantity), updated_at = now()
        WHERE id = NEW.product_id;
    ELSE
      UPDATE public.products
        SET stock = GREATEST(0, stock - OLD.quantity), updated_at = now()
        WHERE id = OLD.product_id;
      UPDATE public.products
        SET stock = stock + NEW.quantity, updated_at = now()
        WHERE id = NEW.product_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.products
      SET stock = GREATEST(0, stock - OLD.quantity), updated_at = now()
      WHERE id = OLD.product_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_stock_movement_insert ON public.stock_movements;
CREATE TRIGGER on_stock_movement_change
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

CREATE INDEX idx_products_category ON public.products(category);
CREATE INDEX idx_transactions_sale_category ON public.transactions(sale_category);
CREATE INDEX idx_stock_movements_entry ON public.stock_movements(stock_entry_id);
CREATE INDEX idx_stock_entries_restock_date ON public.stock_entries(restock_date DESC);