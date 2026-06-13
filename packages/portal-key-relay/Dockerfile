# CVTE portal-key relay — resolves a user's personal CCH key from a portal token.
# Build context = this package directory. No runtime npm deps (Bun built-ins + fetch).
FROM oven/bun:1.3-slim

WORKDIR /app
COPY package.json ./
COPY src ./src

ENV PORT=8788
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8788)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/index.ts"]
