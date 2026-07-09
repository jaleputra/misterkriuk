-- 1. Allow both admins and cashiers to update transactions (for editing transactions on dashboard)
DROP POLICY IF EXISTS "Admins can update transactions" ON public.transactions;
CREATE POLICY "Admins and cashiers can update transactions" ON public.transactions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cashier'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cashier'));

-- 2. Allow both admins and cashiers to insert stock entries (for creating expense entries)
DROP POLICY IF EXISTS "Admins insert stock entries" ON public.stock_entries;
CREATE POLICY "Admins and cashiers insert stock entries" ON public.stock_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cashier'));

-- 3. Allow both admins and cashiers to insert stock movements (for creating stock movement items under expense entry)
DROP POLICY IF EXISTS "Admins insert stock" ON public.stock_movements;
CREATE POLICY "Admins and cashiers insert stock" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'cashier'));
