import { SectionCard } from "@/components/portal/PortalShell";
import { useSession } from "@/lib/auth";
import { useDerived } from "@/lib/upload-stats";
import { useTgMentees, tgBatchLabel } from "@/lib/tg-assign";
import { MessageParentButton } from "@/components/portal/MessageParentModal";
import { NoData } from "@/components/portal/NoData";

export default function TgAttendance() {
  const { session } = useSession();
  const { students } = useDerived();
  const { mentees: mine } = useTgMentees(students, session?.tgIndex);

  if (!students.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Attendance</h1>
        <NoData message="No uploaded students yet." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Attendance</h1>
        <p className="text-sm text-muted-foreground">{tgBatchLabel(session?.tgIndex)}</p>
      </div>
      <SectionCard>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Permanent Registration Number</th>
              <th className="py-2">Name</th>
              <th className="py-2">Class</th>
              <th className="py-2">Attendance</th>
              <th className="py-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((s) => (
              <tr key={s.prn} className="border-b last:border-b-0">
                <td className="py-3">{s.prn}</td>
                <td className="py-3 font-medium text-navy">{s.name}</td>
                <td className="py-3">{s.cls || "—"}</td>
                <td
                  className={`py-3 font-semibold ${
                    !s.attendanceKnown
                      ? "text-muted-foreground"
                      : s.attendance < 75
                        ? "text-danger"
                        : "text-success"
                  }`}
                >
                  {s.attendanceKnown ? `${s.attendance}%` : "—"}
                </td>
                <td className="py-3">
                  <MessageParentButton student={s} mode="attendance" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}
