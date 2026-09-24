import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";
import { useDerived } from "@/lib/upload-stats";
import { sortByBatchThenNumber } from "@/lib/tg-assign";

export default function AdminTgAssign() {
  const { students } = useDerived();
  const [assignments, setAssignments] = useState([]);
  const [tgs, setTgs] = useState([]);
  const [config, setConfig] = useState(null);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState({}); // prn -> tgIndex
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [a, cfg] = await Promise.all([
        api("/api/tg-assignments"),
        api("/api/portal-config"),
      ]);
      setAssignments(a.assignments || []);
      setConfig(cfg.config || {});
      const map = {};
      for (const row of a.assignments || []) {
        map[row.prn] = Number(row.tgIndex);
      }
      setDraft(map);

      // Discover TG users from assignment tgUserIds + standard IDs
      const tgSet = new Map();
      for (const row of a.assignments || []) {
        if (row.tgUserId) tgSet.set(row.tgUserId, row.tgIndex);
      }
      // Default TG001–TGn from config / common seed
      const n = Math.max(3, ...Array.from(tgSet.values()), Number(cfg.config?.tgBatchSize) ? 3 : 3);
      for (let i = 1; i <= Math.max(n, 3); i++) {
        const id = `TG${String(i).padStart(3, "0")}`;
        if (!tgSet.has(id)) tgSet.set(id, i);
      }
      setTgs(
        Array.from(tgSet.entries())
          .map(([id, idx]) => ({ id, index: Number(idx) }))
          .sort((a, b) => a.index - b.index)
      );
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sorted = useMemo(() => sortByBatchThenNumber(students || []), [students]);

  function setTg(prn, tgIndex) {
    setDraft((d) => ({ ...d, [prn]: Number(tgIndex) }));
  }

  async function saveExplicit() {
    setMsg("");
    try {
      const list = Object.entries(draft)
        .filter(([, idx]) => Number(idx) >= 1)
        .map(([prn, tgIndex]) => ({ prn, tgIndex: Number(tgIndex) }));
      const r = await api("/api/tg-assignments", {
        method: "PUT",
        body: JSON.stringify({ assignments: list }),
      });
      setMsg(`Saved ${r.upserted} explicit assignments.`);
      await load();
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function autoDistribute() {
    if (!confirm("Auto-distribute all academic-record students across Teacher Guides?")) return;
    setMsg("");
    try {
      const r = await api("/api/tg-assignments/auto", { method: "POST", body: "{}" });
      setMsg(`Auto-assigned ${r.upserted} students across ${r.tgCount} Teacher Guides.`);
      await load();
    } catch (e) {
      setMsg(e.message);
    }
  }

  const counts = useMemo(() => {
    const c = {};
    for (const v of Object.values(draft)) {
      const k = Number(v);
      if (k >= 1) c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [draft]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Teacher Guide assignment</h1>
        <p className="text-sm text-muted-foreground">
          Explicit student → TG mapping (preferred). Optional auto-distribute uses portal config batch
          size ({config?.tgBatchSize ?? "—"}) and active TG accounts — no hardcoded limits.
        </p>
      </div>
      {msg && <p className="text-sm text-navy">{msg}</p>}

      <SectionCard title="Summary">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-wrap gap-3 text-sm">
            {tgs.map((t) => (
              <span key={t.id} className="rounded border px-2 py-1">
                {t.id} (#{t.index}): <b>{counts[t.index] || 0}</b> students
              </span>
            ))}
            <span className="text-muted-foreground">
              Unassigned in draft:{" "}
              {sorted.filter((s) => !draft[s.prn]).length}
            </span>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy"
            onClick={saveExplicit}
          >
            Save explicit assignments
          </button>
          <button type="button" className="rounded border px-4 py-2 text-sm" onClick={autoDistribute}>
            Auto-distribute
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Students">
        {!sorted.length ? (
          <p className="text-sm text-muted-foreground">No data uploaded yet. Upload academic Excel first.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">PRN</th>
                  <th className="py-2">Name</th>
                  <th className="py-2">Class</th>
                  <th className="py-2">Teacher Guide</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.prn} className="border-b last:border-b-0">
                    <td className="py-2 font-mono text-xs">{s.prn}</td>
                    <td className="py-2">{s.name}</td>
                    <td className="py-2">{s.cls || s.className || "—"}</td>
                    <td className="py-2">
                      <select
                        className="rounded border px-2 py-1 text-xs"
                        value={draft[s.prn] || ""}
                        onChange={(e) => setTg(s.prn, e.target.value)}
                      >
                        <option value="">—</option>
                        {tgs.map((t) => (
                          <option key={t.id} value={t.index}>
                            {t.id} (#{t.index})
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
