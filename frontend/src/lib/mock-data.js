/**
 * DEVELOPMENT-ONLY placeholders.
 * In production builds these exports are empty so no real-looking demo student
 * (Sahil Sutar, 120210001, etc.) can appear. Student announcements and timetable
 * must come from MongoDB via /api/announcements and /api/timetable.
 */

const IS_DEV = import.meta.env.DEV === true;

const emptyStudent = {
  name: "",
  prn: "",
  className: "",
  email: "",
  phone: "",
  attendance: null,
  cgpa: null,
  sgpa: null,
  backlogs: null,
};

const student = IS_DEV
  ? {
      name: "Demo Student",
      prn: "DEV000001",
      className: "TE CSE",
      email: "demo@example.edu",
      phone: "",
      attendance: null,
      cgpa: null,
      sgpa: null,
      backlogs: null,
    }
  : emptyStudent;

const subjects = [];
const sgpaTrend = [];
const marksUT = [];
/** Announcements: always empty here — load from /api/announcements */
const announcements = [];
const assignments = [];
/** Timetable: always empty here — load from /api/timetable */
const timetable = [];
const adminStats = {
  totalStudents: 0,
  totalClasses: 0,
  avgAttendance: 0,
  passPercentage: 0,
  atRisk: 0,
};
const studentsList = [];
const attendanceTrend = [];
const subjectAvgMarks = [];
const feedbackSentiment = [];
const topFeedbackTopics = [];

const demoSystemState = {
  student,
  subjects,
  sgpaTrend,
  marksUT,
  announcements,
  assignments,
  timetable,
  adminStats,
  studentsList,
  attendanceTrend,
  subjectAvgMarks,
  feedbackSentiment,
  topFeedbackTopics,
};

export {
  adminStats,
  announcements,
  assignments,
  attendanceTrend,
  demoSystemState,
  feedbackSentiment,
  marksUT,
  sgpaTrend,
  student,
  studentsList,
  subjectAvgMarks,
  subjects,
  timetable,
  topFeedbackTopics,
};
