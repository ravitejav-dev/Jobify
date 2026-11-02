// Live Curated Daily Job Feeds & Personalized Recommendation Engine + Network Copilot Referral Builder
import { evaluateJobMatch } from "./ats_analyzer.js";

export const CURATED_BOARDS = [
  { company: "Anthropic", ats: "greenhouse", slug: "anthropic", category: "Frontier AI Labs" },
  { company: "OpenAI", ats: "ashby", slug: "openai", category: "Frontier AI Labs" },
  { company: "xAI", ats: "greenhouse", slug: "xai", category: "Frontier AI Labs" },
  { company: "Perplexity", ats: "ashby", slug: "perplexity", category: "Frontier AI Labs" },
  { company: "Cohere", ats: "ashby", slug: "cohere", category: "Frontier AI Labs" },
  { company: "Scale AI", ats: "greenhouse", slug: "scaleai", category: "AI & Eval Infrastructure" },
  { company: "Together AI", ats: "greenhouse", slug: "togetherai", category: "AI & Eval Infrastructure" },
  { company: "Harvey", ats: "ashby", slug: "harvey", category: "AI & Data Unicorns" },
  { company: "Databricks", ats: "greenhouse", slug: "databricks", category: "AI & Data Unicorns" },
  { company: "Stripe", ats: "greenhouse", slug: "stripe", category: "Cloud & FinTech" },
  { company: "Figma", ats: "greenhouse", slug: "figma", category: "Cloud & FinTech" }
];

const ENG_TITLE_RE =
  /(engineer|developer|architect|scientist|researcher|member of technical staff|\bmts\b|\bswe\b|\bsde\b|technical lead)/i;

const NON_ENG_EXCLUDE_RE =
  /(account executive|sales|business development|\bbdr\b|\bsdr\b|recruiter|recruiting|talent acquisition|marketing|communications|public relations|legal|counsel|paralegal|finance|accounting|tax|payroll|executive assistant|workplace|facilities|people partner|human resources|customer success manager)/i;

const US_OR_REMOTE_RE =
  /(united states|\bus\b|california|san francisco|bay area|sunnyvale|mountain view|santa clara|palo alto|san jose|menlo park|seattle|new york|nyc|remote|austin|boston)/i;

async function fetchSingleBoard(board) {
  try {
    if (board.ats === "greenhouse") {
      const resp = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs?content=false`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.jobs || []).map((j) => ({
        id: `gh_${board.slug}_${j.id}`,
        company: board.company,
        category: board.category,
        ats: "Greenhouse",
        title: j.title || "",
        location: j.location?.name || "United States",
        url: j.absolute_url || `https://boards.greenhouse.io/${board.slug}/jobs/${j.id}`,
        updatedAt: j.updated_at || new Date().toISOString()
      }));
    }
    if (board.ats === "ashby") {
      const resp = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${board.slug}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.jobs || []).map((j) => ({
        id: `ash_${board.slug}_${j.id}`,
        company: board.company,
        category: board.category,
        ats: "Ashby",
        title: j.title || "",
        location: j.location || (j.isRemote ? "Remote (US)" : "United States"),
        url: j.jobUrl || `https://jobs.ashbyhq.com/${board.slug}/${j.id}`,
        updatedAt: j.publishedAt || new Date().toISOString()
      }));
    }
  } catch (_) {
    return [];
  }
  return [];
}

export async function fetchPersonalizedRecommendations(profile, { category = "All", query = "", limit = 80 } = {}) {
  const boards = category === "All"
    ? CURATED_BOARDS
    : CURATED_BOARDS.filter((b) => b.category === category);

  const nested = await Promise.all(boards.map(fetchSingleBoard));
  const allJobs = nested.flat();

  const filtered = allJobs.filter((j) => {
    if (!ENG_TITLE_RE.test(j.title)) return false;
    if (NON_ENG_EXCLUDE_RE.test(j.title)) return false;
    if (j.location && !US_OR_REMOTE_RE.test(j.location)) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!`${j.company} ${j.title} ${j.location} ${j.category}`.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const scored = filtered.map((j) => {
    const evalRes = evaluateJobMatch(
      { title: j.title, location: j.location, description: `${j.title} ${j.company} ${j.location}` },
      profile
    );
    // Boost high-affinity AI/Platform/Eval titles for Ravi
    let affinityBoost = 0;
    if (/ai|llm|agent|eval|genai|machine learning|safety/i.test(j.title)) affinityBoost += 14;
    if (/platform|solutions|infrastructure|full[- ]?stack/i.test(j.title)) affinityBoost += 8;
    if (/san francisco|bay area|santa clara|mountain view|sunnyvale|palo alto|remote/i.test(j.location)) {
      affinityBoost += 6;
    }
    const finalScore = Math.min(99, evalRes.matchScore + affinityBoost);
    return {
      ...j,
      matchScore: finalScore
    };
  });

  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored.slice(0, limit);
}

export function buildNetworkCopilotPathways(company, role = "AI Engineer") {
  const compClean = (company || "Company").trim();
  const encComp = encodeURIComponent(`"${compClean}"`);
  const encRole = encodeURIComponent(role);

  return [
    {
      label: `Clark University Alumni at ${compClean}`,
      badge: "Warmest Alumni Path",
      description: "Find fellow Clark University M.S./CS grads working at this company.",
      url: `https://www.linkedin.com/search/results/people/?keywords=${encComp}%20%22Clark%20University%22`
    },
    {
      label: `Ex-GlobalLogic / Google AI Peers at ${compClean}`,
      badge: "Shared Work Overlap",
      description: "Engineers with shared Google / GlobalLogic background now at target company.",
      url: `https://www.linkedin.com/search/results/people/?keywords=${encComp}%20(%22GlobalLogic%22%20OR%20%22Google%22)%20AI`
    },
    {
      label: `AI / Platform Engineering Managers at ${compClean}`,
      badge: "Hiring Manager Direct",
      description: "Engineering Managers & Leads on AI, LLM, and Platform teams.",
      url: `https://www.linkedin.com/search/results/people/?keywords=${encComp}%20%22Engineering%20Manager%22%20(AI%20OR%20Platform%20OR%20Machine%20Learning)`
    },
    {
      label: `Technical Recruiters at ${compClean}`,
      badge: "Recruiter Fast-Track",
      description: "Technical & AI/ML Recruiters hiring for engineering roles.",
      url: `https://www.linkedin.com/search/results/people/?keywords=${encComp}%20%22Technical%20Recruiter%22`
    },
    {
      label: `Team Engineers (${role})`,
      badge: "Peer Referral",
      description: "Individual contributors in similar roles who receive referral bonuses.",
      url: `https://www.linkedin.com/search/results/people/?keywords=${encComp}%20${encRole}`
    }
  ];
}
