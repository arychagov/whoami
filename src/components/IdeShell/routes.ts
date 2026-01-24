import type { FileId } from "./fileTree";

export function fileIdToPath(id: FileId): string {
  switch (id) {
    case "about.md":
      return "/main/about.md";
    case "projects.md":
      return "/main/projects.md";
    case "speeches.md":
      return "/main/speeches.md";
    case "dice.tool":
      return "/tools/roll";
    case "json.tool":
      return "/tools/json-formatter";
    case "urlcodec.tool":
      return "/tools/url-encode-decode";
    default: {
      // Exhaustiveness
      const _never: never = id;
      return _never;
    }
  }
}

export function pathToFileId(pathname: string): FileId | null {
  const clean = pathname.split("?")[0].split("#")[0];
  if (clean === "/") return "about.md";

  if (clean.startsWith("/main/")) {
    const page = decodeURIComponent(clean.slice("/main/".length));
    if (page === "about.md") return "about.md";
    if (page === "projects.md") return "projects.md";
    if (page === "speeches.md") return "speeches.md";
    return null;
  }

  if (clean.startsWith("/tools/")) {
    const tool = decodeURIComponent(clean.slice("/tools/".length));
    if (tool === "roll") return "dice.tool";
    if (tool === "json-formatter") return "json.tool";
    if (tool === "url-encode-decode") return "urlcodec.tool";
    return null;
  }

  return null;
}

