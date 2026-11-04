// Jobify Full-Page Career Hub Controller
import { scoreResumeATS, analyzeJobKeywords } from "../shared/ats_analyzer.js";
import { buildNetworkCopilotPathways, STAFFING_AGENCIES_DIRECTORY, fetchPersonalizedRecommendations } from "../shared/job_feeds.js";

let STATE = null;
let currentView = (location.hash || "#overview").replace("#", "") || "overview";
let cachedLiveJobs = [];

let trackerFilterQ = "";
let trackerFilterStage = "All";

const VIEW_HEADERS = {
  overview: ["Overview & ATS Sandbox", "Your complete Simplify+ AI Copilot pre-loaded with Raviteja Velanati's profile"],
  tracker: ["All-in-One Application Tracker", "Track bookmarks, submitted applications, interview notes, timelines & referrals"],
  resume: ["AI Resume Tailor, Builder & ATS Scorer", "Tailor bullets with Gemini 3.5 Flash / 3 Flash Preview, audit missing keywords & compile ATS PDF"],
  cover: ["AI Cover Letter Studio", "Generate custom recruiter-ready cover letters & export ATS PDFs"],
  jobs: ["Multi-Platform Job Discovery & 128 Staffing Agencies", "Live roles across Workday, LinkedIn, Dice, 128 Staffing Agencies, Microsoft, Greenhouse, Ashby, Lever & Indeed with 2h/8h/12h/24h/2d & H-1B filters"],
  autopilot: ["Autopilot Control Center", "Queue job applications, configure True Full Auto-Submit vs. Safe Review, and schedule recurring runs"],
  network: ["Network Copilot — Warm Referral Pathfinder", "Map alumni, ex-colleagues, hiring managers & AI-drafted outreach notes"],
  vault: ["Profile, Resume Vault, Saved Answers & Credentials", "Edit candidate details, EEO preferences, saved answers, portal logins & Gemini API settings"]
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

async function reloadState() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" });
  STATE = resp?.state || {};
  document.getElementById("sb-user-name").textContent = STATE.profile?.personal?.fullName || "Raviteja Velanati";
  document.getElementById("sb-user-email").textContent = STATE.profile?.personal?.email || "";
  document.getElementById("topbar-model-pill").textContent = `AI: ${STATE.settings?.primaryModel || "gemini-3.5-flash"}${
    STATE.settings?.enableSmartFallback ? " • Smart Quota Ready" : ""
  }`;
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

  c.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-val">${apps.length}</div>
        <div class="kpi-lbl">Tracked Jobs (${apps.filter((a) => a.status === "Applied").length} Applied)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val">${baseAudit.totalScore}/100</div>
        <div class="kpi-lbl">Baseline ATS Resume Score</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val">${(STATE.tailoredResumes || []).length}</div>
        <div class="kpi-lbl">AI-Tailored PDF Resumes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val">${(STATE.savedAnswers || []).length}</div>
        <div class="kpi-lbl">Saved Common Answers</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">🧪 Test 1-Click Autofill on Realistic ATS Sandboxes</div>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:14px;">
          Launch our local multi-ATS sandbox portals (Workday Account Signup + Multi-Step Form, Greenhouse Resume Upload + EEO + AI Questions, Lever Full Application) to see Jobify autofill every field, create portal logins, and attach your real PDF resume in 1 click:
        </p>
        <div class="grid-3">
          <a class="btn primary" href="${esc(chrome.runtime.getURL("sandbox/greenhouse.html"))}" target="_blank">Greenhouse Sandbox ↗</a>
          <a class="btn primary" href="${esc(chrome.runtime.getURL("sandbox/workday.html"))}" target="_blank">Workday + Signup ↗</a>
          <a class="btn primary" href="${esc(chrome.runtime.getURL("sandbox/lever.html"))}" target="_blank">Lever Sandbox ↗</a>
        </div>
      </div>

      <div class="card">
        <div class="card-title">⚡ Pre-Analyzed Candidate Snapshot</div>
        <div style="font-size:13px;line-height:1.65;color:#cbd5e1;">
          <div><strong>Name:</strong> ${esc(STATE.profile.personal.fullName)} (${esc(STATE.profile.personal.locationDisplay)})</div>
          <div><strong>Current Role:</strong> ${esc(STATE.profile.personal.currentTitle)} @ ${esc(STATE.profile.personal.currentCompany)}</div>
          <div><strong>Education:</strong> M.S. CS, Clark University (3.5 GPA) • B.Tech CS, Malla Reddy (3.6 GPA)</div>
          <div><strong>Bundled PDFs:</strong> <span class="chip indigo">1-Page Resume</span> <span class="chip indigo">2-Page Master Resume</span></div>
          <div><strong>Portal Vault:</strong> <span class="chip green">${esc(STATE.credentials.portalEmail)}</span></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Recent AI-Tailored Resumes</span>
        <button class="btn sm secondary" id="ov-go-resume">+ Tailor New Resume</button>
      </div>
      ${
        (STATE.tailoredResumes || []).length === 0
          ? `<p style="font-size:13px;color:#94a3b8;">No tailored resumes generated yet. Open any job tab or click "+ Tailor New Resume" to build your first tailored ATS PDF.</p>`
          : `<table class="table">
              <thead><tr><th>Company</th><th>Role</th><th>Model</th><th>ATS Score</th><th>Created</th><th>Action</th></tr></thead>
              <tbody>
                ${STATE.tailoredResumes
                  .slice(0, 8)
                  .map(
                    (r, i) => `
                  <tr>
                    <td><strong>${esc(r.company)}</strong></td>
                    <td>${esc(r.role)}</td>
                    <td><span class="chip indigo">${esc(r.modelUsed)}</span></td>
                    <td><span class="chip green">${r.atsScore || 94}/100</span></td>
                    <td>${new Date(r.createdAt).toLocaleDateString()}</td>
                    <td><button class="btn sm secondary ov-dl-tr" data-idx="${i}">⬇ Download PDF</button></td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
      }
    </div>
  `;

  c.querySelector("#ov-go-resume")?.addEventListener("click", () => switchView("resume"));
  c.querySelectorAll(".ov-dl-tr").forEach((b) => {
    b.addEventListener("click", () => {
      const tr = STATE.tailoredResumes[Number(b.dataset.idx)];
      downloadBase64(tr.pdfBase64, tr.fileName);
    });
  });
}

let expandedReceiptAppId = null;

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

  c.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:14px;">
      <div class="kpi-card" style="border-color:${inFlightCount > 0 ? "#38bdf8" : "#1f2937"};">
        <div class="kpi-val" style="color:#38bdf8;">${inFlightCount}</div>
        <div class="kpi-lbl">⚡ In Flight (Reading JD / Tailoring / Auth)</div>
      </div>
      <div class="kpi-card" style="border-color:${filledCount > 0 ? "#a855f7" : "#1f2937"};">
        <div class="kpi-val" style="color:#c084fc;">${filledCount}</div>
        <div class="kpi-lbl">✍️ Filled (Fields &amp; PDF Attached)</div>
      </div>
      <div class="kpi-card" style="border-color:#10b981;">
        <div class="kpi-val" style="color:#34d399;">${submittedCount}</div>
        <div class="kpi-lbl">✅ Submitted (Moved to Applied Tracker)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val" style="color:#fbbf24;">${needsYouCount}</div>
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
          <input class="input" id="trk-filter-q" value="${esc(trackerFilterQ)}" placeholder="Search company, role, notes..." style="width:230px;padding:6px 10px;font-size:12px;" />
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
          ? `<p style="font-size:13px;color:#94a3b8;">${
              apps.length === 0
                ? "No applications logged yet. Click Auto-Apply on any job to watch it transition live from In Flight → Filled → Submitted!"
                : "No applications match the current filter."
            }</p>`
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
                        ? "indigo"
                        : a.status === "Filled"
                        ? "amber"
                        : a.status === "Applied"
                        ? "green"
                        : "indigo";
                    const receiptFields = Array.isArray(a.fieldsReceipt) ? a.fieldsReceipt : [];
                    const diffList = Array.isArray(a.resumeDiff) ? a.resumeDiff : [];
                    return `
                  <tr data-id="${esc(a.id)}">
                    <td>
                      <div style="font-weight:700;color:#fff;">${esc(a.company)}</div>
                      <div style="font-size:12px;color:#94a3b8;">${esc(a.role)}</div>
                      <div style="font-size:11px;color:#64748b;">📍 ${esc(a.location || "United States")}</div>
                      ${a.url ? `<a href="${esc(a.url)}" target="_blank" style="font-size:11px;color:#818cf8;">Open Posting ↗</a>` : ""}
                    </td>
                    <td>
                      <span class="chip indigo">${esc(a.ats || "Portal")}</span>
                      <div style="font-size:11px;color:#34d399;margin-top:4px;font-family:monospace;">📄 ${esc(a.resumeUsed || "Tailored PDF")}</div>
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
                      <div style="font-size:11.5px;color:#cbd5e1;margin-bottom:4px;">${esc(a.detail || "")}</div>
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
                        <button class="btn sm danger trk-del" data-id="${esc(a.id)}">✕</button>
                      </div>
                    </td>
                  </tr>
                  ${
                    isExpanded
                      ? `<tr>
                          <td colspan="6" style="background:#090e1a;padding:16px;border-left:3px solid #10b981;">
                            <div class="grid-2">
                              <div>
                                <div style="font-weight:800;color:#6ee7b7;margin-bottom:8px;">
                                  ✓ What Got Sent to ${esc(a.ats || a.company)} (${receiptFields.length || a.filledCount || 8} fields · 0 skipped · 0 generic answers)
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
                                      (f) => `<div style="padding:6px 8px;background:#111827;border-radius:6px;border:1px solid #1f2937;">
                                        <span style="color:#34d399;font-weight:700;">✓ ${esc(f.label)}:</span>
                                        <span style="color:#e2e8f0;margin-left:4px;">${esc(f.value)}</span>
                                      </div>`
                                    )
                                    .join("")}
                                </div>
                              </div>
                              <div>
                                <div style="font-weight:800;color:#a5b4fc;margin-bottom:8px;">
                                  ✨ Tailored Résumé Diff (${esc(a.resumeUsed || "1-Page ATS PDF")})
                                </div>
                                ${
                                  diffList.length === 0
                                    ? `<div style="font-size:12px;color:#94a3b8;">Tailored 1-page ATS résumé attached with role-aligned summary, 4 skill categories, and 14 quantified bullets.</div>`
                                    : diffList
                                        .slice(0, 3)
                                        .map(
                                          (d) => `<div style="margin-bottom:8px;padding:8px;background:#111827;border-radius:6px;font-size:11.5px;">
                                            <div style="font-weight:700;color:#cbd5e1;margin-bottom:4px;">${esc(d.company)} — ${esc(d.role)}</div>
                                            <div style="color:#fca5a5;margin-bottom:3px;">− ${esc(d.before)}</div>
                                            <div style="color:#6ee7b7;">+ ${esc(d.after)}</div>
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
    toast(`🤖 Started silent background Auto-Apply for ${company} — watch status transition In Flight → Filled → Submitted!`);
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
      toast(`🤖 Auto-Applying to ${app.company} in background (In Flight → Filled → Submitted)...`);
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
  c.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div class="card-title" style="margin:0;">Target Job Description</div>
          <button type="button" class="btn secondary" id="rs-sample-btn" style="padding:4px 10px;font-size:11.5px;">Load Sample JD</button>
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
        <div style="display:flex;gap:10px;">
          <button class="btn secondary" id="rs-scan-btn">🔍 Scan Missing Keywords & ATS Score</button>
          <button class="btn primary" id="rs-tailor-btn">✨ Build From-Scratch Resume &amp; PDF</button>
        </div>
      </div>

      <div class="card" id="rs-output-panel">
        <div class="card-title">ATS Score, Missing Keywords &amp; From-Scratch Preview</div>
        <div id="rs-results-inner" style="font-size:13px;color:#94a3b8;">
          Paste a target job description (or click <strong>Load Sample JD</strong>), then click <strong>Scan Missing Keywords</strong> or <strong>Build From-Scratch Resume &amp; PDF</strong>.
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
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;padding:12px;background:#0b1120;border-radius:10px;border:1px solid #1f2937;">
        <div style="font-size:32px;font-weight:900;color:#34d399;">${audit.totalScore}/100</div>
        <div>
          <div style="font-weight:700;color:#fff;">Baseline ATS Readability & Keyword Score</div>
          <div style="font-size:12px;color:#94a3b8;">Keyword Coverage: ${audit.keywords.keywordCoveragePct}% • Quantified Bullets: ${audit.breakdown.quantifiedImpact.quantifiedBullets}/${audit.breakdown.quantifiedImpact.totalBullets}</div>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <div class="field-lbl">Missing Keywords (${audit.keywords.missing.length})</div>
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

  c.querySelector("#rs-sample-btn").addEventListener("click", () => {
    c.querySelector("#rs-comp").value = "Anthropic";
    c.querySelector("#rs-role").value = "AI Platform & Evaluation Engineer";
    c.querySelector("#rs-jd").value =
      "We are hiring an AI Platform & Evaluation Engineer to build scalable LLM evaluation harnesses, multi-agent simulation sandboxes, red-teaming & AI safety pipelines, and full-stack telemetry dashboards. Required skills: Python, TypeScript, React, Kubernetes, Docker, GCP or AWS, distributed microservices, RAG, vector databases, observability/OpenTelemetry, and CI/CD.";
    renderScan(c.querySelector("#rs-jd").value);
  });

  c.querySelector("#rs-scan-btn").addEventListener("click", () => {
    renderScan(c.querySelector("#rs-jd").value);
    if (c.querySelector("#rs-jd").value.trim()) toast("🔍 Updated ATS keyword audit!");
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
    const rec = resp.record;
    const t = rec.tailored;
    const out = c.querySelector("#rs-results-inner");
    out.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#0b1120;border:1px solid #10b981;border-radius:10px;margin-bottom:14px;">
        <div>
          <div style="font-weight:800;color:#6ee7b7;font-size:15px;">✅ Tailored ATS Score: ${rec.atsScore}/100</div>
          <div style="font-size:11.5px;color:#94a3b8;">Header Title: <strong style="color:#e2e8f0;">${esc(t.targetJobTitle || rec.role)}</strong> • Model: ${esc(rec.modelUsed)} • PDF: ${esc(rec.pdfEngine)}</div>
        </div>
        <button class="btn emerald" id="rs-dl-pdf">⬇ Download ${esc(rec.fileName)}</button>
      </div>

      <div style="margin-bottom:12px;">
        <div class="field-lbl">Tailored Summary (4-Sentence From-Scratch Framework)</div>
        <div style="background:#0b1120;padding:10px;border-radius:8px;color:#e2e8f0;line-height:1.5;">${esc(t.summary)}</div>
      </div>

      <div style="margin-bottom:12px;">
        <div class="field-lbl">Tailored Skills (4 Categories)</div>
        <div style="background:#0b1120;padding:10px;border-radius:8px;color:#cbd5e1;line-height:1.55;">
          ${Object.entries(t.skillsCategories || {})
            .map(([cat, items]) => `<div><strong style="color:#a5b4fc;">${esc(cat)}:</strong> ${esc(Array.isArray(items) ? items.join(", ") : items)}</div>`)
            .join("")}
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <div class="field-lbl">Tailored Experience Bullets (5 / 3 / 2 Allocation)</div>
        ${(t.experience || [])
          .map(
            (exp) => `
          <div style="background:#0b1120;padding:10px;border-radius:8px;margin-bottom:8px;">
            <div style="font-weight:700;color:#a5b4fc;">${esc(exp.company)} — ${esc(exp.title)} (${esc(exp.period)})</div>
            <ul style="padding-left:18px;margin-top:5px;color:#cbd5e1;line-height:1.5;">
              ${(exp.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}
            </ul>
          </div>`
          )
          .join("")}
      </div>

      <div>
        <div class="field-lbl">Tailored Projects (2 / 2 Allocation)</div>
        ${(t.projects || [])
          .map(
            (pr) => `
          <div style="background:#0b1120;padding:10px;border-radius:8px;margin-bottom:8px;">
            <div style="font-weight:700;color:#a5b4fc;">${esc(pr.name)} (${esc(pr.stack || "")})</div>
            <ul style="padding-left:18px;margin-top:5px;color:#cbd5e1;line-height:1.5;">
              ${(pr.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}
            </ul>
          </div>`
          )
          .join("")}
      </div>
    `;

    out.querySelector("#rs-dl-pdf").addEventListener("click", () => {
      downloadBase64(rec.pdfBase64, rec.fileName);
    });
    toast(`✨ Tailored PDF compiled (${rec.fileName})!`);
  });
}

function renderCoverStudio(c) {
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
            <option value="Concise & Technical">Concise & Technical (Recommended)</option>
            <option value="High-Impact Builder">High-Impact Builder</option>
            <option value="Research & Safety Rigor">AI Safety & Evaluation Rigor</option>
          </select>
        </div>
        <div class="form-row">
          <label class="field-lbl">Job Description</label>
          <textarea class="textarea" id="cl-jd" style="min-height:200px;" placeholder="Paste the target job description here..."></textarea>
        </div>
        <button class="btn primary" id="cl-gen-btn">📝 Generate Cover Letter + PDF</button>
      </div>

      <div class="card">
        <div class="card-title">Cover Letter Editor & Export</div>
        <textarea class="textarea" id="cl-editor" style="min-height:310px;" placeholder="Your generated cover letter will appear here...">${
          esc(STATE.coverLetters?.[0]?.coverLetter || "")
        }</textarea>
        <div style="display:flex;gap:10px;margin-top:12px;">
          <button class="btn secondary" id="cl-copy-btn">📋 Copy Text</button>
          <button class="btn emerald" id="cl-dl-btn" ${STATE.coverLetters?.[0]?.pdfBase64 ? "" : "disabled"}>⬇ Download Latest PDF</button>
        </div>
      </div>
    </div>
  `;

  c.querySelector("#cl-sample-btn").addEventListener("click", () => {
    c.querySelector("#cl-comp").value = "OpenAI";
    c.querySelector("#cl-role").value = "Software Engineer, Agentic Evaluation";
    c.querySelector("#cl-jd").value =
      "Build evaluation environments, synthetic user state pipelines, and adversarial benchmarks for frontier autonomous browser and coding agents.";
  });

  let activeRecord = STATE.coverLetters?.[0] || null;
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
      toast(`📝 Generated with ${activeRecord.modelUsed}!`);
    } else {
      toast(`Error: ${resp?.error || "Failed"}`);
    }
  });

  c.querySelector("#cl-editor")?.addEventListener("input", (e) => {
    const dlBtn = c.querySelector("#cl-dl-btn");
    if (dlBtn) dlBtn.disabled = !e.target.value.trim();
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

async function renderLiveJobs(c) {
  c.innerHTML = `
    <div class="filter-shell">
      <div class="filter-top-row">
        <div class="filter-search-wrap">
          <input class="filter-search-input" id="jf-q" placeholder="Search by job title, company, skill, or city..." value="" />
        </div>
        <button class="btn sm secondary" id="jf-toggle-staffing">🏢 128 Staffing Agencies</button>
        <button class="btn sm secondary" id="jf-reset" style="display:none;">↺ Reset Filters</button>
        <button class="btn sm primary" id="jf-refresh">↻ Pull Live Jobs</button>
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
          <div style="font-weight:700;font-size:15px;color:#fff;">🏢 128 Staffing Agencies Directory</div>
          <div style="font-size:12px;color:#94a3b8;">Direct career portals across all ${STAFFING_AGENCIES_DIRECTORY.length} staffing agencies supporting H-1B, OPT/STEM OPT, W2 &amp; C2C</div>
        </div>
        <input class="filter-search-input" id="jf-staffing-search" placeholder="Search 128 agencies (e.g., TEKsystems, Insight Global, Kforce)..." style="max-width:300px;" value="" />
      </div>
      <div id="jf-staffing-grid" class="job-feed-grid" style="max-height:360px;overflow-y:auto;padding-right:4px;"></div>
    </div>

    <div id="jf-grid-wrap">
      <div class="card">Pulling live roles across Workday, LinkedIn, Dice, Staffing Agencies, Greenhouse, Ashby &amp; Lever...</div>
    </div>
  `;

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
            <span style="font-weight:700;color:#fff;font-size:13.5px;">${esc(a.name)}</span>
            <span class="chip indigo" style="font-size:10.5px;">${esc(a.portalType)}</span>
          </div>
          <div style="font-size:11px;color:#10b981;margin-bottom:6px;">H-1B • STEM OPT • W2 / C2C</div>
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

    // Direct module fallback guarantees Live Jobs always renders even if background worker was reloaded or idle
    if (jobs.length === 0) {
      try {
        jobs = await fetchPersonalizedRecommendations(STATE?.profile || {}, filterPayload);
      } catch (_) {}
    }

    cachedLiveJobs = jobs;
    if (cachedLiveJobs.length === 0) {
      wrap.innerHTML = `<div class="card" style="text-align:center;color:#94a3b8;">No matching roles found for this filter combination. Click <strong>Reset Filters</strong> to show all live jobs.</div>`;
      return;
    }

    wrap.innerHTML = `
      <div style="margin-bottom:12px;font-size:13px;color:#94a3b8;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <span>Showing <strong style="color:#fff;">${cachedLiveJobs.length}</strong> live roles across Workday, LinkedIn, Dice, Staffing Agencies, Greenhouse, Ashby &amp; Lever</span>
        <span style="font-size:11.5px;color:#10b981;">● Multi-Platform Live Feed Synced</span>
      </div>
      <div class="job-feed-grid">
        ${cachedLiveJobs
          .map(
            (j, idx) => `
          <div class="job-card" data-hub-job-card="true">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:4px;flex-wrap:wrap;">
                <span class="chip indigo">${esc(j.company)} • ${esc(j.ats)}</span>
                <span class="chip green">${j.matchScore}% Match</span>
              </div>
              <div style="font-weight:700;font-size:14.5px;color:#fff;margin-bottom:4px;">${esc(j.title)}</div>
              <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">${esc(j.location)}${j.compensation ? ` • <span style="color:#34d399;font-weight:600;">${esc(j.compensation)}</span>` : ""}</div>
              <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px;">
                <span class="chip" style="background:rgba(56,189,248,0.12);color:#7dd3fc;font-size:10.5px;">${esc(j.postedLabel || "Recent")}</span>
                <span class="chip" style="background:rgba(168,85,247,0.12);color:#d8b4fe;font-size:10.5px;">${esc(j.roleType || "Full-Time")}</span>
                <span class="chip" style="background:rgba(245,158,11,0.12);color:#fcd34d;font-size:10.5px;">${esc(j.experienceLabel || `${j.experienceRange || "2-3"} Yrs`)}</span>
                <span class="chip" style="background:rgba(148,163,184,0.12);color:#cbd5e1;font-size:10.5px;">${esc(j.workMode || "Hybrid")}</span>
                ${
                  j.h1bSponsor
                    ? `<span class="chip" style="background:rgba(16,185,129,0.13);color:#6ee7b7;font-size:10.5px;">${esc(j.sponsorshipType || "H-1B Sponsor")}</span>`
                    : ""
                }
              </div>
            </div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
              <button class="btn sm emerald jf-launch-auto" data-idx="${idx}" style="flex:1.2;">⚡ Auto-Apply</button>
              <a class="btn sm primary" href="${esc(j.url)}" target="_blank" style="flex:0.8;">Open ↗</a>
              <button class="btn sm secondary jf-save" data-idx="${idx}" title="Save to Tracker">📌</button>
              <button class="btn sm secondary jf-ap" data-idx="${idx}" title="Queue in Autopilot">🤖</button>
            </div>
          </div>`
          )
          .join("")}
      </div>
    `;

    wrap.querySelectorAll(".jf-launch-auto").forEach((b) => {
      b.addEventListener("click", async () => {
        const j = cachedLiveJobs[Number(b.dataset.idx)];
        b.disabled = true;
        b.textContent = "⏳ In Flight...";
        toast(`Started background Auto-Apply for ${j.company}!`);
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
        <div class="card-title">🤖 Autopilot Configuration &amp; Runner</div>
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
        <div style="display:flex;gap:10px;">
          <button class="btn primary" id="ap-run-now">▶ Run Queued Jobs Now (${queue.filter((q) => q.status === "Queued").length})</button>
          <button class="btn secondary" id="ap-seed-sandbox">+ Queue Local Sandbox Test</button>
          <button class="btn danger" id="ap-stop">■ Stop</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">+ Add Job URL to Autopilot Queue</div>
        <div class="grid-2 form-row">
          <input class="input" id="ap-comp" placeholder="Company Name" />
          <input class="input" id="ap-title" placeholder="Role Title" />
        </div>
        <div class="form-row">
          <input class="input" id="ap-url" placeholder="https://boards.greenhouse.io/..." />
        </div>
        <button class="btn secondary" id="ap-add-url">+ Enqueue Job URL</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Autopilot Queue (${queue.length})</span>
        <button class="btn sm secondary" id="ap-clear-done">Clear Completed</button>
      </div>
      ${
        queue.length === 0
          ? `<p style="font-size:13px;color:#94a3b8;">Queue is empty. Add roles from "Live Jobs &amp; Daily Lists" or click "+ Queue Local Sandbox Test".</p>`
          : `<table class="table">
              <thead><tr><th>Company</th><th>Role</th><th>Status</th><th>URL</th></tr></thead>
              <tbody>
                ${queue
                  .map(
                    (q) => `
                  <tr>
                    <td><strong>${esc(q.company)}</strong></td>
                    <td>${esc(q.title)}</td>
                    <td><span class="chip ${q.status === "Queued" ? "amber" : "green"}">${esc(q.status)}</span></td>
                    <td><a href="${esc(q.url)}" target="_blank" style="color:#818cf8;font-size:12px;">${esc(q.url.slice(0, 65))}</a></td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
      }
    </div>

    <div class="card">
      <div class="card-title">Autopilot Execution Logs</div>
      <div style="max-height:200px;overflow-y:auto;font-family:monospace;font-size:12px;color:#cbd5e1;line-height:1.6;">
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
    toast("🚀 Autopilot started! Opening queued job tabs...");
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
        <div class="card-title">🤝 Find Referral Contacts & Warm Intro Paths</div>
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
      <a href="${esc(p.url)}" target="_blank" style="display:block;text-decoration:none;background:#0b1120;border:1px solid #1f2937;border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="color:#f8fafc;font-size:13.5px;">${esc(p.label)}</strong>
          <span class="chip indigo">${esc(p.badge)}</span>
        </div>
        <div style="color:#94a3b8;font-size:12px;margin-top:4px;">${esc(p.description)}</div>
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
        <div style="background:#0b1120;border:1px solid #334155;border-radius:10px;padding:12px;font-size:12.5px;line-height:1.5;">
          <div class="field-lbl">LinkedIn Connection Note (&lt;300 chars)</div>
          <p style="margin-bottom:10px;color:#e2e8f0;">${esc(resp.outreach.linkedinNote)}</p>
          <div class="field-lbl">Warm Referral Follow-Up DM</div>
          <p style="margin-bottom:10px;color:#e2e8f0;">${esc(resp.outreach.referralDm)}</p>
          <div class="field-lbl">Direct Recruiter Note</div>
          <p style="color:#e2e8f0;">${esc(resp.outreach.recruiterNote)}</p>
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

  c.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title">👤 Candidate Identity, Work Auth & EEO Defaults</div>
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
        <button class="btn primary" id="pf-save-btn">💾 Save Profile & Preferences</button>
      </div>

      <div class="card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>🔐 Portal Login Vault &amp; Gemini AI Engine</span>
          <button class="btn sm secondary" id="vc-toggle-secrets" type="button">👁 Show Secrets</button>
        </div>
        <div class="form-row">
          <label class="field-lbl">Portal Signup / Login Email (Workday, iCIMS, SmartRecruiters)</label>
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
        <div class="form-row">
          <label style="display:flex;align-items:center;justify-content:space-between;background:#0b1120;border:1px solid #334155;border-radius:8px;padding:9px 12px;cursor:pointer;">
            <span style="font-size:12.5px;color:#e2e8f0;">🎯 <strong>Auto-Submit Applications When Ready</strong> (click final Submit automatically)</span>
            <input type="checkbox" id="vc-auto-sub" ${set.autoSubmitEnabled !== false ? "checked" : ""} style="accent-color:#10b981;width:16px;height:16px;cursor:pointer;" />
          </label>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn primary" id="vc-save-btn">💾 Save Vault &amp; API Settings</button>
          <button class="btn secondary" id="vc-test-imap">📨 Test Gmail OTP Reader</button>
        </div>
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
              <td style="width:28%;"><strong>${esc(sa.questionLabel)}</strong></td>
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
          autopilotMode: autoSubEnabled ? "full_auto" : "safe_review"
        }
      }
    });
    await reloadState();
    toast("🔐 Vault & Gemini settings saved!");
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
