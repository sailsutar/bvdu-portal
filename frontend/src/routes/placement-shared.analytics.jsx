import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { PlacementYearBatchBar } from "@/components/placement/PlacementExcelGrid";
import { api } from "@/lib/api";

export default function PlacementAnalytics({ roleTitle = "Analytics" }) {
  const [year, setYear] = useState("All");
  const [batch, setBatch] = useState("All");
  const [years, setYears] = useState([]);
  const [batches, setBatches] = useState([]);
  const [data, setData] = useState(null);
  const [board, setBoard] = useState([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (year !== "All") params.set("year", year);
    if (batch !== "All") params.set("batch", batch);
    Promise.all([
      api(`/api/placement/analytics/skills?${params}`),
      api(`/api/placement/leaderboard?${params}`),
      api("/api/placement/profiles"),
    ])
      .then(([a, l, p]) => {
        setData(a);
        setBoard(l.leaderboard || []);
        setYears(p.years || []);
        setBatches(p.batches || []);
      })
      .catch((e) => setMsg(e.message));
  }, [year, batch]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">{roleTitle}</h1>
      <p className="text-sm text-muted-foreground">
        Skill heat distribution, readiness leaderboard with batch percentile, year/batch health — recomputed live from
        Excel + student profiles.
      </p>
      <PlacementYearBatchBar year={year} setYear={setYear} batch={batch} setBatch={setBatch} years={years} batches={batches} />
      {msg && <p className="text-sm text-danger">{msg}</p>}

      {data && (
        <>
          <SectionCard title="Core skill heatmap (ratings 1–5)">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2">Skill</th>
                    <th>Avg</th>
                    <th>Rated</th>
                    <th>1</th>
                    <th>2</th>
                    <th>3</th>
                    <th>4</th>
                    <th>5</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.heatmap || []).map((h) => (
                    <tr key={h.key} className="border-b">
                      <td className="py-2 font-semibold">{h.label}</td>
                      <td>{h.avg ?? "—"}</td>
                      <td>{h.rated}</td>
                      {[1, 2, 3, 4, 5].map((b) => (
                        <td key={b}>
                          <span
                            className="inline-block min-w-[1.5rem] rounded px-1 text-center"
                            style={{
                              background:
                                h.buckets[b] > 0
                                  ? `rgba(15, 45, 80, ${Math.min(0.85, 0.15 + h.buckets[b] / Math.max(h.rated, 1))})`
                                  : undefined,
                              color: h.buckets[b] > 0 ? "#fff" : undefined,
                            }}
                          >
                            {h.buckets[b]}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Year / batch health">
            <pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(data.byYearBatch, null, 2)}</pre>
          </SectionCard>
        </>
      )}

      <SectionCard title="Readiness leaderboard (percentile in filter)">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-2">Rank</th>
              <th>%ile</th>
              <th>PRN</th>
              <th>Name</th>
              <th>Year</th>
              <th>Score</th>
              <th>Prediction</th>
            </tr>
          </thead>
          <tbody>
            {board.map((r) => (
              <tr key={r.prn} className="border-b">
                <td className="py-1">{r.rank}</td>
                <td>{r.percentile}</td>
                <td className="font-mono">{r.prn}</td>
                <td>{r.name}</td>
                <td>{r.yearLevel}</td>
                <td className="font-semibold">{r.readinessScore}</td>
                <td>{r.employablePrediction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}
