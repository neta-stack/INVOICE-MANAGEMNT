# Supabase Setup

## 1. Create the `invoices` table

In Supabase Dashboard → SQL Editor, run the contents of `supabase/schema.sql`.

## 2. Create Storage bucket

1. Go to **Storage** in Supabase Dashboard
2. Click **New bucket**
3. Name: `invoices`
4. Enable **Public bucket** (so invoice PDFs can be viewed via URL)
5. Click **Create bucket**

## 3. Storage RLS policies

Add these policies for the `invoices` bucket:

**Allow upload** (authenticated users to their folder):
- Policy name: `Users can upload to own folder`
- Allowed operation: INSERT
- Policy: `(storage.foldername(name))[1] = auth.uid()::text`

**Allow read** (users can read their files):
- Policy name: `Users can read own files`
- Allowed operation: SELECT
- Policy: `(storage.foldername(name))[1] = auth.uid()::text`

**Allow delete** (users can delete their files):
- Policy name: `Users can delete own files`
- Allowed operation: DELETE
- Policy: `(storage.foldername(name))[1] = auth.uid()::text`

## 4. Environment variables

Add to `.env` (and Vercel Environment Variables):

```
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

Get these from Supabase Dashboard → Settings → API.
