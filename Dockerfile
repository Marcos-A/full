# Build the static bundle, then serve it from nginx behind the host's reverse proxy.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npx vite build

FROM nginx:stable-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/full.conf
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Declared late so that the layers above stay cached between deployments.
ARG GIT_COMMIT=""
ARG BUILD_TIME=""
LABEL org.opencontainers.image.revision=$GIT_COMMIT \
      org.opencontainers.image.created=$BUILD_TIME
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
