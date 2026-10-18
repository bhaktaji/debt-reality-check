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
- [Testing](#testing)
- [Project layout](#project-layout)
- [How the engine works](#how-the-engine-works)
- [Privacy and data handling](#privacy-and-data-handling)
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
| Messaging | Channel abstraction with a console driver, an unofficial WhatsApp adapter (`@whiskeysockets/baileys`) and an official **WhatsApp Cloud API** transport |
| Tests | **Vitest 2** — unit, property, golden-fixture, parity and server-render smoke tests |
| Lint | **ESLint 9** (flat config) |
| Money handling | Integer paise internally, `en-IN` formatting for display |
| CI | GitHub Actions — lint, test, build, CLI smoke test, end-to-end demo |

There is **no Java/Maven backend** and no separate server tier: the whole financial core is
plain JavaScript running in Node (CLI, bot) or in the browser (dashboard). One codebase,
three surfaces, one calculation.

---

## Prerequisites

| Requirement | Version | Why |
| --- | --- | --- |
| **Node.js** | **>= 22.5** | `node:sqlite` for the SQLite fallback; `--env-file-if-exists` for `.env` loading from the npm scripts |
| npm | 10+ (bundled with Node) | Dependency management |
| Git | any recent | Cloning and contributing |

Optional, depending on what you run:

- A modern browser for the dashboard (Chrome/Edge/Firefox/Safari).
- A phone with WhatsApp for the bot prototype.
- A Meta developer account for the official Cloud API path.
- Visual Studio C++ build tools **only** if you want to rebuild `better-sqlite3` for your
  Node version (the prebuilt binary ships for Node 22).

---

## Quick start

```bash
git clone https://github.com/bhaktaji/debt-reality-check.git
cd debt-reality-check

npm install
npm run demo        # full end-to-end audit, writes dist/demo-audit-report.html
npm run web         # dashboard at http://localhost:5173
```

That is enough to see everything: the demo runs a complete audit through the console and
prints a printable report; `npm run web` opens the same engine behind the dashboard.

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
| `PSEUDONYM_SECRET` | dev fallback | HMAC key for pseudonymised user ids. **Required in production.** |
| `NODE_ENV` | `development` | `production` refuses to run without `PSEUDONYM_SECRET`. |
| `DRC_DB_PATH` | `data/debt_reality.sqlite` | SQLite file path. |
| `DRC_RETENTION_DAYS` | `90` | Inactivity after which a user's data is purged on boot. |
| `DRC_STORE_DESCRIPTIONS` | `false` | Store free-text expense descriptions. Off by default. |
| `DRC_DB_DRIVER` | auto-detect | Force `better-sqlite3` or `node:sqlite`. |
| `DRC_CHANNEL` | `console` | `console`, `baileys` or `cloud`. |
| `SELF_CHAT_ONLY` | unset | Baileys guard: only answer your own "message yourself" chat. |
| `ALLOWED_JIDS` | unset | Baileys guard: comma-separated allow-list of consented JIDs. |
| `BAILEYS_AUTH_DIR` | `auth_info_baileys` | Session key location. Git-ignored, treat as a live credential. |
| `WHATSAPP_PHONE_NUMBER_ID` | – | Cloud API phone number id. |
| `WHATSAPP_ACCESS_TOKEN` | – | Cloud API permanent token. |
| `WHATSAPP_VERIFY_TOKEN` | – | Cloud API webhook verification token. |

Generate a `PSEUDONYM_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Running it

### Dashboard

```bash
npm run web            # dev server at http://localhost:5173
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
npm run bot:whatsapp    # QR code to scan, replies in your own "message yourself" chat
npm run bot:cloud       # official WhatsApp Cloud API
npm run bot:logout      # clear a stuck WhatsApp session
npm run bot             # console channel, no credentials
```

To test quickly, set `SELF_CHAT_ONLY=true` in `.env`, run `npm run bot:whatsapp`, then scan
the QR from **WhatsApp → Settings → Linked devices → Link a device**. The adapter refuses to
start without that guard or an `ALLOWED_JIDS` list — this is deliberate.

> The Baileys adapter is **unofficial, reverse-engineered and not production-safe**. It is
> for personal prototyping. Use the official Cloud API adapter for anything public.
> See the [troubleshooting](#troubleshooting) section if no QR appears.

---

## Testing

```bash
npm test          # full suite
npm run test:unit # unit, property and fixture suites only
npm run lint      # ESLint over the whole repository
npm run verify    # lint + tests + production build, in one go
```

397 tests across 21 files, green on Node 22 and Node 24.

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
| WhatsApp transport | Groups, status broadcasts and history replay ignored; duplicates dropped; allow-list enforced; the bot never answers its own replies |
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
store/    SQLite. WAL, foreign keys, indexes, migrations, integer paise.
bot/      channel-agnostic router + console, Baileys and Cloud API adapters.
web/      React 18 + Vite dashboard, importing the same core via the @core alias.
cli/      demo.js, audit.js, calibrate.js.
tests/    unit/ property/ fixtures/ helpers/
docs/     the technical whitepaper and review (PDF).
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
| Dashboard | Everything stays in `localStorage` on the device. No account, no server call, no analytics. |
| Logs | Event kinds only, never message bodies. The `events` table has no body column at all. |

On first contact the consent flow states what is stored, why, for how long, and how to
erase it. `DELETE MY DATA` erases everything for one user immediately; the retention purge
handles inactivity.

---

## Contributing and Git workflow

### Branch naming

```
feat/short-description      chore/short-description      fix/short-description
docs/short-description      refactor/short-description
```

Branch from `main`. Keep the scope to one concern.

### Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]
[optional footer]
```

| Type | Use |
| --- | --- |
| `feat` | A new capability |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `test` | Tests only |
| `refactor` | No behaviour change |
| `chore` | Tooling, dependencies, repository structure |
| `perf` | Performance |

Rules: imperative subject, no capitalised first letter, no trailing period, ≤72 characters
in the subject. Reference issues in the footer (`Closes #12`).

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

### Pull requests

1. Branch from `main`.
2. Make the change with tests.
3. Ensure `npm run verify` is green.
4. Open a PR describing **what changed, why, and what you verified**.
5. At least one review approval.

### What must never be committed

- `.env` or any real credential — `.env.example` is the only tracked template.
- `auth_info_baileys/` — it is equivalent to a logged-in WhatsApp session.
- `data/*.sqlite` — it contains real financial data.
- `node_modules/`, `dist/`, `coverage/` — regenerable.
- `.workbuddy-ai/` — local assistant scratch state.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `NODE_MODULE_VERSION 127 … requires 137` | `better-sqlite3` was built for a different Node version (127 = Node 22, 137 = Node 24) | It falls back to the built-in driver automatically. To silence it: run on Node 22, `npm rebuild better-sqlite3`, or set `DRC_DB_DRIVER=node:sqlite`. |
| `Refusing to start the Baileys prototype…` | No `SELF_CHAT_ONLY=true` and no `ALLOWED_JIDS` | Set one in `.env`. This is the safety guard working. |
| Nothing happens after `Storage:` — no QR | A previous pairing left `auth_info_baileys/creds.json` behind | `npm run bot:logout`, then `npm run bot:whatsapp`. |
| `Connection closed: another session took over (440)` | Two bot instances on the same number | Close the other, or `npm run bot:logout` and re-link. |
| `Connection closed: you were logged out (401)` | The device was unlinked | `npm run bot:logout`, then pair again. |
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
