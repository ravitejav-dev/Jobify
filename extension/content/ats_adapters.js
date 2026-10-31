// Jobify Universal + Specialized Production ATS Autofill Engine
// Verified against live Greenhouse Remix (React-Select + Geocode AsyncSelect + Embedded Iframes),
// Ashby (/application + Yes/No Pill Groups + Autocomplete), Workday, Lever, SmartRecruiters, iCIMS, Rippling & Generic Portals.

(() => {
  if (window.__JOBIFY_ADAPTERS_LOADED__) return;
  window.__JOBIFY_ADAPTERS_LOADED__ = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function detectATSPlatform(url = location.href, doc = document) {
    const u = url.toLowerCase();
    if (
      u.includes("myworkdayjobs.com") ||
      u.includes("myworkdaysite.com") ||
      u.includes("/sandbox/workday") ||
      doc.querySelector("[data-automation-id='legalNameSection_firstName'], [data-automation-id='applyManually']")
    ) {
      return "Workday";
    }
    if (
      u.includes("greenhouse.io") ||
      u.includes("gh_jid=") ||
      u.includes("/sandbox/greenhouse") ||
      doc.querySelector("#application_form, #grnhse_app, #grnhse_iframe, iframe[src*='greenhouse.io'], form[action*='greenhouse']")
    ) {
      return "Greenhouse";
    }
    if (
      u.includes("jobs.lever.co") ||
      u.includes("/sandbox/lever") ||
      doc.querySelector(".application-form, input[name='cards[0][field0]'], a.postings-btn[href*='lever.co']")
    ) {
      return "Lever";
    }
    if (
      u.includes("ashbyhq.com") ||
      u.includes("/sandbox/ashby") ||
      doc.querySelector("[class*='ashby-application'], iframe[src*='ashbyhq.com']")
    ) {
      return "Ashby";
    }
    if (u.includes("smartrecruiters.com")) return "SmartRecruiters";
    if (u.includes("icims.com")) return "iCIMS";
    if (u.includes("rippling.com")) return "Rippling";
    if (u.includes("bamboohr.com")) return "BambooHR";
    if (u.includes("workable.com")) return "Workable";
    if (u.includes("jobvite.com")) return "Jobvite";
    if (u.includes("linkedin.com/jobs")) return "LinkedIn";
    if (u.includes("wellfound.com")) return "Wellfound";
    if (u.includes("indeed.com")) return "Indeed";
    return "Career Portal";
  }

  function extractJobMetadata(doc = document) {
    const url = location.href;
    const ats = detectATSPlatform(url, doc);

    let company = "";
    const metaSite = doc.querySelector("meta[property='og:site_name']")?.content?.trim();
    const companyEl = doc.querySelector(
      "[data-company-name], .company-name, .app-title + .company-name, [data-automation-id='companyName'], .posting-categories .company, [data-jobify-company]"
    );
    if (companyEl?.textContent?.trim()) {
      company = companyEl.textContent.trim();
    } else if (metaSite && !/greenhouse|lever|workday|ashby|linkedin/i.test(metaSite)) {
      company = metaSite;
    } else {
      const ghForMatch = url.match(/[?&]for=([^&#]+)/i);
      const ghMatch = url.match(/greenhouse\.io\/([^/?#]+)/i);
      const levMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/i);
      const ashMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i);
      const wdMatch = url.match(/\/\/([^.]+)\.wd\d*\.myworkdayjobs\.com/i);
      const rawSlug =
        ghForMatch?.[1] ||
        (ghMatch?.[1] !== "embed" ? ghMatch?.[1] : "") ||
        levMatch?.[1] ||
        ashMatch?.[1] ||
        wdMatch?.[1] ||
        "";
      if (rawSlug) {
        company = decodeURIComponent(rawSlug)
          .replace(/[-_]+/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
    if (!company) {
      const titleParts = (doc.title || "").split(/\s(?:[-|–—]|at|@)\s/i);
      if (titleParts.length >= 2) company = titleParts[titleParts.length - 1].trim();
    }

    const titleEl = doc.querySelector(
      "[data-jobify-title], h1.app-title, .job__title h1, .posting-headline h2, [data-automation-id='jobPostingHeader'], h1"
    );
    let title =
      titleEl?.textContent?.trim() ||
      doc.title.split(/\s(?:[-|–—]|@)\s/)[0]?.trim() ||
      "Software / AI Engineer";
    title = title.replace(/\s+/g, " ").slice(0, 140);

    const locEl = doc.querySelector(
      "[data-jobify-location], .job__location, .location, .posting-categories .location, [data-automation-id='locations'], [class*='location']"
    );
    const locationStr = locEl?.textContent?.replace(/\s+/g, " ").trim().slice(0, 100) || "";

    const jdSelectors = [
      "[data-jobify-jd]",
      ".job__description",
      "#content .content",
      "#grnhse_app",
      "[data-automation-id='jobPostingDescription']",
      ".posting-page .section-wrapper",
      "[class*='job-description']",
      "[id*='job-description']",
      "main",
      "article"
    ];
    let description = "";
    for (const sel of jdSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 180) {
        description = el.innerText.trim();
        break;
      }
    }
    if (!description) {
      description = (doc.body?.innerText || "").slice(0, 12000);
    }

    const uLow = url.toLowerCase();
    const hasPasswordInput = doc.querySelectorAll("input[type='password']").length > 0;
    const hasFileUpload = doc.querySelectorAll("input[type='file']").length > 0;
    const hasEmbeddedAtsIframe = Boolean(
      doc.querySelector("iframe[src*='greenhouse.io'], iframe[src*='ashbyhq.com'], iframe[src*='lever.co'], iframe[src*='workday'], #grnhse_iframe")
    );
    const isCareerUrl =
      ats !== "Career Portal" ||
      /\/(jobs?|careers?|apply|application|positions?|openings?|postings?|talent|sandbox)\b/i.test(uLow);
    const hasApplyElements =
      hasFileUpload ||
      hasEmbeddedAtsIframe ||
      Boolean(doc.querySelector("form input[name*='first'], form input[autocomplete*='given-name'], [data-automation-id]"));

    return {
      isRelevantPage: isCareerUrl || hasApplyElements,
      isAuthWall:
        hasPasswordInput &&
        (isCareerUrl ||
          Boolean(doc.querySelector("[data-automation-id*='password'], [data-automation-id*='signIn'], [data-jobify-auth]"))),
      hasEmbeddedAtsIframe,
      ats,
      company: company || "Company",
      title,
      location: locationStr,
      description: description.slice(0, 14000),
      url
    };
  }

  function highlightFilledElement(el) {
    if (!el) return;
    try {
      el.dataset.jobifyFilled = "true";
      const target =
        el.closest(".select__control, [class*='ashby-application-form-input']") || el;
      const origOutline = target.style.outline;
      const origTransition = target.style.transition;
      const origShadow = target.style.boxShadow;
      target.style.transition = "box-shadow 0.25s ease, outline 0.25s ease";
      target.style.boxShadow = "0 0 0 2px rgba(99, 102, 241, 0.55)";
      setTimeout(() => {
        target.style.boxShadow = origShadow;
        target.style.outline = origOutline;
        target.style.transition = origTransition;
      }, 2400);
    } catch (_) {}
  }

  // React 16-19 / Angular / Vue native value setter
  function setNativeValue(el, value) {
    if (!el || value === undefined || value === null) return false;
    const strVal = String(value);
    try {
      el.focus();
    } catch (_) {}

    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    const prevValue = el.value;
    if (desc?.set) {
      desc.set.call(el, strVal);
    } else {
      el.value = strVal;
    }

    if (el._valueTracker) {
      el._valueTracker.setValue(prevValue);
    }

    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: strVal, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    highlightFilledElement(el);
    return true;
  }

  function dispatchRealClick(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
  }

  function isComboboxInput(el) {
    if (!el) return false;
    if (el.getAttribute("role") === "combobox") return true;
    if (el.getAttribute("aria-autocomplete") === "list") return true;
    if (el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("aria-haspopup") === "true") return true;
    if (el.classList?.contains("select__input")) return true;
    if (el.className && typeof el.className === "string" && el.className.includes("input-autocomplete")) return true;
    return false;
  }

  function isTrapOrSystemInput(el) {
    if (!el) return true;
    if (el.getAttribute("aria-hidden") === "true") return true;
    if (el.classList?.contains("remix-css-1a0ro4n-requiredInput")) return true;
    if (el.classList?.contains("g-recaptcha-response")) return true;
    const ident = `${el.id || ""} ${el.name || ""} ${typeof el.className === "string" ? el.className : ""}`;
    if (/recaptcha|hcaptcha|turnstile|honeypot|bot[-_]?field/i.test(ident)) return true;
    // intl-tel-input country search input inside phone flag dropdown
    if (/^iti-\d+__search-input$/i.test(el.id || "")) return true;
    // Site-wide header/navbar search boxes
    if (el.closest("header, nav, [role='navigation'], [role='search']")) return true;
    // Ashby hidden checkbox backing Yes/No button pills
    if (el.type === "checkbox" && el.closest("[class*='yesno'], .ashby-application-form-field-entry")?.querySelector("button[class*='yesno']")) {
      return true;
    }
    return false;
  }

  function isVisibleAndEditable(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (isTrapOrSystemInput(el)) return false;
    if (el.type === "hidden" || el.type === "submit" || el.type === "button" || el.type === "reset" || el.type === "image") {
      return false;
    }
    // Hidden validation dummy inputs often have tabIndex === -1 (whereas real combobox inputs have role="combobox")
    if (el.tabIndex === -1 && !isComboboxInput(el) && el.type !== "file" && el.type !== "radio" && el.type !== "checkbox") {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0 && el.type !== "file" && el.type !== "checkbox" && el.type !== "radio" && !isComboboxInput(el)) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && el.type !== "file") return false;
    return true;
  }

  // Extract structured { primaryLabel, helperText, fullLabel } so helper prose never hijacks primary label intent
  function getFieldContext(el) {
    if (!el) return { primaryLabel: "", helperText: "", fullLabel: "" };
    const primaryParts = [];
    const helperParts = [];

    if (el.id) {
      const explicitLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicitLabel) primaryParts.push(explicitLabel.innerText || explicitLabel.textContent);
    }
    const parentLabel = el.closest("label");
    if (parentLabel) primaryParts.push(parentLabel.innerText || parentLabel.textContent);

    const ariaLabelledBy = el.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      for (const id of ariaLabelledBy.split(/\s+/)) {
        const ref = document.getElementById(id);
        if (ref) primaryParts.push(ref.innerText || ref.textContent);
      }
    }

    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && !/^toggle flyout$/i.test(ariaLabel.trim())) {
      primaryParts.push(ariaLabel);
    }

    const fieldContainer = el.closest(
      ".ashby-application-form-field-entry, [class*='fieldEntry'], .text-input-wrapper, .select, .field, .form-group, .application-question, [data-automation-id*='formField'], fieldset"
    );
    if (fieldContainer) {
      const lblEl = fieldContainer.querySelector(
        "label, legend, .ashby-application-form-question-title, .field-label, .label, h4, [data-automation-id='formLabel']"
      );
      if (lblEl) primaryParts.push(lblEl.innerText || lblEl.textContent);

      const descEl = fieldContainer.querySelector(
        "[id$='-description'], .ashby-application-form-question-description, .field-description, p"
      );
      if (descEl) helperParts.push(descEl.innerText || descEl.textContent);
    }

    const ariaDesc = el.getAttribute("aria-describedby");
    if (ariaDesc) {
      for (const id of ariaDesc.split(/\s+/)) {
        if (id.endsWith("-placeholder") || id.endsWith("-error")) continue;
        const ref = document.getElementById(id);
        if (ref) helperParts.push(ref.innerText || ref.textContent);
      }
    }

    if (primaryParts.length === 0) {
      if (el.placeholder) primaryParts.push(el.placeholder);
      if (el.name) primaryParts.push(el.name);
      if (el.id) primaryParts.push(el.id);
      if (el.dataset?.automationId) primaryParts.push(el.dataset.automationId);
    } else if (el.dataset?.automationId) {
      helperParts.push(el.dataset.automationId);
    }

    const clean = (arr) =>
      [...new Set(arr.map((x) => String(x || "").replace(/\s+/g, " ").trim()).filter(Boolean))].join(" | ");

    const primaryLabel = clean(primaryParts);
    const helperText = clean(helperParts);
    const fullLabel = [primaryLabel, helperText, el.name || "", el.id || ""].filter(Boolean).join(" | ");
    return { primaryLabel, helperText, fullLabel };
  }

  function getFieldLabelText(el) {
    return getFieldContext(el).fullLabel;
  }

  // Word-safe option text matcher (prevents "male" matching "female" or "no" matching "none" prematurely)
  function findMatchingOptionElement(optionEls, desiredCandidates) {
    const candidates = (Array.isArray(desiredCandidates) ? desiredCandidates : [desiredCandidates])
      .filter(Boolean)
      .map((c) => String(c).trim());
    if (optionEls.length === 0 || candidates.length === 0) return null;

    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

    // Pass 1: Exact case-insensitive match
    for (const cand of candidates) {
      const cLow = norm(cand);
      const exact = optionEls.find((o) => norm(o.innerText || o.textContent || o.text) === cLow);
      if (exact) return exact;
    }

    // Pass 2: Word-boundary match (e.g. "Male" matches "Male" but NEVER "Female"; "United States" matches "United States +1")
    for (const cand of candidates) {
      const cLow = norm(cand);
      if (!cLow) continue;
      const escaped = cLow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const wordRe = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i");
      const wbMatch = optionEls.find((o) => wordRe.test(norm(o.innerText || o.textContent || o.text)));
      if (wbMatch) return wbMatch;
    }

    // Pass 3: Safe substring match for longer phrases (> 4 chars, never for "male" / "no" / "us")
    for (const cand of candidates) {
      const cLow = norm(cand);
      if (cLow.length < 5) continue;
      const sub = optionEls.find((o) => {
        const txt = norm(o.innerText || o.textContent || o.text);
        return txt.includes(cLow) || (txt.length >= 5 && cLow.includes(txt));
      });
      if (sub) return sub;
    }

    return null;
  }

  function selectBestOption(selectEl, desiredCandidates) {
    const options = Array.from(selectEl.options || []).filter((o) => o.value !== "" && !o.disabled);
    const chosen = findMatchingOptionElement(options, desiredCandidates);
    if (chosen) {
      return setNativeValue(selectEl, chosen.value);
    }
    return false;
  }

  // Order-safe label resolver verified against real Greenhouse, Ashby, Workday & Lever questions
  function resolveDesiredValueForField(ctxOrLabel, profile, el = null) {
    const ctx =
      typeof ctxOrLabel === "string"
        ? { primaryLabel: ctxOrLabel, helperText: "", fullLabel: ctxOrLabel }
        : ctxOrLabel;

    const pLow = (ctx.primaryLabel || "").toLowerCase();
    const hLow = (ctx.helperText || "").toLowerCase();
    const idNameLow = `${el?.id || ""} ${el?.name || ""} ${el?.dataset?.automationId || ""}`.toLowerCase();
    const combinedLow = `${pLow} | ${idNameLow}`;

    const p = profile?.personal || {};
    const eeo = profile?.workAuthAndEEO || {};
    const exp0 = (profile?.workExperience || [])[0] || {};
    const edu0 = (profile?.education || [])[0] || {};

    // 0. Guard against passwords, site search, take-home URLs, and conditional follow-ups ("If yes, explain...")
    if (/password|search\s*jobs|keyword\s*search|filter\s*by/i.test(combinedLow)) return null;
    if (/exercise\s*submission|take[- ]?home|code\s*sample|coding\s*challenge/i.test(pLow)) return null;
    if (/^if\s+(yes|no|other|applicable|so|you\s+selected)\b/i.test(pLow.trim())) {
      return { skip: true };
    }

    // 1. Legal / Arbitration / AI Policy / Sanctions / Non-Compete / Age / Background Check
    if (/arbitrat|read\s+the\s+.*agreement|terms\s+of\s+the\s+agreement/i.test(pLow)) {
      return [
        "I understand and agree",
        "I will read the arbitration agreement",
        "I agree",
        "Yes"
      ];
    }
    if (/\bai\s+policy\b/i.test(pLow)) {
      return ["Yes", "I agree", "I acknowledge"];
    }
    if (/sanctions|export\s+controls|cuba,\s*iran/i.test(`${pLow} ${hLow}`)) {
      return ["None of the above", "No"];
    }
    if (/non-?compete|non-?solicitation|bound\s+by\s+any\s+agreements?|restrict\s+your\s+ability\s+to\s+work/i.test(pLow)) {
      return ["No"];
    }
    if (/18\s*years|over\s*18|at\s*least\s*18|background\s*check/i.test(pLow)) {
      return ["Yes"];
    }

    // 2. Work Authorization, Sponsorship, Prior Employment/Interview, Relocation, Hybrid, Salary, Start Date
    // (MUST run BEFORE geographic country/state/city matchers because work-auth labels contain "in the country where...")
    if (/authorized\s*to\s*work|legally\s*authorized|eligible\s*to\s*work|right\s*to\s*work/i.test(pLow)) {
      return [eeo.authorizedUS || "Yes", "Yes"];
    }
    if (/sponsorship|require.*visa|need.*visa|future.*visa|h-?1b|opt\s*status/i.test(pLow)) {
      return [eeo.requireSponsorship || "Yes", "Yes", eeo.visaStatus || "F-1 STEM OPT"];
    }
    if (
      /previously\s*(worked|employed|applied|interviewed)|former\s*(employee|contractor)|ever\s*(worked|interviewed)|interviewed\s*(at|with)\b|worked\s*for\s+.*\bin\s+the\s+past|currently\s+or\s+have\s+you\s+previously\s+worked/i.test(
        pLow
      )
    ) {
      return [eeo.previouslyEmployedAtCompany || "No", "No"];
    }
    if (/address\s*from\s*which\s*you\s*plan|working\s*address|home\s*address|mailing\s*address/i.test(pLow)) {
      return [
        p.streetAddress
          ? `${p.streetAddress}, ${p.city}, ${p.stateCode} ${p.postalCode}`
          : `${p.city}, ${p.stateCode} ${p.postalCode}, ${p.country}`
      ];
    }
    if (/\brelocat(e|ing|ion)\b/i.test(pLow)) {
      return [eeo.willingToRelocate || "Yes", "Yes"];
    }
    if (
      /working\s*in[- ]?person|come\s*into\s*the\s*office|days?\s*(per|a)\s*week|\bhybrid\b|on-?site|in-?office|work\s*arrangement|business\s*trips|willing\s*to\s*travel/i.test(
        pLow
      )
    ) {
      return ["Yes", eeo.workArrangement || "Hybrid"];
    }
    if (/notice\s*period|earliest.*start|when\s*can\s*you\s*start|start\s*date|available\s*to\s*start/i.test(pLow)) {
      return [eeo.earliestStartDate || "2 weeks notice", "2 weeks"];
    }
    if (/deadlines?\s+or\s+timeline|timeline\s+considerations/i.test(pLow)) {
      return ["No immediate deadlines; flexible to align with your interview timeline."];
    }
    if (/\bsalary\b|\bcompensation\b|desired\s*pay|pay\s*expectation/i.test(pLow)) {
      return [String(eeo.desiredSalaryTarget || 180000), eeo.desiredSalaryDisplay || "$160,000 - $195,000"];
    }
    if ((/how\s*did\s*you\s*hear|referral\s*source|\bsource\b/i.test(pLow)) && !/open[- ]?source/i.test(pLow)) {
      return ["LinkedIn", "Company Website", "Job Board", eeo.howDidYouHear || "LinkedIn"];
    }

    // 3. EEO / Demographic Self-Identification
    if (/hispanic|latino/i.test(combinedLow)) return [eeo.hispanicOrLatino || "No", "No"];
    if (/\brace\b|ethnicity/i.test(combinedLow)) {
      return [eeo.raceEthnicity || "Asian", "Asian (Not Hispanic or Latino)", "Asian"];
    }
    if (/sexual\s*orientation|lgbtq/i.test(combinedLow)) {
      return ["Prefer not to say", "Decline To Self Identify", "I don't wish to answer"];
    }
    if (/transgender/i.test(combinedLow)) {
      return ["No", "Decline To Self Identify"];
    }
    if (/\bgender\b|\bsex\b/i.test(combinedLow)) {
      return [eeo.gender || "Male", "Male", "Man"];
    }
    if (/veteran/i.test(combinedLow)) {
      return [
        eeo.veteranStatus || "I am not a protected veteran",
        "I am not a veteran",
        "No"
      ];
    }
    if (/disability|disabled|handicap/i.test(combinedLow)) {
      return [
        eeo.disabilityStatus || "No, I do not have a disability and have not had one in the past",
        "No, I do not have a disability",
        "No, I don't have a disability",
        "No"
      ];
    }

    // 4. Name, Pronouns, Pronunciation, Contact & Location
    if (/pronounc(e|iation)/i.test(`${pLow} ${hLow}`)) {
      return ["Rah-vih-teh-jah Veh-lah-nah-tee (He/Him)"];
    }
    if (/\bpronouns?\b/i.test(`${pLow} ${hLow}`)) {
      return [p.pronouns || "He/Him", "He/Him/His", "He/Him"];
    }
    if (/preferred\s*(first\s*)?name|\bnickname\b|preferred_name/i.test(combinedLow)) {
      return [p.firstName || p.preferredName];
    }
    if (/first\s*name|given\s*name|legalname.*firstname|\bfname\b|first_name/i.test(combinedLow)) {
      return [p.firstName];
    }
    if (/middle\s*name|\bmname\b|middle_name/i.test(combinedLow)) {
      return p.middleName ? [p.middleName] : null;
    }
    if (/last\s*name|family\s*name|surname|legalname.*lastname|\blname\b|last_name/i.test(combinedLow)) {
      return [p.lastName];
    }
    if (
      (/full\s*name|^name\s*\*?$|_systemfield_name|\byour\s*name\b|applicant\s*name|candidate\s*name|signature/i.test(
        combinedLow
      )) &&
      !/company|school|employer|reference|pronounc/i.test(combinedLow)
    ) {
      return [p.fullName];
    }

    if (/e-?mail/i.test(combinedLow)) return [p.email];
    if (/phone\s*type|device\s*type/i.test(combinedLow)) return ["Mobile", "Cell", "Personal"];
    if (/country\s*phone\s*code|phone.*country/i.test(combinedLow) || (el?.id === "country" && isComboboxInput(el))) {
      return ["United States +1", "United States", "+1", "United States of America", "US"];
    }
    if (/\bphone\b|mobile|telephone|\bcell\b/i.test(combinedLow)) {
      return [p.phone, p.phoneDigits, `+1${p.phoneDigits}`];
    }

    // Candidate Location / City Autocomplete ("Newark, California" first so geocode proxies resolve exact US state!)
    if (
      /candidate[_ -]?location|current\s*location|location\s*\(city\)|where\s*are\s*you\s*(currently\s*)?(based|located)|^location\s*\*?$/i.test(
        combinedLow
      )
    ) {
      return [`${p.city}, ${p.state}`, p.locationDisplay, `${p.city}, ${p.stateCode}`];
    }
    if (/street|address\s*line\s*1|address1|^address\s*\*?$/i.test(pLow)) {
      return [p.streetAddress || `${p.city}, ${p.stateCode} ${p.postalCode}`];
    }
    if ((/\bcity\b|\btown\b/i.test(combinedLow)) && !/\?|capacity|velocity|ethnicity/i.test(pLow)) {
      return [p.city];
    }
    if ((/\bstate\b|\bprovince\b/i.test(combinedLow)) && !/\?|united states|authorized|status|statement/i.test(pLow)) {
      return [p.state, p.stateCode];
    }
    if (/\bzip\b|postal\s*code/i.test(combinedLow)) {
      return [p.postalCode];
    }
    if (/\bcountry\b|what\s+country\s+are\s+you\s+located/i.test(combinedLow)) {
      return [p.country || "United States", "United States +1", "United States of America", "USA", "US"];
    }

    // 5. Links, Current Employment & Education
    if (/linkedin/i.test(combinedLow)) return [p.linkedin, p.linkedinAlt];
    if (/github/i.test(combinedLow)) return p.github ? [p.github] : null;
    if (/portfolio|personal\s*website|^website\s*\*?$|\bwebsite\b|\bblog\b/i.test(pLow)) {
      return [p.portfolio || p.github || p.linkedin];
    }
    if (/(current|most\s*recent|present|latest).*?(company|employer|organization)|^company\s*name|^employer\b|curr_company/i.test(combinedLow)) {
      return [exp0.company || p.currentCompany];
    }
    if (/(current|most\s*recent|more\s*recent|present|latest).*?(job\s*)?title|^job\s*title|^current\s*role/i.test(combinedLow)) {
      return [exp0.title || p.currentTitle];
    }
    if (/years?\s*of\s*.*experience|how\s*many\s*years/i.test(pLow)) {
      return [p.yearsOfExperience || "3", "3-5 years", "3+"];
    }
    if ((/\bschool\b|university|college|institution|alma\s*mater/i.test(pLow)) && !/\?/i.test(pLow)) {
      return [edu0.school];
    }
    if ((/\bdegree\b/i.test(pLow)) && !/\?/i.test(pLow)) {
      return [edu0.degree, "Master's Degree", "Master of Science", "M.S.", "Masters"];
    }
    if ((/field\s*of\s*study|\bmajor\b|\bdiscipline\b/i.test(pLow)) && !/\?/i.test(pLow)) {
      return [edu0.fieldOfStudy, "Computer Science"];
    }
    if (/\bgpa\b|grade\s*point/i.test(pLow)) {
      return [edu0.gpa];
    }

    return null;
  }

  function resolveDesiredValueForLabel(labelRaw, profile) {
    const res = resolveDesiredValueForField(labelRaw, profile, null);
    if (!res || res.skip) return null;
    return res;
  }

  function hasComboboxSelection(comboEl) {
    const shell = comboEl.closest(".select-shell, .select__container, .select") || comboEl.closest(".select__control")?.parentElement;
    if (shell) {
      const singleVal = shell.querySelector(".select__single-value, [class*='singleValue']");
      if (singleVal && singleVal.innerText.trim().length > 0) return true;
      const multiVal = shell.querySelector(".select__multi-value, [class*='multiValue']");
      if (multiVal && multiVal.innerText.trim().length > 0) return true;
    }
    if (comboEl.tagName === "INPUT" && (comboEl.value || "").trim().length > 0) {
      return true;
    }
    if (comboEl.tagName === "BUTTON") {
      const txt = (comboEl.innerText || "").trim();
      if (txt && !/^select\b|^choose\b|^--/i.test(txt)) return true;
    }
    return false;
  }

  function collectComboboxOptions(comboEl, shell) {
    // 1. Exact React-Select option ID prefix or aria-controls listbox
    const ctrlId = comboEl.getAttribute("aria-controls") || comboEl.getAttribute("aria-owns");
    if (ctrlId) {
      const lb = document.getElementById(ctrlId);
      if (lb) {
        const opts = Array.from(lb.querySelectorAll("[role='option'], .select__option, [data-automation-id='promptOption']"));
        if (opts.length > 0) return opts;
      }
    }
    if (comboEl.id) {
      const byIdPrefix = Array.from(
        document.querySelectorAll(`[id^="react-select-${CSS.escape(comboEl.id)}-option-"]`)
      );
      if (byIdPrefix.length > 0) return byIdPrefix;
    }
    if (shell) {
      const localOpts = Array.from(shell.querySelectorAll(".select__option, [role='option']"));
      if (localOpts.length > 0) return localOpts;
    }
    // Fallback to visible listbox options in body portals (excluding intl-tel-input country list items)
    return Array.from(
      document.querySelectorAll(
        ".select__option, [role='option']:not(.iti__country), [data-automation-id='promptOption'], li[role='menuitem']"
      )
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function typeIntoAutocompleteInput(inp, queryText) {
    inp.focus();
    const prev = inp.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(inp, "");
    if (inp._valueTracker) inp._valueTracker.setValue(prev);
    inp.dispatchEvent(new Event("input", { bubbles: true }));

    // execCommand('insertText') triggers genuine browser InputEvent + React onInputChange;
    // keydown + keyup triggers custom wrappers (such as Greenhouse Remix candidate-location onKeyUp!)
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, queryText);
    } catch (_) {}
    if (!inserted || inp.value !== queryText) {
      const p2 = inp.value;
      if (setter) setter.call(inp, queryText);
      else inp.value = queryText;
      if (inp._valueTracker) inp._valueTracker.setValue(p2);
      inp.dispatchEvent(new InputEvent("input", { bubbles: true, data: queryText, inputType: "insertText" }));
    }
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", keyCode: 65, bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyA", keyCode: 65, bubbles: true }));
  }

  async function fillComboboxControl(comboEl, desiredCandidates, ctx, jobMeta, fillOpenEndedWithAI) {
    const shell =
      comboEl.closest(".select-shell, .select__container") ||
      comboEl.closest(".select__control")?.parentElement ||
      comboEl.parentElement;
    const ctrl = shell?.querySelector(".select__control") || comboEl;
    const toggleBtn = shell?.querySelector("button[aria-label='Toggle flyout'], button[class*='toggleButton']");

    try {
      comboEl.scrollIntoView({ block: "nearest" });
    } catch (_) {}

    // Step 1: Open menu cleanly
    comboEl.focus();
    if (toggleBtn && comboEl.getAttribute("aria-expanded") !== "true") {
      dispatchRealClick(toggleBtn);
    } else {
      dispatchRealClick(ctrl);
      comboEl.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true })
      );
    }
    await sleep(160);

    let optionEls = collectComboboxOptions(comboEl, shell);

    // Step 2: If static options appeared, match either via deterministic candidates or AI option picker
    if (optionEls.length > 0) {
      let candidates = desiredCandidates;
      if (!candidates && fillOpenEndedWithAI && ctx.primaryLabel) {
        const optionLabels = optionEls
          .map((o) => (o.innerText || o.textContent || "").trim())
          .filter(Boolean)
          .slice(0, 20);
        if (optionLabels.length > 0) {
          try {
            const resp = await Promise.race([
              chrome.runtime.sendMessage({
                type: "ANSWER_APPLICATION_QUESTION",
                payload: {
                  questionCtx: {
                    label: ctx.primaryLabel,
                    fieldType: "select",
                    options: optionLabels
                  },
                  jobMeta,
                  saveToVault: false
                }
              }),
              sleep(8000).then(() => null)
            ]);
            if (resp?.ok && resp.answer) {
              candidates = [resp.answer];
            }
          } catch (_) {}
        }
      }

      const chosen = findMatchingOptionElement(optionEls, candidates);
      if (chosen) {
        dispatchRealClick(chosen);
        highlightFilledElement(comboEl);
        await sleep(90);
        return true;
      }

      // If searchable combobox (e.g. Country list) didn't show target in top virtualized slice, filter by typing
      if (comboEl.tagName === "INPUT" && candidates?.length) {
        typeIntoAutocompleteInput(comboEl, candidates[0]);
        await sleep(220);
        optionEls = collectComboboxOptions(comboEl, shell);
        const filteredChosen = findMatchingOptionElement(optionEls, candidates);
        if (filteredChosen) {
          dispatchRealClick(filteredChosen);
          highlightFilledElement(comboEl);
          await sleep(90);
          return true;
        }
      }
    } else if (comboEl.tagName === "INPUT" && desiredCandidates?.length) {
      // Step 3: Async autocomplete combobox (Greenhouse candidate-location, Ashby Location, Workday city)
      typeIntoAutocompleteInput(comboEl, desiredCandidates[0]);
      for (let attempt = 0; attempt < 12; attempt++) {
        await sleep(150);
        optionEls = collectComboboxOptions(comboEl, shell);
        if (optionEls.length > 0) break;
      }
      if (optionEls.length > 0) {
        const chosen = findMatchingOptionElement(optionEls, desiredCandidates) || optionEls[0];
        dispatchRealClick(chosen);
        highlightFilledElement(comboEl);
        await sleep(100);
        return true;
      }
    }

    // Close menu cleanly so no open dropdown covers other fields
    comboEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    return false;
  }

  // Ashby custom Yes/No pill buttons (<button class="... ashby-application-form-input-yesno-option">)
  function fillAshbyYesNoGroups(profile) {
    let filled = 0;
    const entries = document.querySelectorAll(".ashby-application-form-field-entry, [class*='fieldEntry']");
    entries.forEach((entry) => {
      const buttons = Array.from(entry.querySelectorAll("button[class*='yesno'], button[class*='_option_']")).filter(
        (b) => /^(yes|no)$/i.test((b.innerText || "").trim())
      );
      if (buttons.length < 2) return;
      // Skip if one is already active
      if (buttons.some((b) => String(b.className).includes("_active_") || b.getAttribute("aria-pressed") === "true")) {
        return;
      }
      const lblEl = entry.querySelector("label, .ashby-application-form-question-title");
      const primaryLabel = (lblEl?.innerText || "").trim();
      if (!primaryLabel) return;
      const desired = resolveDesiredValueForField({ primaryLabel, helperText: "", fullLabel: primaryLabel }, profile);
      if (!desired || desired.skip) return;
      const matchBtn = findMatchingOptionElement(buttons, desired);
      if (matchBtn) {
        dispatchRealClick(matchBtn);
        highlightFilledElement(matchBtn);
        filled++;
      }
    });
    return filled;
  }

  async function attachBase64PdfToInput(fileInput, base64, fileName) {
    if (!fileInput || !base64) return false;
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], fileName, {
      type: "application/pdf",
      lastModified: Date.now()
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    highlightFilledElement(fileInput.parentElement || fileInput);
    return true;
  }

  async function autofillPortalAuth(credentials) {
    if (!credentials?.portalEmail || !credentials?.portalPassword) {
      return { filled: 0 };
    }
    let filled = 0;
    const emailInputs = Array.from(
      document.querySelectorAll(
        "input[type='email'], input[name*='email' i], input[name*='user' i], input[data-automation-id*='email' i]"
      )
    ).filter(isVisibleAndEditable);

    for (const em of emailInputs) {
      if (setNativeValue(em, credentials.portalEmail)) filled++;
    }

    const pwInputs = Array.from(document.querySelectorAll("input[type='password']")).filter(isVisibleAndEditable);
    for (const pw of pwInputs) {
      if (setNativeValue(pw, credentials.portalPassword)) filled++;
    }

    const checkboxes = Array.from(
      document.querySelectorAll(
        "input[type='checkbox'][data-automation-id*='createAccount' i], input[type='checkbox'][name*='terms' i], input[type='checkbox'][name*='agree' i], input[type='checkbox'][data-jobify-auth-consent]"
      )
    );
    for (const cb of checkboxes) {
      if (!cb.checked) {
        cb.click();
        filled++;
      }
    }

    return { filled };
  }

  function fillRepeaterCards(profile) {
    let filled = 0;
    const expContainers = document.querySelectorAll(
      "[data-automation-id^='workExperience-'], [data-jobify-exp-index], .work-experience-card"
    );
    expContainers.forEach((card, idx) => {
      const exp = (profile.workExperience || [])[idx];
      if (!exp) return;
      const inputs = card.querySelectorAll("input, textarea, select");
      inputs.forEach((inp) => {
        if (!isVisibleAndEditable(inp)) return;
        const lbl = getFieldLabelText(inp).toLowerCase();
        if (/job\s*title|role|position/i.test(lbl)) {
          if (setNativeValue(inp, exp.title)) filled++;
        } else if (/company|employer|organization/i.test(lbl)) {
          if (setNativeValue(inp, exp.company)) filled++;
        } else if (/location|city/i.test(lbl)) {
          if (setNativeValue(inp, exp.location)) filled++;
        } else if (/start/i.test(lbl)) {
          if (setNativeValue(inp, exp.startDateDisplay || `${exp.startMonth}/${exp.startYear}`)) filled++;
        } else if (/end/i.test(lbl) && !exp.currentlyWorking) {
          if (setNativeValue(inp, exp.endDateDisplay || `${exp.endMonth}/${exp.endYear}`)) filled++;
        } else if (/currently\s*work/i.test(lbl) && inp.type === "checkbox") {
          if (Boolean(exp.currentlyWorking) !== inp.checked) {
            inp.click();
            filled++;
          }
        } else if (/description|responsibilit|summary|highlights/i.test(lbl) || inp.tagName === "TEXTAREA") {
          const text = (exp.highlights || []).map((b) => `• ${b}`).join("\n");
          if (setNativeValue(inp, text)) filled++;
        }
      });
    });

    const eduContainers = document.querySelectorAll(
      "[data-automation-id^='education-'], [data-jobify-edu-index], .education-card"
    );
    eduContainers.forEach((card, idx) => {
      const edu = (profile.education || [])[idx];
      if (!edu) return;
      const inputs = card.querySelectorAll("input, textarea, select");
      inputs.forEach((inp) => {
        if (!isVisibleAndEditable(inp)) return;
        const lbl = getFieldLabelText(inp).toLowerCase();
        if (/school|university|college|institution/i.test(lbl)) {
          if (setNativeValue(inp, edu.school)) filled++;
        } else if (/degree/i.test(lbl)) {
          if (inp.tagName === "SELECT") {
            if (selectBestOption(inp, [edu.degree, edu.degreeShort, "Master's", "Bachelor's"])) filled++;
          } else if (setNativeValue(inp, edu.degree)) filled++;
        } else if (/field|major|discipline/i.test(lbl)) {
          if (setNativeValue(inp, edu.fieldOfStudy)) filled++;
        } else if (/gpa/i.test(lbl)) {
          if (setNativeValue(inp, edu.gpa)) filled++;
        } else if (/start/i.test(lbl)) {
          if (setNativeValue(inp, edu.startYear)) filled++;
        } else if (/end|graduat/i.test(lbl)) {
          if (setNativeValue(inp, edu.endYear)) filled++;
        }
      });
    });

    return filled;
  }

  function findOpenEndedFields(profile = { personal: {}, workAuthAndEEO: {} }) {
    const results = [];
    const candidates = Array.from(document.querySelectorAll("textarea, input[type='text']"));
    for (const el of candidates) {
      if (!isVisibleAndEditable(el)) continue;
      if (isComboboxInput(el)) continue;
      if (el.id === "resume_text" || el.id === "cover_letter_text") continue;
      if (
        el.closest(
          "[data-jobify-exp-index], [data-jobify-edu-index], [data-automation-id^='workExperience-'], [data-automation-id^='education-'], .select-shell, .select__control"
        )
      ) {
        continue;
      }

      const ctx = getFieldContext(el);
      if (!ctx.primaryLabel) continue;
      const stdMatch = resolveDesiredValueForField(ctx, profile, el);
      if (stdMatch) continue; // Either matched by standard rule OR marked { skip: true }

      const isQuestionInput =
        el.tagName === "TEXTAREA" ||
        /\?|why\b|describe\b|tell\s+us|explain|elaborate|additional\s+information|cover\s+letter|what\s+(interests|excites|are\s+the\s+most)|how\s+do\s+you|proud\s+of|core\s+technical\s+stack/i.test(
          ctx.primaryLabel
        );
      if (isQuestionInput) {
        results.push({
          element: el,
          label: ctx.primaryLabel.split("|")[0].trim() || ctx.primaryLabel.slice(0, 140),
          fullLabel: ctx.fullLabel,
          fieldType: el.tagName.toLowerCase(),
          maxLength: el.maxLength > 0 ? el.maxLength : null
        });
      }
    }
    return results;
  }

  function countActionableFormControls() {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea")).filter(
      (el) => el.type === "file" ? !el.disabled && !isTrapOrSystemInput(el) : isVisibleAndEditable(el)
    );
    return inputs.length;
  }

  // Auto-open collapsed / tabbed application views (e.g. Ashby /application tab, Lever /apply button, Workday Apply)
  async function ensureApplicationFormOpen() {
    if (countActionableFormControls() > 0) {
      return { hasControls: true, clickedApplyGate: false };
    }
    // Do not click away if an embedded ATS iframe is already present on this host page
    if (
      document.querySelector(
        "iframe[src*='greenhouse.io'], iframe[src*='ashbyhq.com'], iframe[src*='lever.co'], #grnhse_iframe"
      )
    ) {
      return { hasControls: false, clickedApplyGate: false };
    }

    const applyCandidates = Array.from(
      document.querySelectorAll(
        "a[href$='/application'], a[href*='/application?'], a.postings-btn[href*='/apply'], [data-automation-id='applyManually'], [data-automation-id='adventureButton'], button, a[role='tab'], a"
      )
    ).filter((el) => {
      const txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!/^(apply(\s+now|\s+for\s+this\s+job|\s+manually)?|application)$/i.test(txt)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    if (applyCandidates.length === 0) {
      return { hasControls: false, clickedApplyGate: false };
    }

    const target = applyCandidates[0];
    const href = target.getAttribute("href") || "";
    // Single native .click() triggers React Router / Remix SPA tab transitions without double-click or forced reload
    target.click();

    for (let i = 0; i < 14; i++) {
      await sleep(160);
      if (countActionableFormControls() > 0) {
        return { hasControls: true, clickedApplyGate: true };
      }
    }

    return {
      hasControls: countActionableFormControls() > 0,
      clickedApplyGate: true,
      navigatingHref: href || null
    };
  }

  async function runFullAutofill({
    profile,
    credentials,
    savedAnswers = [],
    resumePdfPayload = null,
    coverLetterPdfPayload = null,
    coverLetterText = "",
    fillOpenEndedWithAI = true,
    forceOverwrite = false,
    onProgress = null,
    jobMeta = null
  }) {
    let filledCount = 0;
    const filledFieldsLog = [];
    const meta = jobMeta || extractJobMetadata(document);

    // 0. Ensure application tab / collapsed form is open if needed
    const gate = await ensureApplicationFormOpen();
    if (!gate.hasControls && !meta.isAuthWall) {
      return {
        filledCount: 0,
        filledFieldsLog: [],
        openQuestionsCount: 0,
        clickedApplyGate: gate.clickedApplyGate,
        jobMeta: meta
      };
    }

    // 1. Portal Login / Account Creation Wall
    if (meta.isAuthWall && credentials?.autoFillPortalSignups !== false) {
      const authRes = await autofillPortalAuth(credentials);
      filledCount += authRes.filled;
      if (authRes.filled > 0) filledFieldsLog.push("Portal Login / Account Credentials");
    }

    // 2. Multi-Entry Work Experience & Education Repeater Cards
    const repeaterFilled = fillRepeaterCards(profile);
    filledCount += repeaterFilled;

    // 3. Attach Resume PDF & Cover Letter PDF
    // Note: On Ashby, skip top-of-page unlabelled AI autofill dropzone when #_systemfield_resume exists,
    // otherwise Ashby's async parser overwrites our clean fields 3 seconds later!
    const hasAshbySystemResume = Boolean(document.getElementById("_systemfield_resume"));
    const fileInputs = Array.from(document.querySelectorAll("input[type='file']")).filter((fi) => {
      if (fi.disabled || isTrapOrSystemInput(fi)) return false;
      if (hasAshbySystemResume && fi.id !== "_systemfield_resume") {
        const ctx = getFieldContext(fi);
        if (!/cover\s*letter/i.test(ctx.fullLabel)) return false;
      }
      return true;
    });

    let attachedResume = false;
    let attachedCover = false;
    for (const fi of fileInputs) {
      const lbl = getFieldLabelText(fi).toLowerCase();
      if (/cover\s*letter/i.test(lbl)) {
        if (coverLetterPdfPayload?.base64 && (forceOverwrite || !fi.files?.length)) {
          await attachBase64PdfToInput(fi, coverLetterPdfPayload.base64, coverLetterPdfPayload.fileName);
          attachedCover = true;
          filledCount++;
          filledFieldsLog.push(`Cover Letter PDF (${coverLetterPdfPayload.fileName})`);
        }
      } else if (/resume|cv\b|curriculum|attach/i.test(lbl) || fileInputs.length === 1) {
        if (resumePdfPayload?.base64 && (forceOverwrite || !fi.files?.length)) {
          await attachBase64PdfToInput(fi, resumePdfPayload.base64, resumePdfPayload.fileName);
          attachedResume = true;
          filledCount++;
          filledFieldsLog.push(`Resume PDF (${resumePdfPayload.fileName})`);
        }
      }
    }

    // 4. Ashby Custom Yes/No Pill Button Groups
    const ashbyBtnsFilled = fillAshbyYesNoGroups(profile);
    filledCount += ashbyBtnsFilled;
    if (ashbyBtnsFilled > 0) filledFieldsLog.push(`Ashby Yes/No Questions (${ashbyBtnsFilled})`);

    // 5. React-Select & Custom ARIA Comboboxes (2 passes so conditional dropdowns like EEOC Race mount & get filled)
    const visitedCombos = new WeakSet();
    for (let comboPass = 0; comboPass < 2; comboPass++) {
      const comboboxes = Array.from(
        document.querySelectorAll("input[role='combobox'], button[aria-haspopup='listbox'], [role='combobox']")
      ).filter((el) => {
        if (visitedCombos.has(el)) return false;
        if (isTrapOrSystemInput(el)) return false;
        if (el.tagName !== "INPUT" && el.querySelector?.("input[role='combobox']")) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.disabled;
      });
      if (comboboxes.length === 0) break;

      for (const combo of comboboxes) {
        visitedCombos.add(combo);
        if (!forceOverwrite && hasComboboxSelection(combo)) continue;
        const ctx = getFieldContext(combo);
        const resolved = resolveDesiredValueForField(ctx, profile, combo);
        if (resolved?.skip) continue;
        const ok = await fillComboboxControl(combo, resolved, ctx, meta, fillOpenEndedWithAI);
        if (ok) {
          filledCount++;
          filledFieldsLog.push(ctx.primaryLabel.split("|")[0].trim() || combo.id || "Dropdown");
        }
      }
      await sleep(120);
    }

    // 6. Standard <input>, <select>, Radio Groups, Checkboxes & Cover Letter Textarea
    const allControls = Array.from(document.querySelectorAll("input, select, textarea"));
    const handledRadioGroups = new Set();
    const handledCheckboxGroups = new Set();

    for (const el of allControls) {
      if (el.type === "file") continue;
      if (isComboboxInput(el)) continue;
      if (!isVisibleAndEditable(el)) continue;
      if (attachedResume && el.id === "resume_text") continue;
      if (attachedCover && el.id === "cover_letter_text") continue;
      if (
        el.closest(
          "[data-jobify-exp-index], [data-jobify-edu-index], [data-automation-id^='workExperience-'], [data-automation-id^='education-']"
        )
      ) {
        continue;
      }

      const ctx = getFieldContext(el);

      if (el.type === "radio") {
        const groupKey = el.name || ctx.primaryLabel;
        if (handledRadioGroups.has(groupKey)) continue;
        const desired = resolveDesiredValueForField(ctx, profile, el);
        if (desired && !desired.skip) {
          const radios = el.name
            ? Array.from(document.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`))
            : [el];
          const radioWrappers = radios.map((r) => ({
            radio: r,
            innerText: `${getFieldContext(r).primaryLabel} ${r.value || ""}`
          }));
          const chosenWrap = findMatchingOptionElement(radioWrappers, desired);
          if (chosenWrap?.radio) {
            if (!chosenWrap.radio.checked) chosenWrap.radio.click();
            highlightFilledElement(chosenWrap.radio);
            handledRadioGroups.add(groupKey);
            filledCount++;
            filledFieldsLog.push(ctx.primaryLabel.split("|")[0].trim());
          }
        }
        continue;
      }

      if (el.type === "checkbox") {
        // Multi-checkbox questions (e.g. sanctions "None of the above")
        if (el.name && el.name.endsWith("[]")) {
          if (handledCheckboxGroups.has(el.name)) continue;
          const groupCbs = Array.from(
            document.querySelectorAll(`input[type='checkbox'][name="${CSS.escape(el.name)}"]`)
          );
          const groupCtx = getFieldContext(el.closest(".checkbox, fieldset, .field") || el);
          const desired = resolveDesiredValueForField(groupCtx, profile, el);
          if (desired && !desired.skip) {
            const wrappers = groupCbs.map((cb) => ({
              cb,
              innerText: getFieldContext(cb).primaryLabel
            }));
            const chosen = findMatchingOptionElement(wrappers, desired);
            if (chosen?.cb) {
              if (!chosen.cb.checked) chosen.cb.click();
              highlightFilledElement(chosen.cb);
              handledCheckboxGroups.add(el.name);
              filledCount++;
              filledFieldsLog.push(groupCtx.primaryLabel.split("|")[0].trim());
            }
          }
          continue;
        }

        if (
          /privacy|consent|acknowledge|i\s*agree|terms|certify|accurate|gdpr|data_consent/i.test(ctx.fullLabel) &&
          !el.checked
        ) {
          el.click();
          highlightFilledElement(el);
          filledCount++;
          filledFieldsLog.push("Consent Checkbox");
        }
        continue;
      }

      if (el.tagName === "TEXTAREA" && /cover\s*letter/i.test(ctx.primaryLabel) && coverLetterText) {
        if (forceOverwrite || !(el.value || "").trim()) {
          if (setNativeValue(el, coverLetterText)) {
            filledCount++;
            filledFieldsLog.push("Cover Letter Text");
          }
        }
        continue;
      }

      const desired = resolveDesiredValueForField(ctx, profile, el);
      if (!desired || desired.skip) continue;

      if (el.tagName === "SELECT") {
        if (!forceOverwrite && el.value && el.selectedIndex > 0) continue;
        if (selectBestOption(el, desired)) {
          filledCount++;
          filledFieldsLog.push(ctx.primaryLabel.split("|")[0].trim());
        }
      } else {
        if (!forceOverwrite && (el.value || "").trim().length > 0) continue;
        if (setNativeValue(el, desired[0])) {
          filledCount++;
          filledFieldsLog.push(ctx.primaryLabel.split("|")[0].trim());
        }
      }
    }

    // 7. Open-Ended Essay Questions: Instant Saved Vault Match + Parallel Timeout-Guarded Gemini AI
    const openQuestions = findOpenEndedFields(profile);
    const usedSavedIds = new Set();
    const pendingAiQuestions = [];

    for (const q of openQuestions) {
      if (!forceOverwrite && q.element.value && q.element.value.trim().length > 10) continue;
      let matchedAnswer = null;
      for (const sa of savedAnswers) {
        if (usedSavedIds.has(sa.id)) continue;
        if (sa.questionPattern) {
          try {
            if (new RegExp(sa.questionPattern, "i").test(q.fullLabel)) {
              matchedAnswer = sa.answer;
              usedSavedIds.add(sa.id);
              break;
            }
          } catch (_) {}
        }
      }
      if (matchedAnswer) {
        if (setNativeValue(q.element, matchedAnswer)) {
          filledCount++;
          filledFieldsLog.push(`Saved Answer: ${q.label.slice(0, 36)}`);
        }
      } else if (fillOpenEndedWithAI) {
        pendingAiQuestions.push(q);
      }
    }

    if (pendingAiQuestions.length > 0) {
      if (typeof onProgress === "function") {
        onProgress(
          `⚡ Filled ${filledCount} standard fields — drafting ${pendingAiQuestions.length} AI answer(s)...`
        );
      }
      await Promise.all(
        pendingAiQuestions.slice(0, 6).map(async (q) => {
          try {
            const resp = await Promise.race([
              chrome.runtime.sendMessage({
                type: "ANSWER_APPLICATION_QUESTION",
                payload: {
                  questionCtx: {
                    label: q.label,
                    fieldType: q.fieldType,
                    maxLength: q.maxLength
                  },
                  jobMeta: meta,
                  forceAi: true,
                  saveToVault: true
                }
              }),
              sleep(12000).then(() => null)
            ]);
            if (resp?.ok && resp.answer) {
              if (setNativeValue(q.element, resp.answer)) {
                filledCount++;
                filledFieldsLog.push(`AI Answer: ${q.label.slice(0, 36)}`);
              }
            }
          } catch (_) {}
        })
      );
    }

    return {
      filledCount,
      filledFieldsLog,
      openQuestionsCount: openQuestions.length,
      clickedApplyGate: gate.clickedApplyGate,
      jobMeta: meta
    };
  }

  // Self-contained per-frame entrypoint invoked by service_worker RUN_TAB_AUTOFILL across all frames (top + embedded ATS iframes)
  async function runFrameAutofill(options = {}) {
    const stateResp = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" }).catch(() => null);
    const state = stateResp?.state;
    if (!state) return { filledCount: 0, filledFieldsLog: [] };

    const hasFileInputs = document.querySelectorAll("input[type='file']").length > 0;
    let resumePdfPayload = null;
    if (hasFileInputs && state.settings?.autoAttachResumePdf !== false) {
      const selectedResumeId = options.resumeChoice || state.settings?.defaultResumeVariant || "one_page";
      const pdfResp = await chrome.runtime
        .sendMessage({ type: "GET_RESUME_PDF_BYTES", payload: { variantOrId: selectedResumeId } })
        .catch(() => null);
      if (pdfResp?.ok) resumePdfPayload = pdfResp;
    }

    const latestCl = (state.coverLetters || [])[0] || null;
    const coverLetterPdfPayload =
      options.coverLetterPdfPayload ||
      (hasFileInputs && latestCl?.pdfBase64 ? { fileName: latestCl.fileName, base64: latestCl.pdfBase64 } : null);

    return runFullAutofill({
      profile: state.profile,
      credentials: state.credentials,
      savedAnswers: state.savedAnswers || [],
      resumePdfPayload,
      coverLetterPdfPayload,
      coverLetterText: options.coverLetterText || latestCl?.coverLetter || "",
      fillOpenEndedWithAI: options.fillOpenEndedWithAI !== false,
      forceOverwrite: Boolean(options.forceOverwrite),
      jobMeta: options.topJobMeta || null
    });
  }

  window.__JOBIFY_ADAPTERS__ = {
    detectATSPlatform,
    extractJobMetadata,
    setNativeValue,
    getFieldContext,
    getFieldLabelText,
    findOpenEndedFields,
    attachBase64PdfToInput,
    autofillPortalAuth,
    ensureApplicationFormOpen,
    runFullAutofill,
    runFrameAutofill
  };
})();
