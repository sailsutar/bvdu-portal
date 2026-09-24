import { Link } from "react-router-dom";
import { StatCard, SectionCard } from "@/components/portal/PortalShell";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Upload, Eye, FileBarChart, MessageSquare, AlertTriangle } from "lucide-react";
import { useDerived } from "@/lib/upload-stats";
import { NoData } from "@/components/portal/NoData";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";
import { computePassPercentage, attendanceDropAlerts, marksDropAlerts } from "@/lib/year-batch";

function AdminDashboard() {
  const d = useDerived();
  const { students: allStudents } = d;
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);

  if (!d.hasData) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Dashboard</h1>
        <NoData message="Your dashboard is empty. Upload an Excel sheet (attendance, marks or roster) to see live stats, charts and student insights here." />
      </div>
    );
  }

  const totalStudents = students.length;
  const attKnown = students.filter((s) => s.attendance != null && Number.isFinite(Number(s.attendance)));
  const attVals = attKnown.map((s) => Number(s.attendance));
  const avgAttendance = attVals.length
    ? Math.round((attVals.reduce((a, b) => a + b, 0) / attVals.length) * 10) / 10
    : null;
  const presentBand = attKnown.filter((s) => Number(s.attendance) >= 75).length;
  const lowBand = attKnown.filter((s) => Number(s.attendance) < 75).length;
  const unknownAtt = totalStudents - attKnown.length;
  const atRiskCount = students.filter((s) => s.academicStatus === "At Risk").length;
  const passPct = computePassPercentage(students);
  const totalClasses = new Set(
    students.map((s) => s.cls || s.className).filter((c) => c && c !== "—")
  ).size;
  const topAtRisk = students.filter((s) => s.academicStatus === "At Risk").slice(0, 8);
  const alerts = [...attendanceDropAlerts(students), ...marksDropAlerts(students)].slice(0, 10);

  const donut = [
    { name: "≥ 75% attendance", value: presentBand || 0, color: "oklch(0.65 0.18 145)" },
    { name: "< 75% attendance", value: lowBand || 0, color: "oklch(0.62 0.22 25)" },
    ...(unknownAtt > 0
      ? [{ name: "Attendance unknown", value: unknownAtt, color: "oklch(0.78 0.02 260)" }]
      : []),
  ].filter((x) => x.value > 0);
  // Fallback so chart always renders something
  const donutData =
    donut.length > 0
      ? donut
      : [{ name: "No attendance data", value: 1, color: "oklch(0.85 0.02 260)" }];

  const statusBars = [
    { label: "At Risk", value: students.filter((s) => s.academicStatus === "At Risk").length },
    { label: "Average", value: students.filter((s) => s.academicStatus === "Average").length },
    { label: "Good", value: students.filter((s) => s.academicStatus === "Good").length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Viewing {year === "All" ? "all years" : year}
            {batch !== "All" ? ` · batch ${batch}` : ""} · {totalStudents} students
          </p>
        </div>
        <YearBatchFilter {...filterProps} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard value={String(totalStudents)} label="Students" />
        <StatCard
          value={avgAttendance != null ? `${avgAttendance}%` : "—"}
          label="Avg attendance"
          tone="good"
        />
        <StatCard value={passPct != null ? `${passPct}%` : "—"} label="Pass percentage" tone="excellent" />
        <StatCard value={String(atRiskCount)} label="At Risk (current)" />
        <StatCard value={String(totalClasses)} label="Classes / sections" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard title="Attendance overview">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  innerRadius={48}
                  outerRadius={70}
                  dataKey="value"
                  nameKey="name"
                  stroke="none"
                  paddingAngle={2}
                >
                  {donutData.map((x) => (
                    <Cell key={x.name} fill={x.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Average attendance: {avgAttendance != null ? `${avgAttendance}%` : "not available"} ·{" "}
            {presentBand} on track / {lowBand} below 75%
          </p>
        </SectionCard>

        <SectionCard title="Current academic status">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusBars}>
                <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="value" fill="oklch(0.83 0.15 85)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Alerts">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No critical drops in this selection.</p>
          ) : (
            <ul className="max-h-44 space-y-2 overflow-auto text-sm">
              {alerts.map((a, i) => (
                <li key={`${a.prn}-${i}`} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <span>
                    <b>{a.name}</b> ({a.prn}): {a.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="At Risk students (current academic status)">
        {topAtRisk.length === 0 ? (
          <p className="text-sm text-muted-foreground">None in this year/batch selection.</p>
        ) : (
          <ul className="divide-y text-sm">
            {topAtRisk.map((s) => (
              <li key={s.prn} className="flex justify-between py-2">
                <span>
                  {s.name} · {s.prn} · {s.cls || s.className}
                </span>
                <span className="text-danger">Att {s.attendance ?? "—"}%</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { to: "/sysadmin/upload-data", label: "Upload data", icon: Upload },
          { to: "/admin/students", label: "Students", icon: Eye },
          { to: "/admin/reports", label: "Reports", icon: FileBarChart },
          { to: "/admin/feedback", label: "Feedback", icon: MessageSquare },
        ].map((q) => {
          const Icon = q.icon;
          return (
            <Link
              key={q.to}
              to={q.to}
              className="flex flex-col items-center gap-2 rounded-lg border bg-background p-3 text-center text-xs font-medium text-navy hover:border-gold hover:bg-gold-soft"
            >
              <Icon className="h-5 w-5" />
              {q.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default AdminDashboard;
