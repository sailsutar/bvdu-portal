/**
 * Explainable artificial intelligence for student academic performance (teacher-facing).
 * Builds ranked risk drivers, trends, and actionable recommendations
 * from uploaded marks + attendance — no black-box opacity for staff.
 */

const PASS_UT = 8;

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mean(arr) {
  const a = arr.filter((x) => x != null);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function stdev(arr) {
  const a = arr.filter((x) => x != null);
  if (a.length < 2) return null;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length;
  return Math.sqrt(v);
}

/**
 * Analyze one student object from upload-stats / portal shape.
 * Returns explainable report for teachers.
 */
export function explainStudentPerformance(student) {
  if (!student) {
    return emptyReport("No student selected.");
  }

  const marks = student.marks || [];
  const attendance = num(student.attendance);
  const avgPct = num(student.averagePercentage);
  const cgpa = student.cgpaKnown ? num(student.cgpa) : null;
  const status = student.academicStatus || student.status || "Average";

  const ut1 = [];
  const ut2 = [];
  const reut = [];
  const subjectScores = [];
  let failCount = 0;
  let assessCount = 0;
  let absentCount = 0;
  const failingSubjects = [];
  const weakSubjects = [];
  const strongSubjects = [];
  const decliningSubjects = [];
  const improvingSubjects = [];

  for (const m of marks) {
    const a = m.assessments || {};
    const u1 = num(a["UT-1"] ?? a.UT1);
    const u2 = num(a["UT-2"] ?? a.UT2);
    const u3 = num(a["UT-3"] ?? a.UT3);
    const re = num(a["RE-UT"] ?? a.REUT);
    const pct = num(m.percentage ?? a.Pct ?? a.Percentage);
    const avg = num(m.average ?? a.Average ?? a.Avg);

    if (u1 != null) {
      ut1.push(u1);
      assessCount++;
      if (u1 < PASS_UT) {
        failCount++;
        if (!failingSubjects.includes(m.subject)) failingSubjects.push(m.subject);
      }
    }
    if (u2 != null) {
      ut2.push(u2);
      assessCount++;
      if (u2 < PASS_UT) {
        failCount++;
        if (!failingSubjects.includes(m.subject)) failingSubjects.push(m.subject);
      }
    }
    if (re != null) reut.push(re);

    // Absent markers sometimes stored as null with status
    if (m.status === "FAIL" && !failingSubjects.includes(m.subject)) {
      failingSubjects.push(m.subject);
    }

    const score = pct ?? (avg != null ? (avg / 20) * 100 : null);
    if (score != null) {
      subjectScores.push({ subject: m.subject, score, u1, u2 });
      if (score < 50) weakSubjects.push({ subject: m.subject, score });
      if (score >= 75) strongSubjects.push({ subject: m.subject, score });
    }

    if (u1 != null && u2 != null) {
      const delta = u2 - u1;
      if (delta <= -3) decliningSubjects.push({ subject: m.subject, u1, u2, delta });
      if (delta >= 3) improvingSubjects.push({ subject: m.subject, u1, u2, delta });
    }
  }

  const meanUt1 = mean(ut1);
  const meanUt2 = mean(ut2);
  const failRate = assessCount ? failCount / assessCount : 0;
  const trendDelta =
    meanUt1 != null && meanUt2 != null ? Math.round((meanUt2 - meanUt1) * 10) / 10 : null;
  let trend = "unknown";
  if (trendDelta != null) {
    if (trendDelta <= -2) trend = "declining";
    else if (trendDelta >= 2) trend = "improving";
    else trend = "stable";
  }

  const scoreVariance = stdev(subjectScores.map((s) => s.score));
  const consistency =
    scoreVariance == null
      ? "unknown"
      : scoreVariance < 12
        ? "consistent"
        : scoreVariance < 22
          ? "moderate"
          : "uneven";

  // --- Contribution weights (explainable, sum ~100 for negative drivers) ---
  const drivers = [];

  // Attendance
  if (attendance != null) {
    let impact = 0;
    let severity = "low";
    let reason = `Attendance is ${attendance}%, which meets the typical 75% threshold.`;
    if (attendance < 50) {
      impact = 30;
      severity = "critical";
      reason = `Attendance is critically low at ${attendance}% (well below 75%). This alone can block exam eligibility and correlates with poor outcomes.`;
    } else if (attendance < 65) {
      impact = 24;
      severity = "high";
      reason = `Attendance is ${attendance}% (below 65%). Regular absence is a primary driver of risk.`;
    } else if (attendance < 75) {
      impact = 16;
      severity = "medium";
      reason = `Attendance is ${attendance}% — under the 75% eligibility line. Missing classes likely reduces continuous assessment scores.`;
    } else if (attendance < 85) {
      impact = 4;
      severity = "low";
      reason = `Attendance is ${attendance}% (acceptable). Minor room to improve consistency of presence.`;
    }
    drivers.push({
      id: "attendance",
      label: "Attendance",
      impact,
      severity,
      value: `${attendance}%`,
      reason,
      positive: attendance >= 75,
    });
  } else {
    drivers.push({
      id: "attendance",
      label: "Attendance",
      impact: 8,
      severity: "medium",
      value: "—",
      reason: "Attendance data is missing from the upload, so risk cannot be fully ruled out.",
      positive: false,
    });
  }

  // Fail rate
  if (assessCount > 0) {
    let impact = Math.min(28, Math.round(failRate * 40));
    let severity = failRate >= 0.4 ? "critical" : failRate >= 0.25 ? "high" : failRate > 0 ? "medium" : "low";
    let reason =
      failCount === 0
        ? "No UT fails detected — assessment pass rate is healthy."
        : `${failCount} of ${assessCount} UT assessments are below pass (${PASS_UT}/20). Fail rate ${(failRate * 100).toFixed(0)}%.`;
    if (failingSubjects.length) {
      reason += ` Subjects involved: ${failingSubjects.slice(0, 4).join(", ")}${failingSubjects.length > 4 ? "…" : ""}.`;
    }
    drivers.push({
      id: "fails",
      label: "Failed assessments",
      impact: failCount === 0 ? 2 : impact,
      severity: failCount === 0 ? "low" : severity,
      value: `${failCount}/${assessCount}`,
      reason,
      positive: failCount === 0,
    });
  }

  // Overall average %
  if (avgPct != null) {
    let impact = 0;
    let severity = "low";
    let reason = `Overall average is ${avgPct}%.`;
    if (avgPct < 40) {
      impact = 26;
      severity = "critical";
      reason = `Overall average is very low at ${avgPct}%. Performance is well below a safe band.`;
    } else if (avgPct < 50) {
      impact = 20;
      severity = "high";
      reason = `Overall average is ${avgPct}% (under 50%). This is a major risk signal.`;
    } else if (avgPct < 60) {
      impact = 12;
      severity = "medium";
      reason = `Overall average is ${avgPct}% — borderline. Small further drops could push the student to At Risk.`;
    } else if (avgPct >= 75) {
      impact = 2;
      severity = "low";
      reason = `Overall average is strong at ${avgPct}%.`;
    } else {
      impact = 6;
      reason = `Overall average is ${avgPct}% — moderate.`;
    }
    drivers.push({
      id: "average",
      label: "Overall average %",
      impact,
      severity,
      value: `${avgPct}%`,
      reason,
      positive: avgPct >= 65,
    });
  }

  // UT trend
  if (trend !== "unknown") {
    let impact = 0;
    let severity = "low";
    let reason = `Mean Unit Test-1 ${meanUt1?.toFixed(1)} → Unit Test 2 ${meanUt2?.toFixed(1)} (Δ ${trendDelta > 0 ? "+" : ""}${trendDelta}). Trend is ${trend}.`;
    if (trend === "declining") {
      impact = 18;
      severity = trendDelta <= -4 ? "high" : "medium";
      reason = `Performance is declining: average UT dropped from ${meanUt1?.toFixed(1)} to ${meanUt2?.toFixed(1)} (Δ ${trendDelta}). This is a clear degradation signal between tests.`;
      if (decliningSubjects.length) {
        reason += ` Largest drops in: ${decliningSubjects
          .slice(0, 3)
          .map((d) => `${d.subject} (${d.u1}→${d.u2})`)
          .join(", ")}.`;
      }
    } else if (trend === "improving") {
      impact = 3;
      reason = `Performance is improving: UT average rose from ${meanUt1?.toFixed(1)} to ${meanUt2?.toFixed(1)} (Δ +${trendDelta}). Recovery path is visible.`;
    }
    drivers.push({
      id: "trend",
      label: "UT-1 → Unit Test 2 trend",
      impact,
      severity,
      value: trend,
      reason,
      positive: trend === "improving" || trend === "stable",
    });
  }

  // Subject consistency
  if (consistency !== "unknown") {
    const impact = consistency === "uneven" ? 12 : consistency === "moderate" ? 6 : 2;
    drivers.push({
      id: "consistency",
      label: "Subject consistency",
      impact,
      severity: consistency === "uneven" ? "medium" : "low",
      value: consistency,
      reason:
        consistency === "uneven"
          ? `Marks vary widely across subjects (σ ≈ ${scoreVariance?.toFixed(1)}). Uneven profiles often mean a few subjects drag the average down.`
          : consistency === "moderate"
            ? `Moderate spread across subjects (σ ≈ ${scoreVariance?.toFixed(1)}). Some subjects need more focus than others.`
            : `Scores are relatively consistent across subjects (σ ≈ ${scoreVariance?.toFixed(1)}).`,
      positive: consistency === "consistent",
    });
  }

  // Weak subjects cluster
  if (weakSubjects.length) {
    const impact = Math.min(20, 6 + weakSubjects.length * 3);
    drivers.push({
      id: "weak_subjects",
      label: "Weak subjects",
      impact,
      severity: weakSubjects.length >= 3 ? "high" : "medium",
      value: `${weakSubjects.length}`,
      reason: `${weakSubjects.length} subject(s) under 50%: ${weakSubjects
        .slice(0, 4)
        .map((w) => `${w.subject} (${w.score.toFixed(0)}%)`)
        .join(", ")}. These are primary drag factors on overall performance.`,
      positive: false,
    });
  }

  // CGPA if known
  if (cgpa != null) {
    let impact = cgpa < 6 ? 14 : cgpa < 7 ? 8 : 2;
    drivers.push({
      id: "cgpa",
      label: "CGPA",
      impact,
      severity: cgpa < 6 ? "high" : cgpa < 7 ? "medium" : "low",
      value: String(cgpa),
      reason:
        cgpa < 6
          ? `CGPA ${cgpa} is low and indicates sustained underperformance across terms.`
          : cgpa < 7
            ? `CGPA ${cgpa} is below a comfortable band; monitor term-wise recovery.`
            : `CGPA ${cgpa} is acceptable to strong.`,
      positive: cgpa >= 7.5,
    });
  }

  // Sort drivers by impact (degradation reasons first)
  const ranked = [...drivers].sort((a, b) => b.impact - a.impact);
  const totalImpact = ranked.reduce((s, d) => s + d.impact, 0) || 1;
  const withShare = ranked.map((d) => ({
    ...d,
    share: Math.round((d.impact / totalImpact) * 100),
  }));

  // Narrative
  const topNegative = withShare.filter((d) => !d.positive && d.impact >= 8).slice(0, 4);
  const degraded = status === "At Risk" || topNegative.length >= 2 || trend === "declining";

  let headline = "";
  if (status === "At Risk" && trend === "declining") {
    headline = "Performance has degraded and the student is currently At Risk.";
  } else if (status === "At Risk") {
    headline = "Student is At Risk based on current marks and attendance.";
  } else if (trend === "declining") {
    headline = "Early signs of performance degradation between UT-1 and UT-2.";
  } else if (status === "Good") {
    headline = "Performance is currently solid; no major degradation signals.";
  } else {
    headline = "Performance is average; some factors need monitoring.";
  }

  const whyDegraded =
    topNegative.length === 0
      ? ["No strong degradation drivers detected from the uploaded data."]
      : topNegative.map((d) => d.reason);

  // Recommendations for teacher
  const recommendations = [];
  if (attendance != null && attendance < 75) {
    recommendations.push({
      priority: attendance < 65 ? "high" : "medium",
      action: "Attendance counselling",
      detail: `Call a short meeting; target ≥75% for the rest of the term (currently ${attendance}%).`,
    });
  }
  if (failingSubjects.length) {
    recommendations.push({
      priority: "high",
      action: "Remedial for failing assessments",
      detail: `Focus remedial / RE-UT support on: ${failingSubjects.slice(0, 5).join(", ")}.`,
    });
  }
  if (decliningSubjects.length) {
    recommendations.push({
      priority: "medium",
      action: "Investigate subject-wise drop",
      detail: `UT scores fell in ${decliningSubjects
        .slice(0, 3)
        .map((d) => d.subject)
        .join(", ")}. Check topic gaps between UT-1 and UT-2.`,
    });
  }
  if (weakSubjects.length >= 2) {
    recommendations.push({
      priority: "medium",
      action: "Peer / tutorial pairing",
      detail: "Pair with a stronger peer or assign weekly tutorials on weakest subjects.",
    });
  }
  if (trend === "improving" && status !== "Good") {
    recommendations.push({
      priority: "low",
      action: "Reinforce recovery",
      detail: "UT trend is upward — acknowledge progress and lock in study habits that worked.",
    });
  }
  if (!recommendations.length) {
    recommendations.push({
      priority: "low",
      action: "Routine monitoring",
      detail: "No urgent intervention required. Re-check after the next assessment upload.",
    });
  }

  // Protective factors
  const strengths = [];
  if (attendance != null && attendance >= 85) strengths.push(`Strong attendance (${attendance}%)`);
  if (avgPct != null && avgPct >= 75) strengths.push(`Healthy overall average (${avgPct}%)`);
  if (trend === "improving") strengths.push("Improving UT-1 → Unit Test 2 trajectory");
  if (failCount === 0 && assessCount > 0) strengths.push("No failed UT assessments");
  if (strongSubjects.length) {
    strengths.push(
      `Strong in ${strongSubjects
        .slice(0, 3)
        .map((s) => s.subject)
        .join(", ")}`
    );
  }

  return {
    prn: student.prn,
    name: student.name,
    status,
    degraded,
    headline,
    trend,
    trendDelta,
    meanUt1,
    meanUt2,
    attendance,
    avgPct,
    cgpa,
    failCount,
    assessCount,
    failRate: Math.round(failRate * 1000) / 1000,
    consistency,
    drivers: withShare,
    whyDegraded,
    recommendations,
    strengths,
    failingSubjects,
    weakSubjects: weakSubjects.slice(0, 6),
    decliningSubjects: decliningSubjects.slice(0, 6),
    improvingSubjects: improvingSubjects.slice(0, 6),
    generatedAt: new Date().toISOString(),
  };
}

function emptyReport(msg) {
  return {
    prn: null,
    name: null,
    status: "—",
    degraded: false,
    headline: msg,
    trend: "unknown",
    drivers: [],
    whyDegraded: [msg],
    recommendations: [],
    strengths: [],
    failingSubjects: [],
    weakSubjects: [],
    decliningSubjects: [],
    improvingSubjects: [],
  };
}

export function severityClass(severity) {
  if (severity === "critical") return "bg-destructive/15 text-destructive";
  if (severity === "high") return "bg-destructive/10 text-destructive";
  if (severity === "medium") return "bg-gold/20 text-navy";
  return "bg-muted text-muted-foreground";
}

export function priorityClass(priority) {
  if (priority === "high") return "border-destructive/40 bg-destructive/5";
  if (priority === "medium") return "border-gold/40 bg-gold/10";
  return "border-muted bg-muted/30";
}
