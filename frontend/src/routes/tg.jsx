import { Outlet, Navigate } from "react-router-dom";
import { PortalShell } from "@/components/portal/PortalShell";
import { tgNav } from "@/components/portal/nav";
import { useSession } from "@/lib/auth";
import { tgBatchLabel } from "@/lib/tg-assign";

function TgLayout() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session || session.role !== "tg") return <Navigate to="/login/tg" replace />;
  const batch = tgBatchLabel(session.tgIndex);
  return (
    <PortalShell
      nav={tgNav}
      user={{
        name: session.name,
        subtitle: `Teacher Guide · ${session.id} · ${batch}`,
      }}
    >
      <Outlet />
    </PortalShell>
  );
}

export default TgLayout;
