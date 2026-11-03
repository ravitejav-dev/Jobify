function notifyCopied(label) {
  const t = document.getElementById("sp-toast");
  if (!t) return;
  t.textContent = `✓ Copied ${label}`;
  t.style.display = "block";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.display = "none";
  }, 2000);
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

let currentState = {};

function renderVaultContent(state) {
  currentState = state || {};
  const p = state.profile?.personal || {};
  const creds = state.credentials || {};
  const hasPortalPw = Boolean(creds.portalPassword);

  // Tuple format: [label, copyValue, displayValue]
  const fields = [
    ["First Name", p.firstName, p.firstName],
    ["Last Name", p.lastName, p.lastName],
    ["Email", p.email, p.email],
    ["Phone", p.phone, p.phone],
    ["Location", `${p.city}, ${p.stateCode} ${p.postalCode}`, `${p.city}, ${p.stateCode} ${p.postalCode}`],
    ["LinkedIn", p.linkedin, p.linkedin],
    ["GitHub", p.github, p.github],
    ["Portfolio", p.portfolio, p.portfolio],
    ["Portal Email", creds.portalEmail || p.email, creds.portalEmail || p.email],
    ["Portal Password", creds.portalPassword || "", hasPortalPw ? "••••••••••••" : "Set in Hub Vault"],
    ["Desired Salary", state.profile?.workAuthAndEEO?.desiredSalaryDisplay, state.profile?.workAuthAndEEO?.desiredSalaryDisplay],
    ["Summary", state.profile?.summaryShort, state.profile?.summaryShort]
  ];

  const grid = document.getElementById("sp-identity-grid");
  grid.innerHTML = fields
    .map(
      ([k, , displayVal], i) => `
      <button class="copy-card" data-idx="${i}">
        <span class="k">${esc(k)}</span>
        <span class="v">${esc(displayVal)}</span>
      </button>
    `
    )
    .join("");

  grid.querySelectorAll(".copy-card").forEach((b) => {
    b.addEventListener("click", () => {
      const [k, rawVal] = fields[Number(b.dataset.idx)];
      if (!rawVal) {
        setLiveStatus(`⚠️ Set ${k} in Hub Vault first.`);
        return;
      }
      navigator.clipboard.writeText(rawVal);
      notifyCopied(k);
    });
  });

  const expList = document.getElementById("sp-exp-list");
  expList.innerHTML = (state.profile?.workExperience || [])
    .map(
      (w, idx) => `
      <div class="exp-block">
        <div style="font-size:12px;font-weight:800;color:#0f172a;">${esc(w.company)}</div>
        <div style="font-size:10.5px;color:#64748b;margin-bottom:6px;">${esc(w.title)} (${esc(w.startDateDisplay)} – ${esc(w.endDateDisplay)})</div>
        <button class="btn sec sp-exp-copy" data-idx="${idx}" style="width:100%;">📋 Copy Bullets</button>
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
        <div style="font-size:11px;font-weight:800;color:#0f766e;margin-bottom:3px;">${esc(sa.questionLabel)}</div>
        <div style="font-size:11px;color:#334155;margin-bottom:6px;line-height:1.4;">${esc(sa.answer)}</div>
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
  const resp = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" }).catch(() => null);
  const state = resp?.state || {};
  renderVaultContent(state);

  if (resp?.autoApplyStatus?.stepLabel) {
    setLiveStatus(resp.autoApplyStatus.stepLabel);
  }

  document.getElementById("sp-hub")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  });

  document.getElementById("sp-full-auto")?.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return setLiveStatus("⚠️ Focus a job tab first.");
    const autoSub = currentState.settings?.autoSubmitEnabled !== false;
    setLiveStatus(autoSub ? "🚀 Tailoring, filling & auto-submitting..." : "🚀 Tailoring & filling for review...");
    const r = await chrome.runtime
      .sendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: { tabId: tab.id, options: { autoSubmit: autoSub, tailorResume: true } }
      })
      .catch(() => null);
    setLiveStatus(r?.ok ? "🚀 Running on active tab!" : `⚠️ ${r?.error || "Failed"}`);
  });

  document.getElementById("sp-fast-auto")?.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return setLiveStatus("⚠️ Focus a job tab first.");
    const autoSub = currentState.settings?.autoSubmitEnabled !== false;
    setLiveStatus(autoSub ? "⚡ Fast filling & auto-submitting..." : "⚡ Fast filling for review...");
    const r = await chrome.runtime
      .sendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: { tabId: tab.id, options: { autoSubmit: autoSub, tailorResume: false } }
      })
      .catch(() => null);
    setLiveStatus(r?.ok ? "⚡ Fast Apply running!" : `⚠️ ${r?.error || "Failed"}`);
  });

  document.getElementById("sp-fill-only")?.addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return setLiveStatus("⚠️ Focus a job tab first.");
    setLiveStatus("⏳ Filling current screen...");
    const r = await chrome.runtime
      .sendMessage({
        type: "RUN_TAB_AUTOFILL",
        payload: { tabId: tab.id, options: { fillOpenEndedWithAI: true } }
      })
      .catch(() => null);
    setLiveStatus(
      r?.ok && r.filledCount > 0 ? `✓ Filled ${r.filledCount} field(s) (no submit)` : "⚠️ Expand the application form first."
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
