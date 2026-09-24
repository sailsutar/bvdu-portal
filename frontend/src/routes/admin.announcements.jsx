import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

export default function AdminAnnouncements() {
  const [list, setList] = useState([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const d = await api("/api/announcements");
      setList(d.announcements || []);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    setMsg("");
    try {
      await api("/api/announcements", {
        method: "POST",
        body: JSON.stringify({ title: title.slice(0, 200), body: body.slice(0, 4000), date }),
      });
      setTitle("");
      setBody("");
      setMsg("Announcement published.");
      await load();
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function remove(id) {
    if (!confirm("Deactivate this announcement?")) return;
    try {
      await api(`/api/announcements/${encodeURIComponent(id)}`, { method: "DELETE" });
      setMsg("Announcement removed.");
      await load();
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Announcements</h1>
        <p className="text-sm text-muted-foreground">
          Manage messages shown on the student dashboard. Stored in MongoDB.
        </p>
      </div>
      {msg && <p className="text-sm text-navy">{msg}</p>}

      <SectionCard title="New announcement">
        <form onSubmit={create} className="grid max-w-xl gap-3 text-sm">
          <input
            required
            maxLength={200}
            placeholder="Title"
            className="rounded border px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            maxLength={4000}
            rows={4}
            placeholder="Body (optional)"
            className="rounded border px-3 py-2"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <input
            type="date"
            className="rounded border px-3 py-2"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button type="submit" className="w-fit rounded-md bg-gold px-4 py-2 font-semibold text-navy">
            Publish
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Active announcements">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No announcements yet.</p>
        ) : (
          <ul className="divide-y">
            {list.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="font-medium text-navy">{a.title}</p>
                  {a.body && <p className="mt-1 text-sm text-muted-foreground">{a.body}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{a.date}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded border border-destructive/40 px-2 py-1 text-xs text-destructive"
                  onClick={() => remove(a.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
