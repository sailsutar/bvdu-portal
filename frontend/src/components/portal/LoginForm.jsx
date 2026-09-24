import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { Logo } from "./Logo";
import { login, loginAsync, DEMO_CREDS, TEACHER_GUIDE_ACCOUNTS } from "@/lib/auth";
import { hydrateIntelligence } from "@/lib/academic-intelligence";
import { fetchCohortFromServer } from "@/lib/cohort-store";
import { tgBatchLabel } from "@/lib/tg-assign";

function LoginForm({ title, subtitle, idLabel, idPlaceholder, redirectTo, role }) {
  const [show, setShow] = useState(false);
  const showDemo = !import.meta.env.PROD;
  const defaultId = showDemo ? (role === "tg" ? "TG001" : DEMO_CREDS[role]?.id || "") : "";
  const defaultPw = showDemo
    ? DEMO_CREDS[role]?.password || (role === "tg" ? DEMO_CREDS.tg?.password : "") || ""
    : "";
  const [id, setId] = useState(defaultId);
  const [password, setPassword] = useState(defaultPw);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="bvu-login-stage relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-10">
      {/* Campus cinematic background */}
      <video
        className="bvu-login-video"
        autoPlay
        muted
        loop
        playsInline
        poster=""
        aria-hidden="true"
      >
        <source src="/media/campus-bg.mp4" type="video/mp4" />
      </video>
      <div className="bvu-login-video-veil" aria-hidden="true" />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-6">
        <div className="text-center text-white drop-shadow-lg">
          <Logo variant="light" />
          <p className="mt-3 text-sm text-gold/95">
            Reimagining education for everyone
          </p>
        </div>

        {/* Glass card */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setSubmitting(true);
            try {
              let result = await loginAsync(role, id, password);
              if (!result) {
                const session = login(role, id, password);
                if (!session) {
                  setError("Invalid credentials. Check your identifier and password.");
                  return;
                }
              }
              try {
                await hydrateIntelligence();
                await fetchCohortFromServer();
              } catch (_) {}
              navigate(redirectTo);
            } finally {
              setSubmitting(false);
            }
          }}
          className="bvu-glass-card w-full max-w-md p-6 sm:p-8"
        >
          <h2
            className="font-serif text-2xl text-navy sm:text-3xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

          <div className="mt-8 space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy">{idLabel}</label>
              <input
                className="bvu-input w-full rounded-xl border border-white/40 bg-white/70 px-3 py-2.5 text-navy shadow-sm outline-none backdrop-blur-sm focus:border-gold focus:ring-2 focus:ring-gold/30"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder={idPlaceholder}
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy">Password</label>
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  className="bvu-input w-full rounded-xl border border-white/40 bg-white/70 px-3 py-2.5 pr-10 text-navy shadow-sm outline-none backdrop-blur-sm focus:border-gold focus:ring-2 focus:ring-gold/30"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-navy"
                  aria-label="Toggle password"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="bvu-btn bvu-btn-primary min-h-11 w-full rounded-xl bg-gold py-3 font-semibold text-navy shadow-sm transition-colors hover:bg-gold-soft disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <span className="bvu-inline-spinner" />
                  Signing in…
                </>
              ) : (
                "Login"
              )}
            </button>

            {showDemo && (DEMO_CREDS[role]?.password || role === "tg") && (
              <div className="rounded-md border border-dashed border-gold/50 bg-white/40 p-3 text-xs text-navy/80 backdrop-blur-sm">
                <p className="font-semibold text-navy">Demo credentials (development only)</p>
                {role === "tg" ? (
                  <div className="mt-1 space-y-1">
                    <p>
                      <span className="font-medium">Password (all Teacher Guide accounts):</span>{" "}
                      {DEMO_CREDS.tg?.password || "(see seed)"}
                    </p>
                    <ul className="list-inside list-disc">
                      {Object.entries(TEACHER_GUIDE_ACCOUNTS).map(([tid, acc]) => (
                        <li key={tid}>
                          {tid} — {acc.name}: {tgBatchLabel(acc.tgIndex)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-1">
                    <span className="font-medium">{idLabel}:</span> {DEMO_CREDS[role]?.id || "—"}
                    <br />
                    <span className="font-medium">Password:</span> {DEMO_CREDS[role]?.password || "—"}
                  </p>
                )}
              </div>
            )}

            <div className="text-center">
              <Link to="/" className="text-xs text-navy/70 hover:text-navy">
                ← Back to role selection
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export { LoginForm };
