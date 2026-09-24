import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

export default function ParentChild() {
  const { prn } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api(`/api/parent/children/${encodeURIComponent(prn)}`)
      .then(setD)
      .catch((e) => setErr(e.message));
  }, [prn]);

  if (err) return <p className="text-sm text-danger">{err}</p>;
  if (!d) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const pl = d.placement || {};

  return (
    <div className="space-y-5">
      <div>
        <Link to="/parent" className="text-xs font-semibold text-navy underline">
          ← All children
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-navy">{d.name || d.prn}</h1>
        <p className="text-sm text-muted-foreground">
          PRN {d.prn}
          {d.yearLevel ? ` · ${d.yearLevel}` : ""}
          {d.batch ? ` · Batch ${d.batch}` : ""}
        </p>
      </div>

      <SectionCard title="Attendance">
        <p className="text-3xl font-bold text-navy">
          {d.attendance != null ? `${d.attendance}%` : "—"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">From college academic records</p>
      </SectionCard>

      <SectionCard title="Marks">
        <p className="mb-2 text-sm">
          Overall average: <strong>{d.averagePercentage != null ? `${d.averagePercentage}%` : "—"}</strong>
          {" · "}
          Status: <strong>{d.status || "—"}</strong>
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 pr-3">Subject</th>
                <th className="py-2 pr-3">UT-1</th>
                <th className="py-2 pr-3">UT-2</th>
                <th className="py-2 pr-3">UT-3</th>
              </tr>
            </thead>
            <tbody>
              {(d.marks || []).map((m) => (
                <tr key={m.subject} className="border-b border-muted/40">
                  <td className="py-2 pr-3 font-medium">{m.subject}</td>
                  <td className="py-2 pr-3">{m.ut1 ?? "—"}</td>
                  <td className="py-2 pr-3">{m.ut2 ?? "—"}</td>
                  <td className="py-2 pr-3">{m.ut3 ?? "—"}</td>
                </tr>
              ))}
              {!(d.marks || []).length && (
                <tr>
                  <td colSpan={4} className="py-3 text-muted-foreground">
                    No unit test marks on record yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Placement / career">
        {!pl.available ? (
          <p className="text-sm text-muted-foreground">{pl.message || "Not available yet."}</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              Mode: <strong>{pl.mode === "prediction" ? "Readiness (TY/LY)" : "Preparation (FY/SY)"}</strong>
            </p>
            {pl.readinessBand && (
              <p>
                Readiness: <strong>{pl.readinessBand}</strong>
                {pl.readinessScore != null ? ` (${Math.round(pl.readinessScore)})` : ""}
              </p>
            )}
            {pl.topDomain && (
              <p>
                Top domain: <strong>{pl.topDomain}</strong>
              </p>
            )}
            {(pl.domains || []).length > 0 && (
              <p>Domain set: {(pl.domains || []).join(", ")}</p>
            )}
            {(pl.actions || []).length > 0 && (
              <div>
                <p className="font-medium text-navy">Suggested actions</p>
                <ul className="mt-1 list-disc pl-5">
                  {pl.actions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
