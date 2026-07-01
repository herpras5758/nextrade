FROM node:20-alpine AS build
WORKDIR /app

# Replicate the repo structure exactly so relative imports resolve the same way
# as in local development. The critical paths are:
#   api/src/routes/ceisaSubmit.ts  imports ../../../lambda/shared/...
#   = 3 dirs up from routes/ to nextrade-backend/, then lambda/shared
# In Docker: /app/api/src/routes/ -> ../../../ = /app/ -> lambda/shared ✓
COPY api/package.json ./api/package.json
COPY api/tsconfig.json ./api/tsconfig.json

WORKDIR /app/api
RUN npm install

WORKDIR /app
COPY api/src ./api/src
COPY lambda/shared ./lambda/shared

WORKDIR /app/api
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/api/dist ./dist
COPY api/package.json ./
RUN npm install --omit=dev
EXPOSE 3000
CMD ["node", "dist/server.js"]
