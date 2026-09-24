import { Outlet, Navigate } from "react-router-dom";
import { PortalShell } from "@/components/portal/PortalShell";
import { parentNav } from "@/components/portal/nav";
import { useSession } from "@/lib/auth";

export default function ParentLayout() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session || session.role !== "parent") return <Navigate to="/login/parent" replace />;
  return (
    <PortalShell
      nav={parentNav}
      user={{
        name: session.name || "Parent",
        subtitle: session.parentPhone ? `Mobile · ${session.parentPhone}` : "Parent portal",
      }}
    >
      <Outlet />
    </PortalShell>
  );
}
