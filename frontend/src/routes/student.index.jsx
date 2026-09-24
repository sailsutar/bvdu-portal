import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { StatCard, SectionCard } from "@/components/portal/PortalShell";
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { Sparkles, CalendarCheck, BookOpen, FileText, Clock } from "lucide-react";
import { useSession, authHeaders, getToken } from "@/lib/auth";
import { studentPortalData, useDerived } from "@/lib/upload-stats";

const API_BASE = import.meta.env.VITE_API_URL || "";

function StudentDashboard() {
  const { session } = useSession();
  const { students } = useDerived();
  const student = studentPortalData(students, session?.id);
  const [announcements, setAnnouncements] = useState([]);

  useEffect(() => {
    if (!getToken()) return;
    fetch(`${API_BASE}/api/announcements`, { headers: { ...authHeaders() } })
      .then((r) => (r.ok ? r.json() : { announcements: [] }))
      .then((d) => setAnnouncements(d.announcements || []))
      .catch(() => setAnnouncements([]));
  }, []);
  const attendanceData = [
    { name: "Present", value: student.attendance, color: "oklch(0.65 0.18 145)" },
    { name: "Absent", value: 100 - student.attendance, color: "oklch(0.62 0.22 25)" }
  ];
  return <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back, {student.name.split(" ")[0]}! <span aria-hidden>👋</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard value={`${student.attendance != null ? `${student.attendance}%` : "—"}`} label="Attendance" tone="good" />
        <StatCard value={student.cgpa != null ? student.cgpa : "—"} label="CGPA Till last sem" />
        <StatCard value={student.sgpa != null ? student.sgpa : "—"} label="SGPA Current Sem" />
        <StatCard value={student.academicStatus || "—"} label="Academic Status" />
        <StatCard value={student.predictedAveragePct != null ? `${student.predictedAveragePct}%` : "—"} label="Predicted Avg %" />
        <StatCard value={student.backlogs} label="Backlogs" tone="excellent" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard title="Attendance Overview">
          <div className="flex items-center gap-4">
            <div className="h-40 w-40 shrink-0 relative">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={attendanceData} innerRadius={45} outerRadius={65} dataKey="value" stroke="none">
                    {attendanceData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="text-xl font-bold text-navy">{student.attendance != null ? `${student.attendance}%` : "—"}</span>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-success" /> Present {student.attendance != null ? `${student.attendance}%` : "—"}
              </p>
              <p className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-danger" /> Absent {100 - student.attendance}%
              </p>
              <p className="text-muted-foreground">Total Lectures 120</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Performance Trend (SGPA)">
          <div className="h-40">
            <ResponsiveContainer>
              <LineChart data={student.sgpaTrend}>
                <XAxis dataKey="sem" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis domain={[6, 10]} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="sgpa" stroke="oklch(0.83 0.15 85)" strokeWidth={3} dot={{ r: 4, fill: "oklch(0.22 0.06 265)" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="" className="bg-gold-soft border-gold">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-navy text-gold">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold text-navy">AI Insight</p>
              <p className="mt-1 text-sm text-navy/80">
                {student.academicStatus === "Good" ? "You are on track. " : student.academicStatus === "At Risk" ? "Attention needed. " : ""}
                Status: <b>{student.academicStatus || "—"}</b>
                {student.predictedAveragePct != null ? <> · Predicted avg <b>{student.predictedAveragePct}%</b></> : null}
                . View full analysis below.
              </p>
              <Link to="/student/ai-insights" className="mt-3 inline-block rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-navy">
                View All Insights
              </Link>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard title="Recent Announcements" className="lg:col-span-2" action={<Link to="/student/notifications" className="text-xs text-navy hover:underline">View All</Link>}>
          <ul className="divide-y">
            {announcements.length === 0 ? (
              <li className="py-3 text-sm text-muted-foreground">No announcements yet.</li>
            ) : (
              announcements.map((a) => (
                <li key={a.id || a.title} className="flex items-center justify-between py-3 text-sm">
                  <span className="font-medium text-navy">{a.title}</span>
                  <span className="text-xs text-muted-foreground">{a.date}</span>
                </li>
              ))
            )}
          </ul>
        </SectionCard>

        <SectionCard title="Quick Links">
          <div className="grid grid-cols-2 gap-3">
            {[
    { to: "/student/attendance", label: "Attendance", icon: CalendarCheck },
    { to: "/student/marks", label: "Marks", icon: BookOpen },
    { to: "/student/assignments", label: "Assignments", icon: FileText },
    { to: "/student/timetable", label: "Time Table", icon: Clock },
    { to: "/student/ai-insights", label: "Artificial Intelligence Insights", icon: Sparkles }
  ].map((q) => {
    const Icon = q.icon;
    return <Link key={q.to} to={q.to} className="flex flex-col items-center gap-2 rounded-lg border bg-background p-3 text-center text-xs font-medium text-navy transition-colors hover:border-gold hover:bg-gold-soft">
                  <Icon className="h-5 w-5" />
                  {q.label}
                </Link>;
  })}
          </div>
        </SectionCard>
      </div>
    </div>;
}

export default StudentDashboard;
