export type TreeNode =
  | { kind: "file"; name: string; id: FileId };

export type FileId =
  | "about.md"
  | "projects.md"
  | "speeches.md"
  | "json.tool"
  | "urlcodec.tool"
  | "dice.tool";

export type SectionId = "main" | "tools";

export const mainTree: TreeNode[] = [
  { kind: "file", name: "about.md", id: "about.md" },
  { kind: "file", name: "projects.md", id: "projects.md" },
  { kind: "file", name: "speeches.md", id: "speeches.md" }
];

export const toolsTree: TreeNode[] = [
  { kind: "file", name: "JSON Formatter", id: "json.tool" },
  { kind: "file", name: "Roll", id: "dice.tool" },
  { kind: "file", name: "URL encode/decode", id: "urlcodec.tool" }
];

export const fileSection: Record<FileId, SectionId> = {
  "about.md": "main",
  "projects.md": "main",
  "speeches.md": "main",
  "json.tool": "tools",
  "urlcodec.tool": "tools",
  "dice.tool": "tools"
};

export type IdePage = {
  id: FileId;
  title: string;
  language: "md" | "tool";
  lines: Array<{ kind?: "kw" | "str" | "fn" | "cm" | "ty"; text: string }>;
};

export const pages: Record<FileId, IdePage> = {
  "about.md": {
    id: "about.md",
    title: "about.md",
    language: "md",
    lines: [
      { kind: "cm", text: "/**" },
      { kind: "cm", text: " * whoami" },
      { kind: "cm", text: " *" },
      { kind: "cm", text: " * Short intro + photo." },
      { kind: "cm", text: " */" },
      { text: "" },
      { kind: "kw", text: "# Hi!" },
      { text: "This is my personal site styled like Android Studio (Darcula)." },
      { text: "Over time, I’ll be adding small tools you can run right in the browser." },
      { text: "" },
      { kind: "cm", text: "// Photo asset:" },
      { kind: "str", text: "public/myself.jpeg  ->  /myself.jpeg" }
    ]
  },
  "projects.md": {
    id: "projects.md",
    title: "projects.md",
    language: "md",
    lines: [
      { kind: "kw", text: "# Projects" },
      { text: "- Project A — ..." },
      { text: "- Project B — ..." }
    ]
  },
  "speeches.md": {
    id: "speeches.md",
    title: "speeches.md",
    language: "md",
    lines: [{ kind: "cm", text: "/** Speeches page is rendered as a designed view. */" }]
  },
  "json.tool": {
    id: "json.tool",
    title: "JSON Formatter",
    language: "tool",
    lines: [
      { kind: "cm", text: "/**" },
      { kind: "cm", text: " * JSON Formatter" },
      { kind: "cm", text: " *" },
      { kind: "cm", text: " * UI below is interactive." },
      { kind: "cm", text: " */" }
    ]
  },
  "urlcodec.tool": {
    id: "urlcodec.tool",
    title: "URL encode/decode",
    language: "tool",
    lines: [
      { kind: "cm", text: "/**" },
      { kind: "cm", text: " * URL Encode/Decode" },
      { kind: "cm", text: " *" },
      { kind: "cm", text: " * UI below is interactive." },
      { kind: "cm", text: " */" }
    ]
  },
  "dice.tool": {
    id: "dice.tool",
    title: "Roll",
    language: "tool",
    lines: [
      { kind: "cm", text: "/**" },
      { kind: "cm", text: " * Dice Roller" },
      { kind: "cm", text: " *" },
      { kind: "cm", text: " * Supports: Coin(d2), d4, d6, d8, d10, d12, d20, d100" },
      { kind: "cm", text: " */" }
    ]
  }
};

