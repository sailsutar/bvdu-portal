/**
 * Browser speech-to-text → background factor field patch.
 * Best supported in Chrome / Edge. Empty fields stay empty (never forced to 0).
 */

const PATH_PHRASES = [
  { re: /\b(first\s*year\s*regular|fy\s*regular|regular\s*fy)\b/i, path: "FY_REGULAR" },
  { re: /\b(direct\s*second\s*year\s*diploma|dsy\s*diploma|diploma\s*only)\b/i, path: "DSY_DIPLOMA" },
  { re: /\b(science\s*(plus|and|\+)?\s*diploma|dsy\s*science)\b/i, path: "DSY_SCIENCE_DIP" },
  { re: /\b(commerce\s*(plus|and|\+)?\s*diploma|dsy\s*commerce)\b/i, path: "DSY_COMMERCE_DIP" },
];

const STREAM_PHRASES = [
  { re: /\bstream\s+(science|pcm|pcb)\b/i, stream: "science" },
  { re: /\b(science)\s+stream\b/i, stream: "science" },
  { re: /\bstream\s+(commerce|business)\b/i, stream: "commerce" },
  { re: /\b(commerce)\s+stream\b/i, stream: "commerce" },
  { re: /\bstream\s+(arts|humanities)\b/i, stream: "arts" },
];

/** Normalize spoken numbers: "seventy five" is left to STT digits; strip commas/% */
function toNum(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/,/g, "").replace(/%/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a transcript into a partial background row.
 * @param {string} transcript
 * @returns {{ patch: object, labels: string[] }}
 */
export function parseBackgroundVoiceTranscript(transcript) {
  const text = String(transcript || "")
    .replace(/(\d)\s*\.\s*(\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .trim();
  const patch = {};
  const labels = [];

  if (!text) return { patch, labels };

  for (const { re, path } of PATH_PHRASES) {
    if (re.test(text)) {
      patch.entryPath = path;
      labels.push(`Entry path → ${path}`);
      break;
    }
  }
  for (const { re, stream } of STREAM_PHRASES) {
    if (re.test(text)) {
      patch.twelfthStream = stream;
      labels.push(`Stream → ${stream}`);
      break;
    }
  }

  const patterns = [
    { re: /\b(?:10th|tenth|10\s*th)\s*(?:marks?|percent|percentage|%)?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)/gi, key: "tenthPercent", label: "10th %" },
    { re: /\b(?:12th|twelfth|12\s*th)\s*(?:marks?|percent|percentage|%)?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)/gi, key: "twelfthPercent", label: "12th %" },
    { re: /\bdiploma\s*(?:marks?|percent|percentage|%|score)?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)/gi, key: "diplomaPercent", label: "Diploma %" },
    { re: /\b(?:cet|mht\s*cet|mhtcet)\s*(?:score|percentile|percent|%)?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)/gi, key: "cetScore", label: "CET" },
    { re: /\b(?:jee|jee\s*main)\s*(?:score|percentile|percent|rank|%)?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)/gi, key: "jeeScore", label: "JEE" },
  ];

  for (const { re, key, label } of patterns) {
    re.lastIndex = 0;
    let m;
    let last = null;
    while ((m = re.exec(text)) !== null) {
      last = m[1];
    }
    if (last != null) {
      const n = toNum(last);
      if (n != null) {
        patch[key] = n;
        labels.push(`${label} → ${n}`);
      }
    }
  }

  // diploma type phrase (non-numeric)
  const typeM = text.match(/\bdiploma\s+type\s+[:=]?\s*([a-zA-Z][a-zA-Z0-9 \-]{1,40})/i);
  if (typeM) {
    patch.diplomaType = typeM[1].trim();
    labels.push(`Diploma type → ${patch.diplomaType}`);
  }

  return { patch, labels };
}

export function speechRecognitionSupported() {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * One-shot listen → transcript string.
 * @returns {Promise<string>}
 */
export function listenOnceBackgroundVoice(opts = {}) {
  const lang = opts.lang || "en-IN";
  return new Promise((resolve, reject) => {
    if (!speechRecognitionSupported()) {
      reject(new Error("Voice input needs Chrome or Edge with microphone access."));
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = "";
    let settled = false;

    const done = (text) => {
      if (settled) return;
      settled = true;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      resolve(String(text || "").trim());
    };

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const t = r[0]?.transcript || "";
        if (r.isFinal) finalText += t + " ";
        else interim += t;
      }
      if (opts.onInterim) opts.onInterim((finalText + " " + interim).trim());
    };

    rec.onerror = (e) => {
      if (settled) return;
      settled = true;
      reject(new Error(e?.error === "not-allowed" ? "Microphone permission denied." : `Voice error: ${e?.error || "unknown"}`));
    };

    rec.onend = () => {
      done(finalText);
    };

    try {
      rec.start();
    } catch (e) {
      reject(e);
    }

    // Safety stop
    const ms = opts.timeoutMs || 12000;
    setTimeout(() => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }, ms);
  });
}
