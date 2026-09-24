import { LoginForm } from "@/components/portal/LoginForm";

export default function LoginPlacementCoordinator() {
  return (
    <LoginForm
      role="placement_coordinator"
      title="Placement Coordinator"
      subtitle="Collect and verify student employability profiles"
      idLabel="Coordinator ID"
      idPlaceholder="PC001"
      passwordPlaceholder="Coordinator password"
      redirectTo="/placement-coordinator"
    />
  );
}
