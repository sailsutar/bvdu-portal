import { EmployabilityInputWorkspace } from "@/components/employability/EmployabilityInputWorkspace";

/**
 * Staff-only: assessments, intervention results, HITL.
 * Students enter skills via Placement profile (auto-synced).
 */
export default function AdminEmployabilityInputPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Students already enter skill ratings on <strong>Placement profile</strong> — those sync into employability
        automatically. Use this page for verified assessments, next action, and intervention results.
      </p>
      <EmployabilityInputWorkspace mode="staff" defaultPrn="" canEditPrn={true} />
    </div>
  );
}
