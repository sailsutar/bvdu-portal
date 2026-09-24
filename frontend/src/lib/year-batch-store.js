/**
 * Site-wide year + batch selection (canonical FY|SY|TY|FINAL + A-H).
 */

import { normalizeYearLevel, normalizeBatch } from "@/lib/year-batch";

const STORAGE_KEY = "bvu.ui.yearBatch";

function canonicalize(year, batch) {
  const yRaw = year || "All";
  const bRaw = batch || "All";
  const y = yRaw === "All" ? "All" : normalizeYearLevel(yRaw) || yRaw;
  const b = bRaw === "All" ? "All" : normalizeBatch(bRaw) || bRaw;
  return { year: y || "All", batch: b || "All" };
}

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { year: "All", batch: "All" };
    const j = JSON.parse(raw);
    return canonicalize(j.year, j.batch);
  } catch {
    return { year: "All", batch: "All" };
  }
}

function writeStored(year, batch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(canonicalize(year, batch)));
  } catch {
    /* ignore */
  }
}

let state =
  typeof window !== "undefined" ? readStored() : { year: "All", batch: "All" };
const listeners = new Set();

export function getYearBatch() {
  return state;
}

export function setYear(year) {
  state = canonicalize(year || "All", "All"); // reset batch on year change
  writeStored(state.year, state.batch);
  listeners.forEach((fn) => fn(state));
}

export function setBatch(batch) {
  state = canonicalize(state.year, batch || "All");
  writeStored(state.year, state.batch);
  listeners.forEach((fn) => fn(state));
}

export function setYearBatch(year, batch) {
  state = canonicalize(year, batch);
  writeStored(state.year, state.batch);
  listeners.forEach((fn) => fn(state));
}

export function subscribeYearBatch(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function refreshYearBatchFromStorage() {
  state = readStored();
  listeners.forEach((fn) => fn(state));
  return state;
}
