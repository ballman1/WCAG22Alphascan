# AACP Scanner — Alphapointe Accessibility Certification Program
## axe-core + Supabase Deployment Guide

Zero DOM modification. Zero tracking. axe-core WCAG 2.2 AA scanning + human tester workflow.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  SCANNER (Node.js)                                      │
│  Puppeteer → page load → axe-core inject → results     │
│  → violations normalized → Supabase insert              │
│  → delta detection (Tier 3) → delta_alerts table        │
└────────────────────┬────────────────────────────────────┘
                     │  Supabase (PostgreSQL)
                     │  clients / engagements / scans
                     │  violations / certifications / delta_alerts
┌────────────────────▼────────────────────────────────────┐
│  DASHBOARD (React)                                      │
│  Real-time reads via @supabase/supabase-js              │
│  Overview · Clients · Violations · Delta Alerts         │
│  Certification status · Seal token display              │
└─────────────────────────────────────────────────────────┘
```

---

## AACP Certification Logic

| Finding | Threshold | Result |
|---------|-----------|--------|
| 0 Critical, ≤2 High | Pass | **CERTIFIED** |
| Any Critical OR >2 High | Fail | **NOT CERTIFIED** |

axe-core severity mapping used by this scanner:
- `critical` + `serious` → AACP **Critical**
- `moderate` → AACP **High**
- `minor` → AACP **Medium**

---

## Step 1: Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in your Supabase dashboard
3. Paste and run the migration file:
   ```
   supabase/migrations/001_aacp_scanner.sql
   ```
4. Go to **Project Settings → API** and copy:
   - Project URL
   - `service_role` secret key (for scanner — never expose publicly)
   - `anon` public key (for dashboard)

---

## Step 2: Scanner Configuration

```bash
cd aacp-scanner
cp .env.example .env
```

Edit `.env`:
```env
SUPABASE_URL=https://yourref.supabase.co
SUPABASE_SERVICE_KEY=eyJhbG...  # service_role key
CHROME_PATH=/path/to/chrome     # see below
WCAG_LEVEL=wcag22aa
```

### Finding your Chrome path

| Platform | Path |
|----------|------|
| macOS | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| Ubuntu | `/usr/bin/google-chrome` or `/usr/bin/chromium-browser` |
| Puppeteer cache | `~/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome` |
| Docker | `/usr/bin/chromium` |

---

## Step 3: Install Dependencies

```bash
npm install
```

---

## Step 4: Run Your First Scan

### Quick scan (no database setup required)
```bash
node scanner/scanner.js quick https://example.gov https://example.gov/services
```

### Full engagement scan
First create a client and engagement in Supabase, then:
```bash
node scanner/scanner.js scan <engagement-uuid>
```

### Check Tier 3 delta alerts
```bash
node scanner/scanner.js deltas <client-uuid>
```

---

## Step 5: Dashboard Deployment

The dashboard (`dashboard/src/App.jsx`) is a React component.

### Option A: Deploy to Vercel (recommended)

```bash
cd dashboard
npm create vite@latest . -- --template react
# Replace src/App.jsx with aacp-scanner/dashboard/src/App.jsx
# Update SUPABASE_URL and SUPABASE_ANON_KEY in App.jsx
npm install @supabase/supabase-js
vercel deploy
```

### Option B: Run locally
```bash
npm run dev
```

### Option C: Use as Claude artifact
Paste the App.jsx contents into a Claude artifact (JSX mode).
The dashboard runs in demo mode with sample data until real credentials are configured.

---

## Step 6: Scheduled Rescans (Tier 3 Monitoring)

### GitHub Actions (free, recommended)

Create `.github/workflows/rescan.yml`:

```yaml
name: AACP Tier 3 Rescan
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday 6am UTC
  workflow_dispatch:       # Also manually triggerable

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install
      - run: npx puppeteer browsers install chrome
      - run: node scanner/scanner.js scan ${{ secrets.TIER3_ENGAGEMENT_ID }}
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          CHROME_PATH: /home/runner/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome
```

Add secrets in GitHub → Settings → Secrets and variables → Actions.

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `clients` | Organizations under certification |
| `engagements` | Audit or re-audit scoping |
| `scans` | One axe-core run per URL |
| `violations` | Normalized per-element violation rows |
| `certifications` | Formal cert records with seal tokens |
| `delta_alerts` | New violations vs. prior scan (Tier 3) |

---

## Seal Verification

Each certification generates a unique `seal_token`. To verify a seal publicly:

```sql
-- Run in Supabase SQL editor or via RPC
select verify_seal('abc123sealtoken');
```

Returns:
```json
{
  "valid": true,
  "client": "City of Springfield",
  "domain": "springfield.gov",
  "status": "certified",
  "wcag_level": "WCAG 2.2 AA",
  "issued_at": "2026-04-18T11:00:00Z",
  "expires_at": "2027-04-18T11:00:00Z",
  "pages_tested": 8
}
```

---

## What axe-core Catches (Automated — ~57% of WCAG issues)

- Missing or inadequate alt text (WCAG 1.1.1)
- Color contrast failures (WCAG 1.4.3, 1.4.11)
- Missing form labels (WCAG 1.3.1, 3.3.2)
- Invalid ARIA roles and attributes (WCAG 4.1.2)
- Missing page landmarks (WCAG 1.3.1)
- Keyboard focus issues detectable by DOM inspection
- Duplicate IDs, empty headings, skipped heading levels
- Missing language attribute, empty links and buttons

## What Requires Human Blind Testing (the other ~43%)

- Task completion barriers (can a blind user actually check out?)
- Confusing navigation flow and cognitive load
- Dynamic content and SPA state transitions
- Screen reader announcement quality and verbosity
- AT-specific rendering bugs not in the DOM
- Judgment calls: is this description meaningful to someone who cannot see the image?

**This is Alphapointe's irreplaceable value proposition.**
Automated scanning is the pre-scan baseline. Human blind testers are the certification.

---

## Legal Posture

This scanner:
- Makes **zero DOM modifications** to client sites
- Sends **no user data** to external servers
- Stores results only in **your own Supabase instance**
- Has **no always-on client-side script**
- Produces **independently verifiable** results (axe-core is open source, MPL 2.0)

Contrast with accessibility overlays:
- Full DOM write access on every page load
- Pre-consent user tracking to external servers
- Selector-based fixes that degrade silently
- FTC-fined vendors for false compliance claims (accessiBe, April 2025)

---

*AACP Scanner — Alphapointe Accessibility Certification Program*
*axe-core by Deque Systems (MPL 2.0) · Zero tracking · Zero DOM modification*
