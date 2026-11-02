FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY drizzle ./drizzle
COPY src/server ./src/server
# The server shares the shelf grid maths with the phone UI.
COPY src/web/shelf-grid.ts ./src/web/shelf-grid.ts
USER node
EXPOSE 3000
CMD ["node", "src/server/main.ts"]
