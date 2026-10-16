/**
 * Career Coach Chatbot — fully offline (no Gemini / OpenAI / external APIs).
 * Intent routing + curated playbooks + live progress from getCareerCoach().
 * Production-oriented: deterministic, safe, student-facing guidance only.
 */

import { CAREER_DOMAINS, DOMAIN_TOPICS, DOMAIN_FINAL_PROJECTS } from "./career-coach.js";

const DOMAIN_ALIASES = {
  ai_developer: ["ai developer", "ai", "ml engineer", "machine learning engineer", "deep learning", "pytorch", "tensorflow"],
  data_scientist: ["data scientist", "data science", "scientist", "modeling", "random forest", "statistics career"],
  data_analyst: ["data analyst", "analyst", "bi", "power bi", "tableau", "sql analyst", "dashboard"],
  cloud_developer: ["cloud", "cloud developer", "aws", "azure", "gcp", "devops light"],
  kubernetes: ["kubernetes", "k8s", "containers", "helm", "cluster"],
  cyber_security: ["cyber", "security", "cybersecurity", "hacking ethical", "web security", "owasp"],
};

const PLAYBOOKS = {
  greeting: [
    "I'm your Career Coach assistant — I run on this portal only (no external chat API).",
    "I can help with: DSA plan, which domain to pick, daily study routine, resume projects, interview prep, and what to do next on your roadmap.",
    "Ask something specific, for example: “what should I do next?”, “how do I finish DSA?”, “data science project ideas”, or “how to prepare for interviews”.",
  ].join("\n\n"),

  dsa_plan: `DSA plan (mandatory before domain projects)

Order on this portal:
1) Basics (arrays, strings, complexity)
2) Sorting & searching
3) Recursion
4) Linked lists & stacks/queues
5) Trees & graphs intro
6) Dynamic programming

How to study each topic (production habit):
• Learn the idea in 20–30 minutes (one clear article or lecture).
• Code 3–5 problems: 1 easy warm-up, 2 medium, 1 that forces you to rewrite.
• Write time/space complexity in one line under each solution.
• Revisit weak topics after 2–3 days (spaced practice).

Weekly target for a busy semester: 5–7 solid problems, not 50 half-done ones.
When every DSA checkbox on Career Coach is done, domain topics unlock.`,

  next_step: null, // filled dynamically

  domain_pick: `How to choose a domain

• Data Analyst — strongest if you like SQL, dashboards, business questions, Excel/Sheets.
• Data Scientist — stats, experiments, models, explaining metrics to non-technical people.
• AI Developer — Python + ML/DL demos, APIs, applied NLP/CV.
• Cloud Developer — deploy, services, logs, reliability.
• Kubernetes — containers, clusters, ops day-1 (after basic Docker comfort).
• Cyber Security — threat thinking, web flaws, defensive practices.

Pick one active domain on Career Coach. Finish DSA first, then every domain topic, then final projects. You can change domain later, but depth beats switching every week.`,

  interview: `Interview preparation (campus + product companies)

Round types you should practice:
1) DSA — 45–60 minutes, speak your approach before coding.
2) Core CS — OS, DBMS, Networks at “explain simply” level.
3) Domain — for Data/AI: metrics, leakage, train/test; for Cloud/K8s: deploy and failure cases; for Security: OWASP top risks.
4) Project deep-dive — architecture, your role, hardest bug, metrics, what you’d improve.

Daily 40-minute drill:
• 25 min one DSA problem out loud
• 15 min explain one project bullet as if to an interviewer

Never claim tools you cannot defend in follow-up questions.`,

  resume_project: `Resume and project writing

Each project bullet should answer:
• What problem? (1 line)
• What you built? (tools + your work)
• Result? (number, demo, or clear outcome)

Weak: “Worked on machine learning project.”
Strong: “Built a Random Forest early-warning model on attendance + UT marks (~200 students); ~78% holdout accuracy; Streamlit demo for teachers.”

On this portal, final projects are judged on tools + outcomes + clear write-up. Use “Get AI judgment” after DSA and all domain topics are complete.`,

  routine: `Sustainable routine (semester-friendly)

Mon–Fri (60–90 min):
• 30–40 min DSA or domain topic on Career Coach
• 20–30 min coding / notes
• 10 min: tick progress only if you can explain it tomorrow

Weekend (2–3 hours):
• One mini milestone (API, notebook, dashboard panel, write-up)
• Revise 3 old DSA problems

Avoid: binge tutorials with zero commits. Prefer small shipped pieces.`,

  placement_mindset: `Employability mindset

Recruiters look for: clarity, proof of work, and consistency.
• Clarity — you can explain your stack and decisions.
• Proof — GitHub/demo/metrics, not only certificates.
• Consistency — DSA + one domain depth over six shallow domains.

Use Placement profile for formal data the coordinator needs.
Use Career Coach for skill path.
Use Employability Intelligence for progress overview.

If academics are at risk, fix attendance/UT recovery in parallel — placement stories collapse if eligibility fails.`,

  fallback: `I can help with these themes (no internet model required):

• “What should I do next?” — uses your live Career Coach progress
• DSA plan / how to practice
• Choosing AI / Data Science / Analyst / Cloud / Kubernetes / Cyber
• Daily routine and semester plan
• Resume bullets and project write-ups
• Interview preparation

Try one of those phrases, or name a domain (e.g. “data science roadmap”).`,
};

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function detectDomain(text) {
  const t = norm(text);
  let best = null;
  let bestScore = 0;
  for (const [id, aliases] of Object.entries(DOMAIN_ALIASES)) {
    for (const a of aliases) {
      if (t.includes(a)) {
        const score = a.length;
        if (score > bestScore) {
          bestScore = score;
          best = id;
        }
      }
    }
  }
  return best;
}

function detectIntent(text) {
  const t = norm(text);
  if (!t || t.length < 2) return "greeting";
  if (/^(hi|hello|hey|namaste|help|start)\b/.test(t) || t === "menu") return "greeting";
  if (/what should i do|next step|where do i start|stuck|progress|what next/.test(t)) return "next_step";
  if (/\bdsa\b|data structure|leetcode|codeforces|arrays?|dynamic programming|\bdp\b|linked list/.test(t))
    return "dsa_plan";
  if (/which domain|choose domain|pick domain|career path|what (field|domain)/.test(t)) return "domain_pick";
  if (/interview|hr round|coding round|prepare for (job|placement|interview)/.test(t)) return "interview";
  if (/resume|cv\b|project idea|write-?up|github|portfolio|bullet/.test(t)) return "resume_project";
  if (/routine|timetable|schedule|daily|how many hours|study plan/.test(t)) return "routine";
  if (/placement|employable|job ready|recruiter|internship/.test(t)) return "placement_mindset";
  if (detectDomain(t)) return "domain_detail";
  if (/topic|roadmap|learn|how to/.test(t)) return "domain_detail";
  return "fallback";
}

function domainDetailReply(domainId) {
  const meta = CAREER_DOMAINS.find((d) => d.id === domainId);
  const topics = DOMAIN_TOPICS[domainId] || [];
  const projects = DOMAIN_FINAL_PROJECTS[domainId] || [];
  const title = meta?.title || domainId;
  const lines = [
    `Domain: ${title}`,
    meta?.summary || "",
    "",
    "Topic path (tick in order on Career Coach after DSA):",
    ...topics.slice(0, 12).map((t, i) => `${i + 1}. ${t.title} — ${t.description}`),
  ];
  if (topics.length > 12) lines.push(`… and ${topics.length - 12} more on the page.`);
  lines.push("", "Final projects (unlocked after all topics):");
  for (const p of projects) {
    lines.push(`• ${p.title}: ${p.description}`);
  }
  lines.push(
    "",
    "Coach tip: finish DSA checkboxes first. Then one topic at a time with a small artifact (notebook, query file, or deploy note). Use Get AI judgment only when the write-up names tools and a result."
  );
  return lines.filter(Boolean).join("\n");
}

function nextStepReply(progress) {
  if (!progress) {
    return "I could not load your progress. Open Career Coach on this account, then ask “what should I do next?” again.";
  }
  const { dsaComplete, dsa, selectedDomainId, roadmap, domains } = progress;
  const dsaDone = dsa?.doneCount ?? dsa?.topics?.filter((t) => t.done).length ?? 0;
  const dsaTotal = dsa?.totalCount ?? dsa?.topics?.length ?? 0;

  if (!dsaComplete) {
    const next = dsa?.topics?.find((t) => t.unlocked && !t.done) || dsa?.topics?.find((t) => !t.done);
    return [
      "Priority right now: mandatory DSA (required for every domain).",
      dsaTotal ? `Progress: ${dsaDone}/${dsaTotal} DSA topics done.` : "",
      next
        ? `Next DSA topic: “${next.title || next.id}”. Unlock is sequential — finish this before later stages.`
        : "Open the DSA list on Career Coach and tick the first unlocked topic after you can explain and code it.",
      "",
      "Practice rule: 3 problems minimum on this topic, write complexity, then tick it.",
      "Do not start final projects until DSA and all domain topics are complete.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (!selectedDomainId) {
    const titles = (domains || []).map((d) => d.title).join(", ");
    return [
      "DSA is complete — good.",
      "Next: select one career domain on Career Coach.",
      titles ? `Available: ${titles}.` : "",
      "If unsure: Data Analyst (SQL/dashboards), Data Scientist (models/stats), AI Developer (ML demos). Ask “how to choose a domain” for a fuller comparison.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (roadmap && !roadmap.topicsComplete) {
    const next = roadmap.nextTopic;
    return [
      `Domain selected: ${roadmap.title}.`,
      `Topics: ${roadmap.topicsDone}/${roadmap.topicsTotal} (${roadmap.topicsPercent || 0}%).`,
      next
        ? `Next topic: “${next.title}” — ${next.description || "complete it carefully, then tick."}`
        : "Continue the next unlocked domain topic on the page.",
      "",
      "Ship a small artifact for the topic (notes + code). Tick only when you can teach it in 3 minutes.",
    ].join("\n");
  }

  if (roadmap && roadmap.topicsComplete && !roadmap.projectsUnlocked) {
    return "Domain topics look complete, but projects are still locked. Confirm DSA is fully complete and every domain topic is ticked, then refresh Career Coach.";
  }

  if (roadmap?.projectsUnlocked) {
    const nextP = roadmap.nextProject;
    const solid = (roadmap.projects || []).filter((p) => p.projectStatus === "solid" || p.done).length;
    const total = (roadmap.projects || []).length;
    return [
      `You are in final projects for ${roadmap.title}.`,
      `Projects solid/done: ${solid}/${total}.`,
      nextP
        ? `Focus project: “${nextP.title}”. Write tools used, steps, and a measurable or demo outcome, then use Get AI judgment.`
        : "All projects look solid or done — polish GitHub/README and practice explaining them in interviews.",
      "",
      "Strong write-up pattern: problem → tools → what you did → result/metric → optional DSA link.",
    ].join("\n");
  }

  return "Open Career Coach and select a domain to get a precise next step. You can also ask about DSA, interviews, or resume bullets.";
}

function suggestionsFor(intent, progress) {
  const base = ["What should I do next?", "DSA study plan", "How to choose a domain", "Interview prep"];
  if (!progress?.dsaComplete) return ["What should I do next?", "DSA study plan", "Daily routine", "How to choose a domain"];
  if (!progress?.selectedDomainId) return ["How to choose a domain", "Data Science roadmap", "Data Analyst roadmap", "What should I do next?"];
  if (progress?.roadmap && !progress.roadmap.topicsComplete) {
    return ["What should I do next?", "Daily routine", "Resume project bullets", "Interview prep"];
  }
  return ["What should I do next?", "Resume project bullets", "Interview prep", "Placement mindset"];
}

/**
 * @param {object} opts
 * @param {string} opts.message
 * @param {object|null} opts.progress - getCareerCoach() payload
 * @param {string[]} [opts.history] - optional prior user messages (unused for state, reserved)
 */
export function runCareerCoachChat({ message, progress = null }) {
  const intent = detectIntent(message);
  let reply;
  let domainId = detectDomain(message);

  if (intent === "greeting") reply = PLAYBOOKS.greeting;
  else if (intent === "dsa_plan") reply = PLAYBOOKS.dsa_plan;
  else if (intent === "domain_pick") reply = PLAYBOOKS.domain_pick;
  else if (intent === "interview") reply = PLAYBOOKS.interview;
  else if (intent === "resume_project") reply = PLAYBOOKS.resume_project;
  else if (intent === "routine") reply = PLAYBOOKS.routine;
  else if (intent === "placement_mindset") reply = PLAYBOOKS.placement_mindset;
  else if (intent === "next_step") reply = nextStepReply(progress);
  else if (intent === "domain_detail") {
    if (!domainId && progress?.selectedDomainId) domainId = progress.selectedDomainId;
    reply = domainId ? domainDetailReply(domainId) : PLAYBOOKS.domain_pick;
  } else reply = PLAYBOOKS.fallback;

  // Light personalization footer when we have progress
  let footer = "";
  if (progress) {
    const bits = [];
    if (progress.dsaComplete) bits.push("DSA: complete");
    else bits.push("DSA: in progress");
    if (progress.selectedDomainId) {
      const t = CAREER_DOMAINS.find((d) => d.id === progress.selectedDomainId)?.title || progress.selectedDomainId;
      bits.push(`Domain: ${t}`);
      if (progress.roadmap) bits.push(`Topics ${progress.roadmap.topicsDone}/${progress.roadmap.topicsTotal}`);
    } else bits.push("Domain: not selected");
    footer = `\n\n— Your status: ${bits.join(" · ")}`;
  }

  return {
    ok: true,
    source: "offline_coach",
    intent,
    reply: reply + footer,
    suggestions: suggestionsFor(intent, progress),
    domainId: domainId || progress?.selectedDomainId || null,
  };
}
