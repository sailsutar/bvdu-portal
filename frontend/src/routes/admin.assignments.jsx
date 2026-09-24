import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

export default function Page() {
  const [assignments, setAssignments] = useState([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const data = await api("/api/assignments");
      setAssignments(data.assignments || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api("/api/assignments", {
        method: "POST",
        body: JSON.stringify({ title, dueDate, description, course: "Department common" }),
      });
      setTitle("");
      setDueDate("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">Assignments</h1>
      {error && <p className="text-sm text-danger">{error}</p>}
      <SectionCard title="Create assignment">
        <form onSubmit={create} className="grid gap-3 text-sm md:grid-cols-2">
          <input
            required
            className="rounded border px-3 py-2"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            required
            type="date"
            className="rounded border px-3 py-2"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <textarea
            className="rounded border px-3 py-2 md:col-span-2"
            rows={3}
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button type="submit" className="rounded-md bg-gold px-4 py-2 font-semibold text-navy md:col-span-2">
            Publish assignment
          </button>
        </form>
      </SectionCard>
      <SectionCard title="Published">
        <ul className="space-y-2 text-sm">
          {assignments.map((a) => (
            <li key={a.id} className="flex justify-between border-b py-2">
              <span>
                <b>{a.title}</b> · due {a.dueDate}
              </span>
              <span className="text-muted-foreground">{a.submissionCount || 0} submissions</span>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
