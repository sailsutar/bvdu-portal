/**
 * S1 — Canonical skill ids, role seeds, dependency graph seeds.
 * Versioned bootstrap data only; no gap ranking or readiness math.
 */

export const SKILL_GRAPH_VERSION = 1;
export const ROLE_REQUIREMENT_VERSION = 1;
export const CATALOG_VERSION = "s1-v1";

/** Canonical skill identifiers used across roles and graph */
export const SKILL_IDS = {
  PROGRAMMING: "programming",
  OOP: "oop",
  DSA: "dsa",
  ADVANCED_DSA: "advanced_dsa",
  DBMS: "dbms",
  OS: "os",
  NETWORKS: "networks",
  WEB_HTML_CSS: "web_html_css",
  JAVASCRIPT: "javascript",
  REACT: "react",
  BACKEND: "backend",
  FULL_STACK: "full_stack",
  GIT: "git",
  CLOUD: "cloud",
  DEVOPS: "devops",
  AIML: "aiml",
  DATA_ANALYSIS: "data_analysis",
  SYSTEM_DESIGN: "system_design",
  COMMUNICATION: "communication",
  PROJECTS: "projects",
  INTERNSHIP: "internship",
  CYBERSECURITY: "cybersecurity",
};

export const SKILL_LABELS = {
  [SKILL_IDS.PROGRAMMING]: "Programming",
  [SKILL_IDS.OOP]: "Object-Oriented Programming",
  [SKILL_IDS.DSA]: "Data Structures and Algorithms",
  [SKILL_IDS.ADVANCED_DSA]: "Advanced DSA",
  [SKILL_IDS.DBMS]: "Database Management Systems",
  [SKILL_IDS.OS]: "Operating Systems",
  [SKILL_IDS.NETWORKS]: "Computer Networks",
  [SKILL_IDS.WEB_HTML_CSS]: "HTML and CSS",
  [SKILL_IDS.JAVASCRIPT]: "JavaScript",
  [SKILL_IDS.REACT]: "React",
  [SKILL_IDS.BACKEND]: "Backend Development",
  [SKILL_IDS.FULL_STACK]: "Full Stack Development",
  [SKILL_IDS.GIT]: "Git and Version Control",
  [SKILL_IDS.CLOUD]: "Cloud Fundamentals",
  [SKILL_IDS.DEVOPS]: "DevOps",
  [SKILL_IDS.AIML]: "Artificial Intelligence and Machine Learning",
  [SKILL_IDS.DATA_ANALYSIS]: "Data Analysis",
  [SKILL_IDS.SYSTEM_DESIGN]: "System Design",
  [SKILL_IDS.COMMUNICATION]: "Communication",
  [SKILL_IDS.PROJECTS]: "Project Evidence",
  [SKILL_IDS.INTERNSHIP]: "Internship Experience",
  [SKILL_IDS.CYBERSECURITY]: "Cybersecurity Fundamentals",
};

/**
 * Directed edges: prerequisiteSkill → dependentSkill
 * Advanced topics require foundations first.
 */
export const SKILL_DEPENDENCY_SEEDS = [
  { prerequisiteSkill: SKILL_IDS.PROGRAMMING, dependentSkill: SKILL_IDS.OOP, minimumThreshold: 50 },
  { prerequisiteSkill: SKILL_IDS.OOP, dependentSkill: SKILL_IDS.DSA, minimumThreshold: 55 },
  { prerequisiteSkill: SKILL_IDS.DSA, dependentSkill: SKILL_IDS.ADVANCED_DSA, minimumThreshold: 65 },
  { prerequisiteSkill: SKILL_IDS.DSA, dependentSkill: SKILL_IDS.SYSTEM_DESIGN, minimumThreshold: 60 },
  { prerequisiteSkill: SKILL_IDS.WEB_HTML_CSS, dependentSkill: SKILL_IDS.JAVASCRIPT, minimumThreshold: 50 },
  { prerequisiteSkill: SKILL_IDS.JAVASCRIPT, dependentSkill: SKILL_IDS.REACT, minimumThreshold: 55 },
  { prerequisiteSkill: SKILL_IDS.REACT, dependentSkill: SKILL_IDS.FULL_STACK, minimumThreshold: 60 },
  { prerequisiteSkill: SKILL_IDS.BACKEND, dependentSkill: SKILL_IDS.FULL_STACK, minimumThreshold: 60 },
  { prerequisiteSkill: SKILL_IDS.PROGRAMMING, dependentSkill: SKILL_IDS.BACKEND, minimumThreshold: 50 },
  { prerequisiteSkill: SKILL_IDS.DBMS, dependentSkill: SKILL_IDS.BACKEND, minimumThreshold: 50 },
  { prerequisiteSkill: SKILL_IDS.PROGRAMMING, dependentSkill: SKILL_IDS.AIML, minimumThreshold: 55 },
  { prerequisiteSkill: SKILL_IDS.DSA, dependentSkill: SKILL_IDS.AIML, minimumThreshold: 55 },
  { prerequisiteSkill: SKILL_IDS.DATA_ANALYSIS, dependentSkill: SKILL_IDS.AIML, minimumThreshold: 50 },
  { prerequisiteSkill: SKILL_IDS.CLOUD, dependentSkill: SKILL_IDS.DEVOPS, minimumThreshold: 55 },
  { prerequisiteSkill: SKILL_IDS.NETWORKS, dependentSkill: SKILL_IDS.CYBERSECURITY, minimumThreshold: 50 },
  { prerequisiteSkill: SKILL_IDS.OS, dependentSkill: SKILL_IDS.CYBERSECURITY, minimumThreshold: 50 },
];

/** roleId, roleName, required/preferred skill specs */
export const JOB_ROLE_SEEDS = [
  {
    roleId: "software_developer",
    roleName: "Software Developer",
    description: "General software development with strong DSA and programming foundations.",
    skills: [
      { skillId: SKILL_IDS.DSA, category: "required", skillWeight: 0.9, minimumThreshold: 70 },
      { skillId: SKILL_IDS.PROGRAMMING, category: "required", skillWeight: 0.85, minimumThreshold: 70 },
      { skillId: SKILL_IDS.OOP, category: "required", skillWeight: 0.75, minimumThreshold: 65 },
      { skillId: SKILL_IDS.DBMS, category: "required", skillWeight: 0.7, minimumThreshold: 60 },
      { skillId: SKILL_IDS.GIT, category: "required", skillWeight: 0.55, minimumThreshold: 55 },
      { skillId: SKILL_IDS.BACKEND, category: "preferred", skillWeight: 0.65, minimumThreshold: 60 },
      { skillId: SKILL_IDS.PROJECTS, category: "required", skillWeight: 0.8, minimumThreshold: 65 },
      { skillId: SKILL_IDS.COMMUNICATION, category: "required", skillWeight: 0.6, minimumThreshold: 55 },
      { skillId: SKILL_IDS.INTERNSHIP, category: "preferred", skillWeight: 0.5, minimumThreshold: 50 },
    ],
  },
  {
    roleId: "full_stack_developer",
    roleName: "Full Stack Developer",
    description: "End-to-end web applications: frontend, backend, and databases.",
    skills: [
      { skillId: SKILL_IDS.JAVASCRIPT, category: "required", skillWeight: 0.85, minimumThreshold: 70 },
      { skillId: SKILL_IDS.REACT, category: "required", skillWeight: 0.8, minimumThreshold: 65 },
      { skillId: SKILL_IDS.BACKEND, category: "required", skillWeight: 0.8, minimumThreshold: 65 },
      { skillId: SKILL_IDS.DBMS, category: "required", skillWeight: 0.7, minimumThreshold: 60 },
      { skillId: SKILL_IDS.FULL_STACK, category: "required", skillWeight: 0.85, minimumThreshold: 65 },
      { skillId: SKILL_IDS.GIT, category: "required", skillWeight: 0.55, minimumThreshold: 55 },
      { skillId: SKILL_IDS.PROJECTS, category: "required", skillWeight: 0.8, minimumThreshold: 65 },
      { skillId: SKILL_IDS.COMMUNICATION, category: "preferred", skillWeight: 0.55, minimumThreshold: 55 },
    ],
  },
  {
    roleId: "data_analyst",
    roleName: "Data Analyst",
    description: "Data analysis, SQL, and communication of insights.",
    skills: [
      { skillId: SKILL_IDS.DATA_ANALYSIS, category: "required", skillWeight: 0.9, minimumThreshold: 70 },
      { skillId: SKILL_IDS.DBMS, category: "required", skillWeight: 0.8, minimumThreshold: 65 },
      { skillId: SKILL_IDS.PROGRAMMING, category: "required", skillWeight: 0.65, minimumThreshold: 55 },
      { skillId: SKILL_IDS.COMMUNICATION, category: "required", skillWeight: 0.7, minimumThreshold: 60 },
      { skillId: SKILL_IDS.PROJECTS, category: "preferred", skillWeight: 0.6, minimumThreshold: 55 },
    ],
  },
  {
    roleId: "data_scientist",
    roleName: "Data Scientist",
    description: "Statistics, programming, and applied machine learning.",
    skills: [
      { skillId: SKILL_IDS.DATA_ANALYSIS, category: "required", skillWeight: 0.85, minimumThreshold: 70 },
      { skillId: SKILL_IDS.AIML, category: "required", skillWeight: 0.85, minimumThreshold: 65 },
      { skillId: SKILL_IDS.PROGRAMMING, category: "required", skillWeight: 0.75, minimumThreshold: 65 },
      { skillId: SKILL_IDS.DSA, category: "preferred", skillWeight: 0.55, minimumThreshold: 55 },
      { skillId: SKILL_IDS.PROJECTS, category: "required", skillWeight: 0.75, minimumThreshold: 60 },
      { skillId: SKILL_IDS.COMMUNICATION, category: "required", skillWeight: 0.6, minimumThreshold: 55 },
    ],
  },
  {
    roleId: "ml_engineer",
    roleName: "Machine Learning Engineer",
    description: "Production ML systems with strong programming and model skills.",
    skills: [
      { skillId: SKILL_IDS.AIML, category: "required", skillWeight: 0.9, minimumThreshold: 70 },
      { skillId: SKILL_IDS.PROGRAMMING, category: "required", skillWeight: 0.8, minimumThreshold: 70 },
      { skillId: SKILL_IDS.DSA, category: "required", skillWeight: 0.7, minimumThreshold: 65 },
      { skillId: SKILL_IDS.CLOUD, category: "preferred", skillWeight: 0.55, minimumThreshold: 50 },
      { skillId: SKILL_IDS.PROJECTS, category: "required", skillWeight: 0.8, minimumThreshold: 65 },
      { skillId: SKILL_IDS.GIT, category: "required", skillWeight: 0.5, minimumThreshold: 55 },
    ],
  },
  {
    roleId: "ai_engineer",
    roleName: "Artificial Intelligence Engineer",
    description: "AI systems, deep learning foundations, and applied projects.",
    skills: [
      { skillId: SKILL_IDS.AIML, category: "required", skillWeight: 0.95, minimumThreshold: 75 },
      { skillId: SKILL_IDS.PROGRAMMING, category: "required", skillWeight: 0.8, minimumThreshold: 70 },
      { skillId: SKILL_IDS.DSA, category: "required", skillWeight: 0.7, minimumThreshold: 65 },
      { skillId: SKILL_IDS.PROJECTS, category: "required", skillWeight: 0.85, minimumThreshold: 70 },
      { skillId: SKILL_IDS.COMMUNICATION, category: "preferred", skillWeight: 0.5, minimumThreshold: 55 },
    ],
  },
  {
    roleId: "cloud_engineer",
    roleName: "Cloud Engineer",
    description: "Cloud platforms, networking, and operational fundamentals.",
    skills: [
      { skillId: SKILL_IDS.CLOUD, category: "required", skillWeight: 0.9, minimumThreshold: 70 },
      { skillId: SKILL_IDS.NETWORKS, category: "required", skillWeight: 0.7, minimumThreshold: 60 },
      { skillId: SKILL_IDS.OS, category: "required", skillWeight: 0.65, minimumThreshold: 55 },
      { skillId: SKILL_IDS.PROGRAMMING, category: "preferred", skillWeight: 0.55, minimumThreshold: 50 },
      { skillId: SKILL_IDS.GIT, category: "required", skillWeight: 0.5, minimumThreshold: 50 },
      { skillId: SKILL_IDS.PROJECTS, category: "preferred", skillWeight: 0.6, minimumThreshold: 55 },
    ],
  },
  {
    roleId: "devops_engineer",
    roleName: "DevOps Engineer",
    description: "CI/CD, cloud, and system operations.",
    skills: [
      { skillId: SKILL_IDS.DEVOPS, category: "required", skillWeight: 0.9, minimumThreshold: 70 },
      { skillId: SKILL_IDS.CLOUD, category: "required", skillWeight: 0.8, minimumThreshold: 65 },
      { skillId: SKILL_IDS.OS, category: "required", skillWeight: 0.7, minimumThreshold: 60 },
      { skillId: SKILL_IDS.GIT, category: "required", skillWeight: 0.65, minimumThreshold: 60 },
      { skillId: SKILL_IDS.NETWORKS, category: "preferred", skillWeight: 0.55, minimumThreshold: 50 },
      { skillId: SKILL_IDS.PROJECTS, category: "preferred", skillWeight: 0.55, minimumThreshold: 55 },
    ],
  },
  {
    roleId: "cybersecurity_analyst",
    roleName: "Cybersecurity Analyst",
    description: "Security fundamentals grounded in networks and operating systems.",
    skills: [
      { skillId: SKILL_IDS.CYBERSECURITY, category: "required", skillWeight: 0.9, minimumThreshold: 70 },
      { skillId: SKILL_IDS.NETWORKS, category: "required", skillWeight: 0.8, minimumThreshold: 65 },
      { skillId: SKILL_IDS.OS, category: "required", skillWeight: 0.75, minimumThreshold: 60 },
      { skillId: SKILL_IDS.PROGRAMMING, category: "preferred", skillWeight: 0.5, minimumThreshold: 50 },
      { skillId: SKILL_IDS.COMMUNICATION, category: "preferred", skillWeight: 0.5, minimumThreshold: 55 },
    ],
  },
];
