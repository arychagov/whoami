import { IdeShell } from "@/components/IdeShell/IdeShell";
import type { Metadata } from "next";

function capitalizeFirst(s: string) {
  if (!s) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

const TOOL_TITLES: Record<string, string> = {
  roll: "Roll",
  "json-formatter": "JSON Formatter",
  "url-encode-decode": "URL encode/decode",
  "w40k-calculator": "W40K Calculator"
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  roll: "Fast dice rolls in the browser.",
  "json-formatter": "Format and prettify JSON.",
  "url-encode-decode": "Encode/decode text for URLs.",
  "w40k-calculator": "Damage calculator for Warhammer 40K (9th edition)."
};

export async function generateMetadata({
  params
}: {
  params: Promise<{ tool: string }>;
}): Promise<Metadata> {
  const { tool } = await params;
  const decoded = decodeURIComponent(tool);
  const title = TOOL_TITLES[decoded] ?? capitalizeFirst(decoded);
  return {
    title,
    description: TOOL_DESCRIPTIONS[decoded] ?? `Tool: ${title}.`
  };
}

export default async function ToolsPage({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  return <IdeShell initialPath={`/tools/${tool}`} />;
}

