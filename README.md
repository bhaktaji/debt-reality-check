<div align="center">

# Debt Reality Checker

**A deterministic, conflict-free household solvency diagnostic and repayment engine that explains itself in plain English.**

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Engine: Deterministic](https://img.shields.io/badge/Algorithm-v2.0%20(Pure%20JS)-orange.svg?style=flat-square)](#why-zero-ai-in-the-financial-engine)
[![Tests: 415 Passing](https://img.shields.io/badge/Tests-415%20Passing%20(100%25)-success.svg?style=flat-square)](#automated-testing--verification)
[![Channels: Web%20%2B%20WhatsApp](https://img.shields.io/badge/Channels-Web%20%7C%20WhatsApp%20Cloud%20API-25D366.svg?style=flat-square)](#user-journey)

<br />

### **[🚀 Open Debt Reality Checker Live Dashboard](https://debt-reality-checker.ai.studio/)**

*Offline-first web diagnostic runs entirely in your browser — zero tracking, zero accounts, zero network calls.*

</div>

---

## 📌 Executive Summary & Value Proposition

Indian household debt has surged alongside the proliferation of instant credit lines, Buy-Now-Pay-Later (BNPL) services, and digital loan apps. Millions of households find themselves in overlapping repayment cycles where:
- **Quoted interest rates are fundamentally deceptive**: A "24% flat rate for 6 months" with a 10% processing fee is actually an **annualized 79.6% APR**.
- **Financial metrics are opaque**: Jargon like *FOIR*, *Debt-to-Income*, *EIR*, and *Amortization* obscures whether a family has 2 weeks or 6 months of breathing room.
- **Existing aggregators have conflicting incentives**: Most "free financial health checks" exist solely as lead-generation funnels to sell personal loans, refinancing packages, or credit cards.

**Debt Reality Checker** solves this problem by delivering an honest, unvarnished solvency diagnostic. It normalizes every loan rate to true APR, calculates household breathing room, evaluates emergency runway, compares **Avalanche vs. Snowball** debt payoff timelines with automated minimum roll-over, and gives users 3 to 5 concrete next steps—without selling loans, collecting phone numbers, or brokering debt.

```
                      ┌────────────────────────────────────────┐
                      │          DEBT REALITY CHECKER          │
                      │   Conflict-Free Solvency Diagnostic    │
                      └──────────────────┬─────────────────────┘
                                         │
         ┌───────────────────────────────┴───────────────────────────────┐
         ▼                                                               ▼
┌─────────────────────────────────┐                     ┌─────────────────────────────────┐
│     WEB DASHBOARD (React 18)    │                     │   WHATSAPP BOT (Meta Cloud API) │
│  • Offline-first (localStorage) │                     │  • Natural plain-English dialog │
│  • Five guided intake screens   │                     │  • HMAC-SHA256 pseudonymized ID │
│  • Instant graphical verdict    │                     │  • Right to erasure on command  │
└────────────────┬────────────────┘                     └────────────────┬────────────────┘
                 │                                                       │
                 └───────────────────────┬───────────────────────────────┘
                                         ▼
                      ┌────────────────────────────────────────┐
                      │    DETERMINISTIC FINANCIAL ENGINE      │
                      │  • Zero-LLM mathematical core          │
                      │  • Flat-to-APR rate normalization      │
                      │  • 4-Tier cash flow solvency verdict   │
                      │  • Cost-aware payoff simulator         │
                      └────────────────────────────────────────┘
```

---

## 🚀 Live Product Access

| Channel | Access Link / Number | Operational Status | Privacy Profile |
| --- | --- | --- | --- |
| **Interactive Web App** | **[https://debt-reality-checker.ai.studio/](https://debt-reality-checker.ai.studio/)** | **Live & Publicly Accessible** | **100% Client-Side**: All profile data, debts, and history remain in your browser's `localStorage`. No server calls. |
| **Official WhatsApp Bot** | Sandbox Test: `+1 555-152-7255` (`Test Number`) | **Meta Cloud API Webhook Verified** | **Pseudonymized**: Phone numbers are hashed via `HMAC-SHA256` before hitting SQLite. Data purged after 90 days or immediately via `DELETE MY DATA`. |
| **Console / CLI** | `npm run demo` / `npm run audit` | **Local / CI Verified** | Standalone deterministic runner; emits printable HTML audit reports. |

---

## 💡 Why "Zero AI" in the Financial Engine?

While generative AI models excel at text processing, they are non-deterministic, prone to calculation hallucinations, and inherently risky when diagnosing household solvency. 

In Debt Reality Checker:
1. **The mathematical core is 100% deterministic**: Every rate conversion (Newton-Raphson APR solver), cash-flow metric, band-edge calculation, and payoff projection is computed by pure, battle-tested JavaScript functions in `core/`.
2. **Explanations are bound to tested templates**: User-facing copy, glossary definitions, and prioritized recommendations are generated from verified rule-based templates in `core/plain_language.js` and `core/narrative.js`.
3. **No LLM in the financial path**: No generative model calculates health tiers, overrides emergency runway, or invents financial advice.
4. **Golden Fixture Assertions**: 415 automated tests assert exact reproducibility across published archetypes down to the individual rupee paise.

---

## 🎯 Target Users & Key Benefits

### Who It Is For
- **Salaried Employees**: Managing multiple credit cards and personal loans looking for a clear payoff roadmap.
- **Gig Economy & Variable Earners**: Needing realistic budgeting based on conservative income floors rather than optimistic peaks.
- **Households Evaluating New Borrowing**: Seeking to uncover hidden fees and true APRs before signing loan agreements.
- **Financial Counselors & Non-Profits**: Requiring an uncompromised, conflict-free diagnostic tool that never refers users to commercial lenders.

### Core User Benefits
- **True Rate Normalization**: Translates flat monthly quotes (e.g., "2% per month") and fee-laden digital loan offers into annualized APRs so apples-to-apples comparisons are possible.
- **The 4-Tier Cash-Flow Verdict**:
  - `Tier 1: Solvent` — Healthy breathing room, stable buffer, debts under control.
  - `Tier 2: Fragile` — Balanced today, but a single income disruption or medical emergency would trigger distress.
  - `Tier 3: Critical Debt Trap` — Minimum payments consume discretionary cash; balances threaten to spiral.
  - `Tier 4: Acute Cash-Flow Crisis` — Mandatory outgoings exceed effective income; immediate income protection and lender communication required.
- **Emergency Runway Protection**: Computes how many months accessible reserves will last under essential spending; thin buffers automatically cap the solvency rating.
- **Avalanche vs. Snowball Payoff Intelligence**: Compares mathematical optimization (highest interest first) against behavioral momentum (smallest balance first), complete with minimum payment rollover math and budget shortfall detection.

---

## 🔍 Feature Matrix

| Feature | Category | Status | Implementation Details |
| --- | --- | --- | --- |
| **Flat-Rate to APR Solver** | Financial Core | **Implemented** | Newton-Raphson numerical solver converts loan duration, flat rates, and upfront fees to true APR (`core/engine_v2.js`). |
| **4-Tier Solvency Classifier** | Financial Core | **Implemented** | Pure-function evaluation of FOIR, discretionary cash flow (DCF), emergency runway, interest burn, and dependency load (`core/policy.js`). |
| **Avalanche vs. Snowball Simulator** | Financial Core | **Implemented** | Full payoff simulation with freed minimum rollover and `BUDGET_BELOW_INTEREST` safety detection (`core/payoff.js`, `core/strategy.js`). |
| **Offline-First Web Dashboard** | Frontend | **Implemented** | 5-step React 18 SPA built with Vite; persists locally via `localStorage`; zero telemetry or external network calls (`web/`). |
| **Official WhatsApp Cloud API** | Messaging | **Implemented** | Public webhook endpoint with `X-Hub-Signature-256` HMAC validation, message chunking (`<=3800` chars), and Graph API retry with exponential backoff (`bot/whatsapp_cloud.js`). |
| **Persistent Deduplication** | Storage | **Implemented** | Webhook message IDs tracked in SQLite `processed_webhooks` table across restarts to prevent duplicate replies (`store/migrations.js`). |
| **Targeted Audit Editing (`EDIT`)** | Conversation | **Implemented** | Modify individual fields (e.g., `EDIT INCOME`, `EDIT DEBTS`) mid-flow or at review without re-answering the whole questionnaire (`bot/router.js`). |
| **Follow-Up Questions (`WHY`, `STRATEGY`)** | Conversation | **Implemented** | Instant on-demand explanations of tier drivers, buffer targets, and payoff strategies from the latest completed audit (`bot/router.js`). |
| **Right to Erasure (`DELETE MY DATA`)** | Privacy | **Implemented** | Permanently wipes user profile, debts, expenses, audits, and webhook idempotency records from SQLite in a single transaction (`store/retention.js`). |
| **Operational Probes (`/readyz`, `/healthz`)** | Operations | **Implemented** | Real-time liveness and database readiness checks with privacy-safe diagnostic error telemetry (`server.js`). |
| **Single-Line Expense Tracker (`LOG`)** | Personal Finance | **Partially Implemented** | Users can record daily expenses via WhatsApp (`LOG 250 groceries`); comprehensive weekly category reporting is planned. |
| **Vernacular Language Support** | Localization | **Planned** | Hindi, Tamil, Telugu, and Bengali conversational translations. |
| **Automated PDF Export via WhatsApp** | Reporting | **Planned** | Server-side PDF generation sent as an official WhatsApp document attachment. |

---

## 🗺️ User Journey

### 1. Web Dashboard Experience
```
  [1. Income] ───> [2. Essential Costs] ───> [3. Safety Net] ───> [4. Household] ───> [5. Debts]
                                                                                          │
                                                                                          ▼
  [Actionable Next Steps] <─── [Payoff Comparison] <─── [Solvency Verdict & Metrics] <────┘
```
1. **Intake Flow**: Five clean screens guide users through monthly take-home income, core living expenses, cash reserves, household earners/dependents, and existing loans/cards.
2. **Instant Local Diagnostic**: Pressing *View Reality Check* immediately executes Algorithm v2 locally in browser memory.
3. **Conversational Report**: Opens with an honest assessment in plain English, highlights key pressure points, displays the Avalanche vs. Snowball payoff timeline, and outlines 3 to 5 concrete immediate actions.

### 2. WhatsApp Bot Conversation Flow
```
User:  HI
Bot:   Welcome to Debt Reality Checker! Plain-English debt analysis...
       We store pseudonymized figures for 90 days. Reply AGREE to continue.

User:  AGREE
Bot:   Consent recorded. Send AUDIT to begin your reality check.

User:  AUDIT
Bot:   Step 1 of 8: What is your regular monthly take-home income?

User:  60k
Bot:   Got it — ₹60,000. Step 2 of 8: Was your income steady over the last 6 months?
       ... [Steps 3 to 8: Family help, Rent, Essentials, Savings, Debts] ...

User:  EDIT INCOME
Bot:   Updating Monthly income. What is your correct monthly take-home?

User:  55k
Bot:   Updated to ₹55,000. Review your summary. Reply YES to run diagnostic.

User:  YES
Bot:   *YOUR DEBT REALITY CHECK*
       Verdict: Tier 2 — Fragile.
       Your outgoings are covered today, but your cash buffer is under 1 month...
       Payoff Plan: Avalanche clears debt in 18 months saving ₹14,200 in interest.
       Top Action: Build ₹25,000 liquid buffer before aggressively paying extra principal.

User:  WHY
Bot:   Your debt-to-income ratio is 38%, which is manageable, but your emergency
       runway is only 0.8 months. Increasing your buffer by ₹22,000 moves you to Tier 1.

User:  DELETE MY DATA
Bot:   All your stored records and consent have been permanently erased.
```

---

## 🏗️ Architecture & Technology Stack

```mermaid
flowchart TD
    subgraph Clients["User Channels"]
        WebUser["Web Browser Client"]
        WAUser["WhatsApp Mobile User"]
    end

    subgraph Host["Google Cloud Run / Container Host"]
        HTTP["Unified HTTP Server (server.js / server.ts)"]
        Health["/readyz & /healthz Probes"]
        Static["Static Dashboard Assets (dist/web)"]
        CloudAPI["WhatsApp Cloud API Transport (bot/whatsapp_cloud.js)"]
        Router["Conversation Router (bot/router.js)"]
        
        subgraph Engine["Deterministic Financial Engine (core/)"]
            V2["Algorithm v2 Solvency Engine (engine_v2.js)"]
            Payoff["Payoff & Strategy Simulator (payoff.js / strategy.js)"]
            Narrative["Plain-Language Narrative Generator (narrative.js)"]
        end

        subgraph Storage["SQLite Persistence Layer (store/)"]
            DB["SQLite (WAL Mode, Integer Paise)"]
            Pseudo["HMAC-SHA256 Pseudonymizer (pseudonym.js)"]
            Retention["Retention Sweeper (90-day inactivity purge)"]
            Dedup["Webhook Idempotency Store (processed_webhooks)"]
        end
    end

    subgraph Meta["Meta Infrastructure"]
        Graph["Meta Graph API (v21.0)"]
    end

    WebUser -->|HTTPS GET /| Static
    WebUser -.->|Runs Algorithm v2 in Browser| Engine
    WAUser -->|Inbound WhatsApp Message| Graph
    Graph -->|Signed POST /webhook| CloudAPI
    CloudAPI -->|HMAC-SHA256 Verification| CloudAPI
    CloudAPI -->|Deduplicate Message ID| Dedup
    CloudAPI -->|Dispatch User Message| Router
    Router -->|Read / Write State| DB
    Router -->|Pseudonymize Sender| Pseudo
    Router -->|Execute Diagnostic| Engine
    CloudAPI -->|Send Outbound Reply (Backoff/Retry)| Graph
    Graph -->|Deliver Reply| WAUser
    HTTP --> Health
    HTTP --> Static
    HTTP --> CloudAPI
```

### Technology Breakdown
- **Runtime**: Node.js `>= 20.0.0` (ES modules, native cryptographic primitives).
- **Frontend**: React 18 + Vite 6, clean custom CSS, zero third-party UI dependencies.
- **Database**: SQLite with WAL (`Write-Ahead Logging`), foreign keys, indexed queries, and dual driver support (`better-sqlite3` native with automatic `node:sqlite` fallback).
- **Messaging Integration**: Official Meta WhatsApp Business Cloud API (`Graph API v21.0`) with HMAC-SHA256 signature verification, persistent idempotency, and per-sender rate limiting.
- **Test Runner**: Vitest 2 with unit, mathematical property, golden archetype, and integration suites.

---

## 🔒 Privacy Architecture & Trust Model

| Data Item | Storage & Retention Policy |
| --- | --- |
| **Phone Numbers / Sender IDs** | **Never stored in plaintext.** Every channel ID is hashed using `HMAC-SHA256(rawId, PSEUDONYM_SECRET)` and truncated to a 32-character hex string before touching the database. |
| **Financial Figures** | Stored strictly as integer paise (avoiding floating-point errors); tied only to the pseudonymized user key. |
| **Expense Descriptions** | **Discarded by default.** Free-text notes are stripped unless explicitly opted-in via `DRC_STORE_DESCRIPTIONS=true`. |
| **Webhook Delivery Records** | Message IDs stored in `processed_webhooks` for deduplication; purged automatically on user data erasure or retention expiry. |
| **Inactivity Purge** | Automated retention sweep runs on boot and every 6 hours, erasing all data for users inactive beyond `DRC_RETENTION_DAYS` (default 90 days). |
| **Right to Erasure** | Sending `DELETE MY DATA` permanently deletes user records, profiles, debts, expenses, audit history, and webhook records in a single transaction. |
| **Application Logs** | Structured JSON logs record operational events and error codes only. **Message bodies, phone numbers, API tokens, and financial figures are never logged.** |

---

## 💻 Getting Started (Local Development)

### Prerequisites
- **Node.js**: `>= 20.0.0`
- **npm**: `>= 9.0.0`
- **Git**

### Installation
```bash
# 1. Clone the repository
git clone https://github.com/bhaktaji/debt-reality-check.git
cd debt-reality-check

# 2. Install dependencies
npm install

# 3. Create your local environment configuration
cp .env.example .env
```

### Running Locally
```bash
# Run the unified full-stack server (Dashboard + Cloud API webhook + Health probes)
npm run dev
# Dashboard available at: http://localhost:3000
# Readiness probe:        http://localhost:3000/readyz

# Or run the standalone Vite dev server
npm run web
# Available at: http://localhost:5173
```

### Running CLI Tools & Golden Fixture Demos
```bash
# Run a full end-to-end CLI audit and generate a printable HTML report
npm run demo
# Emits report to: dist/demo-audit-report.html

# Run the 4 archetype calibration checks against Algorithm v2
npm run calibrate

# Validate all mathematical policy band edges
npm run calibrate -- --boundaries
```

---

## 🧪 Automated Testing & Verification

The test suite enforces mathematical correctness, monotonic property invariants, copy guardrails, and WhatsApp Cloud API resilience:

```bash
# Run all 415 automated tests across 22 test files
npm test

# Run linter
npm run lint

# Run full quality gate (Lint + Unit/Property Tests + Web Production Build)
npm run verify
```

### What the Test Suite Proves
- **Golden Archetypes**: Verifies that published financial archetype households match Algorithm v2 calculations down to the exact rupee.
- **Monotonic Property Invariants**: Proves that increasing income never worsens a tier, increasing mandatory payments never improves a tier, and scaling rupee amounts preserves tier classification.
- **Copy Guardrails**: Enforces that user-facing copy never uses words like `insolvent`, `insolvency`, `prohibited`, `mandated`, or `strictly required`.
- **Cloud API Transport Suite**: Verifies webhook challenge verification (`GET`), `X-Hub-Signature-256` validation (`POST`), payload sanitization, deduplication across restarts, long message chunking (`<=3800` chars), and Graph API retry backoff.

---

## 🚢 Deployment & Operations

For complete deployment guides, container configuration, Meta webhook setup, and token recovery runbooks, refer to the dedicated operations guides:

- **[Deployment & Cloud Run Operations Runbook](docs/DEPLOYMENT_AND_OPERATIONS.md)**: Container setup (`docs/Dockerfile.cloudrun`), Google Cloud Run configuration, single-instance SQLite WAL volume architecture, and backup procedures (`sqlite3 .backup`).
- **[WhatsApp Cloud API Testing & Troubleshooting Guide](docs/WHATSAPP_TESTING_AND_TROUBLESHOOTING.md)**: End-to-end testing, `/readyz` metric interpretation, Google Cloud Logs Explorer queries, and 24-hour token expiry recovery procedures.

---

## 📈 Roadmap & Development Milestones

### Current Release: v2.0.0 (Production-Ready Diagnostic)
- [x] Deterministic Algorithm v2 financial engine and Newton-Raphson APR solver.
- [x] Offline-first React 18 web dashboard.
- [x] Official Meta WhatsApp Business Cloud API webhook server with HMAC-SHA256 signature verification.
- [x] 8-step conversational intake router with targeted editing (`EDIT`) and pause/resume (`RESUME`).
- [x] Structured diagnostic endpoints (`/readyz`, `/healthz`) and zero-PII logging.

### Upcoming Milestones
- [ ] **Vernacular Language Support**: Localization for major Indian languages (Hindi, Tamil, Telugu, Marathi).
- [ ] **Automated PDF Export**: On-demand downloadable PDF solvency reports delivered directly in WhatsApp.
- [ ] **Bank Statement / Account Aggregator Integration**: Optional read-only import of loan schedules via India's Account Aggregator (AA) framework.
- [ ] **Multi-Currency Support**: Adaptation of thresholds and rate conventions for Southeast Asian emerging markets.

---

## ⚖️ Legal & Financial Disclaimer

**Informational & Diagnostic Assistance Only.** Debt Reality Checker is an educational and diagnostic calculation tool designed to help households evaluate their cash flow, understand debt payoff mechanics, and identify potential financial strain.

- It is **not** a credit bureau, lending platform, loan broker, or credit repair organization.
- It does **not** provide legal, tax, or investment advice.
- It does **not** evaluate legal insolvency or bankruptcy under the Insolvency and Bankruptcy Code (IBC).
- Households experiencing acute financial distress should consult a qualified, independent financial advisor or accredited non-profit credit counseling organization.

---

## 📄 License & Attribution

Distributed under the **MIT License**. See `LICENSE` for details.

*Debt Reality Checker — Built for clarity, transparency, and household financial resilience.*
