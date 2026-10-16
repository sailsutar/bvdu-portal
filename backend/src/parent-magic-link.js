/**
 * Parent app magic links — passwordless open for one student (or multi-child after redeem).
 * Token is HMAC-signed (JWT_SECRET). No external service required.
 *
 * Env (optional):
 *   PARENT_APP_SCHEME=bvuparent
 *   PARENT_APP_DOWNLOAD_URL=https://…/bvu-parent.apk
 *   PARENT_MAGIC_TTL_DAYS=30
 *   PARENT_PUBLIC_API_BASE=https://api.college.edu   (shown in SMS if set)
 */

import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "change-this-to-a-long-random-string";

/** Local copy to avoid circular import with parent-bot.js */
function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("91")) return digits.slice(-10);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function b64url(input) {
  return Buffer.from(typeof input === "string" ? input : JSON.stringify(input))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signPayload(payload) {
  const header = b64url({ alg: "HS256", typ: "PML" });
  const body = b64url(payload);
  const data = `${header}.${body}`;
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyPayload(token) {
  const parts = String(token || "").trim().split(".");
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
    if (payload.typ !== "parent_magic") return null;
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createParentMagicLink({ prn, parentPhone, studentName = "", days = null } = {}) {
  const phone = normalizePhone(parentPhone);
  const keyPrn = String(prn || "").trim();
  if (!keyPrn) throw new Error("prn required for magic link");
  if (!phone || phone.length < 10) throw new Error("parent phone required for magic link");

  const ttlDays = Number(days || process.env.PARENT_MAGIC_TTL_DAYS || 30);
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, ttlDays) * 86400;
  const token = signPayload({
    typ: "parent_magic",
    prn: keyPrn,
    phone,
    name: studentName || "",
    exp,
  });

  const scheme = (process.env.PARENT_APP_SCHEME || "bvuparent").replace(/:\/\/*$/, "");
  const deepLink = `${scheme}://open?token=${encodeURIComponent(token)}`;
  const downloadUrl = String(process.env.PARENT_APP_DOWNLOAD_URL || "").trim();
  const apiBase = String(process.env.PARENT_PUBLIC_API_BASE || process.env.PUBLIC_API_BASE || "").replace(/\/$/, "");

  const lines = [
    "Open the BVU Parent app (no typing login for this student):",
    deepLink,
  ];
  if (downloadUrl) {
    lines.push("", `If the app is not installed, download: ${downloadUrl}`, "Then open the link above again.");
  }
  lines.push(
    "",
    "ऐप में बिना लॉगिन इस छात्र की जानकारी देखें — ऊपर दिए लिंक पर टैप करें।",
    `Link valid ~${ttlDays} days. Do not forward to others.`
  );

  return {
    token,
    deepLink,
    downloadUrl: downloadUrl || null,
    apiBase: apiBase || null,
    prn: keyPrn,
    parentPhone: phone,
    expiresAt: new Date(exp * 1000).toISOString(),
    messageFooter: lines.join("\n"),
  };
}

export function verifyParentMagicToken(token) {
  return verifyPayload(token);
}

/**
 * Append magic-link footer to an existing notify body when contacts allow it.
 */
export function appendMagicLinkFooter(text, student) {
  try {
    const phone =
      student?.parentWhatsapp ||
      student?.parentMobile ||
      student?.phone ||
      student?.parentPhone ||
      "";
    const prn = student?.prn;
    if (!prn || !phone) return String(text || "");
    const { messageFooter } = createParentMagicLink({
      prn,
      parentPhone: phone,
      studentName: student?.name || "",
    });
    return `${String(text || "").trim()}\n\n——\n${messageFooter}`;
  } catch {
    return String(text || "");
  }
}
