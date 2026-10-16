import { useEffect, useState } from "react";
import { useYearBatchSelection } from "@/lib/use-year-batch";
import { normalizeYearLevel, YEAR_LABELS, YEAR_ORDER } from "@/lib/year-batch";
import { SectionCard } from "@/components/portal/PortalShell";
import { getSession, authHeaders } from "@/lib/auth";

function SentimentBadge({ value, note }) {
  const styles = {
    good: "bg-success/15 text-success",
    average: "bg-gold/20 text-navy",
    bad: "bg-destructive/15 text-destructive",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${styles[value] || styles.average}`}>
      {value}{note || ""}
    </span>
  );
}

function OverallBadge({ overall }) {
  if (overall === "none") return null;
  const map = {
    good: { label: "Mostly Positive", cls: "bg-success/15 text-success border-success/30" },
    average: { label: "Mixed / Neutral", cls: "bg-gold/20 text-navy border-gold/40" },
    bad: { label: "Needs Attention", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  };
  const m = map[overall] || map.average;
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${m.cls}`}>{m.label}</span>
  );
}

/** Top-of-page: all feedbacks summarized for the teacher in one place */
function TeacherFeedbackSummary({ summary, loading, onRefresh }) {
  if (loading) {
    return (
      <SectionCard title="Teacher feedback summary">
        <p className="text-sm text-muted-foreground">Loading summary…</p>
      </SectionCard>
    );
  }

  if (!summary || summary.total === 0) {
    return (
      <SectionCard title="Teacher feedback summary">
        <p className="text-sm text-muted-foreground">
          {summary?.overview ||
            "No student feedback yet. Eligible students (75%+ attendance) can submit from the student portal."}
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Teacher feedback summary — all feedbacks at a glance">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <OverallBadge overall={summary.overall} />
        <span className="text-sm font-semibold text-navy">{summary.headline}</span>
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto rounded-md border px-3 py-1 text-xs hover:bg-muted"
        >
          Refresh
        </button>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-navy/85">{summary.overview}</p>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-center">
          <div className="text-lg font-bold text-navy">{summary.total}</div>
          <div className="text-[11px] text-muted-foreground">Total</div>
        </div>
        <div className="rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-center">
          <div className="text-lg font-bold text-success">
            {summary.good}{" "}
            <span className="text-xs font-medium">({summary.goodPct}%)</span>
          </div>
          <div className="text-[11px] text-muted-foreground">Good</div>
        </div>
        <div className="rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-center">
          <div className="text-lg font-bold text-navy">
            {summary.average}{" "}
            <span className="text-xs font-medium">({summary.averagePct}%)</span>
          </div>
          <div className="text-[11px] text-muted-foreground">Average</div>
        </div>
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-center">
          <div className="text-lg font-bold text-destructive">
            {summary.bad}{" "}
            <span className="text-xs font-medium">({summary.badPct}%)</span>
          </div>
          <div className="text-[11px] text-muted-foreground">Bad</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-success/20 bg-success/5 p-3">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-success">
            What students appreciate
          </h3>
          {summary.strengths?.length ? (
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-navy/90">
              {summary.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No clearly positive items yet.</p>
          )}
        </div>
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-destructive">
            Concerns to address
          </h3>
          {summary.concerns?.length ? (
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-navy/90">
              {summary.concerns.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No major concerns flagged.</p>
          )}
        </div>
      </div>

      {summary.action && (
        <div className="mt-4 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-navy">
          <span className="font-semibold">Suggested action: </span>
          {summary.action}
        </div>
      )}
    </SectionCard>
  );
}

function classKey(f) {
  return f.displayGroup || f.className || "Class not specified";
}

function ReceivedFeedback({ items, stats, loading, onRefresh }) {
  const { year: yearFilter, setYear: setYearFilter } = useYearBatchSelection();
  const [selectedClass, setSelectedClass] = useState("All");
  const [agentSummary, setAgentSummary] = useState(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [clearMsg, setClearMsg] = useState("");

  const years = YEAR_ORDER.filter((code) =>
    items.some((f) => normalizeYearLevel(f.yearLevel || f.className || "") === code)
  );

  const afterYear =
    yearFilter === "All"
      ? items
      : items.filter((f) => normalizeYearLevel(f.yearLevel || f.className || "") === yearFilter);

  // Unique classes that have feedback (optionally within selected year)
  const classCounts = {};
  for (const f of afterYear) {
    const k = classKey(f);
    if (!classCounts[k]) classCounts[k] = { total: 0, good: 0, average: 0, bad: 0, yearLevel: f.yearLevel, batch: f.batch };
    classCounts[k].total += 1;
    if (f.sentiment === "good") classCounts[k].good += 1;
    else if (f.sentiment === "bad") classCounts[k].bad += 1;
    else classCounts[k].average += 1;
  }
  const classList = Object.entries(classCounts).sort((a, b) => a[0].localeCompare(b[0]));

  const visible =
    selectedClass === "All"
      ? afterYear
      : afterYear.filter((f) => classKey(f) === selectedClass);

  async function runAgentSummarize() {
    if (!confirm(`Run agent summary for feedback in ${yearFilter === "All" ? "all years" : yearFilter}?`)) return;
    setAgentLoading(true);
    setClearMsg("");
    try {
      const { api } = await import("@/lib/api");
      const d = await api("/api/feedback/agent-summarize", {
        method: "POST",
        body: JSON.stringify({ yearLevel: yearFilter === "All" ? null : yearFilter }),
      });
      setAgentSummary(d);
    } catch (e) {
      alert(e.message || "Agent summarize failed");
    } finally {
      setAgentLoading(false);
    }
  }

  async function clearFeedback() {
    const scope = yearFilter === "All" ? "ALL years (entire database)" : `year ${yearFilter} only`;
    if (
      !confirm(
        `Permanently delete feedback for ${scope}? This cannot be undone.`
      )
    ) {
      return;
    }
    setClearMsg("");
    try {
      const { api } = await import("@/lib/api");
      const q = yearFilter !== "All" ? `?yearLevel=${encodeURIComponent(yearFilter)}` : "";
      const d = await api(`/api/feedback${q}`, { method: "DELETE" });
      const msg =
        yearFilter === "All"
          ? `All feedbacks cleared. Deleted ${d.deleted} record(s).`
          : `Feedbacks cleared for ${yearFilter}. Deleted ${d.deleted} record(s).`;
      setClearMsg(msg);
      alert(msg);
      setAgentSummary(null);
      onRefresh?.();
    } catch (e) {
      alert(e.message || "Clear failed");
    }
  }

  return (
    <div className="space-y-6">
      {clearMsg && (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-navy">{clearMsg}</p>
      )}

      {agentSummary && (
        <SectionCard title={`Agent summary for HOD — ${agentSummary.yearLevel || yearFilter}`}>
          <p className="mb-2 text-xs text-muted-foreground">
            Generated {agentSummary.generatedAt ? new Date(agentSummary.generatedAt).toLocaleString() : "now"} ·{" "}
            {agentSummary.total} feedback item(s)
          </p>
          <div className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed text-navy/90">
            {agentSummary.hodNarrative ||
              `GOOD (${agentSummary.good?.count}): ${agentSummary.good?.overview}\nAVERAGE (${agentSummary.average?.count}): ${agentSummary.average?.overview}\nBAD (${agentSummary.bad?.count}): ${agentSummary.bad?.overview}`}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {["good", "average", "bad"].map((k) => (
              <div key={k} className="rounded border p-3 text-xs">
                <p className="font-semibold uppercase text-navy">{k}</p>
                <p className="mt-1 text-muted-foreground">{agentSummary[k]?.overview}</p>
                <p className="mt-2">Themes: {(agentSummary[k]?.themes || []).slice(0, 5).join(", ") || "—"}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Select class — see which class sent feedback">
        <p className="mb-3 text-sm text-muted-foreground">
          Choose a year, then click a class card. Feedback from First Year, Second Year, Third Year,
          and Final Year stays separate. Same programme with different batches appears as separate
          classes.
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Year level:</span>
          {["All", ...years].map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => {
                setYearFilter(y);
                setSelectedClass("All");
              }}
              className={`rounded-md border px-3 py-1.5 font-medium ${
                yearFilter === y
                  ? "border-gold bg-gold-soft text-navy"
                  : "bg-background text-navy hover:bg-muted"
              }`}
            >
              {y === "All" ? "All years" : YEAR_LABELS[y] || y}
            </button>
          ))}
          <button
            type="button"
            onClick={onRefresh}
            className="ml-auto rounded-md border px-3 py-1 hover:bg-muted"
          >
            Refresh
          </button>
                    <button
            type="button"
            className="rounded-md border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
            disabled={agentLoading}
            onClick={runAgentSummarize}
          >
            {agentLoading ? "Agent working…" : "Agent summarize"}
          </button>
          <button
            type="button"
            className="rounded-md border border-destructive/40 px-3 py-1 text-xs text-destructive"
            onClick={clearFeedback}
          >
            Clear feedback
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading classes…</p>
        ) : classList.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No feedback yet for this year filter. When students submit, their class appears here.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => setSelectedClass("All")}
              className={`rounded-lg border p-3 text-left transition ${
                selectedClass === "All"
                  ? "border-gold bg-gold-soft/40 ring-2 ring-gold/40"
                  : "hover:bg-muted/50"
              }`}
            >
              <div className="text-sm font-bold text-navy">All classes in view</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {afterYear.length} feedback{afterYear.length === 1 ? "" : "s"}
              </div>
            </button>
            {classList.map(([name, c]) => (
              <button
                key={name}
                type="button"
                onClick={() => setSelectedClass(name)}
                className={`rounded-lg border p-3 text-left transition ${
                  selectedClass === name
                    ? "border-gold bg-gold-soft/40 ring-2 ring-gold/40"
                    : "hover:bg-muted/50"
                }`}
              >
                <div className="text-sm font-bold text-navy">{name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {c.yearLevel || "Year not set"}
                  {c.batch ? ` · Batch ${c.batch}` : ""}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded bg-muted px-1.5 py-0.5">{c.total} total</span>
                  <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">{c.good} good</span>
                  <span className="rounded bg-gold/20 px-1.5 py-0.5">{c.average} average</span>
                  <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                    {c.bad} bad
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={
          selectedClass === "All"
            ? "Feedback from selected view"
            : `Feedback from: ${selectedClass}`
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded-md bg-muted px-2 py-1">
            Showing: <b>{visible.length}</b> / {stats.total} overall
          </span>
          <span className="rounded-md bg-success/15 px-2 py-1 text-success">
            Good: <b>{visible.filter((f) => f.sentiment === "good").length}</b>
          </span>
          <span className="rounded-md bg-gold/20 px-2 py-1 text-navy">
            Average: <b>{visible.filter((f) => f.sentiment === "average").length}</b>
          </span>
          <span className="rounded-md bg-destructive/15 px-2 py-1 text-destructive">
            Bad: <b>{visible.filter((f) => f.sentiment === "bad").length}</b>
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No feedback for this class selection yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {visible.map((f) => (
              <li key={f.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <b className="text-navy">{f.studentName}</b>{" "}
                    <span className="text-xs text-muted-foreground">
                      · Permanent Registration Number {f.studentId} · {f.course} ·{" "}
                      {f.createdAt ? new Date(f.createdAt).toLocaleString() : ""}
                    </span>
                    <div className="mt-0.5 text-xs font-semibold text-navy">
                      Class: {classKey(f)}
                      {f.batch ? ` (Batch ${f.batch})` : ""}
                    </div>
                  </div>
                  <SentimentBadge value={f.sentiment} note={f.source ? ` · ${f.source}` : ""} />
                </div>
                <p className="mt-2 text-xs font-semibold text-muted-foreground">Summary</p>
                <p className="text-sm text-navy/90">{f.summary}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Show full feedback
                  </summary>
                  <p className="mt-1 text-sm text-navy/80">{f.text}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function FeedbackAnalytics() {
  const session = getSession();
  const teacherId = session?.id || "EMP001";
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ total: 0, good: 0, average: 0, bad: 0 });
  const [teacherSummary, setTeacherSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/feedback?teacherId=${encodeURIComponent(teacherId)}`, {
        headers: { ...authHeaders() },
      });
      const d = await r.json();
      setItems(d.items || []);
      setStats(d.stats || { total: 0, good: 0, average: 0, bad: 0 });
      setTeacherSummary(d.teacherSummary || null);
    } catch {
      setItems([]);
      setTeacherSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [teacherId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live student feedback only. NLP classifies each response as Good / Average / Bad.
          Students submit from the student portal (attendance eligibility applies).
        </p>
      </div>

      <TeacherFeedbackSummary
        summary={teacherSummary}
        loading={loading}
        onRefresh={load}
      />

      <ReceivedFeedback items={items} stats={stats} loading={loading} onRefresh={load} />
    </div>
  );
}

export default FeedbackAnalytics;
