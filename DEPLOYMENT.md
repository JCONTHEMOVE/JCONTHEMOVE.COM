# Self-Hosting Deployment Guide (Node + Express + Vite)

For the current recommended VPS setup, start with [SELF_HOSTING.md](./SELF_HOSTING.md).
That runbook includes Docker Compose, Caddy HTTPS, database sync, backups, and the
staging-to-production cutover checklist. This file is kept as the lower-level
Node process reference.

This project now supports a standard production deployment flow:

```bash
npm run build
npm start
```

---

## 1) Runtime Requirements

- **Node.js 20+** (recommended: latest Node 20 LTS)
- **npm 10+**
- **PostgreSQL** reachable by `DATABASE_URL`

---

## 2) Environment Variables

### Required for production startup

Set these before running `npm start` in production:

- `NODE_ENV=production`
- `PORT` (optional override; defaults to `5000`)
- `DATABASE_URL`
- `SESSION_SECRET`

### Required for payment readiness

The app can boot without these so non-payment pages stay online, but `/api/health`
and launch checks will report payment readiness as incomplete until they are set:

- `SQUARE_ACCESS_TOKEN`
- `SQUARE_ENVIRONMENT` (`sandbox` or `production`)

For the public Square-hosted gift-card page, also set this non-secret build-time variable before deploying:

- `VITE_SQUARE_EGIFT_URL` — the HTTPS order-page URL copied from **Square Dashboard → Items & services → Gift cards → eGift Cards**

Railway must rebuild the client after this value changes because Vite embeds `VITE_*` values in the browser bundle. If it is omitted or invalid, `/gift-cards` stays public but shows the call/text purchase fallback instead of a broken checkout link.

The optional Square eGift purchase-bonus automation also requires:

- `SQUARE_LOCATION_ID` — the same production location used for invoices and eGift sales
- `SQUARE_WEBHOOK_SIGNATURE_KEY` — the signing key for the Square webhook subscription
- `SQUARE_WEBHOOK_URL=https://www.jconthemove.com/api/webhooks/square` — must exactly match Square's configured notification URL
- `GIFT_CARD_BONUS_START_AT` — an ISO timestamp set immediately before the owner-controlled live test; earlier purchases are never backfilled
- `GIFT_CARD_BONUS_ENABLED=true` — enables signed-webhook processing for the private owner test
- `GIFT_CARD_BONUS_PUBLIC_MARKETING_ENABLED=true` — independent public-advertising switch; keep false until the owner-controlled $50 test in `SQUARE_GIFT_CARD_SETUP.md` passes

The app creates its minimal gift-card bonus audit tables at startup. It stores Square order/payment/activity references and purchaser/recipient emails, but never a gift-card number or access code.

See [SQUARE_GIFT_CARD_SETUP.md](SQUARE_GIFT_CARD_SETUP.md) for the Square configuration, published terms, and owner-controlled live purchase checklist.

### Optional in development

In development (`npm run dev`), these env vars are optional at startup so local UI and non-payment work can continue without live production credentials. Database-backed routes still need a reachable PostgreSQL database once they are used.

### Optional feature env vars

Set these only if those features are enabled in your environment:

- `BTC_WALLET_ADDRESS`
- `ADMIN_EMAIL` or `NOTIFICATION_EMAIL` (admin quote/lead alert recipient)
- `COMPANY_EMAIL` or `FROM_EMAIL` (verified sender address for transactional email)
- `GMAIL_USER` and `GMAIL_APP_PASSWORD` for Gmail SMTP notifications
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (usually `https://your-domain.com/api/auth/google/callback`)
- `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_APPLICATION_CREDENTIALS_JSON` if using Google Cloud Storage uploads
- `GOOGLE_CLOUD_PROJECT_ID` if using Google Cloud Storage
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`
- `ADMIN_PHONE_NUMBER`
- `SENDGRID_API_KEY`
- Gmail OAuth env vars (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_USER`) if using OAuth instead of a Gmail app password
- `VITE_API_BASE_URL` (required for native/Capacitor builds that cannot use same-origin API calls)
- `VITE_SOLANA_RPC_URL`
- `TREASURY_WALLET_PRIVATE_KEY`
- `TREASURY_WALLET_PUBLIC_KEY`
- `MOONSHOT_TOKEN_ADDRESS`

### Google login setup

Create an OAuth Web Client in Google Cloud Console and add this authorized redirect URI:

```text
https://your-domain.com/api/auth/google/callback
```

Then set:

```bash
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://your-domain.com/api/auth/google/callback
```

Google login creates/reuses local `users` records. Roles and approval status stay in your database, so existing admins, crew, and customers keep their current access.

---

## 3) Production Build + Start

From the project root:

```bash
npm ci
npm run build
npm start
```

What this does:

- `npm run build`
  - builds the Vite client to `dist/public`
  - compiles/bundles the Express TypeScript server to `dist/index.js`
- `npm start`
  - runs compiled server with Node (`node dist/index.js`)
  - serves API + static client assets from the same process

---

## 4) Example Linux systemd Service

Create `/etc/systemd/system/jconthemove.service`:

```ini
[Unit]
Description=JC On The Move
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/JCONTHEMOVE.COM
Environment=NODE_ENV=production
Environment=PORT=5000
EnvironmentFile=/opt/JCONTHEMOVE.COM/.env.production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jconthemove
sudo systemctl status jconthemove
```

---

## 5) Reverse Proxy (Nginx)

Point your domain to the server and proxy to the Node app:

```nginx
server {
  listen 80;
  server_name jconthemove.com www.jconthemove.com;

  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

After confirming traffic, add TLS (Let’s Encrypt) and redirect HTTP → HTTPS.

---

## 6) Smoke Test Checklist

After deploy, verify:

- Landing page loads
- Booking flow works end-to-end
- Square payment flow works
- Database writes succeed
- Rewards/JCMOVES pages and redemptions load

---

## Production availability owner alerts

The draft uses one incident-service reporting job for automatic readiness and
apex/www entrypoint outcomes. It incorporates PR #8's email-first escalation
plan and replaces the earlier direct Discord failure reporter.

Follow [AVAILABILITY_RELEASE.md](AVAILABILITY_RELEASE.md) for the concrete
activation sequence, private heartbeat secrets, isolated fail/resolve drills,
recipient verification and independent missed-check coverage. A missing
heartbeat secret fails visibly; no incident service was configured by this
code change. Ordinary manual health checks do not notify or refresh the
production incident monitor.

Do not follow the former instructions to create a
`PRODUCTION_ALERT_DISCORD_WEBHOOK_URL` secret or trigger an alert by supplying
an intentionally wrong production commit. Use the separate drill heartbeat.
Local reporter and entrypoint tests use fake HTTP responses and do not prove
real email/Discord receipt or escalation timing.

## 7) Troubleshooting

### Build fails with missing tools/deps
Run:

```bash
npm ci
```

### App refuses to boot in production
Check startup logs for missing required env vars (`DATABASE_URL`, `SESSION_SECRET`, `SQUARE_ACCESS_TOKEN`, `SQUARE_ENVIRONMENT`, etc.) and set them in your host environment.

### App boots but no DB connectivity
Validate `DATABASE_URL`, DB firewall/security groups, and SSL requirements for your provider.
