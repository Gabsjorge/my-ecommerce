# The Playwright image tag must match the exact @playwright/test version in package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /e2e
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npx", "playwright", "test"]
