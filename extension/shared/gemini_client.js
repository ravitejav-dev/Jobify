// Jobify Gemini AI Engine
// Supports gemini-3.8-flash & gemini-3.1-pro-preview as primary models with automatic Smart Quota Fallback
// to live 200-OK Gemini 3.x models (gemini-3.5-flash, gemini-3-flash-preview) when Free Tier returns 429.

const GLA_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const modelCooldownUntil = new Map();
let preferCompanionRelayUntil = 0;

function normalizeModelName(m) {
  return String(m || "gemini-3.5-flash").replace(/^models\//, "");
}

function supportsZeroThinkingBudget(model) {
  return /^gemini-3(\.\d+)?-flash(-preview)?$/i.test(model) && !/lite|pro|image|tts/i.test(model);
}

function buildCandidateChain(requestedModel, settings) {
  const rawReq = normalizeModelName(requestedModel || settings?.primaryModel || "gemini-3.5-flash");
  if (settings?.enableSmartFallback === false) {
    return [rawReq];
  }
  const fastVerifiedOrder = [
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest"
  ];
  const ordered = /^gemini-(3\.8|3\.6|3\.1-flash-lite|1\.5|2\.)/i.test(rawReq)
    ? [...fastVerifiedOrder, rawReq]
    : [rawReq, ...fastVerifiedOrder];
  const unique = [...new Set(ordered)];
  const now = Date.now();
  const healthy = unique.filter((m) => (modelCooldownUntil.get(m) || 0) <= now);
  return healthy.length > 0 ? healthy : unique;
}

function buildModelRequestBody({ prompt, systemInstruction, jsonMode, temperature, maxOutputTokens, model }) {
  const generationConfig = {
    temperature,
    maxOutputTokens
  };
  if (jsonMode) {
    generationConfig.responseMimeType = "application/json";
  }
  if (supportsZeroThinkingBudget(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  return body;
}

async function tryCompanionRelay({ companionUrl, apiKey, chain, baseReqBody, errors, rawRequested }) {
  try {
    const relayResp = await fetch(`${companionUrl}/api/gemini-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, models: chain, requestBody: baseReqBody })
    });
    if (relayResp.ok) {
      const relayData = await relayResp.json();
      if (relayData?.ok && relayData.text) {
        const reqName = rawRequested || chain[0];
        return {
          text: relayData.text,
          modelUsed: relayData.modelUsed,
          requestedModel: reqName,
          fellBack: relayData.modelUsed !== reqName,
          fallbackTrace: errors
        };
      }
    }
  } catch (_) {}
  return null;
}

export async function callGemini({
  prompt,
  systemInstruction = "",
  requestedModel = null,
  jsonMode = false,
  temperature = 0.35,
  maxOutputTokens = 4096,
  timeoutMs = 12000,
  settings = {}
}) {
  const apiKey = (settings?.geminiApiKey || "").trim();
  if (!apiKey) {
    throw new Error("Missing Gemini API Key in Jobify Settings.");
  }

  const rawRequested = normalizeModelName(requestedModel || settings?.primaryModel || "gemini-3.5-flash");
  const chain = buildCandidateChain(requestedModel, settings);
  const errors = [];
  const companionUrl = settings?.companionServerUrl || "http://127.0.0.1:18765";
  const baseRelayBody = buildModelRequestBody({
    prompt,
    systemInstruction,
    jsonMode,
    temperature,
    maxOutputTokens,
    model: "gemini-3.5-flash"
  });

  if (Date.now() < preferCompanionRelayUntil) {
    const fastRelay = await tryCompanionRelay({
      companionUrl,
      apiKey,
      chain,
      baseReqBody: baseRelayBody,
      errors,
      rawRequested
    });
    if (fastRelay) return fastRelay;
    preferCompanionRelayUntil = 0;
  }

  for (const model of chain) {
    const url = `${GLA_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = buildModelRequestBody({
      prompt,
      systemInstruction,
      jsonMode,
      temperature,
      maxOutputTokens,
      model
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const errPayload = await resp.json().catch(() => ({}));
        const msg = errPayload?.error?.message || `HTTP ${resp.status}`;
        errors.push(`${model}: [${resp.status}] ${msg.slice(0, 120)}`);
        if (resp.status === 429 || resp.status === 404 || resp.status === 503) {
          modelCooldownUntil.set(model, Date.now() + (resp.status === 404 ? 300000 : 120000));
          continue;
        }
        throw new Error(`${model} error (${resp.status}): ${msg}`);
      }

      const data = await resp.json();
      const text = (data?.candidates?.[0]?.content?.parts || [])
        .filter((p) => !p.thought)
        .map((p) => p.text || "")
        .join("")
        .trim();

      if (!text) {
        errors.push(`${model}: Empty response`);
        modelCooldownUntil.set(model, Date.now() + 45000);
        continue;
      }

      return {
        text,
        modelUsed: model,
        requestedModel: rawRequested,
        fellBack: model !== rawRequested,
        fallbackTrace: errors
      };
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = err?.name === "AbortError";
      errors.push(`${model}: ${isTimeout ? "Timeout" : err.message}`);
      modelCooldownUntil.set(model, Date.now() + 180000);
      // If browser fetch failed immediately due to network/proxy (not model timeout), use Companion relay and cache for 5 min
      if (!isTimeout) {
        const relayOut = await tryCompanionRelay({
          companionUrl,
          apiKey,
          chain,
          baseReqBody: baseRelayBody,
          errors,
          rawRequested
        });
        if (relayOut) {
          preferCompanionRelayUntil = Date.now() + 5 * 60 * 1000;
          return relayOut;
        }
        break;
      }
      continue;
    }
  }

  throw new Error(`All Gemini models failed. Trace: ${errors.join(" | ")}`);
}

function parseJsonResponse(rawText) {
  const cleaned = String(rawText || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

export function cleanPostingJobTitle(rawTitle) {
  const base = String(rawTitle || "AI & Platform Software Engineer")
    .replace(/\s*\((req|job|id|jr|#).*?\)/gi, "")
    .replace(/\s*[-–|•]\s*(remote|hybrid|onsite|on-site|san francisco.*|new york.*|santa clara.*|mountain view.*|seattle.*|united states.*|us\b.*)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return base || "AI & Platform Software Engineer";
}

const UNIQUE_ACTION_VERB_POOL = [
  "Architected",
  "Engineered",
  "Built",
  "Designed",
  "Spearheaded",
  "Orchestrated",
  "Optimized",
  "Automated",
  "Developed",
  "Implemented",
  "Streamlined",
  "Delivered",
  "Scaled",
  "Accelerated",
  "Constructed",
  "Integrated",
  "Modernized",
  "Established",
  "Hardened",
  "Configured"
];

function sanitizeBulletSentence(bullet) {
  let s = String(bullet || "")
    .replace(/^[\s•\-*–\d.)]+/, "")
    .replace(/\s+/g, " ")
    .replace(/#(\d+)\s*\/\s*(\d+)/g, "#$1 of $2")
    .replace(/\bCI\s*\/\s*CD\b/gi, "continuous integration and delivery")
    .replace(/\s*\/\s*/g, " and ")
    .replace(/\s*;\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

function enforceUniqueStartingVerb(bullet, usedVerbs) {
  if (!bullet) return "";
  const m = bullet.match(/^([A-Za-z-]+)([\s,][\s\S]*)$/);
  if (!m) return bullet;
  const firstWordLow = m[1].toLowerCase();
  if (!usedVerbs.has(firstWordLow)) {
    usedVerbs.add(firstWordLow);
    return bullet;
  }
  const restNextWord = (m[2].replace(/^[\s,]+/, "").split(/\s+/)[0] || "").toLowerCase();
  const replacement =
    UNIQUE_ACTION_VERB_POOL.find(
      (v) => !usedVerbs.has(v.toLowerCase()) && !restNextWord.startsWith(v.toLowerCase().slice(0, 6))
    ) || "Delivered";
  usedVerbs.add(replacement.toLowerCase());
  return `${replacement}${m[2]}`;
}

function enforceFromScratchResumeQuality(parsed, jobMeta, profile, missingKeywords = []) {
  const cleanTitle = cleanPostingJobTitle(parsed?.targetJobTitle || jobMeta?.title || profile?.personal?.currentTitle);
  const compName = String(jobMeta?.company || "the engineering team").trim();
  const topMissing = (missingKeywords || [])
    .map((k) => String(k || "").replace(/\s*\/\s*/g, " and ").trim())
    .filter(Boolean);

  // 1. Clean 4-sentence neutral third-person summary (<= 75-78 words, zero first-person pronouns)
  const fallbackSummary = `${cleanTitle} with 3.5+ years of production engineering experience building LLM evaluation infrastructure, agentic sandboxes, and scalable backend systems. Skilled in ${topMissing.slice(0, 3).concat(["Python", "TypeScript", "Kubernetes"]).slice(0, 4).join(", ")}, and distributed cloud pipelines. Proven track record increasing evaluation throughput across 2,000+ batches, cutting sandbox startup latency by 70%, and ensuring 100% synthetic data accuracy. Collaborative systems builder focused on strengthening engineering reliability and platform velocity for ${compName}.`;
  let summary = String(parsed?.summary || fallbackSummary)
    .replace(/^(operating|serving|working|acting)\s+as\s+an?\s+[^,]+,\s*(this|the)\s+(professional|candidate|engineer|applicant|individual|specialist)\s+(brings|offers|possesses|has|delivers)\s+/i, `${cleanTitle} with `)
    .replace(/\b(this|the)\s+(professional|candidate|engineer|applicant|individual)\s+(brings|offers|possesses|has)\s+/gi, `${cleanTitle} with `)
    .replace(/\bI am an?\b/gi, cleanTitle)
    .replace(/\bI am\b/gi, "")
    .replace(/\bMy\b/g, "Proven")
    .replace(/\bmy\b/g, "the")
    .replace(/\bme\b/gi, "teams")
    .replace(/\bI\b/g, "Engineer")
    .replace(/\bCI\s*\/\s*CD\b/gi, "CI and CD")
    .replace(/\s*\/\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim();

  const titleNorm = cleanTitle.toLowerCase();
  const titleAndNorm = titleNorm.replace(/&/g, "and").replace(/\s+/g, " ");
  const sumLow = summary.toLowerCase();
  if (summary && !sumLow.includes(titleNorm) && !sumLow.includes(titleAndNorm)) {
    if (/^[^.]{3,55}?\bwith\s+/i.test(summary)) {
      summary = summary.replace(/^[^.]{3,55}?\bwith\s+/i, `${cleanTitle} with `);
    } else {
      summary = `${cleanTitle} with ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
    }
  } else if (sumLow.includes(titleAndNorm) && !sumLow.includes(titleNorm)) {
    summary = summary.replace(new RegExp(titleAndNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), cleanTitle);
  }

  const words = summary.split(/\s+/).filter(Boolean);
  if (words.length > 78) {
    const sliced = words.slice(0, 78).join(" ");
    const lastPeriod = sliced.lastIndexOf(".");
    summary = lastPeriod > 45 ? sliced.slice(0, lastPeriod + 1) : `${sliced.replace(/[.,;:]+$/, "")}.`;
  } else if (summary && !/[.!?]$/.test(summary)) {
    summary += ".";
  }

  // 2. Enforce exactly 4 categories and 25-40 unique skills total
  const rawCats = parsed?.skillsCategories && typeof parsed.skillsCategories === "object" ? parsed.skillsCategories : {};
  const entries = Object.entries(rawCats)
    .map(([k, v]) => [
      String(k).trim(),
      (Array.isArray(v) ? v : String(v || "").split(","))
        .map((x) => String(x || "").replace(/\s*\/\s*/g, " & ").trim())
        .filter(Boolean)
    ])
    .filter(([k, arr]) => k && arr.length > 0)
    .slice(0, 4);

  const defaultCatOrder = [
    ["Languages & Core", profile?.skillsCategories?.Languages || ["Python", "TypeScript", "JavaScript", "C++", "SQL", "Go", "Bash"]],
    ["AI, LLMs & Evaluation", [...topMissing.slice(0, 5), ...(profile?.skillsCategories?.["AI & LLM"] || ["LLM Evaluation", "Agentic AI", "RAG", "LangGraph", "Prompt Engineering", "Synthetic Data", "PyTorch"])]],
    ["Frameworks & Backend", profile?.skillsCategories?.["Frameworks & Libraries"] || ["React", "Node.js", "FastAPI", "Angular", "Playwright", "Microservices", "REST APIs"]],
    ["Cloud, Data & Infrastructure", profile?.skillsCategories?.["Cloud & DevOps"] || ["GCP", "BigQuery", "AWS", "Docker", "Kubernetes", "Terraform", "GitHub Actions"]]
  ];
  while (entries.length < 4) {
    const fallbackPair = defaultCatOrder[entries.length];
    entries.push([fallbackPair[0], [...fallbackPair[1]]]);
  }

  const seenSkills = new Set();
  const normalizedCats = {};
  let totalSkills = 0;

  for (const [catName, list] of entries) {
    const cleanItems = [];
    for (const item of list) {
      const key = item.toLowerCase();
      if (seenSkills.has(key) || totalSkills >= 40) continue;
      seenSkills.add(key);
      cleanItems.push(item);
      totalSkills++;
      if (cleanItems.length >= 10) break;
    }
    normalizedCats[catName] = cleanItems;
  }

  if (totalSkills < 25) {
    const pool = [...topMissing, ...(profile?.allSkillsFlat || []), ...Object.values(profile?.skillsCategories || {}).flat()];
    const catKeys = Object.keys(normalizedCats);
    let idx = 0;
    for (const candidateSkill of pool) {
      if (totalSkills >= 28) break;
      const cleanSk = String(candidateSkill || "").replace(/\s*\/\s*/g, " & ").trim();
      if (!cleanSk || seenSkills.has(cleanSk.toLowerCase())) continue;
      seenSkills.add(cleanSk.toLowerCase());
      normalizedCats[catKeys[idx % catKeys.length]].push(cleanSk);
      totalSkills++;
      idx++;
    }
  }

  // 3. Sanitize experience (5 / 3 / 2) & project (2 / 2) bullets with 14 unique past-tense action verbs
  const usedVerbs = new Set();
  const expTargetCounts = [5, 3, 2];
  const profWork = profile?.workExperience || [];
  const rawExp = Array.isArray(parsed?.experience) && parsed.experience.length > 0 ? parsed.experience : [];

  const experience = [0, 1, 2].map((i) => {
    const baseRole = profWork[i] || {};
    const exp = rawExp[i] || {};
    const targetLen = expTargetCounts[i];
    const combinedBullets = [
      ...(exp.bullets || []),
      ...(baseRole.highlights || [])
    ]
      .map(sanitizeBulletSentence)
      .filter(Boolean);
    const deduped = [];
    const seenBul = new Set();
    for (const b of combinedBullets) {
      if (deduped.length >= targetLen) break;
      const sig = b.slice(0, 45).toLowerCase();
      if (seenBul.has(sig)) continue;
      seenBul.add(sig);
      deduped.push(enforceUniqueStartingVerb(b, usedVerbs));
    }
    const rawRoleTitle = String(exp.title || baseRole.title || "").trim();
    const compactRoleTitle =
      rawRoleTitle.length > 46 ? rawRoleTitle.split(/\s+[-–—]\s+/)[0].trim() : rawRoleTitle;
    return {
      company: exp.company || baseRole.company || "",
      title: compactRoleTitle,
      location: exp.location || baseRole.location || "",
      period: exp.period || `${baseRole.startDateDisplay || ""} - ${baseRole.endDateDisplay || ""}`.trim(),
      bullets: deduped
    };
  });

  const profProjects = profile?.projects || [];
  const rawProj = Array.isArray(parsed?.projects) && parsed.projects.length > 0 ? parsed.projects : [];
  const projects = [0, 1].map((i) => {
    const basePr = profProjects[i] || {};
    const pr = rawProj[i] || {};
    const combinedBullets = [...(pr.bullets || []), ...(basePr.bullets || [])]
      .map(sanitizeBulletSentence)
      .filter(Boolean);
    const deduped = [];
    const seenBul = new Set();
    for (const b of combinedBullets) {
      if (deduped.length >= 2) break;
      const sig = b.slice(0, 45).toLowerCase();
      if (seenBul.has(sig)) continue;
      seenBul.add(sig);
      deduped.push(enforceUniqueStartingVerb(b, usedVerbs));
    }
    return {
      name: pr.name || basePr.name || "",
      stack: String(pr.stack || basePr.stack || "").replace(/\s*\/\s*/g, ", "),
      bullets: deduped
    };
  });

  return {
    targetJobTitle: cleanTitle,
    summary,
    skillsCategories: normalizedCats,
    experience,
    projects,
    addedKeywords: Array.isArray(parsed?.addedKeywords) ? parsed.addedKeywords : [],
    keyChangesSummary: Array.isArray(parsed?.keyChangesSummary) ? parsed.keyChangesSummary : []
  };
}

export async function tailorResumeWithGemini(jobMeta, profile, missingKeywords = [], settings = {}, preferredModel = null) {
  const exactPostingTitle = cleanPostingJobTitle(jobMeta.title || "AI & Platform Software Engineer");
  const modelToUse = preferredModel || settings?.primaryModel || "gemini-3.5-flash";

  const systemInstruction = `You are an elite ATS & Technical Recruiter Resume Architect who builds every resume FROM SCRATCH from the candidate's full Master Profile + the target Job Description — NEVER generic AI rewording.

EXECUTE THIS EXACT 5-STAGE FROM-SCRATCH FRAMEWORK:
1. STAGE 1 — EXACT JD KEYWORD EXTRACTION:
   - Use the exact words and spelling from the Job Description (e.g., if the posting says "ETL pipelines", write "ETL pipelines", not "data workflows").
2. STAGE 2 — TOP JOB TITLE & 4-SENTENCE SUMMARY QUALITY FRAMEWORK:
   - "targetJobTitle": Must be the exact clean job title from the posting ("${exactPostingTitle}").
   - "summary": Strictly 4 sentences, maximum 75 words total, standard implied-subject resume style (NEVER use "I", "I am", "my", "this professional", "the candidate", "this engineer", or "he/she"; zero buzzwords, zero slashes):
     * Sentence 1: Start directly with "${exactPostingTitle} with 3.5+ years of production engineering experience building..." Do NOT mention or imply any other job titles.
     * Sentence 2: Highlight 3-5 core technical strengths pulled directly from the JD's hard skills, written naturally in prose (never a long 10-item tool list).
     * Sentence 3: Describe how these strengths create engineering value (improving reliability, automation, throughput, latency, evaluation rigor, or observability) using high-frequency JD hard skills.
     * Sentence 4: Integrate 1-2 soft skills behaviorally and end with a forward-looking statement connecting strengths to ${jobMeta.company || "the engineering team"}'s impact.
3. STAGE 3 — SKILLS SECTION (4 CATEGORIES, 25 TO 40 TOTAL SKILLS):
   - Arrange 25 to 40 hard skills across EXACTLY 4 clean categories tailored to this posting, combining exact JD keywords (supported by the candidate's real background or functionally equivalent skill translation) with natural supporting skills from the Master Profile.
4. STAGE 4 — SKILL & UNIQUE ACTION-VERB ALLOCATION (5 / 3 / 2 / 2 / 2):
   - Allocate JD hard skills, behavioral soft skills, and 14 COMPLETELY UNIQUE strong past-tense action verbs (zero repeated opening verbs across the entire resume!) across:
     * Experience 1 (GlobalLogic (Client: Google AI)): 5 bullets
     * Experience 2 (MassDigi at WPI): 3 bullets
     * Experience 3 (Wipro): 2 bullets
     * Project 1: 2 bullets
     * Project 2: 2 bullets
5. STAGE 5 — STRICT BULLET WRITING & REALISM RULES:
   - NEVER invent fake employers, fake degrees, fake employment dates, or fake numbers! Every numeric metric (e.g., 13 sandboxed web apps, 48 personas across 9 cloud services, 100% QA accuracy, #1 of 11 throughput across 2,000+ batches and 460+ workflows, 19 custom SxS plugins, 10x video pipeline speedup across 40,000+ clips, ~60% faster diagnosis, 70% faster sandbox startup, 40+ edge cases caught, 60+ FPS and 30+ defects at MassDigi, 10K+ daily eval cases, 95%+ silent failures eliminated, 40% faster feature-to-prod across 8+ teams and 30+ plugins) MUST come strictly from the Master Profile so the candidate can defend every line in an interview.
   - Skill Translation Rule: You may translate between functionally similar tools or workflows when aligning to the JD, provided every bullet stays 100% realistic and defensible for that specific role and work history.
   - Each bullet MUST be ONE single sentence, 15 to 30 words, starting with its unique past-tense action verb and ending with a period (".").
   - Structure every bullet as: Action verb + what you built + how you built it (1-2 exact JD hard skills, no long tool lists) + what changed (real profile metric or concrete engineering artifact/outcome). At least 60%-75% of bullets must contain real profile numbers.
   - Do NOT use slashes ("/") anywhere inside bullet sentences (write "Python and TypeScript" or "Docker and Kubernetes", never "Python/TypeScript").
   - Do NOT mention company names or job titles inside bullet text; refer neutrally to platforms, pipelines, sandboxes, teams, or stakeholders.
   - Avoid repeating the exact same hard skill more than twice across bullets unless central to the JD.
   - Output ONLY valid JSON matching the requested schema.`;

  const prompt = `TARGET JOB POSTING:
Company: ${jobMeta.company || "Target Company"}
Exact Posting Job Title: ${exactPostingTitle}
Location: ${jobMeta.location || ""}
Priority JD Keywords to incorporate where truthful: ${missingKeywords.slice(0, 14).join(", ") || "Extract directly from JD"}

FULL JOB DESCRIPTION:
${String(jobMeta.description || "").slice(0, 9000)}

CANDIDATE FULL MASTER PROFILE (SINGLE SOURCE OF TRUTH — PICK THE BEST EVIDENCE FOR THIS JOB):
${JSON.stringify(
  {
    yearsOfExperience: profile.personal?.yearsOfExperience,
    summary: profile.summary,
    skillsCategories: profile.skillsCategories,
    workExperience: profile.workExperience,
    projects: profile.projects,
    education: profile.education
  },
  null,
  2
)}

Return strictly valid JSON with this exact structure:
{
  "targetJobTitle": "${exactPostingTitle}",
  "summary": "4-sentence implied-subject summary (<=75 words) starting directly with '${exactPostingTitle} with 3.5+ years of...'",
  "skillsCategories": {
    "Category 1 Name": ["6 to 10 exact JD + profile skills"],
    "Category 2 Name": ["6 to 10 exact JD + profile skills"],
    "Category 3 Name": ["6 to 10 exact JD + profile skills"],
    "Category 4 Name": ["6 to 10 exact JD + profile skills"]
  },
  "experience": [
    {
      "company": "GlobalLogic (Client: Google AI)",
      "title": "Senior AI Solutions Engineer",
      "location": "Santa Clara, CA",
      "period": "Oct 2024 - Present",
      "bullets": ["5 single-sentence bullets, 15-30 words each, unique action verbs, no slashes, real metrics"]
    },
    {
      "company": "MassDigi at WPI",
      "title": "Software Engineer & Game Developer",
      "location": "Worcester, MA",
      "period": "May 2023 - Aug 2023",
      "bullets": ["3 single-sentence bullets, 15-30 words each, unique action verbs, no slashes"]
    },
    {
      "company": "Wipro",
      "title": "Software Engineering Intern (.NET Full-Stack)",
      "location": "Hyderabad, India",
      "period": "Mar 2022 - Aug 2022",
      "bullets": ["2 single-sentence bullets, 15-30 words each, unique action verbs, no slashes"]
    }
  ],
  "projects": [
    {
      "name": "Agentic AI Evaluation & Trajectory Analysis Platform",
      "stack": "JD-aligned stack from project",
      "bullets": ["2 single-sentence bullets, 15-30 words each, unique action verbs, no slashes"]
    },
    {
      "name": "AI-Native Developer Tooling & Automated Test Harness",
      "stack": "JD-aligned stack from project",
      "bullets": ["2 single-sentence bullets, 15-30 words each, unique action verbs, no slashes"]
    }
  ],
  "addedKeywords": ["exact JD keyword 1", "exact JD keyword 2"],
  "keyChangesSummary": [
    "Built from scratch for ${exactPostingTitle} with 4-sentence <=75-word summary and 25-40 categorized JD skills",
    "Allocated unique action verbs and JD hard skills across 14 single-sentence (15-30 word) bullets",
    "Grounded 100% of metrics strictly in verified Master Profile achievements"
  ]
}`;

  try {
    const res = await callGemini({
      prompt,
      systemInstruction,
      requestedModel: modelToUse,
      jsonMode: true,
      temperature: 0.25,
      maxOutputTokens: 8192,
      timeoutMs: 28000,
      settings
    });

    const rawParsed = parseJsonResponse(res.text);
    const tailored = enforceFromScratchResumeQuality(rawParsed, jobMeta, profile, missingKeywords);
    return {
      tailored,
      modelUsed: res.modelUsed,
      requestedModel: res.requestedModel,
      fellBack: res.fellBack
    };
  } catch (err) {
    if (!settings?.geminiApiKey) throw err;
    const tailored = enforceFromScratchResumeQuality({}, jobMeta, profile, missingKeywords);
    return {
      tailored,
      modelUsed: "deterministic-from-scratch",
      requestedModel: modelToUse,
      fellBack: true
    };
  }
}

export async function generateCoverLetterWithGemini(jobMeta, profile, tone = "Concise & Technical", settings = {}) {
  const systemInstruction = `You write authentic, high-signal engineering cover letters that sound like a sharp Senior AI/Platform Engineer wrote them personally — zero robotic cliches ("I am thrilled to apply", "delve", "synergy", "seamlessly"). Keep it 230-300 words across 3-4 crisp paragraphs.`;

  const prompt = `Write a tailored cover letter for ${profile.personal.fullName} applying to:
Company: ${jobMeta.company || "your team"}
Role: ${jobMeta.title || "Software / AI Engineer"}
Location: ${jobMeta.location || ""}
Tone: ${tone}

Job Description:
${String(jobMeta.description || "").slice(0, 7000)}

Candidate Profile Highlights:
- Current: ${profile.personal.currentTitle} at ${profile.personal.currentCompany} (Oct 2024 - Present, Santa Clara, CA)
- Built 13 full-stack sandboxed web apps for autonomous browser AI agent evaluation; architected synthetic data seeding across 48 personas & 9 cloud services with 100% QA accuracy; ranked #1 of 11 engineers in platform throughput (2,000+ batches across 460+ workflows); cut video pipeline time 10x and Docker/K8s sandbox init latency 70%.
- Education: M.S. in Computer Science, Clark University (GPA 3.5/4.0).
- Contact: ${profile.personal.email} | ${profile.personal.phone}

Output ONLY the body text of the cover letter starting with "Dear ${jobMeta.company ? jobMeta.company + " Hiring Team," : "Hiring Team,"}" and ending with "Best regards,\\nRaviteja Velanati".`;

  const res = await callGemini({
    prompt,
    systemInstruction,
    requestedModel: settings?.primaryModel || "gemini-3.5-flash",
    jsonMode: false,
    temperature: 0.45,
    maxOutputTokens: 1500,
    settings
  });

  return {
    coverLetter: res.text,
    modelUsed: res.modelUsed,
    requestedModel: res.requestedModel,
    fellBack: res.fellBack
  };
}

export async function answerApplicationQuestionWithGemini(questionCtx, jobMeta, profile, savedAnswers = [], settings = {}) {
  const maxChars = questionCtx.maxLength && questionCtx.maxLength > 20 ? questionCtx.maxLength : null;
  const isShortInput = questionCtx.fieldType === "input" || questionCtx.fieldType === "select";
  const systemInstruction = `You write ultra-clean, direct, first-person job application answers for Raviteja Velanati.
- NEVER add extra explanation, disclaimers, quotation marks, or unrequested details. Output ONLY what the field strictly asks for.
- Never use AI buzzwords ("delve", "comprehensive", "seamlessly", "leverage", "testament", "thrilled").
- If Options are provided, output ONLY the exact verbatim text of the single best matching option.
- If the field is a single-line input or asks a factual question (years of experience, visa status, citizenship, salary, city, date, yes/no), output ONLY the minimal exact value (e.g. "3.5", "H-1B", "India", "120000", "Yes", "No") — NEVER a full sentence.
- Ground every technical claim strictly in Raviteja's real work at GlobalLogic (Client: Google AI), MassDigi at WPI, Wipro, and Clark University M.S. CS.${maxChars ? `\n- STRICT CHARACTER LIMIT: Must be under ${Math.floor(maxChars * 0.9)} characters.` : isShortInput ? "\n- Keep single-line input answers under 12 words." : "\n- Keep open-ended textarea answers concise: 2-4 crisp sentences (45-85 words max)."}`;

  const prompt = `APPLICATION QUESTION: "${questionCtx.label}"
Field Type: ${questionCtx.fieldType || "textarea"}
${questionCtx.options?.length ? `Available Select/Radio Options (pick exact text of best option ONLY): ${JSON.stringify(questionCtx.options)}` : ""}

TARGET ROLE: ${jobMeta.title || "Engineer"} at ${jobMeta.company || "Company"}
JOB DESCRIPTION EXCERPT:
${String(jobMeta.description || "").slice(0, 4500)}

CANDIDATE PROFILE & WORK AUTH:
${JSON.stringify(
  {
    personal: profile.personal,
    workAuthAndEEO: profile.workAuthAndEEO,
    summary: profile.summaryShort,
    highlights: profile.workExperience?.[0]?.highlights,
    education: profile.education
  },
  null,
  2
)}

EXISTING SAVED ANSWERS FOR REFERENCE:
${JSON.stringify(savedAnswers.slice(0, 6), null, 2)}

Write ONLY the exact answer to fill into the form field.`;

  const res = await callGemini({
    prompt,
    systemInstruction,
    requestedModel: settings?.primaryModel || "gemini-3.5-flash",
    jsonMode: false,
    temperature: 0.35,
    maxOutputTokens: 800,
    settings
  });

  let answer = res.text.replace(/^["']|["']$/g, "").trim();
  if (maxChars && answer.length > maxChars) {
    answer = answer.slice(0, maxChars - 3).trim() + "...";
  }

  return {
    answer,
    modelUsed: res.modelUsed,
    fellBack: res.fellBack
  };
}

export async function generateNetworkOutreachWithGemini(company, role, jobUrl, profile, settings = {}) {
  const systemInstruction = `Generate concise, high-response-rate engineer-to-engineer referral outreach messages. Never sound salesy or robotic. Return strictly valid JSON.`;
  const prompt = `Target Company: ${company}
Target Role: ${role}
Job Link: ${jobUrl || "(attached)"}
Candidate: ${profile.personal.fullName} — ${profile.personal.currentTitle} at ${profile.personal.currentCompany}, M.S. CS from Clark University, Newark CA. Built 13 sandboxed AI eval apps, 48-persona synthetic data pipelines, #1/11 platform throughput at Google AI workflows.

Return JSON with:
{
  "linkedinNote": "Under 280 characters warm LinkedIn connection request note",
  "referralDm": "Short 70-100 word follow-up DM / email asking for quick perspective or referral",
  "recruiterNote": "Short 60-90 word direct note to technical recruiter at ${company}"
}`;

  const res = await callGemini({
    prompt,
    systemInstruction,
    requestedModel: settings?.primaryModel || "gemini-3.5-flash",
    jsonMode: true,
    temperature: 0.4,
    maxOutputTokens: 1000,
    settings
  });

  return {
    outreach: parseJsonResponse(res.text),
    modelUsed: res.modelUsed
  };
}
