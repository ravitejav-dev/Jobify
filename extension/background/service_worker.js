// Jobify MV3 Background Service Worker
import {
  ensureInitialized,
  getAllState,
  updateProfile,
  updateSettings,
  updateCredentials,
  upsertApplication,
  deleteApplication,
  upsertSavedAnswer,
  deleteSavedAnswer,
  saveTailoredResume,
  saveCoverLetter,
  updateAutopilotQueue,
  appendAutopilotLog
} from "../shared/storage.js";
import { analyzeJobKeywords, scoreResumeATS, evaluateJobMatch } from "../shared/ats_analyzer.js";
import {
  tailorResumeWithGemini,
  generateCoverLetterWithGemini,
  answerApplicationQuestionWithGemini,
  generateNetworkOutreachWithGemini
} from "../shared/gemini_client.js";
import { generateTailoredResumePdf, generateCoverLetterPdf } from "../shared/pdf_generator.js";
import { fetchPersonalizedRecommendations, buildNetworkCopilotPathways } from "../shared/job_feeds.js";

let autopilotRunning = false;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const t of tabs) {
      if (t.id) {
        chrome.scripting
          .executeScript({
            target: { tabId: t.id, allFrames: true },
            files: ["content/ats_adapters.js", "content/copilot_widget.js"]
          })
          .catch(() => {});
      }
    }
  } catch (_) {}
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "jobify_autopilot_schedule") {
    await appendAutopilotLog("Scheduled Autopilot alarm triggered — processing queue.", "info");
    runAutopilotQueue().catch((err) => appendAutopilotLog(`Autopilot error: ${err.message}`, "error"));
  }
});

async function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function getResumePdfPayload(variantOrId, state) {
  // Check if user requested a specific tailored resume id
  if (variantOrId && variantOrId.startsWith("tr_")) {
    const tr = (state.tailoredResumes || []).find((r) => r.id === variantOrId);
    if (tr?.pdfBase64) {
      return {
        fileName: tr.fileName || "Raviteja_Velanati_Tailored_Resume.pdf",
        mimeType: "application/pdf",
        base64: tr.pdfBase64
      };
    }
  }
  // Check custom uploaded resume in profile
  const selectedVariant = variantOrId || state.settings?.defaultResumeVariant || "one_page";
  const resumeEntry =
    (state.profile?.resumes || []).find((r) => r.id === selectedVariant) ||
    (state.profile?.resumes || [])[0];

  if (resumeEntry?.customBase64) {
    return {
      fileName: resumeEntry.name || "Raviteja_Velanati_Resume.pdf",
      mimeType: "application/pdf",
      base64: resumeEntry.customBase64
    };
  }

  const assetPath =
    selectedVariant === "master"
      ? "assets/Raviteja_Velanati_Master_Resume.pdf"
      : "assets/Raviteja_Velanati_Resume_1Page.pdf";
  const fileName =
    selectedVariant === "master"
      ? "Raviteja_Velanati_Master_Resume.pdf"
      : "Raviteja_Velanati_Resume_1Page.pdf";

  const resp = await fetch(chrome.runtime.getURL(assetPath));
  const buf = await resp.arrayBuffer();
  const base64 = await arrayBufferToBase64(buf);
  return { fileName, mimeType: "application/pdf", base64 };
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    const listener = (updatedId, info) => {
      if (updatedId === tabId && info.status === "complete") {
        setTimeout(done, 1600);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(done, timeoutMs);
  });
}

async function ensureTabScripts(tabId) {
  if (!tabId) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content/ats_adapters.js", "content/copilot_widget.js"]
    });
    return true;
  } catch (_) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/ats_adapters.js", "content/copilot_widget.js"]
      });
      return true;
    } catch (__) {
      return false;
    }
  }
}

async function runAutofillPassAcrossFrames(tabId, opts) {
  const execFn = async (frameOpts) => {
    if (!window.__JOBIFY_ADAPTERS__?.runFrameAutofill) {
      return { filledCount: 0, filledFieldsLog: [] };
    }
    return await window.__JOBIFY_ADAPTERS__.runFrameAutofill(frameOpts);
  };
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: execFn,
      args: [opts]
    });
  } catch (_) {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func: execFn,
      args: [opts]
    });
  }

  let filledCount = 0;
  let openQuestionsCount = 0;
  let clickedApplyGate = false;
  let bestMeta = null;
  const filledFieldsLog = [];

  for (const entry of results || []) {
    const r = entry?.result;
    if (!r) continue;
    filledCount += Number(r.filledCount || 0);
    openQuestionsCount += Number(r.openQuestionsCount || 0);
    if (r.clickedApplyGate) clickedApplyGate = true;
    if (Array.isArray(r.filledFieldsLog)) filledFieldsLog.push(...r.filledFieldsLog);
    if (r.jobMeta && (!bestMeta || r.filledCount > 0)) bestMeta = r.jobMeta;
  }

  return { filledCount, filledFieldsLog, openQuestionsCount, clickedApplyGate, jobMeta: bestMeta };
}

async function executeMultiFrameAutofill(tabId, opts = {}) {
  if (!tabId) return { ok: false, error: "Missing target tabId." };

  const injected = await ensureTabScripts(tabId);
  if (!injected) {
    // Fallback for extension-internal sandbox pages (chrome-extension://) where executeScript is disallowed
    const localResp = await chrome.tabs
      .sendMessage(tabId, { type: "TRIGGER_LOCAL_AUTOFILL", payload: opts })
      .catch(() => null);
    if (localResp?.ok) return localResp;
    return { ok: false, error: "Cannot inject into restricted browser tab." };
  }

  let pass = await runAutofillPassAcrossFrames(tabId, opts);

  // If clicking an "Apply" button navigated the tab (e.g. Lever /apply or Workday), wait for navigation and fill automatically
  if (pass.filledCount === 0 && pass.clickedApplyGate) {
    await waitForTabComplete(tabId, 5500);
    await ensureTabScripts(tabId);
    pass = await runAutofillPassAcrossFrames(tabId, opts);
  }

  return { ok: true, ...pass };
}

async function runAutopilotQueue() {
  if (autopilotRunning) {
    return { started: false, reason: "Autopilot is already running." };
  }
  autopilotRunning = true;
  try {
    let state = await getAllState();
    const queue = [...(state.autopilotQueue || [])];
    const pending = queue.filter((q) => q.status === "Queued");
    if (pending.length === 0) {
      await appendAutopilotLog("No queued jobs remaining in Autopilot queue.", "info");
      autopilotRunning = false;
      return { started: false, reason: "No queued jobs." };
    }

    await appendAutopilotLog(
      `Starting Autopilot batch across ${pending.length} job(s) [Mode: ${state.settings.autopilotMode}].`,
      "info"
    );

    for (const item of pending) {
      state = await getAllState();
      if (!autopilotRunning) break;

      const latestQueue = [...(state.autopilotQueue || [])];
      const idx = latestQueue.findIndex((q) => q.id === item.id);
      if (idx < 0) continue;

      latestQueue[idx].status = "Running";
      await updateAutopilotQueue(latestQueue);
      await appendAutopilotLog(`Opening ${item.company} — ${item.title} (${item.url})`, "info");

      try {
        const tab = await chrome.tabs.create({ url: item.url, active: true });
        await waitForTabComplete(tab.id, 18000);
        await ensureTabScripts(tab.id);

        const execResp = await chrome.tabs.sendMessage(tab.id, {
          type: "EXECUTE_AUTOPILOT_STEP",
          payload: {
            autoSubmit: state.settings.autopilotMode === "full_auto",
            tailorFirst: item.tailorFirst !== false
          }
        });

        const updatedState = await getAllState();
        const q2 = [...updatedState.autopilotQueue];
        const i2 = q2.findIndex((q) => q.id === item.id);
        if (i2 >= 0) {
          q2[i2].status = execResp?.submitted
            ? "Submitted"
            : execResp?.filledCount > 0
            ? "Autofilled (Ready)"
            : "Opened / Needs Review";
          q2[i2].filledCount = execResp?.filledCount || 0;
          q2[i2].completedAt = new Date().toISOString();
          await updateAutopilotQueue(q2);
        }

        await upsertApplication({
          company: item.company || execResp?.company || "Target Company",
          role: item.title || execResp?.role || "AI / Software Engineer",
          location: item.location || "",
          ats: item.ats || execResp?.ats || "Career Portal",
          url: item.url,
          status: execResp?.submitted ? "Applied" : "Bookmarked",
          matchScore: item.matchScore || execResp?.matchScore || 88,
          notes: `Autopilot processed (${execResp?.filledCount || 0} fields filled).`
        });

        await appendAutopilotLog(
          `Completed ${item.company} — ${execResp?.filledCount || 0} fields autofilled${execResp?.submitted ? " & submitted!" : " (paused for review)."}`,
          "success"
        );
      } catch (stepErr) {
        const updatedState = await getAllState();
        const q2 = [...updatedState.autopilotQueue];
        const i2 = q2.findIndex((q) => q.id === item.id);
        if (i2 >= 0) {
          q2[i2].status = "Needs Manual Check";
          q2[i2].error = stepErr.message;
          await updateAutopilotQueue(q2);
        }
        await appendAutopilotLog(`Step warning on ${item.company}: ${stepErr.message}`, "warn");
      }
    }
    return { started: true };
  } finally {
    autopilotRunning = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const { type, payload = {} } = message || {};
    const state = await getAllState();

    switch (type) {
      case "GET_ALL_STATE": {
        return { ok: true, state };
      }

      case "UPDATE_PROFILE": {
        const profile = await updateProfile(payload.profile);
        return { ok: true, profile };
      }

      case "UPDATE_SETTINGS": {
        const settings = await updateSettings(payload.settings);
        return { ok: true, settings };
      }

      case "UPDATE_CREDENTIALS": {
        const credentials = await updateCredentials(payload.credentials);
        return { ok: true, credentials };
      }

      case "ANALYZE_JOB_PAGE": {
        const jobMeta = payload.jobMeta || {};
        const match = evaluateJobMatch(jobMeta, state.profile);
        const atsScore = scoreResumeATS(state.profile, jobMeta.description || "");
        const referrals = buildNetworkCopilotPathways(jobMeta.company, jobMeta.title);
        if (sender?.tab?.id) {
          chrome.action.setBadgeText({ text: `${match.matchScore}%`, tabId: sender.tab.id }).catch(() => {});
          chrome.action.setBadgeBackgroundColor({
            color: match.matchScore >= 80 ? "#10b981" : match.matchScore >= 60 ? "#f59e0b" : "#ef4444",
            tabId: sender.tab.id
          }).catch(() => {});
        }
        return { ok: true, match, atsScore, referrals };
      }

      case "GET_RESUME_PDF_BYTES": {
        const pdfPayload = await getResumePdfPayload(payload.variantOrId, state);
        return { ok: true, ...pdfPayload };
      }

      case "TAILOR_RESUME": {
        const jobMeta = payload.jobMeta || {};
        const kw = analyzeJobKeywords(jobMeta.description || "", state.profile);
        const missingList = kw.missing.map((m) => m.keyword);
        const aiRes = await tailorResumeWithGemini(
          jobMeta,
          state.profile,
          missingList,
          state.settings,
          payload.preferredModel || null
        );
        const pdfOut = await generateTailoredResumePdf(aiRes.tailored, state.profile, state.settings);
        const postScore = scoreResumeATS(state.profile, jobMeta.description || "", aiRes.tailored);
        const safeComp = String(jobMeta.company || "Target")
          .replace(/[^a-zA-Z0-9]+/g, "_")
          .replace(/^_|_$/g, "")
          .slice(0, 24);
        const fileName = `Raviteja_Velanati_${safeComp || "Tailored"}_Resume.pdf`;

        const saved = await saveTailoredResume({
          company: jobMeta.company || "Target Company",
          role: jobMeta.title || "AI / Software Engineer",
          url: jobMeta.url || "",
          fileName,
          modelUsed: aiRes.modelUsed,
          requestedModel: aiRes.requestedModel,
          fellBack: aiRes.fellBack,
          pdfEngine: pdfOut.engine,
          atsScore: postScore.totalScore,
          tailored: aiRes.tailored,
          pdfBase64: pdfOut.pdfBase64
        });

        return { ok: true, record: saved, postScore };
      }

      case "GENERATE_COVER_LETTER": {
        const jobMeta = payload.jobMeta || {};
        const aiCl = await generateCoverLetterWithGemini(
          jobMeta,
          state.profile,
          payload.tone || "Concise & Technical",
          state.settings
        );
        const pdfOut = await generateCoverLetterPdf(
          aiCl.coverLetter,
          { company: jobMeta.company, role: jobMeta.title },
          state.profile,
          state.settings
        );
        const safeComp = String(jobMeta.company || "Target")
          .replace(/[^a-zA-Z0-9]+/g, "_")
          .replace(/^_|_$/g, "")
          .slice(0, 24);
        const fileName = `Raviteja_Velanati_${safeComp || "Cover"}_Cover_Letter.pdf`;
        const saved = await saveCoverLetter({
          company: jobMeta.company || "Target Company",
          role: jobMeta.title || "AI / Software Engineer",
          url: jobMeta.url || "",
          fileName,
          coverLetter: aiCl.coverLetter,
          modelUsed: aiCl.modelUsed,
          fellBack: aiCl.fellBack,
          pdfBase64: pdfOut.pdfBase64
        });
        return { ok: true, record: saved };
      }

      case "ANSWER_APPLICATION_QUESTION": {
        const { questionCtx, jobMeta, saveToVault } = payload;
        // Check saved answers first if exact match requested and not forcing fresh AI
        if (!payload.forceAi) {
          const labelLow = (questionCtx?.label || "").toLowerCase();
          for (const sa of state.savedAnswers || []) {
            if (sa.questionPattern) {
              try {
                const re = new RegExp(sa.questionPattern, "i");
                if (re.test(labelLow) && !questionCtx?.options?.length) {
                  return {
                    ok: true,
                    answer: sa.answer,
                    source: "saved_vault",
                    matchedLabel: sa.questionLabel
                  };
                }
              } catch (_) {}
            }
          }
        }
        const aiAns = await answerApplicationQuestionWithGemini(
          questionCtx,
          jobMeta || {},
          state.profile,
          state.savedAnswers || [],
          state.settings
        );
        if (saveToVault && questionCtx?.label && aiAns.answer) {
          await upsertSavedAnswer({
            questionLabel: questionCtx.label,
            answer: aiAns.answer,
            tags: ["ai-learned"]
          });
        }
        return {
          ok: true,
          answer: aiAns.answer,
          source: "gemini",
          modelUsed: aiAns.modelUsed,
          fellBack: aiAns.fellBack
        };
      }

      case "GENERATE_NETWORK_OUTREACH": {
        const res = await generateNetworkOutreachWithGemini(
          payload.company,
          payload.role,
          payload.url,
          state.profile,
          state.settings
        );
        return { ok: true, ...res };
      }

      case "UPSERT_APPLICATION": {
        const app = await upsertApplication(payload.application);
        return { ok: true, application: app };
      }

      case "DELETE_APPLICATION": {
        const applications = await deleteApplication(payload.id);
        return { ok: true, applications };
      }

      case "UPSERT_SAVED_ANSWER": {
        const item = await upsertSavedAnswer(payload.entry);
        return { ok: true, item };
      }

      case "DELETE_SAVED_ANSWER": {
        const savedAnswers = await deleteSavedAnswer(payload.id);
        return { ok: true, savedAnswers };
      }

      case "FETCH_RECOMMENDED_JOBS": {
        const jobs = await fetchPersonalizedRecommendations(state.profile, payload);
        return { ok: true, jobs };
      }

      case "ENQUEUE_AUTOPILOT": {
        const q = [...(state.autopilotQueue || [])];
        const items = Array.isArray(payload.jobs) ? payload.jobs : [payload.job];
        for (const jb of items) {
          if (!jb?.url) continue;
          if (!q.some((existing) => existing.url === jb.url && existing.status === "Queued")) {
            q.push({
              id: `ap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              company: jb.company || "Company",
              title: jb.title || "Engineer",
              location: jb.location || "",
              ats: jb.ats || "ATS",
              url: jb.url,
              matchScore: jb.matchScore || 85,
              tailorFirst: jb.tailorFirst !== false,
              status: "Queued",
              addedAt: new Date().toISOString()
            });
          }
        }
        await updateAutopilotQueue(q);
        return { ok: true, queue: q };
      }

      case "UPDATE_AUTOPILOT_QUEUE": {
        const queue = await updateAutopilotQueue(payload.queue || []);
        return { ok: true, queue };
      }

      case "RUN_AUTOPILOT_NOW": {
        runAutopilotQueue();
        return { ok: true, message: "Autopilot started." };
      }

      case "STOP_AUTOPILOT": {
        autopilotRunning = false;
        await chrome.alarms.clear("jobify_autopilot_schedule");
        await appendAutopilotLog("Autopilot stopped by user.", "warn");
        return { ok: true };
      }

      case "SCHEDULE_AUTOPILOT": {
        const intervalMinutes = Math.max(5, Number(payload.intervalMinutes || 60));
        await chrome.alarms.create("jobify_autopilot_schedule", {
          delayInMinutes: intervalMinutes,
          periodInMinutes: intervalMinutes
        });
        await appendAutopilotLog(`Autopilot scheduled every ${intervalMinutes} minutes.`, "info");
        return { ok: true, intervalMinutes };
      }

      case "FETCH_IMAP_OTP": {
        const companionUrl = state.settings?.companionServerUrl || "http://127.0.0.1:18765";
        const resp = await fetch(`${companionUrl}/api/imap-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: state.credentials.portalEmail,
            appPassword: state.credentials.gmailAppPassword,
            senderFilter: payload.senderFilter || ""
          })
        });
        const data = await resp.json();
        return { ok: resp.ok, ...data };
      }

      case "OPEN_DASHBOARD": {
        const dashUrl = chrome.runtime.getURL(
          `dashboard/dashboard.html${payload.tab ? "#" + payload.tab : ""}`
        );
        await chrome.tabs.create({ url: dashUrl });
        return { ok: true };
      }

      case "ENSURE_CONTENT_SCRIPTS": {
        const targetTabId = payload.tabId || sender?.tab?.id;
        const ok = await ensureTabScripts(targetTabId);
        return { ok };
      }

      case "RUN_TAB_AUTOFILL": {
        const targetTabId = payload.tabId || sender?.tab?.id;
        return await executeMultiFrameAutofill(targetTabId, payload.options || {});
      }

      case "ATTACH_PDF_ALL_FRAMES": {
        const targetTabId = payload.tabId || sender?.tab?.id;
        if (!targetTabId || !payload.pdfBase64) return { ok: false, attached: 0 };
        await ensureTabScripts(targetTabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId: targetTabId, allFrames: true },
          func: async (base64, fileName) => {
            const adapters = window.__JOBIFY_ADAPTERS__;
            if (!adapters) return 0;
            const fileInputs = Array.from(document.querySelectorAll("input[type='file']")).filter((f) => !f.disabled);
            if (!fileInputs.length) return 0;
            const target =
              document.getElementById("_systemfield_resume") ||
              fileInputs.find((f) => !/cover/i.test(adapters.getFieldLabelText(f))) ||
              fileInputs[0];
            if (!target) return 0;
            await adapters.attachBase64PdfToInput(target, base64, fileName);
            return 1;
          },
          args: [payload.pdfBase64, payload.fileName || "Raviteja_Velanati_Tailored_Resume.pdf"]
        });
        const attached = (results || []).reduce((acc, r) => acc + Number(r?.result || 0), 0);
        return { ok: attached > 0, attached };
      }

      case "OPEN_SIDEPANEL": {
        if (sender?.tab?.windowId && chrome.sidePanel?.open) {
          await chrome.sidePanel.open({ windowId: sender.tab.windowId });
        }
        return { ok: true };
      }

      case "RELOAD_EXTENSION": {
        setTimeout(() => chrome.runtime.reload(), 60);
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown message type: ${type}` };
    }
  })()
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));

  return true; // Keep message channel open for async response
});
