/**
 * Career Coach — full domain roadmaps.
 * Phase 1 (mandatory for every domain): complete DSA roadmap (shared with Employability tracking).
 * Phase 2: domain topics (tick each).
 * Phase 3: end projects — judged (only after DSA + all domain topics done).
 */

import mongoose from "mongoose";
import { getDsaRoadmap, setDsaTopicDone, DSA_ROADMAP_TOPICS } from "./employability-dsa-roadmap.js";
import { genaiJudgeProject } from "./genai.js";

export const CAREER_DOMAINS = [
  {
    id: "ai_developer",
    title: "AI Developer",
    summary: "Full path from Python and ML foundations to shipping an AI demo. DSA is mandatory first.",
  },
  {
    id: "data_scientist",
    title: "Data Scientist",
    summary: "Statistics, EDA, modeling, experiments, and communication. DSA is mandatory first.",
  },
  {
    id: "data_analyst",
    title: "Data Analyst",
    summary: "SQL, metrics, dashboards, and insight storytelling. DSA is mandatory first.",
  },
  {
    id: "cloud_developer",
    title: "Cloud Developer",
    summary: "Cloud fundamentals through deploy and ops basics. DSA is mandatory first.",
  },
  {
    id: "kubernetes",
    title: "Kubernetes",
    summary: "Containers to cluster workloads and day-1 ops. DSA is mandatory first.",
  },
  {
    id: "cyber_security",
    title: "Cyber Security",
    summary: "Security mindset through web defense practices. DSA is mandatory first.",
  },
];

/** Domain topics only (tick). Projects are separate at the end. */
export const DOMAIN_TOPICS = {
  ai_developer: [
    { id: "py_syntax", title: "Python syntax and data structures", description: "Lists, dicts, functions, modules, virtual environments." },
    { id: "py_oop", title: "Python OOP and files", description: "Classes, exceptions, reading/writing files, packages." },
    { id: "numpy_pandas", title: "NumPy and Pandas", description: "Arrays, DataFrames, filtering, groupby, merges." },
    { id: "viz", title: "Data visualization", description: "Matplotlib/Seaborn basics; clear charts." },
    { id: "ml_math", title: "ML math intuition", description: "Vectors, loss, gradient idea, bias/variance, train/test." },
    { id: "supervised", title: "Supervised learning", description: "Regression and classification with scikit-learn pipelines." },
    { id: "unsupervised", title: "Unsupervised learning", description: "Clustering, PCA intuition, when to use them." },
    { id: "eval", title: "Model evaluation", description: "Metrics, cross-validation, leakage awareness." },
    { id: "nn_basics", title: "Neural network basics", description: "Layers, activation, forward pass, simple training loop." },
    { id: "dl_framework", title: "PyTorch or TensorFlow intro", description: "Tensors, Dataset/DataLoader, train one small model." },
    { id: "applied_track", title: "Applied track: NLP or CV", description: "One applied area — text or images — at starter level." },
    { id: "model_save", title: "Save and load models", description: "Persist weights, reload, run inference offline." },
    { id: "api_demo", title: "Inference API or demo app", description: "Expose model via simple API or Streamlit/Gradio." },
    { id: "ethics_limits", title: "Limits and responsible use", description: "Data bias, overclaiming metrics, privacy basics." },
  ],
  data_scientist: [
    { id: "prob_stats", title: "Probability and statistics", description: "Distributions, sampling, confidence intervals." },
    { id: "hypothesis", title: "Hypothesis testing", description: "p-values, common tests, practical interpretation." },
    { id: "data_wrangle", title: "Data wrangling", description: "Cleaning, missing values, types, joins." },
    { id: "eda", title: "Exploratory data analysis", description: "Questions, plots, anomaly notes, feature ideas." },
    { id: "feature_eng", title: "Feature engineering", description: "Encoding, scaling, derived features, leakage." },
    { id: "baselines", title: "Baselines first", description: "Simple models before complex ones; document baseline." },
    { id: "model_compare", title: "Model comparison", description: "Compare 2–3 approaches with the same validation scheme." },
    { id: "experiment_log", title: "Experiment tracking", description: "Hypothesis → setup → result → decision log." },
    { id: "sql_for_ds", title: "SQL for analysis", description: "Aggregations, window functions for feature tables." },
    { id: "communicate", title: "Communicate findings", description: "Non-technical summary: insight + recommendation." },
    { id: "reproducibility", title: "Reproducible workflow", description: "Seed, environment, notebook or script structure." },
  ],
  data_analyst: [
    { id: "sheets", title: "Spreadsheets mastery", description: "Pivot tables, lookups, clean tables, charts." },
    { id: "sql_select", title: "SQL SELECT and filters", description: "WHERE, ORDER, LIMIT, NULL handling." },
    { id: "sql_join", title: "SQL joins and aggregates", description: "JOIN types, GROUP BY, HAVING." },
    { id: "sql_window", title: "SQL window functions", description: "RANK, running totals, partitions." },
    { id: "kpi", title: "KPI definitions", description: "Define metrics so two people compute the same number." },
    { id: "funnel", title: "Funnels and cohorts intro", description: "Conversion steps and simple cohort tables." },
    { id: "dashboard", title: "Dashboard design", description: "Layout, filters, one page one story." },
    { id: "bi_tool", title: "BI tool practice", description: "Tableau / Power BI / Looker Studio / Metabase — pick one." },
    { id: "insight_writing", title: "Insight writing", description: "Chart → observation → business action." },
    { id: "data_quality", title: "Data quality checks", description: "Duplicates, outliers, freshness, source trust." },
    { id: "automation", title: "Light automation", description: "Scheduled query or script that refreshes a metric table." },
  ],
  cloud_developer: [
    { id: "cloud_model", title: "Cloud service model", description: "IaaS/PaaS/SaaS, regions, availability idea." },
    { id: "iam", title: "Identity and access basics", description: "Users, roles, least privilege." },
    { id: "compute", title: "Compute options", description: "VMs vs containers vs serverless — when to use which." },
    { id: "storage", title: "Storage and databases", description: "Object storage, block, managed DB overview." },
    { id: "networking", title: "VPC and networking basics", description: "Subnets, security groups/firewall rules, public vs private." },
    { id: "linux", title: "Linux for developers", description: "SSH, processes, logs, package installs." },
    { id: "git", title: "Git workflows", description: "Branches, PRs, meaningful commits." },
    { id: "docker", title: "Docker essentials", description: "Image, container, Dockerfile, volumes." },
    { id: "cicd_idea", title: "CI/CD idea", description: "Build → test → deploy pipeline concept." },
    { id: "deploy", title: "Deploy a service", description: "Any free tier or local compose running end-to-end." },
    { id: "health_logs", title: "Health checks and logs", description: "/health, structured logs, basic monitoring idea." },
    { id: "cost_security", title: "Cost and security hygiene", description: "Don't leave keys in code; shut down unused resources." },
  ],
  kubernetes: [
    { id: "docker_strong", title: "Strong Docker base", description: "Multi-container apps, networks, compose." },
    { id: "why_k8s", title: "Why Kubernetes", description: "Orchestration problems containers alone don't solve." },
    { id: "architecture", title: "Cluster architecture", description: "Control plane, nodes, kubelet, API server (high level)." },
    { id: "pods", title: "Pods", description: "Pod lifecycle, labels, probes idea." },
    { id: "deployments", title: "Deployments and ReplicaSets", description: "Desired state, rollouts, scaling." },
    { id: "services", title: "Services and networking", description: "ClusterIP, NodePort, basic Service discovery." },
    { id: "config", title: "ConfigMaps and Secrets", description: "Inject config; never commit secrets." },
    { id: "volumes", title: "Volumes intro", description: "Ephemeral vs persistent volume claims (concept)." },
    { id: "kubectl", title: "kubectl daily commands", description: "get, describe, logs, apply, rollout." },
    { id: "manifests", title: "Write YAML manifests", description: "Deployment + Service applied on minikube/kind/cloud." },
    { id: "debug", title: "Debug failing workloads", description: "CrashLoop, ImagePull, events, describe." },
    { id: "helm_idea", title: "Helm or Kustomize idea", description: "Why templating/packaging exists (intro only)." },
  ],
  cyber_security: [
    { id: "cia", title: "CIA triad and risk", description: "Confidentiality, integrity, availability; risk basics." },
    { id: "threats", title: "Threats vs vulnerabilities", description: "Attacker goals, common campus/app threats." },
    { id: "network_sec", title: "Networking for security", description: "TCP/IP, DNS, ports, firewalls." },
    { id: "crypto_basics", title: "Crypto basics", description: "Hashing, symmetric/asymmetric, TLS purpose." },
    { id: "authn_authz", title: "Authentication and authorization", description: "Passwords, MFA, sessions, RBAC idea." },
    { id: "owasp", title: "OWASP Top 10 awareness", description: "Know the categories; map one to a real bug class." },
    { id: "web_attacks", title: "Web attacks practice mindset", description: "XSS, SQLi, CSRF — how they happen, how to prevent." },
    { id: "secure_coding", title: "Secure coding habits", description: "Validation, least privilege, dependency updates." },
    { id: "logging", title: "Security logging", description: "What to log; what not to log (secrets)." },
    { id: "incident", title: "Incident response outline", description: "Detect → contain → eradicate → recover → lessons." },
    { id: "privacy", title: "Privacy and data handling", description: "PII, minimization, campus data sensitivity." },
  ],
};

/** Final projects per domain — judged only after DSA + all topics complete */
export const DOMAIN_FINAL_PROJECTS = {
  ai_developer: [
    {
      id: "proj_ml_pipeline",
      title: "End-to-end ML mini project",
      description: "Clean data → train → evaluate → save model. Report metrics honestly.",
    },
    {
      id: "proj_inference_demo",
      title: "Inference demo",
      description: "Load saved model and expose a small demo (API or UI) with README.",
    },
  ],
  data_scientist: [
    {
      id: "proj_full_study",
      title: "Full data study",
      description: "EDA + model + experiment log + one-page business insight.",
    },
    {
      id: "proj_repro_pack",
      title: "Reproducible package",
      description: "Code + requirements + how to rerun results from scratch.",
    },
  ],
  data_analyst: [
    {
      id: "proj_dashboard",
      title: "Analytics dashboard",
      description: "Dashboard answering 5 business questions with documented KPIs.",
    },
    {
      id: "proj_sql_story",
      title: "SQL + insight pack",
      description: "SQL scripts + written recommendations backed by query outputs.",
    },
  ],
  cloud_developer: [
    {
      id: "proj_deployed_app",
      title: "Deployed small app",
      description: "Containerized app deployed with health check and short architecture note.",
    },
    {
      id: "proj_ops_runbook",
      title: "Ops runbook",
      description: "How to deploy, rollback, and read logs for your app.",
    },
  ],
  kubernetes: [
    {
      id: "proj_k8s_workload",
      title: "Kubernetes workload",
      description: "App on cluster with Deployment + Service; document apply and verify steps.",
    },
    {
      id: "proj_debug_writeup",
      title: "Debug write-up",
      description: "Break something on purpose, fix it, document commands and root cause.",
    },
  ],
  cyber_security: [
    {
      id: "proj_threat_model",
      title: "Threat model + fixes",
      description: "Threat model a web app; list findings and mitigations.",
    },
    {
      id: "proj_secure_checklist",
      title: "Secure delivery checklist",
      description: "Apply a security checklist to a sample app and record pass/fail evidence.",
    },
  ],
};

const careerProgressSchema = new mongoose.Schema(
  {
    prn: { type: String, required: true, unique: true, index: true },
    selectedDomainId: { type: String, default: null },
    /** domainId -> topicId -> { done, completedAt } */
    topicProgress: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** domainId -> projectId -> { note, projectStatus, judgeFeedback, judgedAt, done } */
    projectProgress: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastUpdatedAt: { type: Date, default: Date.now },
    domainChangedAt: { type: Date, default: null },
    previousDomainId: { type: String, default: null },
  },
  { timestamps: true }
);

export const StudentCareerCoach =
  mongoose.models.StudentCareerCoach || mongoose.model("StudentCareerCoach", careerProgressSchema);

function topicList(domainId) {
  return DOMAIN_TOPICS[domainId] || [];
}
function projectList(domainId) {
  return DOMAIN_FINAL_PROJECTS[domainId] || [];
}

function mapTopics(domainId, rawMap) {
  const map = rawMap && typeof rawMap === "object" ? rawMap : {};
  const topics = topicList(domainId);
  let blocked = false;
  return topics.map((t, i) => {
    const p = map[t.id] || {};
    const done = Boolean(p.done);
    const unlocked = !blocked;
    if (!done) blocked = true;
    return {
      ...t,
      order: i + 1,
      done,
      completedAt: p.completedAt || null,
      unlocked,
    };
  });
}

function mapProjects(domainId, rawMap, projectsUnlocked) {
  const map = rawMap && typeof rawMap === "object" ? rawMap : {};
  return projectList(domainId).map((pr, i) => {
    const p = map[pr.id] || {};
    return {
      ...pr,
      order: i + 1,
      unlocked: projectsUnlocked,
      note: p.note || "",
      projectStatus: p.projectStatus || "not_started",
      judgeFeedback: p.judgeFeedback || null,
      strengths: p.strengths || [],
      gaps: p.gaps || [],
      nextActions: p.nextActions || [],
      source: p.source || null,
      judgedAt: p.judgedAt || null,
      done: Boolean(p.done),
    };
  });
}

export function judgeFinalProject({ domainId, projectId, note, dsaComplete, topicsComplete }) {
  if (!dsaComplete) {
    return {
      projectStatus: "needs_work",
      judgeFeedback: "DSA is mandatory. Finish the full DSA roadmap (Basics through Dynamic Programming) before final projects are accepted.",
    };
  }
  if (!topicsComplete) {
    return {
      projectStatus: "needs_work",
      judgeFeedback: "Finish every topic tick in this domain roadmap before final project judgment counts toward completion.",
    };
  }
  const text = String(note || "").trim();
  const meta = projectList(domainId).find((p) => p.id === projectId);
  const title = meta?.title || projectId;
  if (text.length < 80) {
    return {
      projectStatus: "needs_work",
      judgeFeedback: `Write-up too short for “${title}”. Include: goal, tools, steps, result/metrics, and what you would improve. Aim for a solid paragraph (8+ sentences).`,
    };
  }
  const hasTool = /(python|sql|docker|kubernetes|aws|azure|gcp|linux|git|pandas|sklearn|pytorch|tensorflow|react|node|owasp|firewall)/i.test(text);
  const hasOutcome = /(accuracy|result|deploy|dashboard|fixed|metric|%|demo|query|cluster|vulnerability|mitigation)/i.test(text);
  const hasDsa = /(dsa|algorithm|complexity|array|graph|dynamic programming|\bdp\b)/i.test(text);
  if (hasTool && hasOutcome && text.length >= 120) {
    let extra = hasDsa
      ? " Good that you connected algorithms/DSA to the work."
      : " Mention briefly how DSA/problem-solving helped (complexity, data structures, or approach).";
    return {
      projectStatus: "solid",
      judgeFeedback: `Solid final project write-up for “${title}”. Tools and outcomes are clear.${extra} You may mark this project done.`,
    };
  }
  return {
    projectStatus: "needs_work",
    judgeFeedback: `Partial for “${title}”. ${!hasTool ? "Name concrete tools. " : ""}${!hasOutcome ? "State a clear outcome or metric. " : ""}Expand steps and results, then resubmit.`,
  };
}

export async function getCareerCoach(prn) {
  const key = String(prn || "").trim();
  if (!key) throw new Error("prn required");

  const dsa = await getDsaRoadmap(key);
  const dsaComplete = Boolean(dsa.complete);

  let doc = await StudentCareerCoach.findOne({ prn: key });
  if (!doc) doc = await StudentCareerCoach.create({ prn: key, topicProgress: {}, projectProgress: {} });

  const selectedDomainId = doc.selectedDomainId || null;

  const domains = CAREER_DOMAINS.map((d) => {
    const topics = mapTopics(d.id, doc.topicProgress?.[d.id]);
    const topicsDone = topics.filter((t) => t.done).length;
    const topicsComplete = topics.length > 0 && topicsDone === topics.length;
    const projectsUnlocked = dsaComplete && topicsComplete;
    const projects = mapProjects(d.id, doc.projectProgress?.[d.id], projectsUnlocked);
    const projectsSolid = projects.filter((p) => p.projectStatus === "solid" || p.done).length;
    return {
      ...d,
      topicsDone,
      topicsTotal: topics.length,
      topicsPercent: topics.length ? Math.round((topicsDone / topics.length) * 100) : 0,
      topicsComplete,
      projectsUnlocked,
      projectsSolid,
      projectsTotal: projects.length,
      // overall domain %: DSA gate is global; topic+project weighted for selected view
      percent: topics.length
        ? Math.round(
            (topicsDone / topics.length) * 70 +
              (projects.length ? (projectsSolid / projects.length) * 30 : 0)
          )
        : 0,
    };
  });

  let roadmap = null;
  if (selectedDomainId && DOMAIN_TOPICS[selectedDomainId]) {
    const topics = mapTopics(selectedDomainId, doc.topicProgress?.[selectedDomainId]);
    // Domain topics only unlock after DSA complete
    const topicsGated = topics.map((t) => ({
      ...t,
      unlocked: dsaComplete && t.unlocked,
      lockedReason: !dsaComplete ? "Complete mandatory DSA first" : !t.unlocked && !t.done ? "Finish previous topic" : null,
    }));
    const topicsDone = topicsGated.filter((t) => t.done).length;
    const topicsComplete = topicsGated.length > 0 && topicsDone === topicsGated.length;
    const projectsUnlocked = dsaComplete && topicsComplete;
    const projects = mapProjects(selectedDomainId, doc.projectProgress?.[selectedDomainId], projectsUnlocked);
    const domainMeta = CAREER_DOMAINS.find((d) => d.id === selectedDomainId);
    roadmap = {
      domainId: selectedDomainId,
      title: domainMeta?.title || selectedDomainId,
      summary: domainMeta?.summary || "",
      dsaRequired: true,
      dsaComplete,
      topics: topicsGated,
      topicsDone,
      topicsTotal: topicsGated.length,
      topicsPercent: topicsGated.length ? Math.round((topicsDone / topicsGated.length) * 100) : 0,
      topicsComplete,
      projects,
      projectsUnlocked,
      nextTopic: topicsGated.find((t) => t.unlocked && !t.done) || null,
      nextProject: projectsUnlocked ? projects.find((p) => !p.done && p.projectStatus !== "solid") || null : null,
    };
  }

  return {
    prn: key,
    dsaMandatory: true,
    dsa,
    dsaComplete,
    selectedDomainId,
    domains,
    roadmap,
    updatedAt: doc.lastUpdatedAt || doc.updatedAt,
  };
}

export async function selectCareerDomain(prn, domainId) {
  if (!CAREER_DOMAINS.some((d) => d.id === domainId)) {
    const err = new Error("Unknown domain");
    err.code = 400;
    throw err;
  }
  const key = String(prn || "").trim();
  let doc = await StudentCareerCoach.findOne({ prn: key });
  if (!doc) doc = await StudentCareerCoach.create({ prn: key, topicProgress: {}, projectProgress: {} });
  const prev = doc.selectedDomainId || null;
  // Single active domain only; progress for other domains remains in topicProgress / projectProgress
  doc.selectedDomainId = domainId;
  if (prev && prev !== domainId) {
    doc.domainChangedAt = new Date();
    doc.previousDomainId = prev;
  }
  doc.lastUpdatedAt = new Date();
  await doc.save();
  return getCareerCoach(key);
}

/** DSA ticks — delegated to shared DSA store (mandatory for all domains) */
export async function setCareerDsaTopic(prn, topicId, done = true) {
  await setDsaTopicDone(prn, topicId, done);
  return getCareerCoach(prn);
}

export async function setCareerDomainTopic(prn, { domainId, topicId, done }) {
  const key = String(prn || "").trim();
  const topics = topicList(domainId);
  const idx = topics.findIndex((t) => t.id === topicId);
  if (idx < 0) {
    const err = new Error("Unknown topic");
    err.code = 400;
    throw err;
  }

  const dsa = await getDsaRoadmap(key);
  if (done && !dsa.complete) {
    const err = new Error("DSA is mandatory. Complete the full DSA roadmap before domain topics.");
    err.code = 400;
    throw err;
  }

  let doc = await StudentCareerCoach.findOne({ prn: key });
  if (!doc) doc = await StudentCareerCoach.create({ prn: key, topicProgress: {}, projectProgress: {} });
  const byDomain = { ...(doc.topicProgress || {}) };
  const map = { ...(byDomain[domainId] || {}) };

  if (done) {
    for (let i = 0; i < idx; i++) {
      if (!map[topics[i].id]?.done) {
        const err = new Error(`Finish “${topics[i].title}” first.`);
        err.code = 400;
        throw err;
      }
    }
  } else {
    for (let i = idx + 1; i < topics.length; i++) {
      if (map[topics[i].id]) map[topics[i].id] = { ...map[topics[i].id], done: false, completedAt: null };
    }
  }

  map[topicId] = { done: Boolean(done), completedAt: done ? new Date() : null };
  byDomain[domainId] = map;
  doc.topicProgress = byDomain;
  doc.selectedDomainId = doc.selectedDomainId || domainId;
  doc.lastUpdatedAt = new Date();
  doc.markModified("topicProgress");
  await doc.save();
  return getCareerCoach(key);
}

export async function submitFinalProject(prn, { domainId, projectId, note, markDone }) {
  const key = String(prn || "").trim();
  if (!projectList(domainId).some((p) => p.id === projectId)) {
    const err = new Error("Unknown project");
    err.code = 400;
    throw err;
  }

  const dsa = await getDsaRoadmap(key);
  const dsaComplete = Boolean(dsa.complete);

  let doc = await StudentCareerCoach.findOne({ prn: key });
  if (!doc) doc = await StudentCareerCoach.create({ prn: key, topicProgress: {}, projectProgress: {} });

  const topics = mapTopics(domainId, doc.topicProgress?.[domainId]);
  const topicsComplete = topics.length > 0 && topics.every((t) => t.done);

  const domainMeta = CAREER_DOMAINS.find((d) => d.id === domainId);
  const projectMeta = projectList(domainId).find((p) => p.id === projectId);
  const topicsDone = topics.filter((x) => x.done).length;
  const judgment = await genaiJudgeProject({
    domainId,
    projectId,
    domainTitle: domainMeta?.title || domainId,
    projectTitle: projectMeta?.title || projectId,
    projectDescription: projectMeta?.description || "",
    note,
    dsaComplete,
    topicsComplete,
    dsaPercent: dsa.percent,
    topicsPercent: topics.length ? Math.round((topicsDone / topics.length) * 100) : 0,
  });

  const byDomain = { ...(doc.projectProgress || {}) };
  const map = { ...(byDomain[domainId] || {}) };
  const prev = map[projectId] || {};
  map[projectId] = {
    ...prev,
    note: String(note || ""),
    projectStatus: judgment.projectStatus,
    judgeFeedback: judgment.judgeFeedback,
    strengths: judgment.strengths || [],
    gaps: judgment.gaps || [],
    nextActions: judgment.nextActions || [],
    source: judgment.source || "rules",
    judgedAt: new Date(),
    done: markDone && judgment.projectStatus === "solid" ? true : Boolean(prev.done) && judgment.projectStatus === "solid",
  };
  if (markDone && judgment.projectStatus !== "solid") {
    map[projectId].done = false;
  }

  byDomain[domainId] = map;
  doc.projectProgress = byDomain;
  doc.lastUpdatedAt = new Date();
  doc.markModified("projectProgress");
  await doc.save();
  return getCareerCoach(key);
}
