import { LoginForm } from "@/components/portal/LoginForm";

export default function LoginPlacementHead() {
  return (
    <LoginForm
      role="placement_head"
      title="Placement Head"
      subtitle="Placement readiness, verified profiles, and drive planning"
      idLabel="Placement Head ID"
      idPlaceholder="PH001"
      passwordPlaceholder="Head password"
      redirectTo="/placement-head"
    />
  );
}
