CREATE TABLE public.event_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('percent_discount','fixed_discount','set_price')),
  adjustment_value numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, product_id)
);

GRANT SELECT ON public.event_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_items TO authenticated;
GRANT ALL ON public.event_items TO service_role;

ALTER TABLE public.event_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_items readable by all"
  ON public.event_items FOR SELECT
  USING (true);

CREATE POLICY "event_items admin insert"
  ON public.event_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "event_items admin update"
  ON public.event_items FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "event_items admin delete"
  ON public.event_items FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_event_items_updated_at
  BEFORE UPDATE ON public.event_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_event_items_event ON public.event_items(event_id);
CREATE INDEX idx_event_items_product ON public.event_items(product_id);