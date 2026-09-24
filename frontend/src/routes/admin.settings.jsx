import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";
import { resetStudentAccounts, clearCohortOnServer } from "@/lib/cohort-store";
import { useSession } from "@/lib/auth";

const CONFIG_FIELDS = [
  { key: "feedbackAttendanceGate", label: "Feedback attendance gate (%)", step: 1 },
  { key: "utPassMark", label: "UT pass mark (out of 20)", step: 1 },
  { key: "atRiskAttendance", label: "At-Risk attendance below (%)", step: 1 },
  { key: "atRiskAvgPct", label: "At-Risk average % below", step: 1 },
  { key: "atRiskFailRate", label: "At-Risk fail-rate at/above (0–1)", step: 0.05 },
  { key: "goodAttendance", label: "Good attendance at/above (%)", step: 1 },
  { key: "goodAvgPct", label: "Good average % at/above", step: 1 },
  { key: "goodFailRate", label: "Good fail-rate at/below (0–1)", step: 0.05 },
  { key: "tgBatchSize", label: "TG auto-distribute batch size", step: 1 },
];

export default function Page() {
  const { session } = useSession();
  const [settings, setSettings] = useState(null);
  const [portalCfg, setPortalCfg] = useState(null);
  const [msg, setMsg] = useState("");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [promo, setPromo] = useState({ fromYear: "FY", toYear: "SY", batch: "All", dryRun: true });
  const [promoMsg, setPromoMsg] = useState("");
  const [cohorts, setCohorts] = useState(null);

  useEffect(() => {
    api("/api/settings")
      .then((d) => setSettings(d.settings))
      .catch((e) => setMsg(e.message));
    api("/api/portal-config")
      .then((d) => setPortalCfg(d.config))
      .catch(() => {});
    api("/api/cohort/longitudinal")
      .then((d) => setCohorts(d))
      .catch(() => {});
  }, []);

  async function saveSettings(e) {
    e.preventDefault();
    try {
      const d = await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(d.settings);
      setMsg("Preferences saved.");
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    try {
      await api("/api/settings/password", { method: "POST", body: JSON.stringify(pw) });
      setPw({ currentPassword: "", newPassword: "" });
      setMsg("Password updated.");
    } catch (err) {
      setMsg(err.message);
    }
  }

  if (!settings) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy">Settings</h1>
        <p className="text-sm text-muted-foreground">{msg || "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">Settings</h1>
      {msg && <p className="text-sm text-navy">{msg}</p>}
      <SectionCard title="Account">
        <p className="text-sm text-muted-foreground">
          Signed in as <b>{session?.name}</b> ({session?.id})
        </p>
      </SectionCard>
      <SectionCard title="Notification preferences">
        <form onSubmit={saveSettings} className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!settings.emailNotifications}
              onChange={(e) => setSettings({ ...settings, emailNotifications: e.target.checked })}
            />
            Electronic mail notifications
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!settings.smsNotifications}
              onChange={(e) => setSettings({ ...settings, smsNotifications: e.target.checked })}
            />
            Text message notifications
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!settings.weeklyDigest}
              onChange={(e) => setSettings({ ...settings, weeklyDigest: e.target.checked })}
            />
            Weekly cohort digest
          </label>
          <button type="submit" className="rounded-md bg-gold px-4 py-2 font-semibold text-navy">
            Save preferences
          </button>
        </form>
      </SectionCard>
      <SectionCard title="Database maintenance">
        <p className="mb-3 text-sm text-muted-foreground">
          Clear uploaded academic marks from MongoDB, or remove all student login accounts for a clean
          slate (Head of Department and Teacher Guides are kept).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm"
            onClick={async () => {
              try {
                const r = await clearCohortOnServer();
                setMsg(`Cleared academic records: ${r.deleted}`);
              } catch (e) {
                setMsg(e.message);
              }
            }}
          >
            Clear academic cohort (marks)
          </button>
          <button
            type="button"
            className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
            onClick={async () => {
              if (!confirm("Delete all student accounts and academic records?")) return;
              try {
                const r = await resetStudentAccounts();
                setMsg(
                  `Removed ${r.deletedUsers} student accounts and ${r.deletedRecords} academic records.`
                );
              } catch (e) {
                setMsg(e.message);
              }
            }}
          >
            Reset all student accounts
          </button>
        </div>
      </SectionCard>
      <SectionCard title="Department thresholds (PortalConfig)">
        <p className="mb-3 text-sm text-muted-foreground">
          Feedback gate, UT pass mark, Current Academic Status cut-offs, and TG auto batch size. Stored in
          MongoDB and used by the portal and feedback API.
        </p>
        {portalCfg ? (
          <form
            className="grid max-w-lg gap-2 text-sm"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const body = {};
                for (const f of CONFIG_FIELDS) {
                  if (portalCfg[f.key] != null) body[f.key] = Number(portalCfg[f.key]);
                }
                body.tgAutoDistribute = !!portalCfg.tgAutoDistribute;
                const d = await api("/api/portal-config", {
                  method: "PUT",
                  body: JSON.stringify(body),
                });
                setPortalCfg(d.config);
                setMsg("Portal thresholds saved.");
              } catch (err) {
                setMsg(err.message);
              }
            }}
          >
            {CONFIG_FIELDS.map((f) => (
              <label key={f.key} className="grid gap-1">
                <span className="text-muted-foreground">{f.label}</span>
                <input
                  type="number"
                  step={f.step}
                  className="rounded border px-3 py-2"
                  value={portalCfg[f.key] ?? ""}
                  onChange={(e) =>
                    setPortalCfg({ ...portalCfg, [f.key]: e.target.value === "" ? "" : Number(e.target.value) })
                  }
                />
              </label>
            ))}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!portalCfg.tgAutoDistribute}
                onChange={(e) => setPortalCfg({ ...portalCfg, tgAutoDistribute: e.target.checked })}
              />
              Prefer auto-distribute when no explicit TG assignments
            </label>
            <button type="submit" className="mt-2 w-fit rounded-md bg-gold px-4 py-2 font-semibold text-navy">
              Save thresholds
            </button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Loading thresholds…</p>
        )}
      </SectionCard>
      <SectionCard title="Longitudinal cohorts (admission year → journey)">
        <p className="mb-3 text-sm text-muted-foreground">
          Each student keeps one PRN from First Year through Last Year. New admissions get new PRNs and a new
          admission year. Promote moves current stage only (FY→SY→TY→LY); history and cohort id stay on the same PRN.
        </p>
        {cohorts?.cohorts?.length ? (
          <div className="mb-4 overflow-x-auto text-xs">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Cohort</th>
                  <th className="p-2">Admission</th>
                  <th className="p-2">Total</th>
                  <th className="p-2">FY</th>
                  <th className="p-2">SY</th>
                  <th className="p-2">TY</th>
                  <th className="p-2">LY</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.cohorts.map((c) => (
                  <tr key={c.cohortId} className="border-b border-muted/60">
                    <td className="p-2 font-mono">{c.cohortId}</td>
                    <td className="p-2">{c.admissionYear ?? "—"}</td>
                    <td className="p-2">{c.total}</td>
                    <td className="p-2">{c.byYear?.FY ?? 0}</td>
                    <td className="p-2">{c.byYear?.SY ?? 0}</td>
                    <td className="p-2">{c.byYear?.TY ?? 0}</td>
                    <td className="p-2">{c.byYear?.LY ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">No cohort stats yet — upload academic data first.</p>
        )}
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="grid gap-1">
            From
            <select
              className="rounded border px-2 py-1"
              value={promo.fromYear}
              onChange={(e) =>
                setPromo({
                  ...promo,
                  fromYear: e.target.value,
                  toYear: { FY: "SY", SY: "TY", TY: "LY" }[e.target.value] || "SY",
                })
              }
            >
              {["FY", "SY", "TY"].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            To
            <input className="w-20 rounded border px-2 py-1" value={promo.toYear} readOnly />
          </label>
          <label className="grid gap-1">
            Batch
            <input
              className="w-24 rounded border px-2 py-1"
              value={promo.batch}
              onChange={(e) => setPromo({ ...promo, batch: e.target.value })}
              placeholder="All"
            />
          </label>
          <button
            type="button"
            className="rounded-md border border-navy/30 px-3 py-2 font-semibold text-navy"
            onClick={async () => {
              setPromoMsg("");
              try {
                const d = await api("/api/cohort/promote-year", {
                  method: "POST",
                  body: JSON.stringify({ ...promo, batch: promo.batch === "All" ? undefined : promo.batch, dryRun: true }),
                });
                setPromoMsg(`Dry run: ${d.count} student(s) would move ${d.from} → ${d.to}.`);
              } catch (e) {
                setPromoMsg(e.message);
              }
            }}
          >
            Preview
          </button>
          <button
            type="button"
            className="rounded-md bg-navy px-3 py-2 font-semibold text-white"
            onClick={async () => {
              if (!confirm(`Promote all ${promo.fromYear} → ${promo.toYear}? Same PRNs keep history.`)) return;
              setPromoMsg("");
              try {
                const d = await api("/api/cohort/promote-year", {
                  method: "POST",
                  body: JSON.stringify({
                    ...promo,
                    batch: promo.batch === "All" ? undefined : promo.batch,
                    dryRun: false,
                  }),
                });
                setPromoMsg(`Promoted ${d.updated} student(s) ${d.from} → ${d.to}.`);
                const c = await api("/api/cohort/longitudinal");
                setCohorts(c);
              } catch (e) {
                setPromoMsg(e.message);
              }
            }}
          >
            Promote now
          </button>
        </div>
        {promoMsg && <p className="mt-2 text-sm text-navy">{promoMsg}</p>}
      </SectionCard>
      <SectionCard title="Change password">
        <form onSubmit={changePassword} className="grid max-w-md gap-2 text-sm">
          <input
            type="password"
            required
            placeholder="Current password"
            className="rounded border px-3 py-2"
            value={pw.currentPassword}
            onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="New password (min 6 characters)"
            className="rounded border px-3 py-2"
            value={pw.newPassword}
            onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
          />
          <button type="submit" className="rounded-md bg-gold px-4 py-2 font-semibold text-navy">
            Update password
          </button>
        </form>
      </SectionCard>
    </div>
  );
}
