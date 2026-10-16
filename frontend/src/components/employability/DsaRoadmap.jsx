import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CheckCircle2, Circle, Lock, Loader2 } from "lucide-react";

/**
 * Student DSA roadmap — sequential checklist Basics → … → Dynamic Programming.
 */
export function DsaRoadmap({ prn }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    if (!prn) return;
    setLoading(true);
    setErr(null);
    api(`/api/employability/dsa-roadmap/${encodeURIComponent(prn)}`)
      .then((d) => setData(d))
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [prn]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(topic) {
    if (!prn || busyId) return;
    if (!topic.unlocked && !topic.done) return;
    setBusyId(topic.id);
    setErr(null);
    try {
      const nextDone = !topic.done;
      const d = await api(`/api/employability/dsa-roadmap/${encodeURIComponent(prn)}/topic`, {
        method: "PUT",
        body: JSON.stringify({ topicId: topic.id, done: nextDone }),
      });
      setData(d);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border bg-white p-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading DSA roadmap…
      </div>
    );
  }

  if (err && !data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{err}</div>
    );
  }

  const topics = data?.topics || [];
  const percent = data?.percent ?? 0;
  const next = data?.nextTopic;

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-navy">DSA roadmap</h3>
          <p className="text-sm text-muted-foreground">
            Start from the basics and tick each stage when you finish it. Stages unlock in order through{" "}
            <strong>Dynamic Programming</strong>.
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-navy">{percent}%</div>
          <div className="text-xs text-muted-foreground">
            {data?.doneCount ?? 0} / {data?.total ?? topics.length} stages done
          </div>
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      {next ? (
        <p className="text-sm rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-sky-900">
          <strong>Next up:</strong> {next.title} — {next.description}
        </p>
      ) : data?.complete ? (
        <p className="text-sm rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-emerald-900">
          You completed the full DSA roadmap through Dynamic Programming. Keep revising and solving mixed problems.
        </p>
      ) : null}

      {err ? (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</p>
      ) : null}

      <ol className="space-y-2">
        {topics.map((t) => {
          const locked = !t.unlocked && !t.done;
          const busy = busyId === t.id;
          return (
            <li
              key={t.id}
              className={`flex gap-3 rounded-xl border px-3 py-3 transition ${
                t.done
                  ? "border-emerald-200 bg-emerald-50/60"
                  : locked
                    ? "border-slate-100 bg-slate-50 opacity-70"
                    : "border-slate-200 bg-white hover:border-sky-200"
              }`}
            >
              <button
                type="button"
                disabled={locked || busy}
                onClick={() => toggle(t)}
                className="mt-0.5 shrink-0 disabled:cursor-not-allowed"
                title={
                  locked
                    ? "Finish the previous stage first"
                    : t.done
                      ? "Mark as not done"
                      : "Mark as done"
                }
                aria-label={t.done ? `Unmark ${t.title}` : `Mark ${t.title} done`}
              >
                {busy ? (
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                ) : locked ? (
                  <Lock className="h-6 w-6 text-slate-400" />
                ) : t.done ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                ) : (
                  <Circle className="h-6 w-6 text-slate-400" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Stage {t.order}</span>
                  <span className={`font-semibold ${t.done ? "text-emerald-900" : "text-navy"}`}>
                    {t.title}
                  </span>
                  {t.done ? (
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                      Done
                    </span>
                  ) : locked ? (
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded-full">
                      Locked
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-sky-800 bg-sky-100 px-2 py-0.5 rounded-full">
                      Current
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{t.description}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
