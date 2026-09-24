import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { setSession } from "@/lib/auth";
import { Logo } from "@/components/portal/Logo";

const API = import.meta.env.VITE_API_URL || "";

export default function LoginParent() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("parent123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/parent/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Login failed");
      setSession(data.session, data.token);
      navigate("/parent");
    } catch (ex) {
      setErr(ex.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-secondary/40 to-background px-4 py-10">
      <Logo className="mb-6" />
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 shadow-lg"
      >
        <div>
          <h1 className="text-xl font-bold text-navy">Parent login</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the mobile number registered by the college. Default password:{" "}
            <code className="text-navy">parent123</code>
          </p>
        </div>
        {err && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        <label className="block text-sm font-medium">
          Parent mobile
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2.5"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="10-digit mobile"
            inputMode="tel"
            autoComplete="tel"
            required
          />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input
            type="password"
            className="mt-1 w-full rounded-xl border px-3 py-2.5"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-navy py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-xs text-muted-foreground">
          <Link to="/" className="text-navy underline">
            Back to home
          </Link>
        </p>
      </form>
    </div>
  );
}
