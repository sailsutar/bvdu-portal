/**
 * Academic cohort (full marks) + shared intelligence state in MongoDB.
 * Also: portal config, announcements, timetable, TG assignments.
 */
import crypto from "crypto";
import {
  AcademicRecord,
  PlacementProfile,
  IntelligenceState,
  ensureStudentAccounts,
  writeAudit,
  User,
  Feedback,
  PortalConfig,
  getPortalConfig,
  Announcement,
  Timetable,
  TgAssignment,
  TeacherSubject,
} from "./db.js";
import {
  normalizeYear,
  normalizeBatch,
  parseYearBatch,
  inferAdmissionYear,
  cohortIdFromAdmission,
  nextYear,
  promotionPlan,
} from "./year-cohort.js";
import { requireAuth, requireAdmin, requireTeacherGuide } from "./auth.js";

export function registerCohortRoutes(app) {

  /** Update one student phone/email/attendance on AcademicRecord (parent bot testing) */
  app.patch("/api/cohort/student/:prn", requireAdmin, async (req, res) => {
    try {
      const prn = String(req.params.prn || "").trim();
      if (!prn) return res.status(400).json({ error: "prn required" });
      const { phone, email, name, attendance } = req.body || {};
      const patch = {};
      if (phone != null) patch.phone = String(phone).replace(/\s/g, "").slice(0, 20);
      if (email != null) patch.email = String(email).slice(0, 120);
      if (name != null) patch.name = String(name).slice(0, 120);
      if (typeof attendance === "number") {
        patch.attendance = attendance;
        patch.attendanceKnown = true;
      }
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: "Provide phone, email, name, or attendance" });
      }
      const row = await AcademicRecord.findOneAndUpdate(
        { prn },
        { $set: patch },
        { new: true }
      );
      if (!row) {
        return res.status(404).json({
          error: "No academic record for this PRN. Upload Excel first, then set phone.",
        });
      }
      // Mirror phone onto User account if present
      try {
        await User.findOneAndUpdate(
          { $or: [{ id: prn }, { prn }], role: "student" },
          { $set: { phone: patch.phone || undefined, email: patch.email || undefined } }
        );
      } catch (_) {}
      await writeAudit(req.auth?.id || "admin", "cohort.student.patch", { prn, patch });
      res.json({
        ok: true,
        prn: row.prn,
        name: row.name,
        phone: row.phone,
        email: row.email,
        attendance: row.attendance,
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });


  /** Full student roster with marks — source of truth for the portal */
  app.get("/api/cohort", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(100000, Math.max(1, parseInt(String(req.query.limit || "50000"), 10) || 50000));
      const skip = Math.max(0, parseInt(String(req.query.skip || "0"), 10) || 0);
      const totalCount = await AcademicRecord.countDocuments({});
      const rows = await AcademicRecord.find({}).sort({ cls: 1, name: 1 }).skip(skip).limit(limit).lean();
      const total = await AcademicRecord.countDocuments();
      res.json({
        total,
        limit,
        students: rows.map((r) => ({
          prn: r.prn,
          name: r.name,
          cls: r.cls || r.className,
          className: r.className || r.cls,
          yearLevel: r.yearLevel || null,
          batch: r.batch || null,
          email: r.email,
          phone: r.phone,
          attendance: r.attendance,
          attendanceKnown: r.attendanceKnown,
          subjectAttendance: r.subjectAttendance || [],
          labAttendance: r.labAttendance ?? null,
          theoryAttendance: r.theoryAttendance ?? null,
          absentSessions: r.absentSessions ?? null,
          scheduledSessions: r.scheduledSessions ?? null,
          cgpa: r.cgpa,
          cgpaKnown: r.cgpaKnown,
          averagePercentage: r.averagePercentage,
          averagePercentageComputed: r.averagePercentageComputed,
          backlogs: r.backlogs,
          status: r.status,
          academicStatus: r.academicStatus,
          marks: r.marks || [],
          marksKnown: Array.isArray(r.marks) && r.marks.length > 0,
          subjects: r.subjects || [],
          raw: r.raw || {},
          sourceFile: r.sourceFile,
          teacherGuideIndex: r.teacherGuideIndex ?? null,
          updatedAt: r.updatedAt,
        })),
        count: rows.length,
        source: "mongodb",
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /** Replace/merge cohort from Head of Department upload */
  app.post("/api/cohort/sync", requireAdmin, async (req, res) => {
    try {
      const students = req.body?.students || [];
      if (!Array.isArray(students) || students.length === 0) {
        return res.status(400).json({ error: "students array is required." });
      }
      // Client chunks large cohorts; accept full array in this request (safety soft-cap 500)
      const SAFETY = 500;
      const slice = students.length > SAFETY ? students.slice(0, SAFETY) : students;
      const academicYearStart = req.body?.academicYearStart || new Date().getFullYear();
      const chunkIndex = req.body?.chunkIndex ?? 0;
      const chunkTotal = req.body?.chunkTotal ?? 1;

      const prns = slice.map((s) => String(s.prn || s.id || "").trim()).filter(Boolean);
      const existingRows = await AcademicRecord.find({ prn: { $in: prns } }).lean();
      const existingByPrn = new Map(existingRows.map((r) => [String(r.prn), r]));

      const ops = [];
      for (const s of slice) {
        const prn = String(s.prn || s.id || "").trim();
        if (!prn) continue;
        let yearLevel = s.yearLevel || null;
        let batch = s.batch || null;
        const clsLabel = String(s.cls || s.className || "");
        const existing = existingByPrn.get(prn) || null;
        const incomingMarks = Array.isArray(s.marks) ? s.marks : [];
        const incomingSubjects = Array.isArray(s.subjects) ? s.subjects : [];
        const incomingSubjectAtt = Array.isArray(s.subjectAttendance) ? s.subjectAttendance : [];
        const hasIncomingMarks = incomingMarks.length > 0;
        const hasIncomingAtt =
          s.attendance != null ||
          s.labAttendance != null ||
          incomingSubjectAtt.length > 0;

        const patch = {
          prn,
          name: (s.name && String(s.name).trim()) || existing?.name || prn,
          uploadedBy: req.auth.id,
        };
        const parsed = parseYearBatch({
          yearLevel: yearLevel || s.yearLevel,
          batch: batch || s.batch,
          cls: s.cls || s.className,
          className: s.className,
          section: s.section,
        });
        // Year from THIS academic upload is the only authority for HOD year filters.
        // Placement / contacts must never change these fields afterward.
        if (parsed.year) {
          patch.yearLevel = parsed.year;
          patch.academicYearLocked = true;
          patch.academicYearSource = "academic_upload";
        } else if (yearLevel) {
          const ny = normalizeYear(yearLevel) || yearLevel;
          if (ny) {
            patch.yearLevel = ny;
            patch.academicYearLocked = true;
            patch.academicYearSource = "academic_upload";
          }
        } else if (existing?.academicYearLocked && existing.yearLevel) {
          // Keep locked academic year if this file had no year column
          patch.yearLevel = existing.yearLevel;
          patch.academicYearLocked = true;
        }
        if (parsed.batch) patch.batch = parsed.batch;
        else if (batch) patch.batch = normalizeBatch(batch) || batch;
        else if (existing?.academicYearLocked && existing.batch) patch.batch = existing.batch;

        // Keep cls in sync with academic year so LY never displays as TY
        if (patch.yearLevel && patch.batch) {
          patch.cls = `${patch.yearLevel} CSE ${patch.batch}`;
          patch.className = patch.cls;
        } else if (s.cls || s.className) {
          patch.cls = s.cls || s.className || "";
          patch.className = s.className || s.cls || "";
        } else if (!existing) {
          patch.cls = "";
          patch.className = "";
        }

        const yl = patch.yearLevel || (existing && existing.yearLevel) || null;
        if (!existing) {
          const adm =
            s.admissionYear != null
              ? Number(s.admissionYear)
              : inferAdmissionYear(yl || "FY", academicYearStart);
          patch.admissionYear = adm;
          patch.cohortId = s.cohortId || cohortIdFromAdmission(adm, "CSE");
          patch.yearHistory = [
            { yearLevel: yl || "FY", at: new Date().toISOString(), note: "first_seen_on_upload" },
          ];
        } else if (existing.admissionYear == null && yl) {
          const adm = inferAdmissionYear(yl, academicYearStart);
          patch.admissionYear = adm;
          patch.cohortId = existing.cohortId || cohortIdFromAdmission(adm, "CSE");
        }

        if (s.email) patch.email = s.email;
        if (s.phone) patch.phone = s.phone;
        if (s.sourceFile) patch.sourceFile = s.sourceFile;
        if (s.source) patch.source = s.source;

        if (hasIncomingAtt) {
          if (s.attendance != null) patch.attendance = s.attendance;
          patch.attendanceKnown = Boolean(s.attendanceKnown ?? s.attendance != null);
          if (s.labAttendance != null) patch.labAttendance = s.labAttendance;
          if (s.theoryAttendance != null) patch.theoryAttendance = s.theoryAttendance;
          if (incomingSubjectAtt.length) patch.subjectAttendance = incomingSubjectAtt;
          if (s.absentSessions != null) patch.absentSessions = s.absentSessions;
          if (s.scheduledSessions != null) patch.scheduledSessions = s.scheduledSessions;
          if (s.bunkRate != null) patch.bunkRate = s.bunkRate;
          if (s.reportFrom) patch.reportFrom = s.reportFrom;
          if (s.reportTo) patch.reportTo = s.reportTo;
        }

        if (hasIncomingMarks) {
          patch.marks = incomingMarks;
          if (incomingSubjects.length) patch.subjects = incomingSubjects;
          if (s.averagePercentage != null) {
            patch.averagePercentage = s.averagePercentage;
            patch.averagePercentageComputed = Boolean(s.averagePercentageComputed);
          }
          if (s.cgpa != null) {
            patch.cgpa = s.cgpa;
            patch.cgpaKnown = Boolean(s.cgpaKnown);
          }
          if (s.backlogs != null) patch.backlogs = s.backlogs;
        } else if (!existing) {
          patch.marks = [];
          patch.subjects = [];
        }

        if (s.status || s.academicStatus) {
          patch.status = s.status || s.academicStatus;
          patch.academicStatus = s.academicStatus || s.status;
        }
        if (s.raw && typeof s.raw === "object" && Object.keys(s.raw).length) {
          patch.raw = s.raw;
        }

        ops.push({
          updateOne: {
            filter: { prn },
            update: { $set: patch },
            upsert: true,
          },
        });
      }

      let upserted = 0;
      const BULK = 80;
      for (let i = 0; i < ops.length; i += BULK) {
        const part = ops.slice(i, i + BULK);
        const result = await AcademicRecord.bulkWrite(part, { ordered: false });
        upserted += (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0);
      }

      let createdAccounts = 0;
      try {
        createdAccounts = await ensureStudentAccounts(
          slice.map((s) => ({
            prn: String(s.prn || s.id || "").trim(),
            name: s.name,
          })).filter((x) => x.prn)
        );
      } catch {
        /* best-effort */
      }

      await writeAudit(req.auth.id, "cohort.sync", {
        upserted: ops.length,
        createdAccounts,
        chunkIndex,
        chunkTotal,
        received: slice.length,
      });
      res.json({
        ok: true,
        upserted: ops.length,
        createdAccounts,
        total: slice.length,
        chunkIndex,
        chunkTotal,
        truncated: students.length > SAFETY,
        warning: students.length > SAFETY
          ? `Only first ${SAFETY} of ${students.length} rows processed in this request — use chunked client sync.`
          : undefined,
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /** Clear academic cohort (marks) — does not delete login users unless requested */
  app.delete("/api/cohort", requireAdmin, async (req, res) => {
    try {
      const result = await AcademicRecord.deleteMany({});
      await writeAudit(req.auth.id, "cohort.clear", { deleted: result.deletedCount });
      res.json({ ok: true, deleted: result.deletedCount });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /** Optional: purge non-staff users for a clean slate */
  app.post("/api/admin/reset-students", requireAdmin, async (req, res) => {
    try {
      const users = await User.deleteMany({ role: "student" });
      const records = await AcademicRecord.deleteMany({});
      await writeAudit(req.auth.id, "admin.reset_students", {
        users: users.deletedCount,
        records: records.deletedCount,
      });
      res.json({
        ok: true,
        deletedUsers: users.deletedCount,
        deletedRecords: records.deletedCount,
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /**
   * Shared intelligence key-value. Concurrent writes: last-write-wins with monotonic version.
   * Clients may send expectedVersion; mismatch returns 409 with current value.
   */
  app.get("/api/intelligence/:key", requireAuth, async (req, res) => {
    try {
      const doc = await IntelligenceState.findOne({ key: req.params.key }).lean();
      res.json({
        key: req.params.key,
        value: doc?.value ?? null,
        version: doc?.version ?? 0,
        updatedAt: doc?.updatedAt ?? null,
        updatedBy: doc?.updatedBy ?? null,
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/intelligence/:key", requireTeacherGuide, async (req, res) => {
    try {
      const value = req.body?.value;
      const expectedVersion = req.body?.expectedVersion;
      const existing = await IntelligenceState.findOne({ key: req.params.key }).lean();
      if (
        expectedVersion != null &&
        existing &&
        Number(existing.version) !== Number(expectedVersion)
      ) {
        return res.status(409).json({
          error: "Conflict: intelligence state was updated by another user. Reload and retry.",
          key: req.params.key,
          value: existing.value,
          version: existing.version,
          updatedBy: existing.updatedBy,
          updatedAt: existing.updatedAt,
        });
      }
      const nextVersion = existing ? Number(existing.version || 1) + 1 : 1;
      const doc = await IntelligenceState.findOneAndUpdate(
        { key: req.params.key },
        {
          key: req.params.key,
          value,
          updatedBy: req.auth.id,
          version: nextVersion,
        },
        { upsert: true, new: true }
      );
      res.json({
        ok: true,
        key: doc.key,
        value: doc.value,
        version: doc.version,
        updatedBy: doc.updatedBy,
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ---------- Portal config (thresholds, TG capacity) ----------
  app.get("/api/portal-config", requireAuth, async (_req, res) => {
    try {
      const cfg = await getPortalConfig();
      res.json({ config: cfg });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/portal-config", requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const allowed = [
        "feedbackAttendanceGate",
        "utPassMark",
        "atRiskAttendance",
        "atRiskAvgPct",
        "atRiskFailRate",
        "goodAttendance",
        "goodAvgPct",
        "goodFailRate",
        "tgBatchSize",
        "tgAutoDistribute",
      ];
      const patch = {};
      for (const k of allowed) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      patch.updatedBy = req.auth.id;
      const doc = await PortalConfig.findOneAndUpdate(
        { key: "default" },
        { $set: patch, $setOnInsert: { key: "default" } },
        { upsert: true, new: true }
      );
      await writeAudit(req.auth.id, "portal_config.update", patch);
      res.json({ ok: true, config: doc });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ---------- Announcements (admin-managed; student dashboard) ----------
  app.get("/api/announcements", requireAuth, async (_req, res) => {
    try {
      const list = await Announcement.find({ isActive: true }).sort({ createdAt: -1 }).limit(50).lean();
      res.json({ announcements: list });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/announcements", requireAdmin, async (req, res) => {
    try {
      const title = String(req.body?.title || "").trim().slice(0, 200);
      const body = String(req.body?.body || "").trim().slice(0, 4000);
      const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
      if (!title) return res.status(400).json({ error: "Title is required." });
      const id = `ann_${crypto.randomBytes(4).toString("hex")}`;
      const doc = await Announcement.create({
        id,
        title,
        body,
        date,
        createdBy: req.auth.id,
      });
      await writeAudit(req.auth.id, "announcement.create", { id });
      res.json({ ok: true, announcement: doc });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/announcements/:id", requireAdmin, async (req, res) => {
    try {
      await Announcement.updateOne({ id: req.params.id }, { $set: { isActive: false } });
      await writeAudit(req.auth.id, "announcement.deactivate", { id: req.params.id });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ---------- Timetable ----------
  app.get("/api/timetable", requireAuth, async (_req, res) => {
    try {
      const doc = await Timetable.findOne({ key: "default" }).lean();
      res.json({
        slots: doc?.slots || [],
        sourceFile: doc?.sourceFile || null,
        empty: !doc?.slots?.length,
        message: doc?.slots?.length ? null : "No timetable uploaded",
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/timetable", requireAdmin, async (req, res) => {
    try {
      const slots = Array.isArray(req.body?.slots) ? req.body.slots : [];
      const doc = await Timetable.findOneAndUpdate(
        { key: "default" },
        {
          key: "default",
          slots,
          sourceFile: req.body?.sourceFile || null,
          updatedBy: req.auth.id,
        },
        { upsert: true, new: true }
      );
      await writeAudit(req.auth.id, "timetable.update", { slotDays: slots.length });
      res.json({ ok: true, slots: doc.slots });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ---------- Teacher Guide assignments (explicit + optional auto) ----------
  app.get("/api/tg-assignments", requireAuth, async (req, res) => {
    try {
      const rows = await TgAssignment.find({}).lean();
      res.json({ assignments: rows });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /** Explicit assign: body.assignments = [{ prn, tgIndex }] */
  app.put("/api/tg-assignments", requireAdmin, async (req, res) => {
    try {
      const list = req.body?.assignments || [];
      if (!Array.isArray(list)) {
        return res.status(400).json({ error: "assignments array required." });
      }
      let upserted = 0;
      for (const a of list) {
        const prn = String(a.prn || "").trim();
        const tgIndex = Number(a.tgIndex);
        if (!prn || !Number.isFinite(tgIndex) || tgIndex < 1) continue;
        await TgAssignment.findOneAndUpdate(
          { prn },
          {
            prn,
            tgIndex,
            tgUserId: a.tgUserId || `TG${String(tgIndex).padStart(3, "0")}`,
            assignedBy: req.auth.id,
            method: "explicit",
          },
          { upsert: true, new: true }
        );
        // Keep User + AcademicRecord in sync so TG portal filters correctly
        await User.updateOne({ id: prn, role: "student" }, { $set: { teacherGuideIndex: tgIndex } });
        await AcademicRecord.updateOne({ prn }, { $set: { teacherGuideIndex: tgIndex } });
        upserted += 1;
      }
      await writeAudit(req.auth.id, "tg_assignments.update", { upserted });
      res.json({ ok: true, upserted });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /**
   * Auto-distribute all AcademicRecord PRNs across active Teacher Guides.
   * Uses portalConfig.tgBatchSize when set; otherwise even split.
   */
  app.post("/api/tg-assignments/auto", requireAdmin, async (req, res) => {
    try {
      const tgs = await User.find({ role: "teacher_guide", isActive: true })
        .sort({ teacherGuideIndex: 1 })
        .lean();
      if (!tgs.length) {
        return res.status(400).json({ error: "No Teacher Guide accounts found." });
      }
      const cfg = await getPortalConfig();
      const students = await AcademicRecord.find({}).sort({ cls: 1, name: 1, prn: 1 }).lean();
      const batchSize = Number(cfg.tgBatchSize) > 0 ? Number(cfg.tgBatchSize) : null;
      let upserted = 0;
      for (let i = 0; i < students.length; i++) {
        const prn = students[i].prn;
        let tgIndex;
        if (batchSize) {
          // Fixed batch size: last TG takes remainder
          const idx = Math.min(Math.floor(i / batchSize), tgs.length - 1);
          tgIndex = tgs[idx].teacherGuideIndex ?? idx + 1;
        } else {
          const idx = i % tgs.length;
          tgIndex = tgs[idx].teacherGuideIndex ?? idx + 1;
        }
        const tg = tgs.find((g) => Number(g.teacherGuideIndex) === Number(tgIndex)) || tgs[0];
        await TgAssignment.findOneAndUpdate(
          { prn },
          {
            prn,
            tgIndex: Number(tgIndex),
            tgUserId: tg.id,
            assignedBy: req.auth.id,
            method: "auto",
          },
          { upsert: true, new: true }
        );
        await User.updateOne({ id: prn, role: "student" }, { $set: { teacherGuideIndex: Number(tgIndex) } });
        await AcademicRecord.updateOne({ prn }, { $set: { teacherGuideIndex: Number(tgIndex) } });
        upserted += 1;
      }
      await writeAudit(req.auth.id, "tg_assignments.auto", { upserted, tgCount: tgs.length });
      res.json({ ok: true, upserted, tgCount: tgs.length });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });


  // ---------- Teacher ↔ subject assignment (HoD) ----------
  app.get("/api/teacher-subjects", requireAuth, async (_req, res) => {
    try {
      const rows = await TeacherSubject.find({}).sort({ subject: 1 }).lean();
      res.json({ assignments: rows });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/teacher-subjects", requireAdmin, async (req, res) => {
    try {
      const list = req.body?.assignments || [];
      if (!Array.isArray(list)) return res.status(400).json({ error: "assignments array required" });
      let upserted = 0;
      for (const a of list) {
        const subject = String(a.subject || "").trim().slice(0, 80);
        const teacherName = String(a.teacherName || "").trim().slice(0, 120);
        if (!subject || !teacherName) continue;
        const yearLevel = a.yearLevel ? String(a.yearLevel).slice(0, 20) : "";
        const batch = a.batch ? String(a.batch).slice(0, 10) : "";
        await TeacherSubject.findOneAndUpdate(
          { subject, yearLevel, batch },
          {
            subject,
            teacherName,
            yearLevel,
            batch,
            assignedBy: req.auth.id,
          },
          { upsert: true, new: true }
        );
        upserted += 1;
      }
      await writeAudit(req.auth.id, "teacher_subjects.update", { upserted });
      res.json({ ok: true, upserted });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/teacher-subjects/:subject", requireAdmin, async (req, res) => {
    try {
      const subject = decodeURIComponent(req.params.subject || "");
      const yearLevel = req.query.yearLevel != null ? String(req.query.yearLevel) : "";
      const batch = req.query.batch != null ? String(req.query.batch) : "";
      const q = { subject };
      if (yearLevel !== undefined) q.yearLevel = yearLevel;
      if (batch !== undefined) q.batch = batch;
      await TeacherSubject.deleteOne(q);
      await writeAudit(req.auth.id, "teacher_subjects.delete", { subject, yearLevel, batch });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /** Performance snapshot per assigned teacher (from AcademicRecord marks + attendance) */
  app.get("/api/teacher-performance", requireAuth, async (req, res) => {
    try {
      const year = req.query.yearLevel ? String(req.query.yearLevel) : null;
      const batch = req.query.batch ? String(req.query.batch) : null;
      const [assignmentsAll, studentsAll] = await Promise.all([
        TeacherSubject.find({}).lean(),
        AcademicRecord.find({}).lean(),
      ]);
      const normYear = (raw) => {
        const s = String(raw || "").toUpperCase();
        if (/\b(LY|FINAL|BE|FOURTH|LAST\s*YEAR)\b/.test(s) || s === "LY" || s === "FINAL") return "LY";
        if (/\b(TY|TE|THIRD)\b/.test(s)) return "TY";
        if (/\b(SY|SE|SECOND)\b/.test(s)) return "SY";
        if (/\b(FY|FE|FIRST)\b/.test(s) || s === "FY" || s === "FE") return "FY";
        return null;
      };
const matchYB = (s) => {
        const cls = String(s.cls || s.className || "");
        const yStu = normYear(s.yearLevel) || normYear(cls);
        if (year && year !== "All") {
          const yWant = normYear(year) || String(year).toUpperCase();
          if (yStu !== yWant) return false;
        }
        if (batch && batch !== "All") {
          const b = String(batch).toUpperCase();
          const bm = cls.toUpperCase().match(/\b([A-H])\b/);
          const sb = String(s.batch || (bm ? bm[1] : "")).toUpperCase();
          if (sb !== b) return false;
        }
        return true;
      };
      const students = studentsAll.filter(matchYB);
      const assignments = assignmentsAll.filter((a) => {
        if (year && year !== "All" && a.yearLevel && String(a.yearLevel) !== year) return false;
        if (batch && batch !== "All" && a.batch && String(a.batch) !== batch) return false;
        // Prefer scoped assignments; include unscoped for same subject list
        return true;
      });
      const bySubject = {};
      for (const s of students) {
        for (const m of s.marks || []) {
          const sub = m.subject || "Unknown";
          if (!bySubject[sub]) bySubject[sub] = { scores: [], fails: 0, total: 0, att: [] };
          bySubject[sub].total += 1;
          const pct = m.percentage != null ? Number(m.percentage) : (m.average != null ? (Number(m.average) / 20) * 100 : null);
          if (pct != null && Number.isFinite(pct)) bySubject[sub].scores.push(pct);
          if (m.status === "FAIL") bySubject[sub].fails += 1;
        }
        if (s.attendance != null) {
          // attribute attendance signal to all subjects the student has (proxy for lecture engagement)
          for (const m of s.marks || []) {
            const sub = m.subject || "Unknown";
            if (!bySubject[sub]) bySubject[sub] = { scores: [], fails: 0, total: 0, att: [] };
            bySubject[sub].att.push(Number(s.attendance));
          }
        }
      }
      const subjectsInView = new Set(Object.keys(bySubject));
      const assignmentsScoped = assignments.filter(
        (a) => !subjectsInView.size || subjectsInView.has(a.subject)
      );
      const rows = assignmentsScoped.map((a) => {
        const stats = bySubject[a.subject] || { scores: [], fails: 0, total: 0, att: [] };
        const avgScore = stats.scores.length
          ? Math.round((stats.scores.reduce((x, y) => x + y, 0) / stats.scores.length) * 10) / 10
          : null;
        const avgAtt = stats.att.length
          ? Math.round((stats.att.reduce((x, y) => x + y, 0) / stats.att.length) * 10) / 10
          : null;
        const failRate = stats.total ? stats.fails / stats.total : null;
        let flag = "OK";
        if (avgAtt != null && avgAtt < 70) flag = "Low attendance in cohort for this subject";
        if (avgScore != null && avgScore < 50) flag = "Poor subject performance";
        if (failRate != null && failRate >= 0.35) flag = "High fail rate";
        return {
          subject: a.subject,
          teacherName: a.teacherName,
          yearLevel: a.yearLevel,
          batch: a.batch,
          avgScore,
          avgAttendance: avgAtt,
          failRate: failRate != null ? Math.round(failRate * 1000) / 10 : null,
          n: stats.total,
          flag,
        };
      });
      // Also include unassigned subjects seen in data
      for (const sub of Object.keys(bySubject)) {
        if (!assignments.find((a) => a.subject === sub)) {
          const stats = bySubject[sub];
          const avgScore = stats.scores.length
            ? Math.round((stats.scores.reduce((x, y) => x + y, 0) / stats.scores.length) * 10) / 10
            : null;
          rows.push({
            subject: sub,
            teacherName: "(unassigned)",
            avgScore,
            avgAttendance: stats.att.length
              ? Math.round((stats.att.reduce((x, y) => x + y, 0) / stats.att.length) * 10) / 10
              : null,
            failRate: stats.total ? Math.round((stats.fails / stats.total) * 1000) / 10 : null,
            n: stats.total,
            flag: "Assign a teacher",
          });
        }
      }
      rows.sort((a, b) => (a.avgScore ?? 999) - (b.avgScore ?? 999));
      res.json({ rows, studentCount: students.length });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });


  /**
   * Promote all (or filtered) students one step: FY→SY, SY→TY, TY→LY.
   * Same PRN kept; admissionYear/cohortId unchanged; yearHistory appended.
   * Body: { fromYear: "FY", toYear?: "SY", batch?: "A", dryRun?: true, academicYearStart?: 2026 }
   */
  app.post("/api/cohort/promote-year", requireAdmin, async (req, res) => {
    try {
      const fromYear = normalizeYear(req.body?.fromYear);
      const plan = promotionPlan(fromYear, req.body?.toYear);
      if (!plan.ok) return res.status(400).json({ error: plan.error });
      const { from, to } = plan;
      const batch = req.body?.batch && req.body.batch !== "All" ? String(req.body.batch) : null;
      const dryRun = !!req.body?.dryRun;

      const q = { yearLevel: from };
      if (batch) q.batch = batch;
      const students = await AcademicRecord.find(q).lean();
      const preview = students.slice(0, 20).map((s) => ({
        prn: s.prn,
        name: s.name,
        from: s.yearLevel,
        to,
        admissionYear: s.admissionYear,
        cohortId: s.cohortId,
      }));
      if (dryRun) {
        return res.json({
          ok: true,
          dryRun: true,
          from,
          to,
          count: students.length,
          sample: preview,
        });
      }

      let updated = 0;
      for (const s of students) {
        const hist = Array.isArray(s.yearHistory) ? [...s.yearHistory] : [];
        hist.push({
          yearLevel: to,
          at: new Date().toISOString(),
          note: `promoted_from_${from}`,
          prevYearLevel: from,
        });
        const adm =
          s.admissionYear != null
            ? s.admissionYear
            : inferAdmissionYear(from, req.body?.academicYearStart || new Date().getFullYear());
        const cohort = s.cohortId || cohortIdFromAdmission(adm, "CSE");
        await AcademicRecord.updateOne(
          { prn: s.prn },
          {
            $set: {
              yearLevel: to,
              admissionYear: adm,
              cohortId: cohort,
              yearHistory: hist,
            },
          }
        );
        await PlacementProfile.updateOne(
          { prn: s.prn },
          {
            $set: {
              yearLevel: to,
              admissionYear: adm,
              cohortId: cohort,
            },
            $push: {
              yearHistory: {
                yearLevel: to,
                at: new Date().toISOString(),
                note: `promoted_from_${from}`,
              },
            },
          }
        ).catch(() => {});
        updated += 1;
      }
      await writeAudit(req.auth.id, "cohort.promote_year", { from, to, batch, updated });
      res.json({ ok: true, from, to, batch, updated, sample: preview });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /** Cohort rollup: count by admissionYear × current yearLevel */
  app.get("/api/cohort/longitudinal", requireAdmin, async (_req, res) => {
    try {
      const rows = await AcademicRecord.find({})
        .select("prn name yearLevel batch admissionYear cohortId yearHistory")
        .lean();
      const byCohort = {};
      for (const r of rows) {
        const c = r.cohortId || (r.admissionYear != null ? `Y${r.admissionYear}` : "unknown");
        if (!byCohort[c]) {
          byCohort[c] = {
            cohortId: c,
            admissionYear: r.admissionYear,
            total: 0,
            byYear: { FY: 0, SY: 0, TY: 0, LY: 0 },
          };
        }
        byCohort[c].total += 1;
        const y = normalizeYear(r.yearLevel) || "FY";
        if (byCohort[c].byYear[y] != null) byCohort[c].byYear[y] += 1;
      }
      res.json({
        ok: true,
        cohorts: Object.values(byCohort).sort((a, b) => (b.admissionYear || 0) - (a.admissionYear || 0)),
        totalStudents: rows.length,
        note: "Same PRN moves FY→LY; new admissions create new PRNs under a new admissionYear/cohortId.",
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

}
