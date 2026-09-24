import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

export default function Page() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      const d = await api("/api/notifications");
      setItems(d.notifications || []);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">Notifications</h1>
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-xs"
          onClick={async () => {
            try {
              await api("/api/notifications/read-all", { method: "POST", body: "{}" });
              await load();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Mark all read
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <SectionCard>
        <ul className="divide-y">
          {items.map((a) => (
            <li key={a._id || a.title} className="flex items-start justify-between gap-3 py-3 text-sm">
              <div>
                <p className={`font-medium text-navy ${a.read ? "opacity-70" : ""}`}>{a.title}</p>
                {a.body && <p className="text-xs text-muted-foreground">{a.body}</p>}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}
              </span>
            </li>
          ))}
          {!items.length && (
            <li className="py-6 text-muted-foreground">
              No notifications yet. Submitting an assignment will create one here.
            </li>
          )}
        </ul>
      </SectionCard>
    </div>
  );
}
