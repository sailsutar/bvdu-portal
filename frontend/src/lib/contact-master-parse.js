import * as XLSX from "xlsx";

function normHeader(h) {
  return String(h || "")
    .toLowerCase()
    .replace(/[%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fuzzy map a header to a known master field */
export function mapContactHeader(header) {
  const h = normHeader(header);
  if (!h) return null;
  if (/^(prn|permanent registration|registration no|reg no|roll)\b/.test(h) || h === "prn") return "prn";
  if (/first\s*name|firstname|given name/.test(h)) return "firstName";
  if (/middle\s*name|middlename/.test(h)) return "middleName";
  if (/last\s*name|lastname|surname|family name/.test(h)) return "lastName";
  if (/^(full\s*)?name$|student name|candidate name/.test(h) || h === "name") return "name";
  if (/student.*(mobile|phone|contact)|mobile.*student|phone.*student|own mobile|learner mobile/.test(h))
    return "studentMobile";
  if (/parent.*whats?app|whats?app.*parent|guardian.*whats?app/.test(h)) return "parentWhatsapp";
  if (/parent.*(mobile|phone|contact)|guardian.*(mobile|phone)|father.*mobile|mother.*mobile/.test(h))
    return "parentMobile";
  if (/(^| )whats?app( |$)/.test(h) && !/student/.test(h)) return "parentWhatsapp";
  if (/student.*mail|email.*student|e-?mail$|^email$|mail id/.test(h)) return "studentEmail";
  if (/^mobile$|^phone$|^contact$|contact no|mobile no|phone no/.test(h)) return "parentMobile";
  if (/10th|ssc|class x\b|xth/.test(h) && /percent|pct|%|marks/.test(h)) return "tenthPercent";
  if (/10th|ssc|class x\b/.test(h) && !/12/.test(h)) return "tenthPercent";
  if (/12th|hsc|class xii|xiith/.test(h) && /percent|pct|%|marks|stream/.test(h)) {
    if (/stream/.test(h)) return "twelfthStream";
    return "twelfthPercent";
  }
  if (/12th|hsc|xii/.test(h)) return "twelfthPercent";
  if (/\bcet\b/.test(h)) return "cetScore";
  if (/\bjee\b/.test(h)) return "jeeScore";
  if (/diploma/.test(h) && /percent|pct|%|marks/.test(h)) return "diplomaPercent";
  if (/year|fy|sy|ty|ly|class year/.test(h) && !/12|10/.test(h)) return "yearLevel";
  if (/\bbatch\b|\bdiv\b|division|section/.test(h)) return "batch";
  return null;
}

function cellStr(v) {
  if (v == null || v === "") return "";
  return String(v).trim();
}

export async function parseContactMasterFromFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const students = [];
  const ignoredSample = new Set();
  let rowsSeen = 0;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!matrix.length) continue;
    // find header row: first row with a PRN-like and name-like column
    let headerIdx = 0;
    let colMap = {};
    for (let r = 0; r < Math.min(matrix.length, 15); r++) {
      const row = matrix[r] || [];
      const trial = {};
      row.forEach((cell, i) => {
        const field = mapContactHeader(cell);
        if (field) trial[i] = field;
        else if (cellStr(cell)) ignoredSample.add(cellStr(cell).slice(0, 40));
      });
      const vals = Object.values(trial);
      if (vals.includes("prn") && (vals.includes("name") || vals.includes("firstName"))) {
        headerIdx = r;
        colMap = trial;
        break;
      }
    }
    if (!Object.keys(colMap).length) continue;

    for (let r = headerIdx + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      rowsSeen += 1;
      const obj = {};
      for (const [i, field] of Object.entries(colMap)) {
        const raw = row[Number(i)];
        if (raw === "" || raw == null) continue;
        obj[field] = typeof raw === "number" ? raw : cellStr(raw);
      }
      if (!obj.prn) continue;
      obj.prn = cellStr(obj.prn);
      if (obj.firstName || obj.lastName) {
        const bits = [obj.firstName, obj.middleName, obj.lastName].filter(Boolean);
        if (!obj.name) obj.name = bits.join(" ");
      }
      if (!obj.name && !obj.firstName) continue;
      if (obj.parentMobile && !obj.parentWhatsapp) obj.parentWhatsapp = obj.parentMobile;
      students.push(obj);
    }
  }

  // de-dupe by PRN (last wins)
  const by = new Map();
  for (const s of students) by.set(String(s.prn), s);
  return {
    students: [...by.values()],
    meta: {
      source: "contact_master_excel",
      sheetsScanned: wb.SheetNames.length,
      rowsSeen,
      ignoredColumnsSample: [...ignoredSample].slice(0, 12),
    },
  };
}
