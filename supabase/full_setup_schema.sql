-- ============================================================================
-- FULL SCHEMA SETUP UNTUK PROJECT SUPABASE BARU (MR KRIUK AMI POS)
-- ============================================================================
-- Gunakan script ini di Supabase Dashboard -> SQL Editor jika Anda membuat
-- project Supabase gratis baru untuk langsung mendapatkan kuota 5 GB Egress baru.

-- 1. Enum Role
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'cashier');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Helper Function: update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 3. Tabel Profiles & User Roles (Data Akun)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;
CREATE POLICY "Profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  branch_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

DROP POLICY IF EXISTS "Roles readable by authenticated" ON public.user_roles;
CREATE POLICY "Roles readable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage own or admin roles" ON public.user_roles;
CREATE POLICY "Authenticated manage own or admin roles" ON public.user_roles FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Trigger otomatis konfirmasi email & buat profile + role saat user daftar
CREATE OR REPLACE FUNCTION public.auto_confirm_user_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_auth_user_created_confirm ON auth.users;
CREATE TRIGGER before_auth_user_created_confirm
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_user_email();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INTEGER;
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 OR lower(NEW.email) = 'jaleputra69@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cashier') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Tabel Branches (Cabang)
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

DROP POLICY IF EXISTS "Allow all authenticated on branches" ON public.branches;
CREATE POLICY "Allow all authenticated on branches" ON public.branches FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Tabel Products (Menu & Gudang)
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'customer',
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL PRIVILEGES ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated on products" ON public.products;
CREATE POLICY "Allow all authenticated on products" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. Tabel Stock Entries & Stock Movements (Gudang & Pengeluaran)
CREATE TABLE IF NOT EXISTS public.stock_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_name TEXT,
  restock_date DATE NOT NULL DEFAULT CURRENT_DATE,
  shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'qris')),
  entry_type TEXT NOT NULL DEFAULT 'expense' CHECK (entry_type IN ('expense', 'restock')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL PRIVILEGES ON public.stock_entries TO authenticated;
GRANT ALL ON public.stock_entries TO service_role;
ALTER TABLE public.stock_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated on stock_entries" ON public.stock_entries;
CREATE POLICY "Allow all authenticated on stock_entries" ON public.stock_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_entry_id UUID REFERENCES public.stock_entries(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  initial_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL PRIVILEGES ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated on stock_movements" ON public.stock_movements;
CREATE POLICY "Allow all authenticated on stock_movements" ON public.stock_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.products SET stock = stock + NEW.quantity, updated_at = now() WHERE id = NEW.product_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.product_id = NEW.product_id THEN
      UPDATE public.products SET stock = GREATEST(0, stock + NEW.quantity - OLD.quantity), updated_at = now() WHERE id = NEW.product_id;
    ELSE
      UPDATE public.products SET stock = GREATEST(0, stock - OLD.quantity), updated_at = now() WHERE id = OLD.product_id;
      UPDATE public.products SET stock = stock + NEW.quantity, updated_at = now() WHERE id = NEW.product_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.products SET stock = GREATEST(0, stock - OLD.quantity), updated_at = now() WHERE id = OLD.product_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_stock_movement_change ON public.stock_movements;
CREATE TRIGGER on_stock_movement_change
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

-- 7. Tabel Transactions & Transaction Items
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_name TEXT,
  buyer_name TEXT,
  house_block TEXT,
  partner_name TEXT,
  sale_category TEXT NOT NULL DEFAULT 'customer',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'qris')),
  total NUMERIC(12,2) NOT NULL,
  discount_amount NUMERIC DEFAULT 0,
  cash_received NUMERIC(12,2),
  change_amount NUMERIC(12,2),
  cashier_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL PRIVILEGES ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated on transactions" ON public.transactions;
CREATE POLICY "Allow all authenticated on transactions" ON public.transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  product_name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL
);
GRANT ALL PRIVILEGES ON public.transaction_items TO authenticated;
GRANT ALL ON public.transaction_items TO service_role;
ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated on transaction_items" ON public.transaction_items;
CREATE POLICY "Allow all authenticated on transaction_items" ON public.transaction_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8. Tabel Daily Reports
CREATE TABLE IF NOT EXISTS public.daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  branch_name TEXT DEFAULT 'Cabang 1',
  initial_cash NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT daily_reports_date_branch_unique UNIQUE (report_date, branch_name)
);
GRANT ALL PRIVILEGES ON public.daily_reports TO authenticated;
GRANT ALL ON public.daily_reports TO service_role;
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and cashiers manage daily_reports" ON public.daily_reports;
CREATE POLICY "Admins and cashiers manage daily_reports" ON public.daily_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 9. Tabel Events & Event Items
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  event_date DATE NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('percent_discount', 'fixed_discount', 'set_price')),
  adjustment_value NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL PRIVILEGES ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated on events" ON public.events;
CREATE POLICY "Allow all authenticated on events" ON public.events FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.event_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('percent_discount', 'fixed_discount', 'set_price')),
  adjustment_value NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, product_id)
);
GRANT ALL PRIVILEGES ON public.event_items TO authenticated;
GRANT ALL ON public.event_items TO service_role;
ALTER TABLE public.event_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated on event_items" ON public.event_items;
CREATE POLICY "Allow all authenticated on event_items" ON public.event_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 10. Tabel Printer Settings
CREATE TABLE IF NOT EXISTS public.printer_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  branch_name TEXT,
  printer_name TEXT,
  paper_width INTEGER DEFAULT 58,
  shop_name TEXT DEFAULT 'Mr Kriuk Ami',
  shop_address TEXT,
  shop_phone TEXT,
  whatsapp_number TEXT,
  qris_payload TEXT,
  qris_image_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL PRIVILEGES ON public.printer_settings TO authenticated;
GRANT ALL ON public.printer_settings TO service_role;
ALTER TABLE public.printer_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated on printer_settings" ON public.printer_settings;
CREATE POLICY "Allow all authenticated on printer_settings" ON public.printer_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.printer_settings (id, shop_name) VALUES (1, 'Mr Kriuk Ami') ON CONFLICT (id) DO NOTHING;

