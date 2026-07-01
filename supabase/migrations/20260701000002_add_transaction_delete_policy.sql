-- Grant UPDATE and DELETE permissions to authenticated role
GRANT UPDATE, DELETE ON public.transactions TO authenticated;
GRANT UPDATE, DELETE ON public.transaction_items TO authenticated;

-- Allow admins to delete transactions
DROP POLICY IF EXISTS "Admins can delete transactions" ON public.transactions;
CREATE POLICY "Admins can delete transactions" ON public.transactions
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to delete transaction items
DROP POLICY IF EXISTS "Admins can delete transaction items" ON public.transaction_items;
CREATE POLICY "Admins can delete transaction items" ON public.transaction_items
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to update transactions
DROP POLICY IF EXISTS "Admins can update transactions" ON public.transactions;
CREATE POLICY "Admins can update transactions" ON public.transactions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Allow admins to update transaction items
DROP POLICY IF EXISTS "Admins can update transaction items" ON public.transaction_items;
CREATE POLICY "Admins can update transaction items" ON public.transaction_items
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
