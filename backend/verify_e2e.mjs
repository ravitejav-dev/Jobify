#!/usr/bin/env node
// Full End-to-End Verification Suite for Jobify Copilot:
// Part A: Real Google Chrome MV3 Unpacked Extension (Service Worker + Shadow-DOM Copilot + Greenhouse, Workday & Lever Autofill + Binary PDF Upload + Auto-Tracker)
// Part B: Live Gemini AI Tailoring + Cover Letter + AI Question Answering + pdflatex & Pure-JS PDF Compilation + Live Public ATS Job Feeds

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_PROFILE, DEFAULT_SETTINGS, DEFAULT_SAVED_ANSWERS } from "../extension/shared/default_profile.js";
import { scoreResumeATS } from "../extension/shared/ats_analyzer.js";
import {
  tailorResumeWithGemini,
  generateCoverLetterWithGemini,
  answerApplicationQuestionWithGemini
} from "../extension/shared/gemini_client.js";
import {
  generateTailoredResumePdf,
  buildPureJsResumePdfBase64,
  formatCompanyResumeFileName
} from "../extension/shared/pdf_generator.js";
import { fetchPersonalizedRecommendations, STAFFING_AGENCIES_DIRECTORY } from "../extension/shared/job_feeds.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXT_DIR = path.join(ROOT, "extension");
const USER_DATA_DIR = path.join(ROOT, ".tmp_chrome_e2e");
const SAMPLE_PDF_OUT = path.join(ROOT, formatCompanyResumeFileName("Anthropic"));
const CDP_PORT = 9339;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.seq = 1;
    this.pending = new Map();
    this.exceptions = [];
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method === "Runtime.exceptionThrown") {
        this.exceptions.push(msg.params?.exceptionDetails?.text || JSON.stringify(msg.params));
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, timeoutMs = 20000) {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout on ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, timeoutMs = 25000) {
    const res = await this.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      timeoutMs
    );
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }
  async navigateTo(url) {
    await this.send("Page.enable", {}, 8000);
    await this.send("Page.navigate", { url }, 10000);
    for (let i = 0; i < 25; i++) {
      await sleep(300);
      const st = await this.eval(`({ href: location.href, ready: document.readyState })`, 4000).catch(() => null);
      if (st && st.href === url && st.ready === "complete") {
        await sleep(700);
        return st;
      }
    }
    throw new Error(`Navigation timeout for ${url}`);
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function main() {
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  console.log("=== PART A: REAL GOOGLE CHROME MV3 EXTENSION RUNTIME VERIFICATION ===");
  let ChromeProc = null;
  let srv = null;

  try {
    srv = spawn("python3", [path.join(ROOT, "backend/server.py")], { stdio: "pipe" });
    await sleep(600);

    ChromeProc = spawn(
      "/usr/bin/google-chrome",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        "--enable-unsafe-extension-debugging",
        `--user-data-dir=${USER_DATA_DIR}`,
        `--remote-debugging-port=${CDP_PORT}`,
        "about:blank"
      ],
      { stdio: "pipe" }
    );

    let browserInfo = null;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      try {
        browserInfo = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json());
        if (browserInfo?.webSocketDebuggerUrl) break;
      } catch (_) {}
    }

    const browserCdp = new CDPClient(browserInfo.webSocketDebuggerUrl);
    await browserCdp.connect();
    const unpackedRes = await browserCdp.send("Extensions.loadUnpacked", { path: EXT_DIR });
    const extId = unpackedRes.id;

    let targets = [];
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      if (targets.some((t) => t.type === "service_worker" && t.url.includes(`${extId}/background/service_worker.js`))) {
        break;
      }
    }

    const swTarget = targets.find((t) => t.type === "service_worker" && t.url.includes(`${extId}/background/service_worker.js`));
    if (!swTarget) throw new Error("Jobify MV3 Service Worker did not start!");
    console.log(`1. ✅ MV3 Service Worker Registered! Extension ID: ${extId}`);

    const swCdp = new CDPClient(swTarget.webSocketDebuggerUrl);
    await swCdp.connect();

    async function openTabAndConnect(url) {
      const tabInfo = await swCdp.eval(`chrome.tabs.create({ url: ${JSON.stringify(url)}, active: true })`);
      for (let i = 0; i < 35; i++) {
        await sleep(350);
        const st = await swCdp.eval(`chrome.tabs.get(${tabInfo.id})`).catch(() => null);
        if (st?.status === "complete" && st?.url?.startsWith(url)) break;
      }
      for (let i = 0; i < 15; i++) {
        const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
        const t = list.find((x) => x.type === "page" && x.url.startsWith(url));
        if (t?.webSocketDebuggerUrl) {
          const client = new CDPClient(t.webSocketDebuggerUrl);
          client.tabId = tabInfo.id;
          await client.connect();
          await sleep(800);
          return client;
        }
        await sleep(300);
      }
      throw new Error(`Tab target did not appear for ${url}`);
    }

    // 1. Real Live Production Greenhouse Remix Application (Anthropic)
    const liveGhCdp = await openTabAndConnect("https://job-boards.greenhouse.io/anthropic/jobs/5456619008");
    await liveGhCdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    for (let i = 0; i < 30; i++) {
      const ready = await liveGhCdp
        .eval(`Boolean(document.readyState === "complete" && document.getElementById("first_name") && document.getElementById("jobify-copilot-host")?.shadowRoot)`)
        .catch(() => false);
      if (ready) break;
      await sleep(400);
    }
    const liveGhFill = await swCdp.eval(`
      new Promise(resolve => {
        chrome.tabs.get(${liveGhCdp.tabId}, (tabMeta) => {
          chrome.tabs.sendMessage(${liveGhCdp.tabId}, { type: "TRIGGER_AUTOFILL", payload: { fillOpenEndedWithAI: false } }, (res) => {
            resolve(res || { err: chrome.runtime.lastError?.message || null, tabUrl: tabMeta?.url, tabStatus: tabMeta?.status });
          });
        });
      })
    `);
    const liveGhCheck = await liveGhCdp.eval(`({
      pillMountedAfterHydration: Boolean(document.getElementById("jobify-copilot-host")?.shadowRoot?.getElementById("jb-pill")),
      firstName: document.getElementById("first_name")?.value,
      countryCode: document.getElementById("country")?.closest(".select-shell")?.querySelector(".select__single-value")?.innerText,
      visaSponsor: document.getElementById("question_19018745008")?.closest(".select-shell")?.querySelector(".select__single-value")?.innerText,
      workAddress: document.getElementById("question_19018749008")?.value,
      gender: document.getElementById("gender")?.closest(".select-shell")?.querySelector(".select__single-value")?.innerText,
      resumeFileAttached: document.getElementById("resume")?.files?.[0]?.name || null,
      resumeShownInUI: document.body.innerText.includes("Raviteja_velanati_Anthropic.pdf")
    })`);
    console.log(`2. ✅ Live Production Greenhouse Remix Verified (${liveGhFill?.filledCount} fields):`, JSON.stringify({ fill: { ok: liveGhFill?.ok, filledCount: liveGhFill?.filledCount, err: liveGhFill?.err }, check: liveGhCheck }, null, 2));
    if (
      !liveGhCheck.pillMountedAfterHydration ||
      liveGhCheck.firstName !== "Raviteja" ||
      liveGhCheck.countryCode !== "+1" ||
      liveGhCheck.visaSponsor !== "Yes" ||
      !liveGhCheck.workAddress?.includes("Newark") ||
      liveGhCheck.gender !== "Male" ||
      !(liveGhCheck.resumeShownInUI || liveGhCheck.resumeFileAttached === "Raviteja_velanati_Anthropic.pdf")
    ) {
      throw new Error("Live production Greenhouse Remix assertion failed!");
    }
    liveGhCdp.close();

    // 2. FULL AUTONOMOUS AUTO-APPLY E2E (Job Page -> Tailor Resume & Cover Letter -> Click Apply Now -> Login Fail -> Switch to Create Account + Verify Password -> 6-Box Email OTP -> Step 1 -> Save & Continue -> Step 2 Clean Needed-Only -> Auto-Submit)
    const autoCdp = await openTabAndConnect("http://127.0.0.1:18765/sandbox/auto-apply");
    for (let i = 0; i < 20; i++) {
      const hasWidget = await autoCdp
        .eval(`Boolean(document.getElementById("jobify-copilot-host")?.shadowRoot?.getElementById("jb-pill"))`)
        .catch(() => false);
      if (hasWidget) break;
      await sleep(300);
    }
    await autoCdp.eval(`
      (async () => {
        const sr = document.getElementById("jobify-copilot-host").shadowRoot;
        if (!sr.getElementById("jb-drawer")?.classList.contains("open")) {
          sr.getElementById("jb-pill")?.click();
        }
        for (let k = 0; k < 15; k++) {
          if (sr.getElementById("jb-btn-full-auto")) break;
          await new Promise(r => setTimeout(r, 150));
        }
        sr.getElementById("jb-btn-full-auto").click();
      })()
    `);

    let autoAudit = null;
    for (let waitIdx = 0; waitIdx < 80; waitIdx++) {
      await sleep(1000);
      autoAudit = await autoCdp.eval(`window.__AUTO_APPLY_AUDIT__`).catch(() => null);
      if (autoAudit?.submitted) break;
    }
    let autoStatus = null;
    for (let sIdx = 0; sIdx < 20; sIdx++) {
      await sleep(400);
      autoStatus = await swCdp.eval(`chrome.storage.local.get("jobify_auto_apply_session").then(r => r.jobify_auto_apply_session)`);
      if (autoStatus && !autoStatus.running) break;
    }
    console.log("3. ✅ Full Autonomous Auto-Apply E2E Verified (5 Stages):", JSON.stringify({
      autoStatus,
      audit: {
        ...autoAudit,
        step2: autoAudit?.step2
          ? {
              ...autoAudit.step2,
              requiredEssayPreview: (autoAudit.step2.requiredEssay || "").slice(0, 75) + "...",
              optionalExtraStayedBlank: autoAudit.step2.optionalExtra === ""
            }
          : null
      }
    }, null, 2));

    if (
      !autoStatus?.completed ||
      !autoAudit?.clickedApplyNow ||
      !autoAudit?.signInAttempted ||
      !autoAudit?.switchedToSignup ||
      !autoAudit?.signupVerifiedMatch ||
      !autoAudit?.otpVerified ||
      !autoAudit?.submitted ||
      autoAudit.step1?.streetAddress !== "39861 Potrero Dr" ||
      autoAudit.step1?.linkedin !== "https://www.linkedin.com/in/raviteja-velanati/" ||
      autoAudit.step1?.github !== "https://github.com/ravitejav-dev" ||
      autoAudit.step1?.portfolio !== "https://3-d-portfolio-999a6bwm3-ravitejav-devs-projects.vercel.app" ||
      autoAudit.step1?.workAuth !== "Yes" ||
      autoAudit.step1?.sponsorship !== "Yes" ||
      autoAudit.step1?.visaStatus !== "H-1B" ||
      autoAudit.step1?.citizenship !== "India" ||
      autoAudit.step1?.yoeDecimal !== "3.5" ||
      autoAudit.step1?.yoeInt !== "3" ||
      !/(150,?000|165,?000|180,?000)/.test(autoAudit.step1?.desiredSalary || "") ||
      autoAudit.step1?.resumeFile !== "Raviteja_velanati_OpenAI.pdf" ||
      autoAudit.step1?.resumeBytes < 1000 ||
      autoAudit.step1?.coverLetterFile !== "Raviteja_Velanati_OpenAI_Cover_Letter.pdf" ||
      autoAudit.step1?.coverLetterBytes < 1000 ||
      autoAudit.step2?.govClearance !== "No" ||
      autoAudit.step2?.gender !== "Male" ||
      autoAudit.step2?.sexualOrientation !== "Heterosexual / Straight" ||
      autoAudit.step2?.lgbtq !== "No" ||
      (autoAudit.step2?.requiredEssay || "").length < 30 ||
      autoAudit.step2?.optionalExtra !== ""
    ) {
      throw new Error("Full Autonomous Auto-Apply E2E assertion failed!");
    }
    autoCdp.close();

    // 2b. WORKDAY FULL-FLOW END-TO-END VIA SIMPLIFY-STYLE DOCKED PILL -> KEYWORDS "TAILOR & AUTO-APPLY" BUTTON
    // (Tests: Job Posting stays as non-intrusive right-edge pill -> Click Pill -> Keywords Tab -> Tailor & Auto-Apply -> Header SignIn Trap Ignored -> Adventure "Apply" -> Async "Start Your Application" Modal -> "Apply Manually" -> "Sign in with email" -> Sign In Fail -> Switch to Create Account -> Read More + opacity:0 Checkbox + opacity:0 click_filter -> Background Email Verification Link Activation -> Step 2 Sign In via click_filter -> Workday searchBox Combobox + State countryRegion + Spinbutton Date + Tailored PDF -> Submit -> Auto-Track!)
    const wdE2eCdp = await openTabAndConnect("http://127.0.0.1:18765/sandbox/workday-full-e2e");
    let wdInitialUi = null;
    for (let i = 0; i < 20; i++) {
      wdInitialUi = await wdE2eCdp
        .eval(`(() => {
          const sr = document.getElementById("jobify-copilot-host")?.shadowRoot;
          const pill = sr?.getElementById("jb-pill");
          const drawer = sr?.getElementById("jb-drawer");
          if (!pill || !drawer) return null;
          return {
            pillVisible: getComputedStyle(pill).display !== "none",
            drawerOpenOnJobPosting: drawer.classList.contains("open")
          };
        })()`)
        .catch(() => null);
      if (wdInitialUi?.pillVisible) break;
      await sleep(300);
    }
    if (!wdInitialUi?.pillVisible || wdInitialUi.drawerOpenOnJobPosting !== false) {
      throw new Error(`Expected non-intrusive docked pill (drawer closed) on job posting page: ${JSON.stringify(wdInitialUi)}`);
    }
    await wdE2eCdp.eval(`
      (async () => {
        const sr = document.getElementById("jobify-copilot-host").shadowRoot;
        sr.getElementById("jb-pill").click();
        await new Promise(r => setTimeout(r, 200));
        sr.querySelector(".jb-tab[data-tab='keywords']").click();
        await new Promise(r => setTimeout(r, 200));
        sr.getElementById("jb-run-tailor").click();
      })()
    `);

    let wdAudit = null;
    for (let waitIdx = 0; waitIdx < 90; waitIdx++) {
      await sleep(1000);
      wdAudit = await wdE2eCdp.eval(`window.__WD_E2E_AUDIT__`).catch(() => null);
      if (wdAudit?.submitted) break;
    }
    let wdSessionStatus = null;
    for (let sIdx = 0; sIdx < 20; sIdx++) {
      await sleep(400);
      wdSessionStatus = await swCdp.eval(`chrome.storage.local.get("jobify_auto_apply_session").then(r => r.jobify_auto_apply_session)`);
      if (wdSessionStatus && !wdSessionStatus.running) break;
    }
    console.log("3b. ✅ Workday Full-Flow E2E (Triggered via 'Tailor Resume' in AI Studio) Verified:", JSON.stringify({
      wdSessionStatus,
      wdAudit
    }, null, 2));

    if (
      !wdSessionStatus?.completed ||
      !wdAudit ||
      wdAudit.headerSignInTrapClicked !== false ||
      wdAudit.usedLinkedInOrLastAppTrap !== false ||
      !wdAudit.clickedAdventure ||
      !wdAudit.clickedApplyManually ||
      !wdAudit.clickedSignInWithEmail ||
      !wdAudit.triedSignInFirst ||
      !wdAudit.switchedToCreateAccount ||
      !wdAudit.readMoreExpanded ||
      !wdAudit.termsChecked ||
      !wdAudit.accountCreatedViaClickFilter ||
      !wdAudit.emailLinkVerified ||
      !wdAudit.signedInAfterCreateViaClickFilter ||
      wdAudit.step1?.howDidYouHear !== "LinkedIn" ||
      wdAudit.step1?.firstName !== "Raviteja" ||
      wdAudit.step1?.lastName !== "Velanati" ||
      wdAudit.step1?.streetAddress !== "39861 Potrero Dr" ||
      wdAudit.step1?.city !== "Newark" ||
      wdAudit.step1?.state !== "California" ||
      wdAudit.step1?.postalCode !== "94560" ||
      wdAudit.step1?.phoneDeviceType !== "Cellular" ||
      wdAudit.step2?.resumeFile !== "Raviteja_velanati_NVIDIA.pdf" ||
      wdAudit.step2?.resumeBytes < 1000 ||
      wdAudit.step2?.linkedin !== "https://www.linkedin.com/in/raviteja-velanati/" ||
      wdAudit.step2?.workAuth !== "Yes" ||
      wdAudit.step2?.sponsorship !== "Yes" ||
      wdAudit.step2?.gender !== "Male" ||
      wdAudit.step2?.cc305Name !== "Raviteja Velanati" ||
      wdAudit.step2?.cc305EmployeeId !== "" ||
      !wdAudit.step2?.cc305Disability?.startsWith("No, I do not have a disability") ||
      wdAudit.step2?.signMonth?.length !== 2 ||
      wdAudit.step2?.signDay?.length !== 2 ||
      wdAudit.step2?.signYear !== String(new Date().getFullYear()) ||
      wdAudit.step2?.optionalComments !== "" ||
      !wdAudit.submitted
    ) {
      throw new Error("Workday Full-Flow End-to-End assertion failed!");
    }
    wdE2eCdp.close();

    // 2c. LIVE PRODUCTION NVIDIA WORKDAY GATE CHECK (Real nvidia.wd5.myworkdayjobs.com: Adventure "Apply" -> Async Modal -> "Apply Manually" -> "Sign in with email" -> signInContent Email+Password without touching utilityButtonSignIn)
    let liveWdJobUrl = null;
    try {
      const cxsResp = await fetch("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 3, offset: 0, searchText: "Engineer" })
      }).then((r) => r.json());
      const extPath = cxsResp?.jobPostings?.find((j) => j.externalPath)?.externalPath;
      if (extPath) {
        liveWdJobUrl = `https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite${extPath}`;
      }
    } catch (_) {}

    if (liveWdJobUrl) {
      const liveWdCdp = await openTabAndConnect(liveWdJobUrl);
      for (let i = 0; i < 35; i++) {
        const hasAdv = await liveWdCdp
          .eval(`Boolean(document.querySelector("[data-automation-id='adventureButton']") && document.getElementById("jobify-copilot-host")?.shadowRoot)`)
          .catch(() => false);
        if (hasAdv) break;
        await sleep(400);
      }
      const liveEntryRes = await swCdp.eval(`
        (async () => {
          const targetTabId = ${liveWdCdp.tabId};
          const step1 = await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            func: async () => {
              window.__jbUtilClicked = false;
              const utilBtn = document.querySelector("[data-automation-id='utilityButtonSignIn']");
              if (utilBtn) utilBtn.addEventListener("click", () => { window.__jbUtilClicked = true; });
              return await window.__JOBIFY_ADAPTERS__.clickApplyEntryButton();
            }
          }).catch(() => null);
          const applyRes = step1?.[0]?.result || null;

          // Wait for Workday navigation / SPA route / auth gate after Apply Manually
          for (let w = 0; w < 22; w++) {
            await new Promise(r => setTimeout(r, 400));
            const probe = await chrome.scripting.executeScript({
              target: { tabId: targetTabId },
              func: () => ({
                hasEmailBtn: Boolean(document.querySelector("[data-automation-id='SignInWithEmailButton']")),
                pwCount: document.querySelectorAll("input[type='password']").length
              })
            }).catch(() => null);
            const pr = probe?.[0]?.result;
            if (pr?.hasEmailBtn || pr?.pwCount > 0) break;
          }

          const step2 = await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            func: async () => {
              const emailGateBtn = document.querySelector("[data-automation-id='SignInWithEmailButton']");
              let clickedEmailGate = false;
              if (emailGateBtn) {
                emailGateBtn.click();
                clickedEmailGate = true;
                for (let i = 0; i < 18; i++) {
                  await new Promise(r => setTimeout(r, 300));
                  if (document.querySelectorAll("input[type='password']").length > 0) break;
                }
              }
              return {
                url: location.href,
                utilClicked: Boolean(window.__jbUtilClicked),
                clickedEmailGate,
                signInMounted: Boolean(document.querySelector("[data-automation-id='signInContent']")),
                emailInputMounted: Boolean(document.querySelector("input[data-automation-id='email']")),
                pwCount: document.querySelectorAll("input[type='password']").length,
                hasClickFilter: Boolean(document.querySelector("[data-automation-id='signInContent'] [data-automation-id='click_filter']"))
              };
            }
          });
          return { applyRes, ...(step2?.[0]?.result || {}) };
        })()
      `);
      console.log("3c. ✅ Live Production NVIDIA Workday Modal + Email Auth Gate Verified:", JSON.stringify(liveWdJobUrl), JSON.stringify(liveEntryRes, null, 2));
      if (
        liveEntryRes.utilClicked !== false ||
        !(liveEntryRes.applyRes?.clickedModalChoice || /\/apply\/applyManually/i.test(liveEntryRes.url || "")) ||
        !liveEntryRes.signInMounted ||
        !liveEntryRes.emailInputMounted ||
        liveEntryRes.pwCount < 1
      ) {
        throw new Error("Live production NVIDIA Workday modal/auth gate assertion failed!");
      }
      liveWdCdp.close();
    }

    // 3. Greenhouse Sandbox inside real Chrome extension
    const ghCdp = await openTabAndConnect(`chrome-extension://${extId}/sandbox/greenhouse.html`);
    const pillMounted = await ghCdp.eval(`Boolean(document.getElementById("jobify-copilot-host")?.shadowRoot?.getElementById("jb-pill"))`);
    const pillScore = await ghCdp.eval(`document.getElementById("jobify-copilot-host")?.shadowRoot?.getElementById("jb-pill-score")?.textContent`);
    console.log(`4. ✅ Greenhouse Sandbox Shadow-DOM Copilot Pill Mounted: ${pillMounted} (${pillScore})`);
    if (!pillMounted) throw new Error("Shadow-DOM pill missing on Greenhouse sandbox!");

    await ghCdp.eval(`
      (async () => {
        const sr = document.getElementById("jobify-copilot-host").shadowRoot;
        if (!sr.getElementById("jb-drawer").classList.contains("open")) {
          sr.getElementById("jb-pill").click();
          await new Promise(r => setTimeout(r, 200));
        }
        sr.getElementById("jb-btn-autofill").click();
      })()
    `);
    await sleep(1800);

    const gh = await ghCdp.eval(`({
      firstName: document.getElementById("first_name").value,
      lastName: document.getElementById("last_name").value,
      email: document.getElementById("email").value,
      phone: document.getElementById("phone").value,
      location: document.getElementById("location_city").value,
      resumeFile: document.getElementById("resume_file").files[0]?.name || null,
      resumeBytes: document.getElementById("resume_file").files[0]?.size || 0,
      linkedin: document.getElementById("linkedin_url").value,
      company: document.getElementById("curr_company").value,
      workAuth: document.getElementById("work_auth").value,
      sponsorship: document.getElementById("sponsorship").value,
      gender: document.getElementById("eeo_gender").value,
      race: document.getElementById("eeo_race").value,
      vet: document.getElementById("eeo_vet").value,
      dis: document.getElementById("eeo_dis").value,
      whyAnthropic: document.getElementById("why_anthropic").value,
      complexSys: document.getElementById("complex_sys").value
    })`);
    console.log("4. ✅ Greenhouse Sandbox 1-Click Autofill + AI Essay Verified:", JSON.stringify({
      ...gh,
      whyAnthropic: gh.whyAnthropic.slice(0, 80) + "...",
      complexSys: gh.complexSys.slice(0, 80) + "...",
      distinctOpenAnswers: gh.whyAnthropic !== gh.complexSys
    }, null, 2));

    if (
      gh.firstName !== "Raviteja" ||
      gh.lastName !== "Velanati" ||
      gh.email !== "ravitejavelanati11@gmail.com" ||
      gh.resumeFile !== "Raviteja_velanati_Anthropic.pdf" ||
      gh.resumeBytes !== 5770 ||
      gh.workAuth !== "Yes" ||
      gh.gender !== "Male" ||
      gh.race !== "Asian" ||
      gh.whyAnthropic.length < 50 ||
      gh.complexSys.length < 50 ||
      gh.whyAnthropic === gh.complexSys
    ) {
      throw new Error("Greenhouse assertion mismatch or duplicate open answers!");
    }

    await ghCdp.eval(`document.querySelector("button[type='submit']").click()`);
    await sleep(500);
    ghCdp.close();

    // 3. Workday + Candidate Account Creation Sandbox
    const wdCdp = await openTabAndConnect(`chrome-extension://${extId}/sandbox/workday.html`);
    await wdCdp.eval(`
      (async () => {
        const sr = document.getElementById("jobify-copilot-host").shadowRoot;
        if (!sr.getElementById("jb-drawer").classList.contains("open")) {
          sr.getElementById("jb-pill").click();
          await new Promise(r => setTimeout(r, 200));
        }
        sr.getElementById("jb-btn-autofill").click();
      })()
    `);
    await sleep(1600);

    const wd = await wdCdp.eval(`({
      portalEmail: document.getElementById("wd-email").value,
      pwMatch: document.getElementById("wd-pw").value.length >= 8,
      pwVerifyMatch: document.getElementById("wd-pw2").value === document.getElementById("wd-pw").value,
      consentChecked: document.querySelector("[data-automation-id='createAccountCheckbox']").checked,
      firstName: document.getElementById("wd-fn").value,
      lastName: document.getElementById("wd-ln").value,
      city: document.getElementById("wd-city").value,
      zip: document.getElementById("wd-zip").value,
      expCompany: document.querySelector("input[name='exp_company']").value,
      eduSchool: document.querySelector("input[name='edu_school']").value,
      eduGpa: document.querySelector("input[name='edu_gpa']").value,
      resumeFile: document.getElementById("wd-res").files[0]?.name || null
    })`);
    console.log("5. ✅ Workday Account Signup + Multi-Entry Autofill Verified:", JSON.stringify(wd, null, 2));

    if (
      wd.portalEmail !== "ravitejavelanati11@gmail.com" ||
      !wd.pwMatch ||
      !wd.pwVerifyMatch ||
      !wd.consentChecked ||
      !wd.expCompany.includes("GlobalLogic") ||
      !wd.eduSchool.includes("Clark") ||
      wd.resumeFile !== "Raviteja_velanati_Databricks.pdf"
    ) {
      throw new Error("Workday assertion mismatch!");
    }
    wdCdp.close();

    // 4. Lever Sandbox
    const lvCdp = await openTabAndConnect(`chrome-extension://${extId}/sandbox/lever.html`);
    await lvCdp.eval(`
      (async () => {
        const sr = document.getElementById("jobify-copilot-host").shadowRoot;
        if (!sr.getElementById("jb-drawer").classList.contains("open")) {
          sr.getElementById("jb-pill").click();
          await new Promise(r => setTimeout(r, 200));
        }
        sr.getElementById("jb-btn-autofill").click();
      })()
    `);
    await sleep(1500);

    const lv = await lvCdp.eval(`({
      fullName: document.querySelector("input[name='name']").value,
      email: document.querySelector("input[name='email']").value,
      org: document.querySelector("input[name='org']").value,
      salary: document.querySelector("input[name='salary_expectation']").value,
      startDate: document.querySelector("input[name='start_date']").value,
      commentsLen: document.querySelector("textarea[name='comments']").value.length,
      resumeFile: document.querySelector("input[name='resume']").files[0]?.name || null
    })`);
    console.log("6. ✅ Lever 1-Click Autofill Verified:", JSON.stringify(lv, null, 2));
    if (lv.fullName !== "Raviteja Velanati" || lv.commentsLen < 50 || lv.resumeFile !== "Raviteja_velanati_Scale_AI.pdf") {
      throw new Error("Lever assertion mismatch!");
    }

    // 4b. Built-In Bundled Extension Sandbox Autonomous Auto-Submit (verifies ADAPTER_RPC fallback on chrome-extension:// URLs!)
    const bundledSubRes = await lvCdp.eval(`
      chrome.runtime.sendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: { tabId: ${lvCdp.tabId}, autoSubmit: true, tailorResume: false, awaitCompletion: true }
      })
    `);
    const bundledLvSubmitted = await lvCdp.eval(`getComputedStyle(document.getElementById("lv-done")).display === "block"`);
    console.log("6b. ✅ Bundled chrome-extension:// Sandbox Autonomous Auto-Submit Verified:", JSON.stringify({
      ok: bundledSubRes?.ok,
      submitted: bundledSubRes?.submitted,
      status: bundledSubRes?.status,
      lvDoneBannerVisible: bundledLvSubmitted
    }, null, 2));
    if (!bundledSubRes?.submitted || !bundledLvSubmitted) {
      throw new Error("Bundled chrome-extension:// sandbox auto-submit failed!");
    }
    lvCdp.close();

    // 4c. Tricky SPA Auto-Submit & Validation Self-Healing (/sandbox/tricky-submit via Copilot Fast Auto-Submit button)
    const trickyCdp = await openTabAndConnect("http://127.0.0.1:18765/sandbox/tricky-submit");
    for (let i = 0; i < 20; i++) {
      const hasWidget = await trickyCdp
        .eval(`Boolean(document.getElementById("jobify-copilot-host")?.shadowRoot?.getElementById("jb-btn-fast-auto"))`)
        .catch(() => false);
      if (hasWidget) break;
      await sleep(250);
    }
    await trickyCdp.eval(`
      (async () => {
        const sr = document.getElementById("jobify-copilot-host").shadowRoot;
        if (!sr.getElementById("jb-drawer").classList.contains("open")) {
          sr.getElementById("jb-pill").click();
          await new Promise(r => setTimeout(r, 250));
        }
        sr.getElementById("jb-btn-fast-auto").click();
      })()
    `);
    let trickyAudit = null;
    for (let waitIdx = 0; waitIdx < 75; waitIdx++) {
      await sleep(700);
      trickyAudit = await trickyCdp.eval(`window.__TRICKY_AUDIT__`).catch(() => null);
      if (trickyAudit?.submitted) break;
    }
    await sleep(600);
    console.log("6c. ✅ Tricky SPA Auto-Submit + Validation Self-Healing Verified:", JSON.stringify(trickyAudit, null, 2));
    if (
      !trickyAudit?.submitted ||
      trickyAudit.cookieClicked !== false ||
      trickyAudit.cookieChecked !== false ||
      trickyAudit.authYesSelected !== true ||
      trickyAudit.firstSubmitRejectedUnmarkedField !== true ||
      trickyAudit.submitClicks < 2 ||
      trickyAudit.healedAndSubmittedOnRetry !== true ||
      trickyAudit.finalValues?.fullName !== "Raviteja Velanati" ||
      trickyAudit.finalValues?.resumeName !== "Raviteja_velanati_Perplexity_AI.pdf" ||
      !trickyAudit.finalValues?.privacyChecked ||
      !(trickyAudit.finalValues?.exceptionalAbility?.length > 25) ||
      !(trickyAudit.finalValues?.unmarkedTeamHealedValue?.length > 0) ||
      trickyAudit.finalValues?.optionalPubs !== "" ||
      JSON.stringify(trickyAudit.finalValues?.checkedSources) !== JSON.stringify(["LinkedIn"])
    ) {
      throw new Error(`Tricky SPA auto-submit assertion failed: ${JSON.stringify(trickyAudit)}`);
    }
    trickyCdp.close();

    // 4e. Autonomous AI Form Error Doctor + Simplify-Style Widget Lifecycle (/sandbox/ai-error-heal)
    const aiHealCdp = await openTabAndConnect("http://127.0.0.1:18765/sandbox/ai-error-heal");
    let initialPopupState = null;
    for (let i = 0; i < 25; i++) {
      initialPopupState = await aiHealCdp
        .eval(`(() => {
          const sr = document.getElementById("jobify-copilot-host")?.shadowRoot;
          if (!sr) return null;
          const drawer = sr.getElementById("jb-drawer");
          if (!drawer || !drawer.classList.contains("open")) return null;
          const rect = drawer.getBoundingClientRect();
          const compChipText = sr.querySelector(".jb-mini-chip.comp")?.textContent?.trim() || null;
          return {
            drawerOpenOnLoad: drawer.classList.contains("open") && getComputedStyle(drawer).display !== "none",
            topPx: Math.round(rect.top),
            rightGapPx: Math.round(window.innerWidth - rect.right),
            hasFastAutoBtn: Boolean(sr.getElementById("jb-btn-fast-auto")),
            compChipText
          };
        })()`)
        .catch(() => null);
      if (initialPopupState?.drawerOpenOnLoad && initialPopupState?.compChipText) break;
      await sleep(250);
    }

    // Verify Profile tab masks password and Minimize -> Right-Edge Docked Pill -> Re-Open Lifecycle
    const minimizeReopenCheck = await aiHealCdp.eval(`
      (async () => {
        const sr = document.getElementById("jobify-copilot-host").shadowRoot;
        sr.querySelector(".jb-tab[data-tab='profile']").click();
        await new Promise(r => setTimeout(r, 80));
        const passwordMaskedInWidget = (sr.getElementById("jb-body")?.innerText || "").includes("••••••••••••");
        sr.querySelector(".jb-tab[data-tab='autofill']").click();
        await new Promise(r => setTimeout(r, 80));
        const closeBtn = sr.getElementById("jb-close");
        const pill = sr.getElementById("jb-pill");
        const drawer = sr.getElementById("jb-drawer");
        closeBtn.click();
        await new Promise(r => setTimeout(r, 120));
        const pillVisibleWhenMinimized = getComputedStyle(pill).display !== "none" && !drawer.classList.contains("open");
        pill.click();
        await new Promise(r => setTimeout(r, 120));
        const drawerReopened = drawer.classList.contains("open") && getComputedStyle(pill).display === "none";
        return { passwordMaskedInWidget, pillVisibleWhenMinimized, drawerReopened };
      })()
    `);

    if (
      !initialPopupState?.drawerOpenOnLoad ||
      initialPopupState.topPx > 26 ||
      initialPopupState.rightGapPx > 40 ||
      !initialPopupState.compChipText?.includes("$180,000 - $210,000") ||
      !minimizeReopenCheck?.passwordMaskedInWidget ||
      !minimizeReopenCheck?.pillVisibleWhenMinimized ||
      !minimizeReopenCheck?.drawerReopened
    ) {
      throw new Error(`Simplify-style widget lifecycle or salary/masking check failed: ${JSON.stringify({ initialPopupState, minimizeReopenCheck })}`);
    }

    // Trigger Auto-Apply directly from the open panel
    await aiHealCdp.eval(`
      document.getElementById("jobify-copilot-host").shadowRoot.getElementById("jb-btn-fast-auto").click()
    `);

    let sawTakeControlHud = false;
    let aiHealAudit = null;
    for (let waitIdx = 0; waitIdx < 75; waitIdx++) {
      await sleep(450);
      const stepSnap = await aiHealCdp
        .eval(`(() => {
          const sr = document.getElementById("jobify-copilot-host")?.shadowRoot;
          const hud = sr?.getElementById("jb-hud");
          const frame = sr?.getElementById("jb-control-frame");
          const hudVisible = Boolean(hud && getComputedStyle(hud).display !== "none");
          const frameActive = Boolean(frame && frame.classList.contains("active"));
          return { hudVisible, frameActive, audit: window.__AI_HEAL_AUDIT__ };
        })()`)
        .catch(() => null);
      if (stepSnap?.hudVisible || stepSnap?.frameActive) sawTakeControlHud = true;
      if (stepSnap?.audit) aiHealAudit = stepSnap.audit;
      if (stepSnap?.audit?.submitted) {
        break;
      }
    }

    // Wait ~2.1s for the panel & HUD to collapse cleanly and dock the right-edge pill ("✓ Applied")
    await sleep(2150);
    const postDonePopupState = await aiHealCdp.eval(`(() => {
      const sr = document.getElementById("jobify-copilot-host")?.shadowRoot;
      const drawer = sr?.getElementById("jb-drawer");
      const hud = sr?.getElementById("jb-hud");
      const frame = sr?.getElementById("jb-control-frame");
      const pill = sr?.getElementById("jb-pill");
      const pillScore = sr?.getElementById("jb-pill-score")?.textContent || "";
      return {
        drawerDisplay: drawer ? getComputedStyle(drawer).display : "none",
        hudDisplay: hud ? getComputedStyle(hud).display : "none",
        frameDisplay: frame ? getComputedStyle(frame).display : "none",
        pillDockedVisible: Boolean(pill && getComputedStyle(pill).display !== "none"),
        pillScore
      };
    })()`);

    console.log("6e. ✅ Autonomous AI Error Doctor + Simplify-Style Edge-Pill Lifecycle Verified:", JSON.stringify({
      initialPopupState,
      minimizeReopenCheck,
      sawTakeControlHud,
      aiHealAudit,
      postDonePopupState
    }, null, 2));

    if (
      !sawTakeControlHud ||
      !aiHealAudit?.submitted ||
      aiHealAudit.submitClicks < 2 ||
      !aiHealAudit.firstSubmitErrors?.includes("phone_format") ||
      !aiHealAudit.firstSubmitErrors?.includes("salary_format") ||
      !aiHealAudit.firstSubmitErrors?.includes("unmarked_pod") ||
      aiHealAudit.finalValues?.fullName !== "Raviteja Velanati" ||
      aiHealAudit.finalValues?.resumeName !== "Raviteja_velanati_Mistral_AI.pdf" ||
      aiHealAudit.finalValues?.phone !== "7748108481" ||
      aiHealAudit.finalValues?.salary !== "$195,000" ||
      !(aiHealAudit.finalValues?.pod?.length >= 30) ||
      aiHealAudit.finalValues?.authYes !== true ||
      aiHealAudit.finalValues?.consentChecked !== true ||
      postDonePopupState.drawerDisplay !== "none" ||
      postDonePopupState.hudDisplay !== "none" ||
      postDonePopupState.frameDisplay !== "none" ||
      postDonePopupState.pillDockedVisible !== true ||
      postDonePopupState.pillScore !== "✓ Applied"
    ) {
      throw new Error(`AI Error Doctor or Edge-Pill Lifecycle assertion failed: ${JSON.stringify({ sawTakeControlHud, aiHealAudit, postDonePopupState })}`);
    }
    aiHealCdp.close();

    const dashCdp = await openTabAndConnect(`chrome-extension://${extId}/dashboard/dashboard.html`);
    await dashCdp.send("Runtime.enable", {});

    // 4d. Live Production OpenAI Ashby Non-Submitting Sanity Check (autoSubmit: false)
    const ashbyBoard = await fetch("https://api.ashbyhq.com/posting-api/job-board/openai")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const liveAshbyJob = (ashbyBoard?.jobs || []).find((j) => j?.id && j?.isListed !== false) || ashbyBoard?.jobs?.[0];
    if (liveAshbyJob?.id) {
      const ashbyAppUrl = `https://jobs.ashbyhq.com/openai/${liveAshbyJob.id}/application`;
      const ashbyCdp = await openTabAndConnect(ashbyAppUrl);
      await ashbyCdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      for (let i = 0; i < 30; i++) {
        const mounted = await ashbyCdp
          .eval(`Boolean(document.querySelector("input, textarea") && document.getElementById("jobify-copilot-host")?.shadowRoot)`)
          .catch(() => false);
        if (mounted) break;
        await sleep(400);
      }
      const ashbyRun = await dashCdp.eval(
        `chrome.runtime.sendMessage({ type: "START_FULL_AUTO_APPLY", payload: { tabId: ${ashbyCdp.tabId}, options: { autoSubmit: false, tailorResume: false }, awaitCompletion: true } })`,
        55000
      );
      console.log("6d. ✅ Live Production OpenAI Ashby Non-Submitting Auto-Fill Sanity Verified:", JSON.stringify({
        jobTitle: liveAshbyJob.title,
        url: ashbyAppUrl,
        ok: ashbyRun?.ok,
        status: ashbyRun?.status,
        submitted: ashbyRun?.submitted,
        totalFilledFields: ashbyRun?.totalFilledFields
      }, null, 2));
      if (!ashbyRun?.ok || ashbyRun.submitted !== false || !(ashbyRun.totalFilledFields >= 4)) {
        throw new Error(`Live OpenAI Ashby non-submitting check failed: ${JSON.stringify(ashbyRun)}`);
      }
      ashbyCdp.close();
    }

    // 4f. STEP 2 ANTI-HANG REGRESSION TEST (Tailor Step 1 -> Apply mutates URL hash #apply -> Delayed Modal Wrapper -> Popup-Blocked window.open -> Div-only Label-identified Form -> Submit!)
    const step2RegCdp = await openTabAndConnect("http://127.0.0.1:18765/sandbox/verify-account");
    await step2RegCdp.eval(`
      (() => {
        const isFormView = location.search.includes("step2_manual_form=1");
        if (!isFormView) {
          document.title = "Staff AI Systems Engineer - Databricks";
          document.body.innerHTML = \`
            <main style="max-width:760px;margin:30px auto;font-family:sans-serif;">
              <h1>Staff AI Systems Engineer</h1>
              <div class="company">Databricks</div>
              <p>Build distributed LLM inference, vector retrieval, PyTorch, Kubernetes, and evaluation pipelines in San Francisco, CA. Salary: $180,000 - $220,000.</p>
              <button id="entry-apply-btn" data-automation-id="adventureButton" type="button">Apply</button>
              <div id="modal-mount"></div>
            </main>
          \`;
          document.getElementById("entry-apply-btn").addEventListener("click", () => {
            // Mutate URL hash immediately (which previously caused clickApplyEntryButton to exit before modal mounted!)
            location.hash = "#apply";
            setTimeout(() => {
              document.getElementById("modal-mount").innerHTML = \`
                <div role="dialog" aria-modal="true" data-automation-id="wd-popup-frame" style="display:block;padding:20px;border:1px solid #ccc;">
                  <h2>Start Your Application</h2>
                  <div data-automation-id="applyManually">
                    <button id="inner-manual-btn" type="button">Apply Manually</button>
                  </div>
                </div>
              \`;
              document.getElementById("inner-manual-btn").addEventListener("click", () => {
                // Simulate Chrome Popup Blocker blocking window.open after 5s Step 1 Tailor!
                const targetUrl = "http://127.0.0.1:18765/sandbox/verify-account?step2_manual_form=1";
                try {
                  document.documentElement.setAttribute("data-jobify-last-window-open", targetUrl);
                } catch (_) {}
                // Do NOT navigate via window.open (simulating blocked popup)
              });
            }, 450);
          });
        }
      })();
    `);
    // Intercept ?step2_manual_form=1 load on the same tab so when executeStep2ApplyAndTransition navigates to it, we render a <main data-automation-id="myInformationPage"> <div>-based form with auto-generated IDs
    await step2RegCdp.send("Page.enable", {});
    await step2RegCdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        if (location.search.includes("step2_manual_form=1")) {
          window.addEventListener("DOMContentLoaded", () => {
            document.title = "Apply Manually - Databricks";
            document.body.innerHTML = \`
              <main data-automation-id="myInformationPage" style="max-width:700px;margin:24px auto;font-family:sans-serif;">
                <h2>My Information</h2>
                <div class="field"><label for="input-gen-1">First Name *</label><input id="input-gen-1" type="text" required /></div>
                <div class="field"><label for="input-gen-2">Last Name *</label><input id="input-gen-2" type="text" required /></div>
                <div class="field"><label for="input-gen-3">Email Address *</label><input id="input-gen-3" type="email" required /></div>
                <div class="field"><label for="input-gen-4">Phone Number *</label><input id="input-gen-4" type="tel" required /></div>
                <button id="div-form-submit" data-jobify-submit="true" type="button">Submit Application</button>
              </main>
            \`;
            document.getElementById("div-form-submit").addEventListener("click", () => {
              window.__STEP2_REG_SUBMITTED__ = {
                firstName: document.getElementById("input-gen-1").value,
                lastName: document.getElementById("input-gen-2").value,
                email: document.getElementById("input-gen-3").value,
                phone: document.getElementById("input-gen-4").value
              };
              const banner = document.createElement("div");
              banner.id = "submit-banner";
              banner.textContent = "Thank you for applying to Databricks!";
              document.body.appendChild(banner);
            });
          });
        }
      `
    });

    const step2RegRes = await dashCdp.eval(
      `chrome.runtime.sendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: {
          tabId: ${step2RegCdp.tabId},
          awaitCompletion: true,
          options: {
            tailorResume: true,
            autoSubmit: true,
            jobMeta: {
              company: "Databricks",
              title: "Staff AI Systems Engineer",
              location: "San Francisco, CA",
              description: "Build distributed LLM inference, vector retrieval, PyTorch, Kubernetes, and evaluation pipelines in San Francisco, CA."
            }
          }
        }
      })`,
      65000
    );
    const step2SubVals = await step2RegCdp.eval(`window.__STEP2_REG_SUBMITTED__ || null`).catch(() => null);
    console.log("6f. ✅ Step 2 Anti-Hang Regression Verified (Tailor Step 1 -> Hash #apply + Delayed Manual Modal -> Popup-Blocked window.open Recovery -> Div/Label Form Fill & Submit):", JSON.stringify({
      ok: step2RegRes?.ok,
      submitted: step2RegRes?.submitted,
      status: step2RegRes?.status,
      step2SubVals
    }, null, 2));
    if (
      !step2RegRes?.ok ||
      !step2RegRes?.submitted ||
      step2SubVals?.firstName !== "Raviteja" ||
      step2SubVals?.lastName !== "Velanati" ||
      !step2SubVals?.email?.includes("raviteja")
    ) {
      throw new Error(`Step 2 Anti-Hang Regression failed: ${JSON.stringify({ step2RegRes, step2SubVals })}`);
    }
    step2RegCdp.close();

    // 4h. UNIVERSAL LOGIN -> MULTI-FIELD CREATE ACCOUNT (1-PASSWORD + FIRST/LAST NAME + CONFIRM EMAIL + PHONE + COUNTRY + TERMS) REGRESSION TEST (Gate 6g)
    // Verifies that on any portal:
    // 1. Clicking "Apply to Job" opens a Login portal.
    // 2. Trying "Sign In" fails (even without .error/.alert classes) and automatically clicks "<p>Don't have an account? <a>Click here</a></p>".
    // 3. The Create Account page (which asks for First Name, Last Name, Email, Confirm Email, Phone, Country, 1 Password, and Terms Checkbox) is recognized as an Auth Wall (not misclassified as the candidate form), fills ALL registration fields, and taps "Create an Account".
    // 4. Transitions to the Application Form, uploads tailored PDF resume (Raviteja_velanati_Cohere.pdf), fills remaining fields, and submits!
    const authRegCdp = await openTabAndConnect("http://127.0.0.1:18765/ats/greenhouse?universal_auth_test=1");
    await authRegCdp.eval(`
      (() => {
        document.title = "Senior LLM Systems Engineer - Cohere";
        document.body.innerHTML = \`
          <div id="cohere-portal" style="max-width:680px;margin:24px auto;font-family:sans-serif;">
            <h1>Senior LLM Systems Engineer — Cohere</h1>
            <p>Location: San Francisco, CA | Compensation: $195,000 - $240,000</p>
            <p>Architect high-throughput LLM serving, RAG pipelines, Python, TypeScript, Kubernetes, and evaluation systems.</p>
            <button id="btn-apply-to-job" type="button">Apply to Job</button>
          </div>
        \`;
        window.__AUTH_REG_AUDIT__ = {
          clickedApplyToJob: false,
          triedSignIn: false,
          switchedViaClickHere: false,
          registrationFieldsFilled: null,
          createdAccountSuccess: false,
          submittedApp: null
        };
        document.getElementById("btn-apply-to-job").addEventListener("click", () => {
          window.__AUTH_REG_AUDIT__.clickedApplyToJob = true;
          document.body.innerHTML = \`
            <div id="login-view" style="max-width:520px;margin:24px auto;font-family:sans-serif;">
              <h1>Candidate Sign In</h1>
              <p>Please sign in to your account to apply for this position.</p>
              <div id="plain-login-msg" style="display:none;padding:8px;margin-bottom:8px;"></div>
              <div><label for="login-email">Email Address *</label><input id="login-email" type="email" required /></div>
              <div><label for="login-pw">Password *</label><input id="login-pw" type="password" required /></div>
              <button id="btn-login-submit" type="button">Sign In</button>
              <p style="margin-top:16px;">Don't have an account yet? <a id="link-click-here" href="#create-account">Click here</a></p>
            </div>
          \`;
          document.getElementById("btn-login-submit").addEventListener("click", () => {
            window.__AUTH_REG_AUDIT__.triedSignIn = true;
            const msg = document.getElementById("plain-login-msg");
            msg.style.display = "block";
            msg.textContent = "We could not find an account matching that email address.";
          });
          document.getElementById("link-click-here").addEventListener("click", (e) => {
            e.preventDefault();
            window.__AUTH_REG_AUDIT__.switchedViaClickHere = true;
            document.body.innerHTML = \`
              <div id="register-view" style="max-width:560px;margin:24px auto;font-family:sans-serif;">
                <h1>Create an Account</h1>
                <p>Complete all fields below to register your candidate profile.</p>
                <div class="field"><label for="reg-fn">First Name *</label><input id="reg-fn" name="firstName" type="text" required /></div>
                <div class="field"><label for="reg-ln">Last Name *</label><input id="reg-ln" name="lastName" type="text" required /></div>
                <div class="field"><label for="reg-email">Email Address *</label><input id="reg-email" name="email" type="email" required /></div>
                <div class="field"><label for="reg-email2">Confirm Email Address *</label><input id="reg-email2" name="confirmEmail" type="email" required /></div>
                <div class="field"><label for="reg-phone">Mobile Phone Number *</label><input id="reg-phone" name="phone" type="tel" required /></div>
                <div class="field">
                  <label for="reg-country">Country / Region *</label>
                  <select id="reg-country" name="country" required>
                    <option value="">Select Country</option>
                    <option value="United States">United States</option>
                    <option value="Canada">Canada</option>
                  </select>
                </div>
                <div class="field"><label for="reg-pw">Create Password *</label><input id="reg-pw" name="password" type="password" required /></div>
                <div class="field">
                  <label><input id="reg-terms" type="checkbox" required /> I have read and agree to the Candidate Privacy Policy and Terms of Service *</label>
                </div>
                <div id="reg-err" style="color:rgb(210,30,30);display:none;"></div>
                <button id="btn-create-account" type="button">Create an Account</button>
              </div>
            \`;
            document.getElementById("btn-create-account").addEventListener("click", () => {
              const fn = document.getElementById("reg-fn").value.trim();
              const ln = document.getElementById("reg-ln").value.trim();
              const em = document.getElementById("reg-email").value.trim();
              const em2 = document.getElementById("reg-email2").value.trim();
              const ph = document.getElementById("reg-phone").value.trim();
              const co = document.getElementById("reg-country").value;
              const pw = document.getElementById("reg-pw").value;
              const tm = document.getElementById("reg-terms").checked;
              window.__AUTH_REG_AUDIT__.registrationFieldsFilled = { fn, ln, em, em2, ph, co, hasPw: pw.length >= 8, tm };
              if (!fn || !ln || !em || em !== em2 || !ph || co !== "United States" || pw.length < 8 || !tm) {
                const err = document.getElementById("reg-err");
                err.style.display = "block";
                err.textContent = "Please complete all required registration fields.";
                return;
              }
              window.__AUTH_REG_AUDIT__.createdAccountSuccess = true;
              document.body.innerHTML = \`
                <form id="application_form" style="max-width:640px;margin:24px auto;font-family:sans-serif;">
                  <h2>Candidate Application — Cohere</h2>
                  <div class="field"><label for="app-res">Resume/CV *</label><input id="app-res" type="file" required /></div>
                  <div class="field"><label for="app-li">LinkedIn URL *</label><input id="app-li" type="text" required /></div>
                  <button id="btn-final-sub" type="submit">Submit Application</button>
                </form>
              \`;
              document.getElementById("application_form").addEventListener("submit", (ev) => {
                ev.preventDefault();
                window.__AUTH_REG_AUDIT__.submittedApp = {
                  resumeFile: document.getElementById("app-res").files[0]?.name || null,
                  linkedin: document.getElementById("app-li").value
                };
                const done = document.createElement("div");
                done.id = "submit-banner";
                done.textContent = "Thank you for applying to Cohere!";
                document.body.appendChild(done);
              });
            });
          });
        });
      })();
    `);

    const authRegRes = await dashCdp.eval(
      `chrome.runtime.sendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: {
          tabId: ${authRegCdp.tabId},
          awaitCompletion: true,
          options: {
            tailorResume: true,
            autoSubmit: true,
            jobMeta: {
              company: "Cohere",
              title: "Senior LLM Systems Engineer",
              location: "San Francisco, CA",
              description: "Architect high-throughput LLM serving, RAG pipelines, Python, TypeScript, Kubernetes, and evaluation systems."
            }
          }
        }
      })`,
      65000
    );
    const authRegAudit = await authRegCdp.eval(`window.__AUTH_REG_AUDIT__ || null`).catch(() => null);
    console.log("6g. ✅ Universal Login -> Multi-Field Create Account -> Auto-Submit Verified:", JSON.stringify({
      ok: authRegRes?.ok,
      submitted: authRegRes?.submitted,
      authRegAudit
    }, null, 2));
    if (
      !authRegRes?.ok ||
      !authRegRes?.submitted ||
      !authRegAudit?.clickedApplyToJob ||
      !authRegAudit?.triedSignIn ||
      !authRegAudit?.switchedViaClickHere ||
      !authRegAudit?.createdAccountSuccess ||
      authRegAudit?.registrationFieldsFilled?.fn !== "Raviteja" ||
      authRegAudit?.registrationFieldsFilled?.ln !== "Velanati" ||
      authRegAudit?.registrationFieldsFilled?.em !== "ravitejavelanati11@gmail.com" ||
      authRegAudit?.registrationFieldsFilled?.em2 !== "ravitejavelanati11@gmail.com" ||
      authRegAudit?.registrationFieldsFilled?.co !== "United States" ||
      !authRegAudit?.registrationFieldsFilled?.tm ||
      authRegAudit?.submittedApp?.resumeFile !== "Raviteja_velanati_Cohere.pdf"
    ) {
      throw new Error(`Universal Login & Create Account Regression failed: ${JSON.stringify({ authRegRes, authRegAudit })}`);
    }
    authRegCdp.close();

    // 4i. MICROSOFT CAREERS MULTI-PROVIDER SSO ("Sign in with Google" / Microsoft / LinkedIn / Facebook) + GOOGLE OAUTH POPUP + PRIVACY CONSENT + AUTO-SUBMIT (Gate 6h)
    const msSsoCdp = await openTabAndConnect("http://127.0.0.1:18765/sandbox/microsoft-sso");
    const msSsoRes = await dashCdp.eval(
      `chrome.runtime.sendMessage({
        type: "START_FULL_AUTO_APPLY",
        payload: {
          tabId: ${msSsoCdp.tabId},
          awaitCompletion: true,
          options: {
            tailorResume: true,
            autoSubmit: true
          }
        }
      })`,
      65000
    );
    const msSsoAudit = await msSsoCdp.eval(`window.__MS_SSO_AUDIT__ || null`).catch(() => null);
    console.log("6h. ✅ Microsoft Careers Multi-Provider SSO ('Sign in with Google') + Google OAuth Account Chooser Popup + Privacy Consent + Auto-Submit Verified:", JSON.stringify({
      ok: msSsoRes?.ok,
      submitted: msSsoRes?.submitted,
      tailoredResumeFile: msSsoRes?.tailoredResumeFile,
      msSsoAudit
    }, null, 2));
    if (
      !msSsoRes?.ok ||
      !msSsoRes?.submitted ||
      msSsoAudit?.navSignInTrapClicked !== false ||
      msSsoAudit?.applyClicked !== true ||
      msSsoAudit?.ssoProviderClicked !== "google" ||
      msSsoAudit?.oauthCompletedEmail !== "ravitejavelanati11@gmail.com" ||
      msSsoAudit?.privacyAccepted !== true ||
      msSsoAudit?.submitted !== true ||
      msSsoAudit?.finalValues?.firstName !== "Raviteja" ||
      msSsoAudit?.finalValues?.lastName !== "Velanati" ||
      msSsoAudit?.finalValues?.email !== "ravitejavelanati11@gmail.com" ||
      msSsoAudit?.finalValues?.resumeName !== "Raviteja_velanati_Microsoft.pdf" ||
      msSsoAudit?.finalValues?.workAuth !== "Yes"
    ) {
      throw new Error(`Microsoft Careers Multi-Provider SSO + Google OAuth Popup E2E failed: ${JSON.stringify({ msSsoRes, msSsoAudit })}`);
    }
    msSsoCdp.close();

    // 5. Full UI & Runtime Sanity Check Across Dashboard (all 8 views), Popup, SidePanel & Auto-Tracker
    const trackedApps = await dashCdp.eval(`chrome.runtime.sendMessage({ type: "GET_ALL_STATE" }).then(r => r.state.applications)`);
    console.log(
      `7. ✅ Dashboard & Auto-Tracker Verified: ${trackedApps.length} applications automatically logged (${trackedApps
        .map((a) => `${a.company}:${a.status}[${a.resumeUsed}]`)
        .join(", ")})`
    );
    if (
      trackedApps.length < 6 ||
      !trackedApps.some((a) => a.company === "Microsoft" && a.status === "Applied" && a.resumeUsed === "Raviteja_velanati_Microsoft.pdf") ||
      !trackedApps.some((a) => a.company === "OpenAI" && a.status === "Applied" && a.resumeUsed === "Raviteja_velanati_OpenAI.pdf") ||
      !trackedApps.some((a) => a.company === "NVIDIA" && a.status === "Applied" && a.resumeUsed === "Raviteja_velanati_NVIDIA.pdf") ||
      !trackedApps.some((a) => a.company === "Perplexity AI" && a.status === "Applied" && a.resumeUsed === "Raviteja_velanati_Perplexity_AI.pdf") ||
      !trackedApps.some((a) => a.company === "Mistral AI" && a.status === "Applied" && a.resumeUsed === "Raviteja_velanati_Mistral_AI.pdf") ||
      !trackedApps.some((a) => a.company === "Scale AI" && a.status === "Applied" && a.resumeUsed === "Raviteja_velanati_Scale_AI.pdf")
    ) {
      throw new Error(`Auto-tracker failed to log all submitted applications or company resume filenames: ${JSON.stringify(trackedApps)}`);
    }

    await dashCdp.send("Page.bringToFront", {}).catch(() => {});
    const dashAudit = await dashCdp.eval(`
      (async () => {
        const views = ["overview", "tracker", "resume", "cover", "jobs", "autopilot", "network", "vault"];
        const rendered = {};
        for (const v of views) {
          const btn = document.querySelector(\`#main-nav [data-view="\${v}"]\`);
          btn.click();
          await new Promise(r => setTimeout(r, 60));
          rendered[v] = document.getElementById("view-container").innerText.trim().length;
        }

        // Verify Resume & Cover Studios open clean (zero prefilled demo text)
        document.querySelector('#main-nav [data-view="resume"]').click();
        await new Promise(r => setTimeout(r, 40));
        const resumeCompEmpty = (document.getElementById("rs-comp")?.value || "") === "";
        document.querySelector('#main-nav [data-view="cover"]').click();
        await new Promise(r => setTimeout(r, 40));
        const coverCompEmpty = (document.getElementById("cl-comp")?.value || "") === "";

        // Explicitly audit Live Jobs view (#jobs): non-empty multi-platform cards + zero prefiltered selections + interactive filter & reset
        document.querySelector('#main-nav [data-view="jobs"]').click();
        let hubLiveJobCards = 0;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 100));
          hubLiveJobCards = document.querySelectorAll('[data-hub-job-card="true"]').length;
          if (hubLiveJobCards >= 30) break;
        }
        const hubInitialActiveFilterPills = document.querySelectorAll("#jf-active-chips .active-filter-pill").length;
        const hubResetHiddenInitially = getComputedStyle(document.getElementById("jf-reset")).display === "none";

        const jfRec = document.getElementById("jf-recency");
        jfRec.value = "2";
        jfRec.dispatchEvent(new Event("change"));
        await new Promise(r => setTimeout(r, 250));
        const hub2hJobCards = document.querySelectorAll('[data-hub-job-card="true"]').length;
        const hubActivePillsWhenFiltered = document.querySelectorAll("#jf-active-chips .active-filter-pill").length;
        document.getElementById("jf-reset").click();
        await new Promise(r => setTimeout(r, 250));
        const hubResetJobCards = document.querySelectorAll('[data-hub-job-card="true"]').length;
        const hubActivePillsAfterReset = document.querySelectorAll("#jf-active-chips .active-filter-pill").length;

        // Check Tracker filter controls
        document.querySelector('#main-nav [data-view="tracker"]').click();
        await new Promise(r => setTimeout(r, 50));
        const hasTrackerFilters = Boolean(document.getElementById("trk-filter-q") && document.getElementById("trk-filter-stage"));

        // Check Autopilot default mode = full_auto
        document.querySelector('#main-nav [data-view="autopilot"]').click();
        await new Promise(r => setTimeout(r, 50));
        const autopilotMode = document.getElementById("ap-mode")?.value || null;

        // Check Vault autoSubmitEnabled checkbox & masked secret inputs
        document.querySelector('#main-nav [data-view="vault"]').click();
        await new Promise(r => setTimeout(r, 50));
        const vaultAutoSubmitChecked = Boolean(document.getElementById("vc-auto-sub")?.checked);
        const vaultSecretsMasked =
          document.getElementById("vc-pass")?.type === "password" &&
          document.getElementById("vc-app-pass")?.type === "password" &&
          document.getElementById("vc-api-key")?.type === "password";

        // Check COMPILE_COVER_LETTER_PDF RPC
        const clPdf = await chrome.runtime.sendMessage({
          type: "COMPILE_COVER_LETTER_PDF",
          payload: {
            coverLetterText: "Dear Hiring Team,\\n\\nExcited to contribute to autonomous evaluation infrastructure.\\n\\nSincerely,\\nRaviteja Velanati",
            jobMeta: { company: "Perplexity AI", title: "Senior Autonomous Agents Engineer" }
          }
        });

        return {
          rendered,
          zeroPrefilledStudios: resumeCompEmpty && coverCompEmpty,
          hubJobsAudit: {
            hubLiveJobCards,
            hubInitialActiveFilterPills,
            hubResetHiddenInitially,
            hub2hJobCards,
            hubActivePillsWhenFiltered,
            hubResetJobCards,
            hubActivePillsAfterReset
          },
          hasTrackerFilters,
          autopilotMode,
          vaultAutoSubmitChecked,
          vaultSecretsMasked,
          clPdfOk: Boolean(clPdf?.ok && clPdf?.pdfBase64?.length > 200)
        };
      })()
    `, 35000);
    if (
      dashCdp.exceptions.length > 0 ||
      !dashAudit.zeroPrefilledStudios ||
      !(dashAudit.hubJobsAudit?.hubLiveJobCards >= 30) ||
      dashAudit.hubJobsAudit?.hubInitialActiveFilterPills !== 0 ||
      !dashAudit.hubJobsAudit?.hubResetHiddenInitially ||
      !(dashAudit.hubJobsAudit?.hub2hJobCards >= 4 && dashAudit.hubJobsAudit.hub2hJobCards < dashAudit.hubJobsAudit.hubLiveJobCards) ||
      dashAudit.hubJobsAudit?.hubActivePillsWhenFiltered !== 1 ||
      dashAudit.hubJobsAudit?.hubResetJobCards !== dashAudit.hubJobsAudit?.hubLiveJobCards ||
      dashAudit.hubJobsAudit?.hubActivePillsAfterReset !== 0 ||
      !dashAudit.hasTrackerFilters ||
      dashAudit.autopilotMode !== "full_auto" ||
      !dashAudit.vaultAutoSubmitChecked ||
      !dashAudit.vaultSecretsMasked ||
      !dashAudit.clPdfOk ||
      Object.values(dashAudit.rendered).some((len) => len < 40)
    ) {
      throw new Error(`Dashboard UI sanity check failed: exceptions=${JSON.stringify(dashCdp.exceptions)} audit=${JSON.stringify(dashAudit)}`);
    }

    const popupCdp = await openTabAndConnect(`chrome-extension://${extId}/popup/popup.html`);
    await popupCdp.send("Runtime.enable", {});
    await sleep(300);
    const popupAudit = await popupCdp.eval(`({
      autoSubmitChecked: Boolean(document.getElementById("chk-auto-submit")?.checked),
      hasFastAutoBtn: Boolean(document.getElementById("btn-fast-auto")),
      hasFullAutoBtn: Boolean(document.getElementById("btn-full-auto")),
      appliedCountText: document.getElementById("st-applied")?.innerText
    })`);
    if (
      popupCdp.exceptions.length > 0 ||
      !popupAudit.autoSubmitChecked ||
      !popupAudit.hasFastAutoBtn ||
      !popupAudit.hasFullAutoBtn ||
      Number(popupAudit.appliedCountText) < 4
    ) {
      throw new Error(`Popup UI sanity check failed: exceptions=${JSON.stringify(popupCdp.exceptions)} audit=${JSON.stringify(popupAudit)}`);
    }
    popupCdp.close();

    const spCdp = await openTabAndConnect(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
    await spCdp.send("Runtime.enable", {});
    await sleep(300);
    const spAudit = await spCdp.eval(`({
      hasFullAuto: Boolean(document.getElementById("sp-full-auto")),
      hasFastAuto: Boolean(document.getElementById("sp-fast-auto")),
      hasFillOnly: Boolean(document.getElementById("sp-fill-only")),
      identityCards: document.querySelectorAll("#sp-identity-grid .copy-card").length,
      passwordMaskedInSidePanel: document.getElementById("sp-identity-grid")?.innerText?.includes("••••••••••••")
    })`);
    if (
      spCdp.exceptions.length > 0 ||
      !spAudit.hasFullAuto ||
      !spAudit.hasFastAuto ||
      !spAudit.hasFillOnly ||
      spAudit.identityCards < 6 ||
      !spAudit.passwordMaskedInSidePanel
    ) {
      throw new Error(`SidePanel UI sanity check failed: exceptions=${JSON.stringify(spCdp.exceptions)} audit=${JSON.stringify(spAudit)}`);
    }
    spCdp.close();
    console.log("7b. ✅ All Extension UI Surfaces Verified (Dashboard 8 Views, Popup, SidePanel, Cover Letter PDF Re-Compiler — 0 JS Exceptions):", JSON.stringify({
      dashboard: dashAudit,
      popup: popupAudit,
      sidepanel: spAudit
    }, null, 2));

    // 5c. Jobify Autonomous Platform (Tsenta + Jobright AI Edition at http://127.0.0.1:18765/) + Multi-Platform & 128 Staffing Agencies + Silent Background Pipeline Verification
    const webAppCdp = await openTabAndConnect("http://127.0.0.1:18765/");
    let webAppAudit = null;
    for (let w = 0; w < 25; w++) {
      await sleep(300);
      webAppAudit = await webAppCdp
        .eval(`({
          isWebAppAttr: document.documentElement.getAttribute("data-jobify-webapp") === "true",
          extensionConnected: document.documentElement.getAttribute("data-jobify-extension-connected") === "true",
          statusText: document.getElementById("ext-status-text")?.textContent || "",
          liveJobsCount: Number(document.getElementById("stat-live-jobs")?.textContent || 0),
          syncedAppliedCount: Number(document.getElementById("stat-applied-count")?.textContent || 0),
          renderedJobCards: document.querySelectorAll(".job-card[data-job-id]").length,
          hasCustomUrlLauncher: Boolean(document.getElementById("custom-job-url") && document.getElementById("btn-launch-custom-url")),
          floatingCopilotSuppressedOnWebApp: !document.getElementById("jobify-copilot-host"),
          hasSidebarViews: Boolean(
            document.getElementById("web-sidebar-nav") &&
            document.querySelector(".web-nav-btn[data-web-view='dashboard']") &&
            document.querySelector(".web-nav-btn[data-web-view='staffing']") &&
            document.querySelector(".web-nav-btn[data-web-view='tracker']") &&
            document.querySelector(".web-nav-btn[data-web-view='resume']") &&
            document.querySelector(".web-nav-btn[data-web-view='insider']") &&
            document.querySelector(".web-nav-btn[data-web-view='inbox']")
          ),
          hasAllNewFilters: Boolean(
            document.getElementById("filter-ats") &&
            document.getElementById("filter-recency") &&
            document.getElementById("filter-sponsorship") &&
            document.getElementById("filter-role-type") &&
            document.getElementById("filter-experience") &&
            document.getElementById("filter-work-mode")
          ),
          initialActiveFilterPills: document.querySelectorAll("#active-filter-chips .active-filter-pill").length,
          resetBtnHiddenOnLoad: getComputedStyle(document.getElementById("btn-reset-filters")).display === "none",
          hasOrionDrawer: Boolean(document.getElementById("orion-copilot-drawer") && document.getElementById("orion-chat-input"))
        })`)
        .catch(() => null);
      if (webAppAudit?.extensionConnected && webAppAudit?.renderedJobCards >= 30 && webAppAudit?.syncedAppliedCount >= 6) {
        break;
      }
    }

    // Verify Multi-Platform Job Sources, All New Filters (2h/8h/12h/24h/48h, H-1B, Role Type, Experience), 128 Staffing Agencies View, and Silent Tracker Auto-Apply
    const autonomousFlowAudit = await webAppCdp.eval(`
      (async () => {
        const beforeApplied = Number(document.getElementById("stat-applied-count")?.textContent || 0);

        // 0. Check multi-platform coverage + interactive filters + 128 Staffing Agencies API & View
        const t0 = performance.now();
        const jobsApi = await fetch("/api/jobs").then((r) => r.json());
        const jobsApiLatencyMs = Math.round(performance.now() - t0);
        const platformsPresent = {
          workday: jobsApi.jobs.some((j) => /workday/i.test(j.ats)),
          linkedin: jobsApi.jobs.some((j) => /linkedin/i.test(j.ats)),
          dice: jobsApi.jobs.some((j) => /dice/i.test(j.ats)),
          staffing: jobsApi.jobs.some((j) => /staffing/i.test(j.ats) || j.isStaffingAgency),
          microsoft: jobsApi.jobs.some((j) => /microsoft/i.test(j.ats)),
          greenhouse: jobsApi.jobs.some((j) => /greenhouse/i.test(j.ats)),
          ashby: jobsApi.jobs.some((j) => /ashby/i.test(j.ats))
        };

        // Test interactive filters (2h, 8h, 12h, 24h, 48h, H-1B, Role Type, Experience)
        const recSel = document.getElementById("filter-recency");
        recSel.value = "2";
        recSel.dispatchEvent(new Event("change"));
        const count2h = document.querySelectorAll("#jobs-feed-container .job-card[data-job-id]").length;

        recSel.value = "12";
        recSel.dispatchEvent(new Event("change"));
        const count12h = document.querySelectorAll("#jobs-feed-container .job-card[data-job-id]").length;

        recSel.value = "48";
        recSel.dispatchEvent(new Event("change"));
        const count48h = document.querySelectorAll("#jobs-feed-container .job-card[data-job-id]").length;

        document.getElementById("btn-reset-filters").click();

        const expSel = document.getElementById("filter-experience");
        expSel.value = "1-2";
        expSel.dispatchEvent(new Event("change"));
        const countExp12 = document.querySelectorAll("#jobs-feed-container .job-card[data-job-id]").length;
        document.getElementById("btn-reset-filters").click();

        // Check 128 Staffing Agencies view
        document.querySelector(".web-nav-btn[data-web-view='staffing']").click();
        await new Promise((r) => setTimeout(r, 250));
        const staffingCardsCount = document.querySelectorAll("#staffing-cards-grid [data-staffing-card]").length;
        document.querySelector(".web-nav-btn[data-web-view='dashboard']").click();
        await new Promise((r) => setTimeout(r, 100));

        // 1. Click 📌 Save to Tracker on a live job card that isn't in tracker yet, then click ⚡ Auto-Apply inside the Tracker
        const saveCardBtn = Array.from(document.querySelectorAll(".btn-save-to-tracker")).find((b) => {
          const card = b.closest(".job-card");
          const comp = card?.getAttribute("data-job-company") || "";
          return comp && !document.getElementById("tsenta-apps-tbody")?.innerText?.includes(comp);
        }) || document.querySelector(".btn-save-to-tracker");
        if (saveCardBtn) saveCardBtn.click();
        await new Promise((r) => setTimeout(r, 350));

        // Find the newly saved row in #tsenta-apps-tbody and click its .btn-tracker-auto-apply button
        const trackerApplyBtn = document.querySelector("#tsenta-apps-tbody .btn-tracker-auto-apply");
        const hadSavedTrackerApplyBtn = Boolean(trackerApplyBtn);
        let sawInFlightOrFilled = false;
        const obs = new MutationObserver(() => {
          const stages = Array.from(document.querySelectorAll("#tsenta-apps-tbody tr")).map((tr) => tr.getAttribute("data-pipeline-stage"));
          if (stages.includes("in_flight") || stages.includes("filled")) {
            sawInFlightOrFilled = true;
          }
        });
        const tbodyEl = document.getElementById("tsenta-apps-tbody");
        if (tbodyEl) obs.observe(tbodyEl, { childList: true, subtree: true, attributes: true });

        if (trackerApplyBtn) {
          trackerApplyBtn.click();
        }

        // Poll until pipeline reaches submitted
        let finalSubmittedCount = 0;
        let finalAppliedCount = beforeApplied;
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => setTimeout(r, 150));
          finalSubmittedCount = Number(document.getElementById("cnt-pipe-submitted")?.textContent || 0);
          finalAppliedCount = Number(document.getElementById("stat-applied-count")?.textContent || 0);
          const inFlightNow = Number(document.getElementById("cnt-pipe-inflight")?.textContent || 0);
          const filledNow = Number(document.getElementById("cnt-pipe-filled")?.textContent || 0);
          if (inFlightNow > 0 || filledNow > 0) sawInFlightOrFilled = true;
          if (finalAppliedCount >= beforeApplied && inFlightNow === 0 && filledNow === 0 && i >= 3) {
            break;
          }
        }
        obs.disconnect();

        // Click Receipt & Diff on the top row to verify Tsenta Submission Receipt & Resume Diff modal
        const receiptBtn = document.querySelector("#tsenta-apps-tbody .btn-view-receipt");
        if (receiptBtn) receiptBtn.click();
        await new Promise((r) => setTimeout(r, 180));
        const receiptModalText = document.getElementById("receipt-modal-content")?.innerText || "";
        const hasReceiptFields = receiptModalText.includes("What Just Got Sent") && receiptModalText.includes("Tailored Résumé Diff");

        // Test Orion AI Career Copilot endpoint
        const orionRes = await fetch("/api/orion-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: "Why am I a strong fit and what insider referral message should I send?" })
        }).then((r) => r.json());

        return {
          jobsApiLatencyMs,
          platformsPresent,
          filterCounts: { count2h, count12h, count48h, countExp12 },
          staffingCardsCount,
          hadSavedTrackerApplyBtn,
          sawInFlightOrFilled,
          beforeApplied,
          finalAppliedCount,
          finalSubmittedCount,
          hasReceiptFields,
          orionOk: Boolean(orionRes?.ok && orionRes?.reply?.length > 40),
          webExceptions: []
        };
      })()
    `, 35000);

    console.log("7c. ✅ Jobify Autonomous Platform (Multi-Platform + 128 Staffing Agencies + Filters + Turbo Auto-Apply) Verified:", JSON.stringify({
      ...webAppAudit,
      autonomousFlow: autonomousFlowAudit
    }, null, 2));
    if (
      webAppCdp.exceptions.length > 0 ||
      !webAppAudit?.isWebAppAttr ||
      !webAppAudit?.extensionConnected ||
      webAppAudit.liveJobsCount < 30 ||
      webAppAudit.renderedJobCards < 30 ||
      webAppAudit.syncedAppliedCount < 6 ||
      !webAppAudit.hasCustomUrlLauncher ||
      !webAppAudit.floatingCopilotSuppressedOnWebApp ||
      !webAppAudit.hasSidebarViews ||
      !webAppAudit.hasAllNewFilters ||
      webAppAudit.initialActiveFilterPills !== 0 ||
      !webAppAudit.resetBtnHiddenOnLoad ||
      !webAppAudit.hasOrionDrawer ||
      !Object.values(autonomousFlowAudit?.platformsPresent || {}).every(Boolean) ||
      !(autonomousFlowAudit?.filterCounts?.count2h >= 4 && autonomousFlowAudit.filterCounts.count2h < autonomousFlowAudit.filterCounts.count12h) ||
      !(autonomousFlowAudit?.filterCounts?.countExp12 >= 4) ||
      autonomousFlowAudit?.staffingCardsCount !== 128 ||
      !autonomousFlowAudit?.hadSavedTrackerApplyBtn ||
      !autonomousFlowAudit?.sawInFlightOrFilled ||
      autonomousFlowAudit.finalSubmittedCount < 8 ||
      !autonomousFlowAudit?.hasReceiptFields ||
      !autonomousFlowAudit?.orionOk
    ) {
      throw new Error(`Jobify Autonomous Platform or Silent Pipeline verification failed: exceptions=${JSON.stringify(webAppCdp.exceptions)} webAppAudit=${JSON.stringify(webAppAudit)} flow=${JSON.stringify(autonomousFlowAudit)}`);
    }
    webAppCdp.close();

    // 7d. Universal Multi-Portal Login & Create-Account Hardening Gauntlet (Workday beecatcher + React focusout + click_filter reuse + duplicate recovery, Oracle Email-First + Consent Checkbox, SAP Privacy Modal + Password Policy Auto-Upgrade, and Manual Autofill Page Auth-Wall Continuation)
    await dashCdp.eval(`chrome.runtime.sendMessage({ type: "STOP_FULL_AUTO_APPLY" })`).catch(() => {});
    for (let wIdle = 0; wIdle < 40; wIdle++) {
      const st = await dashCdp.eval(`chrome.runtime.sendMessage({ type: "GET_AUTO_APPLY_STATUS" })`).catch(() => null);
      if (!st?.status?.running) break;
      await sleep(300);
    }

    const runGauntletScenario = async (scenario, manualAutofill = false) => {
      const url = `http://127.0.0.1:18765/sandbox/universal-auth-gauntlet?scenario=${scenario}`;
      const cdp = await openTabAndConnect(url);
      for (let i = 0; i < 20; i++) {
        const ready = await cdp
          .eval(`Boolean(document.getElementById("jobify-copilot-host")?.shadowRoot?.getElementById("jb-btn-autofill"))`)
          .catch(() => false);
        if (ready) break;
        await sleep(250);
      }
      if (manualAutofill) {
        const fillRes = await dashCdp.eval(
          `chrome.runtime.sendMessage({ type: "RUN_TAB_AUTOFILL", payload: { tabId: ${cdp.tabId}, options: { fillOpenEndedWithAI: false } } })`,
          45000
        );
        for (let w = 0; w < 15; w++) {
          const readyDone = await cdp
            .eval(`document.getElementById("g-fn")?.value === "Raviteja" && (document.getElementById("g-res")?.files?.length || 0) > 0`)
            .catch(() => false);
          if (readyDone) break;
          await sleep(250);
        }
        const manualSnap = await cdp.eval(`({
          fillOk: ${Boolean(fillRes?.ok)},
          audit: window.__GAUNTLET_AUDIT__,
          fn: document.getElementById("g-fn")?.value || "",
          ln: document.getElementById("g-ln")?.value || "",
          ph: document.getElementById("g-ph")?.value || "",
          resName: document.getElementById("g-res")?.files?.[0]?.name || null
        })`);
        cdp.close();
        return manualSnap;
      }

      for (let wIdle = 0; wIdle < 30; wIdle++) {
        const st = await dashCdp.eval(`chrome.runtime.sendMessage({ type: "GET_AUTO_APPLY_STATUS" })`).catch(() => null);
        if (!st?.status?.running) break;
        await sleep(300);
      }
      const runRes = await dashCdp.eval(
        `chrome.runtime.sendMessage({ type: "START_FULL_AUTO_APPLY", payload: { tabId: ${cdp.tabId}, options: { autoSubmit: true, tailorResume: false }, awaitCompletion: true } })`,
        45000
      );
      const audit = await cdp.eval(`window.__GAUNTLET_AUDIT__`);
      cdp.close();
      return { runRes, audit };
    };

    // Temporarily set a 10-char password when testing sap_privacy_modal so the >=15-char policy auto-upgrade triggers deterministically
    const wdDupOut = await runGauntletScenario("workday_beecatcher_dup", false);
    const oracleOut = await runGauntletScenario("oracle_email_first", false);

    const origVault = await swCdp.eval(`chrome.storage.local.get("jobify_credentials_vault").then(r => r.jobify_credentials_vault)`);
    await swCdp.eval(`
      chrome.storage.local.get("jobify_credentials_vault").then(async (r) => {
        const next = { ...(r.jobify_credentials_vault || {}), portalPassword: "Short!99Aa", domainPasswords: {} };
        await chrome.storage.local.set({ jobify_credentials_vault: next });
      })
    `);
    const sapOut = await runGauntletScenario("sap_privacy_modal", false);
    const savedVaultAfterSap = await swCdp.eval(`chrome.storage.local.get("jobify_credentials_vault").then(r => r.jobify_credentials_vault)`);
    await swCdp.eval(`chrome.storage.local.set({ jobify_credentials_vault: ${JSON.stringify(origVault)} })`);

    const manualAuthOut = await runGauntletScenario("manual_autofill_auth_wall", true);

    console.log("7d. ✅ Universal Multi-Portal Login & Create-Account Hardening Gauntlet Verified (4 Scenarios):", JSON.stringify({
      workdayBeecatcherAndDup: wdDupOut.audit,
      oracleEmailFirst: oracleOut.audit,
      sapPrivacyAndPwUpgrade: {
        ...sapOut.audit,
        persistedDomainPwLen: (savedVaultAfterSap?.domainPasswords?.["127.0.0.1"] || "").length
      },
      manualAutofillAuthWall: manualAuthOut
    }, null, 2));

    if (
      !wdDupOut.audit?.submitted ||
      wdDupOut.audit.beecatcherTriggered !== false ||
      wdDupOut.audit.beecatcherFinalValue !== "" ||
      wdDupOut.audit.passwordFocusoutFired !== true ||
      wdDupOut.audit.reusedClickFilterClicks < 2 ||
      wdDupOut.audit.sawDuplicateAccountError !== true ||
      wdDupOut.audit.switchedToSignInAfterDuplicate !== true ||
      wdDupOut.audit.candidateFormValues?.firstName !== "Raviteja" ||
      !oracleOut.audit?.submitted ||
      oracleOut.audit.emailFirstStepCompleted !== true ||
      oracleOut.audit.emailFirstConsentChecked !== true ||
      !sapOut.audit?.submitted ||
      sapOut.audit.privacyModalOpened !== true ||
      sapOut.audit.privacyModalAccepted !== true ||
      sapOut.audit.passwordPolicyUpgraded !== true ||
      !(sapOut.audit.upgradedPasswordUsed?.length >= 15) ||
      savedVaultAfterSap?.domainPasswords?.["127.0.0.1"] !== sapOut.audit.upgradedPasswordUsed ||
      manualAuthOut.audit?.authCompleted !== true ||
      manualAuthOut.audit?.beecatcherTriggered !== false ||
      manualAuthOut.audit?.passwordFocusoutFired !== true ||
      manualAuthOut.fn !== "Raviteja" ||
      manualAuthOut.ln !== "Velanati" ||
      !manualAuthOut.resName?.endsWith(".pdf")
    ) {
      throw new Error(`Universal Multi-Portal Auth Gauntlet failed: ${JSON.stringify({ wdDupOut, oracleOut, sapOut, manualAuthOut })}`);
    }

    dashCdp.close();
    swCdp.close();
    browserCdp.close();
    ChromeProc.kill("SIGKILL");
    ChromeProc = null;

    console.log("\n=== PART B: FROM-SCRATCH ATS RESUME QUALITY + 1-PAGE PDFLATEX & PURE-JS PDF + LIVE FEEDS VERIFICATION ===");
    let localSecrets = {};
    try {
      localSecrets = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "shared/local_secrets.json"), "utf8"));
    } catch (_) {}
    const runtimeSettings = {
      ...DEFAULT_SETTINGS,
      geminiApiKey: localSecrets.geminiApiKey || process.env.GEMINI_API_KEY || DEFAULT_SETTINGS.geminiApiKey
    };

    const jobMeta = {
      company: "Anthropic",
      title: "AI Platform & Evaluation Engineer",
      location: "San Francisco, CA",
      description:
        "We are hiring an AI Platform & Evaluation Engineer to architect autonomous browser AI agent sandboxes, multi-modal synthetic user state pipelines, red-teaming & adversarial safety evaluations, and real-time OpenTelemetry dashboards. Required skills: Python, TypeScript, React, LangGraph, Docker, Kubernetes, GCP, BigQuery, PyTorch, Playwright, RAG, Vector Databases, and CI/CD."
    };

    let aiTailor = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(3500);
      aiTailor = await tailorResumeWithGemini(
        jobMeta,
        DEFAULT_PROFILE,
        ["Vector Databases", "Observability / Telemetry"],
        runtimeSettings,
        "gemini-3.5-flash"
      );
      if (aiTailor.modelUsed !== "deterministic-from-scratch") break;
    }
    const tRes = aiTailor.tailored;
    const summaryWords = String(tRes.summary || "").trim().split(/\s+/).filter(Boolean).length;
    const hasFirstPerson = /\b(i|i'm|my|me)\b/i.test(tRes.summary || "");
    const skillCatEntries = Object.entries(tRes.skillsCategories || {});
    const totalSkillsCount = skillCatEntries.reduce((acc, [, arr]) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
    const expCounts = (tRes.experience || []).map((e) => (e.bullets || []).length);
    const projCounts = (tRes.projects || []).map((p) => (p.bullets || []).length);
    const all14Bullets = [
      ...(tRes.experience || []).flatMap((e) => e.bullets || []),
      ...(tRes.projects || []).flatMap((p) => p.bullets || [])
    ];
    const hasSlashesInBullets = all14Bullets.some((b) => b.includes("/"));
    const startingVerbs = all14Bullets.map((b) => (String(b).trim().match(/^([A-Za-z-]+)/)?.[1] || "").toLowerCase());
    const uniqueVerbCount = new Set(startingVerbs.filter(Boolean)).size;

    const countPdfPages = (b64) => {
      const raw = Buffer.from(b64, "base64").toString("latin1");
      const pageMatches = raw.match(/\/Type\s*\/Page\b/g);
      if (pageMatches?.length) return pageMatches.length;
      const countMatch = raw.match(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/);
      return countMatch ? Number(countMatch[1]) : 0;
    };

    const pdfRes = await generateTailoredResumePdf(tRes, DEFAULT_PROFILE, runtimeSettings);
    fs.writeFileSync(SAMPLE_PDF_OUT, Buffer.from(pdfRes.pdfBase64, "base64"));
    const latexPageCount = countPdfPages(pdfRes.pdfBase64);
    const postScore = scoreResumeATS(DEFAULT_PROFILE, jobMeta.description, tRes);

    const pureJsB64 = buildPureJsResumePdfBase64(tRes, DEFAULT_PROFILE);
    const pureRaw = Buffer.from(pureJsB64, "base64").toString("latin1");
    const purePageCount = countPdfPages(pureJsB64);

    const fromScratchAudit = {
      fileName: path.basename(SAMPLE_PDF_OUT),
      targetJobTitle: tRes.targetJobTitle,
      summaryWords,
      hasFirstPerson,
      summaryIntroducesTargetRole: String(tRes.summary || "").toLowerCase().includes("ai platform & evaluation engineer"),
      skillCategoriesCount: skillCatEntries.length,
      totalSkillsCount,
      expBulletCounts: expCounts,
      projBulletCounts: projCounts,
      totalBullets: all14Bullets.length,
      uniqueStartingVerbs: uniqueVerbCount,
      hasSlashesInBullets,
      latexPageCount,
      pureJsPageCount: purePageCount,
      atsScore: postScore.totalScore
    };
    console.log(
      `8. ✅ From-Scratch ATS Resume + 1-Page pdflatex & Pure-JS PDFs Verified! Model: ${aiTailor.modelUsed} | Engine: ${pdfRes.engine}`,
      JSON.stringify(fromScratchAudit, null, 2)
    );

    if (
      aiTailor.modelUsed === "deterministic-from-scratch" ||
      fromScratchAudit.fileName !== "Raviteja_velanati_Anthropic.pdf" ||
      tRes.targetJobTitle !== "AI Platform & Evaluation Engineer" ||
      summaryWords > 80 ||
      hasFirstPerson ||
      !fromScratchAudit.summaryIntroducesTargetRole ||
      skillCatEntries.length !== 4 ||
      totalSkillsCount < 25 ||
      totalSkillsCount > 40 ||
      JSON.stringify(expCounts) !== JSON.stringify([5, 3, 2]) ||
      JSON.stringify(projCounts) !== JSON.stringify([2, 2]) ||
      all14Bullets.length !== 14 ||
      uniqueVerbCount !== 14 ||
      hasSlashesInBullets ||
      latexPageCount !== 1 ||
      !pureRaw.startsWith("%PDF-1.4") ||
      !pureRaw.endsWith("%%EOF") ||
      purePageCount !== 1 ||
      !pureRaw.includes("AI Platform & Evaluation Engineer")
    ) {
      throw new Error(`From-Scratch Resume quality or 1-page PDF assertion failed: ${JSON.stringify(fromScratchAudit)}`);
    }
    console.log(`9. ✅ Standalone Pure-JS Fallback 1-Page PDF Engine Verified (${Buffer.from(pureJsB64, "base64").length} bytes, ${purePageCount} page, includes top role header)`);

    const clRes = await generateCoverLetterWithGemini(jobMeta, DEFAULT_PROFILE, "Concise & Technical", runtimeSettings);
    console.log(`10. ✅ Gemini AI Cover Letter Generated (${clRes.coverLetter.length} chars, Model: ${clRes.modelUsed})`);

    const qAns = await answerApplicationQuestionWithGemini(
      { label: "Why are you excited to join Anthropic's AI Platform & Evaluation team?", fieldType: "textarea", maxLength: 600 },
      jobMeta,
      DEFAULT_PROFILE,
      DEFAULT_SAVED_ANSWERS,
      runtimeSettings
    );
    console.log(`11. ✅ Gemini AI Custom Application Question Answered (${qAns.answer.length} chars): "${qAns.answer.slice(0, 120)}..."`);

    const liveJobs = await fetchPersonalizedRecommendations(DEFAULT_PROFILE, { category: "All", limit: 60 });
    const filtered2hJobs = await fetchPersonalizedRecommendations(DEFAULT_PROFILE, { maxHoursAgo: 2, sponsorship: "H-1B Sponsor", limit: 40 });
    console.log(
      `12. ✅ Multi-Platform & 128 Staffing Agencies Feeds Verified: ${liveJobs.length} total matches, ${filtered2hJobs.length} ultra-fresh (<=2h H-1B) roles, ${STAFFING_AGENCIES_DIRECTORY.length} Staffing Agencies synced (e.g. #1 ${liveJobs[0]?.company} — ${liveJobs[0]?.title} [${liveJobs[0]?.matchScore}% Match])`
    );
    if (liveJobs.length < 30 || filtered2hJobs.length < 4 || STAFFING_AGENCIES_DIRECTORY.length !== 128) {
      throw new Error(`Multi-platform live job feed or 128 staffing agencies assertion failed: live=${liveJobs.length} 2h=${filtered2hJobs.length} agencies=${STAFFING_AGENCIES_DIRECTORY.length}`);
    }

    console.log("\n🎉 ALL 20 END-TO-END, UNIVERSAL LOGIN/SIGNUP & FROM-SCRATCH RESUME VERIFICATION GATES PASSED 100%!");
  } finally {
    if (ChromeProc) ChromeProc.kill("SIGKILL");
    if (srv) srv.kill("SIGKILL");
    await sleep(600);
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error("❌ E2E Verification Failed:", err);
  process.exit(1);
});
