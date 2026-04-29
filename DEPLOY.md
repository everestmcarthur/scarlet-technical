# Scarlet Technical v2.1 — Deployment Guide

## Quick Deploy to Render

### Option A: Push to GitHub (Recommended)
1. Replace files in your GitHub repo with this v2.1 code
2. Render auto-deploys from `main` branch
3. Check Render dashboard for build status

### Option B: Manual Deploy via Render Dashboard
1. Go to https://dashboard.render.com
2. Select your scarlet-technical service
3. Click "Manual Deploy" → "Clear Build Cache & Deploy"

## Environment Variables Needed

Add these in Render → Environment:

### Required (Already Set)
- `DATABASE_URL` — Your Neon PostgreSQL connection string
- `SESSION_SECRET` — Random string for cookie signing (generate new one!)
- `ADMIN_SETUP_KEY` — Key for initial admin creation (generate new one!)
- `SITE_URL` — `https://jarviscli.dev`

### New for v2.1
- `SENTRY_DSN` — `https://b1decf9ab3a6405e4d94b499c53bcc37@o4510960090873856.ingest.us.sentry.io/4511303978057728`
- `STRIPE_SECRET_KEY` — From Stripe Dashboard → API Keys
- `STRIPE_WEBHOOK_SECRET` — Create webhook at stripe.com/webhooks pointing to `https://jarviscli.dev/api/stripe/webhook`

### Discord Webhooks (Create in Discord → Channel Settings → Integrations)
- `DISCORD_WEBHOOK_REPAIRS` — Webhook URL for #new-repairs channel
- `DISCORD_WEBHOOK_PAYMENTS` — Webhook URL for #payments channel
- `DISCORD_WEBHOOK_ALERTS` — Webhook URL for #alerts channel
- `DISCORD_WEBHOOK_ACTIVITY` — Webhook URL for #customer-activity channel
- `DISCORD_WEBHOOK_SUMMARY` — Webhook URL for #daily-summary channel

### Google Drive (Optional)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — Service account email
- `GOOGLE_PRIVATE_KEY` — Service account private key (PEM format)
- Folder IDs are pre-set in render.yaml

### Existing
- `POLSIA_API_KEY` — Your Polsia email API key
- `FROM_EMAIL` — Sender email address
- Twilio vars (if SMS enabled): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`

## Database Migration

Migration 019 runs automatically on deploy (`npm run build` triggers `node migrate.js`).
It adds: `two_factor_codes` table, Stripe columns, review tracking fields, indexes.

## Post-Deploy Checklist
- [ ] Site loads at https://jarviscli.dev
- [ ] Admin login works at /admin/login
- [ ] Customer portal works at /portal/login
- [ ] Stripe webhook receives test event
- [ ] Sentry captures test error
- [ ] Discord notifications fire
