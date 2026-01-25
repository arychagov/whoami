"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fileSection, mainTree, pages, toolsTree, type FileId, type TreeNode } from "./fileTree";
import { UrlCodecTool } from "@/components/tools/UrlCodecTool";
import { DiceTool } from "@/components/tools/DiceTool";
import { JsonFormatterTool } from "@/components/tools/JsonFormatterTool";
import { W40kCalculatorTool } from "@/components/tools/W40kCalculatorTool";
import { AboutPage } from "@/components/main/AboutPage";
import { ProjectsPage } from "@/components/main/ProjectsPage";
import { SpeechesPage } from "@/components/main/SpeechesPage";
import { fileIdToPath, pathToFileId } from "./routes";

type LeftMode = "main" | "tools";

type Tab = {
  id: FileId;
};

function fileIconSrcFor(id: FileId) {
  return fileSection[id] === "tools" ? "/icons/tool-terminal.svg" : "/icons/file.svg";
}

function Tree({
  nodes,
  indent,
  active,
  onOpenFile
}: {
  nodes: TreeNode[];
  indent: number;
  active: FileId | null;
  onOpenFile: (id: FileId) => void;
}) {
  return (
    <>
      {nodes.map((n) => {
        const isActive = active != null && n.id === active;
        return (
          <div
            key={n.id}
            className={`treeNode ${isActive ? "treeNodeActive" : ""}`}
            role="treeitem"
            onClick={() => onOpenFile(n.id)}
          >
            {Array.from({ length: indent }).map((_, i) => (
              <span key={i} className="treeIndent" />
            ))}
            <img className="treeIconImg" src={fileIconSrcFor(n.id)} alt="" />
            <span>{n.name}</span>
          </div>
        );
      })}
    </>
  );
}

export function IdeShell({ initialPath }: { initialPath?: string }) {
  const router = useRouter();
  const pathname = usePathname();

  const bootId = pathToFileId(initialPath ?? pathname) ?? "about.md";
  const bootSection = fileSection[bootId];

  // Current section = what is rendered in the editor + tabs.
  const [mode, setMode] = useState<LeftMode>(bootSection);
  // Panel section = what is shown in the left tool window / mobile drawer.
  const [panelMode, setPanelMode] = useState<LeftMode>(bootSection);
  const [mainActive, setMainActive] = useState<FileId>(
    bootSection === "main" ? bootId : "about.md"
  );
  const [mainTabs, setMainTabs] = useState<Tab[]>([
    { id: "about.md" },
    { id: "projects.md" },
    { id: "speeches.md" }
  ]);
  const [toolsActive, setToolsActive] = useState<FileId>(
    bootSection === "tools" ? bootId : "dice.tool"
  );
  const [toolsTabs, setToolsTabs] = useState<Tab[]>([
    { id: "dice.tool" },
    { id: "json.tool" },
    { id: "urlcodec.tool" },
    { id: "w40k.tool" }
  ]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const rawTabs = mode === "main" ? mainTabs : toolsTabs;
  const activeId = mode === "main" ? mainActive : toolsActive;

  const tabs = useMemo(() => {
    return [...rawTabs].sort((a, b) =>
      pages[a.id].title.localeCompare(pages[b.id].title, "en", { sensitivity: "base" })
    );
  }, [rawTabs]);

  const activeTab = useMemo<FileId>(() => {
    const fallback = mode === "main" ? ("about.md" as const) : ("urlcodec.tool" as const);
    return (tabs.find((t) => t.id === activeId)?.id ?? tabs[0]?.id ?? fallback) as FileId;
  }, [tabs, activeId, mode]);

  // Sync state from URL (supports back/forward).
  useEffect(() => {
    const id = pathToFileId(pathname);
    if (!id) return;

    const section = fileSection[id];
    setMode(section);
    setPanelMode(section);
    if (section === "main") setMainActive(id);
    else setToolsActive(id);
  }, [pathname]);

  function openFile(id: FileId) {
    const section = fileSection[id];
    if (section !== mode) setMode(section);
    setPanelMode(section);

    if (section === "main") {
      setMainActive(id);
      setMainTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id }]));
    } else {
      setToolsActive(id);
      setToolsTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id }]));
    }
    setDrawerOpen(false);

    const target = fileIdToPath(id);
    if (pathname !== target) router.push(target);
  }

  // Socials via Simple Icons CDN (monochrome SVG). Update hrefs with your handles.
  const socials: Array<{ key: string; label: string; href: string; iconSrc: string }> = [
    {
      key: "tg",
      label: "Telegram",
      href: "https://t.me/arychagov",
      iconSrc: "https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/telegram.svg"
    },
    {
      key: "li",
      label: "LinkedIn",
      href: "https://www.linkedin.com/in/antonrychagov/",
      iconSrc: "https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/linkedin.svg"
    },
    {
      key: "gh",
      label: "GitHub",
      href: "https://github.com/arychagov",
      iconSrc: "https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/github.svg"
    },
    {
      key: "ig",
      label: "Instagram",
      href: "https://www.instagram.com/arychagov/",
      iconSrc: "https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/instagram.svg"
    },
    {
      key: "gm",
      label: "Gmail",
      href: "mailto:anton.rychagov@gmail.com",
      iconSrc: "https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/gmail.svg"
    }
  ];

  const page = pages[activeTab];
  const leftTitle = panelMode === "main" ? "Main" : "Tools";
  const leftNodes = panelMode === "main" ? mainTree : toolsTree;
  const panelActiveId = panelMode === mode ? activeId : null;

  return (
    <>
      {drawerOpen ? <div className="drawerBackdrop" onClick={() => setDrawerOpen(false)} /> : null}

      <div className="appShell">
        <aside className="panel">
          <div className="iconBar" aria-label="Left navigation">
            <button
              className={`iconBtn ${panelMode === "main" ? "iconBtnActive" : ""}`}
              aria-label="Main"
              onClick={() => {
                setPanelMode("main");
                setDrawerOpen(isMobile ? true : false);
              }}
              title="Main"
            >
              <img className="uiIcon" src="/icons/main.svg" alt="" />
            </button>
            <button
              className={`iconBtn ${panelMode === "tools" ? "iconBtnActive" : ""}`}
              aria-label="Tools"
              onClick={() => {
                setPanelMode("tools");
                setDrawerOpen(isMobile ? true : false);
              }}
              title="Tools"
            >
              <img className="uiIcon" src="/icons/tools.svg" alt="" />
            </button>
          </div>
        </aside>

        {/* Desktop tree */}
        <aside className="panel treePanel" aria-label="Side tool window">
          <div className="treeWrap">
            <div className="treeHeader">
              <div className="treeTitle">{leftTitle}</div>
              <button className="iconBtn mobileTreeToggle" onClick={() => setDrawerOpen(false)}>
                <img className="uiIcon" src="/icons/close.svg" alt="" />
              </button>
            </div>
            <div className="tree" role="tree" aria-label={`${leftTitle} tree`}>
              <Tree nodes={leftNodes} indent={0} active={panelActiveId} onOpenFile={openFile} />
            </div>
          </div>
        </aside>

        {/* Mobile drawer */}
        {drawerOpen ? (
          <aside className="drawer" aria-label="Mobile tool window">
            <div className="treeWrap">
              <div className="treeHeader">
                <div className="treeTitle">{leftTitle}</div>
                <button className="iconBtn" onClick={() => setDrawerOpen(false)} aria-label="Close">
                  <img className="uiIcon" src="/icons/close.svg" alt="" />
                </button>
              </div>
              <div className="tree" role="tree" aria-label={`${leftTitle} tree (mobile)`}>
                <Tree nodes={leftNodes} indent={0} active={panelActiveId} onOpenFile={openFile} />
              </div>
            </div>
          </aside>
        ) : null}

        <main className="editor" aria-label="Editor">
          {/* In mobile, hint how to open the drawer */}
          <div className="tabs" role="tablist" aria-label="Editor tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`tab ${t.id === activeId ? "tabActive" : ""}`}
                onClick={() => {
                  openFile(t.id);
                }}
                type="button"
              >
                <span>{pages[t.id].title}</span>
              </button>
            ))}
          </div>

          <div className="editorBody" role="document" aria-label="Editor content">
            {activeTab === "about.md" ? (
              <AboutPage />
            ) : activeTab === "projects.md" ? (
              <ProjectsPage />
            ) : activeTab === "speeches.md" ? (
              <SpeechesPage />
            ) : page.language === "tool" ? (
              activeTab === "urlcodec.tool" ? (
                <UrlCodecTool />
              ) : activeTab === "dice.tool" ? (
                <DiceTool />
              ) : activeTab === "json.tool" ? (
                <JsonFormatterTool />
              ) : activeTab === "w40k.tool" ? (
                <W40kCalculatorTool />
              ) : null
            ) : (
              page.lines.map((l, idx) => (
                <div className="codeLine" key={idx}>
                  <div className="ln">{idx + 1}</div>
                  <div className="code">
                    {l.kind ? <span className={l.kind}>{l.text}</span> : l.text}
                  </div>
                </div>
              ))
            )}
          </div>
        </main>

        {/* Desktop-only right toolbar */}
        <aside className="panelRight" aria-label="Social links">
          <div className="rightBar">
            {socials.map((s) => (
              <a
                key={s.key}
                className="iconBtn tooltip"
                href={s.href}
                target="_blank"
                rel="noreferrer"
                data-tip={s.label}
                aria-label={s.label}
                title={s.label}
              >
                <img className="socialIcon" src={s.iconSrc} alt="" width={20} height={20} />
              </a>
            ))}
          </div>
        </aside>
      </div>

      {/* Mobile-only floating dock (About only) */}
      {isMobile && activeTab === "about.md" && !drawerOpen ? (
        <aside className="socialsDockMobile" aria-label="Social links">
          {socials.map((s) => (
            <a
              key={s.key}
              className="iconBtn tooltip"
              href={s.href}
              target="_blank"
              rel="noreferrer"
              data-tip={s.label}
              aria-label={s.label}
              title={s.label}
            >
              <img className="socialIcon" src={s.iconSrc} alt="" width={20} height={20} />
            </a>
          ))}
        </aside>
      ) : null}
    </>
  );
}

