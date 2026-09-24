import { Outlet, Navigate } from "react-router-dom";
import { PortalShell } from "@/components/portal/PortalShell";
import { sysadminNav } from "@/components/portal/nav";
import { useSession } from "@/lib/auth";

export default function SysadminLayout() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session || session.role !== "system_admin") {
    return <Navigate to="/login/system-admin" replace />;
  }
  return (
    <PortalShell
      nav={sysadminNav}
      user={{
        name: session.name,
        subtitle: `System Administrator · ${session.id}`,
      }}
    >
      <Outlet />
    </PortalShell>
  );
}
