import { Link } from "react-router-dom";
import { Database } from "lucide-react";
import { SectionCard } from "./PortalShell";
function NoData({ message }) {
  return <SectionCard>
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Database className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground max-w-md">
          {message ?? "No Excel data uploaded yet. Upload a spreadsheet to populate this section."}
        </p>
        <Link
    to="/sysadmin/upload-data"
    className="rounded-md bg-gold px-4 py-2 text-xs font-semibold text-navy hover:bg-gold-soft"
  >
          Upload Excel Data
        </Link>
      </div>
    </SectionCard>;
}
export {
  NoData
};
