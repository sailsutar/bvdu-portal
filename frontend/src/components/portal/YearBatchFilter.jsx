import { uniqueBatches, uniqueYears, YEAR_LABELS } from "@/lib/year-batch";

/**
 * Shared year + batch selectors. Values are canonical: FY|SY|TY|LY/FINAL and A–H.
 */
export default function YearBatchFilter({
  students,
  year,
  batch,
  onYearChange,
  onBatchChange,
  className = "",
}) {
  const years = uniqueYears(students);
  const batches = uniqueBatches(students, year);

  return (
    <div className={`bvu-filter-bar w-full sm:w-auto ${className}`}>
      <label className="flex min-h-11 flex-1 flex-col gap-1 text-sm sm:min-w-[7.5rem] sm:flex-none">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Year</span>
        <select
          className="bvu-focus-ring min-h-11 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-sm"
          value={year || "All"}
          onChange={(e) => onYearChange(e.target.value)}
        >
          <option value="All">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {YEAR_LABELS[y] || y}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 flex-1 flex-col gap-1 text-sm sm:min-w-[7.5rem] sm:flex-none">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Batch</span>
        <select
          className="bvu-focus-ring min-h-11 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-sm"
          value={batch || "All"}
          onChange={(e) => onBatchChange(e.target.value)}
        >
          <option value="All">All batches</option>
          {batches.map((b) => (
            <option key={b} value={b}>
              Batch {b}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
