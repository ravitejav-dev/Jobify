function notifyCopied(label) {
  const t = document.getElementById("sp-toast");
  t.textContent = `📋 Copied ${label} to clipboard!`;
  t.style.display = "block";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.display = "none";
  }, 2200);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setLiveStatus(msg) {
  const el = document.getElementById("sp-live-status");
  if (el) el.textContent = msg || "";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderVaultContent(state) {
  const p = state.profile?.personal || {};
  const creds = state.credentials || {};

  const fields = [
    ["First Name", p.firstName],
    ["Last Name", p.lastName],
    ["Email", p.email],
    ["Phone", p.phone],
    ["Location", `${p.city}, ${p.stateCode} ${p.postalCode}`],
    ["LinkedIn", p.linkedin],
    ["GitHub", p.github],
    ["Portal Email", creds.portalEmail],
    ["Portal Password", creds.portalPassword],
    ["Desired Salary", state.profile?.workAuthAndEEO?.desiredSalaryDisplay],
    ["Summary", state.profile?.summaryShort]
  ];

  const grid = document.getElementById("sp-identity-grid");
  grid.innerHTML = fields
    .map(
      ([k, v], i) => `
      <button class="copy-card" data-idx="${i}">
        <span class="k">${esc(k)}</span>
        <span class="v">${esc(v)}</span>
      </button>
    `
    )
    .join("");

  grid.querySelectorAll(".copy-card").forEach((b) => {
    b.addEventListener("click", () => {
      const [k, v] = fields[Number(b.dataset.idx)];
      navigator.clipboard.writeText(v || "");
      notifyCopied(k);
    });
  });

  const expList = document.getElementById("sp-exp-list");
  expList.innerHTML = (state.profile?.workExperience || [])
    .map(
      (w, idx) => `
      <div class="exp-block">
        <div style="font-size:12.5px;font-weight:700;">${esc(w.company)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">${esc(w.title)} (${esc(w.startDateDisplay)} - ${esc(w.endDateDisplay)})</div>
        <button class="btn sec sp-exp-copy" data-idx="${idx}" style="width:100%;">📋 Copy All Bullets</button>
      </div>
    `
    )
    .join("");

  expList.querySelectorAll(".sp-exp-copy").forEach((b) => {
    b.addEventListener("click", () => {
      const w = state.profile.workExperience[Number(b.dataset.idx)];
      const txt = (w.highlights || []).map((h) => `• ${h}`).join("\n");
      navigator.clipboard.writeText(txt);
      notifyCopied(`${w.company} bullets`);
    });
  });

  const saList = document.getElementById("sp-sa-list");
  saList.innerHTML = (state.savedAnswers || [])
    .map(
      (sa, idx) => `
      <div class="sa-block">
        <div style="font-size:11.5px;font-weight:700;color:#c7d2fe;margin-bottom:4px;">${esc(sa.questionLabel)}</div>
        <div style="font-size:11.5px;color:#cbd5e1;margin-bottom:6px;">${esc(sa.answer)}</div>
        <button class="btn sec sp-sa-copy" data-idx="${idx}" style="width:100%;">📋 Copy Answer</button>
      </div>
    `
    )
    .join("");

  saList.querySelectorAll(".sp-sa-copy").forEach((b) => {
    b.addEventListener("click", () => {
      const sa = state.savedAnswers[Number(b.dataset.idx)];
      navigator.clipboard.writeText(sa?.answer || "");
      notifyCopied("Saved Answer");
    });
  });
}

async function initSidePanel() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" });
  const state = resp?.state || {};
  renderVaultContent(state);

  if (resp?.autoApplyStatus?.stepLabel) {
    setLiveStatus(resp.autoApplyStatus.stepLabel);
  }

  document.getElementById("sp-hub").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  });

  document.getElementById("sp-full-auto")?.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return setLiveStatus("⚠️ Focus a job tab first.");
    setLiveStatus("🚀 Tailoring resume, filling & auto-submitting...");
    const r = await chrome.runtime
      .sendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: { tabId: tab.id, options: { autoSubmit: true, tailorResume: true } }
      })
      .catch(() => null);
    setLiveStatus(r?.ok ? "🚀 Running on active tab!" : `⚠️ ${r?.error || "Failed"}`);
  });

  document.getElementById("sp-fast-auto")?.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return setLiveStatus("⚠️ Focus a job tab first.");
    setLiveStatus("⚡ Fast filling & auto-submitting...");
    const r = await chrome.runtime
      .sendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: { tabId: tab.id, options: { autoSubmit: true, tailorResume: false } }
      })
      .catch(() => null);
    setLiveStatus(r?.ok ? "⚡ Fast Auto-Apply running!" : `⚠️ ${r?.error || "Failed"}`);
  });

  document.getElementById("sp-fill-only")?.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return setLiveStatus("⚠️ Focus a job tab first.");
    setLiveStatus("⏳ Filling current screen only...");
    const r = await chrome.runtime
      .sendMessage({
        type: "RUN_TAB_AUTOFILL",
        payload: { tabId: tab.id, options: { fillOpenEndedWithAI: true } }
      })
      .catch(() => null);
    setLiveStatus(
      r?.ok && r.filledCount > 0 ? `✍️ Filled ${r.filledCount} field(s) (no submit).` : "⚠️ Expand the application form first."
    );
  });

  chrome.storage?.onChanged?.addListener(async (_changes, area) => {
    if (area !== "local") return;
    const latest = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" }).catch(() => null);
    if (latest?.state) renderVaultContent(latest.state);
    if (latest?.autoApplyStatus?.stepLabel) setLiveStatus(latest.autoApplyStatus.stepLabel);
  });
}

initSidePanel();
