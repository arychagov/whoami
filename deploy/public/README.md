Runtime files in `public/` are served without rebuilding the app.

## How it works

Next.js serves everything under `public/` as static files at the site root:

- `public/cv.pdf` → `https://your-domain/cv.pdf`
- `public/handsome_devil.jpeg` → `https://your-domain/handsome_devil.jpeg`
- `public/projects/photo.png` → `https://your-domain/projects/photo.png`

In Docker Compose, `./public` is mounted into the app container, so files added on the server are picked up immediately.

## On the server

From the project directory:

```bash
cp /path/to/cv.pdf public/cv.pdf
cp /path/to/photo.jpeg public/handsome_devil.jpeg
```

No `docker compose build` or container restart is required.

## Local dev

`npm run dev` already reads `public/` from disk on every request — just add or replace files there.

## Local Docker (without Compose)

```bash
docker run --rm -p 3000:3000 -v "$(pwd)/public:/app/public:ro" whoami
```

## Notes

- Files tracked in git (icons, dice SVGs, `robots.txt`, etc.) live in `public/` too — keep that folder when deploying.
- Large or private assets (CV, photos) are usually added only on the server and left out of git.
