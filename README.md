# ⚡ Jobify Copilot — Full Simplify + Simplify+ Chrome Extension

**Jobify** is an end-to-end Manifest V3 Chrome Extension and AI Career Suite pre-configured with **Raviteja Velanati's** Master & 1-Page Resumes, ATS Autofill Engine, and Gemini 3.x AI Tailoring Suite.

---

## 💻 Personal Laptop Setup & Live Sync Workflow

### 1. Clone & Load in Chrome (One-Time Setup)
```bash
git clone https://github.com/ravitejav-dev/Jobify.git
cd Jobify
```
1. Open Chrome on your personal laptop → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select the **`Jobify/extension`** folder.
4. Pin **Jobify Copilot** (`J` icon) in your Chrome toolbar.

### 2. Add Your API Key & Portal Password Locally (Zero Secrets in Git)
Your Gemini API key and portal passwords are excluded from Git via `.gitignore` so they are never exposed on GitHub. Choose either option once on your personal laptop:
- **Option A (UI — Easiest)**: Click the Jobify icon → **Hub ↗** → **Vault & API** tab → paste your **Gemini API Key** and **Portal Password** → click **Save**. (Stored persistently in Chrome's local storage across all future `git pull` updates.)
- **Option B (Local File)**: Copy `extension/shared/local_secrets.example.json` to `extension/shared/local_secrets.json` and fill in your values.

### 3. Live Sync Workflow (`Jetski` ↔ `Personal Laptop`)
Whenever code changes are pushed from Jetski to `main`:
- **Automatic Live Pull Watcher (Recommended while testing)**:
  ```bash
  node backend/dev_sync.mjs
  ```
  Polls `origin/main` every 5 seconds, automatically pulls new commits, and chimes when an update lands.
- **Or Manual Pull**:
  ```bash
  git pull
  ```
- **1-Click Extension Hot-Reload (No `chrome://extensions` tab needed!)**:
  Click the **`↻`** button right inside the **Jobify Popup** or **Copilot Drawer** header — it reloads the extension and automatically re-injects updated scripts into your open job tabs!

---

## 🛠️ Optional: Local Companion Server (`pdflatex` PDF Compiler + ATS Sandboxes)
Jobify works **100% standalone** inside Chrome (with built-in pure-JS ATS PDF generation), and automatically upgrades to `pdflatex` typography if the optional Python server is running:
```bash
python3 backend/server.py
```
Local test sandboxes served on port `18765`:
- **Greenhouse Sandbox**: `http://127.0.0.1:18765/sandbox/greenhouse`
- **Workday + Account Signup Sandbox**: `http://127.0.0.1:18765/sandbox/workday`
- **Lever Sandbox**: `http://127.0.0.1:18765/sandbox/lever`
- **Full Autonomous Auto-Apply Sandbox (5-Stage E2E)**: `http://127.0.0.1:18765/sandbox/auto-apply`

---

## ⭐ Implemented Features (Simplify Free + Simplify+ Premium + Full Auto-Apply)

### 🚀 End-to-End Autonomous Full Auto-Apply (`START_FULL_AUTO_APPLY`)
Click **`🚀 Full Auto-Apply (Tailor → Login → Fill → Submit)`** in either the floating Copilot Drawer or Toolbar Popup on any job posting page:
1. **Job Detail & JD Salary Extraction**: Extracts role requirements, cover-letter requirements, and posted annual/hourly compensation ranges (dynamically using the JD's salary when stated, or falling back to `$120,000` / `$50/hr`).
2. **AI Resume + On-Demand Cover Letter Tailoring**: Compiles a tailored single-column ATS `.pdf` resume with Gemini (and automatically generates + compiles a tailored Cover Letter `.pdf` whenever requested by the JD or required by the form).
3. **Smart `Apply Now` Entry**: Clicks `Apply` / `Apply Now` / Workday `Apply Manually`, seamlessly following same-tab routes, SPA modals, embedded iframes, or newly spawned child tabs.
4. **Sharp Portal Login / Signup + Verify Password**: Signs in with your Vault email & password, and if no account exists yet, automatically switches to **Create Account**, fills **Password + Verify/Confirm Password**, and checks privacy/terms consent boxes.
5. **Dual-Engine Email OTP Auto-Reader**: Automatically reads 6–8 digit OTPs and Greenhouse 8-character security codes from your signed-in Chrome Gmail session (zero server required) or Companion IMAP, fills single or 4–8 split OTP boxes, and clicks Verify.
6. **Clean Needed-Only 1-by-1 Field Filling + Multi-Step Submit**: Inventories all fields on each wizard step first, fills strictly required/relevant fields one by one (leaving optional "Additional Information" fluff boxes untouched), advances through `Next / Save & Continue`, auto-submits, and logs the role as **`Applied`** in the Jobify Tracker.

### Core & Simplify+ Features
- **Universal + Production ATS 1-Click Autofill (`extension/content/ats_adapters.js`)**:
  - Supports **Greenhouse Remix** (React-Select flyouts, `country` phone codes, async `candidate-location` geocode autocomplete, compliance/arbitration dropdowns), **Ashby** (auto-opens `/application` tab, Yes/No pill buttons, async location autocomplete), **Workday** (account signup walls + multi-entry repeaters), **Lever**, **SmartRecruiters**, **iCIMS**, **Rippling**, **BambooHR**, **LinkedIn**, and **embedded cross-origin ATS iframes**.
- **All-in-One Application Tracker**: Kanban/table stage pipeline (`Bookmarked`, `Applied`, `OA / Assessment`, `Recruiter Screen`, `Technical Interview`, `Final Round`, `Offer`, `Rejected`) with timeline history, notes, and CSV export.
- **Quick-Copy SidePanel & Drawer**: 1-click clipboard chips for every profile field, experience bullets, and saved answers.
- **Missing Keyword Scanner, 100-Point ATS Scorer & Live AI/SWE Job Feeds**: Pulls live engineering roles directly from Anthropic, OpenAI, Perplexity, Scale AI, Databricks, and Stripe public ATS APIs + LinkedIn warm referral pathways.
