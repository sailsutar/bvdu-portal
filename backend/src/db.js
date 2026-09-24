import "./loadEnv.js";
/**
 * MongoDB connection and models for the university portal.
 * Set MONGODB_URI (default mongodb://127.0.0.1:27017/bvu_portal)
 */
import mongoose from "mongoose";
import crypto from "crypto";

const MONGODB_URI =
  (process.env.MONGODB_URI && process.env.MONGODB_URI.trim()) ||
  "mongodb://127.0.0.1:27017/bvu_portal";

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const check = crypto.scryptSync(String(password), salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(check, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

const userSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    role: {
      type: String,
      required: true,
      enum: ["student", "admin", "system_admin", "teacher_guide", "placement_coordinator", "placement_head", "parent"],
      index: true,
    },
    passwordHash: { type: String, required: true },
    passwordSalt: { type: String, required: true },
    name: { type: String, required: true },
    email: String,
    phone: String,
    className: String,
    teacherGuideIndex: Number,
    attendance: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
    expoPushTokens: { type: [String], default: [] },
  },
  { timestamps: true }
);

const sessionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

const feedbackSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    studentId: { type: String, required: true, index: true },
    studentName: String,
    teacherId: { type: String, index: true },
    course: String,
    text: { type: String, required: true },
    sentiment: String,
    summary: String,
    confidence: Number,
    source: String,
    className: String,
    yearLevel: { type: String, index: true },
    programme: String,
    batch: String,
    displayGroup: String,
  },
  { timestamps: true }
);

const messageLogSchema = new mongoose.Schema(
  {
    channel: String,
    recipient: String,
    studentPrn: String,
    subject: String,
    bodyPreview: String,
    provider: String,
    providerMessageId: String,
    sentBy: String,
  },
  { timestamps: true }
);

const auditSchema = new mongoose.Schema(
  {
    actorId: String,
    action: { type: String, required: true },
    detail: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);


const assignmentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    course: { type: String, default: "General" },
    dueDate: { type: String, required: true },
    createdBy: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const submissionSchema = new mongoose.Schema(
  {
    assignmentId: { type: String, required: true, index: true },
    studentId: { type: String, required: true, index: true },
    studentName: String,
    text: { type: String, default: "" },
    status: { type: String, enum: ["Submitted", "Late", "Draft"], default: "Submitted" },
  },
  { timestamps: true }
);
submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    kind: { type: String, default: "general" },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const settingsSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    emailNotifications: { type: Boolean, default: true },
    smsNotifications: { type: Boolean, default: false },
    weeklyDigest: { type: Boolean, default: true },
    displayName: String,
  },
  { timestamps: true }
);


const academicRecordSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, unique: true, index: true },
    name: String,
    cls: String,
    className: String,
    yearLevel: { type: String, index: true },
    /** Calendar year student first entered FY (stable for life of PRN) */
    admissionYear: { type: Number, default: null, index: true },
    /** e.g. CSE-2024-2028 — intake cohort, does not change on promotion */
    cohortId: { type: String, default: null, index: true },
    /** [{ yearLevel, at, note }] */
    yearHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    batch: { type: String, index: true },
    email: String,
    phone: String,
    attendance: Number,
    attendanceKnown: Boolean,
    labAttendance: Number,
    theoryAttendance: Number,
    subjectAttendance: { type: mongoose.Schema.Types.Mixed, default: [] },
    absentSessions: Number,
    scheduledSessions: Number,
    bunkRate: Number,
    reportFrom: String,
    reportTo: String,
    source: String,
    cgpa: Number,
    cgpaKnown: Boolean,
    averagePercentage: Number,
    averagePercentageComputed: Boolean,
    backlogs: Number,
    status: String,
    academicStatus: String,
    marks: { type: mongoose.Schema.Types.Mixed, default: [] },
    subjects: { type: mongoose.Schema.Types.Mixed, default: [] },
    raw: { type: mongoose.Schema.Types.Mixed, default: {} },
    sourceFile: String,
    uploadedBy: String,
    teacherGuideIndex: { type: Number, default: null, index: true },
  },
  { timestamps: true }
);

/** Subject → teacher assignment (HoD managed, permanent until edited) */
const teacherSubjectSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, index: true },
    teacherName: { type: String, required: true },
    yearLevel: { type: String, default: "", index: true },
    batch: { type: String, default: "", index: true },
    assignedBy: String,
  },
  { timestamps: true }
);
// Same subject can have different teachers per year/batch
teacherSubjectSchema.index({ subject: 1, yearLevel: 1, batch: 1 }, { unique: true });

const intelligenceStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: String,
    /** Monotonic version for concurrent HoD + TG writes (last-write-wins with client awareness) */
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

/** Department-wide configurable thresholds and TG settings (single document, key="default") */
const portalConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    feedbackAttendanceGate: { type: Number, default: 75 },
    utPassMark: { type: Number, default: 8 },
    atRiskAttendance: { type: Number, default: 65 },
    atRiskAvgPct: { type: Number, default: 50 },
    atRiskFailRate: { type: Number, default: 0.4 },
    goodAttendance: { type: Number, default: 75 },
    goodAvgPct: { type: Number, default: 72 },
    goodFailRate: { type: Number, default: 0.15 },
    tgBatchSize: { type: Number, default: 20 },
    tgAutoDistribute: { type: Boolean, default: true },
    updatedBy: String,
  },
  { timestamps: true }
);

/** Admin-managed announcements (student dashboard) */
const announcementSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    date: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    createdBy: String,
  },
  { timestamps: true }
);

/** Admin-uploaded timetable slots */
const timetableSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    slots: { type: mongoose.Schema.Types.Mixed, default: [] }, // [{ day, slots: string[] }]
    sourceFile: String,
    updatedBy: String,
  },
  { timestamps: true }
);

/**
 * Explicit student → Teacher Guide assignment.
 * Preferred over auto batch slicing. tgIndex is 1-based (matches User.teacherGuideIndex).
 */
const tgAssignmentSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, unique: true, index: true },
    tgIndex: { type: Number, required: true, index: true },
    tgUserId: String,
    assignedBy: String,
    method: { type: String, enum: ["explicit", "auto"], default: "explicit" },
  },
  { timestamps: true }
);
tgAssignmentSchema.index({ tgIndex: 1, prn: 1 });


/**
 * Master identity + pre-college background (Admin-owned).
 * Partial fields allowed — missing values stay null (never force zeros for ML).
 */
const studentBackgroundSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "" }, // full display name
    admissionYear: { type: Number, default: null, index: true },
    cohortId: { type: String, default: null, index: true },
    firstName: { type: String, default: "" },
    middleName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    studentMobile: { type: String, default: "" },
    parentMobile: { type: String, default: "" },
    studentEmail: { type: String, default: "" },
    parentWhatsapp: { type: String, default: "" }, // defaults to parentMobile when empty
    yearLevel: { type: String, default: null, index: true }, // FY | SY | TY | LY (display/filter only)
    batch: { type: String, default: null },
    entryPath: {
      type: String,
      enum: ["FY_REGULAR", "DSY_DIPLOMA", "DSY_SCIENCE_DIP", "DSY_COMMERCE_DIP", "OTHER"],
      default: undefined,
    },
    tenthPercent: { type: Number, default: null },
    twelfthPercent: { type: Number, default: null },
    twelfthStream: { type: String, default: null }, // science | commerce | arts | null
    diplomaPercent: { type: Number, default: null },
    diplomaType: { type: String, default: null },
    cetScore: { type: Number, default: null },
    jeeScore: { type: Number, default: null },
    hasTenth: { type: Boolean, default: false },
    hasTwelfth: { type: Boolean, default: false },
    hasDiploma: { type: Boolean, default: false },
    hasCet: { type: Boolean, default: false },
    hasJee: { type: Boolean, default: false },
    source: { type: String, default: "admin" },
    notes: { type: String, default: "" },
    updatedBy: String,
  },
  { timestamps: true }
);

/** Editable Teacher Guide display profiles (login id stable). */
const tgProfileSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // TG001
    name: { type: String, required: true },
    index: { type: Number, required: true, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const User = mongoose.models.User || mongoose.model("User", userSchema);
export const Session = mongoose.models.Session || mongoose.model("Session", sessionSchema);
export const Feedback =
  mongoose.models.Feedback || mongoose.model("Feedback", feedbackSchema);
export const MessageLog =
  mongoose.models.MessageLog || mongoose.model("MessageLog", messageLogSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", auditSchema);
export const Assignment =
  mongoose.models.Assignment || mongoose.model("Assignment", assignmentSchema);
export const Submission =
  mongoose.models.Submission || mongoose.model("Submission", submissionSchema);
export const Notification =
  mongoose.models.Notification || mongoose.model("Notification", notificationSchema);
export const UserSettings =
  mongoose.models.UserSettings || mongoose.model("UserSettings", settingsSchema);
export const AcademicRecord =
  mongoose.models.AcademicRecord || mongoose.model("AcademicRecord", academicRecordSchema);
export const IntelligenceState =
  mongoose.models.IntelligenceState || mongoose.model("IntelligenceState", intelligenceStateSchema);
export const PortalConfig =
  mongoose.models.PortalConfig || mongoose.model("PortalConfig", portalConfigSchema);
export const Announcement =
  mongoose.models.Announcement || mongoose.model("Announcement", announcementSchema);
export const Timetable =
  mongoose.models.Timetable || mongoose.model("Timetable", timetableSchema);
export const TgAssignment =
  mongoose.models.TgAssignment || mongoose.model("TgAssignment", tgAssignmentSchema);
export const StudentBackground =
  mongoose.models.StudentBackground || mongoose.model("StudentBackground", studentBackgroundSchema);

/** Student employability / placement profile (student → coordinator → head). */
const placementProfileSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "" },
    yearLevel: { type: String, default: null, index: true },
    admissionYear: { type: Number, default: null, index: true },
    cohortId: { type: String, default: null, index: true },
    yearHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    batch: { type: String, default: null },
    cgpa: { type: Number, default: null },
    degreePercent: { type: Number, default: null },
    activeKtCount: { type: Number, default: 0 },
    ktDetails: { type: String, default: "" },
    tenthPercent: { type: Number, default: null },
    twelfthPercent: { type: Number, default: null },
    cetScore: { type: Number, default: null },
    jeeScore: { type: Number, default: null },
    internships: { type: String, default: "" },
    internshipCount: { type: Number, default: 0 },
    internshipStartSem: { type: Number, default: null },
    hackathons: { type: String, default: "" },
    buildathons: { type: String, default: "" },
    achievements: { type: String, default: "" },
    skillDsa: { type: Number, default: null }, // 1-5
    skillC: { type: Number, default: null },
    skillCpp: { type: Number, default: null },
    skillDbms: { type: Number, default: null },
    skillAiml: { type: Number, default: null },
    skillTags: { type: String, default: "" },
    resumeUrl: { type: String, default: "" },
    customFields: { type: [{ key: String, value: String }], default: [] },
    status: {
      type: String,
      enum: ["draft", "submitted", "returned", "verified", "locked"],
      default: "draft",
      index: true,
    },
    consistency: {
      type: String,
      enum: ["consistent", "inconsistent"],
      default: "consistent",
      index: true,
    },
    completenessScore: { type: Number, default: 0 },
    readinessScore: { type: Number, default: 0 },
    readinessBand: { type: String, default: "Low" },
    gaps: { type: [String], default: [] },
    coordinatorNote: { type: String, default: "" },
    verifiedBy: String,
    verifiedAt: Date,
    submittedAt: Date,
    updatedBy: String,
    shareWithPlacement: { type: Boolean, default: true },
    sourceExcel: { type: Boolean, default: false },
    sourceProfile: { type: Boolean, default: false },
    // TADE (Trajectory-Aware Domain Engine)
    tadeTopDomain: { type: String, default: null },
    tadeDomainSet: { type: [String], default: [] },
    tadeReadiness: { type: Number, default: null },
    tadeProba: { type: Object, default: {} },
    tadeSource: { type: String, default: null },
    tadeSetSize: { type: Number, default: null },
    tadeUncertain: { type: Boolean, default: false },
    tadeUpdatedAt: { type: Date, default: null },
    tadeGapPlan: { type: [Object], default: [] },
    academicStatus: { type: String, default: null },
    academicAttendance: { type: Number, default: null },
  },
  { timestamps: true }
);

export const TgProfile =
  mongoose.models.TgProfile || mongoose.model("TgProfile", tgProfileSchema);
export const PlacementProfile =
  mongoose.models.PlacementProfile || mongoose.model("PlacementProfile", placementProfileSchema);
export const TeacherSubject =
  mongoose.models.TeacherSubject || mongoose.model("TeacherSubject", teacherSubjectSchema);

/** Load or create the single portal config document */
export async function getPortalConfig() {
  let doc = await PortalConfig.findOne({ key: "default" }).lean();
  if (!doc) {
    const created = await PortalConfig.create({ key: "default" });
    doc = created.toObject();
  }
  return doc;
}



let connected = false;

/** Options tuned for mobile hotspot / high-latency links (Atlas or remote). */
export function mongoConnectOptions() {
  return {
    // Wait longer for initial selection — hotspots are slow, not "down"
    serverSelectionTimeoutMS: 45000,
    connectTimeoutMS: 45000,
    socketTimeoutMS: 60000,
    heartbeatFrequencyMS: 15000,
    // Fewer sockets = lighter on weak networks
    maxPoolSize: 5,
    minPoolSize: 0,
    maxIdleTimeMS: 30000,
    // Prefer IPv4 — many mobile networks break IPv6 / SRV dual-stack
    family: 4,
    retryWrites: true,
    retryReads: true,
  };
}

export async function connectMongo(retries = 4) {
  if (connected && mongoose.connection.readyState === 1) return mongoose.connection;
  mongoose.set("strictQuery", true);
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(MONGODB_URI, mongoConnectOptions());
      connected = true;
      console.log(
        `[database] Connected to MongoDB at ${MONGODB_URI.replace(/\/\/.*@/, "//***@")} (attempt ${attempt})`
      );
      return mongoose.connection;
    } catch (e) {
      lastErr = e;
      connected = false;
      const wait = Math.min(15000, 1500 * attempt * attempt);
      console.warn(
        `[database] Connect attempt ${attempt}/${retries} failed: ${e.message}. Retrying in ${wait}ms…`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

export async function findUserById(id) {
  return User.findOne({ id: String(id).trim(), isActive: true }).lean();
}

export async function writeAudit(actorId, action, detail) {
  await AuditLog.create({
    actorId: actorId || null,
    action,
    detail: detail || null,
  });
}

export async function seedIfEmpty() {
  const count = await User.countDocuments();
  if (count > 0) return { seeded: false, count };

  const studentPassword = process.env.STUDENT_DEFAULT_PASSWORD || "abc@123";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const tgPassword = process.env.TEACHER_GUIDE_PASSWORD || "tg123";

  // Students are created on first login (password abc@123) or via roster sync — no demo cohort.


  const admin = hashPassword(adminPassword);
  await User.create({
    id: "EMP001",
    role: "admin",
    passwordHash: admin.hash,
    passwordSalt: admin.salt,
    name: "Dr. Priya Sharma",
    email: "hod.cse@bvu.edu.in",
  });

  for (const g of [
    { id: "TG001", name: "Teacher Guide Mentor 1", index: 1 },
    { id: "TG002", name: "Teacher Guide Mentor 2", index: 2 },
    { id: "TG003", name: "Teacher Guide Mentor 3", index: 3 },
  ]) {
    const pw = hashPassword(tgPassword);
    await User.create({
      id: g.id,
      role: "teacher_guide",
      passwordHash: pw.hash,
      passwordSalt: pw.salt,
      name: g.name,
      email: `${g.id.toLowerCase()}@bvu.edu.in`,
      teacherGuideIndex: g.index,
    });
  }

    const aCount = await Assignment.countDocuments();
  if (aCount === 0) {
    const defaults = [
      {
        id: "asg_001",
        title: "Unit Test 1 preparation worksheet",
        description: "Complete practice questions for weak topics identified from attendance and early marks.",
        course: "Department common",
        dueDate: "2026-09-15",
        createdBy: "EMP001",
      },
      {
        id: "asg_002",
        title: "Course Outcome reflection note",
        description: "Write a short reflection on Course Outcome 1 fundamentals (max 300 words).",
        course: "Department common",
        dueDate: "2026-09-22",
        createdBy: "EMP001",
      },
      {
        id: "asg_003",
        title: "Lab record submission",
        description: "Upload summary of lab experiments completed this fortnight.",
        course: "Laboratory",
        dueDate: "2026-09-30",
        createdBy: "EMP001",
      },
    ];
    await Assignment.insertMany(defaults);
  }

  const sysPw = hashPassword(process.env.SYSTEM_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "admin123");
  await User.create({
    id: "ADMIN001",
    role: "system_admin",
    passwordHash: sysPw.hash,
    passwordSalt: sysPw.salt,
    name: "System Administrator",
    email: "admin@bvu.edu.in",
  });

  for (const g of [
    { id: "TG001", name: "Teacher Guide Mentor 1", index: 1 },
    { id: "TG002", name: "Teacher Guide Mentor 2", index: 2 },
    { id: "TG003", name: "Teacher Guide Mentor 3", index: 3 },
  ]) {
    await TgProfile.findOneAndUpdate(
      { id: g.id },
      { $set: { name: g.name, index: g.index, isActive: true } },
      { upsert: true }
    );
  }

  return { seeded: true, students: 0, admin: 1, systemAdmin: 1, teacherGuides: 3 };

}

/**
 * Ensure uploaded Permanent Registration Numbers get student accounts (password abc@123).
 */
export async function ensureStudentAccounts(studentRows) {
  const password = process.env.STUDENT_DEFAULT_PASSWORD || "abc@123";
  const rows = (studentRows || [])
    .map((s) => ({ ...s, id: String(s.prn || s.id || "").trim() }))
    .filter((s) => s.id);
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const existing = await User.find({ id: { $in: ids } }).lean();
  const have = new Set(existing.map((u) => String(u.id)));
  let created = 0;
  const toCreate = [];
  for (const s of rows) {
    if (have.has(s.id)) {
      const patch = {};
      if (s.name) patch.name = s.name;
      if (typeof s.attendance === "number") patch.attendance = s.attendance;
      if (s.cls || s.className) patch.className = s.cls || s.className;
      if (s.email) patch.email = s.email;
      if (s.phone) patch.phone = s.phone;
      if (Object.keys(patch).length) await User.updateOne({ id: s.id }, { $set: patch });
      continue;
    }
    const { hash, salt } = hashPassword(password);
    toCreate.push({
      id: s.id,
      role: "student",
      passwordHash: hash,
      passwordSalt: salt,
      name: s.name || s.id,
      email: s.email || `${s.id}@bvu.edu.in`,
      className: s.cls || s.className || null,
      phone: s.phone || null,
      attendance: typeof s.attendance === "number" ? s.attendance : null,
    });
  }
  if (toCreate.length) {
    try {
      await User.insertMany(toCreate, { ordered: false });
      created = toCreate.length;
    } catch (e) {
      // partial insert on duplicates
      created = toCreate.length;
    }
  }
  return created;
}

export { MONGODB_URI };


/** Ensure system admin + TG profiles exist even when DB already has users. */
export async function ensureSystemAdmin() {
  const id = "ADMIN001";
  const existing = await User.findOne({ id }).lean();
  if (!existing) {
    const sysPw = hashPassword(process.env.SYSTEM_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "admin123");
    await User.create({
      id,
      role: "system_admin",
      passwordHash: sysPw.hash,
      passwordSalt: sysPw.salt,
      name: "System Administrator",
      email: "admin@bvu.edu.in",
    });
  } else if (existing.role !== "system_admin") {
    await User.updateOne({ id }, { $set: { role: "system_admin" } });
  }
  for (const g of [
    { id: "TG001", name: "Teacher Guide Mentor 1", index: 1 },
    { id: "TG002", name: "Teacher Guide Mentor 2", index: 2 },
    { id: "TG003", name: "Teacher Guide Mentor 3", index: 3 },
  ]) {
    const u = await User.findOne({ id: g.id }).lean();
    const name = u?.name || g.name;
    await TgProfile.findOneAndUpdate(
      { id: g.id },
      { $setOnInsert: { name, index: g.index, isActive: true } },
      { upsert: true }
    );
  }
  return { ok: true };
}


export async function ensurePlacementUsers() {
  const tgPassword = process.env.TEACHER_GUIDE_PASSWORD || "tg123";
  const coordPw = process.env.PLACEMENT_COORDINATOR_PASSWORD || "coord123";
  const headPw = process.env.PLACEMENT_HEAD_PASSWORD || "head123";
  const accounts = [
    { id: "PC001", role: "placement_coordinator", name: "Placement Coordinator", password: coordPw },
    { id: "PH001", role: "placement_head", name: "Placement Head", password: headPw },
  ];
  for (const a of accounts) {
    const existing = await User.findOne({ id: a.id }).lean();
    if (!existing) {
      const { hash, salt } = hashPassword(a.password);
      await User.create({
        id: a.id,
        role: a.role,
        passwordHash: hash,
        passwordSalt: salt,
        name: a.name,
        email: `${a.id.toLowerCase()}@bvu.edu.in`,
        isActive: true,
      });
    } else if (existing.role !== a.role) {
      await User.updateOne({ id: a.id }, { $set: { role: a.role, name: a.name } });
    }
  }
  return { ok: true };
}
