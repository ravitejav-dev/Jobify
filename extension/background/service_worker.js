// Jobify MV3 Background Service Worker — Autonomous Full Auto-Apply, Dual-Engine Gmail OTP & Multi-Frame Autofill
import {
  STORAGE_KEYS,
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
let autoApplyRunning = false;
let autoApplyAbortFlag = false;
let currentAutoApplyStatus = {
  running: false,
  stage: "idle",
  stepLabel: "Idle",
  detail: "",
  completed: false,
  error: null,
  updatedAt: 0
};

const recentSpawnedTabs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.tabs.onCreated.addListener((tab) => {
  recentSpawnedTabs.push({
    id: tab.id,
    openerTabId: tab.openerTabId || null,
    url: tab.pendingUrl || tab.url || "",
    createdAt: Date.now()
  });
  if (recentSpawnedTabs.length > 25) recentSpawnedTabs.shift();
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const t of tabs) {
      if (t.id && !/^https:\/\/mail\.google\.com/i.test(t.url || "")) {
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

async function broadcastAutoApplyProgress(tabId, patch) {
  currentAutoApplyStatus = {
    ...currentAutoApplyStatus,
    ...patch,
    tabId: tabId || currentAutoApplyStatus.tabId || null,
    updatedAt: Date.now()
  };
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_APPLY_SESSION]: currentAutoApplyStatus });
  } catch (_) {}
  if (tabId) {
    chrome.tabs
      .sendMessage(tabId, { type: "AUTO_APPLY_PROGRESS", payload: currentAutoApplyStatus })
      .catch(() => {});
  }
}

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

function waitForTabComplete(tabId, timeoutMs = 15000) {
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
        setTimeout(done, 900);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs
      .get(tabId)
      .then((t) => {
        if (t?.status === "complete") {
          setTimeout(done, 700);
        }
      })
      .catch(() => done());
    setTimeout(done, timeoutMs);
  });
}

async function waitForTabSettle(tabId, minWaitMs = 1300, maxWaitMs = 7000) {
  await sleep(minWaitMs);
  try {
    const t = await chrome.tabs.get(tabId);
    if (t?.status === "loading") {
      await waitForTabComplete(tabId, maxWaitMs);
    }
  } catch (_) {}
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

async function buildAndSaveTailoredResume(jobMeta, state, preferredModel = null) {
  const kw = analyzeJobKeywords(jobMeta.description || "", state.profile);
  const missingList = kw.missing.map((m) => m.keyword);
  const aiRes = await tailorResumeWithGemini(
    jobMeta,
    state.profile,
    missingList,
    state.settings,
    preferredModel
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

  return { record: saved, postScore };
}

async function buildAndSaveCoverLetter(jobMeta, state, tone = "Concise & Technical") {
  const aiCl = await generateCoverLetterWithGemini(jobMeta, state.profile, tone, state.settings);
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
  return saved;
}

// Extract 6-8 digit numeric OTP OR Greenhouse 8-char alphanumeric security code from email text
function extractOtpCodeFromRawText(subj, bodyText) {
  const combined = `${subj || ""}\n${bodyText || ""}`;
  const ghMatch = combined.match(
    /(?:security\s*code|verification\s*code|paste\s*this\s*code[^:]*:|passcode\s*(?:is|:))\s*([A-Za-z0-9]{6,8})\b/i
  );
  if (ghMatch && /\d/.test(ghMatch[1]) && ghMatch[1] !== "94560") {
    return ghMatch[1];
  }
  const ctxNum = combined.match(/(?:code|otp|passcode|verify|verification|pin)[^0-9]{0,40}\b(\d{6,8})\b/i);
  if (ctxNum) {
    return ctxNum[1];
  }
  if (/verify|verification|security\s*code|passcode|one-time|otp|confirm\s*your\s*email/i.test(combined)) {
    const allSix = [...combined.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]);
    const filtered = allSix.find(
      (v) => !["120000", "140000", "115000", "150000", "180000", "000000"].includes(v)
    );
    if (filtered) return filtered;
  }
  return null;
}

// Engine 1: Zero-Backend Signed-In Chrome Gmail Reader (reads Atom feed / basic inbox using existing Chrome session cookies)
async function fetchOtpFromSignedInChromeGmail({ targetEmail = "", sinceEpochMs = 0, senderFilter = "" } = {}) {
  let gmailTabId = null;
  let createdTempTab = false;
  try {
    const existingTabs = await chrome.tabs.query({ url: "https://mail.google.com/*" });
    if (existingTabs.length > 0 && existingTabs[0].id) {
      gmailTabId = existingTabs[0].id;
    } else {
      const tempTab = await chrome.tabs.create({
        url: "https://mail.google.com/mail/u/0/feed/atom",
        active: false
      });
      gmailTabId = tempTab.id;
      createdTempTab = true;
      await waitForTabComplete(gmailTabId, 6500);
    }

    const scriptRes = await chrome.scripting.executeScript({
      target: { tabId: gmailTabId },
      func: async () => {
        const feeds = [
          "https://mail.google.com/mail/u/0/feed/atom",
          "https://mail.google.com/mail/u/1/feed/atom",
          "https://mail.google.com/mail/u/2/feed/atom"
        ];
        const xmlPayloads = [];
        for (const url of feeds) {
          try {
            const r = await fetch(url, { credentials: "include", cache: "no-store" });
            if (r.ok) {
              const txt = await r.text();
              if (txt && txt.includes("<feed")) xmlPayloads.push(txt);
            }
          } catch (_) {}
        }
        const domPreview = (document.body?.innerText || "").slice(0, 8000);
        return { xmlPayloads, domPreview };
      }
    });

    const { xmlPayloads = [], domPreview = "" } = scriptRes?.[0]?.result || {};
    const minTs = sinceEpochMs > 0 ? sinceEpochMs - 120000 : 0;

    for (const xml of xmlPayloads) {
      if (targetEmail && xml.includes("<title>Gmail - Inbox for ") && !xml.toLowerCase().includes(targetEmail.toLowerCase())) {
        // Still inspect if single account, otherwise prefer matching account feed
      }
      const entryBlocks = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
      for (const block of entryBlocks) {
        const title = (block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
        const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] || "")
          .replace(/<!\[CDATA\[|\]\]>/g, "")
          .trim();
        const author = (block.match(/<email>([\s\S]*?)<\/email>/i)?.[1] || "").trim();
        const issued = (block.match(/<issued>([\s\S]*?)<\/issued>/i)?.[1] || "").trim();
        if (minTs > 0 && issued) {
          const parsed = Date.parse(issued);
          if (!Number.isNaN(parsed) && parsed < minTs) continue;
        }
        if (senderFilter && !`${author} ${title} ${summary}`.toLowerCase().includes(senderFilter.toLowerCase())) {
          continue;
        }
        const otp = extractOtpCodeFromRawText(title, summary);
        if (otp) {
          return { ok: true, otp, subject: title, from: author, source: "chrome_gmail_session" };
        }
      }
    }

    if (domPreview) {
      const domOtp = extractOtpCodeFromRawText("Gmail Inbox", domPreview);
      if (domOtp) {
        return { ok: true, otp: domOtp, subject: "Gmail Web Session", from: "Gmail", source: "chrome_gmail_dom" };
      }
    }
    return { ok: false, otp: null };
  } catch (_) {
    return { ok: false, otp: null };
  } finally {
    if (createdTempTab && gmailTabId) {
      chrome.tabs.remove(gmailTabId).catch(() => {});
    }
  }
}

async function fetchOtpDualEngine(state, { tabUrl = "", sinceEpochMs = 0, senderFilter = "" } = {}) {
  const companionUrl = state.settings?.companionServerUrl || "http://127.0.0.1:18765";

  // 1. Local E2E Sandbox OTP Inbox (when testing on localhost / 127.0.0.1)
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(tabUrl)) {
    try {
      const sResp = await fetch(`${companionUrl}/api/sandbox-otp`);
      if (sResp.ok) {
        const sData = await sResp.json();
        if (sData?.otp && (!sinceEpochMs || (sData.timestampMs || 0) >= sinceEpochMs - 30000)) {
          return { ok: true, otp: sData.otp, subject: sData.subject, from: sData.from, source: "sandbox" };
        }
      }
    } catch (_) {}
  }

  // 2. Companion Python IMAP OTP Endpoint (when Gmail App Password is active)
  if (state.credentials?.portalEmail && state.credentials?.gmailAppPassword) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const resp = await fetch(`${companionUrl}/api/imap-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: state.credentials.portalEmail,
          appPassword: state.credentials.gmailAppPassword,
          senderFilter,
          sinceEpochMs
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        if (data?.otp) {
          return { ok: true, otp: data.otp, subject: data.subject, from: data.from, source: "imap" };
        }
      }
    } catch (_) {}
  }

  // 3. Zero-Backend Signed-In Chrome Gmail Session Reader
  return await fetchOtpFromSignedInChromeGmail({
    targetEmail: state.credentials?.portalEmail || "",
    sinceEpochMs,
    senderFilter
  });
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
  let requiresCoverLetter = false;
  let bestMeta = null;
  const filledFieldsLog = [];

  for (const entry of results || []) {
    const r = entry?.result;
    if (!r) continue;
    filledCount += Number(r.filledCount || 0);
    openQuestionsCount += Number(r.openQuestionsCount || 0);
    if (r.clickedApplyGate) clickedApplyGate = true;
    if (r.requiresCoverLetter) requiresCoverLetter = true;
    if (Array.isArray(r.filledFieldsLog)) filledFieldsLog.push(...r.filledFieldsLog);
    if (r.jobMeta && (!bestMeta || r.filledCount > 0)) bestMeta = r.jobMeta;
  }

  return {
    filledCount,
    filledFieldsLog,
    openQuestionsCount,
    clickedApplyGate,
    requiresCoverLetter,
    jobMeta: bestMeta
  };
}

async function executeMultiFrameAutofill(tabId, opts = {}) {
  if (!tabId) return { ok: false, error: "Missing target tabId." };

  const injected = await ensureTabScripts(tabId);
  if (!injected) {
    const localResp = await chrome.tabs
      .sendMessage(tabId, { type: "TRIGGER_LOCAL_AUTOFILL", payload: opts })
      .catch(() => null);
    if (localResp?.ok) return localResp;
    return { ok: false, error: "Cannot inject into restricted browser tab." };
  }

  let pass = await runAutofillPassAcrossFrames(tabId, opts);

  if (pass.filledCount === 0 && pass.clickedApplyGate) {
    await waitForTabComplete(tabId, 5500);
    await ensureTabScripts(tabId);
    pass = await runAutofillPassAcrossFrames(tabId, opts);
  }

  return { ok: true, ...pass };
}

async function inspectTabFrames(tabId, topJobMeta = null) {
  const state = await getAllState();
  let frameResults = [];
  try {
    frameResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (profile, fallbackMeta) => {
        if (!window.__JOBIFY_ADAPTERS__?.inspectAutonomousScreenState) return null;
        return window.__JOBIFY_ADAPTERS__.inspectAutonomousScreenState(profile, fallbackMeta);
      },
      args: [state.profile, topJobMeta]
    });
  } catch (_) {
    try {
      frameResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: (profile, fallbackMeta) => {
          if (!window.__JOBIFY_ADAPTERS__?.inspectAutonomousScreenState) return null;
          return window.__JOBIFY_ADAPTERS__.inspectAutonomousScreenState(profile, fallbackMeta);
        },
        args: [state.profile, topJobMeta]
      });
    } catch (__) {}
  }

  const valid = (frameResults || [])
    .map((entry) => (entry?.result ? { frameId: entry.frameId, ...entry.result } : null))
    .filter(Boolean);

  if (valid.length === 0) {
    return {
      url: "",
      isSubmittedConfirmation: false,
      otpChallenge: { detected: false },
      isStandaloneAuthWall: false,
      inventory: { totalFields: 0, emptyFieldsCount: 0, emptyRequiredCount: 0, requiresCoverLetter: false, fields: [] },
      hasApplyButton: false,
      hasNextButton: false,
      hasSubmitButton: false,
      jobMeta: topJobMeta || {}
    };
  }

  // Merge across top + embedded ATS iframes (e.g. Greenhouse / Ashby / Workday iframe)
  const topFrame = valid.find((v) => v.frameId === 0) || valid[0];
  const submittedFrame = valid.find((v) => v.isSubmittedConfirmation);
  const otpFrame = valid.find((v) => v.otpChallenge?.detected);
  const authFrame = valid.find((v) => v.isStandaloneAuthWall);
  const richestFormFrame = [...valid].sort((a, b) => (b.inventory?.totalFields || 0) - (a.inventory?.totalFields || 0))[0];
  const richestMetaFrame = [...valid].sort(
    (a, b) => (b.jobMeta?.description?.length || 0) - (a.jobMeta?.description?.length || 0)
  )[0];

  const totalFields = valid.reduce((acc, v) => acc + (v.inventory?.totalFields || 0), 0);
  const emptyFieldsCount = valid.reduce((acc, v) => acc + (v.inventory?.emptyFieldsCount || 0), 0);
  const emptyRequiredCount = valid.reduce((acc, v) => acc + (v.inventory?.emptyRequiredCount || 0), 0);
  const requiresCoverLetter = valid.some((v) => v.inventory?.requiresCoverLetter);

  return {
    url: topFrame.url,
    activeFormFrameId: richestFormFrame?.frameId ?? 0,
    authFrameId: authFrame?.frameId ?? 0,
    otpFrameId: otpFrame?.frameId ?? 0,
    isSubmittedConfirmation: Boolean(submittedFrame),
    otpChallenge: otpFrame?.otpChallenge || { detected: false },
    isStandaloneAuthWall: Boolean(authFrame) && totalFields <= 3,
    inventory: {
      totalFields,
      emptyFieldsCount,
      emptyRequiredCount,
      requiresCoverLetter,
      fields: richestFormFrame?.inventory?.fields || []
    },
    hasApplyButton: valid.some((v) => v.hasApplyButton) && totalFields === 0 && !authFrame,
    hasNextButton: valid.some((v) => v.hasNextButton),
    hasSubmitButton: valid.some((v) => v.hasSubmitButton),
    jobMeta: richestMetaFrame?.jobMeta || topFrame.jobMeta || topJobMeta || {}
  };
}

function findSpawnedChildTab(openerTabId, sinceMs) {
  for (let i = recentSpawnedTabs.length - 1; i >= 0; i--) {
    const item = recentSpawnedTabs[i];
    if (item.createdAt >= sinceMs - 200 && item.id !== openerTabId) {
      if (!item.openerTabId || item.openerTabId === openerTabId) {
        return item;
      }
    }
  }
  return null;
}

// End-to-End Autonomous Full Auto-Apply Workflow:
// Pull Job Details -> Tailor Resume (+ Cover Letter if needed) -> Click Apply Now -> Login/Create Account (+ Verify Password) -> Read Email OTP -> Extract & Cleanly Fill 1-by-1 -> Next -> Auto-Submit
async function runFullAutoApplyWorkflow(initialTabId, options = {}) {
  if (!initialTabId) {
    return { ok: false, error: "No active job tab provided." };
  }
  if (autoApplyRunning) {
    return { ok: false, error: "Full Auto-Apply is already running." };
  }

  autoApplyRunning = true;
  autoApplyAbortFlag = false;
  let tabId = initialTabId;
  let totalFilledFields = 0;
  let tailoredResume = null;
  let tailoredCoverLetter = null;
  let authOrSubmitTriggerMs = Date.now();
  const swKeepAliveTimer = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo(() => {});
    } catch (_) {}
  }, 12000);

  try {
    let state = await getAllState();
    await ensureTabScripts(tabId);

    await broadcastAutoApplyProgress(tabId, {
      running: true,
      completed: false,
      error: null,
      stage: "extracting_job",
      stepLabel: "🔍 Step 1: Pulling Job Details & Requirements",
      detail: "Scanning job description, posted salary & application requirements..."
    });

    const initialScreen = await inspectTabFrames(tabId, options.jobMeta || null);
    const jobMeta =
      initialScreen.jobMeta?.description?.length >= (options.jobMeta?.description?.length || 0)
        ? initialScreen.jobMeta
        : options.jobMeta || initialScreen.jobMeta || {};

    // Step 1: Tailor ATS Resume PDF with Gemini
    if (options.tailorResume !== false && (jobMeta.description || "").length > 40) {
      await broadcastAutoApplyProgress(tabId, {
        stage: "tailoring_resume",
        stepLabel: `✨ Step 1: Tailoring Resume for ${jobMeta.company || "Role"}`,
        detail: "Injecting missing ATS keywords & compiling single-column PDF..."
      });
      try {
        const trOut = await buildAndSaveTailoredResume(jobMeta, state, options.preferredModel || null);
        tailoredResume = trOut.record;
      } catch (tailorErr) {
        await appendAutopilotLog(`Resume tailor fallback to default PDF: ${tailorErr.message}`, "warn");
      }
    }

    if (autoApplyAbortFlag) throw new Error("Stopped by user.");

    // Also tailor Cover Letter upfront if JD explicitly mentions/requests one or form requires one
    if (jobMeta.mentionsCoverLetter || initialScreen.inventory?.requiresCoverLetter) {
      await broadcastAutoApplyProgress(tabId, {
        stage: "tailoring_cover_letter",
        stepLabel: "📝 Step 1b: Tailoring Cover Letter PDF",
        detail: "Cover letter requested — drafting concise technical cover letter..."
      });
      try {
        tailoredCoverLetter = await buildAndSaveCoverLetter(jobMeta, state, "Concise & Technical");
      } catch (_) {}
    }

    if (autoApplyAbortFlag) throw new Error("Stopped by user.");

    // Step 2: Click "Apply Now" / "Apply Manually" if we are on the job posting gate
    const preApplyCheck = await inspectTabFrames(tabId, jobMeta);
    if (
      preApplyCheck.hasApplyButton &&
      !preApplyCheck.isStandaloneAuthWall &&
      !preApplyCheck.otpChallenge?.detected &&
      preApplyCheck.inventory.totalFields === 0
    ) {
      await broadcastAutoApplyProgress(tabId, {
        stage: "clicking_apply",
        stepLabel: "🖱️ Step 2: Clicking Apply Now",
        detail: "Opening application portal..."
      });
      const clickTs = Date.now();
      authOrSubmitTriggerMs = clickTs;

      await chrome.scripting
        .executeScript({
          target: { tabId, allFrames: true },
          func: async () => {
            if (!window.__JOBIFY_ADAPTERS__?.clickApplyEntryButton) return null;
            return await window.__JOBIFY_ADAPTERS__.clickApplyEntryButton();
          }
        })
        .catch(() => {});

      await sleep(1500);
      const childTab = findSpawnedChildTab(tabId, clickTs);
      if (childTab?.id) {
        tabId = childTab.id;
        await waitForTabComplete(tabId, 12000);
      } else {
        await waitForTabSettle(tabId, 600, 8000);
      }
      await ensureTabScripts(tabId);
    }

    // Step 3..5: Autonomous Auth + Email OTP + Field Inventory -> Clean 1-by-1 Fill -> Next -> Submit Loop
    let authAttempts = 0;
    for (let stepIdx = 1; stepIdx <= 12; stepIdx++) {
      if (autoApplyAbortFlag) throw new Error("Stopped by user.");

      await ensureTabScripts(tabId);
      state = await getAllState();
      const screen = await inspectTabFrames(tabId, jobMeta);

      // Check A: Submission Confirmation Banner Reached!
      if (screen.isSubmittedConfirmation) {
        await upsertApplication({
          company: jobMeta.company || "Target Company",
          role: jobMeta.title || "AI / Software Engineer",
          location: jobMeta.location || "",
          ats: jobMeta.ats || "Career Portal",
          url: screen.url || jobMeta.url || "",
          status: "Applied",
          matchScore: 94,
          resumeUsed: tailoredResume?.fileName || "Raviteja_Velanati_Resume_1Page.pdf",
          notes: `Full Auto-Apply submitted (${totalFilledFields} fields filled cleanly).`
        });
        await broadcastAutoApplyProgress(tabId, {
          running: false,
          completed: true,
          stage: "completed",
          stepLabel: "✅ Application Submitted!",
          detail: `Logged ${jobMeta.company || "Role"} as Applied (${totalFilledFields} fields filled cleanly).`
        });
        return {
          ok: true,
          submitted: true,
          tabId,
          totalFilledFields,
          tailoredResumeFile: tailoredResume?.fileName || null,
          coverLetterFile: tailoredCoverLetter?.fileName || null
        };
      }

      // Check B: Email OTP / Security Code Challenge Detected!
      if (screen.otpChallenge?.detected) {
        let otpCode = null;
        let otpSource = "";
        for (let poll = 1; poll <= 14; poll++) {
          if (autoApplyAbortFlag) throw new Error("Stopped by user.");
          await broadcastAutoApplyProgress(tabId, {
            stage: "waiting_otp",
            stepLabel: `📨 Reading Email OTP (Attempt ${poll}/14)`,
            detail: `Checking ${state.credentials.portalEmail} for verification code...`
          });
          const otpRes = await fetchOtpDualEngine(state, {
            tabUrl: screen.url,
            sinceEpochMs: authOrSubmitTriggerMs
          });
          if (otpRes?.ok && otpRes.otp) {
            otpCode = otpRes.otp;
            otpSource = otpRes.source || "gmail";
            break;
          }
          await sleep(2800);
        }

        if (!otpCode) {
          await broadcastAutoApplyProgress(tabId, {
            running: false,
            completed: false,
            stage: "paused_otp",
            stepLabel: "⏸️ Waiting for Verification Code",
            detail: `No recent OTP found in ${state.credentials.portalEmail} yet — enter code to finish.`
          });
          return { ok: true, submitted: false, pausedForOtp: true, tabId, totalFilledFields };
        }

        await broadcastAutoApplyProgress(tabId, {
          stage: "filling_otp",
          stepLabel: `🔐 Filling OTP Code (${otpCode})`,
          detail: `Retrieved via ${otpSource} — verifying code & continuing...`
        });

        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: async (code) => {
            if (!window.__JOBIFY_ADAPTERS__?.fillOtpChallengeAndSubmit) return null;
            return await window.__JOBIFY_ADAPTERS__.fillOtpChallengeAndSubmit(code);
          },
          args: [otpCode]
        });

        await waitForTabSettle(tabId, 1500, 7000);
        continue;
      }

      // Check C: Standalone Portal Login / Signup Wall (+ Verify Password)
      if (screen.isStandaloneAuthWall && authAttempts < 3) {
        authAttempts++;
        authOrSubmitTriggerMs = Date.now();
        await broadcastAutoApplyProgress(tabId, {
          stage: "portal_auth",
          stepLabel: "🔐 Portal Login / Create Account",
          detail: `Using ${state.credentials.portalEmail} (auto-handling Verify Password if needed)...`
        });

        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: async (creds) => {
            if (!window.__JOBIFY_ADAPTERS__?.performAutonomousAuth) return null;
            return await window.__JOBIFY_ADAPTERS__.performAutonomousAuth(creds);
          },
          args: [state.credentials]
        });

        await waitForTabSettle(tabId, 1600, 7500);
        continue;
      }

      // Check D: Application Form Step — Extract Inventory -> On-Demand Cover Letter if Required -> Fill 1-by-1 Cleanly
      if (screen.inventory.totalFields > 0) {
        if (screen.inventory.requiresCoverLetter && !tailoredCoverLetter) {
          await broadcastAutoApplyProgress(tabId, {
            stage: "tailoring_cover_letter",
            stepLabel: "📝 Required Cover Letter Detected",
            detail: "Tailoring custom cover letter PDF for this form..."
          });
          try {
            tailoredCoverLetter = await buildAndSaveCoverLetter(jobMeta, state, "Concise & Technical");
          } catch (_) {}
        }

        await broadcastAutoApplyProgress(tabId, {
          stage: "filling_fields",
          stepLabel: `✍️ Filling ${screen.inventory.totalFields} Fields Cleanly (1 by 1)`,
          detail: `Step ${stepIdx}: Filling strictly needed fields & skipping optional fluff...`
        });

        const fillPass = await executeMultiFrameAutofill(tabId, {
          resumeChoice: tailoredResume?.id || state.settings?.defaultResumeVariant || "one_page",
          sequentialOneByOne: true,
          onlyNeededCleanMode: true,
          forceOverwrite: false,
          fillOpenEndedWithAI: true,
          topJobMeta: jobMeta,
          coverLetterRecord: tailoredCoverLetter,
          coverLetterText: tailoredCoverLetter?.coverLetter || "",
          coverLetterPdfPayload: tailoredCoverLetter?.pdfBase64
            ? { fileName: tailoredCoverLetter.fileName, base64: tailoredCoverLetter.pdfBase64 }
            : null
        });

        totalFilledFields += Number(fillPass?.filledCount || 0);
      }

      if (autoApplyAbortFlag) throw new Error("Stopped by user.");

      // Advance Wizard ("Next / Continue") OR Final "Submit Application"
      const allowFinalSubmit = options.autoSubmit !== false;
      const navExec = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: async (allowSub) => {
          if (!window.__JOBIFY_ADAPTERS__?.clickWizardNextOrSubmit) return { action: "none" };
          return await window.__JOBIFY_ADAPTERS__.clickWizardNextOrSubmit({ allowFinalSubmit: allowSub });
        },
        args: [allowFinalSubmit]
      });

      const actions = (navExec || []).map((e) => e?.result).filter(Boolean);
      const nextAct = actions.find((a) => a.action === "next");
      const submitAct = actions.find((a) => a.action === "submit");

      if (nextAct) {
        await broadcastAutoApplyProgress(tabId, {
          stage: "advancing_step",
          stepLabel: `➡️ Advancing Wizard ('${nextAct.buttonText}')`,
          detail: `Filled ${totalFilledFields} fields so far — loading next page...`
        });
        await waitForTabSettle(tabId, 1300, 7000);
        continue;
      }

      if (submitAct) {
        authOrSubmitTriggerMs = Date.now();
        await broadcastAutoApplyProgress(tabId, {
          stage: "submitting",
          stepLabel: `🚀 Submitting Application ('${submitAct.buttonText}')`,
          detail: "Checking for confirmation or post-submit email security code..."
        });
        await waitForTabSettle(tabId, 1800, 7500);

        const postSubmit = await inspectTabFrames(tabId, jobMeta);
        if (postSubmit.otpChallenge?.detected) {
          // Loop continues so Check B reads & enters Greenhouse/ATS post-submit security code!
          continue;
        }

        await upsertApplication({
          company: jobMeta.company || "Target Company",
          role: jobMeta.title || "AI / Software Engineer",
          location: jobMeta.location || "",
          ats: jobMeta.ats || "Career Portal",
          url: postSubmit.url || jobMeta.url || "",
          status: "Applied",
          matchScore: 94,
          resumeUsed: tailoredResume?.fileName || "Raviteja_Velanati_Resume_1Page.pdf",
          notes: `Full Auto-Apply submitted (${totalFilledFields} fields filled cleanly).`
        });

        await broadcastAutoApplyProgress(tabId, {
          running: false,
          completed: true,
          stage: "completed",
          stepLabel: "✅ Application Submitted!",
          detail: `Logged ${jobMeta.company || "Role"} as Applied (${totalFilledFields} fields filled cleanly).`
        });

        return {
          ok: true,
          submitted: true,
          tabId,
          totalFilledFields,
          tailoredResumeFile: tailoredResume?.fileName || null,
          coverLetterFile: tailoredCoverLetter?.fileName || null
        };
      }

      // Neither Next nor Submit clicked
      await broadcastAutoApplyProgress(tabId, {
        running: false,
        completed: true,
        stage: "ready_for_review",
        stepLabel: `✅ Autofilled ${totalFilledFields} Fields Cleanly`,
        detail: allowFinalSubmit
          ? "All visible fields filled — review final screen if custom submit control is present."
          : "Paused before final submit (Review-Before-Submit mode)."
      });
      return {
        ok: true,
        submitted: false,
        tabId,
        totalFilledFields,
        tailoredResumeFile: tailoredResume?.fileName || null,
        coverLetterFile: tailoredCoverLetter?.fileName || null
      };
    }

    return { ok: true, submitted: false, tabId, totalFilledFields };
  } catch (err) {
    await broadcastAutoApplyProgress(tabId, {
      running: false,
      completed: false,
      error: err?.message || String(err),
      stage: "error",
      stepLabel: "⚠️ Auto-Apply Paused",
      detail: err?.message || String(err)
    });
    return { ok: false, error: err?.message || String(err), totalFilledFields };
  } finally {
    clearInterval(swKeepAliveTimer);
    autoApplyRunning = false;
  }
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

        const execResp = await runFullAutoApplyWorkflow(tab.id, {
          autoSubmit: state.settings.autopilotMode === "full_auto",
          tailorResume: item.tailorFirst !== false
        });

        const updatedState = await getAllState();
        const q2 = [...updatedState.autopilotQueue];
        const i2 = q2.findIndex((q) => q.id === item.id);
        if (i2 >= 0) {
          q2[i2].status = execResp?.submitted
            ? "Submitted"
            : execResp?.totalFilledFields > 0
            ? "Autofilled (Ready)"
            : "Opened / Needs Review";
          q2[i2].filledCount = execResp?.totalFilledFields || 0;
          q2[i2].completedAt = new Date().toISOString();
          await updateAutopilotQueue(q2);
        }

        await appendAutopilotLog(
          `Completed ${item.company} — ${execResp?.totalFilledFields || 0} fields autofilled${execResp?.submitted ? " & submitted!" : " (paused for review)."}`,
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
        return { ok: true, state, autoApplyStatus: currentAutoApplyStatus };
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
          chrome.action
            .setBadgeBackgroundColor({
              color: match.matchScore >= 80 ? "#10b981" : match.matchScore >= 60 ? "#f59e0b" : "#ef4444",
              tabId: sender.tab.id
            })
            .catch(() => {});
        }
        return { ok: true, match, atsScore, referrals };
      }

      case "GET_RESUME_PDF_BYTES": {
        const pdfPayload = await getResumePdfPayload(payload.variantOrId, state);
        return { ok: true, ...pdfPayload };
      }

      case "TAILOR_RESUME": {
        const out = await buildAndSaveTailoredResume(
          payload.jobMeta || {},
          state,
          payload.preferredModel || null
        );
        return { ok: true, ...out };
      }

      case "GENERATE_COVER_LETTER": {
        const saved = await buildAndSaveCoverLetter(
          payload.jobMeta || {},
          state,
          payload.tone || "Concise & Technical"
        );
        return { ok: true, record: saved };
      }

      case "ANSWER_APPLICATION_QUESTION": {
        const { questionCtx, jobMeta, saveToVault } = payload;
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
        autoApplyAbortFlag = true;
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

      case "START_FULL_AUTO_APPLY": {
        const targetTabId = payload.tabId || sender?.tab?.id;
        if (!targetTabId) return { ok: false, error: "No active tab found." };
        if (payload.awaitCompletion) {
          return await runFullAutoApplyWorkflow(targetTabId, payload.options || {});
        }
        runFullAutoApplyWorkflow(targetTabId, payload.options || {});
        return { ok: true, started: true, tabId: targetTabId };
      }

      case "STOP_FULL_AUTO_APPLY": {
        autoApplyAbortFlag = true;
        return { ok: true, stopping: true };
      }

      case "GET_AUTO_APPLY_STATUS": {
        return { ok: true, status: currentAutoApplyStatus };
      }

      case "FETCH_IMAP_OTP": {
        const res = await fetchOtpDualEngine(state, {
          tabUrl: sender?.tab?.url || payload.tabUrl || "",
          sinceEpochMs: payload.sinceEpochMs || 0,
          senderFilter: payload.senderFilter || ""
        });
        return res;
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

  return true;
});
