/**
 * System Admin APIs: identity roster (PRN+name), background factors, TG profiles.
 */
import {
  StudentBackground,
  PlacementProfile,
  ensureStudentAccounts,
  TgProfile,
  TgAssignment,
  User,
  AcademicRecord,
  Feedback,
  TeacherSubject,
  IntelligenceState,
  MessageLog,
  hashPassword,
  writeAudit,
} from "./db.js";
import {
  normalizeYear,
  inferAdmissionYear,
  cohortIdFromAdmission,
  isPlacementPredictionYear,
} from "./year-cohort.js";
import { requireAuth, requireSystemAdmin, requireAdmin } from "./auth.js";


function normalizePhone(v) {
  if (v == null || v === "") return "";
  let s = String(v).replace(/[\s\-()]/g, "");
  if (s.startsWith("whatsapp:")) s = s.slice("whatsapp:".length);
  return s.slice(0, 20);
}

/** Split full name → first (required), middle (optional), last (required when possible). */
export function parsePersonName(full) {
  const parts = String(full || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "", middleName: "", lastName: "", name: "" };
  if (parts.length === 1) return { firstName: parts[0], middleName: "", lastName: "", name: parts[0] };
  if (parts.length === 2) {
    return { firstName: parts[0], middleName: "", lastName: parts[1], name: `${parts[0]} ${parts[1]}` };
  }
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
    name: parts.join(" "),
  };
}

function composeName(firstName, middleName, lastName, fallback) {
  const bits = [firstName, middleName, lastName].map((x) => String(x || "").trim()).filter(Boolean);
  if (bits.length) return bits.join(" ");
  return String(fallback || "").trim();
}

function numOrNull(v) {
  if (v == null || v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function flagsFromBody(b) {
  return {
    hasTenth: b.tenthPercent != null && b.tenthPercent !== "",
    hasTwelfth: b.twelfthPercent != null && b.twelfthPercent !== "",
    hasDiploma: b.diplomaPercent != null && b.diplomaPercent !== "",
    hasCet: b.cetScore != null && b.cetScore !== "",
    hasJee: b.jeeScore != null && b.jeeScore !== "",
  };
}

function pickBackground(body, prn, name) {
  const tenthPercent = numOrNull(body.tenthPercent);
  const twelfthPercent = numOrNull(body.twelfthPercent);
  const diplomaPercent = numOrNull(body.diplomaPercent);
  const cetScore = numOrNull(body.cetScore);
  const jeeScore = numOrNull(body.jeeScore);
  const flags = {
    hasTenth: tenthPercent != null,
    hasTwelfth: twelfthPercent != null,
    hasDiploma: diplomaPercent != null,
    hasCet: cetScore != null,
    hasJee: jeeScore != null,
  };

  let firstName = body.firstName != null ? String(body.firstName).trim() : undefined;
  let middleName = body.middleName != null ? String(body.middleName).trim() : undefined;
  let lastName = body.lastName != null ? String(body.lastName).trim() : undefined;
  const fullIn = name != null ? String(name).trim() : body.name != null ? String(body.name).trim() : undefined;

  if ((!firstName || !lastName) && fullIn) {
    const parsed = parsePersonName(fullIn);
    if (!firstName) firstName = parsed.firstName;
    if (middleName === undefined) middleName = parsed.middleName;
    if (!lastName) lastName = parsed.lastName;
  }

  const displayName =
    composeName(firstName, middleName, lastName, fullIn) || fullIn || undefined;

  const parentMobile = body.parentMobile != null ? normalizePhone(body.parentMobile) : undefined;
  let parentWhatsapp =
    body.parentWhatsapp != null ? normalizePhone(body.parentWhatsapp) : undefined;
  if (parentWhatsapp === "" && parentMobile) parentWhatsapp = parentMobile;
  if (parentWhatsapp === undefined && parentMobile) parentWhatsapp = parentMobile;

  const out = {
    prn: String(prn).trim(),
    yearLevel: body.yearLevel || null,
    batch: body.batch || null,
    entryPath: body.entryPath || null,
    tenthPercent,
    twelfthPercent,
    twelfthStream: body.twelfthStream || null,
    diplomaPercent,
    diplomaType: body.diplomaType || null,
    cetScore,
    jeeScore,
    ...flags,
    notes: body.notes != null ? String(body.notes) : undefined,
  };
  if (displayName !== undefined) out.name = displayName;
  if (firstName !== undefined) out.firstName = firstName;
  if (middleName !== undefined) out.middleName = middleName;
  if (lastName !== undefined) out.lastName = lastName;
  if (body.studentMobile != null) out.studentMobile = normalizePhone(body.studentMobile);
  if (parentMobile !== undefined) out.parentMobile = parentMobile;
  if (body.studentEmail != null) out.studentEmail = String(body.studentEmail).trim().slice(0, 120);
  if (parentWhatsapp !== undefined) out.parentWhatsapp = parentWhatsapp;
  // strip undefined
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}


/** Map 0–100 skill to 1–5 portal scale */
function skillToFive(v) {
  const n = numOrNull(v);
  if (n == null) return null;
  if (n <= 5) return n;
  return Math.max(1, Math.min(5, Math.round(n / 20)));
}

function mapPlacementFeatureRow(r) {
  const prn = String(r.prn || r.PRN || "").trim();
  const name = String(r.name || r["Student Name"] || r.studentName || "").trim();
  const yearRaw = r.yearLevel || r["Current Year"] || r.year || "";
  const yearLevel = normalizeYear(yearRaw) || null;
  const batch = r.batch || r.Batch || null;
  const ssc = numOrNull(r.tenthPercent ?? r["SSC %"] ?? r.ssc);
  const hsc = numOrNull(r.twelfthPercent ?? r["10+2 / Diploma %"] ?? r.hsc);
  const stream = String(r.stream || r["10+2 / Diploma"] || "").trim();
  const entranceExam = String(r.entranceExam || r["Entrance Exam"] || "").trim();
  const entranceScore = numOrNull(r.entranceScore ?? r["Entrance Score"]);
  const cetScore = /CET/i.test(entranceExam) ? entranceScore : numOrNull(r.cetScore);
  const jeeScore = /JEE/i.test(entranceExam) ? entranceScore : numOrNull(r.jeeScore);
  const cgpaFy = numOrNull(r.cgpaFy ?? r["FY CGPA"]);
  const cgpaSy = numOrNull(r.cgpaSy ?? r["SY CGPA"]);
  const cgpaTy = numOrNull(r.cgpaTy ?? r["TY CGPA"]);
  const cgpaLy = numOrNull(r.cgpaLy ?? r["LY CGPA"]);
  const order = { FY: 0, SY: 1, TY: 2, LY: 3 };
  const yi = order[yearLevel] ?? 3;
  let cgpa = null;
  if (yi >= 3 && cgpaLy != null) cgpa = cgpaLy;
  else if (yi >= 2 && cgpaTy != null) cgpa = cgpaTy;
  else if (yi >= 1 && cgpaSy != null) cgpa = cgpaSy;
  else if (cgpaFy != null) cgpa = cgpaFy;

  const nIntern = Math.max(0, Number(r.internshipCount ?? r["No. of Internships"] ?? 0) || 0);
  const internLines = [];
  for (let i = 1; i <= 3; i++) {
    const company = r[`Internship ${i} - Company`] || r[`intern${i}Company`] || "";
    const role = r[`Internship ${i} - Role`] || r[`intern${i}Role`] || "";
    const typ = r[`Internship ${i} - Type`] || r[`intern${i}Type`] || "";
    const months = r[`Internship ${i} - Duration (Months)`] || r[`intern${i}Months`] || "";
    if (role && String(role) !== "-") {
      internLines.push([company, role, typ, months ? `${months}mo` : ""].filter(Boolean).join(" · "));
    }
  }

  const skillC = skillToFive(r.skillC ?? r.C);
  const skillCpp = skillToFive(r.skillCpp ?? r["C++"]);
  const skillDsa = skillToFive(r.skillDsa ?? r["NLDS / Data Structures"]);
  const skillDbms = skillToFive(r.skillDbms ?? r.DBMS);
  const skillAiml = skillToFive(r.skillAiml ?? r.AI ?? r.ML ?? r.Python);
  const skillJava = numOrNull(r["OOM (Java)"] ?? r.skillJava);
  const skillCn = numOrNull(r["Computer Networks"] ?? r.skillCn);

  const customFields = [];
  if (skillJava != null) customFields.push({ key: "skill_java_100", value: String(skillJava) });
  if (skillCn != null) customFields.push({ key: "skill_networks_100", value: String(skillCn) });
  for (const k of ["Python", "AI", "ML", "DL"]) {
    const v = numOrNull(r[k]);
    if (v != null) customFields.push({ key: `skill_${k.toLowerCase()}_100`, value: String(v) });
  }
  if (cgpaFy != null) customFields.push({ key: "cgpa_fy", value: String(cgpaFy) });
  if (cgpaSy != null) customFields.push({ key: "cgpa_sy", value: String(cgpaSy) });
  if (cgpaTy != null) customFields.push({ key: "cgpa_ty", value: String(cgpaTy) });
  if (cgpaLy != null) customFields.push({ key: "cgpa_ly", value: String(cgpaLy) });

  return {
    prn,
    name,
    yearLevel,
    batch: batch != null ? String(batch) : null,
    tenthPercent: ssc,
    twelfthPercent: stream.toUpperCase().includes("DIPLOMA") ? null : hsc,
    diplomaPercent: stream.toUpperCase().includes("DIPLOMA") ? hsc : null,
    cetScore,
    jeeScore,
    cgpa,
    skillC,
    skillCpp,
    skillDsa,
    skillDbms,
    skillAiml,
    skillTags: [stream, entranceExam].filter(Boolean).join("; "),
    internships: internLines.join("\n"),
    internshipCount: nIntern || internLines.length,
    customFields,
    // raw for TADE
    _tade: {
      year: yearLevel,
      yearLevel,
      tenthPercent: ssc,
      twelfthPercent: hsc,
      diplomaPercent: stream.toUpperCase().includes("DIPLOMA") ? hsc : null,
      entrance_score: entranceScore,
      entrance_exam: entranceExam || null,
      stream,
      cgpa_fy: cgpaFy,
      cgpa_sy: cgpaSy,
      cgpa_ty: cgpaTy,
      cgpa_ly: cgpaLy,
      cgpa,
      skillC: numOrNull(r.C) ?? (skillC != null ? skillC * 20 : null),
      skillCpp: numOrNull(r["C++"]) ?? (skillCpp != null ? skillCpp * 20 : null),
      skillJava: skillJava,
      skillDsa: numOrNull(r["NLDS / Data Structures"]) ?? (skillDsa != null ? skillDsa * 20 : null),
      skillDbms: numOrNull(r.DBMS) ?? (skillDbms != null ? skillDbms * 20 : null),
      skillCn: skillCn,
      skillPython: numOrNull(r.Python),
      skillAi: numOrNull(r.AI),
      skillMl: numOrNull(r.ML),
      skillDl: numOrNull(r.DL),
      n_internships: nIntern || internLines.length,
      internships: [1, 2, 3]
        .map((i) => ({
          role: r[`Internship ${i} - Role`],
          type: r[`Internship ${i} - Type`],
          months: numOrNull(r[`Internship ${i} - Duration (Months)`]),
        }))
        .filter((x) => x.role && String(x.role) !== "-"),
    },
  };
}

async function callMlTade(path, body) {
  const base = (process.env.ML_SERVICE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    return await res.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
}


export function registerAdminMasterRoutes(app) {
  /** List / search master roster + background */
  app.get("/api/admin-master/students", requireAuth, requireSystemAdmin, async (req, res) => {
    try {
      const year = req.query.year || null;
      const q = {};
      if (year && year !== "All") q.yearLevel = String(year).toUpperCase();
      const rows = await StudentBackground.find(q).sort({ prn: 1 }).lean();
      res.json({ students: rows, count: rows.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Flexible master import: PRN + name required; contacts + 10th/12th/CET when present.
   * Extra columns ignored client-side; server only persists known fields.
   */
  app.post("/api/admin-master/roster", requireAuth, requireSystemAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.students) ? req.body.students : [];
      let upserted = 0;
      let skipped = 0;
      for (const r of rows) {
        const prn = String(r.prn || "").trim();
        if (!prn) {
          skipped += 1;
          continue;
        }
        const patch = pickBackground(r, prn, r.name);
        if (!patch.name && !patch.firstName) {
          skipped += 1;
          continue;
        }
        // Template rule: prefer having first + last when name has 2+ parts
        if (patch.firstName && !patch.lastName && patch.name) {
          const parsed = parsePersonName(patch.name);
          patch.lastName = parsed.lastName || patch.lastName;
          patch.middleName = patch.middleName || parsed.middleName;
        }
        patch.source = r.source || "sysadmin_import";
        patch.updatedBy = req.auth.id;
        delete patch.prn;
        await StudentBackground.findOneAndUpdate(
          { prn },
          { $set: patch, $setOnInsert: { prn } },
          { upsert: true }
        );
        // Mirror phones/email onto AcademicRecord + User for messaging
        const mirror = {};
        if (patch.parentMobile || patch.parentWhatsapp || patch.studentMobile) {
          mirror.phone = patch.parentWhatsapp || patch.parentMobile || patch.studentMobile;
        }
        if (patch.studentEmail) mirror.email = patch.studentEmail;
        // Do not override academic name — contact/register match by PRN only
        if (Object.keys(mirror).length) {
          await AcademicRecord.updateOne({ prn }, { $set: mirror });
        }
        const userMirror = { ...mirror };
        if (patch.name) userMirror.name = patch.name;
        if (Object.keys(userMirror).length) {
          await User.updateOne({ id: prn, role: "student" }, { $set: userMirror });
        }
        upserted += 1;
      }
      await writeAudit(req.auth.id, "admin_master.roster_upload", { upserted, skipped });
      res.json({ ok: true, upserted, skipped });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Student self-service: push profile fields into System Admin master (by PRN). */
  app.put("/api/admin-master/student-self", requireAuth, async (req, res) => {
    try {
      if (req.auth.role !== "student") {
        return res.status(403).json({ error: "Students only." });
      }
      const prn = String(req.auth.id).trim();
      const patch = pickBackground(req.body || {}, prn, req.body?.name);
      delete patch.prn;
      patch.source = "student_self";
      patch.updatedBy = prn;
      const doc = await StudentBackground.findOneAndUpdate(
        { prn },
        { $set: patch, $setOnInsert: { prn } },
        { upsert: true, new: true }
      ).lean();
      const mirror = {};
      if (doc.parentWhatsapp || doc.parentMobile || doc.studentMobile) {
        mirror.phone = doc.parentWhatsapp || doc.parentMobile || doc.studentMobile;
      }
      if (doc.studentEmail) mirror.email = doc.studentEmail;
      if (doc.name) mirror.name = doc.name;
      if (Object.keys(mirror).length) {
        await AcademicRecord.updateOne({ prn }, { $set: mirror });
      }
      await writeAudit(prn, "admin_master.student_self", { prn });
      res.json({ ok: true, student: doc });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Resolve contacts for messaging (any staff). Prefers System Admin master. */
  app.get("/api/admin-master/contacts/:prn", requireAuth, async (req, res) => {
    try {
      const prn = String(req.params.prn).trim();
      const bg = await StudentBackground.findOne({ prn }).lean();
      const ac = await AcademicRecord.findOne({ prn }).lean();
      const parentMobile = bg?.parentMobile || "";
      const parentWhatsapp = bg?.parentWhatsapp || parentMobile || ac?.phone || "";
      res.json({
        prn,
        name: bg?.name || ac?.name || "",
        firstName: bg?.firstName || parsePersonName(bg?.name || ac?.name).firstName,
        middleName: bg?.middleName || "",
        lastName: bg?.lastName || parsePersonName(bg?.name || ac?.name).lastName,
        studentMobile: bg?.studentMobile || "",
        parentMobile,
        parentWhatsapp,
        studentEmail: bg?.studentEmail || ac?.email || "",
        source: bg ? "sysadmin" : ac ? "academic" : null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Patch one student background (partial OK). */
  app.patch("/api/admin-master/students/:prn", requireAuth, requireSystemAdmin, async (req, res) => {
    try {
      const prn = String(req.params.prn).trim();
      const patch = pickBackground(req.body || {}, prn, req.body?.name);
      delete patch.prn;
      if (patch.name === undefined) delete patch.name;
      patch.updatedBy = req.auth.id;
      const doc = await StudentBackground.findOneAndUpdate(
        { prn },
        { $set: patch },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();
      res.json({ ok: true, student: doc });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Bulk patch backgrounds */
  app.put("/api/admin-master/students", requireAuth, requireSystemAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.students) ? req.body.students : [];
      let n = 0;
      for (const r of rows) {
        const prn = String(r.prn || "").trim();
        if (!prn) continue;
        const patch = pickBackground(r, prn, r.name);
        delete patch.prn;
        patch.updatedBy = req.auth.id;
        await StudentBackground.findOneAndUpdate({ prn }, { $set: patch }, { upsert: true });
        const mirror = {};
        if (patch.parentMobile || patch.parentWhatsapp || patch.studentMobile) {
          mirror.phone = patch.parentWhatsapp || patch.parentMobile || patch.studentMobile;
        }
        if (patch.studentEmail) mirror.email = patch.studentEmail;
        // Do not override academic name — contact/register match by PRN only
        if (Object.keys(mirror).length) {
          await AcademicRecord.updateOne({ prn }, { $set: mirror });
        }
        const userMirror = { ...mirror };
        if (patch.name) userMirror.name = patch.name;
        if (Object.keys(userMirror).length) {
          await User.updateOne({ id: prn, role: "student" }, { $set: userMirror });
        }
        n += 1;
      }
      res.json({ ok: true, updated: n });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Background by PRN — available to HOD/ML (read) */
  app.get("/api/admin-master/students/:prn", requireAuth, requireAdmin, async (req, res) => {
    try {
      const doc = await StudentBackground.findOne({ prn: String(req.params.prn).trim() }).lean();
      res.json({ student: doc || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** TG profiles list (merged with User accounts) */
  app.get("/api/tg-profiles", requireAuth, requireAdmin, async (_req, res) => {
    try {
      let rows = await TgProfile.find({}).sort({ index: 1 }).lean();
      if (!rows.length) {
        for (let i = 1; i <= 3; i++) {
          const id = `TG${String(i).padStart(3, "0")}`;
          const u = await User.findOne({ id }).lean();
          await TgProfile.findOneAndUpdate(
            { id },
            { $set: { name: u?.name || `Teacher Guide Mentor ${i}`, index: i, isActive: true } },
            { upsert: true }
          );
        }
        rows = await TgProfile.find({}).sort({ index: 1 }).lean();
      }
      const users = await User.find({ role: "teacher_guide" }).lean();
      const byId = Object.fromEntries(users.map((u) => [u.id, u]));
      const profiles = rows.map((p) => ({
        ...p,
        loginId: p.id,
        hasAccount: !!byId[p.id],
        isActive: p.isActive !== false && byId[p.id]?.isActive !== false,
      }));
      // Include teacher_guide users not yet in TgProfile
      for (const u of users) {
        if (!profiles.find((p) => p.id === u.id)) {
          profiles.push({
            id: u.id,
            loginId: u.id,
            name: u.name,
            index: u.teacherGuideIndex || profiles.length + 1,
            isActive: u.isActive !== false,
            hasAccount: true,
          });
        }
      }
      profiles.sort((a, b) => Number(a.index) - Number(b.index));
      res.json({ profiles });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Create a new Teacher Guide (login id + password + display name) */
  app.post("/api/tg-profiles", requireAuth, requireSystemAdmin, async (req, res) => {
    try {
      let id = String(req.body?.id || req.body?.loginId || "").trim().toUpperCase();
      const name = String(req.body?.name || "").trim();
      const password = String(req.body?.password || "");
      let index = Number(req.body?.index);

      if (!name) return res.status(400).json({ error: "Display name is required." });
      if (!password || password.length < 4) {
        return res.status(400).json({ error: "Password must be at least 4 characters." });
      }

      if (!id) {
        const existing = await TgProfile.find({}).select("id index").lean();
        const users = await User.find({ role: "teacher_guide" }).select("id teacherGuideIndex").lean();
        const nums = [
          ...existing.map((p) => parseInt(String(p.id).replace(/\D/g, ""), 10)),
          ...users.map((u) => parseInt(String(u.id).replace(/\D/g, ""), 10)),
        ].filter((n) => Number.isFinite(n) && n > 0);
        const next = (nums.length ? Math.max(...nums) : 0) + 1;
        id = `TG${String(next).padStart(3, "0")}`;
      }
      if (!/^TG\d{3,}$/i.test(id) && !/^[A-Z][A-Z0-9]{2,15}$/i.test(id)) {
        return res.status(400).json({ error: "Login ID should look like TG004 (letters/numbers, no spaces)." });
      }

      const taken = await User.findOne({ id }).lean();
      if (taken) return res.status(409).json({ error: `Login ID ${id} already exists.` });

      if (!Number.isFinite(index) || index < 1) {
        const maxIdx = await TgProfile.find({}).sort({ index: -1 }).limit(1).lean();
        const maxUser = await User.find({ role: "teacher_guide" }).sort({ teacherGuideIndex: -1 }).limit(1).lean();
        index = Math.max(maxIdx[0]?.index || 0, maxUser[0]?.teacherGuideIndex || 0, 0) + 1;
      }

      const { hash, salt } = hashPassword(password);
      await User.create({
        id,
        role: "teacher_guide",
        passwordHash: hash,
        passwordSalt: salt,
        name,
        email: `${id.toLowerCase()}@bvu.edu.in`,
        teacherGuideIndex: index,
        isActive: true,
      });
      const profile = await TgProfile.findOneAndUpdate(
        { id },
        { $set: { name, index, isActive: true } },
        { upsert: true, new: true }
      ).lean();
      await writeAudit(req.auth.id, "tg_profile.create", { id, index });
      res.json({ ok: true, profile, loginId: id, index });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Commit many TG name / password / active updates */
  app.put("/api/tg-profiles", requireAuth, requireSystemAdmin, async (req, res) => {
    try {
      const list = Array.isArray(req.body?.profiles) ? req.body.profiles : [];
      let updated = 0;
      for (const row of list) {
        const id = String(row.id || row.loginId || "").trim().toUpperCase();
        if (!id) continue;
        const name = String(row.name || "").trim();
        const password = row.password != null && String(row.password).trim() ? String(row.password).trim() : null;
        const isActive = row.isActive != null ? !!row.isActive : undefined;
        const index = row.index != null && Number.isFinite(Number(row.index)) ? Number(row.index) : undefined;

        if (name) {
          await TgProfile.findOneAndUpdate(
            { id },
            { $set: { name, ...(isActive != null ? { isActive } : {}), ...(index != null ? { index } : {}) } },
            { upsert: true }
          );
          const userSet = { name };
          if (isActive != null) userSet.isActive = isActive;
          if (index != null) userSet.teacherGuideIndex = index;
          if (password) {
            const { hash, salt } = hashPassword(password);
            userSet.passwordHash = hash;
            userSet.passwordSalt = salt;
          }
          const u = await User.findOne({ id }).lean();
          if (u) {
            await User.updateOne({ id }, { $set: userSet });
          } else if (password) {
            await User.create({
              id,
              role: "teacher_guide",
              passwordHash: userSet.passwordHash,
              passwordSalt: userSet.passwordSalt,
              name: name || id,
              email: `${id.toLowerCase()}@bvu.edu.in`,
              teacherGuideIndex: index || 1,
              isActive: isActive !== false,
            });
          } else {
            await User.updateOne({ id }, { $set: userSet });
          }
          updated += 1;
        } else if (password) {
          const { hash, salt } = hashPassword(password);
          await User.updateOne(
            { id, role: "teacher_guide" },
            { $set: { passwordHash: hash, passwordSalt: salt } }
          );
          updated += 1;
        }
      }
      await writeAudit(req.auth.id, "tg_profile.bulk_commit", { updated });
      res.json({ ok: true, updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Update TG display name (and User.name for login subtitle) */
  app.patch("/api/tg-profiles/:id", requireAuth, requireSystemAdmin, async (req, res) => {
    try {
      const id = String(req.params.id).trim().toUpperCase();
      const name = String(req.body?.name || "").trim();
      if (!name) return res.status(400).json({ error: "Name is required." });
      const doc = await TgProfile.findOneAndUpdate(
        { id },
        { $set: { name, ...(req.body?.isActive != null ? { isActive: !!req.body.isActive } : {}) } },
        { new: true, upsert: true }
      ).lean();
      await User.updateOne({ id }, { $set: { name } });
      await writeAudit(req.auth.id, "tg_profile.rename", { id, name });
      res.json({ ok: true, profile: doc });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Reassign single student TG (lifetime assignment; rare exception) */
  app.post("/api/tg-assignments/reassign", requireAuth, requireSystemAdmin, async (req, res) => {
    try {
      const prn = String(req.body?.prn || "").trim();
      const tgIndex = Number(req.body?.tgIndex);
      const tgUserId = String(req.body?.tgUserId || `TG${String(tgIndex).padStart(3, "0")}`).toUpperCase();
      if (!prn || !Number.isFinite(tgIndex) || tgIndex < 1) {
        return res.status(400).json({ error: "prn and tgIndex are required." });
      }
      const doc = await TgAssignment.findOneAndUpdate(
        { prn },
        {
          $set: {
            tgIndex,
            tgUserId,
            assignedBy: req.auth.id,
            method: "explicit",
          },
        },
        { upsert: true, new: true }
      ).lean();
      await User.updateOne({ id: prn, role: "student" }, { $set: { teacherGuideIndex: tgIndex } });
      await AcademicRecord.updateOne({ prn }, { $set: { teacherGuideIndex: tgIndex } });
      await writeAudit(req.auth.id, "tg.reassign", { prn, tgIndex, tgUserId });
      res.json({ ok: true, assignment: doc });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * System Admin: bulk placement features Excel (skills, CGPA path, internships).
   * Body: { students: [...], runTade?: boolean, academicYearStart?: number }
   */
  app.post("/api/admin-master/placement-features", requireAuth, requireSystemAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.students) ? req.body.students : [];
      const runTade = req.body?.runTade !== false;
      const academicYearStart = req.body?.academicYearStart || new Date().getFullYear();
      let upserted = 0;
      let skipped = 0;
      let tadeOk = 0;
      const errors = [];
      const mappedList = [];

      for (const raw of rows) {
        const m = mapPlacementFeatureRow(raw);
        if (!m.prn || !m.name) {
          skipped += 1;
          continue;
        }
        mappedList.push(m);
      }

      for (const m of mappedList) {
        try {
          const adm =
            numOrNull(m.admissionYear) ??
            inferAdmissionYear(m.yearLevel || "FY", academicYearStart);
          const cohort = cohortIdFromAdmission(adm, "CSE");

          await StudentBackground.findOneAndUpdate(
            { prn: m.prn },
            {
              $set: {
                name: m.name,
                yearLevel: m.yearLevel,
                batch: m.batch,
                tenthPercent: m.tenthPercent,
                twelfthPercent: m.twelfthPercent,
                diplomaPercent: m.diplomaPercent,
                cetScore: m.cetScore,
                jeeScore: m.jeeScore,
                admissionYear: adm,
                cohortId: cohort,
                source: "sysadmin_placement_features",
                updatedBy: req.auth.id,
              },
              $setOnInsert: { prn: m.prn },
            },
            { upsert: true }
          );

          const existing = await PlacementProfile.findOne({ prn: m.prn }).lean();
          // Merge Excel + existing student form: non-null Excel fills gaps / updates structured fields; never wipe student-only text if Excel empty
          const pick = (excelVal, key) => {
            if (excelVal !== null && excelVal !== undefined && excelVal !== "") return excelVal;
            return existing?.[key] ?? null;
          };
          const mergedCustom = [
            ...((existing && existing.customFields) || []),
            ...(m.customFields || []),
          ];
          // dedupe custom by key (excel wins)
          const cfMap = new Map();
          for (const c of mergedCustom) {
            if (c && c.key) cfMap.set(String(c.key), c);
          }

          const placeSet = {
            name: pick(m.name, "name") || m.name,
            yearLevel: pick(m.yearLevel, "yearLevel"),
            batch: pick(m.batch, "batch"),
            admissionYear: adm,
            cohortId: cohort,
            cgpa: pick(m.cgpa, "cgpa"),
            tenthPercent: pick(m.tenthPercent, "tenthPercent"),
            twelfthPercent: pick(m.twelfthPercent, "twelfthPercent"),
            cetScore: pick(m.cetScore, "cetScore"),
            jeeScore: pick(m.jeeScore, "jeeScore"),
            skillC: pick(m.skillC, "skillC"),
            skillCpp: pick(m.skillCpp, "skillCpp"),
            skillDsa: pick(m.skillDsa, "skillDsa"),
            skillDbms: pick(m.skillDbms, "skillDbms"),
            skillAiml: pick(m.skillAiml, "skillAiml"),
            skillTags: pick(m.skillTags, "skillTags"),
            internships: m.internships || existing?.internships || "",
            internshipCount: m.internshipCount || existing?.internshipCount || 0,
            customFields: Array.from(cfMap.values()),
            shareWithPlacement: true,
            sourceExcel: true,
            updatedBy: req.auth.id,
            status: existing?.status === "verified" || existing?.status === "locked" ? existing.status : "submitted",
            submittedAt: existing?.submittedAt || new Date(),
          };
          // Keep student narrative fields if Excel did not send them
          if (existing?.resumeUrl && !placeSet.resumeUrl) placeSet.resumeUrl = existing.resumeUrl;
          if (existing?.hackathons) placeSet.hackathons = existing.hackathons;
          if (existing?.achievements) placeSet.achievements = existing.achievements;
          if (existing?.buildathons) placeSet.buildathons = existing.buildathons;
          if (existing?.activeKtCount != null) placeSet.activeKtCount = existing.activeKtCount;

          const yearForTade = placeSet.yearLevel || m.yearLevel;
          if (runTade && isPlacementPredictionYear(yearForTade)) {
            try {
              const tade = await callMlTade("/placement/tade/predict", {
                ...m._tade,
                year: yearForTade,
                yearLevel: yearForTade,
              });
              if (tade && tade.top_domain) {
                placeSet.tadeTopDomain = tade.top_domain;
                placeSet.tadeDomainSet = tade.domain_set || [];
                placeSet.tadeReadiness = tade.readiness;
                placeSet.tadeProba = tade.probabilities || {};
                placeSet.tadeSource = tade.source || "tade";
                placeSet.tadeSetSize = (tade.domain_set || []).length;
                placeSet.tadeUncertain = (tade.domain_set || []).length >= 3;
                placeSet.tadeUpdatedAt = new Date();
                if (tade.readiness != null) {
                  placeSet.readinessScore = Math.round(Number(tade.readiness));
                  placeSet.readinessBand =
                    placeSet.readinessScore >= 75 ? "High" : placeSet.readinessScore >= 55 ? "Medium" : "Low";
                }
                tadeOk += 1;
              }
            } catch (te) {
              errors.push({ prn: m.prn, tade: String(te.message || te) });
            }
          }

          await PlacementProfile.findOneAndUpdate(
            { prn: m.prn },
            { $set: placeSet, $setOnInsert: { prn: m.prn } },
            { upsert: true }
          );

          // STRICT: AcademicRecord identity fields from academic upload only.
          // Placement matches by PRN; does not override name/year/batch/marks.
          const existingAc = await AcademicRecord.findOne({ prn: m.prn }).lean();
          if (existingAc) {
            const academicSet = {};
            // Name: only if academic row has no real name yet
            const acName = String(existingAc.name || "").trim();
            if ((!acName || acName === m.prn) && m.name) academicSet.name = m.name;
            if (existingAc.cgpa == null && m.cgpa != null) academicSet.cgpa = m.cgpa;
            if (Object.keys(academicSet).length) {
              await AcademicRecord.updateOne({ prn: m.prn }, { $set: academicSet });
            }
          } else {
            // No academic row yet — thin shell keyed by PRN only (year/marks come later)
            await AcademicRecord.findOneAndUpdate(
              { prn: m.prn },
              {
                $setOnInsert: {
                  prn: m.prn,
                  name: m.name || m.prn,
                  marks: [],
                  subjects: [],
                  attendanceKnown: false,
                  marksKnown: false,
                  ...(m.cgpa != null ? { cgpa: m.cgpa } : {}),
                },
              },
              { upsert: true }
            );
          }

          upserted += 1;
        } catch (rowErr) {
          skipped += 1;
          errors.push({ prn: m.prn, error: String(rowErr.message || rowErr) });
        }
      }

      try {
        await ensureStudentAccounts(mappedList.map((m) => ({ prn: m.prn, name: m.name })));
      } catch {
        /* seed accounts best-effort */
      }

      await writeAudit(req.auth.id, "admin_master.placement_features", {
        upserted,
        skipped,
        tadeOk,
        runTade,
      });
      res.json({
        ok: true,
        upserted,
        skipped,
        tadeScored: tadeOk,
        runTade,
        errors: errors.slice(0, 20),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });


  // ---------- System Admin danger zone (destructive, confirmed on client) ----------
  app.get("/api/admin-master/danger/counts", requireAuth, requireSystemAdmin, async (_req, res) => {
    try {
      const [
        academicRecords,
        studentBackgrounds,
        placementProfiles,
        feedback,
        teacherSubjects,
        tgAssignments,
        studentUsers,
        intelligenceKeys,
        messageLogs,
      ] = await Promise.all([
        AcademicRecord.countDocuments({}),
        StudentBackground.countDocuments({}),
        PlacementProfile.countDocuments({}),
        Feedback.countDocuments({}),
        TeacherSubject.countDocuments({}),
        TgAssignment.countDocuments({}),
        User.countDocuments({ role: "student" }),
        IntelligenceState.countDocuments({}),
        MessageLog.countDocuments({}),
      ]);
      res.json({
        academicRecords,
        studentBackgrounds,
        placementProfiles,
        feedback,
        teacherSubjects,
        tgAssignments,
        studentUsers,
        intelligenceKeys,
        messageLogs,
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /**
   * body.targets = string[] of:
   * academic | roster | placement | feedback | teacherSubjects | tgAssignments |
   * studentUsers | intelligence | messageLogs
   * Confirm token must equal "DELETE"
   */
  app.post("/api/admin-master/danger/purge", requireAuth, requireSystemAdmin, async (req, res) => {
    try {
      const confirm = String(req.body?.confirm || "").trim();
      if (confirm !== "DELETE") {
        return res.status(400).json({
          error: 'Type DELETE in the confirm field to run a purge.',
        });
      }
      const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
      if (!targets.length) {
        return res.status(400).json({ error: "Select at least one data category." });
      }

      const deleted = {};
      const run = async (key, fn) => {
        const r = await fn();
        deleted[key] = r?.deletedCount ?? r?.n ?? 0;
      };

      if (targets.includes("academic")) {
        await run("academicRecords", () => AcademicRecord.deleteMany({}));
      }
      if (targets.includes("roster")) {
        await run("studentBackgrounds", () => StudentBackground.deleteMany({}));
      }
      if (targets.includes("placement")) {
        await run("placementProfiles", () => PlacementProfile.deleteMany({}));
      }
      if (targets.includes("feedback")) {
        await run("feedback", () => Feedback.deleteMany({}));
      }
      if (targets.includes("teacherSubjects")) {
        await run("teacherSubjects", () => TeacherSubject.deleteMany({}));
      }
      if (targets.includes("tgAssignments")) {
        await run("tgAssignments", () => TgAssignment.deleteMany({}));
      }
      if (targets.includes("studentUsers")) {
        await run("studentUsers", () => User.deleteMany({ role: "student" }));
      }
      if (targets.includes("intelligence")) {
        await run("intelligenceKeys", () => IntelligenceState.deleteMany({}));
      }
      if (targets.includes("messageLogs")) {
        await run("messageLogs", () => MessageLog.deleteMany({}));
      }

      await writeAudit(req.auth.id, "admin_master.danger_purge", { targets, deleted });
      res.json({ ok: true, deleted, targets });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });


}
