FROM node:20-alpine AS build
WORKDIR /app
COPY api/package.json api/tsconfig.json ./
RUN npm install
COPY api/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY api/package.json ./
RUN npm install --omit=dev
EXPOSE 3000
CMD ["node", "dist/server.js"]
