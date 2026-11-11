# ---------- build the React app ----------
FROM node:22-bookworm-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
# `npm install` (not `ci`) so Linux-only native optional deps are resolved even
# though the lockfile was generated on another OS.
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim
# LibreOffice powers Word/PowerPoint/Excel conversions. Build with WITH_LIBREOFFICE=false for a ~400 MB smaller image.
# DejaVu + Liberation fonts are always installed: the PDF text editor uses them when an edit needs characters the PDF's own font lacks.
ARG WITH_LIBREOFFICE=true
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg poppler-utils qpdf ghostscript ca-certificates fonts-dejavu-core fonts-liberation2 \
 && if [ "$WITH_LIBREOFFICE" = "true" ]; then \
      apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress \
        fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core; \
    fi \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY server/package*.json ./
# --ignore-scripts skips ffmpeg-static's binary download; the system ffmpeg is used instead.
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/tmp/file-converter \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    CLIENT_DIST=/app/client/dist
EXPOSE 8080
USER node
CMD ["node", "src/index.js"]
