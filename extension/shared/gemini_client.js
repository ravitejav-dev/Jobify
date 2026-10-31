// Jobify Gemini AI Engine
// Supports gemini-3.8-flash & gemini-3.1-pro-preview as primary models with automatic Smart Quota Fallback
// to live 200-OK Gemini 3.x models (gemini-3.5-flash, gemini-3-flash-preview) when Free Tier returns 429.

const GLA_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function normalizeModelName(m) {
  return String(m || "gemini-3.8-flash").replace(/^models\//, "");
}

function buildCandidateChain(requestedModel, settings) {
  const primary = normalizeModelName(requestedModel || settings?.primaryModel || "gemini-3.8-flash");
  if (settings?.enableSmartFallback === false) {
    return [primary];
  }
  const isProFirst = /pro/i.test(primary);
  const defaults = isProFirst
    ? [
        primary,
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3-flash-preview"
      ]
    : [
        primary,
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3-flash-preview",
        normalizeModelName(settings?.proModel || "gemini-3.1-pro-preview")
      ];
  return [...new Set(defaults)];
}

export async function callGemini({
  prompt,
  systemInstruction = "",
  requestedModel = null,
  jsonMode = false,
  temperature = 0.35,
  maxOutputTokens = 4096,
  timeoutMs = 18000,
  settings = {}
}) {
  const apiKey = (settings?.geminiApiKey || "").trim();
  if (!apiKey) {
    throw new Error("Missing Gemini API Key in Jobify Settings.");
  }

  const chain = buildCandidateChain(requestedModel, settings);
  const errors = [];

  for (const model of chain) {
    const url = `${GLA_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens
      }
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (jsonMode) {
      body.generationConfig.responseMimeType = "application/json";
    }

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
        continue;
      }

      return {
        text,
        modelUsed: model,
        requestedModel: chain[0],
        fellBack: model !== chain[0],
        fallbackTrace: errors
      };
    } catch (err) {
      clearTimeout(timer);
      errors.push(`${model}: ${err?.name === "AbortError" ? "Timeout" : err.message}`);
      // If browser outbound HTTPS is restricted (e.g. corporate Chrome policy), try local Companion relay immediately
      const companionUrl = settings?.companionServerUrl || "http://127.0.0.1:18765";
      try {
        const relayResp = await fetch(`${companionUrl}/api/gemini-generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, models: chain, requestBody: body })
        });
        if (relayResp.ok) {
          const relayData = await relayResp.json();
          if (relayData?.ok && relayData.text) {
            return {
              text: relayData.text,
              modelUsed: relayData.modelUsed,
              requestedModel: chain[0],
              fellBack: relayData.modelUsed !== chain[0],
              fallbackTrace: errors
            };
          }
        }
      } catch (_) {}
      break;
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

export async function tailorResumeWithGemini(jobMeta, profile, missingKeywords = [], settings = {}, preferredModel = null) {
  const modelToUse = preferredModel || settings?.proModel || settings?.primaryModel || "gemini-3.8-flash";
  const systemInstruction = `You are an elite Principal Technical Recruiter and ATS Resume Architect.
Your job is to tailor the candidate's resume to the target job description with surgical precision.
STRICT RULES:
1. NEVER invent fake employers, fake job titles, fake degrees, or fake employment dates. Preserve exact employers (GlobalLogic (Client: Google AI), MassDigi at WPI, Wipro) and exact education (Clark University M.S. CS, Malla Reddy B.Tech CS).
2. Reframe, prioritize, and sharpen the candidate's real accomplishments, metrics (e.g., 13 sandboxed web apps, 48 personas across 9 cloud services, #1 of 11 throughput across 460+ workflows, 10x video pipeline speedup, 70% faster Docker/K8s sandboxes, 10K+ daily agentic evals), and transferable skills so they directly mirror the target JD's terminology and priorities.
3. Naturally weave in relevant target JD keywords ONLY where supported by the candidate's real technical stack and engineering experience.
4. Keep bullets crisp, single-sentence or tight two-clause, starting with strong action verbs and concrete numbers so the entire resume fits cleanly on 1 ATS-friendly page.
5. Output ONLY valid JSON matching the requested schema.`;

  const prompt = `TARGET JOB:
Company: ${jobMeta.company || "Target Company"}
Role Title: ${jobMeta.title || "AI / Software Engineer"}
Location: ${jobMeta.location || ""}
Missing / Priority JD Keywords to address if truthful: ${missingKeywords.slice(0, 12).join(", ") || "Extract from JD"}

JOB DESCRIPTION:
${String(jobMeta.description || "").slice(0, 9000)}

CANDIDATE MASTER PROFILE:
${JSON.stringify(
  {
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
  "summary": "3-line tailored professional summary aligned to target role & company",
  "skillsCategories": {
    "Languages": ["..."],
    "Frameworks & Libraries": ["..."],
    "AI & LLM": ["..."],
    "Cloud & DevOps": ["..."]
  },
  "experience": [
    {
      "company": "GlobalLogic (Client: Google AI)",
      "title": "Senior AI Solutions Engineer - Responsible AI & Novel AI Testing",
      "location": "Santa Clara, CA",
      "period": "Oct 2024 - Present",
      "bullets": ["4 to 5 high-impact tailored bullets with exact metrics"]
    },
    {
      "company": "MassDigi at WPI",
      "title": "Software Engineer & Game Developer",
      "location": "Worcester, MA",
      "period": "May 2023 - Aug 2023",
      "bullets": ["1 to 2 tailored bullets"]
    },
    {
      "company": "Wipro",
      "title": "Software Engineering Intern (.NET Full-Stack)",
      "location": "Hyderabad, India",
      "period": "Mar 2022 - Aug 2022",
      "bullets": ["1 concise tailored bullet"]
    }
  ],
  "projects": [
    {
      "name": "Project Title",
      "stack": "Tech stack",
      "bullets": ["1 to 2 crisp bullets"]
    }
  ],
  "addedKeywords": ["keyword1", "keyword2"],
  "keyChangesSummary": [
    "Brief bullet explaining specific tailoring adjustment #1",
    "Brief bullet explaining specific tailoring adjustment #2",
    "Brief bullet explaining specific tailoring adjustment #3"
  ]
}`;

  const res = await callGemini({
    prompt,
    systemInstruction,
    requestedModel: modelToUse,
    jsonMode: true,
    temperature: 0.3,
    maxOutputTokens: 4096,
    settings
  });

  const parsed = parseJsonResponse(res.text);
  return {
    tailored: parsed,
    modelUsed: res.modelUsed,
    requestedModel: res.requestedModel,
    fellBack: res.fellBack
  };
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
    requestedModel: settings?.primaryModel || "gemini-3.8-flash",
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
    requestedModel: settings?.primaryModel || "gemini-3.8-flash",
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
    requestedModel: settings?.primaryModel || "gemini-3.8-flash",
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
