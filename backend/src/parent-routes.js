/**
 * Parent portal APIs — phone login, academic + placement summary for linked children.
 * No Twilio required; data is read directly from MongoDB.
 */
import {
  StudentBackground,
  AcademicRecord,
  PlacementProfile,
  Announcement,
  User,
  writeAudit,
  hashPassword,
  verifyPassword,
} from "./db.js";
import { normalizePhone } from "./parent-bot.js";
import { requireAuth, requireTeacherGuide, signParentSession, PARENT_DEFAULT_PASSWORD } from "./auth.js";


async function sendExpoPush(messages) {
  if (!messages.length) return { sent: 0, tickets: [] };
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  const data = await res.json().catch(() => ({}));
  return { sent: messages.length, tickets: data.data || data, status: res.status };
}



async function findLinkedByPhone(phoneRaw) {
  const key = normalizePhone(phoneRaw);
  if (!key || key.length < 10) return { key: null, rows: [] };
  const matchPhone = (p) => {
    const n = normalizePhone(p);
    return n && (n === key || n.endsWith(key) || key.endsWith(n));
  };
  const masters = await StudentBackground.find({})
    .select("prn name parentWhatsapp parentMobile studentMobile studentEmail yearLevel batch")
    .lean();
  const linked = [];
  for (const m of masters) {
    if (matchPhone(m.parentWhatsapp) || matchPhone(m.parentMobile) || matchPhone(m.studentMobile)) {
      linked.push(m);
    }
  }
  if (!linked.length) {
    const academic = await AcademicRecord.find({})
      .select("prn name phone yearLevel batch")
      .lean();
    for (const a of academic) {
      if (matchPhone(a.phone)) {
        linked.push({
          prn: a.prn,
          name: a.name,
          parentMobile: a.phone,
          yearLevel: a.yearLevel,
          batch: a.batch,
        });
      }
    }
  }
  return { key, rows: linked };
}

function parentUserId(phoneKey) {
  return `PARENT_${phoneKey}`;
}

async function ensureParentUser(phoneKey, displayName) {
  const id = parentUserId(phoneKey);
  let user = await User.findOne({ id }).lean();
  if (!user) {
    const { hash, salt } = hashPassword(PARENT_DEFAULT_PASSWORD);
    await User.create({
      id,
      role: "parent",
      passwordHash: hash,
      passwordSalt: salt,
      name: displayName || `Parent ${phoneKey}`,
      phone: phoneKey,
      email: `${id.toLowerCase()}@parents.bvu.local`,
    });
    user = await User.findOne({ id }).lean();
  }
  return user;
}

function safePlacement(p, yearLevel) {
  if (!p) {
    return {
      available: false,
      message: "Placement profile is not filled yet.",
      readinessBand: null,
      domains: [],
      actions: [],
    };
  }
  const yl = String(yearLevel || p.yearLevel || "").toUpperCase();
  const predictionYears = yl === "TY" || yl === "LY";
  return {
    available: true,
    mode: predictionYears ? "prediction" : "preparation",
    readinessBand: p.readinessBand || (p.tadeReadiness != null ? (p.tadeReadiness >= 75 ? "High" : p.tadeReadiness >= 55 ? "Medium" : "Low") : null),
    readinessScore: p.readinessScore ?? p.tadeReadiness ?? null,
    topDomain: p.tadeTopDomain || null,
    domains: Array.isArray(p.tadeDomainSet) ? p.tadeDomainSet.slice(0, 5) : [],
    actions: Array.isArray(p.tadeGapPlan)
      ? p.tadeGapPlan.slice(0, 5).map((x) => (typeof x === "string" ? x : x?.action || x?.text || JSON.stringify(x)))
      : [],
    internshipCount: p.internshipCount ?? p.internships?.length ?? null,
    status: p.status || null,
  };
}

function marksSummary(marks) {
  const list = Array.isArray(marks) ? marks : [];
  return list.slice(0, 15).map((m) => {
    const a = m.assessments || {};
    return {
      subject: m.subject || "Subject",
      ut1: a["UT-1"] ?? a.UT1 ?? null,
      ut2: a["UT-2"] ?? a.UT2 ?? null,
      ut3: a["UT-3"] ?? a.UT3 ?? null,
      average: m.average ?? null,
      percentage: m.percentage ?? null,
    };
  });
}

export function registerParentRoutes(app) {
  /**
   * Parent login: registered mobile + institutional parent password.
   * Body: { phone, password }
   */
  app.post("/api/parent/login", async (req, res) => {
    try {
      const phone = String(req.body?.phone || req.body?.mobile || "").trim();
      const password = String(req.body?.password || "");
      if (!phone || !password) {
        return res.status(400).json({ error: "Mobile number and password are required." });
      }
      const { key, rows } = await findLinkedByPhone(phone);
      if (!key || !rows.length) {
        return res.status(401).json({
          error:
            "No student is linked to this mobile number. Ask the college to save your number under Contact details.",
        });
      }
      if (password !== PARENT_DEFAULT_PASSWORD) {
        // also allow if parent user already has custom password
        const existing = await User.findOne({ id: parentUserId(key) }).lean();
        if (existing) {
          const ok = verifyPassword(
            password,
            existing.passwordHash || existing.password_hash,
            existing.passwordSalt || existing.password_salt
          );
          if (!ok) return res.status(401).json({ error: "Invalid mobile number or password." });
        } else {
          return res.status(401).json({ error: "Invalid mobile number or password." });
        }
      }

      const name = rows[0]?.name ? `Parent of ${rows[0].name}` : `Parent ${key}`;
      await ensureParentUser(key, name);
      const result = await signParentSession(parentUserId(key), key, rows.map((r) => String(r.prn)));
      if (!result.ok) return res.status(401).json({ error: result.error || "Login failed." });
      await writeAudit(parentUserId(key), "auth.parent_login", { phone: key, children: rows.length });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/parent/me", requireAuth, requireParent, async (req, res) => {
    try {
      const phone = req.auth.parentPhone || String(req.auth.id || "").replace(/^PARENT_/, "");
      const { rows } = await findLinkedByPhone(phone);
      res.json({
        role: "parent",
        phone,
        children: rows.map((r) => ({
          prn: r.prn,
          name: r.name,
          yearLevel: r.yearLevel,
          batch: r.batch,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/parent/children", requireAuth, requireParent, async (req, res) => {
    try {
      const phone = req.auth.parentPhone || String(req.auth.id || "").replace(/^PARENT_/, "");
      const { rows } = await findLinkedByPhone(phone);
      const prns = rows.map((r) => String(r.prn));
      const academics = await AcademicRecord.find({ prn: { $in: prns } })
        .select("prn name attendance yearLevel batch cls averagePercentage academicStatus status")
        .lean();
      const byPrn = Object.fromEntries(academics.map((a) => [String(a.prn), a]));
      const children = rows.map((r) => {
        const a = byPrn[String(r.prn)] || {};
        return {
          prn: r.prn,
          name: a.name || r.name,
          yearLevel: a.yearLevel || r.yearLevel,
          batch: a.batch || r.batch,
          cls: a.cls,
          attendance: a.attendance ?? null,
          averagePercentage: a.averagePercentage ?? null,
          status: a.academicStatus || a.status || null,
        };
      });
      res.json({ children, phone });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/parent/children/:prn", requireAuth, requireParent, async (req, res) => {
    try {
      const prn = String(req.params.prn || "").trim();
      const phone = req.auth.parentPhone || String(req.auth.id || "").replace(/^PARENT_/, "");
      const { rows } = await findLinkedByPhone(phone);
      if (!rows.some((r) => String(r.prn) === prn)) {
        return res.status(403).json({ error: "This student is not linked to your mobile number." });
      }
      const academic = await AcademicRecord.findOne({ prn }).lean();
      const placement = await PlacementProfile.findOne({ prn }).lean();
      const marks = marksSummary(academic?.marks);
      res.json({
        prn,
        name: academic?.name || rows.find((r) => String(r.prn) === prn)?.name,
        yearLevel: academic?.yearLevel,
        batch: academic?.batch,
        cls: academic?.cls,
        attendance: academic?.attendance ?? null,
        attendanceKnown: academic?.attendanceKnown,
        averagePercentage: academic?.averagePercentage ?? null,
        status: academic?.academicStatus || academic?.status || null,
        marks,
        placement: safePlacement(placement, academic?.yearLevel),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/parent/notices", requireAuth, requireParent, async (_req, res) => {
    try {
      const list = await Announcement.find({})
        .sort({ createdAt: -1 })
        .limit(30)
        .lean()
        .catch(() => []);
      res.json({
        notices: (list || []).map((n) => ({
          id: String(n.id || n._id),
          title: n.title || "Notice",
          body: n.body || n.message || "",
          createdAt: n.createdAt || n.date || null,
        })),
      });
    } catch (e) {
      res.json({ notices: [] });
    }
  });

  /** Register Expo push token for this parent device (demo + production). */
  app.post("/api/parent/push-token", requireAuth, requireParent, async (req, res) => {
    try {
      const token = String(req.body?.token || req.body?.expoPushToken || "").trim();
      const looksExpo =
        token.startsWith("ExponentPushToken") ||
        token.startsWith("ExpoPushToken") ||
        (token.length > 20 && token.includes("PushToken"));
      if (!token || !looksExpo) {
        return res.status(400).json({
          error: "Valid Expo push token required.",
          receivedPrefix: token ? token.slice(0, 24) : null,
        });
      }
      await User.updateOne(
        { id: req.auth.id },
        { $addToSet: { expoPushTokens: token } }
      );
      res.json({ ok: true, registered: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Demo / staff: create a notice and push to all registered parent devices.
   * Body: { title, body }
   */
  app.post("/api/parent/demo-notify", requireAuth, requireTeacherGuide, async (req, res) => {
    try {
      const title = String(req.body?.title || "BVU Parent update").trim();
      const body = String(req.body?.body || "Please open the Parent app for attendance and marks.").trim();
      const id = `notice_${Date.now()}`;
      await Announcement.findOneAndUpdate(
        { id },
        {
          id,
          title,
          body,
          date: new Date().toISOString(),
          isActive: true,
          createdBy: req.auth.id,
        },
        { upsert: true, new: true }
      );

      const parents = await User.find({ role: "parent", isActive: { $ne: false } })
        .select("id expoPushTokens name phone")
        .lean();
      const messages = [];
      const debugParents = [];
      for (const p of parents) {
        const toks = (p.expoPushTokens || []).filter(Boolean);
        debugParents.push({ id: p.id, name: p.name, tokenCount: toks.length });
        for (const tok of toks) {
          const s = String(tok);
          if (
            s.startsWith("ExponentPushToken") ||
            s.startsWith("ExpoPushToken") ||
            s.includes("PushToken")
          ) {
            messages.push({
              to: s,
              sound: "default",
              title,
              body,
              data: { type: "notice", screen: "Notices" },
            });
          }
        }
      }
      const pushResult = await sendExpoPush(messages);
      res.json({
        ok: true,
        noticeId: id,
        parents: parents.length,
        pushTargets: messages.length,
        parentTokenDebug: debugParents,
        push: pushResult,
        demoTip:
          messages.length === 0
            ? "No parent devices registered yet. In the Parent APK tap Register for HOD push after login."
            : "Push sent via Expo. Check the parent phone.",
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Parent inbox snapshot for demo dashboard */
  app.get("/api/parent/demo-status", requireAuth, requireParent, async (req, res) => {
    try {
      const user = await User.findOne({ id: req.auth.id }).select("expoPushTokens name phone").lean();
      const tokens = user?.expoPushTokens || [];
      res.json({
        ok: true,
        pushRegistered: tokens.length > 0,
        tokenCount: tokens.length,
        features: {
          attendance: true,
          marks: true,
          placement: true,
          notices: true,
          pushNotifications: true,
        },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

function requireParent(req, res, next) {
  if (!req.auth || req.auth.role !== "parent") {
    return res.status(403).json({ error: "Parent access only." });
  }
  next();
}
