import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/lib/auth";
import { api } from "@/lib/api";
import { ArrowRight, Target, Loader2 } from "lucide-react";

/**
 * Employability Intelligence — tracking summary only.
 * Full DSA + domain topics + projects live only on Career Coach.
 */
export default function StudentEmployabilityPage() {
  const { session } = useSession();
  const prn = session?.id || session?.sub || session?.prn;
  const [coach, setCoach] = useState(null);
  const [dash, setDash] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!prn) return;
    setLoading(true);
    setErr(null);
    Promise.all([
      api(`/api/career-coach/${encodeURIComponent(prn)}`).catch((e) => {
        throw e;
      }),
      api(`/api/employability/dashboard/student/${encodeURIComponent(prn)}?roleId=software_developer`).catch(() => null),
    ])
      .then(([c, d]) => {
        setCoach(c);
        setDash(d);
      })
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [prn]);

  useEffect(() => {
    load();
  }, [load]);

  if (!prn) {
    return <div className="p-6 text-sm text-muted-foreground">Sign in as a student to view employability intelligence.</div>;
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const band = dash?.readiness?.readinessBand || "UNKNOWN";
  const score = dash?.readiness?.readinessScore;
  const dsa = coach?.dsa;
  const dsaComplete = Boolean(coach?.dsaComplete);
  const domainMeta = (coach?.domains || []).find((d) => d.id === coach?.selectedDomainId);
  const roadmap = coach?.roadmap;

  const missing = [];
  if (!dsaComplete) missing.push(`DSA incomplete (${dsa?.doneCount ?? 0}/${dsa?.total ?? "—"} topics)`);
  if (!coach?.selectedDomainId) missing.push("No career domain selected yet");
  else if (roadmap && !roadmap.topicsComplete) {
    missing.push(`${roadmap.title}: ${roadmap.topicsTotal - roadmap.topicsDone} topic(s) left`);
  }
  if (roadmap?.topicsComplete && roadmap.projects?.length) {
    const pending = roadmap.projects.filter((p) => !p.done && p.projectStatus !== "solid").length;
    if (pending) missing.push(`${pending} final project(s) still open`);
  }
  if (!(dash?.profile?.skills || []).length) missing.push("Core skills not set on Placement profile");

  let nextLabel = "Open Career Coach";
  let nextHint = "Start or continue your path";
  if (!dsaComplete && dsa?.topics?.length) {
    const n = dsa.topics.find((t) => t.unlocked && !t.done);
    if (n) {
      nextLabel = `Next DSA: ${n.title}`;
      nextHint = "Mandatory for every domain";
    }
  } else if (roadmap?.nextTopic) {
    nextLabel = `Next topic: ${roadmap.nextTopic.title}`;
    nextHint = roadmap.title;
  } else if (roadmap?.projectsUnlocked && roadmap.nextProject) {
    nextLabel = `Next project: ${roadmap.nextProject.title}`;
    nextHint = "Submit for judgment in Career Coach";
  } else if (roadmap?.topicsComplete) {
    nextLabel = "Domain path looking complete";
    nextHint = "Review projects or update Placement profile";
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-navy">Employability Intelligence</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Snapshot of where you stand. Roadmaps, ticks, and project judgment are only on{" "}
          <Link to="/student/career-coach" className="text-sky-700 font-semibold underline">
            Career Coach
          </Link>
          . Coordinator data stays on{" "}
          <Link to="/student/placement" className="text-sky-700 font-semibold underline">
            Placement profile
          </Link>
          .
        </p>
      </div>

      {err ? <p className="text-sm text-rose-700 bg-rose-50 border rounded-lg px-3 py-2">{err}</p> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preparation range</div>
          <div className="mt-2 text-3xl font-bold text-navy tabular-nums">{score != null ? score : "—"}</div>
          <div className="text-sm font-semibold text-slate-700 mt-1">{String(band).replace(/_/g, " ")}</div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">DSA (mandatory)</div>
          <div className="mt-2 text-3xl font-bold text-navy">{dsa?.percent ?? 0}%</div>
          <div className="text-sm text-slate-600 mt-1">
            {dsaComplete ? "Complete" : `${dsa?.doneCount ?? 0}/${dsa?.total ?? "—"} topics`}
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected domain</div>
          <div className="mt-2 text-lg font-bold text-navy leading-snug">{domainMeta?.title || "None yet"}</div>
          {domainMeta ? (
            <div className="text-sm text-slate-600 mt-1">
              Topics {domainMeta.topicsPercent}% · Projects {domainMeta.projectsSolid}/{domainMeta.projectsTotal}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground mt-2">Choose one domain in Career Coach (you can change it later).</div>
          )}
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills on profile</div>
          <div className="mt-2 text-3xl font-bold text-navy">{(dash?.profile?.skills || []).length}</div>
          <div className="text-xs text-muted-foreground mt-2">From Placement profile Core skills</div>
        </div>
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase text-sky-800">Your next step</div>
          <div className="text-lg font-bold text-navy mt-0.5">{nextLabel}</div>
          <div className="text-xs text-slate-600">{nextHint}</div>
        </div>
        <Link
          to="/student/career-coach"
          className="inline-flex items-center gap-2 rounded-lg bg-navy text-white text-sm font-semibold px-4 py-2"
        >
          Continue in Career Coach <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 font-semibold text-navy text-sm">
          <Target className="h-4 w-4" /> Still missing / open
        </div>
        {missing.length === 0 ? (
          <p className="text-sm text-emerald-800 mt-2">Nothing major flagged — keep projects and profile updated.</p>
        ) : (
          <ul className="mt-2 list-disc list-inside text-sm text-slate-700 space-y-1">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>

      {(dash?.profile?.skills || []).length > 0 && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Skill scores (read-only here)</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {dash.profile.skills.map((s) => (
              <span key={s.skillId} className="rounded-full border px-3 py-1 text-xs">
                <span className="font-semibold">{s.skillLabel || s.skillId}</span>
                {": "}
                {s.skillScore ?? "—"}/100
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Edit ratings on Placement profile, then refresh.</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        One active domain at a time. Progress on other domains is kept if you change domain later in Career Coach.
      </p>
    </div>
  );
}
