type Project = {
  name: string;
  href: string;
  description: string;
};

const projects: Project[] = [
  {
    name: "Yandex.Browser",
    href: "https://play.google.com/store/apps/details?id=com.yandex.browser&hl=ru",
    description:
      "Chromium-based Android browser by Yandex. Led a 40+ person engineering organization and delivered key user-facing features, including a PDF viewer based on androidx.pdf."
  },
  {
    name: "Yandex",
    href: "https://play.google.com/store/apps/details?id=com.yandex.searchapp&hl=ru",
    description:
      "Yandex’s flagship Android search app. Led a 40+ person engineering organization and shipped major improvements, including a new Kotlin-based backend for the application."
  },
  {
    name: "Discord Drafter",
    href: "https://github.com/arychagov/Discord-Drafter-App",
    description:
      "Designed, built, and hosted a Discord bot for matchmaking drafts. Tracks players looking for a game and generates randomized teams from the participant pool."
  },
  {
    name: "APK Comparator",
    href: "https://github.com/arychagov/apkcomparator",
    description:
      "Python utility built on top of Android SDK’s apkanalyzer. Compares two APKs and highlights build-to-build changes in components and application metadata."
  },
  {
    name: "W40K Gladius — Adeptus Mod",
    href: "https://github.com/arychagov/Adeptus",
    description:
      "Independently developed a gameplay mod for Warhammer 40,000: Gladius — Relics of War game."
  }
];

export function ProjectsPage() {
  return (
    <section className="projectsWrap" aria-label="Projects">
      <h1 className="projectsH1">Projects</h1>
      <p className="projectsLead">A selection of products and side projects I’ve worked on.</p>

      <div className="projectsList" role="list">
        {projects.map((p) => (
          <article key={p.href} className="projectCard" role="listitem">
            <div className="projectTop">
              <a className="projectTitle" href={p.href} target="_blank" rel="noreferrer">
                {p.name}
              </a>
              <a className="projectLink" href={p.href} target="_blank" rel="noreferrer">
                Open
              </a>
            </div>

            <div className="projectMeta">{p.href}</div>

            <div className="projectDesc">{p.description}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

