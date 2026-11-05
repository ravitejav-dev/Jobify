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
    if (u.includes("smartrecruiters.com") || doc.querySelector("oc-application, [class*='smartrecruiters']")) return "SmartRecruiters";
    if (u.includes("icims.com") || doc.querySelector("#icims_content_iframe, iframe[src*='icims.com']")) return "iCIMS";
    if (u.includes("rippling.com") || u.includes("ats.rippling.com")) return "Rippling";
    if (u.includes("bamboohr.com")) return "BambooHR";
    if (u.includes("workable.com")) return "Workable";
    if (u.includes("jobvite.com")) return "Jobvite";
    if (u.includes("oraclecloud.com") && /hcmui|candidateexperience|recruiting/i.test(u)) return "Oracle Cloud HCM";
    if (u.includes("successfactors.com") || u.includes("successfactors.eu") || u.includes("jobs2web.com")) return "SAP SuccessFactors";
    if (u.includes("taleo.net")) return "Taleo";
    if (u.includes("ultipro.com") || u.includes("recruiting.ultipro") || u.includes("ukg.net")) return "UKG";
    if (u.includes("dayforcehcm.com") || u.includes("ceridian.com")) return "Dayforce";
    if (u.includes("workforcenow.adp.com") || u.includes("myjobs.adp.com")) return "ADP";
    if (u.includes("eightfold.ai") || doc.querySelector("[data-test-id*='eightfold' i], [class*='eightfold']")) return "Eightfold AI";
    if (u.includes("phenompeople.com") || doc.querySelector("meta[name*='phenom' i], [data-ph-at-id]")) return "Phenom";
    if (u.includes("avature.net")) return "Avature";
    if (u.includes("applytojob.com") || u.includes("jazzhr.com")) return "JazzHR";
    if (u.includes("breezy.hr")) return "Breezy HR";
    if (u.includes("recruitee.com")) return "Recruitee";
    if (u.includes("pinpointhq.com")) return "Pinpoint";
    if (u.includes("dover.com") || u.includes("dover.io")) return "Dover";
    if (u.includes("jobs.gem.com") || u.includes("gem.com/jobs")) return "Gem";
    if (u.includes("teamtailor.com")) return "Teamtailor";
    if (u.includes("personio.de") || u.includes("personio.com")) return "Personio";
    if (u.includes("jobdiva.com")) return "JobDiva";
    if (u.includes("ceipal.com")) return "Ceipal";
    if (u.includes("bullhornstaffing.com") || u.includes("bullhorn.com")) return "Bullhorn";
    if (u.includes("amazon.jobs")) return "Amazon Jobs";
    if (u.includes("google.com/about/careers")) return "Google Careers";
    if (u.includes("jobs.apple.com")) return "Apple Jobs";
    if (u.includes("metacareers.com")) return "Meta Careers";
    if (u.includes("careers.microsoft.com") || u.includes("jobs.careers.microsoft.com")) return "Microsoft Careers";
    if (u.includes("linkedin.com/jobs")) return "LinkedIn";
    if (u.includes("wellfound.com")) return "Wellfound";
    if (u.includes("indeed.com")) return "Indeed";
    if (u.includes("dice.com")) return "Dice";
    return "Career Portal";
  }

  function extractJobPostingJsonLd(doc = document) {
    try {
      const scripts = Array.from(doc.querySelectorAll("script[type='application/ld+json']"));
      for (const s of scripts) {
        const raw = (s.textContent || "").trim();
        if (!raw || !/JobPosting/i.test(raw)) continue;
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          continue;
        }
        const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item || typeof item !== "object") continue;
          if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
          const t = item["@type"];
          const isJob = Array.isArray(t) ? t.some((x) => /JobPosting/i.test(String(x))) : /JobPosting/i.test(String(t || ""));
          if (!isJob) continue;
          const orgName =
            typeof item.hiringOrganization === "string"
              ? item.hiringOrganization
              : item.hiringOrganization?.name || "";
          const locObj = Array.isArray(item.jobLocation) ? item.jobLocation[0] : item.jobLocation;
          const addr = locObj?.address || {};
          const locStr = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
            .filter((x) => typeof x === "string" && x.trim())
            .join(", ");
          const rawDesc = String(item.description || "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|li|div|h[1-6])>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/\s+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          return {
            title: String(item.title || "").trim(),
            company: String(orgName || "").trim(),
            location: locStr || ( /TELECOMMUTE/i.test(String(item.jobLocationType || "")) ? "Remote" : "" ),
            description: rawDesc
          };
        }
      }
    } catch (_) {}
    return null;
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
        const rawHr = `$${minH}/hr - $${maxH}/hr`;
        return {
          type: "hourly",
          minHourly: minH,
          maxHourly: maxH,
          targetHourly: midH,
          midpoint: midH,
          raw: rawHr,
          displayHourly: `$${midH}/hr`,
          displayHourlyRange: rawHr
        };
      }
    }
    const hrSingleMatch = src.match(/\$\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:\/\s*hr|\/\s*hour|per\s+hour|hourly)/i);
    if (hrSingleMatch) {
      const h = Math.round(parseFloat(hrSingleMatch[1]));
      if (h >= 20 && h <= 350) {
        const rawHr = `$${h}/hr`;
        return {
          type: "hourly",
          minHourly: h,
          maxHourly: h,
          targetHourly: h,
          midpoint: h,
          raw: rawHr,
          displayHourly: rawHr,
          displayHourlyRange: rawHr
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
        const rawAnnual = `$${minA.toLocaleString()} - $${maxA.toLocaleString()}`;
        return {
          type: "annual",
          minAnnual: minA,
          maxAnnual: maxA,
          targetAnnual: midA,
          midpoint: midA,
          raw: rawAnnual,
          displayAnnual: `$${midA.toLocaleString()}`,
          displayAnnualRange: rawAnnual,
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
        const rawAnnual = `$${minA.toLocaleString()} - $${maxA.toLocaleString()}`;
        return {
          type: "annual",
          minAnnual: minA,
          maxAnnual: maxA,
          targetAnnual: midA,
          midpoint: midA,
          raw: rawAnnual,
          displayAnnual: `$${midA.toLocaleString()}`,
          displayAnnualRange: rawAnnual,
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
        pageType: "other",
        hasCandidateForm: false,
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
    const jsonLdJob = extractJobPostingJsonLd(doc);

    let company = "";
    const metaSite = doc.querySelector("meta[property='og:site_name']")?.content?.trim();
    const companyEl = doc.querySelector(
      "[data-company-name], .company-name, .app-title + .company-name, [data-automation-id='companyName'], .posting-categories .company, [data-jobify-company]"
    );
    if (companyEl?.textContent?.trim()) {
      company = companyEl.textContent.trim();
    } else if (jsonLdJob?.company) {
      company = jsonLdJob.company;
    } else if (metaSite && !/greenhouse|lever|workday|ashby|linkedin|smartrecruiters|icims|workable/i.test(metaSite)) {
      company = metaSite;
    } else {
      const ghForMatch = url.match(/[?&]for=([^&#]+)/i);
      const ghMatch = url.match(/greenhouse\.io\/([^/?#]+)/i);
      const levMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/i);
      const ashMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i);
      const wdMatch = url.match(/\/\/([^.]+)\.wd\d*\.myworkdayjobs\.com/i);
      const srMatch = url.match(/jobs\.smartrecruiters\.com\/([^/?#]+)/i);
      const wkMatch = url.match(/apply\.workable\.com\/([^/?#]+)/i);
      const rawSlug =
        ghForMatch?.[1] ||
        (ghMatch?.[1] !== "embed" ? ghMatch?.[1] : "") ||
        levMatch?.[1] ||
        ashMatch?.[1] ||
        wdMatch?.[1] ||
        srMatch?.[1] ||
        wkMatch?.[1] ||
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
      "[data-jobify-title], h1.app-title, .job__title h1, .posting-headline h2, [data-automation-id='jobPostingHeader'], .job-details-jobs-unified-top-card__job-title, [data-ph-at-id='job-title'], h1"
    );
    let title =
      titleEl?.textContent?.trim() ||
      jsonLdJob?.title ||
      doc.title.split(/\s(?:[-|–—]|@)\s/)[0]?.trim() ||
      "Software / AI Engineer";
    title = title.replace(/\s+/g, " ").slice(0, 140);

    const locEl = doc.querySelector(
      "[data-jobify-location], .job__location, .location, .posting-categories .location, [data-automation-id='locations'], [data-ph-at-id='job-location'], [class*='location']"
    );
    const locationStr = (locEl?.textContent?.replace(/\s+/g, " ").trim() || jsonLdJob?.location || "").slice(0, 100);

    const jdSelectors = [
      "[data-jobify-jd]",
      ".job__description",
      "#content .content",
      "#grnhse_app",
      "[data-automation-id='jobPostingDescription']",
      ".posting-page .section-wrapper",
      ".jobs-description__content",
      "[data-ph-at-id='jobdescription-text']",
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
    if (!description && jsonLdJob?.description?.length > 120) {
      description = jsonLdJob.description;
    }
    if (!description) {
      description = (doc.body?.innerText || "").slice(0, 12000);
    }

    const combinedJobText = `${title}\n${locationStr}\n${description}`;
    const compensation = extractCompensationFromJob(combinedJobText);
    const mentionsCoverLetter = doesJobMentionCoverLetter(description);

    const uLow = url.toLowerCase();
    const hasPasswordInput = queryAllDeep(doc, "input[type='password']").some(isVisibleAndEditable);
    const hasFileUpload = queryAllDeep(doc, "input[type='file']").some(isActionableFileInput);
    const hasEmbeddedAtsIframe = Boolean(
      doc.querySelector("iframe[src*='greenhouse.io'], iframe[src*='ashbyhq.com'], iframe[src*='lever.co'], iframe[src*='workday'], iframe[src*='icims.com'], iframe[src*='smartrecruiters.com'], #icims_content_iframe, #grnhse_iframe")
    );
    const hasCandidateForm = hasFileUpload || hasEmbeddedAtsIframe || hasRealCandidateFormFields(doc);
    const isCareerUrl =
      ats !== "Career Portal" ||
      Boolean(jsonLdJob) ||
      /\/(jobs?|careers?|apply|application|positions?|openings?|postings?|requisitions?|opportunities|talent|sandbox|login|signin|sign-in|register|signup|auth|oauth)\b/i.test(uLow);
    const hasApplyElements =
      hasCandidateForm ||
      Boolean(jsonLdJob) ||
      Boolean(doc.querySelector("[data-jobify-apply-btn], [data-automation-id='adventureButton'], [data-automation-id='jobPostingHeader']"));
    const hasNonPasswordAuthGate =
      !hasFileUpload &&
      !hasCandidateForm &&
      (isOAuthProviderScreen(doc) ||
        Boolean(findEmailAuthChoiceButton(doc)) ||
        Boolean(detectEmailFirstAuthStep(doc)) ||
        Boolean(findSsoProviderChoiceButton(doc)));
    const isAuthWall =
      (hasPasswordInput &&
        (isCareerUrl ||
          Boolean(doc.querySelector("[data-automation-id*='password'], [data-automation-id*='signIn'], [data-jobify-auth]")))) ||
      hasNonPasswordAuthGate;

    // Distinguish directory/search boards from specific job postings & active forms (Simplify Copilot pattern)
    const isRootBoardUrl =
      /^https?:\/\/(boards|job-boards)\.greenhouse\.io\/[^/?#]+\/?(\?.*)?$/i.test(url) ||
      /^https?:\/\/jobs\.lever\.co\/[^/?#]+\/?(\?.*)?$/i.test(url) ||
      /^https?:\/\/jobs\.ashbyhq\.com\/[^/?#]+\/?(\?.*)?$/i.test(url) ||
      (/myworkdayjobs\.com/i.test(url) && !/\/job\/|\/apply/i.test(uLow) && !doc.querySelector("[data-automation-id='jobPostingHeader']") && !uLow.includes("sandbox")) ||
      (/linkedin\.com\/jobs/i.test(url) && !/currentjobid=|\/jobs\/view\//i.test(uLow));

    const isGenericDirectoryTitle =
      !hasCandidateForm &&
      !isAuthWall &&
      !jsonLdJob &&
      !uLow.includes("sandbox") &&
      /^(search(\s+for)?\s+jobs?|careers?(\s+at\s+.+)?|open\s+(roles|positions)|all\s+openings|job\s+(openings|search)|join\s+(our\s+team|us))$/i.test(
        title.trim()
      );

    const isJobBoard = !hasCandidateForm && !isAuthWall && (isRootBoardUrl || isGenericDirectoryTitle);
    const isRelevantPage = isCareerUrl || hasApplyElements;
    const pageType = !isRelevantPage
      ? "other"
      : isAuthWall
        ? "auth_wall"
        : hasCandidateForm
          ? "application_form"
          : isJobBoard
            ? "job_board"
            : "job_posting";

    return {
      isRelevantPage,
      pageType,
      hasCandidateForm,
      isAuthWall,
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

  // React 16-19 / Angular / Vue native value setter (MV3 Isolated-World safe + React 17/18/19 focusout blur validation)
  function setNativeValue(el, value) {
    if (!el || value === undefined || value === null) return false;
    const strVal = String(value);
    try {
      el.focus();
      el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    } catch (_) {}

    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    const prevValue = el.value;

    // In Chrome MV3 Isolated World, el._valueTracker is undefined (owned by MAIN-world React).
    // When overwriting an existing/pre-filled value, briefly clear to "" + fire input so MAIN-world React _valueTracker always registers a real transition.
    if (
      prevValue &&
      !(el instanceof HTMLSelectElement) &&
      el.type !== "checkbox" &&
      el.type !== "radio" &&
      el.type !== "file"
    ) {
      if (desc?.set) {
        desc.set.call(el, "");
      } else {
        el.value = "";
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
    }

    if (desc?.set) {
      desc.set.call(el, strVal);
    } else {
      el.value = strVal;
    }

    if (el._valueTracker) {
      el._valueTracker.setValue(prevValue === strVal ? "" : prevValue);
    }

    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: strVal, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    // React 17/18/19 delegates onBlur (e.g. Workday password policy validator) via FocusEvent('focusout', { bubbles: true }) + real blur()
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    try {
      el.blur();
    } catch (_) {}
    highlightFilledElement(el);
    return true;
  }

  const COOKIE_CONSENT_SELECTOR =
    "#onetrust-consent-sdk, [id*='onetrust' i], [class*='onetrust' i], #CybotCookiebotDialog, [id*='cookiebot' i], [id*='cookie-banner' i], [class*='cookie-consent' i], .osano-cm-window, #truste-consent-track";

  function dispatchRealClick(el) {
    if (!el) return;
    let clientX = 0;
    let clientY = 0;
    try {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        clientX = Math.round(r.left + r.width / 2);
        clientY = Math.round(r.top + r.height / 2);
      }
    } catch (_) {}
    const opts = { bubbles: true, cancelable: true, view: window, button: 0, clientX, clientY };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
  }

  function isCheckboxOrRadioChecked(el) {
    if (!el) return false;
    return Boolean(el.checked) && el.getAttribute("aria-checked") !== "false";
  }

  function clickCheckboxOrRadioReliably(el) {
    if (!el) return false;
    if (isCheckboxOrRadioChecked(el)) return true;
    // Step 1: Single native .click() first (avoids mousedown + click double-toggling custom React/MUI wrappers)
    try {
      el.click();
    } catch (_) {}
    if (isCheckboxOrRadioChecked(el)) return true;

    // Step 2: Click explicit <label for="...">
    if (el.id) {
      const explicitLbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicitLbl) {
        try {
          explicitLbl.click();
        } catch (_) {
          dispatchRealClick(explicitLbl);
        }
      }
    }
    if (isCheckboxOrRadioChecked(el)) return true;

    // Step 3: Click ancestor <label> or sibling custom checkbox visual box
    const parentLbl = el.closest("label");
    if (parentLbl) {
      try {
        parentLbl.click();
      } catch (_) {
        dispatchRealClick(parentLbl);
      }
    }
    if (isCheckboxOrRadioChecked(el)) return true;

    const customBox = el.parentElement?.querySelector?.("[class*='checkbox' i], [data-automation-id*='checkbox' i]");
    if (customBox && customBox !== el) {
      try {
        customBox.click();
      } catch (_) {}
    }
    if (isCheckboxOrRadioChecked(el)) return true;

    // Step 4: Native HTMLInputElement prototype checked setter + React input/change events
    const checkedDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
    if (checkedDesc?.set) {
      checkedDesc.set.call(el, true);
    } else {
      el.checked = true;
    }
    el.dispatchEvent(new Event("click", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
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
    const ident = `${el.id || ""} ${el.name || ""} ${el.dataset?.automationId || ""} ${typeof el.className === "string" ? el.className : ""} ${el.getAttribute?.("placeholder") || ""} ${el.getAttribute?.("aria-label") || ""}`;
    if (
      /recaptcha|hcaptcha|turnstile|honeypot|beecatcher|_gotcha|spambot|antispam|bot[-_]?field|trap[-_]?field|confirm[-_]?human|keywordsearch|locationsearch|jobalert|job[-_]?alert|talent[-_]?network|newsletter/i.test(
        ident
      )
    ) {
      return true;
    }
    // Check explicit or wrapping <label> for anti-bot honeypot instructions (e.g. Workday: "Enter website. This input is for robots only, do not enter if you're human.")
    let lblTxt = "";
    try {
      if (el.id && el.ownerDocument) {
        const expLbl = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (expLbl) lblTxt += ` ${expLbl.textContent || ""}`;
      }
      const wrapLbl = el.closest?.("label");
      if (wrapLbl) lblTxt += ` ${wrapLbl.textContent || ""}`;
    } catch (_) {}
    if (
      lblTxt &&
      /for\s+robots\s+only|do\s+not\s+(enter|fill|complete)(\s+if\s+you'?re\s+human)?|if\s+you('?re|\s+are)\s+human|leave\s+this\s+(field\s+)?(blank|empty)|bot\s+trap|honeypot/i.test(
        lblTxt
      )
    ) {
      return true;
    }
    // intl-tel-input country search input inside phone flag dropdown
    if (/^iti-\d+__search-input$/i.test(el.id || "")) return true;
    // Site-wide header/navbar/footer search, talent-network, or newsletter boxes
    if (
      el.closest(
        "header, nav, footer, [role='navigation'], [role='search'], [role='banner'], [role='contentinfo'], [class*='talent-network' i], [id*='talent-network' i], [class*='job-alert' i], [id*='job-alert' i]"
      )
    ) {
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
    const nextAncestor = (node) => {
      if (!node) return null;
      if (node.parentElement) return node.parentElement;
      const root = node.getRootNode?.();
      return root && root instanceof ShadowRoot ? root.host : null;
    };
    let cur = nextAncestor(el);
    while (cur && cur !== document.documentElement) {
      // Allow localized hidden dropzone wrappers around <input type="file"> (e.g. React-Dropzone, Workday, Lever, Rippling)
      // while still rejecting hidden modals, hidden wizard steps/forms, or collapsed tabpanels containing other inputs.
      const isLocalizedFileWrapper =
        el.type === "file" &&
        !cur.matches?.("form, fieldset, [role='dialog'], [role='tabpanel'], [aria-modal='true'], details:not([open])") &&
        !cur.querySelector?.("input:not([type='file']):not([type='hidden']), select, textarea");
      if (!isLocalizedFileWrapper) {
        if (cur.hidden) return true;
        if (cur.getAttribute?.("aria-hidden") === "true" && cur.matches?.("[role='dialog'], [role='tabpanel']")) {
          return true;
        }
        const cs = window.getComputedStyle(cur);
        if (cs.display === "none" || cs.visibility === "hidden") return true;
      }
      cur = nextAncestor(cur);
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
    const isChoiceOrSpecial =
      el.type === "file" || el.type === "checkbox" || el.type === "radio" || isComboboxInput(el);
    if (parseFloat(style.opacity) === 0 && !isChoiceOrSpecial) {
      return false;
    }
    // Reject 1px x 1px / CSS-clipped / off-screen honeypot inputs (e.g. Workday clip: rect(1px,1px,1px,1px) / polygon(0px 0px...))
    if (!isChoiceOrSpecial) {
      const clipStr = `${style.clip || ""} ${style.clipPath || ""}`.toLowerCase();
      if (
        /rect\(\s*[01]px/i.test(clipStr) ||
        /inset\(\s*(50%|100%)/i.test(clipStr) ||
        /polygon\(\s*0(px|%)?\s+0(px|%)?,\s*0(px|%)?\s+0(px|%)?/i.test(clipStr)
      ) {
        return false;
      }
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && el.type !== "file") {
      if (el.type === "radio" || el.type === "checkbox") {
        const root = el.getRootNode?.() || document;
        const proxyEl =
          (el.id && root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`)) ||
          el.closest("label") ||
          el.parentElement;
        const pStyle = proxyEl ? window.getComputedStyle(proxyEl) : null;
        const pRect = proxyEl?.getBoundingClientRect?.();
        if (
          !pRect ||
          (pRect.width === 0 && pRect.height === 0) ||
          pStyle?.display === "none" ||
          pStyle?.visibility === "hidden"
        ) {
          return false;
        }
      } else {
        return false;
      }
    }
    const docRight = rect.right + (window.scrollX || window.pageXOffset || 0);
    const docBottom = rect.bottom + (window.scrollY || window.pageYOffset || 0);
    if (!isChoiceOrSpecial && (rect.width <= 4 || rect.height <= 4 || docRight < -50 || docBottom < -2500)) {
      return false;
    }
    return true;
  }

  // Extract structured { primaryLabel, helperText, fullLabel } so helper prose or radio "Yes"/"No" option labels never hijack primary label intent
  function getFieldContext(el) {
    if (!el) return { primaryLabel: "", helperText: "", fullLabel: "" };
    const primaryParts = [];
    const helperParts = [];
    const rootNode = el.getRootNode?.() || document;
    const shadowHost = rootNode instanceof ShadowRoot ? rootNode.host : null;
    const isRadioChoice = el.type === "radio" || el.getAttribute?.("role") === "radio";
    const PLACEHOLDER_LABEL_RE = /^(select(\s+one)?|please\s+select|choose(\s+one)?|--\s*select\s*--|toggle\s+flyout)$/i;

    if (!isRadioChoice) {
      if (el.id) {
        const explicitLabel =
          rootNode.querySelector?.(`label[for="${CSS.escape(el.id)}"]`) ||
          document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (explicitLabel) primaryParts.push(explicitLabel.innerText || explicitLabel.textContent);
      }
      const parentLabel = el.closest("label") || shadowHost?.closest?.("label");
      if (parentLabel) primaryParts.push(parentLabel.innerText || parentLabel.textContent);
    }

    const ariaLabelledBy = el.getAttribute("aria-labelledby") || shadowHost?.getAttribute?.("aria-labelledby");
    if (ariaLabelledBy) {
      for (const id of ariaLabelledBy.split(/\s+/)) {
        const ref = rootNode.getElementById?.(id) || document.getElementById(id);
        if (!ref || ref === el) continue;
        const refTxt = String(ref.innerText || ref.textContent || "").replace(/\s+/g, " ").trim();
        if (refTxt && !PLACEHOLDER_LABEL_RE.test(refTxt) && !(isRadioChoice && /^(yes|no|true|false)$/i.test(refTxt))) {
          primaryParts.push(refTxt);
        }
      }
    }

    const ariaLabel = el.getAttribute("aria-label") || shadowHost?.getAttribute?.("aria-label") || shadowHost?.getAttribute?.("label");
    if (ariaLabel && !PLACEHOLDER_LABEL_RE.test(ariaLabel.trim()) && !(isRadioChoice && /^(yes|no|true|false)$/i.test(ariaLabel.trim()))) {
      primaryParts.push(ariaLabel);
    }

    const containerSelector =
      ".ashby-application-form-field-entry, [class*='fieldEntry'], .text-input-wrapper, .select, .field, .form-group, .application-question, [data-automation-id*='formField'], [data-automation-id*='question' i], [data-uxi-widget-type*='question' i], [role='radiogroup'], [data-jobify-field], fieldset";
    const fieldContainer = el.closest(containerSelector) || shadowHost?.closest?.(containerSelector);
    if (fieldContainer) {
      const groupAriaLblBy = fieldContainer.getAttribute("aria-labelledby");
      if (groupAriaLblBy) {
        for (const gid of groupAriaLblBy.split(/\s+/)) {
          const gref = rootNode.getElementById?.(gid) || document.getElementById(gid);
          if (gref && gref !== el) {
            const gtxt = String(gref.innerText || gref.textContent || "").replace(/\s+/g, " ").trim();
            if (gtxt && !PLACEHOLDER_LABEL_RE.test(gtxt)) primaryParts.push(gtxt);
          }
        }
      }
      const groupAriaLbl = fieldContainer.getAttribute("aria-label");
      if (groupAriaLbl && !PLACEHOLDER_LABEL_RE.test(groupAriaLbl.trim())) {
        primaryParts.push(groupAriaLbl);
      }

      // Prioritise group/question prompt elements (legend, formLabel, Workday richText, question titles) over option <label>s!
      const promptCandidates = Array.from(
        fieldContainer.querySelectorAll(
          "legend, [data-automation-id='formLabel'], [data-automation-id='richText'], .ashby-application-form-question-title, .field-label, .question-label, h3, h4, label"
        )
      );
      for (const cand of promptCandidates) {
        if (cand.tagName === "LABEL") {
          const forId = cand.getAttribute("for");
          if (forId && el.id && forId !== el.id) {
            const targetInput = rootNode.getElementById?.(forId) || document.getElementById(forId);
            if (targetInput && (targetInput.type === "radio" || targetInput.type === "checkbox")) continue;
          }
          if (isRadioChoice && (cand.contains(el) || cand.querySelector("input[type='radio'], input[type='checkbox']"))) {
            continue;
          }
          if (isRadioChoice && forId) {
            const targetInput = rootNode.getElementById?.(forId) || document.getElementById(forId);
            if (targetInput && targetInput.type === "radio") continue;
          }
        }
        const cTxt = String(cand.innerText || cand.textContent || "").replace(/\s+/g, " ").trim();
        if (!cTxt || PLACEHOLDER_LABEL_RE.test(cTxt)) continue;
        if (isRadioChoice && /^(yes|no|true|false)$/i.test(cTxt)) continue;
        primaryParts.push(cTxt);
        break;
      }

      const descEl = fieldContainer.querySelector(
        "[id$='-description'], .ashby-application-form-question-description, .field-description, p"
      );
      if (descEl) {
        const dTxt = String(descEl.innerText || descEl.textContent || "").replace(/\s+/g, " ").trim();
        if (dTxt) {
          if (primaryParts.length === 0) primaryParts.push(dTxt);
          else helperParts.push(dTxt);
        }
      }
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
      if (el.placeholder && !PLACEHOLDER_LABEL_RE.test(el.placeholder.trim())) primaryParts.push(el.placeholder);
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
    if (
      node.querySelector?.(
        ".required, [class*='required'], [aria-label*='required' i], abbr[title*='required' i], [data-automation-id='required'], [data-automation-id='asterisk']"
      )
    ) {
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
      ".select-shell, .field, .form-group, .application-question, .ashby-application-form-field-entry, [class*='fieldEntry'], [data-automation-id*='formField'], [data-automation-id*='question' i], fieldset"
    );
    if (wrapper) {
      if (hasCssRequiredMarker(wrapper)) return true;
      if (
        wrapper.querySelector(
          "input[required], select[required], textarea[required], [aria-required='true'], [aria-invalid='true'], abbr[title*='required' i], [data-automation-id='required']"
        )
      ) {
        return true;
      }
      const lbl = wrapper.querySelector(
        "label, legend, [data-automation-id='formLabel'], [data-automation-id='richText'], .field-label, .label, .ashby-application-form-question-title"
      );
      if (lbl && (/\*/.test(lbl.textContent || "") || hasCssRequiredMarker(lbl))) return true;
    }
    return false;
  }

  // Deterministic binary Yes/No polarity classifier when options are strictly ["Yes", "No"] and AI is offline or timed out
  function resolveBinaryYesNoFallback(labelRaw, profile = {}) {
    const q = String(labelRaw || "").toLowerCase();
    const eeo = profile?.workAuthAndEEO || {};
    if (!q) return ["Yes"];
    if (/sponsorship|require.*visa|need.*visa|future.*visa/i.test(q)) {
      return [eeo.requireSponsorship || "Yes"];
    }
    if (/authorized\s*to\s*work|legally\s*authorized|eligible\s*to\s*work|right\s*to\s*work/i.test(q)) {
      return [eeo.authorizedUS || "Yes"];
    }
    if (
      /previously\s*(worked|employed|contracted|interned)|former\s*(employee|contractor|intern|worker)|currently\s*(employed|working)\s*(at|by|for)|relativ|family\s*member|conflict\s*of\s*interest|non[- ]?compet|non[- ]?solicit|restrictive\s*covenant|bound\s*by|prevent.*working|government\s*(official|employee|agency)|public\s*official|security\s*clearanc|active\s*clearanc|deloitte|pwc|pricewaterhouse|kpmg|ernst|auditor|\bu\.?s\.?\s*(citizen|person)\b|permanent\s*resident|felon|convict|criminal|debar|sanction|embargo|suspend|terminat|disciplin|currently\s*enrolled|full[- ]time\s*student|hispanic|latino|transgender|disabil|veteran/i.test(
        q
      )
    ) {
      return ["No"];
    }
    return ["Yes"];
  }

  function isBinaryYesNoOptionList(optionLabels = []) {
    const cleaned = (optionLabels || [])
      .map((s) => String(s || "").replace(/\s+/g, " ").trim())
      .filter((s) => s && !/^(select(\s+one)?|please\s+select|choose(\s+one)?|--)/i.test(s));
    if (cleaned.length < 2 || cleaned.length > 3) return false;
    const hasYes = cleaned.some((s) => /^(yes|true|i\s+agree|i\s+confirm|yes,?\s+)/i.test(s));
    const hasNo = cleaned.some((s) => /^(no|false|i\s+do\s+not\s+agree|no,?\s+)/i.test(s));
    return hasYes && hasNo;
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
    if (/^if\s+(yes|no|other|applicable|so|you\s+selected|you\s+answered)\b/i.test(pLow.trim()) && !isFieldRequired(el, ctx)) {
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

    // 1. Legal / Arbitration / Consent / AI Policy / Sanctions / Export Control / Government / Auditor / Clearance / Non-Compete / Age / Background Check
    if (
      /arbitrat|read\s+the\s+.*agreement|terms\s+of\s+the\s+agreement|confirm\s+i\s+have\s+read|read\s+and\s+underst(ood|and)|certify\s+that.*?(true|accurate|complete)|acknowledge\s+and\s+agree|privacy\s+(notice|policy|statement)|consent\s+to\s+(electronic|receive|processing|data)/i.test(
        pLow
      )
    ) {
      return [
        "I understand and agree",
        "I will read the arbitration agreement",
        "I confirm",
        "I agree",
        "I acknowledge",
        "Yes"
      ];
    }
    if (/\bai\s+policy\b/i.test(pLow)) {
      return ["Yes", "I agree", "I acknowledge"];
    }
    if (
      /sanctions|embargo|cuba|iran|north\s*korea|syria|crimea|citizen\s+or\s+resident\s+of\s+any\s+country\s+subject/i.test(
        `${pLow} ${hLow}`
      )
    ) {
      return ["None of the above", "No"];
    }
    if (/\bu\.?s\.?\s*person\b|export\s+control.*?(citizen|permanent\s*resident|asylee|refugee)/i.test(`${pLow} ${hLow}`)) {
      return [eeo.requireSponsorship === "Yes" ? "No" : "Yes", "No"];
    }
    if (/export\s+controls?/i.test(`${pLow} ${hLow}`)) {
      return ["None of the above", "No"];
    }
    if (
      /relatives?\s*(employed|working|at|who\s*work)|family\s*members?\s*(employed|working|at|who\s*work)|immediate\s*family|related\s+to\s+any(one|\s+employee|\s+director|\s+officer|\s+board)|close\s+personal\s+relationship|conflict\s+of\s+interest/i.test(
        pLow
      )
    ) {
      return [eeo.relativesAtCompany || "No", "No", "None"];
    }
    if (/security\s*clearance|active\s*clearance|hold.*clearance/i.test(pLow)) {
      return [eeo.securityClearance || eeo.governmentOrClearance || "No", "No", "None"];
    }
    if (
      /government\s*(employee|official|agency|employment|service|entity)|public\s*official|worked\s*for\s*(the\s*)?(u\.?s\.?\s*|federal\s*|state\s*|foreign\s*)?government|revolving\s*door|current\s*or\s*former.*?(auditor|deloitte|pwc|pricewaterhouse|ernst\s*(&|and)\s*young|\bey\b|kpmg)|employed\s+by.*?(deloitte|pwc|ernst|kpmg)/i.test(
        pLow
      )
    ) {
      return [eeo.governmentOrClearance || "No", "No", "None"];
    }
    if (
      /non-?compete|non-?solicitation|restrictive\s*covenant|post-?employment\s*(restriction|obligation|agreement)|bound\s+by\s+any\s+(agreements?|contracts?|obligations?)|restrict\s+your\s+ability\s+to\s+work|prevent\s+or\s+restrict\s+you\s+from\s+working|contractual\s+(obligation|restriction)/i.test(
        pLow
      )
    ) {
      return [eeo.nonCompeteRestriction || "No", "No"];
    }
    if (
      /felony|convicted|criminal\s*(offense|history|record)|pleaded\s+guilty|debarred|suspended|excluded.*federal|oig|gsa\s*exclusion|terminated\s+for\s+cause|asked\s+to\s+resign|disciplinary\s+action/i.test(
        pLow
      )
    ) {
      return ["No"];
    }
    if (/18\s*years|over\s*18|at\s*least\s*18|age\s*of\s*18|legal\s*age\s*to\s*work|minimum\s*age/i.test(pLow)) {
      return [eeo.over18 || "Yes", "Yes"];
    }
    if (/background\s*(check|screen|investig)|drug\s*(test|screen)|reference\s*check|pre-?employment\s*screen/i.test(pLow)) {
      return [eeo.backgroundCheckConsent || "Yes", "Yes", "I consent"];
    }
    if (
      /meet\s*(all\s*)?(the\s*)?(minimum|basic|required)\s*(qualifications?|requirements?)|essential\s*functions|perform\s+the\s+(duties|responsibilities|essential)|able\s+to\s+perform.*?(with\s+or\s+without|duties|functions)|driver'?s\s*licen[sc]e|reliable\s+transportation/i.test(
        pLow
      )
    ) {
      return ["Yes"];
    }

    // 2. Work Authorization, Visa Status, Citizenship, Sponsorship, Prior Employment, Relocation, Hybrid, Salary, Start Date
    // (MUST run BEFORE geographic country/state/city matchers because work-auth labels contain "in the country where...")
    if (
      /what\s*is\s*your\s*(current\s*)?(u\.?s\.?\s*)?(visa|immigration|work\s*authorization)\s*(type|status|classification|category)|current\s*(u\.?s\.?\s*)?visa|visa\s*(type|category|classification|status)|select\s*your\s*(current\s*)?visa/i.test(
        pLow
      ) &&
      !/require|need|future|will\s*you/i.test(pLow)
    ) {
      return [eeo.visaStatus || "H-1B", "H-1B", "H1B", "H-1B Visa", "H-1B Specialty Occupation"];
    }
    if (/are\s+you\s+a\s+(u\.?s\.?\s*|united\s+states\s*)?(citizen|permanent\s+resident|national|green\s+card)/i.test(pLow)) {
      return ["No"];
    }
    if (/citizenship|citizen\s*of|nationality|country\s*of\s*(citizenship|origin|nationality)/i.test(combinedLow)) {
      return [eeo.citizenship || "India", "India", "Indian"];
    }
    if (/authorized\s*to\s*work|legally\s*authorized|eligible\s*to\s*work|right\s*to\s*work|legally\s*permitted\s*to\s*work/i.test(pLow)) {
      return [eeo.authorizedUS || "Yes", "Yes"];
    }
    if (/sponsorship|require.*visa|need.*visa|future.*visa|immigration\s*support|employer\s*petition|h-?1b\s*transfer|opt\s*status/i.test(pLow)) {
      return [eeo.requireSponsorship || "Yes", "Yes", eeo.visaStatus || "H-1B"];
    }
    if (
      /previously\s*(worked|employed|applied|interviewed|contracted|interned)|former\s*(employee|contractor|worker|intern|associate|contingent)|ever\s*(worked|been\s*employed|interviewed)|interviewed\s*(at|with)\b|worked\s*(at|for)\s+.*\b(before|previously|in\s+the\s+past)|currently\s+or\s+have\s+you\s+previously\s+worked|currently\s*(employed|working)\s*(at|by|for|with)\b|have\s+you\s+ever\s+been\s+employed\s+by|current\s+or\s+former\s+(employee|worker|contractor)/i.test(
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
      /working\s*in[- ]?person|come\s*into\s*the\s*office|days?\s*(per|a)\s*week|\bhybrid\b|on-?site|in-?office|work\s*arrangement|business\s*trips|willing\s*to\s*travel|commut(e|ing)\s+distance|able\s+to\s+commute/i.test(
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
    if (/highest\s*(level\s*of\s*)?education|education\s*level/i.test(combinedLow)) {
      return ["Master's Degree", "Master's", "Master of Science", "Graduate Degree", edu0.degree, "Bachelor's Degree"];
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
    if (
      Boolean(el?.closest?.("[data-automation-id='skillsSection']")) ||
      (/^(skills|technical\s*skills|key\s*skills|add\s*skills)\s*\*?$/i.test(pLow.trim()) || /type\s+to\s+add\s+skills/i.test(combinedLow))
    ) {
      const topSkills = [
        ...(profile?.skills?.programming || []),
        ...(profile?.skills?.aiAndML || []),
        ...(profile?.skills?.webAndCloud || [])
      ].filter(Boolean);
      return topSkills.length > 0 ? topSkills.slice(0, 5) : ["Python", "TypeScript", "React", "Kubernetes", "PyTorch"];
    }
    if (/english\s*(proficiency|fluency|level|skill)|language\s*proficiency/i.test(combinedLow)) {
      return ["Fluent", "Native or Bilingual", "Full Professional Proficiency", "Professional Working", "Advanced", "Yes"];
    }
    if (/currently\s*enrolled.*student|are\s+you\s+currently\s+a\s+(full[- ]time\s+)?student/i.test(combinedLow)) {
      return ["No", "False"];
    }
    if (/willing\s+to\s+(undergo|submit\s+to|complete)\s+.*?(background\s*check|drug\s*(test|screen))/i.test(combinedLow)) {
      return ["Yes", "I consent", "True"];
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
    const filterPlaceholders = (els) =>
      els.filter((el) => {
        const txt = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (!txt || /^(select\s*one|please\s*select|choose\s*one|--\s*select\s*--)$/i.test(txt)) return false;
        return true;
      });

    // 1. Exact React-Select option ID prefix or aria-controls listbox
    const ctrlId = comboEl.getAttribute("aria-controls") || comboEl.getAttribute("aria-owns");
    if (ctrlId) {
      const lb = document.getElementById(ctrlId);
      if (lb) {
        const opts = filterPlaceholders(
          Array.from(
            lb.querySelectorAll(
              "[role='option'], .select__option, [data-automation-id='promptOption'], [data-automation-id='selectOption'], li"
            )
          )
        );
        if (opts.length > 0) return opts;
      }
    }
    if (comboEl.id) {
      const byIdPrefix = filterPlaceholders(
        Array.from(document.querySelectorAll(`[id^="react-select-${CSS.escape(comboEl.id)}-option-"]`))
      );
      if (byIdPrefix.length > 0) return byIdPrefix;
    }
    if (shell) {
      const localOpts = filterPlaceholders(Array.from(shell.querySelectorAll(".select__option, [role='option']")));
      if (localOpts.length > 0) return localOpts;
    }
    // Fallback to visible listbox options in body portals (including Workday wd-popup portals)
    return filterPlaceholders(
      Array.from(
        document.querySelectorAll(
          ".select__option, [role='option']:not(.iti__country), [data-automation-id='promptOption'], [data-automation-id='selectOption'], [data-uxi-widget-type='selectinputoption'], ul[role='listbox'] li, li[role='menuitem']"
        )
      ).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
    );
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

  async function fillComboboxControl(comboEl, desiredCandidates, ctx, jobMeta, fillOpenEndedWithAI, profile = null) {
    const shell =
      comboEl.closest(".select-shell, .select__container") ||
      comboEl.closest(".select__control")?.parentElement ||
      comboEl.parentElement;
    const ctrl = shell?.querySelector(".select__control") || comboEl;
    const toggleBtn = shell?.querySelector("button[aria-label='Toggle flyout'], button[class*='toggleButton']");

    try {
      comboEl.scrollIntoView({ block: "nearest" });
    } catch (_) {}

    // Step 1: Open menu cleanly & poll up to 5 ticks for async Workday wd-popup portals
    comboEl.focus();
    if (toggleBtn && comboEl.getAttribute("aria-expanded") !== "true") {
      dispatchRealClick(toggleBtn);
    } else {
      dispatchRealClick(ctrl);
      comboEl.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true })
      );
    }

    let optionEls = [];
    for (let waitTick = 0; waitTick < 5; waitTick++) {
      await sleep(110);
      optionEls = collectComboboxOptions(comboEl, shell);
      if (optionEls.length > 0) break;
      if (waitTick === 1 && comboEl.tagName === "BUTTON") {
        try {
          comboEl.click();
        } catch (_) {}
        comboEl.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
        );
      }
    }

    // Step 2: If static options appeared, match via deterministic candidates -> AI option picker -> Binary Yes/No fallback
    if (optionEls.length > 0) {
      let candidates = desiredCandidates;
      const optionLabels = optionEls
        .map((o) => (o.innerText || o.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 24);

      if (!candidates && fillOpenEndedWithAI && ctx.primaryLabel && optionLabels.length > 0) {
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

      if (!candidates && isBinaryYesNoOptionList(optionLabels)) {
        candidates = resolveBinaryYesNoFallback(ctx.primaryLabel || ctx.fullLabel, profile || {});
      }

      const chosen = findMatchingOptionElement(optionEls, candidates);
      if (chosen) {
        dispatchRealClick(chosen);
        await sleep(80);
        if (comboEl.tagName === "BUTTON" && !hasComboboxSelection(comboEl)) {
          try {
            const innerNode = chosen.querySelector("div, span") || chosen;
            innerNode.click();
            chosen.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
            );
          } catch (_) {}
          await sleep(60);
        }
        highlightFilledElement(comboEl);
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
    try {
      const nativeFilesSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
      if (nativeFilesSetter) {
        nativeFilesSetter.call(fileInput, dt.files);
      } else {
        fileInput.files = dt.files;
      }
    } catch (_) {
      fileInput.files = dt.files;
    }
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dispatchEvent(new Event("blur", { bubbles: true }));
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

  function queryAllDeep(root = document, selector = "*") {
    const out = [];
    const seen = new Set();
    const visit = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      try {
        const matches = node.querySelectorAll?.(selector) || [];
        for (const m of matches) out.push(m);
      } catch (_) {}
      try {
        const allNodes = node.querySelectorAll?.("*") || [];
        for (const el of allNodes) {
          if (el.shadowRoot) visit(el.shadowRoot);
        }
      } catch (_) {}
    };
    visit(root);
    return out;
  }

  // Detect "Apply as a Guest" / "Continue without signing in" bypass buttons
  function findGuestOrSkipAuthButton(doc = document) {
    const candidates = queryAllDeep(
      doc,
      "[data-jobify-guest-apply], button, a[role='button'], [role='button'], a, input[type='button']"
    ).filter((el) => !el.disabled && isElementVisible(el) && !isHeaderOrNavButton(el) && !el.closest(COOKIE_CONSENT_SELECTOR));

    return (
      candidates.find((el) => {
        if (el.hasAttribute("data-jobify-guest-apply")) return true;
        const txt = (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || "")
          .replace(/[→›»↗⟶➔▶]+/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!txt || txt.length > 80) return false;
        return /^(apply\s*as\s*(a\s*)?guest|continue\s*as\s*(a\s*)?guest|continue\s*without\s*(signing\s*in|an?\s*account|login|logging\s*in)|skip\s*(sign\s*in|login)|apply\s*without\s*(signing\s*in|an?\s*account|registering))$/i.test(
          txt
        );
      }) || null
    );
  }

  // Detect SSO-vs-Email auth gate (e.g. Workday [data-automation-id="SignInWithEmailButton"], SmartRecruiters "Continue with email")
  function findEmailAuthChoiceButton(doc = document) {
    const candidates = queryAllDeep(
      doc,
      "[data-automation-id='SignInWithEmailButton'], [data-jobify-signin-email], button, a[role='button'], [role='button'], a"
    ).filter((el) => !el.disabled && isElementVisible(el) && !isHeaderOrNavButton(el) && !el.closest(COOKIE_CONSENT_SELECTOR));

    return (
      candidates.find((el) => {
        if (el.dataset?.automationId === "SignInWithEmailButton" || el.hasAttribute("data-jobify-signin-email")) {
          return true;
        }
        const txt = (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
          .replace(/[→›»↗⟶➔▶]+/g, "")
          .replace(/\s+/g, " ")
          .trim();
        return /^(sign\s*(in|up)\s*(with|using)\s*email|continue\s*(with|using)\s*email|use\s*(my\s*|an?\s*)?email(\s*address|\s*instead)?|log\s*in\s*(with|using)\s*email|register\s*(with|using)\s*email|apply\s*(with|using)\s*email|email\s*(and|&)\s*password|sign\s*in\s*with\s*credentials)$/i.test(
          txt
        );
      }) || null
    );
  }

  // Detect Multi-Provider OAuth / Social Login Chooser Modals & Pages (e.g. Microsoft Careers "Sign in with Google / Microsoft / LinkedIn / Facebook")
  function findSsoProviderChoiceButton(doc = document, preferredEmail = "") {
    if (findApplyModalChoiceButton(doc)) return null;
    if (hasRealCandidateFormFields(doc)) return null;

    const now = Date.now();
    const emailLow = String(preferredEmail || "ravitejavelanati11@gmail.com").toLowerCase();
    const prefersMicrosoft = /@(outlook|hotmail|live|msn|microsoft)\.com$/i.test(emailLow);

    const authDialogs = queryAllDeep(
      doc,
      "[role='dialog'], [aria-modal='true'], dialog[open], .modal, [class*='modal' i], [class*='signin' i], [class*='sign-in' i], [class*='login' i], [class*='auth' i], [data-automation-id*='signIn' i], [data-jobify-sso-modal]"
    ).filter(isElementVisible);

    const pageHeadingsText = queryAllDeep(doc, "h1, h2, h3, h4, [role='heading'], title")
      .map((h) => (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim())
      .join(" | ")
      .slice(0, 800);

    const isPageLevelAuthContext =
      /\/(login|signin|sign-in|auth|oauth|sso|account|candidate-login)\b/i.test(
        `${location.pathname || ""}${location.search || ""}${location.hash || ""}`
      ) ||
      /sign\s*in(\s*to\s*apply|\s*with|\s*to\s*your\s*account)?|choose\s*an?\s*account|select\s*a?\s*sign[-\s]?in|log\s*in\s*to\s*continue|continue\s*with/i.test(
        pageHeadingsText
      );

    const candidates = queryAllDeep(
      doc,
      "[data-jobify-sso-provider], [data-provider], [data-idp], button, a[role='button'], [role='button'], a, input[type='button'], div[tabindex='0']"
    ).filter((el) => {
      if (el.disabled || !isElementVisible(el)) return false;
      if (el.closest("#jobify-copilot-host") || el.closest(COOKIE_CONSENT_SELECTOR)) return false;
      const inAuthModal = authDialogs.some((d) => d.contains(el));
      if (!inAuthModal && (isHeaderOrNavButton(el) || el.closest("footer"))) return false;
      const lastClicked = Number(el.getAttribute?.("data-jobify-sso-clicked-ts") || 0);
      if (lastClicked > 0 && now - lastClicked < 3500) return false;
      // Avoid matching outer container if an inner button/link exists
      if (
        el.tagName === "DIV" &&
        el.querySelector?.("button, a, [role='button']") &&
        !el.hasAttribute("data-jobify-sso-provider")
      ) {
        return false;
      }
      return true;
    });

    const scoredMatches = [];

    for (const el of candidates) {
      const rawTxt = (el.innerText || el.textContent || el.value || "")
        .replace(/[→›»↗⟶➔▶]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const aria = (el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
      const imgAlt = Array.from(el.querySelectorAll?.("img[alt], svg[aria-label]") || [])
        .map((n) => n.getAttribute("alt") || n.getAttribute("aria-label") || "")
        .join(" ")
        .trim();
      const dataProv = `${el.getAttribute("data-jobify-sso-provider") || ""} ${el.getAttribute("data-provider") || ""} ${el.getAttribute("data-idp") || ""} ${el.getAttribute("data-testid") || ""} ${el.id || ""}`.toLowerCase();
      const combined = `${rawTxt} ${aria} ${imgAlt}`.replace(/\s+/g, " ").trim();

      if (!combined && !dataProv) continue;
      if (combined.length > 95) continue;
      if (/share\s*(on|with|this)|follow\s*us|tweet|post\s*(on|to)|visit\s*our|privacy|terms|cookie|help|support|cancel|close/i.test(combined)) {
        continue;
      }

      const inAuthContainer =
        authDialogs.some((d) => d.contains(el)) ||
        Boolean(
          el.closest(
            "[class*='signin' i], [class*='sign-in' i], [class*='login' i], [class*='auth' i], [class*='sso' i], [id*='signin' i], [id*='login' i], [data-jobify-sso-modal]"
          )
        ) ||
        isPageLevelAuthContext;

      const explicitVerbMatch =
        /\b(sign\s*(in|up)|log\s*in|continue|connect|authenticate|access)\s*(with|using)\s*(google|microsoft|linkedin|github|apple|facebook|personal\s+account)\b/i.test(
          combined
        ) || Boolean(el.getAttribute("data-jobify-sso-provider"));

      if (!explicitVerbMatch && !inAuthContainer) continue;

      let provider = null;
      if (
        /\bgoogle\b/i.test(dataProv) ||
        /^((sign\s*(in|up)|log\s*in|continue|connect|authenticate)\s*(with|using)\s*google|google(\s*(account|sign\s*in|login))?)$/i.test(
          rawTxt || aria || imgAlt
        ) ||
        (inAuthContainer && /\b(sign\s*(in|up)|continue|log\s*in)?\s*(with\s*)?google\b/i.test(combined))
      ) {
        provider = "google";
      } else if (
        /\bmicrosoft\b|\bmsa\b|\baad\b|\bentra\b/i.test(dataProv) ||
        /^((sign\s*(in|up)|log\s*in|continue|connect|authenticate)\s*(with|using)\s*microsoft(\s*(personal\s*)?account)?|microsoft(\s*(personal\s*)?(account|sign\s*in|login))?|personal\s*microsoft\s*account)$/i.test(
          rawTxt || aria || imgAlt
        ) ||
        (inAuthContainer && /\b(sign\s*(in|up)|continue|log\s*in)?\s*(with\s*)?microsoft(\s+personal)?(\s+account)?\b/i.test(combined))
      ) {
        provider = "microsoft";
      } else if (
        /\blinkedin\b/i.test(dataProv) ||
        /^((sign\s*(in|up)|log\s*in|continue|connect|authenticate)\s*(with|using)\s*linkedin|linkedin(\s*(account|sign\s*in|login))?)$/i.test(
          rawTxt || aria || imgAlt
        ) ||
        (inAuthContainer && /\b(sign\s*(in|up)|continue|log\s*in)\s*(with\s*)?linkedin\b/i.test(combined))
      ) {
        provider = "linkedin";
      } else if (
        /\bgithub\b/i.test(dataProv) ||
        /^((sign\s*(in|up)|log\s*in|continue|connect|authenticate)\s*(with|using)\s*github|github)$/i.test(rawTxt || aria || imgAlt)
      ) {
        provider = "github";
      } else if (
        /\bapple\b/i.test(dataProv) ||
        /^((sign\s*(in|up)|log\s*in|continue|connect|authenticate)\s*(with|using)\s*apple|sign\s*in\s*with\s*apple|apple)$/i.test(
          rawTxt || aria || imgAlt
        )
      ) {
        provider = "apple";
      } else if (
        /\bfacebook\b/i.test(dataProv) ||
        /^((sign\s*(in|up)|log\s*in|continue|connect|authenticate)\s*(with|using)\s*facebook|facebook)$/i.test(
          rawTxt || aria || imgAlt
        )
      ) {
        provider = "facebook";
      }

      if (!provider) continue;

      let score = 50;
      if (provider === "google") score = prefersMicrosoft ? 95 : 115;
      else if (provider === "microsoft") score = prefersMicrosoft ? 115 : 90;
      else if (provider === "linkedin") score = 75;
      else if (provider === "github") score = 65;
      else if (provider === "apple") score = 55;
      else if (provider === "facebook") score = 45;

      if (explicitVerbMatch) score += 10;

      scoredMatches.push({ element: el, provider, score, label: rawTxt || aria || provider });
    }

    if (scoredMatches.length === 0) return null;
    scoredMatches.sort((a, b) => b.score - a.score);
    return scoredMatches[0];
  }

  // Detect when current screen or popup is an OAuth / Identity Provider screen (Google Accounts, Microsoft Live/Entra, Okta, Auth0, or embedded OAuth chooser)
  function isOAuthProviderScreen(doc = document) {
    const host = (location.hostname || "").toLowerCase();
    const href = (location.href || "").toLowerCase();
    if (
      /(^|\.)(accounts\.google\.com|login\.live\.com|login\.microsoftonline\.com|b2clogin\.com|appleid\.apple\.com|auth0\.com|okta\.com|onelogin\.com)$/i.test(
        host
      ) ||
      /linkedin\.com\/(uas\/)?oauth|github\.com\/login\/oauth/i.test(href)
    ) {
      return true;
    }

    if (
      doc.querySelector(
        "[data-jobify-oauth-screen], [data-jobify-oauth-account], [data-identifier*='@'], [data-email*='@'], input#identifierId, #identifierNext, #passwordNext, #submit_approve_access, #tilesHolder, input[name='loginfmt'], #idSIButton9"
      )
    ) {
      return true;
    }

    const headings = queryAllDeep(doc, "h1, h2, h3, [role='heading'], [class*='heading' i], [class*='title' i]")
      .filter(isElementVisible)
      .map((h) => (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim())
      .join(" | ");

    if (
      /choose\s+an?\s+account(\s+to\s+continue)?|pick\s+an?\s+account|sign\s+in\s+with\s+google|sign\s+in\s+to\s+your\s+microsoft\s+account|wants\s+to\s+access\s+your\s+google\s+account|continue\s+to\s+microsoft\s+careers/i.test(
        headings
      )
    ) {
      return true;
    }

    return false;
  }

  // Execute Google / Microsoft / Generic OAuth Account Chooser, Identifier/Password Login & Consent Approval
  async function performOAuthProviderStep(credentials, profile = null, doc = document) {
    const targetEmail = String(
      credentials?.portalEmail || profile?.personal?.email || "ravitejavelanati11@gmail.com"
    )
      .toLowerCase()
      .trim();
    const targetPassword = String(credentials?.portalPassword || "").trim();
    let actionsTaken = 0;

    // 1. Account Chooser Tile Selection (Google [data-identifier] / [data-email], Microsoft #tilesHolder, or matching email tile)
    const findAccountTile = () => {
      const tileCandidates = queryAllDeep(
        doc,
        "[data-jobify-oauth-account], [data-identifier], [data-email], [data-test-id], #tilesHolder [role='button'], #tilesHolder .table, li [role='link'], div[role='link'], div[role='button'], button, a"
      ).filter((el) => !el.disabled && isElementVisible(el) && !el.closest("#jobify-copilot-host"));

      // Pass A: Exact match on user's email (e.g. ravitejavelanati11@gmail.com)
      const exactTile = tileCandidates.find((el) => {
        const idAttr = (
          el.getAttribute("data-identifier") ||
          el.getAttribute("data-email") ||
          el.getAttribute("data-test-id") ||
          el.getAttribute("data-jobify-oauth-account") ||
          ""
        )
          .toLowerCase()
          .trim();
        const txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").toLowerCase();
        if (/use\s+another\s+account|add\s+another\s+account|sign\s+out|remove\s+an?\s+account/i.test(txt)) {
          return false;
        }
        return idAttr === targetEmail || (targetEmail && txt.includes(targetEmail) && txt.length < 180);
      });
      if (exactTile) return exactTile;

      // Pass B: Any active signed-in Google/Microsoft account tile with an email address
      return (
        tileCandidates.find((el) => {
          const idAttr = (
            el.getAttribute("data-identifier") ||
            el.getAttribute("data-email") ||
            el.getAttribute("data-test-id") ||
            el.getAttribute("data-jobify-oauth-account") ||
            ""
          )
            .toLowerCase()
            .trim();
          const txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          if (/use\s+another\s+account|add\s+another\s+account|sign\s+out|remove|forgot|privacy|terms/i.test(txt)) {
            return false;
          }
          if (idAttr && idAttr.includes("@")) return true;
          if (el.hasAttribute("data-jobify-oauth-account")) return true;
          return false;
        }) || null
      );
    };

    const findOAuthConsentButton = () => {
      const btns = queryAllDeep(
        doc,
        "#submit_approve_access, #acceptButton, [data-jobify-oauth-consent], #idSIButton9, button[type='submit'], input[type='submit'], button, [role='button'], a[role='button']"
      ).filter((b) => !isButtonDisabledState(b) && isElementVisible(b) && !b.closest("#jobify-copilot-host"));

      return (
        btns.find((b) => {
          if (b.id === "submit_approve_access" || b.id === "acceptButton" || b.hasAttribute("data-jobify-oauth-consent")) {
            return true;
          }
          const txt = (b.innerText || b.value || b.getAttribute("aria-label") || "")
            .replace(/[→›»↗⟶➔▶]+/g, "")
            .replace(/\s+/g, " ")
            .trim();
          return /^(continue(\s+as\s+.+)?|allow(\s+access)?|accept(\s*(&|and)\s*continue)?|authorize(\s+app)?|confirm|yes,?\s*i'?m\s*in|yes|agree(\s*(&|and)\s*continue)?)$/i.test(
            txt
          );
        }) || null
      );
    };

    const accountTile = findAccountTile();
    if (accountTile) {
      clickElementAndInner(accountTile);
      actionsTaken++;
      for (let w = 0; w < 8; w++) {
        await sleep(280);
        const consentBtn = findOAuthConsentButton();
        const pwNow = queryAllDeep(doc, "input[type='password']").filter(isVisibleAndEditable);
        if (consentBtn && pwNow.length === 0) {
          clickElementAndInner(consentBtn);
          actionsTaken++;
          await sleep(600);
          break;
        }
        if (pwNow.length > 0) break;
      }
      if (queryAllDeep(doc, "input[type='password']").filter(isVisibleAndEditable).length === 0) {
        return { handled: true, filled: actionsTaken, submittedAuthForm: true, mode: "oauth_account_chooser" };
      }
    }

    // 2. If on an Account Chooser screen with only "Use another account" and no visible inputs yet, click "Use another account"
    const visibleEmailInputs = queryAllDeep(
      doc,
      "input#identifierId, input[name='loginfmt'], #i0116, input[type='email'], input[name='identifier'], input[name='username'], input[autocomplete='username']"
    ).filter(isVisibleAndEditable);
    const visiblePwInputs = queryAllDeep(doc, "input[type='password']").filter(isVisibleAndEditable);

    if (visibleEmailInputs.length === 0 && visiblePwInputs.length === 0) {
      const useAnotherBtn = queryAllDeep(doc, "li, div[role='link'], div[role='button'], button, a").find((el) => {
        if (!isElementVisible(el)) return false;
        const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        return /^(use\s+another\s+account|use\s+a\s+different\s+account|sign\s+in\s+with\s+a\s+different\s+account)$/i.test(t);
      });
      if (useAnotherBtn) {
        clickElementAndInner(useAnotherBtn);
        actionsTaken++;
        await sleep(750);
      }
    }

    // 3. OAuth Email / Identifier Input Step (Google #identifierId, Microsoft loginfmt / #i0116)
    const emailInputsNow = queryAllDeep(
      doc,
      "input#identifierId, input[name='loginfmt'], #i0116, input[type='email'], input[name='identifier'], input[name='username'], input[autocomplete='username']"
    ).filter(isVisibleAndEditable);

    if (emailInputsNow.length > 0 && targetEmail) {
      if (setNativeValue(emailInputsNow[0], targetEmail)) {
        actionsTaken++;
      }
      await sleep(120);
      if (queryAllDeep(doc, "input[type='password']").filter(isVisibleAndEditable).length === 0) {
        const nextBtn =
          doc.querySelector("#identifierNext button, #identifierNext, #idSIButton9") ||
          queryAllDeep(doc, "button[type='submit'], input[type='submit'], button, [role='button']").find((b) => {
            if (isButtonDisabledState(b) || !isElementVisible(b)) return false;
            const t = (b.innerText || b.value || "").replace(/\s+/g, " ").trim();
            return /^(next|continue|sign\s*in|proceed|submit)$/i.test(t);
          });
        if (nextBtn) {
          clickElementAndInner(nextBtn);
          actionsTaken++;
          for (let i = 0; i < 9; i++) {
            await sleep(280);
            if (
              queryAllDeep(doc, "input[type='password']").filter(isVisibleAndEditable).length > 0 ||
              Boolean(findOAuthConsentButton())
            ) {
              break;
            }
          }
        }
      }
    }

    // 4. OAuth Password Step (Google Passwd / #passwordNext, Microsoft passwd / #i0118)
    const pwInputsNow = queryAllDeep(doc, "input[type='password'], input[name='Passwd'], input[name='passwd'], #i0118").filter(
      isVisibleAndEditable
    );
    if (pwInputsNow.length > 0 && targetPassword) {
      for (const pw of pwInputsNow) {
        if (setNativeValue(pw, targetPassword)) actionsTaken++;
      }
      await sleep(140);
      const pwSubmit =
        doc.querySelector("#passwordNext button, #passwordNext, #idSIButton9") ||
        findAuthSubmitButton(false, doc);
      if (pwSubmit) {
        clickElementAndInner(pwSubmit);
        actionsTaken++;
        for (let i = 0; i < 8; i++) {
          await sleep(280);
          const consentAfterPw = findOAuthConsentButton();
          if (consentAfterPw && queryAllDeep(doc, "input[type='password']").filter(isVisibleAndEditable).length === 0) {
            clickElementAndInner(consentAfterPw);
            actionsTaken++;
            await sleep(500);
            break;
          }
        }
      }
      return { handled: true, filled: actionsTaken, submittedAuthForm: true, mode: "oauth_password" };
    }

    // 5. Final Consent / "Continue" / "Allow" / "Stay signed in?" Step
    const consentBtnFinal = findOAuthConsentButton();
    if (consentBtnFinal) {
      clickElementAndInner(consentBtnFinal);
      actionsTaken++;
      await sleep(600);
      return { handled: true, filled: actionsTaken, submittedAuthForm: true, mode: "oauth_consent" };
    }

    return {
      handled: actionsTaken > 0,
      filled: actionsTaken,
      submittedAuthForm: actionsTaken > 0,
      mode: "oauth_provider"
    };
  }

  // Detect Email-First 2-Step Auth Screen (Email -> Continue -> Password/OTP/CreateAccount, used on iCIMS, Eightfold, SuccessFactors, Phenom, Oracle)
  function detectEmailFirstAuthStep(doc = document) {
    const pwVisible = queryAllDeep(doc, "input[type='password']").filter(isVisibleAndEditable);
    if (pwVisible.length > 0) return null;
    if (queryAllDeep(doc, "input[type='file']").some(isActionableFileInput)) return null;
    if (hasDirectApplicationResumeOrSections(doc)) return null;

    const allEditable = queryAllDeep(doc, "input, select, textarea").filter((el) => {
      if (!isVisibleAndEditable(el)) return false;
      if (el.type === "checkbox" || el.type === "radio" || el.type === "hidden" || el.type === "submit" || el.type === "button") {
        return false;
      }
      return true;
    });
    if (allEditable.length === 0 || allEditable.length > 4) return null;

    const emailInput = allEditable.find((el) => {
      const ctx = getFieldContext(el);
      const sig = `${el.type || ""} ${el.name || ""} ${el.id || ""} ${el.autocomplete || ""} ${el.placeholder || ""} ${el.dataset?.automationId || ""} ${ctx.fullLabel || ""}`;
      return /email|e-mail|username|user\s*id/i.test(sig) && !isComboboxInput(el);
    });
    if (!emailInput) return null;

    // Reject if the remaining fields look like a quick-apply candidate form (e.g. Resume/LinkedIn/Salary/Work Auth)
    const nonEmailHasAppQuestions = allEditable.some((el) => {
      if (el === emailInput) return false;
      const ctx = getFieldContext(el);
      const sig = `${el.name || ""} ${el.id || ""} ${ctx.fullLabel || ""}`;
      return /linkedin|portfolio|salary|compensation|years\s+of\s+experience|work\s+authoriz|sponsorship|cover\s+letter/i.test(sig);
    });
    if (nonEmailHasAppQuestions) return null;

    const headingsText = queryAllDeep(
      doc,
      "h1, h2, h3, h4, legend, [role='heading'], [id*='auth' i], [class*='login' i], [class*='signin' i], [class*='auth' i], form p, main p, label"
    )
      .filter(isElementVisible)
      .map((h) => (h.innerText || h.textContent || "").trim())
      .join(" ")
      .slice(0, 1100);
    const urlAuthHint = /login|signin|sign-in|register|signup|sign-up|auth|account|candidate|icims|oraclecloud|eightfold|successfactors|ultipro|taleo/i.test(
      location.href
    );
    if (
      !urlAuthHint &&
      !/sign\s*in|log\s*in|create\s*(an?\s*)?account|register|sign\s*up|candidate\s*(login|portal)|enter\s*your\s*email|verify\s*your\s*email|welcome\s*back|start\s*your\s*application|continue\s*with\s*(your\s*)?email|apply\s*now/i.test(
        headingsText
      )
    ) {
      return null;
    }

    const continueBtn = queryAllDeep(
      doc,
      "button[type='submit'], input[type='submit'], button, [role='button'], a[role='button'], input[type='button']"
    )
      .filter((b) => !isButtonDisabledState(b) && isElementVisible(b) && !isHeaderOrNavButton(b) && !b.closest("#jobify-copilot-host"))
      .find((b) => {
        const t = (b.innerText || b.value || b.getAttribute("aria-label") || "")
          .replace(/[→›»↗⟶➔▶]+/g, "")
          .replace(/\s+/g, " ")
          .trim();
        return (
          /^(continue(\s*with\s*email)?|next|sign\s*in|log\s*in|proceed|submit|send\s*(verification\s*|security\s*)?(code|pin)|verify(\s*email)?|get\s*started|start(\s*application)?|register|sign\s*up|check\s*email)$/i.test(
            t
          ) && !/with\s+(google|linkedin|apple|microsoft|facebook|indeed)/i.test(t)
        );
      });

    return continueBtn ? { emailInput, continueBtn, extraInputs: allEditable.filter((e) => e !== emailInput) } : null;
  }

  // Detect "Verify your email address / Click activation link in email" banner (e.g. Workday / iCIMS / SmartRecruiters post-signup email verification)
  function detectEmailVerificationBanner(doc = document) {
    if (detectOtpChallenge(doc).detected) return false;
    const containers = Array.from(
      doc.querySelectorAll(
        "[data-automation-id='signInContent'], [data-automation-id='errorMessage'], [data-jobify-verify-email-banner], [role='alert'], [role='status'], main, .card, form, body"
      )
    ).filter(isElementVisible);
    for (const c of containers) {
      if (c.hasAttribute("data-jobify-verify-email-banner")) return true;
      const t = (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 1200);
      if (
        /verify\s+your\s+(email|account)|verification\s+(email|link)\s+(has\s+been\s+|was\s+)?sent|check\s+your\s+(email|inbox)\s+to\s+(verify|activate|complete|confirm)|click\s+the\s+(verification\s+|activation\s+)?link\s+in\s+(the|your)\s+email|account\s+has\s+not\s+been\s+(verified|activated)|sent\s+an?\s+(verification|activation|confirmation)\s+(email|link)|activate\s+your\s+account\s+by\s+clicking|awaiting\s+email\s+verification/i.test(
          t
        )
      ) {
        return true;
      }
    }
    return false;
  }

  function hasDirectApplicationResumeOrSections(doc = document) {
    if (Array.from(doc.querySelectorAll("input[type='file']")).some(isActionableFileInput)) {
      return true;
    }
    if (
      doc.querySelector(
        "[data-automation-id^='workExperience-'], [data-automation-id^='education-'], [data-jobify-exp-index], [data-jobify-edu-index], #application_form, #grnhse_app, [class*='ashby-application-form']"
      )
    ) {
      return true;
    }
    return false;
  }

  // Human-like analyzer: determines whether the current auth page is asking to CREATE AN ACCOUNT ("create") vs. SIGN IN ("signin")
  function analyzeAuthPageMode(doc = document) {
    const pwInputs = queryAllDeep(doc, "input[type='password']").filter(isVisibleAndEditable);
    const pwCount = pwInputs.length;

    // 1. Check if there are registration-only personal fields (First Name, Last Name, Full Name, Confirm Email) alongside password
    const visibleTextInputs = queryAllDeep(
      doc,
      "input:not([type='password']):not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='submit']):not([type='button']), select"
    ).filter((el) => isVisibleAndEditable(el) && !isComboboxInput(el));
    let hasRegistrationProfileFields = false;
    let emailFieldCount = 0;
    for (const inp of visibleTextInputs) {
      const ctx = getFieldContext(inp);
      const sig = `${inp.name || ""} ${inp.id || ""} ${inp.autocomplete || ""} ${inp.placeholder || ""} ${inp.dataset?.automationId || ""} ${ctx.fullLabel || ""}`.toLowerCase();
      if (/email/i.test(sig)) emailFieldCount++;
      if (
        /first[_-\s]?name|last[_-\s]?name|given[_-\s]?name|family[_-\s]?name|full[_-\s]?name|confirm[_-\s]?email|re[-_]?type[_-\s]?email|re[-_]?enter[_-\s]?email|verify[_-\s]?email|phone|mobile/i.test(
          sig
        )
      ) {
        hasRegistrationProfileFields = true;
      }
    }
    if (emailFieldCount >= 2) {
      hasRegistrationProfileFields = true;
    }

    // 2. Inspect active headings, legends, and selected tabs
    const headingsText = queryAllDeep(
      doc,
      "[data-automation-id='signInContent'] h1, [data-automation-id='signInContent'] h2, [data-automation-id='signInContent'] h3, form h1, form h2, form h3, form legend, [role='tab'][aria-selected='true'], .tab.active, .nav-link.active, h1, h2, h3"
    )
      .filter(isElementVisible)
      .map((el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim())
      .join(" | ");

    const headingSaysCreate =
      /create\s*(an?\s*|your\s*|my\s*|new\s*|candidate\s*)?(account|profile)|sign\s*up|register(\s+account|\s+now)?|new\s*(user|candidate|applicant)\s*registration/i.test(
        headingsText
      ) && !/^(sign\s*in|log\s*in|candidate\s*login|welcome\s*back)\b/i.test(headingsText);

    // 3. Inspect visible submit button text inside the auth container
    const submitBtns = queryAllDeep(
      doc,
      "[data-jobify-auth-submit], [data-automation-id*='createAccountSubmit' i], [data-automation-id*='signInSubmit' i], button[type='submit'], input[type='submit'], form button"
    ).filter((b) => isElementVisible(b) && !isHeaderOrNavButton(b));

    const hasExplicitCreateSubmitBtn = submitBtns.some((b) => {
      const autoId = b.dataset?.automationId || "";
      if (/createAccountSubmit/i.test(autoId)) return true;
      if (/^(createAccountLink|signInLink)$/i.test(autoId)) return false;
      if (b.hasAttribute("data-jobify-switch-signup") || b.hasAttribute("data-jobify-switch-signin")) return false;
      const txt = (b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      return /^(create\s*(an?\s*|your\s*|my\s*|new\s*|candidate\s*)?(account|profile)|sign\s*up(\s*now)?|register(\s*(now|account))?|complete\s*registration)$/i.test(
        txt
      );
    });

    const hasExplicitSignInSubmitBtn = submitBtns.some((b) => {
      const autoId = b.dataset?.automationId || "";
      if (/signInSubmit/i.test(autoId)) return true;
      if (/^(createAccountLink|signInLink)$/i.test(autoId)) return false;
      if (b.hasAttribute("data-jobify-switch-signup") || b.hasAttribute("data-jobify-switch-signin")) return false;
      const txt = (b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      return /^(sign\s*in|log\s*in|login)$/i.test(txt);
    });

    const isCreateMode =
      pwCount >= 2 ||
      (pwCount >= 1 && hasRegistrationProfileFields) ||
      (pwCount >= 1 && hasExplicitCreateSubmitBtn && !hasExplicitSignInSubmitBtn) ||
      (pwCount >= 1 && headingSaysCreate && !hasExplicitSignInSubmitBtn);

    return {
      mode: isCreateMode ? "create" : "signin",
      isCreateMode,
      pwCount,
      hasRegistrationProfileFields,
      hasExplicitCreateSubmitBtn,
      hasExplicitSignInSubmitBtn
    };
  }

  function resolvePortalPasswordForHost(credentials, host = location.hostname) {
    const cleanHost = String(host || "").toLowerCase().trim();
    const map = credentials?.domainPasswords;
    if (cleanHost && map && typeof map === "object") {
      if (map[cleanHost]) return String(map[cleanHost]);
      const parentKey = Object.keys(map).find((k) => cleanHost.endsWith(`.${k.toLowerCase()}`));
      if (parentKey && map[parentKey]) return String(map[parentKey]);
    }
    return String(credentials?.portalPassword || "");
  }

  // Deterministic compliant fallback password synthesizer when a strict portal rejects default symbol/length rules
  function buildCompliantDomainPassword(errText = "", host = location.hostname) {
    const cleanHost = String(host || "portal").replace(/[^a-z0-9]/gi, "");
    const tag = (cleanHost.slice(0, 3) || "Prt").replace(/^./, (c) => c.toUpperCase());
    const disallowSpecial = /no\s+special|alphanumeric\s+only|only\s+letters\s+and\s+numbers/i.test(errText);
    const max12 = /max(imum)?\s*(of\s*)?(10|11|12)\b|between\s+\d+\s+and\s+(10|11|12)\b|8[-\s]*12\s*character/i.test(errText);
    if (disallowSpecial) {
      return max12 ? `Jb9${tag}Qx47m` : `Jb9${tag}Qx47mKp29z`;
    }
    // Uses '@' (universally accepted across Workday, Taleo, SuccessFactors, iCIMS, Oracle, UKG), 16 chars, upper, lower, digits, zero name/email substrings
    return max12 ? `Jb9@${tag}Qx4m` : `Jb9@${tag}Qx47mKp2z`;
  }

  // Handle SAP SuccessFactors & enterprise portals where clicking "Read and accept the data privacy statement" opens an Accept dialog
  async function acceptPrivacyModalIfRequired(doc = document) {
    let clicked = 0;
    const findDialogAcceptBtn = () => {
      const dialogs = Array.from(
        doc.querySelectorAll("[role='dialog'], [aria-modal='true'], dialog[open], .ui-dialog, .modal.show, .modal.in, [data-jobify-terms-modal]")
      ).filter((d) => isElementVisible(d) && !d.closest(COOKIE_CONSENT_SELECTOR) && !d.matches(COOKIE_CONSENT_SELECTOR));
      for (const dlg of dialogs) {
        const dlgTxt = (dlg.innerText || "").slice(0, 1200);
        if (!/privacy|terms|consent|data\s+protection|statement|agreement|acknowledge/i.test(dlgTxt)) continue;
        const btn = Array.from(
          dlg.querySelectorAll("button, input[type='button'], input[type='submit'], a[role='button'], [role='button']")
        ).find((b) => {
          if (isButtonDisabledState(b) || !isElementVisible(b)) return false;
          const t = (b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
          return /^(accept|i\s*accept|agree|i\s*agree|acknowledge|confirm|accept\s*&\s*close)$/i.test(t);
        });
        if (btn) return btn;
      }
      return null;
    };

    let acceptBtn = findDialogAcceptBtn();
    if (!acceptBtn) {
      // Look for SAP SuccessFactors "Read and accept the data privacy statement *" trigger link next to disabled/unselected consent control
      const privacyOpenTriggers = Array.from(
        doc.querySelectorAll("a, button, span[role='button'], [role='link'], [onclick*='privacy' i], [id*='privacy' i]")
      ).filter((el) => {
        if (!isElementVisible(el) || isHeaderOrNavButton(el)) return false;
        const href = (el.getAttribute("href") || "").trim();
        // Do NOT click external new-tab PDF/policy links; only in-page modal triggers!
        if (/^https?:\/\//i.test(href) && el.getAttribute("target") === "_blank") return false;
        const t = (el.innerText || el.textContent || "")
          .replace(/[\s*:.*→›»↗⟶➔▶]+$/g, "")
          .replace(/\s+/g, " ")
          .trim();
        return /^(read\s+and\s+accept(\s+the)?\s+(data\s+)?privacy(\s+statement)?|view\s+and\s+accept\s+(terms|privacy)|read\s+data\s+privacy\s+statement)$/i.test(
          t
        );
      });
      if (privacyOpenTriggers.length > 0) {
        clickElementAndInner(privacyOpenTriggers[0], { bypassCooldown: true });
        await sleep(320);
        acceptBtn = findDialogAcceptBtn();
      }
    }

    if (acceptBtn) {
      clickElementAndInner(acceptBtn, { bypassCooldown: true });
      clicked++;
      await sleep(220);
    }
    return clicked;
  }

  // Sharp Portal Login & Full Account Creation Filler:
  // Fills Email (+ Confirm Email), Password (+ Confirm/Verify Password), ALL Personal/Registration Fields (First/Last Name, Phone, Country, State, City, Zip, etc.),
  // expands/scrolls Terms boxes, accepts Privacy Modals, and checks all Consent/Terms checkboxes!
  async function autofillPortalAuth(credentials, profile = null, passwordOverride = null) {
    const activePassword = String(passwordOverride || resolvePortalPasswordForHost(credentials)).trim();
    if (!credentials?.portalEmail) {
      return { filled: 0, passwordFieldsFilled: 0, isCreateMode: false };
    }
    let filled = 0;
    let passwordFieldsFilled = 0;

    // 0. Sanitize any bot-trap honeypots (e.g. Workday data-automation-id="beecatcher") if accidentally pre-populated
    const allRawInputs = queryAllDeep(document, "input");
    for (const rawInp of allRawInputs) {
      if (rawInp.type === "text" && rawInp.value && isTrapOrSystemInput(rawInp)) {
        const rawIdent = `${rawInp.dataset?.automationId || ""} ${rawInp.name || ""} ${rawInp.id || ""}`;
        if (/beecatcher|honeypot|_gotcha|bot[-_]?field|trap/i.test(rawIdent)) {
          try {
            const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
            if (desc?.set) desc.set.call(rawInp, "");
            else rawInp.value = "";
            rawInp.dispatchEvent(new Event("input", { bubbles: true }));
          } catch (_) {}
        }
      }
    }

    const effectiveProfile = profile?.personal
      ? profile
      : {
          personal: {
            firstName: "Raviteja",
            lastName: "Velanati",
            fullName: "Raviteja Velanati",
            preferredName: "Ravi",
            email: credentials.portalEmail,
            phone: "(774) 810-8481",
            phoneDigits: "7748108481",
            phoneCountryCode: "+1",
            streetAddress: "39861 Potrero Dr",
            city: "Newark",
            state: "California",
            stateCode: "CA",
            postalCode: "94560",
            country: "United States",
            locationDisplay: "Newark, California, United States",
            linkedin: "https://www.linkedin.com/in/raviteja-velanati/",
            github: "https://github.com/ravitejav-dev",
            currentCompany: "GlobalLogic (Client: Google AI)",
            currentTitle: "Senior AI Solutions Engineer"
          },
          workAuthAndEEO: {
            authorizedUS: "Yes",
            requireSponsorship: "Yes",
            howDidYouHear: "LinkedIn",
            over18: "Yes"
          }
        };

    // 1. Fill all Email / Confirm Email / Username inputs
    const allVisibleInputs = queryAllDeep(document, "input, select, textarea").filter(
      (el) => isVisibleAndEditable(el) && !isComboboxInput(el)
    );

    const handledEls = new WeakSet();

    for (const el of allVisibleInputs) {
      if (el.type === "password" || el.type === "checkbox" || el.type === "radio" || el.type === "file") continue;
      const ctx = getFieldContext(el);
      const sig = `${el.type || ""} ${el.name || ""} ${el.id || ""} ${el.autocomplete || ""} ${el.placeholder || ""} ${el.dataset?.automationId || ""} ${ctx.fullLabel || ""}`;
      if (/email|e-mail|username|user[_-\s]?id|login[_-\s]?id/i.test(sig) && !/phone|first|last|given|family|city|state|zip|postal/i.test(sig)) {
        const disallowsAt =
          /username|user[_-\s]?id/i.test(sig) &&
          !/email/i.test(sig) &&
          ((el.pattern && !el.pattern.includes("@")) || /without\s*@|no\s*@|alphanumeric/i.test(sig));
        const valToUse = disallowsAt
          ? credentials.portalEmail.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "")
          : credentials.portalEmail;
        if (setNativeValue(el, valToUse)) {
          filled++;
          handledEls.add(el);
        }
      }
    }

    // 2. Fill primary Password + any Verify / Confirm / Repeat Password inputs
    if (activePassword) {
      const pwInputs = queryAllDeep(
        document,
        "input[type='password'], input[data-automation-id*='password' i], input[name*='verify_password' i], input[name*='confirm_password' i], input[name*='retype_password' i], input[id*='verifyPassword' i], input[id*='confirmPassword' i], input[id*='retypePassword' i]"
      ).filter(isVisibleAndEditable);

      for (const pw of pwInputs) {
        if (setNativeValue(pw, activePassword)) {
          filled++;
          passwordFieldsFilled++;
          handledEls.add(pw);
        }
      }
    }

    const modeInfo = analyzeAuthPageMode(document);

    // 3. Fill ALL other registration fields on the page (First Name, Last Name, Full Name, Phone, Country, State, City, Zip, Security Question, etc.)
    // Only skip if a full multi-section job application with Resume Upload is inline below (handled by runFullAutofill)
    if (!hasDirectApplicationResumeOrSections(document)) {
      // 3a. Fill any custom comboboxes on the registration page (e.g. Country, State, Phone Country Code, How did you hear)
      const authCombos = queryAllDeep(
        document,
        "input[role='combobox'], button[aria-haspopup='listbox'], button[aria-haspopup='true'], [role='combobox']"
      ).filter((el) => {
        if (isTrapOrSystemInput(el) || isInHiddenAncestor(el) || el.disabled) return false;
        if (el.tagName !== "INPUT" && el.querySelector?.("input[role='combobox']")) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      for (const combo of authCombos) {
        if (hasComboboxSelection(combo)) continue;
        const ctx = getFieldContext(combo);
        const resolved = resolveDesiredValueForField(ctx, effectiveProfile, combo, null);
        if (resolved && !resolved.skip) {
          const ok = await fillComboboxControl(combo, resolved, ctx, null, false);
          if (ok) filled++;
        }
      }

      // 3b. Fill standard <input> and <select> fields on the registration page
      for (const el of allVisibleInputs) {
        if (handledEls.has(el)) continue;
        if (el.type === "password" || el.type === "checkbox" || el.type === "radio" || el.type === "file") continue;
        if (el.getAttribute("maxlength") === "1" || el.dataset?.otpBox === "true" || el.autocomplete === "one-time-code") continue;
        const ctx = getFieldContext(el);
        const fieldSig = `${el.name || ""} ${el.id || ""} ${ctx.fullLabel || ""}`;
        // Guard against disguised website/URL honeypots on standalone login/registration screens unless explicitly required
        if (/\b(website|homepage|blog|github|portfolio)\b/i.test(fieldSig) && !isFieldRequired(el, ctx)) {
          continue;
        }
        const desired = resolveDesiredValueForField(ctx, effectiveProfile, el, null);
        if (!desired || desired.skip) continue;
        if (el.tagName === "SELECT") {
          if (selectBestOption(el, desired)) {
            filled++;
            handledEls.add(el);
          }
        } else if (setNativeValue(el, desired[0])) {
          filled++;
          handledEls.add(el);
        }
      }
    }

    // 4. Expand "Read More" / Scrollable Terms containers + Accept Privacy Modal if required (e.g. Workday wd5, SAP SuccessFactors)
    const expandBtns = Array.from(
      document.querySelectorAll("[data-automation-id='createAccountExpandButton'], button, a[role='button'], [role='button']")
    ).filter((b) => isElementVisible(b) && /^(read\s*more|view\s*terms|expand(\s*terms)?|show\s*terms)$/i.test((b.innerText || "").trim()));
    for (const eb of expandBtns) {
      clickElementAndInner(eb, { bypassCooldown: true });
      await sleep(100);
    }

    const scrollableTerms = Array.from(
      document.querySelectorAll("[data-automation-id='signInContent'] div, form div, [role='dialog'] div")
    ).filter((d) => {
      if (!isElementVisible(d)) return false;
      return d.scrollHeight > d.clientHeight + 30 && d.clientHeight >= 60 && d.clientHeight <= 420;
    });
    for (const box of scrollableTerms) {
      try {
        box.scrollTop = box.scrollHeight;
        box.dispatchEvent(new Event("scroll", { bubbles: true }));
      } catch (_) {}
    }

    const modalAccepted = await acceptPrivacyModalIfRequired(document);
    filled += modalAccepted;

    // 5. Check all Terms / Privacy / Consent / Account Creation Checkboxes (both native <input type="checkbox"> and custom [role="checkbox"])
    const checkboxes = queryAllDeep(document, "input[type='checkbox']").filter(
      (cb) => !cb.disabled && !isTrapOrSystemInput(cb) && !isInHiddenAncestor(cb)
    );

    for (const cb of checkboxes) {
      const ctx = getFieldContext(cb);
      const optTxt = `${getChoiceOptionLabel(cb)} ${ctx.fullLabel} ${cb.dataset?.automationId || ""} ${cb.name || ""} ${cb.id || ""}`;
      if (NEGATIVE_CHECKBOX_REGEX.test(optTxt) || /remember\s*me|keep\s*me\s*signed|show\s*password/i.test(optTxt)) {
        continue;
      }
      if (
        !isCheckboxOrRadioChecked(cb) &&
        (cb.hasAttribute("data-jobify-auth-consent") ||
          cb.dataset?.automationId === "createAccountCheckbox" ||
          isFieldRequired(cb, ctx) ||
          /agree|terms|privacy|create|consent|accept|acknowledge|policy|18\s*years|age|authorize|confirm|statement/i.test(optTxt))
      ) {
        clickCheckboxOrRadioReliably(cb);
        if (isCheckboxOrRadioChecked(cb)) {
          filled++;
        }
      }
    }

    const ariaAuthCheckboxes = queryAllDeep(document, "[role='checkbox'], [role='switch']").filter(
      (cb) => isElementVisible(cb) && cb.getAttribute("aria-disabled") !== "true"
    );
    for (const acb of ariaAuthCheckboxes) {
      if (isCustomOptionSelected(acb)) continue;
      const ctx = getFieldContext(acb);
      const optTxt = `${getChoiceOptionLabel(acb)} ${ctx.fullLabel} ${acb.dataset?.automationId || ""}`;
      if (NEGATIVE_CHECKBOX_REGEX.test(optTxt) || /remember\s*me|keep\s*me\s*signed|show\s*password/i.test(optTxt)) continue;
      if (
        isFieldRequired(acb, ctx) ||
        /agree|terms|privacy|create|consent|accept|acknowledge|policy|18\s*years|age|authorize|confirm|statement/i.test(optTxt)
      ) {
        dispatchRealClick(acb);
        filled++;
      }
    }

    // Re-check if clicking a consent checkbox popped open a SAP SuccessFactors / enterprise privacy acceptance dialog
    filled += await acceptPrivacyModalIfRequired(document);

    return {
      filled,
      passwordFieldsFilled,
      isCreateMode: modeInfo.isCreateMode || passwordFieldsFilled >= 2
    };
  }

  function findAuthSubmitButton(preferCreateAccount = false, doc = document) {
    // 1. Workday click_filter overlay sits beside signInSubmitButton / createAccountSubmitButton
    const wdClickFilters = Array.from(
      doc.querySelectorAll(
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

    // 2. Standard Auth Submit Buttons across standard DOM & Shadow DOM (excluding top-navbar Sign In traps & switch links!)
    const candidates = queryAllDeep(
      doc,
      "[data-jobify-auth-submit], [data-automation-id*='createAccountSubmit' i], [data-automation-id*='signInSubmit' i], button[type='submit'], input[type='submit'], button, [role='button'], a[role='button'], input[type='button']"
    ).filter((b) => {
      if (isButtonDisabledState(b) || !isElementVisible(b)) return false;
      if (isHeaderOrNavButton(b)) return false;
      if (b.closest("#jobify-copilot-host") || b.closest(COOKIE_CONSENT_SELECTOR)) return false;
      const autoId = b.dataset?.automationId || "";
      if (/^(createAccountLink|signInLink|forgotPasswordLink|createAccountExpandButton)$/i.test(autoId)) return false;
      if (b.hasAttribute("data-jobify-switch-signup") || b.hasAttribute("data-jobify-switch-signin")) return false;
      const txt = (b.innerText || b.value || b.getAttribute("aria-label") || "")
        .replace(/[→›»↗⟶➔▶]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (/with\s+(google|apple|linkedin|microsoft|facebook|sso|github|indeed)/i.test(txt)) return false;
      if (/^(forgot|reset|cancel|back|clear|show\s*password|hide\s*password|read\s*more|privacy|terms)$/i.test(txt)) return false;
      return true;
    });

    const createPattern =
      /^(create\s*(an?\s*|your\s*|my\s*|new\s*|candidate\s*)?(account|profile)|sign\s*up(\s*(now|and\s*continue|&\s*apply|for\s*account))?|register(\s*(now|account|and\s*continue|&\s*apply))?|complete\s*(registration|sign\s*up)|join(\s*now)?|get\s*started|continue|verify|next|submit|save\s*(&|and)\s*continue)$/i;
    const signInPattern =
      /^(sign\s*in(\s*(and\s*continue|&\s*apply|to\s*apply))?|log\s*in(\s*(and\s*continue|&\s*apply|to\s*apply))?|login|submit|continue|next|proceed|verify|enter)$/i;

    // Pass 1: Strict match for preferred mode (Create Account vs Sign In)
    for (const b of candidates) {
      const txt = (b.innerText || b.value || b.getAttribute("aria-label") || "")
        .replace(/[→›»↗⟶➔▶]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const autoId = b.dataset?.automationId || "";
      if (
        b.hasAttribute("data-jobify-auth-submit") ||
        (preferCreateAccount && /createAccountSubmit/i.test(autoId)) ||
        (!preferCreateAccount && /signInSubmit/i.test(autoId)) ||
        (preferCreateAccount ? createPattern.test(txt) : signInPattern.test(txt))
      ) {
        return b;
      }
    }

    // Pass 2: Fallback to any valid auth submit button inside the form
    for (const b of candidates) {
      const txt = (b.innerText || b.value || b.getAttribute("aria-label") || "")
        .replace(/[→›»↗⟶➔▶]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (createPattern.test(txt) || signInPattern.test(txt)) {
        return b;
      }
      if ((b.type === "submit" || b.getAttribute("type") === "submit") && b.closest("form")) {
        return b;
      }
    }
    return null;
  }

  function findCreateAccountSwitchLink(doc = document) {
    // 1. Explicit automation IDs or href patterns
    const explicit = queryAllDeep(
      doc,
      "[data-automation-id='createAccountLink'], [data-uxi-element-id*='createAccount' i], [data-jobify-switch-signup]"
    ).find((el) => isElementVisible(el) && !el.disabled);
    if (explicit) return explicit;

    const els = queryAllDeep(
      doc,
      "button, a, [role='button'], [role='tab'], [role='link'], span[class*='link' i], div[class*='link' i], label[role='tab']"
    ).filter(
      (el) =>
        isElementVisible(el) &&
        !isHeaderOrNavButton(el) &&
        !el.closest("#jobify-copilot-host") &&
        !el.hasAttribute("data-jobify-auth-submit") &&
        !/createAccountSubmit|signInSubmit/i.test(el.dataset?.automationId || "")
    );

    // 2. Direct text match on link / button / tab
    const directMatch = els.find((el) => {
      const txt = (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
        .replace(/[→›»↗⟶➔▶]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!txt || txt.length > 95) return false;
      if (/with\s+(google|apple|linkedin|microsoft|facebook|indeed)/i.test(txt)) return false;
      return /(create\s*(an?\s*|your\s*|my\s*|new\s*|candidate\s*)?(account|profile)|sign\s*up(\s*(now|here|today|for\s*an?\s*account))?|\bregister(\s*(now|here|today|an?\s*account))?\b|new\s*(user|candidate|applicant|member)\b|don'?t\s*have\s*an?\s*account|not\s*registered|need\s*an?\s*account|first\s*time\s*(user|here|applying))/i.test(
        txt
      );
    });
    if (directMatch) return directMatch;

    // 3. Contextual parent match (e.g. <p>Don't have an account? <a href="/register">Click here / Create one</a></p>)
    const contextMatch = els.find((el) => {
      if (el.tagName !== "A" && el.tagName !== "BUTTON" && el.getAttribute("role") !== "button") return false;
      const parentTxt = (el.parentElement?.innerText || "").replace(/\s+/g, " ").trim();
      if (parentTxt.length > 160) return false;
      return /don'?t\s*have\s*an?\s*account|new\s*(user|candidate|applicant)|not\s*registered|need\s*an?\s*account|first\s*time\s*(user|here)/i.test(
        parentTxt
      );
    });
    return contextMatch || null;
  }

  function findSignInSwitchLink(doc = document) {
    const explicit = queryAllDeep(doc, "[data-automation-id='signInLink'], [data-jobify-switch-signin]").find(
      (el) => isElementVisible(el) && !el.disabled
    );
    if (explicit) return explicit;

    const els = queryAllDeep(doc, "button, a, [role='button'], [role='tab'], [role='link'], span[class*='link' i]").filter(
      (el) =>
        isElementVisible(el) &&
        !isHeaderOrNavButton(el) &&
        !el.closest("#jobify-copilot-host") &&
        !el.hasAttribute("data-jobify-auth-submit") &&
        !/createAccountSubmit|signInSubmit/i.test(el.dataset?.automationId || "")
    );

    const directMatch = els.find((el) => {
      const txt = (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
        .replace(/[→›»↗⟶➔▶]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!txt || txt.length > 90) return false;
      if (/with\s+(google|apple|linkedin|microsoft|facebook|indeed)/i.test(txt)) return false;
      return /^(sign\s*in|log\s*in|already\s*(have\s*an?\s*account|registered)|existing\s*(user|candidate|account)|return\s*to\s*(sign\s*in|log\s*in)|back\s*to\s*(sign\s*in|log\s*in))/i.test(
        txt
      );
    });
    if (directMatch) return directMatch;

    const contextMatch = els.find((el) => {
      if (el.tagName !== "A" && el.tagName !== "BUTTON" && el.getAttribute("role") !== "button") return false;
      const parentTxt = (el.parentElement?.innerText || "").replace(/\s+/g, " ").trim();
      if (parentTxt.length > 160) return false;
      return /already\s*(have\s*an?\s*account|registered)|existing\s*(user|candidate|account)/i.test(parentTxt);
    });
    return contextMatch || null;
  }

  function hasVisibleAuthError(doc = document) {
    // 1. High-signal explicit alert/error elements (including password policy errors inside explicit error banners)
    const explicitErrEls = queryAllDeep(
      doc,
      "[data-automation-id='errorMessage'], [data-automation-id*='error' i], [role='alert'], .error, .error-message, .alert-danger, .text-danger, .icims-error, [class*='fieldError' i], [class*='errorMessage' i], [data-jobify-auth-error]"
    ).filter((el) => isElementVisible(el) && !el.closest(COOKIE_CONSENT_SELECTOR));
    for (const el of explicitErrEls) {
      const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 300) continue;
      if (/^(current\s+)?step\s+\d+\s+of\s+\d+$/i.test(t)) continue;
      if (
        el.getAttribute("data-automation-id") === "errorMessage" ||
        el.hasAttribute("data-jobify-auth-error") ||
        /invalid|incorrect|wrong|not\s*found|no\s*account|doesn'?t\s*exist|does\s*not\s*exist|unable\s*to\s*(sign\s*in|log\s*in|create|authenticate|register)|authentication\s*failed|login\s*failed|unrecognized|already\s*(exists|registered|in\s*use|taken|associated)|duplicate\s*account|check\s*your\s*(email|credentials|password)|locked|not\s*match|does\s*not\s*meet|password\s*(must|cannot|is\s+too|policy|criteria)/i.test(
          t
        )
      ) {
        return t;
      }
    }

    // 2. General text scan inside auth container
    const errEls = Array.from(
      doc.querySelectorAll("[role='status'], [class*='invalid' i], form p, form div, form span, [data-automation-id='signInContent'] div")
    ).filter((el) => isElementVisible(el) && (!el.children || el.children.length <= 3));
    for (const el of errEls) {
      const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 260) continue;
      if (
        /invalid\s*(username|email|password|credentials|entry)|incorrect\s*(email|password|credentials)|no\s*account\s*found|doesn'?t\s*exist|does\s*not\s*exist|unable\s*to\s*(sign\s*in|log\s*in|create|authenticate)|authentication\s*failed|login\s*failed|already\s*(exists|registered|in\s*use|taken)|duplicate\s*account/i.test(
          t
        )
      ) {
        return t;
      }
    }
    return "";
  }

  function isPasswordPolicyAuthError(errText = "") {
    if (!errText) return false;
    if (/invalid\s*(username\s*(or|\/)\s*password|email\s*(or|\/)\s*password|credentials)|already\s*(exists|registered|in\s*use)/i.test(errText)) {
      return false;
    }
    return /password\s*(must|cannot|can'?t|does\s*not\s*meet|doesn'?t\s*meet|is\s*(too\s*(short|long|weak)|weak)|policy|criteria|requirements)|special\s*character|alphanumeric\s*only|uppercase|lowercase/i.test(
      errText
    );
  }

  async function submitAuthControlReliably(authBtn, isCreateMode, prevPwCount = 1, doc = document) {
    if (!authBtn) return false;
    // 1. Flush any active input blur so React/Angular/Vue onBlur validators (e.g. Workday password rules) settle before submit
    try {
      const active = doc.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "SELECT" || active.tagName === "TEXTAREA")) {
        active.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
        active.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        active.blur?.();
      }
    } catch (_) {}
    await sleep(90);

    const urlBefore = location.href;
    const countSameOriginAuthRequests = () => {
      try {
        if (typeof performance !== "undefined" && typeof performance.getEntriesByType === "function") {
          const originPrefix = location.origin || "";
          return performance
            .getEntriesByType("resource")
            .filter(
              (e) =>
                (e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest") &&
                (!originPrefix || String(e.name || "").startsWith(originPrefix)) &&
                !/telemetry|analytics|beacon|datadog|splunk|sentry|metrics/i.test(String(e.name || ""))
            ).length;
        }
      } catch (_) {}
      return 0;
    };
    const resCountBefore = countSameOriginAuthRequests();
    let formSubmitFired = false;
    const onFormSubmitCapture = () => {
      formSubmitFired = true;
    };
    try {
      doc.addEventListener("submit", onFormSubmitCapture, { capture: true, once: true });
    } catch (_) {}

    const didNetworkOrSubmitFire = () => {
      if (formSubmitFired) return true;
      return countSameOriginAuthRequests() > resCountBefore;
    };

    const isWdClickFilter =
      authBtn.getAttribute?.("data-automation-id") === "click_filter" ||
      authBtn.hasAttribute?.("data-jobify-click-filter") ||
      Boolean(authBtn.querySelector?.("[data-automation-id='click_filter']"));

    if (isWdClickFilter) {
      const cfNode =
        authBtn.getAttribute?.("data-automation-id") === "click_filter" || authBtn.hasAttribute?.("data-jobify-click-filter")
          ? authBtn
          : authBtn.querySelector("[data-automation-id='click_filter']");
      try {
        cfNode.removeAttribute("data-jobify-apply-clicked-ts");
        cfNode.scrollIntoView({ block: "center", behavior: "instant" });
        cfNode.click();
      } catch (_) {
        dispatchRealClick(cfNode);
      }

      // Only trigger sibling submit button as backup if the click was completely inert (zero form submit, zero network activity, zero UI change)
      await sleep(750);
      try {
        doc.removeEventListener("submit", onFormSubmitCapture, { capture: true });
      } catch (_) {}
      const pwNow = queryAllDeep(doc, "input[type='password']").filter(isVisibleAndEditable).length;
      const busy = Boolean(
        doc.querySelector("[aria-busy='true'], [data-automation-id='loadingSpinner'], [class*='loading' i], [class*='spinner' i]")
      );
      const sibSubmit =
        cfNode.parentElement?.querySelector(
          isCreateMode
            ? "button[data-automation-id='createAccountSubmitButton'], button[type='submit']"
            : "button[data-automation-id='signInSubmitButton'], button[type='submit']"
        ) || null;
      if (
        !didNetworkOrSubmitFire() &&
        !busy &&
        location.href === urlBefore &&
        pwNow === prevPwCount &&
        !hasVisibleAuthError(doc) &&
        !detectEmailVerificationBanner(doc) &&
        !detectOtpChallenge(doc).detected &&
        sibSubmit &&
        !isButtonDisabledState(sibSubmit)
      ) {
        try {
          sibSubmit.click();
        } catch (_) {}
      }
      return true;
    }

    clickElementAndInner(authBtn, { bypassCooldown: true });

    // For standard HTML <form> portals: if after 750ms click was completely inert (zero submit event, zero network fetch), call form.requestSubmit
    await sleep(750);
    try {
      doc.removeEventListener("submit", onFormSubmitCapture, { capture: true });
    } catch (_) {}
    const pwAfter = queryAllDeep(doc, "input[type='password']").filter(isVisibleAndEditable).length;
    const isBusy =
      isButtonDisabledState(authBtn) ||
      Boolean(doc.querySelector("[aria-busy='true'], .loading, .spinner, [class*='spinner' i]"));
    const parentForm = authBtn.closest?.("form");
    if (
      parentForm &&
      !didNetworkOrSubmitFire() &&
      !isBusy &&
      location.href === urlBefore &&
      pwAfter === prevPwCount &&
      !hasVisibleAuthError(doc) &&
      !detectEmailVerificationBanner(doc) &&
      !detectOtpChallenge(doc).detected &&
      typeof parentForm.requestSubmit === "function"
    ) {
      try {
        if (authBtn.tagName === "BUTTON" || authBtn.tagName === "INPUT") {
          parentForm.requestSubmit(authBtn);
        } else {
          parentForm.requestSubmit();
        }
      } catch (_) {}
    }
    return true;
  }

  async function waitForAuthStateTransition(prevPwCount, prevUrl = location.href, maxWaitMs = 4500) {
    const loops = Math.ceil(maxWaitMs / 300);
    for (let i = 0; i < loops; i++) {
      await sleep(300);
      const pwNow = queryAllDeep(document, "input[type='password']").filter(isVisibleAndEditable);
      if (pwNow.length !== prevPwCount) {
        return {
          pwCount: pwNow.length,
          err: hasVisibleAuthError(),
          verifyBanner: detectEmailVerificationBanner(document),
          hasFormNow: hasDirectApplicationResumeOrSections(document)
        };
      }
      if (hasDirectApplicationResumeOrSections(document)) {
        return { pwCount: 0, err: "", verifyBanner: false, hasFormNow: true };
      }
      const err = hasVisibleAuthError();
      if (err) return { pwCount: pwNow.length, err };
      if (detectEmailVerificationBanner(document)) return { pwCount: pwNow.length, err: "", verifyBanner: true };
      if (detectOtpChallenge(document).detected) return { pwCount: pwNow.length, err: "", otp: true };
      if (location.href !== prevUrl && pwNow.length === 0) {
        return { pwCount: 0, err: "", verifyBanner: detectEmailVerificationBanner(document) };
      }
    }
    const pwFinal = queryAllDeep(document, "input[type='password']").filter(isVisibleAndEditable);
    return {
      pwCount: pwFinal.length,
      err: hasVisibleAuthError(),
      verifyBanner: detectEmailVerificationBanner(document),
      hasFormNow: hasDirectApplicationResumeOrSections(document)
    };
  }

  // Autonomous Multi-Stage Auth Executor:
  // Analyzes any Login, OAuth Provider, SSO Chooser, or Create Account page like a human:
  // Handles OAuth Account Chooser -> Guest Bypass -> "Sign in with email" -> "Sign in with Google/Microsoft" -> Email-First -> Sign In <-> Create Account!
  async function performAutonomousAuth(credentials, authHistory = {}, profile = null) {
    let totalFilled = 0;
    let createdAccount = Boolean(authHistory?.createdAccount);
    let triedSignIn = Boolean(authHistory?.triedSignIn);
    let savedDomainPassword = null;
    const activeHostPassword = resolvePortalPasswordForHost(credentials);

    // Stage 0a: If already inside an OAuth Provider Screen (Google Accounts, Microsoft Live/Entra, or embedded OAuth Account Chooser)
    if (isOAuthProviderScreen(document)) {
      const oauthRes = await performOAuthProviderStep(credentials, profile, document);
      if (oauthRes.handled) {
        return {
          ...oauthRes,
          createdAccount,
          triedSignIn,
          needsEmailVerification: detectEmailVerificationBanner(document)
        };
      }
    }

    // Stage 0b: Click "Apply as a Guest" / "Continue without signing in" if available
    const guestBtn = findGuestOrSkipAuthButton(document);
    if (guestBtn) {
      clickElementAndInner(guestBtn, { bypassCooldown: true });
      await sleep(900);
      return {
        handled: true,
        filled: 1,
        clickedGuestBypass: true,
        submittedAuthForm: true,
        mode: "guest_bypass",
        createdAccount,
        triedSignIn,
        needsEmailVerification: false
      };
    }

    // Stage 0c: Click "Sign in with email" (Workday SignInWithEmailButton / SSO choice gate) when portalPassword is set (or no SSO button exists)
    const emailGateBtn = findEmailAuthChoiceButton(document);
    const hasAltSsoChoice = Boolean(
      findSsoProviderChoiceButton(document, credentials?.portalEmail || profile?.personal?.email || "ravitejavelanati11@gmail.com")
    );
    if (emailGateBtn && (activeHostPassword || !hasAltSsoChoice)) {
      clickElementAndInner(emailGateBtn, { bypassCooldown: true });
      for (let i = 0; i < 12; i++) {
        await sleep(300);
        const mounted = queryAllDeep(
          document,
          "input[type='password'], input[data-automation-id*='email' i], input[type='email']"
        ).some(isVisibleAndEditable);
        if (mounted) break;
      }
    }

    let pwVisible = queryAllDeep(document, "input[type='password']").filter(isVisibleAndEditable);

    // Stage 0d: Two-step Email-First Login / Signup (Email + Optional Consent Checkbox -> Continue -> Password / Registration / OTP)
    if (pwVisible.length === 0) {
      const emailFirst = detectEmailFirstAuthStep(document);
      if (emailFirst && credentials?.portalEmail) {
        const stepFill = await autofillPortalAuth(credentials, profile, activeHostPassword);
        totalFilled += stepFill.filled;
        if (!stepFill.filled && setNativeValue(emailFirst.emailInput, credentials.portalEmail)) {
          totalFilled++;
        }
        await sleep(140);
        clickElementAndInner(emailFirst.continueBtn, { bypassCooldown: true });
        for (let i = 0; i < 12; i++) {
          await sleep(300);
          pwVisible = queryAllDeep(document, "input[type='password']").filter(isVisibleAndEditable);
          if (
            pwVisible.length > 0 ||
            hasDirectApplicationResumeOrSections(document) ||
            detectOtpChallenge(document).detected ||
            detectEmailVerificationBanner(document) ||
            isOAuthProviderScreen(document)
          ) {
            break;
          }
        }
        if (isOAuthProviderScreen(document)) {
          const oauthStep = await performOAuthProviderStep(credentials, profile, document);
          totalFilled += oauthStep.filled || 0;
        }
        if (pwVisible.length === 0) {
          return {
            handled: true,
            filled: totalFilled,
            submittedAuthForm: true,
            mode: "email_first",
            createdAccount,
            triedSignIn,
            needsEmailVerification: detectEmailVerificationBanner(document)
          };
        }
      } else {
        // Stage 0e: Multi-Provider OAuth / Social Login Chooser (e.g. Microsoft Careers "Sign in with Google / Microsoft / LinkedIn / Facebook")
        const ssoChoice = findSsoProviderChoiceButton(
          document,
          credentials?.portalEmail || profile?.personal?.email || "ravitejavelanati11@gmail.com"
        );
        if (ssoChoice?.element) {
          document.documentElement.removeAttribute("data-jobify-last-window-open");
          try {
            ssoChoice.element.setAttribute("data-jobify-sso-clicked-ts", String(Date.now()));
          } catch (_) {}
          const ssoHref = extractElementHref(ssoChoice.element);
          clickElementAndInner(ssoChoice.element, { bypassCooldown: true });
          totalFilled++;
          for (let i = 0; i < 8; i++) {
            await sleep(280);
            if (isOAuthProviderScreen(document)) {
              const inlineOAuth = await performOAuthProviderStep(credentials, profile, document);
              totalFilled += inlineOAuth.filled || 0;
              break;
            }
            pwVisible = queryAllDeep(document, "input[type='password']").filter(isVisibleAndEditable);
            if (pwVisible.length > 0 || hasRealCandidateFormFields(document)) break;
          }
          const capturedWinOpen = document.documentElement.getAttribute("data-jobify-last-window-open") || "";
          if (pwVisible.length === 0) {
            return {
              handled: true,
              filled: totalFilled,
              clickedSsoGate: true,
              action: "sso_provider_gate",
              ssoProvider: ssoChoice.provider,
              ssoLabel: ssoChoice.label,
              windowOpenUrl: /^https?:\/\//i.test(capturedWinOpen) ? capturedWinOpen : null,
              href: ssoHref || null,
              submittedAuthForm: true,
              mode: `sso_${ssoChoice.provider}`,
              createdAccount,
              triedSignIn,
              needsEmailVerification: detectEmailVerificationBanner(document)
            };
          }
        }

        // Stage 0f: If no password input, email-first input, or SSO chooser, check if a "Create Account" or "Sign In" gate button opens the auth inputs
        const gateSwitch = !createdAccount
          ? findCreateAccountSwitchLink(document) || findSignInSwitchLink(document)
          : findSignInSwitchLink(document);
        if (gateSwitch) {
          clickElementAndInner(gateSwitch, { bypassCooldown: true });
          for (let i = 0; i < 10; i++) {
            await sleep(280);
            pwVisible = queryAllDeep(document, "input[type='password']").filter(isVisibleAndEditable);
            if (pwVisible.length > 0) break;
          }
        }
        const visibleSignInContent = Array.from(document.querySelectorAll("[data-automation-id='signInContent']")).some(
          isElementVisible
        );
        if (
          pwVisible.length === 0 &&
          (visibleSignInContent ||
            /\/(login|signin|sign-in|register|signup|sign-up|auth|account|candidate-login|applyManually)\b/i.test(
              `${location.pathname || ""}${location.search || ""}${location.hash || ""}`
            ))
        ) {
          for (let i = 0; i < 10; i++) {
            await sleep(280);
            const lateEmailBtn = findEmailAuthChoiceButton(document);
            if (lateEmailBtn && (activeHostPassword || !hasAltSsoChoice)) {
              clickElementAndInner(lateEmailBtn, { bypassCooldown: true });
              await sleep(500);
            }
            pwVisible = queryAllDeep(document, "input[type='password']").filter(isVisibleAndEditable);
            if (pwVisible.length > 0) break;
          }
        }
        if (pwVisible.length === 0) {
          return {
            handled: Boolean(emailGateBtn || gateSwitch),
            filled: totalFilled,
            clickedEmailGate: Boolean(emailGateBtn || gateSwitch),
            createdAccount,
            triedSignIn,
            needsEmailVerification: detectEmailVerificationBanner(document)
          };
        }
      }
    }

    // Ensure Workday / SPA auth container React handlers & submit overlay finish binding before filling
    if (Array.from(document.querySelectorAll("[data-automation-id='signInContent']")).some(isElementVisible)) {
      for (let i = 0; i < 6; i++) {
        if (
          Array.from(
            document.querySelectorAll("[data-automation-id='click_filter'], button[data-automation-id*='Submit' i]")
          ).some(isElementVisible)
        ) {
          break;
        }
        await sleep(220);
      }
      await sleep(260);
    }

    // Guard: If full application form WITH resume upload / work history is simultaneously inline below password fields, only fill without clicking standalone auth submit
    if (hasDirectApplicationResumeOrSections(document) && !document.querySelector("[data-jobify-auth-step-only='true']")) {
      const inlineFill = await autofillPortalAuth(credentials, profile, activeHostPassword);
      return {
        handled: true,
        filled: totalFilled + inlineFill.filled,
        submittedAuthForm: false,
        mode: inlineFill.isCreateMode ? "create_inline" : "signin_inline",
        createdAccount,
        triedSignIn
      };
    }

    // Stage 1: Analyze current page mode (Sign In vs Create Account) and pre-switch if appropriate!
    let modeAnalysis = analyzeAuthPageMode(document);
    const preErr = hasVisibleAuthError();

    if (modeAnalysis.isCreateMode && createdAccount && (/already\s*(exists|registered|in\s*use|taken)|duplicate/i.test(preErr) || authHistory?.verifiedEmailLink)) {
      const toSignIn = findSignInSwitchLink();
      if (toSignIn) {
        clickElementAndInner(toSignIn, { bypassCooldown: true });
        await sleep(750);
        modeAnalysis = analyzeAuthPageMode(document);
      }
    } else if (!modeAnalysis.isCreateMode && !createdAccount && (preErr || triedSignIn)) {
      // We already tried Sign In (or an error is already on screen) -> immediately switch to Create Account!
      const toCreate = findCreateAccountSwitchLink();
      if (toCreate) {
        clickElementAndInner(toCreate, { bypassCooldown: true });
        for (let i = 0; i < 10; i++) {
          await sleep(250);
          modeAnalysis = analyzeAuthPageMode(document);
          if (modeAnalysis.isCreateMode) break;
        }
      }
    }

    // Stage 2: Fill all fields on the active auth form (Email, Password, Confirm Password, First/Last Name, Phone, Country, Checkboxes, etc.)
    let currentPasswordUsed = activeHostPassword;
    const fillRes = await autofillPortalAuth(credentials, profile, currentPasswordUsed);
    totalFilled += fillRes.filled;
    const isCreateMode = fillRes.isCreateMode || modeAnalysis.isCreateMode;

    await sleep(120);
    let authBtn = findAuthSubmitButton(isCreateMode);
    if (!authBtn) {
      for (let w = 0; w < 4; w++) {
        await sleep(220);
        authBtn = findAuthSubmitButton(isCreateMode);
        if (authBtn) break;
      }
    }
    if (!authBtn) {
      return { handled: true, filled: totalFilled, submittedAuthForm: false, createdAccount, triedSignIn };
    }

    if (isCreateMode) createdAccount = true;
    else triedSignIn = true;

    const urlBeforeSubmit = location.href;
    await submitAuthControlReliably(authBtn, isCreateMode, fillRes.passwordFieldsFilled, document);
    let afterFirst = await waitForAuthStateTransition(fillRes.passwordFieldsFilled, urlBeforeSubmit, 4200);

    // If Create Account failed specifically due to portal password policy rules, synthesize compliant domain password & retry immediately!
    if (isCreateMode && afterFirst.pwCount >= 1 && isPasswordPolicyAuthError(afterFirst.err)) {
      const upgradedPw = buildCompliantDomainPassword(afterFirst.err, location.hostname);
      if (upgradedPw && upgradedPw !== currentPasswordUsed) {
        currentPasswordUsed = upgradedPw;
        savedDomainPassword = { host: location.hostname.toLowerCase(), password: upgradedPw };
        const retryFill = await autofillPortalAuth(credentials, profile, currentPasswordUsed);
        totalFilled += retryFill.filled;
        await sleep(120);
        const retryBtn = findAuthSubmitButton(true);
        if (retryBtn) {
          await submitAuthControlReliably(retryBtn, true, retryFill.passwordFieldsFilled, document);
          afterFirst = await waitForAuthStateTransition(retryFill.passwordFieldsFilled, location.href, 4200);
        }
      }
    }

    // Case 1: Logged straight into the application form or OTP challenge!
    if (afterFirst.pwCount === 0 || afterFirst.hasFormNow || afterFirst.otp) {
      return {
        handled: true,
        filled: totalFilled,
        submittedAuthForm: true,
        mode: isCreateMode ? "create_account_complete" : "sign_in_complete",
        createdAccount,
        triedSignIn,
        savedDomainPassword,
        needsEmailVerification: Boolean(afterFirst.verifyBanner) || detectEmailVerificationBanner(document)
      };
    }

    // Case 2: Started on Create Account (Step 1) -> Workday/ATS transitioned to Sign In (Step 2) OR reported "account already exists"!
    if (isCreateMode) {
      if (afterFirst.pwCount === 1 && !afterFirst.err && !analyzeAuthPageMode(document).isCreateMode) {
        if (afterFirst.verifyBanner || detectEmailVerificationBanner(document)) {
          return {
            handled: true,
            filled: totalFilled,
            submittedAuthForm: true,
            mode: "create_awaiting_email_verify",
            createdAccount: true,
            triedSignIn: false,
            savedDomainPassword,
            needsEmailVerification: true
          };
        }
        // Step 1 (Create Account) succeeded and opened Step 2 (Sign In) — immediately Sign In!
        await sleep(350);
        const loginFill = await autofillPortalAuth(credentials, profile, currentPasswordUsed);
        totalFilled += loginFill.filled;
        triedSignIn = true;
        const loginBtn = findAuthSubmitButton(false);
        if (loginBtn) {
          await submitAuthControlReliably(loginBtn, false, 1, document);
          await waitForAuthStateTransition(1, location.href, 4000);
        }
        return {
          handled: true,
          filled: totalFilled,
          submittedAuthForm: true,
          mode: "create_then_signin",
          createdAccount: true,
          triedSignIn: true,
          savedDomainPassword,
          needsEmailVerification: detectEmailVerificationBanner(document)
        };
      }

      if (afterFirst.err && !isPasswordPolicyAuthError(afterFirst.err)) {
        // Account already exists on this tenant -> switch from Create Account to Sign In and log in!
        const signInSwitch = findSignInSwitchLink();
        if (signInSwitch) {
          clickElementAndInner(signInSwitch, { bypassCooldown: true });
          for (let i = 0; i < 10; i++) {
            await sleep(250);
            if (!analyzeAuthPageMode(document).isCreateMode) break;
          }
          await sleep(180);
          const loginFill = await autofillPortalAuth(credentials, profile, activeHostPassword);
          totalFilled += loginFill.filled;
          triedSignIn = true;
          const loginBtn = findAuthSubmitButton(false);
          if (loginBtn) {
            await submitAuthControlReliably(loginBtn, false, 1, document);
            await waitForAuthStateTransition(1, location.href, 4000);
          }
          return {
            handled: true,
            filled: totalFilled,
            submittedAuthForm: true,
            switchedToSignIn: true,
            createdAccount: true,
            triedSignIn: true,
            savedDomainPassword,
            needsEmailVerification: detectEmailVerificationBanner(document)
          };
        }
      }
    }

    // Case 3: Started on Sign In -> did NOT log in (either showed an error OR stayed on the password screen) -> Switch to Create Account, fill ALL fields, and tap Create Account!
    if (!isCreateMode && (afterFirst.err || afterFirst.pwCount >= 1) && !authHistory?.createdAccount) {
      const switchBtn = findCreateAccountSwitchLink();
      if (switchBtn) {
        const urlBeforeSwitch = location.href;
        clickElementAndInner(switchBtn, { bypassCooldown: true });
        for (let i = 0; i < 12; i++) {
          await sleep(250);
          const checkMode = analyzeAuthPageMode(document);
          if (checkMode.isCreateMode || location.href !== urlBeforeSwitch) break;
        }
        await sleep(220);
        const signupRes = await autofillPortalAuth(credentials, profile, currentPasswordUsed);
        totalFilled += signupRes.filled;
        await sleep(120);
        let createBtn = findAuthSubmitButton(true);
        if (!createBtn) {
          for (let w = 0; w < 4; w++) {
            await sleep(220);
            createBtn = findAuthSubmitButton(true);
            if (createBtn) break;
          }
        }
        if (createBtn) {
          createdAccount = true;
          const urlBeforeCreate = location.href;
          await submitAuthControlReliably(createBtn, true, signupRes.passwordFieldsFilled, document);
          let afterSignup = await waitForAuthStateTransition(signupRes.passwordFieldsFilled, urlBeforeCreate, 4200);

          // Password policy auto-upgrade inside Case 3 (Sign In -> Create Account)
          if (afterSignup.pwCount >= 1 && isPasswordPolicyAuthError(afterSignup.err)) {
            const upgradedPw = buildCompliantDomainPassword(afterSignup.err, location.hostname);
            if (upgradedPw && upgradedPw !== currentPasswordUsed) {
              currentPasswordUsed = upgradedPw;
              savedDomainPassword = { host: location.hostname.toLowerCase(), password: upgradedPw };
              const retrySignup = await autofillPortalAuth(credentials, profile, currentPasswordUsed);
              totalFilled += retrySignup.filled;
              await sleep(120);
              const retryCreateBtn = findAuthSubmitButton(true);
              if (retryCreateBtn) {
                await submitAuthControlReliably(retryCreateBtn, true, retrySignup.passwordFieldsFilled, document);
                afterSignup = await waitForAuthStateTransition(retrySignup.passwordFieldsFilled, location.href, 4200);
              }
            }
          }

          // If creating the account immediately landed back on 1-password Sign In (and no email-verify gate is blocking yet), log right in!
          if (
            afterSignup.pwCount === 1 &&
            !afterSignup.err &&
            !analyzeAuthPageMode(document).isCreateMode &&
            !(afterSignup.verifyBanner || detectEmailVerificationBanner(document))
          ) {
            await sleep(350);
            const postLogin = await autofillPortalAuth(credentials, profile, currentPasswordUsed);
            totalFilled += postLogin.filled;
            const postLoginBtn = findAuthSubmitButton(false);
            if (postLoginBtn) {
              await submitAuthControlReliably(postLoginBtn, false, 1, document);
              await waitForAuthStateTransition(1, location.href, 4000);
            }
          }
        }
        return {
          handled: true,
          filled: totalFilled,
          submittedAuthForm: true,
          switchedToCreateAccount: true,
          createdAccount,
          triedSignIn: true,
          savedDomainPassword,
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
      savedDomainPassword,
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

  async function fillRepeaterCards(profile) {
    let filled = 0;

    // Auto-expand empty Workday / career portal Work Experience & Education sections when an "Add" button is present
    const tryAutoExpandEmptySection = async (sectionSelector, cardSelector, itemsList) => {
      if (!Array.isArray(itemsList) || itemsList.length === 0) return;
      const sec = document.querySelector(sectionSelector);
      if (!sec || !isElementVisible(sec)) return;
      if (sec.querySelectorAll(cardSelector).length > 0) return;
      const addBtn = Array.from(
        sec.querySelectorAll("[data-automation-id='Add'], [data-automation-id='add-button'], button, [role='button']")
      ).find((b) => {
        if (b.disabled || !isElementVisible(b)) return false;
        const txt = (b.innerText || b.textContent || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        return b.dataset?.automationId === "Add" || b.dataset?.automationId === "add-button" || /^add(\s+(another|work\s*experience|education|entry))?$/i.test(txt);
      });
      if (addBtn) {
        dispatchRealClick(addBtn);
        await sleep(180);
      }
    };

    await tryAutoExpandEmptySection(
      "[data-automation-id='workExperienceSection'], [data-jobify-exp-section]",
      "[data-automation-id^='workExperience-'], [data-jobify-exp-index], .work-experience-card",
      profile.workExperience
    );
    await tryAutoExpandEmptySection(
      "[data-automation-id='educationSection'], [data-jobify-edu-section]",
      "[data-automation-id^='education-'], [data-jobify-edu-index], .education-card",
      profile.education
    );

    const expContainers = Array.from(
      document.querySelectorAll("[data-automation-id^='workExperience-'], [data-jobify-exp-index], .work-experience-card")
    );
    for (let idx = 0; idx < expContainers.length; idx++) {
      const card = expContainers[idx];
      const exp = (profile.workExperience || [])[idx];
      if (!exp) continue;

      if (exp.currentlyWorking !== undefined) {
        const curCb = Array.from(card.querySelectorAll("input[type='checkbox']")).find((cb) =>
          /currently\s*work|current\s*(role|position)/i.test(getFieldLabelText(cb))
        );
        if (curCb && isVisibleAndEditable(curCb) && Boolean(exp.currentlyWorking) !== curCb.checked) {
          clickCheckboxOrRadioReliably(curCb);
          filled++;
          await sleep(60);
        }
      }

      const inputs = Array.from(card.querySelectorAll("input, textarea, select"));
      for (const inp of inputs) {
        if (inp.type === "checkbox" || isComboboxInput(inp)) continue;
        if (!isVisibleAndEditable(inp)) continue;
        const lbl = `${getFieldLabelText(inp)} ${inp.dataset?.automationId || ""} ${inp.placeholder || ""}`.toLowerCase();
        const sMonth = String(exp.startMonth || "05").padStart(2, "0");
        const sYear = String(exp.startYear || "2024");
        const eMonth = String(exp.endMonth || "05").padStart(2, "0");
        const eYear = String(exp.endYear || "2026");

        if (/datesectionmonth/i.test(lbl) || inp.placeholder === "MM") {
          const isEnd = Boolean(inp.closest("[data-automation-id*='endDate' i]")) || /\bend\b|\bto\b/i.test(lbl);
          if (isEnd && exp.currentlyWorking) continue;
          if (setNativeValue(inp, isEnd ? eMonth : sMonth)) filled++;
        } else if (/datesectionyear/i.test(lbl) || inp.placeholder === "YYYY") {
          const isEnd = Boolean(inp.closest("[data-automation-id*='endDate' i]")) || /\bend\b|\bto\b/i.test(lbl);
          if (isEnd && exp.currentlyWorking) continue;
          if (setNativeValue(inp, isEnd ? eYear : sYear)) filled++;
        } else if (/job\s*title|role|position/i.test(lbl)) {
          if (setNativeValue(inp, exp.title)) filled++;
        } else if (/company|employer|organization/i.test(lbl)) {
          if (setNativeValue(inp, exp.company)) filled++;
        } else if (/location|city/i.test(lbl)) {
          if (setNativeValue(inp, exp.location)) filled++;
        } else if (/start/i.test(lbl)) {
          if (setNativeValue(inp, exp.startDateDisplay || `${sMonth}/${sYear}`)) filled++;
        } else if (/end/i.test(lbl) && !exp.currentlyWorking) {
          if (setNativeValue(inp, exp.endDateDisplay || `${eMonth}/${eYear}`)) filled++;
        } else if (/description|responsibilit|summary|highlights|role\s*description/i.test(lbl) || inp.tagName === "TEXTAREA") {
          const text = (exp.highlights || []).map((b) => `• ${b}`).join("\n");
          if (text && setNativeValue(inp, text)) filled++;
        }
      }
    }

    const eduContainers = Array.from(
      document.querySelectorAll("[data-automation-id^='education-'], [data-jobify-edu-index], .education-card")
    );
    for (let idx = 0; idx < eduContainers.length; idx++) {
      const card = eduContainers[idx];
      const edu = (profile.education || [])[idx];
      if (!edu) continue;

      const combos = Array.from(
        card.querySelectorAll("input[role='combobox'], button[aria-haspopup='listbox'], [role='combobox'], input[data-automation-id='searchBox']")
      ).filter((c) => !c.disabled && !isInHiddenAncestor(c) && !hasComboboxSelection(c));
      for (const cb of combos) {
        const ctx = getFieldContext(cb);
        const cLow = `${ctx.fullLabel} ${cb.dataset?.automationId || ""}`.toLowerCase();
        let candidates = null;
        if (/degree/i.test(cLow)) {
          candidates = [edu.degree, edu.degreeShort, "Master's Degree", "Master of Science", "Masters", "Bachelor's Degree"];
        } else if (/field|major|discipline/i.test(cLow)) {
          candidates = [edu.fieldOfStudy, "Computer Science", "Software Engineering"];
        } else if (/school|university|college|institution/i.test(cLow)) {
          candidates = [edu.school];
        }
        if (candidates) {
          if (await fillComboboxControl(cb, candidates, ctx, null, false)) filled++;
        }
      }

      const inputs = Array.from(card.querySelectorAll("input, textarea, select"));
      for (const inp of inputs) {
        if (isComboboxInput(inp) || !isVisibleAndEditable(inp)) continue;
        const lbl = `${getFieldLabelText(inp)} ${inp.dataset?.automationId || ""} ${inp.placeholder || ""}`.toLowerCase();
        if (/datesectionyear/i.test(lbl) || inp.placeholder === "YYYY") {
          const isEnd = Boolean(inp.closest("[data-automation-id*='endDate' i], [data-automation-id*='lastYearAttended' i]")) || /\bend\b|\bto\b|graduat|last\s*year/i.test(lbl);
          if (setNativeValue(inp, isEnd ? String(edu.endYear || "2025") : String(edu.startYear || "2023"))) filled++;
        } else if (/school|university|college|institution/i.test(lbl)) {
          if (setNativeValue(inp, edu.school)) filled++;
        } else if (/degree/i.test(lbl)) {
          if (inp.tagName === "SELECT") {
            if (selectBestOption(inp, [edu.degree, edu.degreeShort, "Master's Degree", "Master's", "Bachelor's"])) filled++;
          } else if (setNativeValue(inp, edu.degree)) filled++;
        } else if (/field|major|discipline/i.test(lbl)) {
          if (setNativeValue(inp, edu.fieldOfStudy)) filled++;
        } else if (/gpa|overall\s*result/i.test(lbl)) {
          if (setNativeValue(inp, edu.gpa)) filled++;
        } else if (/start|first\s*year/i.test(lbl)) {
          if (setNativeValue(inp, edu.startYear)) filled++;
        } else if (/end|graduat|last\s*year/i.test(lbl)) {
          if (setNativeValue(inp, edu.endYear)) filled++;
        }
      }
    }

    return filled;
  }

  function isOptionalUnneededExtraField(el, ctx, required) {
    if (required) return false;
    const pLow = `${ctx?.primaryLabel || ""} ${ctx?.helperText || ""}`.toLowerCase();
    // Skip optional "Additional information", "Anything else?", "(Optional)", "Optional: ..." so we never add unrequested fluff
    if (
      /\boptional\b|\(optional\)|additional\s*(information|comments|notes|context)|anything\s*else|other\s*information|is\s*there\s*anything\s*else/i.test(
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

  async function askAiToPickOption(label, optionLabels, jobMeta, profile = null) {
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
    if (isBinaryYesNoOptionList(cleanOptions)) {
      return resolveBinaryYesNoFallback(label, profile || {});
    }
    return null;
  }

  function findOpenEndedFields(profile = { personal: {}, workAuthAndEEO: {} }, jobMeta = null, options = {}) {
    const skipOptionalExtras = options.skipOptionalExtras !== false;
    const includeAllUnresolved = Boolean(options.includeAllUnresolved);
    const results = [];
    const candidates = queryAllDeep(
      document,
      "textarea, input[type='text'], input[type='url'], input:not([type])"
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
      const optTexts = grp.options.map((o) => o.text);
      const isBinYesNo = isBinaryYesNoOptionList(optTexts);
      if (!desired && (grp.required || isBinYesNo || !onlyNeededCleanMode) && fillOpenEndedWithAI) {
        desired = await askAiToPickOption(grp.label, optTexts, jobMeta, profile);
      }
      if (!desired && isBinYesNo) {
        desired = resolveBinaryYesNoFallback(grp.label, profile);
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

    const allEls = queryAllDeep(
      document,
      "input, select, textarea, [role='combobox'], button[aria-haspopup='listbox']"
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
        const radioScope = el.getRootNode?.() || document;
        const groupRadios = el.name
          ? Array.from(radioScope.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`))
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
        const cbGroup = resolveCheckboxGroup(el, el.getRootNode?.() || document);
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
    const inputs = queryAllDeep(document, "input, select, textarea").filter((el) =>
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

  function extractElementHref(el) {
    if (!el) return null;
    const anchor = el.tagName === "A" ? el : el.closest?.("a[href]") || el.querySelector?.("a[href]");
    const raw =
      anchor?.getAttribute?.("href") ||
      el.getAttribute?.("href") ||
      el.dataset?.href ||
      el.dataset?.url ||
      el.dataset?.applyUrl ||
      el.getAttribute?.("formaction") ||
      "";
    const trimmed = String(raw || "").trim();
    if (!trimmed || /^#|^javascript:|^mailto:|^tel:/i.test(trimmed)) return null;
    try {
      return new URL(trimmed, location.href).href;
    } catch (_) {
      return null;
    }
  }

  function clickElementAndInner(el, opts = {}) {
    if (!el) return;
    const bypassCooldown = Boolean(opts?.bypassCooldown);
    const now = Date.now();
    const actionSig = (
      `${el.innerText || el.textContent || el.value || el.getAttribute?.("aria-label") || ""}|${el.getAttribute?.("href") || ""}|${el.dataset?.automationId || ""}`
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    const lastClickTs = Number(el.getAttribute?.("data-jobify-apply-clicked-ts") || 0);
    const lastClickSig = el.getAttribute?.("data-jobify-apply-clicked-sig") || "";
    if (!bypassCooldown && lastClickSig === actionSig && now - lastClickTs < 1500) return;
    try {
      el.setAttribute?.("data-jobify-apply-clicked-ts", String(now));
      el.setAttribute?.("data-jobify-apply-clicked-sig", actionSig);
      el.scrollIntoView({ block: "center", behavior: "instant" });
    } catch (_) {}

    const stripBlankTargetOnAnchor = (node) => {
      const anchor = node?.tagName === "A" ? node : node?.closest?.("a");
      if (!anchor) return;
      const rawHref = (anchor.getAttribute("href") || "").trim();
      if (anchor.getAttribute("target") === "_blank" && rawHref && !/^javascript:|^#/i.test(rawHref)) {
        try {
          anchor.removeAttribute("target");
        } catch (_) {}
      }
    };

    const selfIsFilter = el.getAttribute?.("data-automation-id") === "click_filter";
    const wdFilter = selfIsFilter
      ? el
      : el.querySelector?.("[data-automation-id='click_filter']") ||
        (el.tagName !== "BUTTON" && el.tagName !== "A"
          ? el.parentElement?.querySelector?.("[data-automation-id='click_filter']")
          : null);
    if (wdFilter && isElementVisible(wdFilter)) {
      stripBlankTargetOnAnchor(wdFilter);
      dispatchRealClick(wdFilter);
      if (wdFilter !== el && (el.tagName === "BUTTON" || el.tagName === "A")) {
        try {
          el.click();
        } catch (_) {}
      }
      return;
    }
    const innerAction =
      el.tagName !== "A" && el.tagName !== "BUTTON"
        ? el.querySelector?.("a, button, [role='button']")
        : null;
    if (innerAction && isElementVisible(innerAction)) {
      try {
        innerAction.setAttribute?.("data-jobify-apply-clicked-ts", String(now));
        innerAction.setAttribute?.("data-jobify-apply-clicked-sig", actionSig);
      } catch (_) {}
      stripBlankTargetOnAnchor(innerAction);
      dispatchRealClick(innerAction);
      return;
    }
    stripBlankTargetOnAnchor(el);
    dispatchRealClick(el);
  }

  // Detect open "Start Your Application" / Apply-Method Choice Modal (e.g. Workday Apply Manually vs LinkedIn / Last Application)
  function findApplyModalChoiceButton(doc = document) {
    const explicitManual = Array.from(
      doc.querySelectorAll(
        "[data-automation-id='applyManually'], [data-uxi-element-id*='applyManually' i], [data-jobify-apply-manual]"
      )
    ).find((el) => isElementVisible(el) && !el.disabled);
    if (explicitManual) {
      return explicitManual.querySelector?.("a, button") || explicitManual;
    }

    const visibleInteractive = Array.from(
      doc.querySelectorAll("a, button, [role='button'], input[type='button'], input[type='submit']")
    ).filter(
      (el) =>
        !el.disabled &&
        isElementVisible(el) &&
        !isHeaderOrNavButton(el) &&
        !el.closest("#application_form, #application-form, #grnhse_app, [class*='ashby-application-form']")
    );

    const manualTextBtn = visibleInteractive.find((el) => {
      const txt = (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || "")
        .replace(/[→›»↗⟶➔▶]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return /^(apply\s*manually|manually\s*apply|fill\s*out\s*manually|manual\s*application|continue\s*manually|apply\s*without\s*linkedin)$/i.test(
        txt
      );
    });
    if (manualTextBtn) return manualTextBtn;

    // Fallback inside an open dialog ONLY if no "Apply Manually" exists (never pick LinkedIn or Use My Last Application!)
    const modalRoot = Array.from(
      doc.querySelectorAll(
        "[data-automation-id='wd-popup-frame'], [data-automation-id*='popup' i], [role='dialog'], [aria-modal='true'], dialog[open]"
      )
    ).find(isElementVisible);
    if (modalRoot) {
      // Do not treat an active candidate form modal (e.g. Easy Apply with First/Last Name inputs) as a pre-form choice modal
      const modalInputs = Array.from(modalRoot.querySelectorAll("input, select, textarea")).filter((i) => {
        if (isTrapOrSystemInput(i) || i.disabled) return false;
        if (
          i.type === "hidden" ||
          i.type === "submit" ||
          i.type === "button" ||
          i.type === "password" ||
          i.type === "checkbox" ||
          i.type === "radio"
        ) {
          return false;
        }
        return isVisibleAndEditable(i);
      });
      if (modalInputs.length >= 2) return null;

      const autofillBtn = Array.from(
        modalRoot.querySelectorAll(
          "[data-automation-id='autofillWithResume'], [data-automation-id*='apply' i], a, button, [role='button']"
        )
      ).find((el) => {
        if (!isElementVisible(el) || el.disabled) return false;
        const autoId = el.dataset?.automationId || "";
        if (/linkedin|useMyLast|close|cancel/i.test(autoId)) return false;
        const txt = (el.innerText || el.textContent || "").replace(/[→›»↗⟶➔▶]+/g, "").replace(/\s+/g, " ").trim();
        if (/linkedin|indeed|last\s*(application|location)|cancel|close|back/i.test(txt)) return false;
        return (
          autoId === "autofillWithResume" ||
          /^(autofill\s*with\s*resume|upload\s*a?\s*resume|continue\s*without\s*linkedin|start(\s+your|\s+new)?\s+application|create\s+new\s+application)$/i.test(
            txt
          )
        );
      });
      if (autofillBtn) return autofillBtn;
    }

    return null;
  }

  function hasRealCandidateFormFields(doc = document) {
    // If an Apply-Method modal ("Apply Manually") is open on top of the page, we are not in the candidate form yet
    if (findApplyModalChoiceButton(doc)) return false;

    const hasDirectAppSections = hasDirectApplicationResumeOrSections(doc);

    // If a password input, OAuth chooser, Email-Choice gate, or 2-step Email-First gate is visible and there is no
    // Resume upload or application section on the page, this is a standalone Login / Create Account / Auth wall!
    const hasVisiblePassword = queryAllDeep(doc, "input[type='password']").some(isVisibleAndEditable);
    if (
      !hasDirectAppSections &&
      (hasVisiblePassword ||
        isOAuthProviderScreen(doc) ||
        Boolean(findEmailAuthChoiceButton(doc)) ||
        Boolean(detectEmailFirstAuthStep(doc)))
    ) {
      return false;
    }

    if (queryAllDeep(doc, "input[type='file']").some(isActionableFileInput)) {
      return true;
    }

    const visibleInputs = queryAllDeep(
      doc,
      "input, select, textarea, [role='combobox'], button[aria-haspopup='listbox'], button[aria-haspopup='true']"
    ).filter((el) => {
      if (isTrapOrSystemInput(el) || el.disabled) return false;
      if (
        el.type === "password" ||
        el.type === "hidden" ||
        el.type === "submit" ||
        el.type === "button" ||
        el.type === "checkbox" ||
        el.type === "radio"
      ) {
        return false;
      }
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
      const sig = `${el.id || ""} ${el.name || ""} ${el.autocomplete || ""} ${el.placeholder || ""} ${el.dataset?.automationId || ""} ${el.getAttribute?.("aria-label") || ""}`.toLowerCase();
      if (
        /first[_-\s]?name|last[_-\s]?name|full[_-\s]?name|given[_-\s]?name|family[_-\s]?name|legal[_-\s]?name|_systemfield_name|phone[-_\s]?number|\bphone\b|\bmobile\b|linkedin|github|portfolio|street[_-\s]?address|address[_-\s]?line|addresssection|postal[_-\s]?code|zip[_-\s]?code|how\s+did\s+you\s+hear|work\s+authoriz|sponsorship|visa\s+status|desired\s+salary|compensation|years\s+of\s+experience/i.test(
          sig
        )
      ) {
        return true;
      }
      const ctx = getFieldContext(el);
      if (
        /first\s*name|last\s*name|full\s*name|given\s*name|family\s*name|legal\s*name|phone\s*number|mobile\s*number|linkedin|github|portfolio|street\s*address|address\s*line|postal\s*code|zip\s*code|how\s+did\s+you\s+hear|authorized\s+to\s+work|work\s+authorization|require\s+sponsorship|visa\s+sponsorship|desired\s+salary|salary\s+expectations|years\s+of\s+experience|cover\s+letter/i.test(
          ctx.fullLabel
        )
      ) {
        return true;
      }
    }

    const insideAppContainer = visibleInputs.filter((el) =>
      Boolean(
        el.closest(
          "[data-automation-id*='applyFlow' i], [data-automation-id*='myInformation' i], [data-automation-id*='contactInformation' i], [class*='ashby-application-form'], #application_form, #grnhse_app, .application-form, [class*='applicationForm' i], [class*='apply-form' i], [id*='application-form' i], [id*='apply-form' i], [role='dialog'], [aria-modal='true'], form:not([role='search']):not([action*='search' i])"
        )
      )
    );
    if (
      insideAppContainer.some((el) =>
        Boolean(
          el.closest(
            "[data-automation-id*='applyFlow' i], [data-automation-id*='myInformation' i], [data-automation-id*='contactInformation' i], [class*='ashby-application-form'], #application_form, #grnhse_app"
          )
        )
      )
    ) {
      return true;
    }
    return insideAppContainer.length >= 2 || visibleInputs.length >= 3;
  }

  function findApplyEntryCandidates(doc = document) {
    return queryAllDeep(
      doc,
      "[data-automation-id='adventureButton'], [data-uxi-element-id*='adventureButton' i], [data-automation-id*='applyButton' i], [data-jobify-apply-btn], a[href$='/application'], a[href*='/application?'], a.postings-btn[href*='/apply'], a[href*='/careers/apply/'], a[href*='/apply/'], [class*='apply-button' i], [id*='apply-button' i], button, a[role='button'], a[role='tab'], [role='button'], input[type='button'], input[type='submit'], a"
    ).filter((el) => {
      if (el.disabled || !isElementVisible(el)) return false;
      if (isHeaderOrNavButton(el)) return false;
      if (el.closest(COOKIE_CONSENT_SELECTOR)) return false;
      if (el.closest("#jobify-copilot-host")) return false;
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
      return /^(apply(\s+(now|(for|to)\s+(this\s+|the\s+|a\s+)?(job|role|position|opening|opportunity|posting|requisition)|online|here|externally|on\s+company\s+(site|website|page|portal)|directly|today|manually|with\s+resume))?|quick\s+apply|easy\s+apply|1[-\s]?click\s+apply|instant\s+apply|start(\s+(your|my|new))?\s+application|begin(\s+(your|my))?\s+application|continue\s+to\s+application|go\s+to\s+application|submit\s+an?\s+application|i'?m\s+interested)$/i.test(
        rawTxt
      );
    });
  }

  // Click "Apply" / "Apply Now" AND handle Workday / multi-option "Start Your Application" -> "Apply Manually" modal!
  async function clickApplyEntryButton() {
    document.documentElement.removeAttribute("data-jobify-last-window-open");

    const readCapturedWindowOpen = () => {
      const captured = document.documentElement.getAttribute("data-jobify-last-window-open") || "";
      return /^https?:\/\//i.test(captured) ? captured : null;
    };

    const navigateIfStuckOnSameView = async (rawHref, prevUrl) => {
      if (!rawHref || !/^https?:\/\//i.test(rawHref)) return false;
      if (findApplyModalChoiceButton(document)) return false;
      if (
        location.href !== prevUrl ||
        hasRealCandidateFormFields(document) ||
        Boolean(findGuestOrSkipAuthButton(document)) ||
        Boolean(findEmailAuthChoiceButton(document)) ||
        Boolean(findSsoProviderChoiceButton(document)) ||
        isOAuthProviderScreen(document) ||
        Boolean(detectEmailFirstAuthStep(document)) ||
        Array.from(document.querySelectorAll("input[type='password']")).some(isVisibleAndEditable)
      ) {
        return false;
      }
      try {
        window.location.assign(rawHref);
        return true;
      } catch (_) {
        return false;
      }
    };

    // 1. If "Start Your Application" modal ("Apply Manually") is ALREADY open on screen, click it immediately!
    const existingModalBtn = findApplyModalChoiceButton(document);
    if (existingModalBtn) {
      const prevUrl = location.href;
      const modalHref = extractElementHref(existingModalBtn);
      const modalTarget =
        existingModalBtn.getAttribute("target") || existingModalBtn.closest("a")?.getAttribute("target") || "";
      clickElementAndInner(existingModalBtn);
      for (let w = 0; w < 5; w++) {
        await sleep(160);
        if (
          !findApplyModalChoiceButton(document) ||
          location.href !== prevUrl ||
          hasRealCandidateFormFields(document) ||
          Boolean(findGuestOrSkipAuthButton(document)) ||
          Boolean(findEmailAuthChoiceButton(document)) ||
          Boolean(findSsoProviderChoiceButton(document)) ||
          isOAuthProviderScreen(document) ||
          Array.from(document.querySelectorAll("input[type='password']")).some(isVisibleAndEditable)
        ) {
          break;
        }
      }
      if (modalHref && modalTarget !== "_blank") {
        await navigateIfStuckOnSameView(modalHref, prevUrl);
      }
      return {
        clicked: true,
        clickedModalChoice: true,
        href: readCapturedWindowOpen() || modalHref || null,
        windowOpenUrl: readCapturedWindowOpen(),
        opensNewTab: modalTarget === "_blank" || Boolean(readCapturedWindowOpen())
      };
    }

    // 2. If page has a lazy embedded ATS iframe below the fold (e.g. Databricks #grnhse_iframe), scroll it into view
    const embeddedIframe = document.querySelector(
      "iframe[src*='greenhouse.io'], iframe[src*='ashbyhq.com'], iframe[src*='lever.co'], iframe[src*='myworkdayjobs.com'], iframe[src*='icims.com'], iframe[src*='smartrecruiters.com'], #grnhse_iframe"
    );
    if (embeddedIframe) {
      try {
        embeddedIframe.scrollIntoView({ block: "center", behavior: "instant" });
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
          /^apply(\s+(now|(for|to)\s+(this\s+|the\s+|a\s+)?(job|role|position|opening|opportunity)))?$/i.test(
            (c.innerText || "").replace(/[→›»↗⟶➔▶]+/g, "").replace(/\s+/g, " ").trim()
          )
      ) || candidates[0];

    const beforeUrl = location.href;
    const href = extractElementHref(chosenBtn);
    const targetAttr = chosenBtn.getAttribute("target") || chosenBtn.closest("a")?.getAttribute("target") || "";
    clickElementAndInner(chosenBtn);

    // 4. Poll up to 2.0s (10 x 200ms) for async "Start Your Application" modal (Workday wd-popup-frame -> Apply Manually)
    // Keep polling concise so backgrounded tabs never stall; service_worker also polls for modal/form/child-tab!
    for (let tick = 0; tick < 10; tick++) {
      await sleep(200);
      const modalChoice = findApplyModalChoiceButton(document);
      if (modalChoice) {
        await sleep(80);
        const urlAtModal = location.href;
        const mHref = extractElementHref(modalChoice);
        const mTarget = modalChoice.getAttribute("target") || modalChoice.closest("a")?.getAttribute("target") || "";
        clickElementAndInner(modalChoice);
        for (let mw = 0; mw < 4; mw++) {
          await sleep(150);
          if (
            !findApplyModalChoiceButton(document) ||
            location.href !== urlAtModal ||
            hasRealCandidateFormFields(document) ||
            Boolean(findGuestOrSkipAuthButton(document)) ||
            Boolean(findEmailAuthChoiceButton(document)) ||
            Boolean(findSsoProviderChoiceButton(document)) ||
            isOAuthProviderScreen(document) ||
            Array.from(document.querySelectorAll("input[type='password']")).some(isVisibleAndEditable)
          ) {
            break;
          }
        }
        if (mHref && mTarget !== "_blank") {
          await navigateIfStuckOnSameView(mHref, urlAtModal);
        }
        return {
          clicked: true,
          clickedModalChoice: true,
          href: readCapturedWindowOpen() || mHref || href || null,
          windowOpenUrl: readCapturedWindowOpen(),
          opensNewTab: mTarget === "_blank" || targetAttr === "_blank" || Boolean(readCapturedWindowOpen())
        };
      }

      const formOrAuthReady =
        hasRealCandidateFormFields(document) ||
        Boolean(findGuestOrSkipAuthButton(document)) ||
        Boolean(findEmailAuthChoiceButton(document)) ||
        Boolean(findSsoProviderChoiceButton(document)) ||
        isOAuthProviderScreen(document) ||
        Boolean(detectEmailFirstAuthStep(document)) ||
        Array.from(document.querySelectorAll("input[type='password']")).some(isVisibleAndEditable);

      // Only exit early on URL change after at least 3 ticks (600ms) so Workday #apply / /apply URL changes that open a modal still catch the modal!
      if (formOrAuthReady || (tick >= 3 && location.href !== beforeUrl)) {
        return {
          clicked: true,
          clickedModalChoice: false,
          transitionedToFormOrAuth: formOrAuthReady,
          href: readCapturedWindowOpen() || href || null,
          windowOpenUrl: readCapturedWindowOpen(),
          opensNewTab: targetAttr === "_blank" || Boolean(readCapturedWindowOpen())
        };
      }
    }

    // 5. Direct href navigation fallback ONLY if no modal is open and same-tab link click was swallowed
    const isWorkdayAdventure = chosenBtn.dataset?.automationId === "adventureButton";
    if (href && targetAttr !== "_blank" && !isWorkdayAdventure) {
      await navigateIfStuckOnSameView(href, beforeUrl);
    }

    return {
      clicked: true,
      clickedModalChoice: false,
      href: readCapturedWindowOpen() || href || null,
      windowOpenUrl: readCapturedWindowOpen(),
      opensNewTab: targetAttr === "_blank" || Boolean(readCapturedWindowOpen())
    };
  }

  // Auto-open collapsed / tabbed application views (e.g. Ashby /application tab, Lever /apply button, Workday Apply)
  async function ensureApplicationFormOpen(options = {}) {
    if (
      options?.skipApplyGate ||
      window !== window.top ||
      (!findApplyModalChoiceButton(document) &&
        (hasRealCandidateFormFields(document) ||
          countActionableFormControls() > 0 ||
          queryAllDeep(document, "input[type='password']").some(isVisibleAndEditable)))
    ) {
      return { hasControls: countActionableFormControls() > 0, clickedApplyGate: false };
    }
    const embeddedIframe = document.querySelector(
      "iframe[src*='greenhouse.io'], iframe[src*='ashbyhq.com'], iframe[src*='lever.co'], iframe[src*='myworkdayjobs.com'], iframe[src*='icims.com'], iframe[src*='smartrecruiters.com'], #grnhse_iframe"
    );
    if (embeddedIframe) {
      try {
        embeddedIframe.scrollIntoView({ block: "center", behavior: "instant" });
      } catch (_) {}
      return { hasControls: false, clickedApplyGate: false };
    }

    const res = await clickApplyEntryButton();
    if (!res.clicked) {
      return { hasControls: countActionableFormControls() > 0, clickedApplyGate: false };
    }

    for (let i = 0; i < 8; i++) {
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

  // Find Next Step vs. Final Submit button on multi-page wizards and single-page forms (including open Shadow DOMs)
  function findWizardButtons({ includeDisabled = false } = {}) {
    const btns = queryAllDeep(
      document,
      "[data-jobify-next], [data-jobify-submit], .ashby-application-form-submit-button, #submit_app, #btn-submit, .template-btn-submit, button[class*='submitButton' i], [data-uxi-element-id*='submit' i], [data-automation-id='bottom-navigation-next-button'], [data-automation-id='pageFooterNextButton'], button[type='submit'], input[type='submit'], button, [role='button']"
    ).filter(
      (b) =>
        (includeDisabled || !isButtonDisabledState(b)) &&
        isElementVisible(b) &&
        !isHeaderOrNavButton(b) &&
        !b.closest(COOKIE_CONSENT_SELECTOR) &&
        !b.closest("#jobify-copilot-host")
    );

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
        (/^(next(\s*(step|page|section))?|continue(\s+to\s+[\w\s]+)?|(save|agree|accept|confirm)\s*(and|&)\s*continue|i\s*agree(\s*(and|&)\s*continue)?|accept\s+terms|proceed(\s+to\s+application)?|review(\s*application)?)$/i.test(
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
      const wdClickFilter = document.querySelector("[data-automation-id='click_filter']:not([role='button'])");
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
    const pwVisible = queryAllDeep(document, "input[type='password']").filter(isVisibleAndEditable);
    const hasGuestAuthBypass = Boolean(findGuestOrSkipAuthButton(document));
    const hasEmailAuthGate = Boolean(findEmailAuthChoiceButton(document));
    const ssoChoice = findSsoProviderChoiceButton(document, profile?.personal?.email || "ravitejavelanati11@gmail.com");
    const hasSsoAuthGate = Boolean(ssoChoice);
    const isOAuthProviderPage = isOAuthProviderScreen(document);
    const hasEmailFirstAuth = Boolean(detectEmailFirstAuthStep(document));
    const hasCandidateForm = hasRealCandidateFormFields(document);
    const hasApplyChoiceModal = Boolean(findApplyModalChoiceButton(document));
    const needsEmailVerificationBanner = detectEmailVerificationBanner(document);
    const authModeInfo = analyzeAuthPageMode(document);
    const hasAuthLandingGate =
      !hasCandidateForm &&
      (Array.from(document.querySelectorAll("[data-automation-id='signInContent']")).some(isElementVisible) ||
        (Boolean(findCreateAccountSwitchLink(document) || findSignInSwitchLink(document)) &&
          /\/(login|signin|sign-in|register|signup|sign-up|auth|account|candidate-login|applyManually)\b/i.test(
            `${location.pathname || ""}${location.search || ""}${location.hash || ""}`
          )));

    const isStandaloneAuthWall =
      !hasApplyChoiceModal &&
      (pwVisible.length > 0 ||
        hasGuestAuthBypass ||
        hasEmailAuthGate ||
        hasSsoAuthGate ||
        isOAuthProviderPage ||
        hasEmailFirstAuth ||
        hasAuthLandingGate) &&
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
      authMode: authModeInfo.mode,
      hasGuestAuthBypass,
      hasEmailAuthGate,
      hasSsoAuthGate,
      ssoProvider: ssoChoice?.provider || null,
      ssoLabel: ssoChoice?.label || null,
      isOAuthProviderPage,
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
    skipApplyGate = false,
    onProgress = null,
    jobMeta = null
  }) {
    let filledCount = 0;
    let submittedAuthWall = false;
    let savedDomainPassword = null;
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
    const stepDelay = sequentialOneByOne ? 10 : 0;

    const reportStep = async (label) => {
      filledFieldsLog.push(label);
      if (typeof onProgress === "function") {
        onProgress(`✍️ [${filledCount}] ${label}`);
      }
      if (stepDelay > 0) await sleep(stepDelay);
    };

    // 0. Ensure application tab / collapsed form is open if needed
    const gate = await ensureApplicationFormOpen({ skipApplyGate });
    const initialScreen = !skipApplyGate ? inspectAutonomousScreenState(profile, meta) : null;
    if (!gate.hasControls && !meta.isAuthWall && !initialScreen?.isStandaloneAuthWall) {
      return {
        filledCount: 0,
        filledFieldsLog: [],
        openQuestionsCount: 0,
        clickedApplyGate: gate.clickedApplyGate,
        submittedAuthWall: false,
        savedDomainPassword: null,
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
          await sleep(30);
          window.scrollTo({ top: docEl.scrollHeight, behavior: "instant" });
          await sleep(30);
          window.scrollTo({ top: origTop, behavior: "instant" });
          await sleep(20);
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
    if (!skipApplyGate && initialScreen?.isStandaloneAuthWall && credentials?.autoFillPortalSignups !== false) {
      const autoAuthRes = await performAutonomousAuth(credentials, {}, profile);
      if (autoAuthRes?.savedDomainPassword) {
        savedDomainPassword = autoAuthRes.savedDomainPassword;
      }
      if (autoAuthRes?.handled) {
        submittedAuthWall = Boolean(autoAuthRes.submittedAuthForm || autoAuthRes.clickedSsoGate || autoAuthRes.action);
        const authFilled = Math.max(1, Number(autoAuthRes.filled || 0));
        filledCount += authFilled;
        await reportStep(`Autonomous Portal Auth (${autoAuthRes.action || "submit"})`);
        if (!hasRealCandidateFormFields(document)) {
          return {
            filledCount,
            filledFieldsLog,
            extractedFieldsCount: preInventory.totalFields,
            remainingEmptyRequired: 0,
            requiresCoverLetter: preInventory.requiresCoverLetter,
            openQuestionsCount: 0,
            clickedApplyGate: gate.clickedApplyGate,
            submittedAuthWall,
            savedDomainPassword,
            jobMeta: meta
          };
        }
      }
    } else if (meta.isAuthWall && credentials?.autoFillPortalSignups !== false) {
      const authRes = await autofillPortalAuth(credentials, profile);
      if (authRes.filled > 0) {
        filledCount += authRes.filled;
        await reportStep(`Portal Login / Verify Password (${authRes.filled} fields)`);
      }
    }

    // 2. Multi-Entry Work Experience & Education Repeater Cards
    const repeaterFilled = await fillRepeaterCards(profile);
    if (repeaterFilled > 0) {
      filledCount += repeaterFilled;
      await reportStep(`Work & Education Cards (${repeaterFilled} fields)`);
    }

    // 3. Attach Resume PDF & Cover Letter PDF (only when needed/available, including open Shadow DOMs)
    const hasAshbySystemResume = Boolean(document.getElementById("_systemfield_resume"));
    const fileInputs = queryAllDeep(document, "input[type='file']").filter((fi) => {
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

    // 4-6. Cascading Multi-Pass Fill: Custom ARIA Controls + Comboboxes + Standard Inputs/Radios/Selects
    // (Up to 3 passes so conditional Workday sub-questions like Sponsorship -> Visa Status mount and fill automatically!)
    const visitedCombos = new WeakSet();
    const handledRadioGroups = new Set();
    const handledCheckboxGroups = new Set();

    for (let cascadePass = 0; cascadePass < 3; cascadePass++) {
      let filledInPass = 0;

      // 4. Custom ARIA Checkboxes, ARIA Radio Groups, Ashby Yes/No & Generic Choice Pill Groups
      const customControlsFilled = await fillCustomInteractiveControls(profile, meta, {
        forceOverwrite: cascadePass === 0 ? forceOverwrite : false,
        fillOpenEndedWithAI,
        onlyNeededCleanMode
      });
      if (customControlsFilled > 0) {
        filledCount += customControlsFilled;
        filledInPass += customControlsFilled;
        await reportStep(`Interactive Choice & Consent Controls (${customControlsFilled})`);
      }

      // 5. React-Select, Workday <button aria-haspopup='listbox'> & Custom ARIA Comboboxes
      const comboboxes = queryAllDeep(
        document,
        "input[role='combobox'], button[aria-haspopup='listbox'], button[aria-haspopup='true'], [role='combobox'], input[data-automation-id='searchBox'], [data-automation-id='multiSelectContainer'] input"
      ).filter((el) => {
        if (visitedCombos.has(el)) return false;
        if (isTrapOrSystemInput(el) || isInHiddenAncestor(el)) return false;
        if (el.tagName !== "INPUT" && el.querySelector?.("input[role='combobox'], input[data-automation-id='searchBox']")) {
          return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.disabled;
      });

      for (const combo of comboboxes) {
        visitedCombos.add(combo);
        if (!(cascadePass === 0 && forceOverwrite) && hasComboboxSelection(combo)) continue;
        const ctx = getFieldContext(combo);
        const resolved = resolveDesiredValueForField(ctx, profile, combo, meta);
        if (resolved?.skip) continue;
        const isWorkdayQuestionCombo = Boolean(
          combo.closest("[data-automation-id*='question' i], [data-automation-id*='formField'], .application-question, fieldset")
        );
        if (!resolved && onlyNeededCleanMode && !isFieldRequired(combo, ctx) && !isWorkdayQuestionCombo) continue;
        const ok = await fillComboboxControl(combo, resolved, ctx, meta, fillOpenEndedWithAI, profile);
        if (ok) {
          filledCount++;
          filledInPass++;
          await reportStep(ctx.primaryLabel.split("|")[0].trim() || combo.id || "Dropdown");
        }
      }

      // 6. Standard <input>, <select>, Radio Groups, Checkboxes & Cover Letter Textarea (One-by-One in DOM order)
      const allControls = queryAllDeep(document, "input, select, textarea");

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
        const passForceOverwrite = cascadePass === 0 ? forceOverwrite : false;

        if (el.type === "radio") {
          const groupKey = el.name || ctx.primaryLabel;
          if (handledRadioGroups.has(groupKey)) continue;
          const radioScope = el.getRootNode?.() || document;
          const radios = el.name
            ? Array.from(radioScope.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`))
            : [el];
          if (!passForceOverwrite && radios.some((r) => r.checked)) {
            handledRadioGroups.add(groupKey);
            continue;
          }
          let desired = resolveDesiredValueForField(ctx, profile, el, meta);
          const radioWrappers = radios.map((r) => ({
            radio: r,
            innerText: getChoiceOptionLabel(r) || `${r.value || ""}`
          }));
          const radioOptTexts = radioWrappers.map((w) => w.innerText);
          const isBinYesNo = isBinaryYesNoOptionList(radioOptTexts);
          if (!desired && (req || isBinYesNo || !onlyNeededCleanMode) && fillOpenEndedWithAI) {
            desired = await askAiToPickOption(ctx.primaryLabel, radioOptTexts, meta, profile);
          }
          if (!desired && isBinYesNo) {
            desired = resolveBinaryYesNoFallback(ctx.primaryLabel, profile);
          }
          if (desired && !desired.skip) {
            const chosenWrap = findMatchingOptionElement(radioWrappers, desired);
            if (chosenWrap?.radio) {
              clickCheckboxOrRadioReliably(chosenWrap.radio);
              highlightFilledElement(chosenWrap.radio);
              handledRadioGroups.add(groupKey);
              filledCount++;
              filledInPass++;
              await reportStep(ctx.primaryLabel.split("|")[0].trim() || "Choice");
            }
          }
          continue;
        }

        if (el.type === "checkbox") {
          const cbGroup = resolveCheckboxGroup(el, el.getRootNode?.() || document);
          if (cbGroup) {
            if (handledCheckboxGroups.has(cbGroup.groupKey)) continue;
            if (!passForceOverwrite && cbGroup.checkboxes.some((c) => c.checked)) {
              handledCheckboxGroups.add(cbGroup.groupKey);
              continue;
            }
            const groupReq = isFieldRequired(el, cbGroup.groupCtx);
            let desired = resolveDesiredValueForField(cbGroup.groupCtx, profile, el, meta);
            const wrappers = cbGroup.checkboxes.map((cb) => ({
              cb,
              innerText: getChoiceOptionLabel(cb)
            }));
            const cbOptTexts = wrappers.map((w) => w.innerText);
            const isBinYesNo = isBinaryYesNoOptionList(cbOptTexts);
            if (!desired && (groupReq || isBinYesNo) && fillOpenEndedWithAI) {
              desired = await askAiToPickOption(cbGroup.groupCtx.primaryLabel, cbOptTexts, meta, profile);
            }
            if (!desired && isBinYesNo) {
              desired = resolveBinaryYesNoFallback(cbGroup.groupCtx.primaryLabel, profile);
            }
            if (desired && !desired.skip) {
              const chosen = findMatchingOptionElement(wrappers, desired);
              if (chosen?.cb) {
                clickCheckboxOrRadioReliably(chosen.cb);
                highlightFilledElement(chosen.cb);
                handledCheckboxGroups.add(cbGroup.groupKey);
                filledCount++;
                filledInPass++;
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
              filledInPass++;
              await reportStep("Consent Checkbox");
            }
          }
          continue;
        }

        if (el.tagName === "TEXTAREA" && /cover\s*letter/i.test(ctx.primaryLabel)) {
          const isReqCl = isFieldRequired(el, ctx);
          if ((shouldAttachCoverLetter || isReqCl) && coverLetterText && (passForceOverwrite || !(el.value || "").trim())) {
            if (setNativeValue(el, coverLetterText)) {
              filledCount++;
              filledInPass++;
              await reportStep("Cover Letter Text");
            }
          }
          continue;
        }

        let desired = resolveDesiredValueForField(ctx, profile, el, meta);
        if (desired?.skip) continue;

        if (el.tagName === "SELECT") {
          if (!passForceOverwrite && el.value && el.selectedIndex > 0) continue;
          const validOpts = Array.from(el.options || [])
            .filter((o) => o.value !== "" && !o.disabled)
            .map((o) => o.text || o.innerText || o.value);
          const isBinYesNo = isBinaryYesNoOptionList(validOpts);
          if (!desired && (req || isBinYesNo || !onlyNeededCleanMode) && fillOpenEndedWithAI) {
            desired = await askAiToPickOption(ctx.primaryLabel, validOpts, meta, profile);
          }
          if (!desired && isBinYesNo) {
            desired = resolveBinaryYesNoFallback(ctx.primaryLabel, profile);
          }
          if (!desired) continue;
          if (sequentialOneByOne) {
            try {
              el.scrollIntoView({ block: "nearest" });
            } catch (_) {}
          }
          if (selectBestOption(el, desired)) {
            filledCount++;
            filledInPass++;
            await reportStep(ctx.primaryLabel.split("|")[0].trim());
          }
        } else {
          if (!desired) continue;
          if (!passForceOverwrite && (el.value || "").trim().length > 0) continue;
          if (sequentialOneByOne) {
            try {
              el.scrollIntoView({ block: "nearest" });
            } catch (_) {}
          }
          if (setNativeValue(el, desired[0])) {
            filledCount++;
            filledInPass++;
            await reportStep(ctx.primaryLabel.split("|")[0].trim());
          }
        }
      }

      if (filledInPass === 0) break;
      await sleep(180);
    }

    // 7. Open-Ended Questions: Saved Vault Match + Parallel Concise Gemini AI (skipping optional fluff boxes!)
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
          `⚡ Filled ${filledCount} fields — answering ${pendingAiQuestions.length} required question(s) in parallel...`
        );
      }
      const batch = pendingAiQuestions.slice(0, 10);
      const answers = await Promise.all(
        batch.map(async (q) => {
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
              sleep(8500).then(() => null)
            ]);
            return { q, answer: resp?.ok ? resp.answer : null };
          } catch (_) {
            return { q, answer: null };
          }
        })
      );
      for (const { q, answer } of answers) {
        if (answer && setNativeValue(q.element, answer)) {
          filledCount++;
          await reportStep(`AI Answer: ${q.label.slice(0, 36)}`);
        }
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
      submittedAuthWall,
      savedDomainPassword,
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
    const comboboxes = queryAllDeep(
      doc,
      "input[role='combobox'], button[aria-haspopup='listbox'], [role='combobox']"
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

    // 4. Native <input>, <select>, <textarea> (including open Shadow DOM controls)
    const seenRadioNames = new Set();
    const seenCbGroups = new Set();
    const allControls = queryAllDeep(doc, "input, select, textarea");

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
        const radioScope = el.getRootNode?.() || doc;
        const radios = el.name
          ? Array.from(radioScope.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`))
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
        const cbGroup = resolveCheckboxGroup(el, el.getRootNode?.() || doc);
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
      const el =
        document.querySelector(`[data-jobify-ref="${CSS.escape(rep.refId)}"]`) ||
        queryAllDeep(document, `[data-jobify-ref="${CSS.escape(rep.refId)}"]`)[0];
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
          const radioScope = el.getRootNode?.() || document;
          const radios = el.name
            ? Array.from(radioScope.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`))
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
        const cbGroup = resolveCheckboxGroup(el, el.getRootNode?.() || document);
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

    // 1. Run clean deterministic autofill pass first (catches required custom controls & dropdowns without duplicating AI open-ended calls before DIAGNOSE_FORM_ERRORS)
    const baseFill = await runFrameAutofill({
      ...options,
      skipApplyGate: true,
      onlyNeededCleanMode: true,
      fillOpenEndedWithAI: false,
      includeAllUnresolvedOpenEnded: false
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

    const allControls = queryAllDeep(document, "input, select, textarea");
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
        const fallbackComp = Number(
          meta?.compensation?.midpoint ||
            meta?.compensation?.targetAnnual ||
            profile?.workAuthAndEEO?.desiredSalaryTarget ||
            165000
        );
        if (el.type === "tel" || /phone/i.test(ctx.fullLabel)) {
          const digits = p.phoneDigits || "7748108481";
          const altPhone =
            /10\s*digit|digits?\s*only|no\s*(spaces|dashes|parentheses)/i.test(errLow) || curVal.startsWith("+")
              ? digits
              : `+1${digits}`;
          if (altPhone !== curVal && setNativeValue(el, altPhone)) healedCount++;
        } else if (/leading\s*\$|with\s*\$|format\s+currency/i.test(errLow)) {
          const fmtUsd = `$${fallbackComp.toLocaleString("en-US")}`;
          if (fmtUsd !== curVal && setNativeValue(el, fmtUsd)) healedCount++;
        } else if (/digits?\s*only|numbers?\s*only|numeric|no\s*\$|valid\s*number/i.test(errLow)) {
          const cleanDigits = String(fallbackComp);
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
      skipApplyGate: Boolean(options.skipApplyGate),
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
    findGuestOrSkipAuthButton,
    findEmailAuthChoiceButton,
    findSsoProviderChoiceButton,
    isOAuthProviderScreen,
    performOAuthProviderStep,
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
