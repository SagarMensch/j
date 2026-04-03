import { UploadConsole } from "@/components/upload/UploadConsole";
import { fetchAnalyses } from "@/lib/api";

export default async function SubmitterUploadPage() {
  const history = await fetchAnalyses(6).catch(() => ({
    page: 1,
    page_size: 6,
    total: 0,
    items: [],
  }));

  return <UploadConsole initialRecentUploads={history.items} />;
}
