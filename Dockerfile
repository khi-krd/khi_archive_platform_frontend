FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_BASE_URL=http://178.105.87.169/api
ARG VITE_API_WITH_CREDENTIALS=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_WITH_CREDENTIALS=$VITE_API_WITH_CREDENTIALS \
    NODE_OPTIONS=--max-old-space-size=2048
RUN pnpm build

FROM nginx:1.28-alpine
COPY nginx.docker.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
