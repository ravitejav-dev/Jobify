// Jobify Toolbar Popup Controller
function setStatus(msg) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = "";
  }, 3000);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function initPopup() {
  const stateResp = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" });
  const state = stateResp?.state || {};
  const apps = state.applications || [];

  document.getElementById("candidate-line").textContent = `${
    state.profile?.personal?.fullName || "Raviteja Velanati"
  } • Simplify+ AI`;

  document.getElementById("st-saved").textContent = apps.filter((a) => a.status === "Bookmarked").length;
  document.getElementById("st-applied").textContent = apps.filter((a) => a.status === "Applied").length;
  document.getElementById("st-interview").textContent = apps.filter((a) =>
    ["OA / Assessment", "Recruiter Screen", "Technical Interview", "Final Round", "Offer"].includes(a.status)
  ).length;
  document.getElementById("st-tailored").textContent = (state.tailoredResumes || []).length;

  const modelSel = document.getElementById("sel-model");
  if (state.settings?.primaryModel) modelSel.value = state.settings.primaryModel;
  modelSel.addEventListener("change", async () => {
    await chrome.runtime.sendMessage({
      type: "UPDATE_SETTINGS",
      payload: { settings: { primaryModel: modelSel.value } }
    });
    setStatus(`Switched AI model to ${modelSel.value}`);
  });

  const tab = await getActiveTab();
  let pageCtx = null;
  if (tab?.id && /^(https?:|chrome-extension:)/i.test(tab.url || "")) {
    pageCtx = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" }).catch(() => null);
    if (!pageCtx?.ok && /^https?:/i.test(tab.url || "")) {
      await chrome.runtime.sendMessage({ type: "ENSURE_CONTENT_SCRIPTS", payload: { tabId: tab.id } }).catch(() => null);
      pageCtx = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" }).catch(() => null);
    }
  }

  if (pageCtx?.ok && pageCtx.pageMeta) {
    document.getElementById("page-ats").textContent = pageCtx.pageMeta.ats || "Career Portal";
    document.getElementById("page-title").textContent = pageCtx.pageMeta.title || tab.title || "Job Page";
    document.getElementById("page-company").textContent =
      [pageCtx.pageMeta.company, pageCtx.pageMeta.location].filter(Boolean).join(" • ") || tab.url;
    const sc = pageCtx.analysis?.match?.matchScore;
    document.getElementById("page-score").textContent = sc ? `${sc}% Match` : "Ready";
  } else {
    document.getElementById("page-ats").textContent = "Web Page";
    document.getElementById("page-title").textContent = tab?.title || "Browser Tab";
    document.getElementById("page-company").textContent = "Open any career site or click Hub ↗";
    document.getElementById("page-score").textContent = "Standby";
  }

  document.getElementById("btn-autofill").addEventListener("click", async (e) => {
    if (!tab?.id) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    setStatus("⏳ Autofilling form & attaching PDF...");
    const resp = await chrome.runtime
      .sendMessage({
        type: "RUN_TAB_AUTOFILL",
        payload: {
          tabId: tab.id,
          options: { fillOpenEndedWithAI: true, topJobMeta: pageCtx?.pageMeta || null }
        }
      })
      .catch(() => null);
    btn.disabled = false;
    if (resp?.ok && resp.filledCount > 0) {
      setStatus(`⚡ Autofilled ${resp.filledCount} field(s)!`);
    } else if (resp?.ok) {
      setStatus("⚠️ Open/expand the job application form first.");
    } else {
      setStatus("Open an http/https job form tab first.");
    }
  });

  document.getElementById("btn-open-drawer").addEventListener("click", async () => {
    if (!tab?.id) return;
    if (/^https?:/i.test(tab.url || "")) {
      await chrome.runtime.sendMessage({ type: "ENSURE_CONTENT_SCRIPTS", payload: { tabId: tab.id } }).catch(() => null);
    }
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_COPILOT_DRAWER", payload: { open: true } }).catch(() => {});
    window.close();
  });

  document.getElementById("btn-bookmark").addEventListener("click", async () => {
    if (!tab) return;
    await chrome.runtime.sendMessage({
      type: "UPSERT_APPLICATION",
      payload: {
        application: {
          company: pageCtx?.pageMeta?.company || new URL(tab.url).hostname.replace(/^www\./, ""),
          role: pageCtx?.pageMeta?.title || tab.title,
          location: pageCtx?.pageMeta?.location || "",
          ats: pageCtx?.pageMeta?.ats || "Web",
          url: tab.url,
          status: "Bookmarked",
          matchScore: pageCtx?.analysis?.match?.matchScore || 85
        }
      }
    });
    setStatus("📌 Saved to Jobify Tracker!");
    const refreshed = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" });
    document.getElementById("st-saved").textContent = (refreshed.state.applications || []).filter(
      (a) => a.status === "Bookmarked"
    ).length;
  });

  document.getElementById("btn-reload-ext")?.addEventListener("click", () => {
    chrome.runtime.reload();
  });

  document.getElementById("btn-dashboard").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
    window.close();
  });

  document.getElementById("btn-jobs").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD", payload: { tab: "jobs" } });
    window.close();
  });

  document.getElementById("btn-autopilot").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD", payload: { tab: "autopilot" } });
    window.close();
  });

  document.getElementById("btn-sidepanel").addEventListener("click", async () => {
    if (tab?.windowId && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    } else {
      chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD", payload: { tab: "vault" } });
      window.close();
    }
  });
}

initPopup();
