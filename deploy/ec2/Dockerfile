FROM node:22.19.0-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN mkdir -p .openai
COPY deploy/ec2/hosting.json ./.openai/hosting.json
RUN npm run build

FROM node:22.19.0-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl dumb-init jq \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 quantscope \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/quantscope quantscope

WORKDIR /app

COPY --from=build --chown=quantscope:quantscope /app/dist ./dist
COPY --from=build --chown=quantscope:quantscope /app/node_modules ./node_modules
COPY --from=build --chown=quantscope:quantscope /app/package.json ./package.json
COPY --from=build --chown=quantscope:quantscope /app/deploy/ec2/scanner-worker.jsonc ./.scanner-worker.jsonc
COPY --from=build --chown=quantscope:quantscope /app/deploy/ec2/scanner-entrypoint.sh /usr/local/bin/quantscope-scanner
COPY --from=build --chown=quantscope:quantscope /app/deploy/ec2/web-entrypoint.sh /usr/local/bin/quantscope-web

RUN chmod 0755 /usr/local/bin/quantscope-scanner /usr/local/bin/quantscope-web

ENV CI=true \
    NODE_ENV=production \
    PORT=8791 \
    PERSIST_DIR=/data \
    SCANNER_SECRET_FILE=/run/secrets/scanner_env \
    WRANGLER_SEND_METRICS=false \
    WRANGLER_WRITE_LOGS=false \
    XDG_CONFIG_HOME=/tmp/quantscope/config

USER quantscope

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/quantscope-scanner"]
