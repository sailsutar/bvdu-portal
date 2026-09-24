import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

export default function Page() {
  const [assignments, setAssignments] = useState([]);
  const [error, setError] = useState("");
  const [active, setActive] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const data = await api("/api/assignments");
      setAssignments(data.assignments || []);
      setError("");
    } catch (e) {
      setError(e.message || "Could not load assignments. Is the backend running?");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit() {
    if (!active) return;
    setBusy(true);
    try {
      await api(`/api/assignments/${active.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setActive(null);
      setText("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">Assignments</h1>
      {error && <p className="text-sm text-danger">{error}</p>}
      <SectionCard>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="py-2">Title</th>
              <th className="py-2">Course</th>
              <th className="py-2">Due Date</th>
              <th className="py-2">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id} className="border-b last:border-b-0">
                <td className="py-3 font-medium text-navy">{a.title}</td>
                <td className="py-3">{a.course}</td>
                <td className="py-3">{a.dueDate}</td>
                <td className="py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      a.mySubmission
                        ? "bg-success/15 text-success"
                        : "bg-warning/15 text-warning"
                    }`}
                  >
                    {a.mySubmission?.status || "Pending"}
                  </span>
                </td>
                <td className="py-3 text-right">
                  <button
                    type="button"
                    className="rounded-md bg-gold px-3 py-1 text-xs font-semibold text-navy hover:bg-gold-soft"
                    onClick={() => {
                      setActive(a);
                      setText(a.mySubmission?.text || "");
                    }}
                  >
                    {a.mySubmission ? "View / Update" : "Submit"}
                  </button>
                </td>
              </tr>
            ))}
            {!assignments.length && (
              <tr>
                <td colSpan={5} className="py-6 text-muted-foreground">
                  No assignments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SectionCard>

      {active && (
        <SectionCard title={active.title}>
          <p className="mb-2 text-sm text-muted-foreground">{active.description}</p>
          <textarea
            className="w-full rounded border p-2 text-sm"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your submission here…"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save submission"}
            </button>
            <button type="button" className="rounded-md border px-4 py-2 text-sm" onClick={() => setActive(null)}>
              Close
            </button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
