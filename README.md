# dood — Dog of the Day

A tiny website with one job: show a "dog of the day" photo to everyone who
visits. There's a password-protected admin page to upload a new photo, and
the homepage updates for every visitor as soon as you do.

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
5. Deploy. Your public homepage is the service's Railway URL; the admin upload
   page is `<your-url>/admin`.
