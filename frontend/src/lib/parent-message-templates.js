/**
 * Pre-built parent letter templates for admin messaging.
 * mode: "full" | "attendance" | "marks"
 */

function fmtAtt(student) {
  if (student?.attendanceKnown && student.attendance != null) return `${student.attendance}%`;
  if (student?.attendance != null) return `${student.attendance}%`;
  return "Not available";
}

function fmtAvg(student) {
  if (student?.averagePercentage != null) return `${student.averagePercentage}%`;
  return "Not available";
}

function marksLines(student) {
  const marks = student?.marks || [];
  if (!marks.length) return "  (No subject-wise marks on record.)";
  return marks
    .map((m) => {
      const a = m.assessments || {};
      const parts = [];
      if (a["UT-1"] != null || a.UT1 != null) parts.push(`UT-1: ${a["UT-1"] ?? a.UT1}`);
      if (a["UT-2"] != null || a.UT2 != null) parts.push(`UT-2: ${a["UT-2"] ?? a.UT2}`);
      if (a["UT-3"] != null || a.UT3 != null) parts.push(`UT-3: ${a["UT-3"] ?? a.UT3}`);
      if (m.average != null) parts.push(`Avg: ${m.average}`);
      if (m.percentage != null) parts.push(`${m.percentage}%`);
      const detail = parts.length ? parts.join(", ") : "—";
      const st = m.status ? ` [${m.status}]` : "";
      return `  • ${m.subject}: ${detail}${st}`;
    })
    .join("\n");
}

function letterHeader(student) {
  const date = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return [
    "Bharati Vidyapeeth University",
    "Student Academic Progress Update",
    "",
    `Date: ${date}`,
    "",
    "Dear Parent / Guardian,",
    "",
    `This is regarding your ward:`,
    `  Name : ${student?.name || "—"}`,
    `  PRN  : ${student?.prn || "—"}`,
    `  Class: ${student?.cls || student?.className || "—"}`,
    "",
  ].join("\n");
}

function letterFooter() {
  return [
    "",
    "Please feel free to contact the class teacher or academic office if you wish to discuss this further.",
    "",
    "With regards,",
    "Academic Office",
    "Bharati Vidyapeeth University",
  ].join("\n");
}

/** Build subject + body for a given mode */
export function buildParentMessage(student, mode = "full") {
  const header = letterHeader(student);
  const footer = letterFooter();
  const name = student?.name || "the student";

  if (mode === "attendance") {
    const att = fmtAtt(student);
    const body = [
      header,
      `We wish to update you on ${name}'s attendance for the current term.`,
      "",
      `  Overall attendance: ${att}`,
      "",
      att !== "Not available" && Number(String(att).replace("%", "")) < 75
        ? "Attendance is currently below the recommended 75% eligibility threshold. Regular presence in class is essential for continuous assessment and exam eligibility."
        : "Kindly encourage regular attendance so that academic performance remains steady.",
      footer,
    ].join("\n");
    return {
      mode,
      subject: `Attendance update — ${name} (${student?.prn || ""})`,
      body,
    };
  }

  if (mode === "marks") {
    const avg = fmtAvg(student);
    const body = [
      header,
      `Please find below the academic marks summary for ${name}.`,
      "",
      `  Overall average: ${avg}`,
      "",
      "Subject-wise details:",
      marksLines(student),
      "",
      "We request you to review the above and support your ward in subjects that need attention.",
      footer,
    ].join("\n");
    return {
      mode,
      subject: `Marks update — ${name} (${student?.prn || ""})`,
      body,
    };
  }

  // full — attendance + marks
  const att = fmtAtt(student);
  const avg = fmtAvg(student);
  const body = [
    header,
    `Please find a consolidated academic update for ${name}.`,
    "",
    "1. Attendance",
    `  Overall attendance: ${att}`,
    "",
    "2. Academic performance",
    `  Overall average: ${avg}`,
    "",
    "Subject-wise details:",
    marksLines(student),
    "",
    "We request your continued support in monitoring both attendance and academic progress.",
    footer,
  ].join("\n");
  return {
    mode: "full",
    subject: `Academic progress update — ${name} (${student?.prn || ""})`,
    body,
  };
}

export const MESSAGE_MODE_LABELS = {
  full: "Attendance + Marks",
  attendance: "Attendance only",
  marks: "Marks only",
};
