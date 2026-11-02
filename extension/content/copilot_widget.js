// Jobify Shadow-DOM Floating Copilot Drawer, Inline AI Question Sparkles & Auto-Submit Tracker

(() => {
  if (window.__JOBIFY_WIDGET_LOADED__) return;
  window.__JOBIFY_WIDGET_LOADED__ = true;

  // Only mount floating UI in top frame (iframes still get inline autofill support via ats_adapters.js)
  const IS_TOP_FRAME = (() => {
    try {
      return window === window.top;
    } catch (_) {
      return false;
    }
  })();

  let appState = null;
  let pageMeta = null;
  let analysis = null;
  let latestTailoredRecord = null;
  let latestCoverLetterRecord = null;
  let autoApplyStatus = null;
  let shadowRoot = null;
  let hostEl = null;
  let drawerOpen = false;
  let activeTab = "autofill";

  async function safeSendMessage(msg) {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.id) return null;
      return await chrome.runtime.sendMessage(msg);
    } catch (_) {
      return null;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function downloadBase64Pdf(base64, fileName) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function showToast(msg, tone = "info") {
    if (!shadowRoot) return;
    const toast = shadowRoot.getElementById("jb-toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `jb-toast show ${tone}`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.className = "jb-toast";
    }, 3400);
  }

  async function refreshStateAndAnalyze() {
    const adapters = window.__JOBIFY_ADAPTERS__;
    if (!adapters || typeof chrome === "undefined" || !chrome.runtime?.id) return;
    pageMeta = adapters.extractJobMetadata(document);

    const stateResp = await safeSendMessage({ type: "GET_ALL_STATE" });
    if (stateResp?.ok) {
      appState = stateResp.state;
      if (stateResp.autoApplyStatus) autoApplyStatus = stateResp.autoApplyStatus;
    }

    if (pageMeta.isRelevantPage) {
      const anResp = await safeSendMessage({ type: "ANALYZE_JOB_PAGE", payload: { jobMeta: pageMeta } });
      if (anResp?.ok) analysis = anResp;
    }
  }

  function injectInlineAiButtons() {
    const adapters = window.__JOBIFY_ADAPTERS__;
    if (!adapters) return;
    const openFields = adapters.findOpenEndedFields(appState?.profile);
    for (const item of openFields) {
      const el = item.element;
      if (el.previousElementSibling?.classList?.contains("jb-inline-ai-wrap")) continue;

      const wrapper = document.createElement("div");
      wrapper.className = "jb-inline-ai-wrap";
      wrapper.style.cssText = "display:flex;justify-content:flex-end;margin:4px 0 4px 0;font-family:Inter,system-ui,sans-serif;";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "✨ Answer with Jobify AI";
      btn.style.cssText =
        "background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11.5px;font-weight:600;cursor:pointer;box-shadow:0 2px 6px rgba(79,70,229,0.28);";

      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const orig = btn.textContent;
        btn.textContent = "⏳ Drafting with Gemini...";
        btn.disabled = true;
        try {
          const meta = adapters.extractJobMetadata(document);
          const resp = await chrome.runtime.sendMessage({
            type: "ANSWER_APPLICATION_QUESTION",
            payload: {
              questionCtx: {
                label: item.label,
                fieldType: item.fieldType,
                maxLength: item.maxLength
              },
              jobMeta: meta,
              forceAi: true,
              saveToVault: true
            }
          });
          if (resp?.ok && resp.answer) {
            adapters.setNativeValue(el, resp.answer);
            btn.textContent = `✅ Filled (${resp.modelUsed || "Vault"})`;
          } else {
            btn.textContent = "⚠️ Retry AI";
          }
        } catch (_) {
          btn.textContent = "⚠️ Error";
        } finally {
          btn.disabled = false;
          setTimeout(() => {
            btn.textContent = orig;
          }, 2600);
        }
      });

      el.insertAdjacentElement("beforebegin", wrapper);
      wrapper.appendChild(btn);

      // Learn custom user-typed answers automatically on blur
      el.addEventListener("change", () => {
        const val = (el.value || "").trim();
        if (val.length >= 25 && item.label.length >= 6) {
          chrome.runtime.sendMessage({
            type: "UPSERT_SAVED_ANSWER",
            payload: {
              entry: {
                questionLabel: item.label,
                answer: val,
                tags: ["auto-saved"]
              }
            }
          }).catch(() => {});
        }
      });
    }
  }

  function attachSubmitAutoTracker() {
    const logManualSubmitIfConfirmed = () => {
      setTimeout(() => {
        if (!appState?.settings?.autoSaveSubmittedJobs) return;
        if (autoApplyStatus?.running) return;
        const adapters = window.__JOBIFY_ADAPTERS__;
        if (!adapters) return;
        const meta = adapters.extractJobMetadata(document);
        if (!meta?.isRelevantPage) return;
        const hasErrors = adapters.detectFormValidationErrors?.(document)?.hasErrors;
        if (hasErrors) return;
        const confirmed =
          adapters.detectSubmissionConfirmation?.(document) ||
          !adapters.findWizardButtons?.()?.submitBtn;
        if (!confirmed) return;
        chrome.runtime
          .sendMessage({
            type: "UPSERT_APPLICATION",
            payload: {
              application: {
                company: meta.company,
                role: meta.title,
                location: meta.location,
                ats: meta.ats,
                url: meta.url,
                status: "Applied",
                matchScore: analysis?.match?.matchScore || 88,
                resumeUsed:
                  latestTailoredRecord?.fileName ||
                  (appState?.settings?.defaultResumeVariant === "master"
                    ? "Raviteja_Velanati_Master_Resume.pdf"
                    : "Raviteja_Velanati_Resume_1Page.pdf")
              }
            }
          })
          .catch(() => {});
      }, 1800);
    };

    document.addEventListener("submit", logManualSubmitIfConfirmed, true);
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(
          ".ashby-application-form-submit-button, #submit_app, #btn-submit, [data-jobify-submit], button[type='submit']"
        );
        if (btn) logManualSubmitIfConfirmed();
      },
      true
    );
  }

  async function executeLocalAutofill(options = {}) {
    const adapters = window.__JOBIFY_ADAPTERS__;
    if (!adapters) return { filledCount: 0, filledFieldsLog: [] };

    await refreshStateAndAnalyze();
    if (!appState?.profile) return { filledCount: 0, filledFieldsLog: [] };

    const selectedResumeId =
      options.resumeChoice ||
      shadowRoot?.getElementById("jb-resume-select")?.value ||
      (latestTailoredRecord ? latestTailoredRecord.id : appState?.settings?.defaultResumeVariant || "one_page");

    let resumePdfPayload = null;
    if (appState?.settings?.autoAttachResumePdf !== false) {
      const pdfResp = await safeSendMessage({ type: "GET_RESUME_PDF_BYTES", payload: { variantOrId: selectedResumeId } });
      if (pdfResp?.ok) resumePdfPayload = pdfResp;
    }

    const coverLetterPayload = latestCoverLetterRecord?.pdfBase64
      ? { fileName: latestCoverLetterRecord.fileName, base64: latestCoverLetterRecord.pdfBase64 }
      : null;

    return await adapters.runFullAutofill({
      profile: appState.profile,
      credentials: appState.credentials,
      savedAnswers: appState.savedAnswers || [],
      resumePdfPayload,
      coverLetterPdfPayload: coverLetterPayload,
      coverLetterText: latestCoverLetterRecord?.coverLetter || "",
      fillOpenEndedWithAI: options.fillOpenEndedWithAI !== false,
      forceOverwrite: Boolean(options.forceOverwrite),
      onProgress: options.onProgress || null,
      jobMeta: pageMeta
    });
  }

  async function executeAutofillFromUI(options = {}) {
    await refreshStateAndAnalyze();
    const selectedResumeId =
      options.resumeChoice ||
      shadowRoot?.getElementById("jb-resume-select")?.value ||
      (latestTailoredRecord ? latestTailoredRecord.id : appState?.settings?.defaultResumeVariant || "one_page");

    let result;
    if (location.protocol === "chrome-extension:") {
      result = await executeLocalAutofill({
        ...options,
        resumeChoice: selectedResumeId,
        onProgress: (msg) => {
          if (options.buttonEl) options.buttonEl.textContent = msg;
          showToast(msg, "info");
        }
      });
    } else {
      // Coordinate across top document AND any cross-origin embedded ATS iframes (Greenhouse, Ashby, Lever, Workday)
      const tabResp = await safeSendMessage({
        type: "RUN_TAB_AUTOFILL",
        payload: {
          options: {
            resumeChoice: selectedResumeId,
            fillOpenEndedWithAI: options.fillOpenEndedWithAI !== false,
            forceOverwrite: Boolean(options.forceOverwrite),
            topJobMeta: pageMeta,
            coverLetterText: latestCoverLetterRecord?.coverLetter || "",
            coverLetterPdfPayload: latestCoverLetterRecord?.pdfBase64
              ? { fileName: latestCoverLetterRecord.fileName, base64: latestCoverLetterRecord.pdfBase64 }
              : null
          }
        }
      });

      result = tabResp?.ok ? tabResp : await executeLocalAutofill({ ...options, resumeChoice: selectedResumeId });
    }

    injectInlineAiButtons();
    if ((result?.filledCount || 0) > 0) {
      showToast(`⚡ Autofilled ${result.filledCount} field(s) successfully!`, "success");
    } else {
      showToast(
        "No empty form fields found yet — scroll to or open the application form and click Autofill again.",
        "warn"
      );
    }
    return result;
  }

  function mountWidget() {
    if (!IS_TOP_FRAME) return;
    const existing = document.getElementById("jobify-copilot-host");
    if (existing) {
      if (existing === hostEl) return;
      existing.remove();
    }
    if (hostEl && shadowRoot) {
      (document.documentElement || document.body)?.appendChild(hostEl);
      renderDrawer();
      return;
    }

    const host = document.createElement("div");
    host.id = "jobify-copilot-host";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483646;top:0;right:0;width:0;height:0;";
    (document.documentElement || document.body)?.appendChild(host);
    hostEl = host;
    shadowRoot = host.attachShadow({ mode: "open" });

    const score = analysis?.match?.matchScore || 90;
    shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .jb-pill-bar {
          position: fixed; right: 16px; bottom: 24px;
          display: flex; align-items: center; gap: 7px;
          z-index: 2147483646;
        }
        .jb-pill-quick {
          background: linear-gradient(135deg, #059669 0%, #0284c7 100%);
          color: #fff; border: 1px solid rgba(255,255,255,0.28);
          border-radius: 999px; padding: 9px 13px;
          font-size: 12px; font-weight: 800; cursor: pointer;
          box-shadow: 0 10px 26px rgba(5, 150, 105, 0.42);
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .jb-pill-quick:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(5, 150, 105, 0.58); }
        .jb-pill {
          display: flex; align-items: center; gap: 8px;
          background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
          color: #fff; border: 1px solid rgba(255,255,255,0.22);
          border-radius: 999px; padding: 9px 15px;
          box-shadow: 0 10px 28px rgba(79, 70, 229, 0.42);
          cursor: pointer; user-select: none;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .jb-pill:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(79, 70, 229, 0.55); }
        .jb-pill-logo { font-weight: 800; font-size: 13.5px; letter-spacing: -0.2px; }
        .jb-pill-score {
          background: rgba(16, 185, 129, 0.25); border: 1px solid rgba(16, 185, 129, 0.65);
          color: #d1fae5; font-size: 11.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px;
        }
        .jb-drawer {
          position: fixed; top: 12px; right: 12px; bottom: 12px; width: 392px;
          background: #0f172a; color: #f8fafc;
          border: 1px solid #334155; border-radius: 16px;
          box-shadow: 0 24px 60px rgba(2, 6, 23, 0.72);
          display: none; flex-direction: column; overflow: hidden;
          z-index: 2147483647;
        }
        .jb-drawer.open { display: flex; }
        .jb-header {
          padding: 13px 15px;
          background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);
          border-bottom: 1px solid #334155;
          display: flex; align-items: center; justify-content: space-between;
        }
        .jb-brand { display: flex; align-items: center; gap: 8px; }
        .jb-brand-badge {
          width: 28px; height: 28px; border-radius: 8px;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          display: flex; align-items: center; justify-content: center;
          font-weight: 900; font-size: 15px; color: #fff;
        }
        .jb-brand-title { font-weight: 800; font-size: 15px; color: #fff; }
        .jb-brand-sub { font-size: 11px; color: #a5b4fc; }
        .jb-hdr-actions { display: flex; gap: 6px; }
        .jb-icon-btn {
          background: rgba(255,255,255,0.1); color: #e2e8f0; border: none;
          border-radius: 7px; padding: 5px 8px; font-size: 12px; cursor: pointer;
        }
        .jb-icon-btn:hover { background: rgba(255,255,255,0.2); }
        .jb-tabs {
          display: grid; grid-template-columns: repeat(5, 1fr);
          background: #1e293b; border-bottom: 1px solid #334155;
        }
        .jb-tab {
          background: transparent; border: none; color: #94a3b8;
          padding: 9px 4px; font-size: 11px; font-weight: 600; cursor: pointer;
          border-bottom: 2px solid transparent;
        }
        .jb-tab.active { color: #818cf8; border-bottom-color: #818cf8; background: rgba(99,102,241,0.08); }
        .jb-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
        .jb-card {
          background: #1e293b; border: 1px solid #334155; border-radius: 11px; padding: 12px;
        }
        .jb-job-title { font-size: 14px; font-weight: 700; color: #f8fafc; margin-bottom: 4px; }
        .jb-job-meta { font-size: 12px; color: #94a3b8; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .jb-chip {
          display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
          font-size: 11px; font-weight: 600;
        }
        .jb-chip.ats { background: rgba(99,102,241,0.2); color: #a5b4fc; }
        .jb-chip.green { background: rgba(16,185,129,0.18); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.35); margin: 2px; }
        .jb-chip.amber { background: rgba(245,158,11,0.18); color: #fcd34d; border: 1px solid rgba(245,158,11,0.35); margin: 2px; }
        .jb-chip.red { background: rgba(239,68,68,0.18); color: #fca5a5; border: 1px solid rgba(239,68,68,0.35); }
        .jb-btn {
          width: 100%; border: none; border-radius: 9px; padding: 10px 12px;
          font-size: 13px; font-weight: 700; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 7px;
          transition: opacity 0.15s ease, transform 0.1s ease;
        }
        .jb-btn:active { transform: scale(0.99); }
        .jb-btn:disabled { opacity: 0.55; cursor: wait; }
        .jb-btn.primary { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,0.38); }
        .jb-btn.secondary { background: #334155; color: #f1f5f9; font-weight: 600; font-size: 12px; padding: 8px 10px; }
        .jb-btn.emerald { background: linear-gradient(135deg, #059669, #10b981); color: #fff; }
        .jb-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .jb-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 5px; display: block; }
        .jb-select, .jb-input, .jb-textarea {
          width: 100%; background: #0f172a; color: #f8fafc; border: 1px solid #475569;
          border-radius: 8px; padding: 7px 9px; font-size: 12px;
        }
        .jb-textarea { min-height: 110px; resize: vertical; line-height: 1.45; }
        .jb-copy-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .jb-copy-item {
          background: #0f172a; border: 1px solid #334155; border-radius: 8px;
          padding: 7px 9px; cursor: pointer; text-align: left; color: #e2e8f0;
        }
        .jb-copy-item:hover { border-color: #6366f1; background: #172036; }
        .jb-copy-k { font-size: 10px; color: #94a3b8; display: block; }
        .jb-copy-v { font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
        .jb-score-row { display: flex; align-items: center; gap: 12px; }
        .jb-score-circle {
          width: 60px; height: 60px; border-radius: 50%;
          background: rgba(16,185,129,0.14); border: 3px solid #10b981;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .jb-score-num { font-size: 18px; font-weight: 800; color: #34d399; line-height: 1; }
        .jb-score-lbl { font-size: 9px; color: #94a3b8; margin-top: 2px; }
        .jb-toast {
          position: absolute; bottom: 14px; left: 14px; right: 14px;
          background: #1e293b; border: 1px solid #6366f1; color: #f8fafc;
          padding: 9px 12px; border-radius: 9px; font-size: 12px; font-weight: 600;
          box-shadow: 0 8px 24px rgba(0,0,0,0.45);
          opacity: 0; pointer-events: none; transition: opacity 0.2s ease;
        }
        .jb-toast.show { opacity: 1; }
        .jb-toast.success { border-color: #10b981; color: #a7f3d0; }
        .jb-toast.warn { border-color: #f59e0b; color: #fde68a; }
        .jb-ref-link {
          display: block; text-decoration: none; background: #0f172a; border: 1px solid #334155;
          border-radius: 8px; padding: 9px 10px; margin-bottom: 7px; color: #e2e8f0;
        }
        .jb-ref-link:hover { border-color: #818cf8; }
        .jb-btn.auto-hero {
          background: linear-gradient(135deg, #059669 0%, #0284c7 100%);
          color: #fff; box-shadow: 0 4px 16px rgba(5, 150, 105, 0.42);
        }
        .jb-hud {
          position: fixed; right: 16px; bottom: 72px; width: 320px;
          background: rgba(15, 23, 42, 0.96); color: #f8fafc;
          border: 1px solid #10b981; border-radius: 12px;
          padding: 10px 12px; box-shadow: 0 14px 34px rgba(2, 6, 23, 0.65);
          display: none; flex-direction: column; gap: 5px;
          z-index: 2147483646;
        }
        .jb-hud.visible { display: flex; }
        .jb-hud-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .jb-hud-title { font-size: 12px; font-weight: 800; color: #6ee7b7; }
        .jb-hud-detail { font-size: 11px; color: #cbd5e1; line-height: 1.35; }
        .jb-hud-stop {
          background: #ef4444; color: #fff; border: none; border-radius: 6px;
          padding: 3px 8px; font-size: 10.5px; font-weight: 700; cursor: pointer; flex-shrink: 0;
        }
      </style>

      <div class="jb-hud" id="jb-hud">
        <div class="jb-hud-top">
          <span class="jb-hud-title" id="jb-hud-title">🚀 Full Auto-Apply Running...</span>
          <button class="jb-hud-stop" id="jb-hud-stop">⏹ Stop</button>
        </div>
        <div class="jb-hud-detail" id="jb-hud-detail">Initializing...</div>
      </div>

      <div class="jb-pill-bar">
        <button class="jb-pill-quick" id="jb-pill-tailor-apply" title="Tailor Resume & Auto-Apply End-to-End">
          🚀 Tailor &amp; Apply
        </button>
        <div class="jb-pill" id="jb-pill" title="Open Jobify Copilot">
          <span class="jb-pill-logo">⚡ Jobify</span>
          <span class="jb-pill-score" id="jb-pill-score">${score}% Match</span>
        </div>
      </div>

      <div class="jb-drawer" id="jb-drawer">
        <div class="jb-header">
          <div class="jb-brand">
            <div class="jb-brand-badge">J</div>
            <div>
              <div class="jb-brand-title">Jobify Copilot</div>
              <div class="jb-brand-sub">Simplify+ AI Suite • Raviteja Velanati</div>
            </div>
          </div>
          <div class="jb-hdr-actions">
            <button class="jb-icon-btn" id="jb-reload-ext" title="Reload Extension after git pull">↻</button>
            <button class="jb-icon-btn" id="jb-open-dash" title="Open Full Jobify Dashboard">Dashboard ↗</button>
            <button class="jb-icon-btn" id="jb-close-drawer" title="Minimize">✕</button>
          </div>
        </div>

        <div class="jb-tabs">
          <button class="jb-tab active" data-tab="autofill">⚡ Autofill</button>
          <button class="jb-tab" data-tab="keywords">🎯 Keywords</button>
          <button class="jb-tab" data-tab="ai">✨ AI Studio</button>
          <button class="jb-tab" data-tab="copy">📋 Copy</button>
          <button class="jb-tab" data-tab="network">🤝 Referrals</button>
        </div>

        <div class="jb-body" id="jb-body"></div>
        <div class="jb-toast" id="jb-toast"></div>
      </div>
    `;

    shadowRoot.getElementById("jb-pill").addEventListener("click", () => {
      drawerOpen = true;
      renderDrawer();
    });
    shadowRoot.getElementById("jb-pill-tailor-apply").addEventListener("click", async (e) => {
      e.stopPropagation();
      await refreshStateAndAnalyze();
      drawerOpen = false;
      renderDrawer();
      await safeSendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: {
          options: {
            autoSubmit: appState?.settings?.autoSubmitEnabled !== false,
            tailorResume: true,
            jobMeta: pageMeta
          }
        }
      });
    });
    shadowRoot.getElementById("jb-hud-stop").addEventListener("click", async () => {
      await safeSendMessage({ type: "STOP_FULL_AUTO_APPLY" });
      if (autoApplyStatus) autoApplyStatus.running = false;
      renderAutoApplyHud();
      showToast("⏹ Stopped Full Auto-Apply.", "warn");
    });
    shadowRoot.getElementById("jb-close-drawer").addEventListener("click", () => {
      drawerOpen = false;
      shadowRoot.getElementById("jb-drawer").classList.remove("open");
    });
    shadowRoot.getElementById("jb-reload-ext").addEventListener("click", () => {
      showToast("↻ Reloading Jobify Extension...", "info");
      chrome.runtime.sendMessage({ type: "RELOAD_EXTENSION" });
    });
    shadowRoot.getElementById("jb-open-dash").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
    });
    shadowRoot.querySelectorAll(".jb-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        shadowRoot.querySelectorAll(".jb-tab").forEach((b) => b.classList.toggle("active", b === btn));
        renderTabContent();
      });
    });

    renderAutoApplyHud();
    renderDrawer();
  }

  function renderAutoApplyHud() {
    if (!shadowRoot) return;
    const hud = shadowRoot.getElementById("jb-hud");
    const titleEl = shadowRoot.getElementById("jb-hud-title");
    const detailEl = shadowRoot.getElementById("jb-hud-detail");
    const stopBtn = shadowRoot.getElementById("jb-hud-stop");
    if (!hud) return;

    const isPausedOrAttention =
      autoApplyStatus &&
      !autoApplyStatus.running &&
      (autoApplyStatus.stage === "needs_review" ||
        autoApplyStatus.stage === "paused_captcha" ||
        autoApplyStatus.stage === "paused_otp");

    const isRecentDone =
      autoApplyStatus &&
      !autoApplyStatus.running &&
      (autoApplyStatus.completed || autoApplyStatus.error || isPausedOrAttention) &&
      Date.now() - (autoApplyStatus.updatedAt || 0) < (isPausedOrAttention ? 22000 : 12000);

    if (autoApplyStatus?.running || isRecentDone) {
      hud.classList.add("visible");
      titleEl.textContent = autoApplyStatus.stepLabel || "🚀 Full Auto-Apply";
      detailEl.textContent = autoApplyStatus.detail || "";
      stopBtn.style.display = autoApplyStatus.running ? "inline-block" : "none";
      hud.style.borderColor =
        autoApplyStatus.error || isPausedOrAttention ? "#f59e0b" : "#10b981";
    } else {
      hud.classList.remove("visible");
    }
  }

  function renderDrawer() {
    if (!shadowRoot) return;
    const pillScore = shadowRoot.getElementById("jb-pill-score");
    if (pillScore && analysis?.match?.matchScore) {
      pillScore.textContent = `${analysis.match.matchScore}% Match`;
    }
    renderAutoApplyHud();
    const drawer = shadowRoot.getElementById("jb-drawer");
    if (drawerOpen) {
      drawer.classList.add("open");
      renderTabContent();
    } else {
      drawer.classList.remove("open");
    }
  }

  function renderTabContent() {
    const body = shadowRoot?.getElementById("jb-body");
    if (!body || !appState) return;
    const p = appState.profile.personal || {};
    const creds = appState.credentials || {};
    const matchScore = analysis?.match?.matchScore || 88;
    const atsTotal = latestTailoredRecord?.atsScore || analysis?.atsScore?.totalScore || 86;
    const kw = analysis?.atsScore?.keywords || { matched: [], missing: [], keywordCoveragePct: 80 };
    const dealbreakers = analysis?.match?.dealbreakers || [];

    if (activeTab === "autofill") {
      const tailoredOpts = (appState.tailoredResumes || [])
        .slice(0, 5)
        .map(
          (tr) =>
            `<option value="${escapeHtml(tr.id)}" ${latestTailoredRecord?.id === tr.id ? "selected" : ""}>✨ Tailored: ${escapeHtml(tr.company)} (${tr.atsScore || 94}%)</option>`
        )
        .join("");

      const jdCompBadge = pageMeta?.compensation?.raw
        ? `<div style="margin-top:6px;"><span class="jb-chip green">💰 JD Salary Detected: ${escapeHtml(pageMeta.compensation.raw)}</span></div>`
        : "";
      const autoSubOn = appState.settings?.autoSubmitEnabled !== false;

      body.innerHTML = `
        <div class="jb-card">
          <div class="jb-job-title">${escapeHtml(pageMeta?.title || document.title)}</div>
          <div class="jb-job-meta">
            <span class="jb-chip ats">${escapeHtml(pageMeta?.ats || "Career Portal")}</span>
            <span>${escapeHtml(pageMeta?.company || "")}</span>
            ${pageMeta?.location ? `<span>• ${escapeHtml(pageMeta.location)}</span>` : ""}
          </div>
          ${jdCompBadge}
          ${dealbreakers
            .map((d) => `<div style="margin-top:8px;"><span class="jb-chip red">⚠️ ${escapeHtml(d)}</span></div>`)
            .join("")}
        </div>

        <div class="jb-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding:6px 8px;background:#0f172a;border:1px solid #334155;border-radius:8px;font-size:11.5px;">
            <span style="color:#e2e8f0;font-weight:600;">🎯 Auto-Submit When Ready</span>
            <input type="checkbox" id="jb-auto-submit-toggle" ${autoSubOn ? "checked" : ""} style="accent-color:#10b981;width:16px;height:16px;cursor:pointer;" />
          </div>

          <button class="jb-btn auto-hero" id="jb-btn-full-auto" style="margin-bottom:8px;">
            ${autoApplyStatus?.running ? "⏳ Auto-Apply Running... (Click to Stop)" : `🚀 Full Auto-Apply (Tailor → Login → Fill${autoSubOn ? " → Submit" : ""})`}
          </button>

          <button class="jb-btn primary" id="jb-btn-fast-auto" style="margin-bottom:10px;">
            ⚡ Fast Fill &amp; Auto-Submit (Default PDF)
          </button>

          <label class="jb-label">Resume PDF to Auto-Attach</label>
          <select class="jb-select" id="jb-resume-select" style="margin-bottom:8px;">
            ${tailoredOpts}
            <option value="one_page" ${!latestTailoredRecord && appState.settings.defaultResumeVariant === "one_page" ? "selected" : ""}>Raviteja_Velanati_Resume_1Page.pdf (1-Page Default)</option>
            <option value="master" ${!latestTailoredRecord && appState.settings.defaultResumeVariant === "master" ? "selected" : ""}>Raviteja_Velanati_Master_Resume.pdf (2-Page Master)</option>
          </select>

          <button class="jb-btn secondary" id="jb-btn-autofill">
            ✍️ Fill Current Screen Only (No Submit)
          </button>

          <div class="jb-row" style="margin-top:8px;">
            <button class="jb-btn secondary" id="jb-btn-auth">🔐 Fill Portal Login</button>
            <button class="jb-btn secondary" id="jb-btn-ai-q">✨ AI Open Questions</button>
          </div>
        </div>

        <div class="jb-card">
          <label class="jb-label">All-in-One Job Tracker & Autopilot</label>
          <div class="jb-row">
            <button class="jb-btn secondary" id="jb-btn-bookmark">📌 Bookmark Job</button>
            <button class="jb-btn emerald" id="jb-btn-applied">✅ Log as Applied</button>
          </div>
          <button class="jb-btn secondary" id="jb-btn-autopilot" style="margin-top:8px;">
            🤖 Add Page to Autopilot Queue
          </button>
        </div>

        <div class="jb-card" style="font-size:11.5px;color:#94a3b8;">
          <strong style="color:#e2e8f0;">Active Portal Account Vault:</strong><br/>
          ${escapeHtml(creds.portalEmail)} • Login + Verify Password + Email OTP Ready
        </div>
      `;

      body.querySelector("#jb-auto-submit-toggle").addEventListener("change", async (e) => {
        const enabled = Boolean(e.target.checked);
        appState.settings.autoSubmitEnabled = enabled;
        await safeSendMessage({
          type: "UPDATE_SETTINGS",
          payload: { settings: { autoSubmitEnabled: enabled } }
        });
        renderTabContent();
        showToast(enabled ? "🎯 Auto-Submit enabled!" : "⏸️ Review-Before-Submit mode enabled.", "info");
      });

      body.querySelector("#jb-btn-full-auto").addEventListener("click", async () => {
        if (autoApplyStatus?.running) {
          await safeSendMessage({ type: "STOP_FULL_AUTO_APPLY" });
          autoApplyStatus.running = false;
          renderDrawer();
          showToast("⏹ Stopped Full Auto-Apply.", "warn");
          return;
        }
        drawerOpen = false;
        renderDrawer();
        await safeSendMessage({
          type: "START_FULL_AUTO_APPLY",
          payload: {
            options: {
              autoSubmit: appState.settings?.autoSubmitEnabled !== false,
              tailorResume: true,
              jobMeta: pageMeta
            }
          }
        });
      });

      body.querySelector("#jb-btn-fast-auto").addEventListener("click", async () => {
        drawerOpen = false;
        renderDrawer();
        await safeSendMessage({
          type: "START_FULL_AUTO_APPLY",
          payload: {
            options: {
              autoSubmit: true,
              tailorResume: false,
              jobMeta: pageMeta
            }
          }
        });
      });

      body.querySelector("#jb-btn-autofill").addEventListener("click", async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = "⏳ Autofilling fields & attaching PDF...";
        try {
          await executeAutofillFromUI({ fillOpenEndedWithAI: true, buttonEl: b });
        } finally {
          b.disabled = false;
          b.textContent = "✍️ Fill Current Screen Only (No Submit)";
        }
      });

      body.querySelector("#jb-btn-auth").addEventListener("click", async () => {
        const res = await window.__JOBIFY_ADAPTERS__.autofillPortalAuth(appState.credentials);
        showToast(
          res.filled > 0
            ? `🔐 Filled ${res.filled} login/signup field(s) for ${creds.portalEmail}`
            : "No password/login fields detected on this screen.",
          res.filled > 0 ? "success" : "warn"
        );
      });

      body.querySelector("#jb-btn-ai-q").addEventListener("click", async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = "⏳ Answering...";
        try {
          await executeAutofillFromUI({ fillOpenEndedWithAI: true, buttonEl: b });
        } finally {
          b.disabled = false;
          b.textContent = "✨ AI Open Questions";
        }
      });

      body.querySelector("#jb-btn-bookmark").addEventListener("click", async () => {
        await chrome.runtime.sendMessage({
          type: "UPSERT_APPLICATION",
          payload: {
            application: {
              company: pageMeta?.company,
              role: pageMeta?.title,
              location: pageMeta?.location,
              ats: pageMeta?.ats,
              url: location.href,
              status: "Bookmarked",
              matchScore
            }
          }
        });
        showToast("📌 Saved to Jobify Tracker!", "success");
      });

      body.querySelector("#jb-btn-applied").addEventListener("click", async () => {
        await chrome.runtime.sendMessage({
          type: "UPSERT_APPLICATION",
          payload: {
            application: {
              company: pageMeta?.company,
              role: pageMeta?.title,
              location: pageMeta?.location,
              ats: pageMeta?.ats,
              url: location.href,
              status: "Applied",
              matchScore
            }
          }
        });
        showToast("✅ Logged as Applied in Jobify Tracker!", "success");
      });

      body.querySelector("#jb-btn-autopilot").addEventListener("click", async () => {
        await chrome.runtime.sendMessage({
          type: "ENQUEUE_AUTOPILOT",
          payload: {
            job: {
              company: pageMeta?.company,
              title: pageMeta?.title,
              location: pageMeta?.location,
              ats: pageMeta?.ats,
              url: location.href,
              matchScore
            }
          }
        });
        showToast("🤖 Added to Autopilot Queue!", "success");
      });
      return;
    }

    if (activeTab === "keywords") {
      const bd = analysis?.atsScore?.breakdown || {};
      body.innerHTML = `
        <div class="jb-card">
          <div class="jb-score-row">
            <div class="jb-score-circle">
              <span class="jb-score-num">${atsTotal}</span>
              <span class="jb-score-lbl">ATS SCORE</span>
            </div>
            <div>
              <div style="font-size:13.5px;font-weight:700;">Resume Readability & Match</div>
              <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;">
                Keywords: ${bd.keywordAlignment?.score ?? 28}/35 • Impact: ${bd.quantifiedImpact?.score ?? 19}/20 • Format: ${bd.atsParseability?.score ?? 15}/15
              </div>
            </div>
          </div>
        </div>

        <div class="jb-card">
          <label class="jb-label">Missing JD Keywords (${kw.missing.length})</label>
          <div>
            ${
              kw.missing.length > 0
                ? kw.missing
                    .map((m) => `<span class="jb-chip amber">+ ${escapeHtml(m.keyword)} (${m.mentions}x)</span>`)
                    .join("")
                : `<span style="font-size:12px;color:#6ee7b7;">🎉 Zero missing keywords detected!</span>`
            }
          </div>
          <button class="jb-btn auto-hero" id="jb-kw-tailor" style="margin-top:10px;">
            🚀 Tailor Resume &amp; Auto-Apply End-to-End
          </button>
        </div>

        <div class="jb-card">
          <label class="jb-label">Matched Resume Keywords (${kw.matched.length})</label>
          <div>
            ${kw.matched
              .map((m) => `<span class="jb-chip green">✓ ${escapeHtml(m.keyword)}</span>`)
              .join("")}
          </div>
        </div>
      `;
      body.querySelector("#jb-kw-tailor").addEventListener("click", async () => {
        drawerOpen = false;
        renderDrawer();
        await safeSendMessage({
          type: "START_FULL_AUTO_APPLY",
          payload: {
            options: {
              autoSubmit: true,
              tailorResume: true,
              jobMeta: pageMeta
            }
          }
        });
      });
      return;
    }

    if (activeTab === "ai") {
      body.innerHTML = `
        <div class="jb-card">
          <label class="jb-label">Gemini AI Model</label>
          <select class="jb-select" id="jb-ai-model" style="margin-bottom:10px;">
            <option value="gemini-3.8-flash" ${appState.settings.primaryModel === "gemini-3.8-flash" ? "selected" : ""}>Gemini 3.8 Flash (Fast Tailoring)</option>
            <option value="gemini-3.1-pro-preview" ${appState.settings.primaryModel === "gemini-3.1-pro-preview" ? "selected" : ""}>Gemini 3.1 Pro (Deep Reasoning)</option>
          </select>

          <button class="jb-btn auto-hero" id="jb-run-tailor">
            🚀 Tailor Resume &amp; Auto-Apply End-to-End
          </button>
          <button class="jb-btn secondary" id="jb-run-tailor-only" style="margin-top:8px;">
            📄 Tailor &amp; Download PDF Only
          </button>

          ${
            latestTailoredRecord
              ? `
            <div style="margin-top:10px;padding:9px;background:#0f172a;border:1px solid #334155;border-radius:8px;font-size:11.5px;">
              <div style="color:#6ee7b7;font-weight:700;margin-bottom:4px;">
                ✅ Tailored (${escapeHtml(latestTailoredRecord.modelUsed)}) • New ATS Score: ${latestTailoredRecord.atsScore}/100
              </div>
              <div style="color:#cbd5e1;margin-bottom:6px;">${escapeHtml(latestTailoredRecord.tailored?.summary || "")}</div>
              <div class="jb-row">
                <button class="jb-btn secondary" id="jb-dl-resume">⬇ Download PDF</button>
                <button class="jb-btn emerald" id="jb-attach-resume">📎 Attach to Form</button>
              </div>
            </div>
          `
              : ""
          }
        </div>

        <div class="jb-card">
          <label class="jb-label">AI Cover Letter Generator</label>
          <select class="jb-select" id="jb-cl-tone" style="margin-bottom:8px;">
            <option value="Concise & Technical">Concise & Technical (Recommended)</option>
            <option value="High-Impact Builder">High-Impact Startup Builder</option>
            <option value="Research & Safety Rigor">AI Safety & Evaluation Rigor</option>
          </select>
          <button class="jb-btn secondary" id="jb-run-cl">📝 Generate Tailored Cover Letter</button>
          ${
            latestCoverLetterRecord
              ? `
            <textarea class="jb-textarea" id="jb-cl-text" style="margin-top:8px;">${escapeHtml(latestCoverLetterRecord.coverLetter)}</textarea>
            <div class="jb-row" style="margin-top:6px;">
              <button class="jb-btn secondary" id="jb-copy-cl">📋 Copy Text</button>
              <button class="jb-btn secondary" id="jb-dl-cl">⬇ Download PDF</button>
            </div>
          `
              : ""
          }
        </div>
      `;

      body.querySelector("#jb-run-tailor").addEventListener("click", async () => {
        const chosenModel = body.querySelector("#jb-ai-model").value;
        drawerOpen = false;
        renderDrawer();
        await safeSendMessage({
          type: "START_FULL_AUTO_APPLY",
          payload: {
            options: {
              autoSubmit: true,
              tailorResume: true,
              preferredModel: chosenModel,
              jobMeta: pageMeta
            }
          }
        });
      });

      body.querySelector("#jb-run-tailor-only").addEventListener("click", async (e) => {
        const b = e.currentTarget;
        const chosenModel = body.querySelector("#jb-ai-model").value;
        b.disabled = true;
        b.textContent = "⏳ Tailoring with Gemini & compiling PDF...";
        const resp = await chrome.runtime.sendMessage({
          type: "TAILOR_RESUME",
          payload: { jobMeta: pageMeta, preferredModel: chosenModel }
        });
        b.disabled = false;
        if (resp?.ok) {
          latestTailoredRecord = resp.record;
          await refreshStateAndAnalyze();
          renderTabContent();
          showToast(`✨ Tailored PDF ready (${resp.record.modelUsed})!`, "success");
        } else {
          b.textContent = "📄 Tailor & Download PDF Only";
          showToast(`Error: ${resp?.error || "Failed"}`, "warn");
        }
      });

      body.querySelector("#jb-dl-resume")?.addEventListener("click", () => {
        downloadBase64Pdf(latestTailoredRecord.pdfBase64, latestTailoredRecord.fileName);
      });

      body.querySelector("#jb-attach-resume")?.addEventListener("click", async () => {
        const fileInputs = Array.from(document.querySelectorAll("input[type='file']"));
        const target =
          document.getElementById("_systemfield_resume") ||
          fileInputs.find((f) => !/cover/i.test(window.__JOBIFY_ADAPTERS__.getFieldLabelText(f))) ||
          fileInputs[0];
        if (target) {
          await window.__JOBIFY_ADAPTERS__.attachBase64PdfToInput(
            target,
            latestTailoredRecord.pdfBase64,
            latestTailoredRecord.fileName
          );
          showToast(`📎 Attached ${latestTailoredRecord.fileName}!`, "success");
          return;
        }
        const frameAttach = await chrome.runtime
          .sendMessage({
            type: "ATTACH_PDF_ALL_FRAMES",
            payload: {
              pdfBase64: latestTailoredRecord.pdfBase64,
              fileName: latestTailoredRecord.fileName
            }
          })
          .catch(() => null);
        if (frameAttach?.ok) {
          showToast(`📎 Attached ${latestTailoredRecord.fileName} to embedded form!`, "success");
        } else {
          showToast("No file upload input found on this page.", "warn");
        }
      });

      body.querySelector("#jb-run-cl").addEventListener("click", async (e) => {
        const b = e.currentTarget;
        const tone = body.querySelector("#jb-cl-tone").value;
        b.disabled = true;
        b.textContent = "⏳ Writing Cover Letter...";
        const resp = await chrome.runtime.sendMessage({
          type: "GENERATE_COVER_LETTER",
          payload: { jobMeta: pageMeta, tone }
        });
        b.disabled = false;
        if (resp?.ok) {
          latestCoverLetterRecord = resp.record;
          renderTabContent();
          showToast("📝 Tailored Cover Letter ready!", "success");
        } else {
          b.textContent = "📝 Generate Tailored Cover Letter";
          showToast(`Error: ${resp?.error || "Failed"}`, "warn");
        }
      });

      body.querySelector("#jb-copy-cl")?.addEventListener("click", () => {
        const txt = body.querySelector("#jb-cl-text").value;
        navigator.clipboard.writeText(txt);
        showToast("📋 Copied Cover Letter!", "success");
      });

      body.querySelector("#jb-dl-cl")?.addEventListener("click", async () => {
        const editedText = body.querySelector("#jb-cl-text")?.value || "";
        if (editedText && editedText.trim() !== (latestCoverLetterRecord?.coverLetter || "").trim()) {
          const recomp = await chrome.runtime
            .sendMessage({
              type: "COMPILE_COVER_LETTER_PDF",
              payload: {
                coverLetter: editedText,
                company: pageMeta?.company || latestCoverLetterRecord?.company || "Company",
                role: pageMeta?.title || latestCoverLetterRecord?.role || "Software Engineer",
                recordId: latestCoverLetterRecord?.id || null
              }
            })
            .catch(() => null);
          if (recomp?.ok && recomp.pdfBase64) {
            latestCoverLetterRecord = {
              ...latestCoverLetterRecord,
              coverLetter: editedText,
              pdfBase64: recomp.pdfBase64,
              fileName: recomp.fileName
            };
          }
        }
        downloadBase64Pdf(latestCoverLetterRecord.pdfBase64, latestCoverLetterRecord.fileName);
      });
      return;
    }

    if (activeTab === "copy") {
      const quickItems = [
        ["Full Name", p.fullName],
        ["Email", p.email],
        ["Phone", p.phone],
        ["Location", `${p.city}, ${p.stateCode}`],
        ["LinkedIn", p.linkedin],
        ["Portal Password", creds.portalPassword],
        ["Current Title", p.currentTitle],
        ["Current Company", p.currentCompany],
        ["University", "Clark University (M.S. CS, 3.5 GPA)"],
        ["Summary", appState.profile.summaryShort]
      ];
      body.innerHTML = `
        <div class="jb-card">
          <label class="jb-label">1-Click Quick-Copy Profile Fields</label>
          <div class="jb-copy-grid">
            ${quickItems
              .map(
                ([k, v], idx) => `
              <button class="jb-copy-item" data-copy-idx="${idx}">
                <span class="jb-copy-k">${escapeHtml(k)}</span>
                <span class="jb-copy-v">${escapeHtml(v)}</span>
              </button>
            `
              )
              .join("")}
          </div>
        </div>

        <div class="jb-card">
          <label class="jb-label">Saved Common Answers (${(appState.savedAnswers || []).length})</label>
          ${(appState.savedAnswers || [])
            .map(
              (sa, i) => `
            <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px;margin-bottom:7px;">
              <div style="font-size:11px;font-weight:700;color:#a5b4fc;margin-bottom:3px;">${escapeHtml(sa.questionLabel)}</div>
              <div style="font-size:11.5px;color:#cbd5e1;max-height:54px;overflow:hidden;">${escapeHtml(sa.answer)}</div>
              <button class="jb-btn secondary jb-sa-copy" data-sa-idx="${i}" style="margin-top:6px;padding:5px;">📋 Copy Answer</button>
            </div>
          `
            )
            .join("")}
        </div>
      `;

      body.querySelectorAll(".jb-copy-item").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [k, v] = quickItems[Number(btn.dataset.copyIdx)];
          navigator.clipboard.writeText(v || "");
          showToast(`📋 Copied ${k}!`, "success");
        });
      });

      body.querySelectorAll(".jb-sa-copy").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sa = appState.savedAnswers[Number(btn.dataset.saIdx)];
          navigator.clipboard.writeText(sa?.answer || "");
          showToast("📋 Copied Saved Answer!", "success");
        });
      });
      return;
    }

    if (activeTab === "network") {
      const refs = analysis?.referrals || [];
      body.innerHTML = `
        <div class="jb-card">
          <label class="jb-label">Network Copilot — Referral Pathways at ${escapeHtml(pageMeta?.company || "Company")}</label>
          ${refs
            .map(
              (r) => `
            <a class="jb-ref-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:12px;font-weight:700;color:#f8fafc;">${escapeHtml(r.label)}</span>
                <span class="jb-chip ats">${escapeHtml(r.badge)}</span>
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-top:3px;">${escapeHtml(r.description)}</div>
            </a>
          `
            )
            .join("")}
          <button class="jb-btn primary" id="jb-gen-outreach" style="margin-top:6px;">
            ✨ Draft Personalized Referral Note & DM
          </button>
          <div id="jb-outreach-box"></div>
        </div>
      `;

      body.querySelector("#jb-gen-outreach").addEventListener("click", async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = "⏳ Generating warm referral notes...";
        const resp = await chrome.runtime.sendMessage({
          type: "GENERATE_NETWORK_OUTREACH",
          payload: {
            company: pageMeta?.company || "Company",
            role: pageMeta?.title || "AI Engineer",
            url: location.href
          }
        });
        b.disabled = false;
        b.textContent = "✨ Regenerate Referral Notes";
        if (resp?.ok && resp.outreach) {
          const box = body.querySelector("#jb-outreach-box");
          box.innerHTML = `
            <div style="margin-top:10px;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:9px;font-size:11.5px;">
              <div style="font-weight:700;color:#a5b4fc;margin-bottom:4px;">LinkedIn Connection Note (&lt;300 chars):</div>
              <div style="color:#e2e8f0;margin-bottom:8px;">${escapeHtml(resp.outreach.linkedinNote)}</div>
              <button class="jb-btn secondary" id="jb-cp-li" style="margin-bottom:8px;">📋 Copy Connection Note</button>
              <div style="font-weight:700;color:#a5b4fc;margin-bottom:4px;">Warm Referral DM / Email:</div>
              <div style="color:#e2e8f0;margin-bottom:8px;">${escapeHtml(resp.outreach.referralDm)}</div>
              <button class="jb-btn secondary" id="jb-cp-dm">📋 Copy Referral DM</button>
            </div>
          `;
          box.querySelector("#jb-cp-li").addEventListener("click", () => {
            navigator.clipboard.writeText(resp.outreach.linkedinNote || "");
            showToast("📋 Copied LinkedIn Note!", "success");
          });
          box.querySelector("#jb-cp-dm").addEventListener("click", () => {
            navigator.clipboard.writeText(resp.outreach.referralDm || "");
            showToast("📋 Copied Referral DM!", "success");
          });
        }
      });
    }
  }

  const WIDGET_MSG_TYPES = new Set([
    "GET_PAGE_CONTEXT",
    "TOGGLE_COPILOT_DRAWER",
    "TRIGGER_AUTOFILL",
    "TRIGGER_LOCAL_AUTOFILL",
    "EXECUTE_AUTOPILOT_STEP",
    "AUTO_APPLY_PROGRESS",
    "ADAPTER_RPC"
  ]);

  // Listen for Popup / Sidepanel / Autopilot commands strictly in top frame so analytics/reCAPTCHA iframes never hijack responses
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!IS_TOP_FRAME || !WIDGET_MSG_TYPES.has(msg?.type)) {
      return false;
    }
    (async () => {
      if (msg.type === "ADAPTER_RPC") {
        const fn = window.__JOBIFY_ADAPTERS__?.[msg.payload?.method];
        if (typeof fn !== "function") return { ok: false, error: `Unknown adapter method: ${msg.payload?.method}` };
        const result = await fn(...(msg.payload?.args || []));
        return { ok: true, result };
      }
      if (msg.type === "AUTO_APPLY_PROGRESS") {
        autoApplyStatus = msg.payload || null;
        if (!document.getElementById("jobify-copilot-host") && pageMeta?.isRelevantPage) {
          mountWidget();
        }
        renderAutoApplyHud();
        if (drawerOpen && activeTab === "autofill") renderTabContent();
        return { ok: true };
      }
      if (msg.type === "GET_PAGE_CONTEXT") {
        await refreshStateAndAnalyze();
        return { ok: true, pageMeta, analysis };
      }
      if (msg.type === "TOGGLE_COPILOT_DRAWER") {
        await refreshStateAndAnalyze();
        if (!document.getElementById("jobify-copilot-host")) mountWidget();
        drawerOpen = msg.payload?.open ?? !drawerOpen;
        if (msg.payload?.tab) activeTab = msg.payload.tab;
        renderDrawer();
        return { ok: true, drawerOpen };
      }
      if (msg.type === "TRIGGER_LOCAL_AUTOFILL") {
        await refreshStateAndAnalyze();
        if (!document.getElementById("jobify-copilot-host")) mountWidget();
        const res = await executeLocalAutofill(msg.payload || {});
        injectInlineAiButtons();
        if ((res?.filledCount || 0) > 0) {
          showToast(`⚡ Autofilled ${res.filledCount} field(s) successfully!`, "success");
        }
        return { ok: true, ...res };
      }
      if (msg.type === "TRIGGER_AUTOFILL") {
        await refreshStateAndAnalyze();
        if (!document.getElementById("jobify-copilot-host")) mountWidget();
        const res = await executeAutofillFromUI(msg.payload || {});
        return { ok: true, ...res };
      }
      if (msg.type === "EXECUTE_AUTOPILOT_STEP") {
        await refreshStateAndAnalyze();
        if (!document.getElementById("jobify-copilot-host")) mountWidget();
        if (msg.payload?.tailorFirst && pageMeta?.description?.length > 200) {
          const tResp = await chrome.runtime
            .sendMessage({ type: "TAILOR_RESUME", payload: { jobMeta: pageMeta } })
            .catch(() => null);
          if (tResp?.ok) latestTailoredRecord = tResp.record;
        }
        const res = await executeAutofillFromUI({
          resumeChoice: latestTailoredRecord?.id,
          fillOpenEndedWithAI: true
        });
        let submitted = false;
        if (msg.payload?.autoSubmit && res.filledCount > 0) {
          const navAct = await window.__JOBIFY_ADAPTERS__?.clickWizardNextOrSubmit?.({ allowFinalSubmit: true });
          submitted = navAct?.action === "submit";
        }
        return {
          ok: true,
          filledCount: res.filledCount,
          submitted,
          company: pageMeta?.company,
          role: pageMeta?.title,
          ats: pageMeta?.ats,
          matchScore: analysis?.match?.matchScore || 88
        };
      }
    })()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  });

  // Boot after brief hydration settle (capped at 1.2s so slow analytics pixels never block widget mount)
  (async () => {
    if (/^https?:/i.test(location.protocol)) {
      if (document.readyState !== "complete") {
        await Promise.race([
          new Promise((r) => window.addEventListener("load", r, { once: true })),
          new Promise((r) => setTimeout(r, 1200))
        ]);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
    await refreshStateAndAnalyze();
    attachSubmitAutoTracker();
    if (pageMeta?.isRelevantPage) {
      injectInlineAiButtons();
      if (IS_TOP_FRAME && appState?.settings?.autoShowCopilotWidget !== false) {
        mountWidget();
      }
    }

    if (IS_TOP_FRAME) {
      let lastHref = location.href;
      const pollTimer = setInterval(async () => {
        try {
          if (typeof chrome === "undefined" || !chrome.runtime?.id) {
            clearInterval(pollTimer);
            return;
          }
          if (
            hostEl &&
            !document.getElementById("jobify-copilot-host") &&
            pageMeta?.isRelevantPage &&
            appState?.settings?.autoShowCopilotWidget !== false
          ) {
            mountWidget();
          }
          if (location.href !== lastHref) {
            lastHref = location.href;
            await refreshStateAndAnalyze();
            if (pageMeta?.isRelevantPage) {
              injectInlineAiButtons();
              if (!document.getElementById("jobify-copilot-host") && appState?.settings?.autoShowCopilotWidget !== false) {
                mountWidget();
              } else if (shadowRoot) {
                renderDrawer();
              }
            }
          }
        } catch (_) {}
      }, 900);
    }
  })().catch(() => {});
})();
