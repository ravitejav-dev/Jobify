# ⚡ Jobify Copilot — Full Simplify + Simplify+ Chrome Extension

**Jobify** is an end-to-end Manifest V3 Chrome Extension and AI Career Suite pre-configured with **Raviteja Velanati's** Master & 1-Page Resumes, ATS Autofill Engine, and Gemini 3.x AI Tailoring Suite.

---

## 💻 Personal Laptop Setup & Live Sync Workflow

### 1. Clone & Load in Chrome (One-Time Setup)
```bash
git clone https://github.com/ravitejav-dev/jobify.git
cd jobify
```
1. Open Chrome on your personal laptop → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select the **`jobify/extension`** folder.
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

---

## ⭐ Implemented Features (Simplify Free + Simplify+ Premium Parity)

### Core Features
- **Universal + Production ATS 1-Click Autofill (`extension/content/ats_adapters.js`)**:
  - Supports **Greenhouse Remix** (React-Select flyouts, `country` phone codes, async `candidate-location` geocode autocomplete, compliance/arbitration dropdowns), **Ashby** (auto-opens `/application` tab, Yes/No pill buttons, async location autocomplete), **Workday** (account signup walls + multi-entry repeaters), **Lever**, **SmartRecruiters**, **iCIMS**, **Rippling**, **BambooHR**, **LinkedIn**, and **embedded cross-origin ATS iframes** (`?gh_jid=...` on Databricks, Stripe, etc.).
  - Attaches binary `.pdf` Resume & Cover Letter files directly into `<input type="file">`.
- **ATS Account Auto-Signup / Login**: Fills candidate portal signup/login walls + password confirmation + consent checkboxes.
- **All-in-One Application Tracker**: Kanban/table stage pipeline (`Bookmarked`, `Applied`, `OA / Assessment`, `Recruiter Screen`, `Technical Interview`, `Final Round`, `Offer`, `Rejected`) with timeline history, notes, and CSV export.
- **Quick-Copy SidePanel & Drawer**: 1-click clipboard chips for every profile field, experience bullets, and saved answers.
- **Personalized Job Match & Dealbreaker Engine (`extension/shared/ats_analyzer.js`)**: `0–99%` fit scoring with salary floor, location, and clearance/sponsorship dealbreaker alerts.
- **Missing Keyword Scanner & 100-Point ATS Scorer**: Flags missing JD technical skills and scores Keyword Alignment, Quantified Impact, Action Verbs, Parseability, and Seniority Fit.

### Simplify+ Premium AI Features
- **AI Resume Tailoring + ATS PDF Compiler (`extension/shared/gemini_client.js` + `extension/shared/pdf_generator.js`)**: Supports **Gemini 3.8 Flash** and **Gemini 3.1 Pro** with automatic Smart Quota Fallback to live Gemini 3.5 / 3 Flash models on Free Tier `429` limits.
- **Parallel AI Open-Ended Question Answering**: Inline `✨ Answer with Jobify AI` buttons + timeout-guarded parallel autofill for custom essay & dropdown questions.
- **AI Cover Letter Studio**: Generates custom cover letters with selectable tones and downloadable/attachable `.pdf` export.
- **Autopilot Queue**: Safe Review Mode (autofill + attach tailored PDF + pause) or Full Auto-Submit Mode, on-demand or scheduled via `chrome.alarms`.
- **Live Curated AI/SWE Job Feeds & Network Copilot (`extension/shared/job_feeds.js`)**: Pulls live engineering roles directly from Anthropic, OpenAI, Perplexity, Scale AI, Databricks, and Stripe public ATS APIs + LinkedIn warm referral search pathways.
