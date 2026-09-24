import { LoginForm } from "@/components/portal/LoginForm";

export default function Page() {
  return (
    <LoginForm
      role="student"
      title="Student Login"
      subtitle="Sign in with your Permanent Registration Number. Use the password issued by the department (change it under Settings after first login). Academic data appears after the department uploads marks."
      idLabel="Permanent Registration Number"
      idPlaceholder="Enter your Permanent Registration Number"
      redirectTo="/student"
    />
  );
}
