FROM node:20-bullseye AS build

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bullseye AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000