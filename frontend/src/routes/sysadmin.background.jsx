import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";
import {
  listenOnceBackgroundVoice,
  parseBackgroundVoiceTranscript,
  speechRecognitionSupported,
} from "@/lib/voice-background-fill";

const PATHS = [
  { id: "", label: "—" },
  { id: "FY_REGULAR", label: "FY regular" },
  { id: "DSY_DIPLOMA", label: "DSY diploma" },
  { id: "DSY_SCIENCE_DIP", label: "DSY science + diploma" },
  { id: "DSY_COMMERCE_DIP", label: "DSY commerce + diploma" },
  { id: "OTHER", label: "Other" },
];

const YEARS = ["All", "FY", "SY", "TY", "LY"];
const YEAR_OPTS = ["", "FY", "SY", "TY", "LY"];
const STREAM_OPTS = ["", "science", "commerce", "arts"];

const COLS = [
  { key: "prn", label: "PRN", readOnly: true, width: "9rem" },
  { key: "name", label: "Name", readOnly: true, width: "11rem" },
  { key: "entryPath", label: "Entry path", type: "select", options: PATHS, width: "10rem" },
  { key: "yearLevel", label: "Year", type: "select", options: YEAR_OPTS.map((y) => ({ id: y, label: y || "—" })), width: "5rem" },
  { key: "tenthPercent", label: "10th %", type: "number", width: "5rem" },
  { key: "twelfthPercent", label: "12th %", type: "number", width: "5rem" },
  { key: "twelfthStream", label: "Stream", type: "select", options: STREAM_OPTS.map((s) => ({ id: s, label: s || "—" })), width: "7rem" },
  { key: "diplomaPercent", label: "Diploma %", type: "number", width: "6rem" },
  { key: "diplomaType", label: "Diploma type", type: "text", width: "8rem" },
  { key: "cetScore", label: "CET", type: "number", width: "5rem" },
  { key: "jeeScore", label: "JEE", type: "number", width: "5rem" },
];

function rowFromApi(s) {
  return {
    prn: s.prn,
    name: s.name || "",
    entryPath: s.entryPath || "",
    yearLevel: s.yearLevel || "",
    tenthPercent: s.tenthPercent ?? "",
    twelfthPercent: s.twelfthPercent ?? "",
    twelfthStream: s.twelfthStream || "",
    diplomaPercent: s.diplomaPercent ?? "",
    diplomaType: s.diplomaType || "",
    cetScore: s.cetScore ?? "",
    jeeScore: s.jeeScore ?? "",
  };
}

function emptyToNull(v) {
  if (v === "" || v === undefined || v === null) return null;
  return v;
}

function toPayload(row) {
  const num = (v) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    prn: row.prn,
    name: row.name,
    entryPath: emptyToNull(row.entryPath) || null,
    yearLevel: emptyToNull(row.yearLevel) || null,
    tenthPercent: num(row.tenthPercent),
    twelfthPercent: num(row.twelfthPercent),
    twelfthStream: emptyToNull(row.twelfthStream) || null,
    diplomaPercent: num(row.diplomaPercent),
    diplomaType: emptyToNull(row.diplomaType) || null,
    cetScore: num(row.cetScore),
    jeeScore: num(row.jeeScore),
  };
}

export default function SysadminBackground() {
  const [year, setYear] = useState("All");
  const [grid, setGrid] = useState([]);
  const [selectedPrn, setSelectedPrn] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const voiceOk = useMemo(() => speechRecognitionSupported(), []);

  const load = useCallback(async () => {
    const q = year && year !== "All" ? `?year=${encodeURIComponent(year)}` : "";
    const r = await api(`/api/admin-master/students${q}`);
    setGrid((r.students || []).map(rowFromApi));
    setDirty(false);
  }, [year]);

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [load]);

  function setCell(prn, key, value) {
    setGrid((rows) => rows.map((r) => (r.prn === prn ? { ...r, [key]: value } : r)));
    setDirty(true);
  }

  async function saveAll() {
    setMsg("");
    setBusy(true);
    try {
      const students = grid.map(toPayload);
      const r = await api("/api/admin-master/students", {
        method: "PUT",
        body: JSON.stringify({ students }),
      });
      setMsg(`Saved ${r.updated} row(s). Empty cells stay empty (not stored as zero).`);
      setDirty(false);
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function voiceFillSelected() {
    if (!selectedPrn) {
      setMsg("Click a row first, then use Fill by voice.");
      return;
    }
    setMsg("");
    setHeard("");
    setListening(true);
    try {
      const transcript = await listenOnceBackgroundVoice({
        onInterim: (t) => setHeard(t),
      });
      setHeard(transcript);
      const { patch, labels } = parseBackgroundVoiceTranscript(transcript);
      if (!labels.length) {
        setMsg(`Heard “${transcript || "…"}” but no factors matched. Try: “tenth 75, twelfth 60, diploma 78, CET 90”.`);
        return;
      }
      setGrid((rows) =>
        rows.map((r) => {
          if (r.prn !== selectedPrn) return r;
          const next = { ...r };
          for (const [k, v] of Object.entries(patch)) {
            next[k] = v;
          }
          return next;
        })
      );
      setDirty(true);
      setMsg(`Applied to ${selectedPrn}: ${labels.join("; ")}. Review the row, then Commit changes.`);
    } catch (e) {
      setMsg(e.message || "Voice input failed");
    } finally {
      setListening(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">Background factors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Spreadsheet-style grid: edit many students, paste values cell by cell, then <strong>Commit changes</strong>. Optional <strong>Fill by voice</strong> on the selected row
            (Chrome / Edge). Partial fills are allowed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!selectedPrn || listening}
            onClick={voiceFillSelected}
            className="rounded-lg border border-navy/30 bg-white px-3 py-2 text-sm font-semibold text-navy disabled:opacity-40"
          >
            {listening ? "Listening…" : "Fill by voice"}
          </button>
          <button
            type="button"
            disabled={busy || !grid.length}
            onClick={saveAll}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : dirty ? "Commit changes *" : "Commit changes"}
          </button>
        </div>
      </div>

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
      {heard && (
        <p className="text-xs text-muted-foreground">
          Heard: <span className="font-medium text-navy">{heard}</span>
        </p>
      )}
      {!voiceOk && (
        <p className="text-xs text-amber-700">
          Voice fill needs Chrome or Edge with microphone permission. Grid editing still works.
        </p>
      )}
      {selectedPrn && (
        <p className="text-xs text-muted-foreground">
          Selected row: <span className="font-mono font-semibold text-navy">{selectedPrn}</span> — speak
          e.g. “tenth 75 twelfth 60 diploma 78 CET 92”
        </p>
      )}

      <SectionCard title={`Grid (${grid.length} students)`}>
        {!grid.length ? (
          <p className="text-sm text-muted-foreground">
            No students yet. Upload academic data or Contact details (with Permanent Registration Number) first.
          </p>
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded border">
            <table className="w-max min-w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-muted/95">
                <tr>
                  {COLS.map((c) => (
                    <th
                      key={c.key}
                      className="border-b px-2 py-2 font-semibold text-muted-foreground"
                      style={{ minWidth: c.width }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row) => {
                  const selected = row.prn === selectedPrn;
                  return (
                    <tr
                      key={row.prn}
                      onClick={() => setSelectedPrn(row.prn)}
                      className={`border-b ${selected ? "bg-gold/20" : "hover:bg-muted/40"}`}
                    >
                      {COLS.map((c) => (
                        <td key={c.key} className="px-1 py-1 align-middle">
                          {c.readOnly ? (
                            <span className={`block px-1 ${c.key === "prn" ? "font-mono tabular-nums" : ""}`}>
                              {row[c.key]}
                            </span>
                          ) : c.type === "select" ? (
                            <select
                              className="w-full rounded border bg-white px-1 py-1"
                              value={row[c.key] ?? ""}
                              onChange={(e) => setCell(row.prn, c.key, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {(c.options || []).map((o) => (
                                <option key={o.id ?? o} value={o.id ?? o}>
                                  {o.label ?? o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={c.type === "number" ? "number" : "text"}
                              className="w-full rounded border bg-white px-1 py-1"
                              value={row[c.key] ?? ""}
                              onChange={(e) => setCell(row.prn, c.key, e.target.value)}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPrn(row.prn);
                              }}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
