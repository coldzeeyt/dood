# dood — Dog of the Day

A tiny website with one job: show a "dog of the day" (and "dog of the
week") photo to everyone who visits. Swipe between them on the homepage.
It supports manual uploads, public submissions with moderation, and an
autopilot mode that fetches a random dog if nobody's uploaded one.

The **API runs on Railway** (`server.js`), storing everything — the current
dog, history, the submission queue, the admin password, and the photos
themselves — in a **Postgres database** so it all survives redeploys and
restarts. The **static frontend (`public/`) is hosted on GitHub Pages**,
calling the Railway API over CORS. You can also just use the Railway URL
directly for everything — GitHub Pages is optional, purely for a nicer/free
frontend URL.

## Pages

| Path | What it's for |
|------|----------------|
| `/` | The homepage — swipe (or tap the dots) between the Dog of the Day and Dog of the Week panels. Has an "About the Creator" popup and links to the pages below. |
| `/admin/` | Password-protected: upload a Day dog, upload a Week dog, upload one photo as **both** at once, trigger random picks for either, review/moderate submitted dogs, and change the admin password. |
| `/admin/queue/` | Password-protected: accept or deny dogs submitted via `/request/` before they can go live. |
| `/request/` | Public, no password: anyone can submit a dog photo + name for the **Day** rotation. It sits as "pending" until approved in `/admin/queue/`. |
| `/history/` | Public: a grid of past dogs (both Day and Week transitions). |

## How a new "dog of the day" gets picked

1. **Manual upload** (`/admin/`) always wins immediately — whatever you upload becomes the current dog right away.
2. **The queue**: dogs submitted via `/request/` start "pending" and don't show up anywhere public until you **accept** them in `/admin/queue/`. Denying one deletes it.
3. **Autopilot** advances to the next dog either automatically (once per day, in the few minutes after local midnight, only if nobody's uploaded that day) or on demand via the "🎲 Get a random dog now" button in `/admin/`. Either way, it first checks the queue for the oldest **approved** submission; only if there isn't one does it fetch a random dog photo from the free [Dog CEO API](https://dog.ceo/dog-api/) and pair it with a random name from a built-in list (that API has no real names or dogs — the photo is real, the name is made up).
4. Whatever dog gets replaced is archived into `/history/` (its photo is kept, not deleted) instead of being thrown away, capped at `HISTORY_MAX_ENTRIES` (oldest dropped first).

## Dog of the Week

Works the same way as the Day, independently, with its own upload and its
own "🎲 Get a random week dog now" button in `/admin/` — except there's no
public request queue for it (that's Day-only), so its autopilot always
fetches a fresh random dog rather than checking a queue. It auto-advances
once per week, in the few minutes after local midnight on **Monday**.

To set one photo as both the Day and Week dog at once, use **Update Both
at Once** in `/admin/` — one upload, two rotations updated together.

## Running locally

Requires a Postgres database. If you have one running locally:

```bash
npm install
ADMIN_PASSWORD=changeme DATABASE_URL=postgres://user:pass@localhost:5432/dood npm start
```

Tables are created automatically on startup if they don't exist. Then open
`http://localhost:3000` and the pages listed above.

## Environment variables

| Variable              | Description                                   |
|------------------------|------------------------------------------------|
| `DATABASE_URL`         | Postgres connection string. Required — this is where everything is stored. |
| `ADMIN_PASSWORD`       | Initial admin password. Can be changed later from `/admin/` (see below); this env var is only the fallback used when no password has been changed yet. |
| `PORT`                 | Port to listen on (Railway sets this automatically). |
| `CORS_ORIGIN`          | Origin allowed to call the API (e.g. `https://<you>.github.io`). Defaults to `*`. |
| `AUTOPILOT_ENABLED`    | Set to `false` to disable automatic picks entirely (manual upload and the queue still work). Defaults to enabled. |
| `HISTORY_MAX_ENTRIES`  | How many past dogs to keep in `/history/` before dropping the oldest. Defaults to `60`. |

## Changing the admin password

Go to `/admin/`, scroll to **Change password**, and enter the current
password plus a new one. This is stored as a salted hash in the database,
so it persists across restarts and redeploys just like everything else.

## Deploying to Railway

1. Push this repo to GitHub (already done if you're reading this from there).
2. In Railway, create a new project → **Deploy from GitHub repo** → pick this repo.
   Railway will detect the Node app via Nixpacks and use `railway.toml` for the
   start command automatically.
3. Add a **Postgres database** to the same project: **+ New → Database → Add
   PostgreSQL**. Railway provisions it as its own persistent service.
4. In your app service's **Variables** tab, add a reference to the Postgres
   database's connection string as `DATABASE_URL` (Railway usually offers this
   as "Add Reference" when you start typing a variable name — pick the
   Postgres service's `DATABASE_URL`).
5. Set the `ADMIN_PASSWORD` environment variable in the app service too.
6. Deploy. Note the Railway URL Railway gives you (e.g.
   `https://dood-production.up.railway.app`) — you'll need it below. At this
   point the app already fully works at that URL directly; GitHub Pages below
   is just for a nicer frontend URL.

Because everything lives in Postgres (a separate, persistent Railway
service), the current dog, history, queue, and password all survive app
redeploys and restarts — no volume needed.

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
