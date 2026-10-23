# The frontend as a production image: a Vite build served by nginx, which also
# proxies /api to the BFF so the browser sees one origin (the session cookie
# stays same-site). Build from frontend/:
#
#   docker build -t arcus-web frontend
#
# VITE_* values are compiled into the bundle, so they are build arguments, not
# runtime settings. BFF_UPSTREAM (where nginx finds the BFF) is a runtime one.

ARG NODE_IMAGE=node:24.14.1-alpine3.23
ARG NGINX_IMAGE=nginx:1.28.0-alpine

# --- build -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Relative /api: the same origin that served the page, proxied by nginx below.
ARG VITE_API_MODE=live
ARG VITE_BFF_URL=/api
ARG VITE_APP_NAME=Intertec
ARG VITE_PLATFORM_NAME=Servicedesk
ARG VITE_DEFAULT_LOCALE=en
ENV VITE_API_MODE=${VITE_API_MODE} \
    VITE_BFF_URL=${VITE_BFF_URL} \
    VITE_APP_NAME=${VITE_APP_NAME} \
    VITE_PLATFORM_NAME=${VITE_PLATFORM_NAME} \
    VITE_DEFAULT_LOCALE=${VITE_DEFAULT_LOCALE}
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM ${NGINX_IMAGE}
# The image renders /etc/nginx/templates/*.template with envsubst at start.
ENV BFF_UPSTREAM=http://bff:4000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
