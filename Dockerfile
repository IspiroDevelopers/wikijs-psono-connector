# SPDX-License-Identifier: AGPL-3.0-only
#
# Sidecar image. Also carries the Wiki.js rendering module under
# /opt/wikijs-psono-connector/wikijs-module for easy extraction (see docs/installation.md).

# Pinned by digest (node 24.21.0); Dependabot proposes updates.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run typecheck && npm test && npm run build \
 && node scripts/third-party-notices.mjs > dist/THIRD_PARTY_NOTICES.txt

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
LABEL org.opencontainers.image.title="wikijs-psono-connector" \
      org.opencontainers.image.description="Psono credentials in Wiki.js pages, resolved per user with their own read-only Psono API key" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production
WORKDIR /opt/wikijs-psono-connector
COPY --from=build /src/dist/sidecar/ ./
COPY --from=build /src/dist/wikijs-module/ ./wikijs-module/
COPY --from=build /src/dist/THIRD_PARTY_NOTICES.txt /src/LICENSE ./
# npm and yarn are not needed at runtime; removing them shrinks the attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3100/psono-connector/healthz >/dev/null || exit 1
CMD ["node", "main.cjs"]
