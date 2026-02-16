# Invoice Management – User Guide

## What is this app?

An **invoice management** app that runs in your web browser. You can:

- **Sign in** with email and password (create an account if you don't have one)
- **Add invoices** by dragging PDF files or clicking to choose them
- **See all your invoices** in a table with payment method labels (VB/IL)
- **Search and filter** by payment type, text, or date
- **Mark as paid** and move invoices to the Paid section
- **Edit** details (payment type, vendor, amount, date)
- **Delete** invoices
- **Export to Excel** with current filters applied

Data is stored in Supabase (cloud). You can access your invoices from any device.

---

## How to run the app

### Development (local)

1. Install dependencies (once): `npm install`
2. Start dev server: `npm run dev`
3. Open http://localhost:5173 in your browser
4. Sign up or sign in with email/password

### Production (Vercel)

1. Push to GitHub and connect to Vercel
2. Add env vars: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
3. Deploy – Vercel builds the static site (no backend)

---

## Supabase setup

Before using the app, set up Supabase:

1. Create a project at supabase.com
2. Run the SQL in `supabase/schema.sql` in the SQL Editor
3. Create a Storage bucket named `invoices` (public)
4. Add Storage RLS policies (see `SUPABASE_SETUP.md`)

---

## Badges

- **Pay via VB** (green) – Invoice contains "SCANMARKER"
- **Pay via IL** (blue) – Invoice contains "TOPSCAN"
- **Not marked** – Neither keyword found
- **Paid** / **Unpaid** – Payment status
