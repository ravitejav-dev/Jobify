// Deterministic + Semantic ATS Keyword Scanner, 100-Pt Resume Scorer & Dealbreaker Engine

export const TECH_KEYWORD_DICTIONARY = [
  // Languages
  { canonical: "Python", aliases: ["python", "python3"] },
  { canonical: "TypeScript", aliases: ["typescript", "ts"] },
  { canonical: "JavaScript", aliases: ["javascript", "es6", "ecmascript"] },
  { canonical: "C++", aliases: ["c++", "cpp"] },
  { canonical: "C#", aliases: ["c#", "csharp", ".net"] },
  { canonical: "Go", aliases: ["golang", " go "] },
  { canonical: "Rust", aliases: ["rust"] },
  { canonical: "Java", aliases: ["java"] },
  { canonical: "SQL", aliases: ["sql", "postgresql", "postgres", "mysql", "sqlite"] },
  { canonical: "Bash & Shell", aliases: ["bash", "shell scripting", "linux", "unix"] },
  { canonical: "HTML5 & CSS3", aliases: ["html5", "css3", "html", "css"] },
  // Frontend & Web Systems
  { canonical: "React", aliases: ["react", "react.js", "reactjs"] },
  { canonical: "Next.js", aliases: ["next.js", "nextjs"] },
  { canonical: "Angular", aliases: ["angular"] },
  { canonical: "Vue.js", aliases: ["vue", "vue.js", "vuejs"] },
  { canonical: "Tailwind CSS", aliases: ["tailwind", "tailwindcss"] },
  { canonical: "WebSockets", aliases: ["websocket", "websockets", "real-time streaming", "sse"] },
  // Backend, APIs & Distributed Systems
  { canonical: "Node.js", aliases: ["node.js", "nodejs", "express.js"] },
  { canonical: "FastAPI", aliases: ["fastapi"] },
  { canonical: "Django", aliases: ["django"] },
  { canonical: "Flask", aliases: ["flask"] },
  { canonical: ".NET Core", aliases: [".net core", "asp.net"] },
  { canonical: "Spring Boot", aliases: ["spring boot", "spring"] },
  { canonical: "GraphQL", aliases: ["graphql"] },
  { canonical: "gRPC", aliases: ["grpc", "protobuf", "protocol buffers"] },
  { canonical: "REST APIs", aliases: ["rest api", "restful", "api design", "rest endpoints"] },
  { canonical: "Microservices", aliases: ["microservices", "service-oriented"] },
  { canonical: "Distributed Systems", aliases: ["distributed systems", "distributed computing", "scalable systems", "high-throughput"] },
  { canonical: "System Design", aliases: ["system design", "architecture design", "fault-tolerant", "high availability"] },
  { canonical: "AsyncIO & Concurrency", aliases: ["asyncio", "asynchronous", "concurrency", "multithreading", "multiprocessing"] },
  { canonical: "Event-Driven Architecture", aliases: ["event-driven", "message queue", "pub/sub", "pubsub", "celery", "rabbitmq"] },
  { canonical: "Low-Latency Systems", aliases: ["low latency", "low-latency", "latency optimization", "high performance"] },
  // AI, LLMs & Agentic Orchestration
  { canonical: "LLM", aliases: ["llm", "llms", "large language model", "foundation model", "frontier model"] },
  { canonical: "Generative AI", aliases: ["generative ai", "genai", "gen ai"] },
  { canonical: "RAG", aliases: ["rag", "retrieval-augmented", "retrieval augmented", "hybrid search", "semantic search"] },
  { canonical: "Agentic AI", aliases: ["agentic", "ai agents", "autonomous agents", "multi-agent", "agent workflows"] },
  { canonical: "LangGraph", aliases: ["langgraph"] },
  { canonical: "LangChain", aliases: ["langchain"] },
  { canonical: "LlamaIndex", aliases: ["llamaindex"] },
  { canonical: "AutoGen", aliases: ["autogen", "crewai"] },
  { canonical: "MCP", aliases: ["model context protocol", " mcp "] },
  { canonical: "Tool Use & Function Calling", aliases: ["tool use", "function calling", "tool-calling", "tool calling", "structured outputs"] },
  { canonical: "Context Engineering", aliases: ["context engineering", "context window", "memory management", "long-context"] },
  { canonical: "Prompt Engineering", aliases: ["prompt engineering", "chain-of-thought", "few-shot", "system prompts"] },
  { canonical: "Model Routing", aliases: ["model routing", "llm gateway", "fallback handling", "inference routing"] },
  // LLM Evaluation, Safety & Post-Training
  { canonical: "LLM Evaluation", aliases: ["llm evaluation", "evals", "model evaluation", "benchmarking", "promptfoo", "llm-as-a-judge"] },
  { canonical: "AI Safety & Red Teaming", aliases: ["ai safety", "red teaming", "red-teaming", "adversarial", "guardrails", "trust & safety", "trust and safety", "prompt injection", "responsible ai"] },
  { canonical: "RLHF & Post-Training", aliases: ["rlhf", "sft", "dpo", "fine-tuning", "fine tuning", "post-training", "preference tuning"] },
  { canonical: "Human-in-the-Loop (HITL)", aliases: ["human-in-the-loop", "hitl", "human rating", "annotation", "data labeling", "side-by-side"] },
  { canonical: "Synthetic Data", aliases: ["synthetic data", "data generation", "data seeding", "persona simulation"] },
  { canonical: "Trajectory Analysis", aliases: ["trajectory", "reasoning traces", "execution traces", "multi-turn evaluation"] },
  // ML, Deep Learning & Inference
  { canonical: "PyTorch", aliases: ["pytorch", "torch"] },
  { canonical: "TensorFlow", aliases: ["tensorflow"] },
  { canonical: "Hugging Face", aliases: ["hugging face", "huggingface", "transformers"] },
  { canonical: "vLLM & Inference Serving", aliases: ["vllm", "tensorrt", "triton", "model serving", "llm serving", "inference optimization"] },
  { canonical: "Ray", aliases: ["ray", "anyscale"] },
  { canonical: "CUDA & GPU Optimization", aliases: ["cuda", "gpu", "nccl"] },
  { canonical: "MLflow", aliases: ["mlflow", "weights & biases", "wandb", "experiment tracking"] },
  { canonical: "Multimodal AI", aliases: ["multimodal", "multi-modal", "video processing", "vision-language", "audio processing", "ocr"] },
  // Data, Storage & Vector DBs
  { canonical: "Vector Databases", aliases: ["vector database", "vector search", "embeddings", "pinecone", "weaviate", "pgvector", "milvus", "faiss", "qdrant", "chromadb"] },
  { canonical: "PostgreSQL", aliases: ["postgresql", "postgres", "supabase", "relational database"] },
  { canonical: "Redis", aliases: ["redis", "caching", "in-memory cache"] },
  { canonical: "MongoDB", aliases: ["mongodb", "nosql", "dynamodb"] },
  { canonical: "BigQuery", aliases: ["bigquery"] },
  { canonical: "Snowflake", aliases: ["snowflake"] },
  { canonical: "Apache Spark", aliases: ["spark", "pyspark", "databricks"] },
  { canonical: "Kafka", aliases: ["kafka", "streaming", "kinesis"] },
  { canonical: "Airflow", aliases: ["airflow", "orchestration", "dagster", "prefect", "temporal"] },
  { canonical: "Neo4j", aliases: ["neo4j", "knowledge graph", "graph database"] },
  { canonical: "Data Pipelines & ETL", aliases: ["data pipeline", "data pipelines", "etl", "elt", "data ingestion", "batch processing"] },
  // Cloud, DevOps, Testing & Observability
  { canonical: "GCP", aliases: ["gcp", "google cloud", "vertex ai", "cloud storage", "gcs"] },
  { canonical: "AWS", aliases: ["aws", "amazon web services", "ec2", "s3", "ecs", "lambda", "bedrock", "sagemaker"] },
  { canonical: "Azure", aliases: ["azure", "azure openai"] },
  { canonical: "Docker", aliases: ["docker", "containerization", "containers", "containerized"] },
  { canonical: "Kubernetes", aliases: ["kubernetes", "k8s", "gke", "eks", "helm"] },
  { canonical: "Terraform", aliases: ["terraform", "infrastructure as code", "iac"] },
  { canonical: "CI & CD", aliases: ["ci/cd", "ci & cd", "continuous integration", "continuous delivery", "github actions", "jenkins", "gitlab ci"] },
  { canonical: "Playwright", aliases: ["playwright", "browser automation", "puppeteer", "selenium", "end-to-end testing", "e2e testing"] },
  { canonical: "Observability & Telemetry", aliases: ["observability", "telemetry", "opentelemetry", "prometheus", "grafana", "datadog", "distributed tracing", "monitoring"] }
];

export function detectJobArchetype(jobMeta = {}) {
  const combined = `${jobMeta.title || ""} ${jobMeta.description || ""}`.toLowerCase();
  const scores = {
    eval_safety_rlhf: 0,
    frontier_ai_agents: 0,
    fullstack_product_ai: 0,
    backend_distributed_infra: 0,
    data_ml_pipelines: 0
  };
  if (/eval|evaluation|benchmark|red[- ]?team|safety|alignment|rlhf|post-training|human-in-the-loop|hitl|synthetic data|trust\s*&\s*safety|quality/i.test(combined)) {
    scores.eval_safety_rlhf += 4;
  }
  if (/agent|agentic|langgraph|langchain|mcp|tool[- ]?use|function calling|rag|llm|genai|generative ai|prompt|autonomous/i.test(combined)) {
    scores.frontier_ai_agents += 3;
  }
  if (/full[- ]?stack|frontend|react|next\.js|angular|ui|ux|typescript|product engineer|web application/i.test(combined)) {
    scores.fullstack_product_ai += 3;
  }
  if (/distributed systems|backend|platform|infrastructure|kubernetes|docker|microservices|grpc|c\+\+|go|golang|low[- ]?latency|scalability|reliability|sre|devops/i.test(combined)) {
    scores.backend_distributed_infra += 3;
  }
  if (/data pipeline|etl|spark|pyspark|bigquery|snowflake|kafka|airflow|data engineer|mlops|ml infrastructure|pytorch|vllm|inference/i.test(combined)) {
    scores.data_ml_pipelines += 3;
  }
  const titleLow = (jobMeta.title || "").toLowerCase();
  if (/eval|safety|rlhf|alignment|quality|trust/i.test(titleLow)) scores.eval_safety_rlhf += 5;
  else if (/agent|llm|ai|genai|ml|machine learning/i.test(titleLow)) scores.frontier_ai_agents += 4;
  else if (/full[- ]?stack|frontend|ui|product/i.test(titleLow)) scores.fullstack_product_ai += 5;
  else if (/data|analytics|pipeline/i.test(titleLow)) scores.data_ml_pipelines += 5;
  else if (/backend|platform|infrastructure|systems|software engineer/i.test(titleLow)) scores.backend_distributed_infra += 4;

  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

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
      const inResume =
        matchesAlias(resumeLower, item.canonical.toLowerCase()) ||
        item.aliases.some((alias) => matchesAlias(resumeLower, alias));
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
