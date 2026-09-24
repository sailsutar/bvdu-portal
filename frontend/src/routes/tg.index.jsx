import { Link } from "react-router-dom";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { useSession } from "@/lib/auth";
import { useDerived } from "@/lib/upload-stats";
import { useTgMentees, tgBatchLabel } from "@/lib/tg-assign";
import { currentStatusOf } from "@/lib/ml-predict";
import { NoData } from "@/components/portal/NoData";

export default function TgDashboard() {
  const { session } = useSession();
  const { students } = useDerived();
  const { mentees: mine } = useTgMentees(students, session?.tgIndex);

  if (!students.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Teacher Guide Dashboard</h1>
        <NoData message="No student data uploaded yet. Ask the Head of Department to upload Excel marks." />
      </div>
    );
  }

  let atRisk = 0;
  let lowAtt = 0;
  for (const s of mine) {
    if (currentStatusOf(s) === "At Risk") atRisk++;
    if (s.attendanceKnown && s.attendance < 75) lowAtt++;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Teacher Guide Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {session?.name} ({session?.id}) — {tgBatchLabel(session?.tgIndex)}. View-only access to
          your mentees; you can message parents.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard value={String(mine.length)} label="Assigned students" />
        <StatCard value={String(atRisk)} label="At Risk (current)" />
        <StatCard value={String(lowAtt)} label="Attendance &lt; 75%" />
      </div>
      <SectionCard title="Quick links">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link to="/tg/students" className="rounded-md bg-gold px-3 py-2 font-semibold text-navy">
            My Students
          </Link>
          <Link to="/tg/attendance" className="rounded-md border px-3 py-2 text-navy hover:bg-muted">
            Attendance
          </Link>
          <Link to="/tg/marks" className="rounded-md border px-3 py-2 text-navy hover:bg-muted">
            Marks
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
