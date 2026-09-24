/**
 * Production portal routes: assignments, notifications, settings, reports data.
 */
import crypto from "crypto";
import {
  Assignment,
  Submission,
  Notification,
  UserSettings,
  User,
  writeAudit,
  hashPassword,
  findUserById,
} from "./db.js";
import { requireAuth, requireAdmin, requireStudent, requireTeacherGuide } from "./auth.js";

export function registerPortalRoutes(app) {
  // ---------- Assignments ----------
  app.get("/api/assignments", requireAuth, async (req, res) => {
    try {
      const list = await Assignment.find({ isActive: true }).sort({ dueDate: 1 }).lean();
      let submissions = [];
      if (req.auth.role === "student") {
        submissions = await Submission.find({ studentId: req.auth.id }).lean();
      } else {
        submissions = await Submission.find({}).lean();
      }
      const byAsg = {};
      for (const s of submissions) {
        byAsg[s.assignmentId] = byAsg[s.assignmentId] || [];
        byAsg[s.assignmentId].push(s);
      }
      res.json({
        assignments: list.map((a) => {
          const mine =
            req.auth.role === "student"
              ? (byAsg[a.id] || []).find((s) => s.studentId === req.auth.id)
              : null;
          return {
            ...a,
            mySubmission: mine || null,
            submissionCount: (byAsg[a.id] || []).length,
          };
        }),
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/assignments", requireAdmin, async (req, res) => {
    try {
      const { title, description, course, dueDate } = req.body || {};
      if (!title || !dueDate) {
        return res.status(400).json({ error: "Title and due date are required." });
      }
      const id = `asg_${crypto.randomBytes(4).toString("hex")}`;
      const doc = await Assignment.create({
        id,
        title,
        description: description || "",
        course: course || "General",
        dueDate,
        createdBy: req.auth.id,
      });
      await writeAudit(req.auth.id, "assignment.create", { id });
      res.json({ ok: true, assignment: doc });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/assignments/:id/submit", requireStudent, async (req, res) => {
    try {
      const assignmentId = req.params.id;
      const asg = await Assignment.findOne({ id: assignmentId, isActive: true }).lean();
      if (!asg) return res.status(404).json({ error: "Assignment not found." });
      const text = String(req.body?.text || "").trim();
      if (!text) return res.status(400).json({ error: "Submission text is required." });

      const due = new Date(asg.dueDate);
      const late = !Number.isNaN(due.getTime()) && Date.now() > due.getTime() + 86400000;
      const status = late ? "Late" : "Submitted";

      const doc = await Submission.findOneAndUpdate(
        { assignmentId, studentId: req.auth.id },
        {
          assignmentId,
          studentId: req.auth.id,
          studentName: req.auth.name,
          text,
          status,
        },
        { upsert: true, new: true }
      );

      await Notification.create({
        userId: req.auth.id,
        title: `Assignment submitted: ${asg.title}`,
        body: `Status: ${status}.`,
        kind: "assignment",
      });

      res.json({ ok: true, submission: doc });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ---------- Notifications ----------
  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const list = await Notification.find({ userId: req.auth.id })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      res.json({ notifications: list });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
    await Notification.updateMany({ userId: req.auth.id, read: false }, { $set: { read: true } });
    res.json({ ok: true });
  });

  app.post("/api/notifications", requireAdmin, async (req, res) => {
    try {
      const { userId, title, body, kind } = req.body || {};
      if (!userId || !title) {
        return res.status(400).json({ error: "userId and title are required." });
      }
      const n = await Notification.create({
        userId,
        title,
        body: body || "",
        kind: kind || "general",
      });
      res.json({ ok: true, notification: n });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // ---------- Settings ----------
  app.get("/api/settings", requireAuth, async (req, res) => {
    let s = await UserSettings.findOne({ userId: req.auth.id }).lean();
    if (!s) {
      s = {
        userId: req.auth.id,
        emailNotifications: true,
        smsNotifications: false,
        weeklyDigest: true,
        displayName: req.auth.name,
      };
    }
    res.json({ settings: s });
  });

  app.put("/api/settings", requireAuth, async (req, res) => {
    const body = req.body || {};
    const s = await UserSettings.findOneAndUpdate(
      { userId: req.auth.id },
      {
        userId: req.auth.id,
        emailNotifications: Boolean(body.emailNotifications),
        smsNotifications: Boolean(body.smsNotifications),
        weeklyDigest: Boolean(body.weeklyDigest),
        displayName: body.displayName || req.auth.name,
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true, settings: s });
  });

  app.post("/api/settings/password", requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword || String(newPassword).length < 6) {
        return res.status(400).json({
          error: "Current password and a new password of at least 6 characters are required.",
        });
      }
      const user = await findUserById(req.auth.id);
      if (!user) return res.status(404).json({ error: "User not found." });
      const { verifyPassword } = await import("./db.js");
      if (!verifyPassword(currentPassword, user.passwordHash, user.passwordSalt)) {
        return res.status(401).json({ error: "Current password is incorrect." });
      }
      const { hash, salt } = hashPassword(newPassword);
      await User.updateOne(
        { id: req.auth.id },
        { $set: { passwordHash: hash, passwordSalt: salt } }
      );
      await writeAudit(req.auth.id, "auth.password_change", {});
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });
}
