import { useEffect, useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { api } from "@/lib/api";
import { parseContactMasterFromFile } from "@/lib/contact-master-parse";
import { Upload } from "lucide-react";

const EMPTY = {
  prn: "",
  firstName: "",
  middleName: "",
  lastName: "",
  name: "",
  studentMobile: "",
  parentMobile: "",
  parentWhatsapp: "",
  studentEmail: "",
  tenthPercent: "",
  twelfthPercent: "",
  cetScore: "",
  jeeScore: "",
  yearLevel: "",
  batch: "",
};

export default function SysadminContacts() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  async function load() {
    const r = await api("/api/admin-master/students");
    setRows(r.students || []);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  function setF(k, v) {
    setForm((prev) => {
      const next = { ...prev, [k]: v };
      if (k === "parentMobile" && (!prev.parentWhatsapp || prev.parentWhatsapp === prev.parentMobile)) {
        next.parentWhatsapp = v;
      }
      if (k === "firstName" || k === "middleName" || k === "lastName") {
        next.name = [next.firstName, next.middleName, next.lastName].filter(Boolean).join(" ");
      }
      return next;
    });
  }

  async function saveOne(e) {
    e?.preventDefault();
    setMsg("");
    if (!form.prn.trim()) {
      setMsg("PRN is required.");
      return;
    }
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setMsg("First name and last name are required for mail templates (middle name optional).");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/admin-master/students/${encodeURIComponent(form.prn.trim())}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setMsg(`Saved ${form.prn}.`);
      setForm({ ...EMPTY });
      await load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  function editRow(s) {
    setForm({
      prn: s.prn || "",
      firstName: s.firstName || "",
      middleName: s.middleName || "",
      lastName: s.lastName || "",
      name: s.name || "",
      studentMobile: s.studentMobile || "",
      parentMobile: s.parentMobile || "",
      parentWhatsapp: s.parentWhatsapp || s.parentMobile || "",
      studentEmail: s.studentEmail || "",
      tenthPercent: s.tenthPercent ?? "",
      twelfthPercent: s.twelfthPercent ?? "",
      cetScore: s.cetScore ?? "",
      jeeScore: s.jeeScore ?? "",
      yearLevel: s.yearLevel || "",
      batch: s.batch || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onFile(e) {
    const list = [...(e.target.files || [])];
    e.target.value = "";
    if (!list.length) return;
    setBusy(true);
    setMsg("");
    try {
      let upserted = 0;
      let skipped = 0;
      let filesOk = 0;
      const ignored = [];
      for (const file of list) {
        const { students, meta } = await parseContactMasterFromFile(file);
        if (!students.length) {
          skipped += 1;
          continue;
        }
        const r = await api("/api/admin-master/roster", {
          method: "POST",
          body: JSON.stringify({ students }),
        });
        upserted += Number(r.upserted) || 0;
        skipped += Number(r.skipped) || 0;
        filesOk += 1;
        for (const h of meta?.ignoredColumnsSample || []) {
          if (h && !ignored.includes(h)) ignored.push(h);
        }
      }
      if (!filesOk) {
        setMsg("No PRN rows detected in the selected file(s). Check headers (PRN, phones, email…).");
      } else {
        setMsg(
          `Imported from ${filesOk} file(s): ${upserted} saved (skipped ${skipped}). Sample ignored headers: ${ignored.slice(0, 8).join(", ") || "—"}`
        );
      }
      await load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const shown = rows.filter((s) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      String(s.prn).toLowerCase().includes(q) ||
      String(s.name || "").toLowerCase().includes(q) ||
      String(s.studentEmail || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-navy">Contact details</h1>
        <p className="text-sm text-muted-foreground">Parent mobile, student mobile, email and WhatsApp for messaging. Include Permanent Registration Number in this file (or upload academic data first so the PRN exists).</p>
      </div>
      {msg && <p className="rounded border bg-muted/40 px-3 py-2 text-sm text-navy/90">{msg}</p>}

      <SectionCard title="Excel import (flexible headers)">
        <p className="mb-2 text-xs text-muted-foreground">
          Accepts any sheet with PRN + name (or first/last). Maps parent mobile, student mobile, email, WhatsApp,
          10th, 12th, CET, JEE when present — ignores marks/attendance and other columns.
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white">
          <Upload className="h-4 w-4" />
          Upload file(s)
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" multiple onChange={onFile} disabled={busy} />
        </label>
      </SectionCard>

      <SectionCard title="Manual entry / edit">
        <form onSubmit={saveOne} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["prn", "PRN *"],
            ["firstName", "First name *"],
            ["middleName", "Middle name"],
            ["lastName", "Last name *"],
            ["studentMobile", "Student mobile"],
            ["parentMobile", "Parent mobile"],
            ["parentWhatsapp", "Parent WhatsApp"],
            ["studentEmail", "Student email"],
            ["yearLevel", "Year (FY/SY/TY/LY)"],
            ["batch", "Batch"],
            ["tenthPercent", "10th %"],
            ["twelfthPercent", "12th %"],
            ["cetScore", "CET"],
            ["jeeScore", "JEE"],
          ].map(([k, lab]) => (
            <label key={k} className="text-sm">
              <span className="text-xs font-semibold text-muted-foreground">{lab}</span>
              <input
                className="mt-1 w-full rounded border px-2 py-1.5"
                value={form[k] ?? ""}
                onChange={(e) => setF(k, e.target.value)}
              />
            </label>
          ))}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Commit save
            </button>
            <button
              type="button"
              className="rounded-lg border px-4 py-2 text-sm font-semibold text-navy"
              onClick={() => setForm({ ...EMPTY })}
            >
              Clear
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title={`Master list (${shown.length})`}>
        <input
          className="mb-3 w-full max-w-md rounded border px-3 py-1.5 text-sm"
          placeholder="Filter PRN / name / email"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="max-h-[50vh] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2">PRN</th>
                <th>Name</th>
                <th>Student mobile</th>
                <th>Parent mobile</th>
                <th>WhatsApp</th>
                <th>Email</th>
                <th>10th</th>
                <th>12th</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.prn} className="border-b">
                  <td className="py-1 font-mono">{s.prn}</td>
                  <td>{s.name}</td>
                  <td>{s.studentMobile || "—"}</td>
                  <td>{s.parentMobile || "—"}</td>
                  <td>{s.parentWhatsapp || "—"}</td>
                  <td className="max-w-[8rem] truncate">{s.studentEmail || "—"}</td>
                  <td>{s.tenthPercent ?? "—"}</td>
                  <td>{s.twelfthPercent ?? "—"}</td>
                  <td>
                    <button type="button" className="text-navy underline" onClick={() => editRow(s)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
