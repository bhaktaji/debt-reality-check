# Deployment, WhatsApp Cloud API Setup & Operations Runbook

This guide covers taking **Debt Reality Checker** from a clean checkout to a production deployment on **Google Cloud Run** (or any Docker / Node 22 host) connected to the **official Meta WhatsApp Business Cloud API**.

---

## 1. Local Development & Verification from a Clean Checkout

```bash
git clone https://github.com/bhaktaji/debt-reality-check.git
cd debt-reality-check

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Run full quality gate (ESLint + Vitest unit/property/fixture/Cloud API suites + Vite build)
npm run verify

# Run deterministic CLI demo & calibration checks
npm run demo
npm run calibrate
npm run calibrate -- --boundaries
```

---

## 2. Production Architecture & SQLite Persistence Strategy

Debt Reality Checker uses **SQLite in WAL mode** (`store/db.js`) with pseudonymised user keys (`HMAC-SHA256(senderId, PSEUDONYM_SECRET)` truncated to 32 hex chars).

### Critical Rule for Container Platforms (Google Cloud Run / Fly.io / Render / Railway)
An ephemeral container filesystem will lose SQLite state when the container scales to zero or redeploys. Choose **one** of these two production storage topologies:

1. **Single-Instance Pilot with Persistent Volume (Recommended for Initial Launch)**:
   - Run with `--max-instances=1` (SQLite WAL locks are process/host-local and must not be shared across concurrent network writers).
   - Mount a persistent disk / volume at `/app/data` and set `DRC_DB_PATH=/app/data/debt_reality.sqlite`.
   - On Google Cloud Run (Gen2 execution environment), attach a Cloud Filestore or dedicated persistent volume mount, or run on a single Compute Engine / Fly.io / Render / Railway instance with an attached SSD block volume at `/app/data`.
2. **Multi-Instance Horizontal Scaling (Future Evolution)**:
   - If horizontal auto-scaling (`max-instances > 1`) is required, replace the synchronous `store/db.js` SQLite adapter with a managed PostgreSQL (Cloud SQL) adapter implementing the same `store.{users, consent, profiles, debts, expenses, audits, events, webhooks, retention}` interface.

### SQLite Backup & Restore Procedure
Because the database runs in WAL (`Write-Ahead Logging`) mode, **do not copy `.sqlite` files with `cp` while the server is writing** without checkpointing. Use the online backup command:

```bash
# Safe online backup
sqlite3 /app/data/debt_reality.sqlite ".backup '/app/data/backups/drc-$(date +%Y%m%d-%H%M%S).sqlite'"

# Integrity check on a backup
sqlite3 /app/data/backups/drc-latest.sqlite "PRAGMA integrity_check;"

# Restore procedure (stop the service first)
rm -f /app/data/debt_reality.sqlite /app/data/debt_reality.sqlite-wal /app/data/debt_reality.sqlite-shm
cp /app/data/backups/drc-latest.sqlite /app/data/debt_reality.sqlite
chmod 600 /app/data/debt_reality.sqlite
```

---

## 3. Meta WhatsApp Business Cloud API Setup

### Step 3.1: Create a Meta Business App
1. Go to [developers.facebook.com](https://developers.facebook.com/) → **My Apps** → **Create App**.
2. Choose **Other** → **Business** and link it to your Meta Business Portfolio.
3. Add the **WhatsApp** product to the app.

### Step 3.2: Collect the 4 Required Credentials
| Variable | Where to Find It in Meta Developer Portal |
| --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` | **WhatsApp → API Setup** → *Phone number ID* (numeric string, e.g., `106540352242922`). |
| `WHATSAPP_APP_SECRET` | **App Settings → Basic** → *App secret* (used by the server to verify `X-Hub-Signature-256` on every incoming `POST /webhook`). |
| `WHATSAPP_VERIFY_TOKEN` | Generate your own random 32-byte hex secret (`openssl rand -hex 32`). You will paste this exact value into the Meta Webhook dialog. |
| `WHATSAPP_ACCESS_TOKEN` | For initial sandbox testing, use the temporary token in **WhatsApp → API Setup**. For production, create a **System User** in **Meta Business Settings → Users → System Users**, assign the WhatsApp App and WABA with `whatsapp_business_messaging` and `whatsapp_business_management` permissions, and generate a ** permanent token**. |

### Step 3.3: Generate `PSEUDONYM_SECRET`
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Store this in Secret Manager. **Never rotate `PSEUDONYM_SECRET` casually without awareness**: rotating it changes every user's derived 32-char pseudonym ID, effectively starting all returning users with a fresh state while leaving old pseudonymised rows to expire via the 90-day retention sweep.

---

## 4. Deploying to Google Cloud Run

```bash
# 1. Build and push the container image
gcloud builds submit --tag gcr.io/YOUR_GCP_PROJECT/debt-reality-checker:v2.0.0

# 2. Deploy to Cloud Run (Gen2 execution environment, single instance for SQLite locking safety)
gcloud run deploy debt-reality-checker \
  --image gcr.io/YOUR_GCP_PROJECT/debt-reality-checker:v2.0.0 \
  --region asia-south1 \
  --platform managed \
  --execution-environment gen2 \
  --max-instances 1 \
  --min-instances 1 \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,DRC_CHANNEL=cloud,DRC_RETENTION_DAYS=90,DRC_STORE_DESCRIPTIONS=false,WHATSAPP_GRAPH_API_VERSION=v21.0" \
  --set-secrets "PSEUDONYM_SECRET=DRC_PSEUDONYM_SECRET:latest,WHATSAPP_PHONE_NUMBER_ID=DRC_WA_PHONE_ID:latest,WHATSAPP_ACCESS_TOKEN=DRC_WA_ACCESS_TOKEN:latest,WHATSAPP_VERIFY_TOKEN=DRC_WA_VERIFY_TOKEN:latest,WHATSAPP_APP_SECRET=DRC_WA_APP_SECRET:latest"
```

### Verify Health & Readiness Endpoints
Once deployed, verify the service is healthy before registering the webhook in Meta:

```bash
curl -sS https://YOUR_CLOUD_RUN_URL/healthz
# Expected: {"ok":true,"status":"healthy","channel":"cloud",...}

curl -sS https://YOUR_CLOUD_RUN_URL/readyz
# Expected: {"ok":true,"status":"ready","db":true,"configured":true,"schemaVersion":2}
```

---

## 5. Registering the Webhook in Meta Developer Portal

1. Open **Meta Developer Portal → WhatsApp → Configuration → Webhook → Edit**.
2. Set **Callback URL**:
   ```
   https://YOUR_CLOUD_RUN_URL/webhook
   ```
3. Set **Verify token**: paste the exact `WHATSAPP_VERIFY_TOKEN` configured in your server secrets.
4. Click **Verify and save**. Meta will send a `GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...` request, and the server will respond `200 OK` with the raw challenge.
5. Under **Webhook fields**, subscribe to **`messages`** (v21.0+).

---

## 6. Live WhatsApp Test-Number Acceptance Procedure

Before opening the bot to public users, run this exact end-to-end acceptance test from a real phone registered as a test recipient in **WhatsApp → API Setup**:

1. **Greeting & Onboarding**:
   - Send `HI` to the WhatsApp test number.
   - Verify the bot replies with the plain-English welcome notice explaining privacy, retention (90 days), and `AGREE` / `AUDIT` / `DELETE MY DATA`.
2. **Explicit Consent**:
   - Send `AUDIT` before consenting → verify the bot prompts for `AGREE` first.
   - Send `AGREE` → verify consent confirmation.
3. **Full Guided Audit + Input Correction**:
   - Send `AUDIT`.
   - Step 1 (Monthly income): Send `abc` → verify polite validation error. Send `55k` → verify `Got it — ₹55,000.` and Step 2 prompt.
   - Step 2 (Income stability): Send `no` → verify follow-up asking for lowest month (`48k`) and average (`53k`).
   - Step 3 (Family help): Send `0`.
   - Step 4 (Housing): Send `15k`.
   - Step 5 (Essentials): Send `14k`.
   - Step 6 (Liquid cash reserves): Send `60k`.
   - Step 7 (Protected retirement/gold): Send `1L`.
   - Step 8 (Household size & earner status): Send `3, yes`.
   - Step 9 (Debts):
     - Add `Personal Loan` → `loan` → `1.2L` → `18%` → `15` → `4.5k` → `0`.
     - Add `Credit Card` → `card` → `45k` → `42%` → `2.25k`.
     - Send `done`.
4. **Edit & Review Before Calculation**:
   - At the review screen (`Does this look right?`), send `EDIT INCOME`.
   - Enter `60k` → verify the bot updates Monthly take-home income to `₹60,000` and immediately re-displays the review summary.
5. **Verdict & Deterministic Report**:
   - Send `YES`.
   - Verify the bot returns the plain-English health tier, key numbers (in ₹ and %), rate normalisation notes, payoff comparison (Avalanche vs Snowball), and 3–5 advisory actions.
6. **Follow-Up Questions**:
   - Send `WHY` → verify plain-English explanation of tier drivers and distance to the next healthier range.
   - Send `STRATEGY` → verify payoff strategy comparison details.
   - Send `NEXT STEPS` → verify concrete advisory actions.
7. **Data Export & Right to Erasure**:
   - Send `EXPORT` → verify JSON export contains only the 32-char pseudonymised ID and integer paise records (never your phone number).
   - Send `DELETE MY DATA` → verify immediate confirmation of erasure.
   - Send `SUMMARY` → verify the bot asks for consent again (`AGREE`), confirming zero residual user or consent state.

---

## 7. Operational Runbook: Diagnostics, Rate Limits & Token Rotation

### Diagnosing Failed Webhook Deliveries or Replies
- **Check `/readyz`**: Returns `{"ok":true,"status":"ready","db":true,"configured":true,"schemaVersion":2}`. If `configured: false`, one of `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, or `WHATSAPP_APP_SECRET` is unset.
- **Structured Error Logs**: `bot/whatsapp_cloud.js` logs JSON error events (`{"level":"error","event":"cloud_webhook_process_error","code":...,"status":...}`) to `stderr` with all Bearer tokens and app secrets automatically redacted (`[REDACTED]`) and zero phone numbers or financial figures logged.
- **HTTP 401 on `POST /webhook`**: Indicates `X-Hub-Signature-256` verification failed. Confirm `WHATSAPP_APP_SECRET` matches the Meta App Secret under **App Settings → Basic**.
- **HTTP 429 / 5xx from Graph API**: The outbound sender automatically retries up to 3 times with exponential backoff and jitter (honouring `Retry-After` headers when present). Persistent 401/403 errors from Graph API are **not** retried and indicate an expired or revoked `WHATSAPP_ACCESS_TOKEN`.

### Rotating Secrets Safely
1. **`WHATSAPP_ACCESS_TOKEN`**: Generate a new System User token in Meta Business Settings, update the secret in Cloud Run Secret Manager, and deploy a new revision. Zero downtime or data impact.
2. **`WHATSAPP_VERIFY_TOKEN`**: Update the secret in Cloud Run first, then update the Verify Token in the Meta Developer Portal Webhook settings if re-verifying the callback URL.
3. **`PSEUDONYM_SECRET`**: Keep stable across deployments. Only rotate if you suspect key compromise (rotating invalidates existing pseudonymised user lookups, requiring users to re-consent on their next message).

---

## 8. Legal, Privacy & Regulatory Pre-Launch Checklist (India)

Even with strong technical privacy controls (`HMAC-SHA256` pseudonymisation, no raw phone numbers in SQLite, no free-text expense descriptions by default, 90-day inactivity purge, and immediate `DELETE MY DATA`), **pseudonymised records remain personal data under India's Digital Personal Data Protection Act, 2023 (DPDPA) and DPDP Rules, 2025**. Before launching publicly:

- [ ] **Publish a Privacy Notice & Terms of Use URL** on your WhatsApp Business Profile and website naming the Data Fiduciary, the purpose of processing, the 90-day retention period, and the contact details of your Grievance Officer.
- [ ] **Verify Non-Advisory / Non-Lending Boundaries (SEBI / RBI)**: Ensure no product copy recommends securities, Mutual Funds, or insurance products, and ensure no loan brokering, credit bureau pull, or debt-settlement negotiation service is bundled without appropriate regulatory registration.
- [ ] **Complete Meta Business Verification**: Required by Meta to move the WhatsApp Business Account from Sandbox/Test mode to public production messaging tiers.

---

## 9. GitHub Personal Access Token Expiry & Rotation Procedure

To authorize Git operations (`push`, `pull`, `fetch`, and repository synchronization) with GitHub without relying on interactive prompts, a GitHub Personal Access Token (fine-grained PAT) is used.

### Security & Storage Invariants
- **Never committed**: The token must never appear in `git log`, source code, `README.md`, or any committed file.
- **Git-ignored storage**: The token is stored strictly in the local, Git-ignored environment (`.env` as `GITHUB_TOKEN=...`, mode `0600`) and the local Git credential helper cache (`.git/credentials`, mode `0600`, which resides inside Git's internal metadata directory and is never tracked).
- **Zero logging**: Automated scripts and server processes must sanitize error outputs to prevent credential leakage.

### Token Expiry Schedule
- **Token Validity**: 90 days (3 months) from issuance.
- **Current Token Expiration**: Late January 2027.
- **Required Permissions**: Read and write repository access for `Contents` (`repo` scope or fine-grained repository permissions for `bhaktaji/debt-reality-check`).

### Quarterly Rotation Procedure
When GitHub sends an expiration warning email or when the token reaches its 90-day threshold:

1. **Generate a Fresh Token on GitHub**:
   - Navigate to **GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens** (or Tokens classic).
   - Click **Generate new token**.
   - Set Name (e.g., `debt-reality-checker-sync`), choose an expiration (e.g., 90 days), and select Repository Access for `bhaktaji/debt-reality-check` with **Read and write** permissions for repository contents.
   - Copy the newly generated token.

2. **Update Local Git Credentials**:
   ```bash
   # Update the Git-ignored .env file
   # Replace the existing GITHUB_TOKEN line in .env with your fresh token
   chmod 600 .env

   # Update the local git credentials file
   echo "https://x-access-token:YOUR_NEW_TOKEN_HERE@github.com" > .git/credentials
   chmod 600 .git/credentials
   ```

3. **Verify Authorized Access**:
   ```bash
   git ls-remote origin HEAD
   # Verifies connectivity and authentication without printing the token
   ```

4. **Revoke the Previous Token**:
   - In GitHub Settings, delete/revoke the expired token to complete the rotation cycle.

