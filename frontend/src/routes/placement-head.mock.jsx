import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { PlacementYearBatchBar, PlacementExcelGrid } from "@/components/placement/PlacementExcelGrid";
import { api } from "@/lib/api";

export default function PhMock() {
  const [year, setYear] = useState("All");
  const [batch, setBatch] = useState("All");
  const [years, setYears] = useState([]);
  const [batches, setBatches] = useState([]);
  const [all, setAll] = useState([]);
  const [nominated, setNominated] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [msg, setMsg] = useState("");

  async function load() {
    const params = new URLSearchParams();
    if (year !== "All") params.set("year", year);
    if (batch !== "All") params.set("batch", batch);
    const [p, m] = await Promise.all([
      api(`/api/placement/profiles?${params}`),
      api(`/api/placement/mock-interview?${params}`),
    ]);
    setAll(p.profiles || []);
    setYears(p.years || []);
    setBatches(p.batches || []);
    setNominated(m.profiles || []);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [year, batch]);

  function toggle(prn) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(prn)) n.delete(prn);
      else n.add(prn);
      return n;
    });
  }

  async function nominate() {
    const prns = [...selected];
    if (!prns.length) {
      setMsg("Select students first (checkbox column via click list below).");
      return;
    }
    try {
      const r = await api("/api/placement/mock-interview/nominate", {
        method: "POST",
        body: JSON.stringify({ prns, note: `Nominated ${new Date().toISOString().slice(0, 10)}` }),
      });
      setMsg(`Nominated ${r.nominated} student(s) for mock interview.`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setMsg(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">Mock interview queue</h1>
      <p className="text-sm text-muted-foreground">
        Nominate students for mock interviews. Medium readiness or skill gaps are good candidates.
      </p>
      <PlacementYearBatchBar year={year} setYear={setYear} batch={batch} setBatch={setBatch} years={years} batches={batches} />
      {msg && <p className="text-sm text-navy/90">{msg}</p>}
      <button type="button" onClick={nominate} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white">
        Nominate selected ({selected.size})
      </button>
      <SectionCard title="Select candidates">
        <ul className="max-h-64 overflow-auto text-sm">
          {all.slice(0, 200).map((r) => (
            <li key={r.prn} className="flex items-center gap-2 border-b py-1">
              <input type="checkbox" checked={selected.has(r.prn)} onChange={() => toggle(r.prn)} />
              <span className="font-mono text-xs">{r.prn}</span>
              <span>{r.name}</span>
              <span className="text-xs text-muted-foreground">
                {r.readinessBand} · {r.employablePrediction}
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>
      <SectionCard title={`Already nominated (${nominated.length})`}>
        <PlacementExcelGrid rows={nominated} />
      </SectionCard>
    </div>
  );
}
