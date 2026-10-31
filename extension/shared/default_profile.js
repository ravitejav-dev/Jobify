// Jobify Pre-Analyzed Candidate Profile & Vault (Extracted from Raviteja Velanati's Master & 1-Page Resumes)

export const PROFILE_SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS = {
  geminiApiKey: "", // Loaded from gitignored shared/local_secrets.json or entered once in Jobify Vault UI
  primaryModel: "gemini-3.8-flash",
  proModel: "gemini-3.1-pro-preview",
  enableSmartFallback: true,
  fallbackChain: [
    "gemini-3.8-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-3.5-flash-lite"
  ],
  companionServerUrl: "http://127.0.0.1:18765",
  autoShowCopilotWidget: true,
  autoSaveSubmittedJobs: true,
  autoAttachResumePdf: true,
  defaultResumeVariant: "one_page", // "one_page" | "master"
  autopilotMode: "full_auto" // "full_auto" (autonomous tailor -> apply -> fill -> submit) | "safe_review" (pause before final submit)
};

export const DEFAULT_CREDENTIALS_VAULT = {
  portalEmail: "ravitejavelanati11@gmail.com",
  portalPassword: "", // Loaded from gitignored shared/local_secrets.json or entered once in Jobify Vault UI
  gmailAppPassword: "",
  autoFillPortalSignups: true
};

export const DEFAULT_PROFILE = {
  profileSchemaVersion: PROFILE_SCHEMA_VERSION,
  personal: {
    firstName: "Raviteja",
    middleName: "",
    lastName: "Velanati",
    fullName: "Raviteja Velanati",
    preferredName: "Ravi",
    pronouns: "He/Him",
    email: "ravitejavelanati11@gmail.com",
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
    linkedinAlt: "https://www.linkedin.com/in/ravitejavelanati",
    github: "https://github.com/ravitejav-dev",
    portfolio: "https://3-d-portfolio-999a6bwm3-ravitejav-devs-projects.vercel.app",
    currentCompany: "GlobalLogic (Client: Google AI)",
    currentTitle: "Senior AI Solutions Engineer – Responsible AI & Novel AI Testing",
    yearsOfExperience: "3.5",
    yearsOfExperienceInt: "3",
    yearsOfExperienceRange: "3-4 years",
    totalYearsNumeric: 3.5,
    highestDegree: "Master's Degree",
    headline: "AI/ML Platform & GenAI Engineer | LLM Evaluation, Agentic AI Infrastructure & Full-Stack Systems"
  },

  workAuthAndEEO: {
    authorizedUS: "Yes",
    requireSponsorship: "Yes",
    visaStatus: "H-1B",
    citizenship: "India",
    willingToRelocate: "Yes",
    workArrangement: "Hybrid / Remote / On-site",
    earliestStartDate: "2 weeks notice",
    noticePeriodWeeks: "2",
    useJdSalaryWhenAvailable: true,
    desiredSalaryMin: 120000,
    desiredSalaryMax: 140000,
    desiredSalaryTarget: 120000,
    desiredSalaryRangeNumeric: "120000-140000",
    desiredSalaryDisplay: "$120,000 - $140,000",
    desiredHourlyMin: 50,
    desiredHourlyMax: 60,
    desiredHourlyTarget: 50,
    desiredHourlyDisplay: "$50/hr",
    desiredHourlyRangeDisplay: "$50/hr - $60/hr",
    governmentOrClearance: "No",
    securityClearance: "No",
    relativesAtCompany: "No",
    gender: "Male",
    hispanicOrLatino: "No",
    raceEthnicity: "Asian",
    sexualOrientation: "Straight",
    lgbtq: "No",
    transgender: "No",
    veteranStatus: "I am not a protected veteran",
    disabilityStatus: "No, I do not have a disability and have not had one in the past",
    howDidYouHear: "LinkedIn",
    previouslyEmployedAtCompany: "No",
    over18: "Yes",
    backgroundCheckConsent: "Yes"
  },

  preferences: {
    targetRoles: [
      "AI/ML Platform Engineer",
      "Generative AI Engineer",
      "AI Solutions Engineer",
      "LLM Evaluation & Infrastructure Engineer",
      "Machine Learning Engineer",
      "Agentic AI Engineer",
      "Senior Software Engineer, AI",
      "Full-Stack AI Engineer",
      "Backend / Platform Software Engineer"
    ],
    preferredLocations: [
      "San Francisco",
      "Bay Area",
      "Santa Clara",
      "Sunnyvale",
      "Mountain View",
      "Palo Alto",
      "San Jose",
      "Menlo Park",
      "Newark",
      "California",
      "Remote",
      "Seattle",
      "New York"
    ],
    minSalary: 115000,
    dealbreakerExcludeKeywords: [
      "US Citizens Only",
      "Active Top Secret Clearance",
      "TS/SCI",
      "Principal 12+ years",
      "Unpaid Internship"
    ]
  },

  summary:
    "AI/ML Platform Engineer specializing in LLM evaluation, agentic AI testing infrastructure, and Trust & Safety workflows for Google AI (via GlobalLogic). Built 0-to-1 developer tools, 13 full-stack sandbox environments, synthetic data pipelines across 48 personas and 9 cloud services, and human-in-the-loop evaluation platforms using Python, TypeScript, React, Angular, and C++. Ranked #1 of 11 engineers in platform throughput. Focused on making LLM systems testable, traceable, and reliable at scale.",

  summaryShort:
    "Gen AI / Platform Engineer with 3+ years of experience in LLM evaluation, agentic AI testing infrastructure, and Trust & Safety workflows at Google AI (via GlobalLogic). Built 13 full-stack sandbox apps, synthetic data pipelines across 48 personas, and human-in-the-loop platforms (Python, TypeScript, React, Angular, C++). Ranked #1 of 11 engineers in platform throughput.",

  skillsCategories: {
    Languages: [
      "Python", "TypeScript", "JavaScript", "C++", "C#", "Go", "Java", "SQL", "Bash/Shell", "HTML5/CSS3"
    ],
    "Frameworks & Libraries": [
      "React.js", "Angular", "Node.js", "FastAPI", "Django", ".NET Core", "LangGraph", "LangChain", "PyTorch", "Playwright", "Apache Spark/PySpark", "Unity"
    ],
    "AI & LLM": [
      "LLM Platforms", "RAG Systems", "Agentic Orchestration", "Prompt Engineering", "Chain-of-Thought (CoT)", "promptfoo", "MLflow", "Autogen", "AI Safety & Adversarial Testing", "Evaluation Frameworks", "Synthetic Data Pipelines", "Human-in-the-Loop (HITL) Systems"
    ],
    "Cloud & DevOps": [
      "GCP", "Google Cloud Storage (GCS)", "BigQuery", "AWS", "EC2", "ECS", "S3", "AWS Lambda", "Docker", "Kubernetes", "Terraform", "Jenkins", "GitHub Actions", "CI/CD", "Linux", "Simulation Sandboxes"
    ],
    "Data & Tooling": [
      "Neo4j", "Multi-modal Data Pipelines", "Google3 Toolchain", "Blaze", "Piper", "Critique", "textproto", "Google Apps Script", "Claude Code", "Cursor", "Gemini API", "Agile"
    ]
  },

  allSkillsFlat: [
    "Python", "TypeScript", "JavaScript", "C++", "C#", "Go", "Java", "SQL", "Bash", "Shell", "HTML5", "CSS3",
    "React", "React.js", "Angular", "Node.js", "FastAPI", "Django", ".NET Core", "LangGraph", "LangChain",
    "PyTorch", "Playwright", "Apache Spark", "PySpark", "Unity", "LLM", "Generative AI", "RAG",
    "Agentic AI", "Multi-Agent Systems", "Prompt Engineering", "promptfoo", "MLflow", "Autogen",
    "AI Safety", "Red Teaming", "Adversarial Testing", "LLM Evaluation", "Synthetic Data",
    "Human-in-the-Loop", "RLHF", "GCP", "BigQuery", "Cloud Storage", "AWS", "EC2", "ECS", "S3", "Lambda",
    "Docker", "Kubernetes", "Terraform", "Jenkins", "GitHub Actions", "CI/CD", "Linux", "Neo4j",
    "Browser Automation", "Microservices", "REST APIs", "Distributed Systems"
  ],

  workExperience: [
    {
      id: "exp_google_senior_ai",
      company: "GlobalLogic (Client: Google AI)",
      title: "Senior AI Solutions Engineer – Responsible AI & Novel AI Testing",
      location: "Santa Clara, CA",
      startMonth: "10",
      startYear: "2024",
      startDateDisplay: "Oct 2024",
      endMonth: "",
      endYear: "",
      endDateDisplay: "Present",
      currentlyWorking: true,
      employmentType: "Full-time",
      highlights: [
        "Designed, built, and deployed 13 full-stack sandboxed web applications (e-commerce, grocery, food delivery, fintech, messaging) from scratch to safely reproduce edge cases and evaluate autonomous browser AI agents (TypeScript, Angular, Python, Apps Script).",
        "Architected a synthetic data seeding framework across 48 multi-modal user personas (healthcare, wellness, youth safety, enterprise) and 9 cloud services, injecting longitudinal user histories (Email, Conversational AI, Search, Video, Photos, Drive, Calendar, Notes, Tasks, Fitbit) with a Python Data Integrity QA suite guaranteeing 100% numerical accuracy.",
        "Built Python/Playwright browser automation across all 48 test accounts and re-engineered a multi-language video segmentation pipeline (1,800+ recordings -> 40,000+ clips across 8 languages), cutting processing time by 10x and resolving a critical data-injection blocker in 10 days.",
        "Ranked #1 of 11 developers in platform throughput on CrowdCompute, delivering 2,000+ ingestion and extraction batches across 460+ evaluation workflows with zero queue backlog and building Side-by-Side (SxS) rating interfaces across 19 custom React/TypeScript/textproto plugin builds.",
        "Built full-stack telemetry dashboards (React, TypeScript, Node.js) reducing AI agent mean-time-to-diagnosis by ~60%, warm-pool Docker/Kubernetes sandboxes cutting initialization latency by 70%, and Python/C++ LLM serving backends with promptfoo CI/CD analyzers and PyTorch fallback diagnostics."
      ],
      subRoles: [
        {
          title: "Senior AI Solutions Engineer – Responsible AI & Novel AI Testing",
          period: "Nov 2025 – Present",
          bullets: [
            "Designed, built, and deployed 13 full-stack sandboxed web applications (e-commerce, grocery, food delivery, fintech, messaging) from scratch to safely reproduce edge cases and evaluate autonomous browser AI agents (TypeScript, Angular, Python, Apps Script).",
            "Architected a synthetic data seeding framework across 48 multi-modal user personas and 9 cloud services, plus an automated Python Data Integrity QA suite guaranteeing 100% numerical accuracy and Playwright biometric clustering automation.",
            "Re-engineered a multi-language video segmentation pipeline to process 1,800+ recordings into 40,000+ two-minute clips across 8 languages, cutting processing time by 10x; resolved a critical data-injection blocker in 10 days.",
            "Built full-stack telemetry dashboards (React, TypeScript, Node.js) cutting diagnosis time by ~60%, warm-pool Docker/Kubernetes infrastructure cutting sandbox startup latency by 70%, and adversarial multi-turn evaluation suites catching 40+ edge cases pre-deployment."
          ]
        },
        {
          title: "Senior Software Developer – Plugin & Data Solutions Architect (CrowdCompute)",
          period: "Aug 2025 – Sep 2026",
          bullets: [
            "Ranked #1 of 11 developers in platform throughput, delivering 2,000+ ingestion and extraction batches across 460+ evaluation workflows with zero queue backlog.",
            "Designed and deployed Side-by-Side (SxS) human rating interfaces across 19 custom plugin builds (React, TypeScript, textproto) for multi-model LLM comparison, multilingual query vetting, and indirect prompt injection (IPI) evaluations.",
            "Owned Python ingestion, extraction, and Stage 1->Stage 2 deduplication scripts across 80+ multi-stage workflows (200+ deliveries, 55 P0 requests) and mentored junior developers."
          ]
        },
        {
          title: "Python & C++ Developer / Prompt Engineer",
          period: "Oct 2024 – Aug 2025",
          bullets: [
            "Built and maintained Python/C++ backend services to serve LLMs with low latency and high throughput under heavy production query loads; ran prompt-injection robustness evaluations.",
            "Engineered a custom YAML Editor and Promptfoo Analyzer to drive A/B prompt optimization in CI/CD pipelines; authored CoT, persona, and adversarial prompts."
          ]
        }
      ]
    },
    {
      id: "exp_massdigi",
      company: "MassDigi at WPI",
      title: "Software Engineer & Game Developer",
      location: "Worcester, MA",
      startMonth: "05",
      startYear: "2023",
      startDateDisplay: "May 2023",
      endMonth: "08",
      endYear: "2023",
      endDateDisplay: "Aug 2023",
      currentlyWorking: false,
      employmentType: "Internship",
      highlights: [
        "Programmed AI-driven NPC behavior in Unity/C# and C++ using finite state machines and behavior trees; built in-editor debugging and logging tools to reproduce AI anomalies faster.",
        "Optimized memory allocation, asset loading, and object pooling to sustain 60+ FPS under heavy rendering loads; resolved 30+ integration defects in agile sprints."
      ]
    },
    {
      id: "exp_wipro",
      company: "Wipro",
      title: "Software Engineering Intern (.NET Full-Stack)",
      location: "Hyderabad, India",
      startMonth: "03",
      startYear: "2022",
      startDateDisplay: "Mar 2022",
      endMonth: "08",
      endYear: "2022",
      endDateDisplay: "Aug 2022",
      currentlyWorking: false,
      employmentType: "Internship",
      highlights: [
        "Developed web applications and backend services on the .NET full-stack ecosystem (C#, SQL); accelerated C# architecture proficiency through structured mentoring and passed technical assessments."
      ]
    }
  ],

  projects: [
    {
      name: "Agentic AI Evaluation & Trajectory Analysis Platform",
      stack: "Python, LangGraph, LangChain, FastAPI, Docker, Kubernetes, RAG",
      bullets: [
        "Architected an evaluation platform processing 10K+ test cases daily to benchmark production LLM and multi-agent behaviors across containerized sandboxes; prevented capability drift across 12+ model iterations.",
        "Implemented automated retry logic and outcome-analysis pipelines parsing tool-call sequences and reasoning traces, eliminating 95%+ of silent failures in edge-case handling."
      ]
    },
    {
      name: "AI-Native Developer Tooling & Automated Test Harness",
      stack: "Python, React.js, TypeScript, FastAPI, Docker, AWS Lambda, CI/CD",
      bullets: [
        "Built an internal backend service translating natural-language product specs into structured coding sequences and CI/CD test workflows; reduced feature-to-production time by 40% across 8+ teams with 30+ plugins."
      ]
    }
  ],

  education: [
    {
      id: "edu_clark",
      school: "Clark University",
      degree: "Master of Science (M.S.)",
      degreeShort: "M.S.",
      fieldOfStudy: "Computer Science",
      gpa: "3.5",
      gpaScale: "4.0",
      location: "Worcester, MA",
      startMonth: "01",
      startYear: "2023",
      endMonth: "12",
      endYear: "2024",
      coursework: "Applied Data Analytics, Software Engineering, Design & Analysis of Algorithms, Data Visualization, Cyber Security Fundamentals, Network Architecture & Design"
    },
    {
      id: "edu_mallareddy",
      school: "Malla Reddy College of Engineering & Management Sciences",
      degree: "Bachelor of Technology (B.Tech)",
      degreeShort: "B.Tech",
      fieldOfStudy: "Computer Science",
      gpa: "3.6",
      gpaScale: "4.0",
      location: "Hyderabad, India",
      startMonth: "08",
      startYear: "2018",
      endMonth: "05",
      endYear: "2022",
      coursework: "Computer Science & Engineering"
    }
  ],

  certifications: [
    "Ranked #1 of 11 engineers in platform throughput (Google AI / GlobalLogic)",
    "Google Gemini for Developers",
    "Microsoft Azure AI Essentials (Microsoft & LinkedIn)",
    "Pair Programming with AI",
    "Walmart USA – Advanced Software Engineering",
    "Datacom – Software Development"
  ],

  resumes: [
    {
      id: "one_page",
      name: "Raviteja_Velanati_Resume_1Page.pdf",
      label: "1-Page GenAI & Platform Resume (Default)",
      assetPath: "assets/Raviteja_Velanati_Resume_1Page.pdf",
      isDefault: true
    },
    {
      id: "master",
      name: "Raviteja_Velanati_Master_Resume.pdf",
      label: "2-Page Master Technical Resume",
      assetPath: "assets/Raviteja_Velanati_Master_Resume.pdf",
      isDefault: false
    }
  ]
};

export const DEFAULT_SAVED_ANSWERS = [
  {
    id: "sa_why_role",
    questionPattern: "why are you (interested|excited)|why do you want|what excites you|excited to join",
    questionLabel: "Why are you interested in this role / company?",
    answer:
      "I spend every day building agentic AI evaluation infrastructure, sandboxed web environments, and large-scale LLM data pipelines supporting Google AI workflows (where I ranked #1 of 11 engineers in platform throughput across 460+ workflows). I am excited by teams pushing frontier AI reliability into real products, where my mix of Python/TypeScript/React full-stack engineering, multi-agent orchestration, and rigorous evaluation harnesses can make an immediate impact.",
    tags: ["motivation", "general"]
  },
  {
    id: "sa_complex_project",
    questionPattern: "challenging project|proud of|complex.*(system|platform)|architected|technical accomplishment|tell us about something you built",
    questionLabel: "Describe a complex technical project or system you built.",
    answer:
      "Supporting Google AI's Novel AI & Responsible AI testing, I architected a synthetic longitudinal data-seeding platform across 48 multi-modal user personas and 9 cloud services alongside 13 full-stack sandboxed web apps (TypeScript, Angular, Python) for evaluating autonomous browser AI agents. I paired this with an automated Data Integrity QA suite enforcing 100% post-injection numerical accuracy and warm-pool Docker/Kubernetes sandboxes that cut initialization latency by 70%.",
    tags: ["technical", "architecture", "ai"]
  },
  {
    id: "sa_llm_eval",
    questionPattern: "llm|genai|generative ai|agent|rag|evaluation|prompt",
    questionLabel: "Describe your experience with LLMs, Agents, and AI Evaluation.",
    answer:
      "Over the past 2+ years supporting Google AI, I have built 13 full-stack browser-agent evaluation sandboxes, Side-by-Side (SxS) human rating plugins across 19 custom builds, adversarial multi-turn agent benchmarks (catching 40+ edge cases pre-deployment), Python/C++ low-latency LLM serving backends, and promptfoo CI/CD regression pipelines processing 10K+ daily test cases.",
    tags: ["ai", "llm", "agents"]
  },
  {
    id: "sa_salary",
    questionPattern: "salary|compensation|pay expectation|total comp",
    questionLabel: "What are your salary / compensation expectations?",
    answer: "$120,000 - $140,000",
    tags: ["compensation"]
  },
  {
    id: "sa_start_date",
    questionPattern: "when can you start|earliest start date|notice period|availability",
    questionLabel: "When can you start / what is your notice period?",
    answer: "I can start within 2 weeks of an offer (or immediately if needed after transition).",
    tags: ["logistics"]
  },
  {
    id: "sa_location",
    questionPattern: "relocat|hybrid|on-site|in office|commute",
    questionLabel: "Are you comfortable with on-site/hybrid work or relocation?",
    answer: "Yes — I am currently based in Newark, CA (San Francisco Bay Area) for immediate Bay Area hybrid/on-site roles, and I am fully open to relocating anywhere in the US as well as remote roles.",
    tags: ["location"]
  }
];
