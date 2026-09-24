import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth";

export default function Page() {
  const { session } = useSession();
  const [settings, setSettings] = useState(null);
  const [msg, setMsg] = useState("");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });

  useEffect(() => {
    api("/api/settings")
      .then((d) => setSettings(d.settings))
      .catch((e) => setMsg(e.message));
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
      setMsg("Password updated. Use the new password next time you sign in.");
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">Settings</h1>
      {msg && <p className="text-sm text-navy">{msg}</p>}
      <SectionCard title="Account">
        <p className="text-sm">
          Permanent Registration Number: <b>{session?.id}</b>
        </p>
      </SectionCard>
      {settings && (
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
                checked={!!settings.weeklyDigest}
                onChange={(e) => setSettings({ ...settings, weeklyDigest: e.target.checked })}
              />
              Weekly academic digest
            </label>
            <button type="submit" className="rounded-md bg-gold px-4 py-2 font-semibold text-navy">
              Save preferences
            </button>
          </form>
        </SectionCard>
      )}
      <SectionCard title="Change password">
        <form onSubmit={changePassword} className="grid max-w-md gap-2 text-sm">
          <input
            type="password"
            required
            placeholder="Current password (default abc@123 until changed)"
            className="rounded border px-3 py-2"
            value={pw.currentPassword}
            onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="New password"
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
