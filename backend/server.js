import "./src/loadEnv.js";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  connectMongo,
  ensureStudentAccounts,
  writeAudit,
  Feedback,
  User,
  MessageLog,
  seedIfEmpty,
  MONGODB_URI,
  getPortalConfig,
  PortalConfig,
  Announcement,
  Timetable,
  TgAssignment,
  StudentBackground,
} from "./src/db.js";
import { scoreFeedbackText, analyzeFeedback, summarizeFeedbackCorpus } from "./src/feedback-nlp.js";
import {
  loginUser,
  logoutToken,
  requireAuth,
  requireAdmin,
  requireTeacherGuide,
  requireStudent,
  optionalAuth,
} from "./src/auth.js";
import { registerPortalRoutes } from "./src/portal-routes.js";
import { registerCohortRoutes } from "./src/cohort-routes.js";
import { registerAdminMasterRoutes } from "./src/admin-master-routes.js";
import { registerPlacementRoutes } from "./src/placement-routes.js";
import { registerParentRoutes } from "./src/parent-routes.js";
import { ensureSystemAdmin, ensurePlacementUsers } from "./src/db.js";
import { resolveStudentProfile } from "./src/sample-cohort.js";
import { parseAcademicGroup } from "./src/academic-group.js";
import {
  handleParentIncoming,
  buildParentNotifyText,
  buildHelpText,
  placeAutomatedCall,
  normalizePhone,
} from "./src/parent-bot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();

// CORS: set CORS_ORIGINS to frontend URL(s), or * for open pilot deploy
const IS_PROD = process.env.NODE_ENV === "production";
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (IS_PROD && ALLOWED_ORIGINS.length === 0) {
  console.warn(
    "[cors] CORS_ORIGINS empty in production — allowing all origins for pilot. Set CORS_ORIGINS to lock down (e.g. https://your-app.vercel.app)."
  );
}
function corsOriginAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.length === 0) return true; // pilot / mobile / same-host
  if (ALLOWED_ORIGINS.includes("*")) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow Vercel preview URLs if a vercel.app entry is listed
  try {
    const host = new URL(origin).hostname;
    for (const a of ALLOWED_ORIGINS) {
      if (a.startsWith("*.") && host.endsWith(a.slice(1))) return true;
      if (a.includes("vercel.app") && host.endsWith("vercel.app")) return true;
    }
  } catch (_) {}
  return false;
}
app.set("trust proxy", 1);
// Disable ETag so browsers never get HTTP 304 for cohort / student JSON after uploads
app.set("etag", false);
app.use(
  cors({
    origin: (origin, cb) => {
      if (corsOriginAllowed(origin)) return cb(null, true);
      return cb(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "40mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || "40mb" }));

// Lightweight request log (no bodies — avoid leaking student data)
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/")) {
    console.log(`[api] ${req.method} ${req.path}`);
  }
  next();
});

/**
 * In-process rate limiter.
 * LIMITATION: Map is process-local — does not share state across multiple Node instances.
 * For multi-instance production, replace with Redis (e.g. rate-limiter-flexible) or rely on
 * sticky sessions at the load balancer. Keys incorporate X-Forwarded-For when present.
 */
const rateBuckets = new Map();
function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) {
    const first = String(xf).split(",")[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

app.get("/api/health", async (_req, res) => {
  let feedbackCount = 0;
  try {
    feedbackCount = await Feedback.countDocuments();
  } catch {
    /* mongo may be starting */
  }
  res.json({
    ok: true,
    service: "Bharati Vidyapeeth University Portal Application Programming Interface",
    time: new Date().toISOString(),
    feedbackCount,
    sampleCohortSize: 0,
  });
});

app.post("/api/login", async (req, res) => {
  try {
    const { role, id, password } = req.body || {};
    if (!role || !id || !password) {
      return res.status(400).json({ error: "Role, identifier, and password are required." });
    }
    const result = await loginUser(role, id, password);
    if (!result.ok) {
      return res.status(401).json({ error: result.error || "Invalid credentials" });
    }
    res.json({ session: result.session, token: result.token });
  } catch (e) {
    console.error("[login]", e);
    res.status(500).json({ error: "Login service unavailable. Is MongoDB running?" });
  }
});

app.post("/api/logout", optionalAuth, async (req, res) => {
  if (req.auth?.token) await logoutToken(req.auth.token);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const u = req.auth.user;
  res.json({
    id: u.id,
    role: req.auth.publicRole,
    name: u.name,
    email: u.email,
    phone: u.phone,
    className: u.className || u.class_name,
    tgIndex: u.teacherGuideIndex ?? u.teacher_guide_index,
    prn: u.role === "student" ? u.id : undefined,
  });
});

/** Head of Department can register student accounts from an uploaded roster */
app.post("/api/auth/sync-students", requireAdmin, async (req, res) => {
  try {
    const students = req.body?.students || [];
    const created = await ensureStudentAccounts(students);
    await writeAudit(req.auth.id, "auth.sync_students", { created, total: students.length });
    res.json({ ok: true, created, total: students.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/auth/status", async (_req, res) => {
  try {
    const rows = await User.aggregate([{ $group: { _id: "$role", c: { $sum: 1 } } }]);
    res.json({
      database: "mongodb",
      uriHost: (process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/bvu_portal").split("@").pop(),
      roles: Object.fromEntries(rows.map((r) => [r._id, r.c])),
      studentLogin:
        process.env.NODE_ENV === "production"
          ? "Students sign in with Permanent Registration Number and institutional password"
          : "Students sign in with Permanent Registration Number and default password (see seed)",
      headOfDepartmentLogin: "Employee identifier EMP001 with the Head of Department password",
      teacherGuideLogin: "Teacher Guide identifiers TG001, TG002, TG003",
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e), database: "mongodb" });
  }
});

/** Development-only placeholder. Returns empty shape in production. */
app.get("/api/mock", (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not available in production." });
  }
  res.json({
    student: null,
    adminStats: { totalStudents: 0, avgAttendance: 0, passPercentage: 0, atRisk: 0 },
    note: "Demo data disabled. Upload academic Excel from the Head of Department portal.",
  });
});

// ---------- Feedback ----------

// Return a single student's attendance so the frontend can enable/disable the form.

/** Head of Department updates student attendance / class stored in MongoDB */
app.patch("/api/students/:id/roster", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const { attendance, className, name, phone, email } = req.body || {};
    const patch = {};
    if (typeof attendance === "number") patch.attendance = attendance;
    if (className != null) patch.className = String(className).slice(0, 80);
    if (name) patch.name = String(name).slice(0, 120);
    if (phone != null) patch.phone = String(phone).slice(0, 20);
    if (email != null) patch.email = String(email).slice(0, 120);
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "No fields to update." });
    }
    const result = await User.findOneAndUpdate(
      { id, role: "student" },
      { $set: patch },
      { new: true }
    );
    if (!result) {
      return res.status(404).json({ error: "Student account not found. Upload roster or have the student sign in once first." });
    }
    await writeAudit(req.auth.id, "roster.update", { id, patch });
    res.json({
      ok: true,
      student: {
        id: result.id,
        name: result.name,
        attendance: result.attendance,
        className: result.className,
        email: result.email,
        phone: result.phone,
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/students/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const role = req.auth.role;

    // Student may only view own profile
    if (role === "student") {
      if (req.auth.id !== id) {
        return res.status(403).json({ error: "Students may only view their own profile." });
      }
    } else if (role === "teacher_guide") {
      // Strict mentee check: unassigned students are NOT visible to every TG.
      // Allow only if:
      //   (a) explicit TgAssignment exists for this PRN and tgIndex matches, OR
      //   (b) no explicit assignment, but student.teacherGuideIndex is set and matches.
      const tgIndex = req.auth.tgIndex;
      const explicit = await TgAssignment.findOne({ prn: id }).lean();
      let allowed = false;
      if (explicit) {
        allowed = Number(explicit.tgIndex) === Number(tgIndex);
      } else {
        const studentUser = await User.findOne({ id, role: "student" }).lean();
        if (
          studentUser != null &&
          studentUser.teacherGuideIndex != null &&
          Number(studentUser.teacherGuideIndex) === Number(tgIndex)
        ) {
          allowed = true;
        }
      }
      if (!allowed) {
        return res.status(403).json({ error: "This student is not in your mentee list." });
      }
    } else if (role !== "admin") {
      return res.status(403).json({ error: "You do not have permission to view this student." });
    }
    // admin (HoD) can see all
    const profile = await resolveStudentProfile(id, User);
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/cohort/sample", requireAuth, (_req, res) => {
  res.json({
    count: 0,
    students: [],
    note: "No sample cohort. Upload academic Excel data from the Head of Department portal.",
  });
});

// Feedback NLP: local module (backend/src/feedback-nlp.js) — no Lovable / external LLM
// scoreFeedbackText, analyzeFeedback, summarizeFeedbackCorpus imported above.



function buildTeacherSummary(list) {
  const total = list.length;
  if (!total) {
    return {
      total: 0,
      good: 0,
      average: 0,
      bad: 0,
      overall: "none",
      headline: "No student feedback yet.",
      overview:
        "Students with 75%+ attendance can submit feedback from the student portal.",
      strengths: [],
      concerns: [],
      action: "Share the feedback form with eligible students.",
      goodPct: 0,
      averagePct: 0,
      badPct: 0,
    };
  }
  const good = list.filter((f) => f.sentiment === "good");
  const average = list.filter((f) => f.sentiment === "average");
  const bad = list.filter((f) => f.sentiment === "bad");
  const g = good.length;
  const a = average.length;
  const b = bad.length;
  const overall = g >= a && g >= b ? "good" : b > g && b >= a ? "bad" : "average";
  const pct = (n) => Math.round((n / total) * 100);

  const strengths = good
    .slice(0, 5)
    .map((f) => f.summary || String(f.text || "").slice(0, 100))
    .filter(Boolean);
  const concerns = bad
    .slice(0, 5)
    .map((f) => f.summary || String(f.text || "").slice(0, 100))
    .filter(Boolean);

  const headline =
    overall === "good"
      ? `Overall sentiment is positive (${pct(g)}% good).`
      : overall === "bad"
        ? `Overall sentiment needs attention (${pct(b)}% negative).`
        : `Overall sentiment is mixed (${pct(g)}% good, ${pct(b)}% negative).`;

  let overview = `You have ${total} student feedback${total === 1 ? "" : "s"}: ${g} good, ${a} average, ${b} bad. `;
  if (g && !b) overview += "Students are largely satisfied with teaching and support.";
  else if (b && !g) overview += "Multiple students raised concerns — review the points below.";
  else if (g && b)
    overview += "Praise and concerns both appear; focus on recurring issues while keeping what works.";
  else overview += "Feedback is mostly neutral or mild.";

  const action =
    overall === "bad"
      ? "Prioritize the listed concerns (clarity, pace, availability) and follow up in the next class."
      : overall === "good"
        ? "Keep current practices; note any repeated requests for more examples or doubt sessions."
        : "Address negative themes early and reinforce topics students already appreciate.";

  return {
    total,
    good: g,
    average: a,
    bad: b,
    overall,
    headline,
    overview,
    strengths,
    concerns,
    action,
    goodPct: pct(g),
    averagePct: pct(a),
    badPct: pct(b),
  };
}

// Student submits feedback. Attendance gate is admin-configurable (default 75%).
app.post("/api/feedback", requireAuth, async (req, res) => {
  try {
    const { studentId, teacherId, course, text, className } = req.body || {};
    const rawText = String(text || "").trim();
    if (!studentId || rawText.length < 10) {
      return res
        .status(400)
        .json({ error: "studentId and a feedback message (10+ chars) are required." });
    }
    // Input length sanitisation
    if (rawText.length > 4000) {
      return res.status(400).json({ error: "Feedback text must be at most 4000 characters." });
    }
    if (String(course || "").length > 120) {
      return res.status(400).json({ error: "Course name too long." });
    }
    // Students may only submit as themselves
    if (req.auth.role === "student" && req.auth.id !== String(studentId).trim()) {
      return res.status(403).json({ error: "Students may only submit feedback as themselves." });
    }

    const student = await resolveStudentProfile(studentId, User);
    const att = typeof student.attendance === "number" ? student.attendance : 0;
    const cfg = await getPortalConfig();
    const gate = Number(cfg.feedbackAttendanceGate ?? 75);
    if (att < gate) {
      return res.status(403).json({
        error: `You need at least ${gate}% attendance to submit feedback. Current: ${att}%.`,
      });
    }

    const { sentiment, summary, source, confidence, score } = await analyzeFeedback(rawText);

    const cls = className || student.className || "";
    const group = parseAcademicGroup(cls);

    const entry = {
      id: crypto.randomUUID(),
      studentId: String(studentId).trim(),
      studentName: student.name,
      teacherId: teacherId || "EMP001",
      course: String(course || "General").slice(0, 120),
      text: rawText,
      sentiment,
      summary,
      source,
      aiSource: source,
      confidence: confidence ?? null,
      score: score ?? null,
      className: group.className,
      yearLevel: group.yearLevel,
      programme: group.programme,
      batch: group.batch,
      displayGroup: group.displayGroup,
      createdAt: new Date().toISOString(),
    };
    try {
      await Feedback.create(entry);
    } catch (e) {
      console.warn("[feedback] mongo write", e.message);
      return res.status(500).json({ error: "Could not save feedback to database." });
    }
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Teacher / admin feedback inbox — Mongo only, paginated
app.get("/api/feedback", requireAuth, async (req, res) => {
  try {
    if (req.auth.role === "student") {
      return res.status(403).json({ error: "Students cannot list all feedback." });
    }
    const { teacherId, yearLevel, batch } = req.query;
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
    const skip = (page - 1) * limit;

    const filter = {};
    if (teacherId) filter.teacherId = String(teacherId);
    if (yearLevel) filter.yearLevel = String(yearLevel);
    if (batch) filter.batch = String(batch);

    const [total, list] = await Promise.all([
      Feedback.countDocuments(filter),
      Feedback.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const items = list.map((m) => ({
      ...m,
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
    }));

    // Stats over the filtered set (not just the page) — capped for safety
    const forStats = await Feedback.find(filter).select("sentiment yearLevel").limit(5000).lean();
    const stats = {
      total,
      good: forStats.filter((f) => f.sentiment === "good").length,
      average: forStats.filter((f) => f.sentiment === "average").length,
      bad: forStats.filter((f) => f.sentiment === "bad").length,
    };

    const byYear = {};
    for (const f of forStats) {
      const y = f.yearLevel || "Unspecified year";
      if (!byYear[y]) byYear[y] = 0;
      byYear[y] += 1;
    }

    res.json({
      items,
      stats,
      byYearLevel: byYear,
      teacherSummary: buildTeacherSummary(items),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/feedback/summary", requireAdmin, async (req, res) => {
  try {
    const { teacherId } = req.query;
    const filter = teacherId ? { teacherId: String(teacherId) } : {};
    const list = await Feedback.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
    res.json(buildTeacherSummary(list));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});


/** Clear feedback (all or by yearLevel) — admin only; removes from MongoDB */
app.delete("/api/feedback", requireAdmin, async (req, res) => {
  try {
    const yearLevel = req.query.yearLevel ? String(req.query.yearLevel) : null;
    const filter = yearLevel && yearLevel !== "All" ? { yearLevel } : {};
    const result = await Feedback.deleteMany(filter);
    await writeAudit(req.auth.id, "feedback.clear", { deleted: result.deletedCount, yearLevel: yearLevel || "all" });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** Agent-style summaries split by sentiment (good / average / bad) */
app.post("/api/feedback/agent-summarize", requireAdmin, async (req, res) => {
  try {
    const yearLevel = req.body?.yearLevel ? String(req.body.yearLevel) : null;
    const filter = {};
    if (yearLevel && yearLevel !== "All") filter.yearLevel = yearLevel;
    if (req.body?.teacherId) filter.teacherId = String(req.body.teacherId);
    const list = await Feedback.find(filter).sort({ createdAt: -1 }).limit(2000).lean();
    const corpus = summarizeFeedbackCorpus(list);
    const buckets = { good: [], average: [], bad: [] };
    for (const f of list) {
      const s = f.sentiment === "good" || f.sentiment === "bad" ? f.sentiment : "average";
      buckets[s].push({
        id: f._id,
        text: f.text,
        studentName: f.studentName,
        cls: f.cls,
        yearLevel: f.yearLevel,
        createdAt: f.createdAt,
      });
    }
    res.json({
      ok: true,
      total: corpus.total,
      good: corpus.good,
      average: corpus.average,
      bad: corpus.bad,
      headline: corpus.headline,
      bullets: corpus.bullets,
      themes: corpus.themes,
      extractiveSummary: corpus.extractiveSummary,
      source: corpus.source,
      buckets: {
        good: { count: buckets.good.length, samples: buckets.good.slice(0, 8) },
        average: { count: buckets.average.length, samples: buckets.average.slice(0, 8) },
        bad: { count: buckets.bad.length, samples: buckets.bad.slice(0, 8) },
      },
      yearLevel: yearLevel || "All",
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Agent summarize failed" });
  }
});


app.post("/api/feedback/nlp-test", requireAdmin, (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not available in production." });
  }
  const samples = req.body?.samples || [
    "Sir explains concepts very clearly and clears all doubts.",
    "Teaching is excellent and highly recommended.",
    "The lectures are boring and hard to understand.",
    "Worst teaching experience, waste of time.",
    "Class is okay, nothing special.",
    "Not helpful at all and never available for doubts.",
    "Really good teaching with practical examples.",
  ];
  const results = samples.map((text) => {
    const r = scoreFeedbackText(text);
    return { text, ...r, summary: makeOneLineSummary(text, r.sentiment) };
  });
  res.json({ results });
});

// ---------- ML prediction proxy (Random Forest service on :8001) ----------
const ML_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8001";

app.get("/api/ml/health", async (_req, res) => {
  try {
    const r = await fetch(`${ML_URL}/health`);
    const data = await r.json();
    res.json({ ok: true, ml: data });
  } catch (e) {
    res.status(503).json({ ok: false, error: "ML service unreachable", detail: String(e.message || e) });
  }
});

app.get("/api/ml/metrics", async (_req, res) => {
  try {
    const r = await fetch(`${ML_URL}/metrics`);
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(503).json({ error: "ML service unreachable" });
  }
});

app.get("/api/ml/model-health", async (_req, res) => {
  try {
    const r = await fetch(`${ML_URL}/model-health`);
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(503).json({ error: "ML service unreachable", detail: String(e.message || e) });
  }
});

app.get("/api/ml/mlops/registry", async (_req, res) => {
  try {
    const r = await fetch(`${ML_URL}/mlops/registry`);
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(503).json({ error: "ML service unreachable" });
  }
});

app.post("/api/ml/mlops/promote", async (req, res) => {
  try {
    const r = await fetch(`${ML_URL}/mlops/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(503).json({ error: "ML service unreachable" });
  }
});

app.post("/api/ml/mlops/rollback", async (req, res) => {
  try {
    const r = await fetch(`${ML_URL}/mlops/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(503).json({ error: "ML service unreachable" });
  }
});

app.post("/api/ml/predict", async (req, res) => {
  try {
    const r = await fetch(`${ML_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(503).json({ error: "ML service unreachable", detail: String(e.message || e) });
  }
});

app.post("/api/ml/predict/batch", async (req, res) => {
  try {
    const r = await fetch(`${ML_URL}/predict/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || []),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(503).json({ error: "ML service unreachable", detail: String(e.message || e) });
  }
});

app.post("/api/ml/explain", async (req, res) => {
  try {
    const r = await fetch(`${ML_URL}/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(503).json({ error: "ML service unreachable", detail: String(e.message || e) });
  }
});


// ---------- Parent messaging: email | sms | whatsapp ----------
// Email: Brevo (default). SMS + WhatsApp: Twilio (set TWILIO_* to enable).
// Later you can drop Brevo and route email elsewhere; channel API stays the same.

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL || "";
const BREVO_FROM_NAME = process.env.BREVO_FROM_NAME || "BVU Portal";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_SMS_FROM = process.env.TWILIO_SMS_FROM || ""; // +1... or messaging service SID
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || ""; // e.g. whatsapp:+14155238886
const MESSAGE_DRY_RUN = String(process.env.MESSAGE_DRY_RUN || "") === "1";

function twilioConfigured() {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);
}

async function sendBrevoEmail({ to, subject, text, html, studentPrn, studentName, mode }) {
  if (!BREVO_API_KEY || !BREVO_FROM_EMAIL) {
    const err = new Error("Email not configured — set BREVO_API_KEY and BREVO_FROM_EMAIL");
    err.status = 503;
    throw err;
  }
  const payload = {
    sender: { name: BREVO_FROM_NAME, email: BREVO_FROM_EMAIL },
    to: [{ email: String(to).trim(), name: studentName ? `Parent of ${studentName}` : undefined }],
    subject: String(subject || "BVU Portal update"),
    textContent: String(text),
    htmlContent: html
      ? String(html)
      : `<pre style="font-family:Georgia,serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${String(text)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>`,
    tags: ["bvu-portal", mode || "parent-update"].filter(Boolean),
    headers: studentPrn ? { "X-BVU-PRN": String(studentPrn) } : undefined,
  };
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": BREVO_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.message || data.error || "Brevo send failed");
    err.status = r.status;
    err.detail = data;
    throw err;
  }
  return { provider: "brevo", messageId: data.messageId || null, channel: "email" };
}

/** Twilio REST: SMS or WhatsApp */
async function sendTwilioMessage({ channel, to, text }) {
  if (!twilioConfigured()) {
    const err = new Error(
      "Twilio not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_SMS_FROM / TWILIO_WHATSAPP_FROM"
    );
    err.status = 503;
    throw err;
  }
  let from = channel === "whatsapp" ? TWILIO_WHATSAPP_FROM : TWILIO_SMS_FROM;
  if (!from) {
    const err = new Error(
      channel === "whatsapp"
        ? "Set TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886)"
        : "Set TWILIO_SMS_FROM (E.164 number or Messaging Service SID)"
    );
    err.status = 503;
    throw err;
  }

  let toAddr = String(to).trim();
  // Normalize WhatsApp addresses
  if (channel === "whatsapp") {
    if (!toAddr.startsWith("whatsapp:")) toAddr = `whatsapp:${toAddr}`;
    if (!from.startsWith("whatsapp:")) from = `whatsapp:${from}`;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const body = new URLSearchParams({ To: toAddr, From: from, Body: String(text).slice(0, 1500) });
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
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
    const err = new Error(data.message || data.error_message || "Twilio send failed");
    err.status = r.status >= 400 ? r.status : 502;
    err.detail = data;
    throw err;
  }
  return {
    provider: "twilio",
    messageId: data.sid || null,
    channel,
    status: data.status || null,
  };
}

app.get("/api/messages/status", (_req, res) => {
  res.json({
    email: {
      configured: Boolean(BREVO_API_KEY && BREVO_FROM_EMAIL),
      provider: "brevo",
      from: BREVO_FROM_EMAIL || null,
    },
    sms: {
      configured: twilioConfigured() && Boolean(TWILIO_SMS_FROM),
      provider: "twilio",
      from: TWILIO_SMS_FROM || null,
    },
    whatsapp: {
      configured: twilioConfigured() && Boolean(TWILIO_WHATSAPP_FROM),
      provider: "twilio",
      from: TWILIO_WHATSAPP_FROM || null,
    },
    voice: {
      configured: twilioConfigured() && Boolean(process.env.TWILIO_VOICE_FROM || TWILIO_SMS_FROM),
      provider: "twilio",
      from: process.env.TWILIO_VOICE_FROM || TWILIO_SMS_FROM || null,
    },
    parentBot: {
      webhookWhatsapp: "/api/parent-bot/whatsapp",
      webhookSms: "/api/parent-bot/sms",
      keywords: ["attendance", "marks", "help"],
      languages: ["en", "hi"],
      production: true,
    },
    dryRun: MESSAGE_DRY_RUN,
  });
});

app.post("/api/messages/send", requireTeacherGuide, async (req, res) => {
  const clientKey = clientIp(req);
  if (!rateLimit(`msg:${clientKey}`, Number(process.env.MESSAGE_RATE_MAX || 120), 60_000)) {
    return res.status(429).json({
      error: "Too many messages sent from this address. Please wait a minute and try again.",
    });
  }
  const {
    channel: rawChannel,
    to,
    subject,
    text,
    html,
    studentPrn,
    studentName,
    mode,
  } = req.body || {};
  const channel = String(rawChannel || "email").toLowerCase();
  if (!["email", "sms", "whatsapp"].includes(channel)) {
    return res.status(400).json({ error: "channel must be email | sms | whatsapp" });
  }
  if (!to || !text) {
    return res.status(400).json({ error: "to and text are required" });
  }
  const textStr = String(text).slice(0, 4000);
  const subjectStr = subject != null ? String(subject).slice(0, 200) : "";
  const prnStr = studentPrn != null ? String(studentPrn).trim().slice(0, 40) : "";
  const nameStr = studentName != null ? String(studentName).trim().slice(0, 120) : "";
  if (channel === "email" && !subjectStr) {
    return res.status(400).json({ error: "subject is required for email" });
  }

  if (MESSAGE_DRY_RUN) {
    console.log(`[messages:dry-run] channel=${channel} to=${to} prn=${studentPrn || "-"}`);
    return res.json({
      ok: true,
      dryRun: true,
      channel,
      provider: "dry-run",
      messageId: `dry_${Date.now()}`,
      to,
      mode: mode || null,
    });
  }

  try {
    let result;
    if (channel === "email") {
      result = await sendBrevoEmail({ to: String(to).slice(0, 200), subject: subjectStr, text: textStr, html, studentPrn: prnStr, studentName: nameStr, mode });
    } else {
      result = await sendTwilioMessage({ channel, to: String(to).slice(0, 40), text: textStr });
    }
    console.log(
      `[messages] channel=${result.channel} provider=${result.provider} to=${to} prn=${studentPrn || "-"} id=${result.messageId || "?"}`
    );
    if (studentPrn) {
      try {
        const { Notification } = await import("./src/db.js");
        await Notification.create({
          userId: String(studentPrn),
          title: "Parent message sent",
          body: `A ${channel} update was sent regarding your academics.`,
          kind: "parent_message",
        });
      } catch (_) {}
    }
    res.json({ ok: true, ...result, to, mode: mode || null });
  } catch (e) {
    const status = e.status || 502;
    res.status(status).json({
      error: e.message || "Send failed",
      detail: e.detail || undefined,
      channel,
    });
  }
});

/**
 * Bulk parent messages (AI agent / HOD approve-all).
 * Up to 100 items per request; concurrency + small delay for 60+ sends.
 * Env: MESSAGE_RATE_MAX (default 120), MESSAGE_BATCH_CONCURRENCY (5), MESSAGE_BATCH_DELAY_MS (80).
 */
app.post("/api/messages/send-batch", requireTeacherGuide, async (req, res) => {
  const clientKey = clientIp(req);
  const maxPerMin = Number(process.env.MESSAGE_RATE_MAX || 120);
  const concurrency = Math.max(1, Math.min(10, Number(process.env.MESSAGE_BATCH_CONCURRENCY || 5)));
  const delayMs = Math.max(0, Number(process.env.MESSAGE_BATCH_DELAY_MS || 80));

  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawItems.length) {
    return res.status(400).json({ error: "items array is required" });
  }
  if (rawItems.length > 100) {
    return res.status(400).json({ error: "Maximum 100 messages per batch. Split into multiple batches." });
  }

  if (!rateLimit(`msg-batch:${clientKey}`, Math.max(3, Math.floor(maxPerMin / 20)), 60_000)) {
    return res.status(429).json({
      error: "Too many batch sends from this address. Wait a minute and try again.",
    });
  }

  async function sendOne(item, index) {
    const channel = String(item?.channel || "email").toLowerCase();
    const to = item?.to;
    const text = item?.text;
    if (!["email", "sms", "whatsapp"].includes(channel)) {
      return { index, ok: false, error: "Invalid channel", prn: item?.studentPrn || null };
    }
    if (!to || !text) {
      return {
        index,
        ok: false,
        error: "to and text are required",
        prn: item?.studentPrn || null,
        studentName: item?.studentName || null,
      };
    }
    const textStr = String(text).slice(0, 4000);
    const subjectStr = item?.subject != null ? String(item.subject).slice(0, 200) : "";
    const prnStr = item?.studentPrn != null ? String(item.studentPrn).trim().slice(0, 40) : "";
    const nameStr = item?.studentName != null ? String(item.studentName).trim().slice(0, 120) : "";
    if (channel === "email" && !subjectStr) {
      return { index, ok: false, error: "subject is required for email", prn: prnStr, studentName: nameStr };
    }

    if (MESSAGE_DRY_RUN) {
      return {
        index,
        ok: true,
        dryRun: true,
        channel,
        provider: "dry-run",
        messageId: `dry_${Date.now()}_${index}`,
        to: String(to),
        prn: prnStr,
        studentName: nameStr,
      };
    }

    try {
      let result;
      if (channel === "email") {
        result = await sendBrevoEmail({
          to: String(to).slice(0, 200),
          subject: subjectStr,
          text: textStr,
          html: item?.html,
          studentPrn: prnStr,
          studentName: nameStr,
          mode: item?.mode,
        });
      } else {
        result = await sendTwilioMessage({
          channel,
          to: String(to).slice(0, 40),
          text: textStr,
        });
      }
      if (prnStr) {
        try {
          const { Notification } = await import("./src/db.js");
          await Notification.create({
            userId: prnStr,
            title: "Parent message sent",
            body: `A ${channel} update was sent regarding your academics.`,
            kind: "parent_message",
          });
        } catch (_) {}
      }
      return {
        index,
        ok: true,
        ...result,
        to: String(to),
        prn: prnStr,
        studentName: nameStr,
      };
    } catch (e) {
      return {
        index,
        ok: false,
        error: e.message || "Send failed",
        channel,
        prn: prnStr,
        studentName: nameStr,
      };
    }
  }

  const results = new Array(rawItems.length);
  let cursor = 0;

  async function worker() {
    while (cursor < rawItems.length) {
      const i = cursor++;
      if (delayMs > 0 && i > 0) await new Promise((r) => setTimeout(r, delayMs));
      results[i] = await sendOne(rawItems[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, rawItems.length) }, () => worker())
  );

  const sent = results.filter((r) => r?.ok).length;
  const failed = results.filter((r) => r && !r.ok).length;
  console.log(`[messages:batch] total=${rawItems.length} sent=${sent} failed=${failed} concurrency=${concurrency}`);
  res.json({
    ok: true,
    total: rawItems.length,
    sent,
    failed,
    dryRun: MESSAGE_DRY_RUN,
    results,
  });
});

// ---------- Parent WhatsApp bot + notify + voice ----------
/** Production WhatsApp inbound (Twilio webhook — no auth; Twilio hits this URL). */
app.post("/api/parent-bot/whatsapp", async (req, res) => {
  try {
    const from = req.body?.From || req.body?.from || "";
    const body = req.body?.Body || req.body?.body || req.body?.text || "";
    const result = await handleParentIncoming({ from, body });
    console.log(
      `[parent-bot:whatsapp] from=${normalizePhone(from)} intent=${result.intent} students=${(result.students || []).length}`
    );
    const reply = String(result.text || buildHelpText()).slice(0, 1500);
    // Reply via TwiML only (do not also REST-send — avoids double messages)
    const escaped = reply
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    res
      .type("text/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
      );
  } catch (e) {
    console.error("[parent-bot:whatsapp]", e);
    res
      .type("text/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Service temporarily unavailable. / सेवा अस्थायी रूप से अनुपलब्ध है।</Message></Response>`
      );
  }
});

/** Production SMS inbound (Twilio webhook). */
app.post("/api/parent-bot/sms", async (req, res) => {
  try {
    const from = req.body?.From || req.body?.from || "";
    const body = req.body?.Body || req.body?.body || req.body?.text || "";
    const result = await handleParentIncoming({ from, body });
    console.log(
      `[parent-bot:sms] from=${normalizePhone(from)} intent=${result.intent} students=${(result.students || []).length}`
    );
    const reply = String(result.text || buildHelpText()).slice(0, 1500);
    const escaped = reply
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    res
      .type("text/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
      );
  } catch (e) {
    console.error("[parent-bot:sms]", e);
    res
      .type("text/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Service temporarily unavailable.</Message></Response>`
      );
  }
});

/** Live parent-bot health for HOD / System Admin. */
app.get("/api/parent-bot/status", requireTeacherGuide, async (_req, res) => {
  try {
    const dry =
      MESSAGE_DRY_RUN ||
      ["1", "true", "yes"].includes(String(process.env.MESSAGE_DRY_RUN || "").trim().toLowerCase());
    const bgCount = await StudentBackground.countDocuments({
      $or: [
        { parentMobile: { $exists: true, $nin: [null, ""] } },
        { parentWhatsapp: { $exists: true, $nin: [null, ""] } },
        { studentMobile: { $exists: true, $nin: [null, ""] } },
      ],
    }).catch(() => 0);
    res.json({
      ok: true,
      mode: dry ? "dry-run" : "live",
      webhooks: {
        whatsapp: "/api/parent-bot/whatsapp",
        sms: "/api/parent-bot/sms",
      },
      keywords: ["attendance", "marks", "help"],
      languages: ["en", "hi"],
      twilio: {
        account: Boolean(process.env.TWILIO_ACCOUNT_SID),
        whatsappFrom: TWILIO_WHATSAPP_FROM || null,
        smsFrom: TWILIO_SMS_FROM || null,
        whatsappReady: twilioConfigured() && Boolean(TWILIO_WHATSAPP_FROM),
        smsReady: twilioConfigured() && Boolean(TWILIO_SMS_FROM),
      },
      parentsWithPhone: bgCount,
      note:
        "Point Twilio WhatsApp/SMS 'A MESSAGE COMES IN' webhook to https://YOUR_PUBLIC_HOST/api/parent-bot/whatsapp (or /sms). Parent numbers must be saved under Contact details.",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/parent-bot/simulate", requireTeacherGuide, async (req, res) => {
  try {
    const from = req.body?.from || req.body?.phone || "";
    const body = req.body?.body || req.body?.text || "";
    const result = await handleParentIncoming({ from, body });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/parent-bot/notify-preview", requireTeacherGuide, async (req, res) => {
  try {
    const { AcademicRecord } = await import("./src/db.js");
    const prn = String(req.body?.prn || "").trim();
    const mode = req.body?.mode || "full";
    if (!prn) return res.status(400).json({ error: "prn required" });
    const student = await AcademicRecord.findOne({ prn }).lean();
    if (!student) return res.status(404).json({ error: "Student not found in cohort" });
    const text = buildParentNotifyText(student, { mode });
    res.json({ ok: true, prn, phone: student.phone || null, text, languages: ["en", "hi"] });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/parent-bot/notify", requireTeacherGuide, async (req, res) => {
  try {
    const { AcademicRecord } = await import("./src/db.js");
    const prn = String(req.body?.prn || "").trim();
    const channel = String(req.body?.channel || "whatsapp").toLowerCase();
    const mode = req.body?.mode || "full";
    const placeCall = Boolean(req.body?.placeCall);
    if (!prn) return res.status(400).json({ error: "prn required" });
    const student = await AcademicRecord.findOne({ prn }).lean();
    if (!student) return res.status(404).json({ error: "Student not found" });
    const text = buildParentNotifyText(student, { mode });
    const to = req.body?.to || (channel === "email" ? student.email : student.phone);
    if (!to) {
      return res.status(400).json({ error: "No parent contact on student (phone/email)." });
    }
    const results = { text, channel, call: null, message: null };
    if (MESSAGE_DRY_RUN) {
      results.message = { ok: true, dryRun: true, to, channel };
    } else if (channel === "email") {
      results.message = await sendBrevoEmail({
        to, subject: `BVU academic update — ${student.name || prn}`, text,
        studentPrn: prn, studentName: student.name, mode,
      });
    } else {
      results.message = await sendTwilioMessage({ channel, to, text });
    }
    if (placeCall) {
      const voiceFrom = process.env.TWILIO_VOICE_FROM || TWILIO_SMS_FROM;
      const short =
        `Hello, this is Bharati Vidyapeeth portal. Update for ${student.name || "your ward"}. ` +
        `Attendance ${student.attendance != null ? student.attendance + " percent" : "not available"}. ` +
        `Please check WhatsApp for marks details.`;
      results.call = await placeAutomatedCall({
        to: student.phone || to,
        messageEn: short,
        accountSid: TWILIO_ACCOUNT_SID,
        authToken: TWILIO_AUTH_TOKEN,
        from: voiceFrom,
        dryRun: MESSAGE_DRY_RUN,
      });
    }
    try {
      await MessageLog.create({
        channel,
        recipient: String(to),
        studentPrn: prn,
        subject: `parent-bot ${mode}`,
        bodyPreview: text.slice(0, 300),
        provider: channel === "email" ? "brevo" : "twilio",
        providerMessageId: results.message?.messageId || null,
        sentBy: req.auth?.id || "parent-bot",
      });
    } catch (_) {}
    res.json({ ok: true, ...results });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e), detail: e.detail });
  }
});


const PORT = process.env.PORT || 4000;

registerPortalRoutes(app);
registerCohortRoutes(app);
registerAdminMasterRoutes(app);
registerPlacementRoutes(app);
registerParentRoutes(app);

function redactMongoUri(uri) {
  if (!uri) return "(not set — using default localhost)";
  try {
    return String(uri).replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
  } catch {
    return "(set)";
  }
}

async function start() {
  // Listen first so Vite proxy does not get ECONNREFUSED while Mongo is connecting.
  await new Promise((resolve) => {
    
// JSON error handler (CORS + unexpected)
app.use((err, req, res, next) => {
  if (!err) return next();
  const msg = err.message || "Server error";
  if (String(msg).includes("CORS")) {
    return res.status(403).json({ error: msg });
  }
  console.error("[api error]", msg);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: IS_PROD ? "Internal server error" : msg });
});

app.listen(PORT, "0.0.0.0", () => {
      console.log(`[backend] listening on http://0.0.0.0:${PORT}`);
      console.log(`[backend] MongoDB target: ${redactMongoUri(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/bvu_portal")}`);
      const emailOn = Boolean(process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL);
      const smsOn = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);
      const waOn = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
      const dry = ["1", "true", "yes"].includes(String(process.env.MESSAGE_DRY_RUN || "").trim().toLowerCase());
      console.log(
        `[backend] Messaging: dryRun=${dry ? "YES (no real sends)" : "OFF (live)"} | email(Brevo)=${emailOn ? "ready" : "missing keys"} | sms(Twilio)=${smsOn ? "ready" : "missing keys"} | whatsapp=${waOn ? "ready" : "missing keys"}`
      );
      if (!dry && !emailOn && !smsOn && !waOn) {
        console.warn("[backend] No Brevo/Twilio keys in .env — agent sends will fail until keys are set.");
      }
      resolve();
    });
  });

  async function wireDatabase() {
    await connectMongo();
    const seed = await seedIfEmpty();
    if (seed.seeded) console.log("[database] Seeded default users", seed);
    await ensureSystemAdmin();
    console.log("[database] System administrator (ADMIN001) ready");
    await ensurePlacementUsers();
    console.log("[database] Placement coordinator (PC001) and head (PH001) ready");
  }

  try {
    await wireDatabase();
  } catch (e) {
    console.error("[database] MongoDB connection failed:", e.message);
    console.error("[database] Will keep retrying every 20s — UI stays up; login works once DB is reachable.");
    const retry = async () => {
      try {
        await wireDatabase();
        console.log("[database] Reconnected after hotspot/network recovery.");
      } catch (err) {
        console.warn("[database] Still offline:", err.message);
        setTimeout(retry, 20000);
      }
    };
    setTimeout(retry, 20000);
  }
}

start().catch((e) => {
  console.error("[backend] fatal start error", e);
  process.exit(1);
});
