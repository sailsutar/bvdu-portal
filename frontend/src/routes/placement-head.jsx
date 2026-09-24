import { Outlet, Navigate } from "react-router-dom";
import { PortalShell } from "@/components/portal/PortalShell";
import { phNav } from "@/components/portal/nav";
import { useSession } from "@/lib/auth";

export default function PlacementHeadLayout() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session || session.role !== "placement_head") {
    return <Navigate to="/login/placement-head" replace />;
  }
  return (
    <PortalShell
      nav={phNav}
      user={{ name: session.name, subtitle: `Placement Head · ${session.id}` }}
    >
      <Outlet />
    </PortalShell>
  );
}
