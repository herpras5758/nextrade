FROM node:20-alpine AS build
WORKDIR /app

COPY api/package.json ./api/package.json
COPY api/tsconfig.json ./api/tsconfig.json

WORKDIR /app/api
RUN npm install

WORKDIR /app
COPY api/src ./api/src
COPY lambda/shared ./lambda/shared

# Symlink so that lambda/shared files can resolve node_modules
# (TypeScript walks up: lambda/shared -> lambda -> app -> finds node_modules here)
RUN ln -s /app/api/node_modules /app/node_modules

WORKDIR /app/api
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/api/dist ./dist
COPY api/package.json ./
RUN npm install --omit=dev
EXPOSE 3000
CMD ["node", "dist/api/src/server.js"]
