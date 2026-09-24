import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { authHeaders, useSession } from "@/lib/auth";
import { studentPortalData, useDerived } from "@/lib/upload-stats";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function FeedbackPage() {
  const { session } = useSession();
  const { students } = useDerived();
  const studentId = session?.id || "";
  const portal = studentPortalData(students, studentId);

  const courseOptions = useMemo(() => {
    const fromMarks = (portal.marks || []).map((m) => m.subject).filter(Boolean);
    const fromAtt = (portal.subjects || []).map((s) => s.name).filter(Boolean);
    const set = [...new Set([...fromMarks, ...fromAtt])];
    return set.length ? set : ["General"];
  }, [portal.marks, portal.subjects]);

  const [attendance, setAttendance] = useState(portal.attendance);
  const [course, setCourse] = useState(courseOptions[0] || "General");
  const [text, setText] = useState("");
  const [mine, setMine] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (courseOptions.length && !courseOptions.includes(course)) {
      setCourse(courseOptions[0]);
    }
  }, [courseOptions, course]);

  async function load() {
    if (!studentId) return;
    try {
      const [attRes, fbRes] = await Promise.all([
        fetch(`${API_BASE}/api/students/${studentId}`, { headers: { ...authHeaders() } }),
        fetch(`${API_BASE}/api/feedback`, { headers: { ...authHeaders() } }),
      ]);
      const att = await attRes.json().catch(() => ({}));
      const fb = await fbRes.json().catch(() => ({}));
      const attVal =
        typeof att.attendance === "number"
          ? att.attendance
          : portal.attendance != null
            ? portal.attendance
            : null;
      setAttendance(attVal);
      const items = Array.isArray(fb.items) ? fb.items : Array.isArray(fb.feedback) ? fb.feedback : [];
      setMine(items.filter((f) => String(f.studentId) === String(studentId) || String(f.prn) === String(studentId)));
    } catch {
      setMsg("Could not reach the server. Start the backend and try again.");
    }
  }

  useEffect(() => {
    load();
  }, [studentId]);

  const gate = 75;
  const eligible = attendance !== null && attendance >= gate;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          studentId,
          course,
          text,
          className: portal.className || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(data.error || "Submit failed");
      else {
        setText("");
        setMsg("Feedback submitted.");
        await load();
      }
    } catch {
      setMsg("Network error while submitting feedback.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Feedback</h1>
        <p className="text-sm text-muted-foreground">
          Submit feedback when attendance allows. Previous submissions are listed from the server.
        </p>
      </div>

      <SectionCard title="Eligibility">
        {attendance == null ? (
          <p className="text-sm text-muted-foreground">
            Attendance not available for your PRN yet — cannot verify the {gate}% gate.
          </p>
        ) : eligible ? (
          <p className="text-sm">
            Your attendance is <b>{attendance}%</b>. You can submit feedback.
          </p>
        ) : (
          <p className="text-sm text-danger">
            Your attendance is {attendance}%. You need at least {gate}% to submit feedback.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Submit feedback">
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="text-xs font-semibold text-muted-foreground">Course / subject</span>
            <select
              className="mt-1 w-full rounded border px-3 py-2"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              disabled={!eligible}
            >
              {courseOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs font-semibold text-muted-foreground">Your feedback</span>
            <textarea
              className="mt-1 w-full rounded border px-3 py-2"
              rows={4}
              placeholder="Write at least 10 characters…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!eligible}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !eligible || text.trim().length < 10}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit"}
          </button>
          {msg && <p className="text-sm text-navy/90">{msg}</p>}
        </form>
      </SectionCard>

      <SectionCard title="Your previous feedback">
        {!mine.length ? (
          <p className="text-sm text-muted-foreground">No feedback submitted yet.</p>
        ) : (
          <ul className="divide-y">
            {mine.map((f, i) => (
              <li key={f._id || f.id || i} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-navy">{f.course || "General"}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.createdAt ? new Date(f.createdAt).toLocaleString() : f.date || ""}
                    {f.sentiment ? ` · ${f.sentiment}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-navy/90">{f.text || f.message || ""}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
