import { LoginForm } from "@/components/portal/LoginForm";

export default function Page() {
  return (
    <LoginForm
      role="admin"
      title="Head of Department Login"
      subtitle="Full academic administration, intelligence tools, and institutional reports"
      idLabel="Employee identifier"
      idPlaceholder="EMP001"
      redirectTo="/admin"
    />
  );
}
