# dood — Dog of the Day

A tiny website with one job: show a "dog of the day" photo to everyone who
visits. There's a password-protected admin page to upload a new photo, and
the homepage updates for every visitor as soon as you do.

The **API and image storage run on Railway** (`server.js`), and the
**static frontend (`public/`) is hosted on GitHub Pages**, calling the
Railway API over CORS. You can also just use the Railway URL directly for
both — GitHub Pages is optional, purely for a nicer/free frontend URL.

## Running locally

```bash
npm install
ADMIN_PASSWORD=changeme npm start
```

Then open:

- `http://localhost:3000` — the public homepage
- `http://localhost:3000/admin` — upload a new dog photo (needs the password)

Uploaded photos and the "current dog" record are stored under `data/`
(gitignored) so they survive restarts locally.

## Environment variables

| Variable         | Description                                   |
|------------------|------------------------------------------------|
| `ADMIN_PASSWORD` | Password required to upload a new photo. Set this to something real in production. |
| `PORT`           | Port to listen on (Railway sets this automatically). |
| `DATA_DIR`       | Where uploaded photos and metadata are stored. Defaults to `./data`. |
| `CORS_ORIGIN`    | Origin allowed to call the API (e.g. `https://<you>.github.io`). Defaults to `*`. |

## Deploying to Railway

1. Push this repo to GitHub (already done if you're reading this from there).
2. In Railway, create a new project → **Deploy from GitHub repo** → pick this repo.
   Railway will detect the Node app via Nixpacks and use `railway.toml` for the
   start command automatically.
3. Set the `ADMIN_PASSWORD` environment variable in the Railway service settings.
4. **Important:** Railway's filesystem is ephemeral across deploys/restarts. Add a
   [Volume](https://docs.railway.com/reference/volumes) to the service and mount
   it at `/app/data`, then set `DATA_DIR=/app/data`. This keeps uploaded photos
   around instead of losing them on the next deploy.
5. Deploy. Note the Railway URL Railway gives you (e.g.
   `https://dood-production.up.railway.app`) — you'll need it below. At this
   point the app already fully works at that URL (`/` and `/admin`); GitHub
   Pages below is just for a nicer frontend URL.

## Hosting the frontend on GitHub Pages

The frontend in `public/` talks to the Railway API via `public/config.js`,
so it can be hosted separately as a static site.

1. Edit `public/config.js` and set `window.DOOD_API_BASE` to your Railway
   URL from above, e.g.:
   ```js
   window.DOOD_API_BASE = 'https://dood-production.up.railway.app';
   ```
   Commit and push this change.
2. On Railway, set `CORS_ORIGIN` to your future Pages URL, typically
   `https://<your-github-username>.github.io` (no trailing slash).
3. In the GitHub repo, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**. This is a one-time manual step.
4. Pushing to `main` (or running the workflow manually from the **Actions**
   tab) triggers `.github/workflows/pages.yml`, which publishes `public/` to
   GitHub Pages.
5. Your site is now live at `https://<your-github-username>.github.io/dood/`
   (homepage) and `.../admin` (upload page), backed by the Railway API.
