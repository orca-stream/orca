# Orca'H&M server. Build from the repository root:
#   docker build -f apps/hm-server/Dockerfile -t orca-hm .
FROM node:24-trixie-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# VP_GIT_HOOKS=0: the `prepare` script would otherwise try to install git hooks.
ENV VP_GIT_HOOKS=0
RUN pnpm install --frozen-lockfile --filter @orca/hm-server... \
 && pnpm --filter @orca/hm-server build \
 && pnpm --filter @orca/hm-server deploy --prod /out

FROM node:24-trixie-slim
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /media/tv \
 && chown -R node:node /data /media
WORKDIR /app
COPY --from=build /out ./
USER node
VOLUME ["/data", "/media/tv"]
ENV DB_FILE=/data/hm.sqlite MEDIA_ROOT=/media/tv HOST=0.0.0.0 PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["tini","--"]
CMD ["node","dist/main.mjs"]
