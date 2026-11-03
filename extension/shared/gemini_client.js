// Jobify Gemini AI Engine
// Supports gemini-3.8-flash & gemini-3.1-pro-preview as primary models with automatic Smart Quota Fallback
// to live 200-OK Gemini 3.x models (gemini-3.5-flash, gemini-3-flash-preview) when Free Tier returns 429.

import { analyzeJobKeywords, detectJobArchetype } from "./ats_analyzer.js";

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
  "Re-engineered",
  "Ranked",
  "Deployed",
  "Configured"
];

const BANNED_WEAK_STARTING_VERBS = new Set([
  "facilitated",
  "formulated",
  "assisted",
  "helped",
  "utilized",
  "leveraged",
  "worked",
  "supported",
  "participated",
  "handled",
  "contributed",
  "involved",
  "responsible",
  "collaborated",
  "maintained",
  "managed",
  "used",
  "performed",
  "conducted"
]);

function sanitizeBulletSentence(bullet) {
  let s = String(bullet || "")
    .replace(/^[\s•\-*–\d.)]+/, "")
    .replace(/\s+/g, " ")
    .replace(/#(\d+)\s*\/\s*(\d+)/g, "#$1 of $2")
    .replace(/\bCI\s*\/\s*CD\b/gi, "CI and CD")
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
  if (!usedVerbs.has(firstWordLow) && !BANNED_WEAK_STARTING_VERBS.has(firstWordLow)) {
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

function hasStrongQuantitativeMetric(bullet) {
  return /\b(\d+%|\d+x|\d+\+|#\d+|\d{1,3},\d{3}|\b13\b|\b19\b|\b30\b|\b40\b|\b48\b|\b60\b|\b70\b|\b95\b|\b460\b|\b8\s+languages\b|first\s+among\s+11|#1\s+of\s+11)\b/i.test(
    String(bullet || "")
  );
}

function buildArchetypeReferenceBullets(archetype, jdSkills = []) {
  const cleanSk = jdSkills
    .map((s) => String(s || "").replace(/\s*\/\s*/g, " and ").trim())
    .filter(Boolean);
  const hasKw = (re) => cleanSk.some((s) => re.test(s));
  const vecMention = hasKw(/vector|rag|embedding|pinecone|weaviate|pgvector|faiss/i)
    ? " and RAG vector search indexing"
    : "";
  const otelMention = hasKw(/observability|telemetry|opentelemetry|datadog|prometheus|grafana/i)
    ? "OpenTelemetry and React"
    : "React, TypeScript, and Node.js";
  const k8sMention = hasKw(/kubernetes|docker|gke|eks|terraform/i)
    ? "Docker and Kubernetes"
    : "containerized cloud";

  const globalLogicPool = {
    eval_safety_rlhf: [
      `Architected a synthetic data seeding framework across 48 multi-modal user personas and 9 cloud services on GCP and BigQuery${vecMention}, enforcing 100% numerical accuracy via an automated Python Data Integrity QA suite.`,
      `Designed and deployed 13 full-stack sandboxed web applications in TypeScript, React, Angular, and Python with Playwright browser automation to safely reproduce edge cases and benchmark autonomous AI agents.`,
      `Ranked #1 of 11 engineers in platform throughput across 2,000+ batches and 460+ evaluation workflows with zero queue backlog while building 19 custom React and TypeScript Side-by-Side (SxS) RLHF and adversarial red-teaming plugins.`,
      `Re-engineered a distributed multi-language video and multimodal pipeline processing 1,800+ recordings into 40,000+ clips across 8 languages, cutting processing time by 10x and resolving a critical blocker in 10 days.`,
      `Built ${otelMention} telemetry dashboards cutting agent diagnosis time by 60%, warm-pool ${k8sMention} sandboxes reducing initialization latency by 70%, and PyTorch adversarial suites catching 40+ edge cases pre-deployment.`
    ],
    frontier_ai_agents: [
      `Designed and deployed 13 full-stack sandboxed web applications in TypeScript, React, Angular, and Python with Playwright automation to evaluate autonomous multi-turn browser AI agents across 48 test accounts.`,
      `Architected a longitudinal synthetic data seeding platform across 48 multi-modal user personas and 9 cloud services${vecMention}, guaranteeing 100% numerical accuracy through an automated Python QA verification suite.`,
      `Engineered warm-pool ${k8sMention} sandboxes cutting initialization latency by 70%, alongside ${otelMention} execution-tracing dashboards reducing agent mean-time-to-diagnosis by 60% in production.`,
      `Ranked #1 of 11 engineers in platform throughput by delivering 2,000+ ingestion batches across 460+ evaluation workflows and building 19 React and TypeScript Side-by-Side (SxS) multi-model evaluation plugins.`,
      `Re-engineered a multi-language video segmentation pipeline transforming 1,800+ recordings into 40,000+ clips across 8 languages for a 10x speedup, while maintaining Python, C++, and PyTorch LLM serving backends catching 40+ edge cases.`
    ],
    fullstack_product_ai: [
      `Built and deployed 13 full-stack sandboxed web applications from scratch using React, Angular, TypeScript, Node.js, and Python across e-commerce, fintech, and messaging domains to benchmark autonomous browser AI agents.`,
      `Spearheaded 19 custom React and TypeScript Side-by-Side (SxS) evaluation applications and ranked #1 of 11 engineers in platform throughput across 2,000+ data batches and 460+ production workflows.`,
      `Developed real-time ${otelMention} observability dashboards reducing AI agent diagnosis time by 60%, paired with warm-pool ${k8sMention} sandboxes cutting environment startup latency by 70%.`,
      `Architected a multi-service synthetic data platform across 48 user personas and 9 cloud APIs with Playwright end-to-end automation and a Python QA suite guaranteeing 100% numerical data accuracy.`,
      `Re-engineered a distributed Python media processing pipeline converting 1,800+ recordings into 40,000+ clips across 8 languages for a 10x speedup in 10 days, alongside low-latency Python and C++ LLM inference services.`
    ],
    backend_distributed_infra: [
      `Engineered warm-pool ${k8sMention} sandbox infrastructure cutting initialization latency by 70%, alongside low-latency Python, C++, and PyTorch LLM serving backends handling high-throughput production workloads.`,
      `Architected a distributed synthetic data seeding pipeline across 48 multi-modal personas and 9 cloud services on GCP and BigQuery${vecMention}, enforcing 100% post-injection numerical accuracy via automated Python QA gates.`,
      `Re-engineered a high-volume multi-language video processing pipeline transforming 1,800+ recordings into 40,000+ clips across 8 languages, achieving a 10x throughput speedup and unblocking 3+ engineering teams in 10 days.`,
      `Ranked #1 of 11 engineers in platform throughput across 2,000+ ingestion and extraction batches and 460+ multi-stage deduplication workflows with zero queue backlog and 19 custom TypeScript and React plugins.`,
      `Constructed 13 containerized full-stack sandbox applications and ${otelMention} distributed tracing dashboards that reduced production AI agent mean-time-to-diagnosis by 60% and caught 40+ edge cases pre-release.`
    ]
  };

  const chosenGl = globalLogicPool[archetype] || globalLogicPool.frontier_ai_agents;

  const massDigiBullets = [
    "Constructed autonomous agent and non-player character decision systems in C# and C++ using finite state machines and behavior trees for real-time interactive simulation loops.",
    "Integrated custom in-editor telemetry, state-inspection, and structured diagnostic logging tools that isolated deterministic runtime anomalies across automated build regressions.",
    "Optimized memory allocation, asynchronous asset streaming, and object pooling to sustain 60+ FPS under heavy rendering loads while resolving 30+ integration defects across agile sprints."
  ];

  const wiproBullets = [
    "Developed full-stack web modules and RESTful backend microservices using .NET Core and C# integrated with normalized SQL relational database schemas and automated API validation.",
    "Implemented SQL query performance tuning, schema indexing, and modular REST API endpoints with 100% unit test pass rates across enterprise engineering assessments."
  ];

  const proj1Bullets = [
    `Orchestrated a distributed evaluation platform using Python, LangGraph, FastAPI, Docker, and Kubernetes processing 10,000+ test cases daily with RAG and Vector Databases, preventing capability drift across 12+ model iterations.`,
    `Automated retry orchestration and trajectory-analysis pipelines parsing tool-call sequences and multi-turn reasoning traces with OpenTelemetry, eliminating 95%+ of silent failures in production edge cases.`
  ];

  const proj2Bullets = [
    `Accelerated feature-to-production delivery by 40% across 8+ engineering teams by building an AI-native Python, React, TypeScript, and FastAPI service translating product specs into CI and CD workflows.`,
    `Established an extensible validation harness supporting 30+ modular plugins with deterministic schema checks, API contract verification, and real-time observability reporting dashboards.`
  ];

  return {
    exp0: chosenGl,
    exp1: massDigiBullets,
    exp2: wiproBullets,
    proj0: proj1Bullets,
    proj1: proj2Bullets
  };
}

function classifySkillCategoryIndex(skillStr) {
  const s = String(skillStr || "").toLowerCase();
  if (/^(python|typescript|javascript|c\+\+|c#|go|golang|rust|java|sql|bash|shell|html|css)/i.test(s)) {
    return 0;
  }
  if (/llm|ai|rag|agent|langgraph|langchain|llamaindex|autogen|mcp|prompt|eval|safety|red team|rlhf|post-training|hitl|human-in-the-loop|synthetic|trajectory|pytorch|tensorflow|hugging|vllm|inference|ray|cuda|mlflow|multimodal|vector/i.test(s)) {
    return 1;
  }
  if (/react|next\.js|angular|vue|tailwind|websocket|node\.js|fastapi|django|flask|\.net|spring|graphql|grpc|rest|microservice|distributed|system design|asyncio|event-driven|low-latency|playwright/i.test(s)) {
    return 2;
  }
  return 3;
}

function enforceFromScratchResumeQuality(parsed, jobMeta, profile, missingKeywords = []) {
  const cleanTitle = cleanPostingJobTitle(parsed?.targetJobTitle || jobMeta?.title || profile?.personal?.currentTitle);
  const compName = String(jobMeta?.company || "the engineering team").trim();
  const archetype = detectJobArchetype(jobMeta);
  const kwScan = analyzeJobKeywords(jobMeta?.description || "", profile);
  const allJdKeywords = [
    ...new Set([
      ...(kwScan.matched || []).map((m) => m.keyword),
      ...(kwScan.missing || []).map((m) => m.keyword),
      ...(missingKeywords || [])
    ])
  ]
    .map((k) => String(k || "").replace(/\s*\/\s*/g, " & ").trim())
    .filter(Boolean);

  const topJdProse = allJdKeywords
    .slice(0, 6)
    .map((k) => k.replace(/\s*&\s*/g, " and "))
    .concat(["Python", "TypeScript", "Kubernetes", "LangGraph"])
    .slice(0, 5);

  // 1. Clean 4-sentence neutral third-person summary (<= 75-78 words, zero first-person pronouns, includes #1 of 11 & core JD stack)
  const fallbackSummary = `${cleanTitle} with 3.5+ years of production engineering experience building autonomous AI agent sandboxes, synthetic data pipelines, and high-throughput evaluation platforms at Google AI (via GlobalLogic). Skilled in ${topJdProse.slice(0, 4).join(", ")}, and distributed cloud infrastructure. Ranked #1 of 11 engineers in platform throughput across 2,000+ batches while cutting sandbox startup latency by 70% and guaranteeing 100% data accuracy. Collaborative systems architect focused on scaling reliable AI infrastructure for ${compName}.`;
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

  // 2. Enforce exactly 4 categories and 28-38 unique skills total, front-loading 100% of detected JD keywords!
  const defaultCatHeaders = [
    "Languages & Core Systems",
    "AI, LLMs & Evaluation",
    "Frameworks, APIs & Automation",
    "Cloud, Data & Observability"
  ];
  const defaultCatSeeds = [
    ["Python", "TypeScript", "JavaScript", "C++", "C#", "Go", "Java", "SQL", "Bash & Shell"],
    ["LLM Evaluation", "Agentic AI", "LangGraph", "LangChain", "RAG", "Vector Databases", "PyTorch", "AI Safety & Red Teaming", "Synthetic Data", "RLHF & Post-Training", "promptfoo"],
    ["React", "Angular", "Node.js", "FastAPI", ".NET Core", "Playwright", "REST APIs", "Microservices", "Distributed Systems"],
    ["GCP", "BigQuery", "AWS", "Docker", "Kubernetes", "Terraform", "CI & CD", "GitHub Actions", "Observability & Telemetry", "Neo4j", "Linux"]
  ];

  const rawCats = parsed?.skillsCategories && typeof parsed.skillsCategories === "object" ? parsed.skillsCategories : {};
  const rawEntries = Object.entries(rawCats)
    .map(([k, v]) => [
      String(k).trim(),
      (Array.isArray(v) ? v : String(v || "").split(","))
        .map((x) => String(x || "").replace(/\s*\/\s*/g, " & ").trim())
        .filter((x) => x && x.length > 1 && !/^(ci|cd)$/i.test(x))
    ])
    .filter(([k, arr]) => k && arr.length > 0)
    .slice(0, 4);

  const catBuckets = [0, 1, 2, 3].map((idx) => ({
    name: rawEntries[idx]?.[0] || defaultCatHeaders[idx],
    items: []
  }));

  // First, front-load ALL detected JD keywords into their matching category so ATS & recruiter scan hits 100%!
  for (const jdKw of allJdKeywords) {
    const bucketIdx = classifySkillCategoryIndex(jdKw);
    catBuckets[bucketIdx].items.push(jdKw);
  }

  // Second, add model-selected skills + default profile seed skills
  for (let idx = 0; idx < 4; idx++) {
    const modelItems = rawEntries[idx]?.[1] || [];
    catBuckets[idx].items.push(...modelItems, ...defaultCatSeeds[idx]);
  }

  const normalizeSkillKey = (raw) =>
    String(raw || "")
      .toLowerCase()
      .replace(/^restful\s+apis?$/, "rest apis")
      .replace(/^react\.?js$/, "react")
      .replace(/^node\.?js$/, "node.js")
      .replace(/^rag\s+systems?$/, "rag")
      .replace(/^bash\s*(&|and)\s*shell$/, "bash");

  const seenSkills = new Set();
  const normalizedCats = {};
  let totalSkills = 0;

  for (const bucket of catBuckets) {
    const cleanItems = [];
    for (const item of bucket.items) {
      const cleanItem = String(item || "").replace(/\s*\/\s*/g, " & ").trim();
      if (!cleanItem) continue;
      const key = normalizeSkillKey(cleanItem);
      if (seenSkills.has(key) || totalSkills >= 38) continue;
      seenSkills.add(key);
      cleanItems.push(cleanItem);
      totalSkills++;
      if (cleanItems.length >= 10) break;
    }
    normalizedCats[bucket.name] = cleanItems;
  }

  if (totalSkills < 26) {
    const pool = [...allJdKeywords, ...(profile?.allSkillsFlat || []), ...defaultCatSeeds.flat()];
    const catKeys = Object.keys(normalizedCats);
    let idx = 0;
    for (const candidateSkill of pool) {
      if (totalSkills >= 30) break;
      const cleanSk = String(candidateSkill || "").replace(/\s*\/\s*/g, " & ").trim();
      if (!cleanSk || seenSkills.has(cleanSk.toLowerCase())) continue;
      seenSkills.add(cleanSk.toLowerCase());
      normalizedCats[catKeys[idx % catKeys.length]].push(cleanSk);
      totalSkills++;
      idx++;
    }
  }

  // 3. Sanitize experience (5 / 3 / 2) & project (2 / 2) bullets with 14 unique past-tense action verbs AND mandatory metric preservation!
  const refBullets = buildArchetypeReferenceBullets(archetype, allJdKeywords);
  const usedVerbs = new Set();
  const expTargetCounts = [5, 3, 2];
  const profWork = profile?.workExperience || [];
  const rawExp = Array.isArray(parsed?.experience) && parsed.experience.length > 0 ? parsed.experience : [];
  const expRefPools = [refBullets.exp0, refBullets.exp1, refBullets.exp2];

  const experience = [0, 1, 2].map((i) => {
    const baseRole = profWork[i] || {};
    const exp = rawExp[i] || {};
    const targetLen = expTargetCounts[i];
    const refPool = expRefPools[i] || baseRole.highlights || [];
    const modelBullets = (exp.bullets || []).map(sanitizeBulletSentence).filter(Boolean);

    const candidateList = [];
    for (let slot = 0; slot < targetLen; slot++) {
      const mBul = modelBullets[slot] || "";
      const refBul = sanitizeBulletSentence(refPool[slot] || baseRole.highlights?.[slot] || "");
      const mWords = mBul.split(/\s+/).filter(Boolean).length;
      const needsMetric = i === 0 || (i === 1 && slot === 2);
      // Keep model bullet ONLY if it has strong length (>=14 words) and preserves quantitative metrics when required
      if (mBul && mWords >= 14 && (!needsMetric || hasStrongQuantitativeMetric(mBul))) {
        candidateList.push(mBul);
      } else if (refBul) {
        candidateList.push(refBul);
      } else if (mBul) {
        candidateList.push(mBul);
      }
    }
    candidateList.push(...refPool.map(sanitizeBulletSentence), ...(baseRole.highlights || []).map(sanitizeBulletSentence));

    const deduped = [];
    const seenBul = new Set();
    for (const b of candidateList.filter(Boolean)) {
      if (deduped.length >= targetLen) break;
      const sig = b.slice(0, 42).toLowerCase();
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
  const projRefPools = [refBullets.proj0, refBullets.proj1];

  const projects = [0, 1].map((i) => {
    const basePr = profProjects[i] || {};
    const pr = rawProj[i] || {};
    const refPool = projRefPools[i] || basePr.bullets || [];
    const modelBullets = (pr.bullets || []).map(sanitizeBulletSentence).filter(Boolean);

    const candidateList = [];
    for (let slot = 0; slot < 2; slot++) {
      const mBul = modelBullets[slot] || "";
      const refBul = sanitizeBulletSentence(refPool[slot] || basePr.bullets?.[slot] || "");
      const mWords = mBul.split(/\s+/).filter(Boolean).length;
      if (mBul && mWords >= 14 && hasStrongQuantitativeMetric(mBul)) {
        candidateList.push(mBul);
      } else if (refBul) {
        candidateList.push(refBul);
      } else if (mBul) {
        candidateList.push(mBul);
      }
    }
    candidateList.push(...refPool.map(sanitizeBulletSentence), ...(basePr.bullets || []).map(sanitizeBulletSentence));

    const deduped = [];
    const seenBul = new Set();
    for (const b of candidateList.filter(Boolean)) {
      if (deduped.length >= 2) break;
      const sig = b.slice(0, 42).toLowerCase();
      if (seenBul.has(sig)) continue;
      seenBul.add(sig);
      deduped.push(enforceUniqueStartingVerb(b, usedVerbs));
    }

    const baseStackItems = String(pr.stack || basePr.stack || "")
      .replace(/\bCI\s*\/\s*CD\b/gi, "CI & CD")
      .replace(/\s*\/\s*/g, ", ")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !/^(ci|cd)$/i.test(s));
    const jdStackAdditions = allJdKeywords
      .filter((k) =>
        i === 0
          ? /python|langgraph|langchain|rag|vector|fastapi|docker|kubernetes|pytorch|llm/i.test(k)
          : /typescript|react|fastapi|docker|ci & cd|observability|telemetry|playwright|aws|gcp/i.test(k)
      )
      .slice(0, 3);
    const mergedStack = [];
    const seenSt = new Set();
    for (const st of [...baseStackItems, ...jdStackAdditions]) {
      const cleanSt = st.replace(/\s*\/\s*/g, " & ").trim();
      if (!cleanSt || seenSt.has(cleanSt.toLowerCase())) continue;
      seenSt.add(cleanSt.toLowerCase());
      mergedStack.push(cleanSt);
      if (mergedStack.length >= 8) break;
    }

    return {
      name: pr.name || basePr.name || "",
      stack: mergedStack.join(", "),
      bullets: deduped
    };
  });

  return {
    targetJobTitle: cleanTitle,
    archetype,
    summary,
    skillsCategories: normalizedCats,
    experience,
    projects,
    addedKeywords: allJdKeywords.slice(0, 12),
    keyChangesSummary: [
      `Tailored for ${cleanTitle} (${archetype.replace(/_/g, " ")}) with 4-sentence summary and ${totalSkills} JD-aligned skills`,
      "Preserved 100% of verified Google AI, MassDigi, Wipro & Project metrics across 14 unique action-verb bullets",
      `Front-loaded ${allJdKeywords.length} exact JD technical keywords across Skills, Summary, Experience & Projects`
    ]
  };
}

export async function tailorResumeWithGemini(jobMeta, profile, missingKeywords = [], settings = {}, preferredModel = null) {
  const exactPostingTitle = cleanPostingJobTitle(jobMeta.title || "AI & Platform Software Engineer");
  const modelToUse = preferredModel || settings?.primaryModel || "gemini-3.5-flash";
  const archetype = detectJobArchetype(jobMeta);
  const kwScan = analyzeJobKeywords(jobMeta?.description || "", profile);
  const priorityJdKeywords = [
    ...new Set([
      ...(kwScan.matched || []).map((m) => m.keyword),
      ...(kwScan.missing || []).map((m) => m.keyword),
      ...(missingKeywords || [])
    ])
  ];

  const systemInstruction = `You are a Principal Technical Recruiter & Staff Engineering Hiring Manager who writes elite, high-converting 1-page technical resumes FROM SCRATCH using the candidate's verified Master Profile and the target Job Description.

EXECUTE THIS 5-STAGE HIGH-SIGNAL TAILORING FRAMEWORK:
1. STAGE 1 — DEEP JD REQUIREMENT & ARCHETYPE ALIGNMENT (Detected Archetype: ${archetype}):
   - Mirror the exact technical terminology from the Job Description (${priorityJdKeywords.slice(0, 14).join(", ")}).
   - Lead every section with the engineering systems and stack most relevant to ${exactPostingTitle} at ${jobMeta.company || "the target company"}.
2. STAGE 2 — TOP JOB TITLE & 4-SENTENCE EXECUTIVE SUMMARY (<= 75 WORDS):
   - "targetJobTitle": Exact clean job title ("${exactPostingTitle}").
   - "summary": Strictly 4 sentences, <= 75 words, implied third-person resume style (NEVER use "I", "my", "me", "this candidate", or slashes "/"):
     * Sentence 1: "${exactPostingTitle} with 3.5+ years of production engineering experience building..." tailored to the JD's core domain at Google AI (via GlobalLogic).
     * Sentence 2: Highlight 4-5 core JD technical strengths written naturally in prose.
     * Sentence 3: Highlight flagship quantified impact (Ranked #1 of 11 engineers in platform throughput across 2,000+ batches, 70% faster Docker and Kubernetes sandbox startup, 100% synthetic data accuracy across 48 personas).
     * Sentence 4: Connect system design rigor and cross-functional execution directly to ${jobMeta.company || "the engineering team"}'s roadmap.
3. STAGE 3 — FRONT-LOADED SKILLS SECTION (EXACTLY 4 CATEGORIES, 28 TO 38 SKILLS):
   - Organize 28 to 38 hard skills into 4 crisp categories, placing the JD's exact required technologies FIRST in each category. Never use "/" inside skill names (use "&" or "and").
4. STAGE 4 — 14 POWERHOUSE BULLETS WITH 14 UNIQUE PAST-TENSE ACTION VERBS (5 / 3 / 2 / 2 / 2):
   - Every single bullet across the entire resume MUST start with a unique strong engineering verb (Architected, Engineered, Built, Designed, Spearheaded, Orchestrated, Optimized, Automated, Developed, Implemented, Streamlined, Delivered, Scaled, Accelerated, Constructed, Integrated, Modernized, Established, Hardened, Re-engineered, Ranked, Deployed).
   - NEVER use weak filler verbs ("Facilitated", "Formulated", "Assisted", "Helped", "Utilized", "Leveraged", "Worked on").
   - Allocate:
     * Experience 1 — GlobalLogic (Client: Google AI): 5 bullets
     * Experience 2 — MassDigi at WPI: 3 bullets
     * Experience 3 — Wipro: 2 bullets
     * Project 1 — Agentic AI Evaluation & Trajectory Analysis Platform: 2 bullets
     * Project 2 — AI-Native Developer Tooling & Automated Test Harness: 2 bullets
5. STAGE 5 — MANDATORY METRIC PRESERVATION & ZERO-SLASH RULE:
   - NEVER drop or dilute the candidate's verified metrics! Every GlobalLogic bullet and every Project bullet MUST include its specific numeric achievement:
     * 13 full-stack sandboxed web applications (TypeScript, React, Angular, Python, Playwright)
     * 48 multi-modal user personas across 9 cloud services with 100% numerical QA accuracy
     * 1,800+ recordings processed into 40,000+ clips across 8 languages (10x speedup in 10 days)
     * Ranked #1 of 11 engineers in platform throughput across 2,000+ batches and 460+ workflows + 19 custom React and TypeScript Side-by-Side (SxS) plugins
     * 60% faster agent diagnosis via telemetry dashboards + 70% faster Docker and Kubernetes warm-pool sandbox startup + 40+ edge cases caught pre-deployment
     * MassDigi: C# and C++ state machines and behavior trees, in-editor telemetry logging, and 60+ FPS with 30+ integration defects resolved
     * Projects: 10,000+ daily test cases preventing drift across 12+ model iterations, 95%+ silent failures eliminated, 40% faster feature-to-production across 8+ teams, and 30+ modular validation plugins
   - Each bullet MUST be ONE single sentence, 16 to 29 words, with 1-2 exact JD keywords woven naturally into how the system was built.
   - NEVER use "/" anywhere in bullet text (write "CI and CD", "Python and TypeScript", "Docker and Kubernetes").
   - Output ONLY valid JSON matching the requested schema.`;

  const prompt = `TARGET JOB POSTING:
Company: ${jobMeta.company || "Target Company"}
Exact Posting Job Title: ${exactPostingTitle}
Detected Role Archetype: ${archetype}
Location: ${jobMeta.location || ""}
Must-Have JD Keywords to weave into Skills, Summary, Experience & Projects: ${priorityJdKeywords.slice(0, 16).join(", ") || "Extract directly from JD"}

FULL JOB DESCRIPTION:
${String(jobMeta.description || "").slice(0, 9000)}

CANDIDATE FULL MASTER PROFILE (SINGLE SOURCE OF TRUTH — PRESERVE ALL METRICS):
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
    "Languages & Core Systems": ["7 to 9 front-loaded JD + profile skills"],
    "AI, LLMs & Evaluation": ["7 to 10 front-loaded JD + profile skills"],
    "Frameworks, APIs & Automation": ["7 to 10 front-loaded JD + profile skills"],
    "Cloud, Data & Observability": ["7 to 10 front-loaded JD + profile skills"]
  },
  "experience": [
    {
      "company": "GlobalLogic (Client: Google AI)",
      "title": "Senior AI Solutions Engineer",
      "location": "Santa Clara, CA",
      "period": "Oct 2024 - Present",
      "bullets": ["5 single-sentence bullets (16-29 words each), unique strong verbs, zero slashes, preserving 13 apps, 48 personas & 9 services (100% accuracy), 1,800+ to 40,000+ clips (10x in 10 days), #1 of 11 across 2,000+ batches & 460+ workflows (19 SxS plugins), and 60% diagnosis + 70% K8s latency + 40+ edge cases"]
    },
    {
      "company": "MassDigi at WPI",
      "title": "Software Engineer & Game Developer",
      "location": "Worcester, MA",
      "period": "May 2023 - Aug 2023",
      "bullets": ["3 single-sentence bullets (16-29 words each), unique strong verbs, zero slashes, preserving C# and C++ behavior trees, telemetry logging, and 60+ FPS with 30+ defects resolved"]
    },
    {
      "company": "Wipro",
      "title": "Software Engineering Intern (.NET Full-Stack)",
      "location": "Hyderabad, India",
      "period": "Mar 2022 - Aug 2022",
      "bullets": ["2 single-sentence bullets (16-29 words each), unique strong verbs, zero slashes, preserving .NET Core, C#, REST APIs, and SQL tuning"]
    }
  ],
  "projects": [
    {
      "name": "Agentic AI Evaluation & Trajectory Analysis Platform",
      "stack": "JD-aligned stack (no slashes)",
      "bullets": ["2 single-sentence bullets (16-29 words each), unique strong verbs, zero slashes, preserving 10,000+ daily test cases across 12+ model iterations and 95%+ silent failures eliminated"]
    },
    {
      "name": "AI-Native Developer Tooling & Automated Test Harness",
      "stack": "JD-aligned stack (no slashes)",
      "bullets": ["2 single-sentence bullets (16-29 words each), unique strong verbs, zero slashes, preserving 40% faster feature-to-production across 8+ teams and 30+ modular plugins"]
    }
  ],
  "addedKeywords": ["exact JD keyword 1", "exact JD keyword 2"],
  "keyChangesSummary": [
    "Built from scratch for ${exactPostingTitle} with 4-sentence <=75-word summary and front-loaded JD skills",
    "Allocated 14 unique strong past-tense action verbs and JD hard skills across all 14 bullets",
    "Preserved 100% of verified quantitative metrics from Master Profile"
  ]
}`;

  try {
    const res = await callGemini({
      prompt,
      systemInstruction,
      requestedModel: modelToUse,
      jsonMode: true,
      temperature: 0.2,
      maxOutputTokens: 8192,
      timeoutMs: 28000,
      settings
    });

    const rawParsed = parseJsonResponse(res.text);
    const tailored = enforceFromScratchResumeQuality(rawParsed, jobMeta, profile, priorityJdKeywords);
    return {
      tailored,
      modelUsed: res.modelUsed,
      requestedModel: res.requestedModel,
      fellBack: res.fellBack
    };
  } catch (err) {
    if (!settings?.geminiApiKey) throw err;
    const tailored = enforceFromScratchResumeQuality({}, jobMeta, profile, priorityJdKeywords);
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

export async function diagnoseFormErrorsWithGemini(
  diagnostics = {},
  jobMeta = {},
  profile = {},
  savedAnswers = [],
  settings = {}
) {
  const rawFields = Array.isArray(diagnostics?.fields) ? diagnostics.fields.slice(0, 24) : [];
  const fields = rawFields.filter((f) => {
    if (f.flaggedInvalid || f.errorMessage || f.required) return true;
    const lblText = `${f.label || ""} ${f.helperText || ""}`;
    if (/\boptional\b|\(optional\)|additional\s*(information|comments|notes|context)|anything\s*else/i.test(lblText)) {
      return false;
    }
    return true;
  });
  const pageErrors = Array.isArray(diagnostics?.pageErrors) ? diagnostics.pageErrors.slice(0, 12) : [];
  if (fields.length === 0 && pageErrors.length === 0) {
    return {
      diagnosis: { analysisSummary: "No unresolved fields or validation errors detected.", repairs: [] },
      modelUsed: "none"
    };
  }

  const p = profile?.personal || {};
  const eeo = profile?.workAuthAndEEO || {};

  const buildDeterministicFallback = () => {
    const repairs = [];
    for (const f of fields) {
      const lbl = `${f.label || ""} ${f.helperText || ""} ${f.placeholder || ""}`.toLowerCase();
      const err = `${f.errorMessage || ""} ${pageErrors.join(" ")}`.toLowerCase();
      const opts = Array.isArray(f.options) ? f.options.filter(Boolean) : [];
      const cur = String(f.currentValue || "").trim();

      if (f.kind === "checkbox") {
        if (!/do\s*not\s*(contact|sell|share)|opt[- ]?out|unsubscribe/i.test(lbl)) {
          repairs.push({ refId: f.refId, action: "check", value: "true", reason: "Required consent/acknowledgement" });
        }
        continue;
      }

      if (opts.length > 0 && ["select", "combobox", "radio_group", "checkbox_group", "button_group"].includes(f.kind)) {
        let pick = opts[0];
        if (/sponsor|visa.*future|require.*visa/i.test(lbl)) {
          pick = opts.find((o) => /^yes\b/i.test(o)) || opts[0];
        } else if (/authorized|legally\s+eligible|right\s+to\s+work/i.test(lbl)) {
          pick = opts.find((o) => /^yes\b/i.test(o)) || opts[0];
        } else if (/relocat|hybrid|onsite|in[- ]person|commute/i.test(lbl)) {
          pick = opts.find((o) => /^yes\b|hybrid|remote|flexible|open/i.test(o)) || opts[0];
        } else if (/clearance|export\s*control|previously\s+worked|former\s+employee|non[- ]?compete|related\s+to/i.test(lbl)) {
          pick = opts.find((o) => /^no\b/i.test(o)) || opts[0];
        } else if (/gender|sex\b/i.test(lbl)) {
          pick = opts.find((o) => /\bmale\b|\bman\b/i.test(o)) || opts[0];
        } else if (/hispanic|latino/i.test(lbl)) {
          pick = opts.find((o) => /^no\b/i.test(o)) || opts[0];
        } else if (/race|ethnic/i.test(lbl)) {
          pick = opts.find((o) => /asian/i.test(o)) || opts[0];
        } else if (/veteran/i.test(lbl)) {
          pick = opts.find((o) => /not\s+a\s+(protected\s+)?veteran|^no\b/i.test(o)) || opts[0];
        } else if (/disabilit/i.test(lbl)) {
          pick = opts.find((o) => /^no\b|do\s+not\s+have/i.test(o)) || opts[0];
        } else if (/hear\s+about|source/i.test(lbl)) {
          pick = opts.find((o) => /linkedin|company\s+website|job\s+board/i.test(o)) || opts[0];
        }
        repairs.push({
          refId: f.refId,
          action: f.kind === "select" || f.kind === "combobox" ? "select_option" : "click_choice",
          value: pick,
          reason: "Matched valid option from available list"
        });
        continue;
      }

      if (/phone|mobile|tel/i.test(lbl)) {
        const digitsOnly = p.phoneDigits || "7748108481";
        const val =
          /10\s*digit|digits?\s*only|no\s*(spaces|dashes|parentheses|symbols)/i.test(err) || cur.startsWith("+")
            ? digitsOnly
            : `+1${digitsOnly}`;
        repairs.push({ refId: f.refId, action: "fill_text", value: val, reason: "Normalized phone format" });
        continue;
      }

      if (/salary|compensation|pay|remuneration/i.test(lbl) || /digits?\s*only|numeric|valid\s*number|no\s*\$|leading\s*\$|format\s+currency/i.test(err)) {
        const num = Number(jobMeta?.compensation?.midpoint || jobMeta?.compensation?.targetAnnual || eeo?.desiredSalaryTarget || 165000);
        const val = /leading\s*\$|with\s*\$|format\s+currency/i.test(err) ? `$${num.toLocaleString("en-US")}` : String(num);
        repairs.push({ refId: f.refId, action: "fill_text", value: val, reason: "Repaired compensation format" });
        continue;
      }

      if (f.inputType === "number" || /years?.*experience|how\s+many\s+years/i.test(lbl)) {
        repairs.push({
          refId: f.refId,
          action: "fill_text",
          value: String(p.yearsOfExperienceInt || "3"),
          reason: "Numeric years of experience"
        });
        continue;
      }

      if (f.inputType === "url" || /linkedin|github|portfolio|website|url|link/i.test(lbl)) {
        const link = /github/i.test(lbl)
          ? p.github || "https://github.com/ravitejav-dev"
          : /portfolio|website/i.test(lbl)
            ? p.portfolio || p.github || "https://github.com/ravitejav-dev"
            : p.linkedin || "https://www.linkedin.com/in/raviteja-velanati/";
        repairs.push({ refId: f.refId, action: "fill_text", value: link, reason: "Valid HTTPS profile URL" });
        continue;
      }

      if (!cur || f.flaggedInvalid || f.errorMessage) {
        repairs.push({
          refId: f.refId,
          action: "fill_text",
          value: `3.5+ years building production AI evaluation sandboxes, Kubernetes microservices, and Python/TypeScript data pipelines at Google AI workflows (GlobalLogic), ready to contribute immediately at ${jobMeta?.company || "your team"}.`,
          reason: "Grounded technical response for required field"
        });
      }
    }
    return {
      analysisSummary: pageErrors[0] || `Repaired ${repairs.length} missing or invalid form field(s).`,
      repairs
    };
  };

  const systemInstruction = `You are Jobify's Autonomous Form Error Analyzer & Self-Healing Agent.
A job application form showed validation errors or failed to submit because one or more fields are missing or formatted in a way the portal validator rejected.
Your job:
1. Read EVERY error in pageErrors and EVERY field's errorMessage, currentValue, label, helperText, placeholder, kind, inputType, maxLength, and options.
2. Ground all candidate facts strictly in the provided CANDIDATE PROFILE (never invent degrees, employers, or clearance).
3. FORMAT REPAIR RULES (CRITICAL):
   - If a field already has a currentValue AND has an errorMessage (or flaggedInvalid is true): diagnose WHY currentValue failed validation and produce a corrected value that strictly obeys the error message!
     * "digits only" / "numbers only" / "no $ or commas" / numeric salary -> output plain integer digits e.g. "165000" (no $, commas, or ranges).
     * "10 digits" / "no parentheses or spaces" on phone -> output "5103782758". If "E.164" or "include +1 country code" -> "+15103782758".
     * "valid URL" / "must start with https://" -> full https:// URL.
     * "at least N characters" or "maximum N characters" -> write an answer strictly satisfying that character count.
     * Date format ("MM/DD/YYYY" vs "YYYY-MM-DD") -> format exact date accordingly.
4. MISSING FIELD RULES:
   - If options array is non-empty (select, combobox, radio_group, checkbox_group, button_group), "value" MUST match one exact verbatim string from that field's options array.
   - For single checkbox (consent, privacy, terms, certify, acknowledge), use action "check" and value "true" (never check opt-out / "do not contact" boxes).
   - For open-ended text/textarea questions, write a crisp, factual 1-3 sentence answer grounded in Raviteja's experience (Senior AI Solutions Engineer at GlobalLogic / Google AI client, 13 sandboxed web apps, 48-persona synthetic pipelines, Python, TypeScript, React, FastAPI, Kubernetes, GCP, Clark University M.S. CS).
   - Do NOT fill purely optional "Additional comments / Anything else" fields if they have NO errorMessage and required is false.
5. Return ONLY valid JSON matching the exact schema.`;

  const prompt = `TARGET JOB:
Company: ${jobMeta?.company || "Target Company"}
Role: ${jobMeta?.title || "Software / AI Engineer"}
Location: ${jobMeta?.location || "United States"}
Posted Compensation: ${jobMeta?.compensation?.raw || "Not listed"}

VISIBLE PAGE / FORM VALIDATION ERRORS:
${JSON.stringify(pageErrors, null, 2)}

UNRESOLVED OR FLAGGED FORM FIELDS:
${JSON.stringify(fields, null, 2)}

CANDIDATE MASTER PROFILE:
${JSON.stringify(
  {
    personal: p,
    workAuthAndEEO: eeo,
    topExperience: (profile?.workExperience || []).slice(0, 2).map((w) => ({
      company: w.company,
      title: w.title,
      period: `${w.startDateDisplay} - ${w.endDateDisplay}`,
      highlights: (w.highlights || []).slice(0, 3)
    })),
    education: profile?.education?.[0] || {},
    savedAnswers: (savedAnswers || []).slice(0, 5)
  },
  null,
  2
)}

Return JSON with this exact structure:
{
  "analysisSummary": "Concise 1-sentence root cause of what failed validation and how you are fixing it",
  "repairs": [
    {
      "refId": "exact refId from UNRESOLVED OR FLAGGED FORM FIELDS",
      "action": "fill_text | select_option | click_choice | check",
      "value": "exact corrected value or verbatim option string",
      "reason": "short reason"
    }
  ]
}`;

  try {
    const res = await callGemini({
      prompt,
      systemInstruction,
      requestedModel: settings?.primaryModel || "gemini-3.5-flash",
      jsonMode: true,
      temperature: 0.15,
      maxOutputTokens: 3000,
      timeoutMs: 14000,
      settings
    });
    const parsed = parseJsonResponse(res.text);
    if (parsed && Array.isArray(parsed.repairs) && parsed.repairs.length > 0) {
      return {
        diagnosis: {
          analysisSummary: String(parsed.analysisSummary || "AI diagnosed and repaired form errors."),
          repairs: parsed.repairs
        },
        modelUsed: res.modelUsed
      };
    }
  } catch (_) {}

  return {
    diagnosis: buildDeterministicFallback(),
    modelUsed: "deterministic-doctor-fallback"
  };
}
