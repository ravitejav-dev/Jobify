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

function renderStats(state) {
  const apps = state?.applications || [];
  document.getElementById("st-saved").textContent = apps.filter((a) => a.status === "Bookmarked").length;
  document.getElementById("st-applied").textContent = apps.filter((a) => a.status === "Applied").length;
  document.getElementById("st-interview").textContent = apps.filter((a) =>
    ["OA / Assessment", "Recruiter Screen", "Technical Interview", "Final Round", "Offer"].includes(a.status)
  ).length;
  document.getElementById("st-tailored").textContent = (state?.tailoredResumes || []).length;
}

function renderLiveBanner(status) {
  const banner = document.getElementById("popup-live-banner");
  const stopBtn = document.getElementById("btn-stop-auto");
  if (!banner) return;
  if (status && (status.running || ["needs_review", "paused_captcha", "paused_otp"].includes(status.stage))) {
    banner.classList.add("active");
    document.getElementById("popup-live-step").textContent = status.stepLabel || "Auto-Apply Running...";
    document.getElementById("popup-live-detail").textContent = status.detail || "";
    if (stopBtn) stopBtn.style.display = status.running ? "inline-block" : "none";
  } else {
    banner.classList.remove("active");
  }
}

async function initPopup() {
  const stateResp = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" });
  const state = stateResp?.state || {};
  renderLiveBanner(stateResp?.autoApplyStatus || null);

  document.getElementById("candidate-line").textContent = `${
    state.profile?.personal?.fullName || "Raviteja Velanati"
  } • Simplify+ AI`;

  renderStats(state);

  const autoSubChk = document.getElementById("chk-auto-submit");
  if (autoSubChk) {
    autoSubChk.checked = state.settings?.autoSubmitEnabled !== false;
    autoSubChk.addEventListener("change", async () => {
      await chrome.runtime.sendMessage({
        type: "UPDATE_SETTINGS",
        payload: {
          settings: {
            autoSubmitEnabled: autoSubChk.checked,
            autopilotMode: autoSubChk.checked ? "full_auto" : "safe_review"
          }
        }
      });
      setStatus(
        autoSubChk.checked
          ? "🎯 Auto-Submit ENABLED — applications submit automatically"
          : "⏸️ Auto-Submit OFF — will pause on final screen for review"
      );
    });
  }

  const modelSel = document.getElementById("sel-model");
  if (state.settings?.primaryModel) modelSel.value = state.settings.primaryModel;
  modelSel.addEventListener("change", async () => {
    await chrome.runtime.sendMessage({
      type: "UPDATE_SETTINGS",
      payload: { settings: { primaryModel: modelSel.value } }
    });
    setStatus(`Switched AI model to ${modelSel.value}`);
  });

  document.getElementById("btn-stop-auto")?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "STOP_FULL_AUTO_APPLY" }).catch(() => null);
    renderLiveBanner(null);
    setStatus("⏹ Stopped Auto-Apply.");
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

  const launchAutoApplyFromPopup = async ({ tailorResume }) => {
    if (!tab?.id) return;
    const shouldSubmit = autoSubChk ? autoSubChk.checked : true;
    setStatus(
      tailorResume
        ? `🚀 Launching Full Auto-Apply (${shouldSubmit ? "Tailor → Fill → Submit" : "Tailor → Fill → Review"})...`
        : `⚡ Fast Fill & ${shouldSubmit ? "Auto-Submit" : "Review"} starting...`
    );
    const resp = await chrome.runtime
      .sendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: {
          tabId: tab.id,
          options: {
            autoSubmit: shouldSubmit,
            tailorResume,
            preferredModel: modelSel.value,
            jobMeta: pageCtx?.pageMeta || null
          }
        }
      })
      .catch(() => null);
    if (resp?.ok) {
      setStatus("🚀 Auto-Apply running! Watch live progress on the job tab.");
      setTimeout(() => window.close(), 750);
    } else {
      setStatus(`⚠️ ${resp?.error || "Open a job posting tab first."}`);
    }
  };

  document.getElementById("btn-full-auto")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    await launchAutoApplyFromPopup({ tailorResume: true });
    e.currentTarget.disabled = false;
  });

  document.getElementById("btn-fast-auto")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    await launchAutoApplyFromPopup({ tailorResume: false });
    e.currentTarget.disabled = false;
  });

  document.getElementById("btn-autofill").addEventListener("click", async (e) => {
    if (!tab?.id) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    setStatus("⏳ Filling current screen only (no submit)...");
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
      setStatus(`✍️ Filled ${resp.filledCount} field(s) (review & submit when ready).`);
    } else if (resp?.ok) {
      setStatus("⚠️ Open/expand the job application form first.");
    } else {
      setStatus("Open a job form tab first.");
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
    renderStats(refreshed?.state || {});
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

  chrome.storage?.onChanged?.addListener(async (_changes, area) => {
    if (area !== "local") return;
    const latest = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" }).catch(() => null);
    if (latest?.state) renderStats(latest.state);
    renderLiveBanner(latest?.autoApplyStatus || null);
  });
}

initPopup();
