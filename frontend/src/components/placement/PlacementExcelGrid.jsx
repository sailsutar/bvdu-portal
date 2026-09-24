/**
 * Spreadsheet-style view for placement coordinator / head.
 * Paginated for 400+ rows; compact actions with large tap targets.
 */
import { useMemo, useState } from "react";

const COLS = [
  { key: "prn", label: "PRN", w: "8.5rem" },
  { key: "name", label: "Name", w: "9rem" },
  { key: "yearLevel", label: "Year", w: "3.5rem" },
  { key: "batch", label: "Batch", w: "3.5rem" },
  { key: "status", label: "Status", w: "5.5rem" },
  { key: "consistency", label: "Consistency", w: "6.5rem" },
  { key: "placementMode", label: "Mode", w: "5.5rem" },
  { key: "employablePrediction", label: "Employability", w: "10rem" },
  { key: "primaryDomain", label: "Domain", w: "9rem" },
  { key: "readinessBand", label: "Band", w: "4.5rem" },
  { key: "readinessScore", label: "Score", w: "3.5rem" },
  { key: "completenessScore", label: "Complete %", w: "4.5rem" },
  { key: "cgpa", label: "CGPA", w: "3.5rem" },
  { key: "attendance", label: "Att %", w: "4rem" },
  { key: "activeKtCount", label: "KTs", w: "3rem" },
  { key: "internshipCount", label: "Interns", w: "4rem" },
];

const PAGE_SIZES = [25, 50, 100];

function cellClass(row, key) {
  if (key === "consistency" && row.consistency === "inconsistent") return "bg-red-50 text-red-800 font-semibold";
  if (key === "readinessBand" && row.readinessBand === "High") return "bg-emerald-50 text-emerald-800 font-semibold";
  if (key === "readinessBand" && row.readinessBand === "Low") return "bg-amber-50";
  if (key === "employablePrediction" && row.driveReady) return "bg-emerald-50 font-medium";
  if (key === "placementMode" && row.placementMode === "preparation") return "bg-amber-50 text-amber-900";
  if (key === "status" && row.status === "verified") return "bg-emerald-50";
  if (key === "status" && row.status === "submitted") return "bg-sky-50";
  return "";
}

function displayMode(row) {
  if (row.placementMode) return row.placementMode === "prediction" ? "Predict" : "Prep";
  if (row.predictionEligible) return "Predict";
  return "Prep";
}

export function PlacementYearBatchBar({ year, setYear, batch, setBatch, years = [], batches = [], extra }) {
  const yOpts = ["All", "FY", "SY", "TY", "LY", ...years.filter((y) => !["FY", "SY", "TY", "LY", "All"].includes(y))];
  const bOpts = ["All", ...batches.filter((b) => b && b !== "All")];
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <label className="grid gap-1 text-xs font-semibold text-navy">
        Year
        <select
          className="min-h-10 min-w-[7rem] rounded-lg border border-slate-300 bg-white px-3 text-sm"
          value={year || "All"}
          onChange={(e) => setYear(e.target.value)}
        >
          {yOpts.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-navy">
        Batch
        <select
          className="min-h-10 min-w-[6rem] rounded-lg border border-slate-300 bg-white px-3 text-sm"
          value={batch || "All"}
          onChange={(e) => setBatch(e.target.value)}
        >
          {bOpts.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      {extra}
    </div>
  );
}

export function PlacementExcelGrid({
  rows,
  onRowClick,
  selectedPrn,
  showActions,
  onVerify,
  onReturn,
  onLock,
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [busyPrn, setBusyPrn] = useState(null);

  const filtered = useMemo(() => {
    const list = rows || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (r) =>
        String(r.prn || "").toLowerCase().includes(needle) ||
        String(r.name || "").toLowerCase().includes(needle) ||
        String(r.status || "").toLowerCase().includes(needle) ||
        String(r.primaryDomain || "").toLowerCase().includes(needle)
    );
  }, [rows, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const slice = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  async function act(fn, prn) {
    if (!fn) return;
    setBusyPrn(prn);
    try {
      await fn(prn);
    } finally {
      setBusyPrn(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search PRN, name, status, domain…"
          className="min-h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Rows
          <select
            className="min-h-10 rounded-lg border border-slate-300 px-2 text-sm"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">
          {filtered.length} row{filtered.length === 1 ? "" : "s"}
          {q ? ` (filtered)` : ""}
        </span>
      </div>

      <div className="max-h-[min(70vh,720px)] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-navy text-white">
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-2 py-2.5 font-semibold" style={{ minWidth: c.w }}>
                  {c.label}
                </th>
              ))}
              {showActions && <th className="px-2 py-2.5">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr
                key={r.prn}
                onClick={() => onRowClick?.(r)}
                className={`border-b border-slate-200 ${
                  selectedPrn === r.prn ? "bg-gold/25" : i % 2 ? "bg-slate-50/80" : "bg-white"
                } cursor-pointer hover:bg-sky-50/80`}
              >
                {COLS.map((c) => {
                  let val = r[c.key];
                  if (c.key === "placementMode") val = displayMode(r);
                  return (
                    <td
                      key={c.key}
                      className={`border-r border-slate-100 px-2 py-2 tabular-nums ${cellClass(r, c.key)}`}
                      style={{ minWidth: c.w }}
                      title={c.key === "employablePrediction" ? (r.gaps || []).join("; ") : undefined}
                    >
                      {val == null || val === "" ? "—" : String(val)}
                    </td>
                  );
                })}
                {showActions && (
                  <td className="whitespace-nowrap px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap gap-1">
                      {r.status === "submitted" && (
                        <>
                          <button
                            type="button"
                            disabled={busyPrn === r.prn}
                            className="min-h-9 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white disabled:opacity-50"
                            onClick={() => act(onVerify, r.prn)}
                          >
                            Verify
                          </button>
                          <button
                            type="button"
                            disabled={busyPrn === r.prn}
                            className="min-h-9 rounded-md bg-amber-500 px-2.5 text-xs font-semibold text-white disabled:opacity-50"
                            onClick={() => act(onReturn, r.prn)}
                          >
                            Return
                          </button>
                        </>
                      )}
                      {r.status === "verified" && (
                        <button
                          type="button"
                          disabled={busyPrn === r.prn}
                          className="min-h-9 rounded-md bg-navy px-2.5 text-xs font-semibold text-white disabled:opacity-50"
                          onClick={() => act(onLock, r.prn)}
                        >
                          Lock
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!slice.length && (
              <tr>
                <td
                  colSpan={COLS.length + (showActions ? 1 : 0)}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  No rows for this filter. Sync academic Excel or ask students to open Placement profile.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button
          type="button"
          className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:opacity-40"
          disabled={safePage <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          Previous
        </button>
        <span className="text-xs text-muted-foreground">
          Page {safePage + 1} / {pageCount}
        </span>
        <button
          type="button"
          className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:opacity-40"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        >
          Next
        </button>
      </div>
    </div>
  );
}
