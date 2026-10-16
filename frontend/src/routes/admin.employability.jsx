import { CohortEmployabilityTable, AdminEmployabilityHealth } from "@/components/employability/EmployabilityDashboard";

export default function AdminEmployabilityPage() {
  return (
    <div className="space-y-8">
      <CohortEmployabilityTable endpoint="/api/employability/dashboard/hod" title="Department employability overview" />
      <AdminEmployabilityHealth />
    </div>
  );
}
