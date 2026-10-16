import { Routes, Route, Navigate } from "react-router-dom";
import { GlobalLoading } from "./components/GlobalLoading.jsx";

import Index from "./routes/index.jsx";
import LoginStudent from "./routes/login.student.jsx";
import LoginParent from "./routes/login.parent.jsx";
import ParentLayout from "./routes/parent.jsx";
import ParentIndex from "./routes/parent.index.jsx";
import ParentChild from "./routes/parent.child.jsx";
import ParentNotices from "./routes/parent.notices.jsx";
import LoginAdmin from "./routes/login.admin.jsx";
import LoginSystemAdmin from "./routes/login.system-admin.jsx";
import LoginTg from "./routes/login.tg.jsx";
import LoginPlacementCoordinator from "./routes/login.placement-coordinator.jsx";
import LoginPlacementHead from "./routes/login.placement-head.jsx";
import PlacementCoordinatorLayout from "./routes/placement-coordinator.jsx";
import PcIndex from "./routes/placement-coordinator.index.jsx";
import PcProfiles from "./routes/placement-coordinator.profiles.jsx";
import PcQueue from "./routes/placement-coordinator.queue.jsx";
import PlacementHeadLayout from "./routes/placement-head.jsx";
import PhIndex from "./routes/placement-head.index.jsx";
import PhProfiles from "./routes/placement-head.profiles.jsx";
import PhReady from "./routes/placement-head.ready.jsx";
import PcReminders from "./routes/placement-coordinator.reminders.jsx";
import PcAnalytics from "./routes/placement-coordinator.analytics.jsx";
import PhAnalytics from "./routes/placement-head.analytics.jsx";
import PhMock from "./routes/placement-head.mock.jsx";
import PhFreeze from "./routes/placement-head.freeze.jsx";
import StudentEmployability from "@/routes/student.employability";
import StudentCareerCoach from "@/routes/student.career-coach";
import StudentPlacement from "./routes/student.placement.jsx";

import SysadminLayout from "./routes/sysadmin.jsx";
import SysadminIndex from "./routes/sysadmin.index.jsx";
import SysadminContacts from "./routes/sysadmin.contacts.jsx";
import SysadminBackground from "./routes/sysadmin.background.jsx";
import SysadminPlacementFeatures from "./routes/sysadmin.placement-features.jsx";
import SysadminTg from "./routes/sysadmin.tg.jsx";
import SysadminTgAssign from "./routes/sysadmin.tg-assign.jsx";
import SysadminDanger from "./routes/sysadmin.danger.jsx";

import StudentLayout from "./routes/student.jsx";
import StudentIndex from "./routes/student.index.jsx";
import StudentProfile from "./routes/student.profile.jsx";
import StudentAttendance from "./routes/student.attendance.jsx";
import StudentMarks from "./routes/student.marks.jsx";
import StudentAssignments from "./routes/student.assignments.jsx";
import StudentTimetable from "./routes/student.timetable.jsx";
import StudentFeedback from "./routes/student.feedback.jsx";
import StudentAI from "./routes/student.ai-insights.jsx";
import StudentNotifications from "./routes/student.notifications.jsx";
import StudentSettings from "./routes/student.settings.jsx";

import AdminLayout from "./routes/admin.jsx";
import AdminIndex from "./routes/admin.index.jsx";
import AdminStudents from "./routes/admin.students.jsx";
import AdminStudentDetail from "./routes/admin.students.$prn.jsx";
import AdminAttendance from "./routes/admin.attendance.jsx";
import AdminBunkAnalysis from "./routes/admin.bunk-analysis.jsx";
import AdminMarks from "./routes/admin.marks.jsx";
import AdminAssignments from "./routes/admin.assignments.jsx";
import AdminFeedback from "./routes/admin.feedback.jsx";
import AdminAnalytics from "./routes/admin.analytics.jsx";
import AdminReports from "./routes/admin.reports.jsx";
import AdminTeachers from "./routes/admin.teachers.jsx";
import AdminUploadData from "./routes/admin.upload-data.jsx";
import AdminCombineData from "./routes/admin.combine-data.jsx";
import AdminSettings from "./routes/admin.settings.jsx";
import AdminAnnouncements from "./routes/admin.announcements.jsx";
import AdminTimetable from "./routes/admin.timetable.jsx";
import AdminTgAssign from "./routes/admin.tg-assign.jsx";
import AdminLearners from "./routes/admin.learners.jsx";
import AdminIntelligence from "./routes/admin.intelligence.jsx";
import AdminInterventions from "./routes/admin.interventions.jsx";
import AdminObe from "./routes/admin.obe.jsx";
import AdminModelHealth from "./routes/admin.model-health.jsx";
import AdminAdvanced from "./routes/admin.advanced.jsx";
import AdminAgents from "./routes/admin.agents.jsx";
import AdminParentBot from "./routes/admin.parent-bot.jsx";

import TgLayout from "./routes/tg.jsx";
import TgIndex from "./routes/tg.index.jsx";
import TgStudents from "./routes/tg.students.jsx";
import TgAttendance from "./routes/tg.attendance.jsx";
import TgMarks from "./routes/tg.marks.jsx";
import TgStudentDetail from "./routes/tg.students.$prn.jsx";
import TgInterventions from "./routes/tg.interventions.jsx";
import TgAgent from "./routes/tg.agent.jsx";
import TgWhatIf from "./routes/tg.whatif.jsx";

export default function App() {
  return (
    <>
      <GlobalLoading />
      <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/login/student" element={<LoginStudent />} />
      <Route path="/login/parent" element={<LoginParent />} />
      <Route path="/login/admin" element={<LoginAdmin />} />
      <Route path="/login/system-admin" element={<LoginSystemAdmin />} />
      <Route path="/sysadmin" element={<SysadminLayout />}>
        <Route index element={<SysadminIndex />} />
        <Route path="contacts" element={<SysadminContacts />} />
        <Route path="background" element={<SysadminBackground />} />
        <Route path="placement-features" element={<SysadminPlacementFeatures />} />
        <Route path="tg" element={<SysadminTg />} />
        <Route path="tg-assign" element={<SysadminTgAssign />} />
        <Route path="upload-data" element={<AdminUploadData />} />
        <Route path="combine-data" element={<AdminCombineData />} />
        <Route path="danger" element={<SysadminDanger />} />
      </Route>
      <Route path="/login/tg" element={<LoginTg />} />
      <Route path="/login/placement-coordinator" element={<LoginPlacementCoordinator />} />
      <Route path="/login/placement-head" element={<LoginPlacementHead />} />
      <Route path="/placement-coordinator" element={<PlacementCoordinatorLayout />}>
        <Route index element={<PcIndex />} />
        <Route path="profiles" element={<PcProfiles />} />
        <Route path="queue" element={<PcQueue />} />
        <Route path="reminders" element={<PcReminders />} />
        <Route path="analytics" element={<PcAnalytics />} />
</Route>
      <Route path="/placement-head" element={<PlacementHeadLayout />}>
        <Route index element={<PhIndex />} />
        <Route path="profiles" element={<PhProfiles />} />
        <Route path="ready" element={<PhReady />} />
        <Route path="analytics" element={<PhAnalytics />} />
<Route path="mock" element={<PhMock />} />
        <Route path="freeze" element={<PhFreeze />} />
      </Route>

      <Route path="/parent" element={<ParentLayout />}>
        <Route index element={<ParentIndex />} />
        <Route path="child/:prn" element={<ParentChild />} />
        <Route path="notices" element={<ParentNotices />} />
      </Route>

      <Route path="/student" element={<StudentLayout />}>
        <Route index element={<StudentIndex />} />
        <Route path="profile" element={<StudentProfile />} />
        <Route path="placement" element={<StudentPlacement />} />
        <Route path="employability" element={<StudentEmployability />} />
        <Route path="career-coach" element={<StudentCareerCoach />} />
        <Route path="attendance" element={<StudentAttendance />} />
        <Route path="marks" element={<StudentMarks />} />
        <Route path="assignments" element={<StudentAssignments />} />
        <Route path="timetable" element={<StudentTimetable />} />
        <Route path="feedback" element={<StudentFeedback />} />
        <Route path="ai-insights" element={<StudentAI />} />
        <Route path="notifications" element={<StudentNotifications />} />
        <Route path="settings" element={<StudentSettings />} />
      </Route>

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminIndex />} />
        <Route path="students" element={<AdminStudents />} />
        <Route path="students/:prn" element={<AdminStudentDetail />} />
        <Route path="learners" element={<AdminLearners />} />
        <Route path="intelligence" element={<AdminIntelligence />} />
<Route path="interventions" element={<AdminInterventions />} />
        <Route path="obe" element={<AdminObe />} />
        <Route path="model-health" element={<AdminModelHealth />} />
        <Route path="advanced" element={<AdminAdvanced />} />
        <Route path="agents" element={<AdminAgents />} />
        <Route path="parent-bot" element={<AdminParentBot />} />
        <Route path="attendance" element={<AdminAttendance />} />
          <Route path="bunk-analysis" element={<AdminBunkAnalysis />} />
        <Route path="marks" element={<AdminMarks />} />
        <Route path="assignments" element={<AdminAssignments />} />
        <Route path="feedback" element={<AdminFeedback />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="reports" element={<AdminReports />} />
        <Route path="teachers" element={<AdminTeachers />} />
                <Route path="announcements" element={<AdminAnnouncements />} />
        <Route path="timetable" element={<AdminTimetable />} />
                <Route path="settings" element={<AdminSettings />} />
      </Route>

      <Route path="/tg" element={<TgLayout />}>
        <Route index element={<TgIndex />} />
        <Route path="students" element={<TgStudents />} />
<Route path="students/:prn" element={<TgStudentDetail />} />
        <Route path="interventions" element={<TgInterventions />} />
        <Route path="agent" element={<TgAgent />} />
        <Route path="whatif" element={<TgWhatIf />} />
        <Route path="attendance" element={<TgAttendance />} />
        <Route path="marks" element={<TgMarks />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}

