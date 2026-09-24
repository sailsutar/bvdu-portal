import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";

const CATEGORIES = [
  {
    id: "academic",
    title: "Academic cohort (marks & attendance)",
    detail: "All uploaded academic records used by HOD, Teacher Guide, and students. Use before a full re-upload.",
    countKey: "academicRecords",
  },
  {
    id: "roster",
    title: "Contacts & background",
    detail: "Contact details and 10th / 12th / CET / JEE / diploma factors (StudentBackground).",
    countKey: "studentBackgrounds",
  },
  {
    id: "placement",
    title: "Placement profiles",
    detail: "Placement coordinator / head profiles, skills, Trajectory-Aware Domain Engine scores from Excel or student forms.",
    countKey: "placementProfiles",
  },
  {
    id: "feedback",
    title: "Student feedback",
    detail: "All feedback text and sentiment labels submitted by students.",
    countKey: "feedback",
  },
  {
    id: "teacherSubjects",
    title: "Subject ↔ faculty assignments",
    detail: "Teacher Performance mappings (including auto-filled faculty in-charge names).",
    countKey: "teacherSubjects",
  },
  {
    id: "tgAssignments",
    title: "Teacher Guide ↔ student links",
    detail: "Which students are assigned to which Teacher Guide. Teacher Guide login accounts are not deleted.",
    countKey: "tgAssignments",
  },
  {
    id: "studentUsers",
    title: "Student login accounts",
    detail: "Removes role=student users only. Staff (system admin, HOD, Teacher Guide, placement) stay.",
    countKey: "studentUsers",
  },
  {
    id: "intelligence",
    title: "Intelligence / agent state",
    detail: "Stored agent drafts, queues, and related key-value intelligence state.",
    countKey: "intelligenceKeys",
  },
  {
    id: "messageLogs",
    title: "Message send logs",
    detail: "History of email / SMS / WhatsApp sends from the portal (not provider inboxes).",
    countKey: "messageLogs",
  },
];

export default function SysadminDanger() {
  const [counts, setCounts] = useState(null);
  const [selected, setSelected] = useState([]);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await api("/api/admin-master/danger/counts");
      setCounts(d);
    } catch (e) {
      setErr(e?.message || "Failed to load counts");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectAcademicReset() {
    setSelected(["academic", "teacherSubjects"]);
  }

  function selectFullAcademicAndStudents() {
    setSelected(["academic", "studentUsers", "teacherSubjects"]);
  }

  async function runPurge() {
    setErr(null);
    setMsg(null);
    if (!selected.length) {
      setErr("Select at least one category.");
      return;
    }
    if (confirm.trim() !== "DELETE") {
      setErr('Type DELETE (all capitals) in the confirm box.');
      return;
    }
    if (
      !window.confirm(
        `Permanently delete ${selected.length} data categor${selected.length === 1 ? "y" : "ies"} from MongoDB? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const d = await api("/api/admin-master/danger/purge", {
        method: "POST",
        body: JSON.stringify({ targets: selected, confirm: "DELETE" }),
      });
      setMsg(`Purge complete: ${JSON.stringify(d.deleted)}`);
      setConfirm("");
      setSelected([]);
      await load();
    } catch (e) {
      setErr(e?.message || "Purge failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          Danger zone
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Delete data from MongoDB when a bad upload or test run must be undone. Staff accounts (system
          admin, HOD, Teacher Guide, placement) are never removed here. Type <strong>DELETE</strong> to
          confirm. After a purge, clear this site’s browser storage and re-upload if needed.
        </p>
      </div>

      {err && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      )}
      {msg && (
        <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-navy">
          {msg}
        </div>
      )}

      <SectionCard
        title="Current database counts"
        action={
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        }
      >
        {!counts ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((c) => (
              <div key={c.id} className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                <div className="text-xs text-muted-foreground">{c.title}</div>
                <div className="text-lg font-bold text-navy">{counts[c.countKey] ?? "—"}</div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Quick presets">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-xs font-semibold"
            onClick={selectAcademicReset}
          >
            Bad Excel re-upload (academic + faculty map)
          </button>
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-xs font-semibold"
            onClick={selectFullAcademicAndStudents}
          >
            Academic + student logins
          </button>
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-xs font-semibold"
            onClick={() => setSelected(["roster"])}
          >
            Contacts / background only
          </button>
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-xs font-semibold"
            onClick={() => setSelected(["placement"])}
          >
            Placement profiles only
          </button>
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-xs font-semibold text-muted-foreground"
            onClick={() => setSelected([])}
          >
            Clear selection
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Select categories to delete">
        <ul className="space-y-3">
          {CATEGORIES.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-xl border p-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={selected.includes(c.id)}
                onChange={() => toggle(c.id)}
                id={`danger-${c.id}`}
              />
              <label htmlFor={`danger-${c.id}`} className="cursor-pointer">
                <div className="text-sm font-semibold text-navy">{c.title}</div>
                <div className="text-xs text-muted-foreground">{c.detail}</div>
                {counts && (
                  <div className="mt-1 text-xs font-medium">
                    Rows now: {counts[c.countKey] ?? 0}
                  </div>
                )}
              </label>
            </li>
          ))}
        </ul>

        <div className="mt-6 space-y-3 border-t pt-4">
          <label className="block text-sm font-semibold text-navy">
            Type DELETE to confirm
            <input
              className="mt-1 w-full max-w-xs rounded-lg border px-3 py-2 font-mono text-sm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            disabled={busy || !selected.length}
            onClick={runPurge}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-destructive px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {busy ? "Deleting…" : `Delete selected (${selected.length})`}
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
