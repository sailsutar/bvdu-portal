/**
 * Student DSA learning roadmap — ordered checklist from basics to DP.
 * Every student can tick topics as done; progress is stored per PRN.
 */

import mongoose from "mongoose";

/** Canonical ordered roadmap (id stable for progress keys) */
export const DSA_ROADMAP_TOPICS = [
  {
    id: "basics",
    title: "Basics",
    description: "Complexity (Big-O), recursion intro, how to read a problem, brute force thinking.",
  },
  {
    id: "arrays",
    title: "Arrays",
    description: "Traversal, two pointers, prefix sums, sliding window basics.",
  },
  {
    id: "strings",
    title: "Strings",
    description: "Palindrome, frequency maps, string builders, basic pattern problems.",
  },
  {
    id: "hashing",
    title: "Hashing",
    description: "Hash maps / sets, frequency counting, pair-sum style problems.",
  },
  {
    id: "sorting_searching",
    title: "Sorting and searching",
    description: "Binary search, sorting patterns, search on answer.",
  },
  {
    id: "linked_lists",
    title: "Linked lists",
    description: "Traversal, reverse, middle, cycle detection, merge lists.",
  },
  {
    id: "stacks_queues",
    title: "Stacks and queues",
    description: "Monotonic stack, next greater, parentheses, BFS queue usage.",
  },
  {
    id: "trees",
    title: "Trees",
    description: "Binary trees, BST, traversals (in/pre/post/level), depth and diameter.",
  },
  {
    id: "heaps",
    title: "Heaps / priority queues",
    description: "Top-K, heap operations, merge patterns.",
  },
  {
    id: "graphs",
    title: "Graphs",
    description: "BFS, DFS, connected components, topological sort intro.",
  },
  {
    id: "greedy",
    title: "Greedy",
    description: "Interval problems, activity selection, basic greedy proofs by example.",
  },
  {
    id: "recursion_backtracking",
    title: "Recursion and backtracking",
    description: "Subsets, permutations, N-Queens style exploration.",
  },
  {
    id: "dynamic_programming",
    title: "Dynamic programming",
    description: "1D DP, 2D DP, knapsack family, LIS, grid paths — end goal of this roadmap.",
  },
];

const studentDsaRoadmapSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, unique: true, index: true },
    /** topicId → { done: boolean, completedAt?: Date } */
    progress: {
      type: Map,
      of: new mongoose.Schema(
        {
          done: { type: Boolean, default: false },
          completedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: {},
    },
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const StudentDsaRoadmap =
  mongoose.models.StudentDsaRoadmap ||
  mongoose.model("StudentDsaRoadmap", studentDsaRoadmapSchema);

function normalizeProgress(mapLike) {
  const out = {};
  if (!mapLike) return out;
  const entries =
    mapLike instanceof Map
      ? [...mapLike.entries()]
      : typeof mapLike.entries === "function"
        ? [...mapLike.entries()]
        : Object.entries(mapLike);
  for (const [k, v] of entries) {
    out[String(k)] = {
      done: Boolean(v?.done),
      completedAt: v?.completedAt || null,
    };
  }
  return out;
}

export function buildRoadmapPayload(doc) {
  const progress = normalizeProgress(doc?.progress);
  const topics = DSA_ROADMAP_TOPICS.map((t, index) => {
    const p = progress[t.id] || { done: false, completedAt: null };
    return {
      ...t,
      order: index + 1,
      done: Boolean(p.done),
      completedAt: p.completedAt,
    };
  });
  const doneCount = topics.filter((t) => t.done).length;
  const total = topics.length;
  // Unlock rule: topic i unlocked if all previous are done (first always unlocked)
  let blocked = false;
  for (let i = 0; i < topics.length; i++) {
    topics[i].unlocked = !blocked;
    if (!topics[i].done) blocked = true;
  }
  return {
    prn: doc?.prn || null,
    topics,
    doneCount,
    total,
    percent: total ? Math.round((doneCount / total) * 100) : 0,
    nextTopic: topics.find((t) => t.unlocked && !t.done) || null,
    complete: doneCount === total && total > 0,
  };
}

export async function getDsaRoadmap(prn) {
  const key = String(prn || "").trim();
  if (!key) throw new Error("prn required");
  let doc = await StudentDsaRoadmap.findOne({ prn: key });
  if (!doc) {
    doc = await StudentDsaRoadmap.create({ prn: key, progress: {} });
  }
  return buildRoadmapPayload(doc);
}

/**
 * Toggle or set done for one topic. Sequential unlock is soft-enforced:
 * can only mark a topic done if previous are done (unless force=true for admin later).
 */
export async function setDsaTopicDone(prn, topicId, done = true) {
  const key = String(prn || "").trim();
  const tid = String(topicId || "").trim();
  if (!key) throw new Error("prn required");
  if (!DSA_ROADMAP_TOPICS.some((t) => t.id === tid)) {
    const err = new Error("Unknown DSA topic");
    err.code = 400;
    throw err;
  }

  let doc = await StudentDsaRoadmap.findOne({ prn: key });
  if (!doc) doc = await StudentDsaRoadmap.create({ prn: key, progress: {} });

  const progress = normalizeProgress(doc.progress);
  const idx = DSA_ROADMAP_TOPICS.findIndex((t) => t.id === tid);
  if (done) {
    for (let i = 0; i < idx; i++) {
      const prev = DSA_ROADMAP_TOPICS[i].id;
      if (!progress[prev]?.done) {
        const err = new Error(
          `Finish "${DSA_ROADMAP_TOPICS[i].title}" before marking "${DSA_ROADMAP_TOPICS[idx].title}" done.`
        );
        err.code = 400;
        throw err;
      }
    }
  } else {
    // Unticking a topic also unticks everything after it
    for (let i = idx + 1; i < DSA_ROADMAP_TOPICS.length; i++) {
      const later = DSA_ROADMAP_TOPICS[i].id;
      if (progress[later]) {
        progress[later] = { done: false, completedAt: null };
      }
    }
  }

  progress[tid] = {
    done: Boolean(done),
    completedAt: done ? new Date() : null,
  };

  doc.progress = progress;
  doc.lastUpdatedAt = new Date();
  doc.markModified("progress");
  await doc.save();
  return buildRoadmapPayload(doc);
}
