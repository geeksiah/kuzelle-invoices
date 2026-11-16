# Kuzelle: invoices, receipts and payment tracking

Version 3. Static front end (public/) plus one Netlify Function (netlify/functions/api.mjs)
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

## Upgrading the existing site (from V2)
Replace the files in your GitHub repository with the contents of this folder and commit.
Netlify redeploys on its own. Nothing else changes:
- Environment variables: the same ones. ACCESS_CODE (required), SESSION_SECRET and SESSION_HOURS (optional).
- No database migration. V1/V2 records are read as they are and never rewritten until you edit them:
  - an invoice marked "paid" in V1 without a receipt still shows as Paid
  - a V1 receipt's amount is read from its items
  - V1 sessions, theme choice and offline data on each device are kept (same storage keys)
- The API gained one record type, product/<id>. Older records are untouched.

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
- Netlify Blobs has no multi-record transactions. Two devices saving at the same moment use
  last-write-wins per record; numbers are picked from existing records, so a clash needs two
  people creating a document in the same second on different devices.
- PDFs are rendered from the on-screen layout as high-resolution images (crisp in print).
  Text in the PDF is not selectable.
- Netlify free plan: 300 credits/month. Each production deploy costs 15.
