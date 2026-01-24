export function AboutPage() {
  return (
    <section className="aboutTop">
      <div className="aboutRight">
        <img className="aboutPhoto" src="/handsome_devil.jpeg" alt="Anton Rychagov" />
      </div>

      <div className="aboutLeft">
        <h1 className="aboutH1">Anton Rychagov</h1>
        <p className="aboutBio">
          Senior Android Engineer &amp; Engineering Manager with 10+ years of experience building
          high-performance mobile applications at scale. Strong background in Android architecture,
          Kotlin/Java, team leadership, and developer tooling. Focused on building reliable,
          testable, and maintainable systems.
        </p>
        <p className="aboutLinks">
          <a className="aboutLink" href="/cv.pdf" target="_blank" rel="noreferrer">
            My CV
          </a>
        </p>
      </div>
    </section>
  );
}

