// Deterministic + Semantic ATS Keyword Scanner, 100-Pt Resume Scorer & Dealbreaker Engine

export const TECH_KEYWORD_DICTIONARY = [
  // Languages
  { canonical: "Python", aliases: ["python", "python3"] },
  { canonical: "TypeScript", aliases: ["typescript", "ts"] },
  { canonical: "JavaScript", aliases: ["javascript", "es6"] },
  { canonical: "C++", aliases: ["c++", "cpp"] },
  { canonical: "C#", aliases: ["c#", "csharp", ".net"] },
  { canonical: "Go", aliases: ["golang", " go "] },
  { canonical: "Rust", aliases: ["rust"] },
  { canonical: "Java", aliases: ["java"] },
  { canonical: "SQL", aliases: ["sql", "postgresql", "postgres", "mysql"] },
  { canonical: "Bash/Shell", aliases: ["bash", "shell scripting", "linux"] },
  // Frontend & Backend Frameworks
  { canonical: "React", aliases: ["react", "react.js", "reactjs"] },
  { canonical: "Next.js", aliases: ["next.js", "nextjs"] },
  { canonical: "Angular", aliases: ["angular"] },
  { canonical: "Node.js", aliases: ["node.js", "nodejs"] },
  { canonical: "FastAPI", aliases: ["fastapi"] },
  { canonical: "Django", aliases: ["django"] },
  { canonical: "Flask", aliases: ["flask"] },
  { canonical: "GraphQL", aliases: ["graphql"] },
  { canonical: "gRPC", aliases: ["grpc", "protobuf", "protocol buffers"] },
  { canonical: "REST APIs", aliases: ["rest api", "restful", "api design"] },
  { canonical: "Microservices", aliases: ["microservices", "distributed systems"] },
  // AI, LLM & Agents
  { canonical: "LLM", aliases: ["llm", "llms", "large language model", "foundation model"] },
  { canonical: "Generative AI", aliases: ["generative ai", "genai", "gen ai"] },
  { canonical: "RAG", aliases: ["rag", "retrieval-augmented", "retrieval augmented"] },
  { canonical: "Agentic AI", aliases: ["agentic", "ai agents", "autonomous agents", "multi-agent"] },
  { canonical: "LangGraph", aliases: ["langgraph"] },
  { canonical: "LangChain", aliases: ["langchain"] },
  { canonical: "LlamaIndex", aliases: ["llamaindex"] },
  { canonical: "AutoGen", aliases: ["autogen"] },
  { canonical: "MCP", aliases: ["model context protocol", " mcp "] },
  { canonical: "Prompt Engineering", aliases: ["prompt engineering", "chain-of-thought", "few-shot"] },
  { canonical: "LLM Evaluation", aliases: ["llm evaluation", "evals", "model evaluation", "benchmarking", "promptfoo"] },
  { canonical: "AI Safety & Red Teaming", aliases: ["ai safety", "red teaming", "adversarial", "guardrails", "trust & safety", "trust and safety", "prompt injection"] },
  { canonical: "RLHF / Post-Training", aliases: ["rlhf", "sft", "dpo", "fine-tuning", "fine tuning", "post-training", "human-in-the-loop", "hitl"] },
  { canonical: "Synthetic Data", aliases: ["synthetic data", "data generation"] },
  { canonical: "PyTorch", aliases: ["pytorch", "torch"] },
  { canonical: "TensorFlow", aliases: ["tensorflow"] },
  { canonical: "vLLM / Inference", aliases: ["vllm", "tensorrt", "triton", "model serving", "llm serving"] },
  { canonical: "Ray", aliases: ["ray"] },
  { canonical: "MLflow", aliases: ["mlflow", "weights & biases", "wandb"] },
  { canonical: "Vector Databases", aliases: ["vector database", "vector search", "embeddings", "pinecone", "weaviate", "pgvector", "milvus", "faiss"] },
  // Data, Cloud & Infra
  { canonical: "GCP", aliases: ["gcp", "google cloud", "vertex ai"] },
  { canonical: "BigQuery", aliases: ["bigquery"] },
  { canonical: "AWS", aliases: ["aws", "amazon web services", "ec2", "s3", "ecs", "lambda", "bedrock", "sagemaker"] },
  { canonical: "Azure", aliases: ["azure", "azure openai"] },
  { canonical: "Docker", aliases: ["docker", "containerization", "containers"] },
  { canonical: "Kubernetes", aliases: ["kubernetes", "k8s", "gke", "eks"] },
  { canonical: "Terraform", aliases: ["terraform", "infrastructure as code", "iac"] },
  { canonical: "CI/CD", aliases: ["ci/cd", "github actions", "jenkins", "gitlab ci"] },
  { canonical: "Apache Spark", aliases: ["spark", "pyspark", "databricks"] },
  { canonical: "Kafka", aliases: ["kafka", "streaming"] },
  { canonical: "Airflow", aliases: ["airflow", "orchestration"] },
  { canonical: "Snowflake", aliases: ["snowflake"] },
  { canonical: "Redis", aliases: ["redis", "caching"] },
  { canonical: "Neo4j", aliases: ["neo4j", "knowledge graph", "graph database"] },
  { canonical: "Playwright", aliases: ["playwright", "browser automation", "puppeteer", "selenium"] },
  { canonical: "Observability / Telemetry", aliases: ["observability", "telemetry", "opentelemetry", "prometheus", "grafana", "datadog", "tracing"] }
];

function buildResumeCorpus(profile, customResumeObj = null) {
  if (customResumeObj) {
    return JSON.stringify(customResumeObj).toLowerCase();
  }
  const parts = [
    profile.summary || "",
    profile.summaryShort || "",
    ...(profile.allSkillsFlat || []),
    ...Object.values(profile.skillsCategories || {}).flat(),
    ...(profile.workExperience || []).flatMap((w) => [
      w.company,
      w.title,
      ...(w.highlights || []),
      ...(w.subRoles || []).flatMap((sr) => [sr.title, ...(sr.bullets || [])])
    ]),
    ...(profile.projects || []).flatMap((p) => [p.name, p.stack, ...(p.bullets || [])]),
    ...(profile.certifications || [])
  ];
  return ` ${parts.join(" ").toLowerCase()} `;
}

function matchesAlias(haystack, alias) {
  if (alias.startsWith(" ") || alias.endsWith(" ")) {
    return haystack.includes(alias);
  }
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

export function analyzeJobKeywords(jobDescription, profile, customResumeObj = null) {
  const jdLower = ` ${(jobDescription || "").toLowerCase()} `;
  const resumeLower = buildResumeCorpus(profile, customResumeObj);

  const matched = [];
  const missing = [];

  for (const item of TECH_KEYWORD_DICTIONARY) {
    let jdHits = 0;
    for (const alias of item.aliases) {
      if (matchesAlias(jdLower, alias)) {
        const escaped = alias.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const countMatches = jdLower.match(new RegExp(escaped, "gi"));
        jdHits += countMatches ? countMatches.length : 1;
      }
    }
    if (jdHits > 0) {
      const inResume = item.aliases.some((alias) => matchesAlias(resumeLower, alias));
      if (inResume) {
        matched.push({ keyword: item.canonical, mentions: jdHits });
      } else {
        missing.push({ keyword: item.canonical, mentions: jdHits, priority: jdHits >= 2 ? "High" : "Medium" });
      }
    }
  }

  matched.sort((a, b) => b.mentions - a.mentions);
  missing.sort((a, b) => b.mentions - a.mentions);

  const total = matched.length + missing.length;
  const keywordCoveragePct = total === 0 ? 85 : Math.round((matched.length / total) * 100);

  return {
    totalDetected: total,
    matched,
    missing,
    keywordCoveragePct
  };
}

export function scoreResumeATS(profile, jobDescription = "", tailoredResume = null) {
  const kw = analyzeJobKeywords(jobDescription, profile, tailoredResume);

  // 1. Keyword Alignment (35 pts)
  const keywordScore = Math.round((kw.keywordCoveragePct / 100) * 35);

  // 2. Quantified Impact & Metrics Density (20 pts)
  const bullets = tailoredResume?.experience
    ? [
        ...tailoredResume.experience.flatMap((e) => e.bullets || []),
        ...(tailoredResume.projects || []).flatMap((p) => p.bullets || [])
      ]
    : [
        ...(profile.workExperience || []).flatMap((w) => w.highlights || []),
        ...(profile.projects || []).flatMap((p) => p.bullets || [])
      ];

  const metricRegex = /(\d+%|\d+x|\d+\+|\$[\d,]+|#\d+|\d{2,})/i;
  const quantifiedCount = bullets.filter((b) => metricRegex.test(b)).length;
  const metricRatio = bullets.length > 0 ? Math.min(1, quantifiedCount / Math.max(4, bullets.length * 0.6)) : 0.7;
  const impactScore = Math.round(metricRatio * 20);

  // 3. Action Verbs & Bullet Clarity (15 pts)
  const strongVerbs =
    /^(architected|engineered|built|designed|spearheaded|orchestrated|optimized|automated|developed|implemented|streamlined|delivered|launched|scaled|accelerated|constructed|integrated|modernized|established|pioneered|owned|re-engineered|ranked|created|led|reduced|cut|authored|deployed|configured|hardened)/i;
  const strongCount = bullets.filter((b) => strongVerbs.test((b || "").trim())).length;
  const verbScore = bullets.length > 0 ? Math.min(15, Math.round((strongCount / bullets.length) * 15) + 2) : 12;

  // 4. ATS Parseability & Section Completeness (15 pts)
  let formatScore = 0;
  if (profile?.personal?.email && profile?.personal?.phone) formatScore += 5;
  if (profile?.personal?.linkedin) formatScore += 3;
  if ((profile?.education || []).length > 0) formatScore += 4;
  if ((profile?.workExperience || []).length > 0) formatScore += 3;

  // 5. Role & Seniority Fit (15 pts)
  let fitScore = 13;
  const jdLow = (jobDescription || "").toLowerCase();
  if (/10\+\s*years|12\+\s*years|staff|principal/i.test(jdLow)) {
    fitScore = tailoredResume?.targetJobTitle ? 12 : 9;
  } else if (
    tailoredResume?.targetJobTitle ||
    /ai|llm|machine learning|platform|python|typescript|full-stack|software engineer/i.test(jdLow)
  ) {
    fitScore = 15;
  }

  const totalScore = Math.min(100, keywordScore + impactScore + verbScore + formatScore + fitScore);

  const suggestions = [];
  if (kw.missing.length > 0) {
    suggestions.push(
      `Add missing JD keywords where truthful: ${kw.missing
        .slice(0, 5)
        .map((m) => m.keyword)
        .join(", ")}.`
    );
  }
  if (quantifiedCount < bullets.length * 0.7) {
    suggestions.push("Ensure at least 75% of experience bullets include concrete throughput, latency, or scale metrics.");
  }
  if (fitScore < 12) {
    suggestions.push("Target JD requests Staff/10+ YoE; emphasize your #1/11 throughput rank and 0-to-1 Google AI architecture ownership.");
  }
  if (suggestions.length === 0) {
    suggestions.push("Strong ATS alignment! Ready for 1-click upload and submission.");
  }

  return {
    totalScore,
    breakdown: {
      keywordAlignment: { score: keywordScore, max: 35 },
      quantifiedImpact: { score: impactScore, max: 20, quantifiedBullets: quantifiedCount, totalBullets: bullets.length },
      actionVerbsAndClarity: { score: verbScore, max: 15 },
      atsParseability: { score: formatScore, max: 15 },
      roleAndSeniorityFit: { score: fitScore, max: 15 }
    },
    keywords: kw,
    suggestions
  };
}

export function evaluateJobMatch(jobMeta, profile) {
  const title = (jobMeta.title || "").toLowerCase();
  const jd = (jobMeta.description || "").toLowerCase();
  const loc = (jobMeta.location || "").toLowerCase();

  const dealbreakers = [];
  for (const phrase of profile?.preferences?.dealbreakerExcludeKeywords || []) {
    if (jd.includes(phrase.toLowerCase()) || title.includes(phrase.toLowerCase())) {
      dealbreakers.push(`Dealbreaker detected: "${phrase}"`);
    }
  }
  if (/do not provide sponsorship|cannot sponsor|no visa sponsorship|must be a u\.s\. citizen/i.test(jd)) {
    if (profile?.workAuthAndEEO?.requireSponsorship === "Yes") {
      dealbreakers.push("Sponsorship warning: JD mentions no visa sponsorship / citizenship requirement.");
    }
  }

  // Extract salary range if listed
  let extractedSalaryMax = null;
  const salMatches = [...(jobMeta.description || "").matchAll(/\$\s*(\d{2,3}),(\d{3})/g)];
  if (salMatches.length > 0) {
    const nums = salMatches.map((m) => parseInt(m[1] + m[2], 10)).filter((n) => n >= 50000 && n <= 900000);
    if (nums.length > 0) {
      extractedSalaryMax = Math.max(...nums);
      if (extractedSalaryMax < (profile?.preferences?.minSalary || 140000)) {
        dealbreakers.push(`Listed max salary ($${extractedSalaryMax.toLocaleString()}) is below your $${(profile.preferences.minSalary || 145000).toLocaleString()} minimum.`);
      }
    }
  }

  // Score role match + keyword match + location match
  const kw = analyzeJobKeywords(jobMeta.description || title, profile);
  let roleBonus = 15;
  if (/ai|llm|ml|machine learning|genai|agent|platform|evaluation|python|full stack|fullstack|software engineer/i.test(title)) {
    roleBonus = 30;
  }
  let locBonus = 15;
  const prefLocs = (profile?.preferences?.preferredLocations || []).map((l) => l.toLowerCase());
  if (!loc || prefLocs.some((pl) => loc.includes(pl)) || /united states|us|remote|hybrid/i.test(loc)) {
    locBonus = 20;
  }

  let rawScore = Math.round(kw.keywordCoveragePct * 0.5 + roleBonus + locBonus);
  if (dealbreakers.length > 0) rawScore = Math.max(25, rawScore - dealbreakers.length * 20);

  return {
    matchScore: Math.min(99, Math.max(20, rawScore)),
    extractedSalaryMax,
    dealbreakers,
    keywords: kw
  };
}
