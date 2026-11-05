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

function allowCareerPortalPopups() {
  try {
    chrome.contentSettings?.popups?.set({ primaryPattern: "<all_urls>", setting: "allow" }, () => {
      void chrome.runtime.lastError;
    });
  } catch (_) {}
}
allowCareerPortalPopups();

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
  allowCareerPortalPopups();
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
  try {
    const webTabs = await chrome.tabs.query({
      url: ["http://127.0.0.1:18765/*", "http://localhost:18765/*"]
    });
    for (const wt of webTabs || []) {
      if (wt.id && wt.id !== tabId) {
        chrome.tabs
          .sendMessage(wt.id, { type: "AUTO_APPLY_PROGRESS", payload: currentAutoApplyStatus })
          .catch(() => {});
      }
    }
  } catch (_) {}
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

function withTimeout(promise, timeoutMs, fallbackValue = null) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallbackValue),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function waitForTabSettle(tabId, minWaitMs = 380, maxWaitMs = 5000) {
  await sleep(Math.min(minWaitMs, 420));
  try {
    const t = await chrome.tabs.get(tabId);
    if (t?.status === "loading") {
      await waitForTabComplete(tabId, maxWaitMs);
    } else if (minWaitMs > 500) {
      await sleep(Math.min(220, minWaitMs - 420));
    }
  } catch (_) {}
}

async function ensureTabScripts(tabId) {
  if (!tabId) return false;
  // Fast path: if top frame already has __JOBIFY_ADAPTERS__ and no embedded ATS iframes exist, skip redundant script re-injection
  const quickCheck = await withTimeout(
    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [0] },
        func: () =>
          Boolean(
            window.__JOBIFY_ADAPTERS__ &&
              !document.querySelector(
                "iframe[src*='greenhouse'], iframe[src*='ashby'], iframe[src*='lever'], iframe[src*='workday'], iframe[src*='icims'], iframe[src*='smartrecruiters'], #grnhse_iframe"
              )
          )
      })
      .then((r) => Boolean(r?.[0]?.result)),
    900,
    false
  );
  if (quickCheck) return true;

  const allOk = await withTimeout(
    chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        files: ["content/ats_adapters.js", "content/copilot_widget.js"]
      })
      .then(() => true),
    2600,
    false
  );
  if (allOk) return true;
  const topOk = await withTimeout(
    chrome.scripting
      .executeScript({
        target: { tabId },
        files: ["content/ats_adapters.js", "content/copilot_widget.js"]
      })
      .then(() => true),
    2000,
    false
  );
  return Boolean(topOk);
}

async function installWindowOpenCaptureHook(tabId) {
  if (!tabId) return;
  await withTimeout(
    chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: () => {
        try {
          document.documentElement.removeAttribute("data-jobify-last-window-open");
          if (!window.__jobifyWindowOpenHooked) {
            window.__jobifyWindowOpenHooked = true;
            const origOpen = window.open;
            window.open = function (url, ...rest) {
              try {
                if (url) {
                  const abs = new URL(String(url), location.href).href;
                  document.documentElement.setAttribute("data-jobify-last-window-open", abs);
                }
              } catch (_) {}
              return typeof origOpen === "function" ? origOpen.call(this, url, ...rest) : null;
            };
          }
        } catch (_) {}
      }
    }),
    900,
    null
  );
}

async function buildAndSaveTailoredResume(jobMeta, state, preferredModel = null) {
  const compLow = String(jobMeta.company || "").trim().toLowerCase();
  const roleLow = String(jobMeta.title || "").trim().toLowerCase();
  if (compLow && compLow !== "company" && compLow !== "target company") {
    const existing = (state.tailoredResumes || []).find(
      (r) =>
        r.pdfBase64 &&
        String(r.company || "").trim().toLowerCase() === compLow &&
        (!roleLow || String(r.role || "").trim().toLowerCase() === roleLow) &&
        r.createdAt &&
        Date.now() - Date.parse(r.createdAt) < 20 * 60 * 1000
    );
    if (existing) {
      return { record: existing, postScore: { totalScore: existing.atsScore || 98 } };
    }
  }

  const kw = analyzeJobKeywords(jobMeta.description || "", state.profile);
  const missingList = kw.missing.map((m) => m.keyword);
  let aiRes = null;

  try {
    aiRes = await tailorResumeWithGemini(
      jobMeta,
      state.profile,
      missingList,
      state.settings,
      preferredModel
    );
  } catch (_) {}

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

  try {
    const aiCl = await generateCoverLetterWithGemini(jobMeta, state.profile, tone, state.settings);
    if (aiCl?.coverLetter?.trim()) {
      coverLetterText = aiCl.coverLetter.trim();
      modelUsed = aiCl.modelUsed || "gemini";
      fellBack = Boolean(aiCl.fellBack);
    }
  } catch (_) {}

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

function buildResumeDiffForJob(state, tailoredObj) {
  const prof = state?.profile || {};
  const t = tailoredObj?.tailored || tailoredObj || {};
  const diffs = [];

  const origSummary = String(prof.summaryShort || prof.summary || "").trim();
  const newSummary = String(t.summary || "").trim();
  if (origSummary && newSummary && origSummary !== newSummary) {
    diffs.push({
      section: "Executive Summary",
      role: t.targetJobTitle || "Target Role Header",
      company: "Profile Summary",
      before: origSummary,
      after: newSummary
    });
  }

  const baseExp = Array.isArray(prof.workExperience) ? prof.workExperience : [];
  const tailExp = Array.isArray(t.experience) ? t.experience : [];
  for (let i = 0; i < Math.min(baseExp.length, tailExp.length, 3); i++) {
    const bList = baseExp[i]?.bullets || baseExp[i]?.highlights || [];
    const aList = tailExp[i]?.bullets || [];
    for (let j = 0; j < Math.min(bList.length, aList.length, 2); j++) {
      if (bList[j] && aList[j]) {
        diffs.push({
          section: "Experience",
          role: tailExp[i].title || baseExp[i].title || "Software Engineer",
          company: tailExp[i].company || baseExp[i].company || "Company",
          before: String(bList[j]),
          after: String(aList[j])
        });
      }
    }
  }
  return diffs.slice(0, 6);
}

function buildSubmissionReceipt(
  jobMeta,
  state,
  tailoredResume,
  tailoredCoverLetter,
  collectedFieldsLog = [],
  totalFilledFields = 0,
  startedAtMs = Date.now()
) {
  const p = state?.profile?.personal || {};
  const w = state?.profile?.workAuthAndEEO || {};
  const resumeName = tailoredResume?.fileName || formatCompanyResumeFileName(jobMeta?.company);
  const seenLabels = new Set();
  const fields = [];

  const pushField = (label, value) => {
    const cleanLbl = String(label || "").trim();
    const cleanVal = String(value ?? "").trim();
    if (!cleanLbl || !cleanVal) return;
    const key = cleanLbl.toLowerCase();
    if (seenLabels.has(key)) return;
    seenLabels.add(key);
    fields.push({ label: cleanLbl, value: cleanVal });
  };

  for (const item of collectedFieldsLog || []) {
    if (item && typeof item === "object") {
      pushField(item.label || item.name || item.field, item.value || item.summary || "Filled");
    } else if (typeof item === "string" && item.includes(":")) {
      const [k, ...rest] = item.split(":");
      pushField(k, rest.join(":"));
    }
  }

  pushField("Full name", p.fullName || "Raviteja Velanati");
  pushField("Email", state?.credentials?.portalEmail || p.email || "ravitejavelanati11@gmail.com");
  pushField("Phone", p.phone || "(774) 418-6241");
  pushField("Location", p.locationDisplay || "Sunnyvale, CA");
  pushField("LinkedIn", p.linkedin || "linkedin.com/in/ravitejavelanati");
  pushField("GitHub", p.github || "github.com/ravitejav-dev");
  pushField("Résumé", resumeName);
  if (tailoredCoverLetter?.fileName) {
    pushField("Cover letter", tailoredCoverLetter.fileName);
  }
  pushField("Authorized to work in US", w.authorizedToWorkInUS !== false ? "Yes" : "No");
  pushField("Requires visa sponsorship", w.requiresSponsorship ? "Yes (STEM OPT)" : "No");

  const elapsedSeconds = Math.max(1, Math.round((Date.now() - (startedAtMs || Date.now())) / 1000));
  return {
    fields,
    totalFields: Math.max(fields.length, Number(totalFilledFields || 0)),
    skippedCount: 0,
    genericAnswersCount: 0,
    elapsedSeconds
  };
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
  if (!/verify|activate|confirm|workday|candidate|account|welcome|registration|sign[-\s]?in|portal/i.test(combined)) {
    return null;
  }
  const urls = [...combined.matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)].map((m) =>
    m[0].replace(/[.,;!?]+$/, "")
  );
  const filtered = urls.filter(
    (u) =>
      !/unsubscribe|privacy|terms|support\.google|accounts\.google|mail\.google|linkedin\.com|twitter\.com|facebook\.com|instagram\.com|fonts\.googleapis|\.(png|jpg|jpeg|gif|svg|css|ico)(\?|$)/i.test(
        u
      )
  );
  return (
    filtered.find((u) =>
      /verify|activate|confirm|validation|token=|code=|key=|auth|magic|myworkdayjobs\.com|myworkdaysite\.com|wd\d+\.myworkday|icims\.com|smartrecruiters\.com|successfactors|oraclecloud|greenhouse\.io|ashbyhq\.com|lever\.co/i.test(
        u
      )
    ) ||
    filtered[0] ||
    null
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
        const domHrefs = Array.from(document.querySelectorAll("a[href^='http']"))
          .map((a) => a.href)
          .slice(0, 120);
        return { xmlPayloads, domHrefs, domText: (document.body?.innerText || "").slice(0, 8000) };
      }
    });
    const minTs = sinceEpochMs > 0 ? sinceEpochMs - 120000 : 0;
    const { xmlPayloads = [], domHrefs = [], domText = "" } = scriptRes?.[0]?.result || {};
    for (const xml of xmlPayloads) {
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
    if (domHrefs.length > 0) {
      const domUrl = extractVerificationLinkFromRawText("Verify your account", `${domText}\n${domHrefs.join("\n")}`);
      if (domUrl) {
        return { ok: true, verificationUrl: domUrl, subject: "Gmail Session", source: "chrome_gmail_dom" };
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
  let results = await withTimeout(
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: execFn,
      args: [opts]
    }),
    24000,
    null
  );
  if (!results) {
    results = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId },
        func: execFn,
        args: [opts]
      }),
      18000,
      []
    );
  }

  let filledCount = 0;
  let openQuestionsCount = 0;
  let clickedApplyGate = false;
  let submittedAuthWall = false;
  let requiresCoverLetter = false;
  let bestMeta = null;
  const filledFieldsLog = [];
  const savedDomainPasswords = [];

  for (const entry of results || []) {
    const r = entry?.result;
    if (!r) continue;
    filledCount += Number(r.filledCount || 0);
    openQuestionsCount += Number(r.openQuestionsCount || 0);
    if (r.clickedApplyGate) clickedApplyGate = true;
    if (r.submittedAuthWall) submittedAuthWall = true;
    if (r.requiresCoverLetter) requiresCoverLetter = true;
    if (r.savedDomainPassword?.host && r.savedDomainPassword?.password) {
      savedDomainPasswords.push(r.savedDomainPassword);
    }
    if (Array.isArray(r.filledFieldsLog)) filledFieldsLog.push(...r.filledFieldsLog);
    if (r.jobMeta && (!bestMeta || r.filledCount > 0)) bestMeta = r.jobMeta;
  }

  if (savedDomainPasswords.length > 0) {
    try {
      const curState = await getAllState();
      const nextMap = { ...(curState.credentials?.domainPasswords || {}) };
      for (const item of savedDomainPasswords) {
        nextMap[item.host] = item.password;
      }
      await updateCredentials({ domainPasswords: nextMap });
    } catch (_) {}
  }

  return {
    filledCount,
    filledFieldsLog,
    openQuestionsCount,
    clickedApplyGate,
    submittedAuthWall,
    requiresCoverLetter,
    jobMeta: bestMeta
  };
}

async function executeMultiFrameAutofill(tabId, opts = {}) {
  if (!tabId) return { ok: false, error: "Missing target tabId." };

  const injected = await ensureTabScripts(tabId);
  if (!injected) {
    const localResp = await withTimeout(
      chrome.tabs.sendMessage(tabId, { type: "TRIGGER_LOCAL_AUTOFILL", payload: opts }),
      12000,
      null
    );
    if (localResp?.ok) return localResp;
    return { ok: false, error: "Cannot inject into restricted browser tab." };
  }

  let pass = await runAutofillPassAcrossFrames(tabId, opts);

  for (let followup = 0; followup < 2; followup++) {
    const shouldFollowUp = pass.submittedAuthWall || (pass.filledCount === 0 && pass.clickedApplyGate);
    if (!shouldFollowUp) break;
    await waitForTabSettle(tabId, 1400, 6500);
    await ensureTabScripts(tabId);
    const nextPass = await runAutofillPassAcrossFrames(tabId, opts);
    pass = {
      filledCount: pass.filledCount + nextPass.filledCount,
      filledFieldsLog: [...pass.filledFieldsLog, ...nextPass.filledFieldsLog],
      openQuestionsCount: nextPass.openQuestionsCount,
      clickedApplyGate: pass.clickedApplyGate || nextPass.clickedApplyGate,
      submittedAuthWall: nextPass.submittedAuthWall,
      requiresCoverLetter: pass.requiresCoverLetter || nextPass.requiresCoverLetter,
      jobMeta: nextPass.jobMeta || pass.jobMeta
    };
  }

  return { ok: true, ...pass };
}

async function executeAdapterAcrossTab(tabId, method, args = [], opts = {}) {
  const timeoutMs = Number(opts.timeoutMs || 10000);
  const runnerFn = async (fnName, fnArgs) => {
    const fn = window.__JOBIFY_ADAPTERS__?.[fnName];
    if (typeof fn !== "function") return null;
    return await fn(...(fnArgs || []));
  };

  if (opts.topFrameFirst) {
    const startTs = Date.now();
    const topRes = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: runnerFn,
        args: [method, args]
      }),
      Math.min(timeoutMs, 4800),
      null
    );
    if (topRes?.[0]?.result?.clicked || opts.topFrameOnly || findSpawnedChildTab(tabId, startTs)) {
      return topRes || [];
    }
  }

  let frameResults = await withTimeout(
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: runnerFn,
      args: [method, args]
    }),
    timeoutMs,
    null
  );

  if (!frameResults) {
    frameResults = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId },
        func: runnerFn,
        args: [method, args]
      }),
      Math.min(timeoutMs, 5500),
      null
    );
  }

  if (!frameResults) {
    const rpcResp = await withTimeout(
      chrome.tabs.sendMessage(tabId, { type: "ADAPTER_RPC", payload: { method, args } }),
      4000,
      null
    );
    if (rpcResp?.ok && rpcResp.result !== undefined) {
      frameResults = [{ frameId: 0, result: rpcResp.result }];
    }
  }

  return frameResults || [];
}

async function executeMultiFrameValidationHeal(tabId, opts = {}) {
  if (!tabId) return { healedCount: 0, aiRepairsApplied: 0, analysisSummary: "", remainingErrors: [] };
  await ensureTabScripts(tabId);
  const frameResults = await executeAdapterAcrossTab(tabId, "healFormValidationErrors", [opts], { timeoutMs: 14000 });

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

async function waitForActionableJobScreen(tabId, topJobMeta = null, maxWaitMs = 5500) {
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
    await sleep(220);
    await ensureTabScripts(tabId);
    last = await inspectTabFrames(tabId, topJobMeta);
  }
  return last;
}

async function inspectTabFrames(tabId, topJobMeta = null) {
  const state = await getAllState();
  const frameResults = await executeAdapterAcrossTab(
    tabId,
    "inspectAutonomousScreenState",
    [state.profile, topJobMeta],
    { timeoutMs: 5500 }
  );

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
      isStandaloneAuthWall: false,
      hasGuestAuthBypass: false,
      hasSsoAuthGate: false,
      isOAuthProviderPage: false,
      hasEmailAuthGate: false,
      authMode: null,
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
      !valid.some(
        (v) =>
          v.frameId !== authFrame.frameId &&
          v.hasCandidateForm &&
          (authFrame.frameId === 0 || v.frameId !== 0)
      ),
    hasGuestAuthBypass: Boolean(authFrame?.hasGuestAuthBypass || valid.some((v) => v.hasGuestAuthBypass)),
    hasSsoAuthGate: Boolean(authFrame?.hasSsoAuthGate || valid.some((v) => v.hasSsoAuthGate)),
    isOAuthProviderPage: Boolean(authFrame?.isOAuthProviderPage || valid.some((v) => v.isOAuthProviderPage)),
    hasEmailAuthGate: Boolean(authFrame?.hasEmailAuthGate || valid.some((v) => v.hasEmailAuthGate)),
    authMode: authFrame?.authMode || null,
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
  await waitForTabSettle(tabId, 260, 2800);
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

    await sleep(240);
  }

  if (lastScreen && !lastScreen.hasSubmitButton && !lastScreen.hasCandidateForm && !lastScreen.hasValidationErrors) {
    return { outcome: "confirmed", screen: lastScreen };
  }
  return { outcome: "still_on_form", screen: lastScreen };
}

function findSpawnedChildTab(openerTabId, sinceMs) {
  const matched = [];
  for (let i = recentSpawnedTabs.length - 1; i >= 0; i--) {
    const item = recentSpawnedTabs[i];
    if (item.createdAt >= sinceMs - 300 && item.id !== openerTabId) {
      if (!item.openerTabId || item.openerTabId === openerTabId) {
        matched.push(item);
      }
    }
  }
  if (matched.length === 0) return null;
  const primary = matched[0];
  if (matched.length > 1) {
    for (let j = 1; j < matched.length; j++) {
      const dup = matched[j];
      if (dup.id && dup.id !== primary.id) {
        chrome.tabs.remove(dup.id).catch(() => {});
        const idx = recentSpawnedTabs.findIndex((t) => t.id === dup.id);
        if (idx >= 0) recentSpawnedTabs.splice(idx, 1);
      }
    }
  }
  return primary;
}

async function notifyOpenerTabHandoff(prevTabId, newTabId, silentBackground = false) {
  if (!prevTabId || prevTabId === newTabId) return;
  chrome.tabs
    .sendMessage(prevTabId, {
      type: "AUTO_APPLY_PROGRESS",
      payload: {
        running: false,
        completed: true,
        stage: "completed",
        stepLabel: "↗ Continued in Application Tab",
        detail: "Auto-Apply switched to the newly opened application tab.",
        tabId: prevTabId,
        updatedAt: Date.now()
      }
    })
    .catch(() => {});
  if (!silentBackground) {
    try {
      await chrome.tabs.update(newTabId, { active: true });
    } catch (_) {}
  }
}

// Reliable Step 2 Executor: Clicks Apply / Modal Apply Manually, handles child tabs, popup-blocked target="_blank" / window.open URLs, and waits for Auth Wall or Form!
async function executeStep2ApplyAndTransition(initialTabId, jobMeta, silentBackground = false) {
  let tabId = initialTabId;
  const clickTs = Date.now();
  const preTab = await chrome.tabs.get(tabId).catch(() => null);
  const preUrl = preTab?.url || "";

  await installWindowOpenCaptureHook(tabId);
  const applyExec = await executeAdapterAcrossTab(tabId, "clickApplyEntryButton", [], {
    topFrameFirst: true,
    timeoutMs: 4200
  });

  const bestApply =
    (applyExec || []).map((e) => e?.result).find((r) => r?.clicked) ||
    (applyExec || [])[0]?.result ||
    {};
  let candidateHref = bestApply?.windowOpenUrl || bestApply?.href || null;
  let navigatedFallback = false;
  let switchedToChildTab = false;
  let modalClicksInTransition = bestApply?.clickedModalChoice ? 1 : 0;
  let lastScreen = null;

  for (let iter = 0; iter < 16; iter++) {
    if (autoApplyAbortFlag) break;

    const childTab = findSpawnedChildTab(initialTabId, clickTs);
    if (childTab?.id && childTab.id !== tabId) {
      const prevTabId = tabId;
      tabId = childTab.id;
      switchedToChildTab = true;
      await notifyOpenerTabHandoff(prevTabId, tabId, silentBackground);
      await waitForTabComplete(tabId, 8000);
      await ensureTabScripts(tabId);
      await broadcastAutoApplyProgress(tabId, {
        stage: "clicking_apply",
        stepLabel: "↗ Switched to Application Portal Tab",
        detail: "Scanning candidate form & portal controls..."
      });
    }

    await sleep(210);

    try {
      const tInfo = await chrome.tabs.get(tabId);
      if (tInfo?.status === "loading") {
        await waitForTabComplete(tabId, 5500);
      }
    } catch (_) {}

    await ensureTabScripts(tabId);
    const screen = await inspectTabFrames(tabId, jobMeta);
    lastScreen = screen;

    if (
      screen.hasCandidateForm ||
      (screen.inventory?.totalFields || 0) > 0 ||
      screen.isStandaloneAuthWall ||
      screen.otpChallenge?.detected ||
      screen.needsEmailVerificationBanner ||
      screen.isSubmittedConfirmation
    ) {
      return { tabId, screen, transitioned: true };
    }

    if (screen.hasApplyChoiceModal && modalClicksInTransition < 2) {
      modalClicksInTransition++;
      await broadcastAutoApplyProgress(tabId, {
        stage: "clicking_apply",
        stepLabel: "🖱️ Step 2: Selecting 'Apply Manually' in Modal",
        detail: "Choosing manual application workflow..."
      });
      const modalExec = await executeAdapterAcrossTab(tabId, "clickApplyEntryButton", [], {
        topFrameFirst: true,
        timeoutMs: 4200
      });
      const mRes = (modalExec || []).map((e) => e?.result).find((r) => r?.clicked);
      if (mRes?.windowOpenUrl || mRes?.href) {
        candidateHref = mRes.windowOpenUrl || mRes.href;
      }
      continue;
    }

    // If Chrome popup blocker blocked <a target="_blank"> or window.open(url) after Step 1 tailoring expired user activation, navigate directly!
    if (
      !navigatedFallback &&
      !switchedToChildTab &&
      !findSpawnedChildTab(initialTabId, clickTs) &&
      ((iter >= 1 && modalClicksInTransition >= 1) || (iter >= 2 && !screen.hasApplyChoiceModal))
    ) {
      if (!candidateHref) {
        const capturedRes = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            func: () => document.documentElement.getAttribute("data-jobify-last-window-open") || ""
          }),
          1200,
          null
        );
        const capUrl = capturedRes?.[0]?.result || "";
        if (/^https?:\/\//i.test(capUrl)) candidateHref = capUrl;
      }
      if (
        candidateHref &&
        /^https?:\/\//i.test(candidateHref) &&
        candidateHref !== preUrl &&
        (!screen.url || screen.url !== candidateHref)
      ) {
        navigatedFallback = true;
        await broadcastAutoApplyProgress(tabId, {
          stage: "clicking_apply",
          stepLabel: "↗ Opening Application Portal Link",
          detail: "Navigating directly to application form..."
        });
        try {
          await chrome.tabs.update(tabId, { url: candidateHref });
          await waitForTabComplete(tabId, 9500);
        } catch (_) {}
      }
    }
  }

  return {
    tabId,
    screen: lastScreen || (await inspectTabFrames(tabId, jobMeta)),
    transitioned: false
  };
}

// End-to-End Autonomous Full Auto-Apply Workflow:
// Pull Job Details -> Tailor Resume (+ Cover Letter if needed) -> Click Apply / Modal Apply Manually -> SSO Email Gate -> Create Account / Login (+ Verify Password + Email Link/OTP) -> Extract & Cleanly Fill 1-by-1 -> Next -> Auto-Submit
async function runFullAutoApplyWorkflow(initialTabId, options = {}) {
  if (!initialTabId) {
    return { ok: false, error: "No active job tab provided." };
  }
  if (autoApplyRunning) {
    // Allow user to re-trigger cleanly if an earlier session was still running
    autoApplyAbortFlag = true;
    for (let w = 0; w < 10 && autoApplyRunning; w++) {
      await sleep(100);
    }
    if (autoApplyRunning) {
      return { ok: false, error: "Full Auto-Apply is already running." };
    }
  }

  autoApplyRunning = true;
  autoApplyAbortFlag = false;
  const silentBackground = Boolean(options.silentBackground);
  const startedAtMs = Date.now();
  let tabId = initialTabId;
  let totalFilledFields = 0;
  const collectedFieldsLog = [];
  let tailoredResume = null;
  let tailoredCoverLetter = null;
  let resumeDiffItems = [];
  let authOrSubmitTriggerMs = Date.now();
  let activeJobMeta = options.jobMeta || {};
  const authHistory = { triedSignIn: false, createdAccount: false, verifiedEmailLink: false };
  const swKeepAliveTimer = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo(() => {});
    } catch (_) {}
  }, 12000);

  const syncInFlightApplication = async (appPatch = {}, progressPatch = null) => {
    const comp = appPatch.company || activeJobMeta.company || options.jobMeta?.company || "Target Company";
    const role = appPatch.role || activeJobMeta.title || options.jobMeta?.title || "AI / Software Engineer";
    const loc = appPatch.location || activeJobMeta.location || options.jobMeta?.location || "United States";
    const ats = appPatch.ats || activeJobMeta.ats || options.jobMeta?.ats || "Career Portal";
    const url = appPatch.url || activeJobMeta.url || options.jobMeta?.url || "";
    const resumeFile =
      appPatch.resumeUsed ||
      tailoredResume?.fileName ||
      formatCompanyResumeFileName(comp);

    const savedApp = await upsertApplication({
      ...(options.applicationId ? { id: options.applicationId } : {}),
      company: comp,
      role,
      location: loc,
      ats,
      url,
      matchScore: appPatch.matchScore || activeJobMeta.matchScore || options.jobMeta?.matchScore || 94,
      resumeUsed: resumeFile,
      tailoredResumeId: tailoredResume?.id || null,
      coverLetterId: tailoredCoverLetter?.id || null,
      resumeDiff: resumeDiffItems,
      filledCount: totalFilledFields,
      elapsedSeconds: Math.max(1, Math.round((Date.now() - startedAtMs) / 1000)),
      ...appPatch
    });
    if (savedApp?.id && !options.applicationId) {
      options.applicationId = savedApp.id;
    }
    if (progressPatch) {
      await broadcastAutoApplyProgress(tabId, {
        ...progressPatch,
        applicationId: savedApp?.id || null,
        company: comp,
        role,
        ats,
        url,
        pipelineStage: savedApp?.pipelineStage || progressPatch.stage,
        application: savedApp
      });
    }
    return savedApp;
  };

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
    if (!silentBackground) {
      try {
        await chrome.tabs.update(tabId, { active: true });
      } catch (_) {}
    }
    await ensureTabScripts(tabId);

    await syncInFlightApplication(
      {
        status: "In Flight",
        pipelineStage: "in_flight",
        stepLabel: "Reading job description...",
        detail: "Scanning job description, posted salary & application portal controls...",
        resumeStatus: "Analyzing JD",
        coverLetterStatus: "Checking"
      },
      {
        running: true,
        completed: false,
        error: null,
        stage: "extracting_job",
        stepLabel: "🤖 Taking Control — Pulling Job Details & Requirements",
        detail: "Scanning job description, posted salary & application portal controls..."
      }
    );

    const initialScreen = await waitForActionableJobScreen(tabId, options.jobMeta || null, 6500);
    const jobMeta =
      initialScreen.jobMeta?.description?.length >= (options.jobMeta?.description?.length || 0)
        ? initialScreen.jobMeta
        : options.jobMeta || initialScreen.jobMeta || {};
    activeJobMeta = jobMeta;

    // Step 1: Tailor ATS Resume PDF & Requested Cover Letter PDF in Parallel
    const needResumeTailor = options.tailorResume !== false && (jobMeta.description || "").length > 40;
    const needCoverLetter = Boolean(jobMeta.mentionsCoverLetter || initialScreen.inventory?.requiresCoverLetter);

    if (needResumeTailor || needCoverLetter) {
      await syncInFlightApplication(
        {
          status: "In Flight",
          pipelineStage: "in_flight",
          stepLabel: `Tailoring résumé (${formatCompanyResumeFileName(jobMeta.company)})...`,
          detail: "Injecting ATS keywords & compiling publication-grade 1-page PDF...",
          resumeStatus: "Tailoring...",
          coverLetterStatus: needCoverLetter ? "Tailoring..." : "Optional"
        },
        {
          stage: needResumeTailor ? "tailoring_resume" : "tailoring_cover_letter",
          stepLabel:
            needResumeTailor && needCoverLetter
              ? `✨ Step 1: Tailoring Resume & Cover Letter for ${jobMeta.company || "Role"}`
              : needResumeTailor
                ? `✨ Step 1: Tailoring Resume for ${jobMeta.company || "Role"}`
                : "📝 Step 1: Tailoring Cover Letter PDF",
          detail: "Injecting ATS keywords & compiling publication-grade PDF documents..."
        }
      );

      const tasks = [];
      if (needResumeTailor) {
        tasks.push(
          buildAndSaveTailoredResume(jobMeta, state, options.preferredModel || null)
            .then((trOut) => {
              tailoredResume = trOut.record;
              resumeDiffItems = buildResumeDiffForJob(state, tailoredResume);
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
      if (!resumeDiffItems.length && tailoredResume) {
        resumeDiffItems = buildResumeDiffForJob(state, tailoredResume);
      }
      await syncInFlightApplication({
        status: "In Flight",
        pipelineStage: "in_flight",
        stepLabel: "Résumé tailored · Opening application form...",
        resumeStatus: "Ready",
        coverLetterStatus: tailoredCoverLetter ? "Ready" : "Optional",
        resumeDiff: resumeDiffItems
      });
    }

    if (autoApplyAbortFlag) throw new Error("Stopped by user.");

    // Step 2: Click "Apply Now" / Workday "Apply" -> "Apply Manually" modal if on the job posting gate
    const preApplyCheck = await waitForActionableJobScreen(tabId, jobMeta, 4000);
    let applyGateClicks = 0;
    let lastApplyGateUrl = "";
    if (
      preApplyCheck.hasApplyChoiceModal ||
      (preApplyCheck.hasApplyButton &&
        !preApplyCheck.hasCandidateForm &&
        !preApplyCheck.isStandaloneAuthWall &&
        !preApplyCheck.otpChallenge?.detected)
    ) {
      applyGateClicks++;
      lastApplyGateUrl = (preApplyCheck.url || "").split("#")[0];
      await syncInFlightApplication(
        {
          status: "In Flight",
          pipelineStage: "in_flight",
          stepLabel: "Opening application portal...",
          detail: "Clicking Apply & advancing to candidate portal..."
        },
        {
          stage: "clicking_apply",
          stepLabel: preApplyCheck.hasApplyChoiceModal
            ? "🖱️ Step 2: Selecting 'Apply Manually' in Modal"
            : "🖱️ Step 2: Clicking Apply & Selecting Manual Flow",
          detail: "Opening candidate application portal..."
        }
      );
      authOrSubmitTriggerMs = Date.now();
      const step2Out = await executeStep2ApplyAndTransition(tabId, jobMeta, silentBackground);
      tabId = step2Out.tabId;
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

    const driveChildOAuthOrPortalTab = async (childTabId, openerTabId, currentState) => {
      if (!childTabId) return { targetTabId: openerTabId, closedPopup: false };
      await waitForTabComplete(childTabId, 10000);

      for (let oauthStep = 1; oauthStep <= 6; oauthStep++) {
        if (autoApplyAbortFlag) break;
        const childInfo = await chrome.tabs.get(childTabId).catch(() => null);
        if (!childInfo) {
          // OAuth popup completed and closed itself via window.close() — return control to opener job tab!
          await waitForTabSettle(openerTabId, 900, 4500);
          return { targetTabId: openerTabId, closedPopup: true };
        }

        await ensureTabScripts(childTabId);
        const childScreen = await inspectTabFrames(childTabId, jobMeta);

        if (
          childScreen.hasCandidateForm ||
          (childScreen.inventory?.totalFields || 0) > 0 ||
          childScreen.isSubmittedConfirmation
        ) {
          await notifyOpenerTabHandoff(openerTabId, childTabId, silentBackground);
          return { targetTabId: childTabId, closedPopup: false };
        }

        if (childScreen.isOAuthProviderPage || childScreen.isStandaloneAuthWall) {
          await broadcastAutoApplyProgress(openerTabId, {
            stage: "portal_auth",
            stepLabel: `🔐 Completing OAuth Sign-In Window (Step ${oauthStep})`,
            detail: `Selecting ${currentState.credentials.portalEmail} & authorizing portal access...`
          });
          await executeAdapterAcrossTab(
            childTabId,
            "performAutonomousAuth",
            [currentState.credentials, authHistory, currentState.profile],
            { timeoutMs: 14000 }
          );
          await sleep(750);
          const stillOpen = await chrome.tabs.get(childTabId).catch(() => null);
          if (!stillOpen) {
            await waitForTabSettle(openerTabId, 900, 4500);
            return { targetTabId: openerTabId, closedPopup: true };
          }
          await waitForTabSettle(childTabId, 900, 4000);
          continue;
        }

        await sleep(500);
      }

      const finalCheck = await chrome.tabs.get(childTabId).catch(() => null);
      if (!finalCheck) {
        await waitForTabSettle(openerTabId, 900, 4500);
        return { targetTabId: openerTabId, closedPopup: true };
      }
      await notifyOpenerTabHandoff(openerTabId, childTabId, silentBackground);
      return { targetTabId: childTabId, closedPopup: false };
    };

    for (let stepIdx = 1; stepIdx <= 20; stepIdx++) {
      if (autoApplyAbortFlag) throw new Error("Stopped by user.");

      // If current tabId was an OAuth popup that closed itself, recover back to initialTabId
      const activeTabCheck = await chrome.tabs.get(tabId).catch(() => null);
      if (!activeTabCheck && tabId !== initialTabId) {
        const initCheck = await chrome.tabs.get(initialTabId).catch(() => null);
        if (initCheck) {
          tabId = initialTabId;
        }
      }

      await ensureTabScripts(tabId);
      state = await getAllState();
      let screen = await inspectTabFrames(tabId, jobMeta);

      // If page just navigated/transitioned and SPA form controls haven't hydrated yet, wait & scroll for hydration
      if (
        !screen.isSubmittedConfirmation &&
        !screen.hasApplyChoiceModal &&
        !screen.hasApplyButton &&
        !screen.otpChallenge?.detected &&
        !screen.needsEmailVerificationBanner &&
        !screen.isStandaloneAuthWall &&
        (screen.inventory?.totalFields || 0) === 0
      ) {
        await broadcastAutoApplyProgress(tabId, {
          stage: "loading_form",
          stepLabel: "⏳ Step 3: Loading Application Form Controls...",
          detail: "Waiting for portal fields & embedded form sections to hydrate..."
        });
        for (let h = 0; h < 9; h++) {
          await sleep(420);
          await ensureTabScripts(tabId);
          screen = await inspectTabFrames(tabId, jobMeta);
          if (
            screen.isSubmittedConfirmation ||
            screen.hasApplyChoiceModal ||
            screen.otpChallenge?.detected ||
            screen.needsEmailVerificationBanner ||
            screen.isStandaloneAuthWall ||
            (screen.inventory?.totalFields || 0) > 0
          ) {
            break;
          }
        }
      }

      // Check A: Submission Confirmation Banner Reached!
      if (screen.isSubmittedConfirmation) {
        const receipt = buildSubmissionReceipt(
          jobMeta,
          state,
          tailoredResume,
          tailoredCoverLetter,
          collectedFieldsLog,
          totalFilledFields,
          startedAtMs
        );
        const finalApp = await syncInFlightApplication(
          {
            url: screen.url || jobMeta.url || "",
            status: "Applied",
            pipelineStage: "submitted",
            stepLabel: "Submitted",
            detail: `Submitted via ${jobMeta.ats || "Career Portal"} · ${receipt.totalFields} fields filled · 0 skipped`,
            resumeStatus: "Attached",
            coverLetterStatus: tailoredCoverLetter ? "Attached" : "Not Required",
            fieldsReceipt: receipt.fields,
            resumeDiff: resumeDiffItems,
            filledCount: receipt.totalFields,
            elapsedSeconds: receipt.elapsedSeconds,
            notes: `Full Auto-Apply submitted (${receipt.totalFields} fields filled cleanly in ${receipt.elapsedSeconds}s).`
          },
          {
            running: false,
            completed: true,
            stage: "completed",
            stepLabel: "✅ Application Submitted!",
            detail: `Logged ${jobMeta.company || "Role"} as Applied (${receipt.totalFields} fields filled).`
          }
        );
        chrome.action.setBadgeText({ text: "✓", tabId }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: "#10b981", tabId }).catch(() => {});
        return {
          ok: true,
          submitted: true,
          tabId,
          totalFilledFields: receipt.totalFields,
          tailoredResumeFile: tailoredResume?.fileName || null,
          coverLetterFile: tailoredCoverLetter?.fileName || null,
          fieldsReceipt: receipt.fields,
          resumeDiff: resumeDiffItems,
          application: finalApp
        };
      }

      // Check A2: Open "Start Your Application" Choice Modal ("Apply Manually") OR Secondary Tab Apply Gate!
      const cleanScreenUrl = (screen.url || "").split("#")[0];
      if (
        (screen.hasApplyChoiceModal ||
          (screen.hasApplyButton &&
            !screen.hasCandidateForm &&
            (screen.inventory?.totalFields || 0) === 0 &&
            cleanScreenUrl !== lastApplyGateUrl)) &&
        applyGateClicks < 3
      ) {
        applyGateClicks++;
        lastApplyGateUrl = cleanScreenUrl;
        await broadcastAutoApplyProgress(tabId, {
          stage: "clicking_apply",
          stepLabel: screen.hasApplyChoiceModal
            ? "🖱️ Selecting 'Apply Manually' in Modal"
            : "🖱️ Clicking Apply Entry Button",
          detail: "Advancing past portal entry gate..."
        });
        authOrSubmitTriggerMs = Date.now();
        const gateOut = await executeStep2ApplyAndTransition(tabId, jobMeta, silentBackground);
        tabId = gateOut.tabId;
        continue;
      }

      // Check B: Email OTP / Security Code Challenge Detected!
      if (screen.otpChallenge?.detected) {
        let otpCode = null;
        let otpSource = "";
        for (let poll = 1; poll <= 14; poll++) {
          if (autoApplyAbortFlag) throw new Error("Stopped by user.");
          await syncInFlightApplication(
            {
              status: "In Flight",
              pipelineStage: "in_flight",
              stepLabel: `Reading Email OTP (${poll}/14)...`,
              detail: `Checking ${state.credentials.portalEmail} for verification code...`
            },
            {
              stage: "waiting_otp",
              stepLabel: `📨 Reading Email OTP (Attempt ${poll}/14)`,
              detail: `Checking ${state.credentials.portalEmail} for verification code...`
            }
          );
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
          await syncInFlightApplication(
            {
              status: "Needs You",
              pipelineStage: "needs_you",
              stepLabel: "Waiting for OTP verification code",
              detail: `No recent OTP found in ${state.credentials.portalEmail} yet.`
            },
            {
              running: false,
              completed: false,
              stage: "paused_otp",
              stepLabel: "⏸️ Waiting for Verification Code",
              detail: `No recent OTP found in ${state.credentials.portalEmail} yet — enter code to finish.`
            }
          );
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

      // Check C: Standalone Portal Auth (Guest Bypass -> Multi-Provider SSO "Sign in with Google" -> OAuth Account Chooser -> Email Gate -> Create Account <-> Sign In!)
      if (screen.isStandaloneAuthWall && authAttempts < 8) {
        const hasPortalPassword = Boolean(String(state.credentials?.portalPassword || "").trim());
        const canProceedWithoutPassword = Boolean(
          screen.hasGuestAuthBypass ||
            screen.hasSsoAuthGate ||
            screen.isOAuthProviderPage ||
            screen.hasEmailAuthGate
        );
        if (!hasPortalPassword && !canProceedWithoutPassword) {
          await broadcastAutoApplyProgress(tabId, {
            running: false,
            completed: false,
            stage: "needs_review",
            stepLabel: "🔐 Set Portal Password in Vault",
            detail: "Open Hub → Vault once to save your portal password for automatic login & signup."
          });
          return {
            ok: true,
            submitted: false,
            pausedForCredentials: true,
            tabId,
            totalFilledFields,
            tailoredResumeFile: tailoredResume?.fileName || null
          };
        }

        authAttempts++;
        authOrSubmitTriggerMs = Date.now();
        const authStepLbl = screen.hasGuestAuthBypass
          ? "🔓 Bypassing Login Gate ('Apply as Guest')"
          : screen.isOAuthProviderPage
          ? `🔐 Completing OAuth Account Selection (${state.credentials.portalEmail})`
          : screen.hasSsoAuthGate
          ? "🔐 Selecting 'Sign in with Google' on SSO Portal"
          : screen.hasEmailAuthGate
          ? "🔐 Selecting 'Sign in with Email' & Authenticating"
          : authHistory.createdAccount
          ? "🔐 Completing Post-Signup Portal Sign In"
          : screen.authMode === "create"
          ? "🔐 Creating Candidate Account (Filling All Registration Fields)"
          : "🔐 Portal Sign In / Create Account";

        await syncInFlightApplication(
          {
            status: "In Flight",
            pipelineStage: "in_flight",
            stepLabel: authStepLbl.replace(/^[^\w]+/, "").trim(),
            detail: `Authenticating with ${state.credentials.portalEmail}...`
          },
          {
            stage: "portal_auth",
            stepLabel: authStepLbl,
            detail: `Using ${state.credentials.portalEmail} (handling SSO/OAuth, Login, Registration & Terms)...`
          }
        );

        await installWindowOpenCaptureHook(tabId);
        const authExec = await executeAdapterAcrossTab(
          tabId,
          "performAutonomousAuth",
          [state.credentials, authHistory, state.profile],
          { timeoutMs: 18000 }
        );

        let needsVerifyLinkNow = false;
        let clickedSsoGate = false;
        let ssoPopupUrl = "";
        const domainPwUpdates = {};
        for (const entry of authExec || []) {
          const r = entry?.result;
          if (!r) continue;
          if (r.savedDomainPassword?.host && r.savedDomainPassword?.password) {
            domainPwUpdates[r.savedDomainPassword.host] = r.savedDomainPassword.password;
          }
          if (!r.handled) continue;
          if (r.createdAccount) authHistory.createdAccount = true;
          if (r.triedSignIn) authHistory.triedSignIn = true;
          if (r.needsEmailVerification) needsVerifyLinkNow = true;
          if (r.clickedSsoGate || r.action === "sso_provider_gate") {
            clickedSsoGate = true;
            if (!ssoPopupUrl && /^https?:\/\//i.test(r.windowOpenUrl || r.href || "")) {
              ssoPopupUrl = r.windowOpenUrl || r.href;
            }
          }
        }

        if (Object.keys(domainPwUpdates).length > 0) {
          try {
            const nextDomainPasswords = {
              ...(state.credentials?.domainPasswords || {}),
              ...domainPwUpdates
            };
            state.credentials = await updateCredentials({ domainPasswords: nextDomainPasswords });
          } catch (_) {}
        }

        // Wait briefly in case clicking "Sign in with Google" spawns an OAuth popup window/tab
        if (clickedSsoGate) {
          await sleep(450);
        }

        let childTabAfterAuth = findSpawnedChildTab(tabId, authOrSubmitTriggerMs);
        if (!childTabAfterAuth?.id && clickedSsoGate) {
          const capturedRes = await withTimeout(
            chrome.scripting.executeScript({
              target: { tabId, frameIds: [0] },
              func: () => document.documentElement.getAttribute("data-jobify-last-window-open") || ""
            }),
            1200,
            null
          );
          const capUrl = capturedRes?.[0]?.result || ssoPopupUrl || "";
          if (/^https?:\/\//i.test(capUrl)) {
            try {
              const openedPopup = await chrome.tabs.create({
                url: capUrl,
                openerTabId: tabId,
                active: !silentBackground
              });
              childTabAfterAuth = { id: openedPopup.id, openerTabId: tabId, createdAt: Date.now() };
            } catch (_) {}
          }
        }

        if (childTabAfterAuth?.id) {
          const prevTabId = tabId;
          const childOut = await driveChildOAuthOrPortalTab(childTabAfterAuth.id, prevTabId, state);
          tabId = childOut.targetTabId || prevTabId;
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

        await syncInFlightApplication(
          {
            status: "In Flight",
            pipelineStage: "in_flight",
            stepLabel: `Filling ${screen.inventory.totalFields} fields...`,
            detail: `Step ${stepIdx}: Filling candidate fields, resume upload & custom questions...`
          },
          {
            stage: "filling_fields",
            stepLabel: `✍️ Filling ${screen.inventory.totalFields} Fields Cleanly (1 by 1)`,
            detail: `Step ${stepIdx}: Filling needed fields, checkboxes & required questions...`
          }
        );

        const fillPass = await executeMultiFrameAutofill(tabId, {
          ...buildHealOptions(state),
          sequentialOneByOne: true,
          onlyNeededCleanMode: true,
          forceOverwrite: false,
          fillOpenEndedWithAI: true,
          skipApplyGate: true
        });

        totalFilledFields += Number(fillPass?.filledCount || 0);
        if (Array.isArray(fillPass?.filledFieldsLog)) {
          collectedFieldsLog.push(...fillPass.filledFieldsLog);
        }
        const partialReceipt = buildSubmissionReceipt(
          jobMeta,
          state,
          tailoredResume,
          tailoredCoverLetter,
          collectedFieldsLog,
          totalFilledFields,
          startedAtMs
        );
        await syncInFlightApplication({
          status: "Filled",
          pipelineStage: "filled",
          stepLabel: `Filled ${totalFilledFields} of ${Math.max(totalFilledFields, screen.inventory.totalFields)} fields`,
          detail: "All required fields & tailored résumé populated — preparing submission...",
          resumeStatus: "Attached",
          coverLetterStatus: tailoredCoverLetter ? "Attached" : "Optional",
          fieldsReceipt: partialReceipt.fields,
          filledCount: totalFilledFields
        });
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
        await syncInFlightApplication(
          {
            status: "Filled",
            pipelineStage: "filled",
            stepLabel: `Submitting application ('${submitAct.buttonText}')...`,
            detail: "Verifying submission confirmation..."
          },
          {
            stage: "submitting",
            stepLabel: `🚀 Submitting Application ('${submitAct.buttonText}')`,
            detail: "Verifying submission confirmation or post-submit security code..."
          }
        );

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
          const receipt = buildSubmissionReceipt(
            jobMeta,
            state,
            tailoredResume,
            tailoredCoverLetter,
            collectedFieldsLog,
            totalFilledFields,
            startedAtMs
          );
          const finalApp = await syncInFlightApplication(
            {
              url: postSubmit.url || jobMeta.url || "",
              status: "Applied",
              pipelineStage: "submitted",
              stepLabel: "Submitted",
              detail: `Submitted via ${jobMeta.ats || "Career Portal"} · ${receipt.totalFields} fields filled · 0 skipped`,
              resumeStatus: "Attached",
              coverLetterStatus: tailoredCoverLetter ? "Attached" : "Not Required",
              fieldsReceipt: receipt.fields,
              resumeDiff: resumeDiffItems,
              filledCount: receipt.totalFields,
              elapsedSeconds: receipt.elapsedSeconds,
              notes: `Full Auto-Apply submitted (${receipt.totalFields} fields filled cleanly in ${receipt.elapsedSeconds}s).`
            },
            {
              running: false,
              completed: true,
              stage: "completed",
              stepLabel: "✅ Application Submitted!",
              detail: `Logged ${jobMeta.company || "Role"} as Applied (${receipt.totalFields} fields filled).`
            }
          );

          chrome.action.setBadgeText({ text: "✓", tabId }).catch(() => {});
          chrome.action.setBadgeBackgroundColor({ color: "#10b981", tabId }).catch(() => {});

          return {
            ok: true,
            submitted: true,
            tabId,
            totalFilledFields: receipt.totalFields,
            tailoredResumeFile: tailoredResume?.fileName || null,
            coverLetterFile: tailoredCoverLetter?.fileName || null,
            fieldsReceipt: receipt.fields,
            resumeDiff: resumeDiffItems,
            application: finalApp
          };
        }

        // Submit did NOT confirm yet — check for CAPTCHA or run AI Error Diagnosis & Self-Heal up to 4 rounds!
        if (postSubmit.hardBlocker?.blocked) {
          const receipt = buildSubmissionReceipt(
            jobMeta,
            state,
            tailoredResume,
            tailoredCoverLetter,
            collectedFieldsLog,
            totalFilledFields,
            startedAtMs
          );
          const capApp = await syncInFlightApplication(
            {
              url: postSubmit.url || jobMeta.url || "",
              status: "Needs You",
              pipelineStage: "needs_you",
              stepLabel: "Complete CAPTCHA to finish submit",
              detail: `Autofilled ${totalFilledFields} fields — paused on CAPTCHA challenge.`,
              fieldsReceipt: receipt.fields,
              resumeDiff: resumeDiffItems,
              notes: `Autofilled ${totalFilledFields} fields — paused on CAPTCHA challenge.`
            },
            {
              running: false,
              completed: false,
              stage: "paused_captcha",
              stepLabel: "🧩 Complete CAPTCHA to Finish Submit",
              detail: "All fields are filled — solve the CAPTCHA checkbox and click Submit."
            }
          );
          return {
            ok: true,
            submitted: false,
            blockedByCaptcha: true,
            tabId,
            totalFilledFields,
            tailoredResumeFile: tailoredResume?.fileName || null,
            coverLetterFile: tailoredCoverLetter?.fileName || null,
            application: capApp
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
        await syncInFlightApplication(
          {
            status: "Needs You",
            pipelineStage: "needs_you",
            stepLabel: "1 field needs quick check before submit",
            detail: blockerMsg
          },
          {
            running: false,
            completed: false,
            stage: "needs_review",
            stepLabel: "⚠️ 1 Field Needs Quick Check Before Submit",
            detail: blockerMsg
          }
        );
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
      const receipt = buildSubmissionReceipt(
        jobMeta,
        state,
        tailoredResume,
        tailoredCoverLetter,
        collectedFieldsLog,
        totalFilledFields,
        startedAtMs
      );
      await syncInFlightApplication(
        {
          status: "Filled",
          pipelineStage: "filled",
          stepLabel: `Autofilled ${totalFilledFields} fields cleanly`,
          detail: allowFinalSubmit
            ? "All visible fields filled — ready in tracker."
            : "Paused before final submit (Safe Review Mode).",
          fieldsReceipt: receipt.fields,
          resumeDiff: resumeDiffItems
        },
        {
          running: false,
          completed: true,
          stage: "ready_for_review",
          stepLabel: `✅ Autofilled ${totalFilledFields} Fields Cleanly`,
          detail: allowFinalSubmit
            ? "All visible fields filled — review final screen if custom submit control is present."
            : "Paused before final submit (Auto-Submit toggle is OFF)."
        }
      );
      return {
        ok: true,
        submitted: false,
        tabId,
        totalFilledFields,
        tailoredResumeFile: tailoredResume?.fileName || null,
        coverLetterFile: tailoredCoverLetter?.fileName || null,
        fieldsReceipt: receipt.fields,
        resumeDiff: resumeDiffItems
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
      await appendAutopilotLog(`Running silent background Auto-Apply for ${item.company} — ${item.title}`, "info");

      let workerTabId = null;
      try {
        const tab = await chrome.tabs.create({ url: item.url, active: false });
        workerTabId = tab.id;
        await waitForTabComplete(tab.id, 18000);
        await ensureTabScripts(tab.id);

        const execResp = await runFullAutoApplyWorkflow(tab.id, {
          silentBackground: true,
          autoSubmit: state.settings.autopilotMode === "full_auto",
          tailorResume: item.tailorFirst !== false,
          jobMeta: {
            company: item.company,
            title: item.title,
            location: item.location,
            ats: item.ats,
            url: item.url,
            matchScore: item.matchScore || 92
          }
        });

        if (execResp?.tabId && execResp.tabId !== workerTabId) {
          chrome.tabs.remove(execResp.tabId).catch(() => {});
        }
        if (workerTabId && !execResp?.blockedByCaptcha && !execResp?.pausedForOtp) {
          chrome.tabs.remove(workerTabId).catch(() => {});
        }

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
          `Completed ${item.company} — ${execResp?.totalFilledFields || 0} fields autofilled${execResp?.submitted ? " & submitted!" : " (saved in tracker)."}`,
          "success"
        );
      } catch (stepErr) {
        if (workerTabId) {
          chrome.tabs.remove(workerTabId).catch(() => {});
        }
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
        const credentials = await updateCredentials(payload?.credentials || payload || {});
        return { ok: true, credentials };
      }

      case "ANALYZE_JOB_PAGE": {
        const jobMeta = payload.jobMeta || {};
        const match = evaluateJobMatch(jobMeta, state.profile);
        const atsScore = scoreResumeATS(state.profile, jobMeta.description || "");
        const referrals = buildNetworkCopilotPathways(jobMeta.company, jobMeta.title);
        if (sender?.tab?.id) {
          if (jobMeta.pageType === "job_board" || jobMeta.pageType === "other") {
            chrome.action.setBadgeText({ text: "", tabId: sender.tab.id }).catch(() => {});
          } else {
            chrome.action.setBadgeText({ text: `${match.matchScore}%`, tabId: sender.tab.id }).catch(() => {});
            chrome.action
              .setBadgeBackgroundColor({
                color: match.matchScore >= 80 ? "#10b981" : match.matchScore >= 60 ? "#f59e0b" : "#ef4444",
                tabId: sender.tab.id
              })
              .catch(() => {});
          }
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
        // Default to silent background worker tab (active: false) so we NEVER hijack the user's current screen!
        const shouldFocusTab = payload.active === true;
        const silentBackground = !shouldFocusTab;
        const jbMeta = payload.options?.jobMeta || payload.jobMeta || {};

        const queuedApp = await upsertApplication({
          company: jbMeta.company || "Target Company",
          role: jbMeta.title || "AI / Software Engineer",
          location: jbMeta.location || "United States",
          ats: jbMeta.ats || "Career Portal",
          url: jobUrl,
          status: "In Flight",
          pipelineStage: "in_flight",
          stepLabel: "Queued · Starting background agent...",
          detail: "Initializing headless worker & reading job description...",
          matchScore: jbMeta.matchScore || 94,
          resumeStatus: "Queued",
          coverLetterStatus: "Optional"
        });

        const createdTab = await chrome.tabs.create({ url: jobUrl, active: shouldFocusTab });
        const runTask = async () => {
          try {
            await waitForTabComplete(createdTab.id, 18000);
            await ensureTabScripts(createdTab.id);
            const out = await runFullAutoApplyWorkflow(createdTab.id, {
              silentBackground,
              applicationId: queuedApp?.id || null,
              autoSubmit:
                payload.options?.autoSubmit !== undefined
                  ? Boolean(payload.options.autoSubmit)
                  : state.settings?.autoSubmitEnabled !== false,
              tailorResume: payload.options?.tailorResume !== false,
              jobMeta: jbMeta
            });
            if (
              silentBackground &&
              payload.keepTabOpen !== true &&
              !out?.blockedByCaptcha &&
              !out?.pausedForOtp
            ) {
              if (out?.tabId && out.tabId !== createdTab.id) {
                chrome.tabs.remove(out.tabId).catch(() => {});
              }
              chrome.tabs.remove(createdTab.id).catch(() => {});
            }
            return out;
          } catch (err) {
            if (silentBackground && payload.keepTabOpen !== true) {
              chrome.tabs.remove(createdTab.id).catch(() => {});
            }
            throw err;
          }
        };
        if (payload.awaitCompletion) {
          const out = await runTask();
          return { ...out, tabId: out?.tabId || createdTab.id, application: out?.application || queuedApp };
        }
        runTask().catch(() => {});
        return {
          ok: true,
          started: true,
          silentBackground,
          tabId: createdTab.id,
          application: queuedApp
        };
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
