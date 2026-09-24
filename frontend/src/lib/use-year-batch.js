import { useMemo, useState, useEffect, useCallback } from "react";
import { filterByYearBatch } from "@/lib/year-batch";
import {
  getYearBatch,
  setYear as storeSetYear,
  setBatch as storeSetBatch,
  subscribeYearBatch,
} from "@/lib/year-batch-store";

/**
 * Shared year + batch for the whole portal.
 * Uses a module store + localStorage so selection survives section switches and refresh.
 */
export function useYearBatchStudents(allStudents) {
  const [yb, setYb] = useState(() => getYearBatch());

  useEffect(() => {
    // Sync if another component already changed the store before mount
    setYb(getYearBatch());
    return subscribeYearBatch(setYb);
  }, []);

  const year = yb.year || "All";
  const batch = yb.batch || "All";

  const students = useMemo(
    () => filterByYearBatch(allStudents || [], year, batch),
    [allStudents, year, batch]
  );

  const onYearChange = useCallback((y) => {
    storeSetYear(y);
  }, []);

  const onBatchChange = useCallback((b) => {
    storeSetBatch(b);
  }, []);

  return {
    year,
    batch,
    setYear: onYearChange,
    setBatch: onBatchChange,
    students,
    allStudents: allStudents || [],
    filterProps: {
      students: allStudents || [],
      year,
      batch,
      onYearChange,
      onBatchChange,
    },
  };
}

/** Lightweight: only year/batch values (no student filter) */
export function useYearBatchSelection() {
  const [yb, setYb] = useState(() => getYearBatch());
  useEffect(() => {
    setYb(getYearBatch());
    return subscribeYearBatch(setYb);
  }, []);
  return {
    year: yb.year || "All",
    batch: yb.batch || "All",
    setYear: storeSetYear,
    setBatch: storeSetBatch,
  };
}
