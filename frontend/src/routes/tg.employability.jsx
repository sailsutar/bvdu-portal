import { CohortEmployabilityTable } from "@/components/employability/EmployabilityDashboard";

export default function TgEmployabilityPage() {
  return (
    <CohortEmployabilityTable
      endpoint="/api/employability/dashboard/faculty"
      title="Teacher Guide — assigned cohort employability"
    />
  );
}
