import { useEffect, useMemo, useState } from "react";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";
import { useDerived } from "@/lib/upload-stats";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";
import {
  subjectPrimaryYearMap,
  subjectBelongsToYear,
  parseYearBatch,
  normalizeYearLevel,
  YEAR_LABELS,
} from "@/lib/year-batch";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";

/** Normalize subject labels so "DBMS" matches "Database management System" etc. */
function subjectKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\blab\b|\bpractical\b|\btheory\b|\bregular\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function subjectsMatch(a, b) {
  const ka = subjectKey(a);
  const kb = subjectKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.includes(kb) || kb.includes(ka)) return true;
  // token overlap (e.g. dbms vs database management system)
  const ta = new Set(ka.split(" ").filter((t) => t.length > 2));
  const tb = new Set(kb.split(" ").filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return false;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit >= 1 && (hit / Math.min(ta.size, tb.size) >= 0.5);
}

function findStatsForSubject(bySubject, subjectName) {
  if (bySubject[subjectName]) return bySubject[subjectName];
  for (const [k, v] of Object.entries(bySubject)) {
    if (subjectsMatch(k, subjectName)) return v;
  }
  return null;
}

function yearMatches(assignmentYear, selectedYear) {
  if (!selectedYear || selectedYear === "All") return true;
  const y = normalizeYearLevel(selectedYear) || String(selectedYear).toUpperCase();
  const ayRaw = assignmentYear ? String(assignmentYear).trim() : "";
  // Unscoped assignments must not appear under a specific year (prevents jumbling)
  if (!ayRaw) return false;
  const ay = normalizeYearLevel(ayRaw) || ayRaw.toUpperCase();
  return ay === y;
}

function batchMatches(assignmentBatch, selectedBatch) {
  if (!selectedBatch || selectedBatch === "All") return true;
  const b = String(selectedBatch).toUpperCase();
  const ab = assignmentBatch ? String(assignmentBatch).trim().toUpperCase() : "";
  // Unscoped batch: only show when filter is All (already handled) or allow match if empty? Strict: require batch
  if (!ab) return false;
  return ab === b;
}

function extractPctFromMark(m) {
  if (!m) return null;
  if (m.percentage != null && Number.isFinite(Number(m.percentage))) return Number(m.percentage);
  if (m.average != null && Number.isFinite(Number(m.average))) {
    const avg = Number(m.average);
    return avg <= 20 ? (avg / 20) * 100 : avg;
  }
  const a = m.assessments || {};
  const vals = [];
  for (const [k, v] of Object.entries(a)) {
    if (!/ut|quiz|mid|test|internal/i.test(String(k))) continue;
    const n = Number(v);
    if (Number.isFinite(n)) vals.push(n <= 20 ? (n / 20) * 100 : n);
  }
  if (!vals.length) return null;
  return vals.reduce((x, y) => x + y, 0) / vals.length;
}

/**
 * Build per-subject stats for the filtered student list.
 * Sources: marks[], subjectAttendance[], raw UT columns (combined Excel).
 */
function buildSubjectStats(students, allStudents, year) {
  const primary = subjectPrimaryYearMap(allStudents || students);
  const yearsInView = new Set();
  for (const s of students || []) {
    const y = parseYearBatch(s).year;
    if (y && y !== "Unspecified") yearsInView.add(y);
  }
  const singleYear =
    year && year !== "All"
      ? normalizeYearLevel(year) || year
      : yearsInView.size === 1
        ? [...yearsInView][0]
        : null;

  const bySubject = {};
  const ensure = (sub) => {
    if (!bySubject[sub]) bySubject[sub] = { scores: [], fails: 0, total: 0, att: [] };
    return bySubject[sub];
  };

  const allowSubject = (sub) => {
    if (!singleYear) return true;
    // Unknown to primary map → keep (combined UT column names often differ from affinity keys)
    if (!primary || primary[sub] == null) {
      const hit = Object.keys(primary || {}).some((k) => subjectsMatch(k, sub));
      if (!hit) return true;
      return subjectBelongsToYear(
        Object.keys(primary).find((k) => subjectsMatch(k, sub)) || sub,
        singleYear,
        primary
      );
    }
    return subjectBelongsToYear(sub, singleYear, primary);
  };

  for (const s of students || []) {
    const studentAtt = s.attendance != null && Number.isFinite(Number(s.attendance)) ? Number(s.attendance) : null;

    // 1) Structured marks
    for (const m of s.marks || []) {
      const sub = m.subject || "Unknown";
      if (!allowSubject(sub)) continue;
      const bucket = ensure(sub);
      bucket.total += 1;
      const pct = extractPctFromMark(m);
      if (pct != null) bucket.scores.push(pct);
      if (m.status === "FAIL" || (pct != null && pct < 40)) bucket.fails += 1;
      if (studentAtt != null) bucket.att.push(studentAtt);
    }

    // 2) VMedulife subject attendance (and teacher labels)
    for (const sa of s.subjectAttendance || []) {
      const sub = sa.subject || "Unknown";
      if (!allowSubject(sub)) continue;
      const bucket = ensure(sub);
      if (sa.pct != null && Number.isFinite(Number(sa.pct))) {
        bucket.att.push(Number(sa.pct));
      } else if (studentAtt != null) {
        bucket.att.push(studentAtt);
      }
      // If no marks yet, still count presence for graph width
      if (!(s.marks || []).some((m) => subjectsMatch(m.subject, sub))) {
        bucket.total += 1;
      }
    }

    // 3) Raw combined-Excel columns e.g. DBMS_UT-1, SE_UT-2
    const raw = s.raw || {};
    const utBuckets = {};
    for (const [key, val] of Object.entries(raw)) {
      const m = String(key).match(/^(.+?)[_\s-]*(ut[_\s-]*[12]|ut[12])$/i);
      if (!m) continue;
      const sub = m[1].replace(/_/g, " ").trim();
      if (!sub || !allowSubject(sub)) continue;
      const n = Number(val);
      if (!Number.isFinite(n)) continue;
      if (!utBuckets[sub]) utBuckets[sub] = [];
      utBuckets[sub].push(n <= 20 ? (n / 20) * 100 : n);
    }
    for (const [sub, vals] of Object.entries(utBuckets)) {
      const bucket = ensure(sub);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      bucket.scores.push(mean);
      bucket.total += 1;
      if (mean < 40) bucket.fails += 1;
      if (studentAtt != null) bucket.att.push(studentAtt);
    }

    // 4) Subject Teacher columns on combined rows → ensure subject exists
    for (const [key, val] of Object.entries(raw)) {
      if (!/teacher$/i.test(String(key))) continue;
      const sub = String(key).replace(/\s*teacher$/i, "").trim();
      if (!sub || !allowSubject(sub)) continue;
      ensure(sub);
    }
  }

  return { bySubject, singleYear, primary };
}

/** Most common faculty name for a subject from attendance subjectAttendance. */
function facultyFromStudents(students, subject) {
  const counts = {};
  const want = String(subject || "").trim().toLowerCase();
  for (const s of students || []) {
    for (const sa of s.subjectAttendance || []) {
      const sub = String(sa.subject || "").trim().toLowerCase();
      if (!sub) continue;
      if (sub !== want && !sub.includes(want) && !want.includes(sub)) continue;
      const name = String(sa.teacherName || "").trim();
      if (!name) continue;
      counts[name] = (counts[name] || 0) + 1;
    }
  }
  let best = null;
  let bestN = 0;
  for (const [n, c] of Object.entries(counts)) {
    if (c > bestN) {
      best = n;
      bestN = c;
    }
  }
  return best;
}

function rowsFromStats(bySubject, assignments, year, batch, students) {

  const assignList = (assignments || []).filter((a) => {
    if (!yearMatches(a.yearLevel, year)) return false;
    if (!batchMatches(a.batch, batch)) return false;
    return true;
  });

  const rows = [];
  const seenKeys = new Set();

  for (const a of assignList) {
    const stats = findStatsForSubject(bySubject, a.subject);
    if (!stats) continue;
    const avgScore = stats.scores.length
      ? Math.round((stats.scores.reduce((x, y) => x + y, 0) / stats.scores.length) * 10) / 10
      : null;
    const avgAtt = stats.att.length
      ? Math.round((stats.att.reduce((x, y) => x + y, 0) / stats.att.length) * 10) / 10
      : null;
    const failRate = stats.total ? stats.fails / Math.max(stats.total, 1) : null;
    let flag = "OK";
    if (avgAtt != null && avgAtt < 70) flag = "Low attendance in cohort for this subject";
    if (avgScore != null && avgScore < 50) flag = "Poor subject performance";
    if (failRate != null && failRate >= 0.35) flag = "High fail rate";
    // Prefer score; if only attendance, still show for graph via avgAttendance
    rows.push({
      subject: a.subject,
      teacherName: a.teacherName,
      yearLevel: a.yearLevel,
      batch: a.batch,
      avgScore,
      avgAttendance: avgAtt,
      failRate: failRate != null ? Math.round(failRate * 1000) / 10 : null,
      n: stats.total || stats.att.length || stats.scores.length,
      flag,
    });
    seenKeys.add(subjectKey(a.subject));
  }

  for (const sub of Object.keys(bySubject)) {
    if ([...seenKeys].some((k) => subjectsMatch(k, sub) || k === subjectKey(sub))) continue;
    const stats = bySubject[sub];
    const avgScore = stats.scores.length
      ? Math.round((stats.scores.reduce((x, y) => x + y, 0) / stats.scores.length) * 10) / 10
      : null;
    const avgAtt = stats.att.length
      ? Math.round((stats.att.reduce((x, y) => x + y, 0) / stats.att.length) * 10) / 10
      : null;
    const fromAtt = facultyFromStudents(students, sub);
    rows.push({
      subject: sub,
      teacherName: fromAtt || "(unassigned)",
      yearLevel: year !== "All" ? year : "",
      batch: batch !== "All" ? batch : "",
      avgScore,
      avgAttendance: avgAtt,
      failRate: stats.total ? Math.round((stats.fails / Math.max(stats.total, 1)) * 1000) / 10 : null,
      n: stats.total || stats.att.length || stats.scores.length,
      flag: fromAtt ? "From attendance report" : "Assign a teacher",
    });
  }

  rows.sort((a, b) => {
    const sa = a.avgScore ?? a.avgAttendance ?? 999;
    const sb = b.avgScore ?? b.avgAttendance ?? 999;
    return sa - sb;
  });
  return rows;
}

export default function AdminTeachers() {
  const { students: allStudents } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);
  const [assignments, setAssignments] = useState([]);
  const [subject, setSubject] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [msg, setMsg] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptSubject, setPromptSubject] = useState("");
  const [promptName, setPromptName] = useState("");

  const { bySubject, singleYear } = useMemo(
    () => buildSubjectStats(students, allStudents, year),
    [students, allStudents, year]
  );

  const subjectsFromData = useMemo(() => Object.keys(bySubject).sort(), [bySubject]);

  const perf = useMemo(
    () => rowsFromStats(bySubject, assignments, year, batch, students),
    [bySubject, assignments, year, batch, students]
  );

  const scopedAssignments = useMemo(() => {
    return (assignments || []).filter((a) => {
      if (!yearMatches(a.yearLevel, year)) return false;
      if (!batchMatches(a.batch, batch)) return false;
      if (subjectsFromData.length) {
        const visible = subjectsFromData.some((s) => subjectsMatch(s, a.subject));
        if (!visible) return false;
      }
      return true;
    });
  }, [assignments, year, batch, subjectsFromData]);

  async function loadAssignments() {
    try {
      const a = await api("/api/teacher-subjects");
      setAssignments(a.assignments || []);
    } catch (e) {
      setMsg(e.message || "Failed to load teacher assignments");
    }
  }

  useEffect(() => {
    loadAssignments();
  }, []);

  useEffect(() => {
    if (year === "All") {
      setShowPrompt(false);
      return;
    }
    const hasScoped = (assignments || []).some(
      (a) => yearMatches(a.yearLevel, year) && (batch === "All" || batchMatches(a.batch, batch))
    );
    if (!hasScoped && subjectsFromData.length > 0) {
      setShowPrompt(true);
      setPromptSubject(subjectsFromData[0] || "");
      setPromptName("");
    } else {
      setShowPrompt(false);
    }
  }, [year, batch, assignments, subjectsFromData]);

  useEffect(() => {
    if (subjectsFromData.length && !subjectsFromData.includes(subject)) {
      setSubject(subjectsFromData[0]);
    }
  }, [subjectsFromData, subject]);

  async function saveAssignment(subj, name) {
    const subjectName = String(subj || "").trim();
    const tName = String(name || "").trim();
    if (!subjectName || !tName) return;
    if (year === "All") {
      setMsg("Select a specific year (and batch if needed) before assigning a teacher — this keeps SY / TY / LY separate.");
      return;
    }
    await api("/api/teacher-subjects", {
      method: "PUT",
      body: JSON.stringify({
        assignments: [
          {
            subject: subjectName,
            teacherName: tName,
            yearLevel: year,
            batch: batch !== "All" ? batch : "",
          },
        ],
      }),
    });
    setMsg(
      `Saved ${tName} → ${subjectName} (${YEAR_LABELS[year] || year}${batch !== "All" ? " · batch " + batch : ""})`
    );
    await loadAssignments();
  }

  async function assign(e) {
    e.preventDefault();
    try {
      await saveAssignment(subject, teacherName);
      setTeacherName("");
    } catch (err) {
      setMsg(err.message || "Save failed");
    }
  }

  async function savePrompt(e) {
    e.preventDefault();
    try {
      await saveAssignment(promptSubject || subjectsFromData[0], promptName);
      setShowPrompt(false);
    } catch (err) {
      setMsg(err.message || "Save failed");
    }
  }

  async function remove(a) {
    try {
      const q = new URLSearchParams({
        yearLevel: a.yearLevel || "",
        batch: a.batch || "",
      });
      await api(`/api/teacher-subjects/${encodeURIComponent(a.subject)}?${q}`, { method: "DELETE" });
      await loadAssignments();
    } catch (err) {
      setMsg(err.message || "Remove failed");
    }
  }

  // Graph: use avgScore when present, else avgAttendance so attendance-only cohorts still chart
  const chartData = useMemo(() => {
    return [...perf]
      .filter(
        (r) =>
          (r.avgScore != null && Number.isFinite(Number(r.avgScore))) ||
          (r.avgAttendance != null && Number.isFinite(Number(r.avgAttendance)))
      )
      .sort((a, b) => {
        const sa = a.avgScore ?? a.avgAttendance ?? 0;
        const sb = b.avgScore ?? b.avgAttendance ?? 0;
        return sa - sb;
      })
      .map((r) => ({
        name: (r.teacherName === "(unassigned)" ? r.subject : r.teacherName).slice(0, 18),
        fullLabel: `${r.teacherName} · ${r.subject}`,
        subject: r.subject,
        avgScore: r.avgScore != null ? r.avgScore : null,
        avgAttendance: r.avgAttendance != null ? r.avgAttendance : null,
        // plot metric for single-bar fallback
        plotScore: r.avgScore != null ? r.avgScore : r.avgAttendance ?? 0,
        flag: r.flag,
      }));
  }, [perf]);

  function barColor(avg) {
    if (avg == null) return "oklch(0.7 0.02 250)";
    if (avg >= 70) return "oklch(0.65 0.15 145)";
    if (avg >= 50) return "oklch(0.83 0.15 85)";
    return "oklch(0.62 0.2 25)";
  }

  const hasScoreBars = chartData.some((d) => d.avgScore != null);
  const hasAttBars = chartData.some((d) => d.avgAttendance != null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Teacher performance</h1>
          <p className="text-sm text-muted-foreground">
            Teachers are stored per year and batch (SY-B stays on SY-B). Graph uses UT marks when
            present, otherwise subject attendance from VMedulife / combined files.
          </p>
        </div>
        <YearBatchFilter {...filterProps} />
      </div>
      <p className="text-xs text-muted-foreground">
        {YEAR_LABELS[year] || year}
        {batch !== "All" ? ` · batch ${batch}` : ""} · {students.length} students ·{" "}
        {subjectsFromData.length} subjects
        {singleYear ? ` · subject year lock: ${YEAR_LABELS[singleYear] || singleYear}` : ""}
      </p>
      {msg && <p className="text-sm text-navy">{msg}</p>}

      {showPrompt && (
        <div className="rounded-xl border-2 border-gold bg-gold-soft/40 p-4 shadow-sm">
          <h2 className="font-semibold text-navy">
            Set teacher for {YEAR_LABELS[year] || year}
            {batch !== "All" ? ` · Batch ${batch}` : ""}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            First time for this year/batch — enter faculty name and subject (list is year-filtered).
          </p>
          <form onSubmit={savePrompt} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col gap-1">
              Subject
              <select
                className="rounded border px-2 py-1"
                value={promptSubject}
                onChange={(e) => setPromptSubject(e.target.value)}
              >
                {subjectsFromData.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Teacher name
              <input
                className="rounded border px-2 py-1"
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
                placeholder="Faculty name"
                required
              />
            </label>
            <button type="submit" className="rounded-md bg-gold px-4 py-2 font-semibold text-navy">
              Save
            </button>
            <button type="button" className="rounded-md border px-3 py-2 text-xs" onClick={() => setShowPrompt(false)}>
              Later
            </button>
          </form>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Subjects in view" value={String(subjectsFromData.length)} />
        <StatCard label="Teachers assigned (this filter)" value={String(scopedAssignments.length)} />
        <StatCard
          label="With scores or attendance"
          value={String(chartData.length)}
        />
      </div>

      <SectionCard title="Assign teacher (locked to selected year / batch)">
        {year === "All" ? (
          <p className="text-sm text-amber-800">
            Select a year (SY / TY / LY / FY) in the filter above before assigning. This stops teachers
            from being mixed across years.
          </p>
        ) : (
          <form onSubmit={assign} className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              Subject
              <select
                className="rounded border px-2 py-1 min-w-[12rem]"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              >
                <option value="">Select subject</option>
                {subjectsFromData.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Teacher name
              <input
                className="rounded border px-2 py-1 min-w-[12rem]"
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
                placeholder="Faculty name"
                required
              />
            </label>
            <button type="submit" className="rounded-md bg-navy px-4 py-2 font-medium text-white">
              Save for {YEAR_LABELS[year] || year}
              {batch !== "All" ? `-${batch}` : ""}
            </button>
          </form>
        )}
        <ul className="mt-4 space-y-1 text-sm">
          {scopedAssignments.map((a) => (
            <li key={`${a.subject}-${a.yearLevel}-${a.batch}-${a.teacherName}`} className="flex items-center gap-2">
              <span>
                <b>{a.subject}</b> → {a.teacherName}
                <span className="text-xs text-muted-foreground">
                  {" "}
                  ({a.yearLevel || "?"}
                  {a.batch ? `-${a.batch}` : ""})
                </span>
              </span>
              <button type="button" className="text-xs text-danger underline" onClick={() => remove(a)}>
                Remove
              </button>
            </li>
          ))}
          {!scopedAssignments.length && (
            <li className="text-muted-foreground">No teachers assigned for this year/batch yet.</li>
          )}
        </ul>
      </SectionCard>

      <SectionCard title="Performance graph (this year / batch only)">
        {!chartData.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No subject scores or attendance to chart for this filter. Upload combined marks + attendance
            (or VMedulife attendance), then select the matching year and batch.
          </p>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                <XAxis dataKey="name" interval={0} angle={-25} textAnchor="end" height={70} fontSize={11} />
                <YAxis domain={[0, 100]} fontSize={11} />
                <Tooltip
                  formatter={(v, name) => [v == null ? "—" : v, name]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ""}
                />
                <Legend />
                {hasScoreBars && (
                  <Bar dataKey="avgScore" name="Avg subject %" radius={[4, 4, 0, 0]}>
                    {chartData.map((e, i) => (
                      <Cell key={`s-${i}`} fill={barColor(e.avgScore)} />
                    ))}
                  </Bar>
                )}
                {hasAttBars && (
                  <Bar
                    dataKey="avgAttendance"
                    name="Avg attendance %"
                    fill="oklch(0.55 0.08 250)"
                    radius={[4, 4, 0, 0]}
                  />
                )}
                {!hasScoreBars && !hasAttBars && (
                  <Bar dataKey="plotScore" name="Score" radius={[4, 4, 0, 0]}>
                    {chartData.map((e, i) => (
                      <Cell key={`p-${i}`} fill={barColor(e.plotScore)} />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Flags and details (ascending)">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Teacher</th>
              <th className="py-2">Subject</th>
              <th className="py-2">Year / batch</th>
              <th className="py-2">Avg %</th>
              <th className="py-2">Att %</th>
              <th className="py-2">Fail %</th>
              <th className="py-2">Flag</th>
            </tr>
          </thead>
          <tbody>
            {perf.map((r) => (
              <tr
                key={`${r.teacherName}-${r.subject}-${r.yearLevel}-${r.batch}`}
                className="border-b last:border-0"
              >
                <td className="py-2">{r.teacherName}</td>
                <td className="py-2">{r.subject}</td>
                <td className="py-2 text-xs text-muted-foreground">
                  {r.yearLevel || "—"}
                  {r.batch ? `-${r.batch}` : ""}
                </td>
                <td className="py-2 font-medium">{r.avgScore ?? "—"}</td>
                <td className="py-2">{r.avgAttendance ?? "—"}</td>
                <td className="py-2">{r.failRate != null ? `${r.failRate}%` : "—"}</td>
                <td
                  className={`py-2 ${r.flag && r.flag !== "OK" ? "font-medium text-danger" : "text-muted-foreground"}`}
                >
                  {r.flag || "—"}
                </td>
              </tr>
            ))}
            {!perf.length && (
              <tr>
                <td colSpan={7} className="py-4 text-muted-foreground">
                  No subject rows for this year/batch. Check class labels and that marks or subject
                  attendance were uploaded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}
