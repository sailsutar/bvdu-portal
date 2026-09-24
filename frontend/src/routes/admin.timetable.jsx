import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function emptySlots() {
  return DAYS.map((day) => ({ day, slots: ["", "", "", "", "", ""] }));
}

export default function AdminTimetable() {
  const [slots, setSlots] = useState(emptySlots());
  const [empty, setEmpty] = useState(true);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const d = await api("/api/timetable");
      if (d.slots?.length) {
        setSlots(
          d.slots.map((r) => ({
            day: r.day,
            slots: [...(r.slots || [])].concat(Array(6).fill("")).slice(0, Math.max(6, (r.slots || []).length)),
          }))
        );
        setEmpty(false);
      } else {
        setSlots(emptySlots());
        setEmpty(true);
      }
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateCell(dayIdx, slotIdx, value) {
    setSlots((prev) =>
      prev.map((row, i) =>
        i === dayIdx
          ? { ...row, slots: row.slots.map((s, j) => (j === slotIdx ? value.slice(0, 40) : s)) }
          : row
      )
    );
  }

  function addSlotColumn() {
    setSlots((prev) => prev.map((row) => ({ ...row, slots: [...row.slots, ""] })));
  }

  async function save(e) {
    e.preventDefault();
    setMsg("");
    try {
      const payload = slots.map((r) => ({
        day: r.day,
        slots: r.slots.map((s) => String(s || "").trim()).filter((s, i, arr) => s || i < 6),
      }));
      // Keep structure even if trailing empty
      const cleaned = slots.map((r) => ({
        day: r.day,
        slots: r.slots.map((s) => String(s || "").trim() || "—"),
      }));
      await api("/api/timetable", {
        method: "PUT",
        body: JSON.stringify({ slots: cleaned }),
      });
      setEmpty(false);
      setMsg("Timetable saved to MongoDB.");
      await load();
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function clearAll() {
    if (!confirm("Clear timetable?")) return;
    try {
      await api("/api/timetable", { method: "PUT", body: JSON.stringify({ slots: [] }) });
      setSlots(emptySlots());
      setEmpty(true);
      setMsg("Timetable cleared.");
    } catch (err) {
      setMsg(err.message);
    }
  }

  const maxSlots = Math.max(6, ...slots.map((r) => r.slots.length));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Timetable</h1>
        <p className="text-sm text-muted-foreground">
          Department timetable shown to students. Stored in MongoDB.
        </p>
      </div>
      {msg && <p className="text-sm text-navy">{msg}</p>}

      <SectionCard title={empty ? "No timetable uploaded" : "Edit timetable"}>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <form onSubmit={save} className="space-y-4">
            {empty && (
              <p className="text-sm text-muted-foreground">
                No timetable uploaded. Fill the grid below and save, or leave empty for students to see
                “No timetable uploaded”.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-2">Day</th>
                    {Array.from({ length: maxSlots }, (_, i) => (
                      <th key={i} className="py-2 px-1">
                        Slot {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((row, di) => (
                    <tr key={row.day} className="border-b">
                      <td className="py-2 pr-2 font-semibold text-navy">{row.day}</td>
                      {Array.from({ length: maxSlots }, (_, si) => (
                        <td key={si} className="py-1 px-1">
                          <input
                            className="w-full min-w-[4.5rem] rounded border px-1 py-1 text-xs"
                            value={row.slots[si] || ""}
                            onChange={(e) => updateCell(di, si, e.target.value)}
                            placeholder="—"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded border px-3 py-2 text-sm" onClick={addSlotColumn}>
                Add slot column
              </button>
              <button type="submit" className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy">
                Save timetable
              </button>
              <button
                type="button"
                className="rounded border border-destructive/40 px-3 py-2 text-sm text-destructive"
                onClick={clearAll}
              >
                Clear
              </button>
            </div>
          </form>
        )}
      </SectionCard>
    </div>
  );
}
