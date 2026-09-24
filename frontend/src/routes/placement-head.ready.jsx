import { useCallback, useEffect, useState } from "react";
import { PlacementExcelGrid, PlacementYearBatchBar } from "@/components/placement/PlacementExcelGrid";
import { api } from "@/lib/api";

export default function PhReady() {
  const [year, setYear] = useState("All");
  const [batch, setBatch] = useState("All");
  const [rows, setRows] = useState([]);
  const [years, setYears] = useState([]);
  const [batches, setBatches] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ driveReady: "1" });
    if (year !== "All") params.set("year", year);
    if (batch !== "All") params.set("batch", batch);
    const r = await api(`/api/placement/profiles?${params}`);
    setRows(r.profiles || []);
    setYears(r.years || []);
    setBatches(r.batches || []);
  }, [year, batch]);

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">Drive ready</h1>
      <p className="text-sm text-muted-foreground">
        Dynamic shortlist: High readiness + consistent (no active KT). Uses placement form + Excel attendance/CGPA.
      </p>
      <PlacementYearBatchBar year={year} setYear={setYear} batch={batch} setBatch={setBatch} years={years} batches={batches} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          onClick={async () => {
            setBusy(true);
            setMsg("");
            try {
              const r = await api("/api/placement/tade/batch", {
                method: "POST",
                body: JSON.stringify({ year, batch, verifiedOnly: true }),
              });
              setMsg(`TADE scored ${r.count} profile(s).`);
              await load();
            } catch (e) {
              setMsg(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Scoring…" : "Run batch TADE"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-navy/30 px-4 py-2 text-sm font-semibold text-navy"
          onClick={() => {
            const q = new URLSearchParams({ driveReady: "1" });
            if (year !== "All") q.set("year", year);
            if (batch !== "All") q.set("batch", batch);
            window.open(`/api/placement/tade/shortlist.csv?${q}`, "_blank");
          }}
        >
          Export TADE shortlist CSV
        </button>
      </div>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      <PlacementExcelGrid rows={rows} />
    </div>
  );
}
