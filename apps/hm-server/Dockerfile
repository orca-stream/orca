# Orca'H&M server and admin panel in one image. Build from the repository root:
#   docker build -f apps/hm-server/Dockerfile -t orca-hm .
# The generic page detector needs Chromium, which is left out unless asked for:
#   docker build -f apps/hm-server/Dockerfile --build-arg WITH_CHROMIUM=1 -t orca-hm .
# (then run with HM_GENERIC_DETECTOR=1, HM_CHROMIUM_PATH=/usr/bin/chromium and the other
# HM_DETECTOR_* variables of .env.example). Debian's Chromium is not the build Playwright pins, and the
# detector can reach what the container can reach: see "Residual risks" in docs/hm-server-design.md.
FROM node:24-trixie-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# VP_GIT_HOOKS=0: the `prepare` script would otherwise try to install git hooks.
ENV VP_GIT_HOOKS=0
RUN pnpm install --frozen-lockfile --filter @orca/hm-server... --filter @orca/hm-web... \
 && pnpm --filter @orca/hm-server build \
 && pnpm --filter @orca/hm-web build \
 && pnpm --filter @orca/hm-server deploy --prod /out

FROM node:24-trixie-slim
ARG WITH_CHROMIUM=0
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && if [ "$WITH_CHROMIUM" = "1" ]; then \
      apt-get install -y --no-install-recommends chromium fonts-liberation; \
    fi \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /media/tv \
 && chown -R node:node /data /media
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/hm-web/dist ./public
USER node
VOLUME ["/data", "/media/tv"]
# Image layout, not host settings. JELLYFIN_URL, JELLYFIN_API_KEY and JELLYFIN_MEDIA_ROOT come from the
# environment the container runs in.
ENV DB_FILE=/data/hm.sqlite MEDIA_ROOT=/media/tv HOST=0.0.0.0 PORT=8787 WEB_ROOT=/app/public
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["tini","--"]
CMD ["node","dist/main.mjs"]
