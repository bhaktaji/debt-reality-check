# Debt Reality Checker

A deterministic, offline-first household solvency diagnostic that explains itself in
plain English.

Tell it your income, essential costs, cash buffer and debts. It normalises every interest
rate to a comparable year-on-year figure, computes a four-tier cash-flow verdict, compares
two debt-payoff strategies, and gives you three to five concrete next actions. A person who
has never heard of FOIR, DCF, APR or amortisation can read the whole result without
meeting any of those words.

There is no account, no telemetry, no lending, no brokering, no referrals and no LLM in the
financial path. Verdicts come from pure functions over thresholds you can read and test.

> **Informational only.** Not legal, tax or investment advice. This tool does not assess
> insolvency in any legal sense. A qualified professional should review your individual
> circumstances.

---

## Table of contents

- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Environment setup](#environment-setup)
- [Running it](#running-it)
  - [Dashboard](#dashboard)
  - [CLI](#cli)
  - [WhatsApp bot](#whatsapp-bot)
- [WhatsApp conversation commands](#whatsapp-conversation-commands)
- [Testing](#testing)
- [Project layout](#project-layout)
- [How the engine works](#how-the-engine-works)
- [Privacy and data handling](#privacy-and-data-handling)
- [Deployment & operations](#deployment--operations)
- [Contributing and Git workflow](#contributing-and-git-workflow)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [License](#license)

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime | **Node.js 22.5+** (uses `node:sqlite` and `--env-file-if-exists`) |
| Dashboard | **React 18 + Vite 6**, plain CSS, zero runtime UI dependencies |
| Storage | **SQLite** — `better-sqlite3` (native) with automatic fallback to the built-in `node:sqlite` |
| Messaging | Channel abstraction with a console driver, an official **WhatsApp Business Cloud API** webhook server (`bot/whatsapp_cloud.js`), and a guarded local personal prototype (`@whiskeysockets/baileys`) |
| Tests | **Vitest 2** — unit, property, golden-fixture, parity, Cloud API webhook/signature/retry, and server-render smoke tests |
| Lint | **ESLint 9** (flat config) |
| Money handling | Integer paise internally, `en-IN` formatting for display |
| CI | GitHub Actions — lint, test, build, CLI smoke test, end-to-end demo |

There is **no Java/Maven backend** and no separate server tier: the whole financial core is
plain JavaScript running in Node (CLI, bot, Cloud API webhook server) or in the browser (dashboard).
One codebase, three surfaces, one calculation.

---

## Prerequisites

| Requirement | Version | Why |
| --- | --- | --- |
| **Node.js** | **>= 22.5** | `node:sqlite` for the SQLite fallback; `--env-file-if-exists` for `.env` loading from the npm scripts |
| npm | 10+ (bundled with Node) | Dependency management |
| Git | any recent | Cloning and contributing |

Optional, depending on what you run:

- A modern browser for the dashboard (Chrome/Edge/Firefox/Safari).
- A Meta Developer account & WhatsApp Business App for the official Cloud API webhook server.
- A phone with WhatsApp for the local personal Baileys prototype.
- Visual Studio C++ build tools **only** if you want to rebuild `better-sqlite3` for your
  Node version (the prebuilt binary ships for Node 22).

---

## Quick start

```bash
git clone https://github.com/bhaktaji/debt-reality-check.git
cd debt-reality-check

npm install
npm run demo        # full end-to-end audit, writes dist/demo-audit-report.html
npm run dev         # unified server (dashboard + Cloud API webhook) at http://localhost:3000
npm run web         # standalone Vite dashboard at http://localhost:5173
```

That is enough to see everything: the demo runs a complete audit through the console and
prints a printable report; `npm run dev` or `npm run web` opens the same engine behind the dashboard.

---

## Environment setup

The dashboard needs **no configuration** — it stores everything in `localStorage` on your
device and makes no network request.

The CLI and the bot read an optional `.env` file. The npm scripts load it automatically
(`node --env-file-if-exists=.env`), so there is nothing to export by hand.

```bash
cp .env.example .env
```

`.env` is git-ignored. **`.env.example` is the tracked template** — never put real
credentials in anything else. The variables are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PSEUDONYM_SECRET` | dev fallback | HMAC key for pseudonymised user ids. **Required in production (min 16 chars).** |
| `NODE_ENV` | `development` | `production` refuses to run without `PSEUDONYM_SECRET` and Cloud API secrets. |
| `PORT` | `3000` / `8080` | HTTP port for the Cloud API webhook & dashboard server. |
| `DRC_DB_PATH` | `data/debt_reality.sqlite` | SQLite file path. |
| `DRC_RETENTION_DAYS` | `90` | Inactivity after which a user's data is purged on boot and every 6 hours. |
| `DRC_STORE_DESCRIPTIONS` | `false` | Store free-text expense descriptions. Off by default. |
| `DRC_DB_DRIVER` | auto-detect | Force `better-sqlite3` or `node:sqlite`. |
| `DRC_CHANNEL` | `console` | `console`, `cloud` (official production API), or `baileys` (local personal prototype). |
| `WHATSAPP_PHONE_NUMBER_ID` | – | Official Cloud API phone number ID. **Required in production.** |
| `WHATSAPP_ACCESS_TOKEN` | – | Official Cloud API permanent System User token. **Required in production.** |
| `WHATSAPP_VERIFY_TOKEN` | – | Official Cloud API webhook verification token. **Required in production.** |
| `WHATSAPP_APP_SECRET` | – | Meta App Secret used to verify `X-Hub-Signature-256` on `POST /webhook`. **Required in production.** |
| `WHATSAPP_GRAPH_API_VERSION` | `v21.0` | Configurable Meta Graph API version. |
| `SELF_CHAT_ONLY` | `true` | Baileys guard: only answer your own "message yourself" chat. |
| `ALLOWED_JIDS` | unset | Baileys guard: comma-separated allow-list of consented JIDs. |
| `BAILEYS_AUTH_DIR` | `auth_info_baileys` | Session key location. Git-ignored, treat as a live credential. |

Generate a `PSEUDONYM_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Running it

### Dashboard

```bash
npm run dev            # unified server (dashboard + webhook + healthz) at http://localhost:3000
npm run web            # Vite dev server at http://localhost:5173
npm run web:build      # production bundle into dist/web
```

Offline-first: profile, expenses and audit history live in `localStorage`. The production
bundle makes no outbound request. You can also open `dist/web/index.html` directly from disk.

Five guided screens (income → costs → safety net → household → debts), each asking one part
of the household with plain-English labels and a `?` help control on anything technical.
The result opens with a conversational verdict before any number.

### CLI

```bash
npm run demo                        # full end-to-end audit + printable HTML report
npm run audit -- --file examples/profile.sample.json
npm run audit -- --file examples/profile.flat-rate.json --json
npm run audit -- --file examples/profile.sample.json --html dist/report.html
cat examples/profile.sample.json | npm run audit -- --stdin
npm run calibrate                    # the four archetype fixtures under Algorithm v2
npm run calibrate -- --boundaries    # every documented band edge
```

Two example profiles ship in `examples/`: a standard household, and one exercising rate
normalisation (a flat-rate loan-app quote with an up-front fee).

### WhatsApp bot

```bash
npm run bot:cloud       # official WhatsApp Business Cloud API HTTP webhook server (production)
npm run bot             # interactive console channel, no credentials required
npm run bot:whatsapp    # unofficial QR-linked prototype (replies in your own "message yourself" chat)
npm run bot:logout      # clear a local Baileys prototype session
```

- **Production (`npm run bot:cloud` or `npm start`)**: Starts the HTTP server exposing:
  - `GET /webhook` (and `GET /api/webhook`): Meta webhook subscription challenge verification (`hub.mode=subscribe`, timing-safe `hub.verify_token` check).
  - `POST /webhook` (and `POST /api/webhook`): Validates `X-Hub-Signature-256` using `WHATSAPP_APP_SECRET`, enforces payload size bounds, deduplicates `message.id` across restarts in SQLite (`processed_webhooks`), handles text/interactive/unsupported-media/status events, splits long reports at section boundaries (`<= 3800` chars), and sends outbound replies via Graph API with bounded exponential backoff + jitter on `429`/`5xx`.
  - `GET /healthz`, `GET /readyz`, `GET /api/status`: Operational liveness and database readiness endpoints.
- **Local Personal Prototype (`npm run bot:whatsapp`)**: Set `SELF_CHAT_ONLY=true` in `.env`, run `npm run bot:whatsapp`, then scan the QR from **WhatsApp → Settings → Linked devices → Link a device**. The Baileys adapter is **unofficial, reverse-engineered, and strictly prohibited for public production**.

---

## WhatsApp conversation commands

| Command | What it does |
| --- | --- |
| `HI` / `HELLO` / `HELP` | Shows the plain-English welcome guide and command list |
| `AGREE` | Records explicit data-processing consent |
| `AUDIT` / `RESTART` | Starts a fresh 8-step guided debt & cash-flow reality check |
| `BACK` | Steps back one question during an audit |
| `EDIT INCOME` / `EDIT RENT` / `EDIT COSTS` / `EDIT RESERVES` / `EDIT HOUSEHOLD` / `EDIT DEBTS` | Updates a specific answer and returns directly to the review screen |
| `CANCEL` | Pauses the current questionnaire while keeping your draft |
| `RESUME` | Continues a paused questionnaire from where you left off |
| `YES` (at review screen) | Runs the deterministic v2 calculation and prints the full report |
| `WHY` / `STRATEGY` / `NEXT STEPS` | Answers follow-up questions about your last completed audit |
| `LOG 250 groceries` | Logs a daily expense (`essential`, `debt`, `discretionary`, `buffer`) |
| `SUMMARY` | Shows logged expenses for the last 30 days and your latest verdict |
| `EXPORT` | Prints a copy of all pseudonymised records held for your chat |
| `DELETE MY DATA` | Immediately and permanently erases all records and consent for your chat |

---

## Testing

```bash
npm test          # full suite
npm run test:unit # unit, property and fixture suites only
npm run lint      # ESLint over the whole repository
npm run verify    # lint + tests + production build, in one go
```

| Layer | What it proves |
| --- | --- |
| Unit | Amount/rate parsing, expense categorisation, band edges, overrides, rate normalisation, credit stress, data-quality guards, payoff mechanics, strategy selection, formatting, storage, the router, report rendering, dashboard render, copy guardrails |
| Golden fixtures | The four archetypes reproduce the published v2 numbers exactly (FOIR, DCF %, runway, flow tier, final tier, drivers) |
| Boundary fixtures | FOIR 39.99/40/50/65; DCF 25/24.99/10/9.99/0; runway 6/5.99/3/2.99/1/0.99; deficit 5.99/6.0 |
| Property | Raising income never worsens the tier; raising a mandatory payment never improves it; scaling every rupee amount preserves the tier; the engine never mutates its input; payoff interest is never negative; the budget is never exceeded |
| Parser fuzz | Every formatted variant of a number round-trips; junk never becomes `0`; random input never throws |
| Parity | A full bot conversation, read back out of SQLite, produces the same verdict as the dashboard |
| Copy snapshots | No message, label, glossary entry or narrative ever contains "insolvent", "prohibited" or "mandated" |
| Plain language | Every technical term has a glossary entry written as a plain sentence; the whole reading flow contains no FOIR/DCF/APR/DTI jargon |
| Dashboard render | The real React tree renders to a string in Node: every screen, every label bound to a control, help controls present, `aria-current` on the active step |
| WhatsApp Cloud API | Webhook verification, `X-Hub-Signature-256` HMAC validation, malformed payloads, unsupported media handling, status callbacks, persistent deduplication across restarts, bounded retry/backoff on 429/5xx, token redaction, multi-user isolation, and `DELETE MY DATA` complete erasure |
| WhatsApp Baileys | Groups, status broadcasts and history replay ignored; duplicates dropped; allow-list enforced; the bot never answers its own replies |
| SQLite drivers | Driver detection probes with a real database; a broken native module falls through; both drivers produce identical query results |

---

## Project layout

```
core/     pure functions. no I/O, no clock, no network, no randomness.
            policy.js            thresholds, tier labels, directives, career guidance
            plain_language.js    plain tier names, the glossary, headlines, actions
            explain.js           each metric -> its value + what that value means
            narrative.js         the conversational verdict and next steps
            engine_v2.js         rate normalisation, metrics, tiers, overrides
            payoff.js            payoff simulation with roll-over and infeasibility guards
            strategy.js          cost-aware Avalanche / Snowball selector
            report.js            ONE report model, one section list, three renderers
store/    SQLite. WAL, foreign keys, indexes, migrations (v1 + v2 webhook idempotency), integer paise.
bot/      channel-agnostic router + console, Cloud API (production) and Baileys (local) adapters.
web/      React 18 + Vite dashboard, importing the same core via the @core alias.
cli/      demo.js, audit.js, calibrate.js.
tests/    unit/ property/ fixtures/ helpers/
docs/     technical whitepaper (PDF) and production deployment & operations guide.
server.js unified HTTP server (Cloud API webhook + health probes + static dashboard).
```

**The rule that matters:** `core/` contains every financial formula *and* every user-facing
sentence. `web/`, `bot/` and `cli/` all import it. There is no second copy of a formula, and
no second copy of a sentence, anywhere in the repository.

---

## How the engine works

1. **Normalise rates.** Every debt is converted to a true APR. A ₹20,000 loan quoted at
   "24% flat over 6 months" has an EMI of ₹3,733.33 and a true APR of **40.0%**; add a 10%
   up-front fee and it is **79.6%**. An unknown rate stays unknown.
2. **Compute metrics.** Effective income (the weakest of the last 3-6 months), FOIR,
   discretionary cash flow, emergency runway, interest burn, debt-to-income months and
   credit-stress indicators.
3. **Assign a tier.** `flowTier = max(FOIR tier, DCF tier)`. The runway may worsen that by
   at most one tier and may never improve it. Two documented overrides apply on top
   (a balance growing even when paid; a high dependency load with a thin buffer).
4. **Explain it.** Drivers, distance to the next healthier range, and the exact number that
   would change it.
5. **Compare strategies.** Avalanche vs Snowball with a fixed budget and freed minimums
   rolling over. If the budget cannot cover the interest, the plan is reported as
   `BUDGET_BELOW_INTEREST` with the shortfall — never simulated to a nonsense horizon.
6. **Say what to do.** Three to five tier-specific actions, advisory wording only.

The thresholds live in `core/policy.js`, are asserted by boundary tests, and can be
recalibrated from the CLI with `npm run calibrate`.

---

## Privacy and data handling

**Data minimised, not exempt.** Pseudonymised data generally remains personal data. These
controls reduce exposure and breach impact; they do not create a regulatory exemption.

| Data | How it is handled |
| --- | --- |
| Channel id (a WhatsApp JID contains a phone number) | Stored only as `HMAC-SHA256(rawId, secret)`, truncated to 32 hex chars. The raw value is never persisted. |
| Income, costs, debts, reserves | Stored as integer paise; purged after inactivity or on request. |
| Expense descriptions | **Not stored by default.** Only amount and category. Opt in with `DRC_STORE_DESCRIPTIONS=true`. |
| Webhook message IDs | Stored in `processed_webhooks` associated with the pseudonymised user ID for idempotency; erased on `DELETE MY DATA` and inactivity purge. |
| Dashboard | Everything stays in `localStorage` on the device. No account, no server call, no analytics. |
| Logs | Event kinds only, never message bodies, phone numbers, financial figures, or API tokens. |

On first contact the consent flow states what is stored, why, for how long, and how to
erase it. `DELETE MY DATA` erases everything for one user immediately (without leaving an
empty skeleton user row behind); the retention sweep handles inactivity on startup and every 6 hours.

---

## Deployment & operations

See [`docs/DEPLOYMENT_AND_OPERATIONS.md`](docs/DEPLOYMENT_AND_OPERATIONS.md) for the complete
production guide covering:

- Google Cloud Run / Docker deployment (`Dockerfile`)
- SQLite persistent volume configuration (`max-instances=1` with Cloud Run Gen2 volume mount) and backup/restore runbook
- Meta Developer App & WhatsApp Business Cloud API configuration (`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, permanent System User token)
- End-to-end live WhatsApp test-number verification checklist
- Token rotation, rate-limit diagnostics, and DPDPA / SEBI / RBI pre-launch compliance checklist

---

## Contributing and Git workflow

### Definition of done

A change is ready to merge when **all** of these pass:

```bash
npm run lint
npm test
npm run web:build
```

Plus: add tests for new behaviour, and **never** weaken an existing test to make code pass.
If a threshold or formula changes, say so explicitly in the commit body — those numbers are
asserted by golden fixtures and are the contract with the user.

### What must never be committed

- `.env` or any real credential — `.env.example` is the only tracked template.
- `auth_info_baileys/` — it is equivalent to a logged-in WhatsApp session.
- `data/*.sqlite` — it contains real financial data.
- `node_modules/`, `dist/`, `coverage/` — regenerable.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `NODE_MODULE_VERSION 127 … requires 137` | `better-sqlite3` was built for a different Node version (127 = Node 22, 137 = Node 24) | It falls back to the built-in driver automatically. To silence it: run on Node 22, `npm rebuild better-sqlite3`, or set `DRC_DB_DRIVER=node:sqlite`. |
| `CloudApiChannel refuses to start in production...` | Missing `PSEUDONYM_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, or `WHATSAPP_APP_SECRET` | Configure all 5 secrets in your deployment environment / Secret Manager. |
| `401 Invalid signature` on `POST /webhook` | `WHATSAPP_APP_SECRET` does not match the Meta App Secret in App Settings → Basic | Verify `WHATSAPP_APP_SECRET` matches the Meta Developer Portal App Secret (not the verify token or access token). |
| `Refusing to start the Baileys prototype…` | No `SELF_CHAT_ONLY=true` and no `ALLOWED_JIDS` | Set one in `.env`. This is the safety guard working. |
| `npm install` fails on a postinstall script | A locked-down sandbox blocking `esbuild` | `npm install --ignore-scripts` — the prebuilt binaries are already unpacked. |

---

## Known limitations

- The tier cut-offs are **unvalidated rules of thumb** from the source specification, not
  field-validated.
- Credit-stress indicators are **non-bureau proxies** derived from entered data. They are
  not a credit score.
- The payoff simulator assumes a fixed budget and constant rates. Real lenders change
  minimums, charge fees and negotiate settlements.
- Family help is shown for context only, never counted as income.
- Currency support is **INR only**.
- Copy is English only. Localisation is outstanding work.

---

## License

MIT. See `LICENSE`.

*This is an informational engineering artefact. Regulatory and pricing points referenced in
the source specification should be re-verified against current guidance before any public
launch.*
