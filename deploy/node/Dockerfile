# Runs the site as one Node process with SQLite. Build from the repo root:
#   docker build -f deploy/node/Dockerfile -t jev-plays-chess .
#   docker run -p 8080:8080 -v jev-data:/data -e TYPESAFE_API_KEY=... jev-plays-chess

# The full image has git, which npm needs for the maia3-ts dependency.
FROM node:24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:node

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/deploy/node/dist/server.mjs server.mjs
ENV PORT=8080 DB_PATH=/data/jev.sqlite STATIC_DIR=web/dist
VOLUME /data
EXPOSE 8080
CMD ["node", "server.mjs"]
