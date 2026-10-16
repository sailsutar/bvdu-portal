import { CohortEmployabilityTable } from "@/components/employability/EmployabilityDashboard";

export default function PlacementEmployabilityPage() {
  return (
    <CohortEmployabilityTable
      endpoint="/api/employability/dashboard/placement"
      title="Placement — readiness and skill-gap monitoring"
    />
  );
}
