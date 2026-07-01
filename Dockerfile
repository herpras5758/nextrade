FROM node:20-alpine AS build
WORKDIR /app

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
# rootDir ".." means api/src/server.ts -> dist/api/src/server.js
COPY --from=build /app/api/dist ./dist
COPY api/package.json ./
RUN npm install --omit=dev
EXPOSE 3000
CMD ["node", "dist/api/src/server.js"]
