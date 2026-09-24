import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

const YEARS = ["All", "FY", "SY", "TY", "LY"];

export default function SysadminTgAssign() {
  const [year, setYear] = useState("All");
  const [students, setStudents] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [msg, setMsg] = useState("");
  const [reassignPrn, setReassignPrn] = useState("");
  const [reassignTg, setReassignTg] = useState(1);

  async function load() {
    const q = year && year !== "All" ? `?year=${encodeURIComponent(year)}` : "";
    const [st, pr, asg, cohort] = await Promise.all([
      api(`/api/admin-master/students${q}`).catch(() => ({ students: [] })),
      api("/api/tg-profiles"),
      api("/api/tg-assignments"),
      api("/api/cohort").catch(() => ({ students: [] })),
    ]);
    // Merge master roster + academic cohort by PRN so HOD-uploaded students can be assigned
    const byPrn = new Map();
    for (const s of st.students || []) {
      byPrn.set(String(s.prn), {
        prn: s.prn,
        name: s.name,
        yearLevel: s.yearLevel || null,
        cls: s.cls || null,
      });
    }
    for (const s of cohort.students || []) {
      const prn = String(s.prn || "");
      if (!prn) continue;
      const y = (s.yearLevel || "").toUpperCase() || null;
      if (year && year !== "All" && y && y !== year) continue;
      if (year && year !== "All" && !y) {
        const cls = String(s.cls || s.className || "").toUpperCase();
        const ok =
          (year === "FY" && /\b(FY|FE|FIRST)\b/.test(cls)) ||
          (year === "SY" && /\b(SY|SE|SECOND)\b/.test(cls)) ||
          (year === "TY" && /\b(TY|TE|THIRD)\b/.test(cls)) ||
          (year === "LY" && /\b(LY|BE|FINAL|LAST)\b/.test(cls));
        if (!ok && year !== "All") continue;
      }
      const prev = byPrn.get(prn) || {};
      byPrn.set(prn, {
        prn,
        name: prev.name || s.name,
        yearLevel: prev.yearLevel || y || null,
        cls: s.cls || s.className || prev.cls || null,
      });
    }
    setStudents(Array.from(byPrn.values()).sort((a, b) => String(a.prn).localeCompare(String(b.prn))));
    setProfiles(pr.profiles || []);
    const map = {};
    for (const a of asg.assignments || []) map[a.prn] = a.tgIndex;
    setAssignments(map);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [year]);

  const profileByIndex = useMemo(() => {
    const m = {};
    for (const p of profiles) m[p.index] = p;
    return m;
  }, [profiles]);

  async function assignOne(prn, tgIndex) {
    setMsg("");
    try {
      const tgUserId = profileByIndex[tgIndex]?.id || `TG${String(tgIndex).padStart(3, "0")}`;
      await api("/api/tg-assignments", {
        method: "PUT",
        body: JSON.stringify({
          assignments: [{ prn, tgIndex, tgUserId }],
        }),
      });
      setAssignments((a) => ({ ...a, [prn]: tgIndex }));
      setMsg(`Assigned ${prn} → ${tgUserId} (lifetime until reassigned).`);
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function reassign() {
    if (!reassignPrn) return;
    if (!confirm(`Reassign ${reassignPrn} to Teacher Guide index ${reassignTg}? Use only when a mentor leaves.`)) return;
    setMsg("");
    try {
      const tgUserId = profileByIndex[reassignTg]?.id || `TG${String(reassignTg).padStart(3, "0")}`;
      await api("/api/tg-assignments/reassign", {
        method: "POST",
        body: JSON.stringify({ prn: reassignPrn, tgIndex: Number(reassignTg), tgUserId }),
      });
      setAssignments((a) => ({ ...a, [reassignPrn]: Number(reassignTg) }));
      setMsg(`Reassigned ${reassignPrn}.`);
      setReassignPrn("");
    } catch (e) {
      setMsg(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">Teacher Guide assignment</h1>
      <p className="text-sm text-muted-foreground">
        One Teacher Guide per student from first assignment through Last Year. Year filter only changes
        which students you see while assigning.
      </p>
      <div className="flex flex-wrap gap-2">
        {YEARS.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYear(y)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              year === y ? "bg-navy text-white" : "bg-muted text-navy"
            }`}
          >
            {y}
          </button>
        ))}
      </div>
      {msg && <p className="text-sm text-navy/90">{msg}</p>}
      <SectionCard title="Assign">
        <div className="max-h-[24rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2">PRN</th>
                <th>Name</th>
                <th>Year</th>
                <th>Teacher Guide</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.prn} className="border-b">
                  <td className="py-2 tabular-nums">{s.prn}</td>
                  <td>{s.name}</td>
                  <td>{s.yearLevel || "—"}</td>
                  <td>
                    <select
                      className="rounded border px-2 py-1 text-sm"
                      value={assignments[s.prn] || ""}
                      onChange={(e) => assignOne(s.prn, Number(e.target.value))}
                    >
                      <option value="">—</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.index}>
                          {p.name} ({p.id})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
      <SectionCard title="Reassign Teacher Guide (exception)">
        <p className="mb-3 text-xs text-muted-foreground">
          Use only if a mentor leaves or a mapping was wrong. Not the normal yearly path.
        </p>
        <div className="flex flex-wrap gap-3">
          <input
            className="rounded border px-2 py-1.5 text-sm"
            placeholder="Permanent Registration Number"
            value={reassignPrn}
            onChange={(e) => setReassignPrn(e.target.value)}
          />
          <select
            className="rounded border px-2 py-1.5 text-sm"
            value={reassignTg}
            onChange={(e) => setReassignTg(Number(e.target.value))}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.index}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
          <button type="button" onClick={reassign} className="rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold text-white">
            Reassign
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
