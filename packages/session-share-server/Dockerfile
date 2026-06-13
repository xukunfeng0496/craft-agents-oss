# CVTE session-share backend — the /s/api store behind apps/viewer.
# Build context = this package directory (packages/session-share-server).
FROM oven/bun:1.3-slim

WORKDIR /app

# Install only this package's deps (no monorepo workspace needed at runtime —
# the server has no workspace imports, just @aws-sdk/client-s3).
COPY package.json ./
RUN bun install --production

COPY src ./src

ENV PORT=8787
EXPOSE 8787

# Liveness: GET /healthz
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/index.ts"]
