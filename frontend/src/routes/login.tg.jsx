import { LoginForm } from "@/components/portal/LoginForm";

export default function Page() {
  return (
    <LoginForm
      role="tg"
      title="Teacher Guide Login"
      subtitle="View your assigned mentees — attendance, marks, and parent messages"
      idLabel="Teacher Guide identifier"
      idPlaceholder="TG001, TG002, or TG003"
      redirectTo="/tg"
    />
  );
}
