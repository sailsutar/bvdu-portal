/**
 * Map academic subject marks → core placement topics (DSA, programming, DBMS, AI/ML, …).
 * Uses real UT/average marks from HOD Excel, not only self-ratings.
 */

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Score for one subject entry on 0–100 scale when possible */
export function subjectScore100(m) {
  if (!m || typeof m !== "object") return null;
  if (m.percentage != null && Number.isFinite(Number(m.percentage))) return Number(m.percentage);
  if (m.average != null && Number.isFinite(Number(m.average))) {
    const a = Number(m.average);
    // UT averages often on /20
    if (a <= 20) return (a / 20) * 100;
    if (a <= 100) return a;
  }
  const assessments = m.assessments || {};
  const vals = Object.values(assessments)
    .map((v) => {
      if (v == null || v === "") return null;
      if (typeof v === "object") return num(v.score ?? v.marks ?? v.value);
      return num(v);
    })
    .filter((x) => x != null);
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (mean <= 20) return (mean / 20) * 100;
  if (mean <= 100) return mean;
  return null;
}

/**
 * Keyword rules: subject title → topic bucket(s).
 * A subject can map to multiple topics (e.g. "Machine Learning" → aiml).
 */
const TOPIC_RULES = [
  {
    topic: "dsa",
    label: "DSA / Algorithms",
    re: /\b(dsa|data\s*structures?|algorithms?|analysis\s+of\s+algorithms?|design\s+and\s+analysis)\b/i,
  },
  {
    topic: "programming",
    label: "Programming (C / C++ / Java / Python)",
    re: /\b(c\+\+|cpp|java|python|programming|oop|object\s*oriented|data\s*structures\s*using|problem\s*solving)\b|\b(^|\s)c(\s|$)/i,
  },
  {
    topic: "dbms",
    label: "DBMS / Databases",
    re: /\b(dbms|database|sql|data\s*management|rdbms|nosql)\b/i,
  },
  {
    topic: "aiml",
    label: "AI / ML / DL / Data Science",
    re: /\b(artificial\s*intelligence|\bai\b|machine\s*learning|\bml\b|deep\s*learning|\bdl\b|neural|data\s*science|data\s*mining|nlp|natural\s*language|computer\s*vision)\b/i,
  },
  {
    topic: "os_networks",
    label: "OS / Networks",
    re: /\b(operating\s*system|\bos\b|computer\s*networks?|\bcn\b|distributed|cloud\s*computing)\b/i,
  },
  {
    topic: "web",
    label: "Web / Full stack",
    re: /\b(web|full\s*stack|frontend|backend|react|node|javascript|mean|mern)\b/i,
  },
  {
    topic: "security",
    label: "Security / Cyber",
    re: /\b(security|cryptography|cyber|ethical\s*hacking|network\s*security)\b/i,
  },
];

export function topicsForSubjectName(name) {
  const s = String(name || "");
  const hits = [];
  for (const rule of TOPIC_RULES) {
    if (rule.re.test(s)) hits.push(rule.topic);
  }
  return hits;
}

/**
 * @param {Array} marks - AcademicRecord.marks
 * @returns {{ topics: object, subjectBreakdown: Array, coverage: number }}
 */
export function computeTopicStrengthsFromMarks(marks) {
  const lists = {};
  for (const rule of TOPIC_RULES) lists[rule.topic] = [];

  const subjectBreakdown = [];
  for (const m of marks || []) {
    const subject = m.subject || m.name || "";
    const score = subjectScore100(m);
    if (score == null) continue;
    const topics = topicsForSubjectName(subject);
    subjectBreakdown.push({
      subject,
      score: Math.round(score * 10) / 10,
      topics,
    });
    for (const t of topics) {
      if (lists[t]) lists[t].push(score);
    }
  }

  const topics = {};
  for (const rule of TOPIC_RULES) {
    const arr = lists[rule.topic];
    if (!arr.length) {
      topics[rule.topic] = {
        label: rule.label,
        score100: null,
        level1to5: null,
        subjectsUsed: 0,
        companyBasic: rule.topic === "dsa" || rule.topic === "programming" || rule.topic === "dbms" || rule.topic === "aiml",
      };
      continue;
    }
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    // Map 0–100 → 1–5 for comparison with self-ratings
    const level1to5 = Math.max(1, Math.min(5, Math.round((mean / 100) * 5)));
    topics[rule.topic] = {
      label: rule.label,
      score100: Math.round(mean * 10) / 10,
      level1to5,
      subjectsUsed: arr.length,
      companyBasic: rule.topic === "dsa" || rule.topic === "programming" || rule.topic === "dbms" || rule.topic === "aiml",
    };
  }

  const covered = Object.values(topics).filter((t) => t.score100 != null).length;
  return {
    topics,
    subjectBreakdown: subjectBreakdown.sort((a, b) => b.score - a.score).slice(0, 40),
    coverage: covered,
    basicTopicAvg: (() => {
      const basics = ["dsa", "programming", "dbms", "aiml"]
        .map((k) => topics[k]?.score100)
        .filter((x) => x != null);
      if (!basics.length) return null;
      return Math.round((basics.reduce((a, b) => a + b, 0) / basics.length) * 10) / 10;
    })(),
  };
}

export function topicGaps(topicResult, selfRatings = {}) {
  const gaps = [];
  const t = topicResult?.topics || {};
  const check = [
    ["dsa", "skillDsa", "DSA"],
    ["programming", "skillCpp", "Programming"],
    ["dbms", "skillDbms", "DBMS"],
    ["aiml", "skillAiml", "AI/ML"],
  ];
  for (const [topic, selfKey, label] of check) {
    const markLevel = t[topic]?.level1to5;
    const self = selfRatings[selfKey] != null ? Number(selfRatings[selfKey]) : null;
    if (markLevel != null && markLevel <= 2) {
      gaps.push(`${label} subject marks are weak (≈ level ${markLevel}/5 from Excel)`);
    }
    if (markLevel != null && self != null && self >= 4 && markLevel <= 2) {
      gaps.push(`${label}: self-rating high but subject marks low — review`);
    }
  }
  if (topicResult?.basicTopicAvg != null && topicResult.basicTopicAvg < 50) {
    gaps.push(`Average on company-basic topics (DSA/Prog/DBMS/AI) is ${topicResult.basicTopicAvg}%`);
  }
  return gaps;
}

/**
 * Suggest career / job domains from marks topics + self skills + internships.
 * Rule+score ensemble (explainable) — not a black box.
 */
export function suggestDomains(profile) {
  const topics = profile.topicStrengths || {};
  const score = (key) => {
    const t = topics[key];
    if (t?.score100 != null) return Number(t.score100);
    return null;
  };
  const self = {
    dsa: num(profile.skillDsa),
    c: num(profile.skillC),
    cpp: num(profile.skillCpp),
    dbms: num(profile.skillDbms),
    aiml: num(profile.skillAiml),
  };
  const blend = (mark100, self1to5, markW = 0.65) => {
    const parts = [];
    if (mark100 != null) parts.push({ v: mark100, w: markW });
    if (self1to5 != null) parts.push({ v: (self1to5 / 5) * 100, w: 1 - markW });
    if (!parts.length) return null;
    const ws = parts.reduce((a, p) => a + p.w, 0);
    return parts.reduce((a, p) => a + p.v * (p.w / ws), 0);
  };

  const dsa = blend(score("dsa"), self.dsa);
  const prog = blend(score("programming"), self.cpp != null ? self.cpp : self.c);
  const dbms = blend(score("dbms"), self.dbms);
  const aiml = blend(score("aiml"), self.aiml);
  const web = score("web");
  const sec = score("security");
  const osn = score("os_networks");

  const tags = String(profile.skillTags || "").toLowerCase();
  const intern = String(profile.internships || "").toLowerCase();
  const hasIntern = Number(profile.internshipCount) > 0 || intern.length > 3;
  const startSem = num(profile.internshipStartSem);
  const earlyIntern =
    hasIntern &&
    (startSem === 2 ||
      startSem === 3 ||
      /\b(2nd|second)\s*sem/i.test(intern) ||
      String(profile.yearLevel || "").toUpperCase() === "SY");

  const candidates = [];

  const push = (domain, fit, reasons) => {
    if (fit == null || fit < 35) return;
    candidates.push({
      domain,
      fitScore: Math.round(Math.min(100, fit)),
      reasons: reasons.filter(Boolean).slice(0, 4),
    });
  };

  // AI / ML / Data
  {
    let fit = aiml != null ? aiml : 0;
    const reasons = [];
    if (aiml != null) reasons.push(`AI/ML topic strength ${Math.round(aiml)}%`);
    if (dsa != null && dsa >= 55) {
      fit += 8;
      reasons.push("Solid DSA supports ML interviews");
    }
    if (/ml|ai|data|python|tensorflow|pytorch/.test(tags + intern)) {
      fit += 10;
      reasons.push("Skills/internship mention AI or data");
    }
    push("AI / Machine Learning / Data Science", fit, reasons);
  }

  // Backend / Server
  {
    let fit = 0;
    const reasons = [];
    if (dbms != null) {
      fit += dbms * 0.45;
      reasons.push(`DBMS ${Math.round(dbms)}%`);
    }
    if (prog != null) {
      fit += prog * 0.4;
      reasons.push(`Programming ${Math.round(prog)}%`);
    }
    if (osn != null) {
      fit += osn * 0.15;
      reasons.push(`OS/Networks ${Math.round(osn)}%`);
    }
    if (/node|backend|api|spring|django|sql/.test(tags + intern)) {
      fit += 10;
      reasons.push("Backend-related tags/internship");
    }
    push("Backend / API / Server-side", fit, reasons);
  }

  // Full stack / Web
  {
    let fit = web != null ? web : prog != null ? prog * 0.5 : 0;
    const reasons = [];
    if (web != null) reasons.push(`Web subjects ${Math.round(web)}%`);
    if (prog != null) {
      fit = Math.max(fit, prog * 0.55 + (dbms || 40) * 0.25);
      reasons.push("Programming + DB foundation");
    }
    if (/react|javascript|full.?stack|frontend|web/.test(tags + intern)) {
      fit += 12;
      reasons.push("Web stack in skills/internship");
    }
    push("Full Stack / Web Development", fit, reasons);
  }

  // Software product / SDE
  {
    let fit = 0;
    const reasons = [];
    if (dsa != null) {
      fit += dsa * 0.5;
      reasons.push(`DSA ${Math.round(dsa)}%`);
    }
    if (prog != null) {
      fit += prog * 0.35;
      reasons.push(`Programming ${Math.round(prog)}%`);
    }
    if (dbms != null) fit += dbms * 0.15;
    if (hasIntern) {
      fit += earlyIntern ? 12 : 6;
      reasons.push(
        earlyIntern
          ? "Early internship (from ~2nd semester) — strong profile signal"
          : "Internship experience"
      );
    }
    push("Software Development (SDE / Product)", fit, reasons);
  }

  // Cloud / DevOps-ish
  {
    let fit = osn != null ? osn * 0.7 : 0;
    const reasons = [];
    if (osn != null) reasons.push(`OS/Cloud/Networks ${Math.round(osn)}%`);
    if (/cloud|aws|azure|devops|docker|kubernetes/.test(tags + intern)) {
      fit += 15;
      reasons.push("Cloud/DevOps keywords");
    }
    if (prog != null && prog >= 50) fit += 8;
    push("Cloud / DevOps / SRE track", fit, reasons);
  }

  // Cybersecurity
  {
    let fit = sec != null ? sec : 0;
    const reasons = [];
    if (sec != null) reasons.push(`Security subjects ${Math.round(sec)}%`);
    if (/security|cyber|crypto/.test(tags + intern)) {
      fit += 12;
      reasons.push("Security interest/experience");
    }
    if (osn != null) fit += osn * 0.2;
    push("Cybersecurity", fit, reasons);
  }

  // QA / Support (fallback if academics moderate)
  {
    const cgpa = num(profile.cgpa);
    const att = num(profile.attendance);
    let fit = 40;
    const reasons = ["Stable process-oriented roles if core coding topics are still building"];
    if (cgpa != null && cgpa >= 6.5) fit += 10;
    if (att != null && att >= 80) fit += 8;
    if ((dsa == null || dsa < 50) && (prog == null || prog < 50)) fit += 5;
    push("QA / Testing / Support Engineer", fit, reasons);
  }

  candidates.sort((a, b) => b.fitScore - a.fitScore);
  const top = candidates.slice(0, 4);
  const primary = top[0] || {
    domain: "General software — strengthen DSA and one stack",
    fitScore: 40,
    reasons: ["Not enough subject marks mapped yet; complete profile and ensure marks Excel is uploaded"],
  };

  return {
    primaryDomain: primary.domain,
    primaryFit: primary.fitScore,
    suggestedDomains: top,
    summary: top.map((c) => `${c.domain} (${c.fitScore})`).join(" · "),
  };
}
