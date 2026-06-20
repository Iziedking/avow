# Deploying Avow

Two pieces. The **frontend** is static and deploys on Vercel. The **backend** (the agent server) runs
in Docker on a small VPS behind Caddy. The verify dashboard reads Sui and Walrus directly, so it
works with the frontend alone; only the agent console (`/?console`) and developer console (`/?dev`)
need the backend.

```
avow.site        -> Vercel (the web app, static)
api.avow.site    -> VPS    -> Caddy (TLS) -> agent container :8787
```

## DNS

- `avow.site` and `www.avow.site` -> Vercel (Vercel shows the exact records when you add the domain).
- `api.avow.site` -> an A record pointing at your VPS IP.

## Frontend (Vercel)

1. Import the GitHub repo into Vercel. `vercel.json` already sets the install/build/output for the
   monorepo, leave the project Root Directory as the repo root.
2. Add an environment variable (Production and Preview):
   - `VITE_AGENT_API = https://api.avow.site`
3. Add the `avow.site` domain to the project.
4. Push to `main`; Vercel builds and deploys automatically.

If you only do this step, judges still get the landing page, the docs, and the full verify
dashboard. The live agent typing needs the backend below.

## Backend (VPS, Docker, Caddy)

One-time setup on the VPS (Docker and the compose plugin installed):

```bash
mkdir -p ~/avow-deploy && cd ~/avow-deploy
# copy deploy/docker-compose.yml and deploy/Caddyfile here
cp /path/to/repo/deploy/docker-compose.yml .
cp /path/to/repo/deploy/Caddyfile .
cp /path/to/repo/deploy/.env.example .env   # then fill in the real secrets

# log in once so the box can pull the private image (use a GitHub PAT with read:packages)
echo "$GHCR_PAT" | docker login ghcr.io -u iziedking --password-stdin

docker compose up -d
```

Fill `~/avow-deploy/.env` from `deploy/.env.example`: `AVOW_KEY`, `ANTHROPIC_API_KEY`,
`MEMWAL_PRIVATE_KEY`, `MEMWAL_ACCOUNT_ID`, and `AVOW_CORS_ORIGIN=https://avow.site`.

Caddy provisions TLS for `api.avow.site` on first request. Check it: `curl https://api.avow.site/health`.

## CI/CD (GitHub Actions)

`.github/workflows/deploy-agent.yml` builds the image, pushes it to GHCR, and rolls it out on the
VPS on every push to `main` that touches the backend. Add these repo secrets:

- `VPS_HOST` — the VPS IP or hostname
- `VPS_USER` — the SSH user
- `VPS_SSH_KEY` — a private key the VPS authorizes (its public half in `~/.ssh/authorized_keys`)

The workflow runs `docker compose pull && docker compose up -d` in `~/avow-deploy`, so keep the
compose file, Caddyfile, and `.env` there. The frontend needs no workflow; Vercel's git integration
redeploys on push.

## A word on the platform key

The backend holds the platform wallet (`AVOW_KEY`) and signs claims, funding, and admin actions for
the testnet demo. On a public box that key is reachable by whatever traffic hits the server. For a
judge-facing testnet deploy this is acceptable with small reserves, but keep `AVOW_CORS_ORIGIN`
locked to `https://avow.site` and the reserves modest. A production deployment would move signing
behind a KMS and add request auth and rate limiting.
