import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { SectionCard } from "@/components/portal/PortalShell";
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  ArrowRight,
  Target,
  TrendingUp,
  ListChecks,
  Sparkles,
} from "lucide-react";

const BAND_STYLES = {
  STRONG: "border-emerald-300 bg-emerald-50 text-emerald-900",
  BUILDING: "border-sky-300 bg-sky-50 text-sky-900",
  STARTING: "border-amber-300 bg-amber-50 text-amber-900",
  READY: "border-emerald-300 bg-emerald-50 text-emerald-900",
  NEAR_READY: "border-sky-300 bg-sky-50 text-sky-900",
  NOT_READY: "border-rose-200 bg-rose-50 text-rose-900",
  PROVISIONAL: "border-amber-300 bg-amber-50 text-amber-900",
  INSUFFICIENT_EVIDENCE: "border-slate-300 bg-slate-50 text-slate-700",
  UNKNOWN: "bg-slate-50 text-slate-600 border-slate-200",
};

const BAND_HELP = {
  STRONG: "You look strong for this role on your current profile — keep proving it with projects and practice.",
  BUILDING: "You are building up. Close the gaps below to move toward a stronger preparation level.",
  STARTING: "You have started. Follow the path: fill missing skills, then practice the top priorities.",
  READY: "Preparation looks ready for this role on the data you entered.",
  NEAR_READY: "Almost there — a few skills still need attention.",
  NOT_READY: "Several role skills are still below target. Use the checklist below.",
  PROVISIONAL: "Based on your self-ratings for now. Keep updating your Placement profile.",
  INSUFFICIENT_EVIDENCE: "Not enough skill data yet. Open Placement profile, rate Core skills, then return here.",
  UNKNOWN: "Status not available yet.",
};

function BandBadge({ band }) {
  const b = band || "UNKNOWN";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${BAND_STYLES[b] || BAND_STYLES.UNKNOWN}`}>
      {String(b).replace(/_/g, " ")}
    </span>
  );
}

function ScoreBar({ value, max = 100, tone = "sky" }) {
  const v = value == null || Number.isNaN(Number(value)) ? 0 : Math.max(0, Math.min(max, Number(value)));
  const pct = max ? Math.round((v / max) * 100) : 0;
  const colors = {
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    slate: "bg-slate-400",
  };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full transition-all ${colors[tone] || colors.sky}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Student employability intelligence — clear path: done / missing / next.
 */
export function StudentEmployabilityView({ prn, roleId = "software_developer" }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!prn) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api(`/api/employability/dashboard/student/${encodeURIComponent(prn)}?roleId=${encodeURIComponent(roleId)}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prn, roleId]);

  const derived = useMemo(() => {
    const gaps = data?.gaps?.rankedGaps || [];
    const skills = data?.profile?.skills || [];
    const done = [];
    const partial = [];
    const missing = [];
    for (const g of gaps) {
      const cur = g.currentScore;
      const target = g.targetScore != null ? Number(g.targetScore) : 60;
      const label = g.skillLabel || g.skillId;
      if (cur == null || cur === "") {
        missing.push({ ...g, label, target });
      } else if (Number(cur) >= target) {
        done.push({ ...g, label, target, current: Number(cur) });
      } else {
        partial.push({ ...g, label, target, current: Number(cur) });
      }
    }
    // Skills on profile not in gap list
    const gapIds = new Set(gaps.map((g) => g.skillId));
    for (const s of skills) {
      if (gapIds.has(s.skillId)) continue;
      if (s.skillScore != null) {
        done.push({
          skillId: s.skillId,
          label: s.skillLabel || s.skillId,
          current: s.skillScore,
          target: null,
        });
      }
    }
    return { done, partial, missing, gaps, skills };
  }, [data]);

  const graphLines = useMemo(() => {
    const edges = data?.skillGraph?.edges || [];
    return edges.slice(0, 16).map((e) => {
      const a = data?.skillLabels?.[e.prerequisiteSkill] || e.prerequisiteSkill;
      const b = data?.skillLabels?.[e.dependentSkill] || e.dependentSkill;
      return `${a} → ${b}`;
    });
  }, [data]);

  if (loading) {
    return (
      <div className="rounded-xl border bg-white p-8 text-sm text-muted-foreground animate-pulse">
        Loading your preparation path…
      </div>
    );
  }
  if (err) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
        Could not load dashboard: {err}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-xl border p-6 text-sm">
        No data yet. Save Core skills on <strong>Placement profile</strong>, then refresh this page.
      </div>
    );
  }

  const readiness = data.readiness || {};
  const band = readiness.readinessBand || "UNKNOWN";
  const score = readiness.readinessScore;
  const next = data.nextAction?.selected;
  const topGap = data.gaps?.topPrioritySkill;
  const roleName = (data.roleId || roleId || "").replace(/_/g, " ");
  const { done, partial, missing } = derived;
  const totalTracked = done.length + partial.length + missing.length;
  const pathPct = totalTracked ? Math.round((done.length / totalTracked) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-sky-50 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-800 bg-sky-100/80 px-2.5 py-1 rounded-full">
              <Sparkles className="h-3.5 w-3.5" />
              Your preparation path
            </div>
            <h2 className="text-2xl font-bold text-navy tracking-tight">Employability Intelligence</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Your <strong>personal practice plan</strong>: what you already cover, what is still missing, and{" "}
              <strong>what to do next</strong> for role{" "}
              <span className="font-semibold text-navy capitalize">{roleName}</span>.
              Change skill ratings only on <strong>Placement profile</strong>. This page is not the coordinator form and not a job-offer probability.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Different from Placement profile: that form’s “Placement profile score” is for the placement office. The score on this page is only for your learning path.
            </p>
          </div>
          <div className="rounded-xl border bg-white/90 px-5 py-4 min-w-[11rem] shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preparation score</div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-4xl font-bold text-navy tabular-nums">{score != null ? score : "—"}</span>
              <span className="text-sm text-muted-foreground pb-1">/ 100</span>
            </div>
            <div className="mt-2">
              <BandBadge band={band} />
            </div>
            <div className="mt-3">
              <ScoreBar
                value={score}
                tone={score >= 75 ? "emerald" : score >= 55 ? "sky" : score > 0 ? "amber" : "slate"}
              />
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-700 bg-white/70 border border-slate-100 rounded-lg px-3 py-2">
          {BAND_HELP[band] || readiness.explanation?.summary || BAND_HELP.UNKNOWN}
        </p>
      </div>

      {/* 3-step path */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            1 · What you have done
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{done.length}</p>
          <p className="text-xs text-emerald-800/80">Skills at or above role target (or rated on your profile)</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            2 · What needs work
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-900">{partial.length}</p>
          <p className="text-xs text-amber-800/80">You started these but they are still below the role target</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
          <div className="flex items-center gap-2 text-rose-900 font-semibold text-sm">
            <Circle className="h-5 w-5 text-rose-500" />
            3 · What is missing
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-900">{missing.length}</p>
          <p className="text-xs text-rose-800/80">No score yet — add on Placement profile or practice these</p>
        </div>
      </div>

      {/* Path progress */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 font-semibold text-navy text-sm">
            <TrendingUp className="h-4 w-4" />
            Role skill coverage
          </div>
          <span className="text-sm font-bold text-navy">{pathPct}%</span>
        </div>
        <ScoreBar value={pathPct} tone={pathPct >= 70 ? "emerald" : pathPct >= 40 ? "sky" : "amber"} />
        <p className="mt-2 text-xs text-muted-foreground">
          Share of tracked role skills that already meet the target. Missing and below-target skills pull this down.
        </p>
      </div>

      {/* Next action - big CTA */}
      <div className="rounded-2xl border-2 border-sky-200 bg-sky-50/60 p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sky-900 font-bold">
          <Target className="h-5 w-5" />
          Your next step
        </div>
        {next ? (
          <div className="mt-3 space-y-2">
            <p className="text-xl font-bold text-navy">{next.title || next.skillLabel || "Practice next priority skill"}</p>
            <p className="text-sm text-slate-700 leading-relaxed">
              {next.reason ||
                next.explanation ||
                `Focus on ${(next.skillLabel || next.skillId || "this skill").toString()}. This is the highest-priority gap for your target role.`}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {(next.skillLabel || next.skillId) && (
                <span className="rounded-full bg-white border px-3 py-1 text-xs font-medium">
                  Skill: {next.skillLabel || next.skillId}
                </span>
              )}
              {next.kind && (
                <span className="rounded-full bg-white border px-3 py-1 text-xs font-medium capitalize">
                  {String(next.kind).replace(/_/g, " ")}
                </span>
              )}
            </div>
          </div>
        ) : topGap ? (
          <div className="mt-3">
            <p className="text-xl font-bold text-navy">Work on: {topGap.skillLabel || topGap.skillId}</p>
            <p className="text-sm text-slate-700 mt-1">
              Highest ranked gap for this role. Update Placement profile or practice until you can honestly rate this skill.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-700">
            Save Core skills on <strong>Placement profile</strong>, then refresh — your next action will appear here.
          </p>
        )}
      </div>

      {/* Done / Partial / Missing lists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-emerald-900 flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4" /> On track
          </h3>
          <ul className="mt-3 space-y-2 max-h-64 overflow-y-auto">
            {done.length === 0 && (
              <li className="text-xs text-muted-foreground">Nothing at target yet — start with Placement profile ratings.</li>
            )}
            {done.map((g) => (
              <li key={g.skillId || g.label} className="text-sm flex justify-between gap-2 border-b border-emerald-50 pb-1.5">
                <span className="text-slate-800">{g.label}</span>
                <span className="text-emerald-700 font-semibold tabular-nums shrink-0">
                  {g.current != null ? g.current : "✓"}
                  {g.target != null ? ` / ${g.target}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-amber-100 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-amber-900 flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4" /> Improve these
          </h3>
          <ul className="mt-3 space-y-2 max-h-64 overflow-y-auto">
            {partial.length === 0 && (
              <li className="text-xs text-muted-foreground">No below-target skills with a score yet.</li>
            )}
            {partial.map((g) => (
              <li key={g.skillId || g.label} className="text-sm space-y-1 border-b border-amber-50 pb-2">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-800">{g.label}</span>
                  <span className="text-amber-800 font-semibold tabular-nums shrink-0">
                    {g.current} / {g.target}
                  </span>
                </div>
                <ScoreBar value={g.current} max={Math.max(g.target || 100, 100)} tone="amber" />
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-rose-100 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-rose-900 flex items-center gap-2 text-sm">
            <Circle className="h-4 w-4" /> Still missing
          </h3>
          <ul className="mt-3 space-y-2 max-h-64 overflow-y-auto">
            {missing.length === 0 && (
              <li className="text-xs text-muted-foreground">No missing role skills — great coverage.</li>
            )}
            {missing.map((g) => (
              <li key={g.skillId || g.label} className="text-sm flex items-start justify-between gap-2 border-b border-rose-50 pb-1.5">
                <span className="text-slate-800">{g.label}</span>
                <span className="text-rose-700 text-xs font-medium shrink-0">Need ≥ {g.target}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* All skill chips */}
      {(derived.skills || []).length > 0 && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-navy">
            <ListChecks className="h-4 w-4" />
            Scores from your Placement profile
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {derived.skills.map((s) => (
              <span
                key={s.skillId}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
              >
                <span className="font-semibold text-navy">{s.skillLabel || s.skillId}</span>
                <span className="text-slate-600"> · {s.skillScore ?? "—"}/100</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Priority table simplified */}
      <div className="rounded-xl border bg-white p-4 shadow-sm overflow-x-auto">
        <h3 className="font-semibold text-navy text-sm mb-3">Priority order (what to improve first)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b">
              <th className="pb-2 pr-2">#</th>
              <th className="pb-2 pr-2">Skill</th>
              <th className="pb-2 pr-2">You</th>
              <th className="pb-2 pr-2">Target</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(derived.gaps || []).slice(0, 12).map((g, i) => {
              const cur = g.currentScore;
              const target = g.targetScore;
              let status = "Missing";
              let cls = "text-rose-700";
              if (cur != null && target != null && Number(cur) >= Number(target)) {
                status = "On track";
                cls = "text-emerald-700";
              } else if (cur != null) {
                status = "Below target";
                cls = "text-amber-700";
              }
              return (
                <tr key={g.skillId || i} className="border-b border-slate-50">
                  <td className="py-2.5 pr-2 text-muted-foreground">{i + 1}</td>
                  <td className="py-2.5 pr-2 font-medium text-slate-900">{g.skillLabel || g.skillId}</td>
                  <td className="py-2.5 pr-2 tabular-nums">{cur != null ? cur : "—"}</td>
                  <td className="py-2.5 pr-2 tabular-nums">{target != null ? target : "—"}</td>
                  <td className={`py-2.5 font-medium text-xs ${cls}`}>{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!(derived.gaps || []).length && (
          <p className="text-sm text-muted-foreground">No gap ranking yet — save skills on Placement profile first.</p>
        )}
      </div>

      {/* Learning order */}
      {graphLines.length > 0 && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-navy text-sm mb-1">Suggested learning order</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Build left → right. Foundations first, then advanced skills.
          </p>
          <div className="flex flex-wrap gap-2">
            {graphLines.map((line) => (
              <span
                key={line}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-xs text-slate-700"
              >
                {line.split(" → ").map((part, i, arr) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    {i > 0 && <ArrowRight className="h-3 w-3 text-slate-400" />}
                    <span className={i === 0 ? "font-medium" : ""}>{part}</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-center text-muted-foreground pb-2">
        To change ratings: open <strong>Placement profile</strong> → Save → refresh this page. Do not mix this preparation score with the “Placement profile score” on the other page. Job-offer ML stays off until the college has real historical placement outcomes.
      </p>
    </div>
  );
}


export function CohortEmployabilityTable({ endpoint, title }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bandFilter, setBandFilter] = useState("ALL");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(endpoint)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (err) return <div className="p-4 text-sm text-rose-700">{err}</div>;
  if (!data) return <div className="p-4 text-sm">Insufficient data</div>;

  const students = (data.students || data.studentsRequiringAttention || []).filter((s) =>
    bandFilter === "ALL" ? true : s.readinessBand === bandFilter
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-navy">{title}</h2>
        <select
          className="rounded-lg border px-3 py-2 text-sm"
          value={bandFilter}
          onChange={(e) => setBandFilter(e.target.value)}
        >
          <option value="ALL">All bands</option>
          <option value="READY">READY</option>
          <option value="NEAR_READY">NEAR_READY</option>
          <option value="NOT_READY">NOT_READY</option>
          <option value="INSUFFICIENT_EVIDENCE">INSUFFICIENT_EVIDENCE</option>
        </select>
      </div>
      {data.ml?.message ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          ML: {data.ml.message}
        </div>
      ) : null}
      {data.readinessBandDistribution ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(data.readinessBandDistribution).map(([k, v]) => (
            <span key={k} className="rounded-full border px-2 py-1">
              {k}: {v}
            </span>
          ))}
        </div>
      ) : null}
      {!students.length ? (
        <p className="text-sm text-muted-foreground">Insufficient data for this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">PRN</th>
                <th className="px-3 py-2">Band</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Top gap</th>
                <th className="px-3 py-2">Intervention</th>
                <th className="px-3 py-2">Stagnation</th>
                <th className="px-3 py-2">Personalization</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.prn} className="border-b">
                  <td className="px-3 py-2 font-mono text-xs">{s.prn}</td>
                  <td className="px-3 py-2">
                    <BandBadge band={s.readinessBand} />
                  </td>
                  <td className="px-3 py-2">{s.readinessScore ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{s.topSkillGap?.skillLabel || s.topSkillGap?.skillId || "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.currentIntervention || "—"}
                    {s.interventionStatus ? ` (${s.interventionStatus})` : ""}
                  </td>
                  <td className="px-3 py-2">{s.stagnation ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">{s.personalizationEvidenceLevel || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {data.note || "Values come from backend employability engines — not recalculated in the UI."}
      </p>
    </div>
  );
}

export function AdminEmployabilityHealth() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api("/api/employability/dashboard/admin")
      .then(setData)
      .catch((e) => setErr(e.message || String(e)));
  }, []);
  if (err) return <div className="text-sm text-rose-700">{err}</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Loading system health…</div>;
  const ml = data.ml || {};
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-navy">Employability system health</h2>
      <div className="rounded-xl border bg-white p-4 text-sm">
        <div className="font-semibold">Stages</div>
        <p className="text-muted-foreground">{(data.system?.stages || []).join(" · ")}</p>
      </div>
      <div className="rounded-xl border bg-white p-4 text-sm">
        <div className="font-semibold">S7 ML registry</div>
        <p>
          Display status: <span className="font-medium">{ml.displayStatus || "unavailable"}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Labeled outcomes: {ml.data?.counts?.labeled ?? 0} · Active model:{" "}
          {ml.registry?.activeModel?.modelId || "none"}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          With zero real placement labels, ML must remain unavailable. No fabricated probability is shown.
        </p>
      </div>
    </div>
  );
}
