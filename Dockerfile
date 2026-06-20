# Avow agent backend. Runs the agent server that powers the hosted app: claim a DeepBook agent,
# instruct it in plain English, and the developer-console endpoints (grant, verify, memory).
#
# The dashboard's verify path reads Sui and Walrus directly and needs none of this; only the agent
# console (/?console) and developer console (/?dev) talk to this server.
FROM node:20-slim

WORKDIR /app

# Install the workspace from the lockfile. The agent imports avow-sdk, so the whole workspace is
# installed; the SDK is then built so the agent loads compiled output.
COPY . .
RUN npm ci && npm -w avow-sdk run build

# Defaults; override the secrets and origin at runtime (see deploy/.env.example).
ENV NODE_ENV=production
ENV AGENT_PORT=8787
ENV AVOW_AGENTS_FILE=/data/agents.json

# Claimed-agent state (their signing keys) persists here across restarts. Mount a volume.
VOLUME ["/data"]
EXPOSE 8787

# tsx runs the TypeScript entrypoint directly, no separate build step for the agent.
CMD ["npx", "tsx", "packages/agent/scripts/agent-server.ts"]
