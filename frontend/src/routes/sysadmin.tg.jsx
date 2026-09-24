import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";

export default function SysadminTg() {
  const [profiles, setProfiles] = useState([]);
  const [draft, setDraft] = useState({}); // id -> { name, password, isActive }
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");

  async function load() {
    const r = await api("/api/tg-profiles");
    const list = r.profiles || [];
    setProfiles(list);
    const d = {};
    for (const p of list) {
      d[p.id] = { name: p.name || "", password: "", isActive: p.isActive !== false };
    }
    setDraft(d);
    setDirty(false);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  const suggestedId = useMemo(() => {
    const nums = profiles
      .map((p) => parseInt(String(p.id).replace(/\D/g, ""), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `TG${String(next).padStart(3, "0")}`;
  }, [profiles]);

  function setDraftField(id, key, value) {
    setDraft((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || { name: "", password: "", isActive: true }), [key]: value },
    }));
    setDirty(true);
  }

  async function commitAll() {
    setMsg("");
    setBusy(true);
    try {
      const payload = profiles.map((p) => ({
        id: p.id,
        name: draft[p.id]?.name ?? p.name,
        password: draft[p.id]?.password || undefined,
        isActive: draft[p.id]?.isActive,
        index: p.index,
      }));
      const r = await api("/api/tg-profiles", {
        method: "PUT",
        body: JSON.stringify({ profiles: payload }),
      });
      setMsg(`Committed ${r.updated} Teacher Guide change(s). Passwords only update when a new password was typed.`);
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addTg() {
    setMsg("");
    setBusy(true);
    try {
      const body = {
        id: (newId || suggestedId).trim().toUpperCase(),
        name: newName.trim(),
        password: newPassword,
      };
      if (!body.name) throw new Error("Display name is required.");
      if (!body.password || body.password.length < 4) throw new Error("Password must be at least 4 characters.");
      const r = await api("/api/tg-profiles", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMsg(`Created Teacher Guide ${r.loginId}. They can log in with that ID and the password you set.`);
      setNewId("");
      setNewName("");
      setNewPassword("");
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">Teacher Guides</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create accounts, set display names and passwords, then <strong>Commit changes</strong>. Login ID is the
            username used on the Teacher Guide login page.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !profiles.length}
          onClick={commitAll}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : dirty ? "Commit changes *" : "Commit changes"}
        </button>
      </div>
      {msg && (
        <p className="rounded-lg border border-navy/10 bg-muted/40 px-3 py-2 text-sm text-navy/90">{msg}</p>
      )}

      <SectionCard title="Add new Teacher Guide">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="text-xs font-semibold text-muted-foreground">Username (login ID)</span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
              placeholder={suggestedId}
              value={newId}
              onChange={(e) => setNewId(e.target.value.toUpperCase())}
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">Suggested: {suggestedId}</span>
          </label>
          <label className="block text-sm">
            <span className="text-xs font-semibold text-muted-foreground">Display name</span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="e.g. Prof. Sharma"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-semibold text-muted-foreground">Password</span>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Set login password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={busy}
              onClick={addTg}
              className="w-full rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Add Teacher Guide
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={`Existing Teacher Guides (${profiles.length})`}>
        <p className="mb-3 text-xs text-muted-foreground">
          Leave password blank to keep the current password. Type a new password only when you want to reset it, then
          Commit changes.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 pr-2">Username</th>
                <th className="py-2 pr-2">Display name</th>
                <th className="py-2 pr-2">New password (optional)</th>
                <th className="py-2 pr-2">Index</th>
                <th className="py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-2 pr-2 font-mono text-xs font-semibold">{p.id}</td>
                  <td className="py-2 pr-2">
                    <input
                      className="w-full min-w-[10rem] rounded border px-2 py-1.5"
                      value={draft[p.id]?.name ?? ""}
                      onChange={(e) => setDraftField(p.id, "name", e.target.value)}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      className="w-full min-w-[8rem] rounded border px-2 py-1.5"
                      placeholder="Unchanged"
                      value={draft[p.id]?.password ?? ""}
                      onChange={(e) => setDraftField(p.id, "password", e.target.value)}
                      autoComplete="new-password"
                    />
                  </td>
                  <td className="py-2 pr-2 tabular-nums text-muted-foreground">{p.index}</td>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={draft[p.id]?.isActive !== false}
                      onChange={(e) => setDraftField(p.id, "isActive", e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
              {!profiles.length && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No Teacher Guides yet. Add one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          disabled={busy || !profiles.length}
          onClick={commitAll}
          className="mt-4 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Commit changes"}
        </button>
      </SectionCard>
    </div>
  );
}
