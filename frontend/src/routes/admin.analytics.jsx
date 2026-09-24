import { useMemo, useState } from "react";
import { StatCard, SectionCard } from "@/components/portal/PortalShell";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDerived } from "@/lib/upload-stats";
import { currentStatusOf } from "@/lib/ml-predict";
import { NoData } from "@/components/portal/NoData";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { computePassPercentage, computeSubjectAverages, computeAssessmentAverages, YEAR_LABELS } from "@/lib/year-batch";
import { useYearBatchStudents } from "@/lib/use-year-batch";

function Analytics() {
  const {
    stats, students: allStudents, attendanceTrend, subjectAvgMarks, assessmentAvgMarks,
    feedback, hasData, detectedSubjects, detectedAssessments,
  } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);
  const filteredSubjectAvg = useMemo(
    () => computeSubjectAverages(students, { allStudents, yearFilter: year }),
    [students, allStudents, year]
  );
  const filteredAssessmentAvg = useMemo(() => computeAssessmentAverages(students), [students]);

  if (!hasData) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Analytics & Reports</h1>
        <NoData message="Analytics will populate as soon as you upload Excel data." />
      </div>
    );
  }

  const attVals = students.filter((s) => s.attendance != null).map((s) => Number(s.attendance));
  const avgAtt = attVals.length ? Math.round((attVals.reduce((a,b)=>a+b,0)/attVals.length)*10)/10 : 0;
  const avgPctCohort = (() => {
    const vals = students.map((s) => s.averagePercentage).filter((n) => n != null && Number.isFinite(Number(n)));
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + Number(b), 0) / vals.length) * 10) / 10;
  })();
  const avgMarks = avgPctCohort ?? 0;
  const below75 = students.filter((s) => s.attendance != null && s.attendance < 75).length;
  const top = [...students]
    .map((s) => ({
      ...s,
      _score: s.averagePercentage != null ? Number(s.averagePercentage) : s.cgpa != null ? Number(s.cgpa) * 10 : null,
    }))
    .filter((s) => s._score != null)
    .sort((a, b) => b._score - a._score)[0];
  const passPct = computePassPercentage(students) ?? 0;
  const sentimentData = feedback
    ? [
        { name: "Positive", value: feedback.positive, color: "oklch(0.65 0.18 145)" },
        { name: "Neutral", value: feedback.neutral, color: "oklch(0.78 0.06 260)" },
        { name: "Negative", value: feedback.negative, color: "oklch(0.62 0.22 25)" },
      ]
    : [];

  // Academic status distribution (At Risk / Average / Good)
  const statusCounts = { "At Risk": 0, Average: 0, Good: 0 };
  for (const s of students) {
    const st = s.academicStatus || currentStatusOf(s) || "Average";
    if (statusCounts[st] != null) statusCounts[st]++;
    else statusCounts[st] = 1;
  }

    // Rank by average % (Excel), then CGPA if present
  const ranked = [...students]
    .map((s) => ({
      ...s,
      _score:
        s.averagePercentage != null
          ? Number(s.averagePercentage)
          : s.cgpa != null
            ? Number(s.cgpa) * 10
            : null,
    }))
    .filter((s) => s._score != null)
    .sort((a, b) => b._score - a._score);
  const topStudents = ranked.slice(0, 5);
  const weakStudents = ranked.slice(-5).reverse();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">Analytics & Reports</h1>
        <YearBatchFilter {...filterProps} />
      </div>
      <p className="text-sm text-muted-foreground">
        {students.length} students in selection
        {top ? ` · Top performer: ${top.name} (${top._score}${top.averagePercentage != null ? "%" : ""})` : ""}
      </p>

      <Tabs defaultValue="class">
        <TabsList>
          <TabsTrigger value="class">Class Overview</TabsTrigger>
          <TabsTrigger value="att">Attendance Analytics</TabsTrigger>
          <TabsTrigger value="marks">Marks Analytics</TabsTrigger>
          <TabsTrigger value="fb">Feedback Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="class" className="mt-4 space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatCard value={`${avgAtt}%`} label="Avg. Attendance" tone="good" />
            <StatCard value={avgPctCohort != null ? `${avgPctCohort}%` : avgMarks || "—"} label="Avg. marks / %" />
            <StatCard value={statusCounts["At Risk"] || 0} label="At Risk" />
            <StatCard value={statusCounts.Average || 0} label="Average" />
            <StatCard value={statusCounts.Good || 0} label="Good" />
            <StatCard value={stats.passPct != null ? `${stats.passPct}%` : `${passPct}%`} label="Pass Percentage" tone="excellent" />
            <StatCard value={below75} label="Students Below 75%" tone="warn" />
            <SectionCard title="Top Performer">
              {top ? (
                <>
                  <p className="text-sm font-semibold text-navy">{top.name} ({top.averagePercentage != null ? `${top.averagePercentage}%` : top.cgpa ?? "—"})</p>
                  <p className="text-xs text-muted-foreground">{top.cls}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No data.</p>
              )}
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <SectionCard title="Attendance Trend">
              <div className="h-52">
                {attendanceTrend.length ? (
                  <ResponsiveContainer>
                    <BarChart data={attendanceTrend}>
                      <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip />
                      <Bar dataKey="value" fill="oklch(0.83 0.15 85)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="grid h-full place-items-center text-xs text-muted-foreground">No attendance data.</p>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Subject Wise Average">
              <div className="h-52">
                {filteredSubjectAvg.length ? (
                  <ResponsiveContainer>
                    <BarChart data={filteredSubjectAvg.slice(0, 10)}>
                      <XAxis dataKey="subject" fontSize={10} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={55} />
                      <YAxis fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip />
                      <Bar dataKey="avg" fill="oklch(0.22 0.06 265)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="grid h-full place-items-center text-xs text-muted-foreground">No subjects for this year/batch.</p>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Feedback Sentiment">
              <div className="h-52">
                {sentimentData.length ? (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={sentimentData} innerRadius={45} outerRadius={70} dataKey="value" stroke="none">
                        {sentimentData.map((d) => (
                          <Cell key={d.name} fill={d.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="grid h-full place-items-center text-xs text-muted-foreground">No feedback column detected.</p>
                )}
              </div>
              {sentimentData.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {sentimentData.map((f) => (
                    <li key={f.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: f.color }} />
                        {f.name}
                      </span>
                      <b>{f.value}%</b>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {(filteredSubjectAvg.length > 0 || filteredAssessmentAvg.length > 0) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SectionCard title="Detected Subjects">
                <div className="flex flex-wrap gap-2">
                  {filteredSubjectAvg.map((s) => (
                    <span key={s.subject} className="rounded-full bg-gold-soft px-2.5 py-1 text-xs font-medium text-navy">{s.subject}</span>
                  ))}
                </div>
              </SectionCard>
              <SectionCard title="Detected Assessments">
                <div className="flex flex-wrap gap-2">
                  {filteredAssessmentAvg.map((a) => (
                    <span key={a.assessment} className="rounded-full border border-navy/20 px-2.5 py-1 text-xs font-medium text-navy">{a.assessment}</span>
                  ))}
                </div>
              </SectionCard>
            </div>
          )}
        </TabsContent>

        <TabsContent value="att" className="mt-4">
          <SectionCard title="Attendance Distribution">
            <div className="grid grid-cols-3 gap-3">
              <StatCard value={students.filter((s) => s.attendanceKnown && s.attendance >= 85).length} label="Excellent (≥85%)" tone="excellent" />
              <StatCard value={students.filter((s) => s.attendanceKnown && s.attendance >= 75 && s.attendance < 85).length} label="Good (75–85%)" tone="good" />
              <StatCard value={below75} label="Below 75%" tone="warn" />
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="marks" className="mt-4 space-y-6">
          <SectionCard title={`Subject averages (${YEAR_LABELS[year] || year}${batch !== "All" ? " · " + batch : ""}) — weakest first`}>
            {filteredSubjectAvg.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subject marks for this year/batch filter.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {filteredSubjectAvg.map((s) => (
                  <li key={s.subject} className="flex items-center justify-between border-b py-2 last:border-b-0">
                    <span className="text-navy">{s.subject}</span>
                    <b>{s.avg}</b>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {filteredAssessmentAvg.length > 0 && (
            <SectionCard title={`Assessment-wise averages (${year}${batch !== "All" ? " · " + batch : ""})`}>
              <div className="h-52">
                <ResponsiveContainer>
                  <BarChart data={filteredAssessmentAvg}>
                    <XAxis dataKey="assessment" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Bar dataKey="avg" fill="oklch(0.83 0.15 85)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <SectionCard title="Top Performers">
              <ul className="space-y-2 text-sm">
                {topStudents.map((s) => (
                  <li key={s.prn} className="flex justify-between border-b py-1.5 last:border-0">
                    <span className="text-navy">{s.name}</span>
                    <b>{s.cgpa}</b>
                  </li>
                ))}
                {topStudents.length === 0 && <p className="text-xs text-muted-foreground">No CGPA data.</p>}
              </ul>
            </SectionCard>
            <SectionCard title="Weak Students">
              <ul className="space-y-2 text-sm">
                {weakStudents.map((s) => (
                  <li key={s.prn} className="flex justify-between border-b py-1.5 last:border-0">
                    <span className="text-navy">{s.name}</span>
                    <b>{s.cgpa}</b>
                  </li>
                ))}
                {weakStudents.length === 0 && <p className="text-xs text-muted-foreground">No CGPA data.</p>}
              </ul>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="fb" className="mt-4">
          {feedback ? (
            <SectionCard title="Feedback Breakdown">
              <div className="grid grid-cols-3 gap-3">
                <StatCard value={`${feedback.positive}%`} label="Positive" tone="good" />
                <StatCard value={`${feedback.neutral}%`} label="Neutral" />
                <StatCard value={`${feedback.negative}%`} label="Negative" tone="warn" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Total responses: {feedback.total}</p>
            </SectionCard>
          ) : (
            <SectionCard>
              <p className="text-sm text-muted-foreground">No feedback/sentiment/rating column detected in uploaded data.</p>
            </SectionCard>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default Analytics;
