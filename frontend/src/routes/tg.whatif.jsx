import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { useSession } from "@/lib/auth";
import { useDerived } from "@/lib/upload-stats";
import { learnerSignals, useTgMentees } from "@/lib/tg-assign";
import {
  simulateTrajectory,
  minimumActionableChange,
} from "@/lib/advanced-intelligence";
import { currentStatusOf } from "@/lib/ml-predict";
import { NoData } from "@/components/portal/NoData";

export default function TgWhatIf() {
  const { session } = useSession();
  const { students } = useDerived();
  const { mentees: mine } = useTgMentees(students, session?.tgIndex);
  const [prn, setPrn] = useState(mine[0]?.prn || "");
  const student = mine.find((s) => String(s.prn) === String(prn)) || mine[0];
  const sig = student ? learnerSignals(student) : {};
  const [att, setAtt] = useState(sig.attendance ?? 70);
  const [ut, setUt] = useState(sig.meanUt ?? 10);

  useEffect(() => {
    if (!student) return;
    const s = learnerSignals(student);
    setAtt(s.attendance ?? 70);
    setUt(s.meanUt ?? 10);
  }, [student?.prn]);

  if (!mine.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">What-if simulator</h1>
        <NoData message="No mentees." />
      </div>
    );
  }

  const sim = simulateTrajectory(student, { attendance: att, meanUt: ut });
  const minAct = minimumActionableChange(student);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">What-if trajectory simulator</h1>
        <p className="text-sm text-muted-foreground">
          Counterfactual levers: change attendance / mean unit test and see predicted status + minimum
          actionable change to flip the band.
        </p>
      </div>

      <SectionCard title="Student">
        <select
          className="w-full max-w-md rounded border px-2 py-1.5 text-sm"
          value={student?.prn}
          onChange={(e) => setPrn(e.target.value)}
        >
          {mine.map((s) => (
            <option key={s.prn} value={s.prn}>
              {s.name} ({s.prn}) — {currentStatusOf(s)}
            </option>
          ))}
        </select>
      </SectionCard>

      <SectionCard title="Levers">
        <label className="mb-4 block text-sm">
          Attendance: <b>{att}%</b>
          <input
            type="range"
            min={40}
            max={100}
            value={att}
            onChange={(e) => setAtt(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          Mean Unit Test: <b>{Number(ut).toFixed(1)}/20</b>
          <input
            type="range"
            min={0}
            max={20}
            step={0.5}
            value={ut}
            onChange={(e) => setUt(Number(e.target.value))}
            className="mt-1 w-full"
          />
        </label>
      </SectionCard>

      <SectionCard title="Simulated outcome">
        <p className="text-sm">
          Baseline: <b>{sim.baseline}</b> → Simulated:{" "}
          <b className={sim.flipped ? "text-success" : ""}>{sim.simulated}</b>
          {sim.flipped && " (status would flip)"}
        </p>
      </SectionCard>

      <SectionCard title="Minimum actionable change">
        {minAct?.alreadyGood && <p className="text-sm">Already Good — maintain trajectory.</p>}
        {minAct?.unreachable && (
          <p className="text-sm text-muted-foreground">No simple path found in search grid.</p>
        )}
        {minAct?.deltaAttendance != null && (
          <p className="text-sm">
            To reach <b>{minAct.target}</b>: about{" "}
            <b>+{minAct.deltaAttendance}% attendance</b> and/or{" "}
            <b>+{minAct.deltaMeanUt} mean unit test marks</b> (e.g. attendance → {minAct.newAttendance}%,
            mean unit test → {minAct.newMeanUt}/20).
          </p>
        )}
      </SectionCard>
    </div>
  );
}
