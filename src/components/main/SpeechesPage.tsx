type Talk = {
  title: string;
  event: string;
  year: number;
  href: string;
  description: string;
  youtubeId: string;
  startSeconds?: number;
};

const talks: Talk[] = [
  {
    title: "Algorithms at Yandex",
    event: "Android Broadcast",
    year: 2023,
    href: "https://youtu.be/tfvm2k5c9JI",
    description: "A mock algorithm interview session covering problem solving and approach.",
    youtubeId: "tfvm2k5c9JI"
  },
  {
    title: "Yandex Mobile School",
    event: "Yandex Mobile School",
    year: 2023,
    href: "https://youtu.be/7pbG923ubQE",
    description:
      "An algorithms talk for a junior audience, including a mock interview and practical tips.",
    youtubeId: "7pbG923ubQE"
  },
  {
    title: "Release cycle & automation tooling for Android apps",
    event: "Yandex Saturday",
    year: 2023,
    href: "https://youtu.be/_QE5ttrWTxg?t=7239",
    description:
      "A deep dive into the release cycle for Yandex and Yandex.Browser Android apps, plus the automation and instrumentation we use in production.",
    youtubeId: "_QE5ttrWTxg",
    startSeconds: 7239
  },
  {
    title: "Architecture for juniors",
    event: "Yandex Mobile School",
    year: 2024,
    href: "https://www.youtube.com/watch?v=Rtwx36jKjDQ",
    description: "An introductory architecture talk for a junior audience.",
    youtubeId: "Rtwx36jKjDQ"
  },
  {
    title: "Algorithms for juniors",
    event: "Yandex Mobile School",
    year: 2022,
    href: "https://youtu.be/5BjhC5Iktwg",
    description: "An introductory algorithms talk for a junior audience.",
    youtubeId: "5BjhC5Iktwg"
  },
  {
    title: "Unit testing in Yandex Android application: through fire and flames",
    event: "Yandex.Saturday",
    year: 2017,
    href: "https://www.youtube.com/watch?v=2Wg5f9zakIc",
    description: "A talk on unit testing practices in the Yandex Android application—what worked, what didn’t, and the lessons learned.",
    youtubeId: "2Wg5f9zakIc"
  },
];

function buildEmbedUrl(id: string, startSeconds?: number) {
  const base = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
  if (!startSeconds) return base;
  return `${base}?start=${Math.max(0, Math.floor(startSeconds))}`;
}

export function SpeechesPage() {
  const sortedTalks = [...talks].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year; // newest first
    return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
  });

  return (
    <section className="projectsWrap" aria-label="Speeches">
      <h1 className="projectsH1">Speeches</h1>
      <p className="projectsLead">Public talks and recordings.</p>

      <div className="projectsList" role="list">
        {sortedTalks.map((t) => (
          <article key={t.href} className="projectCard" role="listitem">
            <div className="projectTop">
              <a className="projectTitle" href={t.href} target="_blank" rel="noreferrer">
                {t.title}
              </a>
              <a className="projectLink" href={t.href} target="_blank" rel="noreferrer">
                Open
              </a>
            </div>

            <div className="speechMeta">
              <span className="speechPill">{t.event}</span>
              <span className="speechDot" />
              <span className="speechYear">{t.year}</span>
            </div>

            <div className="projectDesc">{t.description}</div>

            <div className="youtubeEmbed" aria-label={`YouTube player: ${t.title}`}>
              <iframe
                src={buildEmbedUrl(t.youtubeId, t.startSeconds)}
                title={`${t.title} (${t.year})`}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

