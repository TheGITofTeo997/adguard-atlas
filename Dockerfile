# syntax=docker/dockerfile:1

# ---------- Stage 1: production dependencies ----------
FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
# Fail the build loudly (instead of shipping a blank map) if the MapLibre dist layout changes
RUN test -f node_modules/maplibre-gl/dist/maplibre-gl.mjs && test -f node_modules/maplibre-gl/dist/maplibre-gl.css \
    || (echo "maplibre-gl dist layout changed:" && ls node_modules/maplibre-gl/dist && exit 1)

# ---------- Stage 2: runtime ----------
FROM node:24-alpine AS production
ENV NODE_ENV=production \
    DATA_DIR=/data

# Pick up base-image security fixes, add a proper init, drop npm/npx (not needed at runtime)
RUN apk upgrade --no-cache \
    && apk add --no-cache --upgrade dumb-init \
        'libcrypto3>=3.5.9-r1' 'libssl3>=3.5.9-r1' \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /data && chown node:node /data

WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node login ./login
COPY --chown=node:node package.json ./

USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
