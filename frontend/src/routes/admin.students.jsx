import { Link } from "react-router-dom";
import { useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { normalizeIdentifier, useDerived } from "@/lib/upload-stats";
import { NoData } from "@/components/portal/NoData";
import { Eye, Download } from "lucide-react";
import { MessageParentButton } from "@/components/portal/MessageParentModal";
import {
  useStudentPredictions,
  currentStatusOf,
  statusBadgeClass,
} from "@/lib/ml-predict";
import { parseAcademicGroup } from "@/lib/academic-group";
import { uniqueYears, uniqueBatches, parseYearBatch, filterByYearBatch, YEAR_LABELS } from "@/lib/year-batch";
import { useYearBatchSelection } from "@/lib/use-year-batch";
import YearBatchFilter from "@/components/portal/YearBatchFilter";


function AcademicBadge({ status }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(status)}`}
    >
      {status}
    </span>
  );
}

function StudentsList() {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [filterTarget, setFilterTarget] = useState("current"); // current | predicted
  const [attFilter, setAttFilter] = useState("all"); // all | below75 | above75
  const { year: yearFilter, batch: batchFilter, setYear: setYearFilter, setBatch: setBatchFilter } = useYearBatchSelection();
  const { students } = useDerived();
  const { predictions, predSource, isLoading: mlLoading, isError: mlError, error: mlErr } = useStudentPredictions(students);

  if (students.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Students</h1>
        <NoData message="No student data yet. Upload an Excel with a PRN/Roll column to populate this list." />
      </div>
    );
  }

  const needle = normalizeIdentifier(q);
  const yearOptions = uniqueYears(students);
  // Batches only for the selected year (LY → only LY batches)
  const batchOptions = uniqueBatches(students, yearFilter);

  // Strict year + batch first — TY-A must never appear under LY + A
  const yearBatchScoped = filterByYearBatch(students, yearFilter, batchFilter);

  const filtered = yearBatchScoped.filter((s) => {
    const current = currentStatusOf(s);
    const pred = predictions.get(String(s.prn));
    // Predicted mode: only ML/early-warning status — do not fall back to current academic status
    const predicted = pred?.status || null;
    if (filterTarget === "predicted") {
      if (!predicted) return false; // only rows with a real prediction
      if (statusFilter !== "All" && predicted !== statusFilter) return false;
    } else {
      if (statusFilter !== "All" && current !== statusFilter) return false;
    }

    if (attFilter === "below75") {
      if (!s.attendanceKnown || s.attendance == null || s.attendance >= 75) return false;
    } else if (attFilter === "above75") {
      if (!s.attendanceKnown || s.attendance == null || s.attendance < 75) return false;
    }

    if (!needle) return true;
    return (
      normalizeIdentifier(s.name).includes(needle) ||
      normalizeIdentifier(s.prn).includes(needle)
    );
  });

  if (mlLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Students</h1>
        <div className="flex min-h-[22rem] flex-col items-center justify-center gap-4 rounded-xl border bg-card p-10 shadow-sm">
          <div
            className="h-12 w-12 animate-spin rounded-full border-4 border-navy/20 border-t-gold"
            role="status"
            aria-label="Loading machine learning predictions"
          />
          <p className="text-sm font-medium text-navy">Loading Random Forest predictions…</p>
          <p className="max-w-md text-center text-xs text-muted-foreground">
            Student list appears after the model finishes. Rule-based estimates are disabled.
            Keep the machine learning service running on port 8001.
          </p>
        </div>
      </div>
    );
  }

  if (mlError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Students</h1>
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-6 text-sm">
          <p className="font-semibold text-danger">Machine learning service did not respond</p>
          <p className="mt-2 text-muted-foreground">
            {mlErr?.message || "Start the ML service (port 8001), then refresh this page."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Only Random Forest model predictions are shown. Please wait until loading finishes.
          </p>
        </div>
      </div>
    );
  }

  function exportCsv() {

    const headers = [
      "PRN",
      "Name",
      "Class",
      "Attendance",
      "CGPA",
      "Avg%",
      "Current Status",
      "Predicted Status",
    ];
    const lines = [headers.join(",")];
    for (const s of filtered) {
      const current = currentStatusOf(s);
      const pred = predictions.get(String(s.prn));
      const predictedStatus = pred?.status || null; // never substitute current academic status
      lines.push(
        [
          s.prn,
          `"${(s.name || "").replace(/"/g, '""')}"`,
          s.cls || "",
          s.attendanceKnown ? s.attendance : "",
          s.cgpaKnown && s.cgpa != null ? s.cgpa : "",
          s.averagePercentage != null ? s.averagePercentage : "",
          current,
          predictedStatus,
        ].join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "students-status.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Students</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Current Academic Status is from uploaded marks and attendance. Predicted Status is only from the Random Forest model (shown after the model finishes loading).
        </p>
      </div>

      <SectionCard>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Filter by:</span>
            {[
              { id: "current", label: "Current" },
              { id: "predicted", label: "Predicted" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilterTarget(t.id)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  filterTarget === t.id
                    ? "border-gold bg-gold-soft text-navy"
                    : "bg-background text-navy hover:bg-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {["All", "At Risk", "Average", "Good"].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                statusFilter === f
                  ? "border-gold bg-gold-soft text-navy"
                  : "bg-background text-navy hover:bg-muted"
              }`}
            >
              {f === "All" ? "All Status" : f}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">Attendance:</span>
          {[
            { id: "all", label: "All" },
            { id: "below75", label: "Below 75%" },
            { id: "above75", label: "75% and above" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setAttFilter(f.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                attFilter === f.id
                  ? "border-gold bg-gold-soft text-navy"
                  : "bg-background text-navy hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
          <select
            className="rounded-md border px-2 py-1.5 text-xs"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
          >
            <option value="All">All years</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border px-2 py-1.5 text-xs"
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
          >
            <option value="All">All batches</option>
            {batchOptions.map((b) => (
              <option key={b} value={b}>
                Batch {b}
              </option>
            ))}
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, Permanent Registration Number or Roll No."
            className="ml-auto w-64 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
          />
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-navy hover:bg-gold-soft"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3">Permanent Registration Number</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Class / Batch</th>
                <th className="py-2 pr-3">Attendance</th>
                <th className="py-2 pr-3">Avg %</th>
                <th className="py-2 pr-3">Current Academic Status</th>
                <th className="py-2 pr-3">Predicted Status (Early-Warning)</th>
                <th className="py-2 pr-3">Message</th>
                <th className="py-2">View</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const current = currentStatusOf(s);
                const pred = predictions.get(String(s.prn));
                const predictedStatus = pred?.status || null; // never substitute current academic status
                const differs = predictedStatus != null && predictedStatus !== current;

                return (
                  <tr key={s.prn} className="border-b last:border-b-0">
                    <td className="py-3 pr-3 tabular-nums">{s.prn}</td>
                    <td className="py-3 pr-3 font-medium text-navy">{s.name}</td>
                    <td className="py-3 pr-3">{s.cls || "—"}</td>
                    <td
                      className={`py-3 pr-3 font-semibold ${
                        !s.attendanceKnown
                          ? "text-muted-foreground"
                          : s.attendance < 75
                            ? "text-danger"
                            : "text-success"
                      }`}
                    >
                      {s.attendanceKnown ? `${s.attendance}%` : "—"}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">
                      {s.averagePercentage != null ? `${s.averagePercentage}%` : "—"}
                    </td>
                    <td className="py-3 pr-3">
                      <AcademicBadge status={current} />
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-col items-start gap-0.5">
                        <AcademicBadge status={predictedStatus} />
                        {differs && (
                          <span className="text-[10px] font-medium text-warning">Differs</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <MessageParentButton student={s} mode="full" />
                    </td>
                    <td className="py-3">
                      <Link
                        to={`/admin/students/${encodeURIComponent(s.prn)}`}
                        className="inline-flex items-center gap-1 text-navy hover:underline"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {filtered.length} of {students.length} students
          </span>
          <span>
            Prediction source:{" "}
            {predSource === "ml"
              ? "Random Forest machine learning model"
              : predSource === "error"
                ? "Machine learning unavailable"
                : "Loading model…"}
          </span>
        </div>
      </SectionCard>
    </div>
  );
}

export default StudentsList;
