import { Outlet, Navigate } from "react-router-dom";
import { PortalShell } from "@/components/portal/PortalShell";
import { studentNav } from "@/components/portal/nav";
import { useSession } from "@/lib/auth";
import { studentPortalData, useDerived } from "@/lib/upload-stats";

function StudentLayout() {
  const { session, ready } = useSession();
  const { students } = useDerived();
  if (!ready) return null;
  if (!session || session.role !== "student") return <Navigate to="/login/student" />;
  const student = studentPortalData(students, session.id);
  return <PortalShell nav={studentNav} user={{ name: student.name, subtitle: `PRN: ${session.id}` }}>
      <Outlet />
    </PortalShell>;
}

export default StudentLayout;
