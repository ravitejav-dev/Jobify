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
  generateNetworkOutreachWithGemini,
  diagnoseFormErrorsWithGemini
} from "../shared/gemini_client.js";
import {
  generateTailoredResumePdf,
  generateCoverLetterPdf,
  formatCompanyResumeFileName
} from "../shared/pdf_generator.js";
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

async function getResumePdfPayload(variantOrId, state, companyName = "") {
  if (variantOrId && variantOrId.startsWith("tr_")) {
    const tr = (state.tailoredResumes || []).find((r) => r.id === variantOrId);
    if (tr?.pdfBase64) {
      return {
        fileName: formatCompanyResumeFileName(companyName || tr.company),
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
      fileName: companyName ? formatCompanyResumeFileName(companyName) : resumeEntry.name || "Raviteja_velanati_Resume.pdf",
      mimeType: "application/pdf",
      base64: resumeEntry.customBase64
    };
  }

  const assetPath =
    selectedVariant === "master"
      ? "assets/Raviteja_Velanati_Master_Resume.pdf"
      : "assets/Raviteja_Velanati_Resume_1Page.pdf";
  const fileName = formatCompanyResumeFileName(
    companyName,
    selectedVariant === "master" ? "Master_Resume" : "Resume"
  );

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
  let aiRes = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      aiRes = await tailorResumeWithGemini(
        jobMeta,
        state.profile,
        missingList,
        state.settings,
        preferredModel
      );
      if (aiRes?.tailored) break;
    } catch (_) {
      if (attempt === 1) await sleep(1000);
    }
  }

  if (!aiRes?.tailored) {
    const prof = state.profile || {};
    aiRes = {
      tailored: {
        targetJobTitle: String(jobMeta.title || "Software Engineer").trim(),
        summary: prof.summaryShort || prof.summary || "",
        skillsCategories: prof.skillsCategories || {},
        experience: (prof.workExperience || []).map((w, idx) => ({
          company: w.company,
          title: w.title,
          location: w.location,
          period: `${w.startDateDisplay || ""} - ${w.endDateDisplay || ""}`.trim(),
          bullets: (w.bullets || w.highlights || []).slice(0, idx === 0 ? 5 : idx === 1 ? 3 : 2)
        })),
        projects: (prof.projects || []).slice(0, 2)
      },
      modelUsed: "profile-fallback",
      requestedModel: preferredModel || state.settings?.primaryModel || "gemini-3.5-flash",
      fellBack: true
    };
  }

  const pdfOut = await generateTailoredResumePdf(aiRes.tailored, state.profile, state.settings);
  const postScore = scoreResumeATS(state.profile, jobMeta.description || "", aiRes.tailored);
  const fileName = formatCompanyResumeFileName(jobMeta.company);

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
  let coverLetterText = "";
  let modelUsed = "fallback-template";
  let fellBack = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const aiCl = await generateCoverLetterWithGemini(jobMeta, state.profile, tone, state.settings);
      if (aiCl?.coverLetter?.trim()) {
        coverLetterText = aiCl.coverLetter.trim();
        modelUsed = aiCl.modelUsed || "gemini";
        fellBack = Boolean(aiCl.fellBack);
        break;
      }
    } catch (_) {
      if (attempt === 1) await sleep(1000);
    }
  }

  if (!coverLetterText) {
    const p = state.profile?.personal || {};
    const comp = jobMeta.company || "your engineering team";
    const role = jobMeta.title || "Software & AI Engineer";
    coverLetterText =
      `Dear ${jobMeta.company ? jobMeta.company + " Hiring Team," : "Hiring Team,"}\n\n` +
      `I am writing to apply for the ${role} role at ${comp}. As a ${p.currentTitle || "Senior AI Solutions Engineer"} at ${p.currentCompany || "GlobalLogic (Client: Google AI)"}, I architect autonomous browser-agent evaluation sandboxes, synthetic multi-service test pipelines across 48 personas and 9 cloud services, and high-throughput LLM regression infrastructure.\n\n` +
      `Over the past two years supporting Google AI, I built 13 full-stack sandboxed web applications for agentic testing, delivered 19 Side-by-Side (SxS) evaluation plugins, and ranked #1 of 11 engineers in platform throughput across 2,000+ batches and 460+ workflows while reducing sandbox initialization latency by 70%.\n\n` +
      `With an M.S. in Computer Science from Clark University and hands-on production experience across Python, TypeScript, React, FastAPI, LangGraph, Docker, Kubernetes, and GCP, I would welcome the opportunity to contribute to ${comp}'s engineering roadmap.\n\n` +
      `Best regards,\n${p.fullName || "Raviteja Velanati"}`;
    fellBack = true;
  }

  const pdfOut = await generateCoverLetterPdf(
    coverLetterText,
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
    coverLetter: coverLetterText,
    modelUsed,
    fellBack,
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

function extractVerificationLinkFromRawText(subj, bodyText) {
  const combined = `${subj || ""}\n${bodyText || ""}`
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/=\r?\n/g, "");
  if (!/verify|activate|confirm|workday|candidate|account|welcome/i.test(combined)) {
    return null;
  }
  const urls = [...combined.matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)].map((m) =>
    m[0].replace(/[.,;!?]+$/, "")
  );
  const filtered = urls.filter(
    (u) =>
      !/unsubscribe|privacy|terms|support\.google|linkedin\.com|twitter\.com|facebook\.com|instagram\.com|fonts\.googleapis|\.(png|jpg|jpeg|gif|svg|css|ico)(\?|$)/i.test(
        u
      )
  );
  return (
    filtered.find((u) =>
      /verify|activate|confirm|validation|token=|myworkdayjobs\.com|myworkdaysite\.com|wd\d+\.myworkday/i.test(u)
    ) || null
  );
}

async function fetchVerificationLinkDualEngine(state, { tabUrl = "", sinceEpochMs = 0, senderFilter = "" } = {}) {
  const companionUrl = state.settings?.companionServerUrl || "http://127.0.0.1:18765";

  // 1. Local E2E Sandbox Verification Link Inbox
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(tabUrl)) {
    try {
      const sResp = await fetch(`${companionUrl}/api/sandbox-otp`);
      if (sResp.ok) {
        const sData = await sResp.json();
        if (
          sData?.verificationUrl &&
          (!sinceEpochMs || (sData.timestampMs || 0) >= sinceEpochMs - 30000)
        ) {
          return {
            ok: true,
            verificationUrl: sData.verificationUrl,
            subject: sData.subject,
            from: sData.from,
            source: "sandbox"
          };
        }
      }
    } catch (_) {}
  }

  // 2. Companion Python IMAP Endpoint
  if (state.credentials?.portalEmail && state.credentials?.gmailAppPassword) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7500);
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
        if (data?.verificationUrl) {
          return {
            ok: true,
            verificationUrl: data.verificationUrl,
            subject: data.subject,
            from: data.from,
            source: "imap"
          };
        }
      }
    } catch (_) {}
  }

  // 3. Zero-Backend Signed-In Chrome Gmail Session Reader
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
        const feeds = ["https://mail.google.com/mail/u/0/feed/atom", "https://mail.google.com/mail/u/1/feed/atom"];
        const xmlPayloads = [];
        for (const u of feeds) {
          try {
            const r = await fetch(u, { credentials: "include", cache: "no-store" });
            if (r.ok) {
              const t = await r.text();
              if (t && t.includes("<feed")) xmlPayloads.push(t);
            }
          } catch (_) {}
        }
        return { xmlPayloads };
      }
    });
    const minTs = sinceEpochMs > 0 ? sinceEpochMs - 120000 : 0;
    for (const xml of scriptRes?.[0]?.result?.xmlPayloads || []) {
      const entryBlocks = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
      for (const block of entryBlocks) {
        const title = (block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
        const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] || "").trim();
        const issued = (block.match(/<issued>([\s\S]*?)<\/issued>/i)?.[1] || "").trim();
        if (minTs > 0 && issued) {
          const parsed = Date.parse(issued);
          if (!Number.isNaN(parsed) && parsed < minTs) continue;
        }
        const vUrl = extractVerificationLinkFromRawText(title, summary);
        if (vUrl) {
          return { ok: true, verificationUrl: vUrl, subject: title, source: "chrome_gmail_session" };
        }
      }
    }
  } catch (_) {
  } finally {
    if (createdTempTab && gmailTabId) {
      chrome.tabs.remove(gmailTabId).catch(() => {});
    }
  }

  return { ok: false, verificationUrl: null };
}

async function activateEmailVerificationLink(verificationUrl) {
  if (!verificationUrl) return false;
  let tempTabId = null;
  try {
    const t = await chrome.tabs.create({ url: verificationUrl, active: false });
    tempTabId = t.id;
    await waitForTabComplete(tempTabId, 9000);
    await sleep(1400);
    return true;
  } catch (_) {
    return false;
  } finally {
    if (tempTabId) {
      chrome.tabs.remove(tempTabId).catch(() => {});
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

async function executeAdapterAcrossTab(tabId, method, args = []) {
  let frameResults = [];
  try {
    frameResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: async (fnName, fnArgs) => {
        const fn = window.__JOBIFY_ADAPTERS__?.[fnName];
        if (typeof fn !== "function") return null;
        return await fn(...(fnArgs || []));
      },
      args: [method, args]
    });
  } catch (_) {
    try {
      frameResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (fnName, fnArgs) => {
          const fn = window.__JOBIFY_ADAPTERS__?.[fnName];
          if (typeof fn !== "function") return null;
          return await fn(...(fnArgs || []));
        },
        args: [method, args]
      });
    } catch (__) {
      const rpcResp = await chrome.tabs
        .sendMessage(tabId, { type: "ADAPTER_RPC", payload: { method, args } })
        .catch(() => null);
      if (rpcResp?.ok && rpcResp.result !== undefined) {
        frameResults = [{ frameId: 0, result: rpcResp.result }];
      }
    }
  }
  return frameResults || [];
}

async function executeMultiFrameValidationHeal(tabId, opts = {}) {
  if (!tabId) return { healedCount: 0, aiRepairsApplied: 0, analysisSummary: "", remainingErrors: [] };
  await ensureTabScripts(tabId);
  const frameResults = await executeAdapterAcrossTab(tabId, "healFormValidationErrors", [opts]);

  let healedCount = 0;
  let aiRepairsApplied = 0;
  const summaries = [];
  const remainingErrors = [];
  let hardBlocker = { blocked: false, reason: null };
  for (const entry of frameResults || []) {
    const r = entry?.result;
    if (!r) continue;
    healedCount += Number(r.healedCount || 0);
    aiRepairsApplied += Number(r.aiRepairsApplied || 0);
    if (r.analysisSummary) summaries.push(r.analysisSummary);
    if (Array.isArray(r.remainingErrors?.messages)) {
      remainingErrors.push(...r.remainingErrors.messages);
    }
    if (r.hardBlocker?.blocked) {
      hardBlocker = r.hardBlocker;
    }
  }
  return {
    healedCount,
    aiRepairsApplied,
    analysisSummary: summaries[0] || "",
    remainingErrors,
    hardBlocker
  };
}

async function waitForActionableJobScreen(tabId, topJobMeta = null, maxWaitMs = 6000) {
  const start = Date.now();
  let last = await inspectTabFrames(tabId, topJobMeta);
  while (Date.now() - start < maxWaitMs) {
    if (
      last.isSubmittedConfirmation ||
      last.hasCandidateForm ||
      last.hasApplyChoiceModal ||
      last.hasApplyButton ||
      last.isStandaloneAuthWall ||
      last.otpChallenge?.detected ||
      (last.inventory?.totalFields || 0) > 0
    ) {
      return last;
    }
    await sleep(480);
    await ensureTabScripts(tabId);
    last = await inspectTabFrames(tabId, topJobMeta);
  }
  return last;
}

async function inspectTabFrames(tabId, topJobMeta = null) {
  const state = await getAllState();
  const frameResults = await executeAdapterAcrossTab(tabId, "inspectAutonomousScreenState", [
    state.profile,
    topJobMeta
  ]);

  const valid = (frameResults || [])
    .map((entry) => (entry?.result ? { frameId: entry.frameId ?? 0, ...entry.result } : null))
    .filter(Boolean);

  if (valid.length === 0) {
    return {
      url: "",
      stepSignature: "",
      isSubmittedConfirmation: false,
      otpChallenge: { detected: false },
      isStandaloneAuthWall: false,
      hasApplyChoiceModal: false,
      needsEmailVerificationBanner: false,
      hasCandidateForm: false,
      hasValidationErrors: false,
      validationErrors: [],
      hardBlocker: { blocked: false, reason: null },
      inventory: { totalFields: 0, emptyFieldsCount: 0, emptyRequiredCount: 0, requiresCoverLetter: false, fields: [] },
      hasApplyButton: false,
      hasNextButton: false,
      hasSubmitButton: false,
      hasDisabledSubmit: false,
      jobMeta: topJobMeta || {}
    };
  }

  // Merge across top + embedded ATS iframes (e.g. Greenhouse / Ashby / Workday iframe)
  const topFrame = valid.find((v) => v.frameId === 0) || valid[0];
  const submittedFrame = valid.find((v) => v.isSubmittedConfirmation);
  const otpFrame = valid.find((v) => v.otpChallenge?.detected);
  const authFrame = valid.find((v) => v.isStandaloneAuthWall);
  const hasApplyChoiceModal = valid.some((v) => v.hasApplyChoiceModal);
  const needsEmailVerificationBanner = valid.some((v) => v.needsEmailVerificationBanner);
  const hasCandidateForm = valid.some((v) => v.hasCandidateForm);
  const richestFormFrame = [...valid].sort((a, b) => (b.inventory?.totalFields || 0) - (a.inventory?.totalFields || 0))[0];
  const richestMetaFrame = [...valid].sort(
    (a, b) => (b.jobMeta?.description?.length || 0) - (a.jobMeta?.description?.length || 0)
  )[0];

  const totalFields = valid.reduce((acc, v) => acc + (v.inventory?.totalFields || 0), 0);
  const emptyFieldsCount = valid.reduce((acc, v) => acc + (v.inventory?.emptyFieldsCount || 0), 0);
  const emptyRequiredCount = valid.reduce((acc, v) => acc + (v.inventory?.emptyRequiredCount || 0), 0);
  const requiresCoverLetter = valid.some((v) => v.inventory?.requiresCoverLetter);
  const validationErrors = valid.flatMap((v) => v.validationErrors || []).slice(0, 8);
  const hardBlockerFrame = valid.find((v) => v.hardBlocker?.blocked);
  const stepSignature = valid.map((v) => `${v.frameId}:${v.stepSignature || ""}`).join("||");

  return {
    url: topFrame.url,
    stepSignature,
    activeFormFrameId: richestFormFrame?.frameId ?? 0,
    authFrameId: authFrame?.frameId ?? 0,
    otpFrameId: otpFrame?.frameId ?? 0,
    isSubmittedConfirmation: Boolean(submittedFrame),
    otpChallenge: otpFrame?.otpChallenge || { detected: false },
    hasApplyChoiceModal,
    needsEmailVerificationBanner,
    hasCandidateForm,
    hasValidationErrors: validationErrors.length > 0,
    validationErrors,
    hardBlocker: hardBlockerFrame?.hardBlocker || { blocked: false, reason: null },
    isStandaloneAuthWall:
      Boolean(authFrame) &&
      !hasApplyChoiceModal &&
      !valid.some((v) => v.frameId !== authFrame.frameId && v.hasCandidateForm),
    inventory: {
      totalFields,
      emptyFieldsCount,
      emptyRequiredCount,
      requiresCoverLetter,
      fields: richestFormFrame?.inventory?.fields || []
    },
    hasApplyButton:
      (hasApplyChoiceModal || valid.some((v) => v.hasApplyButton)) &&
      !hasCandidateForm &&
      !authFrame &&
      !otpFrame,
    hasNextButton: valid.some((v) => v.hasNextButton),
    hasSubmitButton: valid.some((v) => v.hasSubmitButton),
    hasDisabledSubmit: valid.some((v) => v.hasDisabledSubmit),
    jobMeta: richestMetaFrame?.jobMeta || topFrame.jobMeta || topJobMeta || {}
  };
}

// Accurately verify whether a Submit click succeeded, triggered OTP, or was blocked by form validation
async function waitForPostSubmitOutcome(tabId, preSubmitScreen, jobMeta, hadHtml5Invalid = false) {
  await waitForTabSettle(tabId, 450, 3200);
  let formGoneStreak = 0;
  let lastScreen = null;

  for (let tick = 0; tick < 12; tick++) {
    await ensureTabScripts(tabId);
    const s = await inspectTabFrames(tabId, jobMeta);
    lastScreen = s;

    if (s.isSubmittedConfirmation) {
      return { outcome: "confirmed", screen: s };
    }
    if (s.otpChallenge?.detected) {
      return { outcome: "otp", screen: s };
    }

    const hadFormBefore = Boolean(preSubmitScreen?.hasCandidateForm || (preSubmitScreen?.inventory?.totalFields || 0) > 0);
    if (hadFormBefore && !s.hasSubmitButton && !s.hasCandidateForm && !s.hasValidationErrors && !s.isStandaloneAuthWall) {
      formGoneStreak++;
      if (formGoneStreak >= 2) {
        return { outcome: "confirmed", screen: s };
      }
    } else {
      formGoneStreak = 0;
    }

    if (tick >= 1 && s.hasSubmitButton && (s.hasValidationErrors || hadHtml5Invalid || s.hardBlocker?.blocked)) {
      return { outcome: "validation_blocked", screen: s };
    }

    await sleep(420);
  }

  if (lastScreen && !lastScreen.hasSubmitButton && !lastScreen.hasCandidateForm && !lastScreen.hasValidationErrors) {
    return { outcome: "confirmed", screen: lastScreen };
  }
  return { outcome: "still_on_form", screen: lastScreen };
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
// Pull Job Details -> Tailor Resume (+ Cover Letter if needed) -> Click Apply / Modal Apply Manually -> SSO Email Gate -> Create Account / Login (+ Verify Password + Email Link/OTP) -> Extract & Cleanly Fill 1-by-1 -> Next -> Auto-Submit
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
  const authHistory = { triedSignIn: false, createdAccount: false, verifiedEmailLink: false };
  const swKeepAliveTimer = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo(() => {});
    } catch (_) {}
  }, 12000);

  const pollAndActivateVerificationLink = async (currentState, screenUrl) => {
    for (let poll = 1; poll <= 10; poll++) {
      if (autoApplyAbortFlag) throw new Error("Stopped by user.");
      await broadcastAutoApplyProgress(tabId, {
        stage: "verifying_email_link",
        stepLabel: `📧 Checking Email for Verification Link (${poll}/10)`,
        detail: `Looking for account activation email in ${currentState.credentials.portalEmail}...`
      });
      const linkRes = await fetchVerificationLinkDualEngine(currentState, {
        tabUrl: screenUrl,
        sinceEpochMs: authOrSubmitTriggerMs
      });
      if (linkRes?.ok && linkRes.verificationUrl) {
        await broadcastAutoApplyProgress(tabId, {
          stage: "activating_email_link",
          stepLabel: "🔗 Activating Candidate Account via Email Link",
          detail: `Verified via ${linkRes.source} — completing portal sign-in...`
        });
        await activateEmailVerificationLink(linkRes.verificationUrl);
        authHistory.verifiedEmailLink = true;
        await sleep(700);
        return true;
      }
      await sleep(2400);
    }
    return false;
  };

  try {
    let state = await getAllState();
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch (_) {}
    await ensureTabScripts(tabId);

    await broadcastAutoApplyProgress(tabId, {
      running: true,
      completed: false,
      error: null,
      stage: "extracting_job",
      stepLabel: "🤖 Taking Control — Pulling Job Details & Requirements",
      detail: "Scanning job description, posted salary & application portal controls..."
    });

    const initialScreen = await waitForActionableJobScreen(tabId, options.jobMeta || null, 6500);
    const jobMeta =
      initialScreen.jobMeta?.description?.length >= (options.jobMeta?.description?.length || 0)
        ? initialScreen.jobMeta
        : options.jobMeta || initialScreen.jobMeta || {};

    // Step 1: Tailor ATS Resume PDF & Requested Cover Letter PDF in Parallel
    const needResumeTailor = options.tailorResume !== false && (jobMeta.description || "").length > 40;
    const needCoverLetter = Boolean(jobMeta.mentionsCoverLetter || initialScreen.inventory?.requiresCoverLetter);

    if (needResumeTailor || needCoverLetter) {
      await broadcastAutoApplyProgress(tabId, {
        stage: needResumeTailor ? "tailoring_resume" : "tailoring_cover_letter",
        stepLabel:
          needResumeTailor && needCoverLetter
            ? `✨ Step 1: Tailoring Resume & Cover Letter for ${jobMeta.company || "Role"}`
            : needResumeTailor
              ? `✨ Step 1: Tailoring Resume for ${jobMeta.company || "Role"}`
              : "📝 Step 1: Tailoring Cover Letter PDF",
        detail: "Injecting ATS keywords & compiling publication-grade PDF documents..."
      });

      const tasks = [];
      if (needResumeTailor) {
        tasks.push(
          buildAndSaveTailoredResume(jobMeta, state, options.preferredModel || null)
            .then((trOut) => {
              tailoredResume = trOut.record;
            })
            .catch((tailorErr) =>
              appendAutopilotLog(`Resume tailor fallback to default PDF: ${tailorErr.message}`, "warn")
            )
        );
      }
      if (needCoverLetter) {
        tasks.push(
          buildAndSaveCoverLetter(jobMeta, state, "Concise & Technical")
            .then((clRec) => {
              tailoredCoverLetter = clRec;
            })
            .catch(() => {})
        );
      }
      await Promise.all(tasks);
      // Reload state after parallel storage writes so both tailoredResume & tailoredCoverLetter are reflected
      state = await getAllState();
    }

    if (autoApplyAbortFlag) throw new Error("Stopped by user.");

    // Step 2: Click "Apply Now" / Workday "Apply" -> "Apply Manually" modal if on the job posting gate
    const preApplyCheck = await waitForActionableJobScreen(tabId, jobMeta, 4500);
    let applyGateClicks = 0;
    if (
      preApplyCheck.hasApplyChoiceModal ||
      (preApplyCheck.hasApplyButton &&
        !preApplyCheck.isStandaloneAuthWall &&
        !preApplyCheck.otpChallenge?.detected)
    ) {
      applyGateClicks++;
      await broadcastAutoApplyProgress(tabId, {
        stage: "clicking_apply",
        stepLabel: preApplyCheck.hasApplyChoiceModal
          ? "🖱️ Step 2: Selecting 'Apply Manually'"
          : "🖱️ Step 2: Clicking Apply & Selecting Manual Flow",
        detail: "Opening candidate application portal..."
      });
      const clickTs = Date.now();
      authOrSubmitTriggerMs = clickTs;

      await executeAdapterAcrossTab(tabId, "clickApplyEntryButton", []);

      await sleep(1200);
      const childTab = findSpawnedChildTab(tabId, clickTs);
      if (childTab?.id) {
        tabId = childTab.id;
        await waitForTabComplete(tabId, 12000);
      } else {
        await waitForTabSettle(tabId, 700, 8500);
      }
      await ensureTabScripts(tabId);
      await waitForActionableJobScreen(tabId, jobMeta, 5500);
    }

    // Step 3..6: Autonomous Modal/Apply Gate + Multi-Stage Auth + Email OTP/Link + Clean 1-by-1 Fill + Next + Self-Healing Auto-Submit Loop
    let authAttempts = 0;
    let nextHealAttempts = 0;
    let submitHealAttempts = 0;
    let skipNextCleanFillOnce = false;

    const buildHealOptions = (currentState) => ({
      resumeChoice: tailoredResume?.id || currentState.settings?.defaultResumeVariant || "one_page",
      topJobMeta: jobMeta,
      coverLetterRecord: tailoredCoverLetter,
      coverLetterText: tailoredCoverLetter?.coverLetter || "",
      coverLetterPdfPayload: tailoredCoverLetter?.pdfBase64
        ? { fileName: tailoredCoverLetter.fileName, base64: tailoredCoverLetter.pdfBase64 }
        : null
    });

    for (let stepIdx = 1; stepIdx <= 20; stepIdx++) {
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
          resumeUsed: tailoredResume?.fileName || formatCompanyResumeFileName(jobMeta.company),
          notes: `Full Auto-Apply submitted (${totalFilledFields} fields filled cleanly).`
        });
        chrome.action.setBadgeText({ text: "✓", tabId }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: "#10b981", tabId }).catch(() => {});
        await broadcastAutoApplyProgress(tabId, {
          running: false,
          completed: true,
          stage: "completed",
          stepLabel: "✅ Application Submitted!",
          detail: `Logged ${jobMeta.company || "Role"} as Applied — returning to Extensions.`
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

      // Check A2: Open "Start Your Application" Choice Modal ("Apply Manually") OR Secondary Tab Apply Gate!
      if ((screen.hasApplyChoiceModal || (screen.hasApplyButton && !screen.hasCandidateForm)) && applyGateClicks < 3) {
        applyGateClicks++;
        await broadcastAutoApplyProgress(tabId, {
          stage: "clicking_apply",
          stepLabel: screen.hasApplyChoiceModal
            ? "🖱️ Selecting 'Apply Manually' in Modal"
            : "🖱️ Clicking Apply Entry Button",
          detail: "Advancing past portal entry gate..."
        });
        const gateTs = Date.now();
        authOrSubmitTriggerMs = gateTs;
        await executeAdapterAcrossTab(tabId, "clickApplyEntryButton", []);

        await sleep(1100);
        const childTab = findSpawnedChildTab(tabId, gateTs);
        if (childTab?.id) {
          tabId = childTab.id;
          await waitForTabComplete(tabId, 12000);
        } else {
          await waitForTabSettle(tabId, 700, 8000);
        }
        continue;
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

        await executeAdapterAcrossTab(tabId, "fillOtpChallengeAndSubmit", [otpCode]);

        await waitForTabSettle(tabId, 1500, 7000);
        continue;
      }

      // Check B2: Email Verification / Activation Link Banner Detected!
      if (screen.needsEmailVerificationBanner && !authHistory.verifiedEmailLink) {
        const activated = await pollAndActivateVerificationLink(state, screen.url);
        if (activated) {
          await waitForTabSettle(tabId, 900, 5000);
          continue;
        }
      }

      // Check C: Standalone Portal Auth ("Sign in with email" -> Create Account <-> Sign In -> Post-Signup Sign In!)
      if (screen.isStandaloneAuthWall && authAttempts < 6) {
        authAttempts++;
        authOrSubmitTriggerMs = Date.now();
        await broadcastAutoApplyProgress(tabId, {
          stage: "portal_auth",
          stepLabel: screen.hasEmailAuthGate
            ? "🔐 Selecting 'Sign in with Email' & Authenticating"
            : authHistory.createdAccount
            ? "🔐 Completing Post-Signup Portal Sign In"
            : "🔐 Portal Sign In / Create Account",
          detail: `Using ${state.credentials.portalEmail} (handling Create Account + Sign In + Verify Password)...`
        });

        const authExec = await executeAdapterAcrossTab(tabId, "performAutonomousAuth", [
          state.credentials,
          authHistory
        ]);

        let needsVerifyLinkNow = false;
        for (const entry of authExec || []) {
          const r = entry?.result;
          if (!r) continue;
          if (r.createdAccount) authHistory.createdAccount = true;
          if (r.triedSignIn) authHistory.triedSignIn = true;
          if (r.needsEmailVerification) needsVerifyLinkNow = true;
        }

        const childTabAfterAuth = findSpawnedChildTab(tabId, authOrSubmitTriggerMs);
        if (childTabAfterAuth?.id) {
          tabId = childTabAfterAuth.id;
          await waitForTabComplete(tabId, 12000);
        } else {
          await waitForTabSettle(tabId, 1500, 7500);
        }

        if (needsVerifyLinkNow && !authHistory.verifiedEmailLink) {
          await pollAndActivateVerificationLink(state, screen.url);
        }
        continue;
      }

      // Check D: Application Form Step — Extract Inventory -> On-Demand Cover Letter if Required -> Fill 1-by-1 Cleanly
      if (screen.inventory.totalFields > 0 && !skipNextCleanFillOnce) {
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
          detail: `Step ${stepIdx}: Filling needed fields, checkboxes & required questions...`
        });

        const fillPass = await executeMultiFrameAutofill(tabId, {
          ...buildHealOptions(state),
          sequentialOneByOne: true,
          onlyNeededCleanMode: true,
          forceOverwrite: false,
          fillOpenEndedWithAI: true
        });

        totalFilledFields += Number(fillPass?.filledCount || 0);
      }
      skipNextCleanFillOnce = false;

      if (autoApplyAbortFlag) throw new Error("Stopped by user.");

      // Advance Wizard ("Next / Continue") OR Final "Submit Application"
      const allowFinalSubmit =
        options.autoSubmit !== undefined
          ? Boolean(options.autoSubmit)
          : state.settings?.autoSubmitEnabled !== false;

      const navExec = await executeAdapterAcrossTab(tabId, "clickWizardNextOrSubmit", [
        { allowFinalSubmit }
      ]);

      const actions = (navExec || []).map((e) => e?.result).filter(Boolean);
      const nextAct = actions.find((a) => a.action === "next");
      const submitAct = actions.find((a) => a.action === "submit");
      const hasDisabledSubmit = actions.some((a) => a.hasDisabledSubmit);

      if (nextAct) {
        await broadcastAutoApplyProgress(tabId, {
          stage: "advancing_step",
          stepLabel: `➡️ Advancing Wizard ('${nextAct.buttonText}')`,
          detail: `Filled ${totalFilledFields} fields so far — checking next step...`
        });
        await waitForTabSettle(tabId, 1100, 6500);

        const afterNext = await inspectTabFrames(tabId, jobMeta);
        if (
          !afterNext.isSubmittedConfirmation &&
          !afterNext.otpChallenge?.detected &&
          !afterNext.isStandaloneAuthWall &&
          (afterNext.stepSignature === screen.stepSignature || afterNext.hasValidationErrors || nextAct.hadHtml5Invalid) &&
          nextHealAttempts < 4
        ) {
          nextHealAttempts++;
          await broadcastAutoApplyProgress(tabId, {
            stage: "healing_validation",
            stepLabel: `🧠 AI Analyzing Wizard Error (${nextHealAttempts}/4)`,
            detail:
              afterNext.validationErrors?.[0] ||
              "Scanning form errors & missing fields with Gemini AI to advance step..."
          });
          const healRes = await executeMultiFrameValidationHeal(tabId, buildHealOptions(state));
          totalFilledFields += Number(healRes.healedCount || 0);
          if (healRes.analysisSummary) {
            await broadcastAutoApplyProgress(tabId, {
              stage: "healing_validation",
              stepLabel: `🔧 AI Repaired ${healRes.healedCount || 1} Field(s) — Retrying Step`,
              detail: healRes.analysisSummary
            });
          }
          skipNextCleanFillOnce = true;
        } else {
          nextHealAttempts = 0;
        }
        continue;
      }

      if (submitAct) {
        authOrSubmitTriggerMs = Date.now();
        await broadcastAutoApplyProgress(tabId, {
          stage: "submitting",
          stepLabel: `🚀 Submitting Application ('${submitAct.buttonText}')`,
          detail: "Verifying submission confirmation or post-submit security code..."
        });

        const postRes = await waitForPostSubmitOutcome(
          tabId,
          screen,
          jobMeta,
          Boolean(submitAct.hadHtml5Invalid)
        );
        const postSubmit = postRes.screen || (await inspectTabFrames(tabId, jobMeta));

        if (postRes.outcome === "otp" || postSubmit.otpChallenge?.detected) {
          // Loop continues so Check B reads & enters Greenhouse/ATS post-submit security code!
          continue;
        }

        if (postRes.outcome === "confirmed" || postSubmit.isSubmittedConfirmation) {
          await upsertApplication({
            company: jobMeta.company || "Target Company",
            role: jobMeta.title || "AI / Software Engineer",
            location: jobMeta.location || "",
            ats: jobMeta.ats || "Career Portal",
            url: postSubmit.url || jobMeta.url || "",
            status: "Applied",
            matchScore: 94,
            resumeUsed: tailoredResume?.fileName || formatCompanyResumeFileName(jobMeta.company),
            notes: `Full Auto-Apply submitted (${totalFilledFields} fields filled cleanly).`
          });

          chrome.action.setBadgeText({ text: "✓", tabId }).catch(() => {});
          chrome.action.setBadgeBackgroundColor({ color: "#10b981", tabId }).catch(() => {});

          await broadcastAutoApplyProgress(tabId, {
            running: false,
            completed: true,
            stage: "completed",
            stepLabel: "✅ Application Submitted!",
            detail: `Logged ${jobMeta.company || "Role"} as Applied — returning to Extensions.`
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

        // Submit did NOT confirm yet — check for CAPTCHA or run AI Error Diagnosis & Self-Heal up to 4 rounds!
        if (postSubmit.hardBlocker?.blocked) {
          await upsertApplication({
            company: jobMeta.company || "Target Company",
            role: jobMeta.title || "AI / Software Engineer",
            location: jobMeta.location || "",
            ats: jobMeta.ats || "Career Portal",
            url: postSubmit.url || jobMeta.url || "",
            status: "Saved",
            matchScore: 92,
            resumeUsed: tailoredResume?.fileName || formatCompanyResumeFileName(jobMeta.company),
            notes: `Autofilled ${totalFilledFields} fields — paused on CAPTCHA challenge.`
          });
          await broadcastAutoApplyProgress(tabId, {
            running: false,
            completed: false,
            stage: "paused_captcha",
            stepLabel: "🧩 Complete CAPTCHA to Finish Submit",
            detail: "All fields are filled — solve the CAPTCHA checkbox and click Submit."
          });
          return {
            ok: true,
            submitted: false,
            blockedByCaptcha: true,
            tabId,
            totalFilledFields,
            tailoredResumeFile: tailoredResume?.fileName || null,
            coverLetterFile: tailoredCoverLetter?.fileName || null
          };
        }

        if (submitHealAttempts < 4) {
          submitHealAttempts++;
          if (
            !tailoredCoverLetter &&
            (postSubmit.inventory?.fields?.some((f) => f.isCoverLetter) ||
              (postSubmit.validationErrors || []).some((m) => /cover\s*letter/i.test(m)))
          ) {
            try {
              tailoredCoverLetter = await buildAndSaveCoverLetter(jobMeta, state, "Concise & Technical");
            } catch (_) {}
          }

          await broadcastAutoApplyProgress(tabId, {
            stage: "healing_validation",
            stepLabel: `🧠 AI Analyzing Form Error (${submitHealAttempts}/4)`,
            detail:
              postSubmit.validationErrors?.[0] ||
              "Diagnosing missing/rejected fields with Gemini AI & repairing automatically..."
          });

          const healRes = await executeMultiFrameValidationHeal(tabId, buildHealOptions(state));
          totalFilledFields += Number(healRes.healedCount || 0);
          if (healRes.analysisSummary) {
            await broadcastAutoApplyProgress(tabId, {
              stage: "healing_validation",
              stepLabel: `🔧 AI Fixed ${healRes.healedCount || 1} Field(s) — Re-Submitting`,
              detail: healRes.analysisSummary
            });
          }
          skipNextCleanFillOnce = true;
          await sleep(280);
          continue;
        }

        // Honest fallback after 4 full AI diagnosis + re-submit attempts: never falsely claim Applied
        const blockerMsg =
          postSubmit.validationErrors?.[0] ||
          "Form stayed open after submit — scrolled to remaining required field.";
        await broadcastAutoApplyProgress(tabId, {
          running: false,
          completed: false,
          stage: "needs_review",
          stepLabel: "⚠️ 1 Field Needs Quick Check Before Submit",
          detail: blockerMsg
        });
        return {
          ok: true,
          submitted: false,
          validationErrors: postSubmit.validationErrors || [],
          tabId,
          totalFilledFields,
          tailoredResumeFile: tailoredResume?.fileName || null,
          coverLetterFile: tailoredCoverLetter?.fileName || null
        };
      }

      // If Submit button exists in DOM but is still disabled because of an unmarked required field, heal & unlock it!
      if (allowFinalSubmit && hasDisabledSubmit && submitHealAttempts < 3) {
        submitHealAttempts++;
        await broadcastAutoApplyProgress(tabId, {
          stage: "healing_validation",
          stepLabel: `🔓 AI Unlocking Disabled Submit (${submitHealAttempts}/3)`,
          detail: "Analyzing & fulfilling remaining unmarked fields to enable Submit..."
        });
        const healRes = await executeMultiFrameValidationHeal(tabId, buildHealOptions(state));
        totalFilledFields += Number(healRes.healedCount || 0);
        skipNextCleanFillOnce = true;
        await sleep(300);
        continue;
      }

      // Neither Next nor Submit clicked
      await broadcastAutoApplyProgress(tabId, {
        running: false,
        completed: true,
        stage: "ready_for_review",
        stepLabel: `✅ Autofilled ${totalFilledFields} Fields Cleanly`,
        detail: allowFinalSubmit
          ? "All visible fields filled — review final screen if custom submit control is present."
          : "Paused before final submit (Auto-Submit toggle is OFF)."
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
        const scopedStatus =
          sender?.tab?.id && currentAutoApplyStatus?.tabId && sender.tab.id !== currentAutoApplyStatus.tabId
            ? null
            : currentAutoApplyStatus;
        return { ok: true, state, autoApplyStatus: scopedStatus };
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
        const pdfPayload = await getResumePdfPayload(payload.variantOrId, state, payload.company || "");
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

      case "COMPILE_COVER_LETTER_PDF": {
        const coverText = String(payload.coverLetter || payload.coverLetterText || "").trim();
        if (!coverText) return { ok: false, error: "Cover letter text is empty." };
        const comp = payload.company || payload.jobMeta?.company || "Target Company";
        const role = payload.role || payload.jobMeta?.title || "AI / Software Engineer";
        const pdfOut = await generateCoverLetterPdf(
          coverText,
          { company: comp, role },
          state.profile,
          state.settings
        );
        const safeComp = String(comp)
          .replace(/[^a-zA-Z0-9]+/g, "_")
          .replace(/^_|_$/g, "")
          .slice(0, 24);
        const fileName = `Raviteja_Velanati_${safeComp || "Cover"}_Cover_Letter.pdf`;
        const saved = await saveCoverLetter({
          ...(payload.recordId ? { id: payload.recordId } : {}),
          company: comp,
          role,
          url: payload.url || payload.jobMeta?.url || "",
          fileName,
          modelUsed: payload.modelUsed || "edited",
          fellBack: false,
          pdfEngine: pdfOut.engine,
          coverLetter: coverText,
          pdfBase64: pdfOut.pdfBase64
        });
        return {
          ok: true,
          pdfBase64: pdfOut.pdfBase64,
          fileName,
          engine: pdfOut.engine,
          record: saved
        };
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

      case "DIAGNOSE_FORM_ERRORS": {
        const res = await diagnoseFormErrorsWithGemini(
          payload.diagnostics || {},
          payload.jobMeta || {},
          state.profile,
          state.savedAnswers || [],
          state.settings
        );
        return { ok: true, ...res };
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
        const mergedOptions = { ...payload, ...(payload.options || {}) };
        if (payload.awaitCompletion) {
          return await runFullAutoApplyWorkflow(targetTabId, mergedOptions);
        }
        runFullAutoApplyWorkflow(targetTabId, mergedOptions);
        return { ok: true, started: true, tabId: targetTabId };
      }

      case "LAUNCH_TAB_AND_AUTO_APPLY": {
        const jobUrl = String(payload.url || "").trim();
        if (!jobUrl) return { ok: false, error: "Missing job URL." };
        const createdTab = await chrome.tabs.create({ url: jobUrl, active: true });
        (async () => {
          await waitForTabComplete(createdTab.id, 18000);
          await ensureTabScripts(createdTab.id);
          await runFullAutoApplyWorkflow(createdTab.id, {
            autoSubmit:
              payload.options?.autoSubmit !== undefined
                ? Boolean(payload.options.autoSubmit)
                : state.settings?.autoSubmitEnabled !== false,
            tailorResume: payload.options?.tailorResume !== false,
            jobMeta: payload.options?.jobMeta || payload.jobMeta || null
          });
        })().catch(() => {});
        return { ok: true, started: true, tabId: createdTab.id };
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
          args: [payload.pdfBase64, payload.fileName || formatCompanyResumeFileName(payload.company)]
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
