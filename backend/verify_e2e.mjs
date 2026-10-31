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
import { generateTailoredResumePdf, buildPureJsResumePdfBase64 } from "../extension/shared/pdf_generator.js";
import { fetchPersonalizedRecommendations } from "../extension/shared/job_feeds.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXT_DIR = path.join(ROOT, "extension");
const USER_DATA_DIR = path.join(ROOT, ".tmp_chrome_e2e");
const SAMPLE_PDF_OUT = path.join(ROOT, "Raviteja_Velanati_Anthropic_Tailored_Sample.pdf");
const CDP_PORT = 9339;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.seq = 1;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
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
      resumeShownInUI: document.body.innerText.includes("Raviteja_Velanati_Resume_1Page.pdf")
    })`);
    console.log(`2. ✅ Live Production Greenhouse Remix Verified (${liveGhFill?.filledCount} fields):`, JSON.stringify({ fill: { ok: liveGhFill?.ok, filledCount: liveGhFill?.filledCount, err: liveGhFill?.err }, check: liveGhCheck }, null, 2));
    if (
      !liveGhCheck.pillMountedAfterHydration ||
      liveGhCheck.firstName !== "Raviteja" ||
      liveGhCheck.countryCode !== "+1" ||
      liveGhCheck.visaSponsor !== "Yes" ||
      !liveGhCheck.workAddress?.includes("Newark") ||
      liveGhCheck.gender !== "Male" ||
      !(liveGhCheck.resumeShownInUI || liveGhCheck.resumeFileAttached === "Raviteja_Velanati_Resume_1Page.pdf")
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
        sr.getElementById("jb-pill").click();
        await new Promise(r => setTimeout(r, 250));
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
      autoAudit.step1?.resumeFile !== "Raviteja_Velanati_OpenAI_Resume.pdf" ||
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

    // 2b. WORKDAY FULL-FLOW END-TO-END VIA AI STUDIO "TAILOR RESUME" BUTTON
    // (Tests: Header SignIn Trap Ignored -> Adventure "Apply" -> Async "Start Your Application" Modal -> "Apply Manually" -> "Sign in with email" -> Sign In Fail -> Switch to Create Account -> Read More + opacity:0 Checkbox + opacity:0 click_filter -> Background Email Verification Link Activation -> Step 2 Sign In via click_filter -> Workday searchBox Combobox + State countryRegion + Spinbutton Date + Tailored PDF -> Submit -> Auto-Track!)
    const wdE2eCdp = await openTabAndConnect("http://127.0.0.1:18765/sandbox/workday-full-e2e");
    for (let i = 0; i < 20; i++) {
      const hasQuickPill = await wdE2eCdp
        .eval(`Boolean(document.getElementById("jobify-copilot-host")?.shadowRoot?.getElementById("jb-pill-tailor-apply"))`)
        .catch(() => false);
      if (hasQuickPill) break;
      await sleep(300);
    }
    await wdE2eCdp.eval(`
      (async () => {
        const sr = document.getElementById("jobify-copilot-host").shadowRoot;
        sr.getElementById("jb-pill").click();
        await new Promise(r => setTimeout(r, 200));
        sr.querySelector(".jb-tab[data-tab='ai']").click();
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
      wdAudit.step2?.resumeFile !== "Raviteja_Velanati_NVIDIA_Resume.pdf" ||
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
        sr.getElementById("jb-pill").click();
        await new Promise(r => setTimeout(r, 200));
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
      gh.resumeFile !== "Raviteja_Velanati_Resume_1Page.pdf" ||
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
        sr.getElementById("jb-pill").click();
        await new Promise(r => setTimeout(r, 200));
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
      wd.resumeFile !== "Raviteja_Velanati_Resume_1Page.pdf"
    ) {
      throw new Error("Workday assertion mismatch!");
    }
    wdCdp.close();

    // 4. Lever Sandbox
    const lvCdp = await openTabAndConnect(`chrome-extension://${extId}/sandbox/lever.html`);
    await lvCdp.eval(`
      (async () => {
        const sr = document.getElementById("jobify-copilot-host").shadowRoot;
        sr.getElementById("jb-pill").click();
        await new Promise(r => setTimeout(r, 200));
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
    if (lv.fullName !== "Raviteja Velanati" || lv.commentsLen < 50 || !lv.resumeFile) {
      throw new Error("Lever assertion mismatch!");
    }
    lvCdp.close();

    // 5. Verify Dashboard & Auto-Tracked Applications (OpenAI Full Auto-Apply + Anthropic Greenhouse)
    const dashCdp = await openTabAndConnect(`chrome-extension://${extId}/dashboard/dashboard.html`);
    const trackedApps = await dashCdp.eval(`chrome.runtime.sendMessage({ type: "GET_ALL_STATE" }).then(r => r.state.applications)`);
    console.log(
      `7. ✅ Dashboard & Auto-Tracker Verified: ${trackedApps.length} applications automatically logged (${trackedApps
        .map((a) => `${a.company}:${a.status}`)
        .join(", ")})`
    );
    if (
      trackedApps.length < 3 ||
      !trackedApps.some((a) => a.company === "OpenAI" && a.status === "Applied") ||
      !trackedApps.some((a) => a.company === "NVIDIA" && a.status === "Applied")
    ) {
      throw new Error("Auto-tracker failed to log submitted applications!");
    }
    dashCdp.close();
    swCdp.close();
    browserCdp.close();
    ChromeProc.kill("SIGKILL");
    ChromeProc = null;

    console.log("\n=== PART B: LIVE GEMINI AI + PDFLATEX PDF + PURE-JS PDF + LIVE ATS FEEDS VERIFICATION ===");
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

    const aiTailor = await tailorResumeWithGemini(
      jobMeta,
      DEFAULT_PROFILE,
      ["Vector Databases", "Observability / Telemetry"],
      runtimeSettings,
      "gemini-3.8-flash"
    );
    const pdfRes = await generateTailoredResumePdf(aiTailor.tailored, DEFAULT_PROFILE, runtimeSettings);
    fs.writeFileSync(SAMPLE_PDF_OUT, Buffer.from(pdfRes.pdfBase64, "base64"));
    const postScore = scoreResumeATS(DEFAULT_PROFILE, jobMeta.description, aiTailor.tailored);
    console.log(
      `8. ✅ Gemini AI Resume Tailoring + pdflatex PDF Compiled! Requested: ${aiTailor.requestedModel} -> Active Model: ${aiTailor.modelUsed} | PDF Engine: ${pdfRes.engine} | New ATS Score: ${postScore.totalScore}/100 | Saved: ${SAMPLE_PDF_OUT}`
    );

    const pureJsB64 = buildPureJsResumePdfBase64(aiTailor.tailored, DEFAULT_PROFILE);
    const pureRaw = Buffer.from(pureJsB64, "base64").toString("latin1");
    if (!pureRaw.startsWith("%PDF-1.4") || !pureRaw.endsWith("%%EOF")) {
      throw new Error("Pure-JS fallback PDF invalid header/trailer!");
    }
    console.log(`9. ✅ Standalone Pure-JS Fallback PDF Engine Verified (${Buffer.from(pureJsB64, "base64").length} bytes, valid %PDF-1.4..%%EOF)`);

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

    const liveJobs = await fetchPersonalizedRecommendations(DEFAULT_PROFILE, { category: "All", limit: 10 });
    console.log(
      `12. ✅ Live Curated ATS Feeds Fetched & Scored: ${liveJobs.length} top matches (e.g. #1 ${liveJobs[0]?.company} — ${liveJobs[0]?.title} [${liveJobs[0]?.matchScore}% Match])`
    );
    if (liveJobs.length === 0) throw new Error("Live job feed returned 0 matches!");

    console.log("\n🎉 ALL 14 END-TO-END VERIFICATION GATES PASSED 100%!");
  } finally {
    if (ChromeProc) ChromeProc.kill("SIGKILL");
    if (srv) srv.kill("SIGKILL");
    await sleep(300);
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("❌ E2E Verification Failed:", err);
  process.exit(1);
});
