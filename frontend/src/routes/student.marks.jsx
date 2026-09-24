import { SectionCard } from "@/components/portal/PortalShell";
import { useSession } from "@/lib/auth";
import { preferredAssessmentOrder, studentPortalData, useDerived } from "@/lib/upload-stats";

function StatusBadge({ status }) {
  if (!status) return null;
  const ok = String(status).toUpperCase() === "PASS";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
      }`}
    >
      {status}
    </span>
  );
}

export default function MarksPage() {
  const { session } = useSession();
  const { students, source } = useDerived();
  const student = studentPortalData(students, session?.id);
  const marks = student.marks || [];

  const keysFromStudent = new Set();
  for (const m of marks) {
    Object.keys(m.assessments || {}).forEach((k) => keysFromStudent.add(k));
  }
  const allKeys = preferredAssessmentOrder(Array.from(keysFromStudent));
  const summarySet = new Set(["Average", "Avg", "Pct", "Percentage", "Total", "LAB_Pct", "LAB_Total"]);
  const scoreKeys = allKeys.filter((k) => !summarySet.has(k));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Marks</h1>
        <p className="text-sm text-muted-foreground">
          Subject marks from the uploaded academic Excel (source: {source || "cohort"}).
          {student.hasAcademicRecord
            ? ` Showing ${student.name} · PRN ${student.prn}`
            : " No record for your login PRN in the cohort yet."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SectionCard title="Average %">
          <p className="text-2xl font-bold text-navy">
            {student.averagePercentage != null ? `${student.averagePercentage}%` : "—"}
          </p>
          {student.averagePercentageComputed && (
            <p className="text-xs text-muted-foreground">Computed from subject marks</p>
          )}
        </SectionCard>
        <SectionCard title="CGPA">
          <p className="text-2xl font-bold text-navy">
            {student.cgpaKnown && student.cgpa != null ? student.cgpa : "—"}
          </p>
        </SectionCard>
        <SectionCard title="Current status">
          <p className="text-2xl font-bold text-navy">{student.academicStatus || "—"}</p>
        </SectionCard>
      </div>

      <SectionCard title="Subject marks">
        {!marks.length ? (
          <p className="text-sm text-muted-foreground">
            No unit-test / subject marks found for your PRN. After HOD uploads a marks Excel that includes your
            Permanent Registration Number, scores will appear here automatically.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-2">Subject</th>
                  {scoreKeys.map((k) => (
                    <th key={k} className="py-2 pr-2">
                      {k}
                    </th>
                  ))}
                  <th className="py-2 pr-2">Average</th>
                  <th className="py-2 pr-2">%</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {marks.map((m) => (
                  <tr key={m.subject} className="border-b last:border-b-0">
                    <td className="py-2 pr-2 font-medium text-navy">{m.subject}</td>
                    {scoreKeys.map((k) => (
                      <td key={k} className="py-2 pr-2 tabular-nums">
                        {m.assessments?.[k] != null && m.assessments[k] !== ""
                          ? m.assessments[k]
                          : "—"}
                      </td>
                    ))}
                    <td className="py-2 pr-2 tabular-nums">{m.average != null ? m.average : "—"}</td>
                    <td className="py-2 pr-2 tabular-nums">
                      {m.percentage != null ? m.percentage : "—"}
                    </td>
                    <td className="py-2">
                      <StatusBadge status={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
