/** University-facing full wording (avoid abbreviations in the interface). */

export const STATUS_LABEL = {
  "At Risk": "At Risk",
  Average: "Average",
  Good: "Good",
};

export const ROLE_LABEL = {
  student: "Student",
  admin: "Head of Department",
  tg: "Teacher Guide",
};

export const CHANNEL_LABEL = {
  email: "Electronic mail",
  sms: "Text message",
  whatsapp: "WhatsApp message",
};

/** Expand common short technical tags for display only */
export function expandUnitTestLabel(text) {
  return String(text || "")
    .replace(/\bUT-1\b/gi, "Unit Test 1")
    .replace(/\bUT-2\b/gi, "Unit Test 2")
    .replace(/\bUT\b/gi, "Unit Test")
    .replace(/\bRE-UT\b/gi, "Re-Unit Test")
    .replace(/\bOBE\b/g, "Outcome-Based Education")
    .replace(/\bCO\b/g, "Course Outcome")
    .replace(/\bPO\b/g, "Program Outcome")
    .replace(/\bTG\b/g, "Teacher Guide")
    .replace(/\bHOD\b/g, "Head of Department")
    .replace(/\bML\b/g, "Machine Learning")
    .replace(/\bSHAP\b/g, "Shapley explanation")
    .replace(/\bNLP\b/g, "natural language processing");
}
