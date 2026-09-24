import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { portalTimetable, useDerived } from "@/lib/upload-stats";
import { authHeaders, getToken } from "@/lib/auth";

const API_BASE = import.meta.env.VITE_API_URL || "";

function TimetablePage() {
  const derived = useDerived();
  const fromUpload = portalTimetable(derived);
  const [apiSlots, setApiSlots] = useState(null);
  const [emptyMsg, setEmptyMsg] = useState(null);

  useEffect(() => {
    if (!getToken()) return;
    fetch(`${API_BASE}/api/timetable`, { headers: { ...authHeaders() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        if (d.slots?.length) setApiSlots(d.slots);
        else setEmptyMsg(d.message || "No timetable uploaded");
      })
      .catch(() => {});
  }, []);

  const timetable = apiSlots?.length ? apiSlots : fromUpload;
  const maxSlots = timetable.length
    ? Math.max(6, ...timetable.map((row) => (row.slots || []).length))
    : 6;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">Time Table</h1>
      <SectionCard>
        {!timetable.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {emptyMsg || "No timetable uploaded"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Day</th>
                  {Array.from({ length: maxSlots }, (_, i) => `Slot ${i + 1}`).map((s) => (
                    <th key={s} className="py-2">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timetable.map((row) => (
                  <tr key={row.day} className="border-b last:border-b-0">
                    <td className="py-3 font-semibold text-navy">{row.day}</td>
                    {Array.from({ length: maxSlots }, (_, i) => (row.slots || [])[i] || "\u2014").map(
                      (slot, i) => (
                        <td
                          key={i}
                          className={`py-3 ${slot === "Lunch" ? "font-semibold text-gold" : ""}`}
                        >
                          {slot}
                        </td>
                      )
                    )}
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

export default TimetablePage;
