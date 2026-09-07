-- Migration: Multi-branch daily reports support
-- Ensure id column exists with default UUID
ALTER TABLE public.daily_reports 
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- Ensure branch_name column exists
ALTER TABLE public.daily_reports 
  ADD COLUMN IF NOT EXISTS branch_name TEXT DEFAULT 'Cabang 1';

-- Drop single primary key on report_date if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'daily_reports_pkey' 
      AND table_name = 'daily_reports'
  ) THEN
    ALTER TABLE public.daily_reports DROP CONSTRAINT daily_reports_pkey;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- Populate missing branch_names
UPDATE public.daily_reports 
SET branch_name = 'Cabang 1' 
WHERE branch_name IS NULL OR trim(branch_name) = '';

-- Ensure id is not null and set as primary key
UPDATE public.daily_reports 
SET id = gen_random_uuid() 
WHERE id IS NULL;

ALTER TABLE public.daily_reports 
  ALTER COLUMN id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_type = 'PRIMARY KEY' 
      AND table_name = 'daily_reports'
  ) THEN
    ALTER TABLE public.daily_reports ADD PRIMARY KEY (id);
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- Unique constraint for (report_date, branch_name) so each branch has 1 report per date
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'daily_reports_date_branch_unique'
  ) THEN
    ALTER TABLE public.daily_reports 
      ADD CONSTRAINT daily_reports_date_branch_unique UNIQUE (report_date, branch_name);
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- Policies
DROP POLICY IF EXISTS "Admins and cashiers manage daily_reports" ON public.daily_reports;
DROP POLICY IF EXISTS "Admins manage daily_reports" ON public.daily_reports;
DROP POLICY IF EXISTS "Authenticated read daily_reports" ON public.daily_reports;

CREATE POLICY "Admins and cashiers manage daily_reports"
  ON public.daily_reports FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
