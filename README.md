# dood — Dog of the Day

A tiny website with one job: show a "dog of the day" photo to everyone who
visits. It supports manual uploads, public submissions with moderation, and
an autopilot mode that fetches a random dog if nobody's uploaded one.

The **API and image storage run on Railway** (`server.js`), and the
**static frontend (`public/`) is hosted on GitHub Pages**, calling the
Railway API over CORS. You can also just use the Railway URL directly for
everything — GitHub Pages is optional, purely for a nicer/free frontend URL.

## Pages

| Path | What it's for |
|------|----------------|
| `/` | The homepage — shows today's dog, its name, and a caption. Has an "About the Creator" popup and links to the pages below. |
| `/admin/` | Password-protected: upload a dog directly, trigger "Get a random dog now", review/moderate submitted dogs, and change the admin password. |
| `/admin/queue/` | Password-protected: accept or deny dogs submitted via `/request/` before they can go live. |
| `/request/` | Public, no password: anyone can submit a dog photo + name. It sits as "pending" until approved in `/admin/queue/`. |
| `/history/` | Public: a grid of past dogs of the day. |

## How a new "dog of the day" gets picked

1. **Manual upload** (`/admin/`) always wins immediately — whatever you upload becomes the current dog right away.
2. **The queue**: dogs submitted via `/request/` start "pending" and don't show up anywhere public until you **accept** them in `/admin/queue/`. Denying one deletes it.
3. **Autopilot** advances to the next dog either automatically (once per day, in the few minutes after local midnight, only if nobody's uploaded that day) or on demand via the "🎲 Get a random dog now" button in `/admin/`. Either way, it first checks the queue for the oldest **approved** submission; only if there isn't one does it fetch a random dog photo from the free [Dog CEO API](https://dog.ceo/dog-api/) and pair it with a random name from a built-in list (that API has no real names or dogs — the photo is real, the name is made up).
4. Whatever dog gets replaced is archived into `/history/` (its photo is kept, not deleted) instead of being thrown away, capped at `HISTORY_MAX_ENTRIES` (oldest dropped first).

## Running locally

```bash
npm install
ADMIN_PASSWORD=changeme npm start
```

Then open `http://localhost:3000` and the pages listed above. Uploaded
photos and all the JSON state (current dog, history, queue, changed
password) live under `data/` (gitignored) so they survive local restarts.

## Environment variables

| Variable              | Description                                   |
|------------------------|------------------------------------------------|
| `ADMIN_PASSWORD`       | Initial admin password. Can be changed later from `/admin/` (see below); this env var is only the fallback used when no password has been changed yet. |
| `PORT`                 | Port to listen on (Railway sets this automatically). |
| `DATA_DIR`             | Where uploaded photos and all JSON state are stored. Defaults to `./data`. |
| `CORS_ORIGIN`          | Origin allowed to call the API (e.g. `https://<you>.github.io`). Defaults to `*`. |
| `AUTOPILOT_ENABLED`    | Set to `false` to disable automatic picks entirely (manual upload and the queue still work). Defaults to enabled. |
| `HISTORY_MAX_ENTRIES`  | How many past dogs to keep in `/history/` before dropping the oldest. Defaults to `60`. |

## Changing the admin password

Go to `/admin/`, scroll to **Change password**, and enter the current
password plus a new one. This is stored as a salted hash in `DATA_DIR`, so
**without a persistent volume on Railway, it reverts to `ADMIN_PASSWORD` on
the next restart** — same limitation as the current photo and queue (see
below).

## Deploying to Railway

1. Push this repo to GitHub (already done if you're reading this from there).
2. In Railway, create a new project → **Deploy from GitHub repo** → pick this repo.
   Railway will detect the Node app via Nixpacks and use `railway.toml` for the
   start command automatically.
3. Set the `ADMIN_PASSWORD` environment variable in the Railway service settings.
4. **Recommended:** Railway's filesystem is ephemeral across deploys/restarts.
   Add a [Volume](https://docs.railway.com/reference/volumes) to the service and
   mount it at `/app/data`, then set `DATA_DIR=/app/data`. Without this, every
   restart wipes the current photo, history, queue, and any changed password
   back to their defaults.
5. Deploy. Note the Railway URL Railway gives you (e.g.
   `https://dood-production.up.railway.app`) — you'll need it below. At this
   point the app already fully works at that URL directly; GitHub Pages below
   is just for a nicer frontend URL.

## Hosting the frontend on GitHub Pages

The frontend in `public/` talks to the Railway API via `public/config.js`,
so it can be hosted separately as a static site.

1. Edit `public/config.js` and set `window.DOOD_API_BASE` to your Railway
   URL from above, e.g.:
   ```js
   window.DOOD_API_BASE = 'https://dood-production.up.railway.app';
   ```
   Commit and push this change.
2. On Railway, set `CORS_ORIGIN` to your Pages URL, typically
   `https://<your-github-username>.github.io` (no trailing slash).
3. In the GitHub repo, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**. This is a one-time manual step.
4. Pushing to `main` (or running the workflow manually from the **Actions**
   tab) triggers `.github/workflows/pages.yml`, which publishes `public/` to
   GitHub Pages.
5. Your site is now live at `https://<your-github-username>.github.io/dood/`,
   backed by the Railway API.
