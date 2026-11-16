# Kuzelle: invoices, receipts and payment tracking

Version 4. Static front end (public/) plus one Netlify Function (netlify/functions/api.mjs)
that stores records in Netlify Blobs. No build step and no framework.

## What's in the folder
public/index.html              app shell
public/styles.css              design system (light and dark themes, document templates)
public/js/app.js               routes and screens: dashboard, invoices, receipts, clients,
                               products, reports, settings, login
public/js/store.js             data layer: records, sync, login, all money and status rules
public/js/document.js          invoice/receipt layout, multi-page pagination, print, PDF
public/js/ui.js                dialogs, menus, toasts
public/js/util.js              dates, currency formatting, icons
public/js/brand.js             default Kuzelle logo
public/vendor/                 html2canvas 1.4.1 + jsPDF 2.5.1 (self-hosted, loaded only on PDF export)
netlify/functions/api.mjs      login check + sync API
netlify.toml, package.json     Netlify config, one dependency (@netlify/blobs 11.1.7)

## What changed in version 4
- Creating an invoice is one short screen: client, items, total, Create invoice.
  Number, dates, tax, payment details and notes come from Settings
  ("Customize invoice" changes them for one invoice).
- Phones get a bottom tab bar (Home, Invoices, Receipts, Clients, Settings) and full-screen
  sheets for picking a client, adding an item and previewing the document.
- Invoice and receipt numbers are claimed from the server when saved (POST /api/claim),
  so two people creating invoices at the same moment never get the same number.
- Each saved invoice and receipt keeps a copy of your business details (doc.biz) and logo
  (stored once as asset/<id>), so changing Settings never rewrites documents already issued.
  Documents from earlier versions have no copy and keep using the current Settings.

## Upgrading the existing site
Replace the files in your GitHub repository with the contents of this folder and commit.
Netlify redeploys on its own. Nothing else changes:
- Environment variables: the same ones. ACCESS_CODE (required), SESSION_SECRET and SESSION_HOURS (optional).
- No database migration. V1/V2 records are read as they are and never rewritten until you edit them:
  - an invoice marked "paid" in V1 without a receipt still shows as Paid
  - a V1 receipt's amount is read from its items
  - V1 sessions, theme choice and offline data on each device are kept (same storage keys)
- The API gained record types product/<id> and asset/<id>, number claims under num/, and the /api/claim route. Older records are untouched.

## First deploy (new site)
1. GitHub: new private repository, upload everything in this folder, commit.
2. Netlify: Add new project > Import from GitHub > pick the repository > Deploy.
3. Project configuration > Environment variables: ACCESS_CODE = a 6-digit code.
   Then Deploys > Trigger deploy.

## How the money works
- Totals are computed in pesewas/cents (integers), each line rounded once. No float drift.
- A receipt is a payment record. Invoice status is derived, never set by hand:
  Draft, Issued, Sent, Partially paid, Paid, Overdue, Cancelled.
- Several payments per invoice. A payment larger than the balance is refused,
  and a repeat payment (same invoice, amount and date) asks for confirmation.
- Receipts are voided, not deleted. A voided receipt stays in history and stops counting.
- An invoice with any payment record can't be deleted (cancel it instead), so receipts are never orphaned.
- Dashboard and reports use one currency (the default in Settings) and say when documents
  in other currencies are left out.

## Known limits
- Netlify Blobs has no multi-record transactions. Two devices editing the same record at the same
  moment use last-write-wins. Numbers are safe: each one is claimed with a write-if-absent key
  and confirmed by reading it back. Offline, a device uses the next local number.
- PDFs are rendered from the on-screen layout as high-resolution images (crisp in print).
  Text in the PDF is not selectable.
- Netlify free plan: 300 credits/month. Each production deploy costs 15.
