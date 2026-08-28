CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name TEXT NOT NULL DEFAULT 'AMI Fried Chicken',
  branch_name TEXT NOT NULL,
  shop_address TEXT,
  shop_phone TEXT,
  whatsapp_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Branches readable by authenticated" ON public.branches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage branches" ON public.branches
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
