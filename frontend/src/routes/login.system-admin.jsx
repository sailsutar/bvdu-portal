import { LoginForm } from "@/components/portal/LoginForm";

export default function LoginSystemAdmin() {
  return (
    <LoginForm
      role="system_admin"
      title="System Administrator"
      subtitle="Contact details, background factors, academic uploads, and Teacher Guide assignment"
      idLabel="Admin ID"
      idPlaceholder="ADMIN001"
      passwordPlaceholder="Administrator password"
      redirectTo="/sysadmin"
      demoHint="ADMIN001 · same password as configured (default admin123)"
    />
  );
}
