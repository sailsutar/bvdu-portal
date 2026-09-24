import { Outlet, Navigate } from "react-router-dom";
import { PortalShell } from "@/components/portal/PortalShell";
import { adminNav } from "@/components/portal/nav";
import { useSession } from "@/lib/auth";

function AdminLayout() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session || session.role !== "admin") return <Navigate to="/login/admin" />;
  return (
    <PortalShell
      nav={adminNav}
      user={{ name: session.name, subtitle: `Head of Department · ${session.id}` }}
    >
      <Outlet />
    </PortalShell>
  );
}

export default AdminLayout;
