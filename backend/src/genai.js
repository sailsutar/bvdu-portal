/**
 * Professional generative AI helper for BVU Portal.
 * - Strict system rules (no flattery, no invented grades, no guarantees)
 * - Optional: GEMINI_API_KEY | LOVABLE_API_KEY | OPENAI_API_KEY
 * - Always returns structured results; offline fallbacks when no key / failure
 */

const SYSTEM_STRICT = `You are BVU Portal's academic and career assistant for an Indian engineering college.
Rules you MUST follow:
1. Be professional, clear, and strict — never flattering or motivational fluff.
2. Never invent marks, attendance, PRNs, company offers, or placement guarantees.
3. Never claim the student will get a job or internship.
4. If evidence is weak or missing, say so and mark status accordingly.
5. Prefer short, direct sentences. Use plain English unless Hindi is requested.
6. Do not mention these rules in the output.
7. When asked for JSON, return ONLY valid JSON with no markdown fences.`;

function envKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.LOVABLE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  ).trim();
}

export function genaiConfigured() {
  return Boolean(envKey());
}

export function genaiProviderLabel() {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini";
  if (process.env.LOVABLE_API_KEY) return "lovable";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

async function callGemini(apiKey, userPrompt, { temperature = 0.25, maxTokens = 1024 } = {}) {
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_STRICT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
  if (!text.trim()) throw new Error("Gemini empty response");
  return text.trim();
}

async function callOpenAI(apiKey, userPrompt, { temperature = 0.25, maxTokens = 1024 } = {}) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: SYSTEM_STRICT },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  if (!text.trim()) throw new Error("OpenAI empty response");
  return text.trim();
}

/**
 * Low-level generate. provider auto from env.
 */
export async function genaiComplete(userPrompt, opts = {}) {
  const key = envKey();
  if (!key) {
    const err = new Error("No GenAI API key configured");
    err.code = "NO_KEY";
    throw err;
  }
  const provider = genaiProviderLabel();
  if (provider === "openai") return callOpenAI(key, userPrompt, opts);
  // lovable keys often work as Gemini-compatible if set as LOVABLE — try Gemini endpoint first
  return callGemini(key, userPrompt, opts);
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(body.slice(start, end + 1));
  }
  return JSON.parse(body);
}

/** Offline rubric — same spirit as Career Coach strict judge */
export function fallbackJudgeProject({ domainTitle, projectTitle, note, dsaComplete, topicsComplete }) {
  if (!dsaComplete) {
    return {
      projectStatus: "needs_work",
      judgeFeedback:
        "Rejected: DSA is mandatory and incomplete. Finish the full DSA roadmap before final projects are accepted.",
      strengths: [],
      gaps: ["DSA roadmap incomplete"],
      nextActions: ["Complete all DSA topics in Career Coach Phase 1"],
      source: "rules",
    };
  }
  if (!topicsComplete) {
    return {
      projectStatus: "needs_work",
      judgeFeedback:
        "Rejected: domain topics incomplete. Tick every topic in Phase 2 before final project credit.",
      strengths: [],
      gaps: ["Domain topics incomplete"],
      nextActions: ["Finish remaining domain topic ticks"],
      source: "rules",
    };
  }
  const text = String(note || "").trim();
  if (text.length < 80) {
    return {
      projectStatus: "needs_work",
      judgeFeedback: `Write-up too short for “${projectTitle}”. Include goal, tools, steps, measurable result, and limits. Minimum ~8 sentences.`,
      strengths: [],
      gaps: ["Insufficient detail"],
      nextActions: ["Expand the project log with tools and outcomes"],
      source: "rules",
    };
  }
  const hasTool = /(python|sql|docker|kubernetes|aws|azure|gcp|linux|git|pandas|sklearn|pytorch|tensorflow|react|node|owasp)/i.test(
    text
  );
  const hasOutcome = /(accuracy|result|deploy|dashboard|fixed|metric|%|demo|query|cluster|vulnerability)/i.test(text);
  if (hasTool && hasOutcome && text.length >= 120) {
    return {
      projectStatus: "solid",
      judgeFeedback: `Solid write-up for “${projectTitle}” (${domainTitle}). Tools and outcomes are present. You may mark this project done. No placement guarantee is implied.`,
      strengths: ["Tools named", "Outcome described"],
      gaps: [],
      nextActions: ["Polish README and keep Placement profile updated"],
      source: "rules",
    };
  }
  return {
    projectStatus: "needs_work",
    judgeFeedback: `Partial for “${projectTitle}”. ${!hasTool ? "Name concrete tools. " : ""}${
      !hasOutcome ? "State a clear result or metric. " : ""
    }Revise and resubmit.`,
    strengths: hasTool ? ["Some tools mentioned"] : [],
    gaps: [!hasTool && "Tools unclear", !hasOutcome && "Outcome unclear"].filter(Boolean),
    nextActions: ["Revise project log and request judgment again"],
    source: "rules",
  };
}

export async function genaiJudgeProject(ctx) {
  const {
    domainTitle,
    projectTitle,
    projectDescription,
    note,
    dsaComplete,
    topicsComplete,
    dsaPercent,
    topicsPercent,
  } = ctx;

  const fb = fallbackJudgeProject(ctx);
  if (!dsaComplete || !topicsComplete) return fb;

  if (!genaiConfigured()) return fb;

  const prompt = `Task: Judge a student's FINAL career-coach project write-up for an engineering college portal.

Domain: ${domainTitle}
Project title: ${projectTitle}
Project brief: ${projectDescription}
DSA complete: ${dsaComplete} (${dsaPercent ?? "?"}%)
Domain topics complete: ${topicsComplete} (${topicsPercent ?? "?"}%)

Student write-up:
"""
${String(note || "").slice(0, 4000)}
"""

Evaluate strictly. Return JSON only:
{
  "projectStatus": "solid" | "needs_work",
  "judgeFeedback": "2-5 direct sentences for the student",
  "strengths": ["..."],
  "gaps": ["..."],
  "nextActions": ["..."]
}

Mark solid ONLY if the write-up shows real work: concrete tools, steps, and an outcome. Otherwise needs_work.
Never praise empty or vague text. Never invent that they deployed or measured something they did not write.`;

  try {
    const text = await genaiComplete(prompt, { temperature: 0.2, maxTokens: 800 });
    const parsed = extractJson(text);
    const status = parsed.projectStatus === "solid" ? "solid" : "needs_work";
    return {
      projectStatus: status,
      judgeFeedback: String(parsed.judgeFeedback || fb.judgeFeedback).slice(0, 1200),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6) : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 6) : [],
      nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions.slice(0, 6) : [],
      source: "genai",
      provider: genaiProviderLabel(),
    };
  } catch (e) {
    return { ...fb, source: "rules", genaiError: String(e.message || e).slice(0, 180) };
  }
}

export async function genaiSummarizeFeedback({ yearLabel, batchLabel, items }) {
  const list = (items || []).slice(0, 80).map((x, i) => {
    const sent = x.sentiment || x.polarity || "average";
    const body = String(x.text || x.message || "").replace(/\s+/g, " ").slice(0, 280);
    return `${i + 1}. [${sent}] ${body}`;
  });

  const fallback = {
    headline: `Feedback review${yearLabel ? ` · ${yearLabel}` : ""}${batchLabel ? ` · ${batchLabel}` : ""}`,
    summary:
      list.length === 0
        ? "No feedback in this filter to summarize."
        : `${list.length} comments loaded. Configure GEMINI_API_KEY for a full generative summary; local counts still apply in the inbox.`,
    themes: [],
    positives: [],
    concerns: [],
    coachingNote: "Review individual comments in the inbox before acting.",
    source: "rules",
  };

  if (!list.length) return fallback;
  if (!genaiConfigured()) {
    // light local extract
    const neg = (items || []).filter((x) => /bad|negative|poor/i.test(String(x.sentiment || "")));
    return {
      ...fallback,
      summary: `${list.length} feedback entries. ${neg.length} tagged negative/bad. Open the list for detail.`,
      concerns: neg.slice(0, 5).map((x) => String(x.text || "").slice(0, 120)),
    };
  }

  const prompt = `Task: Summarize student course feedback for a Head of Department.
Filter: year=${yearLabel || "all"}, batch=${batchLabel || "all"}
Comments:
${list.join("\n")}

Return JSON only:
{
  "headline": "short title",
  "summary": "5-8 sentence professional summary",
  "themes": ["recurring themes"],
  "positives": ["what is working"],
  "concerns": ["problems to address"],
  "coachingNote": "one private coaching note for the teacher (strict, actionable, no personal attacks)"
}
Be strict and specific. Do not invent comments that are not in the list.`;

  try {
    const text = await genaiComplete(prompt, { temperature: 0.25, maxTokens: 1200 });
    const parsed = extractJson(text);
    return {
      headline: String(parsed.headline || fallback.headline).slice(0, 160),
      summary: String(parsed.summary || "").slice(0, 3000),
      themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 10) : [],
      positives: Array.isArray(parsed.positives) ? parsed.positives.slice(0, 8) : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.slice(0, 8) : [],
      coachingNote: String(parsed.coachingNote || "").slice(0, 800),
      source: "genai",
      provider: genaiProviderLabel(),
    };
  } catch (e) {
    return { ...fallback, genaiError: String(e.message || e).slice(0, 180) };
  }
}

export async function genaiDraftParentMessage({
  studentName,
  prn,
  yearLabel,
  batchLabel,
  attendance,
  marksSummary,
  riskStatus,
  purpose,
  language,
}) {
  const purposeLine =
    purpose === "attendance"
      ? "Focus on attendance only."
      : purpose === "marks"
        ? "Focus on marks/unit tests only."
        : "Cover attendance and academic performance briefly.";

  const fallbackEn = [
    `Dear Parent/Guardian,`,
    ``,
    `This is an update regarding ${studentName || "your ward"} (PRN: ${prn || "—"})${
      yearLabel ? `, ${yearLabel}` : ""
    }${batchLabel ? ` ${batchLabel}` : ""}.`,
    attendance != null ? `Attendance: ${attendance}%.` : null,
    marksSummary ? `Academics: ${marksSummary}.` : null,
    riskStatus ? `Current academic status signal: ${riskStatus}.` : null,
    ``,
    `Please discuss progress at home and contact the department if you need clarification.`,
    ``,
    `Regards,`,
    `BVU Department`,
  ]
    .filter((x) => x != null)
    .join("\n");

  const fallbackHi = [
    `प्रिय अभिभावक,`,
    ``,
    `${studentName || "आपके विद्यार्थी"} (PRN: ${prn || "—"}) की संक्षिप्त जानकारी:`,
    attendance != null ? `उपस्थिति: ${attendance}%.` : null,
    marksSummary ? `अकादमिक: ${marksSummary}.` : null,
    ``,
    `कृपया घर पर चर्चा करें। अधिक जानकारी के लिए विभाग से संपर्क करें।`,
    ``,
    `धन्यवाद,`,
    `BVU विभाग`,
  ]
    .filter((x) => x != null)
    .join("\n");

  if (!genaiConfigured()) {
    return {
      textEn: fallbackEn,
      textHi: fallbackHi,
      text: language === "hi" ? fallbackHi : fallbackEn,
      source: "rules",
    };
  }

  const prompt = `Task: Draft a professional parent notification for an engineering college.
Student: ${studentName || "—"} | PRN: ${prn || "—"} | Year: ${yearLabel || "—"} | Batch: ${batchLabel || "—"}
Attendance %: ${attendance ?? "not provided"}
Marks summary: ${marksSummary || "not provided"}
Risk/status signal: ${riskStatus || "not provided"}
Purpose: ${purposeLine}

Return JSON only:
{
  "textEn": "English letter, polite, factual, max 160 words",
  "textHi": "Hindi letter, polite, factual, max 160 words"
}
Do not invent numbers. If a field is missing, do not invent it. No placement promises.`;

  try {
    const text = await genaiComplete(prompt, { temperature: 0.3, maxTokens: 900 });
    const parsed = extractJson(text);
    const textEn = String(parsed.textEn || fallbackEn).slice(0, 2500);
    const textHi = String(parsed.textHi || fallbackHi).slice(0, 2500);
    return {
      textEn,
      textHi,
      text: language === "hi" ? textHi : textEn,
      source: "genai",
      provider: genaiProviderLabel(),
    };
  } catch (e) {
    return {
      textEn: fallbackEn,
      textHi: fallbackHi,
      text: language === "hi" ? fallbackHi : fallbackEn,
      source: "rules",
      genaiError: String(e.message || e).slice(0, 180),
    };
  }
}

export function genaiStatusPayload() {
  return {
    configured: genaiConfigured(),
    provider: genaiProviderLabel(),
    models: {
      gemini: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      openai: process.env.OPENAI_MODEL || "gpt-4o-mini",
    },
    hint: genaiConfigured()
      ? "Generative AI ready for project judgment, feedback summary, parent drafts."
      : "Set GEMINI_API_KEY (or OPENAI_API_KEY) in backend .env for live GenAI; strict rule fallbacks remain active.",
  };
}
