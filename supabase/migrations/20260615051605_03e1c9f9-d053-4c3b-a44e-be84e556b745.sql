REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated insert items" ON public.transaction_items;
CREATE POLICY "Cashiers insert items for own transactions"
ON public.transaction_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.id = transaction_id
      AND t.cashier_id = auth.uid()
  )
);