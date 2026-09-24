import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

export default function ParentIndex() {
  const [children, setChildren] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/parent/children")
      .then((r) => setChildren(r.children || []))
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy">My children</h1>
        <p className="text-sm text-muted-foreground">
          Academic and placement summaries from the college database (no WhatsApp fees).
        </p>
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {children.map((c) => (
          <Link
            key={c.prn}
            to={`/parent/child/${encodeURIComponent(c.prn)}`}
            className="rounded-2xl border bg-card p-4 shadow-sm transition hover:border-navy/30 hover:shadow-md"
          >
            <p className="font-semibold text-navy">{c.name || c.prn}</p>
            <p className="text-xs text-muted-foreground">PRN {c.prn}</p>
            <p className="mt-2 text-sm">
              {c.yearLevel || "—"}
              {c.batch ? ` · Batch ${c.batch}` : ""}
            </p>
            <p className="mt-1 text-sm">
              Attendance:{" "}
              <strong>{c.attendance != null ? `${c.attendance}%` : "—"}</strong>
              {" · "}
              Status: <strong>{c.status || "—"}</strong>
            </p>
          </Link>
        ))}
        {!children.length && !err && (
          <p className="text-sm text-muted-foreground">No linked students found for this mobile.</p>
        )}
      </div>
    </div>
  );
}
