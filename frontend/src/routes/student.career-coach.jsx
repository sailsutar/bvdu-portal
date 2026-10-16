import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/lib/auth";
import { api } from "@/lib/api";
import { CheckCircle2, Circle, Lock, Loader2, AlertTriangle, MessageCircle, Send } from "lucide-react";

/**
 * Career Coach: (1) mandatory DSA → (2) full domain topics → (3) final projects judged.
 * Includes offline Career Coach chatbot (no external chat API).
 */
export default function StudentCareerCoachPage() {
  const { session } = useSession();
  const prn = session?.id || session?.sub || session?.prn;
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState({});
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant",
      text:
        "Hi — I’m your Career Coach assistant (runs on this portal only, no external chat API). Ask what to do next, DSA plan, domain choice, resume bullets, or interview prep.",
      suggestions: ["What should I do next?", "DSA study plan", "How to choose a domain", "Interview prep"],
    },
  ]);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatOpen]);

  async function sendChat(text) {
    const message = String(text || chatInput || "").trim();
    if (!message || !prn || chatBusy) return;
    setChatInput("");
    setChatMessages((m) => [...m, { role: "user", text: message }]);
    setChatBusy(true);
    try {
      const res = await api(`/api/career-coach/${encodeURIComponent(prn)}/chat`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setChatMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: res.reply || res.message || "No reply.",
          suggestions: res.suggestions || [],
          intent: res.intent,
        },
      ]);
    } catch (e) {
      setChatMessages((m) => [
        ...m,
        { role: "assistant", text: e.message || String(e), suggestions: ["What should I do next?"] },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  const load = useCallback(() => {
    if (!prn) return;
    setLoading(true);
    api(`/api/career-coach/${encodeURIComponent(prn)}`)
      .then(setData)
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [prn]);

  useEffect(() => {
    load();
  }, [load]);

  async function selectDomain(domainId) {
    setBusy(true);
    setErr(null);
    try {
      setData(
        await api(`/api/career-coach/${encodeURIComponent(prn)}/domain`, {
          method: "PUT",
          body: JSON.stringify({ domainId }),
        })
      );
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDsa(topic) {
    if (!topic.unlocked && !topic.done) return;
    setBusy(true);
    setErr(null);
    try {
      setData(
        await api(`/api/career-coach/${encodeURIComponent(prn)}/dsa-topic`, {
          method: "PUT",
          body: JSON.stringify({ topicId: topic.id, done: !topic.done }),
        })
      );
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleTopic(topic) {
    if (!data?.selectedDomainId) return;
    if (!topic.unlocked && !topic.done) return;
    setBusy(true);
    setErr(null);
    try {
      setData(
        await api(`/api/career-coach/${encodeURIComponent(prn)}/topic`, {
          method: "PUT",
          body: JSON.stringify({
            domainId: data.selectedDomainId,
            topicId: topic.id,
            done: !topic.done,
          }),
        })
      );
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitProject(project, markDone = false) {
    if (!data?.selectedDomainId) return;
    const note = notes[project.id] ?? project.note ?? "";
    setBusy(true);
    setErr(null);
    try {
      setData(
        await api(`/api/career-coach/${encodeURIComponent(prn)}/final-project`, {
          method: "POST",
          body: JSON.stringify({
            domainId: data.selectedDomainId,
            projectId: project.id,
            note,
            markDone,
          }),
        })
      );
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!prn) {
    return <div className="p-6 text-sm text-muted-foreground">Sign in as a student.</div>;
  }
  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Career Coach…
      </div>
    );
  }

  const dsa = data?.dsa;
  const dsaComplete = Boolean(data?.dsaComplete);
  const roadmap = data?.roadmap;
  const domains = data?.domains || [];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-navy">Career Coach</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Full path to become employable in a domain.{" "}
          <strong className="text-navy">DSA is mandatory for every domain</strong> — finish Basics through Dynamic
          Programming first, then tick every domain topic, then submit final projects for judgment.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Tracking overview:{" "}
          <Link to="/student/employability" className="text-sky-700 font-semibold underline">
            Employability Intelligence
          </Link>
          {" · "}
          Coordinator form:{" "}
          <Link to="/student/placement" className="text-sky-700 font-semibold underline">
            Placement profile
          </Link>
        </p>
      </div>

      {err ? <p className="text-sm text-rose-700 bg-rose-50 border rounded-lg px-3 py-2">{err}</p> : null}

      {/* Path legend */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <div className={`rounded-xl border p-3 ${dsaComplete ? "border-emerald-300 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="font-bold text-navy">1. DSA (mandatory)</div>
          <div className="text-xs mt-1">{dsaComplete ? "Complete" : `${dsa?.doneCount ?? 0}/${dsa?.total ?? "—"} topics`}</div>
        </div>
        <div className={`rounded-xl border p-3 ${roadmap?.topicsComplete ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
          <div className="font-bold text-navy">2. Domain topics</div>
          <div className="text-xs mt-1">
            {!dsaComplete ? "Locked until DSA done" : roadmap ? `${roadmap.topicsDone}/${roadmap.topicsTotal} ticked` : "Pick a domain"}
          </div>
        </div>
        <div className={`rounded-xl border p-3 ${roadmap?.projectsUnlocked ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"}`}>
          <div className="font-bold text-navy">3. Final projects</div>
          <div className="text-xs mt-1">{roadmap?.projectsUnlocked ? "Open — submit for AI judgment" : "Unlock after all topics"}</div>
        </div>
      </div>

      {/* Phase 1 DSA */}
      <section className="rounded-xl border bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-navy">Phase 1 — DSA roadmap (mandatory)</h2>
            <p className="text-sm text-muted-foreground">
              Every domain requires this. Same progress as Employability Intelligence.
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold text-navy">{dsa?.percent ?? 0}%</div>
            <div className="text-xs text-muted-foreground">
              {dsa?.doneCount ?? 0}/{dsa?.total ?? 0}
            </div>
          </div>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${dsa?.percent ?? 0}%` }} />
        </div>
        {!dsaComplete && (
          <p className="text-sm flex gap-2 items-start text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            Domain topic ticks stay locked until DSA is 100% complete (through Dynamic Programming).
          </p>
        )}
        <ol className="space-y-2">
          {(dsa?.topics || []).map((t) => {
            const locked = !t.unlocked && !t.done;
            return (
              <li
                key={t.id}
                className={`flex gap-3 rounded-lg border px-3 py-2 ${
                  t.done ? "border-emerald-200 bg-emerald-50/60" : locked ? "opacity-60 bg-slate-50" : "border-slate-200"
                }`}
              >
                <button type="button" disabled={locked || busy} onClick={() => toggleDsa(t)} className="shrink-0">
                  {locked ? (
                    <Lock className="h-5 w-5 text-slate-400" />
                  ) : t.done ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <Circle className="h-5 w-5 text-slate-400" />
                  )}
                </button>
                <div>
                  <div className="font-semibold text-sm text-navy">
                    {t.order}. {t.title}
                  </div>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Single domain — one active path; editable later */}
      <section>
        <h2 className="font-semibold text-navy mb-1">Your domain (one at a time)</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Only <strong>one</strong> domain is active. You can change it later; progress on each domain is saved separately.
        </p>
        {data?.selectedDomainId ? (
          <div className="mb-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm">
            <span className="text-xs font-semibold uppercase text-sky-800">Active domain</span>
            <div className="font-bold text-navy text-lg">
              {domains.find((x) => x.id === data.selectedDomainId)?.title || data.selectedDomainId}
            </div>
          </div>
        ) : (
          <p className="mb-3 text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            No domain selected yet — pick one below to start Phase 2.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {domains.map((d) => {
            const selected = data?.selectedDomainId === d.id;
            return (
              <button
                key={d.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (selected) return;
                  if (
                    data?.selectedDomainId &&
                    data.selectedDomainId !== d.id &&
                    !window.confirm(
                      `Switch active domain to “${d.title}”? Your current domain progress is kept; only one domain stays active.`
                    )
                  ) {
                    return;
                  }
                  selectDomain(d.id);
                }}
                className={`text-left rounded-xl border p-4 transition ${
                  selected
                    ? "border-sky-400 bg-sky-50 ring-2 ring-sky-200"
                    : "bg-white hover:border-sky-200 opacity-95"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-navy">{d.title}</div>
                  {selected ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-sky-800 bg-white border border-sky-200 rounded-full px-2 py-0.5">
                      Active
                    </span>
                  ) : data?.selectedDomainId ? (
                    <span className="text-[10px] font-semibold text-slate-500">Switch to this</span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{d.summary}</p>
                <p className="text-xs font-semibold mt-2 text-slate-600">
                  Topics {d.topicsPercent}% · Projects {d.projectsSolid}/{d.projectsTotal}
                  {!dsaComplete ? " · DSA gate closed" : ""}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Phase 2 + 3 */}
      {roadmap && (
        <>
          <section className="rounded-xl border bg-white p-5 shadow-sm space-y-3">
            <div className="flex justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-navy">Phase 2 — {roadmap.title} topics</h2>
                <p className="text-sm text-muted-foreground">Tick every topic in order. No shortcuts.</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-navy">{roadmap.topicsPercent}%</div>
                <div className="text-xs text-muted-foreground">
                  {roadmap.topicsDone}/{roadmap.topicsTotal}
                </div>
              </div>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-sky-500" style={{ width: `${roadmap.topicsPercent}%` }} />
            </div>
            <ol className="space-y-2">
              {roadmap.topics.map((t) => {
                const locked = !t.unlocked && !t.done;
                return (
                  <li
                    key={t.id}
                    className={`flex gap-3 rounded-lg border px-3 py-2 ${
                      t.done ? "border-emerald-200 bg-emerald-50/50" : locked ? "opacity-60 bg-slate-50" : ""
                    }`}
                  >
                    <button type="button" disabled={locked || busy} onClick={() => toggleTopic(t)} className="shrink-0">
                      {locked ? (
                        <Lock className="h-5 w-5 text-slate-400" />
                      ) : t.done ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <Circle className="h-5 w-5 text-slate-400" />
                      )}
                    </button>
                    <div>
                      <div className="font-semibold text-sm text-navy">
                        {t.order}. {t.title}
                      </div>
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                      {t.lockedReason ? <p className="text-[11px] text-amber-800 mt-0.5">{t.lockedReason}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="rounded-xl border-2 border-sky-200 bg-sky-50/40 p-5 shadow-sm space-y-3">
            <h2 className="text-lg font-bold text-navy">Phase 3 — Final projects (judged)</h2>
            <p className="text-sm text-muted-foreground">
              Unlocked only after <strong>DSA complete</strong> and <strong>all domain topics</strong> ticked. Write what you
              built; get feedback; mark done when status is Solid.
            </p>
            {!roadmap.projectsUnlocked && (
              <p className="text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Projects locked. Finish Phase 1 (DSA) and Phase 2 (all topics) first.
              </p>
            )}
            <div className="space-y-4">
              {roadmap.projects.map((p) => (
                <div
                  key={p.id}
                  className={`rounded-xl border bg-white p-4 ${!p.unlocked ? "opacity-60" : ""}`}
                >
                  <div className="font-semibold text-navy">
                    Project {p.order}: {p.title}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                  {p.unlocked && (
                    <div className="mt-3 space-y-2">
                      <textarea
                        className="w-full rounded-lg border px-3 py-2 text-sm min-h-[100px]"
                        placeholder="Goal, tools, steps, results/metrics, what you’d improve…"
                        value={notes[p.id] ?? p.note ?? ""}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        disabled={busy}
                      />
                      <div className="flex flex-wrap gap-2 items-center">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => submitProject(p, false)}
                          className="rounded-lg bg-navy text-white text-xs font-semibold px-3 py-1.5"
                        >
                          Get AI judgment
                        </button>
                        {p.projectStatus === "solid" && (
                          <button
                            type="button"
                            disabled={busy || p.done}
                            onClick={() => submitProject(p, true)}
                            className="rounded-lg bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
                          >
                            {p.done ? "Marked done" : "Mark project done"}
                          </button>
                        )}
                        {p.projectStatus && p.projectStatus !== "not_started" && (
                          <span
                            className={`text-xs font-semibold rounded-full px-2 py-0.5 ${
                              p.projectStatus === "solid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
                            }`}
                          >
                            {p.projectStatus === "solid" ? "Solid" : "Needs work"}
                          </span>
                        )}
                      </div>
                      {p.judgeFeedback ? (
                        <div className="text-xs text-slate-700 border rounded-lg px-2 py-1.5 bg-slate-50 space-y-1">
                          <p>{p.judgeFeedback}</p>
                          {p.source ? (
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Judgment source: {p.source}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* Offline Career Coach chatbot */}
      <section className="rounded-2xl border border-sky-200 bg-gradient-to-b from-sky-50/80 to-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setChatOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 font-semibold text-navy">
            <MessageCircle className="h-5 w-5 text-sky-700" />
            Career Coach Assistant
            <span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">
              Offline · no API key
            </span>
          </span>
          <span className="text-xs text-muted-foreground">{chatOpen ? "Hide" : "Show"}</span>
        </button>
        {chatOpen && (
          <div className="border-t border-sky-100 px-3 pb-3 pt-2 space-y-2">
            <p className="text-[11px] text-muted-foreground px-1">
              Uses your live DSA / domain progress. Works without Gemini. For project write-up scoring, still use{" "}
              <strong>Get AI judgment</strong> on each final project.
            </p>
            <div className="h-72 overflow-y-auto rounded-xl bg-white border border-slate-200 p-3 space-y-3">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-navy text-white rounded-br-md"
                        : "bg-slate-50 text-slate-800 border border-slate-200 rounded-bl-md"
                    }`}
                  >
                    {msg.text}
                    {msg.role === "assistant" && msg.suggestions?.length ? (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {msg.suggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            disabled={chatBusy}
                            onClick={() => sendChat(s)}
                            className="text-[11px] rounded-full border border-sky-200 bg-sky-50 text-sky-900 px-2 py-0.5 hover:bg-sky-100 disabled:opacity-50"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {chatBusy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                sendChat(chatInput);
              }}
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask: what should I do next? DSA plan? interview prep…"
                disabled={chatBusy}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-300"
              />
              <button
                type="submit"
                disabled={chatBusy || !chatInput.trim()}
                className="rounded-xl bg-navy text-white px-3 py-2 disabled:opacity-50"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
