import { useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

const YEARS = ["FY", "SY", "TY", "LY"];

export default function PhFreeze() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(year, action) {
    setBusy(true);
    setMsg("");
    try {
      const r = await api("/api/placement/freeze-year", {
        method: "POST",
        body: JSON.stringify({ year, action }),
      });
      setMsg(`${action} ${year}: ${r.affected} profile(s) updated.`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">Drive freeze</h1>
      <p className="text-sm text-muted-foreground">
        Lock verified/submitted profiles for a year so students cannot change data mid-drive. Unfreeze restores
        verified.
      </p>
      {msg && <p className="text-sm text-navy/90">{msg}</p>}
      <SectionCard title="By year">
        <div className="grid gap-3 sm:grid-cols-2">
          {YEARS.map((y) => (
            <div key={y} className="flex items-center justify-between rounded border p-3">
              <span className="font-semibold text-navy">{y}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(y, "freeze")}
                  className="rounded bg-navy px-3 py-1 text-xs font-semibold text-white"
                >
                  Freeze
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(y, "unfreeze")}
                  className="rounded border px-3 py-1 text-xs font-semibold text-navy"
                >
                  Unfreeze
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
