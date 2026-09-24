import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { buildParentMessage, MESSAGE_MODE_LABELS } from "@/lib/parent-message-templates";
import { authHeaders } from "@/lib/auth";
import { Mail, MessageSquare, Phone, Loader2 } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "";

const CHANNELS = [
  { id: "email", label: "Electronic mail", icon: Mail, hint: "Electronic mail (Brevo today; provider can be changed later)" },
  { id: "sms", label: "Text message", icon: Phone, hint: "Text message via Twilio" },
  { id: "whatsapp", label: "WhatsApp", icon: MessageSquare, hint: "WhatsApp message via Twilio" },
];

/**
 * mode: "full" | "attendance" | "marks"
 */
export function MessageParentModal({ open, onOpenChange, student, mode = "full" }) {
  const [channel, setChannel] = useState("email");
  const [toEmail, setToEmail] = useState("");
  const [toPhone, setToPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [providerStatus, setProviderStatus] = useState(null);

  useEffect(() => {
    if (!open || !student) return;
    const tpl = buildParentMessage(student, mode);
    setSubject(tpl.subject);
    setBody(tpl.body);
    setToEmail(student.email || student.parentEmail || "");
    setToPhone(student.phone || student.parentPhone || "");
    setResult(null);
  }, [open, student, mode]);

  useEffect(() => {
    if (!open) return;
    fetch(`${API_BASE}/api/messages/status`)
      .then((r) => r.json())
      .then(setProviderStatus)
      .catch(() => setProviderStatus(null));
  }, [open]);

  const needsEmail = channel === "email";
  const needsPhone = channel === "sms" || channel === "whatsapp";

  async function handleSend() {
    const to = needsEmail ? toEmail.trim() : toPhone.trim();
    if (!to) {
      setResult({
        ok: false,
        error: needsEmail ? "Parent email is required." : "Parent phone (with country code) is required.",
      });
      return;
    }
    if (!body.trim()) {
      setResult({ ok: false, error: "Message body is required." });
      return;
    }
    if (needsEmail && !subject.trim()) {
      setResult({ ok: false, error: "Subject is required for email." });
      return;
    }

    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          channel,
          to,
          subject: subject.trim(),
          text: body,
          studentPrn: student?.prn,
          studentName: student?.name,
          mode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({
          ok: false,
          error: data.error || data.detail || `Send failed (${res.status})`,
        });
      } else {
        setResult({
          ok: true,
          messageId: data.messageId,
          channel: data.channel || channel,
          provider: data.provider,
        });
      }
    } catch (e) {
      setResult({ ok: false, error: String(e.message || e) });
    } finally {
      setSending(false);
    }
  }

  function resetTemplate() {
    if (!student) return;
    const tpl = buildParentMessage(student, mode);
    setSubject(tpl.subject);
    setBody(tpl.body);
    setResult(null);
  }

  const channelReady =
    channel === "email"
      ? providerStatus?.email?.configured
      : channel === "sms"
        ? providerStatus?.sms?.configured
        : providerStatus?.whatsapp?.configured;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-navy">
            <Mail className="h-5 w-5" />
            Message parent
          </DialogTitle>
          <DialogDescription>
            {MESSAGE_MODE_LABELS[mode] || mode}
            {student?.name ? ` — ${student.name}` : ""}
            {student?.prn ? ` (${student.prn})` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {/* Channel picker */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-navy">Send via</label>
            <div className="grid grid-cols-3 gap-2">
              {CHANNELS.map((c) => {
                const Icon = c.icon;
                const active = channel === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setChannel(c.id);
                      setResult(null);
                    }}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors ${
                      active
                        ? "border-gold bg-gold-soft text-navy"
                        : "border-border bg-background text-navy/80 hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {c.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {CHANNELS.find((c) => c.id === channel)?.hint}
              {providerStatus && (
                <>
                  {" · "}
                  {channelReady ? (
                    <span className="text-success">provider ready</span>
                  ) : (
                    <span className="text-warning">not configured on server</span>
                  )}
                </>
              )}
            </p>
          </div>

          {needsEmail ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-navy">Parent / guardian email</label>
              <input
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="parent@example.com"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
              />
              {!student?.email && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  No email on record — type it, or upload Excel with an Email column.
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-navy">
                Parent phone (E.164, e.g. +9198XXXXXXXX)
              </label>
              <input
                type="tel"
                value={toPhone}
                onChange={(e) => setToPhone(e.target.value)}
                placeholder="+91XXXXXXXXXX"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
              />
              {!student?.phone && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  No phone on record — enter with country code, or upload Excel with a Phone column.
                </p>
              )}
            </div>
          )}

          {needsEmail && (
            <div>
              <label className="mb-1 block text-xs font-medium text-navy">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
              />
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-navy">
                {needsEmail ? "Letter (editable)" : "Message (editable — keep shorter for text message)"}
              </label>
              <button
                type="button"
                onClick={resetTemplate}
                className="text-[11px] text-navy underline hover:text-gold"
              >
                Reset to template
              </button>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={needsEmail ? 14 : 8}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
            />
            {!needsEmail && (
              <p className="mt-1 text-[11px] text-muted-foreground">{body.length} characters</p>
            )}
          </div>

          {result && (
            <div
              className={`rounded-md px-3 py-2 text-xs ${
                result.ok ? "bg-success/15 text-success" : "bg-danger/10 text-danger"
              }`}
            >
              {result.ok
                ? `Sent via ${result.channel || channel}${
                    result.provider ? ` (${result.provider})` : ""
                  }${result.messageId ? ` · id ${result.messageId}` : ""}.`
                : result.error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border px-4 py-2 text-sm text-navy hover:bg-muted"
          >
            Close
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={handleSend}
            className="inline-flex items-center gap-2 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-soft disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {sending
              ? "Sending…"
              : channel === "email"
                ? "Send electronic mail"
                : channel === "sms"
                  ? "Send text message"
                  : "Send WhatsApp"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MessageParentButton({ student, mode = "full", className = "" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title={`Message parent (${MESSAGE_MODE_LABELS[mode] || mode})`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex items-center gap-1 rounded-md border border-gold/50 bg-gold-soft/40 px-2 py-1 text-xs font-medium text-navy hover:bg-gold-soft ${className}`}
      >
        <Mail className="h-3.5 w-3.5" />
        Message
      </button>
      <MessageParentModal open={open} onOpenChange={setOpen} student={student} mode={mode} />
    </>
  );
}
