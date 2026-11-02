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
- **Workday Full-Flow End-to-End Sandbox (Modal + SSO Gate + 2-Stage Auth + Email Link + 3-Step Wizard)**: `http://127.0.0.1:18765/sandbox/workday-full-e2e`
- **Lever Sandbox**: `http://127.0.0.1:18765/sandbox/lever`
- **Full Autonomous Auto-Apply Sandbox (5-Stage E2E)**: `http://127.0.0.1:18765/sandbox/auto-apply`
- **Tricky SPA Auto-Submit & Self-Healing Sandbox**: `http://127.0.0.1:18765/sandbox/tricky-submit`

---

## ⭐ Implemented Features (Simplify Free + Simplify+ Premium + Full Auto-Apply)

### 🚀 End-to-End Autonomous Tailor & Auto-Apply (`START_FULL_AUTO_APPLY`)
Click **`🚀 Tailor & Apply`** on the floating pill, **`⚡ Fast Fill & Auto-Submit (Default PDF)`** for instant zero-tailor submission, or launch from the **Toolbar Popup**, **SidePanel**, or **Live Jobs Hub**:
1. **Job Detail & JD Salary Extraction**: Extracts role requirements, cover-letter requirements, and posted annual/hourly compensation ranges (dynamically using the JD's salary when stated, or falling back to `$120,000` / `$50/hr`).
2. **Parallel AI Resume + Cover Letter Tailoring**: Compiles a tailored single-column ATS `.pdf` resume and (when requested) Cover Letter `.pdf` concurrently using Gemini 3.x Flash (`thinkingBudget: 0` low-latency mode + automatic degraded-model cooldowns).
3. **Smart `Apply Now` & Multi-Option Modal Entry**: Clicks `Apply` / `Apply Now` while ignoring OneTrust/Cookiebot consent traps and navbar `Sign In` buttons, automatically selects **`Apply Manually`** in Workday modals, and follows SPA routes, embedded iframes, bundled `chrome-extension://` sandboxes, or spawned child tabs.
4. **Multi-Stage Portal Auth (`Sign in with email` + `Create Account` ↔ `Sign In` + `click_filter`)**: Navigates SSO choice gates (`Sign in with email`), email-first two-step logins, Workday's `opacity: 0` `click_filter` submit overlays & `Read More` / `opacity: 0` terms checkboxes, and two-step **Create Account → Email Verification Link → Sign In** flows.
5. **Dual-Engine Email OTP & Verification Link Auto-Reader**: Automatically reads 6–8 digit OTPs, Greenhouse 8-character security codes, and account verification links from your signed-in Chrome Gmail session (zero server required) or Companion IMAP.
6. **Self-Healing Validation & Autonomous Auto-Submit**: Detects CSS `::after` `"*"` required markers, Ashby `[]-labeled-checkbox-` multi-checkboxes, Yes/No pill buttons, and `opacity: 0` privacy checkboxes; waits out async blur-disabled Submit buttons; and if `Next` or `Submit` triggers inline validation errors or unmarked backend-required fields, automatically runs up to 3 self-healing repair passes (`healFormValidationErrors`) and re-submits before logging the application as **`Applied`**.

### Core & Simplify+ Features
- **Universal + Production ATS 1-Click Autofill (`extension/content/ats_adapters.js`)**:
  - Supports **Greenhouse Remix** (React-Select flyouts, `country` phone codes, async `candidate-location` geocode autocomplete, compliance/arbitration dropdowns), **Ashby** (auto-opens `/application` tab, Yes/No pill buttons, multi-checkbox groups), **Workday** (account signup walls + multi-entry repeaters + CC-305 disclosures), **Lever**, **SmartRecruiters**, **iCIMS**, **Rippling**, **BambooHR**, **LinkedIn**, and **embedded cross-origin ATS iframes**.
- **All-in-One Application Tracker**: Real-time search + stage filtering across `Bookmarked`, `Applied`, `OA / Assessment`, `Recruiter Screen`, `Technical Interview`, `Final Round`, `Offer`, and `Rejected`, with timeline history, notes, and CSV export.
- **Quick-Copy + Autonomous SidePanel & Drawer**: 1-click Auto-Apply, Fast Auto-Submit, Fill-Only, and clipboard chips for every profile field, experience bullets, and saved answers.
- **Missing Keyword Scanner, 100-Point ATS Scorer & 11 Live AI/SWE Job Feeds**: Pulls live engineering roles directly from **Anthropic, OpenAI, Perplexity, xAI, Cohere, Scale AI, Together AI, Databricks, Harvey, Stripe, and Figma** public ATS APIs with 1-click **`🚀 Auto-Apply`** launch + LinkedIn warm referral pathways.
