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

  function extractCompensationFromJob(text = "") {
    const src = String(text || "");
    if (!src) return null;

    // 1. Hourly rate range or single hourly rate: e.g. "$55/hr - $65/hr", "$50 - $65 per hour", "$60/hr"
    const hrRangeMatch = src.match(
      /\$\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:\/?\s*(?:hr|hour))?\s*(?:[-–—]|to)\s*\$?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:\/\s*hr|\/\s*hour|per\s+hour|hourly|\bhr\b)/i
    );
    if (hrRangeMatch) {
      const minH = Math.round(parseFloat(hrRangeMatch[1]));
      const maxH = Math.round(parseFloat(hrRangeMatch[2]));
      if (minH >= 20 && maxH <= 350 && maxH >= minH) {
        const midH = Math.round((minH + maxH) / 2);
        return {
          type: "hourly",
          minHourly: minH,
          maxHourly: maxH,
          targetHourly: midH,
          displayHourly: `$${midH}/hr`,
          displayHourlyRange: `$${minH}/hr - $${maxH}/hr`
        };
      }
    }
    const hrSingleMatch = src.match(/\$\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:\/\s*hr|\/\s*hour|per\s+hour|hourly)/i);
    if (hrSingleMatch) {
      const h = Math.round(parseFloat(hrSingleMatch[1]));
      if (h >= 20 && h <= 350) {
        return {
          type: "hourly",
          minHourly: h,
          maxHourly: h,
          targetHourly: h,
          displayHourly: `$${h}/hr`,
          displayHourlyRange: `$${h}/hr`
        };
      }
    }

    // 2. Annual salary range: e.g. "$140,000 - $180,000", "$135k - $165k"
    const annualRangeComma = src.match(
      /\$\s*(\d{2,3}),(\d{3})(?:\.\d{2})?\s*(?:USD\s*)?(?:[-–—]|to)\s*\$\s*(\d{2,3}),(\d{3})/i
    );
    if (annualRangeComma) {
      const minA = parseInt(annualRangeComma[1] + annualRangeComma[2], 10);
      const maxA = parseInt(annualRangeComma[3] + annualRangeComma[4], 10);
      if (minA >= 50000 && maxA <= 950000 && maxA >= minA) {
        const midA = Math.round((minA + maxA) / 2 / 5000) * 5000;
        return {
          type: "annual",
          minAnnual: minA,
          maxAnnual: maxA,
          targetAnnual: midA,
          displayAnnual: `$${midA.toLocaleString()}`,
          displayAnnualRange: `$${minA.toLocaleString()} - $${maxA.toLocaleString()}`,
          numericAnnualRange: `${minA}-${maxA}`
        };
      }
    }

    const annualRangeK = src.match(/\$\s*(\d{2,3})\s*[kK]\s*(?:[-–—]|to)\s*\$?\s*(\d{2,3})\s*[kK]\b/);
    if (annualRangeK) {
      const minA = parseInt(annualRangeK[1], 10) * 1000;
      const maxA = parseInt(annualRangeK[2], 10) * 1000;
      if (minA >= 50000 && maxA <= 950000 && maxA >= minA) {
        const midA = Math.round((minA + maxA) / 2 / 5000) * 5000;
        return {
          type: "annual",
          minAnnual: minA,
          maxAnnual: maxA,
          targetAnnual: midA,
          displayAnnual: `$${midA.toLocaleString()}`,
          displayAnnualRange: `$${minA.toLocaleString()} - $${maxA.toLocaleString()}`,
          numericAnnualRange: `${minA}-${maxA}`
        };
      }
    }

    return null;
  }

  function doesJobMentionCoverLetter(text = "") {
    const src = String(text || "");
    if (!/cover\s*letter/i.test(src)) return false;
    if (/no\s+cover\s+letter|cover\s+letter\s+(is\s+)?not\s+(required|needed|necessary)|without\s+a\s+cover\s+letter/i.test(src)) {
      return false;
    }
    return true;
  }

  const BRAND_CASING_MAP = {
    openai: "OpenAI",
    nvidia: "NVIDIA",
    xai: "xAI",
    deepmind: "DeepMind",
    scaleai: "Scale AI",
    perplexity: "Perplexity AI",
    perplexityai: "Perplexity AI",
    huggingface: "Hugging Face",
    github: "GitHub",
    linkedin: "LinkedIn"
  };

  function formatCompanyResumeFileName(companyName, fallbackSuffix = "Resume") {
    const raw = String(companyName || "").trim();
    const isGeneric =
      !raw ||
      /^(target(\s+company)?|company|unknown|job\s*portal|career\s*portal|careers?|active\s+browser\s+tab|application)$/i.test(
        raw
      );
    const cleanComp = isGeneric
      ? ""
      : raw
          .replace(/&/g, "and")
          .replace(/[^a-zA-Z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 32);
    return `Raviteja_velanati_${cleanComp || fallbackSuffix}.pdf`;
  }

  function extractJobMetadata(doc = document) {
    const url = location.href;
    if (/^https?:\/\/mail\.google\.com\b/i.test(url)) {
      return {
        isRelevantPage: false,
        isAuthWall: false,
        hasEmbeddedAtsIframe: false,
        ats: "Web",
        company: "",
        title: "",
        location: "",
        description: "",
        compensation: null,
        mentionsCoverLetter: false,
        url
      };
    }

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
        const cleanKey = decodeURIComponent(rawSlug).toLowerCase().replace(/[^a-z0-9]/g, "");
        company =
          BRAND_CASING_MAP[cleanKey] ||
          decodeURIComponent(rawSlug)
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

    const combinedJobText = `${title}\n${locationStr}\n${description}`;
    const compensation = extractCompensationFromJob(combinedJobText);
    const mentionsCoverLetter = doesJobMentionCoverLetter(description);

    const uLow = url.toLowerCase();
    const hasPasswordInput = Array.from(doc.querySelectorAll("input[type='password']")).some(isVisibleAndEditable);
    const hasFileUpload = Array.from(doc.querySelectorAll("input[type='file']")).some(isActionableFileInput);
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
      compensation,
      mentionsCoverLetter,
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

  const COOKIE_CONSENT_SELECTOR =
    "#onetrust-consent-sdk, [id*='onetrust' i], [class*='onetrust' i], #CybotCookiebotDialog, [id*='cookiebot' i], [id*='cookie-banner' i], [class*='cookie-consent' i], .osano-cm-window, #truste-consent-track";

  function dispatchRealClick(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
  }

  function clickCheckboxOrRadioReliably(el) {
    if (!el) return false;
    if (el.checked) return true;
    try {
      dispatchRealClick(el);
    } catch (_) {
      try {
        el.click();
      } catch (__) {}
    }
    if (!el.checked && el.id) {
      const explicitLbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicitLbl) dispatchRealClick(explicitLbl);
    }
    if (!el.checked) {
      const parentLbl = el.closest("label");
      if (parentLbl) dispatchRealClick(parentLbl);
    }
    if (!el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return Boolean(el.checked);
  }

  function isComboboxInput(el) {
    if (!el) return false;
    if (el.getAttribute("role") === "combobox") return true;
    if (el.getAttribute("aria-autocomplete") === "list") return true;
    if (el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("aria-haspopup") === "true") return true;
    if (el.classList?.contains("select__input")) return true;
    if (el.className && typeof el.className === "string" && el.className.includes("input-autocomplete")) return true;
    if (el.dataset?.automationId === "searchBox") return true;
    if (el.tagName === "INPUT" && el.closest?.("[data-automation-id='multiSelectContainer']")) return true;
    return false;
  }

  function isTrapOrSystemInput(el) {
    if (!el) return true;
    if (el.getAttribute("aria-hidden") === "true") return true;
    if (el.classList?.contains("remix-css-1a0ro4n-requiredInput")) return true;
    if (el.classList?.contains("g-recaptcha-response")) return true;
    if (el.closest(COOKIE_CONSENT_SELECTOR)) return true;
    const ident = `${el.id || ""} ${el.name || ""} ${el.dataset?.automationId || ""} ${typeof el.className === "string" ? el.className : ""}`;
    if (/recaptcha|hcaptcha|turnstile|honeypot|bot[-_]?field|keywordsearch|locationsearch|jobalert|job[-_]?alert|newsletter/i.test(ident)) {
      return true;
    }
    // intl-tel-input country search input inside phone flag dropdown
    if (/^iti-\d+__search-input$/i.test(el.id || "")) return true;
    // Site-wide header/navbar/footer search or newsletter boxes
    if (el.closest("header, nav, footer, [role='navigation'], [role='search'], [role='banner'], [role='contentinfo']")) {
      return true;
    }
    // Ashby hidden checkbox backing Yes/No button pills (uses _option_ or yesno class on buttons)
    if (
      el.type === "checkbox" &&
      el
        .closest("[class*='yesno'], .ashby-application-form-field-entry, [class*='fieldEntry']")
        ?.querySelector("button[class*='yesno'], button[class*='_option_']")
    ) {
      return true;
    }
    return false;
  }

  function isHeaderOrNavButton(el) {
    if (!el) return true;
    if (el.closest(COOKIE_CONSENT_SELECTOR)) return true;
    const autoId = el.dataset?.automationId || "";
    if (
      /^(utilityButtonSignIn|hammyMenuIcon|backToJobPosting|logoLink|socialIcon|accessibilitySkipToMainContent)$/i.test(autoId) ||
      /^navigationItem-/i.test(autoId)
    ) {
      return true;
    }
    if (el.closest("header, nav, footer, [role='navigation'], [role='banner'], [data-automation-id='utilityButtonBar']")) {
      // Allow Ashby Application tab link inside job header tabs if href ends with /application
      const href = el.getAttribute("href") || "";
      const txt = (el.innerText || el.textContent || "").trim();
      if (/\/application(\?|$)/i.test(href) || /^application$/i.test(txt)) {
        return false;
      }
      return true;
    }
    return false;
  }

  function isInHiddenAncestor(el) {
    if (!el || !el.isConnected) return true;
    let cur = el.parentElement;
    while (cur && cur !== document.documentElement) {
      // Allow a pure single-child wrapper around <input type="file"> (e.g. <span style="display:none"><input type="file"></span>)
      const isPureFileWrapper =
        el.type === "file" &&
        cur === el.parentElement &&
        cur.childElementCount === 1 &&
        !(cur.innerText || "").trim();
      if (!isPureFileWrapper) {
        if (cur.hidden) return true;
        if (cur.getAttribute("aria-hidden") === "true" && cur.matches?.("[role='dialog'], [role='tabpanel']")) {
          return true;
        }
        const cs = window.getComputedStyle(cur);
        if (cs.display === "none" || cs.visibility === "hidden") return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  function isActionableFileInput(el) {
    if (!el || el.type !== "file" || el.disabled) return false;
    if (isTrapOrSystemInput(el)) return false;
    return !isInHiddenAncestor(el);
  }

  function isVisibleAndEditable(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (isTrapOrSystemInput(el)) return false;
    if (el.type === "hidden" || el.type === "submit" || el.type === "button" || el.type === "reset" || el.type === "image") {
      return false;
    }
    if (isInHiddenAncestor(el)) return false;
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

  // Extract ONLY the individual option label for a radio/checkbox (never parent fieldset/question title!)
  function getChoiceOptionLabel(el) {
    if (!el) return "";
    const parts = [];
    if (el.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicit) parts.push(explicit.innerText || explicit.textContent);
    }
    const parentLabel = el.closest("label");
    if (parentLabel) parts.push(parentLabel.innerText || parentLabel.textContent);
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) parts.push(ariaLabel);
    if (parts.length === 0 && el.name && !/\[\]|question|field/i.test(el.name)) {
      parts.push(el.name);
    }
    if (el.value && !/^(on|true|1)$/i.test(String(el.value).trim())) {
      parts.push(el.value);
    }
    return [...new Set(parts.map((x) => String(x || "").replace(/\s+/g, " ").trim()).filter(Boolean))].join(" ");
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

  function hasCssRequiredMarker(node) {
    if (!node || node.nodeType !== 1) return false;
    const cls = typeof node.className === "string" ? node.className : "";
    if (/(^|[_-\s])required([_-\s]|$)/i.test(cls) && !/not[_-]?required|unrequired|optional/i.test(cls)) {
      return true;
    }
    try {
      const afterContent = window.getComputedStyle(node, "::after")?.content || "";
      const beforeContent = window.getComputedStyle(node, "::before")?.content || "";
      if (afterContent.includes("*") || beforeContent.includes("*")) return true;
    } catch (_) {}
    return false;
  }

  function isFieldRequired(el, ctx = null) {
    if (!el) return false;
    if (el.required || el.getAttribute("aria-required") === "true" || el.getAttribute("aria-invalid") === "true") {
      return true;
    }
    if (el.id) {
      const explicitLbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicitLbl && (/\*/.test(explicitLbl.textContent || "") || hasCssRequiredMarker(explicitLbl))) {
        return true;
      }
    }
    const c = ctx || getFieldContext(el);
    if (/\*/.test(c.primaryLabel || "") || /\brequired\b/i.test(c.primaryLabel || "")) return true;
    const wrapper = el.closest(
      ".select-shell, .field, .form-group, .application-question, .ashby-application-form-field-entry, [class*='fieldEntry'], [data-automation-id*='formField'], fieldset"
    );
    if (wrapper) {
      if (hasCssRequiredMarker(wrapper)) return true;
      if (wrapper.querySelector("input[required], select[required], textarea[required], [aria-required='true'], [aria-invalid='true']")) {
        return true;
      }
      const lbl = wrapper.querySelector("label, legend, .field-label, .label, .ashby-application-form-question-title");
      if (lbl && (/\*/.test(lbl.textContent || "") || hasCssRequiredMarker(lbl))) return true;
    }
    return false;
  }

  // Order-safe label resolver verified against real Greenhouse, Ashby, Workday & Lever questions
  function resolveDesiredValueForField(ctxOrLabel, profile, el = null, jobMeta = null) {
    const ctx =
      typeof ctxOrLabel === "string"
        ? { primaryLabel: ctxOrLabel, helperText: "", fullLabel: ctxOrLabel }
        : ctxOrLabel;

    const pLow = (ctx.primaryLabel || "").toLowerCase();
    const hLow = (ctx.helperText || "").toLowerCase();
    const idNameLow = `${el?.id || ""} ${el?.name || ""} ${el?.dataset?.automationId || ""} ${el?.autocomplete || ""}`.toLowerCase();
    const combinedLow = `${pLow} | ${idNameLow}`;

    const p = profile?.personal || {};
    const eeo = profile?.workAuthAndEEO || {};
    const exp0 = (profile?.workExperience || [])[0] || {};
    const edu0 = (profile?.education || [])[0] || {};

    // 0. Guard against passwords, OTP boxes, site search, take-home URLs, and conditional follow-ups ("If yes, explain...")
    if (/password|search\s*jobs|keyword\s*search|filter\s*by/i.test(combinedLow)) return null;
    if (
      el?.maxLength === 1 ||
      /\bone[- ]?time[- ]?code\b|\botp\b|verification\s*code|security\s*code|passcode|enter.*code.*sent/i.test(combinedLow)
    ) {
      return { skip: true };
    }
    if (/exercise\s*submission|take[- ]?home|coding\s*challenge/i.test(pLow)) return null;
    if (/^if\s+(yes|no|other|applicable|so|you\s+selected)\b/i.test(pLow.trim())) {
      return { skip: true };
    }
    if (/publications?,?\s*papers?\s*or\s*research|google\s*scholar/i.test(pLow) && !isFieldRequired(el, ctx)) {
      return { skip: true };
    }
    if (/samples?\s+of\s+your\s+code|code\s*samples?|github.*personal\s*projects/i.test(`${pLow} ${hLow}`)) {
      return [p.github || p.portfolio, p.linkedin].filter(Boolean);
    }
    if (/share\s+links?.*learn\s+more\s+about\s+you|links?\s+to\s+online\s+profiles/i.test(`${pLow} ${hLow}`)) {
      return [p.linkedin, p.github || p.portfolio].filter(Boolean);
    }

    // 1. Legal / Arbitration / Consent / AI Policy / Sanctions / Government / Clearance / Non-Compete / Age / Background Check
    if (/arbitrat|read\s+the\s+.*agreement|terms\s+of\s+the\s+agreement|confirm\s+i\s+have\s+read|read\s+and\s+underst(ood|and)/i.test(pLow)) {
      return [
        "I understand and agree",
        "I will read the arbitration agreement",
        "I confirm",
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
    if (
      /government\s*(employee|official|agency|employment|service)|worked\s*for\s*(the\s*)?(u\.?s\.?\s*|federal\s*)?government|security\s*clearance|active\s*clearance|hold.*clearance|relatives?\s*(employed|working)|family\s*members?\s*(employed|working)/i.test(
        pLow
      )
    ) {
      return [eeo.governmentOrClearance || "No", "No", "None"];
    }
    if (/non-?compete|non-?solicitation|bound\s+by\s+any\s+agreements?|restrict\s+your\s+ability\s+to\s+work/i.test(pLow)) {
      return ["No"];
    }
    if (/18\s*years|over\s*18|at\s*least\s*18|background\s*check/i.test(pLow)) {
      return ["Yes"];
    }

    // 2. Work Authorization, Visa Status, Citizenship, Sponsorship, Prior Employment, Relocation, Hybrid, Salary, Start Date
    // (MUST run BEFORE geographic country/state/city matchers because work-auth labels contain "in the country where...")
    if (
      /what\s*is\s*your\s*(current\s*)?(u\.?s\.?\s*)?(visa|immigration|work\s*authorization)\s*(type|status|classification|category)|current\s*(u\.?s\.?\s*)?visa|visa\s*(type|category|classification|status)/i.test(
        pLow
      ) &&
      !/require|need|future|will\s*you/i.test(pLow)
    ) {
      return [eeo.visaStatus || "H-1B", "H-1B", "H1B", "H-1B Visa", "H-1B Specialty Occupation"];
    }
    if (/are\s+you\s+a\s+(u\.?s\.?\s*|united\s+states\s*)?(citizen|permanent\s+resident)/i.test(pLow)) {
      return ["No"];
    }
    if (/citizenship|citizen\s*of|nationality|country\s*of\s*(citizenship|origin|nationality)/i.test(combinedLow)) {
      return [eeo.citizenship || "India", "India", "Indian"];
    }
    if (/authorized\s*to\s*work|legally\s*authorized|eligible\s*to\s*work|right\s*to\s*work/i.test(pLow)) {
      return [eeo.authorizedUS || "Yes", "Yes"];
    }
    if (/sponsorship|require.*visa|need.*visa|future.*visa|h-?1b|opt\s*status/i.test(pLow)) {
      return [eeo.requireSponsorship || "Yes", "Yes", eeo.visaStatus || "H-1B"];
    }
    if (
      /previously\s*(worked|employed|applied|interviewed)|former\s*(employee|contractor)|ever\s*(worked|interviewed)|interviewed\s*(at|with)\b|worked\s*for\s+.*\bin\s+the\s+past|currently\s+or\s+have\s+you\s+previously\s+worked/i.test(
        pLow
      )
    ) {
      return [eeo.previouslyEmployedAtCompany || "No", "No"];
    }
    if (/address\s*from\s*which\s*you\s*plan|working\s*address|home\s*address|mailing\s*address|full\s*address/i.test(pLow)) {
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

    // Smart Compensation / Salary / Hourly Rate Resolver (JD-Aware Priority -> User Fallback)
    if (/\bsalary\b|\bcompensation\b|desired\s*pay|pay\s*expectation|hourly\s*rate|pay\s*rate|expected\s*pay|remuneration/i.test(combinedLow)) {
      const comp = eeo.useJdSalaryWhenAvailable !== false ? jobMeta?.compensation : null;
      const isHourly = /hourly|per\s*hour|\/\s*hr|\/\s*hour|bill\s*rate/i.test(`${combinedLow} ${hLow}`);
      const isRange = /\brange\b|min.*max/i.test(`${combinedLow} ${hLow}`);
      const isNumericInput =
        el?.type === "number" ||
        el?.inputMode === "numeric" ||
        /numeric|numbers?\s*only|digits?\s*only|without\s*\$|no\s*commas/i.test(`${pLow} ${hLow} ${el?.placeholder || ""}`);

      if (isHourly) {
        if (comp?.type === "hourly") {
          if (isNumericInput) return [String(comp.targetHourly)];
          if (isRange) return [comp.displayHourlyRange, comp.displayHourly, String(comp.targetHourly)];
          return [comp.displayHourly, String(comp.targetHourly), comp.displayHourlyRange];
        }
        if (isNumericInput) return [String(eeo.desiredHourlyTarget || 50)];
        if (isRange) return [eeo.desiredHourlyRangeDisplay || "$50/hr - $60/hr", "50-60", "$50/hr"];
        return [eeo.desiredHourlyDisplay || "$50/hr", String(eeo.desiredHourlyTarget || 50), eeo.desiredHourlyRangeDisplay || "$50/hr - $60/hr"];
      }

      if (comp?.type === "annual") {
        if (isNumericInput) return [String(comp.targetAnnual)];
        if (isRange) return [comp.displayAnnualRange, comp.numericAnnualRange, String(comp.targetAnnual)];
        return [String(comp.targetAnnual), comp.displayAnnual, comp.displayAnnualRange];
      }

      if (isNumericInput) return [String(eeo.desiredSalaryTarget || 120000)];
      if (isRange) {
        return [
          eeo.desiredSalaryRangeNumeric || "120000-140000",
          eeo.desiredSalaryDisplay || "$120,000 - $140,000",
          String(eeo.desiredSalaryTarget || 120000)
        ];
      }
      return [
        String(eeo.desiredSalaryTarget || 120000),
        eeo.desiredSalaryDisplay || "$120,000 - $140,000",
        eeo.desiredSalaryRangeNumeric || "120000-140000"
      ];
    }

    if ((/how\s*did\s*you\s*hear|referral\s*source|\bsource\b/i.test(pLow)) && !/open[- ]?source/i.test(pLow)) {
      return ["LinkedIn", "Company Website", "Job Board", eeo.howDidYouHear || "LinkedIn"];
    }

    // 3a. Workday / OFCCP Form CC-305 Signature Date, Name & Employee ID (must run BEFORE EEO 'disability'/'veteran' container ID checks because Workday prefixes IDs with 'selfIdentifiedDisabilityData--'!)
    if (/\bemployee\s*id\b|employeeid/i.test(combinedLow)) {
      return { skip: true };
    }
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const yyyy = String(now.getFullYear());
    if (/datesectionmonth/i.test(idNameLow) && /sign|today|disclos|selfidentif|acknowl/i.test(`${combinedLow} ${ctx.fullLabel || ""}`)) {
      return [mm];
    }
    if (/datesectionday/i.test(idNameLow) && /sign|today|disclos|selfidentif|acknowl/i.test(`${combinedLow} ${ctx.fullLabel || ""}`)) {
      return [dd];
    }
    if (/datesectionyear/i.test(idNameLow) && /sign|today|disclos|selfidentif|acknowl/i.test(`${combinedLow} ${ctx.fullLabel || ""}`)) {
      return [yyyy];
    }
    if (/today'?s\s*date|date\s*signed|datesignedon|signature\s*date/i.test(combinedLow)) {
      return el?.type === "date" ? [`${yyyy}-${mm}-${dd}`] : [`${mm}/${dd}/${yyyy}`, `${yyyy}-${mm}-${dd}`];
    }
    const firstPrimaryPart = pLow.split("|")[0].trim();
    if (
      (/^(full\s*(legal\s*)?name|legal\s*name|name|your\s*name|applicant\s*name|candidate\s*name|signature)\s*\*?$/i.test(firstPrimaryPart) ||
        /--name\b/i.test(idNameLow)) &&
      !/company|school|employer|reference|pronounc/i.test(firstPrimaryPart)
    ) {
      return [p.fullName];
    }

    // 3b. EEO / Demographic Self-Identification
    if (/hispanic|latino/i.test(combinedLow)) return [eeo.hispanicOrLatino || "No", "No"];
    if (/\brace\b|ethnicity/i.test(combinedLow)) {
      return [eeo.raceEthnicity || "Asian", "Asian (Not Hispanic or Latino)", "Asian"];
    }
    if (/lgbtq/i.test(combinedLow) && !/sexual\s*orientation/i.test(combinedLow)) {
      return [eeo.lgbtq || "No", "No", "Heterosexual / Straight", "Straight"];
    }
    if (/sexual\s*orientation/i.test(combinedLow)) {
      return [
        eeo.sexualOrientation || "Straight",
        "Heterosexual / Straight",
        "Straight / Heterosexual",
        "Heterosexual",
        "Straight",
        "No"
      ];
    }
    if (/transgender/i.test(combinedLow)) {
      return [eeo.transgender || "No", "No"];
    }
    if (/\bgender\b|\bsex\b/i.test(combinedLow)) {
      return [eeo.gender || "Male", "Male", "Man"];
    }
    if (
      /veteran/i.test(combinedLow) &&
      !/^\s*(name|mm|dd|yyyy|month|day|year|date|employee\s*id)\s*\*?\s*$/i.test(pLow)
    ) {
      return [
        eeo.veteranStatus || "I am not a protected veteran",
        "I am not a veteran",
        "No"
      ];
    }
    if (
      /disability|disabled|handicap/i.test(combinedLow) &&
      !/^\s*(name|mm|dd|yyyy|month|day|year|date|employee\s*id)\s*\*?\s*$/i.test(pLow)
    ) {
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
      (/full\s*(legal\s*)?name|legal\s*name|^name\s*\*?$|_systemfield_name|\byour\s*name\b|applicant\s*name|candidate\s*name|signature/i.test(
        combinedLow
      )) &&
      !/company|school|employer|reference|pronounc/i.test(combinedLow)
    ) {
      return [p.fullName];
    }

    if (/e-?mail/i.test(combinedLow)) return [p.email];
    if (/phone\s*type|device\s*type/i.test(combinedLow)) return ["Mobile", "Cellular", "Cell", "Personal", "Home"];
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
    if (/street|address\s*line\s*1|addresssection_addressline1|address1|^address\s*\*?$/i.test(combinedLow)) {
      return [p.streetAddress || "39861 Potrero Dr"];
    }
    if ((/\bcity\b|\btown\b/i.test(combinedLow)) && !/\?|capacity|velocity|ethnicity/i.test(pLow)) {
      return [p.city];
    }
    // Check primary label for Country BEFORE countryRegion (Workday uses addressSection_countryRegion for State!)
    if ((/\bcountry\b|what\s+country\s+are\s+you\s+located/i.test(pLow)) && !/state|province|phone\s*code/i.test(pLow)) {
      return [p.country || "United States", "United States of America", "United States +1", "USA", "US"];
    }
    if ((/\bstate\b|\bprovince\b|countryregion/i.test(combinedLow)) && !/\?|united states|authorized|status|statement/i.test(pLow)) {
      return [p.state, p.stateCode];
    }
    if (/\bzip\b|postal\s*code|postalcode/i.test(combinedLow)) {
      return [p.postalCode];
    }
    if (/\bcountry\b|what\s+country\s+are\s+you\s+located/i.test(combinedLow)) {
      return [p.country || "United States", "United States +1", "United States of America", "USA", "US"];
    }

    // 5. Links, Current Employment, Experience & Education
    if (/linkedin/i.test(combinedLow)) return [p.linkedin, p.linkedinAlt];
    if (/github/i.test(combinedLow) && !/portfolio|website/i.test(pLow)) return p.github ? [p.github] : null;
    if (/portfolio|personal\s*website|^website\s*\*?$|\bwebsite\b|\bblog\b/i.test(combinedLow)) {
      return [p.portfolio || p.github || p.linkedin, p.github];
    }
    if (/github/i.test(combinedLow)) return [p.github || p.portfolio];

    if (/(current|most\s*recent|present|latest).*?(company|employer|organization)|^company\s*name|^employer\b|curr_company/i.test(combinedLow)) {
      return [exp0.company || p.currentCompany];
    }
    if (/(current|most\s*recent|more\s*recent|present|latest).*?(job\s*)?title|^job\s*title|^current\s*role/i.test(combinedLow)) {
      return [exp0.title || p.currentTitle];
    }
    if (/years?\s*of\s*.*experience|how\s*many\s*years|total\s*experience/i.test(combinedLow)) {
      const isDropdown = el?.tagName === "SELECT" || isComboboxInput(el);
      const isIntegerOnly =
        (el?.type === "number" && (!el.step || el.step === "1" || /^\d+$/.test(String(el.step)))) ||
        el?.pattern === "\\d+" ||
        /whole\s*number|integer/i.test(`${pLow} ${hLow}`);
      if (isDropdown) {
        return [
          p.yearsOfExperienceRange || "3-4 years",
          "3 - 4 years",
          "3-5 years",
          "3 - 5 years",
          "3+ years",
          "3.5",
          "3",
          "2-4 years",
          "2-5 years"
        ];
      }
      if (isIntegerOnly) {
        return [p.yearsOfExperienceInt || "3", "3"];
      }
      return [p.yearsOfExperience || "3.5", p.yearsOfExperienceInt || "3", p.yearsOfExperienceRange || "3-4 years"];
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

  function resolveDesiredValueForLabel(labelRaw, profile, jobMeta = null) {
    const res = resolveDesiredValueForField(labelRaw, profile, null, jobMeta);
    if (!res || res.skip) return null;
    return res;
  }

  function hasComboboxSelection(comboEl) {
    const wdMulti = comboEl.closest("[data-automation-id='multiSelectContainer'], [data-automation-id*='formField']");
    if (wdMulti?.querySelector("[data-automation-id='selectedItem']")) return true;

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
      if (txt && !/^select\b|^please\s+select\b|^choose\b|^none$|^--/i.test(txt)) return true;
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
        if (comboEl.dataset?.automationId === "searchBox" || comboEl.closest?.("[data-automation-id='multiSelectContainer']")) {
          comboEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
          comboEl.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        }
        await sleep(260);
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
      // Step 3: Async autocomplete combobox (Greenhouse candidate-location, Ashby Location, Workday searchBox/city)
      typeIntoAutocompleteInput(comboEl, desiredCandidates[0]);
      if (comboEl.dataset?.automationId === "searchBox" || comboEl.closest?.("[data-automation-id='multiSelectContainer']")) {
        comboEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        comboEl.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      }
      for (let attempt = 0; attempt < 12; attempt++) {
        await sleep(160);
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

  // Ashby & React custom Yes/No pill buttons (<button class="... yesno / _option_">)
  function fillAshbyYesNoGroups(profile, jobMeta = null) {
    let filled = 0;
    const entries = new Set(
      Array.from(document.querySelectorAll("button[class*='yesno'], button[class*='_option_']"))
        .map((b) =>
          b.closest(".ashby-application-form-field-entry, [class*='fieldEntry'], .field, fieldset, [role='group']")
        )
        .filter(Boolean)
    );
    entries.forEach((entry) => {
      const buttons = Array.from(entry.querySelectorAll("button[class*='yesno'], button[class*='_option_']")).filter(
        (b) => /^(yes|no)$/i.test((b.innerText || "").trim())
      );
      if (buttons.length < 2) return;
      if (
        buttons.some(
          (b) =>
            String(b.className).includes("_active_") ||
            b.classList?.contains("active") ||
            b.getAttribute("aria-pressed") === "true"
        )
      ) {
        return;
      }
      const lblEl = entry.querySelector("label, legend, .ashby-application-form-question-title");
      const primaryLabel = (lblEl?.innerText || "").trim();
      if (!primaryLabel) return;
      const desired = resolveDesiredValueForField(
        { primaryLabel, helperText: "", fullLabel: primaryLabel },
        profile,
        null,
        jobMeta
      );
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

  function isElementVisible(el) {
    if (!el) return false;
    if (isInHiddenAncestor(el)) return false;
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Detect SSO-vs-Email auth gate (e.g. Workday [data-automation-id="SignInWithEmailButton"], SmartRecruiters "Continue with email")
  function findEmailAuthChoiceButton(doc = document) {
    const candidates = Array.from(
      doc.querySelectorAll(
        "[data-automation-id='SignInWithEmailButton'], [data-jobify-signin-email], button, a[role='button'], [role='button']"
      )
    ).filter((el) => !el.disabled && isElementVisible(el) && !isHeaderOrNavButton(el));

    return (
      candidates.find((el) => {
        if (el.dataset?.automationId === "SignInWithEmailButton" || el.hasAttribute("data-jobify-signin-email")) {
          return true;
        }
        const txt = (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim();
        return /^(sign\s*(in|up)\s*with\s*email|continue\s*with\s*email|use\s*(my\s*)?email(\s*address)?|log\s*in\s*with\s*email)$/i.test(
          txt
        );
      }) || null
    );
  }

  // Detect Email-First 2-Step Auth Screen (Email -> Continue -> Password, used on iCIMS, Eightfold, SuccessFactors)
  function detectEmailFirstAuthStep(doc = document) {
    const pwVisible = Array.from(doc.querySelectorAll("input[type='password']")).filter(isVisibleAndEditable);
    if (pwVisible.length > 0) return null;
    if (Array.from(doc.querySelectorAll("input[type='file']")).some(isActionableFileInput)) return null;

    const allEditable = Array.from(doc.querySelectorAll("input, select, textarea")).filter(isVisibleAndEditable);
    if (allEditable.length === 0 || allEditable.length > 2) return null;

    const emailInput = allEditable.find((el) => {
      const sig = `${el.type || ""} ${el.name || ""} ${el.id || ""} ${el.autocomplete || ""} ${el.dataset?.automationId || ""}`;
      return /email|username/i.test(sig) && !isComboboxInput(el);
    });
    if (!emailInput) return null;

    const headingsText = Array.from(doc.querySelectorAll("h1, h2, h3, [id*='auth' i], [class*='login' i], [class*='signin' i]"))
      .filter(isElementVisible)
      .map((h) => (h.innerText || "").trim())
      .join(" ");
    if (!/sign\s*in|log\s*in|create\s*account|candidate\s*login|enter\s*your\s*email|welcome\s*back/i.test(headingsText)) {
      return null;
    }

    const continueBtn = Array.from(doc.querySelectorAll("button[type='submit'], input[type='submit'], button"))
      .filter((b) => !b.disabled && isElementVisible(b) && !isHeaderOrNavButton(b))
      .find((b) => {
        const t = (b.innerText || b.value || "").replace(/\s+/g, " ").trim();
        return /^(continue|next|sign\s*in|log\s*in|proceed)$/i.test(t) && !/with\s+(google|linkedin|apple|microsoft)/i.test(t);
      });

    return continueBtn ? { emailInput, continueBtn } : null;
  }

  // Detect "Verify your email address / Click activation link in email" banner (e.g. Workday post-signup email verification)
  function detectEmailVerificationBanner(doc = document) {
    if (detectOtpChallenge(doc).detected) return false;
    const containers = Array.from(
      doc.querySelectorAll(
        "[data-automation-id='signInContent'], [data-automation-id='errorMessage'], [data-jobify-verify-email-banner], [role='alert'], main, .card"
      )
    ).filter(isElementVisible);
    for (const c of containers) {
      if (c.hasAttribute("data-jobify-verify-email-banner")) return true;
      const t = (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 900);
      if (
        /verify\s+your\s+(email|account)|verification\s+(email|link)\s+(has\s+been\s+|was\s+)?sent|check\s+your\s+email\s+to\s+(verify|activate|complete)|click\s+the\s+link\s+in\s+the\s+email|account\s+has\s+not\s+been\s+(verified|activated)/i.test(
          t
        )
      ) {
        return true;
      }
    }
    return false;
  }

  // Sharp Portal Login / Account Creation + Verify Password + Workday Consent Filler
  async function autofillPortalAuth(credentials) {
    if (!credentials?.portalEmail || !credentials?.portalPassword) {
      return { filled: 0, passwordFieldsFilled: 0 };
    }
    let filled = 0;
    let passwordFieldsFilled = 0;

    const emailInputs = Array.from(
      document.querySelectorAll(
        "input[type='email'], input[autocomplete='email'], input[autocomplete='username'], input[name*='email' i], input[name*='username' i], input[name*='user' i], input[data-automation-id*='email' i]"
      )
    ).filter((el) => isVisibleAndEditable(el) && !isComboboxInput(el));

    for (const em of emailInputs) {
      if (setNativeValue(em, credentials.portalEmail)) filled++;
    }

    // Fill primary password + any Verify / Confirm / Repeat Password inputs
    const pwInputs = Array.from(
      document.querySelectorAll(
        "input[type='password'], input[data-automation-id*='password' i], input[name*='verify_password' i], input[name*='confirm_password' i], input[id*='verifyPassword' i], input[id*='confirmPassword' i]"
      )
    ).filter(isVisibleAndEditable);

    for (const pw of pwInputs) {
      if (setNativeValue(pw, credentials.portalPassword)) {
        filled++;
        passwordFieldsFilled++;
      }
    }

    // Workday "Read More" expand button on Create Account terms (unlocks checkbox on strict tenants)
    const expandBtn = document.querySelector("[data-automation-id='createAccountExpandButton']");
    if (expandBtn && isElementVisible(expandBtn) && passwordFieldsFilled >= 2) {
      const txt = (expandBtn.innerText || "").trim();
      if (/read\s*more|expand/i.test(txt)) {
        dispatchRealClick(expandBtn);
        await sleep(120);
      }
    }

    const checkboxes = Array.from(
      document.querySelectorAll(
        "input[type='checkbox'][data-automation-id*='createAccount' i], input[type='checkbox'][name*='terms' i], input[type='checkbox'][name*='agree' i], input[type='checkbox'][name*='consent' i], input[type='checkbox'][data-jobify-auth-consent]"
      )
    ).filter((cb) => !cb.disabled && !isInHiddenAncestor(cb));

    for (const cb of checkboxes) {
      const ctx = getFieldContext(cb);
      if (
        !cb.checked &&
        (cb.hasAttribute("data-jobify-auth-consent") ||
          cb.dataset?.automationId === "createAccountCheckbox" ||
          /agree|terms|privacy|create|consent|accept/i.test(`${ctx.fullLabel} ${cb.dataset?.automationId || ""}`))
      ) {
        dispatchRealClick(cb);
        if (!cb.checked && cb.id) {
          const assocLbl = document.querySelector(`label[for="${CSS.escape(cb.id)}"]`);
          if (assocLbl) dispatchRealClick(assocLbl);
        }
        if (cb.checked || cb.getAttribute("aria-checked") === "true") {
          filled++;
        }
      }
    }

    return { filled, passwordFieldsFilled };
  }

  function findAuthSubmitButton(preferCreateAccount = false) {
    // 1. Workday click_filter overlay sits on top of signInSubmitButton / createAccountSubmitButton with opacity: 0!
    const wdClickFilters = Array.from(
      document.querySelectorAll(
        "[data-automation-id='signInContent'] [data-automation-id='click_filter'], [data-automation-id='noCaptchaWrapper'] [data-automation-id='click_filter'], form [data-automation-id='click_filter'], [data-jobify-click-filter='true']"
      )
    ).filter((cf) => {
      if (isInHiddenAncestor(cf)) return false;
      const cs = window.getComputedStyle(cf);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const r = cf.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (wdClickFilters.length > 0) {
      const preferredCf = wdClickFilters.find((cf) => {
        const aria = (cf.getAttribute("aria-label") || "").toLowerCase();
        const sibBtn = cf.parentElement?.querySelector("button[data-automation-id]");
        const sibId = (sibBtn?.dataset?.automationId || "").toLowerCase();
        return preferCreateAccount
          ? aria.includes("create") || sibId.includes("createaccount")
          : aria.includes("submit") || aria.includes("sign in") || sibId.includes("signin");
      });
      return preferredCf || wdClickFilters[0];
    }

    // 2. Standard Auth Submit Buttons (excluding top-navbar Sign In traps & switch links!)
    const candidates = Array.from(
      document.querySelectorAll(
        "[data-jobify-auth-submit], [data-automation-id*='createAccountSubmit' i], [data-automation-id*='signInSubmit' i], button[type='submit'], input[type='submit'], button"
      )
    ).filter((b) => {
      if (b.disabled || !isElementVisible(b)) return false;
      if (isHeaderOrNavButton(b)) return false;
      const autoId = b.dataset?.automationId || "";
      if (/^(createAccountLink|signInLink|forgotPasswordLink|createAccountExpandButton)$/i.test(autoId)) return false;
      if (b.hasAttribute("data-jobify-switch-signup") || b.hasAttribute("data-jobify-switch-signin")) return false;
      const txt = (b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      if (/with\s+(google|apple|linkedin|microsoft|facebook|sso|github)/i.test(txt)) return false;
      return true;
    });

    const pattern = preferCreateAccount
      ? /^(create\s*(an?\s*)?account|sign\s*up|register|continue|verify|next)$/i
      : /^(sign\s*in|log\s*in|submit|continue|next)$/i;

    for (const b of candidates) {
      const txt = (b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      const autoId = b.dataset?.automationId || "";
      if (
        b.hasAttribute("data-jobify-auth-submit") ||
        (preferCreateAccount && /createAccountSubmit/i.test(autoId)) ||
        (!preferCreateAccount && /signInSubmit/i.test(autoId)) ||
        pattern.test(txt)
      ) {
        return b;
      }
    }
    return null;
  }

  function findCreateAccountSwitchLink() {
    const els = Array.from(
      document.querySelectorAll(
        "[data-automation-id='createAccountLink'], [data-jobify-switch-signup], button, a, [role='button'], [role='tab']"
      )
    ).filter((el) => isElementVisible(el) && !isHeaderOrNavButton(el) && !el.hasAttribute("data-jobify-auth-submit"));
    return (
      els.find((el) => {
        if (el.dataset?.automationId === "createAccountLink" || el.hasAttribute("data-jobify-switch-signup")) return true;
        const txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        return /^(create\s*(an?\s*)?account|sign\s*up|register|new\s*user\??|don'?t\s*have\s*an\s*account)/i.test(txt);
      }) || null
    );
  }

  function findSignInSwitchLink() {
    const els = Array.from(
      document.querySelectorAll(
        "[data-automation-id='signInLink'], [data-jobify-switch-signin], button, a, [role='button'], [role='tab']"
      )
    ).filter((el) => isElementVisible(el) && !isHeaderOrNavButton(el) && !el.hasAttribute("data-jobify-auth-submit"));
    return (
      els.find((el) => {
        if (el.dataset?.automationId === "signInLink" || el.hasAttribute("data-jobify-switch-signin")) return true;
        const txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        return /^(sign\s*in|log\s*in|already\s*have\s*an?\s*account\??)$/i.test(txt);
      }) || null
    );
  }

  function hasVisibleAuthError() {
    const errEls = Array.from(
      document.querySelectorAll(
        "[data-automation-id='errorMessage'], [role='alert'], .error, .error-message, [class*='error' i], [data-jobify-auth-error]"
      )
    ).filter(isElementVisible);
    for (const el of errEls) {
      const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (
        /invalid|incorrect|wrong|not\s*found|no\s*account|doesn'?t\s*exist|unable\s*to\s*(sign\s*in|create)|unrecognized|already\s*(exists|registered|in\s*use)|duplicate\s*account|locked/i.test(
          t
        )
      ) {
        return t;
      }
    }
    return "";
  }

  async function waitForAuthStateTransition(prevPwCount, maxWaitMs = 3600) {
    const loops = Math.ceil(maxWaitMs / 300);
    for (let i = 0; i < loops; i++) {
      await sleep(300);
      const pwNow = Array.from(document.querySelectorAll("input[type='password']")).filter(isVisibleAndEditable);
      if (pwNow.length !== prevPwCount) {
        return { pwCount: pwNow.length, err: hasVisibleAuthError(), verifyBanner: detectEmailVerificationBanner(document) };
      }
      const err = hasVisibleAuthError();
      if (err) return { pwCount: pwNow.length, err };
      if (detectEmailVerificationBanner(document)) return { pwCount: pwNow.length, err: "", verifyBanner: true };
      if (detectOtpChallenge(document).detected) return { pwCount: pwNow.length, err: "", otp: true };
    }
    const pwFinal = Array.from(document.querySelectorAll("input[type='password']")).filter(isVisibleAndEditable);
    return { pwCount: pwFinal.length, err: hasVisibleAuthError(), verifyBanner: detectEmailVerificationBanner(document) };
  }

  // Autonomous Multi-Stage Auth Executor:
  // Handles "Sign in with email" -> Email-First -> Sign In <-> Create Account (+ Verify Password + Consent) -> Post-Signup Sign In!
  async function performAutonomousAuth(credentials, authHistory = {}) {
    let totalFilled = 0;
    let createdAccount = Boolean(authHistory?.createdAccount);
    let triedSignIn = Boolean(authHistory?.triedSignIn);

    // Stage 0: Click "Sign in with email" (Workday SignInWithEmailButton / SSO choice gate) if present
    const emailGateBtn = findEmailAuthChoiceButton(document);
    if (emailGateBtn) {
      dispatchRealClick(emailGateBtn);
      for (let i = 0; i < 12; i++) {
        await sleep(300);
        const mounted =
          Array.from(document.querySelectorAll("input[type='password'], input[data-automation-id*='email' i], input[type='email']")).some(
            isVisibleAndEditable
          );
        if (mounted) break;
      }
    }

    let pwVisible = Array.from(document.querySelectorAll("input[type='password']")).filter(isVisibleAndEditable);

    // Stage 0b: Two-step Email-First Login (Email -> Continue -> Password)
    if (pwVisible.length === 0) {
      const emailFirst = detectEmailFirstAuthStep(document);
      if (emailFirst && credentials?.portalEmail) {
        if (setNativeValue(emailFirst.emailInput, credentials.portalEmail)) totalFilled++;
        await sleep(120);
        dispatchRealClick(emailFirst.continueBtn);
        for (let i = 0; i < 10; i++) {
          await sleep(300);
          pwVisible = Array.from(document.querySelectorAll("input[type='password']")).filter(isVisibleAndEditable);
          if (pwVisible.length > 0) break;
        }
        if (pwVisible.length === 0) {
          return {
            handled: true,
            filled: totalFilled,
            submittedAuthForm: true,
            mode: "email_first",
            createdAccount,
            triedSignIn
          };
        }
      } else {
        return {
          handled: Boolean(emailGateBtn),
          filled: totalFilled,
          clickedEmailGate: Boolean(emailGateBtn),
          createdAccount,
          triedSignIn,
          needsEmailVerification: detectEmailVerificationBanner(document)
        };
      }
    }

    // Guard: If full application form is simultaneously inline below password fields, only fill without clicking standalone auth submit
    const nonAuthInputs = Array.from(document.querySelectorAll("input[type='file'], select, textarea")).filter((el) =>
      el.type === "file" ? isActionableFileInput(el) : isVisibleAndEditable(el)
    );
    if (nonAuthInputs.length > 2 && !document.querySelector("[data-jobify-auth-step-only='true']")) {
      const inlineFill = await autofillPortalAuth(credentials);
      return {
        handled: true,
        filled: totalFilled + inlineFill.filled,
        submittedAuthForm: false,
        mode: inlineFill.passwordFieldsFilled >= 2 ? "create_inline" : "signin_inline",
        createdAccount,
        triedSignIn
      };
    }

    // Pre-switch check:
    // - If we are on Create Account (2 passwords) AFTER already creating the account -> switch to Sign In!
    // - If we are on Sign In (1 password) with a pre-existing error and haven't created an account -> switch to Create Account!
    const preErr = hasVisibleAuthError();
    if (pwVisible.length >= 2 && createdAccount) {
      const toSignIn = findSignInSwitchLink();
      if (toSignIn) {
        dispatchRealClick(toSignIn);
        await sleep(800);
        pwVisible = Array.from(document.querySelectorAll("input[type='password']")).filter(isVisibleAndEditable);
      }
    } else if (pwVisible.length === 1 && preErr && !createdAccount) {
      const toCreate = findCreateAccountSwitchLink();
      if (toCreate) {
        dispatchRealClick(toCreate);
        await sleep(800);
        pwVisible = Array.from(document.querySelectorAll("input[type='password']")).filter(isVisibleAndEditable);
      }
    }

    // Fill active auth form (Sign In or Create Account)
    const fillRes = await autofillPortalAuth(credentials);
    totalFilled += fillRes.filled;
    const isCreateMode = fillRes.passwordFieldsFilled >= 2;
    if (isCreateMode) createdAccount = true;
    else triedSignIn = true;

    const authBtn = findAuthSubmitButton(isCreateMode);
    if (!authBtn) {
      return { handled: true, filled: totalFilled, submittedAuthForm: false, createdAccount, triedSignIn };
    }

    dispatchRealClick(authBtn);
    const afterFirst = await waitForAuthStateTransition(fillRes.passwordFieldsFilled, 3600);

    // Case 1: Logged straight into the application form or OTP challenge!
    if (afterFirst.pwCount === 0 || afterFirst.otp) {
      return {
        handled: true,
        filled: totalFilled,
        submittedAuthForm: true,
        mode: isCreateMode ? "create_account_complete" : "sign_in_complete",
        createdAccount,
        triedSignIn,
        needsEmailVerification: Boolean(afterFirst.verifyBanner) || detectEmailVerificationBanner(document)
      };
    }

    // Case 2: Started on Create Account (Step 1) -> Workday/ATS transitioned to Sign In (Step 2) OR reported "account already exists"!
    if (isCreateMode) {
      if (afterFirst.pwCount === 1 && !afterFirst.err) {
        if (afterFirst.verifyBanner || detectEmailVerificationBanner(document)) {
          return {
            handled: true,
            filled: totalFilled,
            submittedAuthForm: true,
            mode: "create_awaiting_email_verify",
            createdAccount: true,
            triedSignIn: false,
            needsEmailVerification: true
          };
        }
        // Step 1 (Create Account) succeeded and opened Step 2 (Sign In) — immediately Sign In!
        await sleep(350);
        const loginFill = await autofillPortalAuth(credentials);
        totalFilled += loginFill.filled;
        triedSignIn = true;
        const loginBtn = findAuthSubmitButton(false);
        if (loginBtn) {
          dispatchRealClick(loginBtn);
          await waitForAuthStateTransition(1, 3400);
        }
        return {
          handled: true,
          filled: totalFilled,
          submittedAuthForm: true,
          mode: "create_then_signin",
          createdAccount: true,
          triedSignIn: true,
          needsEmailVerification: detectEmailVerificationBanner(document)
        };
      }

      if (afterFirst.err) {
        // Account already exists on this tenant -> switch from Create Account to Sign In and log in!
        const signInSwitch = findSignInSwitchLink();
        if (signInSwitch) {
          dispatchRealClick(signInSwitch);
          await sleep(850);
          const loginFill = await autofillPortalAuth(credentials);
          totalFilled += loginFill.filled;
          triedSignIn = true;
          const loginBtn = findAuthSubmitButton(false);
          if (loginBtn) {
            dispatchRealClick(loginBtn);
            await waitForAuthStateTransition(1, 3400);
          }
          return {
            handled: true,
            filled: totalFilled,
            submittedAuthForm: true,
            switchedToSignIn: true,
            createdAccount: true,
            triedSignIn: true,
            needsEmailVerification: detectEmailVerificationBanner(document)
          };
        }
      }
    }

    // Case 3: Started on Sign In -> returned "wrong email or password / no account" -> switch to Create Account (+ Verify Password) -> and if needed Sign In!
    if (!isCreateMode && afterFirst.err && !authHistory?.createdAccount) {
      const switchBtn = findCreateAccountSwitchLink();
      if (switchBtn) {
        dispatchRealClick(switchBtn);
        for (let i = 0; i < 8; i++) {
          await sleep(250);
          const pws = Array.from(document.querySelectorAll("input[type='password']")).filter(isVisibleAndEditable);
          if (pws.length >= 2) break;
        }
        const signupRes = await autofillPortalAuth(credentials);
        totalFilled += signupRes.filled;
        createdAccount = true;
        const createBtn = findAuthSubmitButton(true);
        if (createBtn) {
          dispatchRealClick(createBtn);
          const afterSignup = await waitForAuthStateTransition(signupRes.passwordFieldsFilled, 3600);
          // If creating the account immediately landed back on 1-password Sign In (and no email-verify gate is blocking yet), log right in!
          if (afterSignup.pwCount === 1 && !afterSignup.err && !(afterSignup.verifyBanner || detectEmailVerificationBanner(document))) {
            await sleep(350);
            const postLogin = await autofillPortalAuth(credentials);
            totalFilled += postLogin.filled;
            const postLoginBtn = findAuthSubmitButton(false);
            if (postLoginBtn) {
              dispatchRealClick(postLoginBtn);
              await waitForAuthStateTransition(1, 3400);
            }
          }
        }
        return {
          handled: true,
          filled: totalFilled,
          submittedAuthForm: true,
          switchedToCreateAccount: true,
          createdAccount: true,
          triedSignIn: true,
          needsEmailVerification: detectEmailVerificationBanner(document)
        };
      }
    }

    return {
      handled: true,
      filled: totalFilled,
      submittedAuthForm: true,
      mode: isCreateMode ? "create_account" : "sign_in",
      createdAccount,
      triedSignIn,
      needsEmailVerification: detectEmailVerificationBanner(document)
    };
  }

  // Detect Email OTP / Security Code Challenge (Single input OR 4-8 split character boxes like Greenhouse Remix)
  function detectOtpChallenge(doc = document) {
    // 1. Check split single-char OTP boxes (4 to 8 visible inputs with maxLength=1)
    const singleCharInputs = Array.from(doc.querySelectorAll("input")).filter((inp) => {
      if (!isVisibleAndEditable(inp)) return false;
      if (inp.type === "checkbox" || inp.type === "radio" || inp.type === "file" || inp.type === "password") return false;
      const ml = inp.getAttribute("maxlength");
      return ml === "1" || inp.dataset?.otpBox === "true";
    });

    if (singleCharInputs.length >= 4 && singleCharInputs.length <= 8) {
      const container =
        singleCharInputs[0].closest("form, fieldset, [role='dialog'], .card, section, div")?.parentElement || doc.body;
      const nearbyText = (container?.innerText || "").replace(/\s+/g, " ").slice(0, 600);
      if (/code|verify|verification|security|passcode|otp|email/i.test(nearbyText)) {
        return {
          detected: true,
          mode: "split",
          boxCount: singleCharInputs.length,
          promptText: nearbyText.slice(0, 220)
        };
      }
    }

    // 2. Check single OTP / Verification Code input
    const textInputs = Array.from(
      doc.querySelectorAll("input[type='text'], input[type='number'], input[type='tel'], input:not([type])")
    ).filter((inp) => isVisibleAndEditable(inp) && !isComboboxInput(inp));

    for (const inp of textInputs) {
      const ctx = getFieldContext(inp);
      const sig = `${ctx.fullLabel} ${inp.placeholder || ""} ${inp.autocomplete || ""}`.toLowerCase();
      if (/zip|postal|area\s*code|country\s*code|phone|referral\s*code|promo/i.test(sig)) continue;
      if (
        inp.autocomplete === "one-time-code" ||
        inp.hasAttribute("data-jobify-otp") ||
        /\botp\b|verification\s*code|security\s*code|one[- ]?time\s*(passcode|code)|enter\s*(the\s*)?(\d[- ]*digit|\d[- ]*character)?\s*code|passcode\s*sent/i.test(
          sig
        )
      ) {
        return {
          detected: true,
          mode: "single",
          boxCount: 1,
          promptText: ctx.primaryLabel || "Verification Code"
        };
      }
    }

    return { detected: false };
  }

  async function fillOtpChallengeAndSubmit(otpCode) {
    const clean = String(otpCode || "").trim();
    if (!clean) return { filled: false };

    const challenge = detectOtpChallenge(document);
    if (!challenge.detected) return { filled: false };

    if (challenge.mode === "split") {
      const boxes = Array.from(document.querySelectorAll("input")).filter((inp) => {
        if (!isVisibleAndEditable(inp)) return false;
        return inp.getAttribute("maxlength") === "1" || inp.dataset?.otpBox === "true";
      });
      for (let i = 0; i < boxes.length && i < clean.length; i++) {
        const ch = clean[i];
        setNativeValue(boxes[i], ch);
        boxes[i].dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
        boxes[i].dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
        await sleep(35);
      }
    } else {
      const textInputs = Array.from(
        document.querySelectorAll("input[type='text'], input[type='number'], input[type='tel'], input:not([type])")
      ).filter((inp) => isVisibleAndEditable(inp) && !isComboboxInput(inp));
      const target = textInputs.find((inp) => {
        const ctx = getFieldContext(inp);
        const sig = `${ctx.fullLabel} ${inp.placeholder || ""} ${inp.autocomplete || ""}`.toLowerCase();
        if (/zip|postal|area\s*code|country\s*code|phone/i.test(sig)) return false;
        return (
          inp.autocomplete === "one-time-code" ||
          inp.hasAttribute("data-jobify-otp") ||
          /\botp\b|verification\s*code|security\s*code|one[- ]?time|enter.*code|passcode/i.test(sig)
        );
      });
      if (!target) return { filled: false };
      setNativeValue(target, clean);
    }

    await sleep(150);
    const verifyBtns = Array.from(
      document.querySelectorAll("[data-jobify-otp-submit], button[type='submit'], input[type='submit'], button")
    ).filter((b) => !b.disabled && isElementVisible(b));

    const verifyBtn = verifyBtns.find((b) => {
      const t = (b.innerText || b.value || "").replace(/\s+/g, " ").trim();
      return (
        b.hasAttribute("data-jobify-otp-submit") ||
        /^(verify(\s*code|\s*&\s*continue|\s*email)?|confirm(\s*code)?|submit(\s*application|\s*code)?|continue)$/i.test(t)
      );
    });

    if (verifyBtn) {
      dispatchRealClick(verifyBtn);
      return { filled: true, clickedVerify: true };
    }
    return { filled: true, clickedVerify: false };
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

  function isOptionalUnneededExtraField(el, ctx, required) {
    if (required) return false;
    const pLow = (ctx?.primaryLabel || "").toLowerCase();
    // Skip optional "Additional information", "Anything else?", "Optional notes" so we never add unrequested fluff
    if (
      /additional\s*(information|comments|notes|context)|anything\s*else|other\s*information|is\s*there\s*anything\s*else|optional\s*note/i.test(
        pLow
      )
    ) {
      return true;
    }
    return false;
  }

  const CONSENT_CHECKBOX_REGEX =
    /privacy|consent|acknowledge|i\s*agree|agree\s*to|terms|certify|accurate|true\s*and\s*(complete|correct)|gdpr|data_consent|confirm\s*(that\s*)?(i\s*have\s*read|the\s*above|my\s*understanding|all\s*information)|read\s*and\s*underst(ood|and)|arbitrat|authorize|background\s*check|electronic\s*signature/i;
  const NEGATIVE_CHECKBOX_REGEX = /do\s*not\s*(contact|sell|share)|opt[- ]?out|unsubscribe/i;

  function resolveCheckboxGroup(el, doc = document) {
    if (!el || el.type !== "checkbox") return null;
    if (el.name && el.name.endsWith("[]")) {
      const checkboxes = Array.from(
        doc.querySelectorAll(`input[type='checkbox'][name="${CSS.escape(el.name)}"]`)
      ).filter((cb) => !isTrapOrSystemInput(cb) && !cb.disabled);
      const container = el.closest("fieldset, .ashby-application-form-field-entry, [class*='fieldEntry'], .checkbox, .field, .form-group") || el;
      return {
        groupKey: `name:${el.name}`,
        checkboxes,
        groupCtx: getFieldContext(container)
      };
    }
    if (el.id && el.id.includes("[]-labeled-checkbox-")) {
      const prefix = el.id.split("[]-labeled-checkbox-")[0];
      const checkboxes = Array.from(
        doc.querySelectorAll(`input[type='checkbox'][id^="${CSS.escape(prefix)}[]-labeled-checkbox-"]`)
      ).filter((cb) => !isTrapOrSystemInput(cb) && !cb.disabled);
      const container = el.closest(".ashby-application-form-field-entry, [class*='fieldEntry'], fieldset, .field") || el;
      return {
        groupKey: `ashby:${prefix}`,
        checkboxes,
        groupCtx: getFieldContext(container)
      };
    }
    const groupContainer = el.closest(
      "fieldset, .ashby-application-form-field-entry, [class*='fieldEntry'], [data-automation-id*='formField'], .checkbox-group"
    );
    if (groupContainer) {
      const checkboxes = Array.from(groupContainer.querySelectorAll("input[type='checkbox']")).filter(
        (cb) => isVisibleAndEditable(cb)
      );
      if (checkboxes.length >= 2) {
        const ctx = getFieldContext(groupContainer);
        return {
          groupKey: `container:${ctx.primaryLabel || checkboxes[0].id || checkboxes[0].name}`,
          checkboxes,
          groupCtx: ctx
        };
      }
    }
    return null;
  }

  async function askAiToPickOption(label, optionLabels, jobMeta) {
    const cleanOptions = (optionLabels || []).map((o) => String(o || "").trim()).filter(Boolean).slice(0, 24);
    if (!label || cleanOptions.length === 0) return null;
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.id) {
        const resp = await Promise.race([
          chrome.runtime.sendMessage({
            type: "ANSWER_APPLICATION_QUESTION",
            payload: {
              questionCtx: {
                label,
                fieldType: "select",
                options: cleanOptions
              },
              jobMeta,
              saveToVault: false
            }
          }),
          sleep(8000).then(() => null)
        ]);
        if (resp?.ok && resp.answer) {
          return [resp.answer];
        }
      }
    } catch (_) {}
    return null;
  }

  function findOpenEndedFields(profile = { personal: {}, workAuthAndEEO: {} }, jobMeta = null, options = {}) {
    const skipOptionalExtras = options.skipOptionalExtras !== false;
    const includeAllUnresolved = Boolean(options.includeAllUnresolved);
    const results = [];
    const candidates = Array.from(
      document.querySelectorAll("textarea, input[type='text'], input[type='url'], input:not([type])")
    );
    for (const el of candidates) {
      if (!isVisibleAndEditable(el)) continue;
      if (isComboboxInput(el)) continue;
      if (el.id === "resume_text" || el.id === "cover_letter_text") continue;
      if (
        el.getAttribute("maxlength") === "1" ||
        el.dataset?.otpBox === "true" ||
        el.hasAttribute("data-jobify-otp") ||
        el.autocomplete === "one-time-code"
      ) {
        continue;
      }
      if (
        el.closest(
          "[data-jobify-exp-index], [data-jobify-edu-index], [data-automation-id^='workExperience-'], [data-automation-id^='education-'], .select-shell, .select__control"
        )
      ) {
        continue;
      }

      const ctx = getFieldContext(el);
      if (!ctx.primaryLabel) continue;
      if (/cover\s*letter/i.test(ctx.primaryLabel)) continue;
      const stdMatch = resolveDesiredValueForField(ctx, profile, el, jobMeta);
      if (stdMatch) continue; // Either matched by standard rule OR marked { skip: true }

      const required = isFieldRequired(el, ctx);
      const hasErrorState =
        el.getAttribute("aria-invalid") === "true" ||
        Boolean(getControlValidationErrorText(el, null, true)) ||
        Array.from(
          el
            .closest(
              ".field, .form-group, .application-question, .ashby-application-form-field-entry, [class*='fieldEntry'], [data-automation-id*='formField']"
            )
            ?.querySelectorAll(".field-error, [class*='error' i], [data-automation-id='errorMessage'], [id$='-error']") || []
        ).some((n) => isElementVisible(n) && (n.innerText || n.textContent || "").trim().length > 0);

      if (!hasErrorState && skipOptionalExtras && isOptionalUnneededExtraField(el, ctx, required)) {
        continue;
      }

      // Every required or errored text input that wasn't matched deterministically MUST be answered so nothing blocks Submit!
      const isQuestionInput =
        required ||
        hasErrorState ||
        includeAllUnresolved ||
        el.tagName === "TEXTAREA" ||
        /\?|why\b|describe\b|tell\s+us|explain|elaborate|example|evidence|exceptional|achievement|what\s+(interests|excites|are\s+the\s+most|motivated|draws)|how\s+do\s+you|proud\s+of|core\s+technical\s+stack|summary|motivation/i.test(
          ctx.primaryLabel
        );
      if (isQuestionInput) {
        if (options.onlyRequiredOpenEnded && !required && !hasErrorState) continue;
        results.push({
          element: el,
          label: ctx.primaryLabel.split("|")[0].trim() || ctx.primaryLabel.slice(0, 140),
          fullLabel: ctx.fullLabel,
          fieldType: el.tagName.toLowerCase(),
          required: required || hasErrorState,
          maxLength: el.maxLength > 0 ? el.maxLength : null
        });
      }
    }
    return results;
  }

  function isCustomOptionSelected(el) {
    if (!el) return false;
    if (
      el.getAttribute("aria-checked") === "true" ||
      el.getAttribute("aria-pressed") === "true" ||
      el.getAttribute("aria-selected") === "true" ||
      el.getAttribute("data-state") === "checked" ||
      el.getAttribute("data-state") === "on" ||
      el.getAttribute("data-selected") === "true"
    ) {
      return true;
    }
    const cls = typeof el.className === "string" ? el.className : "";
    return /\b(active|selected|is-selected|checked)\b|_active_/i.test(cls);
  }

  function scanCustomInteractiveGroups(doc = document) {
    const ariaCheckboxes = Array.from(doc.querySelectorAll("[role='checkbox'], [role='switch']")).filter((el) => {
      if (el.tagName === "INPUT" || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
      if (isTrapOrSystemInput(el) || !isElementVisible(el)) return false;
      if (el.closest(COOKIE_CONSENT_SELECTOR) || el.closest("#jobify-copilot-host") || isHeaderOrNavButton(el)) return false;
      // Skip multi-select dropdown option items inside listboxes
      if (el.closest("[role='listbox'], [role='menu'], .select__menu")) return false;
      return true;
    });

    const ariaRadioGroups = [];
    const seenRadioContainers = new WeakSet();
    for (const rg of Array.from(doc.querySelectorAll("[role='radiogroup']"))) {
      if (!isElementVisible(rg) || rg.closest(COOKIE_CONSENT_SELECTOR) || rg.closest("#jobify-copilot-host")) continue;
      const radios = Array.from(rg.querySelectorAll("[role='radio']")).filter(
        (r) => r.tagName !== "INPUT" && isElementVisible(r) && !r.disabled && r.getAttribute("aria-disabled") !== "true"
      );
      if (radios.length < 2) continue;
      seenRadioContainers.add(rg);
      const wrap =
        rg.closest(
          ".ashby-application-form-field-entry, [class*='fieldEntry'], [data-automation-id*='formField'], [data-jobify-field], .field, .form-group, fieldset"
        ) || rg;
      const ctx = getFieldContext(rg);
      const lblEl = wrap.querySelector("label, legend, .ashby-application-form-question-title, [class*='question' i], [class*='label' i]");
      const label =
        (
          rg.getAttribute("aria-label") ||
          (rg.getAttribute("aria-labelledby") && doc.getElementById(rg.getAttribute("aria-labelledby"))?.innerText) ||
          lblEl?.innerText ||
          ctx.primaryLabel ||
          "Choice Question"
        )
          .replace(/\s+/g, " ")
          .trim();
      const required =
        rg.getAttribute("aria-required") === "true" ||
        hasCssRequiredMarker(wrap) ||
        (lblEl ? hasCssRequiredMarker(lblEl) || /\*/.test(lblEl.innerText || "") : false) ||
        /\*/.test(label);

      ariaRadioGroups.push({
        kind: "aria_radio_group",
        container: rg,
        ctx: { ...ctx, primaryLabel: label, fullLabel: `${label} ${ctx.fullLabel || ""}`.trim() },
        label,
        required,
        options: radios.map((r) => ({
          el: r,
          text: (r.innerText || r.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
          selected: isCustomOptionSelected(r)
        }))
      });
    }

    const buttonChoiceGroups = [];
    const candidateContainers = new Set(
      Array.from(
        doc.querySelectorAll(
          ".ashby-application-form-field-entry, [class*='fieldEntry'], [data-automation-id*='formField'], [data-jobify-field], [data-jobify-choice-group], .application-question, fieldset, [role='group'], .field, .form-group"
        )
      )
    );

    const UTILITY_BTN_RE =
      /^(submit|next|continue|save|back|previous|cancel|upload|attach|browse|remove|delete|clear|reset|add(\s|$)|sign\s*(in|up|out)|log\s*(in|out)|apply|autofill|show\s*(more|less)|read\s*more|toggle\s*flyout)/i;

    for (const entry of candidateContainers) {
      if (seenRadioContainers.has(entry) || entry.querySelector("[role='radiogroup']")) continue;
      if (!isElementVisible(entry) || entry.closest(COOKIE_CONSENT_SELECTOR) || entry.closest("#jobify-copilot-host")) continue;
      if (isHeaderOrNavButton(entry)) continue;

      const explicitAshbyBtns = Array.from(
        entry.querySelectorAll("button[class*='yesno'], button[class*='_option_'], button[data-choice-option]")
      ).filter((b) => isElementVisible(b) && !b.disabled);

      let choiceBtns = explicitAshbyBtns;
      if (choiceBtns.length < 2) {
        // Check for clean Yes/No or custom choice button groups (only if container doesn't hold text/select/file inputs)
        if (entry.querySelector("input:not([type='hidden']), select, textarea, [role='combobox']")) continue;
        const rawBtns = Array.from(entry.querySelectorAll("button:not([type='submit'])")).filter((b) => {
          if (!isElementVisible(b) || b.disabled || b.closest(".jb-inline-ai-wrap")) return false;
          const t = (b.innerText || "").replace(/\s+/g, " ").trim();
          if (!t || t.length > 42 || UTILITY_BTN_RE.test(t) || /jobify/i.test(t)) return false;
          return true;
        });
        const isYesNoPair =
          rawBtns.length === 2 &&
          rawBtns.every((b) => /^(yes|no|i\s+agree|i\s+do\s+not\s+agree|true|false)$/i.test((b.innerText || "").trim()));
        const isExplicitGroup =
          (entry.getAttribute("role") === "group" || entry.hasAttribute("data-jobify-choice-group")) &&
          rawBtns.length >= 2 &&
          rawBtns.length <= 6;
        if (isYesNoPair || isExplicitGroup) {
          choiceBtns = rawBtns;
        }
      }

      if (choiceBtns.length < 2) continue;

      const lblEl = entry.querySelector("label, legend, .ashby-application-form-question-title, [class*='question' i], [class*='label' i]");
      const label = (lblEl?.innerText || entry.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      if (!label) continue;
      const required =
        entry.getAttribute("aria-required") === "true" ||
        hasCssRequiredMarker(entry) ||
        (lblEl ? hasCssRequiredMarker(lblEl) || /\*/.test(lblEl.innerText || "") : false) ||
        /\*/.test(label);

      buttonChoiceGroups.push({
        kind: "button_group",
        container: entry,
        ctx: { primaryLabel: label, helperText: "", fullLabel: label },
        label,
        required,
        options: choiceBtns.map((b) => ({
          el: b,
          text: (b.innerText || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
          selected: isCustomOptionSelected(b)
        }))
      });
    }

    return { ariaCheckboxes, ariaRadioGroups, buttonChoiceGroups };
  }

  async function fillCustomInteractiveControls(
    profile,
    jobMeta = null,
    { forceOverwrite = false, fillOpenEndedWithAI = true, onlyNeededCleanMode = false } = {}
  ) {
    let filled = 0;
    const { ariaCheckboxes, ariaRadioGroups, buttonChoiceGroups } = scanCustomInteractiveGroups(document);

    // 1. Custom ARIA Checkboxes & Switches
    for (const cb of ariaCheckboxes) {
      if (!forceOverwrite && isCustomOptionSelected(cb)) continue;
      const ctx = getFieldContext(cb);
      const optTxt = `${getChoiceOptionLabel(cb)} ${ctx.fullLabel}`;
      const req = isFieldRequired(cb, ctx);
      if (!NEGATIVE_CHECKBOX_REGEX.test(optTxt) && (CONSENT_CHECKBOX_REGEX.test(optTxt) || req)) {
        dispatchRealClick(cb);
        highlightFilledElement(cb);
        filled++;
      }
    }

    // 2. Custom ARIA Radio Groups & Choice Button Groups
    for (const grp of [...ariaRadioGroups, ...buttonChoiceGroups]) {
      if (!forceOverwrite && grp.options.some((o) => o.selected)) continue;
      let desired = resolveDesiredValueForField(grp.ctx, profile, grp.container, jobMeta);
      if (desired?.skip) continue;
      if (!desired && (grp.required || !onlyNeededCleanMode) && fillOpenEndedWithAI) {
        desired = await askAiToPickOption(
          grp.label,
          grp.options.map((o) => o.text),
          jobMeta
        );
      }
      if (!desired || desired.skip) continue;
      const wrappers = grp.options.map((o) => ({ el: o.el, innerText: o.text }));
      const matchWrap = findMatchingOptionElement(wrappers, desired);
      if (matchWrap?.el) {
        dispatchRealClick(matchWrap.el);
        highlightFilledElement(matchWrap.el);
        filled++;
      }
    }

    return filled;
  }

  // Extract a complete structured manifest of all available fields on the current page BEFORE filling
  function extractFormFieldsInventory(profile = { personal: {}, workAuthAndEEO: {} }, jobMeta = null) {
    const meta = jobMeta || extractJobMetadata(document);
    const fields = [];
    let requiresCoverLetter = false;
    const seenRadioGroups = new Set();
    const seenCheckboxGroups = new Set();

    // Include custom ARIA checkboxes, ARIA radio groups, Ashby Yes/No & generic button choice groups
    const customGroups = scanCustomInteractiveGroups(document);
    for (const cb of customGroups.ariaCheckboxes) {
      const ctx = getFieldContext(cb);
      const lbl = (getChoiceOptionLabel(cb) || ctx.primaryLabel || "Consent Checkbox").slice(0, 90);
      const req = isFieldRequired(cb, ctx) || (CONSENT_CHECKBOX_REGEX.test(`${lbl} ${ctx.fullLabel}`) && !NEGATIVE_CHECKBOX_REGEX.test(lbl));
      fields.push({
        index: fields.length + 1,
        kind: "aria_checkbox",
        label: lbl,
        required: req,
        isCoverLetter: false,
        currentlyFilled: isCustomOptionSelected(cb)
      });
    }
    for (const grp of [...customGroups.ariaRadioGroups, ...customGroups.buttonChoiceGroups]) {
      fields.push({
        index: fields.length + 1,
        kind: grp.kind,
        label: grp.label,
        required: grp.required,
        isCoverLetter: false,
        currentlyFilled: grp.options.some((o) => o.selected)
      });
    }

    const allEls = Array.from(
      document.querySelectorAll("input, select, textarea, [role='combobox'], button[aria-haspopup='listbox']")
    );

    for (const el of allEls) {
      if (isTrapOrSystemInput(el) || el.disabled) continue;
      if (el.tagName !== "INPUT" && el.querySelector?.("input[role='combobox']")) continue;

      if (el.type === "file") {
        if (!isActionableFileInput(el)) continue;
        const ctx = getFieldContext(el);
        const lbl = (ctx.primaryLabel || ctx.fullLabel || "File Upload").split("|")[0].trim();
        const isCl = /cover\s*letter/i.test(ctx.fullLabel);
        const req = isFieldRequired(el, ctx);
        if (isCl && (req || meta.mentionsCoverLetter)) requiresCoverLetter = true;
        fields.push({
          index: fields.length + 1,
          kind: isCl ? "cover_letter_file" : "resume_file",
          label: lbl,
          required: req,
          isCoverLetter: isCl,
          currentlyFilled: Boolean(el.files && el.files.length > 0)
        });
        continue;
      }

      if (isComboboxInput(el)) {
        if (isInHiddenAncestor(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const ctx = getFieldContext(el);
        const req = isFieldRequired(el, ctx);
        fields.push({
          index: fields.length + 1,
          kind: "combobox",
          label: (ctx.primaryLabel || el.id || "Dropdown").split("|")[0].trim(),
          required: req,
          isCoverLetter: false,
          currentlyFilled: hasComboboxSelection(el)
        });
        continue;
      }

      if (!isVisibleAndEditable(el)) continue;
      if (el.type === "password") continue;
      if (
        el.getAttribute("maxlength") === "1" ||
        el.dataset?.otpBox === "true" ||
        el.hasAttribute("data-jobify-otp") ||
        el.autocomplete === "one-time-code"
      ) {
        continue;
      }

      const ctx = getFieldContext(el);
      const req = isFieldRequired(el, ctx);

      if (el.type === "radio") {
        const gk = el.name || ctx.primaryLabel;
        if (seenRadioGroups.has(gk)) continue;
        seenRadioGroups.add(gk);
        const groupRadios = el.name
          ? Array.from(document.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`))
          : [el];
        fields.push({
          index: fields.length + 1,
          kind: "radio_group",
          label: (ctx.primaryLabel || gk || "Choice").split("|")[0].trim(),
          required: req,
          isCoverLetter: false,
          currentlyFilled: groupRadios.some((r) => r.checked)
        });
        continue;
      }

      if (el.type === "checkbox") {
        const cbGroup = resolveCheckboxGroup(el, document);
        if (cbGroup) {
          if (seenCheckboxGroups.has(cbGroup.groupKey)) continue;
          seenCheckboxGroups.add(cbGroup.groupKey);
          const groupReq = isFieldRequired(el, cbGroup.groupCtx);
          fields.push({
            index: fields.length + 1,
            kind: "checkbox_group",
            label: (cbGroup.groupCtx.primaryLabel || "Multi-Select").split("|")[0].trim(),
            required: groupReq,
            isCoverLetter: false,
            currentlyFilled: cbGroup.checkboxes.some((c) => c.checked)
          });
          continue;
        }
        const isConsentReq =
          req || (CONSENT_CHECKBOX_REGEX.test(ctx.fullLabel) && !NEGATIVE_CHECKBOX_REGEX.test(ctx.fullLabel));
        fields.push({
          index: fields.length + 1,
          kind: "checkbox",
          label: (getChoiceOptionLabel(el) || ctx.primaryLabel || "Checkbox").slice(0, 90),
          required: isConsentReq,
          isCoverLetter: false,
          currentlyFilled: Boolean(el.checked)
        });
        continue;
      }

      const isClText = el.tagName === "TEXTAREA" && /cover\s*letter/i.test(ctx.primaryLabel);
      if (isClText && (req || meta.mentionsCoverLetter)) {
        requiresCoverLetter = true;
      }

      const currentlyFilled =
        el.tagName === "SELECT"
          ? Boolean(el.value && el.selectedIndex > 0)
          : Boolean((el.value || "").trim().length > 0);

      fields.push({
        index: fields.length + 1,
        kind: isClText ? "cover_letter_text" : el.tagName.toLowerCase(),
        label: (ctx.primaryLabel || el.name || el.id || "Field").split("|")[0].trim(),
        required: req,
        isCoverLetter: isClText,
        currentlyFilled
      });
    }

    const emptyRequiredCount = fields.filter((f) => f.required && !f.currentlyFilled).length;
    return {
      totalFields: fields.length,
      emptyFieldsCount: fields.filter((f) => !f.currentlyFilled).length,
      emptyRequiredCount,
      requiresCoverLetter,
      fields
    };
  }

  function countActionableFormControls() {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea")).filter((el) =>
      el.type === "file" ? isActionableFileInput(el) : isVisibleAndEditable(el)
    );
    const custom = scanCustomInteractiveGroups(document);
    return (
      inputs.length +
      custom.ariaCheckboxes.length +
      custom.ariaRadioGroups.length +
      custom.buttonChoiceGroups.length
    );
  }

  // Detect open "Start Your Application" / Apply-Method Choice Modal (e.g. Workday Apply Manually vs LinkedIn / Last Application)
  function findApplyModalChoiceButton(doc = document) {
    const explicitManual = Array.from(
      doc.querySelectorAll(
        "[data-automation-id='applyManually'], [data-uxi-element-id*='applyManually' i], [data-jobify-apply-manual]"
      )
    ).find((el) => isElementVisible(el) && !el.disabled);
    if (explicitManual) return explicitManual;

    const visibleInteractive = Array.from(
      doc.querySelectorAll("a, button, [role='button']")
    ).filter((el) => !el.disabled && isElementVisible(el) && !isHeaderOrNavButton(el));

    const manualTextBtn = visibleInteractive.find((el) => {
      const txt = (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim();
      return /^(apply\s*manually|fill\s*(out\s*)?manually|manual\s*application|continue\s*manually)$/i.test(txt);
    });
    if (manualTextBtn) return manualTextBtn;

    // Fallback inside an open dialog ONLY if no "Apply Manually" exists (never pick LinkedIn or Use My Last Application!)
    const modalRoot = Array.from(
      doc.querySelectorAll("[data-automation-id='wd-popup-frame'], [role='dialog'], [aria-modal='true']")
    ).find(isElementVisible);
    if (modalRoot) {
      const autofillBtn = Array.from(
        modalRoot.querySelectorAll("[data-automation-id='autofillWithResume'], a, button, [role='button']")
      ).find((el) => {
        if (!isElementVisible(el) || el.disabled) return false;
        const autoId = el.dataset?.automationId || "";
        if (/linkedin|useMyLast/i.test(autoId)) return false;
        const txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (/linkedin|indeed|last\s*(application|location)/i.test(txt)) return false;
        return (
          autoId === "autofillWithResume" ||
          /^(autofill\s*with\s*resume|upload\s*resume|continue\s*without\s*linkedin)$/i.test(txt)
        );
      });
      if (autofillBtn) return autofillBtn;
    }

    return null;
  }

  function hasRealCandidateFormFields(doc = document) {
    // If an Apply-Method modal ("Apply Manually") is open on top of the page, we are not in the candidate form yet
    if (findApplyModalChoiceButton(doc)) return false;

    if (Array.from(doc.querySelectorAll("input[type='file']")).some(isActionableFileInput)) {
      return true;
    }

    const visibleInputs = Array.from(
      doc.querySelectorAll("input, select, textarea, [role='combobox'], button[aria-haspopup='listbox']")
    ).filter((el) => {
      if (isTrapOrSystemInput(el) || el.disabled) return false;
      if (el.type === "password" || el.type === "hidden" || el.type === "submit" || el.type === "button") return false;
      if (el.getAttribute("maxlength") === "1" || el.dataset?.otpBox === "true" || el.autocomplete === "one-time-code") {
        return false;
      }
      if (isComboboxInput(el)) {
        if (isInHiddenAncestor(el)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      return isVisibleAndEditable(el);
    });

    for (const el of visibleInputs) {
      const sig = `${el.id || ""} ${el.name || ""} ${el.autocomplete || ""} ${el.dataset?.automationId || ""}`.toLowerCase();
      if (
        /first[_-]?name|last[_-]?name|given-name|family-name|legalnamesection|_systemfield_name|phone[-_]?number|\bphone\b|linkedin|street[_-]?address|addresssection/i.test(
          sig
        )
      ) {
        return true;
      }
    }

    const insideAppContainer = visibleInputs.filter((el) =>
      Boolean(
        el.closest(
          "[data-automation-id='applyFlowPage'], [class*='ashby-application-form'], #application_form, #grnhse_app, .application-form, [class*='applicationForm' i], form:not([role='search']):not([action*='search' i])"
        )
      )
    );
    if (
      insideAppContainer.some((el) =>
        Boolean(el.closest("[data-automation-id='applyFlowPage'], [class*='ashby-application-form']"))
      )
    ) {
      return true;
    }
    return insideAppContainer.length >= 3;
  }

  function findApplyEntryCandidates(doc = document) {
    return Array.from(
      doc.querySelectorAll(
        "[data-automation-id='adventureButton'], [data-uxi-element-id*='adventureButton' i], [data-jobify-apply-btn], a[href$='/application'], a[href*='/application?'], a.postings-btn[href*='/apply'], a[href*='/careers/apply/'], button, a[role='button'], a[role='tab'], [role='button'], input[type='button'], a"
      )
    ).filter((el) => {
      if (el.disabled || !isElementVisible(el)) return false;
      if (isHeaderOrNavButton(el)) return false;
      const autoId = el.dataset?.automationId || "";
      if (/^(applyWithLinkedIn|useMyLastApplication|utilityButtonSignIn)$/i.test(autoId)) return false;
      const rawTxt = (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || "")
        .replace(/[→›»↗⟶➔▶]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (
        /with\s+(linkedin|indeed|seek|xing|glassdoor|google|apple|facebook)|use\s+my\s+last\s+(application|location)|refer\s+a\s+friend|job\s+alert|save\s+job|share/i.test(
          rawTxt
        )
      ) {
        return false;
      }
      if (
        el.hasAttribute("data-jobify-apply-btn") ||
        autoId === "adventureButton" ||
        /adventureButton/i.test(el.dataset?.uxiElementId || "")
      ) {
        return true;
      }
      const href = el.getAttribute("href") || "";
      if (/^application$/i.test(rawTxt)) {
        return el.getAttribute("role") === "tab" || /\/application(\?|$)/i.test(href);
      }
      return /^(apply(\s+(now|(for|to)\s+(this\s+|the\s+|a\s+)?(job|role|position|opening|opportunity)|online|here|externally|on\s+company\s+site|directly|today|manually))?|quick\s+apply|easy\s+apply|start(\s+your)?\s+application|begin\s+application|continue\s+to\s+application|submit\s+an?\s+application|i'?m\s+interested)$/i.test(
        rawTxt
      );
    });
  }

  // Click "Apply" / "Apply Now" AND handle Workday / multi-option "Start Your Application" -> "Apply Manually" modal!
  async function clickApplyEntryButton() {
    const navigateLinkFallbackIfNeeded = async (anchorEl, prevUrl) => {
      if (!anchorEl) return;
      const rawHref = anchorEl.getAttribute?.("href") || "";
      const targetAttr = anchorEl.getAttribute?.("target") || "";
      if (!rawHref || /^#|^javascript:/i.test(rawHref) || targetAttr === "_blank") return;
      for (let w = 0; w < 5; w++) {
        await sleep(200);
        if (
          location.href !== prevUrl ||
          hasRealCandidateFormFields(document) ||
          Boolean(findEmailAuthChoiceButton(document)) ||
          Array.from(document.querySelectorAll("input[type='password']")).some(isVisibleAndEditable)
        ) {
          return;
        }
      }
      try {
        window.location.assign(new URL(rawHref, location.href).href);
      } catch (_) {}
    };

    // 1. If "Start Your Application" modal ("Apply Manually") is ALREADY open on screen, click it immediately!
    const existingModalBtn = findApplyModalChoiceButton(document);
    if (existingModalBtn) {
      const prevUrl = location.href;
      const modalHref = existingModalBtn.getAttribute("href") || "";
      const modalTarget = existingModalBtn.getAttribute("target") || "";
      try {
        existingModalBtn.scrollIntoView({ block: "center" });
      } catch (_) {}
      await sleep(80);
      dispatchRealClick(existingModalBtn);
      await navigateLinkFallbackIfNeeded(existingModalBtn, prevUrl);
      return {
        clicked: true,
        clickedModalChoice: true,
        href: modalHref || null,
        opensNewTab: modalTarget === "_blank"
      };
    }

    // 2. If page has a lazy embedded ATS iframe below the fold (e.g. Databricks #grnhse_iframe), scroll it into view
    const embeddedIframe = document.querySelector(
      "iframe[src*='greenhouse.io'], iframe[src*='ashbyhq.com'], iframe[src*='lever.co'], #grnhse_iframe"
    );
    if (embeddedIframe) {
      try {
        embeddedIframe.scrollIntoView({ block: "center" });
      } catch (_) {}
    }

    // 3. Otherwise find the primary Apply / Apply Now entry button on the job posting
    const candidates = findApplyEntryCandidates(document);
    if (candidates.length === 0) {
      return { clicked: false };
    }

    const chosenBtn =
      candidates.find(
        (c) =>
          c.hasAttribute("data-jobify-apply-btn") ||
          c.dataset?.automationId === "adventureButton" ||
          /^apply(\s+(now|(for|to)\s+(this\s+)?(job|role|position)))?$/i.test(
            (c.innerText || "").replace(/[→›»↗⟶➔▶]+/g, "").replace(/\s+/g, " ").trim()
          )
      ) || candidates[0];

    const beforeUrl = location.href;
    const href = chosenBtn.getAttribute("href") || "";
    const targetAttr = chosenBtn.getAttribute("target") || "";
    try {
      chosenBtn.scrollIntoView({ block: "center" });
    } catch (_) {}
    await sleep(80);
    dispatchRealClick(chosenBtn);

    // 4. Poll up to 4.0s (16 x 250ms) for async "Start Your Application" modal (Workday wd-popup-frame -> Apply Manually)
    for (let tick = 0; tick < 16; tick++) {
      await sleep(250);
      const modalChoice = findApplyModalChoiceButton(document);
      if (modalChoice) {
        await sleep(120);
        const urlAtModal = location.href;
        const mHref = modalChoice.getAttribute("href") || "";
        const mTarget = modalChoice.getAttribute("target") || "";
        dispatchRealClick(modalChoice);
        await navigateLinkFallbackIfNeeded(modalChoice, urlAtModal);
        return {
          clicked: true,
          clickedModalChoice: true,
          href: mHref || href || null,
          opensNewTab: mTarget === "_blank" || targetAttr === "_blank"
        };
      }
      if (
        location.href !== beforeUrl ||
        hasRealCandidateFormFields(document) ||
        Boolean(findEmailAuthChoiceButton(document)) ||
        Array.from(document.querySelectorAll("input[type='password']")).some(isVisibleAndEditable)
      ) {
        return {
          clicked: true,
          clickedModalChoice: false,
          href: href || null,
          opensNewTab: targetAttr === "_blank"
        };
      }
    }

    // 5. Direct href navigation fallback if <a href> click was swallowed without modal or route transition
    await navigateLinkFallbackIfNeeded(chosenBtn, beforeUrl);

    return {
      clicked: true,
      clickedModalChoice: false,
      href: href || null,
      opensNewTab: targetAttr === "_blank"
    };
  }

  // Auto-open collapsed / tabbed application views (e.g. Ashby /application tab, Lever /apply button, Workday Apply)
  async function ensureApplicationFormOpen() {
    if (
      !findApplyModalChoiceButton(document) &&
      (hasRealCandidateFormFields(document) ||
        Array.from(document.querySelectorAll("input[type='password']")).some(isVisibleAndEditable))
    ) {
      return { hasControls: countActionableFormControls() > 0, clickedApplyGate: false };
    }
    const embeddedIframe = document.querySelector(
      "iframe[src*='greenhouse.io'], iframe[src*='ashbyhq.com'], iframe[src*='lever.co'], #grnhse_iframe"
    );
    if (embeddedIframe) {
      try {
        embeddedIframe.scrollIntoView({ block: "center" });
      } catch (_) {}
      return { hasControls: false, clickedApplyGate: false };
    }

    const res = await clickApplyEntryButton();
    if (!res.clicked) {
      return { hasControls: countActionableFormControls() > 0, clickedApplyGate: false };
    }

    for (let i = 0; i < 14; i++) {
      await sleep(160);
      if (hasRealCandidateFormFields(document) || countActionableFormControls() > 0) {
        return { hasControls: true, clickedApplyGate: true };
      }
    }

    return {
      hasControls: countActionableFormControls() > 0,
      clickedApplyGate: true,
      navigatingHref: res.href || null
    };
  }

  function isButtonDisabledState(b) {
    if (!b) return true;
    return Boolean(b.disabled || b.getAttribute("aria-disabled") === "true" || b.getAttribute("data-disabled") === "true");
  }

  // Find Next Step vs. Final Submit button on multi-page wizards and single-page forms
  function findWizardButtons({ includeDisabled = false } = {}) {
    const btns = Array.from(
      document.querySelectorAll(
        "[data-jobify-next], [data-jobify-submit], .ashby-application-form-submit-button, #submit_app, #btn-submit, .template-btn-submit, button[class*='submitButton' i], [data-uxi-element-id*='submit' i], [data-automation-id='bottom-navigation-next-button'], [data-automation-id='pageFooterNextButton'], button[type='submit'], input[type='submit'], button, [role='button']"
      )
    ).filter((b) => (includeDisabled || !isButtonDisabledState(b)) && isElementVisible(b) && !isHeaderOrNavButton(b));

    let nextBtn = null;
    let submitBtn = null;

    for (const b of btns) {
      if (
        b.hasAttribute("data-jobify-apply-btn") ||
        b.dataset?.automationId === "adventureButton" ||
        b.dataset?.automationId === "applyManually"
      ) {
        continue;
      }
      const rawTxt = (b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      const txt = rawTxt.replace(/[→›»↗⟶➔▶]+/g, "").replace(/\s+/g, " ").trim();
      const autoId = b.dataset?.automationId || "";
      const clsId = `${b.id || ""} ${typeof b.className === "string" ? b.className : ""} ${b.dataset?.uxiElementId || ""}`;

      if (!txt && !autoId && !clsId) continue;
      if (
        /^(back|previous|cancel|save\s*draft|sign\s*out|log\s*out|withdraw|upload|attach|browse|remove|delete|clear|reset|add(\s+another|\s+work|\s+education|\s+skill)?|autofill|yes|no)$/i.test(
          txt
        )
      ) {
        continue;
      }

      const isWdFooterNext = autoId === "bottom-navigation-next-button" || autoId === "pageFooterNextButton";

      if (
        b.hasAttribute("data-jobify-next") ||
        (/^(next(\s*(step|page|section))?|continue(\s+to\s+\w+)?|save\s*(and|&)\s*continue|proceed|review(\s*application)?)$/i.test(
          txt
        ) &&
          !/submit/i.test(txt)) ||
        (isWdFooterNext && !/submit/i.test(txt))
      ) {
        if (!nextBtn) nextBtn = b;
        continue;
      }

      const isExplicitSubmitClassOrId =
        b.classList?.contains("ashby-application-form-submit-button") ||
        /^(submit_app|btn-submit)$/i.test(b.id || "") ||
        /ashby-application-form-submit-button|template-btn-submit|submitButton/i.test(clsId);

      const isFormSubmitApply =
        /^(apply(\s+(now|for\s+this\s+(job|role|position)))?)$/i.test(txt) &&
        Boolean(b.closest("form, [class*='ashby-application-form']")) &&
        (b.getAttribute("type") === "submit" || b.tagName === "INPUT" || hasRealCandidateFormFields(document));

      const isNativeFormSubmitFallback =
        !nextBtn &&
        (b.getAttribute("type") === "submit" || (b.tagName === "INPUT" && b.type === "submit")) &&
        Boolean(b.closest("form, [class*='ashby-application-form']")) &&
        /submit|send|apply|complete|finish|confirm/i.test(`${txt} ${clsId}`);

      if (
        b.hasAttribute("data-jobify-submit") ||
        isExplicitSubmitClassOrId ||
        /^(submit(\s+(your\s+|my\s+)?(application|profile|candidacy|form|info|information|details|now))?|(send|complete|finalize|confirm)\s+(your\s+|my\s+)?application|finish(\s*(&|and)\s*submit)?|review\s*(&|and)\s*submit)$/i.test(
          txt
        ) ||
        isFormSubmitApply ||
        isNativeFormSubmitFallback ||
        (isWdFooterNext && /submit/i.test(txt))
      ) {
        if (!submitBtn) submitBtn = b;
      }
    }

    return { nextBtn, submitBtn };
  }

  async function clickWizardNextOrSubmit({ allowFinalSubmit = true } = {}) {
    // 1. Blur any focused input & close stray dropdown overlays so blur-based React/Workday validators run
    try {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
        document.activeElement.blur?.();
      }
      const wdClickFilter = document.querySelector("[data-automation-id='click_filter']");
      if (wdClickFilter && isElementVisible(wdClickFilter)) {
        dispatchRealClick(wdClickFilter);
      }
    } catch (_) {}
    await sleep(90);

    // 2. Find enabled Next/Submit button; if present in DOM but temporarily disabled by async validator, poll up to 1.6s
    let { nextBtn, submitBtn } = findWizardButtons({ includeDisabled: false });
    if (!nextBtn && !(submitBtn && allowFinalSubmit)) {
      const disabledCheck = findWizardButtons({ includeDisabled: true });
      if (disabledCheck.nextBtn || (disabledCheck.submitBtn && allowFinalSubmit)) {
        for (let waitIdx = 0; waitIdx < 8; waitIdx++) {
          await sleep(200);
          ({ nextBtn, submitBtn } = findWizardButtons({ includeDisabled: false }));
          if (nextBtn || (submitBtn && allowFinalSubmit)) break;
        }
      }
    }

    if (nextBtn) {
      const label = (nextBtn.innerText || nextBtn.value || "Next").replace(/\s+/g, " ").trim();
      const formEl = nextBtn.closest("form");
      const hadHtml5Invalid = Boolean(formEl && typeof formEl.checkValidity === "function" && !formEl.checkValidity());
      try {
        nextBtn.scrollIntoView({ block: "center" });
      } catch (_) {}
      await sleep(80);
      dispatchRealClick(nextBtn);
      return { action: "next", buttonText: label, hadHtml5Invalid };
    }

    if (submitBtn && allowFinalSubmit) {
      const label = (submitBtn.innerText || submitBtn.value || "Submit Application").replace(/\s+/g, " ").trim();
      const formEl = submitBtn.closest("form");
      const hadHtml5Invalid = Boolean(formEl && typeof formEl.checkValidity === "function" && !formEl.checkValidity());
      try {
        submitBtn.scrollIntoView({ block: "center" });
      } catch (_) {}
      await sleep(100);
      dispatchRealClick(submitBtn);
      return { action: "submit", buttonText: label, hadHtml5Invalid };
    }

    const anySubmit = findWizardButtons({ includeDisabled: true }).submitBtn;
    return {
      action: "none",
      hasSubmitReady: Boolean(submitBtn),
      hasDisabledSubmit: Boolean(anySubmit && isButtonDisabledState(anySubmit))
    };
  }

  function detectSubmissionConfirmation(doc = document) {
    const explicitBanners = doc.querySelectorAll(
      "#submit-banner, #wd-done, #lv-done, #application_confirmation, .application-confirmation, [data-jobify-submitted='true'], [data-automation-id='thankYouMessage'], .ashby-application-form-success, [class*='applicationConfirmation' i]"
    );
    for (const b of explicitBanners) {
      if (isElementVisible(b)) return true;
    }

    const { submitBtn } = findWizardButtons({ includeDisabled: false });
    const urlPathSearch = `${location.pathname || ""}${location.search || ""}`;
    if (
      !submitBtn &&
      !hasRealCandidateFormFields(doc) &&
      /\/(confirmation|thank[-_]?you|application[-_]?submitted|submitted)(\b|\/|\?|$)/i.test(urlPathSearch)
    ) {
      return true;
    }

    const headings = Array.from(
      doc.querySelectorAll(
        "h1, h2, h3, h4, [role='alert'], [role='status'], .confirmation, [class*='thank-you' i], [class*='thankYou' i], [class*='success' i]"
      )
    ).filter(isElementVisible);
    for (const h of headings) {
      const t = (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 260) continue;
      if (
        /thank\s+you\s+for\s+(applying|your\s+application|submitting|your\s+interest)|application\s+(has\s+been\s+)?(submitted|received|sent|complete|completed)|we('ve|\s+have)\s+received\s+your\s+application|successfully\s+(submitted(\s+your\s+application)?|applied)|your\s+application\s+is\s+(in|complete|on\s+its\s+way)|you('ve|\s+have)\s+applied\s+(to|for)/i.test(
          t
        )
      ) {
        if (!submitBtn || !h.closest("form")) return true;
      }
    }
    return false;
  }

  function isVisualErrorTextNode(node) {
    if (!node || !isElementVisible(node)) return false;
    if (node.closest(COOKIE_CONSENT_SELECTOR) || node.closest("#jobify-copilot-host")) return false;
    if (node.matches("button, a, [role='button'], label, legend, input, select, textarea")) return false;
    if (node.closest("button, a, [role='button'], label, legend, nav, header, footer")) return false;
    if (node.querySelector("input, select, textarea, button")) return false;
    if (node.children && node.children.length > 3) return false;

    const txt = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    if (!txt || txt.length < 4 || txt.length > 240) return false;
    if (/^\s*(\*|required\s*\*?|\(required\)|optional)\s*$/i.test(txt)) return false;
    if (/thank\s+you|application\s+(submitted|received)|successfully/i.test(txt)) return false;

    const cs = window.getComputedStyle(node);
    const rgbMatch = String(cs.color || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!rgbMatch) return false;
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    const isRedTone = r >= 165 && g <= 95 && b <= 105 && r - g >= 75;
    if (!isRedTone) return false;

    // Red text inside a form or matching validation phrasing is a genuine validation error
    if (
      /required|please\s+|must\s+|invalid|cannot\s+be|can'?t\s+be|enter\s+|select\s+|choose\s+|provide\s+|only\b|digits?\b|numbers?\b|format|minimum|maximum|at\s+least|missing|valid\b|error|agree|confirm|check\b|upload|attach/i.test(
        txt
      ) ||
      Boolean(
        node.closest(
          "form, [data-automation-id='applyFlowPage'], [class*='application' i], .field, .form-group, [data-jobify-field], fieldset"
        )
      )
    ) {
      return true;
    }
    return false;
  }

  function getControlValidationErrorText(el, customWrap = null, includeHtml5Validity = false) {
    if (!el) return "";
    // 1. aria-errormessage / aria-describedby linked error nodes
    const refIds = `${el.getAttribute?.("aria-errormessage") || ""} ${el.getAttribute?.("aria-describedby") || ""}`
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const id of refIds) {
      const refNode = document.getElementById(id);
      if (refNode && isElementVisible(refNode)) {
        const t = (refNode.innerText || refNode.textContent || "").replace(/\s+/g, " ").trim();
        if (
          t &&
          (refNode.matches("[role='alert'], .field-error, [id$='-error'], [class*='error' i]") ||
            isVisualErrorTextNode(refNode) ||
            /required|invalid|please\s+|must\s+|only\b|digits?\b|numbers?\b|cannot\s+be/i.test(t))
        ) {
          return t.slice(0, 220);
        }
      }
    }

    // 2. Field wrapper explicit error classes OR visual red Tailwind / CSS-in-JS error nodes
    const wrap =
      customWrap ||
      el.closest?.(
        ".field, .form-group, .application-question, .ashby-application-form-field-entry, [class*='fieldEntry'], [data-automation-id*='formField'], [data-jobify-field], .row, fieldset, [role='radiogroup'], [role='group']"
      ) ||
      el.parentElement;

    if (wrap) {
      const explicitErrs = Array.from(
        wrap.querySelectorAll(
          "[data-automation-id='errorMessage'], .field-error, .field-error-msg, .lv-error, .ashby-application-form-field-error, [class*='fieldError' i], [class*='errorMessage' i], [class*='error-message' i], [id$='-error'], [role='alert']"
        )
      ).filter((n) => isElementVisible(n) && (n.innerText || n.textContent || "").trim().length > 0);
      if (explicitErrs.length > 0) {
        return (explicitErrs[0].innerText || explicitErrs[0].textContent || "").replace(/\s+/g, " ").trim().slice(0, 220);
      }

      const redNodes = Array.from(wrap.querySelectorAll("p, span, div, small, em")).filter(isVisualErrorTextNode);
      if (redNodes.length > 0) {
        return (redNodes[0].innerText || redNodes[0].textContent || "").replace(/\s+/g, " ").trim().slice(0, 220);
      }
    }

    // 3. HTML5 native constraint validation message (post-submit / heal phase)
    if (includeHtml5Validity && typeof el.validity === "object" && el.validity && !el.validity.valid && el.validationMessage) {
      return String(el.validationMessage).trim().slice(0, 220);
    }

    if (el.getAttribute?.("aria-invalid") === "true") {
      return "Required or invalid value";
    }
    return "";
  }

  function detectFormValidationErrors(doc = document) {
    const messages = [];
    const seen = new Set();
    const pushMsg = (txt) => {
      const clean = String(txt || "").replace(/\s+/g, " ").trim();
      if (!clean || clean.length < 3 || clean.length > 260) return;
      if (seen.has(clean.toLowerCase())) return;
      seen.add(clean.toLowerCase());
      messages.push(clean);
    };

    // 1. Explicit aria-invalid="true" controls (including custom ARIA checkboxes/radios)
    const ariaInvalidEls = Array.from(doc.querySelectorAll("[aria-invalid='true']")).filter((el) => {
      if (isTrapOrSystemInput(el) || el.disabled) return false;
      if (el.type === "file") return isActionableFileInput(el);
      if (isComboboxInput(el)) return !isInHiddenAncestor(el);
      if (el.getAttribute("role") === "checkbox" || el.getAttribute("role") === "switch" || el.getAttribute("role") === "radiogroup") {
        return isElementVisible(el);
      }
      return isVisibleAndEditable(el);
    });
    for (const el of ariaInvalidEls) {
      const specificErr = getControlValidationErrorText(el);
      const ctx = getFieldContext(el);
      const lbl = (ctx.primaryLabel || el.name || el.id || "Required field").split("|")[0].trim();
      pushMsg(specificErr && specificErr !== "Required or invalid value" ? `${lbl}: ${specificErr}` : `Invalid/missing field: ${lbl}`);
    }

    // 2. Visible field error / banner elements
    const errorNodes = Array.from(
      doc.querySelectorAll(
        "[data-automation-id='errorMessage'], [data-automation-id*='errorBanner' i], .field-error, .field-error-msg, .lv-error, .ashby-application-form-field-error, [class*='fieldError' i], [class*='errorMessage' i], [class*='error-message' i], [id$='-error'], [role='alert']"
      )
    ).filter((el) => isElementVisible(el) && !el.closest(COOKIE_CONSENT_SELECTOR));

    for (const node of errorNodes) {
      const txt = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      if (!txt || txt.length > 260) continue;
      if (/thank\s+you|application\s+(submitted|received)|successfully/i.test(txt)) {
        continue;
      }
      if (
        node.matches(
          "[data-automation-id='errorMessage'], .field-error, .field-error-msg, .lv-error, .ashby-application-form-field-error, [id$='-error']"
        ) ||
        /required|please\s+(enter|select|provide|fill|upload|attach|check|complete|confirm|choose|specify)|cannot\s+be\s+(blank|empty)|must\s+(be|select|provide|agree|accept|contain)|invalid|missing|this\s+field|make\s+a\s+selection|value\s+is\s+required|fix\s+the\s+errors?|digits?\s*only|numbers?\s*only/i.test(
          txt
        )
      ) {
        pushMsg(txt);
      }
    }

    // 3. CSS-in-JS / Tailwind red validation paragraphs & spans inside forms/application containers (no .field-error class needed!)
    const formScopes = Array.from(
      doc.querySelectorAll(
        "form, [data-automation-id='applyFlowPage'], [class*='ashby-application-form'], #application_form, #grnhse_app, .application-form, [class*='applicationForm' i], [data-jobify-form]"
      )
    );
    const scopeRoots = formScopes.length > 0 ? formScopes : [doc.body].filter(Boolean);
    for (const root of scopeRoots) {
      const candidates = root.querySelectorAll("p, span, div, small, em");
      for (const node of candidates) {
        if (isVisualErrorTextNode(node)) {
          pushMsg(node.innerText || node.textContent || "");
        }
      }
    }

    return {
      hasErrors: messages.length > 0,
      count: messages.length,
      messages: messages.slice(0, 10)
    };
  }

  function detectHardBlockerChallenge(doc = document) {
    const captchaFrames = Array.from(
      doc.querySelectorAll(
        "iframe[src*='recaptcha' i], iframe[src*='hcaptcha' i], iframe[src*='challenges.cloudflare.com' i], .cf-turnstile"
      )
    ).filter((el) => {
      if (!isElementVisible(el)) return false;
      const src = el.getAttribute("src") || "";
      // Ignore invisible reCAPTCHA v3 anchor badge pinned in corner unless an active challenge popup (bframe) is open
      if (/recaptcha/i.test(src) && /anchor/i.test(src) && !el.closest("form, [class*='application'], [role='dialog']")) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width >= 45 && r.height >= 35;
    });
    if (captchaFrames.length > 0) {
      return { blocked: true, reason: "CAPTCHA challenge requires manual verification" };
    }
    return { blocked: false, reason: null };
  }

  function computeStepSignature(doc = document) {
    const activeStep =
      doc.querySelector("[data-automation-id='progressBarActiveStep'], .step--active, [aria-current='step']")?.innerText?.trim() || "";
    const heading =
      doc.querySelector("[data-automation-id='applyFlowPage'] h2, [data-automation-id='applyFlowPage'] h3, form h1, form h2, h1, h2")
        ?.innerText?.trim()
        ?.slice(0, 80) || "";
    const editableIds = Array.from(doc.querySelectorAll("input, select, textarea"))
      .filter((el) => (el.type === "file" ? isActionableFileInput(el) : isVisibleAndEditable(el)))
      .slice(0, 12)
      .map((el) => el.id || el.name || el.dataset?.automationId || el.type)
      .join(",");
    return `${location.pathname}${location.search}|${activeStep}|${heading}|${editableIds}`;
  }

  function inspectAutonomousScreenState(profile = { personal: {}, workAuthAndEEO: {} }, topJobMeta = null) {
    const meta = extractJobMetadata(document);
    const mergedMeta =
      topJobMeta?.description?.length > (meta.description?.length || 0)
        ? {
            ...topJobMeta,
            url: meta.url,
            isAuthWall: meta.isAuthWall,
            isRelevantPage: meta.isRelevantPage || topJobMeta.isRelevantPage,
            hasEmbeddedAtsIframe: meta.hasEmbeddedAtsIframe
          }
        : meta;
    const isSubmittedConfirmation = detectSubmissionConfirmation(document);
    const otpChallenge = detectOtpChallenge(document);
    const pwVisible = Array.from(document.querySelectorAll("input[type='password']")).filter(isVisibleAndEditable);
    const hasEmailAuthGate = Boolean(findEmailAuthChoiceButton(document));
    const hasEmailFirstAuth = Boolean(detectEmailFirstAuthStep(document));
    const hasCandidateForm = hasRealCandidateFormFields(document);
    const hasApplyChoiceModal = Boolean(findApplyModalChoiceButton(document));
    const needsEmailVerificationBanner = detectEmailVerificationBanner(document);

    const isStandaloneAuthWall =
      !hasApplyChoiceModal &&
      (pwVisible.length > 0 || hasEmailAuthGate || hasEmailFirstAuth) &&
      (!hasCandidateForm || Boolean(document.querySelector("[data-jobify-auth-step-only='true']")));

    const inventory = extractFormFieldsInventory(profile, mergedMeta);
    const { nextBtn, submitBtn } = findWizardButtons({ includeDisabled: false });
    const disabledWizard = !nextBtn && !submitBtn ? findWizardButtons({ includeDisabled: true }) : { nextBtn: null, submitBtn: null };
    const applyBtns = findApplyEntryCandidates(document);
    const validationErrors = detectFormValidationErrors(document);
    const hardBlocker = detectHardBlockerChallenge(document);

    return {
      url: location.href,
      stepSignature: computeStepSignature(document),
      isSubmittedConfirmation,
      otpChallenge,
      isStandaloneAuthWall,
      hasEmailAuthGate,
      hasApplyChoiceModal,
      needsEmailVerificationBanner,
      hasCandidateForm,
      passwordCount: pwVisible.length,
      authErrorText: hasVisibleAuthError(),
      hasValidationErrors: validationErrors.hasErrors,
      validationErrors: validationErrors.messages,
      hardBlocker,
      inventory,
      hasApplyButton:
        (hasApplyChoiceModal || applyBtns.length > 0) &&
        !hasCandidateForm &&
        !isStandaloneAuthWall &&
        !otpChallenge.detected,
      hasNextButton: Boolean(nextBtn || disabledWizard.nextBtn),
      hasSubmitButton: Boolean(submitBtn || disabledWizard.submitBtn),
      hasDisabledSubmit: Boolean(!submitBtn && disabledWizard.submitBtn),
      jobMeta: mergedMeta
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
    sequentialOneByOne = false,
    onlyNeededCleanMode = false,
    includeAllUnresolvedOpenEnded = false,
    onProgress = null,
    jobMeta = null
  }) {
    let filledCount = 0;
    const filledFieldsLog = [];
    const liveMeta = extractJobMetadata(document);
    const meta =
      jobMeta?.description?.length > (liveMeta.description?.length || 0)
        ? {
            ...jobMeta,
            url: liveMeta.url,
            isAuthWall: liveMeta.isAuthWall,
            isRelevantPage: liveMeta.isRelevantPage || jobMeta.isRelevantPage,
            hasEmbeddedAtsIframe: liveMeta.hasEmbeddedAtsIframe
          }
        : jobMeta || liveMeta;
    const stepDelay = sequentialOneByOne ? 55 : 0;

    const reportStep = async (label) => {
      filledFieldsLog.push(label);
      if (typeof onProgress === "function") {
        onProgress(`✍️ [${filledCount}] ${label}`);
      }
      if (stepDelay > 0) await sleep(stepDelay);
    };

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

    // Hydrate below-the-fold lazy-mounted sections on long SPA portals before inventory scan
    if (sequentialOneByOne && /^https?:/i.test(location.protocol)) {
      try {
        const docEl = document.scrollingElement || document.documentElement;
        if (docEl && docEl.scrollHeight > window.innerHeight * 1.4) {
          const origTop = window.scrollY;
          window.scrollTo({ top: Math.min(docEl.scrollHeight, origTop + window.innerHeight * 0.9), behavior: "instant" });
          await sleep(80);
          window.scrollTo({ top: docEl.scrollHeight, behavior: "instant" });
          await sleep(80);
          window.scrollTo({ top: origTop, behavior: "instant" });
          await sleep(50);
        }
      } catch (_) {}
    }

    // Extract structured field inventory BEFORE filling so we know exact fields & cover letter requirement
    const preInventory = extractFormFieldsInventory(profile, meta);
    if (typeof onProgress === "function" && preInventory.totalFields > 0) {
      onProgress(`📋 Extracted ${preInventory.totalFields} field(s) — filling cleanly 1 by 1...`);
    }

    const shouldAttachCoverLetter =
      !onlyNeededCleanMode || preInventory.requiresCoverLetter || Boolean(meta.mentionsCoverLetter);

    // 1. Portal Login / Account Creation Wall
    if (meta.isAuthWall && credentials?.autoFillPortalSignups !== false) {
      const authRes = await autofillPortalAuth(credentials);
      if (authRes.filled > 0) {
        filledCount += authRes.filled;
        await reportStep(`Portal Login / Verify Password (${authRes.filled} fields)`);
      }
    }

    // 2. Multi-Entry Work Experience & Education Repeater Cards
    const repeaterFilled = fillRepeaterCards(profile);
    if (repeaterFilled > 0) {
      filledCount += repeaterFilled;
      await reportStep(`Work & Education Cards (${repeaterFilled} fields)`);
    }

    // 3. Attach Resume PDF & Cover Letter PDF (only when needed/available)
    const hasAshbySystemResume = Boolean(document.getElementById("_systemfield_resume"));
    const fileInputs = Array.from(document.querySelectorAll("input[type='file']")).filter((fi) => {
      if (!isActionableFileInput(fi)) return false;
      if (hasAshbySystemResume && fi.id !== "_systemfield_resume") {
        const ctx = getFieldContext(fi);
        if (!/cover\s*letter/i.test(ctx.fullLabel)) return false;
      }
      return true;
    });

    let attachedResume = false;
    let attachedCover = false;
    for (const fi of fileInputs) {
      const ctx = getFieldContext(fi);
      const lbl = ctx.fullLabel.toLowerCase();
      if (/cover\s*letter/i.test(lbl)) {
        const isReqCl = isFieldRequired(fi, ctx);
        if ((shouldAttachCoverLetter || isReqCl) && coverLetterPdfPayload?.base64 && (forceOverwrite || !fi.files?.length)) {
          await attachBase64PdfToInput(fi, coverLetterPdfPayload.base64, coverLetterPdfPayload.fileName);
          attachedCover = true;
          filledCount++;
          await reportStep(`Cover Letter PDF (${coverLetterPdfPayload.fileName})`);
        }
      } else if (/resume|cv\b|curriculum|attach/i.test(lbl) || fileInputs.length === 1) {
        if (resumePdfPayload?.base64 && (forceOverwrite || !fi.files?.length)) {
          const attachFileName =
            resumePdfPayload.fileName?.startsWith("Raviteja_velanati_") &&
            resumePdfPayload.fileName !== "Raviteja_velanati_Resume.pdf"
              ? resumePdfPayload.fileName
              : formatCompanyResumeFileName(meta?.company);
          await attachBase64PdfToInput(fi, resumePdfPayload.base64, attachFileName);
          attachedResume = true;
          filledCount++;
          await reportStep(`Resume PDF (${attachFileName})`);
        }
      }
    }

    // 4. Custom ARIA Checkboxes, ARIA Radio Groups, Ashby Yes/No & Generic Choice Pill Groups
    const customControlsFilled = await fillCustomInteractiveControls(profile, meta, {
      forceOverwrite,
      fillOpenEndedWithAI,
      onlyNeededCleanMode
    });
    if (customControlsFilled > 0) {
      filledCount += customControlsFilled;
      await reportStep(`Interactive Choice & Consent Controls (${customControlsFilled})`);
    }

    // 5. React-Select & Custom ARIA Comboboxes (2 passes so conditional dropdowns like EEOC Race mount & get filled)
    const visitedCombos = new WeakSet();
    for (let comboPass = 0; comboPass < 2; comboPass++) {
      const comboboxes = Array.from(
        document.querySelectorAll(
          "input[role='combobox'], button[aria-haspopup='listbox'], button[aria-haspopup='true'], [role='combobox'], input[data-automation-id='searchBox'], [data-automation-id='multiSelectContainer'] input"
        )
      ).filter((el) => {
        if (visitedCombos.has(el)) return false;
        if (isTrapOrSystemInput(el) || isInHiddenAncestor(el)) return false;
        if (el.tagName !== "INPUT" && el.querySelector?.("input[role='combobox'], input[data-automation-id='searchBox']")) {
          return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.disabled;
      });
      if (comboboxes.length === 0) break;

      for (const combo of comboboxes) {
        visitedCombos.add(combo);
        if (!forceOverwrite && hasComboboxSelection(combo)) continue;
        const ctx = getFieldContext(combo);
        const resolved = resolveDesiredValueForField(ctx, profile, combo, meta);
        if (resolved?.skip) continue;
        // In strict clean mode, skip unresolved optional dropdowns
        if (!resolved && onlyNeededCleanMode && !isFieldRequired(combo, ctx)) continue;
        const ok = await fillComboboxControl(combo, resolved, ctx, meta, fillOpenEndedWithAI);
        if (ok) {
          filledCount++;
          await reportStep(ctx.primaryLabel.split("|")[0].trim() || combo.id || "Dropdown");
        }
      }
      await sleep(120);
    }

    // 6. Standard <input>, <select>, Radio Groups, Checkboxes & Cover Letter Textarea (One-by-One in DOM order)
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
      const req = isFieldRequired(el, ctx);

      if (el.type === "radio") {
        const groupKey = el.name || ctx.primaryLabel;
        if (handledRadioGroups.has(groupKey)) continue;
        const radios = el.name
          ? Array.from(document.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`))
          : [el];
        if (!forceOverwrite && radios.some((r) => r.checked)) {
          handledRadioGroups.add(groupKey);
          continue;
        }
        let desired = resolveDesiredValueForField(ctx, profile, el, meta);
        const radioWrappers = radios.map((r) => ({
          radio: r,
          innerText: getChoiceOptionLabel(r) || `${r.value || ""}`
        }));
        if (!desired && (req || !onlyNeededCleanMode) && fillOpenEndedWithAI) {
          desired = await askAiToPickOption(
            ctx.primaryLabel,
            radioWrappers.map((w) => w.innerText),
            meta
          );
        }
        if (desired && !desired.skip) {
          const chosenWrap = findMatchingOptionElement(radioWrappers, desired);
          if (chosenWrap?.radio) {
            clickCheckboxOrRadioReliably(chosenWrap.radio);
            highlightFilledElement(chosenWrap.radio);
            handledRadioGroups.add(groupKey);
            filledCount++;
            await reportStep(ctx.primaryLabel.split("|")[0].trim() || "Choice");
          }
        }
        continue;
      }

      if (el.type === "checkbox") {
        const cbGroup = resolveCheckboxGroup(el, document);
        if (cbGroup) {
          if (handledCheckboxGroups.has(cbGroup.groupKey)) continue;
          if (!forceOverwrite && cbGroup.checkboxes.some((c) => c.checked)) {
            handledCheckboxGroups.add(cbGroup.groupKey);
            continue;
          }
          const groupReq = isFieldRequired(el, cbGroup.groupCtx);
          let desired = resolveDesiredValueForField(cbGroup.groupCtx, profile, el, meta);
          const wrappers = cbGroup.checkboxes.map((cb) => ({
            cb,
            innerText: getChoiceOptionLabel(cb)
          }));
          if (!desired && groupReq && fillOpenEndedWithAI) {
            desired = await askAiToPickOption(
              cbGroup.groupCtx.primaryLabel,
              wrappers.map((w) => w.innerText),
              meta
            );
          }
          if (desired && !desired.skip) {
            const chosen = findMatchingOptionElement(wrappers, desired);
            if (chosen?.cb) {
              clickCheckboxOrRadioReliably(chosen.cb);
              highlightFilledElement(chosen.cb);
              handledCheckboxGroups.add(cbGroup.groupKey);
              filledCount++;
              await reportStep(cbGroup.groupCtx.primaryLabel.split("|")[0].trim() || "Checkbox Group");
            }
          }
          continue;
        }

        const optionText = `${getChoiceOptionLabel(el)} ${ctx.fullLabel}`;
        if (
          !el.checked &&
          !NEGATIVE_CHECKBOX_REGEX.test(optionText) &&
          (CONSENT_CHECKBOX_REGEX.test(optionText) || req)
        ) {
          if (clickCheckboxOrRadioReliably(el)) {
            highlightFilledElement(el);
            filledCount++;
            await reportStep("Consent Checkbox");
          }
        }
        continue;
      }

      if (el.tagName === "TEXTAREA" && /cover\s*letter/i.test(ctx.primaryLabel)) {
        const isReqCl = isFieldRequired(el, ctx);
        if ((shouldAttachCoverLetter || isReqCl) && coverLetterText && (forceOverwrite || !(el.value || "").trim())) {
          if (setNativeValue(el, coverLetterText)) {
            filledCount++;
            await reportStep("Cover Letter Text");
          }
        }
        continue;
      }

      let desired = resolveDesiredValueForField(ctx, profile, el, meta);
      if (desired?.skip) continue;

      if (el.tagName === "SELECT") {
        if (!forceOverwrite && el.value && el.selectedIndex > 0) continue;
        if (!desired && (req || !onlyNeededCleanMode) && fillOpenEndedWithAI) {
          const validOpts = Array.from(el.options || [])
            .filter((o) => o.value !== "" && !o.disabled)
            .map((o) => o.text || o.innerText || o.value);
          desired = await askAiToPickOption(ctx.primaryLabel, validOpts, meta);
        }
        if (!desired) continue;
        if (sequentialOneByOne) {
          try {
            el.scrollIntoView({ block: "nearest" });
          } catch (_) {}
        }
        if (selectBestOption(el, desired)) {
          filledCount++;
          await reportStep(ctx.primaryLabel.split("|")[0].trim());
        }
      } else {
        if (!desired) continue;
        if (!forceOverwrite && (el.value || "").trim().length > 0) continue;
        if (sequentialOneByOne) {
          try {
            el.scrollIntoView({ block: "nearest" });
          } catch (_) {}
        }
        if (setNativeValue(el, desired[0])) {
          filledCount++;
          await reportStep(ctx.primaryLabel.split("|")[0].trim());
        }
      }
    }

    // 7. Open-Ended Questions: Saved Vault Match + Clean Concise Gemini AI (skipping optional fluff boxes!)
    const openQuestions = findOpenEndedFields(profile, meta, {
      skipOptionalExtras: !includeAllUnresolvedOpenEnded,
      onlyRequiredOpenEnded: onlyNeededCleanMode,
      includeAllUnresolved: includeAllUnresolvedOpenEnded
    });
    const usedSavedIds = new Set();
    const pendingAiQuestions = [];

    for (const q of openQuestions) {
      if (!forceOverwrite && q.element.value && q.element.value.trim().length > 3) continue;
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
          await reportStep(`Saved Answer: ${q.label.slice(0, 36)}`);
        }
      } else if (fillOpenEndedWithAI) {
        pendingAiQuestions.push(q);
      }
    }

    if (pendingAiQuestions.length > 0) {
      if (typeof onProgress === "function") {
        onProgress(
          `⚡ Filled ${filledCount} fields — answering ${pendingAiQuestions.length} required question(s) cleanly...`
        );
      }
      const answerSingleQuestion = async (q) => {
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
              await reportStep(`AI Answer: ${q.label.slice(0, 36)}`);
            }
          }
        } catch (_) {}
      };

      if (sequentialOneByOne) {
        for (const q of pendingAiQuestions.slice(0, 10)) {
          await answerSingleQuestion(q);
        }
      } else {
        await Promise.all(pendingAiQuestions.slice(0, 8).map(answerSingleQuestion));
      }
    }

    const postInventory = extractFormFieldsInventory(profile, meta);

    return {
      filledCount,
      filledFieldsLog,
      extractedFieldsCount: preInventory.totalFields,
      remainingEmptyRequired: postInventory.emptyRequiredCount,
      requiresCoverLetter: preInventory.requiresCoverLetter,
      openQuestionsCount: openQuestions.length,
      clickedApplyGate: gate.clickedApplyGate,
      jobMeta: meta
    };
  }

  // Collect full live diagnostics of page errors, red/invalid fields, and empty controls for Gemini AI Form Doctor
  function collectLiveFormDiagnostics(profile = {}, jobMeta = null, doc = document) {
    const meta = jobMeta || extractJobMetadata(doc);
    const pageErrScan = detectFormValidationErrors(doc);
    const pageErrors = pageErrScan.messages || [];
    const fields = [];
    let refSeq = 1;

    const assignRef = (el) => {
      if (!el) return null;
      const id = `jb_ref_${refSeq++}`;
      try {
        el.setAttribute("data-jobify-ref", id);
      } catch (_) {}
      return id;
    };

    const customGroups = scanCustomInteractiveGroups(doc);

    // 1. Custom ARIA Checkboxes / Switches
    for (const cb of customGroups.ariaCheckboxes) {
      const checked = isCustomOptionSelected(cb);
      const ctx = getFieldContext(cb);
      const label = (getChoiceOptionLabel(cb) || ctx.primaryLabel || "Consent Checkbox").slice(0, 140);
      const errTxt = getControlValidationErrorText(cb);
      const req = isFieldRequired(cb, ctx) || CONSENT_CHECKBOX_REGEX.test(`${label} ${ctx.fullLabel}`);
      if ((!checked && (req || Boolean(errTxt))) || Boolean(errTxt)) {
        if (NEGATIVE_CHECKBOX_REGEX.test(`${label} ${ctx.fullLabel}`) && !errTxt) continue;
        fields.push({
          refId: assignRef(cb),
          label,
          helperText: (ctx.helperText || "").slice(0, 100),
          kind: "checkbox",
          inputType: "aria-checkbox",
          required: req || Boolean(errTxt),
          flaggedInvalid: Boolean(errTxt) || cb.getAttribute("aria-invalid") === "true",
          currentValue: checked ? "true" : "",
          errorMessage: errTxt,
          placeholder: "",
          options: ["true", "false"]
        });
      }
    }

    // 2. Custom ARIA Radio Groups & Custom Button Choice Groups
    for (const grp of [...customGroups.ariaRadioGroups, ...customGroups.buttonChoiceGroups]) {
      const selectedOpt = grp.options.find((o) => o.selected);
      const errTxt = getControlValidationErrorText(grp.container, grp.container);
      const flagged = Boolean(errTxt) || grp.container.getAttribute("aria-invalid") === "true";
      if (!selectedOpt || flagged) {
        fields.push({
          refId: assignRef(grp.container),
          label: grp.label || "Choice Question",
          helperText: (grp.ctx?.helperText || "").slice(0, 100),
          kind: grp.kind === "aria_radio_group" ? "radio_group" : "button_group",
          inputType: grp.kind,
          required: grp.required || flagged,
          flaggedInvalid: flagged,
          currentValue: selectedOpt ? selectedOpt.text : "",
          errorMessage: errTxt,
          placeholder: "",
          options: grp.options.map((o) => o.text).filter(Boolean).slice(0, 20)
        });
      }
    }

    // 3. Comboboxes
    const comboboxes = Array.from(
      doc.querySelectorAll("input[role='combobox'], button[aria-haspopup='listbox'], [role='combobox']")
    ).filter((c) => {
      if (isTrapOrSystemInput(c) || isInHiddenAncestor(c) || c.disabled) return false;
      if (c.tagName !== "INPUT" && c.querySelector?.("input[role='combobox']")) return false;
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    for (const combo of comboboxes) {
      const ctx = getFieldContext(combo);
      const hasSel = hasComboboxSelection(combo);
      const errTxt = getControlValidationErrorText(combo);
      const flagged = Boolean(errTxt) || combo.getAttribute("aria-invalid") === "true";
      const req = isFieldRequired(combo, ctx);
      if (!hasSel || flagged) {
        const shell =
          combo.closest(".select-shell, .select__container") ||
          combo.closest(".select__control")?.parentElement ||
          combo.parentElement;
        const staticOpts = collectComboboxOptions(combo, shell)
          .map((o) => (o.innerText || o.textContent || "").trim())
          .filter(Boolean)
          .slice(0, 20);
        fields.push({
          refId: assignRef(combo),
          label: (ctx.primaryLabel || combo.id || "Dropdown").split("|")[0].trim(),
          helperText: (ctx.helperText || "").slice(0, 100),
          kind: "combobox",
          inputType: "combobox",
          required: req || flagged,
          flaggedInvalid: flagged,
          currentValue: hasSel ? (combo.value || combo.innerText || "selected").trim().slice(0, 80) : "",
          errorMessage: errTxt,
          placeholder: combo.getAttribute("placeholder") || "",
          options: staticOpts
        });
      }
    }

    // 4. Native <input>, <select>, <textarea>
    const seenRadioNames = new Set();
    const seenCbGroups = new Set();
    const allControls = Array.from(doc.querySelectorAll("input, select, textarea"));

    for (const el of allControls) {
      if (isTrapOrSystemInput(el) || el.disabled) continue;
      if (el.type === "password" || el.type === "hidden" || el.type === "submit" || el.type === "button") continue;
      if (isComboboxInput(el)) continue;

      if (el.type === "file") {
        if (!isActionableFileInput(el)) continue;
        const ctx = getFieldContext(el);
        const hasFile = Boolean(el.files && el.files.length > 0);
        const errTxt = getControlValidationErrorText(el);
        const req = isFieldRequired(el, ctx);
        if (!hasFile && (req || errTxt)) {
          fields.push({
            refId: assignRef(el),
            label: (ctx.primaryLabel || ctx.fullLabel || "Resume Upload").split("|")[0].trim(),
            helperText: "",
            kind: "file",
            inputType: /cover\s*letter/i.test(ctx.fullLabel) ? "cover_letter_file" : "resume_file",
            required: true,
            flaggedInvalid: Boolean(errTxt),
            currentValue: "",
            errorMessage: errTxt,
            placeholder: "",
            options: []
          });
        }
        continue;
      }

      if (!isVisibleAndEditable(el)) continue;
      if (
        el.getAttribute("maxlength") === "1" ||
        el.dataset?.otpBox === "true" ||
        el.hasAttribute("data-jobify-otp") ||
        el.autocomplete === "one-time-code"
      ) {
        continue;
      }

      const ctx = getFieldContext(el);
      const req = isFieldRequired(el, ctx);
      const errTxt = getControlValidationErrorText(el, null, true);
      const flagged =
        Boolean(errTxt) ||
        el.getAttribute("aria-invalid") === "true" ||
        Boolean(typeof el.validity === "object" && el.validity && !el.validity.valid);

      if (el.type === "radio") {
        const gk = el.name || ctx.primaryLabel;
        if (seenRadioNames.has(gk)) continue;
        seenRadioNames.add(gk);
        const radios = el.name
          ? Array.from(doc.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`))
          : [el];
        const checkedRadio = radios.find((r) => r.checked);
        if (!checkedRadio || flagged) {
          fields.push({
            refId: assignRef(el),
            label: (ctx.primaryLabel || gk || "Radio Choice").split("|")[0].trim(),
            helperText: (ctx.helperText || "").slice(0, 100),
            kind: "radio_group",
            inputType: "radio",
            required: req || flagged,
            flaggedInvalid: flagged,
            currentValue: checkedRadio ? getChoiceOptionLabel(checkedRadio) || checkedRadio.value : "",
            errorMessage: errTxt,
            placeholder: "",
            options: radios.map((r) => getChoiceOptionLabel(r) || r.value).filter(Boolean).slice(0, 20)
          });
        }
        continue;
      }

      if (el.type === "checkbox") {
        const cbGroup = resolveCheckboxGroup(el, doc);
        if (cbGroup) {
          if (seenCbGroups.has(cbGroup.groupKey)) continue;
          seenCbGroups.add(cbGroup.groupKey);
          const groupChecked = cbGroup.checkboxes.find((c) => c.checked);
          const grpErr = getControlValidationErrorText(el, cbGroup.checkboxes[0]?.closest("fieldset, .field, .form-group"));
          const grpReq = isFieldRequired(el, cbGroup.groupCtx) || Boolean(grpErr) || flagged;
          if (!groupChecked || grpErr || flagged) {
            fields.push({
              refId: assignRef(cbGroup.checkboxes[0] || el),
              label: (cbGroup.groupCtx.primaryLabel || "Multi-Select").split("|")[0].trim(),
              helperText: "",
              kind: "checkbox_group",
              inputType: "checkbox",
              required: grpReq,
              flaggedInvalid: Boolean(grpErr) || flagged,
              currentValue: groupChecked ? getChoiceOptionLabel(groupChecked) : "",
              errorMessage: grpErr || errTxt,
              placeholder: "",
              options: cbGroup.checkboxes.map((c) => getChoiceOptionLabel(c) || c.value).filter(Boolean).slice(0, 20)
            });
          }
          continue;
        }
        const optTxt = `${getChoiceOptionLabel(el)} ${ctx.fullLabel}`;
        if (!el.checked && !NEGATIVE_CHECKBOX_REGEX.test(optTxt) && (flagged || CONSENT_CHECKBOX_REGEX.test(optTxt) || req)) {
          fields.push({
            refId: assignRef(el),
            label: (getChoiceOptionLabel(el) || ctx.primaryLabel || "Checkbox").slice(0, 130),
            helperText: "",
            kind: "checkbox",
            inputType: "checkbox",
            required: true,
            flaggedInvalid: flagged,
            currentValue: "",
            errorMessage: errTxt,
            placeholder: "",
            options: ["true", "false"]
          });
        }
        continue;
      }

      if (el.tagName === "SELECT") {
        const hasVal = Boolean(el.value && el.selectedIndex > 0);
        if (!hasVal || flagged) {
          const validOpts = Array.from(el.options || [])
            .filter((o) => o.value !== "" && !o.disabled)
            .map((o) => (o.text || o.innerText || o.value || "").trim())
            .filter(Boolean);
          fields.push({
            refId: assignRef(el),
            label: (ctx.primaryLabel || el.name || el.id || "Select Dropdown").split("|")[0].trim(),
            helperText: (ctx.helperText || "").slice(0, 100),
            kind: "select",
            inputType: "select",
            required: req || flagged,
            flaggedInvalid: flagged,
            currentValue: hasVal ? (el.options[el.selectedIndex]?.text || el.value) : "",
            errorMessage: errTxt,
            placeholder: "",
            options: validOpts.slice(0, 24)
          });
        }
        continue;
      }

      const curVal = (el.value || "").trim();
      if (!flagged && curVal.length > 0) continue;
      if (!flagged && !req && isOptionalUnneededExtraField(el, ctx, req)) continue;
      if (!flagged && !req && /\bemployee\s*id\b|employeeid/i.test(`${ctx.primaryLabel} ${el.id || ""}`)) continue;

      fields.push({
        refId: assignRef(el),
        label: (ctx.primaryLabel || el.placeholder || el.name || el.id || "Application Field").split("|")[0].trim(),
        helperText: (ctx.helperText || "").slice(0, 120),
        kind: el.tagName === "TEXTAREA" ? "textarea" : "input",
        inputType: (el.type || "text").toLowerCase(),
        required: req || flagged,
        flaggedInvalid: flagged,
        currentValue: curVal.slice(0, 180),
        errorMessage: errTxt,
        placeholder: el.placeholder || "",
        maxLength: el.maxLength > 0 ? el.maxLength : null,
        options: []
      });
    }

    return {
      pageErrors,
      fields
    };
  }

  // Execute structured repair plan generated by Gemini AI Form Doctor directly on live DOM controls
  async function applyAiFormRepairs(repairs = [], diagnosticsFields = [], meta = {}, extraPayloads = {}) {
    let applied = 0;
    const fieldMap = new Map((diagnosticsFields || []).map((f) => [f.refId, f]));

    for (const rep of repairs) {
      if (!rep?.refId) continue;
      const el = document.querySelector(`[data-jobify-ref="${CSS.escape(rep.refId)}"]`);
      if (!el) continue;
      const info = fieldMap.get(rep.refId) || {};
      const valStr = String(rep.value ?? "").trim();

      try {
        el.scrollIntoView({ block: "nearest" });
      } catch (_) {}

      if (info.kind === "file" || el.type === "file") {
        const isCl = info.inputType === "cover_letter_file";
        const payload = isCl ? extraPayloads.coverLetterPdfPayload : extraPayloads.resumePdfPayload;
        if (payload?.base64) {
          const fname = isCl ? payload.fileName : payload.fileName || formatCompanyResumeFileName(meta?.company);
          if (await attachBase64PdfToInput(el, payload.base64, fname)) applied++;
        }
        continue;
      }

      if (info.kind === "checkbox" || rep.action === "check") {
        if (valStr.toLowerCase() === "false") continue;
        if (el.tagName === "INPUT" && el.type === "checkbox") {
          if (!el.checked && clickCheckboxOrRadioReliably(el)) {
            highlightFilledElement(el);
            applied++;
          }
        } else if (!isCustomOptionSelected(el)) {
          dispatchRealClick(el);
          highlightFilledElement(el);
          applied++;
        }
        continue;
      }

      if (info.kind === "select" || el.tagName === "SELECT") {
        if (valStr && selectBestOption(el, [valStr])) {
          applied++;
        } else {
          const validOpts = Array.from(el.options || []).filter((o) => o.value !== "" && !o.disabled);
          if (validOpts.length > 0 && setNativeValue(el, validOpts[0].value)) applied++;
        }
        continue;
      }

      if (info.kind === "combobox" || isComboboxInput(el)) {
        const ctx = getFieldContext(el);
        if (await fillComboboxControl(el, valStr ? [valStr] : null, ctx, meta, true)) {
          applied++;
        }
        continue;
      }

      if (info.kind === "radio_group") {
        if (el.tagName === "INPUT" && el.type === "radio") {
          const radios = el.name
            ? Array.from(document.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`))
            : [el];
          const wrappers = radios.map((r) => ({ radio: r, innerText: getChoiceOptionLabel(r) || r.value }));
          const chosen = (valStr && findMatchingOptionElement(wrappers, [valStr])) || wrappers[0];
          if (chosen?.radio && clickCheckboxOrRadioReliably(chosen.radio)) {
            highlightFilledElement(chosen.radio);
            applied++;
          }
        } else {
          const ariaRadios = Array.from(el.querySelectorAll("[role='radio']")).filter(isElementVisible);
          const wrappers = ariaRadios.map((r) => ({
            el: r,
            innerText: (r.innerText || r.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()
          }));
          const chosen = (valStr && findMatchingOptionElement(wrappers, [valStr])) || wrappers[0];
          if (chosen?.el) {
            dispatchRealClick(chosen.el);
            highlightFilledElement(chosen.el);
            applied++;
          }
        }
        continue;
      }

      if (info.kind === "checkbox_group") {
        const cbGroup = resolveCheckboxGroup(el, document);
        if (cbGroup?.checkboxes?.length) {
          const wrappers = cbGroup.checkboxes.map((cb) => ({ cb, innerText: getChoiceOptionLabel(cb) || cb.value }));
          const chosen = (valStr && findMatchingOptionElement(wrappers, [valStr])) || wrappers[0];
          if (chosen?.cb && !chosen.cb.checked && clickCheckboxOrRadioReliably(chosen.cb)) {
            highlightFilledElement(chosen.cb);
            applied++;
          }
        }
        continue;
      }

      if (info.kind === "button_group") {
        const btns = Array.from(el.querySelectorAll("button, [role='button']")).filter((b) => isElementVisible(b) && !b.disabled);
        const wrappers = btns.map((b) => ({
          btn: b,
          innerText: (b.innerText || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()
        }));
        const chosen = (valStr && findMatchingOptionElement(wrappers, [valStr])) || wrappers[0];
        if (chosen?.btn) {
          dispatchRealClick(chosen.btn);
          highlightFilledElement(chosen.btn);
          applied++;
        }
        continue;
      }

      // Default: text input / textarea (overwrites invalid formatted values as well as filling empty fields!)
      if (valStr) {
        if (setNativeValue(el, valStr)) {
          try {
            el.dataset.jobifyAiRepaired = "1";
            el.dispatchEvent(new Event("blur", { bubbles: true }));
          } catch (_) {}
          applied++;
        }
      }
      await sleep(35);
    }

    return applied;
  }

  // Self-healing pass invoked when clicking Next or Submit leaves validation errors or stays stuck on the form
  async function healFormValidationErrors(options = {}) {
    let stateResp = null;
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.id) {
        stateResp = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" });
      }
    } catch (_) {}
    const state = stateResp?.state;
    if (!state) return { healedCount: 0, remainingErrors: detectFormValidationErrors(document) };

    const profile = state.profile || {};
    const p = profile.personal || {};
    const meta = options.topJobMeta || extractJobMetadata(document);

    // 1. Run non-restrictive autofill pass first (catches unmarked open questions, custom controls & dropdowns)
    const baseFill = await runFrameAutofill({
      ...options,
      onlyNeededCleanMode: false,
      fillOpenEndedWithAI: true,
      includeAllUnresolvedOpenEnded: true
    });
    let healedCount = baseFill?.filledCount || 0;
    let aiRepairsApplied = 0;
    let analysisSummary = "";
    const repairedRefs = new Set();

    await sleep(120);

    // 2. Collect live form diagnostics (including CSS-in-JS / Tailwind red errors & rejected values!)
    const diagnostics = collectLiveFormDiagnostics(profile, meta, document);

    // Prepare Resume / Cover Letter payloads in case a file input was flagged
    let resumePdfPayload = null;
    if (diagnostics.fields.some((f) => f.kind === "file")) {
      try {
        const selectedResumeId = options.resumeChoice || state.settings?.defaultResumeVariant || "one_page";
        const pdfResp = await chrome.runtime.sendMessage({
          type: "GET_RESUME_PDF_BYTES",
          payload: { variantOrId: selectedResumeId, company: meta?.company || "" }
        });
        if (pdfResp?.ok) resumePdfPayload = pdfResp;
      } catch (_) {}
    }

    // 3. Invoke Gemini AI Form Error Doctor whenever any field is invalid/empty or page errors remain!
    if (diagnostics.fields.length > 0 || diagnostics.pageErrors.length > 0) {
      let doctorResp = null;
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.id) {
          doctorResp = await Promise.race([
            chrome.runtime.sendMessage({
              type: "DIAGNOSE_FORM_ERRORS",
              payload: {
                diagnostics,
                jobMeta: meta
              }
            }),
            sleep(15000).then(() => null)
          ]);
        }
      } catch (_) {}

      if (doctorResp?.ok && Array.isArray(doctorResp.diagnosis?.repairs) && doctorResp.diagnosis.repairs.length > 0) {
        analysisSummary = doctorResp.diagnosis.analysisSummary || "";
        for (const rep of doctorResp.diagnosis.repairs) {
          const rid = rep?.refId || rep?.ref;
          if (rid) repairedRefs.add(String(rid));
        }
        aiRepairsApplied = await applyAiFormRepairs(doctorResp.diagnosis.repairs, diagnostics.fields, meta, {
          resumePdfPayload,
          coverLetterPdfPayload: options.coverLetterPdfPayload || null
        });
        healedCount += aiRepairsApplied;
      }
    }

    await sleep(100);

    // 4. Deterministic safety net for any remaining invalid/required controls not covered above
    const isControlFlaggedInvalid = (el) => {
      if (!el) return false;
      if (el.getAttribute("aria-invalid") === "true") return true;
      try {
        if (typeof el.validity === "object" && el.validity && !el.validity.valid) return true;
      } catch (_) {}
      return Boolean(getControlValidationErrorText(el, null, true));
    };

    const allControls = Array.from(document.querySelectorAll("input, select, textarea"));
    for (const el of allControls) {
      if (isTrapOrSystemInput(el) || el.disabled) continue;
      if (el.type === "file" || el.type === "password") continue;
      if (!isVisibleAndEditable(el)) continue;
      if (repairedRefs.has(el.getAttribute("data-jobify-ref")) || el.dataset?.jobifyAiRepaired === "1") continue;

      const flagged = isControlFlaggedInvalid(el);
      if (!flagged && !isFieldRequired(el)) continue;

      if (el.type === "checkbox") {
        const cbGroup = resolveCheckboxGroup(el, document);
        if (cbGroup) {
          if (!cbGroup.checkboxes.some((c) => c.checked)) {
            const firstCb = cbGroup.checkboxes[0];
            if (firstCb && clickCheckboxOrRadioReliably(firstCb)) healedCount++;
          }
          continue;
        }
        const optTxt = `${getChoiceOptionLabel(el)} ${getFieldLabelText(el)}`;
        if (!el.checked && !NEGATIVE_CHECKBOX_REGEX.test(optTxt)) {
          if (clickCheckboxOrRadioReliably(el)) healedCount++;
        }
        continue;
      }

      if (isComboboxInput(el)) continue;

      const curVal = (el.value || "").trim();
      if (flagged && curVal) {
        const ctx = getFieldContext(el);
        const errLow = getControlValidationErrorText(el, null, true).toLowerCase();
        if (el.type === "tel" || /phone/i.test(ctx.fullLabel)) {
          const digits = p.phoneDigits || "7748108481";
          const altPhone =
            /10\s*digit|digits?\s*only|no\s*(spaces|dashes|parentheses)/i.test(errLow) || curVal.startsWith("+")
              ? digits
              : `+1${digits}`;
          if (altPhone !== curVal && setNativeValue(el, altPhone)) healedCount++;
        } else if (/leading\s*\$|with\s*\$|format\s+currency/i.test(errLow)) {
          const midNum = Number(meta?.compensation?.midpoint || 165000);
          const fmtUsd = `$${midNum.toLocaleString("en-US")}`;
          if (fmtUsd !== curVal && setNativeValue(el, fmtUsd)) healedCount++;
        } else if (/digits?\s*only|numbers?\s*only|numeric|no\s*\$|valid\s*number/i.test(errLow)) {
          const cleanDigits = String(meta?.compensation?.midpoint || "165000");
          if (cleanDigits !== curVal && setNativeValue(el, cleanDigits)) healedCount++;
        } else if ((el.type === "url" || /url|http/i.test(errLow)) && !/^https?:\/\//i.test(curVal)) {
          if (setNativeValue(el, `https://${curVal}`)) healedCount++;
        }
      } else if (!curVal && flagged && el.tagName !== "SELECT" && el.type !== "radio") {
        const fallbackVal =
          el.type === "url"
            ? p.linkedin || p.github || "https://github.com/ravitejav-dev"
            : el.type === "number"
              ? String(p.yearsOfExperienceInt || "3")
              : "Yes — authorized to work in the United States with 3.5+ years of production AI and software engineering experience.";
        if (setNativeValue(el, fallbackVal)) healedCount++;
      }
    }

    const postErrors = detectFormValidationErrors(document);
    const hardBlocker = detectHardBlockerChallenge(document);
    if (postErrors.hasErrors || hardBlocker.blocked) {
      const firstErrNode = document.querySelector(
        "[aria-invalid='true'], [data-automation-id='errorMessage'], .field-error, .ashby-application-form-field-error, iframe[src*='recaptcha' i], iframe[src*='hcaptcha' i]"
      );
      try {
        firstErrNode?.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (_) {}
    }

    return {
      healedCount,
      aiRepairsApplied,
      analysisSummary,
      diagnosedErrors: diagnostics.pageErrors,
      remainingErrors: postErrors,
      hardBlocker
    };
  }

  // Self-contained per-frame entrypoint invoked by service_worker RUN_TAB_AUTOFILL across all frames (top + embedded ATS iframes)
  async function runFrameAutofill(options = {}) {
    let stateResp = null;
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.id) {
        stateResp = await chrome.runtime.sendMessage({ type: "GET_ALL_STATE" });
      }
    } catch (_) {}
    const state = stateResp?.state;
    if (!state) return { filledCount: 0, filledFieldsLog: [] };

    const hasFileInputs = Array.from(document.querySelectorAll("input[type='file']")).some(isActionableFileInput);
    let resumePdfPayload = null;
    if (hasFileInputs && state.settings?.autoAttachResumePdf !== false) {
      const selectedResumeId = options.resumeChoice || state.settings?.defaultResumeVariant || "one_page";
      const frameCompany = (options.topJobMeta || extractJobMetadata(document))?.company || "";
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.id) {
          const pdfResp = await chrome.runtime.sendMessage({
            type: "GET_RESUME_PDF_BYTES",
            payload: { variantOrId: selectedResumeId, company: frameCompany }
          });
          if (pdfResp?.ok) resumePdfPayload = pdfResp;
        }
      } catch (_) {}
    }

    const latestCl =
      options.coverLetterRecord ||
      (options.onlyMatchingCoverLetter
        ? (state.coverLetters || []).find((c) => c.url && location.href.startsWith(c.url.split("?")[0]))
        : (state.coverLetters || [])[0]) ||
      null;

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
      sequentialOneByOne: Boolean(options.sequentialOneByOne),
      onlyNeededCleanMode: Boolean(options.onlyNeededCleanMode),
      includeAllUnresolvedOpenEnded: Boolean(options.includeAllUnresolvedOpenEnded),
      jobMeta: options.topJobMeta || null
    });
  }

  window.__JOBIFY_ADAPTERS__ = {
    detectATSPlatform,
    formatCompanyResumeFileName,
    extractCompensationFromJob,
    extractJobMetadata,
    isFieldRequired,
    resolveDesiredValueForField,
    resolveDesiredValueForLabel,
    setNativeValue,
    clickCheckboxOrRadioReliably,
    getChoiceOptionLabel,
    getFieldContext,
    getFieldLabelText,
    findOpenEndedFields,
    extractFormFieldsInventory,
    collectLiveFormDiagnostics,
    attachBase64PdfToInput,
    autofillPortalAuth,
    performAutonomousAuth,
    findEmailAuthChoiceButton,
    detectEmailVerificationBanner,
    detectOtpChallenge,
    fillOtpChallengeAndSubmit,
    findApplyModalChoiceButton,
    clickApplyEntryButton,
    findWizardButtons,
    clickWizardNextOrSubmit,
    detectSubmissionConfirmation,
    detectFormValidationErrors,
    detectHardBlockerChallenge,
    healFormValidationErrors,
    inspectAutonomousScreenState,
    ensureApplicationFormOpen,
    runFullAutofill,
    runFrameAutofill
  };
})();
