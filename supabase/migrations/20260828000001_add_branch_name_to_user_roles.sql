-- Add branch_name column to user_roles table
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS branch_name TEXT;
