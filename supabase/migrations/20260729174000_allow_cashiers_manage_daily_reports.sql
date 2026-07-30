-- Allow both admins and cashiers to manage daily reports (input & save initial cash, notes, etc.)
DROP POLICY IF EXISTS "Admins manage daily_reports" ON public.daily_reports;

CREATE POLICY "Admins and cashiers manage daily_reports"
  ON public.daily_reports FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cashier'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cashier'));
