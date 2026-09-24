import { useMemo, useState } from "react";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { useSession } from "@/lib/auth";
import { useDerived } from "@/lib/upload-stats";
import { learnerSignals, useTgMentees, tgBatchLabel } from "@/lib/tg-assign";
import {
  buildPriorityQueue,
  createIntervention,
  listInterventions,
  recordOutcome,
  INTERVENTION_TYPES
} from "@/lib/academic-intelligence";
import { currentStatusOf } from "@/lib/ml-predict";
import { NoData } from "@/components/portal/NoData";

export default function TgInterventions() {
  const { session } = useSession();
  const { students } = useDerived();
  const { mentees: mine } = useTgMentees(students, session?.tgIndex);
  const [tick, setTick] = useState(0);
  const { queue, capacity } = useMemo(
    () => buildPriorityQueue(mine, { tgId: session?.id }),
    [mine, session?.id, tick]
  );
  const myOpen = listInterventions().filter(
    (i) => i.ownerTgId === session?.id && i.status === "open"
  );

  if (!students.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Intervention queue</h1>
        <NoData message="No mentees yet." />
      </div>
    );
  }

  function take(row, type) {
    createIntervention({
      prn: row.student.prn,
      studentName: row.student.name,
      type,
      ownerTgId: session?.id,
      ownerName: session?.name,
      reason: `Teacher Guide queue · uplift ${(row.uplift * 100).toFixed(0)}% · ${row.status}`,
      upliftScore: row.uplift,
      drivers: [
        row.signals.attendance != null && `att ${row.signals.attendance}%`,
        row.signals.utBasis && row.signals.utBasis !== "none" && row.signals.utBasis,
      ].filter(Boolean),
    });
    setTick((t) => t + 1);
  }

  function done(i) {
    const s = mine.find((x) => String(x.prn) === String(i.prn));
    const sig = s ? learnerSignals(s) : {};
    recordOutcome({
      interventionId: i.id,
      prn: i.prn,
      beforeStatus: "Average",
      afterStatus: currentStatusOf(s) || "Average",
      afterMeanUt: sig.meanUt,
      afterAttendance: sig.attendance,
      notes: "Completed by Teacher Guide",
    });
    setTick((t) => t + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Intervention queue</h1>
        <p className="text-sm text-muted-foreground">
          {session?.name} · {tgBatchLabel(session?.tgIndex)} · weekly capacity {capacity} · ranked by{" "}
          <b>uplift</b> (benefit if you act), workload-capped.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard value={String(queue.length)} label="Priority slots left this view" />
        <StatCard value={String(myOpen.length)} label="My open interventions" />
      </div>

      <SectionCard title="Take action (uplift order)">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Student</th>
              <th className="py-2">Status</th>
              <th className="py-2">Uplift</th>
              <th className="py-2">Act</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((r) => (
              <tr key={r.student.prn} className="border-b last:border-b-0">
                <td className="py-2 font-medium text-navy">{r.student.name}</td>
                <td className="py-2">{r.status}</td>
                <td className="py-2 font-semibold">{(r.uplift * 100).toFixed(0)}%</td>
                <td className="py-2">
                  <button
                    type="button"
                    className="rounded border px-2 py-0.5 text-xs hover:bg-gold-soft"
                    onClick={() => take(r, "mentor_meeting")}
                  >
                    Mentor meeting
                  </button>
                </td>
              </tr>
            ))}
            {!queue.length && (
              <tr>
                <td colSpan={4} className="py-4 text-muted-foreground">
                  Queue empty — capacity used or no high-uplift mentees under the flag-rate cap.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="My open items">
        <ul className="space-y-2 text-sm">
          {myOpen.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 rounded border p-2">
              <span>
                {i.studentName} — {INTERVENTION_TYPES.find((t) => t.id === i.type)?.label || i.type}
              </span>
              <button
                type="button"
                className="rounded bg-gold px-2 py-1 text-xs font-semibold text-navy"
                onClick={() => done(i)}
              >
                Done + outcome
              </button>
            </li>
          ))}
          {!myOpen.length && <li className="text-muted-foreground">None open.</li>}
        </ul>
      </SectionCard>
    </div>
  );
}
