import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";
import { MessageSquare, Phone, CheckCircle2, AlertTriangle } from "lucide-react";

export default function AdminParentBot() {
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState("");
  const [testFrom, setTestFrom] = useState("");
  const [testBody, setTestBody] = useState("attendance");
  const [testOut, setTestOut] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/parent-bot/status")
      .then(setStatus)
      .catch((e) => setErr(e.message || "Failed to load parent bot status"));
  }, []);

  async function runSimulate() {
    setBusy(true);
    setTestOut(null);
    setErr("");
    try {
      const r = await api("/api/parent-bot/simulate", {
        method: "POST",
        body: JSON.stringify({ from: testFrom, body: testBody }),
      });
      setTestOut(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const waReady = status?.twilio?.whatsappReady;
  const smsReady = status?.twilio?.smsReady;
  const live = status?.mode === "live";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy">Parent bot</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Parents message the college WhatsApp or SMS number. The bot finds the student by the
          registered parent mobile (Contact details) and replies with live attendance or marks from
          academic data.
        </p>
      </div>

      {err && (
        <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>
      )}

      <SectionCard title="Production status">
        {!status ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                  live ? "bg-success/15 text-success" : "bg-amber-100 text-amber-900"
                }`}
              >
                {live ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                Mode: {live ? "LIVE (MESSAGE_DRY_RUN off)" : "Dry-run (no real Twilio send on outbound)"}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  waReady ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                }`}
              >
                WhatsApp: {waReady ? "configured" : "not configured"}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  smsReady ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                }`}
              >
                SMS: {smsReady ? "configured" : "not configured"}
              </span>
            </div>
            <p>
              Parent numbers saved: <strong>{status.parentsWithPhone ?? 0}</strong>
            </p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                WhatsApp webhook: <code className="text-navy">{status.webhooks?.whatsapp}</code>
              </li>
              <li>
                SMS webhook: <code className="text-navy">{status.webhooks?.sms}</code>
              </li>
              <li>
                Keywords: {(status.keywords || []).join(", ")} (English + Hindi)
              </li>
              {status.twilio?.whatsappFrom && (
                <li>
                  Twilio WhatsApp from: <code>{status.twilio.whatsappFrom}</code>
                </li>
              )}
            </ul>
            <p className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-navy/90">
              {status.note}
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="How parents use it">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-navy/90">
          <li>System Admin saves parent mobile under Contact details (linked to Permanent Registration Number).</li>
          <li>Academic data is uploaded so attendance and marks exist for that PRN.</li>
          <li>
            Parent sends WhatsApp/SMS to the <strong>college Twilio number</strong> (not a teacher personal phone).
          </li>
          <li>
            Parent types <code>attendance</code>, <code>marks</code>, or <code>help</code> (or Hindi equivalents).
          </li>
          <li>Bot replies with that student’s live data from MongoDB.</li>
        </ol>
      </SectionCard>

      <SectionCard title="Verify lookup (same logic as production)">
        <p className="mb-3 text-xs text-muted-foreground">
          Uses the production handler. Does not require Twilio. Enter the parent mobile stored in Contact details.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1 text-xs font-medium">
            Parent mobile
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={testFrom}
              onChange={(e) => setTestFrom(e.target.value)}
              placeholder="9004160697"
            />
          </label>
          <label className="block w-full sm:w-40 text-xs font-medium">
            Message
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={testBody}
              onChange={(e) => setTestBody(e.target.value)}
            >
              <option value="attendance">attendance</option>
              <option value="marks">marks</option>
              <option value="help">help</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !testFrom.trim()}
            onClick={runSimulate}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <MessageSquare className="h-4 w-4" />
            {busy ? "Running…" : "Run"}
          </button>
        </div>
        {testOut && (
          <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border bg-white p-4 text-xs text-navy">
            {JSON.stringify(testOut, null, 2)}
          </pre>
        )}
      </SectionCard>

      <SectionCard title="Twilio console checklist">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Messaging → WhatsApp / Phone number → “A message comes in” → Webhook POST</li>
          <li>
            URL must be public HTTPS, e.g. <code>https://your-domain/api/parent-bot/whatsapp</code>
          </li>
          <li>
            Backend <code>.env</code>: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM,
            MESSAGE_DRY_RUN=0
          </li>
          <li>Localhost alone cannot receive Twilio webhooks — deploy or use a tunnel for go-live.</li>
        </ul>
        <p className="mt-3 flex items-center gap-2 text-xs text-navy">
          <Phone className="h-3.5 w-3.5" />
          College bot number = Twilio number in .env, not a staff personal SIM.
        </p>
      </SectionCard>

      <SectionCard title="Push demo to parent app">
        <p className="mb-3 text-xs text-muted-foreground">
          Creates a notice and sends Expo push to all parent devices that opened the mobile app and allowed notifications.
        </p>
        <button
          type="button"
          className="rounded-xl bg-navy px-4 py-2 text-sm font-semibold text-white"
          onClick={async () => {
            setErr("");
            try {
              const r = await api("/api/parent/demo-notify", {
                method: "POST",
                body: JSON.stringify({
                  title: "BVU Parent demo notice",
                  body: "Please open the Parent app for the latest attendance and marks.",
                }),
              });
              setTestOut(r);
            } catch (e) {
              setErr(e.message);
            }
          }}
        >
          Send demo notice + push
        </button>
      </SectionCard>

    </div>
  );
}
