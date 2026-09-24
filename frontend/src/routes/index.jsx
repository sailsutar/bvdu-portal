import { Link } from "react-router-dom";
import { GraduationCap, User, UsersRound, Shield, Briefcase, ClipboardCheck } from "lucide-react";
import { Logo } from "@/components/portal/Logo";

const ROLES = [
  {
    group: "Learning",
    items: [
      {
        to: "/login/student",
        title: "Student",
        desc: "Marks, attendance and insights",
        icon: GraduationCap,
        accent: false,
      },
      {
        to: "/login/parent",
        title: "Parent",
        desc: "Attendance, marks, placement and notices",
        icon: UsersRound,
        accent: false,
      },
      {
        to: "/login/tg",
        title: "Teacher Guide",
        desc: "Mentees and follow-up",
        icon: UsersRound,
        accent: false,
      },
      {
        to: "/login/admin",
        title: "Head of Department",
        desc: "Academics, analytics and learners",
        icon: User,
        accent: true,
      },
    ],
  },
  {
    group: "Administration",
    items: [
      {
        to: "/login/system-admin",
        title: "System Administrator",
        desc: "Contact details, academic uploads and Teacher Guide setup",
        icon: Shield,
        accent: false,
      },
    ],
  },
  {
    group: "Placement",
    items: [
      {
        to: "/login/placement-coordinator",
        title: "Placement Coordinator",
        desc: "Collect and verify profiles",
        icon: ClipboardCheck,
        accent: false,
      },
      {
        to: "/login/placement-head",
        title: "Placement Head",
        desc: "Readiness and shortlists",
        icon: Briefcase,
        accent: false,
      },
    ],
  },
];

function RoleCard({ to, title, desc, icon: Icon, accent }) {
  return (
    <Link
      to={to}
      className={`bvu-role-tile group flex min-h-[7.5rem] flex-col items-center gap-3 rounded-2xl border p-4 text-center backdrop-blur-md transition-transform duration-300 hover:-translate-y-0.5 sm:min-h-[8.25rem] sm:p-5 ${
        accent
          ? "border-gold/70 bg-gold-soft/90 shadow-md"
          : "border-white/50 bg-white/70 shadow-sm hover:bg-white/85"
      }`}
    >
      <div
        className={`grid h-12 w-12 place-items-center rounded-2xl transition-transform duration-300 group-hover:scale-110 sm:h-14 sm:w-14 ${
          accent ? "bg-white text-navy shadow-sm" : "bg-secondary/80 text-navy group-hover:bg-gold-soft"
        }`}
      >
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <div className="space-y-1 px-1">
        <p className="text-sm font-semibold text-navy">{title}</p>
        <p className="text-[11px] leading-snug text-muted-foreground sm:text-xs">{desc}</p>
      </div>
    </Link>
  );
}

function RoleSelection() {
  return (
    <div className="bvu-login-stage relative flex min-h-[100dvh] flex-col overflow-hidden">
      <video className="bvu-login-video" autoPlay muted loop playsInline aria-hidden="true">
        <source src="/media/campus-bg.mp4" type="video/mp4" />
      </video>
      <div className="bvu-login-video-veil" aria-hidden="true" />

      <div className="relative z-10 flex flex-1 flex-col px-4 py-8 sm:px-8 sm:py-10 lg:px-12">
        <div className="bvu-page-enter mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center">
          <div className="mb-8 text-center text-white sm:mb-10">
            <div className="bvu-scale-in inline-block">
              <Logo variant="light" />
            </div>
            <h1
              className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Welcome
            </h1>
            <p className="mt-2 text-sm text-white/80">
              Sign in with the role that matches your account
            </p>
          </div>

          <div className="bvu-glass-card bvu-stagger space-y-7 p-5 sm:space-y-8 sm:p-8">
            {ROLES.map((section) => (
              <div key={section.group}>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {section.group}
                </p>
                <div
                  className={`grid gap-3 ${
                    section.items.length === 1
                      ? "max-w-sm grid-cols-1"
                      : section.items.length === 2
                        ? "grid-cols-1 xs:grid-cols-2 sm:grid-cols-2"
                        : "grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 lg:grid-cols-3"
                  }`}
                >
                  {section.items.map((role) => (
                    <RoleCard key={role.to} {...role} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-[11px] leading-relaxed text-white/70">
            Use the credentials issued by your department. Your session stays on this browser only.
          </p>
        </div>
      </div>
    </div>
  );
}

export default RoleSelection;
