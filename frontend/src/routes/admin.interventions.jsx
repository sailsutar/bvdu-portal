import { useMemo, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";
import {
  rankStudentsByUplift,
  createIntervention,
  listInterventions,
  updateIntervention,
  recordOutcome,
  INTERVENTION_TYPES,
  interventionEffectiveness,
} from "@/lib/academic-intelligence";
import { currentStatusOf } from "@/lib/ml-predict";
import { learnerSignals } from "@/lib/tg-assign";
import { NoData } from "@/components/portal/NoData";

export default function AdminInterventions() {
  const { students: allStudents } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState("open");
  const [msg, setMsg] = useState("");

  const ranked = useMemo(() => rankStudentsByUplift(students), [students, tick]);
  const ints = listInterventions();
  const open = ints.filter((i) => i.status === "open" || !i.status);
  const done = ints.filter((i) => i.status === "done");
  const shown = filter === "open" ? open : filter === "done" ? done : ints;
  const eff = interventionEffectiveness();

  if (!allStudents.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Student Interventions</h1>
        <NoData message="Upload academic data first." />
      </div>
    );
  }

  function assign(r, type) {
    const sig = learnerSignals(r.student);
    createIntervention({
      prn: r.student.prn,
      studentName: r.student.name,
      type,
      status: "open",
      reason: `Uplift ${((r.uplift || 0) * 100).toFixed(0)}%; status ${r.status}; band ${r.band || "—"}`,
      drivers: [
        sig.attendance != null ? `Attendance ${sig.attendance}%` : null,
        sig.meanUt != null ? `Mean UT ${sig.meanUt}` : null,
      ].filter(Boolean),
      createdAt: new Date().toISOString(),
    });
    setMsg(`Assigned ${INTERVENTION_TYPES.find((t) => t.id === type)?.label || type} to ${r.student.name}`);
    setTick((t) => t + 1);
  }

  function markDone(item) {
    const student = students.find((s) => String(s.prn) === String(item.prn));
    const sig = learnerSignals(student || {});
    updateIntervention(item.id, { status: "done", completedAt: new Date().toISOString() });
    recordOutcome({
      interventionId: item.id,
      prn: item.prn,
      type: item.type,
      improved: null,
      beforeMeanUt: null,
      afterMeanUt: sig.meanUt ?? null,
      beforeAttendance: null,
      afterAttendance: sig.attendance ?? null,
      notes: "Marked done from interventions board",
    });
    setMsg(`Marked done: ${item.studentName || item.prn}`);
    setTick((t) => t + 1);
  }

  function markImproved(item, improved) {
    updateIntervention(item.id, { status: "done", completedAt: new Date().toISOString() });
    recordOutcome({
      interventionId: item.id,
      prn: item.prn,
      type: item.type,
      improved,
      notes: improved ? "Teacher marked improvement" : "No improvement observed",
    });
    setMsg(improved ? `Logged improvement for ${item.studentName}` : `Logged no improvement for ${item.studentName}`);
    setTick((t) => t + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Student Interventions</h1>
        <p className="text-sm text-muted-foreground">
          Assign actions to students, track open work, and log outcomes so effectiveness builds over time.
        </p>
        {msg && <p className="mt-1 text-xs text-muted-foreground">{msg}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Showing {students.length} of {allStudents.length} students
          {year !== "All" ? ` · ${year}` : ""}
          {batch !== "All" ? ` · batch ${batch}` : ""}
        </p>
        <YearBatchFilter {...filterProps} />
      </div>


      <SectionCard title="Effectiveness (closed loop)">
        {eff.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No outcomes logged yet. Assign an intervention, mark it done, then record improved / not improved.
          </p>
        ) : (
          <ul className="text-sm">
            {eff.map((e) => (
              <li key={e.type}>
                {INTERVENTION_TYPES.find((t) => t.id === e.type)?.label || e.type}:{" "}
                <b>
                  {e.improved}/{e.n}
                </b>{" "}
                improved
                {e.rate != null && ` (${(e.rate * 100).toFixed(0)}%)`}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={`Open queue (${open.length})`}>
        <div className="mb-2 flex gap-2 text-xs">
          {[
            { id: "open", label: "Open" },
            { id: "done", label: "Done" },
            { id: "all", label: "All" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded border px-2 py-1 ${filter === f.id ? "bg-gold-soft border-gold" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Student</th>
                <th className="py-2">Type</th>
                <th className="py-2">Reason</th>
                <th className="py-2">Status</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0">
                  <td className="py-2">
                    <div className="font-medium text-navy">{item.studentName || item.prn}</div>
                    <div className="text-xs text-muted-foreground">{item.prn}</div>
                  </td>
                  <td className="py-2">
                    {INTERVENTION_TYPES.find((t) => t.id === item.type)?.label || item.type}
                  </td>
                  <td className="py-2 text-xs max-w-xs">{item.reason}</td>
                  <td className="py-2">{item.status || "open"}</td>
                  <td className="py-2">
                    {(item.status === "open" || !item.status) && (
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded border px-2 py-0.5 text-xs"
                          onClick={() => markDone(item)}
                        >
                          Mark done
                        </button>
                        <button
                          type="button"
                          className="rounded border border-green-600/40 px-2 py-0.5 text-xs text-green-800"
                          onClick={() => markImproved(item, true)}
                        >
                          Improved
                        </button>
                        <button
                          type="button"
                          className="rounded border px-2 py-0.5 text-xs"
                          onClick={() => markImproved(item, false)}
                        >
                          Not improved
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={5} className="py-4 text-muted-foreground">
                    No interventions in this filter. Assign from the ranking below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Assign by need (uplift rank)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Student</th>
                <th className="py-2">Class</th>
                <th className="py-2">Status</th>
                <th className="py-2">Attendance</th>
                <th className="py-2">Uplift</th>
                <th className="py-2">Assign action</th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, 40).map((r) => (
                <tr key={r.student.prn} className="border-b last:border-b-0">
                  <td className="py-2">
                    <div className="font-medium text-navy">{r.student.name}</div>
                    <div className="text-xs text-muted-foreground">{r.student.prn}</div>
                  </td>
                  <td className="py-2 text-xs">{r.student.cls || r.student.className || "—"}</td>
                  <td className="py-2">{r.status || currentStatusOf(r.student)}</td>
                  <td className="py-2">
                    {r.student.attendance != null ? `${r.student.attendance}%` : "—"}
                  </td>
                  <td className="py-2 font-semibold">{((r.uplift || 0) * 100).toFixed(0)}%</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {INTERVENTION_TYPES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => assign(r, t.id)}
                          className="rounded border px-2 py-0.5 text-xs hover:bg-gold-soft"
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
