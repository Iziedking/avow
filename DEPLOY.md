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

## Backend (VPS, Docker)

This VPS already runs a Caddy (it serves other sites too), so Avow does NOT run its own Caddy. The
agent joins the existing Caddy's Docker network (`deploy_default`) and the existing Caddy proxies
`api.avow.site` to it. One Caddy on the box, never two fighting for ports 80/443.

One-time setup on the VPS (Docker and the compose plugin installed):

```bash
mkdir -p ~/avow-deploy && cd ~/avow-deploy
cp /path/to/repo/deploy/docker-compose.yml .         # the shared-Caddy compose (no Caddy service)
cp /path/to/repo/deploy/.env.example .env            # then fill in the real secrets

# log in once so the box can pull the private image (a GitHub PAT with read:packages)
echo "$GHCR_PAT" | docker login ghcr.io -u iziedking --password-stdin

docker compose up -d
```

Fill `~/avow-deploy/.env` from `deploy/.env.example`: `AVOW_KEY`, `ANTHROPIC_API_KEY`,
`MEMWAL_PRIVATE_KEY`, `MEMWAL_ACCOUNT_ID`, and `AVOW_CORS_ORIGIN=https://avow.site`.

Then add ONE site block to the existing Caddy's config and reload it (do this once):

```bash
printf '\napi.avow.site {\n\treverse_proxy avow-agent:8787\n}\n' >> /opt/arcrun/deploy/Caddyfile
docker exec arcrun-caddy caddy reload --config /etc/caddy/Caddyfile
```

The existing Caddy provisions TLS for `api.avow.site` automatically. Check it:
`curl https://api.avow.site/health`. The agent container must be on the same network as that Caddy;
`docker-compose.yml` already sets `networks.proxy.name: deploy_default` for that.

Find the Caddy's network and config path on a different box with:
`docker inspect <caddy-container> -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'`
and `docker inspect <caddy-container> -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'`.

## CI/CD (GitHub Actions)

`.github/workflows/deploy-agent.yml` builds the image, pushes it to GHCR, and rolls it out on the
VPS on every push to `main` that touches the backend. Add these repo secrets:

- `VPS_HOST` — the VPS IP or hostname
- `VPS_USER` — the SSH user
- `VPS_SSH_KEY` — a private key the VPS authorizes (its public half in `~/.ssh/authorized_keys`)

On each push that touches the backend or `deploy/`, the workflow ships the current
`deploy/docker-compose.yml` to `~/avow-deploy/` (scp) and then runs `docker compose pull && up -d`,
so a compose change deploys itself. The `.env` and the Caddy site block stay on the VPS and are not
managed by CI (the `.env` holds secrets; the Caddyfile is shared with the box's other sites). The
frontend needs no workflow; Vercel's git integration redeploys on push.

## A word on the platform key

The backend holds the platform wallet (`AVOW_KEY`) and signs claims, funding, and admin actions for
the testnet demo. On a public box that key is reachable by whatever traffic hits the server. For a
judge-facing testnet deploy this is acceptable with small reserves, but keep `AVOW_CORS_ORIGIN`
locked to `https://avow.site` and the reserves modest. A production deployment would move signing
behind a KMS and add request auth and rate limiting.
