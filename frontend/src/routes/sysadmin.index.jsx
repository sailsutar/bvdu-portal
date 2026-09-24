import { Link } from "react-router-dom";
import { SectionCard } from "@/components/portal/PortalShell";

export default function SysadminIndex() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">System Administrator</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Own institutional master data: academic uploads, contact details, Teacher Guide accounts
          and assignment. Head of Department uses analytics, mentoring, and operations on the data you
          commit.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="Upload academic data">
          <p className="text-sm text-navy/80">
            Attendance and unit-test marks. One file or several batch attendance files plus a master
            marks Excel — joined on Permanent Registration Number.
          </p>
          <Link
            className="mt-3 inline-block text-sm font-semibold text-navy underline"
            to="/sysadmin/upload-data"
          >
            Open upload
          </Link>
        </SectionCard>

        <SectionCard title="Combine attendance and marks">
          <p className="text-sm text-navy/80">
            Optional: merge files and download a single Excel, then commit via Upload academic data.
          </p>
          <Link
            className="mt-3 inline-block text-sm font-semibold text-navy underline"
            to="/sysadmin/combine-data"
          >
            Open combine
          </Link>
        </SectionCard>

        <SectionCard title="Contact details">
          <p className="text-sm text-navy/80">Parent and student mobile, email, WhatsApp for messaging.</p>
          <Link
            className="mt-3 inline-block text-sm font-semibold text-navy underline"
            to="/sysadmin/contacts"
          >
            Open contact details
          </Link>
        </SectionCard>

        <SectionCard title="Background factors">
          <p className="text-sm text-navy/80">
            Entry path, 10th / 12th / CET / JEE / diploma. Partial fills are allowed.
          </p>
          <Link
            className="mt-3 inline-block text-sm font-semibold text-navy underline"
            to="/sysadmin/background"
          >
            Edit background factors
          </Link>
        </SectionCard>

        <SectionCard title="Teacher Guides">
          <p className="text-sm text-navy/80">Create Teacher Guide logins and display names.</p>
          <Link
            className="mt-3 inline-block text-sm font-semibold text-navy underline"
            to="/sysadmin/tg"
          >
            Manage Teacher Guides
          </Link>
        </SectionCard>

        <SectionCard title="Teacher Guide assignment">
          <p className="text-sm text-navy/80">
            Assign each student to one Teacher Guide for the full journey (First Year through Last
            Year). Reassign only when a mentor leaves.
          </p>
          <Link
            className="mt-3 inline-block text-sm font-semibold text-navy underline"
            to="/sysadmin/tg-assign"
          >
            Assign students
          </Link>
        </SectionCard>

        <SectionCard title="Danger zone">
          <p className="text-sm text-navy/80">Clear mistaken uploads or reset selected database categories.</p>
          <Link
            className="mt-3 inline-block text-sm font-semibold text-destructive underline"
            to="/sysadmin/danger"
          >
            Open danger zone
          </Link>
        </SectionCard>
      </div>
    </div>
  );
}
