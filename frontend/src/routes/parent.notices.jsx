import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

export default function ParentNotices() {
  const [notices, setNotices] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/parent/notices")
      .then((r) => setNotices(r.notices || []))
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy">Notices</h1>
        <p className="text-sm text-muted-foreground">College announcements for parents</p>
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="space-y-3">
        {notices.map((n) => (
          <SectionCard key={n.id} title={n.title}>
            <p className="whitespace-pre-wrap text-sm text-navy/90">{n.body}</p>
            {n.createdAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                {new Date(n.createdAt).toLocaleString()}
              </p>
            )}
          </SectionCard>
        ))}
        {!notices.length && !err && (
          <p className="text-sm text-muted-foreground">No notices yet.</p>
        )}
      </div>
    </div>
  );
}
