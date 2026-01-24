import { IdeShell } from "@/components/IdeShell/IdeShell";

export default async function ToolsPage({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  return <IdeShell initialPath={`/tools/${tool}`} />;
}

