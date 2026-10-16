/**
 * Practical data-entry UI for Employability Intelligence.
 * Writes only through existing S1/S4/S5 APIs — no new scoring logic.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { SectionCard } from "@/components/portal/PortalShell";

const SOURCE_TYPES = [
  { value: "self_report", label: "Self-report (student)" },
  { value: "teacher_evaluation", label: "Teacher evaluation" },
  { value: "verified_assessment", label: "Verified assessment" },
  { value: "coding_test", label: "Coding test" },
  { value: "project_evaluation", label: "Project evaluation" },
  { value: "verified_certificate", label: "Verified certificate" },
  { value: "verified_github", label: "Verified GitHub" },
];

function Msg({ tone, children }) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "err"
        ? "border-rose-200 bg-rose-50 text-rose-900"
        : "border-slate-200 bg-slate-50 text-slate-800";
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

/**
 * @param {{ mode: "student" | "staff", defaultPrn?: string, canEditPrn?: boolean }} props
 */
export function EmployabilityInputWorkspace({ mode = "staff", defaultPrn = "", canEditPrn = true }) {
  const isStaff = mode === "staff";
  const [prn, setPrn] = useState(defaultPrn || "");
  const [roleId, setRoleId] = useState("software_developer");
  const [roles, setRoles] = useState([]);
  const [skillCatalog, setSkillCatalog] = useState([]);
  const [interventions, setInterventions] = useState([]);
  const [profile, setProfile] = useState(null);
  const [skillScores, setSkillScores] = useState({}); // skillId -> number string
  const [skillSource, setSkillSource] = useState(isStaff ? "teacher_evaluation" : "self_report");
  const [assessSkill, setAssessSkill] = useState("dsa");
  const [assessScore, setAssessScore] = useState("");
  const [assessSource, setAssessSource] = useState("coding_test");
  const [decisionId, setDecisionId] = useState("");
  const [resultScore, setResultScore] = useState("");
  const [resultSource, setResultSource] = useState("coding_test");
  const [timeSpent, setTimeSpent] = useState("");
  const [nextAction, setNextAction] = useState(null);
  const [decisions, setDecisions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (defaultPrn) setPrn(defaultPrn);
  }, [defaultPrn]);

  useEffect(() => {
    Promise.all([
      api("/api/employability/skills/catalog").catch(() => ({ skills: [] })),
      api("/api/employability/roles").catch(() => ({ roles: [] })),
      api("/api/employability/interventions/catalog").catch(() => ({ interventions: [] })),
    ]).then(([sk, ro, iv]) => {
      const skills = sk.skills || sk.catalog || sk.items || [];
      if (Array.isArray(skills) && skills.length) {
        setSkillCatalog(
          skills.map((s) =>
            typeof s === "string"
              ? { id: s, label: s }
              : { id: s.skillId || s.id, label: s.label || s.roleName || s.name || s.skillId || s.id }
          )
        );
      } else if (sk.labels && typeof sk.labels === "object") {
        setSkillCatalog(Object.entries(sk.labels).map(([id, label]) => ({ id, label })));
      } else if (sk.skillIds) {
        setSkillCatalog((sk.skillIds || []).map((id) => ({ id, label: sk.labels?.[id] || id })));
      }
      setRoles(ro.roles || ro.items || []);
      const ints = iv.interventions || iv.catalog || iv.items || [];
      setInterventions(Array.isArray(ints) ? ints : []);
    });
  }, []);

  const loadProfile = useCallback(async () => {
    if (!prn) return;
    setErr(null);
    try {
      const data = await api(`/api/employability/profile/${encodeURIComponent(prn)}`);
      setProfile(data.profile || data);
      const scores = {};
      for (const s of data.profile?.skills || data.skills || []) {
        if (s.skillId != null && s.skillScore != null) scores[s.skillId] = String(s.skillScore);
      }
      setSkillScores(scores);
      setMsg({ tone: "ok", text: "Profile loaded." });
    } catch (e) {
      setErr(e.message || String(e));
      setProfile(null);
    }
  }, [prn]);

  const loadDecisions = useCallback(async () => {
    if (!prn) return;
    try {
      const data = await api(`/api/employability/decisions?prn=${encodeURIComponent(prn)}&limit=15`);
      setDecisions(data.decisions || data.items || data.rows || []);
    } catch {
      setDecisions([]);
    }
  }, [prn]);

  useEffect(() => {
    if (prn) {
      loadProfile();
      loadDecisions();
    }
  }, [prn, loadProfile, loadDecisions]);

  const skillList = useMemo(() => {
    if (skillCatalog.length) return skillCatalog;
    // fallback common ids if catalog empty
    return [
      "programming",
      "oop",
      "dsa",
      "advanced_dsa",
      "dbms",
      "os",
      "networks",
      "web_html_css",
      "javascript",
      "react",
      "backend",
      "full_stack",
      "git",
      "cloud",
      "devops",
      "aiml",
      "data_analysis",
      "system_design",
      "communication",
      "projects",
      "internship",
      "cybersecurity",
    ].map((id) => ({ id, label: id }));
  }, [skillCatalog]);

  const saveSkills = async () => {
    if (!prn) {
      setErr("Enter PRN first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const skills = skillList
        .map((s) => {
          const raw = skillScores[s.id];
          if (raw === undefined || raw === "") return null;
          const score = Number(raw);
          if (Number.isNaN(score)) return null;
          return {
            skillId: s.id,
            skillScore: Math.max(0, Math.min(100, score)),
            evidenceSources: [
              {
                sourceType: skillSource,
                scoreOrResult: score,
                verificationStatus: skillSource === "self_report" ? "unverified" : "verified",
                timestamp: new Date().toISOString(),
              },
            ],
          };
        })
        .filter(Boolean);
      if (!skills.length) {
        setErr("Enter at least one skill score (0–100).");
        setBusy(false);
        return;
      }
      const res = await api(`/api/employability/profile/${encodeURIComponent(prn)}/skills`, {
        method: "PUT",
        body: JSON.stringify({ skills, source: skillSource }),
      });
      setMsg({ tone: "ok", text: res.message || `Saved ${skills.length} skill(s).` });
      await loadProfile();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitAssessment = async () => {
    if (!isStaff) return;
    if (!prn || !assessSkill || assessScore === "") {
      setErr("PRN, skill, and score required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api("/api/employability/assessments", {
        method: "POST",
        body: JSON.stringify({
          prn,
          skillId: assessSkill,
          score: Number(assessScore),
          sourceType: assessSource,
          verificationStatus: assessSource === "self_report" ? "unverified" : "verified",
        }),
      });
      setMsg({
        tone: "ok",
        text: res.message || `Assessment saved. New skill score: ${res.afterScore ?? res.skillScore ?? "—"}`,
      });
      await loadProfile();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const requestNextAction = async () => {
    if (!prn || !roleId) {
      setErr("PRN and target role required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const path = isStaff
        ? "/api/employability/adaptive/next-action"
        : "/api/employability/next-action";
      const res = await api(path, {
        method: "POST",
        body: JSON.stringify({ prn, roleId, persist: true }),
      });
      setNextAction(res);
      setMsg({ tone: "ok", text: "Next action generated from backend (S4/S6)." });
      if (res.decisionId) setDecisionId(String(res.decisionId));
      await loadDecisions();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const recordResult = async () => {
    if (!isStaff) return;
    if (!prn || !decisionId || resultScore === "") {
      setErr("PRN, decision ID, and post score required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api("/api/employability/intervention-results", {
        method: "POST",
        body: JSON.stringify({
          prn,
          decisionId,
          score: Number(resultScore),
          sourceType: resultSource,
          timeSpentHours: timeSpent === "" ? undefined : Number(timeSpent),
        }),
      });
      setMsg({
        tone: "ok",
        text:
          res.message ||
          `Result recorded. Gain: ${res.actualImprovement ?? "—"} · Effectiveness: ${res.effectiveness?.status || res.meta?.effectiveness?.status || "—"}`,
      });
      await loadProfile();
      await loadDecisions();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const hitl = async (action) => {
    if (!isStaff || !decisionId) {
      setErr("Decision ID required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/employability/decisions/${encodeURIComponent(decisionId)}/hitl`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setMsg({ tone: "ok", text: `Decision ${action}.` });
      await loadDecisions();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-navy">Employability data entry</h2>
        <p className="text-sm text-muted-foreground">
          Enter skills, assessments, and intervention results. The system uses these as evidence — self-report alone
          is weaker than verified sources.
        </p>
      </div>

      {err ? <Msg tone="err">{err}</Msg> : null}
      {msg ? <Msg tone={msg.tone}>{msg.text}</Msg> : null}

      <SectionCard title="Student and target role">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">PRN</span>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={prn}
              disabled={!canEditPrn}
              onChange={(e) => setPrn(e.target.value.trim())}
              placeholder="e.g. 2343110099"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Target role</span>
            <select
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              {(roles.length
                ? roles.map((r) => (
                    <option key={r.roleId || r.id} value={r.roleId || r.id}>
                      {r.roleName || r.label || r.name || r.roleId || r.id}
                    </option>
                  ))
                : [
                    <option key="software_developer" value="software_developer">
                      Software developer
                    </option>,
                    <option key="data_analyst" value="data_analyst">
                      Data analyst
                    </option>,
                    <option key="fullstack" value="fullstack_developer">
                      Full-stack developer
                    </option>,
                  ])}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => {
                loadProfile();
                loadDecisions();
              }}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
              disabled={!prn || busy}
            >
              Load profile
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="1. Enter / update skill scores">
        <p className="mb-3 text-xs text-muted-foreground">
          Scores 0–100. Choose evidence type: self-report is allowed but does not count as strong verified evidence.
        </p>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Evidence type for this save</span>
          <select
            className="w-full max-w-md rounded-lg border px-3 py-2 text-sm"
            value={skillSource}
            onChange={(e) => setSkillSource(e.target.value)}
          >
            {(isStaff ? SOURCE_TYPES : SOURCE_TYPES.filter((s) => s.value === "self_report")).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {skillList.map((s) => (
            <label key={s.id} className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={s.label}>
                {s.label}
              </span>
              <input
                type="number"
                min={0}
                max={100}
                className="w-16 rounded border px-1 py-1 text-sm"
                value={skillScores[s.id] ?? ""}
                onChange={(e) => setSkillScores((prev) => ({ ...prev, [s.id]: e.target.value }))}
                placeholder="—"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !prn}
          onClick={saveSkills}
          className="mt-3 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save skills
        </button>
      </SectionCard>

      {isStaff ? (
        <SectionCard title="2. Record assessment (staff)">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Skill</span>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={assessSkill}
                onChange={(e) => setAssessSkill(e.target.value)}
              >
                {skillList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Score (0–100)</span>
              <input
                type="number"
                min={0}
                max={100}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={assessScore}
                onChange={(e) => setAssessScore(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Source</span>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={assessSource}
                onChange={(e) => setAssessSource(e.target.value)}
              >
                {SOURCE_TYPES.filter((s) => s.value !== "self_report").map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={busy || !prn}
            onClick={submitAssessment}
            className="mt-3 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Submit assessment
          </button>
        </SectionCard>
      ) : null}

      <SectionCard title={isStaff ? "3. Generate recommended next action" : "2. Get recommended next action"}>
        <button
          type="button"
          disabled={busy || !prn}
          onClick={requestNextAction}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50"
        >
          Generate next action
        </button>
        {nextAction?.selected ? (
          <div className="mt-3 space-y-1 rounded-lg border bg-slate-50 p-3 text-sm">
            <div className="font-semibold text-navy">{nextAction.selected.title}</div>
            <div className="text-xs text-muted-foreground">
              {nextAction.selected.kind} · {nextAction.selected.modality} · status: {nextAction.selected.status}
            </div>
            {nextAction.decisionId ? (
              <div className="font-mono text-xs">decisionId: {nextAction.decisionId}</div>
            ) : null}
            <p className="text-xs">{nextAction.decision_trace?.explanation || nextAction.note}</p>
          </div>
        ) : null}
      </SectionCard>

      {isStaff ? (
        <SectionCard title="4. Record intervention result (after student completes)">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-xs text-muted-foreground">Decision ID</span>
              <input
                className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
                value={decisionId}
                onChange={(e) => setDecisionId(e.target.value.trim())}
                placeholder="from next action or list below"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Post score (0–100)</span>
              <input
                type="number"
                min={0}
                max={100}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={resultScore}
                onChange={(e) => setResultScore(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Hours spent (optional)</span>
              <input
                type="number"
                min={0}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={timeSpent}
                onChange={(e) => setTimeSpent(e.target.value)}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-xs text-muted-foreground">Evidence source</span>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={resultSource}
                onChange={(e) => setResultSource(e.target.value)}
              >
                {SOURCE_TYPES.filter((s) => s.value !== "self_report").map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !prn}
              onClick={recordResult}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save intervention result
            </button>
            <button
              type="button"
              disabled={busy || !decisionId}
              onClick={() => hitl("approve")}
              className="rounded-lg border border-emerald-400 px-3 py-2 text-sm text-emerald-800"
            >
              HITL approve
            </button>
            <button
              type="button"
              disabled={busy || !decisionId}
              onClick={() => hitl("reject")}
              className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-800"
            >
              HITL reject
            </button>
          </div>
          {decisions.length ? (
            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Recent decisions</div>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                {decisions.map((d) => (
                  <li key={d._id || d.id}>
                    <button
                      type="button"
                      className="text-left text-navy underline"
                      onClick={() => setDecisionId(String(d._id || d.id))}
                    >
                      {String(d._id || d.id).slice(-8)} · {d.interventionId} · {d.status}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      {profile ? (
        <SectionCard title="Current profile snapshot">
          <pre className="max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] text-slate-700">
            {JSON.stringify(
              {
                prn: profile.prn,
                skills: (profile.skills || []).map((s) => ({
                  skillId: s.skillId,
                  skillScore: s.skillScore,
                  status: s.status,
                })),
              },
              null,
              2
            )}
          </pre>
        </SectionCard>
      ) : null}

      {interventions.length ? (
        <p className="text-xs text-muted-foreground">
          Intervention catalog loaded ({interventions.length} items) — used by next-action engine on the server.
        </p>
      ) : null}
    </div>
  );
}
