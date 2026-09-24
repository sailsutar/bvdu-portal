import { useState } from "react";
import { SectionCard } from "@/components/portal/PortalShell";
import { useDerived } from "@/lib/upload-stats";
import { currentStatusOf } from "@/lib/ml-predict";
import { learnerBand } from "@/lib/tg-assign";
import { api, downloadTextFile, toCsv } from "@/lib/api";
import { cohortCOSummary } from "@/lib/academic-intelligence";
import YearBatchFilter from "@/components/portal/YearBatchFilter";
import { useYearBatchStudents } from "@/lib/use-year-batch";
import * as XLSX from "xlsx";

function downloadWorkbook(filename, sheetName, rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

function downloadPdf(title, headers, rows) {
  const escape = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const head = headers.map((h) => `<th style="border:1px solid #ccc;padding:6px;text-align:left">${escape(h)}</th>`).join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${headers
          .map((h) => `<td style="border:1px solid #ccc;padding:6px">${escape(r[h])}</td>`)
          .join("")}</tr>`
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><title>${escape(title)}</title>
    <style>body{font-family:system-ui,sans-serif;padding:24px} h1{font-size:18px} table{border-collapse:collapse;width:100%;font-size:12px}</style>
    </head><body>
    <h1>${escape(title)}</h1>
    <p>Generated ${new Date().toLocaleString()}</p>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <script>window.onload=function(){window.print()}</script>
    </body></html>`;
  const w = window.open("", "_blank");
  if (!w) {
    alert("Allow pop-ups to download / print PDF.");
    return;
  }
  w.document.write(html);
  w.document.close();
}

function emit(format, baseName, columns, dataRows) {
  const stamp = Date.now();
  if (format === "xlsx") {
    const rows = dataRows.map((r) => {
      const o = {};
      for (const c of columns) o[c.label] = r[c.key];
      return o;
    });
    downloadWorkbook(`${baseName}-${stamp}.xlsx`, baseName.slice(0, 31), rows);
    return;
  }
  if (format === "pdf") {
    const headers = columns.map((c) => c.label);
    const rows = dataRows.map((r) => {
      const o = {};
      for (const c of columns) o[c.label] = r[c.key] ?? "";
      return o;
    });
    downloadPdf(baseName.replace(/-/g, " "), headers, rows);
    return;
  }
  // csv default
  const csv = toCsv(dataRows, columns);
  downloadTextFile(`${baseName}-${stamp}.csv`, csv, "text/csv");
}

export default function Page() {
  const { students: allStudents } = useDerived();
  const { students, year, batch, filterProps } = useYearBatchStudents(allStudents);
  const [format, setFormat] = useState("xlsx");
  const [msg, setMsg] = useState("");

  function attendanceReport() {
    emit(
      format,
      "attendance-report",
      [
        { key: "prn", label: "Permanent Registration Number" },
        { key: "name", label: "Name" },
        { key: "cls", label: "Class" },
        { key: "attendance", label: "Attendance percent" },
      ],
      students.map((s) => ({
        prn: s.prn,
        name: s.name,
        cls: s.cls || s.className || "",
        attendance: s.attendance ?? "",
      }))
    );
  }

  function performanceReport() {
    const rows = students.map((s) => ({
      prn: s.prn,
      name: s.name,
      status: currentStatusOf(s),
      band: learnerBand(s),
      averagePercentage: s.averagePercentage ?? "",
      attendance: s.attendance ?? "",
    }));
    emit(
      format,
      "performance-report",
      [
        { key: "prn", label: "Permanent Registration Number" },
        { key: "name", label: "Name" },
        { key: "status", label: "Academic status" },
        { key: "band", label: "Learner band" },
        { key: "averagePercentage", label: "Average percentage" },
        { key: "attendance", label: "Attendance percent" },
      ],
      rows
    );
  }

  function outcomeReport() {
    const cos = cohortCOSummary(students);
    emit(
      format,
      "course-outcome-report",
      [
        { key: "label", label: "Course Outcome" },
        { key: "title", label: "Title" },
        { key: "meanPredicted", label: "Mean predicted percent" },
        { key: "targetPct", label: "Target percent" },
        { key: "pctStudentsBelow", label: "Percent students below target" },
      ],
      cos
    );
  }

  function defaulterReport() {
    const rows = students
      .filter((s) => s.attendance != null && Number(s.attendance) < 75)
      .map((s) => ({
        prn: s.prn,
        name: s.name,
        cls: s.cls || s.className,
        attendance: s.attendance,
      }))
      .sort((a, b) => Number(a.attendance) - Number(b.attendance));
    emit(
      format,
      "defaulter-list",
      [
        { key: "prn", label: "PRN" },
        { key: "name", label: "Student Name" },
        { key: "cls", label: "Class" },
        { key: "attendance", label: "Attendance %" },
      ],
      rows
    );
  }

  async function feedbackReport() {
    setMsg("");
    try {
      const q = new URLSearchParams({ limit: "500" });
      if (year && year !== "All") q.set("yearLevel", year);
      if (batch && batch !== "All") q.set("batch", batch);
      const data = await api(`/api/feedback?${q}`);
      const items = data.items || data.feedback || [];
      const rows = items.map((f) => ({
        studentId: f.studentId || f.prn || "",
        studentName: f.studentName || "",
        course: f.course || "",
        sentiment: f.sentiment || "",
        text: f.text || "",
        className: f.className || f.displayGroup || "",
        yearLevel: f.yearLevel || "",
        batch: f.batch || "",
        createdAt: f.createdAt || "",
      }));
      emit(
        format,
        "feedback-report",
        [
          { key: "studentId", label: "PRN" },
          { key: "studentName", label: "Student name" },
          { key: "course", label: "Course" },
          { key: "sentiment", label: "Sentiment" },
          { key: "text", label: "Feedback text" },
          { key: "className", label: "Class" },
          { key: "yearLevel", label: "Year" },
          { key: "batch", label: "Batch" },
          { key: "createdAt", label: "Submitted at" },
        ],
        rows
      );
      setMsg(`Feedback report: ${rows.length} row(s) for year=${year || "All"} batch=${batch || "All"}.`);
    } catch (e) {
      setMsg(e.message || "Could not load feedback for report.");
    }
  }

  const cards = [
    {
      title: "Attendance Report",
      desc: "PRN, name, class, attendance % for the selected year/batch.",
      onClick: attendanceReport,
    },
    {
      title: "Performance Report",
      desc: "Academic status, learner band, average %, attendance.",
      onClick: performanceReport,
    },
    {
      title: "Course Outcome Report",
      desc: "Predicted course-outcome attainment summary.",
      onClick: outcomeReport,
    },
    {
      title: "Defaulter List",
      desc: "Students with attendance below 75% in the current filter.",
      onClick: defaulterReport,
    },
    {
      title: "Feedback Report",
      desc: "Student feedback text, sentiment, class and year for the selected filter.",
      onClick: feedbackReport,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Downloads use the selected year/batch ({students.length} students in academic filter). Format applies to
            every report below.
          </p>
        </div>
        <YearBatchFilter {...filterProps} />
      </div>

      <SectionCard title="Download format">
        <div className="flex flex-wrap gap-2">
          {[
            { id: "xlsx", label: "Excel (.xlsx)" },
            { id: "csv", label: "CSV (spreadsheet)" },
            { id: "pdf", label: "PDF (print dialog)" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormat(f.id)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                format === f.id ? "bg-navy text-white" : "bg-muted text-navy"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Active format: <b>{format.toUpperCase()}</b>. PDF opens a print window — choose “Save as PDF” in the browser.
        </p>
      </SectionCard>

      {msg && <p className="text-sm text-navy/90">{msg}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((r) => (
          <SectionCard key={r.title} title={r.title}>
            <p className="text-sm text-muted-foreground">{r.desc}</p>
            <button
              type="button"
              onClick={r.onClick}
              className="mt-3 rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-navy hover:bg-gold-soft"
            >
              Download {format === "xlsx" ? "Excel" : format === "pdf" ? "PDF" : "CSV"}
            </button>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
