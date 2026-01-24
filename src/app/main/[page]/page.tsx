import { IdeShell } from "@/components/IdeShell/IdeShell";

export default async function MainPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return <IdeShell initialPath={`/main/${page}`} />;
}

