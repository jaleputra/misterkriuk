
-- Add payment method to stock entries (expenses)
ALTER TABLE public.stock_entries
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash'
  CHECK (payment_method IN ('cash','qris'));

-- Daily reports (initial cash per date)
CREATE TABLE IF NOT EXISTS public.daily_reports (
  report_date date PRIMARY KEY,
  initial_cash numeric NOT NULL DEFAULT 0,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_reports TO authenticated;
GRANT ALL ON public.daily_reports TO service_role;

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage daily_reports"
  ON public.daily_reports FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read daily_reports"
  ON public.daily_reports FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER trg_daily_reports_updated
  BEFORE UPDATE ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
