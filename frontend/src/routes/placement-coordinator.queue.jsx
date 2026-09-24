import { useCallback, useEffect, useState } from "react";
import { PlacementExcelGrid, PlacementYearBatchBar } from "@/components/placement/PlacementExcelGrid";
import { api } from "@/lib/api";

export default function PcQueue() {
  const [year, setYear] = useState("All");
  const [batch, setBatch] = useState("All");
  const [rows, setRows] = useState([]);
  const [years, setYears] = useState([]);
  const [batches, setBatches] = useState([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ missing: "1" });
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
      <h1 className="text-xl font-bold text-navy">Missing data queue</h1>
      <p className="text-sm text-muted-foreground">
        Dynamic list: incomplete profiles, KTs, missing skills. Rows sort by readiness (TADE-blended) so urgent profiles surface first.
      </p>
      <PlacementYearBatchBar year={year} setYear={setYear} batch={batch} setBatch={setBatch} years={years} batches={batches} />
      {msg && <p className="text-sm text-danger">{msg}</p>}
      <PlacementExcelGrid rows={rows} />
    </div>
  );
}
