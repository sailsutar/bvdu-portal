/**
 * Academic feedback NLP — local domain scorer + extractive multi-doc summary.
 * Optional hybrid: ML service POST /sentiment (transformer) when available.
 */

const STOP = new Set(
  `a an the and or but if in on at to for of is are was were be been being it this that these those i we you they he she with from as by not no so too very can could should would will just about into over under again further then once here there when where why how all each few more most other some such only own same than too very`.split(
    /\s+/
  )
);

/** Domain positive weights (teaching feedback) */
const POS = {
  excellent: 3.2,
  outstanding: 3.2,
  amazing: 2.8,
  great: 2.4,
  best: 2.4,
  awesome: 2.4,
  impressive: 2.3,
  wonderful: 2.4,
  helpful: 2.2,
  clear: 2.1,
  lucid: 2.2,
  understandable: 2.1,
  structured: 2.0,
  organized: 2.0,
  engaging: 2.2,
  interactive: 2.0,
  supportive: 2.1,
  patient: 1.9,
  motivating: 2.1,
  inspiring: 2.2,
  knowledgeable: 2.0,
  thorough: 1.9,
  detailed: 1.7,
  practical: 1.8,
  useful: 1.9,
  relevant: 1.7,
  effective: 1.9,
  good: 1.2,
  nice: 1.0,
  fine: 0.7,
  decent: 1.1,
  satisfied: 1.8,
  happy: 1.6,
  love: 2.0,
  liked: 1.5,
  appreciate: 1.8,
  recommends: 1.9,
  recommend: 1.8,
};

const NEG = {
  poor: 2.6,
  bad: 2.4,
  worst: 3.2,
  terrible: 3.0,
  awful: 2.9,
  horrible: 2.9,
  confusing: 2.5,
  unclear: 2.4,
  disorganized: 2.4,
  boring: 2.2,
  monotone: 2.0,
  rushed: 2.1,
  fast: 1.4,
  slow: 1.3,
  late: 1.6,
  absent: 1.8,
  unhelpful: 2.3,
  useless: 2.5,
  irrelevant: 2.0,
  unfair: 2.2,
  biased: 2.1,
  harsh: 1.9,
  rude: 2.3,
  disrespect: 2.4,
  difficult: 1.5,
  hard: 1.2,
  tough: 1.1,
  lack: 1.8,
  lacking: 1.9,
  missing: 1.6,
  incomplete: 1.8,
  insufficient: 2.0,
  disappointed: 2.2,
  disappointment: 2.2,
  waste: 2.4,
  wasted: 2.4,
  never: 1.3,
  always: 0.8,
  problem: 1.5,
  problems: 1.6,
  issue: 1.4,
  issues: 1.5,
  complaint: 2.0,
  complain: 1.9,
};

const POS_PHRASES = [
  "well explained",
  "explains well",
  "very clear",
  "easy to understand",
  "makes it easy",
  "doubt clearing",
  "clears doubts",
  "clears my doubts",
  "takes extra time",
  "extra efforts",
  "real life examples",
  "real-world examples",
  "industry oriented",
  "highly recommend",
  "would recommend",
  "best faculty",
  "best teacher",
  "teaching is good",
  "teaching style is good",
  "interactive session",
  "encourages questions",
];

const NEG_PHRASES = [
  "hard to understand",
  "difficult to understand",
  "not clear",
  "not understandable",
  "goes too fast",
  "too fast",
  "too slow",
  "no examples",
  "no practical",
  "only theory",
  "does not explain",
  "doesn't explain",
  "not helpful",
  "waste of time",
  "wasting time",
  "never available",
  "not available",
  "poor teaching",
  "bad teaching",
  "cannot understand",
  "can't understand",
  "no clarity",
  "lacks clarity",
  "incomplete notes",
  "no notes",
];

const NEGATIONS = [
  "not",
  "never",
  "no",
  "n't",
  "hardly",
  "barely",
  "neither",
  "without",
];
const INTENSIFIERS = ["very", "really", "extremely", "highly", "so", "too", "quite", "totally"];

const THEME_RULES = [
  { id: "pace", label: "Pace of teaching", keys: ["fast", "slow", "pace", "rushed", "speed"] },
  { id: "clarity", label: "Clarity of explanation", keys: ["clear", "unclear", "confusing", "understand", "explain"] },
  { id: "examples", label: "Examples / practical work", keys: ["example", "practical", "lab", "project", "demo"] },
  { id: "availability", label: "Availability / support", keys: ["available", "doubt", "help", "support", "approachable"] },
  { id: "materials", label: "Notes / materials", keys: ["notes", "slides", "material", "content", "syllabus"] },
  { id: "assessment", label: "Assessment / fairness", keys: ["exam", "marks", "fair", "evaluation", "assignment"] },
];

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .trim();
}

function splitSentences(text) {
  const n = normalizeText(text);
  if (!n) return [];
  return n
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function phraseScore(text, phrases) {
  const low = text.toLowerCase();
  let s = 0;
  for (const ph of phrases) {
    if (low.includes(ph)) s += 2.4;
  }
  return s;
}

/**
 * Lexicon score with local negation / intensifier windows.
 */
export function scoreFeedbackText(text) {
  const raw = normalizeText(text);
  if (!raw || raw.length < 3) {
    return {
      sentiment: "average",
      score: 0,
      confidence: 0.35,
      themes: [],
      reason: "empty",
      source: "feedback-nlp-local",
    };
  }

  const tokens = tokenize(raw);
  let score = 0;
  let hits = 0;
  let posHits = 0;
  let negHits = 0;

  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    const prev = tokens.slice(Math.max(0, i - 3), i);
    const negated = prev.some((p) => NEGATIONS.includes(p) || p.endsWith("n't"));
    const intense = prev.some((p) => INTENSIFIERS.includes(p));
    let delta = 0;
    if (POS[w] != null) {
      delta = POS[w];
      if (negated) delta = -delta * 0.85;
      if (intense && !negated) delta *= 1.25;
      posHits += negated ? 0 : 1;
      negHits += negated ? 1 : 0;
      hits++;
    } else if (NEG[w] != null) {
      delta = -NEG[w];
      if (negated) delta = -delta * 0.75; // "not bad" → mild positive
      if (intense && !negated) delta *= 1.25;
      negHits += negated ? 0 : 1;
      posHits += negated ? 1 : 0;
      hits++;
    }
    score += delta;
  }

  score += phraseScore(raw, POS_PHRASES);
  score -= phraseScore(raw, NEG_PHRASES);

  // Mild / neutral cues
  const mild =
    /\b(okay|ok|average|fine|decent|alright|satisfactory|nothing special|as usual)\b/i.test(raw);
  const strongPos = score >= 4.5 || (posHits >= 2 && score >= 2.5);
  const strongNeg = score <= -4.5 || (negHits >= 2 && score <= -2.5);
  const mixed = posHits > 0 && negHits > 0 && Math.abs(score) < 3;

  let sentiment = "average";
  let reason = "balanced_or_weak_signal";
  if (mixed && Math.abs(score) < 2.5) {
    sentiment = "average";
    reason = "mixed_signals";
  } else if (mild && Math.abs(score) < 3.5) {
    sentiment = "average";
    reason = "explicit_average_language";
  } else if (strongPos || score >= 3.2) {
    sentiment = "good";
    reason = "positive_domain_lexicon";
  } else if (strongNeg || score <= -3.2) {
    sentiment = "bad";
    reason = "negative_domain_lexicon";
  } else if (score >= 1.6 && posHits > negHits) {
    sentiment = "good";
    reason = "lean_positive";
  } else if (score <= -1.6 && negHits > posHits) {
    sentiment = "bad";
    reason = "lean_negative";
  }

  let confidence = 0.42 + Math.min(0.45, hits * 0.07 + Math.abs(score) * 0.04);
  if (sentiment === "average" && mild) confidence = Math.min(confidence, 0.6);
  if (mixed) confidence = Math.min(confidence, 0.55);
  confidence = Math.round(Math.min(0.92, confidence) * 100) / 100;

  const themes = [];
  const low = raw.toLowerCase();
  for (const th of THEME_RULES) {
    if (th.keys.some((k) => low.includes(k))) themes.push({ id: th.id, label: th.label });
  }

  return {
    sentiment,
    score: Math.round(score * 100) / 100,
    confidence,
    themes,
    reason,
    source: "feedback-nlp-local",
  };
}

function rankSentences(sentences, docs) {
  const df = new Map();
  const docsTokens = docs.map((d) => {
    const toks = tokenize(d).filter((w) => !STOP.has(w) && w.length > 2);
    for (const w of new Set(toks)) df.set(w, (df.get(w) || 0) + 1);
    return toks;
  });
  const N = Math.max(docs.length, 1);
  const scored = sentences.map((s, idx) => {
    const toks = tokenize(s).filter((w) => !STOP.has(w) && w.length > 2);
    if (!toks.length) return { s, score: 0 };
    let tfidf = 0;
    const tf = new Map();
    for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
    for (const [w, c] of tf) {
      const idf = Math.log((N + 1) / ((df.get(w) || 0) + 1)) + 1;
      tfidf += (c / toks.length) * idf;
    }
    // Prefer middle-early sentences slightly; boost polar words
    const pol = scoreFeedbackText(s);
    const polarBoost = pol.sentiment === "average" ? 0 : 0.35 * Math.abs(pol.score);
    const posBoost = idx < 3 ? 0.15 : 0;
    return { s, score: tfidf + polarBoost + posBoost };
  });
  scored.sort((a, b) => b.score - a.score);
  // Diversity: avoid near-duplicate tops
  const out = [];
  for (const row of scored) {
    if (row.score <= 0) continue;
    const key = row.s.toLowerCase().slice(0, 48);
    if (out.some((x) => x.toLowerCase().slice(0, 48) === key)) continue;
    out.push(row.s);
    if (out.length >= 8) break;
  }
  return out;
}

async function transformerSentiment(text) {
  const base = (process.env.ML_SERVICE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${base}/sentiment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: String(text || "").slice(0, 2000) }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.sentiment) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeFeedback(text) {
  const local = scoreFeedbackText(text);
  const sentences = splitSentences(text);
  const summary =
    sentences.length <= 1
      ? normalizeText(text).slice(0, 240)
      : rankSentences(sentences, [normalizeText(text)]).slice(0, 2).join(" ");

  const xf = await transformerSentiment(text);
  if (xf && xf.sentiment) {
    let sentiment = xf.sentiment;
    let confidence = Number(xf.confidence) || 0.6;
    let reason = "transformer";
    if (
      xf.sentiment === "average" &&
      (local.sentiment === "good" || local.sentiment === "bad") &&
      Math.abs(local.score) >= 3 &&
      local.confidence >= 0.65
    ) {
      sentiment = local.sentiment;
      confidence = Math.max(confidence, local.confidence * 0.9);
      reason = "local_override_strong_domain";
    }
    return {
      sentiment,
      score: local.score,
      confidence: Math.round(confidence * 100) / 100,
      summary,
      themes: local.themes,
      source: reason === "transformer" ? "transformer" : "hybrid",
      model: xf.model || null,
      reason,
      localSentiment: local.sentiment,
    };
  }

  return {
    sentiment: local.sentiment,
    score: local.score,
    confidence: local.confidence,
    summary,
    themes: local.themes,
    source: "feedback-nlp-local",
    reason: local.reason,
  };
}

/**
 * Proper multi-document summary for HOD: counts, headline, themes, concerns, strengths.
 */
export function summarizeFeedbackCorpus(items) {
  const list = (items || [])
    .map((it) => {
      if (typeof it === "string") return { text: it, sentiment: null };
      return {
        text: String(it.text || it.body || it.comment || it.feedback || "").trim(),
        sentiment: it.sentiment || null,
      };
    })
    .filter((x) => x.text);

  if (!list.length) {
    return {
      total: 0,
      good: 0,
      average: 0,
      bad: 0,
      headline: "No feedback to summarize yet.",
      bullets: [],
      themes: [],
      extractiveSummary: "",
      source: "feedback-nlp-local",
    };
  }

  const labeled = list.map((row) => {
    if (row.sentiment && ["good", "average", "bad"].includes(String(row.sentiment).toLowerCase())) {
      return { text: row.text, sentiment: String(row.sentiment).toLowerCase() };
    }
    const sc = scoreFeedbackText(row.text);
    return { text: row.text, sentiment: sc.sentiment, score: sc.score };
  });

  const good = labeled.filter((f) => f.sentiment === "good").length;
  const bad = labeled.filter((f) => f.sentiment === "bad").length;
  const average = labeled.length - good - bad;

  const themeCount = {};
  for (const f of labeled) {
    const sc = scoreFeedbackText(f.text);
    for (const th of sc.themes || []) {
      themeCount[th.id] = themeCount[th.id] || { id: th.id, label: th.label, count: 0 };
      themeCount[th.id].count += 1;
    }
  }
  const themes = Object.values(themeCount).sort((a, b) => b.count - a.count);

  const allSentences = labeled.flatMap((f) => splitSentences(f.text));
  const docs = labeled.map((f) => f.text);
  const topSentences = rankSentences(allSentences, docs);

  const pct = (n) => Math.round((n / labeled.length) * 100);
  let headline;
  if (bad >= good && bad >= average && bad > 0) {
    headline = `Overall tone leans critical (${pct(bad)}% negative, ${pct(good)}% positive, ${pct(average)}% neutral across ${labeled.length} responses).`;
  } else if (good > bad && good >= average) {
    headline = `Overall tone is constructive (${pct(good)}% positive, ${pct(bad)}% negative, ${pct(average)}% neutral across ${labeled.length} responses).`;
  } else {
    headline = `Overall tone is mixed or neutral (${pct(average)}% average, ${pct(good)}% positive, ${pct(bad)}% negative across ${labeled.length} responses).`;
  }

  const bullets = [];
  if (themes[0]) bullets.push(`Top theme: ${themes[0].label} (${themes[0].count} mentions).`);
  if (themes[1]) bullets.push(`Also frequent: ${themes[1].label} (${themes[1].count}).`);

  const takePolar = (sent, label, limit) => {
    const snips = labeled.filter((f) => f.sentiment === sent).map((f) => f.text);
    if (!snips.length) return;
    const ranked = rankSentences(snips.flatMap(splitSentences), snips).slice(0, limit);
    for (const s of ranked) bullets.push(`${label}: ${s}`);
  };
  takePolar("bad", "Concern", 2);
  takePolar("good", "Strength", 2);

  for (const s of topSentences.slice(0, 3)) {
    if (!bullets.some((b) => b.includes(s.slice(0, 36)))) bullets.push(`Highlight: ${s}`);
  }

  // Coherent paragraph summary (extractive stitch)
  const extractiveSummary = topSentences.slice(0, 4).join(" ");

  return {
    total: labeled.length,
    good,
    average,
    bad,
    headline,
    bullets: bullets.slice(0, 10),
    themes,
    extractiveSummary,
    source: "feedback-nlp-local",
  };
}

export default {
  scoreFeedbackText,
  analyzeFeedback,
  summarizeFeedbackCorpus,
};
