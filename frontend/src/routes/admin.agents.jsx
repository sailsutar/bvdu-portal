import { useMemo, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";
import { authHeaders, getSession } from "@/lib/auth";
import {
  runStatusNotifyBatch,
  listStatusNotify,
  getStatusNotifyBatch,
  resolveStatusNotifyItem,
  approveAllStatusNotify,
  executeStatusNotifySend,
  runAttendanceAlertBatch,
  listAttendanceBatch,
  resolveAttendanceBatchItem,
  approveAllAttendanceBatch,
  markAttendanceBatchSent,
  runMarksFollowUpAgent,
  listMarksFollowUp,
  resolveMarksFollowUp,
  runInterventionReminderAgent,
  listInterventionReminders,
  resolveFollowUp,
  runFeedbackCoachingAgent,
  listCoachingForReview,
  resolveCoachingNote,
  getLastDataQualityReport,
  evaluateUploadGate,
  setUploadGateOverride,
  getUploadGateOverride,
  runOddMarksReviewAgent,
  listOddMarksReview,
  resolveOddMarksItem,
  runSlowLearnerFocusAgent,
  listSlowLearnerFocus,
  resolveSlowLearnerItem,
  nominateAllSlowLearners,
  runExamWindowAgent,
  listExamWindow,
  resolveExamWindowItem,
} from "@/lib/agents";
import { recordOutcome, updateIntervention } from "@/lib/academic-intelligence";
import { currentStatusOf } from "@/lib/ml-predict";
import { NoData } from "@/components/portal/NoData";

const API_BASE = import.meta.env.VITE_API_URL || "";

const STATUS_OPTIONS = ["At Risk", "Average", "Good"];

export default function AdminAgents() {
  const { students: allStudents } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);
  const session = getSession();
  const [tab, setTab] = useState("notify");
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  // Notify automation controls
  const [selStatus, setSelStatus] = useState({ "At Risk": true, Average: false, Good: false });
  const [mode, setMode] = useState("full");
  const [channel, setChannel] = useState("email");
  const [attThreshold, setAttThreshold] = useState(75);

  const refresh = () => setTick((x) => x + 1);

  const counts = useMemo(() => {
    const c = { "At Risk": 0, Average: 0, Good: 0 };
    for (const s of students || []) {
      const st = currentStatusOf(s);
      if (c[st] != null) c[st] += 1;
    }
    return c;
  }, [students, tick]);

  const notifyPending = useMemo(() => {
    void tick;
    return listStatusNotify({ status: "pending" });
  }, [tick]);
  const notifyApproved = useMemo(() => {
    void tick;
    return listStatusNotify({ status: "approved" });
  }, [tick]);
  const notifySent = useMemo(() => {
    void tick;
    return listStatusNotify({ status: "sent" });
  }, [tick]);
  const notifyFailed = useMemo(() => {
    void tick;
    return listStatusNotify({ status: "failed" });
  }, [tick]);
  const batchMeta = useMemo(() => {
    void tick;
    return getStatusNotifyBatch();
  }, [tick]);

  const attendancePending = useMemo(() => {
    void tick;
    return listAttendanceBatch({ status: "pending" });
  }, [tick]);
  const marksPending = useMemo(() => {
    void tick;
    return listMarksFollowUp({ status: "pending" });
  }, [tick]);
  const reminders = useMemo(() => {
    void tick;
    return listInterventionReminders().filter((r) => r.status === "pending");
  }, [tick]);
  const oddPending = useMemo(() => {
    void tick;
    return listOddMarksReview({ status: "pending" });
  }, [tick]);
  const slowPending = useMemo(() => {
    void tick;
    return listSlowLearnerFocus({ status: "pending" });
  }, [tick]);
  const examPending = useMemo(() => {
    void tick;
    return listExamWindow({ status: "pending" });
  }, [tick]);
  const coaching = useMemo(() => {
    void tick;
    return listCoachingForReview().filter(
      (n) => !n.reviewStatus || n.reviewStatus === "pending_hod"
    );
  }, [tick]);
  const quality = useMemo(() => {
    void tick;
    return getLastDataQualityReport();
  }, [tick]);
  const gate = useMemo(() => {
    void tick;
    return evaluateUploadGate(getLastDataQualityReport());
  }, [tick]);

  const tabs = [
    { id: "notify", label: "Auto notify by status" },
    { id: "attendance", label: "Attendance batch" },
    { id: "marks", label: "Marks follow-up" },
    { id: "reminders", label: "Intervention reminders" },
    { id: "quality", label: "Upload quality gate" },
    { id: "coaching", label: "Feedback coaching" },
    { id: "odd", label: "Odd marks review" },
    { id: "slow", label: "Slow-learner list" },
    { id: "exam", label: "Exam-window push" },
  ];

  if (!allStudents.length && tab !== "quality") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">AI Agents (Head of Department)</h1>
        <NoData message="Upload cohort data to run automation." />
      </div>
    );
  }

  function toggleStatus(name) {
    setSelStatus((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  async function buildNotifyList() {
    const statuses = STATUS_OPTIONS.filter((s) => selStatus[s]);
    if (!statuses.length) {
      setMsg("Select at least one status: At Risk, Average, or Good.");
      return;
    }
    const items = runStatusNotifyBatch(students, { statuses, mode, channel });
    setMsg(
      `Agent prepared ${items.length} message(s) for: ${statuses.join(", ")}. Review the list, then Approve all and Send.`
    );
    refresh();
  }

  async function approveAndSend() {
    approveAllStatusNotify();
    setSending(true);
    setMsg("Sending approved messages…");
    try {
      const results = await executeStatusNotifySend({
        authHeadersFn: authHeaders,
        apiBase: API_BASE,
      });
      setMsg(
        `Done. Sent: ${results.sent}, failed: ${results.failed}, skipped: ${results.skipped}.` +
          (results.errors?.length ? ` Issues: ${results.errors.slice(0, 3).join("; ")}` : "")
      );
    } catch (e) {
      setMsg(String(e.message || e));
    }
    setSending(false);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">AI Agents (Head of Department)</h1>
        <p className="text-sm text-muted-foreground">
          You choose who (by status) and approve once. The agent builds the full list and sends. You can still message
          individual students manually from Students.
        </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Showing {students.length} of {allStudents.length} students
          {year !== "All" ? ` · ${year}` : ""}
          {batch !== "All" ? ` · batch ${batch}` : ""}
        </p>
        <YearBatchFilter {...filterProps} />
      </div>

        {msg && <p className="mt-2 rounded border bg-muted/30 px-3 py-2 text-xs">{msg}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
              tab === t.id ? "border-gold bg-gold-soft text-navy" : ""
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "notify" && (
        <SectionCard title="Automated parent notify (approve once → agent sends)">
          <div className="mb-4 grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded border p-3">
              <div className="mb-2 text-xs font-semibold text-navy">1. Who should receive messages?</div>
              {STATUS_OPTIONS.map((s) => (
                <label key={s} className="mb-1 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!selStatus[s]} onChange={() => toggleStatus(s)} />
                  {s} <span className="text-muted-foreground">({counts[s] || 0} students)</span>
                </label>
              ))}
            </div>
            <div className="rounded border p-3">
              <div className="mb-2 text-xs font-semibold text-navy">2. Message type</div>
              <select className="w-full rounded border px-2 py-1.5 text-sm" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="full">Full (attendance + marks)</option>
                <option value="attendance">Attendance only</option>
                <option value="marks">Marks only</option>
              </select>
              <div className="mb-2 mt-3 text-xs font-semibold text-navy">3. Channel</div>
              <select className="w-full rounded border px-2 py-1.5 text-sm" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>
            <div className="rounded border p-3">
              <div className="mb-2 text-xs font-semibold text-navy">4. Run</div>
              <button type="button" className="mb-2 w-full rounded bg-gold px-3 py-2 text-xs font-semibold text-navy" onClick={buildNotifyList}>
                Build list (agent prepares all messages)
              </button>
              <button
                type="button"
                disabled={sending || (!notifyPending.length && !notifyApproved.length)}
                className="w-full rounded border border-navy bg-navy px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                onClick={approveAndSend}
              >
                {sending ? "Sending…" : "Approve all pending & send"}
              </button>
              <p className="mt-2 text-xs text-muted-foreground">
                Pending {notifyPending.length} · Approved {notifyApproved.length} · Sent {notifySent.length} · Failed{" "}
                {notifyFailed.length}
              </p>
            </div>
          </div>

          <p className="mb-2 text-xs text-muted-foreground">
            Last batch: {(batchMeta.statuses || []).join(", ") || "—"} · {batchMeta.mode || "—"} · {batchMeta.channel || "—"}
          </p>

          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Student</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Contact</th>
                  <th className="py-2">Queue</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...notifyPending, ...notifyApproved, ...notifyFailed].slice(0, 80).map((x) => (
                  <tr key={x.id} className="border-b last:border-b-0">
                    <td className="py-2">
                      <div className="font-medium text-navy">{x.studentName}</div>
                      <div className="text-xs text-muted-foreground">{x.prn}</div>
                    </td>
                    <td className="py-2">{x.academicStatus}</td>
                    <td className="py-2 text-xs">
                      {x.channel === "email" ? x.email || "No email" : x.phone || "No phone"}
                    </td>
                    <td className="py-2 text-xs">{x.status}{x.error ? ` — ${x.error}` : ""}</td>
                    <td className="py-2">
                      {x.status === "pending" && (
                        <div className="flex gap-1">
                          <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={() => { resolveStatusNotifyItem(x.id, "approved"); refresh(); }}>Approve</button>
                          <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={() => { resolveStatusNotifyItem(x.id, "skipped"); refresh(); }}>Skip</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!notifyPending.length && !notifyApproved.length && !notifyFailed.length && (
              <p className="py-4 text-sm text-muted-foreground">No list yet. Choose statuses and click Build list.</p>
            )}
          </div>
        </SectionCard>
      )}

      {tab === "attendance" && (
        <SectionCard title="Attendance alert batch (below threshold)">
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <label className="text-xs">
              Threshold %
              <input type="number" className="ml-2 w-20 rounded border px-2 py-1" value={attThreshold} onChange={(e) => setAttThreshold(Number(e.target.value) || 75)} />
            </label>
            <button type="button" className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy" onClick={() => { setMsg(`Queued ${runAttendanceAlertBatch(students, { threshold: attThreshold }).length}`); refresh(); }}>Build list</button>
            <button type="button" className="rounded border px-3 py-1.5 text-xs" onClick={() => { approveAllAttendanceBatch(); markAttendanceBatchSent(); setMsg("Approved and marked sent (use Auto notify for real API send)."); refresh(); }}>Approve all</button>
          </div>
          <ul className="max-h-64 space-y-1 overflow-auto text-sm">
            {attendancePending.map((x) => (
              <li key={x.id} className="flex justify-between border-b py-1">
                <span>{x.studentName} · {x.attendance}%</span>
                <span className="flex gap-1">
                  <button type="button" className="text-xs underline" onClick={() => { resolveAttendanceBatchItem(x.id, "approved"); refresh(); }}>Approve</button>
                  <button type="button" className="text-xs underline" onClick={() => { resolveAttendanceBatchItem(x.id, "skipped"); refresh(); }}>Skip</button>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {tab === "marks" && (
        <SectionCard title="Marks follow-up">
          <button type="button" className="mb-3 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy" onClick={() => { setMsg(`Found ${runMarksFollowUpAgent(students).length}`); refresh(); }}>Scan marks</button>
          <ul className="max-h-64 space-y-2 overflow-auto text-sm">
            {marksPending.map((x) => (
              <li key={x.id} className="rounded border p-2">
                <b>{x.studentName}</b>
                <div className="text-xs">{x.rationale}</div>
                <button type="button" className="mt-1 text-xs underline" onClick={() => { resolveMarksFollowUp(x.id, "approved"); refresh(); }}>Approve remedial</button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {tab === "reminders" && (
        <SectionCard title="Intervention reminders">
          <button type="button" className="mb-3 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy" onClick={() => { setMsg(`${runInterventionReminderAgent(students).length} reminders`); refresh(); }}>Scan</button>
          <ul className="space-y-2 text-sm">
            {reminders.map((f) => (
              <li key={f.id} className="rounded border p-2">
                {f.studentName}: {f.suggestion} — {f.reason}
                <button type="button" className="ml-2 text-xs underline" onClick={() => {
                  if (f.interventionId) {
                    updateIntervention(f.interventionId, { status: "done" });
                    recordOutcome({ interventionId: f.interventionId, prn: f.prn, type: f.type, improved: f.suggestion === "improved", notes: f.reason });
                  }
                  resolveFollowUp(f.id, "accepted");
                  refresh();
                }}>Accept</button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {tab === "quality" && (
        <SectionCard title="Upload quality gate">
          {!quality ? (
            <p className="text-sm text-muted-foreground">No report yet. Use Upload Academic Data dry-run.</p>
          ) : (
            <div className="text-sm">
              <p>Gate: <b>{gate.blocked ? "BLOCKED" : "Open"}</b></p>
              <ul className="mt-2 space-y-1">
                {(quality.findings || []).map((f, i) => (
                  <li key={i} className="text-xs"><b>{f.level}</b> — {f.message}</li>
                ))}
              </ul>
              <button type="button" className="mt-2 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy" onClick={() => { setUploadGateOverride(true, { by: session?.id }); setMsg("Override approved"); refresh(); }}>Approve override</button>
              <button type="button" className="ml-2 mt-2 rounded border px-3 py-1.5 text-xs" onClick={() => { setUploadGateOverride(false); refresh(); }}>Clear</button>
            </div>
          )}
        </SectionCard>
      )}

      {tab === "coaching" && (
        <SectionCard title="Feedback coaching (HOD review)">
          <button type="button" className="mb-3 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy" onClick={async () => {
            try {
              const r = await fetch(`${API_BASE}/api/feedback?limit=500`, { headers: { ...authHeaders() } });
              const data = await r.json();
              const list = Array.isArray(data) ? data : data.items || data.feedbacks || [];
              setMsg(`Drafted ${runFeedbackCoachingAgent(list).length} notes`);
            } catch (e) {
              setMsg(String(e.message || e));
            }
            refresh();
          }}>Run</button>
          <ul className="space-y-2 text-sm">
            {coaching.map((n) => (
              <li key={n.id} className="rounded border p-2">
                <b>{n.teacherId}</b>: {n.note}
                <div className="mt-1">
                  <button type="button" className="text-xs underline" onClick={() => { resolveCoachingNote(n.id, "approved"); refresh(); }}>Approve</button>
                  <button type="button" className="ml-2 text-xs underline" onClick={() => { resolveCoachingNote(n.id, "rejected"); refresh(); }}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {tab === "odd" && (
        <SectionCard title="Odd marks review">
          <button type="button" className="mb-3 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy" onClick={() => { setMsg(`${runOddMarksReviewAgent(students).length}`); refresh(); }}>Scan</button>
          <ul className="max-h-64 space-y-1 overflow-auto text-sm">
            {oddPending.map((a) => (
              <li key={a.id} className="border-b py-1">
                {a.name}: {a.detail}
                <button type="button" className="ml-2 text-xs underline" onClick={() => { resolveOddMarksItem(a.id, "dismissed"); refresh(); }}>Dismiss</button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {tab === "slow" && (
        <SectionCard title="Slow-learner list">
          <button type="button" className="mb-3 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy" onClick={() => { setMsg(`${runSlowLearnerFocusAgent(students).length}`); refresh(); }}>Build</button>
          <button type="button" className="mb-3 ml-2 rounded border px-3 py-1.5 text-xs" onClick={() => { setMsg(`Nominated ${nominateAllSlowLearners().length}`); refresh(); }}>Nominate all</button>
          <ul className="max-h-64 overflow-auto text-sm">
            {slowPending.map((x) => (
              <li key={x.id} className="flex justify-between border-b py-1">
                <span>{x.studentName}</span>
                <button type="button" className="text-xs underline" onClick={() => { resolveSlowLearnerItem(x.id, "nominated"); refresh(); }}>Nominate</button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {tab === "exam" && (
        <SectionCard title="Exam-window push">
          <button type="button" className="mb-3 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-navy" onClick={() => { setMsg(`${runExamWindowAgent(students).length}`); refresh(); }}>Build list</button>
          <ul className="max-h-64 space-y-1 overflow-auto text-sm">
            {examPending.map((x) => (
              <li key={x.id} className="flex justify-between border-b py-1">
                <span>{x.studentName} · {x.daysLeft}d</span>
                <button type="button" className="text-xs underline" onClick={() => { resolveExamWindowItem(x.id, "approved"); refresh(); }}>Approve</button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
