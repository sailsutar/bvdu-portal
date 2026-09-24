import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { PlacementYearBatchBar } from "@/components/placement/PlacementExcelGrid";
import { api } from "@/lib/api";

export default function PcReminders() {
  const [year, setYear] = useState("All");
  const [batch, setBatch] = useState("All");
  const [years, setYears] = useState([]);
  const [batches, setBatches] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/placement/profiles")
      .then((r) => {
        setYears(r.years || []);
        setBatches(r.batches || []);
      })
      .catch(() => {});
  }, []);

  async function generate() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api("/api/placement/reminders/draft", {
        method: "POST",
        body: JSON.stringify({ year, batch }),
      });
      setDrafts(r.drafts || []);
      setMsg(`Generated ${r.count} reminder draft(s). Copy and send via your channel.`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  function copyAll() {
    const text = drafts.map((d) => d.text).join("\n\n---\n\n");
    navigator.clipboard?.writeText(text);
    setMsg("All drafts copied to clipboard.");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">Reminder drafts</h1>
      <p className="text-sm text-muted-foreground">
        Auto-written messages for students with missing placement data (by year/batch). You review and send.
      </p>
      <PlacementYearBatchBar year={year} setYear={setYear} batch={batch} setBatch={setBatch} years={years} batches={batches} />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={generate}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Generating…" : "Generate drafts"}
        </button>
        {drafts.length > 0 && (
          <button type="button" onClick={copyAll} className="rounded-lg border px-4 py-2 text-sm font-semibold text-navy">
            Copy all
          </button>
        )}
      </div>
      {msg && <p className="text-sm text-navy/90">{msg}</p>}
      <div className="space-y-3">
        {drafts.map((d) => (
          <SectionCard key={d.prn} title={`${d.name || "Student"} · ${d.prn} · ${d.yearLevel || ""}`}>
            <p className="mb-2 text-xs text-danger">Missing: {(d.missing || []).join(", ") || "—"}</p>
            <pre className="whitespace-pre-wrap rounded bg-muted/50 p-3 text-xs">{d.text}</pre>
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-navy underline"
              onClick={() => {
                navigator.clipboard?.writeText(d.text);
              }}
            >
              Copy
            </button>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
