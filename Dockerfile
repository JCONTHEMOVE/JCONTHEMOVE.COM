# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .

# Vite reads VITE_* values at build time. Pass these from docker compose when
# the frontend needs a non-default API/RPC endpoint baked into the bundle.
ARG VITE_API_BASE_URL=
ARG VITE_SOLANA_RPC_URL=
ARG VITE_VAPID_PUBLIC_KEY=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SOLANA_RPC_URL=$VITE_SOLANA_RPC_URL
ENV VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY

RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=5000
WORKDIR /app

# Sharp's SVG text renderer needs real fonts and fontconfig in the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/attached_assets/google_movers/crew-ramp.jpg ./attached_assets/google_movers/crew-ramp.jpg
COPY --from=build --chown=node:node /app/scripts/check-marketing-fonts.mjs ./scripts/check-marketing-fonts.mjs

USER node
RUN node scripts/check-marketing-fonts.mjs
EXPOSE 5000

CMD ["node", "dist/index.js"]
