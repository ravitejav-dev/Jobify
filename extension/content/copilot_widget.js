// Jobify In-Page Copilot — Simplify-Inspired Minimal Edge Pill, Compact 3-Tab Panel & Autonomous Take-Control HUD
(function initJobifyCopilotWidget() {
  if (window.__JOBIFY_WIDGET_LOADED__) return;
  window.__JOBIFY_WIDGET_LOADED__ = true;

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
  let activeTab = "autofill"; // "autofill" | "keywords" | "profile"
  let drawerOpen = false;
  let userMinimized = false;
  let hiddenForTab = false;
  let pillTopPx = 148;
  let latestTailoredRecord = null;
  let autoApplyStatus = null;
  let collapseTimer = null;
  let shadowRoot = null;
  let hostEl = null;

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function safeSendMessage(message) {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.id) {
        return { ok: false, contextInvalidated: true, error: "Extension reloaded — refresh this tab once." };
      }
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (/Extension context invalidated/i.test(msg)) {
        return { ok: false, contextInvalidated: true, error: "Extension updated — refresh this tab once." };
      }
      return { ok: false, error: msg };
    }
  }

  async function refreshStateAndAnalyze() {
    if (!window.__JOBIFY_ADAPTERS__) return;
    pageMeta = window.__JOBIFY_ADAPTERS__.extractJobMetadata(document);
    const stateResp = await safeSendMessage({ type: "GET_ALL_STATE" });
    if (stateResp?.contextInvalidated) return;
    appState = stateResp?.state || null;
    if (stateResp && "autoApplyStatus" in stateResp) {
      autoApplyStatus = stateResp.autoApplyStatus;
    }

    if (pageMeta && appState) {
      const normHref = location.href.split("?")[0].split("#")[0];
      const compLow = (pageMeta.company || "").toLowerCase();
      latestTailoredRecord =
        (appState.tailoredResumes || []).find(
          (r) =>
            (r.url && r.url.split("?")[0].split("#")[0] === normHref) ||
            (compLow && compLow !== "company" && (r.company || "").toLowerCase() === compLow)
        ) || null;

      if (pageMeta.isRelevantPage) {
        const res = await safeSendMessage({
          type: "ANALYZE_JOB_PAGE",
          payload: { jobMeta: pageMeta }
        });
        if (res?.ok) analysis = res;
      }
    }
  }

  function showToast(text, tone = "info") {
    if (!shadowRoot) return;
    const toast = shadowRoot.getElementById("jb-toast");
    if (!toast) return;
    toast.textContent = text;
    toast.className = `jb-toast show ${tone}`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 3200);
  }

  function downloadBase64Pdf(base64, fileName) {
    if (!base64) return;
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "Raviteja_Velanati_Tailored_Resume.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Inline "✨ AI" chip strictly on genuine open-ended textareas / question fields
  function injectInlineAiButtons() {
    if (!window.__JOBIFY_ADAPTERS__ || !appState) return;
    const openFields = window.__JOBIFY_ADAPTERS__.findOpenEndedFields(appState.profile, pageMeta);
    for (const item of openFields) {
      const el = item.element;
      if (!el || el.dataset.jobifyInlineAi === "1") continue;
      el.dataset.jobifyInlineAi = "1";

      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "jb-inline-ai-wrap";
      badge.textContent = "✨ AI Answer";
      badge.title = "Draft tailored response with Jobify";
      Object.assign(badge.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        marginTop: "5px",
        marginBottom: "4px",
        padding: "3px 9px",
        fontSize: "11.5px",
        fontWeight: "600",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
        color: "#0f766e",
        background: "#f0fdfa",
        border: "1px solid #99f6e4",
        borderRadius: "999px",
        cursor: "pointer",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)"
      });

      badge.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const orig = badge.textContent;
        badge.textContent = "⏳ Drafting...";
        badge.disabled = true;
        try {
          const resp = await safeSendMessage({
            type: "ANSWER_APPLICATION_QUESTION",
            payload: {
              questionCtx: {
                label: item.label,
                fieldType: item.fieldType,
                maxLength: item.maxLength
              },
              jobMeta: pageMeta,
              saveToVault: true
            }
          });
          if (resp?.ok && resp.answer) {
            window.__JOBIFY_ADAPTERS__.setNativeValue(el, resp.answer);
            badge.textContent = "✅ Filled";
            setTimeout(() => {
              badge.textContent = orig;
            }, 2000);
          } else {
            badge.textContent = "⚠️ Retry";
          }
        } catch (_) {
          badge.textContent = orig;
        } finally {
          badge.disabled = false;
        }
      });

      if (el.parentElement) {
        el.insertAdjacentElement("afterend", badge);
      }
    }
  }

  // Strict manual submission auto-tracker: ONLY logs Applied when clicking an actual final Submit button on a real candidate form
  function attachSubmitAutoTracker() {
    if (window.__JOBIFY_SUBMIT_TRACKED__) return;
    window.__JOBIFY_SUBMIT_TRACKED__ = true;

    document.addEventListener(
      "click",
      (e) => {
        if (!e.isTrusted) return; // Ignore programmatic clicks from Auto-Apply (service_worker logs those directly)
        const btn = e.target?.closest?.("button, input[type='submit'], [role='button']");
        if (!btn) return;
        const adapters = window.__JOBIFY_ADAPTERS__;
        if (!adapters || !appState || appState.settings?.autoSaveSubmittedJobs === false) return;

        const preMeta = adapters.extractJobMetadata?.(document);
        if (!preMeta?.hasCandidateForm || preMeta.isAuthWall) return;

        const wizardBtns = adapters.findWizardButtons?.({ includeDisabled: false });
        if (!wizardBtns?.submitBtn || wizardBtns.submitBtn !== btn) return;

        const snapshotCompany = preMeta.company;
        const snapshotTitle = preMeta.title;
        const snapshotLocation = preMeta.location;
        const snapshotAts = preMeta.ats;
        const snapshotUrl = location.href;
        const snapshotScore = analysis?.match?.matchScore || 88;

        setTimeout(() => {
          const explicitConfirm = Boolean(adapters.detectSubmissionConfirmation?.(document));
          const postMeta = adapters.extractJobMetadata?.(document);
          const hasErrors = Boolean(adapters.detectFormValidationErrors?.(document)?.hasErrors);
          const formCleanlyGone =
            !postMeta?.hasCandidateForm &&
            !postMeta?.isAuthWall &&
            !hasErrors &&
            !adapters.findWizardButtons?.()?.submitBtn &&
            !adapters.findWizardButtons?.()?.nextBtn;

          if (!explicitConfirm && !formCleanlyGone) return;

          safeSendMessage({
            type: "UPSERT_APPLICATION",
            payload: {
              application: {
                company: snapshotCompany || "Company",
                role: snapshotTitle || document.title,
                location: snapshotLocation || "",
                ats: snapshotAts || "Career Portal",
                url: snapshotUrl,
                status: "Applied",
                matchScore: snapshotScore,
                notes: "Auto-logged on candidate form submission"
              }
            }
          });
        }, 1400);
      },
      true
    );
  }

  async function executeLocalAutofill({ resumeChoice, fillOpenEndedWithAI = true, onStepProgress = null } = {}) {
    await refreshStateAndAnalyze();
    if (!appState) return { filledCount: 0 };

    let resumePdfPayload = null;
    if (appState.settings?.autoAttachResumePdf !== false) {
      const selectedId =
        resumeChoice || latestTailoredRecord?.id || appState.settings?.defaultResumeVariant || "one_page";
      const pdfResp = await safeSendMessage({
        type: "GET_RESUME_PDF_BYTES",
        payload: { variantOrId: selectedId, company: pageMeta?.company || "" }
      });
      if (pdfResp?.ok) resumePdfPayload = pdfResp;
    }

    const latestCl =
      (appState.coverLetters || []).find((c) => c.url && location.href.startsWith(c.url.split("?")[0])) ||
      (appState.coverLetters || [])[0] ||
      null;

    return window.__JOBIFY_ADAPTERS__.runFullAutofill({
      profile: appState.profile,
      credentials: appState.credentials,
      savedAnswers: appState.savedAnswers || [],
      resumePdfPayload,
      coverLetterText: latestCl?.coverLetter || "",
      fillOpenEndedWithAI,
      jobMeta: pageMeta,
      onProgress: onStepProgress
    });
  }

  async function executeAutofillFromUI({ resumeChoice, fillOpenEndedWithAI = true, buttonEl = null } = {}) {
    await refreshStateAndAnalyze();
    if (!appState) return { filledCount: 0 };

    const setStatusText = (msg) => {
      if (buttonEl) buttonEl.textContent = msg;
    };

    const gateRes = await window.__JOBIFY_ADAPTERS__?.ensureApplicationFormOpen?.();
    if (gateRes?.clickedApplyGate) {
      setStatusText("⏳ Opening form...");
      await new Promise((r) => setTimeout(r, 450));
    }

    setStatusText("⏳ Filling fields...");
    const selectedResume =
      resumeChoice || latestTailoredRecord?.id || appState.settings?.defaultResumeVariant || "one_page";
    const multiResp = await safeSendMessage({
      type: "RUN_TAB_AUTOFILL",
      payload: {
        options: {
          resumeChoice: selectedResume,
          fillOpenEndedWithAI,
          topJobMeta: pageMeta
        }
      }
    });

    if (multiResp?.contextInvalidated) {
      showToast("🔄 Extension updated — refresh this tab once.", "warn");
      return { filledCount: 0 };
    }

    let filledCount = multiResp?.ok ? multiResp.filledCount || 0 : 0;
    if (!multiResp?.ok) {
      const localRes = await executeLocalAutofill({
        resumeChoice: selectedResume,
        fillOpenEndedWithAI,
        onStepProgress: setStatusText
      });
      filledCount = localRes?.filledCount || 0;
    }

    injectInlineAiButtons();
    await refreshStateAndAnalyze();

    if (filledCount > 0) {
      showToast(`⚡ Autofilled ${filledCount} field(s)!`, "success");
    } else if (gateRes?.navigatingHref) {
      showToast("↗ Opening application form...", "info");
    } else {
      showToast("No empty form fields found on this screen yet.", "warn");
    }
    return { filledCount };
  }

  function getTrackedStatusForPage() {
    if (!appState?.applications?.length) return null;
    const cleanUrl = location.href.split("#")[0];
    const match = appState.applications.find((a) => a.url && a.url.split("#")[0] === cleanUrl);
    return match?.status || null;
  }

  function buildStyles() {
    return `
      :host {
        all: initial;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #0f172a;
      }
      * { box-sizing: border-box; }

      /* Subtle Take-Control Viewport Glow During Active Auto-Apply */
      .jb-control-frame {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483644;
        border: 3px solid rgba(13, 148, 136, 0.8);
        box-shadow: inset 0 0 20px rgba(13, 148, 136, 0.16);
        display: none;
      }
      .jb-control-frame.active {
        display: block;
      }

      /* Simplify-Style Right-Edge Docked Pill (Always Accessible, Never Blocks Page) */
      .jb-edge-pill {
        position: fixed;
        right: 0;
        top: 148px;
        z-index: 2147483645;
        display: flex;
        align-items: center;
        gap: 7px;
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid rgba(20, 184, 166, 0.45);
        border-right: none;
        border-radius: 999px 0 0 999px;
        padding: 7px 11px 7px 9px;
        box-shadow: -4px 6px 20px rgba(15, 23, 42, 0.22);
        cursor: pointer;
        user-select: none;
        transition: transform 0.16s ease, background 0.16s ease, padding-right 0.16s ease;
      }
      .jb-edge-pill:hover {
        background: #1e293b;
        padding-right: 14px;
      }
      .jb-edge-logo {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: linear-gradient(135deg, #14b8a6, #0d9488);
        color: #ffffff;
        font-weight: 800;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .jb-edge-score {
        font-size: 12px;
        font-weight: 700;
        color: #5eead4;
        letter-spacing: -0.01em;
        white-space: nowrap;
      }
      .jb-edge-hide {
        display: none;
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 12px;
        padding: 0 2px;
        margin-left: 2px;
        cursor: pointer;
        line-height: 1;
      }
      .jb-edge-pill:hover .jb-edge-hide {
        display: inline-block;
      }
      .jb-edge-hide:hover {
        color: #f87171;
      }

      /* Floating Progress HUD During Autonomous Auto-Apply */
      .jb-hud {
        position: fixed;
        top: 14px;
        right: 16px;
        z-index: 2147483647;
        width: 344px;
        background: rgba(15, 23, 42, 0.97);
        border: 1px solid rgba(20, 184, 166, 0.55);
        border-radius: 12px;
        padding: 11px 13px;
        color: #f8fafc;
        box-shadow: 0 16px 38px rgba(15, 23, 42, 0.35);
        display: none;
        transition: opacity 0.22s ease, transform 0.22s ease;
      }
      .jb-hud.returning {
        opacity: 0;
        transform: translateY(-10px) scale(0.96);
      }
      .jb-hud-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }
      .jb-hud-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 10.5px;
        font-weight: 700;
        color: #5eead4;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .jb-pulse-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #14b8a6;
        box-shadow: 0 0 8px #14b8a6;
      }
      .jb-hud-step {
        font-size: 12.5px;
        font-weight: 700;
        color: #ffffff;
        margin-bottom: 2px;
      }
      .jb-hud-detail {
        font-size: 11px;
        color: #cbd5e1;
        line-height: 1.35;
      }
      .jb-hud-stop {
        background: rgba(239, 68, 68, 0.16);
        color: #fca5a5;
        border: 1px solid rgba(239, 68, 68, 0.4);
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 10.5px;
        font-weight: 700;
        cursor: pointer;
      }
      .jb-hud-stop:hover { background: rgba(239, 68, 68, 0.3); }

      /* Clean Simplify-Inspired Compact Panel */
      .jb-drawer {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483646;
        width: 344px;
        max-height: min(560px, calc(100vh - 32px));
        background: #ffffff;
        color: #0f172a;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        box-shadow: 0 20px 45px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(15, 23, 42, 0.06);
        display: none;
        flex-direction: column;
        overflow: hidden;
      }
      .jb-drawer.open { display: flex; }

      .jb-header {
        padding: 10px 12px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .jb-brand {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .jb-brand-logo {
        width: 24px;
        height: 24px;
        border-radius: 7px;
        background: linear-gradient(135deg, #0d9488, #0f766e);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-size: 13px;
        color: #fff;
      }
      .jb-brand-title {
        font-size: 13.5px;
        font-weight: 800;
        color: #0f172a;
        letter-spacing: -0.01em;
      }
      .jb-hdr-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .jb-icon-btn {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        color: #475569;
        border-radius: 7px;
        padding: 4px 7px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.12s, color 0.12s;
      }
      .jb-icon-btn:hover { background: #f1f5f9; color: #0f172a; }

      .jb-tabs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        padding: 0 8px;
      }
      .jb-tab {
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: #64748b;
        padding: 8px 4px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: color 0.12s;
      }
      .jb-tab:hover { color: #0f172a; }
      .jb-tab.active {
        color: #0d9488;
        border-bottom-color: #0d9488;
        font-weight: 700;
      }

      .jb-body {
        padding: 12px;
        overflow-y: auto;
        flex: 1;
        font-size: 12.5px;
        line-height: 1.45;
      }

      .jb-job-box {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px 11px;
        margin-bottom: 10px;
      }
      .jb-job-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }
      .jb-job-title {
        font-weight: 700;
        font-size: 13px;
        color: #0f172a;
        line-height: 1.3;
      }
      .jb-job-sub {
        font-size: 11.5px;
        color: #64748b;
        margin-top: 2px;
      }
      .jb-match-pill {
        flex-shrink: 0;
        background: #ccfbf1;
        color: #0f766e;
        border: 1px solid #99f6e4;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 999px;
      }
      .jb-meta-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 7px;
      }
      .jb-mini-chip {
        font-size: 10.5px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 6px;
        background: #f1f5f9;
        color: #334155;
      }
      .jb-mini-chip.comp {
        background: #ecfdf5;
        color: #047857;
        border: 1px solid #a7f3d0;
      }
      .jb-mini-chip.warn {
        background: #fef3c7;
        color: #b45309;
      }

      .jb-btn {
        width: 100%;
        padding: 9px 12px;
        border-radius: 9px;
        border: none;
        font-weight: 700;
        font-size: 12.5px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: filter 0.14s, background 0.14s;
      }
      .jb-btn:disabled { opacity: 0.6; cursor: wait; }
      .jb-btn.hero {
        background: linear-gradient(135deg, #0d9488, #0f766e);
        color: #ffffff;
        padding: 10px 12px;
        font-size: 13px;
        box-shadow: 0 3px 10px rgba(13, 148, 136, 0.25);
      }
      .jb-btn.hero:hover { filter: brightness(1.06); }
      .jb-btn.primary-soft {
        background: #f0fdfa;
        color: #0f766e;
        border: 1px solid #99f6e4;
      }
      .jb-btn.primary-soft:hover { background: #ccfbf1; }
      .jb-btn.secondary {
        background: #ffffff;
        color: #334155;
        border: 1px solid #cbd5e1;
      }
      .jb-btn.secondary:hover { background: #f8fafc; color: #0f172a; }

      .jb-row {
        display: flex;
        gap: 7px;
        margin-top: 7px;
      }

      .jb-resume-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #f1f5f9;
      }
      .jb-select {
        flex: 1;
        min-width: 0;
        background: #f8fafc;
        color: #0f172a;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 11.5px;
        font-weight: 500;
      }
      .jb-sm-btn {
        background: #f8fafc;
        color: #0f766e;
        border: 1px solid #99f6e4;
        border-radius: 8px;
        padding: 6px 9px;
        font-size: 11.5px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
      }
      .jb-sm-btn:hover { background: #ccfbf1; }
      .jb-sm-btn:disabled { opacity: 0.6; cursor: wait; }

      .jb-footer-strip {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 10px;
        padding-top: 9px;
        border-top: 1px solid #f1f5f9;
      }
      .jb-toggle-lbl {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        font-weight: 600;
        color: #475569;
        cursor: pointer;
        user-select: none;
      }
      .jb-save-chip {
        background: #f8fafc;
        color: #334155;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
      }
      .jb-save-chip.saved {
        background: #ecfdf5;
        color: #047857;
        border-color: #a7f3d0;
      }

      /* Keywords Tab */
      .jb-score-box {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px 12px;
        margin-bottom: 10px;
      }
      .jb-score-big {
        font-size: 20px;
        font-weight: 800;
        color: #0d9488;
      }
      .jb-sec-lbl {
        font-size: 11px;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin: 10px 0 6px;
      }
      .jb-chip {
        display: inline-block;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        margin: 2px 3px 2px 0;
      }
      .jb-chip.match { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
      .jb-chip.miss { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }

      /* Profile Quick-Copy Tab */
      .jb-copy-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      .jb-copy-item {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 6px 8px;
        cursor: pointer;
        text-align: left;
        overflow: hidden;
        transition: border-color 0.12s, background 0.12s;
      }
      .jb-copy-item:hover { border-color: #14b8a6; background: #f0fdfa; }
      .jb-copy-k { font-size: 10px; color: #64748b; font-weight: 600; display: block; }
      .jb-copy-v { font-size: 11.5px; color: #0f172a; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }

      .jb-sa-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 7px 9px;
        margin-bottom: 6px;
        cursor: pointer;
      }
      .jb-sa-card:hover { border-color: #14b8a6; background: #f0fdfa; }

      .jb-toast {
        position: fixed;
        top: 16px;
        right: 370px;
        z-index: 2147483647;
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid #334155;
        padding: 8px 12px;
        border-radius: 9px;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 8px 22px rgba(15, 23, 42, 0.25);
        opacity: 0;
        transform: translateY(-6px);
        pointer-events: none;
        transition: all 0.18s ease;
      }
      .jb-toast.show { opacity: 1; transform: translateY(0); }
      .jb-toast.success { border-color: #14b8a6; color: #5eead4; }
      .jb-toast.warn { border-color: #f59e0b; color: #fde68a; }
    `;
  }

  function renderPill() {
    if (!shadowRoot) return;
    const pill = shadowRoot.getElementById("jb-pill");
    const scoreEl = shadowRoot.getElementById("jb-pill-score");
    if (!pill || !scoreEl) return;

    const isHudActive = Boolean(
      autoApplyStatus &&
        (autoApplyStatus.running ||
          ["completed", "ready_for_review", "needs_review", "paused_captcha", "paused_otp", "error"].includes(
            autoApplyStatus.stage
          ))
    );

    if (hiddenForTab || drawerOpen || (isHudActive && autoApplyStatus?.running)) {
      pill.style.display = "none";
      return;
    }

    if (!pageMeta?.isRelevantPage) {
      pill.style.display = "none";
      return;
    }

    pill.style.display = "flex";
    pill.style.top = `${pillTopPx}px`;

    const trackedStatus = getTrackedStatusForPage();
    const isSubmitted =
      trackedStatus === "Applied" ||
      autoApplyStatus?.stage === "completed" ||
      Boolean(window.__JOBIFY_ADAPTERS__?.detectSubmissionConfirmation?.(document));

    if (isSubmitted) {
      scoreEl.textContent = "✓ Applied";
    } else if (pageMeta.pageType === "job_board") {
      scoreEl.textContent = "Copilot";
    } else {
      const sc = analysis?.match?.matchScore || 88;
      scoreEl.textContent = `${sc}%`;
    }
  }

  function renderAutoApplyHud() {
    if (!shadowRoot) return;
    const hud = shadowRoot.getElementById("jb-hud");
    const frame = shadowRoot.getElementById("jb-control-frame");
    if (!hud) return;

    const st = autoApplyStatus;
    const isRelevantHud =
      st &&
      (st.running ||
        ["completed", "ready_for_review", "needs_review", "paused_captcha", "paused_otp", "error"].includes(st.stage));

    if (frame) {
      frame.classList.toggle("active", Boolean(st?.running));
    }

    if (!isRelevantHud) {
      hud.style.display = "none";
      return;
    }

    // If auto-apply completed and collapse timer already finished, hide HUD cleanly
    if (!st.running && st._hudDismissed) {
      hud.style.display = "none";
      return;
    }

    hud.style.display = "block";
    const stepEl = shadowRoot.getElementById("jb-hud-step");
    const detEl = shadowRoot.getElementById("jb-hud-detail");
    const stopBtn = shadowRoot.getElementById("jb-hud-stop");
    const badgeTxt = shadowRoot.getElementById("jb-hud-badge-txt");

    if (badgeTxt) {
      badgeTxt.textContent = st.running ? "Jobify Auto-Apply Active" : "Jobify Status";
    }
    if (stepEl) stepEl.textContent = st.stepLabel || "Working...";
    if (detEl) detEl.textContent = st.detail || "";
    if (stopBtn) stopBtn.style.display = st.running ? "inline-block" : "none";
  }

  function renderDrawer() {
    if (!shadowRoot) return;
    const drawer = shadowRoot.getElementById("jb-drawer");
    if (!drawer) return;

    if (autoApplyStatus?.running || hiddenForTab) {
      drawer.classList.remove("open");
      drawer.style.display = "none";
    } else {
      drawer.classList.toggle("open", drawerOpen);
      drawer.style.display = drawerOpen ? "flex" : "none";
    }

    shadowRoot.querySelectorAll(".jb-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === activeTab);
    });

    renderPill();
    renderAutoApplyHud();
    if (drawerOpen && !autoApplyStatus?.running) {
      renderTabContent();
    }
  }

  function renderTabContent() {
    const body = shadowRoot?.getElementById("jb-body");
    if (!body || !appState) return;

    const p = appState.profile?.personal || {};
    const creds = appState.credentials || {};
    const matchScore = analysis?.match?.matchScore || 88;
    const atsTotal = analysis?.atsScore?.totalScore || 85;
    const missingKw = analysis?.atsScore?.keywords?.missing || [];
    const matchedKw = analysis?.atsScore?.keywords?.matched || [];
    const isBoard = pageMeta?.pageType === "job_board";
    const trackedStatus = getTrackedStatusForPage();
    const hasApiKey = Boolean(String(appState.settings?.geminiApiKey || "").trim());

    if (activeTab === "autofill") {
      const resumes = appState.profile?.resumes || [];
      const autoSubOn = appState.settings?.autoSubmitEnabled !== false;
      const compRaw = pageMeta?.compensation?.raw || "";

      body.innerHTML = `
        <div class="jb-job-box">
          <div class="jb-job-top">
            <div style="min-width:0;">
              <div class="jb-job-title">${escapeHtml(isBoard ? `${pageMeta?.company || "Career"} Job Board` : pageMeta?.title || "Active Job Page")}</div>
              <div class="jb-job-sub">${escapeHtml([pageMeta?.company, pageMeta?.location].filter(Boolean).join(" • ") || pageMeta?.ats || "Career Portal")}</div>
            </div>
            ${!isBoard ? `<span class="jb-match-pill">${matchScore}% Match</span>` : `<span class="jb-mini-chip">${escapeHtml(pageMeta?.ats || "Jobs")}</span>`}
          </div>
          <div class="jb-meta-chips">
            <span class="jb-mini-chip">${escapeHtml(pageMeta?.ats || "Portal")}</span>
            ${compRaw ? `<span class="jb-mini-chip comp">💰 ${escapeHtml(compRaw)}</span>` : ""}
            ${!hasApiKey ? `<span class="jb-mini-chip warn" id="jb-warn-apikey" style="cursor:pointer;">🔑 Set Gemini Key in Hub ↗</span>` : ""}
          </div>
        </div>

        <button class="jb-btn hero" id="jb-btn-full-auto">
          🚀 Tailor &amp; Auto-Apply
        </button>

        <div class="jb-row">
          <button class="jb-btn primary-soft" id="jb-btn-autofill" style="flex:1.15;">
            ⚡ Autofill Page
          </button>
          <button class="jb-btn secondary" id="jb-btn-fast-auto" style="flex:1;">
            ⚡ Fast Apply
          </button>
        </div>

        <div class="jb-resume-bar">
          <select class="jb-select" id="jb-resume-select" title="Resume PDF to attach">
            ${
              latestTailoredRecord
                ? `<option value="${escapeHtml(latestTailoredRecord.id)}" selected>✨ Tailored: ${escapeHtml(latestTailoredRecord.fileName)}</option>`
                : ""
            }
            ${resumes
              .map(
                (r) =>
                  `<option value="${escapeHtml(r.id)}" ${
                    !latestTailoredRecord && r.id === appState.settings?.defaultResumeVariant ? "selected" : ""
                  }>📄 ${escapeHtml(r.label)}</option>`
              )
              .join("")}
          </select>
          <button class="jb-sm-btn" id="jb-btn-tailor-inline" title="Generate tailored 1-page PDF for this job">
            ✨ Tailor
          </button>
          ${
            latestTailoredRecord
              ? `<button class="jb-icon-btn" id="jb-dl-resume" title="Download ${escapeHtml(latestTailoredRecord.fileName)}">⬇</button>`
              : ""
          }
        </div>

        <div class="jb-footer-strip">
          <label class="jb-toggle-lbl" title="Click final Submit automatically when all fields pass validation">
            <input type="checkbox" id="jb-chk-autosubmit" ${autoSubOn ? "checked" : ""} style="accent-color:#0d9488;cursor:pointer;" />
            <span>Auto-submit</span>
          </label>
          <div style="display:flex;align-items:center;gap:5px;">
            ${
              pageMeta?.isAuthWall
                ? `<button class="jb-save-chip" id="jb-btn-auth" title="Fill portal email & password">🔐 Login</button>`
                : ""
            }
            <button class="jb-save-chip ${trackedStatus ? "saved" : ""}" id="jb-btn-bookmark">
              ${trackedStatus === "Applied" ? "✓ Applied" : trackedStatus ? "✓ Saved" : "📌 Save"}
            </button>
          </div>
        </div>
      `;

      body.querySelector("#jb-warn-apikey")?.addEventListener("click", () => {
        safeSendMessage({ type: "OPEN_DASHBOARD", payload: { tab: "vault" } });
      });

      const autoSubChk = body.querySelector("#jb-chk-autosubmit");
      autoSubChk?.addEventListener("change", async () => {
        const enabled = Boolean(autoSubChk.checked);
        appState.settings.autoSubmitEnabled = enabled;
        await safeSendMessage({
          type: "UPDATE_SETTINGS",
          payload: {
            settings: {
              autoSubmitEnabled: enabled,
              autopilotMode: enabled ? "full_auto" : "safe_review"
            }
          }
        });
        showToast(enabled ? "Auto-submit enabled" : "Paused before final submit", "info");
      });

      const startAutoApply = async ({ tailorResume }) => {
        const shouldSubmit = autoSubChk ? Boolean(autoSubChk.checked) : true;
        clearTimeout(collapseTimer);
        drawerOpen = false;
        renderDrawer();
        const r = await safeSendMessage({
          type: "START_FULL_AUTO_APPLY",
          payload: {
            options: {
              autoSubmit: shouldSubmit,
              tailorResume,
              jobMeta: pageMeta
            }
          }
        });
        if (r && !r.ok) {
          drawerOpen = true;
          renderDrawer();
          showToast(`⚠️ ${r.error || "Could not start Auto-Apply"}`, "warn");
        }
      };

      body.querySelector("#jb-btn-full-auto").addEventListener("click", () => startAutoApply({ tailorResume: true }));
      body.querySelector("#jb-btn-fast-auto").addEventListener("click", () => startAutoApply({ tailorResume: false }));

      body.querySelector("#jb-btn-autofill").addEventListener("click", async (e) => {
        const b = e.currentTarget;
        const chosenResume = body.querySelector("#jb-resume-select")?.value;
        b.disabled = true;
        try {
          await executeAutofillFromUI({ resumeChoice: chosenResume, fillOpenEndedWithAI: true, buttonEl: b });
        } finally {
          b.disabled = false;
          b.textContent = "⚡ Autofill Page";
        }
      });

      body.querySelector("#jb-btn-tailor-inline").addEventListener("click", async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = "⏳ Tailoring...";
        const resp = await safeSendMessage({
          type: "TAILOR_RESUME",
          payload: { jobMeta: pageMeta }
        });
        b.disabled = false;
        b.textContent = "✨ Tailor";
        if (resp?.ok && resp.record) {
          latestTailoredRecord = resp.record;
          await refreshStateAndAnalyze();
          renderTabContent();
          showToast(`✨ Tailored ${resp.record.fileName} (${resp.record.atsScore}/100)!`, "success");
        } else {
          showToast(`⚠️ ${resp?.error || "Tailoring failed"}`, "warn");
        }
      });

      body.querySelector("#jb-dl-resume")?.addEventListener("click", () => {
        if (latestTailoredRecord?.pdfBase64) {
          downloadBase64Pdf(latestTailoredRecord.pdfBase64, latestTailoredRecord.fileName);
        }
      });

      body.querySelector("#jb-btn-auth")?.addEventListener("click", async () => {
        if (!creds.portalPassword) {
          showToast("Set Portal Password in Hub → Vault first", "warn");
          safeSendMessage({ type: "OPEN_DASHBOARD", payload: { tab: "vault" } });
          return;
        }
        const res = await window.__JOBIFY_ADAPTERS__.autofillPortalAuth(creds);
        showToast(
          res.filled > 0 ? `🔐 Filled login for ${creds.portalEmail}` : "No login fields detected",
          res.filled > 0 ? "success" : "warn"
        );
      });

      body.querySelector("#jb-btn-bookmark").addEventListener("click", async (e) => {
        const nextStatus = trackedStatus === "Bookmarked" ? "Applied" : "Bookmarked";
        await safeSendMessage({
          type: "UPSERT_APPLICATION",
          payload: {
            application: {
              company: pageMeta?.company || "Company",
              role: pageMeta?.title || document.title,
              location: pageMeta?.location || "",
              ats: pageMeta?.ats || "Portal",
              url: location.href,
              status: nextStatus,
              matchScore
            }
          }
        });
        await refreshStateAndAnalyze();
        renderTabContent();
        renderPill();
        showToast(nextStatus === "Applied" ? "✅ Marked as Applied!" : "📌 Saved to Tracker!", "success");
      });
      return;
    }

    if (activeTab === "keywords") {
      const covPct = analysis?.atsScore?.keywords?.keywordCoveragePct ?? 85;
      body.innerHTML = `
        <div class="jb-score-box">
          <div>
            <div style="font-weight:700;color:#0f172a;font-size:12.5px;">ATS Keyword Match</div>
            <div style="font-size:11px;color:#64748b;">Coverage: ${covPct}% (${matchedKw.length} matched, ${missingKw.length} missing)</div>
          </div>
          <div class="jb-score-big">${atsTotal}/100</div>
        </div>

        <button class="jb-btn hero" id="jb-run-tailor" style="margin-bottom:6px;">
          🚀 Tailor &amp; Auto-Apply
        </button>

        <button class="jb-btn primary-soft" id="jb-kw-tailor">
          ✨ Tailor 1-Page PDF Only
        </button>

        ${
          latestTailoredRecord
            ? `<div class="jb-row">
                <button class="jb-btn secondary" id="jb-kw-dl">⬇ Download ${escapeHtml(latestTailoredRecord.fileName)}</button>
                <button class="jb-btn secondary" id="jb-kw-attach">📎 Attach</button>
              </div>`
            : ""
        }

        <div class="jb-sec-lbl">Missing Keywords (${missingKw.length})</div>
        <div>
          ${
            missingKw.length === 0
              ? `<span class="jb-chip match">✓ All key skills covered!</span>`
              : missingKw.map((k) => `<span class="jb-chip miss">+ ${escapeHtml(k.keyword)}</span>`).join("")
          }
        </div>

        <div class="jb-sec-lbl">Matched Keywords (${matchedKw.length})</div>
        <div>
          ${
            matchedKw.length === 0
              ? `<span style="font-size:11.5px;color:#64748b;">Open a specific job description to scan keywords.</span>`
              : matchedKw.map((k) => `<span class="jb-chip match">✓ ${escapeHtml(k.keyword)}</span>`).join("")
          }
        </div>
      `;

      body.querySelector("#jb-run-tailor")?.addEventListener("click", async () => {
        const shouldSubmit = appState.settings?.autoSubmitEnabled !== false;
        clearTimeout(collapseTimer);
        drawerOpen = false;
        renderDrawer();
        const r = await safeSendMessage({
          type: "START_FULL_AUTO_APPLY",
          payload: {
            options: {
              autoSubmit: shouldSubmit,
              tailorResume: true,
              jobMeta: pageMeta
            }
          }
        });
        if (r && !r.ok) {
          drawerOpen = true;
          renderDrawer();
          showToast(`⚠️ ${r.error || "Could not start Auto-Apply"}`, "warn");
        }
      });

      body.querySelector("#jb-kw-tailor").addEventListener("click", async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = "⏳ Tailoring 1-Page PDF...";
        const resp = await safeSendMessage({
          type: "TAILOR_RESUME",
          payload: { jobMeta: pageMeta }
        });
        b.disabled = false;
        if (resp?.ok && resp.record) {
          latestTailoredRecord = resp.record;
          await refreshStateAndAnalyze();
          renderTabContent();
          showToast(`✨ Tailored ${resp.record.fileName} (${resp.record.atsScore}/100)!`, "success");
        } else {
          b.textContent = "✨ Tailor 1-Page PDF Only";
          showToast(`⚠️ ${resp?.error || "Tailoring failed"}`, "warn");
        }
      });

      body.querySelector("#jb-kw-dl")?.addEventListener("click", () => {
        downloadBase64Pdf(latestTailoredRecord.pdfBase64, latestTailoredRecord.fileName);
      });

      body.querySelector("#jb-kw-attach")?.addEventListener("click", async () => {
        const attached = await safeSendMessage({
          type: "ATTACH_PDF_ALL_FRAMES",
          payload: {
            pdfBase64: latestTailoredRecord.pdfBase64,
            fileName: latestTailoredRecord.fileName,
            company: pageMeta?.company
          }
        });
        showToast(
          attached?.ok ? `📎 Attached ${latestTailoredRecord.fileName}!` : "Open the application form first to attach.",
          attached?.ok ? "success" : "warn"
        );
      });
      return;
    }

    if (activeTab === "profile") {
      const hasSecretPw = Boolean(creds.portalPassword);
      const copyPairs = [
        ["Full Name", p.fullName, p.fullName],
        ["Email", p.email, p.email],
        ["Phone", p.phone, p.phone],
        ["Location", `${p.city}, ${p.stateCode} ${p.postalCode}`, `${p.city}, ${p.stateCode} ${p.postalCode}`],
        ["LinkedIn", p.linkedin, p.linkedin],
        ["GitHub", p.github, p.github],
        ["Portfolio", p.portfolio, p.portfolio],
        ["Portal Password", hasSecretPw ? "••••••••••••" : "Not set", creds.portalPassword || ""]
      ];

      body.innerHTML = `
        <div class="jb-sec-lbl" style="margin-top:0;">1-Click Copy Profile</div>
        <div class="jb-copy-grid">
          ${copyPairs
            .map(
              ([k, displayVal], idx) => `
            <button class="jb-copy-item" data-copy-idx="${idx}">
              <span class="jb-copy-k">${escapeHtml(k)}</span>
              <span class="jb-copy-v">${escapeHtml(displayVal || "—")}</span>
            </button>
          `
            )
            .join("")}
        </div>

        <div class="jb-sec-lbl">Saved Answers</div>
        ${(appState.savedAnswers || [])
          .slice(0, 4)
          .map(
            (sa, idx) => `
          <div class="jb-sa-card" data-sa-idx="${idx}" title="Click to copy answer">
            <div style="font-weight:700;font-size:11px;color:#0f766e;margin-bottom:2px;">${escapeHtml(sa.questionLabel)}</div>
            <div style="font-size:11px;color:#334155;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(sa.answer)}</div>
          </div>
        `
          )
          .join("")}

        <button class="jb-btn secondary" id="jb-open-vault" style="margin-top:6px;">
          ⚙️ Edit Profile, Cover Letters &amp; Vault in Hub ↗
        </button>
      `;

      body.querySelectorAll(".jb-copy-item").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [k, , rawVal] = copyPairs[Number(btn.dataset.copyIdx)];
          if (!rawVal) {
            showToast(`Set ${k} in Hub → Vault`, "warn");
            return;
          }
          navigator.clipboard.writeText(rawVal);
          showToast(`📋 Copied ${k}!`, "success");
        });
      });

      body.querySelectorAll(".jb-sa-card").forEach((card) => {
        card.addEventListener("click", () => {
          const sa = appState.savedAnswers[Number(card.dataset.saIdx)];
          if (!sa?.answer) return;
          navigator.clipboard.writeText(sa.answer);
          showToast(`📋 Copied "${sa.questionLabel}"!`, "success");
        });
      });

      body.querySelector("#jb-open-vault")?.addEventListener("click", () => {
        safeSendMessage({ type: "OPEN_DASHBOARD", payload: { tab: "vault" } });
      });
    }
  }

  function mountWidget() {
    if (!IS_TOP_FRAME) return;
    const existingHost = document.getElementById("jobify-copilot-host");
    if (existingHost) {
      hostEl = existingHost;
      shadowRoot = existingHost.shadowRoot;
      renderDrawer();
      return;
    }

    hostEl = document.createElement("div");
    hostEl.id = "jobify-copilot-host";
    Object.assign(hostEl.style, {
      all: "initial",
      position: "fixed",
      zIndex: "2147483647",
      top: "0",
      right: "0",
      width: "0",
      height: "0",
      overflow: "visible"
    });
    (document.body || document.documentElement).appendChild(hostEl);

    shadowRoot = hostEl.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>${buildStyles()}</style>
      <div class="jb-control-frame" id="jb-control-frame"></div>
      <div class="jb-toast" id="jb-toast"></div>

      <!-- Simplify-Style Docked Right-Edge Pill -->
      <div class="jb-edge-pill" id="jb-pill" title="Open Jobify Copilot (drag vertically to reposition)">
        <span class="jb-edge-logo">J</span>
        <span class="jb-edge-score" id="jb-pill-score">88%</span>
        <button class="jb-edge-hide" id="jb-pill-hide" title="Hide on this tab">✕</button>
      </div>

      <!-- Autonomous Progress HUD -->
      <div class="jb-hud" id="jb-hud">
        <div class="jb-hud-top">
          <span class="jb-hud-badge">
            <span class="jb-pulse-dot"></span>
            <span id="jb-hud-badge-txt">Jobify Auto-Apply Active</span>
          </span>
          <button class="jb-hud-stop" id="jb-hud-stop">⏹ Stop</button>
        </div>
        <div class="jb-hud-step" id="jb-hud-step">Preparing...</div>
        <div class="jb-hud-detail" id="jb-hud-detail"></div>
      </div>

      <!-- Compact 3-Tab Simplify-Inspired Panel -->
      <div class="jb-drawer ${drawerOpen ? "open" : ""}" id="jb-drawer">
        <div class="jb-header">
          <div class="jb-brand">
            <div class="jb-brand-logo">J</div>
            <div class="jb-brand-title">Jobify</div>
          </div>
          <div class="jb-hdr-actions">
            <button class="jb-icon-btn" id="jb-open-hub" title="Open Full Jobify Hub">Hub ↗</button>
            <button class="jb-icon-btn" id="jb-close" title="Minimize to right-edge pill">—</button>
          </div>
        </div>
        <div class="jb-tabs">
          <button class="jb-tab active" data-tab="autofill">⚡ Autofill</button>
          <button class="jb-tab" data-tab="keywords">🎯 Keywords</button>
          <button class="jb-tab" data-tab="profile">📋 Profile</button>
        </div>
        <div class="jb-body" id="jb-body"></div>
      </div>
    `;

    // Vertical drag + click support on the Simplify-style right-edge pill
    const pillEl = shadowRoot.getElementById("jb-pill");
    let dragStartY = 0;
    let startTop = pillTopPx;
    let didDrag = false;

    pillEl.addEventListener("pointerdown", (ev) => {
      if (ev.target?.id === "jb-pill-hide") return;
      didDrag = false;
      dragStartY = ev.clientY;
      startTop = pillTopPx;
      const onMove = (mv) => {
        const dy = mv.clientY - dragStartY;
        if (Math.abs(dy) > 5) didDrag = true;
        if (didDrag) {
          pillTopPx = Math.max(64, Math.min(window.innerHeight - 80, startTop + dy));
          pillEl.style.top = `${pillTopPx}px`;
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    pillEl.addEventListener("click", async (ev) => {
      if (ev.target?.id === "jb-pill-hide" || didDrag) return;
      clearTimeout(collapseTimer);
      await refreshStateAndAnalyze();
      userMinimized = false;
      drawerOpen = true;
      renderDrawer();
    });

    shadowRoot.getElementById("jb-pill-hide").addEventListener("click", (ev) => {
      ev.stopPropagation();
      hiddenForTab = true;
      drawerOpen = false;
      renderDrawer();
    });

    shadowRoot.getElementById("jb-hud-stop")?.addEventListener("click", async () => {
      await safeSendMessage({ type: "STOP_FULL_AUTO_APPLY" });
      autoApplyStatus = null;
      drawerOpen = true;
      renderDrawer();
      showToast("⏹ Stopped Auto-Apply.", "warn");
    });

    shadowRoot.getElementById("jb-close").addEventListener("click", () => {
      userMinimized = true;
      drawerOpen = false;
      renderDrawer();
    });

    shadowRoot.getElementById("jb-open-hub").addEventListener("click", () => {
      safeSendMessage({ type: "OPEN_DASHBOARD" });
    });

    shadowRoot.querySelectorAll(".jb-tab").forEach((t) => {
      t.addEventListener("click", () => {
        activeTab = t.dataset.tab;
        renderDrawer();
      });
    });

    renderDrawer();
  }

  const WIDGET_MSG_TYPES = new Set([
    "ADAPTER_RPC",
    "AUTO_APPLY_PROGRESS",
    "GET_PAGE_CONTEXT",
    "TOGGLE_COPILOT_DRAWER",
    "TRIGGER_LOCAL_AUTOFILL",
    "TRIGGER_AUTOFILL",
    "EXECUTE_AUTOPILOT_STEP"
  ]);

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
        autoApplyStatus = msg.payload ? { ...msg.payload, _hudDismissed: false } : null;
        if (autoApplyStatus?.running) {
          clearTimeout(collapseTimer);
          hiddenForTab = false;
          drawerOpen = false;
        } else if (
          autoApplyStatus &&
          !autoApplyStatus.running &&
          (autoApplyStatus.stage === "completed" || autoApplyStatus.stage === "ready_for_review")
        ) {
          clearTimeout(collapseTimer);
          const delayMs = autoApplyStatus.stage === "completed" ? 1350 : 2200;
          collapseTimer = setTimeout(() => {
            const hud = shadowRoot?.getElementById("jb-hud");
            if (hud) hud.classList.add("returning");
            setTimeout(() => {
              if (autoApplyStatus) autoApplyStatus._hudDismissed = true;
              drawerOpen = false;
              if (hud) hud.classList.remove("returning");
              renderDrawer();
            }, 240);
          }, delayMs);
        }
        if (!document.getElementById("jobify-copilot-host") && pageMeta?.isRelevantPage) {
          mountWidget();
        }
        renderDrawer();
        return { ok: true };
      }
      if (msg.type === "GET_PAGE_CONTEXT") {
        await refreshStateAndAnalyze();
        return { ok: true, pageMeta, analysis };
      }
      if (msg.type === "TOGGLE_COPILOT_DRAWER") {
        await refreshStateAndAnalyze();
        clearTimeout(collapseTimer);
        hiddenForTab = false;
        const nextOpen = msg.payload?.open ?? !drawerOpen;
        userMinimized = !nextOpen;
        drawerOpen = nextOpen;
        if (!document.getElementById("jobify-copilot-host")) mountWidget();
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
          showToast(`⚡ Autofilled ${res.filledCount} field(s)!`, "success");
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
          const tResp = await safeSendMessage({ type: "TAILOR_RESUME", payload: { jobMeta: pageMeta } });
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

  function shouldAutoOpenPanel(meta) {
    if (!meta?.isRelevantPage || hiddenForTab || userMinimized) return false;
    if (autoApplyStatus?.running) return false;
    if (window.__JOBIFY_ADAPTERS__?.detectSubmissionConfirmation?.(document)) return false;
    // Simplify pattern: Auto-open compact panel ONLY on active application forms / auth walls, stay as sleek edge pill on postings & search boards!
    return meta.pageType === "application_form" || meta.pageType === "auth_wall";
  }

  // Boot & SPA lifecycle watcher
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
        drawerOpen = shouldAutoOpenPanel(pageMeta);
        mountWidget();
      }
    }

    if (IS_TOP_FRAME) {
      let lastHref = location.href;
      let lastPageType = pageMeta?.pageType || "other";
      let hydrationChecksLeft = 8;

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
            hydrationChecksLeft = 8;
            await refreshStateAndAnalyze();
            const isConfirmedNow = Boolean(window.__JOBIFY_ADAPTERS__?.detectSubmissionConfirmation?.(document));
            if (isConfirmedNow && !autoApplyStatus?.running) {
              drawerOpen = false;
              if (shadowRoot) renderDrawer();
              lastPageType = pageMeta?.pageType || "other";
              return;
            }
            if (pageMeta?.isRelevantPage) {
              injectInlineAiButtons();
              // Only auto-open on SPA route change if transitioning INTO an active application form and user hasn't minimized
              if (
                !autoApplyStatus?.running &&
                appState?.settings?.autoShowCopilotWidget !== false &&
                lastPageType !== "application_form" &&
                shouldAutoOpenPanel(pageMeta)
              ) {
                drawerOpen = true;
              } else if (pageMeta.pageType === "job_board") {
                drawerOpen = false;
              }
              lastPageType = pageMeta.pageType || "other";
              if (!document.getElementById("jobify-copilot-host") && appState?.settings?.autoShowCopilotWidget !== false) {
                mountWidget();
              } else if (shadowRoot) {
                renderDrawer();
              }
            } else if (shadowRoot && !autoApplyStatus?.running) {
              drawerOpen = false;
              renderDrawer();
            }
          } else if (hydrationChecksLeft > 0 && !autoApplyStatus?.running) {
            hydrationChecksLeft--;
            if (!pageMeta?.isRelevantPage || (pageMeta?.description || "").length < 150 || !pageMeta?.hasCandidateForm) {
              const freshMeta = window.__JOBIFY_ADAPTERS__?.extractJobMetadata?.(document);
              if (
                freshMeta?.isRelevantPage &&
                (!pageMeta?.isRelevantPage ||
                  freshMeta.pageType !== pageMeta?.pageType ||
                  (freshMeta.description || "").length > (pageMeta?.description || "").length + 80)
              ) {
                await refreshStateAndAnalyze();
                injectInlineAiButtons();
                if (appState?.settings?.autoShowCopilotWidget !== false) {
                  if (!drawerOpen && lastPageType !== "application_form" && shouldAutoOpenPanel(pageMeta)) {
                    drawerOpen = true;
                  }
                  lastPageType = pageMeta?.pageType || "other";
                  if (!document.getElementById("jobify-copilot-host")) {
                    mountWidget();
                  } else if (shadowRoot && !shadowRoot.activeElement) {
                    renderDrawer();
                  }
                }
              }
            }
          }
        } catch (_) {}
      }, 900);
    }
  })().catch(() => {});
})();
