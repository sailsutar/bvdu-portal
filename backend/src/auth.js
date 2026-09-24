/**
 * Authentication helpers and Express authorization middleware.
 */
import crypto from "crypto";
import {
  findUserById,
  verifyPassword,
  hashToken,
  hashPassword,
  writeAudit,
  User,
  Session,
} from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "bvu-portal-dev-secret-change-in-production";
const TOKEN_TTL_HOURS = Number(process.env.TOKEN_TTL_HOURS || 12);
const STUDENT_DEFAULT_PASSWORD = process.env.STUDENT_DEFAULT_PASSWORD || "abc@123";
export const PARENT_DEFAULT_PASSWORD = process.env.PARENT_DEFAULT_PASSWORD || "parent123";

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function normalizeRole(role) {
  const r = String(role || "").toLowerCase().replace(/-/g, "_");
  if (r === "tg" || r === "teacher_guide" || r === "teacherguide") return "teacher_guide";
  if (r === "system_admin" || r === "systemadmin" || r === "sysadmin") return "system_admin";
  if (r === "hod" || r === "admin" || r === "head_of_department" || r === "headofdepartment") return "admin";
  if (r === "placement_coordinator" || r === "placementcoordinator" || r === "pc") return "placement_coordinator";
  if (r === "placement_head" || r === "placementhead" || r === "ph" || r === "tpo") return "placement_head";
  if (r === "student") return "student";
  if (r === "parent") return "parent";
  return r;
}

export function publicRole(dbRole) {
  if (dbRole === "teacher_guide") return "tg";
  if (dbRole === "system_admin") return "system_admin";
  if (dbRole === "admin") return "admin";
  if (dbRole === "placement_coordinator") return "placement_coordinator";
  if (dbRole === "placement_head") return "placement_head";
  if (dbRole === "parent") return "parent";
  return "student";
}

/**
 * Students: Permanent Registration Number + password abc@123 (default).
 * Unknown Permanent Registration Number with correct default password is auto-provisioned.
 * Head of Department: EMP001 + admin password.
 * Teacher Guide: TG001–TG003 + teacher guide password.
 */
export async function loginUser(roleInput, id, password) {
  const role = normalizeRole(roleInput);
  const rid = String(id || "").trim();
  const pw = String(password || "");

  if (!rid || !pw) {
    return { ok: false, error: "Identifier and password are required." };
  }

  let user = await findUserById(rid);

  // Auto-create student on first login with institutional default password
  if (!user && role === "student" && pw === STUDENT_DEFAULT_PASSWORD) {
    const { hash, salt } = hashPassword(pw);
    await User.create({
      id: rid,
      role: "student",
      passwordHash: hash,
      passwordSalt: salt,
      name: `Student ${rid}`,
      email: `${rid}@bvu.edu.in`,
    });
    user = await findUserById(rid);
  }

  if (!user || user.role !== role) {
    return { ok: false, error: "Invalid identifier or password." };
  }

  const hash = user.passwordHash || user.password_hash;
  const salt = user.passwordSalt || user.password_salt;
  if (!verifyPassword(pw, hash, salt)) {
    return { ok: false, error: "Invalid identifier or password." };
  }

  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_HOURS * 3600;
  const token = signJwt({
    sub: user.id,
    role: user.role,
    name: user.name,
    tgIndex: user.teacherGuideIndex ?? user.teacher_guide_index,
    exp,
  });

  await Session.create({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(exp * 1000),
  });

  await writeAudit(user.id, "auth.login", { role: user.role });

  return {
    ok: true,
    token,
    session: {
      role: publicRole(user.role),
      id: user.id,
      name: user.name,
      email: user.email,
      tgIndex: user.teacherGuideIndex ?? user.teacher_guide_index ?? null,
      className: user.className || user.class_name || null,
      prn: user.role === "student" ? user.id : undefined,
    },
  };
}

export async function logoutToken(token) {
  if (!token) return;
  await Session.deleteOne({ tokenHash: hashToken(token) });
}

export async function resolveAuth(req) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  const token = bearer || req.headers["x-access-token"] || null;
  if (!token) return null;

  const payload = verifyJwt(token);
  if (!payload?.sub) return null;

  const session = await Session.findOne({ tokenHash: hashToken(token) }).lean();
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }

  const user = await findUserById(payload.sub);
  if (!user) return null;

  return {
    token,
    user,
    role: user.role,
    publicRole: publicRole(user.role),
    id: user.id,
    name: user.name,
    tgIndex: user.teacherGuideIndex ?? user.teacher_guide_index,
  };
}


/** Issue JWT for parent portal (role parent, phone + linked PRNs). */
export async function signParentSession(userId, phoneKey, linkedPrns = []) {
  const user = await findUserById(userId);
  if (!user || user.role !== "parent") {
    return { ok: false, error: "Parent account missing." };
  }
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_HOURS * 3600;
  const token = signJwt({
    sub: user.id,
    role: "parent",
    name: user.name,
    parentPhone: phoneKey,
    linkedPrns: linkedPrns || [],
    exp,
  });
  const tokenHash = hashToken(token);
  await Session.create({
    tokenHash,
    userId: user.id,
    role: "parent",
    expiresAt: new Date(exp * 1000),
  }).catch(() => {});
  return {
    ok: true,
    token,
    session: {
      role: "parent",
      id: user.id,
      name: user.name,
      parentPhone: phoneKey,
      linkedPrns: linkedPrns || [],
    },
  };
}

export function requireAuth(req, res, next) {
  resolveAuth(req)
    .then((auth) => {
      if (!auth) {
        return res.status(401).json({ error: "Authentication required. Please log in." });
      }
      req.auth = auth;
      next();
    })
    .catch((err) => {
      console.error("[auth]", err);
      res.status(500).json({ error: "Authentication service error." });
    });
}

export function requireRoles(...roles) {
  const allowed = roles.map(normalizeRole);
  return (req, res, next) => {
    resolveAuth(req)
      .then((auth) => {
        if (!auth) {
          return res.status(401).json({ error: "Authentication required. Please log in." });
        }
        if (!allowed.includes(auth.role)) {
          return res.status(403).json({
            error: "You do not have permission to perform this action.",
            required: allowed,
            actual: auth.role,
          });
        }
        req.auth = auth;
        next();
      })
      .catch((err) => {
        console.error("[auth]", err);
        res.status(500).json({ error: "Authorization service error." });
      });
  };
}

export const requireAdmin = requireRoles("admin", "system_admin");
export const requireHod = requireRoles("admin");
export const requireSystemAdmin = requireRoles("system_admin");
export const requireTeacherGuide = requireRoles("teacher_guide", "admin", "system_admin");
export const requireStudent = requireRoles("student");
export const requirePlacementCoordinator = requireRoles("placement_coordinator", "placement_head", "admin", "system_admin");
export const requirePlacementHead = requireRoles("placement_head", "admin", "system_admin");
export const requirePlacementStaff = requireRoles("placement_coordinator", "placement_head", "admin", "system_admin");

export function optionalAuth(req, _res, next) {
  resolveAuth(req)
    .then((auth) => {
      req.auth = auth;
      next();
    })
    .catch(() => {
      req.auth = null;
      next();
    });
}
