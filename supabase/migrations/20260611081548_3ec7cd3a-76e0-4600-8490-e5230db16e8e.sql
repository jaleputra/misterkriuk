ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url text;

CREATE POLICY "Public read product images" ON storage.objects FOR SELECT USING (bucket_id = 'product-images');
CREATE POLICY "Auth upload product images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "Auth update product images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'product-images');
CREATE POLICY "Auth delete product images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'product-images');