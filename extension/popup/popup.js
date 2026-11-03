// Jobify Toolbar Popup Controller — Clean Simplify-Style Quick Actions
function setStatus(msg) {
  const el = document.getElementById("status-msg");
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = "";
  }, 3000);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "Career Site";
  }
}

function renderStats(state) {
  const apps = state?.applications || [];
  const savedEl = document.getElementById("st-saved");
  const appliedEl = document.getElementById("st-applied");
  const interviewEl = document.getElementById("st-interview");
  if (savedEl) savedEl.textContent = apps.filter((a) => a.status === "Bookmarked").length;
  if (appliedEl) appliedEl.textContent = apps.filter((a) => a.status === "Applied").length;
  if (interviewEl) {
    interviewEl.textContent = apps.filter((a) =>
      ["OA / Assessment", "Recruiter Screen", "Technical Interview", "Final Round", "Offer"].includes(a.status)
    ).length;
  }
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
  const stateResp = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" }).catch(() => null);
  const state = stateResp?.state || {};
  renderLiveBanner(stateResp?.autoApplyStatus || null);

  const candLine = document.getElementById("candidate-line");
  if (candLine) {
    candLine.textContent = state.profile?.personal?.fullName || "Raviteja Velanati";
  }

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
          ? "🎯 Auto-Submit ON — submits automatically when ready"
          : "⏸️ Auto-Submit OFF — pauses on final screen for review"
      );
    });
  }

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

  const pm = pageCtx?.pageMeta;
  if (pageCtx?.ok && pm && pm.isRelevantPage) {
    document.getElementById("page-ats").textContent = pm.ats || "Career Portal";
    document.getElementById("page-title").textContent = pm.title || tab.title || "Job Posting";
    const compRaw = pm.compensation?.raw || "";
    document.getElementById("page-company").textContent =
      [pm.company, pm.location, compRaw].filter(Boolean).join(" • ") || safeHostname(tab.url);
    const sc = pageCtx.analysis?.match?.matchScore;
    document.getElementById("page-score").textContent =
      pm.pageType === "job_board" ? "Job Board" : sc ? `${sc}% Match` : "Ready";
  } else {
    document.getElementById("page-ats").textContent = "Standby";
    document.getElementById("page-title").textContent = "No Active Job Form Detected";
    document.getElementById("page-company").textContent = "Open any job posting or application to autofill in 1 click";
    document.getElementById("page-score").textContent = "Idle";
  }

  const launchAutoApplyFromPopup = async ({ tailorResume }) => {
    if (!tab?.id) return;
    const shouldSubmit = autoSubChk ? autoSubChk.checked : true;
    setStatus(
      tailorResume
        ? `🚀 Starting ${shouldSubmit ? "Tailor → Fill → Submit" : "Tailor → Fill → Review"}...`
        : `⚡ Starting Fast ${shouldSubmit ? "Apply" : "Fill"}...`
    );
    const resp = await chrome.runtime
      .sendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: {
          tabId: tab.id,
          options: {
            autoSubmit: shouldSubmit,
            tailorResume,
            preferredModel: state.settings?.primaryModel || "gemini-3.5-flash",
            jobMeta: pageCtx?.pageMeta || null
          }
        }
      })
      .catch(() => null);
    if (resp?.ok) {
      setStatus("🚀 Running on active tab!");
      setTimeout(() => window.close(), 650);
    } else {
      setStatus(`⚠️ ${resp?.error || "Open a job posting tab first."}`);
    }
  };

  document.getElementById("btn-full-auto")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    await launchAutoApplyFromPopup({ tailorResume: true });
    btn.disabled = false;
  });

  document.getElementById("btn-fast-auto")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    await launchAutoApplyFromPopup({ tailorResume: false });
    btn.disabled = false;
  });

  document.getElementById("btn-autofill")?.addEventListener("click", async (e) => {
    if (!tab?.id) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    setStatus("⏳ Filling current screen...");
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
      setStatus(`✓ Filled ${resp.filledCount} field(s)`);
    } else if (resp?.ok) {
      setStatus("⚠️ Open the application form first.");
    } else {
      setStatus("Open a job application tab first.");
    }
  });

  document.getElementById("btn-open-drawer")?.addEventListener("click", async () => {
    if (!tab?.id) return;
    if (/^https?:/i.test(tab.url || "")) {
      await chrome.runtime.sendMessage({ type: "ENSURE_CONTENT_SCRIPTS", payload: { tabId: tab.id } }).catch(() => null);
    }
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_COPILOT_DRAWER", payload: { open: true } }).catch(() => {});
    window.close();
  });

  document.getElementById("btn-bookmark")?.addEventListener("click", async (e) => {
    if (!tab?.url) return;
    const btn = e.currentTarget;
    await chrome.runtime.sendMessage({
      type: "UPSERT_APPLICATION",
      payload: {
        application: {
          company: pageCtx?.pageMeta?.company || safeHostname(tab.url),
          role: pageCtx?.pageMeta?.title || tab.title || "Saved Role",
          location: pageCtx?.pageMeta?.location || "",
          ats: pageCtx?.pageMeta?.ats || "Web",
          url: tab.url,
          status: "Bookmarked",
          matchScore: pageCtx?.analysis?.match?.matchScore || 85
        }
      }
    });
    btn.textContent = "✓ Saved";
    setStatus("📌 Saved to Tracker!");
    const refreshed = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" }).catch(() => null);
    renderStats(refreshed?.state || {});
  });

  document.getElementById("stats-strip")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD", payload: { tab: "tracker" } });
    window.close();
  });

  document.getElementById("btn-reload-ext")?.addEventListener("click", () => {
    chrome.runtime.reload();
  });

  document.getElementById("btn-dashboard")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
    window.close();
  });

  document.getElementById("btn-jobs")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD", payload: { tab: "jobs" } });
    window.close();
  });

  document.getElementById("btn-sidepanel")?.addEventListener("click", async () => {
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
