// Jobify Full-Page Career Hub Controller (White Edition + Full Autonomous Suite)
import { scoreResumeATS } from "../shared/ats_analyzer.js";
import { buildNetworkCopilotPathways, STAFFING_AGENCIES_DIRECTORY, fetchPersonalizedRecommendations } from "../shared/job_feeds.js";

let STATE = null;
let AUTO_APPLY_STATUS = null;
let AUTO_APPLY_QUEUE_LEN = 0;
let currentView = (location.hash || "#overview").replace("#", "") || "overview";
let cachedLiveJobs = [];
let selectedJobIndexes = new Set();

let trackerFilterQ = "";
let trackerFilterStage = "All";
let trackerViewMode = "table"; // "table" | "kanban"
let expandedReceiptAppId = null;
let pendingInterviewDraft = null;

const VIEW_HEADERS = {
  overview: ["Overview, Conversion Funnel & Quick Launch", "Your Simplify+ Autonomous Career Copilot pre-loaded with Raviteja Velanati's profile"],
  tracker: ["Application Tracker & Kanban Pipeline", "Track bookmarks, submitted receipts, tailored résumé diffs, follow-up alerts & Kanban stages"],
  resume: ["AI Resume Tailor, Live Editor & ATS Heatmap", "Tailor bullets with Gemini 3.5 Flash, interactively edit every section & re-compile 1-page ATS PDFs"],
  cover: ["AI Cover Letter Studio", "Generate custom recruiter-ready cover letters, manage saved drafts & export ATS PDFs"],
  interview: ["AI Interview Prep & Role Cheat-Sheet Studio", "Synthesize 60s elevator pitches, role-specific system design Q&As & quantified STAR stories"],
  jobs: ["Multi-Platform Job Discovery, Batch Auto-Apply & 128 Staffing Agencies", "Live roles across 35+ ATS portals with Duplicate-Apply Guard & multi-select FIFO Batch Auto-Apply"],
  autopilot: ["Autopilot Control Center & Bulk Portal Queue", "Sequential FIFO multi-portal Auto-Apply runner, bulk URL enqueue & recurring schedule"],
  network: ["Network Copilot — Warm Referral Pathfinder", "Map alumni, ex-colleagues, hiring managers & AI-drafted outreach notes"],
  vault: ["Profile, Resume Vault, Zero-Touch Controls & Backup", "Edit candidate details, portal logins, domain passwords, hands-free portal mode & JSON vault backups"]
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg) {
  const el = document.getElementById("global-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3200);
}

function downloadBase64(base64, fileName, mime = "application/pdf") {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function downloadText(text, fileName, mime = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function normalizeUrlKey(rawUrl) {
  const u = String(rawUrl || "").trim().toLowerCase();
  if (!u) return "";
  return u.replace(/[?#].*$/, "").replace(/\/+$/, "");
}

function isJobAlreadyApplied(job, applications = []) {
  const jUrl = normalizeUrlKey(job?.url);
  const jComp = String(job?.company || "").trim().toLowerCase();
  const jRole = String(job?.title || job?.role || "").trim().toLowerCase();
  return applications.some((a) => {
    const isDone = a.status === "Applied" || a.pipelineStage === "submitted";
    if (!isDone) return false;
    const aUrl = normalizeUrlKey(a.url);
    if (jUrl && aUrl && jUrl === aUrl) return true;
    return Boolean(jComp && jRole && String(a.company || "").trim().toLowerCase() === jComp && String(a.role || "").trim().toLowerCase() === jRole);
  });
}

function isFollowUpDue(app) {
  if (!app || app.status !== "Applied") return false;
  const ts = Date.parse(app.updatedAt || app.createdAt || "");
  if (!Number.isFinite(ts)) return false;
  const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return days >= 5;
}

function openReceiptModal(app) {
  const modal = document.getElementById("hub-receipt-modal");
  const titleEl = document.getElementById("hub-receipt-title");
  const bodyEl = document.getElementById("hub-receipt-body");
  if (!modal || !bodyEl || !app) return;

  const receiptFields = Array.isArray(app.fieldsReceipt) && app.fieldsReceipt.length
    ? app.fieldsReceipt
    : [
        { label: "Full Name", value: STATE?.profile?.personal?.fullName || "Raviteja Velanati" },
        { label: "Email", value: STATE?.credentials?.portalEmail || "ravitejavelanati11@gmail.com" },
        { label: "Phone", value: STATE?.profile?.personal?.phone || "(774) 418-6241" },
        { label: "Résumé PDF", value: app.resumeUsed || "Tailored 1-Page ATS PDF" },
        { label: "US Work Auth", value: STATE?.profile?.workAuthAndEEO?.authorizedUS || "Yes" },
        { label: "Visa Status", value: STATE?.profile?.workAuthAndEEO?.visaStatus || "H-1B" }
      ];
  const diffList = Array.isArray(app.resumeDiff) ? app.resumeDiff : [];

  titleEl.textContent = `🧾 Submission Receipt — ${app.company || "Company"} (${app.role || "Role"})`;
  bodyEl.innerHTML = `
    <div class="grid-2">
      <div class="sub-box">
        <div style="font-weight:800;color:#047857;margin-bottom:10px;font-size:13.5px;">
          ✓ What Just Got Sent to ${esc(app.ats || app.company)} (${receiptFields.length} verified fields)
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:6px;font-size:12.5px;">
          ${receiptFields
            .map(
              (f) => `<div style="padding:7px 10px;background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;">
                <span style="color:#059669;font-weight:700;">✓ ${esc(f.label)}:</span>
                <span style="color:#0f172a;margin-left:5px;">${esc(f.value)}</span>
              </div>`
            )
            .join("")}
        </div>
      </div>
      <div class="sub-box">
        <div style="font-weight:800;color:#4338ca;margin-bottom:10px;font-size:13.5px;">
          ✨ Tailored Résumé Diff (${esc(app.resumeUsed || "1-Page ATS PDF")})
        </div>
        ${
          diffList.length === 0
            ? `<div style="font-size:12.5px;color:#475569;line-height:1.55;">
                1-page ATS résumé compiled with target job title header, 4-sentence impact summary, 4 structured skill categories, and 14 quantified bullets with unique action verbs.
              </div>`
            : diffList
                .slice(0, 4)
                .map(
                  (d) => `<div style="margin-bottom:8px;padding:9px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">
                    <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">${esc(d.company)} — ${esc(d.role)}</div>
                    <div style="color:#dc2626;margin-bottom:3px;">− ${esc(d.before)}</div>
                    <div style="color:#047857;">+ ${esc(d.after)}</div>
                  </div>`
                )
                .join("")
        }
      </div>
    </div>
  `;
  modal.style.display = "flex";
}

document.getElementById("hub-receipt-close")?.addEventListener("click", () => {
  const modal = document.getElementById("hub-receipt-modal");
  if (modal) modal.style.display = "none";
});
document.getElementById("hub-receipt-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "hub-receipt-modal") e.currentTarget.style.display = "none";
});

async function reloadState() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" });
  STATE = resp?.state || {};
  AUTO_APPLY_STATUS = resp?.autoApplyStatus || null;
  AUTO_APPLY_QUEUE_LEN = Number(resp?.queueLength || 0);

  document.getElementById("sb-user-name").textContent = STATE.profile?.personal?.fullName || "Raviteja Velanati";
  document.getElementById("sb-user-email").textContent = STATE.profile?.personal?.email || "";
  document.getElementById("topbar-model-pill").textContent = `AI: ${STATE.settings?.primaryModel || "gemini-3.5-flash"}${
    STATE.settings?.enableSmartFallback ? " • Smart Quota Ready" : ""
  }`;

  const qPill = document.getElementById("topbar-queue-pill");
  if (qPill) {
    if (AUTO_APPLY_STATUS?.running || AUTO_APPLY_QUEUE_LEN > 0) {
      qPill.style.display = "inline-flex";
      qPill.textContent = `⚡ Active Auto-Apply${AUTO_APPLY_QUEUE_LEN > 0 ? ` • +${AUTO_APPLY_QUEUE_LEN} Queued` : ""}`;
    } else {
      qPill.style.display = "none";
    }
  }
}

function switchView(view) {
  currentView = VIEW_HEADERS[view] ? view : "overview";
  location.hash = currentView;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === currentView));
  const [t, s] = VIEW_HEADERS[currentView];
  document.getElementById("topbar-title").textContent = t;
  document.getElementById("topbar-sub").textContent = s;
  renderCurrentView();
}

async function renderCurrentView() {
  const c = document.getElementById("view-container");
  if (!STATE) await reloadState();

  if (currentView === "overview") return renderOverview(c);
  if (currentView === "tracker") return renderTracker(c);
  if (currentView === "resume") return renderResumeStudio(c);
  if (currentView === "cover") return renderCoverStudio(c);
  if (currentView === "interview") return renderInterviewStudio(c);
  if (currentView === "jobs") return renderLiveJobs(c);
  if (currentView === "autopilot") return renderAutopilot(c);
  if (currentView === "network") return renderNetworkCopilot(c);
  if (currentView === "vault") return renderVaultAndProfile(c);
}

function renderOverview(c) {
  const apps = STATE.applications || [];
  const baseAudit = scoreResumeATS(
    STATE.profile,
    "AI/ML Platform Engineer Python TypeScript React LangGraph LLM Evaluation Agentic AI Docker Kubernetes GCP AWS PyTorch Playwright"
  );
  const companionUrl = STATE.settings?.companionServerUrl || "http://127.0.0.1:18765";

  const totalApps = Math.max(1, apps.length);
  const savedCount = apps.filter((a) => a.status === "Bookmarked").length;
  const inFlightCount = apps.filter((a) => a.status === "In Flight" || a.status === "Filled").length;
  const appliedCount = apps.filter((a) => a.status === "Applied").length;
  const interviewCount = apps.filter((a) => ["OA / Assessment", "Recruiter Screen", "Technical Interview", "Final Round"].includes(a.status)).length;
  const offerCount = apps.filter((a) => a.status === "Offer").length;
  const followUpDueCount = apps.filter(isFollowUpDue).length;

  const atsCounts = {};
  apps.forEach((a) => {
    const key = String(a.ats || "Direct Portal").trim();
    atsCounts[key] = (atsCounts[key] || 0) + 1;
  });
  const topAts = Object.entries(atsCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  c.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-val">${apps.length}</div>
        <div class="kpi-lbl">Tracked Jobs (${appliedCount} Submitted${followUpDueCount ? ` • ${followUpDueCount} Follow-Up Due` : ""})</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val" style="color:#059669;">${baseAudit.totalScore}/100</div>
        <div class="kpi-lbl">Baseline ATS Resume Score</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val">${(STATE.tailoredResumes || []).length}</div>
        <div class="kpi-lbl">AI-Tailored 1-Page PDF Resumes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val" style="color:#7c3aed;">${(STATE.interviewPreps || []).length}</div>
        <div class="kpi-lbl">AI Role Interview Cheat-Sheets</div>
      </div>
    </div>

    <div class="card" style="border-color:#c7d2fe;background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);">
      <div class="card-title">
        <span>🚀 Universal Career Portal Auto-Apply Launcher (Zero-Touch Any ATS URL)</span>
        <span class="chip green">35+ ATS Portals + Shadow DOM + FIFO Queue</span>
      </div>
      <p style="font-size:13px;color:#475569;margin-bottom:12px;">
        Paste any job posting or direct career portal URL (Workday, Greenhouse, Ashby, Lever, SmartRecruiters, iCIMS, Oracle Cloud HCM, SAP SuccessFactors, Eightfold, Phenom, or corporate career sites) to tailor a 1-page PDF, resolve login/signup, fill every field, and submit automatically in the background:
      </p>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:center;">
        <input class="input" id="ov-custom-url" placeholder="https://company.wd5.myworkdayjobs.com/... or https://job-boards.greenhouse.io/..." />
        <input class="input" id="ov-custom-company" placeholder="Company (optional — auto-detected)" />
        <input class="input" id="ov-custom-role" placeholder="Role Title (optional — auto-detected)" />
        <button class="btn emerald" id="btn-ov-launch-url">⚡ Auto-Apply Now</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>📈 Application Conversion Funnel &amp; Portal Telemetry</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${
            topAts.length
              ? topAts.map(([k, cnt]) => `<span class="chip slate">${esc(k)}: ${cnt}</span>`).join("")
              : `<span class="chip slate">Ready for multi-portal tracking</span>`
          }
        </div>
      </div>
      <div class="funnel-grid">
        ${[
          { label: "Saved / Queued", val: savedCount, pct: Math.round((savedCount / totalApps) * 100) },
          { label: "In Flight / Filled", val: inFlightCount, pct: Math.round((inFlightCount / totalApps) * 100) },
          { label: "Submitted", val: appliedCount, pct: Math.round((appliedCount / totalApps) * 100) },
          { label: "OA / Interview", val: interviewCount, pct: Math.round((interviewCount / totalApps) * 100) },
          { label: "Offers", val: offerCount, pct: Math.round((offerCount / totalApps) * 100) }
        ]
          .map(
            (st) => `
          <div class="funnel-step">
            <div style="display:flex;justify-content:space-between;align-items:baseline;">
              <span style="font-size:20px;font-weight:800;color:#0f172a;">${st.val}</span>
              <span style="font-size:11px;font-weight:700;color:#4f46e5;">${apps.length ? st.pct : 0}%</span>
            </div>
            <div style="font-size:12px;color:#475569;font-weight:600;margin-top:2px;">${esc(st.label)}</div>
            <div class="funnel-bar-track"><div class="funnel-bar-fill" style="width:${apps.length ? Math.max(6, st.pct) : 0}%;"></div></div>
          </div>`
          )
          .join("")}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">🧪 Test 1-Click Autofill &amp; Portal Stress Sandboxes</div>
        <p style="font-size:13px;color:#475569;margin-bottom:14px;">
          Launch realistic local multi-ATS portals (Greenhouse, Workday + Signup, Lever, and Shadow-DOM + Repeater Stress Portal) to verify zero-touch autofill, PDF attachment, and auto-submit:
        </p>
        <div class="grid-2" style="gap:10px;">
          <a class="btn primary" href="${esc(chrome.runtime.getURL("sandbox/greenhouse.html"))}" target="_blank">Greenhouse Sandbox ↗</a>
          <a class="btn primary" href="${esc(chrome.runtime.getURL("sandbox/workday.html"))}" target="_blank">Workday + Signup ↗</a>
          <a class="btn primary" href="${esc(chrome.runtime.getURL("sandbox/lever.html"))}" target="_blank">Lever Sandbox ↗</a>
          <a class="btn secondary" href="${esc(`${companionUrl}/sandbox/portal-advanced`)}" target="_blank">Shadow DOM + Repeater ↗</a>
        </div>
      </div>

      <div class="card">
        <div class="card-title">⚡ Pre-Analyzed Candidate Snapshot</div>
        <div style="font-size:13px;line-height:1.7;color:#334155;">
          <div><strong style="color:#0f172a;">Name:</strong> ${esc(STATE.profile.personal.fullName)} (${esc(STATE.profile.personal.locationDisplay)})</div>
          <div><strong style="color:#0f172a;">Current Role:</strong> ${esc(STATE.profile.personal.currentTitle)} @ ${esc(STATE.profile.personal.currentCompany)}</div>
          <div><strong style="color:#0f172a;">Education:</strong> M.S. CS, Clark University (3.5 GPA) • B.Tech CS, Malla Reddy (3.6 GPA)</div>
          <div><strong style="color:#0f172a;">Bundled PDFs:</strong> <span class="chip indigo">1-Page Resume</span> <span class="chip indigo">2-Page Master Resume</span></div>
          <div><strong style="color:#0f172a;">Portal Vault:</strong> <span class="chip green">${esc(STATE.credentials.portalEmail)}</span></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Recent AI-Tailored Resumes</span>
        <div style="display:flex;gap:8px;">
          <button class="btn sm secondary" id="ov-go-interview">🎤 Interview Prep Studio</button>
          <button class="btn sm primary" id="ov-go-resume">+ Tailor New Resume</button>
        </div>
      </div>
      ${
        (STATE.tailoredResumes || []).length === 0
          ? `<p style="font-size:13px;color:#64748b;">No tailored resumes generated yet. Open any job tab or click "+ Tailor New Resume" to build your first tailored ATS PDF.</p>`
          : `<table class="table">
              <thead><tr><th>Company</th><th>Role</th><th>Model</th><th>ATS Score</th><th>Created</th><th>Action</th></tr></thead>
              <tbody>
                ${STATE.tailoredResumes
                  .slice(0, 8)
                  .map(
                    (r, i) => `
                  <tr>
                    <td><strong style="color:#0f172a;">${esc(r.company)}</strong></td>
                    <td>${esc(r.role)}</td>
                    <td><span class="chip indigo">${esc(r.modelUsed)}</span></td>
                    <td><span class="chip green">${r.atsScore || 94}/100</span></td>
                    <td>${new Date(r.createdAt).toLocaleDateString()}</td>
                    <td style="display:flex;gap:6px;">
                      <button class="btn sm secondary ov-dl-tr" data-idx="${i}">⬇ Download PDF</button>
                    </td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
      }
    </div>
  `;

  c.querySelector("#ov-go-resume")?.addEventListener("click", () => switchView("resume"));
  c.querySelector("#ov-go-interview")?.addEventListener("click", () => switchView("interview"));
  c.querySelector("#btn-ov-launch-url")?.addEventListener("click", async () => {
    const url = c.querySelector("#ov-custom-url")?.value.trim();
    if (!url) return toast("Paste a career portal or job posting URL first.");
    const company = c.querySelector("#ov-custom-company")?.value.trim() || "";
    const role = c.querySelector("#ov-custom-role")?.value.trim() || "";
    toast("🚀 Queued autonomous background Auto-Apply! Watch progress in Job Tracker.");
    await chrome.runtime.sendMessage({
      type: "LAUNCH_TAB_AND_AUTO_APPLY",
      payload: {
        url,
        active: false,
        options: {
          autoSubmit: STATE.settings?.autoSubmitEnabled !== false,
          tailorResume: true,
          ...(company || role ? { jobMeta: { company, title: role, url } } : {})
        }
      }
    });
    await reloadState();
    renderOverview(c);
  });

  c.querySelectorAll(".ov-dl-tr").forEach((b) => {
    b.addEventListener("click", () => {
      const tr = STATE.tailoredResumes[Number(b.dataset.idx)];
      downloadBase64(tr.pdfBase64, tr.fileName);
    });
  });
}

function renderTracker(c) {
  const apps = STATE.applications || [];
  const statuses = [
    "In Flight",
    "Filled",
    "Applied",
    "Needs You",
    "Bookmarked",
    "OA / Assessment",
    "Recruiter Screen",
    "Technical Interview",
    "Final Round",
    "Offer",
    "Rejected"
  ];

  const qNorm = trackerFilterQ.trim().toLowerCase();
  const filteredApps = apps.filter((a) => {
    if (trackerFilterStage !== "All" && a.status !== trackerFilterStage) return false;
    if (!qNorm) return true;
    const hay = `${a.company || ""} ${a.role || ""} ${a.location || ""} ${a.ats || ""} ${a.notes || ""} ${a.stepLabel || ""}`.toLowerCase();
    return hay.includes(qNorm);
  });

  const inFlightCount = apps.filter((a) => a.status === "In Flight" || a.pipelineStage === "in_flight").length;
  const filledCount = apps.filter((a) => a.status === "Filled" || a.pipelineStage === "filled").length;
  const submittedCount = apps.filter((a) => a.status === "Applied" || a.pipelineStage === "submitted").length;
  const needsYouCount = apps.filter((a) => a.status === "Needs You" || a.pipelineStage === "needs_you").length;

  const kanbanColumns = [
    { title: "Bookmarked / Saved", targetStatus: "Bookmarked", match: (a) => a.status === "Bookmarked" },
    { title: "In Flight / Filled", targetStatus: "In Flight", match: (a) => a.status === "In Flight" || a.status === "Filled" || a.status === "Needs You" },
    { title: "Submitted / Applied", targetStatus: "Applied", match: (a) => a.status === "Applied" },
    { title: "OA & Interviews", targetStatus: "Technical Interview", match: (a) => ["OA / Assessment", "Recruiter Screen", "Technical Interview", "Final Round"].includes(a.status) },
    { title: "Offers & Decisions", targetStatus: "Offer", match: (a) => a.status === "Offer" || a.status === "Rejected" }
  ];

  c.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:14px;">
      <div class="kpi-card" style="border-color:${inFlightCount > 0 ? "#0284c7" : "#e2e8f0"};">
        <div class="kpi-val" style="color:#0284c7;">${inFlightCount}</div>
        <div class="kpi-lbl">⚡ In Flight (Reading JD / Tailoring / Auth)</div>
      </div>
      <div class="kpi-card" style="border-color:${filledCount > 0 ? "#7c3aed" : "#e2e8f0"};">
        <div class="kpi-val" style="color:#7c3aed;">${filledCount}</div>
        <div class="kpi-lbl">✍️ Filled (Fields &amp; PDF Attached)</div>
      </div>
      <div class="kpi-card" style="border-color:#a7f3d0;">
        <div class="kpi-val" style="color:#059669;">${submittedCount}</div>
        <div class="kpi-lbl">✅ Submitted (Moved to Applied Tracker)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val" style="color:#d97706;">${needsYouCount}</div>
        <div class="kpi-lbl">🧩 Needs You (Manual Check / CAPTCHA)</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>+ Add or Auto-Apply Job in Background (Zero Tab Interruption)</span>
        <button class="btn sm secondary" id="trk-export-csv">⬇ Export CSV</button>
      </div>
      <div class="grid-3">
        <input class="input" id="trk-comp" placeholder="Company (e.g., Anthropic)" />
        <input class="input" id="trk-role" placeholder="Role Title (e.g., AI Platform Engineer)" />
        <input class="input" id="trk-url" placeholder="Application URL (https://...)" />
      </div>
      <div class="grid-3" style="margin-top:10px;">
        <input class="input" id="trk-loc" placeholder="Location (e.g., San Francisco, CA)" />
        <select class="select" id="trk-status">
          ${statuses.map((s) => `<option value="${esc(s)}" ${s === "Bookmarked" ? "selected" : ""}>${esc(s)}</option>`).join("")}
        </select>
        <div style="display:flex;gap:8px;">
          <button class="btn secondary" id="trk-add-btn" style="flex:1;">+ Save to Tracker</button>
          <button class="btn emerald" id="trk-add-and-apply-btn" style="flex:1.2;">🚀 Auto-Apply in Background</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title" style="flex-wrap:wrap;gap:10px;">
        <span>Live Application Pipeline &amp; Tracker (${filteredApps.length}${filteredApps.length !== apps.length ? ` of ${apps.length}` : ""})</span>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <div style="display:inline-flex;gap:4px;background:#f1f5f9;padding:3px;border-radius:9px;border:1px solid #e2e8f0;">
            <button type="button" class="btn sm secondary ${trackerViewMode === "table" ? "active-tab" : ""}" id="btn-trk-view-table">📋 Table</button>
            <button type="button" class="btn sm secondary ${trackerViewMode === "kanban" ? "active-tab" : ""}" id="btn-trk-view-kanban">🗂️ Kanban</button>
          </div>
          <input class="input" id="trk-filter-q" value="${esc(trackerFilterQ)}" placeholder="Search company, role, notes..." style="width:220px;padding:6px 10px;font-size:12px;" />
          <select class="select" id="trk-filter-stage" style="width:170px;padding:6px 10px;font-size:12px;">
            <option value="All" ${trackerFilterStage === "All" ? "selected" : ""}>All Stages (${apps.length})</option>
            ${statuses
              .map(
                (s) =>
                  `<option value="${esc(s)}" ${trackerFilterStage === s ? "selected" : ""}>${esc(s)} (${
                    apps.filter((a) => a.status === s).length
                  })</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      ${
        filteredApps.length === 0
          ? `<p style="font-size:13px;color:#64748b;">${
              apps.length === 0
                ? "No applications logged yet. Click Auto-Apply on any job to watch it transition live from In Flight → Filled → Submitted!"
                : "No applications match the current filter."
            }</p>`
          : trackerViewMode === "kanban"
          ? `<div class="kanban-board" id="trk-kanban-board">
              ${kanbanColumns
                .map((col) => {
                  const colApps = filteredApps.filter(col.match);
                  return `
                  <div class="kanban-col" data-drop-status="${esc(col.targetStatus)}">
                    <div class="kanban-col-hdr">
                      <span>${esc(col.title)}</span>
                      <span class="chip indigo">${colApps.length}</span>
                    </div>
                    ${colApps
                      .map(
                        (a) => `
                      <div class="kanban-card" draggable="true" data-drag-id="${esc(a.id)}">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px;">
                          <strong style="color:#0f172a;font-size:13px;">${esc(a.company)}</strong>
                          <span class="chip green" style="font-size:10.5px;">${a.matchScore || 92}%</span>
                        </div>
                        <div style="font-size:12px;color:#334155;font-weight:500;">${esc(a.role)}</div>
                        <div style="font-size:11px;color:#64748b;">${esc(a.ats || "Portal")} • ${esc(a.resumeUsed || "1-Page PDF")}</div>
                        ${isFollowUpDue(a) ? `<span class="chip amber" style="font-size:10px;align-self:flex-start;">⏰ Follow-Up Due (5d+)</span>` : ""}
                        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;">
                          <button type="button" class="btn sm secondary trk-open-receipt-modal" data-id="${esc(a.id)}">🧾 Receipt</button>
                          <button type="button" class="btn sm secondary trk-prep-btn" data-id="${esc(a.id)}">🎤 Prep</button>
                          ${
                            a.url && a.status !== "Applied" && a.status !== "In Flight"
                              ? `<button type="button" class="btn sm emerald trk-auto-apply" data-id="${esc(a.id)}">⚡ Apply</button>`
                              : ""
                          }
                        </div>
                      </div>`
                      )
                      .join("")}
                  </div>`;
                })
                .join("")}
            </div>`
          : `<table class="table">
              <thead>
                <tr>
                  <th>Company &amp; Role</th>
                  <th>ATS / Résumé PDF</th>
                  <th>Match</th>
                  <th>Live Pipeline Stage</th>
                  <th>Telemetry / Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${filteredApps
                  .map((a) => {
                    const isExpanded = expandedReceiptAppId === a.id;
                    const badgeTone =
                      a.status === "In Flight"
                        ? "sky"
                        : a.status === "Filled"
                        ? "amber"
                        : a.status === "Applied"
                        ? "green"
                        : a.status === "Rejected"
                        ? "rose"
                        : "indigo";
                    const receiptFields = Array.isArray(a.fieldsReceipt) ? a.fieldsReceipt : [];
                    const diffList = Array.isArray(a.resumeDiff) ? a.resumeDiff : [];
                    return `
                  <tr data-id="${esc(a.id)}">
                    <td>
                      <div style="font-weight:700;color:#0f172a;">${esc(a.company)}</div>
                      <div style="font-size:12px;color:#334155;">${esc(a.role)}</div>
                      <div style="font-size:11px;color:#64748b;">📍 ${esc(a.location || "United States")}</div>
                      ${isFollowUpDue(a) ? `<div style="margin-top:3px;"><span class="chip amber" style="font-size:10.5px;">⏰ Follow-Up Due</span></div>` : ""}
                      ${a.url ? `<a href="${esc(a.url)}" target="_blank" style="font-size:11px;color:#4f46e5;font-weight:600;">Open Posting ↗</a>` : ""}
                    </td>
                    <td>
                      <span class="chip indigo">${esc(a.ats || "Portal")}</span>
                      <div style="font-size:11px;color:#047857;margin-top:4px;font-family:monospace;font-weight:600;">📄 ${esc(a.resumeUsed || "Tailored PDF")}</div>
                    </td>
                    <td><span class="chip green">${a.matchScore || 92}%</span></td>
                    <td>
                      <div style="margin-bottom:4px;">
                        <span class="chip ${badgeTone}">${esc(a.stepLabel || a.status || "Applied")}</span>
                      </div>
                      <select class="select trk-stage-sel" data-id="${esc(a.id)}" style="width:165px;font-size:11.5px;padding:4px 8px;">
                        ${statuses
                          .map((s) => `<option value="${esc(s)}" ${a.status === s ? "selected" : ""}>${esc(s)}</option>`)
                          .join("")}
                      </select>
                    </td>
                    <td>
                      <div style="font-size:11.5px;color:#475569;margin-bottom:4px;">${esc(a.detail || "")}</div>
                      <input class="input trk-note-inp" data-id="${esc(a.id)}" value="${esc(a.notes || "")}" placeholder="Add interview note or referral contact..." style="font-size:11.5px;padding:5px 8px;" />
                    </td>
                    <td>
                      <div style="display:flex;gap:5px;flex-wrap:wrap;">
                        ${
                          a.url && a.status !== "Applied" && a.status !== "In Flight"
                            ? `<button class="btn sm emerald trk-auto-apply" data-id="${esc(a.id)}" title="Run Autonomous Background Auto-Apply">🚀 Auto-Apply</button>`
                            : ""
                        }
                        <button class="btn sm secondary trk-view-receipt" data-id="${esc(a.id)}">🧾 ${isExpanded ? "Hide" : "Receipt & Diff"}</button>
                        <button class="btn sm secondary trk-prep-btn" data-id="${esc(a.id)}" title="AI Interview Prep">🎤 Prep</button>
                        <button class="btn sm danger trk-del" data-id="${esc(a.id)}">✕</button>
                      </div>
                    </td>
                  </tr>
                  ${
                    isExpanded
                      ? `<tr>
                          <td colspan="6" style="background:#f8fafc;padding:16px;border-left:3px solid #10b981;">
                            <div class="grid-2">
                              <div>
                                <div style="font-weight:800;color:#047857;margin-bottom:8px;">
                                  ✓ What Just Got Sent to ${esc(a.ats || a.company)} (${receiptFields.length || a.filledCount || 8} fields · 0 skipped)
                                </div>
                                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
                                  ${(receiptFields.length
                                    ? receiptFields
                                    : [
                                        { label: "Full name", value: STATE.profile?.personal?.fullName || "Raviteja Velanati" },
                                        { label: "Email", value: STATE.credentials?.portalEmail || "ravitejavelanati11@gmail.com" },
                                        { label: "Phone", value: STATE.profile?.personal?.phone || "(774) 418-6241" },
                                        { label: "Résumé", value: a.resumeUsed || "Tailored 1-Page PDF" },
                                        { label: "Authorized in US", value: "Yes" }
                                      ]
                                  )
                                    .map(
                                      (f) => `<div style="padding:6px 8px;background:#ffffff;border-radius:6px;border:1px solid #e2e8f0;">
                                        <span style="color:#059669;font-weight:700;">✓ ${esc(f.label)}:</span>
                                        <span style="color:#0f172a;margin-left:4px;">${esc(f.value)}</span>
                                      </div>`
                                    )
                                    .join("")}
                                </div>
                              </div>
                              <div>
                                <div style="font-weight:800;color:#4338ca;margin-bottom:8px;">
                                  ✨ Tailored Résumé Diff (${esc(a.resumeUsed || "1-Page ATS PDF")})
                                </div>
                                ${
                                  diffList.length === 0
                                    ? `<div style="font-size:12px;color:#475569;">Tailored 1-page ATS résumé attached with role-aligned summary, 4 skill categories, and 14 quantified bullets.</div>`
                                    : diffList
                                        .slice(0, 3)
                                        .map(
                                          (d) => `<div style="margin-bottom:8px;padding:8px;background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;font-size:11.5px;">
                                            <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">${esc(d.company)} — ${esc(d.role)}</div>
                                            <div style="color:#dc2626;margin-bottom:3px;">− ${esc(d.before)}</div>
                                            <div style="color:#047857;">+ ${esc(d.after)}</div>
                                          </div>`
                                        )
                                        .join("")
                                }
                              </div>
                            </div>
                          </td>
                        </tr>`
                      : ""
                  }
                `;
                  })
                  .join("")}
              </tbody>
            </table>`
      }
    </div>
  `;

  c.querySelector("#btn-trk-view-table")?.addEventListener("click", () => {
    trackerViewMode = "table";
    renderTracker(c);
  });
  c.querySelector("#btn-trk-view-kanban")?.addEventListener("click", () => {
    trackerViewMode = "kanban";
    renderTracker(c);
  });

  // Kanban HTML5 drag-and-drop handlers
  c.querySelectorAll(".kanban-card[draggable='true']").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", card.dataset.dragId || "");
    });
  });
  c.querySelectorAll(".kanban-col[data-drop-status]").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drag-over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const appId = e.dataTransfer?.getData("text/plain");
      const nextStatus = col.dataset.dropStatus;
      if (!appId || !nextStatus) return;
      await chrome.runtime.sendMessage({
        type: "UPSERT_APPLICATION",
        payload: { application: { id: appId, status: nextStatus, stepLabel: nextStatus } }
      });
      await reloadState();
      renderTracker(c);
      toast(`Moved card to ${nextStatus}`);
    });
  });

  c.querySelector("#trk-filter-q")?.addEventListener("input", (e) => {
    trackerFilterQ = e.target.value;
    const pos = e.target.selectionStart;
    renderTracker(c);
    const inp = c.querySelector("#trk-filter-q");
    if (inp) {
      inp.focus();
      try {
        inp.setSelectionRange(pos, pos);
      } catch (_) {}
    }
  });

  c.querySelector("#trk-filter-stage")?.addEventListener("change", (e) => {
    trackerFilterStage = e.target.value;
    renderTracker(c);
  });

  c.querySelector("#trk-add-btn")?.addEventListener("click", async () => {
    const company = c.querySelector("#trk-comp").value.trim();
    const role = c.querySelector("#trk-role").value.trim();
    if (!company || !role) {
      toast("Enter Company and Role Title first.");
      return;
    }
    await chrome.runtime.sendMessage({
      type: "UPSERT_APPLICATION",
      payload: {
        application: {
          company,
          role,
          url: c.querySelector("#trk-url").value.trim(),
          location: c.querySelector("#trk-loc").value.trim(),
          status: c.querySelector("#trk-status").value
        }
      }
    });
    await reloadState();
    renderTracker(c);
    toast("✅ Application saved in Tracker!");
  });

  c.querySelector("#trk-add-and-apply-btn")?.addEventListener("click", async () => {
    const company = c.querySelector("#trk-comp").value.trim() || "Target Company";
    const role = c.querySelector("#trk-role").value.trim() || "AI / Software Engineer";
    const url = c.querySelector("#trk-url").value.trim();
    const location = c.querySelector("#trk-loc").value.trim() || "United States";
    if (!url) {
      toast("Enter an Application URL to run Background Auto-Apply.");
      return;
    }
    toast(`🤖 Queued silent background Auto-Apply for ${company}!`);
    await chrome.runtime.sendMessage({
      type: "LAUNCH_TAB_AND_AUTO_APPLY",
      payload: {
        url,
        active: false,
        options: {
          autoSubmit: true,
          tailorResume: true,
          jobMeta: { company, title: role, location, url }
        }
      }
    });
    await reloadState();
    renderTracker(c);
  });

  c.querySelectorAll(".trk-auto-apply").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const app = (STATE.applications || []).find((x) => x.id === btn.dataset.id);
      if (!app || !app.url) return;
      toast(`🤖 Auto-Applying to ${app.company} in background...`);
      await chrome.runtime.sendMessage({
        type: "LAUNCH_TAB_AND_AUTO_APPLY",
        payload: {
          url: app.url,
          active: false,
          options: {
            autoSubmit: true,
            tailorResume: true,
            jobMeta: { company: app.company, title: app.role, location: app.location, ats: app.ats, url: app.url }
          }
        }
      });
      await reloadState();
      renderTracker(c);
    });
  });

  c.querySelectorAll(".trk-view-receipt").forEach((btn) => {
    btn.addEventListener("click", () => {
      expandedReceiptAppId = expandedReceiptAppId === btn.dataset.id ? null : btn.dataset.id;
      renderTracker(c);
    });
  });

  c.querySelectorAll(".trk-open-receipt-modal").forEach((btn) => {
    btn.addEventListener("click", () => {
      const app = (STATE.applications || []).find((x) => x.id === btn.dataset.id);
      if (app) openReceiptModal(app);
    });
  });

  c.querySelectorAll(".trk-prep-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const app = (STATE.applications || []).find((x) => x.id === btn.dataset.id);
      if (!app) return;
      pendingInterviewDraft = {
        company: app.company || "",
        role: app.role || "",
        url: app.url || "",
        jd: `${app.role || ""} at ${app.company || ""} (${app.location || "United States"}). ${app.notes || ""}`.trim()
      };
      switchView("interview");
    });
  });

  c.querySelectorAll(".trk-stage-sel").forEach((sel) => {
    sel.addEventListener("change", async () => {
      await chrome.runtime.sendMessage({
        type: "UPSERT_APPLICATION",
        payload: { application: { id: sel.dataset.id, status: sel.value, stepLabel: sel.value } }
      });
      await reloadState();
      toast(`Updated stage -> ${sel.value}`);
    });
  });

  c.querySelectorAll(".trk-note-inp").forEach((inp) => {
    inp.addEventListener("change", async () => {
      await chrome.runtime.sendMessage({
        type: "UPSERT_APPLICATION",
        payload: { application: { id: inp.dataset.id, notes: inp.value } }
      });
      await reloadState();
      toast("Saved note!");
    });
  });

  c.querySelectorAll(".trk-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "DELETE_APPLICATION", payload: { id: btn.dataset.id } });
      await reloadState();
      renderTracker(c);
      toast("Deleted entry.");
    });
  });

  c.querySelector("#trk-export-csv")?.addEventListener("click", () => {
    const header = ["Company", "Role", "Status", "Location", "ATS", "MatchScore", "URL", "Notes", "UpdatedAt"];
    const rows = apps.map((a) =>
      [a.company, a.role, a.status, a.location, a.ats, a.matchScore, a.url, a.notes, a.updatedAt]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    downloadBase64(btoa(unescape(encodeURIComponent(csv))), "Jobify_Applications_Export.csv", "text/csv");
  });
}

function renderResumeStudio(c) {
  const savedResumes = STATE.tailoredResumes || [];
  c.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
          <div class="card-title" style="margin:0;">Target Job Description</div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${
              savedResumes.length
                ? `<select class="select" id="rs-load-saved" style="width:210px;padding:4px 8px;font-size:11.5px;">
                    <option value="">📂 Load Saved Tailored Resume...</option>
                    ${savedResumes
                      .slice(0, 12)
                      .map((r, i) => `<option value="${i}">${esc(r.company)} — ${esc(r.role)} (${r.atsScore || 94}%)</option>`)
                      .join("")}
                  </select>`
                : ""
            }
            <button type="button" class="btn secondary" id="rs-sample-btn" style="padding:5px 10px;font-size:11.5px;">Load Sample JD</button>
          </div>
        </div>
        <div class="grid-2 form-row">
          <div>
            <label class="field-lbl">Company Name</label>
            <input class="input" id="rs-comp" placeholder="e.g., Anthropic" value="" />
          </div>
          <div>
            <label class="field-lbl">Role Title</label>
            <input class="input" id="rs-role" placeholder="e.g., AI Platform & Evaluation Engineer" value="" />
          </div>
        </div>
        <div class="form-row">
          <label class="field-lbl">Gemini Tailoring Model (From-Scratch Builder)</label>
          <select class="select" id="rs-model">
            <option value="gemini-3.5-flash" ${STATE.settings.primaryModel === "gemini-3.5-flash" ? "selected" : ""}>Gemini 3.5 Flash (Fast From-Scratch ATS Builder)</option>
            <option value="gemini-3-flash-preview" ${STATE.settings.primaryModel === "gemini-3-flash-preview" ? "selected" : ""}>Gemini 3 Flash Preview (Deep Bullet Restructuring)</option>
          </select>
        </div>
        <div class="form-row">
          <label class="field-lbl">Paste Full Job Description</label>
          <textarea class="textarea" id="rs-jd" style="min-height:240px;" placeholder="Paste the target job description here..."></textarea>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn secondary" id="rs-scan-btn">🔍 Scan Missing Keywords &amp; ATS Heatmap</button>
          <button class="btn primary" id="rs-tailor-btn">✨ Build From-Scratch Resume &amp; PDF</button>
        </div>
      </div>

      <div class="card" id="rs-output-panel">
        <div class="card-title">Interactive Resume Editor, ATS Heatmap &amp; 1-Page PDF Compiler</div>
        <div id="rs-results-inner" style="font-size:13px;color:#64748b;">
          Paste a target job description (or click <strong>Load Sample JD</strong>), then click <strong>Scan Missing Keywords</strong> or <strong>Build From-Scratch Resume &amp; PDF</strong>. Every generated section can be edited live and re-compiled into a 1-page PDF in 1 click.
        </div>
      </div>
    </div>
  `;

  const renderScan = (jd) => {
    if (!String(jd || "").trim()) {
      toast("Paste a job description first (or click Load Sample JD).");
      return;
    }
    const audit = scoreResumeATS(STATE.profile, jd);
    const out = c.querySelector("#rs-results-inner");
    out.innerHTML = `
      <div class="sub-box" style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="font-size:32px;font-weight:900;color:#059669;">${audit.totalScore}/100</div>
          <div>
            <div style="font-weight:800;color:#0f172a;">Baseline ATS Readability &amp; Keyword Heatmap</div>
            <div style="font-size:12px;color:#475569;">Keyword Coverage: <strong>${audit.keywords.keywordCoveragePct}%</strong> • Quantified Bullets: <strong>${audit.breakdown.quantifiedImpact.quantifiedBullets}/${audit.breakdown.quantifiedImpact.totalBullets}</strong></div>
          </div>
        </div>
      </div>
      <div class="funnel-bar-track" style="margin-bottom:14px;height:9px;">
        <div class="funnel-bar-fill" style="width:${Math.min(100, audit.keywords.keywordCoveragePct)}%;"></div>
      </div>
      <div style="margin-bottom:12px;">
        <div class="field-lbl">Missing Keywords to Inject (${audit.keywords.missing.length})</div>
        ${
          audit.keywords.missing.length
            ? audit.keywords.missing.map((m) => `<span class="chip amber">+ ${esc(m.keyword)}</span>`).join("")
            : `<span class="chip green">Zero missing keywords!</span>`
        }
      </div>
      <div>
        <div class="field-lbl">Matched Keywords (${audit.keywords.matched.length})</div>
        ${audit.keywords.matched.map((m) => `<span class="chip green">✓ ${esc(m.keyword)}</span>`).join("")}
      </div>
    `;
  };

  const renderInteractiveEditor = (rec) => {
    if (!rec || !rec.tailored) return;
    const t = rec.tailored;
    const out = c.querySelector("#rs-results-inner");
    const catEntries = Object.entries(t.skillsCategories || {});

    out.innerHTML = `
      <div class="sub-box" style="display:flex;justify-content:space-between;align-items:center;border-color:#a7f3d0;background:#ecfdf5;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
        <div>
          <div style="font-weight:800;color:#065f46;font-size:15px;" id="rs-live-score-lbl">✅ Tailored ATS Score: ${rec.atsScore || 95}/100</div>
          <div style="font-size:11.5px;color:#047857;">Header: <strong>${esc(t.targetJobTitle || rec.role)}</strong> • Model: ${esc(rec.modelUsed)} • Engine: ${esc(rec.pdfEngine || "pdflatex")}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn secondary sm" id="btn-rs-recompile" type="button">🔄 Re-Compile 1-Page PDF</button>
          <button class="btn emerald sm" id="rs-dl-pdf" type="button">⬇ Download ${esc(rec.fileName)}</button>
        </div>
      </div>

      <div class="form-row">
        <label class="field-lbl">Editable Target Role Header</label>
        <input class="input" id="ed-target-title" value="${esc(t.targetJobTitle || rec.role || "")}" />
      </div>

      <div class="form-row">
        <label class="field-lbl">Editable Summary (4-Sentence From-Scratch Framework)</label>
        <textarea class="textarea" id="ed-summary" style="min-height:92px;">${esc(t.summary || "")}</textarea>
      </div>

      <div class="form-row">
        <label class="field-lbl">Editable Skills (4 Categories — comma-separated)</label>
        <div style="display:grid;gap:8px;">
          ${catEntries
            .map(
              ([cat, items], idx) => `
            <div class="sub-box" style="padding:8px 10px;">
              <div style="font-size:11.5px;font-weight:700;color:#4338ca;margin-bottom:4px;">${esc(cat)}</div>
              <input class="input ed-skill-cat" data-cat-name="${esc(cat)}" data-cat-idx="${idx}" value="${esc(
                Array.isArray(items) ? items.join(", ") : String(items || "")
              )}" style="padding:6px 9px;font-size:12px;" />
            </div>`
            )
            .join("")}
        </div>
      </div>

      <div class="form-row">
        <label class="field-lbl">Editable Experience Bullets (1 bullet per line)</label>
        ${(t.experience || [])
          .map(
            (exp, idx) => `
          <div class="sub-box" style="margin-bottom:8px;">
            <div style="font-weight:700;color:#0f172a;font-size:12.5px;margin-bottom:5px;">${esc(exp.company)} — ${esc(exp.title)} (${esc(exp.period)})</div>
            <textarea class="textarea ed-exp-bullets" data-exp-idx="${idx}" style="min-height:95px;font-size:12px;">${esc(
              (exp.bullets || []).join("\n")
            )}</textarea>
          </div>`
          )
          .join("")}
      </div>

      <div>
        <label class="field-lbl">Editable Projects Bullets (1 bullet per line)</label>
        ${(t.projects || [])
          .map(
            (pr, idx) => `
          <div class="sub-box" style="margin-bottom:8px;">
            <div style="font-weight:700;color:#0f172a;font-size:12.5px;margin-bottom:5px;">${esc(pr.name)} (${esc(pr.stack || "")})</div>
            <textarea class="textarea ed-proj-bullets" data-proj-idx="${idx}" style="min-height:68px;font-size:12px;">${esc(
              (pr.bullets || []).join("\n")
            )}</textarea>
          </div>`
          )
          .join("")}
      </div>
    `;

    let currentRec = rec;

    out.querySelector("#rs-dl-pdf")?.addEventListener("click", () => {
      downloadBase64(currentRec.pdfBase64, currentRec.fileName);
    });

    out.querySelector("#btn-rs-recompile")?.addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.textContent = "⏳ Re-Compiling PDF...";

      const nextTailored = structuredClone(currentRec.tailored);
      nextTailored.targetJobTitle = out.querySelector("#ed-target-title")?.value.trim() || nextTailored.targetJobTitle;
      nextTailored.summary = out.querySelector("#ed-summary")?.value.trim() || nextTailored.summary;

      const nextCats = {};
      out.querySelectorAll(".ed-skill-cat").forEach((inp) => {
        const catName = inp.dataset.catName;
        const arr = inp.value
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (catName) nextCats[catName] = arr;
      });
      if (Object.keys(nextCats).length > 0) nextTailored.skillsCategories = nextCats;

      out.querySelectorAll(".ed-exp-bullets").forEach((ta) => {
        const idx = Number(ta.dataset.expIdx);
        if (nextTailored.experience?.[idx]) {
          nextTailored.experience[idx].bullets = ta.value
            .split("\n")
            .map((line) => line.replace(/^[•\-*]\s*/, "").trim())
            .filter(Boolean);
        }
      });

      out.querySelectorAll(".ed-proj-bullets").forEach((ta) => {
        const idx = Number(ta.dataset.projIdx);
        if (nextTailored.projects?.[idx]) {
          nextTailored.projects[idx].bullets = ta.value
            .split("\n")
            .map((line) => line.replace(/^[•\-*]\s*/, "").trim())
            .filter(Boolean);
        }
      });

      const comp = c.querySelector("#rs-comp")?.value.trim() || currentRec.company || "Target Company";
      const role = c.querySelector("#rs-role")?.value.trim() || nextTailored.targetJobTitle || currentRec.role || "AI Platform Engineer";
      const jd = c.querySelector("#rs-jd")?.value || "";

      const recomp = await chrome.runtime.sendMessage({
        type: "COMPILE_TAILORED_RESUME_PDF",
        payload: {
          recordId: currentRec.id,
          company: comp,
          role,
          jobDescription: jd,
          tailored: nextTailored,
          modelUsed: `${currentRec.modelUsed || "gemini-3.5-flash"} (edited)`
        }
      });

      btn.disabled = false;
      btn.textContent = "🔄 Re-Compile 1-Page PDF";

      if (recomp?.ok && recomp.record) {
        await reloadState();
        currentRec = recomp.record;
        renderInteractiveEditor(currentRec);
        toast(`✅ Re-compiled 1-page PDF (${currentRec.fileName}) — ATS Score: ${currentRec.atsScore}/100!`);
      } else {
        toast(`Error: ${recomp?.error || "Re-compile failed"}`);
      }
    });
  };

  c.querySelector("#rs-load-saved")?.addEventListener("change", (e) => {
    const idx = e.target.value;
    if (idx === "") return;
    const rec = savedResumes[Number(idx)];
    if (!rec) return;
    c.querySelector("#rs-comp").value = rec.company || "";
    c.querySelector("#rs-role").value = rec.role || "";
    renderInteractiveEditor(rec);
  });

  c.querySelector("#rs-sample-btn").addEventListener("click", () => {
    c.querySelector("#rs-comp").value = "Anthropic";
    c.querySelector("#rs-role").value = "AI Platform & Evaluation Engineer";
    c.querySelector("#rs-jd").value =
      "We are hiring an AI Platform & Evaluation Engineer to build scalable LLM evaluation harnesses, multi-agent simulation sandboxes, red-teaming & AI safety pipelines, and full-stack telemetry dashboards. Required skills: Python, TypeScript, React, Kubernetes, Docker, GCP or AWS, distributed microservices, RAG, vector databases, observability/OpenTelemetry, and CI/CD.";
    renderScan(c.querySelector("#rs-jd").value);
  });

  c.querySelector("#rs-scan-btn").addEventListener("click", () => {
    renderScan(c.querySelector("#rs-jd").value);
    if (c.querySelector("#rs-jd").value.trim()) toast("🔍 Updated ATS keyword heatmap!");
  });

  c.querySelector("#rs-tailor-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "⏳ Building From-Scratch Resume & 1-Page PDF...";
    const resp = await chrome.runtime.sendMessage({
      type: "TAILOR_RESUME",
      payload: {
        jobMeta: {
          company: c.querySelector("#rs-comp").value.trim(),
          title: c.querySelector("#rs-role").value.trim(),
          description: c.querySelector("#rs-jd").value
        },
        preferredModel: c.querySelector("#rs-model").value
      }
    });
    btn.disabled = false;
    btn.textContent = "✨ Build From-Scratch Resume & PDF";

    if (!resp?.ok) {
      toast(`Error: ${resp?.error || "Tailoring failed"}`);
      return;
    }

    await reloadState();
    renderInteractiveEditor(resp.record);
    toast(`✨ Tailored PDF compiled (${resp.record.fileName})!`);
  });
}

function renderCoverStudio(c) {
  const savedLetters = STATE.coverLetters || [];
  c.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div class="card-title" style="margin:0;">Generate Tailored Cover Letter</div>
          <button type="button" class="btn secondary" id="cl-sample-btn" style="padding:4px 10px;font-size:11.5px;">Load Sample JD</button>
        </div>
        <div class="grid-2 form-row">
          <div>
            <label class="field-lbl">Company</label>
            <input class="input" id="cl-comp" placeholder="e.g., OpenAI" value="" />
          </div>
          <div>
            <label class="field-lbl">Role Title</label>
            <input class="input" id="cl-role" placeholder="e.g., Software Engineer, Agentic Evaluation" value="" />
          </div>
        </div>
        <div class="form-row">
          <label class="field-lbl">Tone</label>
          <select class="select" id="cl-tone">
            <option value="Concise & Technical">Concise &amp; Technical (Recommended)</option>
            <option value="High-Impact Builder">High-Impact Builder</option>
            <option value="Research & Safety Rigor">AI Safety &amp; Evaluation Rigor</option>
          </select>
        </div>
        <div class="form-row">
          <label class="field-lbl">Job Description</label>
          <textarea class="textarea" id="cl-jd" style="min-height:200px;" placeholder="Paste the target job description here..."></textarea>
        </div>
        <button class="btn primary" id="cl-gen-btn">📝 Generate Cover Letter + PDF</button>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Cover Letter Editor &amp; Export</span>
          ${
            savedLetters.length > 1
              ? `<select class="select" id="cl-history-sel" style="width:210px;padding:4px 8px;font-size:11.5px;">
                  ${savedLetters.map((l, idx) => `<option value="${idx}">${esc(l.company)} — ${esc(l.role)}</option>`).join("")}
                </select>`
              : ""
          }
        </div>
        <textarea class="textarea" id="cl-editor" style="min-height:310px;" placeholder="Your generated cover letter will appear here...">${esc(
          savedLetters[0]?.coverLetter || ""
        )}</textarea>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;flex-wrap:wrap;gap:8px;">
          <div style="display:flex;gap:10px;">
            <button class="btn secondary" id="cl-copy-btn">📋 Copy Text</button>
            <button class="btn emerald" id="cl-dl-btn" ${savedLetters[0]?.pdfBase64 ? "" : "disabled"}>⬇ Download Latest PDF</button>
          </div>
          <span style="font-size:11.5px;color:#64748b;" id="cl-word-count"></span>
        </div>
      </div>
    </div>
  `;

  let activeRecord = savedLetters[0] || null;
  const updateWordCount = () => {
    const txt = c.querySelector("#cl-editor")?.value.trim() || "";
    const words = txt ? txt.split(/\s+/).length : 0;
    const wcEl = c.querySelector("#cl-word-count");
    if (wcEl) wcEl.textContent = `${words} words • ${txt.length} chars`;
  };
  updateWordCount();

  c.querySelector("#cl-history-sel")?.addEventListener("change", (e) => {
    const rec = savedLetters[Number(e.target.value)];
    if (!rec) return;
    activeRecord = rec;
    c.querySelector("#cl-editor").value = rec.coverLetter || "";
    c.querySelector("#cl-dl-btn").disabled = !rec.coverLetter;
    updateWordCount();
  });

  c.querySelector("#cl-sample-btn").addEventListener("click", () => {
    c.querySelector("#cl-comp").value = "OpenAI";
    c.querySelector("#cl-role").value = "Software Engineer, Agentic Evaluation";
    c.querySelector("#cl-jd").value =
      "Build evaluation environments, synthetic user state pipelines, and adversarial benchmarks for frontier autonomous browser and coding agents.";
  });

  c.querySelector("#cl-gen-btn").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = "⏳ Drafting Cover Letter...";
    const resp = await chrome.runtime.sendMessage({
      type: "GENERATE_COVER_LETTER",
      payload: {
        jobMeta: {
          company: c.querySelector("#cl-comp").value.trim(),
          title: c.querySelector("#cl-role").value.trim(),
          description: c.querySelector("#cl-jd").value
        },
        tone: c.querySelector("#cl-tone").value
      }
    });
    b.disabled = false;
    b.textContent = "📝 Generate Cover Letter + PDF";
    if (resp?.ok) {
      activeRecord = resp.record;
      await reloadState();
      c.querySelector("#cl-editor").value = activeRecord.coverLetter;
      c.querySelector("#cl-dl-btn").disabled = false;
      updateWordCount();
      toast(`📝 Generated with ${activeRecord.modelUsed}!`);
    } else {
      toast(`Error: ${resp?.error || "Failed"}`);
    }
  });

  c.querySelector("#cl-editor")?.addEventListener("input", (e) => {
    const dlBtn = c.querySelector("#cl-dl-btn");
    if (dlBtn) dlBtn.disabled = !e.target.value.trim();
    updateWordCount();
  });

  c.querySelector("#cl-copy-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(c.querySelector("#cl-editor").value);
    toast("📋 Copied cover letter!");
  });

  c.querySelector("#cl-dl-btn").addEventListener("click", async () => {
    const edited = c.querySelector("#cl-editor")?.value || "";
    if (!edited.trim()) return toast("Generate or enter cover letter text first.");
    if (!activeRecord?.pdfBase64 || edited.trim() !== (activeRecord.coverLetter || "").trim()) {
      const recomp = await chrome.runtime
        .sendMessage({
          type: "COMPILE_COVER_LETTER_PDF",
          payload: {
            coverLetter: edited,
            company: c.querySelector("#cl-comp")?.value.trim() || activeRecord?.company || "Company",
            role: c.querySelector("#cl-role")?.value.trim() || activeRecord?.role || "Software Engineer",
            recordId: activeRecord?.id || null
          }
        })
        .catch(() => null);
      if (recomp?.ok && recomp.pdfBase64) {
        activeRecord = {
          ...(activeRecord || {}),
          coverLetter: edited,
          pdfBase64: recomp.pdfBase64,
          fileName: recomp.fileName
        };
      }
    }
    if (activeRecord?.pdfBase64) downloadBase64(activeRecord.pdfBase64, activeRecord.fileName);
  });
}

function renderInterviewStudio(c) {
  const preps = STATE.interviewPreps || [];
  const draft = pendingInterviewDraft || { company: "", role: "", url: "", jd: "" };
  pendingInterviewDraft = null;

  c.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
          <div class="card-title" style="margin:0;">🎤 Target Role &amp; Interview Scope</div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${
              preps.length
                ? `<select class="select" id="ip-history-sel" style="width:205px;padding:4px 8px;font-size:11.5px;">
                    <option value="">📂 Saved Prep Cheat-Sheets...</option>
                    ${preps.map((p, i) => `<option value="${i}">${esc(p.company)} — ${esc(p.role)}</option>`).join("")}
                  </select>`
                : ""
            }
            <button type="button" class="btn secondary sm" id="ip-sample-btn">Load Sample Role</button>
          </div>
        </div>
        <div class="grid-2 form-row">
          <div>
            <label class="field-lbl">Company Name</label>
            <input class="input" id="ip-comp" placeholder="e.g., Anthropic" value="${esc(draft.company)}" />
          </div>
          <div>
            <label class="field-lbl">Role Title</label>
            <input class="input" id="ip-role" placeholder="e.g., Staff Agentic Evaluation Engineer" value="${esc(draft.role)}" />
          </div>
        </div>
        <div class="form-row">
          <label class="field-lbl">Job URL (Optional)</label>
          <input class="input" id="ip-url" placeholder="https://..." value="${esc(draft.url)}" />
        </div>
        <div class="form-row">
          <label class="field-lbl">Job Description / Interview Focus</label>
          <textarea class="textarea" id="ip-jd" style="min-height:190px;" placeholder="Paste the job description or recruiter notes here...">${esc(draft.jd)}</textarea>
        </div>
        <button class="btn primary" id="btn-ip-generate" type="button">🎤 Generate AI Interview Cheat-Sheet</button>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Role-Specific Interview Cheat-Sheet</span>
          <div style="display:flex;gap:6px;" id="ip-export-actions"></div>
        </div>
        <div id="ip-output" style="font-size:13px;color:#64748b;">
          Generate a tailored cheat-sheet to get a 60-second elevator pitch, role-specific technical &amp; architecture Q&amp;As, STAR behavioral stories backed by your real metrics, and high-signal questions to ask your interviewer.
        </div>
      </div>
    </div>
  `;

  const renderPrepRecord = (rec) => {
    if (!rec?.prep) return;
    const p = rec.prep;
    const out = c.querySelector("#ip-output");
    const act = c.querySelector("#ip-export-actions");

    const mdExport = [
      `# Interview Cheat-Sheet: ${p.company || rec.company} — ${p.role || rec.role}`,
      `\n## 60-Second Elevator Pitch\n${p.elevatorPitch || ""}`,
      `\n## Technical & System Design Q&A`,
      ...(p.technicalQuestions || []).map((q, i) => `### Q${i + 1}. ${q.question}\n- **Talking Points:** ${q.keyPoints}`),
      `\n## Quantified STAR Behavioral Stories`,
      ...(p.behavioralStories || []).map((b) => `- **${b.competency}:** ${b.starSummary}`),
      `\n## High-Signal Questions for the Interviewer`,
      ...(p.questionsToAsk || []).map((q) => `- ${q}`)
    ].join("\n");

    act.innerHTML = `
      <button type="button" class="btn sm secondary" id="ip-copy-all">📋 Copy All</button>
      <button type="button" class="btn sm emerald" id="ip-export-md">⬇ Export .md</button>
    `;
    act.querySelector("#ip-copy-all")?.addEventListener("click", () => {
      navigator.clipboard.writeText(mdExport);
      toast("📋 Copied full interview cheat-sheet!");
    });
    act.querySelector("#ip-export-md")?.addEventListener("click", () => {
      const safeComp = String(p.company || rec.company || "Company").replace(/[^A-Za-z0-9]+/g, "_");
      downloadText(mdExport, `Interview_Prep_${safeComp}.md`, "text/markdown;charset=utf-8");
    });

    out.innerHTML = `
      <div class="prep-item" style="border-color:#c7d2fe;background:#eef2ff;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span class="field-lbl" style="margin:0;color:#3730a3;">🎯 60-Second Tailored Elevator Pitch</span>
          <span class="chip indigo">${esc(rec.modelUsed || "gemini-3.5-flash")}</span>
        </div>
        <div style="color:#0f172a;line-height:1.55;font-size:13px;">${esc(p.elevatorPitch)}</div>
      </div>

      <div style="margin-top:14px;">
        <div class="field-lbl">🧠 Technical &amp; System Design Deep-Dives (${(p.technicalQuestions || []).length})</div>
        ${(p.technicalQuestions || [])
          .map(
            (q, i) => `
          <div class="prep-item">
            <div style="font-weight:700;color:#0f172a;margin-bottom:5px;">Q${i + 1}. ${esc(q.question)}</div>
            <div style="color:#334155;font-size:12.5px;line-height:1.5;">${esc(q.keyPoints)}</div>
          </div>`
          )
          .join("")}
      </div>

      <div style="margin-top:14px;">
        <div class="field-lbl">🏆 Quantified STAR Behavioral Stories (${(p.behavioralStories || []).length})</div>
        ${(p.behavioralStories || [])
          .map(
            (s) => `
          <div class="prep-item">
            <div style="font-weight:700;color:#047857;margin-bottom:4px;">${esc(s.competency)}</div>
            <div style="color:#334155;font-size:12.5px;line-height:1.5;">${esc(s.starSummary)}</div>
          </div>`
          )
          .join("")}
      </div>

      <div style="margin-top:14px;">
        <div class="field-lbl">💡 Questions to Ask the Interviewer</div>
        <div class="prep-item">
          <ul style="padding-left:18px;color:#0f172a;line-height:1.6;font-size:12.5px;">
            ${(p.questionsToAsk || []).map((q) => `<li>${esc(q)}</li>`).join("")}
          </ul>
        </div>
      </div>
    `;
  };

  if (preps[0] && !draft.company) {
    renderPrepRecord(preps[0]);
  }

  c.querySelector("#ip-history-sel")?.addEventListener("change", (e) => {
    if (e.target.value === "") return;
    const rec = preps[Number(e.target.value)];
    if (rec) renderPrepRecord(rec);
  });

  c.querySelector("#ip-sample-btn")?.addEventListener("click", () => {
    c.querySelector("#ip-comp").value = "Anthropic";
    c.querySelector("#ip-role").value = "Staff Agentic Evaluation Engineer";
    c.querySelector("#ip-jd").value =
      "Design frontier autonomous browser & coding agent evaluation sandboxes, synthetic user environments, OpenTelemetry failure tracing, and Kubernetes execution pools.";
  });

  c.querySelector("#btn-ip-generate")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const company = c.querySelector("#ip-comp").value.trim() || "Anthropic";
    const title = c.querySelector("#ip-role").value.trim() || "Senior AI & Platform Engineer";
    const url = c.querySelector("#ip-url").value.trim();
    const description = c.querySelector("#ip-jd").value.trim();

    btn.disabled = true;
    btn.textContent = "⏳ Synthesizing Interview Cheat-Sheet...";
    const resp = await chrome.runtime.sendMessage({
      type: "GENERATE_INTERVIEW_PREP",
      payload: { jobMeta: { company, title, url, description } }
    });
    btn.disabled = false;
    btn.textContent = "🎤 Generate AI Interview Cheat-Sheet";

    if (resp?.ok && resp.record) {
      await reloadState();
      renderPrepRecord(resp.record);
      toast(`🎤 Generated Interview Cheat-Sheet for ${company}!`);
    } else {
      toast(`Error: ${resp?.error || "Failed to generate prep"}`);
    }
  });
}

async function renderLiveJobs(c) {
  selectedJobIndexes = new Set();
  c.innerHTML = `
    <div class="filter-shell">
      <div class="filter-top-row">
        <div class="filter-search-wrap">
          <input class="filter-search-input" id="jf-q" placeholder="Search by job title, company, skill, or city..." value="" />
        </div>
        <button class="btn sm secondary" id="jf-select-top5" type="button">☑️ Select Top 5 Unapplied</button>
        <button class="btn sm emerald" id="btn-jf-batch-apply" type="button" style="display:none;">🚀 Batch Auto-Apply Selected (0)</button>
        <button class="btn sm secondary" id="jf-toggle-staffing" type="button">🏢 128 Staffing Agencies</button>
        <button class="btn sm secondary" id="jf-reset" type="button" style="display:none;">↺ Reset Filters</button>
        <button class="btn sm primary" id="jf-refresh" type="button">↻ Pull Live Jobs</button>
      </div>

      <div class="filter-grid-6">
        <div class="filter-group">
          <label class="filter-lbl" for="jf-platform">Platform</label>
          <select class="filter-select-clean" id="jf-platform">
            <option value="ALL">All Platforms</option>
            <option value="Workday">Workday</option>
            <option value="LinkedIn">LinkedIn</option>
            <option value="Dice">Dice</option>
            <option value="Staffing">Staffing Agencies (128)</option>
            <option value="Microsoft">Microsoft Careers</option>
            <option value="Greenhouse">Greenhouse</option>
            <option value="Ashby">Ashby</option>
            <option value="Lever">Lever</option>
            <option value="SmartRecruiters">SmartRecruiters</option>
            <option value="Indeed">Indeed / iCIMS</option>
            <option value="BuiltIn">BuiltIn / Wellfound</option>
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-lbl" for="jf-recency">Date Posted</label>
          <select class="filter-select-clean" id="jf-recency">
            <option value="0">Any Time</option>
            <option value="2">Last 2 Hours</option>
            <option value="8">Last 8 Hours</option>
            <option value="12">Last 12 Hours</option>
            <option value="24">Last 24 Hours</option>
            <option value="48">Last 2 Days</option>
            <option value="168">Last 7 Days</option>
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-lbl" for="jf-sponsorship">Visa / H-1B</label>
          <select class="filter-select-clean" id="jf-sponsorship">
            <option value="ALL">All Roles</option>
            <option value="H-1B Sponsor">H-1B &amp; Visa Sponsors</option>
            <option value="H-1B Transfer">H-1B Transfer &amp; Cap</option>
            <option value="STEM OPT">F-1 OPT / STEM OPT</option>
            <option value="W2 / C2C">W2 / C2C Sponsor</option>
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-lbl" for="jf-role-type">Role Type</label>
          <select class="filter-select-clean" id="jf-role-type">
            <option value="ALL">All Types</option>
            <option value="Full-Time">Full-Time</option>
            <option value="Part-Time">Part-Time</option>
            <option value="Contract / W2">Contract / W2</option>
            <option value="C2C / Corp-to-Corp">C2C / Corp-to-Corp</option>
            <option value="Contract-to-Hire">Contract-to-Hire</option>
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-lbl" for="jf-exp">Experience</label>
          <select class="filter-select-clean" id="jf-exp">
            <option value="ALL">All Levels</option>
            <option value="0-1">0–1 Years</option>
            <option value="1-2">1–2 Years</option>
            <option value="2-3">2–3 Years</option>
            <option value="3-4">3–4 Years</option>
            <option value="4-6">4–6 Years</option>
            <option value="6+">6+ Years</option>
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-lbl" for="jf-work-mode">Work Mode</label>
          <select class="filter-select-clean" id="jf-work-mode">
            <option value="ALL">All Modes</option>
            <option value="Remote">Remote</option>
            <option value="Hybrid">Hybrid</option>
            <option value="On-Site">On-Site</option>
          </select>
        </div>
      </div>

      <div class="active-filters-bar" id="jf-active-chips"></div>
    </div>

    <div id="jf-staffing-drawer" class="card" style="display:none;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-weight:700;font-size:15px;color:#0f172a;">🏢 128 Staffing Agencies Directory</div>
          <div style="font-size:12px;color:#64748b;">Direct career portals across all ${STAFFING_AGENCIES_DIRECTORY.length} staffing agencies supporting H-1B, OPT/STEM OPT, W2 &amp; C2C</div>
        </div>
        <input class="filter-search-input" id="jf-staffing-search" placeholder="Search 128 agencies (e.g., TEKsystems, Insight Global, Kforce)..." style="max-width:300px;" value="" />
      </div>
      <div id="jf-staffing-grid" class="job-feed-grid" style="max-height:360px;overflow-y:auto;padding-right:4px;"></div>
    </div>

    <div id="jf-grid-wrap">
      <div class="card">Pulling live roles across Workday, LinkedIn, Dice, Staffing Agencies, Greenhouse, Ashby &amp; Lever...</div>
    </div>
  `;

  const syncBatchButton = () => {
    const batchBtn = c.querySelector("#btn-jf-batch-apply");
    if (!batchBtn) return;
    const count = selectedJobIndexes.size;
    batchBtn.style.display = count > 0 ? "inline-flex" : "none";
    batchBtn.textContent = `🚀 Batch Auto-Apply Selected (${count})`;
  };

  const renderStaffingDrawerList = (filterText = "") => {
    const q = filterText.trim().toLowerCase();
    const list = STAFFING_AGENCIES_DIRECTORY.filter(
      (a) => !q || a.name.toLowerCase().includes(q) || a.portalType.toLowerCase().includes(q) || a.url.toLowerCase().includes(q)
    );
    const grid = c.querySelector("#jf-staffing-grid");
    grid.innerHTML = list
      .map(
        (a) => `
        <div class="job-card" style="padding:11px 13px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-weight:700;color:#0f172a;font-size:13.5px;">${esc(a.name)}</span>
            <span class="chip indigo" style="font-size:10.5px;">${esc(a.portalType)}</span>
          </div>
          <div style="font-size:11px;color:#059669;font-weight:600;margin-bottom:6px;">H-1B • STEM OPT • W2 / C2C</div>
          <div style="display:flex;gap:6px;">
            <button class="btn sm emerald jf-filter-agency" data-agency="${esc(a.name)}" style="flex:1;">Filter Jobs</button>
            <a class="btn sm primary" href="${esc(a.url)}" target="_blank" style="flex:1;text-align:center;">Open Portal ↗</a>
          </div>
        </div>`
      )
      .join("");
    grid.querySelectorAll(".jf-filter-agency").forEach((btn) => {
      btn.addEventListener("click", () => {
        c.querySelector("#jf-q").value = btn.dataset.agency.split(",")[0].trim();
        c.querySelector("#jf-platform").value = "Staffing";
        loadJobs(false);
      });
    });
  };

  renderStaffingDrawerList();

  c.querySelector("#jf-toggle-staffing").addEventListener("click", () => {
    const drawer = c.querySelector("#jf-staffing-drawer");
    drawer.style.display = drawer.style.display === "none" ? "block" : "none";
  });
  c.querySelector("#jf-staffing-search").addEventListener("input", (e) => {
    renderStaffingDrawerList(e.target.value);
  });

  const syncFilterVisualState = () => {
    const defs = [
      { id: "jf-platform", def: "ALL", label: "Platform" },
      { id: "jf-recency", def: "0", label: "Posted" },
      { id: "jf-sponsorship", def: "ALL", label: "Visa" },
      { id: "jf-role-type", def: "ALL", label: "Type" },
      { id: "jf-exp", def: "ALL", label: "Exp" },
      { id: "jf-work-mode", def: "ALL", label: "Mode" }
    ];
    const activeItems = [];
    defs.forEach(({ id, def, label }) => {
      const el = c.querySelector(`#${id}`);
      if (!el) return;
      const isAct = el.value !== def;
      el.classList.toggle("is-filtered", isAct);
      if (isAct) {
        const text = el.options[el.selectedIndex]?.text || el.value;
        activeItems.push({ id, def, text: `${label}: ${text}` });
      }
    });
    const qEl = c.querySelector("#jf-q");
    if (qEl && qEl.value.trim()) {
      activeItems.push({ id: "jf-q", def: "", text: `Search: "${qEl.value.trim()}"` });
    }

    const bar = c.querySelector("#jf-active-chips");
    const resetBtn = c.querySelector("#jf-reset");
    if (resetBtn) resetBtn.style.display = activeItems.length > 0 ? "inline-flex" : "none";

    if (activeItems.length === 0) {
      bar.classList.remove("visible");
      bar.innerHTML = "";
    } else {
      bar.classList.add("visible");
      bar.innerHTML = activeItems
        .map(
          (it) =>
            `<button type="button" class="active-filter-pill" data-clear-id="${esc(it.id)}" data-clear-def="${esc(it.def)}">${esc(it.text)} <span>✕</span></button>`
        )
        .join("");
      bar.querySelectorAll("[data-clear-id]").forEach((pill) => {
        pill.addEventListener("click", () => {
          const target = c.querySelector(`#${pill.dataset.clearId}`);
          if (target) target.value = pill.dataset.clearDef;
          loadJobs(false);
        });
      });
    }
  };

  const loadJobs = async (forceRefresh = false) => {
    selectedJobIndexes.clear();
    syncBatchButton();
    syncFilterVisualState();
    const platform = c.querySelector("#jf-platform").value;
    const maxHoursAgo = Number(c.querySelector("#jf-recency").value) || 0;
    const sponsorship = c.querySelector("#jf-sponsorship").value;
    const roleType = c.querySelector("#jf-role-type").value;
    const experienceRange = c.querySelector("#jf-exp").value;
    const workMode = c.querySelector("#jf-work-mode").value;
    const query = c.querySelector("#jf-q").value.trim();
    const wrap = c.querySelector("#jf-grid-wrap");

    const filterPayload = {
      category: "ALL",
      platform,
      maxHoursAgo,
      sponsorship,
      roleType,
      experienceRange,
      workMode,
      query,
      forceRefresh,
      limit: 140
    };

    let jobs = [];
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "FETCH_RECOMMENDED_JOBS",
        payload: filterPayload
      });
      if (Array.isArray(resp?.jobs) && resp.jobs.length > 0) {
        jobs = resp.jobs;
      }
    } catch (_) {}

    if (jobs.length === 0) {
      try {
        jobs = await fetchPersonalizedRecommendations(STATE?.profile || {}, filterPayload);
      } catch (_) {}
    }

    cachedLiveJobs = jobs;
    if (cachedLiveJobs.length === 0) {
      wrap.innerHTML = `<div class="card" style="text-align:center;color:#64748b;">No matching roles found for this filter combination. Click <strong>Reset Filters</strong> to show all live jobs.</div>`;
      return;
    }

    const apps = STATE?.applications || [];
    const dupGuardOn = STATE?.settings?.duplicateApplyGuard !== false;

    wrap.innerHTML = `
      <div style="margin-bottom:12px;font-size:13px;color:#475569;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <span>Showing <strong style="color:#0f172a;">${cachedLiveJobs.length}</strong> live roles across Workday, LinkedIn, Dice, Staffing Agencies, Greenhouse, Ashby &amp; Lever</span>
        <span style="font-size:11.5px;color:#059669;font-weight:700;">● Multi-Platform Live Feed Synced</span>
      </div>
      <div class="job-feed-grid">
        ${cachedLiveJobs
          .map((j, idx) => {
            const alreadyApplied = isJobAlreadyApplied(j, apps);
            return `
          <div class="job-card" data-hub-job-card="true" data-card-idx="${idx}">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:4px;flex-wrap:wrap;">
                <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="checkbox" class="jf-batch-chk" data-idx="${idx}" style="accent-color:#4f46e5;width:14px;height:14px;cursor:pointer;" />
                  <span class="chip indigo">${esc(j.company)} • ${esc(j.ats)}</span>
                </label>
                <div style="display:flex;gap:4px;align-items:center;">
                  ${alreadyApplied ? `<span class="chip green">✓ Applied</span>` : ""}
                  <span class="chip green">${j.matchScore}% Match</span>
                </div>
              </div>
              <div style="font-weight:700;font-size:14.5px;color:#0f172a;margin-bottom:4px;">${esc(j.title)}</div>
              <div style="font-size:12px;color:#475569;margin-bottom:8px;">${esc(j.location)}${
              j.compensation ? ` • <span style="color:#059669;font-weight:700;">${esc(j.compensation)}</span>` : ""
            }</div>
              <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px;">
                <span class="chip sky" style="font-size:10.5px;">${esc(j.postedLabel || "Recent")}</span>
                <span class="chip indigo" style="font-size:10.5px;">${esc(j.roleType || "Full-Time")}</span>
                <span class="chip amber" style="font-size:10.5px;">${esc(j.experienceLabel || `${j.experienceRange || "2-3"} Yrs`)}</span>
                <span class="chip slate" style="font-size:10.5px;">${esc(j.workMode || "Hybrid")}</span>
                ${j.h1bSponsor ? `<span class="chip green" style="font-size:10.5px;">${esc(j.sponsorshipType || "H-1B Sponsor")}</span>` : ""}
              </div>
            </div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
              <button class="btn sm ${alreadyApplied && dupGuardOn ? "secondary" : "emerald"} jf-launch-auto" data-idx="${idx}" data-applied="${
              alreadyApplied ? "1" : "0"
            }" style="flex:1.2;">${alreadyApplied && dupGuardOn ? "✓ Applied" : "⚡ Auto-Apply"}</button>
              <a class="btn sm primary" href="${esc(j.url)}" target="_blank" style="flex:0.8;">Open ↗</a>
              <button class="btn sm secondary jf-save" data-idx="${idx}" title="Save to Tracker">📌</button>
              <button class="btn sm secondary jf-ap" data-idx="${idx}" title="Queue in Autopilot">🤖</button>
            </div>
          </div>`;
          })
          .join("")}
      </div>
    `;

    wrap.querySelectorAll(".jf-batch-chk").forEach((chk) => {
      chk.addEventListener("change", () => {
        const idx = Number(chk.dataset.idx);
        const card = chk.closest(".job-card");
        if (chk.checked) {
          selectedJobIndexes.add(idx);
          card?.classList.add("selected-card");
        } else {
          selectedJobIndexes.delete(idx);
          card?.classList.remove("selected-card");
        }
        syncBatchButton();
      });
    });

    wrap.querySelectorAll(".jf-launch-auto").forEach((b) => {
      b.addEventListener("click", async () => {
        const j = cachedLiveJobs[Number(b.dataset.idx)];
        if (b.dataset.applied === "1" && STATE?.settings?.duplicateApplyGuard !== false) {
          toast(`🛡️ Duplicate Guard: You already applied to ${j.company} (${j.title}).`);
          return;
        }
        b.disabled = true;
        b.textContent = "⏳ Queued...";
        toast(`🚀 Queued background Auto-Apply for ${j.company}!`);
        await chrome.runtime.sendMessage({
          type: "LAUNCH_TAB_AND_AUTO_APPLY",
          payload: {
            url: j.url,
            active: false,
            options: {
              autoSubmit: STATE.settings?.autoSubmitEnabled !== false,
              tailorResume: true,
              jobMeta: { company: j.company, title: j.title, location: j.location, ats: j.ats, url: j.url }
            }
          }
        });
        await reloadState();
      });
    });

    wrap.querySelectorAll(".jf-save").forEach((b) => {
      b.addEventListener("click", async () => {
        const j = cachedLiveJobs[Number(b.dataset.idx)];
        await chrome.runtime.sendMessage({
          type: "UPSERT_APPLICATION",
          payload: {
            application: {
              company: j.company,
              role: j.title,
              location: j.location,
              ats: j.ats,
              url: j.url,
              status: "Bookmarked",
              matchScore: j.matchScore
            }
          }
        });
        await reloadState();
        toast(`Saved ${j.company} — ${j.title}`);
      });
    });

    wrap.querySelectorAll(".jf-ap").forEach((b) => {
      b.addEventListener("click", async () => {
        const j = cachedLiveJobs[Number(b.dataset.idx)];
        await chrome.runtime.sendMessage({ type: "ENQUEUE_AUTOPILOT", payload: { job: j } });
        await reloadState();
        toast(`Queued ${j.company} for Autopilot`);
      });
    });
  };

  c.querySelector("#jf-select-top5")?.addEventListener("click", () => {
    const apps = STATE?.applications || [];
    selectedJobIndexes.clear();
    c.querySelectorAll(".jf-batch-chk").forEach((chk) => {
      const idx = Number(chk.dataset.idx);
      const j = cachedLiveJobs[idx];
      const pick = selectedJobIndexes.size < 5 && j && !isJobAlreadyApplied(j, apps);
      chk.checked = pick;
      chk.closest(".job-card")?.classList.toggle("selected-card", pick);
      if (pick) selectedJobIndexes.add(idx);
    });
    syncBatchButton();
    toast(`Selected ${selectedJobIndexes.size} top unapplied roles for Batch Auto-Apply.`);
  });

  c.querySelector("#btn-jf-batch-apply")?.addEventListener("click", async (e) => {
    const indices = [...selectedJobIndexes];
    if (indices.length === 0) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = `⏳ Launching ${indices.length} Jobs in FIFO Queue...`;
    toast(`🚀 Dispatched ${indices.length} jobs into the sequential FIFO Auto-Apply Queue!`);
    for (const idx of indices) {
      const j = cachedLiveJobs[idx];
      if (!j) continue;
      chrome.runtime.sendMessage({
        type: "LAUNCH_TAB_AND_AUTO_APPLY",
        payload: {
          url: j.url,
          active: false,
          options: {
            autoSubmit: STATE.settings?.autoSubmitEnabled !== false,
            tailorResume: true,
            jobMeta: { company: j.company, title: j.title, location: j.location, ats: j.ats, url: j.url }
          }
        }
      });
    }
    selectedJobIndexes.clear();
    btn.disabled = false;
    await reloadState();
    loadJobs(false);
  });

  c.querySelector("#jf-reset").addEventListener("click", () => {
    c.querySelector("#jf-platform").value = "ALL";
    c.querySelector("#jf-recency").value = "0";
    c.querySelector("#jf-sponsorship").value = "ALL";
    c.querySelector("#jf-role-type").value = "ALL";
    c.querySelector("#jf-exp").value = "ALL";
    c.querySelector("#jf-work-mode").value = "ALL";
    c.querySelector("#jf-q").value = "";
    loadJobs(false);
  });

  c.querySelector("#jf-refresh").addEventListener("click", () => loadJobs(true));
  ["#jf-platform", "#jf-recency", "#jf-sponsorship", "#jf-role-type", "#jf-exp", "#jf-work-mode"].forEach((sel) => {
    c.querySelector(sel).addEventListener("change", () => loadJobs(false));
  });
  let searchTimer = null;
  c.querySelector("#jf-q").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadJobs(false), 120);
  });

  await loadJobs(false);
}

function renderAutopilot(c) {
  const queue = STATE.autopilotQueue || [];
  const logs = STATE.autopilotLogs || [];
  const companionUrl = STATE.settings?.companionServerUrl || "http://127.0.0.1:18765";

  c.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">
          <span>🤖 Autopilot Configuration &amp; Runner</span>
          <span class="chip indigo">FIFO Queue: ${AUTO_APPLY_QUEUE_LEN} Pending</span>
        </div>
        <div class="form-row">
          <label class="field-lbl">Execution Mode</label>
          <select class="select" id="ap-mode">
            <option value="full_auto" ${STATE.settings.autopilotMode !== "safe_review" ? "selected" : ""}>True Full Autopilot — Tailor PDF, Autofill &amp; Click Submit Automatically (Default)</option>
            <option value="safe_review" ${STATE.settings.autopilotMode === "safe_review" ? "selected" : ""}>Safe Review Mode — Tailor PDF, Autofill 100% &amp; Pause Before Final Submit</option>
          </select>
        </div>
        <div class="grid-2 form-row">
          <div>
            <label class="field-lbl">Recurring Schedule</label>
            <select class="select" id="ap-interval">
              <option value="30">Every 30 Minutes</option>
              <option value="60" selected>Every 60 Minutes</option>
              <option value="240">Every 4 Hours</option>
            </select>
          </div>
          <div style="display:flex;align-items:flex-end;gap:8px;">
            <button class="btn secondary" id="ap-sched-btn" style="width:100%;">⏰ Enable Schedule</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn primary" id="ap-run-now">▶ Run Queued Jobs Now (${queue.filter((q) => q.status === "Queued").length})</button>
          <button class="btn secondary" id="ap-seed-sandbox">+ Queue Local Sandbox Test</button>
          <button class="btn danger" id="ap-stop">■ Stop</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">+ Enqueue Single or Bulk Career Portal URLs</div>
        <div class="grid-2 form-row">
          <input class="input" id="ap-comp" placeholder="Company Name" />
          <input class="input" id="ap-title" placeholder="Role Title" />
        </div>
        <div class="form-row" style="display:flex;gap:8px;">
          <input class="input" id="ap-url" placeholder="https://boards.greenhouse.io/..." />
          <button class="btn secondary" id="ap-add-url" style="white-space:nowrap;">+ Enqueue URL</button>
        </div>
        <div class="form-row" style="margin-bottom:8px;">
          <label class="field-lbl">Bulk Paste Multiple Job URLs (1 per line)</label>
          <textarea class="textarea" id="ap-bulk-urls" style="min-height:76px;font-size:12px;" placeholder="https://nvidia.wd5.myworkdayjobs.com/...\nhttps://job-boards.greenhouse.io/anthropic/..."></textarea>
        </div>
        <button class="btn emerald sm" id="ap-add-bulk-btn" type="button">+ Enqueue All Pasted URLs</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Autopilot Queue (${queue.length})</span>
        <button class="btn sm secondary" id="ap-clear-done">Clear Completed</button>
      </div>
      ${
        queue.length === 0
          ? `<p style="font-size:13px;color:#64748b;">Queue is empty. Add roles from "Live Jobs &amp; Batch Apply", paste URLs above, or click "+ Queue Local Sandbox Test".</p>`
          : `<table class="table">
              <thead><tr><th>Company</th><th>Role</th><th>Status</th><th>URL</th></tr></thead>
              <tbody>
                ${queue
                  .map(
                    (q) => `
                  <tr>
                    <td><strong style="color:#0f172a;">${esc(q.company)}</strong></td>
                    <td>${esc(q.title)}</td>
                    <td><span class="chip ${q.status === "Queued" ? "amber" : "green"}">${esc(q.status)}</span></td>
                    <td><a href="${esc(q.url)}" target="_blank" style="color:#4f46e5;font-size:12px;font-weight:600;">${esc((q.url || "").slice(0, 70))}</a></td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
      }
    </div>

    <div class="card">
      <div class="card-title">Autopilot Execution Logs</div>
      <div class="sub-box" style="max-height:200px;overflow-y:auto;font-family:monospace;font-size:12px;color:#334155;line-height:1.6;">
        ${
          logs.length === 0
            ? "No Autopilot runs recorded yet."
            : logs.map((l) => `<div>[${new Date(l.ts).toLocaleTimeString()}] ${esc(l.message)}</div>`).join("")
        }
      </div>
    </div>
  `;

  c.querySelector("#ap-mode").addEventListener("change", async (e) => {
    const mode = e.target.value;
    await chrome.runtime.sendMessage({
      type: "UPDATE_SETTINGS",
      payload: { settings: { autopilotMode: mode, autoSubmitEnabled: mode === "full_auto" } }
    });
    await reloadState();
    toast(
      mode === "full_auto"
        ? "🎯 True Full Autopilot enabled — applications will auto-submit!"
        : "⏸️ Safe Review Mode enabled — will pause before final submit."
    );
  });

  c.querySelector("#ap-sched-btn").addEventListener("click", async () => {
    const mins = Number(c.querySelector("#ap-interval").value);
    await chrome.runtime.sendMessage({ type: "SCHEDULE_AUTOPILOT", payload: { intervalMinutes: mins } });
    await reloadState();
    renderAutopilot(c);
    toast(`⏰ Autopilot scheduled every ${mins} minutes!`);
  });

  c.querySelector("#ap-add-url").addEventListener("click", async () => {
    const url = c.querySelector("#ap-url").value.trim();
    if (!url) return toast("Enter a valid job URL.");
    await chrome.runtime.sendMessage({
      type: "ENQUEUE_AUTOPILOT",
      payload: {
        job: {
          company: c.querySelector("#ap-comp").value.trim() || "Target Company",
          title: c.querySelector("#ap-title").value.trim() || "AI / Software Engineer",
          url
        }
      }
    });
    await reloadState();
    renderAutopilot(c);
    toast("🤖 Added to Autopilot queue!");
  });

  c.querySelector("#ap-add-bulk-btn")?.addEventListener("click", async () => {
    const urls = (c.querySelector("#ap-bulk-urls")?.value || "")
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u));
    if (urls.length === 0) return toast("Paste one or more valid https:// job URLs first.");
    for (const url of urls) {
      let hostComp = "Career Portal";
      try {
        hostComp = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
        hostComp = hostComp.charAt(0).toUpperCase() + hostComp.slice(1);
      } catch (_) {}
      await chrome.runtime.sendMessage({
        type: "ENQUEUE_AUTOPILOT",
        payload: { job: { company: hostComp, title: "AI / Software Engineer", url } }
      });
    }
    await reloadState();
    renderAutopilot(c);
    toast(`🚀 Enqueued ${urls.length} career portal URLs!`);
  });

  c.querySelector("#ap-seed-sandbox").addEventListener("click", async () => {
    let targetSandboxUrl = chrome.runtime.getURL("sandbox/greenhouse.html");
    try {
      const health = await fetch(`${companionUrl}/api/health`, { method: "GET" });
      if (health.ok) targetSandboxUrl = `${companionUrl}/sandbox/greenhouse`;
    } catch (_) {}

    await chrome.runtime.sendMessage({
      type: "ENQUEUE_AUTOPILOT",
      payload: {
        job: {
          company: "Jobify AI Sandbox",
          title: "Senior AI Platform Engineer",
          ats: "Greenhouse",
          url: targetSandboxUrl,
          tailorFirst: false
        }
      }
    });
    await reloadState();
    renderAutopilot(c);
    toast("Added Greenhouse Sandbox to Autopilot queue!");
  });

  c.querySelector("#ap-run-now").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "RUN_AUTOPILOT_NOW" });
    toast("🚀 Autopilot started! Processing queued job tabs sequentially...");
  });

  c.querySelector("#ap-stop").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "STOP_AUTOPILOT" });
    await reloadState();
    renderAutopilot(c);
    toast("Stopped Autopilot.");
  });

  c.querySelector("#ap-clear-done").addEventListener("click", async () => {
    const remaining = (STATE.autopilotQueue || []).filter((q) => q.status === "Queued");
    await chrome.runtime.sendMessage({ type: "UPDATE_AUTOPILOT_QUEUE", payload: { queue: remaining } });
    await reloadState();
    renderAutopilot(c);
  });
}

function renderNetworkCopilot(c) {
  c.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">🤝 Find Referral Contacts &amp; Warm Intro Paths</div>
        <div class="form-row">
          <label class="field-lbl">Target Company</label>
          <input class="input" id="nw-comp" value="Anthropic" />
        </div>
        <div class="form-row">
          <label class="field-lbl">Target Role</label>
          <input class="input" id="nw-role" value="AI Platform Engineer" />
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn secondary" id="nw-map-btn">🔍 Map Referral Pathways</button>
          <button class="btn primary" id="nw-ai-btn">✨ Draft Outreach Notes</button>
        </div>
        <div id="nw-ai-out" style="margin-top:14px;"></div>
      </div>

      <div class="card">
        <div class="card-title">Referral Search Pathways</div>
        <div id="nw-paths"></div>
      </div>
    </div>
  `;

  const renderPaths = () => {
    const comp = c.querySelector("#nw-comp").value.trim();
    const role = c.querySelector("#nw-role").value.trim();
    const paths = buildNetworkCopilotPathways(comp, role);
    c.querySelector("#nw-paths").innerHTML = paths
      .map(
        (p) => `
      <a href="${esc(p.url)}" target="_blank" style="display:block;text-decoration:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="color:#0f172a;font-size:13.5px;">${esc(p.label)}</strong>
          <span class="chip indigo">${esc(p.badge)}</span>
        </div>
        <div style="color:#475569;font-size:12px;margin-top:4px;">${esc(p.description)}</div>
      </a>`
      )
      .join("");
  };

  renderPaths();
  c.querySelector("#nw-map-btn").addEventListener("click", renderPaths);
  c.querySelector("#nw-ai-btn").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = "⏳ Drafting...";
    const resp = await chrome.runtime.sendMessage({
      type: "GENERATE_NETWORK_OUTREACH",
      payload: {
        company: c.querySelector("#nw-comp").value.trim(),
        role: c.querySelector("#nw-role").value.trim()
      }
    });
    b.disabled = false;
    b.textContent = "✨ Draft Outreach Notes";
    if (resp?.ok && resp.outreach) {
      c.querySelector("#nw-ai-out").innerHTML = `
        <div class="sub-box" style="font-size:12.5px;line-height:1.55;">
          <div class="field-lbl">LinkedIn Connection Note (&lt;300 chars)</div>
          <p style="margin-bottom:10px;color:#0f172a;">${esc(resp.outreach.linkedinNote)}</p>
          <div class="field-lbl">Warm Referral Follow-Up DM</div>
          <p style="margin-bottom:10px;color:#0f172a;">${esc(resp.outreach.referralDm)}</p>
          <div class="field-lbl">Direct Recruiter Note</div>
          <p style="color:#0f172a;">${esc(resp.outreach.recruiterNote)}</p>
        </div>
      `;
    }
  });
}

function renderVaultAndProfile(c) {
  const p = STATE.profile.personal || {};
  const eeo = STATE.profile.workAuthAndEEO || {};
  const creds = STATE.credentials || {};
  const set = STATE.settings || {};
  const domainPasswords = Object.entries(creds.domainPasswords || {});

  c.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">👤 Candidate Identity, Work Auth &amp; EEO Defaults</div>
        <div class="grid-2 form-row">
          <div><label class="field-lbl">First Name</label><input class="input" id="pf-fname" value="${esc(p.firstName)}" /></div>
          <div><label class="field-lbl">Last Name</label><input class="input" id="pf-lname" value="${esc(p.lastName)}" /></div>
        </div>
        <div class="grid-2 form-row">
          <div><label class="field-lbl">Email</label><input class="input" id="pf-email" value="${esc(p.email)}" /></div>
          <div><label class="field-lbl">Phone</label><input class="input" id="pf-phone" value="${esc(p.phone)}" /></div>
        </div>
        <div class="form-row">
          <label class="field-lbl">Street Address</label>
          <input class="input" id="pf-street" value="${esc(p.streetAddress || "")}" placeholder="39861 Potrero Dr" />
        </div>
        <div class="grid-3 form-row">
          <div><label class="field-lbl">City</label><input class="input" id="pf-city" value="${esc(p.city)}" /></div>
          <div><label class="field-lbl">State</label><input class="input" id="pf-state" value="${esc(p.state)}" /></div>
          <div><label class="field-lbl">Postal Code</label><input class="input" id="pf-zip" value="${esc(p.postalCode)}" /></div>
        </div>
        <div class="grid-3 form-row">
          <div><label class="field-lbl">LinkedIn URL</label><input class="input" id="pf-li" value="${esc(p.linkedin)}" /></div>
          <div><label class="field-lbl">GitHub URL</label><input class="input" id="pf-gh" value="${esc(p.github)}" /></div>
          <div><label class="field-lbl">Portfolio Website</label><input class="input" id="pf-port" value="${esc(p.portfolio || "")}" /></div>
        </div>
        <div class="grid-3 form-row">
          <div>
            <label class="field-lbl">Authorized to Work in US?</label>
            <select class="select" id="pf-auth">
              <option value="Yes" ${eeo.authorizedUS === "Yes" ? "selected" : ""}>Yes</option>
              <option value="No" ${eeo.authorizedUS === "No" ? "selected" : ""}>No</option>
            </select>
          </div>
          <div>
            <label class="field-lbl">Require Visa Sponsorship?</label>
            <select class="select" id="pf-spons">
              <option value="Yes" ${eeo.requireSponsorship === "Yes" ? "selected" : ""}>Yes</option>
              <option value="No" ${eeo.requireSponsorship === "No" ? "selected" : ""}>No</option>
            </select>
          </div>
          <div>
            <label class="field-lbl">Current US Visa Status</label>
            <input class="input" id="pf-visa" value="${esc(eeo.visaStatus || "H-1B")}" />
          </div>
        </div>
        <div class="grid-3 form-row">
          <div>
            <label class="field-lbl">Citizenship</label>
            <input class="input" id="pf-cit" value="${esc(eeo.citizenship || "India")}" />
          </div>
          <div>
            <label class="field-lbl">Default Target Salary ($)</label>
            <input class="input" type="number" id="pf-target-sal" value="${esc(eeo.desiredSalaryTarget || 120000)}" />
          </div>
          <div>
            <label class="field-lbl">Min Salary Dealbreaker ($)</label>
            <input class="input" type="number" id="pf-sal" value="${esc(STATE.profile.preferences?.minSalary || 115000)}" />
          </div>
        </div>
        <button class="btn primary" id="pf-save-btn">💾 Save Profile &amp; Preferences</button>
      </div>

      <div class="card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>🔐 Portal Login Vault &amp; Zero-Touch Automation</span>
          <button class="btn sm secondary" id="vc-toggle-secrets" type="button">👁 Show Secrets</button>
        </div>
        <div class="form-row">
          <label class="field-lbl">Portal Signup / Login Email (Workday, iCIMS, Oracle, SAP, SmartRecruiters)</label>
          <input class="input" id="vc-email" value="${esc(creds.portalEmail)}" />
        </div>
        <div class="grid-2 form-row">
          <div>
            <label class="field-lbl">Portal Account Password</label>
            <input class="input" type="password" id="vc-pass" value="${esc(creds.portalPassword)}" autocomplete="off" />
          </div>
          <div>
            <label class="field-lbl">Gmail App Password (Optional — Chrome Gmail OTP Also Active)</label>
            <input class="input" type="password" id="vc-app-pass" value="${esc(creds.gmailAppPassword)}" autocomplete="off" />
          </div>
        </div>
        <div class="form-row">
          <label class="field-lbl">Gemini API Key</label>
          <input class="input" type="password" id="vc-api-key" value="${esc(set.geminiApiKey)}" autocomplete="off" />
        </div>
        <div class="grid-2 form-row">
          <div>
            <label class="field-lbl">Default Resume Variant</label>
            <select class="select" id="vc-def-res">
              <option value="one_page" ${set.defaultResumeVariant === "one_page" ? "selected" : ""}>1-Page GenAI Resume</option>
              <option value="master" ${set.defaultResumeVariant === "master" ? "selected" : ""}>2-Page Master Resume</option>
            </select>
          </div>
          <div>
            <label class="field-lbl">Upload Additional PDF Resume</label>
            <input class="input" type="file" id="vc-upload-pdf" accept="application/pdf" />
          </div>
        </div>
        <div class="form-row" style="display:grid;gap:8px;">
          <label class="toggle-row">
            <span style="font-size:12.5px;color:#0f172a;">🎯 <strong>Auto-Submit Applications When Ready</strong> (click final Submit automatically)</span>
            <input type="checkbox" id="vc-auto-sub" ${set.autoSubmitEnabled !== false ? "checked" : ""} style="accent-color:#059669;width:16px;height:16px;cursor:pointer;" />
          </label>
          <label class="toggle-row">
            <span style="font-size:12.5px;color:#0f172a;">🤖 <strong>Hands-Free Career Portal Auto-Pilot</strong> (auto-run when opening ATS application forms)</span>
            <input type="checkbox" id="vc-hands-free" ${set.handsFreePortalAutoApply === true ? "checked" : ""} style="accent-color:#4f46e5;width:16px;height:16px;cursor:pointer;" />
          </label>
          <label class="toggle-row">
            <span style="font-size:12.5px;color:#0f172a;">🛡️ <strong>Duplicate-Application Guard</strong> (badge &amp; block accidental double-apply)</span>
            <input type="checkbox" id="vc-dup-guard" ${set.duplicateApplyGuard !== false ? "checked" : ""} style="accent-color:#059669;width:16px;height:16px;cursor:pointer;" />
          </label>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn primary" id="vc-save-btn">💾 Save Vault &amp; API Settings</button>
          <button class="btn secondary" id="vc-test-imap">📨 Test Gmail OTP Reader</button>
        </div>

        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-size:13px;font-weight:700;color:#0f172a;">📦 Full Vault Backup &amp; Restore (.json)</div>
            <div style="font-size:11.5px;color:#64748b;">Export or restore profile, applications, tailored resumes, interview preps &amp; saved answers</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn sm secondary" id="btn-export-backup">💾 Export Backup</button>
            <button type="button" class="btn sm secondary" id="btn-import-backup">📂 Import Backup</button>
            <input type="file" id="file-import-backup" accept="application/json,.json" style="display:none;" />
          </div>
        </div>

        ${
          domainPasswords.length > 0
            ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;">
                <div class="field-lbl">🔑 Auto-Upgraded Domain Passwords (${domainPasswords.length})</div>
                <div style="display:grid;gap:6px;">
                  ${domainPasswords
                    .map(
                      ([dom, pw]) => `
                    <div class="sub-box" style="padding:7px 10px;display:flex;justify-content:space-between;align-items:center;font-size:12px;">
                      <strong style="color:#0f172a;">${esc(dom)}</strong>
                      <button type="button" class="btn sm secondary vc-copy-dom-pw" data-pw="${esc(pw)}">📋 Copy Domain Password</button>
                    </div>`
                    )
                    .join("")}
                </div>
              </div>`
            : ""
        }
      </div>
    </div>

    <div class="card">
      <div class="card-title">💬 Saved Common Answers Bank (${(STATE.savedAnswers || []).length})</div>
      <div class="grid-3 form-row">
        <input class="input" id="sa-new-q" placeholder="Question (e.g., Why do you want to join our team?)" />
        <input class="input" id="sa-new-a" placeholder="Reusable answer..." />
        <button class="btn secondary" id="sa-add-btn">+ Save Reusable Answer</button>
      </div>
      <table class="table">
        <thead><tr><th>Question</th><th>Saved Answer</th><th>Action</th></tr></thead>
        <tbody>
          ${(STATE.savedAnswers || [])
            .map(
              (sa) => `
            <tr>
              <td style="width:28%;"><strong style="color:#0f172a;">${esc(sa.questionLabel)}</strong></td>
              <td>${esc(sa.answer)}</td>
              <td style="width:90px;"><button class="btn sm danger sa-del-btn" data-id="${esc(sa.id)}">Delete</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  c.querySelector("#pf-save-btn").addEventListener("click", async () => {
    const next = structuredClone(STATE.profile);
    next.personal.firstName = c.querySelector("#pf-fname").value.trim();
    next.personal.lastName = c.querySelector("#pf-lname").value.trim();
    next.personal.fullName = `${next.personal.firstName} ${next.personal.lastName}`.trim();
    next.personal.email = c.querySelector("#pf-email").value.trim();
    next.personal.phone = c.querySelector("#pf-phone").value.trim();
    next.personal.streetAddress = c.querySelector("#pf-street").value.trim();
    next.personal.city = c.querySelector("#pf-city").value.trim();
    next.personal.state = c.querySelector("#pf-state").value.trim();
    next.personal.postalCode = c.querySelector("#pf-zip").value.trim();
    next.personal.linkedin = c.querySelector("#pf-li").value.trim();
    next.personal.github = c.querySelector("#pf-gh").value.trim();
    next.personal.portfolio = c.querySelector("#pf-port").value.trim();
    next.workAuthAndEEO.authorizedUS = c.querySelector("#pf-auth").value;
    next.workAuthAndEEO.requireSponsorship = c.querySelector("#pf-spons").value;
    next.workAuthAndEEO.visaStatus = c.querySelector("#pf-visa").value.trim() || "H-1B";
    next.workAuthAndEEO.citizenship = c.querySelector("#pf-cit").value.trim() || "India";
    next.workAuthAndEEO.desiredSalaryTarget = Number(c.querySelector("#pf-target-sal").value || 120000);
    next.preferences.minSalary = Number(c.querySelector("#pf-sal").value || 115000);

    await chrome.runtime.sendMessage({ type: "UPDATE_PROFILE", payload: { profile: next } });
    await reloadState();
    toast("✅ Profile saved!");
  });

  c.querySelector("#vc-toggle-secrets")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const inputs = ["#vc-pass", "#vc-app-pass", "#vc-api-key"].map((sel) => c.querySelector(sel)).filter(Boolean);
    const show = inputs[0]?.type === "password";
    inputs.forEach((inp) => {
      inp.type = show ? "text" : "password";
    });
    btn.textContent = show ? "🙈 Hide Secrets" : "👁 Show Secrets";
  });

  c.querySelector("#vc-save-btn").addEventListener("click", async () => {
    const autoSubEnabled = Boolean(c.querySelector("#vc-auto-sub")?.checked);
    const handsFreeEnabled = Boolean(c.querySelector("#vc-hands-free")?.checked);
    const dupGuardEnabled = Boolean(c.querySelector("#vc-dup-guard")?.checked);
    await chrome.runtime.sendMessage({
      type: "UPDATE_CREDENTIALS",
      payload: {
        credentials: {
          portalEmail: c.querySelector("#vc-email").value.trim(),
          portalPassword: c.querySelector("#vc-pass").value,
          gmailAppPassword: c.querySelector("#vc-app-pass").value
        }
      }
    });
    await chrome.runtime.sendMessage({
      type: "UPDATE_SETTINGS",
      payload: {
        settings: {
          geminiApiKey: c.querySelector("#vc-api-key").value.trim(),
          defaultResumeVariant: c.querySelector("#vc-def-res").value,
          autoSubmitEnabled: autoSubEnabled,
          autopilotMode: autoSubEnabled ? "full_auto" : "safe_review",
          handsFreePortalAutoApply: handsFreeEnabled,
          duplicateApplyGuard: dupGuardEnabled
        }
      }
    });
    await reloadState();
    toast("🔐 Vault & Zero-Touch settings saved!");
  });

  c.querySelectorAll(".vc-copy-dom-pw").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.pw || "");
      toast("📋 Copied domain password!");
    });
  });

  c.querySelector("#btn-export-backup")?.addEventListener("click", () => {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        version: "2.3.0",
        state: STATE
      },
      null,
      2
    );
    downloadText(payload, `Jobify_Vault_Backup_${new Date().toISOString().slice(0, 10)}.json`, "application/json");
    toast("💾 Exported full Jobify Vault backup!");
  });

  c.querySelector("#btn-import-backup")?.addEventListener("click", () => {
    c.querySelector("#file-import-backup")?.click();
  });

  c.querySelector("#file-import-backup")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const backupObj = parsed?.state || parsed;
      const resp = await chrome.runtime.sendMessage({
        type: "RESTORE_STATE_BACKUP",
        payload: { backup: backupObj }
      });
      if (resp?.ok) {
        await reloadState();
        renderVaultAndProfile(c);
        toast("✅ Vault backup restored!");
      } else {
        toast(`Error: ${resp?.error || "Restore failed"}`);
      }
    } catch (err) {
      toast(`Invalid backup JSON: ${err.message}`);
    }
  });

  c.querySelector("#vc-upload-pdf").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const b64 = btoa(bin);
    const next = structuredClone(STATE.profile);
    next.resumes.unshift({
      id: `custom_${Date.now()}`,
      name: file.name,
      label: `Uploaded: ${file.name}`,
      customBase64: b64
    });
    await chrome.runtime.sendMessage({ type: "UPDATE_PROFILE", payload: { profile: next } });
    await reloadState();
    toast(`📎 Added ${file.name} to Resume Vault!`);
  });

  c.querySelector("#vc-test-imap").addEventListener("click", async () => {
    const resp = await chrome.runtime.sendMessage({ type: "FETCH_IMAP_OTP", payload: {} }).catch(() => null);
    if (resp?.ok) {
      toast(`📨 IMAP connected! Latest OTP: ${resp.otp || "None in recent messages"}`);
    } else {
      toast(`⚠️ IMAP check: ${resp?.error || "Start backend/server.py or verify Gmail App Password"}`);
    }
  });

  c.querySelector("#sa-add-btn").addEventListener("click", async () => {
    const q = c.querySelector("#sa-new-q").value.trim();
    const a = c.querySelector("#sa-new-a").value.trim();
    if (!q || !a) return toast("Enter both question and answer.");
    await chrome.runtime.sendMessage({
      type: "UPSERT_SAVED_ANSWER",
      payload: { entry: { questionLabel: q, answer: a } }
    });
    await reloadState();
    renderVaultAndProfile(c);
    toast("💬 Saved reusable answer!");
  });

  c.querySelectorAll(".sa-del-btn").forEach((b) => {
    b.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "DELETE_SAVED_ANSWER", payload: { id: b.dataset.id } });
      await reloadState();
      renderVaultAndProfile(c);
    });
  });
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

let liveRefreshTimer = null;
chrome.storage?.onChanged?.addListener((_changes, area) => {
  if (area !== "local") return;
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(async () => {
    await reloadState();
    const activeEl = document.activeElement;
    const isTypingInForm =
      activeEl &&
      (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT");
    if (!isTypingInForm && ["overview", "tracker", "autopilot"].includes(currentView)) {
      renderCurrentView();
    }
  }, 280);
});

(async () => {
  await reloadState();
  switchView(currentView);
})();
