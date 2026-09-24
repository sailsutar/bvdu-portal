import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import {
  rankStudentsByUplift,
  buildPriorityQueue,
  fairnessReport,
  interventionEffectiveness,
  listInterventions,
  listOutcomes,
  getAiSettings,
  setAiSettings,
} from "@/lib/academic-intelligence";
import { NoData } from "@/components/portal/NoData";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";

export default function AdminIntelligence() {
  const { students: allStudents } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);
  const [settings, setSettingsLocal] = useState(getAiSettings());
  const ranked = useMemo(() => rankStudentsByUplift(students), [students]);
  const { queue } = useMemo(() => buildPriorityQueue(students), [students]);
  const fairness = useMemo(() => fairnessReport(students), [students]);
  const effectiveness = interventionEffectiveness();
  const openInts = listInterventions().filter((i) => i.status === "open").length;
  const outcomes = listOutcomes();

  if (!allStudents.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Academic Intelligence</h1>
        <NoData message="Upload student data to activate the intelligence spine." />
      </div>
    );
  }

  function saveSettings(e) {
    e.preventDefault();
    const next = setAiSettings(settings);
    setSettingsLocal(next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Academic Intelligence</h1>
          <p className="text-sm text-muted-foreground">
            Uplift-ranked priority queue, fairness, intervention outcomes, and workload settings for{" "}
            {year}
            {batch !== "All" ? ` · batch ${batch}` : ""}.
          </p>
        </div>
        <YearBatchFilter {...filterProps} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard value={String(queue.length)} label="Workload-capped priority queue" />
        <StatCard value={String(openInts)} label="Open interventions" />
        <StatCard value={String(outcomes.length)} label="Logged outcomes" />
        <StatCard
          value={
            effectiveness.length
              ? `${Math.round(
                  (effectiveness.reduce((s, e) => s + (e.rate || 0), 0) / effectiveness.length) * 100
                )}%`
              : "—"
          }
          label="Avg intervention success"
        />
      </div>

      <SectionCard title="Priority queue (uplift-ranked)">
        <p className="mb-2 text-xs text-muted-foreground">
          Top intervenable students in this year/batch. Full intervention workflow is under{" "}
          <Link className="text-navy underline" to="/admin/interventions">
            Interventions
          </Link>
          .
        </p>
        <ul className="max-h-64 divide-y overflow-auto text-sm">
          {(queue.length ? queue : ranked).slice(0, 15).map((row, i) => {
            const s = row.student || row;
            const name = s.name || s.studentName || "Unknown";
            const prn = s.prn || row.prn || "—";
            const status = row.status || s.academicStatus || "";
            const upliftPct =
              row.uplift != null
                ? Math.round(Number(row.uplift) * 100)
                : row.upliftScore != null
                  ? Math.round(Number(row.upliftScore) * 100)
                  : null;
            return (
              <li key={prn + "-" + i} className="flex justify-between gap-2 py-2">
                <span className="min-w-0">
                  <b className="text-navy">{name}</b>
                  <span className="text-muted-foreground"> · {prn}</span>
                  {(s.cls || s.className) && (
                    <span className="text-muted-foreground"> · {s.cls || s.className}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  uplift {upliftPct != null ? `${upliftPct}%` : "—"} · {status}
                </span>
              </li>
            );
          })}
          {!queue.length && !ranked.length && (
            <li className="py-4 text-muted-foreground">No students in this filter.</li>
          )}
        </ul>
      </SectionCard>

      <SectionCard title="Fairness snapshot">
        <pre className="max-h-48 overflow-auto rounded bg-muted/40 p-3 text-xs">
          {JSON.stringify(fairness, null, 2)}
        </pre>
      </SectionCard>

      <SectionCard title="Intervention effectiveness">
        {!effectiveness.length ? (
          <p className="text-sm text-muted-foreground">
            Log outcomes on the Interventions page to see success rates by type.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {effectiveness.map((e) => (
              <li key={e.type} className="flex justify-between border-b py-1">
                <span>{e.type}</span>
                <span>
                  {Math.round((e.rate || 0) * 100)}% ({e.n || 0} cases)
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Workload settings">
        <form onSubmit={saveSettings} className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Teacher Guide weekly capacity
            <input
              type="number"
              min={1}
              className="rounded border px-2 py-1"
              value={settings.tgWeeklyCapacity ?? 8}
              onChange={(e) =>
                setSettingsLocal({ ...settings, tgWeeklyCapacity: Number(e.target.value) })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            Flag rate cap
            <input
              type="number"
              step={0.05}
              min={0}
              max={1}
              className="rounded border px-2 py-1"
              value={settings.flagRateCap ?? 0.15}
              onChange={(e) =>
                setSettingsLocal({ ...settings, flagRateCap: Number(e.target.value) })
              }
            />
          </label>
          <button type="submit" className="rounded-md bg-gold px-4 py-2 font-semibold text-navy">
            Save
          </button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          Model health, Outcome-Based Education evidence, and drift tools stay on their own nav
          pages.
        </p>
      </SectionCard>
    </div>
  );
}
