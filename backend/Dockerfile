FROM node:22-alpine AS base
WORKDIR /app
RUN chown node:node /app
COPY package*.json ./

# Dev image also runs the test suites (backend-test), so it keeps tests and tsconfig files.
FROM base AS dev
USER node
RUN npm ci
COPY --chown=node:node . .
CMD ["npm", "run", "dev"]

FROM base AS build
USER node
RUN npm ci
COPY --chown=node:node . .
RUN npm run build

FROM base AS production
ENV NODE_ENV=production
USER node
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node drizzle ./drizzle
CMD ["node", "dist/server.js"]
