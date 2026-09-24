import { useMemo, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import { getSession } from "@/lib/auth";
import {
  runTgActionAgent,
  listActionDrafts,
  resolveActionDraft,
  runParentCommunicationAgent,
} from "@/lib/agents";
import { NoData } from "@/components/portal/NoData";

export default function TgAgent() {
  const { students } = useDerived();
  const session = getSession();
  const tgIndex = session?.tgIndex ?? session?.teacherGuideIndex ?? 0;
  const tgId = session?.id || session?.identifier || `TG${tgIndex + 1}`;
  const [tick, setTick] = useState(0);
  const [editId, setEditId] = useState(null);
  const [editBody, setEditBody] = useState("");
  const [msg, setMsg] = useState("");

  const drafts = useMemo(() => {
    void tick;
    return listActionDrafts({}).filter(
      (d) => !d.tgId || d.tgId === tgId || d.tgId === session?.id
    );
  }, [tick, tgId, session?.id]);
  const pending = drafts.filter((d) => d.status === "pending");

  if (!students.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Action Agent</h1>
        <NoData message="No student cohort loaded." />
      </div>
    );
  }

  function run() {
    const created = runTgActionAgent(students, {
      tgId,
      tgName: session?.name || tgId,
      tgIndex,
    });
    setMsg(`Agent drafted ${created.length} action(s). Review Approve / Edit / Skip below.`);
    setTick((t) => t + 1);
  }

  function approve(d) {
    resolveActionDraft(d.id, "approved");
    setMsg(`Approved action for ${d.studentName}. Intervention created.`);
    setTick((t) => t + 1);
  }

  function skip(d) {
    resolveActionDraft(d.id, "skipped");
    setMsg(`Skipped ${d.studentName}.`);
    setTick((t) => t + 1);
  }

  function startEdit(d) {
    setEditId(d.id);
    setEditBody(d.draftBody || "");
  }

  function saveEdit(d) {
    resolveActionDraft(d.id, "edited", { draftBody: editBody });
    setEditId(null);
    setMsg(`Saved edits and approved for ${d.studentName}.`);
    setTick((t) => t + 1);
  }

  function parentDraft(d) {
    const student = students.find((s) => String(s.prn) === String(d.prn));
    if (!student) return;
    runParentCommunicationAgent(student, {
      mode: d.actionType === "attendance_plan" ? "attendance" : "full",
      channel: d.channelHint || "email",
    });
    setMsg(`Parent letter draft stored for ${d.studentName}. Open Message on Students to send.`);
    setTick((t) => t + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Teacher Guide Action Agent</h1>
        <p className="text-sm text-muted-foreground">
          Weekly-style run: finds high-need students, picks an action, drafts a parent letter. You only
          Approve, Edit, or Skip.
        </p>
        {msg && <p className="mt-1 text-xs text-muted-foreground">{msg}</p>}
      </div>

      <SectionCard title="Run agent">
        <button
          type="button"
          className="rounded bg-gold px-4 py-2 text-sm font-semibold text-navy"
          onClick={run}
        >
          Run action agent now
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          Pending in queue: <b>{pending.length}</b>
        </p>
      </SectionCard>

      <SectionCard title="Approve / Edit / Skip queue">
        {!pending.length ? (
          <p className="text-sm text-muted-foreground">No pending drafts. Run the agent.</p>
        ) : (
          <ul className="space-y-4">
            {pending.map((d) => (
              <li key={d.id} className="rounded border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-navy">
                      {d.studentName}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {d.prn} · {d.cls}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.riskStatus} · need {d.needScore} · action{" "}
                      <b>{d.actionType}</b>
                    </div>
                    <div className="mt-1 text-xs">{d.rationale}</div>
                    {d.drivers?.length > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Drivers: {d.drivers.join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="rounded bg-gold px-2 py-1 text-xs font-semibold text-navy"
                      onClick={() => approve(d)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => startEdit(d)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => skip(d)}
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() => parentDraft(d)}
                    >
                      Parent draft
                    </button>
                  </div>
                </div>
                {editId === d.id ? (
                  <div className="mt-2">
                    <textarea
                      className="w-full rounded border p-2 text-xs font-mono"
                      rows={10}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <button
                      type="button"
                      className="mt-1 rounded bg-gold px-2 py-1 text-xs font-semibold text-navy"
                      onClick={() => saveEdit(d)}
                    >
                      Save edit & approve
                    </button>
                  </div>
                ) : (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">
                    {d.draftSubject}
                    {"\n\n"}
                    {d.draftBody}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
