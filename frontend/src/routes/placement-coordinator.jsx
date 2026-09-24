import { Outlet, Navigate } from "react-router-dom";
import { PortalShell } from "@/components/portal/PortalShell";
import { pcNav } from "@/components/portal/nav";
import { useSession } from "@/lib/auth";

export default function PlacementCoordinatorLayout() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session || session.role !== "placement_coordinator") {
    return <Navigate to="/login/placement-coordinator" replace />;
  }
  return (
    <PortalShell
      nav={pcNav}
      user={{ name: session.name, subtitle: `Placement Coordinator · ${session.id}` }}
    >
      <Outlet />
    </PortalShell>
  );
}
