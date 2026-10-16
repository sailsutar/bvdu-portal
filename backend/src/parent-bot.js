/**
 * Parent WhatsApp bot + bilingual templates + optional automated voice call.
 *
 * Keywords (English/Hindi roman / Devanagari):
 *   attendance | उपस्थित | haziri | present
 *   marks | अंक | marks | result | score
 *   help | मदद
 *
 * Wire Twilio WhatsApp webhook → POST /api/parent-bot/whatsapp
 * Outbound notify: buildParentNotifyText + optional placeVoiceCall
 */

import { AcademicRecord, StudentBackground } from "./db.js";
import { appendMagicLinkFooter } from "./parent-magic-link.js";

const PASS_UT = 8;

/** Normalize Indian / E.164-ish phone for matching */
export function normalizePhone(p) {
  if (p == null) return "";
  let s = String(p).replace(/[^\d+]/g, "");
  if (s.startsWith("whatsapp:")) s = s.slice("whatsapp:".length);
  s = s.replace(/[^\d+]/g, "");
  // strip leading + for digit compare
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10); // last 10 (India mobile)
  return digits;
}

export function detectIntent(body) {
  const t = String(body || "")
    .trim()
    .toLowerCase();
  if (!t) return "help";
  if (
    /\b(attendance|attendence|att|haziri|haazri|present)\b/.test(t) ||
    t.includes("उपस्थिति") ||
    t.includes("हाजिरी")
  ) {
    return "attendance";
  }
  if (
    /\b(marks|mark|result|score|scores|ut|grades?)\b/.test(t) ||
    t.includes("अंक") ||
    t.includes("नंबर") ||
    t.includes("मार्क्स")
  ) {
    return "marks";
  }
  if (/\b(help|menu|start|hi|hello|namaste)\b/.test(t) || t.includes("मदद")) {
    return "help";
  }
  return "unknown";
}

function formatMarksBlock(student) {
  const marks = student.marks || [];
  if (!marks.length) {
    return {
      en: "No unit test marks are on record yet.",
      hi: "अभी तक यूनिट टेस्ट के अंक दर्ज नहीं हैं।",
    };
  }
  const linesEn = [];
  const linesHi = [];
  for (const m of marks.slice(0, 12)) {
    const a = m.assessments || {};
    const u1 = a["UT-1"] ?? a.UT1;
    const u2 = a["UT-2"] ?? a.UT2;
    const u3 = a["UT-3"] ?? a.UT3;
    const bits = [];
    if (u1 != null) bits.push(`UT-1: ${u1}`);
    if (u2 != null) bits.push(`UT-2: ${u2}`);
    if (u3 != null) bits.push(`UT-3: ${u3}`);
    if (!bits.length && m.average != null) bits.push(`Avg: ${m.average}`);
    linesEn.push(`• ${m.subject || "Subject"}: ${bits.join(", ") || "—"}`);
    linesHi.push(`• ${m.subject || "विषय"}: ${bits.join(", ") || "—"}`);
  }
  return { en: linesEn.join("\n"), hi: linesHi.join("\n") };
}

export function buildHelpText() {
  return (
    `BVU Parent Bot / बीवीयू पेरेंट बॉट\n\n` +
    `Reply with:\n` +
    `• attendance — attendance %\n` +
    `• marks — unit test marks\n` +
    `• help — this menu\n\n` +
    `उत्तर भेजें:\n` +
    `• attendance — उपस्थिति\n` +
    `• marks — अंक\n` +
    `• help — सहायता`
  );
}

export function buildAttendanceReply(student) {
  const name = student.name || "Student";
  const prn = student.prn || "";
  const att =
    student.attendance != null && Number.isFinite(Number(student.attendance))
      ? `${Number(student.attendance)}%`
      : "not available / उपलब्ध नहीं";
  return (
    `Attendance update / उपस्थिति\n` +
    `${name} (PRN ${prn})\n` +
    `Attendance: ${att}\n` +
    `उपस्थिति: ${att}`
  );
}

export function buildMarksReply(student) {
  const name = student.name || "Student";
  const prn = student.prn || "";
  const block = formatMarksBlock(student);
  const avg =
    student.averagePercentage != null
      ? `${student.averagePercentage}%`
      : "—";
  return (
    `Marks update / अंक\n` +
    `${name} (PRN ${prn})\n` +
    `Overall average: ${avg}\n` +
    `${block.en}\n\n` +
    `समग्र औसत: ${avg}\n` +
    `${block.hi}`
  );
}

/** Bilingual outbound notify after HOD approval */
export function buildParentNotifyText(student, { mode = "full", includeAppLink = false } = {}) {
  const name = student.name || "Student";
  const prn = student.prn || "";
  const att =
    student.attendance != null ? `${Number(student.attendance)}%` : "—";
  const status = student.academicStatus || student.status || "—";
  const marks = formatMarksBlock(student);

  if (mode === "attendance") {
    return (
      `Dear Parent,\n` +
      `Update for ${name} (PRN ${prn}): Attendance ${att}.\n\n` +
      `प्रिय अभिभावक,\n` +
      `${name} (PRN ${prn}) की उपस्थिति: ${att}।\n\n` +
      `Reply ATTENDANCE or MARKS on WhatsApp for live details.\n` +
      `लाइव जानकारी के लिए WhatsApp पर ATTENDANCE या MARKS भेजें।`
    );
  }
  if (mode === "marks") {
    return (
      `Dear Parent,\n` +
      `Marks for ${name} (PRN ${prn}):\n${marks.en}\n\n` +
      `प्रिय अभिभावक,\n` +
      `${name} के अंक:\n${marks.hi}\n\n` +
      `Reply ATTENDANCE or MARKS on WhatsApp for live details.`
    );
  }
  return (
    `Dear Parent,\n` +
    `Academic update for ${name} (PRN ${prn})\n` +
    `Status: ${status} | Attendance: ${att}\n` +
    `${marks.en}\n\n` +
    `प्रिय अभिभावक,\n` +
    `${name} (PRN ${prn}) की शैक्षणिक जानकारी\n` +
    `स्थिति: ${status} | उपस्थिति: ${att}\n` +
    `${marks.hi}\n\n` +
    `WhatsApp bot: type attendance or marks for live data.\n` +
    `बॉट: attendance या marks लिखें।`
  );
}


/** Notify text + optional passwordless Parent app deep link */
export function enrichParentNotifyText(student, { mode = "full", includeAppLink = true } = {}) {
  const base = buildParentNotifyText(student, { mode, includeAppLink: false });
  if (!includeAppLink) return base;
  return appendMagicLinkFooter(base, student);
}

export async function findStudentsByParentPhone(fromPhone) {
  const key = normalizePhone(fromPhone);
  if (!key || key.length < 10) return [];
  const matchPhone = (p) => {
    const n = normalizePhone(p);
    return n && (n === key || n.endsWith(key) || key.endsWith(n));
  };

  // System Admin Contact details (parent WhatsApp / parent mobile / student mobile)
  const masters = await StudentBackground.find({})
    .select("prn name parentWhatsapp parentMobile studentMobile studentEmail")
    .lean();
  const prns = new Set();
  const masterByPrn = {};
  for (const m of masters) {
    masterByPrn[String(m.prn)] = m;
    if (
      matchPhone(m.parentWhatsapp) ||
      matchPhone(m.parentMobile) ||
      matchPhone(m.studentMobile)
    ) {
      prns.add(String(m.prn));
    }
  }
  if (prns.size) {
    const academic = await AcademicRecord.find({ prn: { $in: [...prns] } })
      .select(
        "prn name attendance attendanceKnown marks averagePercentage academicStatus status yearLevel batch cls phone email"
      )
      .lean();
    const byPrn = Object.fromEntries(academic.map((a) => [String(a.prn), a]));
    return [...prns].map((prn) => {
      const m = masterByPrn[prn] || {};
      const a = byPrn[prn] || {};
      return {
        ...a,
        prn,
        name: a.name || m.name || "",
        phone: m.parentWhatsapp || m.parentMobile || m.studentMobile || a.phone,
        email: m.studentEmail || a.email,
        attendance: a.attendance,
        marks: a.marks || [],
        averagePercentage: a.averagePercentage,
        academicStatus: a.academicStatus || a.status,
      };
    });
  }

  // Fallback: phone on academic row only
  const rows = await AcademicRecord.find({})
    .select(
      "prn name attendance attendanceKnown marks averagePercentage academicStatus status yearLevel batch cls phone email"
    )
    .lean();
  return rows.filter((s) => matchPhone(s.phone));
}

export async function handleParentIncoming({ from, body }) {
  const intent = detectIntent(body);
  const students = await findStudentsByParentPhone(from);

  if (!students.length) {
    return {
      intent,
      text:
        `No student is linked to this mobile number in BVU Portal.\n` +
        `इस मोबाइल नंबर से कोई छात्र लिंक नहीं है।\n` +
        `Please contact the department office.\n` +
        `कृपया विभाग कार्यालय से संपर्क करें।`,
      students: [],
    };
  }

  // If multiple children on same phone, merge briefly
  const primary = students[0];
  let text;
  if (intent === "attendance") {
    text = students.map((s) => buildAttendanceReply(s)).join("\n\n---\n\n");
  } else if (intent === "marks") {
    text = students.map((s) => buildMarksReply(s)).join("\n\n---\n\n");
  } else if (intent === "help") {
    text = buildHelpText();
  } else {
    text =
      `Sorry, I did not understand.\n` +
      `माफ़ करें, समझ नहीं पाया।\n\n` +
      buildHelpText();
  }
  return { intent, text, students: students.map((s) => s.prn), primaryPrn: primary.prn };
}

/**
 * Twilio Voice: place a short automated call (TTS).
 * Requires TWILIO_* and a public TWILIO_VOICE_STATUS optional.
 */
export async function placeAutomatedCall({
  to,
  messageEn,
  accountSid,
  authToken,
  from,
  dryRun = false,
}) {
  if (dryRun) {
    return { ok: true, dryRun: true, channel: "voice", to, preview: messageEn };
  }
  if (!accountSid || !authToken || !from || !to) {
    const err = new Error("Voice call not configured (TWILIO_ACCOUNT_SID, AUTH, FROM, to)");
    err.status = 503;
    throw err;
  }
  const toAddr = String(to).replace(/^whatsapp:/, "");
  // TwiML inline via Twiml bin-style: use Twiml in API
  const twiml = `<Response><Say voice="alice" language="en-IN">${escapeXml(
    String(messageEn).slice(0, 500)
  )}</Say><Pause length="1"/><Say voice="alice" language="hi-IN">कृपया कॉलेज पोर्टल या व्हाट्सएप बॉट से विवरण देखें।</Say></Response>`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
  const body = new URLSearchParams({
    To: toAddr,
    From: from,
    Twiml: twiml,
  });
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.message || "Twilio voice call failed");
    err.status = r.status >= 400 ? r.status : 502;
    err.detail = data;
    throw err;
  }
  return { ok: true, channel: "voice", provider: "twilio", messageId: data.sid, status: data.status };
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
