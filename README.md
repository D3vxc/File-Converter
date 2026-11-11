# Morph — free file converter

Convert images, video, audio, documents, spreadsheets and archives. No ads, no sign-up, no subscription.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/D3vxc/File-Converter)

- **~390 conversions**: JPG/PNG/WEBP/AVIF/GIF/TIFF/ICO/SVG, MP4/WEBM/MKV/MOV/AVI/GIF, MP3/WAV/AAC/OGG/OPUS/FLAC, DOCX/MD/HTML/TXT/PDF, XLSX/CSV/JSON/YAML/XML, ZIP/TAR/TAR.GZ
- **Tools**: compress & resize images, compress video, video → GIF, extract audio, trim, merge / split / compress PDF, images → PDF, PDF → JPG
- **Options**: quality, dimensions, resolution, frame rate, bitrate, trimming, mute, EXIF stripping

## How it stays fast for many users at once

- **Simple image conversions run in the browser**, so they never touch the server.
- **Fair queue**: each user gets turns in round-robin order, so one heavy uploader can't block anyone.
- **Two lanes**: quick jobs (images, docs, data) never wait behind long video encodes.
- **Remux fast path**: MP4 ↔ MKV ↔ MOV without re-encoding when nothing else changes.
- Streaming uploads/downloads (no files held in memory), rate limits, automatic retry when busy, files deleted after the retention window.

## Stack

`client/`: React, Vite, Framer Motion · `server/`: Node, Express, sharp, ffmpeg, pdf-lib, SheetJS, mammoth.
Optional: LibreOffice (Word/PowerPoint ↔ PDF), Poppler/Ghostscript (PDF → image, better PDF compression).

## Run locally

```bash
npm run install:all
npm run dev:server   # http://localhost:8080
npm run dev:client   # http://localhost:5173
npm test             # end-to-end tests
```

## Deploy

**Render (free):** click the button above. It builds the `Dockerfile` and uses `render.yaml`.
The free instance sleeps after 15 minutes idle (first visit then takes ~30–60 s) and has a small CPU, so long video jobs queue up.

**More capacity for free:** an Oracle Cloud "Always Free" ARM VM (4 cores, 24 GB RAM):

```bash
docker build -t morph --build-arg WITH_LIBREOFFICE=true .
docker run -d --restart unless-stopped -p 80:8080 morph
```

## Configuration (env vars)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP port |
| `MAX_FILE_MB` | 500 | Max upload size |
| `FILE_TTL_MIN` | 60 | Files deleted after this many minutes |
| `HEAVY_CONCURRENCY` | cores / 2 | Parallel video/office jobs |
| `LIGHT_CONCURRENCY` | cores × 2 | Parallel image/doc/data jobs |
| `CORS_ORIGIN` | `*` | Allowed origins if the frontend is hosted separately (`VITE_API_URL` on the client) |
