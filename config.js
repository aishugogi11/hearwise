const dotenv = require('dotenv');

dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

function getAppUrl() {
  const fromEnv = (process.env.APP_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const fromRedirect = (process.env.SPOTIFY_REDIRECT_URI || '').replace(/\/callback\/?$/i, '');
  if (fromRedirect) return fromRedirect;
  if (!isProduction) {
    const port = Number(process.env.PORT) || 3000;
    return `http://127.0.0.1:${port}`;
  }
  return '';
}

function validateEnv() {
  if (!isProduction) return;

  const required = ['SESSION_SECRET', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI'];
  const missing = required.filter(function (key) {
    const val = process.env[key];
    return !val || /your_|change-this/i.test(val);
  });

  if (missing.length) {
    console.error('❌ Missing or placeholder production env:', missing.join(', '));
    process.exit(1);
  }

  if ((process.env.SESSION_SECRET || '').length < 16) {
    console.error('❌ SESSION_SECRET must be at least 16 characters in production');
    process.exit(1);
  }

  const redirect = process.env.SPOTIFY_REDIRECT_URI || '';
  if (!/^https:\/\//i.test(redirect)) {
    console.warn('⚠️ SPOTIFY_REDIRECT_URI should use https:// in production');
  }
}

function getAllowedOrigins() {
  const origins = new Set();
  const appUrl = getAppUrl();
  if (appUrl) origins.add(appUrl);

  if (!isProduction) {
    const port = Number(process.env.PORT) || 3000;
    origins.add(`http://127.0.0.1:${port}`);
    origins.add(`http://localhost:${port}`);
  }

  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean)
    .forEach(function (o) { origins.add(o); });

  return origins;
}

const demoToolsEnabled = !isProduction || process.env.ENABLE_DEMO_TOOLS === 'true';

function requireDevRoute(req, res, next) {
  if (demoToolsEnabled) return next();
  const key = req.headers['x-internal-key'] || req.body?.internalKey;
  if (process.env.INTERNAL_API_KEY && key === process.env.INTERNAL_API_KEY) return next();
  return res.status(404).json({ error: 'Not found' });
}

module.exports = {
  NODE_ENV,
  isProduction,
  getAppUrl,
  validateEnv,
  getAllowedOrigins,
  demoToolsEnabled,
  requireDevRoute,
  internalApiKey: process.env.INTERNAL_API_KEY || ''
};
