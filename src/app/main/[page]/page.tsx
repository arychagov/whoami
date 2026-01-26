import { IdeShell } from "@/components/IdeShell/IdeShell";
import type { Metadata } from "next";

function capitalizeFirst(s: string) {
  if (!s) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

const MAIN_DESCRIPTIONS: Record<string, string> = {
  "about.md": "Personal website of Anton Rychagov.",
  "projects.md": "Projects that I have participated in.",
  "speeches.md": "Talks and public speaking I gave."
};

export async function generateMetadata({
  params
}: {
  params: Promise<{ page: string }>;
}): Promise<Metadata> {
  const { page } = await params;
  const decoded = decodeURIComponent(page);

  if (decoded === "about.md") {
    return {
      title: "Anton Rychagov",
      description: MAIN_DESCRIPTIONS["about.md"]
    };
  }

  const title = decoded.endsWith(".md") ? decoded.slice(0, -".md".length) : decoded;
  const pageTitle = capitalizeFirst(title);
  return {
    title: pageTitle,
    description: MAIN_DESCRIPTIONS[decoded] ?? `${pageTitle}.`
  };
}

export default async function MainPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return <IdeShell initialPath={`/main/${page}`} />;
}

