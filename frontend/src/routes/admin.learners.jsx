import { useMemo, useState } from "react";
import { SectionCard, StatCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import {
  partitionLearners,
  learnerSignals,
  sortByBatchThenNumber,
  batchSortKey,
} from "@/lib/tg-assign";
import { currentStatusOf, statusBadgeClass } from "@/lib/ml-predict";
import { NoData } from "@/components/portal/NoData";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";
import { YEAR_LABELS } from "@/lib/year-batch";

function Badge({ status }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(status)}`}
    >
      {status}
    </span>
  );
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 10) / 10}`;
}

function LearnerTable({ rows, empty }) {
  if (!rows.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-3">Batch</th>
            <th className="py-2 pr-3">Permanent Registration Number</th>
            <th className="py-2 pr-3">Name</th>
            <th className="py-2 pr-3">Class</th>
            <th className="py-2 pr-3">Attendance</th>
            <th className="py-2 pr-3">Mean Unit Test (/20)</th>
            <th className="py-2 pr-3">Unit Test basis</th>
            <th className="py-2 pr-3">Unit Test fail rate</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const sig = learnerSignals(s);
            const key = batchSortKey(s);
            return (
              <tr key={s.prn} className="border-b last:border-b-0">
                <td className="py-3 pr-3 font-semibold text-navy">
                  {key.batch === "ZZ" ? "—" : key.batch}
                </td>
                <td className="py-3 pr-3 tabular-nums">{s.prn}</td>
                <td className="py-3 pr-3 font-medium text-navy">{s.name}</td>
                <td className="py-3 pr-3">{s.cls || "—"}</td>
                <td
                  className={`py-3 pr-3 font-semibold ${
                    sig.attendance == null
                      ? "text-muted-foreground"
                      : sig.attendance < 65
                        ? "text-danger"
                        : sig.attendance >= 80
                          ? "text-success"
                          : "text-navy"
                  }`}
                >
                  {sig.attendance != null ? `${sig.attendance}%` : "—"}
                </td>
                <td
                  className={`py-3 pr-3 tabular-nums font-semibold ${
                    sig.meanUt == null
                      ? "text-muted-foreground"
                      : sig.meanUt < 8
                        ? "text-danger"
                        : sig.meanUt >= 14
                          ? "text-success"
                          : "text-navy"
                  }`}
                >
                  {sig.meanUt != null ? fmt(sig.meanUt) : "—"}
                </td>
                <td className="py-3 pr-3 text-xs text-muted-foreground">
                  {sig.utBasis === "none" ? "—" : sig.utBasis}
                </td>
                <td className="py-3 pr-3 tabular-nums">
                  {sig.utFailRate != null ? `${Math.round(sig.utFailRate * 100)}%` : "—"}
                </td>
                <td className="py-3">
                  <Badge status={currentStatusOf(s)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminLearners() {
  const { students: allStudents } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);
  const [tab, setTab] = useState("slow");

  const { slow, fast } = useMemo(() => partitionLearners(students), [students]);

  // Batch A (numbers asc) → Batch B (numbers asc) → …
  const slowSorted = useMemo(() => sortByBatchThenNumber(slow), [slow]);
  const fastSorted = useMemo(() => sortByBatchThenNumber(fast), [fast]);

  if (!allStudents.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Slow and Fast Learners</h1>
        <NoData message="Upload student data to classify learners." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1 className="text-2xl font-bold text-navy">Slow and Fast Learners</h1>
        <p className="text-sm text-muted-foreground">
          Rules: mean marks <b>&lt; 8/20</b> → slow learner; mean marks <b>&gt; 15/20</b> → fast learner.
            Clear <b>spike</b> (Unit Test 1 &lt; 8 then Unit Test 2 &gt; 15 on enough subjects) also counts as fast.
            Percentage-only sheets are mapped to a /20 scale (percentage ÷ 5).</p>
        <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
          <li>
            <span className="font-medium text-navy">Slow:</span> attendance &lt; 65%, or mean unit test
            Mean marks &lt; 8/20 (or equivalent percentage)
          </li>
          <li>
            <span className="font-medium text-navy">Fast:</span> mean unit test ≥ 14/20 with low fails, and
            Mean marks &gt; 15/20, or low→high Unit Test spike
          </li>
        </ul>
      </div>

        <YearBatchFilter {...filterProps} />
      </div>
      <p className="text-xs text-muted-foreground">
        Filter: {year === "All" ? "All years" : (YEAR_LABELS[year] || year)}{batch !== "All" ? ` · batch ${batch}` : ""} · {students.length} students in view
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard value={String(slowSorted.length)} label="Slow learners" />
        <StatCard value={String(fastSorted.length)} label="Fast learners" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("slow")}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
            tab === "slow"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "bg-background text-navy"
          }`}
        >
          Slow learners ({slowSorted.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("fast")}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
            tab === "fast"
              ? "border-success/40 bg-success/10 text-success"
              : "bg-background text-navy"
          }`}
        >
          Fast learners ({fastSorted.length})
        </button>
      </div>

      <SectionCard
        title={
          tab === "slow"
            ? "Slow learners (Batch A → B, numbers ascending)"
            : "Fast learners (Batch A → B, numbers ascending)"
        }
      >
        <LearnerTable
          rows={tab === "slow" ? slowSorted : fastSorted}
          empty={
            tab === "slow"
              ? "No slow learners matched UT + attendance criteria."
              : "No fast learners matched UT + attendance criteria."
          }
        />
      </SectionCard>
    </div>
  );
}
