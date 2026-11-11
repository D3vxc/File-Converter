import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import routes from './routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'connect-src': ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','), exposedHeaders: ['Content-Disposition', 'Retry-After'] }));
  // Don't gzip downloads (already-compressed media); do gzip JSON and the web app.
  app.use(compression({ filter: (req, res) => !req.path.includes('/download') && compression.filter(req, res) }));

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.apiRequestsPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Slow down a little and try again.' },
  });
  const uploadLimiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: config.uploadsPerWindow,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'You have uploaded a lot of files recently. Please wait a few minutes.' },
  });

  app.use('/api', apiLimiter);
  app.use(['/api/convert', '/api/tools'], uploadLimiter);
  app.use('/api', routes);

  // Serve the built React app when it exists (single-container deploys).
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(
      express.static(config.clientDist, {
        index: false,
        setHeaders(res, file) {
          if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => res.type('text').send('File Converter API is running. Start the client with `npm run dev` from the repo root.'));
  }
  return app;
}
