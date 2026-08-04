Runtime files in `public/` are served without rebuilding the app.

## How it works

Files under `public/` are available at the site root:

- `public/cv.pdf` → `https://your-domain/cv.pdf`
- `public/handsome_devil.jpeg` → `https://your-domain/handsome_devil.jpeg`
- `public/projects/photo.png` → `https://your-domain/projects/photo.png`

In Docker Compose, `./public` is mounted into **nginx** (and the app). Nginx reads files from disk on each request.

## On the server

From the project directory (where `docker-compose.yml` lives):

```bash
cp /path/to/cv.pdf public/cv.pdf
cp /path/to/photo.jpeg public/handsome_devil.jpeg
```

No rebuild needed. After the first deploy with volume mounts, no container restart is required either.

## One-time setup after pulling changes

If you just added the volume mounts, recreate containers once:

```bash
docker compose up -d --force-recreate nginx app
```

No `--build` required just for adding files to `public/`.

## Verify files are visible inside the container

```bash
# from the project directory
ls -la public/
docker compose exec nginx ls -la /var/www/public/
curl -I https://your-domain/cv.pdf
```

If the file is on the host but not in the container listing, `docker compose` was run from the wrong directory or containers were not recreated.

## Local dev

`npm run dev` reads `public/` from disk on every request — just add or replace files there.

## Local Docker (without Compose)

```bash
docker run --rm -p 3000:3000 -v "$(pwd)/public:/app/public:ro" whoami
```

## Notes

- Files tracked in git (icons, dice SVGs, `robots.txt`, etc.) live in `public/` too — keep that folder when deploying.
- Large or private assets (CV, photos) are usually added only on the server and left out of git.
