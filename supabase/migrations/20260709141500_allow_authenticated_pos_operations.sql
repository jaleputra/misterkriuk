-- 1. Products: Allow all actions (SELECT, INSERT, UPDATE, DELETE) to authenticated users
DROP POLICY IF EXISTS "Admins manage products" ON public.products;
DROP POLICY IF EXISTS "Cashiers can update product stock" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can update products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can insert products" ON public.products;
DROP POLICY IF EXISTS "Allow all authenticated on products" ON public.products;

CREATE POLICY "Allow all authenticated on products" ON public.products
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- 2. Transactions: Allow all actions to authenticated users
DROP POLICY IF EXISTS "Transactions readable by authenticated" ON public.transactions;
DROP POLICY IF EXISTS "Authenticated insert transactions" ON public.transactions;
DROP POLICY IF EXISTS "Admins can delete transactions" ON public.transactions;
DROP POLICY IF EXISTS "Admins can update transactions" ON public.transactions;
DROP POLICY IF EXISTS "Admins and cashiers can update transactions" ON public.transactions;
DROP POLICY IF EXISTS "Authenticated users can update transactions" ON public.transactions;
DROP POLICY IF EXISTS "Allow all authenticated on transactions" ON public.transactions;

CREATE POLICY "Allow all authenticated on transactions" ON public.transactions
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Transaction Items: Allow all actions to authenticated users
DROP POLICY IF EXISTS "Items readable by authenticated" ON public.transaction_items;
DROP POLICY IF EXISTS "Authenticated insert items" ON public.transaction_items;
DROP POLICY IF EXISTS "Cashiers insert items for own transactions" ON public.transaction_items;
DROP POLICY IF EXISTS "Admins can delete transaction items" ON public.transaction_items;
DROP POLICY IF EXISTS "Admins can update transaction items" ON public.transaction_items;
DROP POLICY IF EXISTS "Allow all authenticated on transaction_items" ON public.transaction_items;

CREATE POLICY "Allow all authenticated on transaction_items" ON public.transaction_items
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. Stock Entries: Cashiers/admins can read/insert, ONLY admins can update/delete
DROP POLICY IF EXISTS "Stock entries readable by authenticated" ON public.stock_entries;
DROP POLICY IF EXISTS "Admins insert stock entries" ON public.stock_entries;
DROP POLICY IF EXISTS "Admins update stock entries" ON public.stock_entries;
DROP POLICY IF EXISTS "Admins delete stock entries" ON public.stock_entries;
DROP POLICY IF EXISTS "Admins and cashiers insert stock entries" ON public.stock_entries;
DROP POLICY IF EXISTS "Authenticated users insert stock entries" ON public.stock_entries;
DROP POLICY IF EXISTS "Allow all authenticated on stock_entries" ON public.stock_entries;

CREATE POLICY "Authenticated select stock_entries" ON public.stock_entries
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated insert stock_entries" ON public.stock_entries
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins update stock_entries" ON public.stock_entries
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete stock_entries" ON public.stock_entries
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5. Stock Movements: Cashiers/admins can read/insert, ONLY admins can update/delete
DROP POLICY IF EXISTS "Stock readable by authenticated" ON public.stock_movements;
DROP POLICY IF EXISTS "Admins insert stock" ON public.stock_movements;
DROP POLICY IF EXISTS "Admins update stock movements" ON public.stock_movements;
DROP POLICY IF EXISTS "Admins delete stock movements" ON public.stock_movements;
DROP POLICY IF EXISTS "Admins and cashiers insert stock" ON public.stock_movements;
DROP POLICY IF EXISTS "Authenticated users insert stock" ON public.stock_movements;
DROP POLICY IF EXISTS "Allow all authenticated on stock_movements" ON public.stock_movements;

CREATE POLICY "Authenticated select stock_movements" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated insert stock_movements" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins update stock_movements" ON public.stock_movements
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete stock_movements" ON public.stock_movements
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 6. Grant privileges on these tables to authenticated users
GRANT ALL PRIVILEGES ON public.products TO authenticated;
GRANT ALL PRIVILEGES ON public.transactions TO authenticated;
GRANT ALL PRIVILEGES ON public.transaction_items TO authenticated;
GRANT ALL PRIVILEGES ON public.stock_entries TO authenticated;
GRANT ALL PRIVILEGES ON public.stock_movements TO authenticated;
