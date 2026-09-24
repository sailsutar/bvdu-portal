import {
  LayoutDashboard,
  User,
  CalendarCheck,
  BookOpen,
  FileText,
  Clock,
  MessageSquare,
  Sparkles,
  Bell,
  Settings,
  Users,
  BarChart3,
  Upload,
  GitMerge,
  FileBarChart,
  Zap,
  Brain,
  ListChecks,
  GraduationCap,
  Activity,
  Target,
  Bot,
  SlidersHorizontal,
  Layers,
  Megaphone,
  UserCog,
  Shield,
  ClipboardList,
  FileSpreadsheet,
  UserPlus,
  AlertTriangle,
  Briefcase,
  ClipboardCheck,
  Building2,
} from "lucide-react";

const studentNav = [
  { label: "Dashboard", to: "/student", icon: LayoutDashboard, end: true },
  { label: "My Profile", to: "/student/profile", icon: User },
  { label: "Attendance", to: "/student/attendance", icon: CalendarCheck },
  { label: "Marks", to: "/student/marks", icon: BookOpen },
  { label: "Assignments", to: "/student/assignments", icon: FileText },
  { label: "Time Table", to: "/student/timetable", icon: Clock },
  { label: "Feedback", to: "/student/feedback", icon: MessageSquare },
  { label: "Artificial Intelligence Insights", to: "/student/ai-insights", icon: Sparkles },
  { label: "Notifications", to: "/student/notifications", icon: Bell },
  { label: "Placement profile", to: "/student/placement", icon: Briefcase },
  { label: "Settings", to: "/student/settings", icon: Settings },
];

const adminNav = [
  { label: "Dashboard", to: "/admin", icon: LayoutDashboard, end: true },
  { label: "Academic Intelligence", to: "/admin/intelligence", icon: Brain },
  { label: "Advanced Intelligence", to: "/admin/advanced", icon: Layers },
  { label: "AI Agents", to: "/admin/agents", icon: Bot },
  { label: "Parent bot", to: "/admin/parent-bot", icon: MessageSquare },
  { label: "Student Interventions", to: "/admin/interventions", icon: ListChecks },
  { label: "Predictive Outcome-Based Education", to: "/admin/obe", icon: GraduationCap },
  { label: "Model Health and Audit", to: "/admin/model-health", icon: Activity },
  { label: "Students", to: "/admin/students", icon: Users },
  { label: "Slow and Fast Learners", to: "/admin/learners", icon: Zap },
  { label: "Attendance", to: "/admin/attendance", icon: CalendarCheck },
  { label: "Bunk analysis", to: "/admin/bunk-analysis", icon: Activity },
  { label: "Marks", to: "/admin/marks", icon: BookOpen },
  { label: "Assignments", to: "/admin/assignments", icon: FileText },
  { label: "Feedback", to: "/admin/feedback", icon: MessageSquare },
  { label: "Analytics", to: "/admin/analytics", icon: BarChart3 },
  { label: "Reports", to: "/admin/reports", icon: FileBarChart },
  { label: "Teacher performance", to: "/admin/teachers", icon: GraduationCap },
  { label: "Announcements", to: "/admin/announcements", icon: Megaphone },
  { label: "Timetable", to: "/admin/timetable", icon: Clock },
  { label: "Settings", to: "/admin/settings", icon: Settings },
];

const tgNav = [
  { label: "Dashboard", to: "/tg", icon: LayoutDashboard, end: true },
  { label: "My Students", to: "/tg/students", icon: Users },
  { label: "Intervention Queue", to: "/tg/interventions", icon: Target },
  { label: "Action Agent", to: "/tg/agent", icon: Bot },
  { label: "What-If Simulator", to: "/tg/whatif", icon: SlidersHorizontal },
  { label: "Attendance", to: "/tg/attendance", icon: CalendarCheck },
  { label: "Marks", to: "/tg/marks", icon: BookOpen },
];


const parentNav = [
  { label: "My children", to: "/parent", icon: LayoutDashboard, end: true },
  { label: "Notices", to: "/parent/notices", icon: Bell },
];

const sysadminNav = [
  { label: "Dashboard", to: "/sysadmin", icon: LayoutDashboard, end: true },
  { label: "Upload academic data", to: "/sysadmin/upload-data", icon: Upload },
  { label: "Combine attendance and marks", to: "/sysadmin/combine-data", icon: GitMerge },
  { label: "Contact details", to: "/sysadmin/contacts", icon: Users },
  { label: "Background factors", to: "/sysadmin/background", icon: ClipboardList },
  { label: "Placement features", to: "/sysadmin/placement-features", icon: FileSpreadsheet },
  { label: "Teacher Guides", to: "/sysadmin/tg", icon: UserCog },
  { label: "TG assignment", to: "/sysadmin/tg-assign", icon: UserPlus },
  { label: "Danger zone", to: "/sysadmin/danger", icon: AlertTriangle },
];

const pcNav = [
  { label: "Dashboard", to: "/placement-coordinator", icon: LayoutDashboard, end: true },
  { label: "Student profiles", to: "/placement-coordinator/profiles", icon: ClipboardCheck },
  { label: "Missing data queue", to: "/placement-coordinator/queue", icon: ListChecks },
  { label: "Reminder drafts", to: "/placement-coordinator/reminders", icon: MessageSquare },
  { label: "Analytics", to: "/placement-coordinator/analytics", icon: BarChart3 },
];

const phNav = [
  { label: "Dashboard", to: "/placement-head", icon: LayoutDashboard, end: true },
  { label: "Verified profiles", to: "/placement-head/profiles", icon: Building2 },
  { label: "Drive ready", to: "/placement-head/ready", icon: Briefcase },
  { label: "Analytics & ranks", to: "/placement-head/analytics", icon: BarChart3 },
  { label: "Mock interviews", to: "/placement-head/mock", icon: Target },
  { label: "Drive freeze", to: "/placement-head/freeze", icon: Activity },
];

export { adminNav, studentNav, tgNav, sysadminNav, pcNav, phNav, parentNav };


