import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

const SKILL = [1, 2, 3, 4, 5];

export default function StudentPlacement() {
  const [p, setP] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api("/api/placement/me");
    setP(r.profile);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  function setField(k, v) {
    setP((prev) => ({ ...prev, [k]: v }));
  }

  function addCustom() {
    setP((prev) => ({
      ...prev,
      customFields: [...(prev.customFields || []), { key: "", value: "" }],
    }));
  }

  function setCustom(i, key, value) {
    setP((prev) => {
      const cf = [...(prev.customFields || [])];
      cf[i] = { ...cf[i], [key]: value };
      return { ...prev, customFields: cf };
    });
  }

  async function save(submit) {
    setBusy(true);
    setMsg("");
    try {
      const body = { ...p, submit };
      const r = await api("/api/placement/me", { method: "PUT", body: JSON.stringify(body) });
      setP(r.profile);
      // Push overlapping fields into System Admin master record
      try {
        await api("/api/admin-master/student-self", {
          method: "PUT",
          body: JSON.stringify({
            name: r.profile?.name,
            tenthPercent: r.profile?.tenthPercent,
            twelfthPercent: r.profile?.twelfthPercent,
            cetScore: r.profile?.cetScore,
            jeeScore: r.profile?.jeeScore,
            yearLevel: r.profile?.yearLevel,
            batch: r.profile?.batch,
          }),
        });
      } catch {
        /* master sync best-effort */
      }
      setMsg(submit ? "Submitted to placement coordinator." : "Draft saved.");
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!p) {
    return <p className="text-sm text-muted-foreground">Loading placement profile…</p>;
  }

  const locked = p.status === "locked";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Placement profile</h1>
        <p className="text-sm text-muted-foreground">
          Fill employability details for the placement cell. Linked to your academic Excel data where available.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-muted px-3 py-1 font-semibold capitalize">Status: {p.status}</span>
          <span className={`rounded-full px-3 py-1 font-semibold ${p.consistency === "inconsistent" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
            {p.consistency === "inconsistent" ? "Inconsistent (active KT)" : "Consistent"}
          </span>
          <span className="rounded-full bg-sky-100 px-3 py-1 font-semibold text-sky-900">
            Completeness {p.completenessScore}%
          </span>
          <span className="rounded-full bg-gold/40 px-3 py-1 font-semibold text-navy">
            Readiness {p.readinessBand} ({p.readinessScore})
          </span>
          {p.employablePrediction && (
            <span className="rounded-full bg-navy px-3 py-1 font-semibold text-white">{p.employablePrediction}</span>
          )}
          {p.attendance != null && (
            <span className="rounded-full bg-muted px-3 py-1">Attendance {p.attendance}% (from Excel)</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {p.dataSources?.excel && (
            <span className="rounded-full bg-violet-100 px-3 py-1 font-semibold text-violet-900">Data: System Admin Excel</span>
          )}
          {(p.dataSources?.student || p.sourceProfile) && (
            <span className="rounded-full bg-teal-100 px-3 py-1 font-semibold text-teal-900">Data: Your form</span>
          )}
          <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-800">
            Mode: {p.placementMode === "prediction" || p.predictionEligible ? "Domain prediction (TY/LY)" : "Preparation (FY/SY)"}
          </span>
        </div>
        {(p.placementMode === "preparation" || p.preparation || (!p.predictionEligible && p.yearLevel !== "TY" && p.yearLevel !== "LY")) && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm">
            <p className="font-bold text-amber-950">
              {p.preparation?.headline || "Preparation stage — full placement prediction starts from Third Year"}
            </p>
            <ul className="mt-2 list-inside list-disc text-xs text-amber-950/90">
              {(p.preparation?.explain || ["Fill skills, internships, and academics now so Third Year prediction is accurate."]).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs font-semibold text-amber-950">What to prepare</p>
            <ul className="list-inside list-disc text-xs">
              {(p.preparation?.prepare || p.tade?.gap_plan || []).slice(0, 6).map((g, i) => (
                <li key={i}>{typeof g === "string" ? g : g.action}</li>
              ))}
            </ul>
          </div>
        )}
        {(p.predictionEligible || p.placementMode === "prediction") && (p.tade?.top_domain || p.tadeTopDomain) && (
          <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-sm">
            <p className="font-bold text-indigo-900">Domain prediction (TADE)</p>
            <p className="mt-1 font-semibold text-navy">
              Top: {p.tade?.top_domain || p.tadeTopDomain}
            </p>
            <p className="text-xs text-muted-foreground">
              Domain set: {(p.tade?.domain_set || p.tadeDomainSet || []).join(", ") || "—"}
              {(p.tade?.uncertain || p.tadeUncertain) ? " · needs review (broad set)" : ""}
            </p>
            {(p.tade?.gap_plan || p.tadeGapPlan || []).length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs">
                {(p.tade?.gap_plan || p.tadeGapPlan).slice(0, 3).map((g, i) => (
                  <li key={i}>{typeof g === "string" ? g : g.action}</li>
                ))}
              </ul>
            )}
          </div>
        )}

      </div>
      {msg && <p className="text-sm text-navy/90">{msg}</p>}
      {p.coordinatorNote && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          Coordinator note: {p.coordinatorNote}
        </p>
      )}
      {(p.gaps || []).length > 0 && (
        <SectionCard title="Gaps to improve">
          <ul className="list-inside list-disc text-sm text-navy/90">
            {p.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </SectionCard>
      )}

      {(p.predictionEligible || p.placementMode === "prediction") && (p.primaryDomain || (p.suggestedDomains || []).length > 0) && (
        <SectionCard title="AI suggested domains (from your marks & profile)">
          <p className="text-sm text-muted-foreground">
            Based on subject marks (Excel), skill ratings, and internships — not a job guarantee.
          </p>
          <p className="mt-2 text-lg font-bold text-navy">
            {p.primaryDomain}
            {p.primaryDomainFit != null ? ` · fit ${p.primaryDomainFit}` : ""}
          </p>
          <ul className="mt-3 space-y-2">
            {(p.suggestedDomains || []).map((d) => (
              <li key={d.domain} className="rounded border px-3 py-2 text-sm">
                <span className="font-semibold text-navy">
                  {d.domain} ({d.fitScore})
                </span>
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  {(d.reasons || []).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <fieldset disabled={locked} className="space-y-4">
        <SectionCard title="Academics">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["cgpa", "CGPA", "number"],
              ["degreePercent", "Degree %", "number"],
              ["activeKtCount", "Active KTs (backlogs)", "number"],
              ["ktDetails", "KT details", "text"],
            ].map(([k, lab, typ]) => (
              <label key={k} className="text-sm">
                <span className="text-xs font-semibold text-muted-foreground">{lab}</span>
                <input
                  type={typ}
                  className="mt-1 w-full rounded border px-2 py-1.5"
                  value={p[k] ?? ""}
                  onChange={(e) => setField(k, e.target.value)}
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Active KT count greater than zero marks you as academically inconsistent for placement readiness.
          </p>
        </SectionCard>

        <SectionCard title="Background (edit if needed)">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["tenthPercent", "10th %"],
              ["twelfthPercent", "12th %"],
              ["cetScore", "CET"],
              ["jeeScore", "JEE"],
            ].map(([k, lab]) => (
              <label key={k} className="text-sm">
                <span className="text-xs font-semibold text-muted-foreground">{lab}</span>
                <input
                  type="number"
                  className="mt-1 w-full rounded border px-2 py-1.5"
                  value={p[k] ?? ""}
                  onChange={(e) => setField(k, e.target.value)}
                />
              </label>
            ))}
          </div>
        </SectionCard>

        {(p.topicStrengths || p.topicBasicAvg != null) && (
          <SectionCard title="Company-basic topics from your subject marks (Excel)">
            <p className="mb-2 text-xs text-muted-foreground">
              Derived from UT/subject marks uploaded by HOD — not self-rating. Used in employability prediction.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              {[
                ["DSA", p.markTopicDsaPct, p.markTopicDsa],
                ["Programming", p.markTopicProgPct, p.markTopicProg],
                ["DBMS", p.markTopicDbmsPct, p.markTopicDbms],
                ["AI / ML", p.markTopicAimlPct, p.markTopicAiml],
              ].map(([lab, pct, lvl]) => (
                <div key={lab} className="rounded border px-3 py-2">
                  <p className="text-xs font-semibold text-muted-foreground">{lab}</p>
                  <p className="font-semibold text-navy">
                    {pct != null ? `${pct}%` : "—"}
                    {lvl != null ? ` · level ${lvl}/5` : ""}
                  </p>
                </div>
              ))}
            </div>
            {p.topicBasicAvg != null && (
              <p className="mt-2 text-sm">
                Average on company-basic topics: <strong>{p.topicBasicAvg}%</strong>
              </p>
            )}
            {(p.subjectTopicBreakdown || []).length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-semibold text-navy">Subject breakdown</summary>
                <ul className="mt-1 max-h-40 overflow-auto">
                  {p.subjectTopicBreakdown.map((s) => (
                    <li key={s.subject}>
                      {s.subject}: {s.score}%
                      {s.topics?.length ? ` → ${s.topics.join(", ")}` : " (unmapped)"}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </SectionCard>
        )}

        <SectionCard title="Core skills (1 = beginner, 5 = strong)">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["skillDsa", "DSA"],
              ["skillC", "C"],
              ["skillCpp", "C++"],
              ["skillDbms", "DBMS"],
              ["skillAiml", "AI / ML / DL"],
            ].map(([k, lab]) => (
              <label key={k} className="text-sm">
                <span className="text-xs font-semibold text-muted-foreground">{lab}</span>
                <select
                  className="mt-1 w-full rounded border px-2 py-1.5"
                  value={p[k] ?? ""}
                  onChange={(e) => setField(k, e.target.value)}
                >
                  <option value="">—</option>
                  {SKILL.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="mt-3 block text-sm">
            <span className="text-xs font-semibold text-muted-foreground">Other skill tags</span>
            <input
              className="mt-1 w-full rounded border px-2 py-1.5"
              placeholder="e.g. React, Python, SQL"
              value={p.skillTags || ""}
              onChange={(e) => setField("skillTags", e.target.value)}
            />
          </label>
        </SectionCard>

        <SectionCard title="Experience and achievements">
          <p className="mb-2 text-xs text-muted-foreground">
            Internships from the <strong>2nd semester</strong> onward mark a strong placement profile. Log early
            internships and the starting semester when possible.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-xs font-semibold text-muted-foreground">Internship count</span>
              <input
                type="number"
                className="mt-1 w-full rounded border px-2 py-1.5"
                value={p.internshipCount ?? ""}
                onChange={(e) => setField("internshipCount", e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-semibold text-muted-foreground">
                Internship from semester (2 = 2nd sem — preferred)
              </span>
              <input
                type="number"
                min={1}
                max={8}
                className="mt-1 w-full rounded border px-2 py-1.5"
                placeholder="e.g. 2"
                value={p.internshipStartSem ?? ""}
                onChange={(e) => setField("internshipStartSem", e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-semibold text-muted-foreground">Resume URL / link</span>
              <input
                className="mt-1 w-full rounded border px-2 py-1.5"
                value={p.resumeUrl || ""}
                onChange={(e) => setField("resumeUrl", e.target.value)}
                placeholder="https://..."
              />
            </label>
            {[
              ["internships", "Internships (details)"],
              ["hackathons", "Hackathons"],
              ["buildathons", "Buildathons"],
              ["achievements", "Achievements"],
            ].map(([k, lab]) => (
              <label key={k} className="text-sm sm:col-span-2">
                <span className="text-xs font-semibold text-muted-foreground">{lab}</span>
                <textarea
                  className="mt-1 w-full rounded border px-2 py-1.5"
                  rows={2}
                  value={p[k] || ""}
                  onChange={(e) => setField(k, e.target.value)}
                />
              </label>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Extra columns (optional)">
          <p className="mb-2 text-xs text-muted-foreground">
            Add custom fields like a spreadsheet column (label + value).
          </p>
          {(p.customFields || []).map((c, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input
                className="w-1/3 rounded border px-2 py-1.5 text-sm"
                placeholder="Column name"
                value={c.key}
                onChange={(e) => setCustom(i, "key", e.target.value)}
              />
              <input
                className="flex-1 rounded border px-2 py-1.5 text-sm"
                placeholder="Value"
                value={c.value}
                onChange={(e) => setCustom(i, "value", e.target.value)}
              />
            </div>
          ))}
          <button type="button" onClick={addCustom} className="text-sm font-semibold text-navy underline">
            + Add column
          </button>
        </SectionCard>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || locked}
          onClick={() => save(false)}
          className="rounded-lg border border-navy/30 px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50"
        >
          Save draft
        </button>
        <button
          type="button"
          disabled={busy || locked}
          onClick={() => save(true)}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Submit to coordinator
        </button>
      </div>
    </div>
  );
}
