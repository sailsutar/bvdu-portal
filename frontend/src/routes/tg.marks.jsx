import { useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { useSession } from "@/lib/auth";
import { useDerived, preferredAssessmentOrder } from "@/lib/upload-stats";
import { useTgMentees, tgBatchLabel } from "@/lib/tg-assign";
import { MessageParentButton } from "@/components/portal/MessageParentModal";
import { NoData } from "@/components/portal/NoData";
import { ChevronDown, ChevronRight } from "lucide-react";

export default function TgMarks() {
  const { session } = useSession();
  const { students, detectedAssessments } = useDerived();
  const { mentees: mine } = useTgMentees(students, session?.tgIndex);
  const [expanded, setExpanded] = useState(() => new Set());
  const keys = preferredAssessmentOrder(
    detectedAssessments.length ? detectedAssessments : ["Unit Test 1", "Unit Test 2"]
  );

  if (!students.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Marks</h1>
        <NoData message="No uploaded students yet." />
      </div>
    );
  }

  function toggle(prn) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(prn)) n.delete(prn);
      else n.add(prn);
      return n;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Marks</h1>
        <p className="text-sm text-muted-foreground">{tgBatchLabel(session?.tgIndex)}</p>
      </div>
      <SectionCard>
        <div className="divide-y">
          {mine.map((s) => {
            const open = expanded.has(s.prn);
            const marks = s.marks || [];
            return (
              <div key={s.prn}>
                <button
                  type="button"
                  onClick={() => toggle(s.prn)}
                  className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-muted/30"
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="text-sm tabular-nums text-navy">{s.prn}</span>
                  <span className="text-sm font-semibold text-navy">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.averagePercentage != null ? `Avg ${s.averagePercentage}%` : "—"}
                  </span>
                  <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
                    <MessageParentButton student={s} mode="marks" />
                  </span>
                </button>
                {open && (
                  <div className="border-t bg-muted/10 px-4 py-3">
                    {!marks.length ? (
                      <p className="text-sm text-muted-foreground">No subject marks.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="py-1">Subject</th>
                            {keys.map((k) => (
                              <th key={k} className="py-1">
                                {k}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {marks.map((m) => (
                            <tr key={m.subject} className="border-t">
                              <td className="py-1.5 font-medium text-navy">{m.subject}</td>
                              {keys.map((k) => (
                                <td key={k} className="py-1.5 tabular-nums">
                                  {m.assessments?.[k] ?? "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
