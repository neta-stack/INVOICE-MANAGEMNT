# Invoice Management – User Guide

This guide explains what the app does and how to use it. You don’t need any technical background.

---

## What is this app?

It’s an **invoice management** program that runs in your web browser. You can:

- **Add invoices** by dragging PDF files (or clicking to choose them).
- **See all your invoices** in one list, with automatic labels for how they will be paid.
- **Search and filter** by payment type, text, or date.
- **Edit** details (payment type, vendor, amount, date) if something is wrong.
- **Delete** invoices you no longer need.

Everything you add is **saved on your computer**. When you close the browser and come back later, your invoices are still there.

---

## How to start the app

1. Open a **terminal** (or “Command Prompt” / “PowerShell” on Windows).
2. Go to the folder where the app is installed. For example:
   - `cd "C:\Users\YourName\Desktop\INV AI"`
   - (Use your real path if it’s different.)
3. Run these two commands, one after the other:
   - `npm install`  
     (This installs what the app needs. You only need to do it once.)
   - `npm start`  
     (This starts the app.)
4. When you see a message like “Server running at http://localhost:3000”, open your **web browser** (Chrome, Edge, Firefox, etc.).
5. In the address bar, type: **http://localhost:3000** and press Enter.

The invoice management page will open. Leave the terminal window open while you use the app; if you close it, the app will stop.

---

## How to use the app

### Adding an invoice

- **Drag and drop:** Drag a PDF invoice file from your computer and drop it onto the **“Drag an invoice (PDF) here or click to choose”** area.
- **Or click:** Click that same area and choose a PDF file from the file picker.

The app will read the PDF and:

- Extract text and basic details (vendor, amount, date if it finds them).
- **Automatically label** how the invoice will be paid (see “What the badges mean” below).
- **Save** the invoice and show it at the top of the list.

You’ll see a short “Saved” message when it’s done.

### The list of invoices

Below the drop zone you’ll see all your saved invoices. Each row shows:

- **Filename** of the PDF you uploaded.
- **Vendor, amount, date** (if the app could detect them).
- A **badge**: “Pay via VB”, “Pay via IL”, or “Not marked”.
- Buttons: **Details**, **Edit**, **Delete**.

- **Details:** Click to show or hide the full text that was read from the PDF.
- **Edit:** Change the payment type, vendor, amount, or date, then click **Save**.
- **Delete:** Remove the invoice from the list (you’ll be asked to confirm).

### Filtering and search

Above the list you’ll see:

- **Payment:** Choose “All”, “VB”, “IL”, or “Unmarked” to show only invoices with that label.
- **Search:** Type part of a filename, vendor name, or any text that appears in the invoice. The list updates as you type (after a short delay).
- **From date** and **To date:** Optionally set a date range so only invoices in that period are shown.

The list updates automatically when you change these.

---

## What the badges mean

The app looks at the **text inside the PDF** and applies simple rules (you don’t have to do anything):

- If the invoice text contains **SCANMARKER** (capital or small letters), it is labeled **“Pay via VB”** (green badge).
- If it contains **TOPSCAN** (capital or small letters), it is labeled **“Pay via IL”** (blue badge).
- If neither word appears, the badge is **“Not marked”** (gray).

You can always change the label later with **Edit**.

---

## Where is my data stored?

All saved invoices are stored in **one file on the same computer where you run the app** (a file named `invoices.db` in the app folder). Nothing is sent to the internet for storage. You don’t need an account or login.

If you close the browser, your invoices are still saved. When you open http://localhost:3000 again (with `npm start` still running), you’ll see the same list.

---

## Troubleshooting

**Nothing happens when I drop a file.**  
Make sure the file is a **PDF**. Other formats (Word, images, etc.) are not supported for automatic text reading.

**I closed the browser. Are my invoices gone?**  
No. They are saved. Start the app again with `npm start` and open http://localhost:3000; your list will be there.

**The app says “No file selected” or “Unsupported format”.**  
Use a PDF file. If you have a photo or scan of an invoice, save it as a PDF first, then upload that PDF.

**The wrong payment label appeared (VB vs IL).**  
Use **Edit** on that invoice and change the “Payment type” to the correct one, then click **Save**.

**The list is empty after I restart the app.**  
Check that you’re starting the app from the same folder where you ran `npm install` and where the `invoices.db` file is stored. If you run the app from a different folder, it will use a different (empty) list.

---

## Summary

- **Start:** Run `npm install` once, then `npm start`, and open http://localhost:3000 in your browser.
- **Add:** Drag or click to upload PDF invoices; they are saved automatically.
- **Labels:** SCANMARKER → Pay via VB; TOPSCAN → Pay via IL (case doesn’t matter).
- **Manage:** Use the list, search, and filters; use **Edit** to fix details, **Delete** to remove an invoice.
- **Data:** Stored on your computer in one file; no internet or account needed.
