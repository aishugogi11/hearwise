const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const session = require('express-session');
const pool = require('./database/connection');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');
const HearingRiskModel = require('./ml/train');
const BehavioralAnalyzer = require('./ml/behavioralAnalysis');
const RiskForecaster = require('./ml/forecasting');
const { getChallengesForProfile, getChallengeById, getAllAchievements } = require('./challenges');
const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const LiveMonitoringService = require('./live-monitoring');
const systemVolume = require('./system-volume');
const {
  featherlessSlackOverview,
  featherlessSlackRisk,
  featherlessSlackSummary,
} = require('./featherless');

dotenv.config();
config.validateEnv();

const app = express();

if (config.isProduction) {
  app.set('trust proxy', 1);
}

// Local dev: Spotify redirect URI uses 127.0.0.1 — normalize host so session cookies persist
if (!config.isProduction) {
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    const port = Number(process.env.PORT) || 3000;
    if (host.startsWith('localhost')) {
      return res.redirect(301, `http://127.0.0.1:${port}${req.url}`);
    }
    next();
  });
}

const allowedOrigins = config.getAllowedOrigins();
app.use(cors({
  origin: function (origin, cb) {
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
    if (!config.isProduction) return cb(null, true);
    return cb(null, false);
  },
  credentials: true
}));

if (config.isProduction) {
  app.use(function (req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
}
app.use(express.json());

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(header.split(';').map(function (c) {
    const parts = c.trim().split('=');
    const k = parts[0];
    const v = parts.slice(1).join('=');
    return [k, decodeURIComponent(v || '')];
  }));
}

async function saveSpotifyTokens(spotifyUserId, accessToken, refreshToken) {
  if (!spotifyUserId || !accessToken || !refreshToken) return;
  try {
    await pool.query(
      `INSERT INTO spotify_tokens (id, user_id, access_token, refresh_token, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         updated_at = datetime('now')`,
      [uuidv4(), spotifyUserId, accessToken, refreshToken]
    );
  } catch (err) {
    console.error('Failed to save Spotify tokens:', err.message);
  }
}

async function loadSpotifyTokens(spotifyUserId) {
  if (!spotifyUserId) return null;
  try {
    const result = await pool.query(
      'SELECT access_token, refresh_token FROM spotify_tokens WHERE user_id = ? LIMIT 1',
      [spotifyUserId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('Failed to load Spotify tokens:', err.message);
    return null;
  }
}

async function restoreSpotifySession(req) {
  if (req.session.access_token) return true;

  const cookies = parseCookies(req);
  const spotifyUserId = cookies.hw_spotify_uid;
  if (spotifyUserId) {
    const tokens = await loadSpotifyTokens(spotifyUserId);
    if (tokens) {
      req.session.access_token = tokens.access_token;
      req.session.refresh_token = tokens.refresh_token;
      req.session.spotify_user_id = spotifyUserId;
      console.log('[Spotify] Restored session for user', spotifyUserId);
      return true;
    }
  }

  if (req.sessionID) {
    const tokens = await loadSpotifyTokens('sess_' + req.sessionID);
    if (tokens) {
      req.session.access_token = tokens.access_token;
      req.session.refresh_token = tokens.refresh_token;
      console.log('[Spotify] Restored session from session store');
      return true;
    }
  }

  return false;
}

function saveExpressSession(req) {
  return new Promise(function (resolve, reject) {
    req.session.save(function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

const _meFetchThrottle = new Map();
let _meGlobalBackoffUntil = 0;
const _authSyncStore = new Map();

let _spotifyGlobalBackoffUntil = 0;
let _spotifyRequestCount = 0;
let _spotify429Count = 0;
const _activePollIntervals = { client: 0, server: 0 };

/** Parse Spotify Retry-After (seconds). Capped so a bad 429 never locks the app for hours. */
const SPOTIFY_RETRY_AFTER_MAX_SEC = 120;

function parseRetryAfterSeconds(header, fallback) {
  if (header == null || header === '') return fallback || 30;
  const raw = parseInt(String(header).trim(), 10);
  if (!raw || raw < 1) return fallback || 30;
  return Math.min(raw, SPOTIFY_RETRY_AFTER_MAX_SEC);
}

function isSpotifyPlayerStateEndpoint(endpoint) {
  if (!endpoint) return false;
  var path = String(endpoint).split('?')[0];
  if (path === 'me/player') return true;
  /* Playback controls (volume, pause, play, skip) must work during read backoff */
  if (path.indexOf('me/player/') === 0) return true;
  return false;
}

function isSpotifyGloballyBackedOff() {
  return Date.now() < _spotifyGlobalBackoffUntil;
}

function setSpotifyGlobalBackoff(retryAfterHeader, endpoint, source) {
  const sec = parseRetryAfterSeconds(retryAfterHeader, 30);
  const until = Date.now() + sec * 1000;
  if (until > _spotifyGlobalBackoffUntil) {
    _spotifyGlobalBackoffUntil = until;
    _spotify429Count++;
    console.warn(
      '[Spotify API] 429 on',
      endpoint,
      '| Retry-After:',
      sec + 's',
      '| source:',
      source || 'api',
      '| global backoff until',
      new Date(until).toISOString()
    );
  }
  return sec;
}

function logSpotifyRequest(method, endpoint) {
  _spotifyRequestCount++;
  console.log('[Spotify API] #' + _spotifyRequestCount + ' ' + (method || 'GET') + ' /' + endpoint);
}

function trimCacheMap(map, maxSize) {
  if (map.size <= maxSize) return;
  const keys = Array.from(map.keys());
  for (let i = 0; i < keys.length - maxSize; i++) map.delete(keys[i]);
}

function storeAuthSync(syncToken, tokens) {
  _authSyncStore.set(syncToken, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    spotify_user_id: tokens.spotify_user_id || null,
    expires: Date.now() + 120000
  });
  if (_authSyncStore.size > 50) {
    const now = Date.now();
    _authSyncStore.forEach(function (entry, key) {
      if (entry.expires < now) _authSyncStore.delete(key);
    });
  }
}

async function applySpotifyTokensToSession(req, res, accessToken, refreshToken, spotifyUserId) {
  req.session.access_token = accessToken;
  req.session.refresh_token = refreshToken;
  if (spotifyUserId) req.session.spotify_user_id = spotifyUserId;
  if (req.sessionID) {
    await saveSpotifyTokens('sess_' + req.sessionID, accessToken, refreshToken);
  }
  if (spotifyUserId) {
    await saveSpotifyTokens(spotifyUserId, accessToken, refreshToken);
  }
  await saveExpressSession(req);
  if (spotifyUserId && res) {
    res.setHeader(
      'Set-Cookie',
      'hw_spotify_uid=' + encodeURIComponent(spotifyUserId) + '; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax'
    );
  }
}

async function fetchSpotifyMe(accessToken) {
  if (Date.now() < _meGlobalBackoffUntil || isSpotifyGloballyBackedOff()) return null;

  logSpotifyRequest('GET', 'me');
  const resp = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: 'Bearer ' + accessToken }
  });

  if (resp.status === 429) {
    const sec = parseRetryAfterSeconds(resp.headers.get('retry-after'), 30);
    _meGlobalBackoffUntil = Date.now() + sec * 1000;
    console.warn('[Spotify API] /me rate limited — backing off me only for', sec + 's');
    return null;
  }

  if (!resp.ok) return null;
  try {
    return await resp.json();
  } catch (_) {
    return null;
  }
}

async function linkSpotifyUser(req, me, res) {
  if (!me || !me.id || !req.session.access_token) return null;
  req.session.spotify_user_id = me.id;
  req.session.user_id = me.id;
  await saveSpotifyTokens(me.id, req.session.access_token, req.session.refresh_token);
  if (req.sessionID) {
    try {
      await pool.query('DELETE FROM spotify_tokens WHERE user_id = ?', ['sess_' + req.sessionID]);
    } catch (_) { /* non-fatal */ }
  }
  if (res) {
    res.setHeader(
      'Set-Cookie',
      'hw_spotify_uid=' + encodeURIComponent(me.id) + '; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax'
    );
  }
  console.log('[Spotify] User linked:', me.id);
  return me.id;
}

async function ensureSpotifyUserId(req, res, force) {
  if (!req.session.access_token || req.session.spotify_user_id) {
    return req.session.spotify_user_id || null;
  }

  const key = req.session.spotify_user_id || req.sessionID || 'anon';
  const now = Date.now();
  const last = _meFetchThrottle.get(key) || 0;
  if (!force && now - last < 300000) return null;
  if (Date.now() < _meGlobalBackoffUntil) return null;

  _meFetchThrottle.set(key, now);
  const me = await fetchSpotifyMe(req.session.access_token);
  if (!me || !me.id) return null;

  await linkSpotifyUser(req, me, res);
  try {
    await storeUserInDatabase(req.session.access_token, me);
  } catch (_) { /* non-fatal */ }
  return me.id;
}

const _playbackCache = new Map();
const _spotifyBackoffUntil = new Map();

function playbackCacheKey(req) {
  return req.session.spotify_user_id || req.sessionID || 'anon';
}

function getCachedPlayback(req) {
  const entry = _playbackCache.get(playbackCacheKey(req));
  return entry ? entry.data : null;
}

function setCachedPlayback(req, data) {
  if (data && data.item) {
    _playbackCache.set(playbackCacheKey(req), { data: data, at: Date.now() });
    trimCacheMap(_playbackCache, 50);
  } else if (data && data.playbackSource === 'player-no-track') {
    var key = playbackCacheKey(req);
    var prev = _playbackCache.get(key);
    if (prev && prev.data) {
      _playbackCache.set(key, {
        data: Object.assign({}, prev.data, { is_playing: false, playbackSource: 'player-no-track' }),
        at: Date.now()
      });
    }
  }
}

function playbackFromCache(req, extra) {
  const cached = getCachedPlayback(req);
  if (!cached) return Object.assign({ item: null, is_playing: false, playbackSource: 'none' }, extra || {});
  return Object.assign({}, cached, extra || {}, { cached: true });
}

const _spotifyLastFetch = new Map();
const SPOTIFY_PLAYBACK_MIN_MS = 6000;
const SPOTIFY_PLAYBACK_FRESH_MIN_MS = 2500;
const SPOTIFY_PLAYBACK_HOLD_MS = 180000;
const _weeklyStatsCache = new Map();
const _exposureScoreCache = new Map();
const WEEKLY_STATS_TTL_MS = 300000;

async function readSpotifyResponse(resp, endpoint) {
  if (resp.status === 204) return { empty: true };
  if (resp.status === 429) {
    const retryAfter = parseRetryAfterSeconds(
      resp.headers && resp.headers.get ? resp.headers.get('retry-after') : null,
      30
    );
    if (!isSpotifyPlayerStateEndpoint(endpoint || '')) {
      setSpotifyGlobalBackoff(
        resp.headers && resp.headers.get ? resp.headers.get('retry-after') : null,
        endpoint || 'unknown',
        'readSpotifyResponse'
      );
    }
    return { rateLimited: true, retryAfter: retryAfter };
  }
  const text = await resp.text();
  if (!text) return { empty: true };
  try {
    return JSON.parse(text);
  } catch (_) {
    console.warn('[Spotify] Non-JSON response (' + resp.status + '):', text.slice(0, 80));
    return { error: true };
  }
}

// Main app lives at project root — avoid stale copy under /hearwise/
app.get(['/hearwise', '/hearwise/'], (req, res) => {
  res.redirect(302, '/');
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    env: config.NODE_ENV,
    db: pool.type || 'unknown',
    spotify: !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
    slack: !!process.env.SLACK_BOT_TOKEN,
    systemVolume: systemVolume.isSupported()
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    production: config.isProduction,
    demoTools: config.demoToolsEnabled,
    appUrl: config.getAppUrl(),
    systemVolume: systemVolume.isSupported()
  });
});

const BLOCKED_STATIC = new Set([
  '/server.js', '/config.js', '/featherless.js', '/system-volume.js', '/package.json', '/package-lock.json',
  '/.env', '/.env.example', '/render.yaml'
]);
const BLOCKED_PREFIXES = ['/database', '/docs', '/.git', '/node_modules', '/.vscode'];

app.use(function (req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const urlPath = decodeURIComponent(req.path || '/');
  if (BLOCKED_STATIC.has(urlPath)) return res.status(404).end();
  if (BLOCKED_PREFIXES.some(function (p) { return urlPath.startsWith(p); })) return res.status(404).end();
  if (urlPath.startsWith('/ml/') && urlPath !== '/ml/model.json') return res.status(404).end();
  next();
});

app.use(express.static('.', {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'hearwise-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.isProduction,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

app.use(async function (req, res, next) {
  try {
    await restoreSpotifySession(req);
  } catch (_) { /* non-fatal */ }
  next();
});

const client_id = process.env.SPOTIFY_CLIENT_ID;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
const redirect_uri = process.env.SPOTIFY_REDIRECT_URI;

let _extensionToken = null;

// ==================== SPOTIFY TOKEN REFRESH ====================

async function refreshAccessToken(req) {
  if (!req.session.refresh_token) {
    throw new Error('No refresh token available');
  }

  try {
    const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: req.session.refresh_token
      })
    });

    const data = await tokenResp.json();
    if (!tokenResp.ok) {
      throw new Error('Token refresh failed');
    }

    req.session.access_token = data.access_token;
    if (data.refresh_token) {
      req.session.refresh_token = data.refresh_token;
    }
    if (req.session.spotify_user_id) {
      await saveSpotifyTokens(
        req.session.spotify_user_id,
        data.access_token,
        req.session.refresh_token
      );
    }

    return data.access_token;
  } catch (err) {
    console.error('Token refresh error:', err);
    throw err;
  }
}

async function spotifyApiCall(req, url, options) {
  options = options || {};
  let accessToken = req.session.access_token;

  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const endpoint = url.replace('https://api.spotify.com/v1/', '');
  const playerState = isSpotifyPlayerStateEndpoint(endpoint);

  if (isSpotifyGloballyBackedOff() && !playerState) {
    const waitSec = Math.ceil((_spotifyGlobalBackoffUntil - Date.now()) / 1000);
    console.log('[Spotify API] Skipped (global backoff ' + waitSec + 's left):', endpoint);
    return {
      status: 429,
      headers: { get: function (h) { return h === 'retry-after' ? String(waitSec) : null; } }
    };
  }

  logSpotifyRequest(options.method || 'GET', endpoint);

  const makeRequest = async function (token) {
    return fetch(url, Object.assign({}, options, {
      headers: Object.assign({}, options.headers || {}, {
        Authorization: 'Bearer ' + token
      })
    }));
  };

  let resp = await makeRequest(accessToken);

  if (resp.status === 401) {
    try {
      accessToken = await refreshAccessToken(req);
      logSpotifyRequest((options.method || 'GET') + ' (retry)', endpoint);
      resp = await makeRequest(accessToken);
    } catch (err) {
      throw new Error('Token refresh failed');
    }
  }

  if (resp.status === 429) {
    if (!playerState) {
      setSpotifyGlobalBackoff(resp.headers.get('retry-after'), endpoint, 'spotifyApiCall');
    }
  }

  return resp;
}

async function fetchSpotifyDevices(req) {
  try {
    const resp = await spotifyApiCall(req, 'https://api.spotify.com/v1/me/player/devices');
    if (!resp.ok) return [];
    const data = await readSpotifyResponse(resp, 'me/player/devices');
    if (data.error || data.rateLimited || data.empty) return [];
    return data.devices || [];
  } catch {
    return [];
  }
}

function pickSpotifyDevice(devices) {
  if (!devices || !devices.length) return null;
  return devices.find(function (d) { return d.is_active; })
    || devices.find(function (d) { return d.type === 'Computer'; })
    || devices[0];
}

function normalizeSpotifyDevice(device) {
  if (!device) return null;
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    volume_percent: device.volume_percent,
    is_active: device.is_active
  };
}

/** Playback — single Spotify API call; cache + global backoff; never retry on 429. */
async function fetchSpotifyPlaybackState(req, opts) {
  opts = opts || {};
  const forceFresh = !!opts.forceFresh;
  const key = playbackCacheKey(req);
  const now = Date.now();

  const backoffUntil = _spotifyBackoffUntil.get(key) || 0;
  if (now < backoffUntil) {
    return playbackFromCache(req, { rateLimited: true, playbackSource: 'backoff' });
  }

  const lastFetch = _spotifyLastFetch.get(key) || 0;
  const cached = getCachedPlayback(req);
  const minGap = forceFresh ? SPOTIFY_PLAYBACK_FRESH_MIN_MS : SPOTIFY_PLAYBACK_MIN_MS;
  if (cached && (now - lastFetch) < minGap) {
    return Object.assign({}, cached, { cached: true, playbackSource: 'cache-throttle' });
  }

  function onRateLimit(retryAfter) {
    const waitSec = Math.min(retryAfter || 30, 45);
    _spotifyBackoffUntil.set(key, Date.now() + waitSec * 1000);
    console.warn('[Spotify /playback] Rate limited — serving cache for', waitSec + 's');
    return playbackFromCache(req, { rateLimited: true, playbackSource: 'rate-limited' });
  }

  const playerResp = await spotifyApiCall(
    req,
    'https://api.spotify.com/v1/me/player?additional_types=track,episode'
  );
  _spotifyLastFetch.set(key, Date.now());
  const playerData = await readSpotifyResponse(playerResp, 'me/player');

  if (playerData.rateLimited) return onRateLimit(playerData.retryAfter);

  if (!playerData.empty && !playerData.error && playerData.item) {
    const result = Object.assign({}, playerData, { playbackSource: 'player' });
    setCachedPlayback(req, result);
    return result;
  }

  if (!playerData.empty && !playerData.error && !playerData.item) {
    const cacheEntry = _playbackCache.get(key);
    if (cacheEntry && cacheEntry.data && cacheEntry.data.item && (now - cacheEntry.at) < SPOTIFY_PLAYBACK_HOLD_MS) {
      return Object.assign({}, cacheEntry.data, {
        is_playing: !!playerData.is_playing,
        device: playerData.device || cacheEntry.data.device,
        playbackSource: 'hold-no-track',
        held: true
      });
    }
    setCachedPlayback(req, Object.assign({}, playerData, { playbackSource: 'player-no-track' }));
    return Object.assign({}, playerData, { playbackSource: 'player-no-track' });
  }

  const cacheEntry = _playbackCache.get(key);
  if (cached && cached.item && cacheEntry && (now - cacheEntry.at) < SPOTIFY_PLAYBACK_HOLD_MS) {
    return Object.assign({}, cached, {
      is_playing: playerData.is_playing != null ? !!playerData.is_playing : false,
      device: playerData.device || cached.device,
      playbackSource: playerData.empty ? 'hold-204' : 'stale-cache',
      held: !playerData.empty
    });
  }

  if (playerData.empty) {
    setCachedPlayback(req, { playbackSource: 'player-no-track', is_playing: false });
  }

  return { item: null, is_playing: false, device: null, noActiveDevice: true, playbackSource: 'none' };
}

// Initialize ML Model
const riskModel = new HearingRiskModel();
riskModel.loadModel();

// Initialize Behavioral Analyzer
const behavioralAnalyzer = new BehavioralAnalyzer();

// Initialize Risk Forecaster
const riskForecaster = new RiskForecaster();

// Initialize Slack — Web API for meeting detection (Socket Mode optional)
let slackApp = null;
let slackClient = null;
let liveMonitoring = null;
const userSlackMap = new Map();
const _slackMeetingSim = new Map();
let _slackBotUserId = null;

async function initSlackBotInfo() {
  if (!slackClient) return;
  try {
    const auth = await slackClient.auth.test();
    _slackBotUserId = auth.user_id;
    console.log('🤖 Slack bot user ID:', _slackBotUserId, '(do not use as your personal ID in HearWise)');
  } catch (e) {
    console.log('Slack auth.test failed:', e.message);
  }
}

if (process.env.SLACK_BOT_TOKEN) {
  try {
    slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    console.log('✅ Slack Web API client ready (meeting detection)');
  } catch (error) {
    console.log('Slack Web API disabled:', error.message);
    slackClient = null;
  }
}

const slackSocketModeEnabled =
  process.env.SLACK_SOCKET_MODE !== 'false' &&
  process.env.SLACK_BOT_TOKEN &&
  process.env.SLACK_APP_LEVEL_TOKEN;

if (slackSocketModeEnabled) {
  try {
    slackApp = new App({
      token: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_LEVEL_TOKEN,
      socketMode: true,
      logLevel: 'warn',
    });
    if (!slackClient) slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    liveMonitoring = new LiveMonitoringService(slackClient, slackApp);
    liveMonitoring.setupSlackEventHandlers();
    console.log('✅ Slack Socket Mode + live event monitoring enabled');
  } catch (error) {
    console.log('Slack Socket Mode disabled:', error.message);
    slackApp = null;
  }
} else if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_LEVEL_TOKEN) {
  console.log('ℹ️ Slack Socket Mode off (set SLACK_SOCKET_MODE=true to enable)');
}

if (!liveMonitoring) {
  liveMonitoring = new LiveMonitoringService(slackClient, null);
  console.log('✅ Live monitoring service initialized' + (slackClient ? ' (API polling)' : ''));
}

if (slackApp && liveMonitoring) {
  liveMonitoring.startMonitoring();
}

initSlackBotInfo();

// ==================== SLACK INTEGRATION ====================

if (slackApp) {
  // Slash Command: /hearwise - Main HearWise command
  slackApp.command('/hearwise', async ({ command, ack, respond, client, body }) => {
    await ack();
    
    const userId = body.user_id;
    const userName = body.user_name;
    
    // Store user mapping
  userSlackMap.set(userId, { userName, timestamp: Date.now() });
  
  try {
    // Get user's hearing health overview
    const overview = await getHearingHealthOverview(userId);
    const auraNote = await featherlessSlackOverview(userName, userId, overview);
    const topLine = auraNote || overview.topRecommendation;
    
    await respond({
      text: `🎧 *HearWise Health Overview for ${userName}*`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎧 *HearWise Health Overview for ${userName}*`
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Risk Score:*\n${overview.riskScore}/100`
            },
            {
              type: 'mrkdwn',
              text: `*Risk Level:*\n${overview.riskLevel}`
            },
            {
              type: 'mrkdwn',
              text: `*Hearing Age:*\n${overview.hearingAge} years`
            },
            {
              type: 'mrkdwn',
              text: `*Weekly Exposure:*\n${overview.weeklyExposure} hours`
            }
          ]
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Aura:*\n${topLine}`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'View Risk Details'
              },
              value: 'risk_details',
              action_id: 'view_risk_details'
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Get Summary'
              },
              value: 'get_summary',
              action_id: 'get_summary'
            }
          ]
        }
      ]
    });
  } catch (error) {
    console.error('Error handling /hearwise command:', error);
    await respond({
      text: 'Sorry, I encountered an error fetching your hearing health data. Please try again.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '❌ Sorry, I encountered an error fetching your hearing health data. Please try again.'
          }
        }
      ]
    });
  }
});

// Slash Command: /hearwise risk - Get current risk assessment
slackApp.command('/hearwise risk', async ({ command, ack, respond, client, body }) => {
  await ack();
  
  const userId = body.user_id;
  const userName = body.user_name;
  
  try {
    const riskAnalysis = await getDetailedRiskAnalysis(userId);
    const auraNote = await featherlessSlackRisk(userName, userId, riskAnalysis);
    
    await respond({
      text: `📊 *Hearing Risk Assessment for ${userName}*`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📊 *Hearing Risk Assessment for ${userName}*`
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Overall Risk:*\n${riskAnalysis.overallRisk}/100`
            },
            {
              type: 'mrkdwn',
              text: `*Risk Category:*\n${riskAnalysis.riskCategory}`
            },
            {
              type: 'mrkdwn',
              text: `*Confidence:*\n${riskAnalysis.confidence}%`
            },
            {
              type: 'mrkdwn',
              text: `*Trend:*\n${riskAnalysis.trend}`
            }
          ]
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Risk Contributors:*\n${riskAnalysis.contributors.map(c => `• ${c.feature}: ${c.impact}`).join('\n')}`
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: auraNote
              ? `*Aura:*\n${auraNote}`
              : `*Recommendations:*\n${riskAnalysis.recommendations.map(r => `• ${r}`).join('\n')}`
          }
        }
      ]
    });
  } catch (error) {
    console.error('Error handling /hearwise risk command:', error);
    await respond({
      text: 'Sorry, I encountered an error fetching your risk assessment. Please try again.'
    });
  }
});

// Slash Command: /hearwise summary - Get daily/weekly summary
slackApp.command('/hearwise summary', async ({ command, ack, respond, client, body }) => {
  await ack();
  
  const userId = body.user_id;
  const userName = body.user_name;
  const period = command.text || 'week'; // Default to weekly
  
  try {
    const summary = await getListeningSummary(userId, period);
    const auraNote = await featherlessSlackSummary(userName, userId, period, summary);
    const insightLine = auraNote || summary.insights;
    
    await respond({
      text: `📈 *${period === 'day' ? 'Daily' : 'Weekly'} Listening Summary for ${userName}*`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📈 *${period === 'day' ? 'Daily' : 'Weekly'} Listening Summary for ${userName}*`
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Total Listening:*\n${summary.totalHours} hours`
            },
            {
              type: 'mrkdwn',
              text: `*Average Volume:*\n${summary.avgVolume}%`
            },
            {
              type: 'mrkdwn',
              text: `*Sessions:*\n${summary.sessionCount}`
            },
            {
              type: 'mrkdwn',
              text: `*Breaks Taken:*\n${summary.breakCount}`
            }
          ]
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: auraNote ? `*Aura:*\n${insightLine}` : `*Insights:*\n${insightLine}`
          }
        }
      ]
    });
  } catch (error) {
    console.error('Error handling /hearwise summary command:', error);
    await respond({
      text: 'Sorry, I encountered an error fetching your listening summary. Please try again.'
    });
  }
});

// Handle button clicks from interactive messages
slackApp.action({ action_id: 'view_risk_details' }, async ({ body, ack, respond, client }) => {
  await ack();
  
  const userId = body.user.id;
  const riskAnalysis = await getDetailedRiskAnalysis(userId);
  
  await respond({
    text: `📊 *Detailed Risk Analysis*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📊 *Detailed Risk Analysis*`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Risk Score Breakdown:*\n${riskAnalysis.featureBreakdown}`
        }
      }
    ],
    replace_original: false
  });
});

slackApp.action({ action_id: 'get_summary' }, async ({ body, ack, respond, client }) => {
  await ack();
  
  const userId = body.user.id;
  const summary = await getListeningSummary(userId, 'week');
  
  await respond({
    text: `📈 *Weekly Summary*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📈 *Weekly Summary*`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Total Listening:*\n${summary.totalHours} hours\n\n*Average Volume:*\n${summary.avgVolume}%\n\n*Insights:*\n${summary.insights}`
        }
      }
    ],
    replace_original: false
  });
});

// Handle app mentions
slackApp.event('app_mention', async ({ event, say }) => {
  await say({
    text: `Hi! I'm HearWise, your hearing health assistant. You can use these commands:\n• \`/hearwise\` - Get your health overview\n• \`/hearwise risk\` - Get risk assessment\n• \`/hearwise summary\` - Get listening summary`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Hi! I'm HearWise, your hearing health assistant. You can use these commands:\n• \`/hearwise\` - Get your health overview\n• \`/hearwise risk\` - Get risk assessment\n• \`/hearwise summary\` - Get listening summary`
        }
      }
    ]
  });
});

// Handle direct messages
slackApp.message(async ({ message, say }) => {
  if (message.channel_type === 'im') {
    await say({
      text: `Hello! I'm HearWise. Use \`/hearwise\` to get started with your hearing health overview.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Hello! I'm HearWise. Use \`/hearwise\` to get started with your hearing health overview.`
          }
        }
      ]
    });
  }
});
} // Close the if (slackApp) block

// ==================== SLACK HELPER FUNCTIONS ====================

async function getHearingHealthOverview(userId) {
  // Mock data for now - will be replaced with actual database queries
  return {
    riskScore: 45,
    riskLevel: 'Moderate',
    hearingAge: 28,
    weeklyExposure: 18.5,
    topRecommendation: 'Reduce weekend volume by 10% to lower weekly exposure'
  };
}

async function getDetailedRiskAnalysis(userId) {
  // Mock data for now
  return {
    overallRisk: 45,
    riskCategory: 'Moderate',
    confidence: 87,
    trend: 'Stable',
    contributors: [
      { feature: 'Listening Duration', impact: '+15 points' },
      { feature: 'Volume Exposure', impact: '+20 points' },
      { feature: 'Session Frequency', impact: '+10 points' }
    ],
    recommendations: [
      'Reduce listening volume by 10-15%',
      'Take 5-minute breaks every hour',
      'Limit daily listening to under 4 hours'
    ],
    featureBreakdown: '• Listening Duration: 35% weight\n• Volume Exposure: 30% weight\n• Session Frequency: 15% weight\n• Consecutive Time: 10% weight\n• Age: 5% weight\n• Recovery Habits: 5%'
  };
}

async function getListeningSummary(userId, period) {
  // Mock data for now
  return {
    totalHours: period === 'day' ? 2.5 : 18.5,
    avgVolume: 72,
    sessionCount: period === 'day' ? 4 : 28,
    breakCount: period === 'day' ? 2 : 14,
    insights: period === 'day' 
      ? 'Your listening patterns are within safe limits today. Continue taking regular breaks.'
      : 'Weekly exposure is slightly elevated. Consider reducing weekend volume by 10%.'
  };
}

// ==================== SLACK API ENDPOINTS ====================

// Send DM to user
app.post('/api/slack/dm', async (req, res) => {
  try {
    const { userId, message } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'userId and message are required' });
    }

    if (!slackClient) {
      return res.json({
        success: true,
        demo: true,
        message: 'Demo mode — message shown in app only'
      });
    }

    // Open DM channel
    const dmResult = await slackClient.conversations.open({
      users: userId
    });
    
    const channelId = dmResult.channel.id;
    
    // Send message
    await slackClient.chat.postMessage({
      channel: channelId,
      text: message,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message
          }
        }
      ]
    });
    
    res.json({ success: true, channelId });
  } catch (error) {
    console.error('Error sending DM:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send hearing health alert
app.post('/api/slack/alert', async (req, res) => {
  try {
    const { userId, alertType, severity, message } = req.body;
    
    if (!userId || !message) {
      return res.status(400).json({ error: 'userId and message are required' });
    }
    
    const dmResult = await slackClient.conversations.open({ users: userId });
    const channelId = dmResult.channel.id;
    
    const emoji = severity === 'high' ? '🚨' : severity === 'medium' ? '⚠️' : 'ℹ️';
    
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `${emoji} ${alertType}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${alertType}*\n${message}`
          }
        }
      ]
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending alert:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send meeting notification
app.post('/api/slack/meeting-notification', async (req, res) => {
  try {
    const { userId, meetingTitle, duration, headphoneUsage } = req.body;
    
    const dmResult = await slackClient.conversations.open({ users: userId });
    const channelId = dmResult.channel.id;
    
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `🎧 Meeting Alert: ${meetingTitle}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎧 *Meeting Alert: ${meetingTitle}*\n\n*Duration:* ${duration}\n*Headphone Usage:* ${headphoneUsage}\n\n💡 Tip: Take a 5-minute break after this meeting to let your ears recover.`
          }
        }
      ]
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending meeting notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send daily summary
app.post('/api/slack/daily-summary', async (req, res) => {
  try {
    const { userId } = req.body;
    
    const summary = await getListeningSummary(userId, 'day');
    
    const dmResult = await slackClient.conversations.open({ users: userId });
    const channelId = dmResult.channel.id;
    
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `📊 Daily Hearing Health Summary`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '📊 Daily Hearing Health Summary'
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Total Listening:*\n${summary.totalHours} hours`
            },
            {
              type: 'mrkdwn',
              text: `*Average Volume:*\n${summary.avgVolume}%`
            },
            {
              type: 'mrkdwn',
              text: `*Sessions:*\n${summary.sessionCount}`
            },
            {
              type: 'mrkdwn',
              text: `*Breaks Taken:*\n${summary.breakCount}`
            }
          ]
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Insights:*\n${summary.insights}`
          }
        }
      ]
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending daily summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to verify Slack connectivity
app.get('/api/slack/test', async (req, res) => {
  try {
    // Test Slack connection
    const authResult = await slackClient.auth.test();
    
    res.json({
      success: true,
      message: 'Slack connection successful',
      botInfo: {
        botUserId: authResult.bot_id,
        botName: authResult.user,
        team: authResult.team
      }
    });
  } catch (error) {
    console.error('Slack connection test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint to send a test message
app.post('/api/slack/test-message', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    const dmResult = await slackClient.conversations.open({ users: userId });
    const channelId = dmResult.channel.id;
    
    await slackClient.chat.postMessage({
      channel: channelId,
      text: '✅ HearWise Slack integration is working! This is a test message.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '✅ *HearWise Slack integration is working!*\n\nThis is a test message to verify connectivity. You can now use:\n• `/hearwise` - Get your health overview\n• `/hearwise risk` - Get risk assessment\n• `/hearwise summary` - Get listening summary'
          }
        }
      ]
    });
    
    res.json({ success: true, message: 'Test message sent successfully' });
  } catch (error) {
    console.error('Error sending test message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Link user to Slack ID
app.post('/api/slack/link-user', async (req, res) => {
  try {
    const { userId, slackUserId } = req.body;
    
    if (!userId || !slackUserId) {
      return res.status(400).json({ error: 'userId and slackUserId are required' });
    }
    
    userSlackMap.set(userId, { slackUserId, timestamp: Date.now() });
    
    // Store in database if needed
    await pool.query(
      `INSERT INTO user_slack_mapping (user_id, slack_user_id) 
       VALUES ($1, $2) 
       ON CONFLICT (user_id) DO UPDATE SET 
         slack_user_id = EXCLUDED.slack_user_id,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, slackUserId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error linking user to Slack:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== LIVE MONITORING API ENDPOINTS ====================

// Start live monitoring
app.post('/api/live-monitoring/start', async (req, res) => {
  try {
    const { slackUserId, surveyData, decibel } = req.body;
    
    if (slackUserId) {
      liveMonitoring.setSlackUserId(slackUserId);
    }
    
    if (surveyData) {
      liveMonitoring.setSurveyData(surveyData);
    }
    
    if (decibel) {
      liveMonitoring.setCurrentDecibel(decibel);
    }
    
    liveMonitoring.startMonitoring();
    
    res.json({ success: true, message: 'Live monitoring started' });
  } catch (error) {
    console.error('Error starting live monitoring:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stop live monitoring
app.post('/api/live-monitoring/stop', async (req, res) => {
  try {
    liveMonitoring.stopMonitoring();
    
    res.json({ success: true, message: 'Live monitoring stopped' });
  } catch (error) {
    console.error('Error stopping live monitoring:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get timeline events
app.get('/api/live-monitoring/timeline', (req, res) => {
  try {
    const timeline = liveMonitoring.getTimeline();
    
    res.json({ success: true, timeline });
  } catch (error) {
    console.error('Error getting timeline:', error);
    res.status(500).json({ error: error.message });
  }
});

// Slack setup diagnostics for the settings UI
app.get('/api/slack/setup-info', async (req, res) => {
  try {
    let scopeCheck = { ok: false, error: null, needed: null };
    let humanMembers = [];

    if (slackClient) {
      try {
        await slackClient.users.info({ user: _slackBotUserId || 'U00000000' });
        scopeCheck.ok = true;
      } catch (e) {
        scopeCheck.error = e.data && e.data.error ? e.data.error : e.message;
        scopeCheck.needed = e.data && e.data.needed;
        scopeCheck.provided = e.data && e.data.response_metadata && e.data.response_metadata.scopes;
      }

      if (scopeCheck.ok) {
        try {
          const list = await slackClient.users.list({ limit: 200 });
          humanMembers = (list.members || [])
            .filter(function (m) { return m && !m.is_bot && !m.deleted && m.id !== 'USLACKBOT' && m.id !== _slackBotUserId; })
            .map(function (m) {
              return {
                id: m.id,
                name: m.real_name || m.name || m.id,
                inHuddle: (m.profile && m.profile.huddle_state) === 'in_a_huddle'
              };
            });
        } catch (e) { /* ignore */ }
      }
    }

    const inHuddleNow = humanMembers.find(function (m) { return m.inHuddle; });

    res.json({
      configured: !!slackClient,
      socketMode: !!slackApp,
      botUserId: _slackBotUserId,
      humanMembers: humanMembers,
      suggestedUserId: inHuddleNow ? inHuddleNow.id : (humanMembers.length === 1 ? humanMembers[0].id : null),
      requiredBotScopes: ['users:read', 'users.profile:read'],
      requiredBotEvents: ['user_huddle_changed'],
      scopeCheck,
      hint: 'Use YOUR member ID from Slack → Profile → ⋮ → Copy member ID. Do not use the bot ID.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set Slack user ID for live monitoring
app.post('/api/live-monitoring/set-slack-user', (req, res) => {
  try {
    const { slackUserId, surveyData, decibel } = req.body;

    if (!slackUserId) {
      return res.status(400).json({ error: 'slackUserId is required' });
    }

    if (_slackBotUserId && slackUserId === _slackBotUserId) {
      return res.status(400).json({
        error: 'That ID belongs to the HearWise bot, not you. In Slack: Profile → ⋮ → Copy member ID.',
        isBotId: true,
        botUserId: _slackBotUserId
      });
    }

    liveMonitoring.setSlackUserId(slackUserId);
    userSlackMap.set(slackUserId, { timestamp: Date.now() });

    if (surveyData) liveMonitoring.setSurveyData(surveyData);
    if (decibel) liveMonitoring.setCurrentDecibel(decibel);

    liveMonitoring.startMonitoring();

    res.json({
      success: true,
      message: 'Slack user ID saved',
      meetingPolling: !!slackClient
    });
  } catch (error) {
    console.error('Error setting Slack user ID:', error);
    res.status(500).json({ error: error.message });
  }
});

// Poll whether a Slack user is currently in a huddle/call (uses users.info huddle_state)
app.get('/api/slack/meeting-status', async (req, res) => {
  try {
    const slackUserId = req.query.slackUserId;
    if (!slackUserId) {
      return res.status(400).json({ error: 'slackUserId query param is required' });
    }

    if (_slackMeetingSim.has(slackUserId)) {
      return res.json({
        inMeeting: true,
        source: 'demo_simulate',
        title: 'Slack Meeting',
        configured: true
      });
    }

    if (_slackBotUserId && slackUserId === _slackBotUserId) {
      return res.json({
        inMeeting: false,
        configured: !!slackClient,
        isBotId: true,
        error: 'You saved the bot ID. Use your personal Slack member ID instead.',
        botUserId: _slackBotUserId
      });
    }

    if (liveMonitoring.isUserInHuddle(slackUserId)) {
      return res.json({
        inMeeting: true,
        source: 'realtime_event',
        title: 'Slack Huddle',
        configured: !!slackClient
      });
    }

    if (liveMonitoring.isUserInActiveMeeting()) {
      return res.json({
        inMeeting: true,
        source: 'live_events',
        configured: !!slackClient
      });
    }

    if (!slackClient) {
      return res.json({
        inMeeting: false,
        configured: false,
        note: 'Add SLACK_BOT_TOKEN to .env for real-time Slack meeting detection'
      });
    }

    const state = await liveMonitoring.fetchUserHuddleState(slackUserId);
    const payload = Object.assign({ configured: true }, state);
    if (state.error && String(state.error).includes('missing_scope')) {
      payload.setupHint = 'Add bot scopes users:read and users.profile:read, subscribe to user_huddle_changed, then Reinstall to Workspace.';
      payload.requiredScopes = ['users:read', 'users.profile:read'];
    }
    res.json(payload);
  } catch (error) {
    console.error('Error checking Slack meeting status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Demo: simulate Slack meeting join for testing auto Join Meeting
app.post('/api/slack/meeting-simulate', config.requireDevRoute, (req, res) => {
  try {
    const { slackUserId, inMeeting } = req.body;
    if (!slackUserId) {
      return res.status(400).json({ error: 'slackUserId is required' });
    }
    if (inMeeting) {
      _slackMeetingSim.set(slackUserId, Date.now());
    } else {
      _slackMeetingSim.delete(slackUserId);
    }
    res.json({ success: true, inMeeting: !!inMeeting });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test Slack notification
app.post('/api/live-monitoring/test-notification', config.requireDevRoute, async (req, res) => {
  try {
    const { slackUserId } = req.body;

    if (slackUserId) {
      liveMonitoring.setSlackUserId(slackUserId);
    }

    if (!slackClient) {
      return res.json({
        success: true,
        demo: true,
        message: 'Demo mode — in-app notifications only. Add SLACK_BOT_TOKEN to .env for real Slack DMs.'
      });
    }

    const result = await liveMonitoring.sendTestNotification();

    if (result.success) {
      return res.json(result);
    }

    res.json({
      success: true,
      demo: true,
      message: result.error || 'Slack DM unavailable — demo toast shown in app instead'
    });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.json({
      success: true,
      demo: true,
      message: 'Demo mode — Slack bot not configured'
    });
  }
});

// Enhanced Spotify OAuth with listening history scopes
app.get('/api/auth/status', async (req, res) => {
  await restoreSpotifySession(req);
  res.json({ connected: !!req.session.access_token });
});

app.post('/api/auth/sync', async (req, res) => {
  try {
    const syncToken = req.body && req.body.sync;
    if (!syncToken) return res.status(400).json({ error: 'Missing sync token' });

    const entry = _authSyncStore.get(syncToken);
    if (!entry || entry.expires < Date.now()) {
      return res.status(410).json({ error: 'Sync token expired — connect again' });
    }
    _authSyncStore.delete(syncToken);

    await applySpotifyTokensToSession(
      req,
      res,
      entry.access_token,
      entry.refresh_token,
      entry.spotify_user_id
    );
    console.log('[Spotify] Synced OAuth tokens into parent session', req.sessionID);
    res.json({ connected: true });
  } catch (err) {
    console.error('[Spotify] Auth sync failed:', err.message);
    res.status(500).json({ error: 'Auth sync failed' });
  }
});

app.get('/login', (req, res) => {
  const scope = 'user-read-private user-read-email user-read-playback-state user-read-currently-playing user-modify-playback-state streaming user-read-recently-played user-top-read user-library-read';
  let state = 'hearwise';
  if (req.query.popup === '1') state = 'popup';
  else if (req.query.state === 'extension') state = 'extension';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id,
    scope,
    redirect_uri,
    state
  });
  res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const error = req.query.error || null;

  console.log('Spotify callback received:', { code: !!code, error });

  if (error) {
    console.error('Spotify auth error:', error);
    return res.redirect('/?error=' + encodeURIComponent(error));
  }
  if (!code) {
    console.error('No code received from Spotify');
    return res.redirect('/?error=missing_code');
  }

  try {
    console.log('Exchanging code for tokens...');
    const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri })
    });

    const data = await tokenResp.json();
    console.log('Token response status:', tokenResp.ok, 'has_access_token:', !!data.access_token);
    
    if (!tokenResp.ok) {
      console.error('Token exchange failed:', data);
      return res.redirect('/?error=token_error');
    }

    req.session.access_token = data.access_token;
    req.session.refresh_token = data.refresh_token;
    console.log('Tokens stored in session');

    if (req.sessionID) {
      await saveSpotifyTokens('sess_' + req.sessionID, data.access_token, data.refresh_token);
    }

    _extensionToken = data.access_token;

    const syncToken = uuidv4();
    storeAuthSync(syncToken, {
      access_token: data.access_token,
      refresh_token: data.refresh_token
    });

    await saveExpressSession(req);
    console.log('Redirecting with spotify_connected=true (user profile resolves in background)');

    const oauthState = req.query.state || 'hearwise';
    const postOrigin = JSON.stringify(config.getAppUrl() || (config.isProduction ? '' : '*'));

    if (oauthState === 'extension') {
      return res.send(`<!DOCTYPE html><html><head>
        <style>
          body{font-family:-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;
               display:flex;flex-direction:column;align-items:center;justify-content:center;
               height:100vh;margin:0;gap:16px;}
          .check{font-size:64px;}
          h1{font-size:22px;font-weight:800;color:#10b981;}
          p{font-size:14px;color:#94a3b8;text-align:center;}
        </style></head><body>
        <div class="check">✅</div>
        <h1>Spotify Connected!</h1>
        <p>Your HearWise extension is now linked to Spotify.<br>You can close this tab.</p>
        <script>
          var o = ${postOrigin} || '*';
          window.opener && window.opener.postMessage({ type: 'spotify_token', token: '${data.access_token}' }, o);
          setTimeout(function() { window.close(); }, 2000);
        </script>
      </body></html>`);
    }

    if (oauthState === 'popup') {
      return res.send(`<!DOCTYPE html><html><head>
        <style>
          body{font-family:-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;
               display:flex;flex-direction:column;align-items:center;justify-content:center;
               height:100vh;margin:0;gap:16px;}
          .check{font-size:64px;}
          h1{font-size:22px;font-weight:800;color:#10b981;}
          p{font-size:14px;color:#94a3b8;text-align:center;}
        </style></head><body>
        <div class="check">✅</div>
        <h1>Spotify Connected!</h1>
        <p>Returning to HearWise…</p>
        <script>
          try {
            var o = ${postOrigin} || '*';
            if (window.opener) window.opener.postMessage({ type: 'spotify_connected', sync: '${syncToken}' }, o);
          } catch (_) {}
          setTimeout(function() { window.close(); }, 1200);
        </script>
      </body></html>`);
    }

    res.redirect('/?spotify_connected=true&sync=' + encodeURIComponent(syncToken));
  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/?error=oauth_failed');
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Spotify Current Track
app.get('/api/spotify/current-track', async (req, res) => {
  try {
    const data = await fetchSpotifyPlaybackState(req);
    res.json(data);
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Spotify Playback State (includes volume)
app.get('/api/spotify/playback', async (req, res) => {
  try {
    await restoreSpotifySession(req);
    if (!req.session.access_token) {
      console.warn('[Spotify /playback] Not authenticated');
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const forceFresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const data = await fetchSpotifyPlaybackState(req, { forceFresh: forceFresh });
    if (data.item) {
      console.log('[Spotify /playback] Track:', data.item.name, '| Playing:', data.is_playing, '| Source:', data.playbackSource || 'player', forceFresh ? '(fresh)' : '');
    }
    res.json(data);
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      console.warn('[Spotify /playback] Not authenticated');
      return res.status(401).json({ error: 'Not authenticated' });
    }
    console.error('[Spotify /playback] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Spotify Playback Control
app.post('/api/spotify/skip', async (req, res) => {
  try {
    const resp = await spotifyApiCall(req, 'https://api.spotify.com/v1/me/player/next', { method: 'POST' });
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/spotify/pause', async (req, res) => {
  try {
    await spotifyApiCall(req, 'https://api.spotify.com/v1/me/player/pause', { method: 'PUT' });
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/spotify/play', async (req, res) => {
  try {
    await spotifyApiCall(req, 'https://api.spotify.com/v1/me/player/play', { method: 'PUT' });
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/spotify/volume', async (req, res) => {
  try {
    await restoreSpotifySession(req);
    if (!req.session.access_token) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const volume = Math.max(0, Math.min(100, parseInt(req.body.volume_percent, 10)));
    if (Number.isNaN(volume)) {
      return res.status(400).json({ success: false, error: 'volume_percent required (0–100)' });
    }

    let deviceId = req.body.device_id || null;
    let deviceName = null;

    try {
      const playback = await fetchSpotifyPlaybackState(req, { forceFresh: true });
      if (!deviceId && playback.device && playback.device.id) {
        deviceId = playback.device.id;
        deviceName = playback.device.name;
      }
    } catch (e) { /* ignore — fall back to devices list */ }

    if (!deviceId) {
      const devices = await fetchSpotifyDevices(req);
      const picked = pickSpotifyDevice(devices);
      if (picked && picked.id) {
        deviceId = picked.id;
        deviceName = picked.name;
      }
    }

    async function callVolumeApi(id) {
      let url = 'https://api.spotify.com/v1/me/player/volume?volume_percent=' + volume;
      if (id) url += '&device_id=' + encodeURIComponent(id);
      return spotifyApiCall(req, url, { method: 'PUT' });
    }

    let resp = await callVolumeApi(deviceId);
    if (resp.status !== 204 && !resp.ok && deviceId) {
      console.warn('[Spotify volume] retry without device_id after', resp.status);
      resp = await callVolumeApi(null);
    }

    if (resp.status === 204 || resp.ok) {
      console.log('[Spotify volume] Set to', volume + '%', deviceName ? 'on ' + deviceName : '');
      return res.json({
        success: true,
        volume_percent: volume,
        device_id: deviceId || undefined,
        device_name: deviceName || undefined
      });
    }

    let errText = '';
    try { errText = await resp.text(); } catch (e) { /* ignore */ }
    console.warn('[Spotify volume] failed', resp.status, errText);

    let hint = null;
    if (resp.status === 403) {
      hint = 'Spotify Premium is required to change volume remotely. Free accounts cannot use this API.';
    } else if (resp.status === 404) {
      hint = 'No active Spotify device found. Start playback in the Spotify desktop app, then try again.';
    } else if (resp.status === 429) {
      hint = 'Spotify rate limit — volume change will retry on the next Auto-Pilot check.';
    }

    return res.status(resp.status >= 400 ? resp.status : 500).json({
      success: false,
      error: errText || 'Spotify volume change failed',
      hint,
      device_id: deviceId || undefined
    });
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/system/volume', async (req, res) => {
  if (!systemVolume.isSupported()) {
    return res.json({ available: false });
  }
  try {
    const data = await systemVolume.getSystemVolume();
    res.json(data);
  } catch (err) {
    res.status(500).json({ available: false, error: err.message });
  }
});

app.put('/api/system/volume', async (req, res) => {
  if (!systemVolume.isSupported()) {
    return res.status(501).json({ available: false, error: 'System volume control is not supported on this host' });
  }
  try {
    const data = await systemVolume.setSystemVolume(req.body.volume_percent);
    if (!data.available) return res.status(501).json(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ available: false, error: err.message });
  }
});

// Get Available Devices
app.get('/api/spotify/devices', async (req, res) => {
  try {
    const resp = await spotifyApiCall(req, 'https://api.spotify.com/v1/me/player/devices');
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Transfer Playback to Device
app.put('/api/spotify/device', async (req, res) => {
  try {
    await spotifyApiCall(req, 'https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_ids: [req.body.device_id], play: true })
    });
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

// NEW: Listening History Ingestion
app.get('/api/spotify/recently-played', async (req, res) => {
  try {
    const limit = req.query.limit || 50;
    const resp = await spotifyApiCall(req, `https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`);
    const data = await resp.json();
    
    // Store listening history in database
    await storeListeningHistory(data.items, req.session.user_id);
    
    res.json(data);
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

// NEW: User Profile
app.get('/api/spotify/profile', async (req, res) => {
  try {
    await restoreSpotifySession(req);
    if (!req.session.access_token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (isSpotifyGloballyBackedOff()) {
      return res.status(429).json({
        error: 'rate_limited',
        retryAfter: Math.ceil((_spotifyGlobalBackoffUntil - Date.now()) / 1000)
      });
    }
    const resp = await spotifyApiCall(req, 'https://api.spotify.com/v1/me');
    if (resp.status === 429) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const data = await resp.json();
    req.session.user_id = data.id;
    req.session.spotify_user_id = data.id;
    res.json(data);
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

// NEW: Top Tracks
app.get('/api/spotify/top-tracks', async (req, res) => {
  try {
    const limit = req.query.limit || 20;
    const timeRange = req.query.time_range || 'medium_term';
    const resp = await spotifyApiCall(req, `https://api.spotify.com/v1/me/top/tracks?limit=${limit}&time_range=${timeRange}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Weekly Listening Statistics — paginated recently-played with gap-based listen estimates
app.get('/api/spotify/weekly-stats', async (req, res) => {
  try {
    await restoreSpotifySession(req);
    if (!req.session.access_token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const cacheKey = playbackCacheKey(req);
    const forceFresh = req.query.fresh === '1';
    const cached = _weeklyStatsCache.get(cacheKey);
    if (!forceFresh && cached && (Date.now() - cached.at) < WEEKLY_STATS_TTL_MS) {
      return res.json(cached.data);
    }

    const items = await fetchSpotifyRecentWeek(req);
    if (!items.length) {
      return res.json({
        todayMinutes: 0,
        weeklyMinutes: 0,
        sessionCount: 0,
        avgSessionLength: 0,
        longestSession: 0,
        trackCount: 0,
        sessions: [],
        source: 'spotify_recently_played'
      });
    }

    const volumePercent = await getSpotifyPlaybackVolume(req);
    const stats = aggregateSpotifyWeeklyStats(items, volumePercent);
    const payload = {
      todayMinutes: stats.todayMinutes,
      weeklyMinutes: stats.weeklyMinutes,
      sessionCount: stats.sessionCount,
      avgSessionLength: stats.avgSessionLength,
      longestSession: stats.longestSession,
      trackCount: stats.trackCount,
      sessions: stats.sessions,
      volumePercent: stats.volumePercent,
      estimatedDb: stats.estimatedDb,
      source: 'spotify_recently_played'
    };
    _weeklyStatsCache.set(cacheKey, { data: payload, at: Date.now() });
    trimCacheMap(_weeklyStatsCache, 30);
    res.json(payload);
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

function spotifyVolumeToDb(volumePercent) {
  const v = Math.max(0, Math.min(100, Number(volumePercent) || 70));
  return Math.round(40 + v * 0.6);
}

/** Paginate recently-played — max 3 pages; stop immediately on 429. */
async function fetchSpotifyRecentWeek(req) {
  if (isSpotifyGloballyBackedOff()) return [];

  const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const allItems = [];
  let before = null;

  for (let page = 0; page < 3; page++) {
    const url = before
      ? `https://api.spotify.com/v1/me/player/recently-played?limit=50&before=${before}`
      : 'https://api.spotify.com/v1/me/player/recently-played?limit=50';
    const resp = await spotifyApiCall(req, url);
    if (resp.status === 429) break;
    const data = await resp.json().catch(function () { return {}; });
    if (!data.items || !data.items.length) break;

    allItems.push(...data.items);
    const oldest = new Date(data.items[data.items.length - 1].played_at).getTime();
    if (oldest < weekAgoMs) break;

    const cursorBefore = data.cursors && data.cursors.before;
    if (cursorBefore) {
      before = cursorBefore;
    } else {
      before = oldest;
    }
    if (page > 0 && before === data.cursors?.before) break;
  }

  return allItems.filter(function (item) {
    return new Date(item.played_at).getTime() >= weekAgoMs;
  });
}

/** Estimate actual listen time from play timestamps (handles skips better than full track length). */
function aggregateSpotifyWeeklyStats(items, volumePercent) {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const weekItems = items
    .map((item) => ({
      playedAt: new Date(item.played_at),
      trackMs: item.track.duration_ms || 0,
      trackName: item.track.name,
      artistName: (item.track.artists && item.track.artists[0] && item.track.artists[0].name) || 'Unknown',
      albumArt: item.track.album && item.track.album.images && item.track.album.images[0]
        ? item.track.album.images[0].url
        : null
    }))
    .sort((a, b) => b.playedAt - a.playedAt);

  let weeklyMinutes = 0;
  let todayMinutes = 0;
  const tracks = [];

  for (let i = 0; i < weekItems.length; i++) {
    const cur = weekItems[i];
    let listenedMs;
    if (i === 0) {
      listenedMs = Math.min(cur.trackMs, Math.max(0, now - cur.playedAt.getTime()));
    } else {
      const gapMs = weekItems[i - 1].playedAt - cur.playedAt;
      listenedMs = Math.min(cur.trackMs, Math.max(0, gapMs));
    }
    if (listenedMs < 15000) continue;
    const durationMin = listenedMs / 60000;
    weeklyMinutes += durationMin;
    if (cur.playedAt >= todayStart) todayMinutes += durationMin;
    tracks.push({
      trackName: cur.trackName,
      artistName: cur.artistName,
      albumArt: cur.albumArt,
      playedAt: cur.playedAt.toISOString(),
      durationMin: Math.round(durationMin * 10) / 10
    });
  }

  const asc = tracks.slice().sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt));
  let sessionCount = asc.length ? 1 : 0;
  let longestSession = 0;
  let sessionMin = 0;
  const SESSION_GAP_MS = 20 * 60 * 1000;

  for (let i = 0; i < asc.length; i++) {
    sessionMin += asc[i].durationMin;
    if (i < asc.length - 1) {
      const gap = new Date(asc[i + 1].playedAt) - new Date(asc[i].playedAt);
      if (gap > SESSION_GAP_MS) {
        sessionCount++;
        longestSession = Math.max(longestSession, sessionMin);
        sessionMin = 0;
      }
    }
  }
  if (sessionMin > 0) {
    longestSession = Math.max(longestSession, sessionMin);
  }

  const vol = volumePercent != null ? volumePercent : 70;
  const estimatedDb = spotifyVolumeToDb(vol);
  const weeklyExposurePercent = computeNioshWeeklyDosePercent(weeklyMinutes, vol);
  const dailyExposurePercent = computeNioshWeeklyDosePercent(todayMinutes, vol);

  let riskLevel = 'Safe';
  if (weeklyExposurePercent > 80) riskLevel = 'High';
  else if (weeklyExposurePercent > 50) riskLevel = 'Elevated';
  else if (weeklyExposurePercent > 25) riskLevel = 'Moderate';

  return {
    todayMinutes: Math.round(todayMinutes),
    weeklyMinutes: Math.round(weeklyMinutes),
    sessionCount: sessionCount || (tracks.length ? 1 : 0),
    avgSessionLength: sessionCount > 0 ? Math.round(weeklyMinutes / sessionCount) : 0,
    longestSession: Math.round(longestSession),
    trackCount: tracks.length,
    sessions: tracks.slice(0, 30),
    volumePercent: vol,
    estimatedDb,
    dailyExposurePercent: Math.min(100, dailyExposurePercent),
    weeklyExposurePercent,
    riskLevel
  };
}

function computeNioshWeeklyDosePercent(weeklyMinutes, volumePercent) {
  const mins = Math.max(0, Number(weeklyMinutes) || 0);
  const estimatedDb = spotifyVolumeToDb(volumePercent);
  const referenceTime = 8 * 60;
  const exchangeRate = 3;
  const dosePerMinute = Math.pow(10, (estimatedDb - 80) / exchangeRate);
  const weeklyDose = (mins * dosePerMinute) / referenceTime;
  return Math.round(Math.max(0, weeklyDose * 100));
}

async function getSpotifyPlaybackVolume(req) {
  try {
    if (isSpotifyGloballyBackedOff()) return 70;
    const data = await fetchSpotifyPlaybackState(req);
    return data.device?.volume_percent ?? 70;
  } catch {
    return 70;
  }
}

// Hearing Exposure Score — NIOSH dose from recently-played history + live device volume
app.get('/api/spotify/exposure-score', async (req, res) => {
  try {
    await restoreSpotifySession(req);
    if (!req.session.access_token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const cacheKey = playbackCacheKey(req);
    const forceFresh = req.query.fresh === '1';
    const cached = _exposureScoreCache.get(cacheKey);
    if (!forceFresh && cached && (Date.now() - cached.at) < WEEKLY_STATS_TTL_MS) {
      return res.json(cached.data);
    }

    const items = await fetchSpotifyRecentWeek(req);
    const volumePercent = await getSpotifyPlaybackVolume(req);

    if (!items.length) {
      return res.json({
        dailyExposurePercent: 0,
        weeklyExposurePercent: 0,
        riskLevel: 'Safe',
        volumePercent,
        estimatedDb: spotifyVolumeToDb(volumePercent),
        todayMinutes: 0,
        weeklyMinutes: 0,
        trackCount: 0,
        note: 'No recent listening history yet — connect Spotify and play music to build your score'
      });
    }

    const stats = aggregateSpotifyWeeklyStats(items, volumePercent);

    const payload = {
      dailyExposurePercent: stats.dailyExposurePercent,
      weeklyExposurePercent: stats.weeklyExposurePercent,
      riskLevel: stats.riskLevel,
      todayMinutes: stats.todayMinutes,
      weeklyMinutes: stats.weeklyMinutes,
      trackCount: stats.trackCount,
      volumePercent: stats.volumePercent,
      estimatedDb: stats.estimatedDb,
      note: 'NIOSH dose from your last 7 days of Spotify history at ~' + stats.estimatedDb + ' dB (device volume ' + stats.volumePercent + '%)'
    };
    _exposureScoreCache.set(cacheKey, { data: payload, at: Date.now() });
    trimCacheMap(_exposureScoreCache, 30);
    res.json(payload);
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Audio features + artist genres for session type detection
app.get('/api/spotify/track-context/:trackId', async (req, res) => {
  try {
    const { trackId } = req.params;
    const artistId = req.query.artistId;
    if (!trackId) return res.status(400).json({ error: 'trackId is required' });

    const featuresResp = await spotifyApiCall(req, `https://api.spotify.com/v1/audio-features/${trackId}`);
    let features = null;
    if (featuresResp.ok) {
      const data = await featuresResp.json();
      features = {
        energy: data.energy,
        valence: data.valence,
        tempo: data.tempo,
        acousticness: data.acousticness,
        danceability: data.danceability,
        instrumentalness: data.instrumentalness,
        liveness: data.liveness,
        speechiness: data.speechiness,
        loudness: data.loudness
      };
    }

    let genres = [];
    if (artistId) {
      try {
        const artistResp = await spotifyApiCall(req, `https://api.spotify.com/v1/artists/${artistId}`);
        if (artistResp.ok) {
          const artist = await artistResp.json();
          genres = artist.genres || [];
        }
      } catch (_) { /* optional */ }
    }

    res.json({ trackId, features, genres });
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Playlist name for session classifier (Lofi Girl radio, etc.)
app.get('/api/spotify/playlist/:id/name', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ name: '' });
    const resp = await spotifyApiCall(req, `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}?fields=name`);
    if (!resp.ok) return res.json({ name: '' });
    const data = await resp.json();
    res.json({ name: data.name || '' });
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({ name: '' });
  }
});

// NEW: Get Audio Features for Calm Audio Detection
app.get('/api/spotify/audio-features/:trackId', async (req, res) => {
  try {
    const { trackId } = req.params;
    if (!trackId) {
      return res.status(400).json({ error: 'trackId is required' });
    }
    
    const resp = await spotifyApiCall(req, `https://api.spotify.com/v1/audio-features/${trackId}`);
    const data = await resp.json();
    
    // Analyze if track is "calm"
    const isCalm = data.energy < 0.4 && data.tempo < 100 && data.acousticness > 0.5;
    
    res.json({
      trackId,
      features: {
        energy: data.energy,
        valence: data.valence,
        tempo: data.tempo,
        acousticness: data.acousticness,
        danceability: data.danceability,
        instrumentalness: data.instrumentalness,
        liveness: data.liveness,
        speechiness: data.speechiness,
        loudness: data.loudness,
        mode: data.mode,
        key: data.key,
        time_signature: data.time_signature
      },
      isCalm,
      calmScore: Math.round((1 - data.energy) * 0.4 + (1 - data.tempo/200) * 0.3 + data.acousticness * 0.3) * 100
    });
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

// NEW: Track Morning Routine Progress
app.get('/api/spotify/morning-routine', async (req, res) => {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    
    // Check if it's morning (6AM - 10AM)
    const isMorning = currentHour >= 6 && currentHour <= 10;
    
    // Get recently played tracks from this morning
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0);
    const resp = await spotifyApiCall(req, 'https://api.spotify.com/v1/me/player/recently-played?limit=50');
    const data = await resp.json();
    
    let morningCalmMinutes = 0;
    let morningTotalMinutes = 0;
    const calmTracks = [];
    
    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        const playedAt = new Date(item.played_at);
        
        // Only count tracks played this morning between 6-10AM
        if (playedAt >= todayStart && playedAt.getHours() >= 6 && playedAt.getHours() <= 10) {
          const durationMin = item.track.duration_ms / 60000;
          morningTotalMinutes += durationMin;
          
          // For now, estimate calmness based on track name/artist (real analysis would need audio features API call)
          const trackName = item.track.name.toLowerCase();
          const artistName = item.track.artists[0].name.toLowerCase();
          const isLikelyCalm = 
            trackName.includes('calm') || 
            trackName.includes('peace') || 
            trackName.includes('relax') ||
            trackName.includes('meditation') ||
            trackName.includes('sleep') ||
            trackName.includes('ambient') ||
            trackName.includes('piano') ||
            trackName.includes('acoustic') ||
            artistName.includes('relaxation') ||
            artistName.includes('meditation') ||
            artistName.includes('sleep') ||
            artistName.includes('ambient') ||
            artistName.includes('piano') ||
            artistName.includes('classical');
          
          if (isLikelyCalm) {
            morningCalmMinutes += durationMin;
            calmTracks.push({
              name: item.track.name,
              artist: item.track.artists[0].name,
              duration: Math.round(durationMin),
              playedAt: item.played_at
            });
          }
        }
      }
    }
    
    // Goal: 15 minutes of calm audio in the morning
    const goalMinutes = 15;
    const progress = Math.min(100, Math.round((morningCalmMinutes / goalMinutes) * 100));
    const isComplete = morningCalmMinutes >= goalMinutes;
    
    res.json({
      isMorning,
      currentHour,
      morningWindow: '6:00 AM - 10:00 AM',
      morningTotalMinutes: Math.round(morningTotalMinutes),
      morningCalmMinutes: Math.round(morningCalmMinutes),
      goalMinutes,
      progress,
      isComplete,
      calmTracks,
      message: isComplete 
        ? '🌅 Early Bird badge earned! You listened to ' + Math.round(morningCalmMinutes) + ' min of calm audio this morning.'
        : `Listen to ${Math.round(goalMinutes - morningCalmMinutes)} more minutes of calm audio to earn the Early Bird badge.`,
      badge: isComplete ? '🌅 Early Bird' : null
    });
  } catch (err) {
    if (err.message === 'Not authenticated' || err.message === 'Token refresh failed') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.status(500).json({ error: err.message });
  }
});

// NEW: Disconnect Spotify
app.post('/api/spotify/disconnect', async (req, res) => {
  try {
    req.session.access_token = null;
    req.session.refresh_token = null;
    req.session.spotify_user_id = null;
    res.setHeader('Set-Cookie', 'hw_spotify_uid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW: Listening Analytics
app.get('/api/analytics/listening-summary', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const userId = req.session.user_id;
    const days = req.query.days || 7;
    
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_tracks,
        SUM(listened_duration_ms) / 60000 as total_minutes,
        AVG(volume_percent) as avg_volume,
        COUNT(DISTINCT DATE(start_time)) as active_days
      FROM listening_sessions
      WHERE user_id = $1 
      AND start_time >= NOW() - INTERVAL '${days} days'`,
      [userId]
    );
    
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW: Weekly Listening Breakdown
app.get('/api/analytics/weekly-breakdown', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const userId = req.session.user_id;
    const weeks = req.query.weeks || 4;
    
    const result = await pool.query(
      `SELECT 
        week_start,
        week_end,
        total_minutes,
        total_tracks,
        avg_volume_percent,
        dose_percent
      FROM weekly_listening
      WHERE user_id = $1
      ORDER BY week_start DESC
      LIMIT $2`,
      [userId, weeks]
    );
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Risk Prediction Endpoint
app.post('/api/risk/predict', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { listeningDuration, volumeExposure, sessionFrequency, consecutiveTime, age, headphoneType, recoveryHabits } = req.body;
    
    // Use risk model for prediction
    const features = {
      listeningDuration: listeningDuration || 0,
      volumeExposure: volumeExposure || 0,
      sessionFrequency: sessionFrequency || 0,
      consecutiveTime: consecutiveTime || 0,
      age: age || 25,
      headphoneType: headphoneType || 'over-ear',
      recoveryHabits: recoveryHabits || 5
    };
    
    const prediction = riskModel.predict(features);
    
    // Store prediction in database
    await pool.query(
      `INSERT INTO risk_predictions (user_id, risk_score, risk_category, confidence, features, model_version)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.session.user_id, prediction.riskScore, prediction.riskCategory, prediction.confidence, features, riskModel.model?.version || '1.0']
    );
    
    res.json({
      riskScore: prediction.riskScore,
      riskCategory: prediction.riskCategory,
      confidence: prediction.confidence,
      featureContributions: prediction.featureContributions,
      recommendations: generateRecommendations(prediction.riskCategory)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public ML demo endpoint (no auth — for demo profiles)
app.post('/api/ml/predict-demo', (req, res) => {
  try {
    const {
      listeningDuration = 240,
      volumeExposure = 65,
      sessionFrequency = 6,
      consecutiveTime = 60,
      age = 22,
      headphoneType = 'over-ear',
      recoveryHabits = 6
    } = req.body || {};

    const features = {
      listeningDuration,
      volumeExposure,
      sessionFrequency,
      consecutiveTime,
      age,
      headphoneType,
      recoveryHabits
    };

    const prediction = riskModel.predict(features);
    res.json({
      model: 'HearingRiskModel',
      version: riskModel.model?.version || '1.0',
      features,
      riskScore: prediction.riskScore,
      riskCategory: prediction.riskCategory,
      confidence: prediction.confidence,
      featureContributions: prediction.featureContributions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listening pattern endpoints
app.get('/api/behavioral/segment', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const segment = await behavioralAnalyzer.segmentUser(req.session.user_id);
    res.json(segment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/behavioral/patterns', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const patterns = await behavioralAnalyzer.analyzeListeningPatterns(req.session.user_id);
    res.json(patterns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/behavioral/habits', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const habits = await behavioralAnalyzer.detectHabits(req.session.user_id);
    res.json(habits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/behavioral/full-analysis', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const analysis = await behavioralAnalyzer.performFullAnalysis(req.session.user_id);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW: Risk Forecasting Endpoints
app.get('/api/forecast/30-day', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const forecast = await riskForecaster.forecastRisk30Days(req.session.user_id);
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/forecast/90-day', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const forecast = await riskForecaster.forecastRisk90Days(req.session.user_id);
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/forecast/combined', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const forecast = await riskForecaster.getCombinedForecast(req.session.user_id);
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW: Real-Time Alerts Endpoints
app.post('/api/alerts/check-unsafe', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { currentVolume, sessionDuration, consecutiveMinutes } = req.body;
    
    // Hearing alert: loud volume AND session over 90 minutes (both required)
    const alerts = [];
    const vol = Number(currentVolume) || 0;
    const sessionMins = Number(sessionDuration) || Number(consecutiveMinutes) || 0;
    const LOUD_VOL = 75;
    const MIN_SESSION_MINS = 90;

    if (vol >= LOUD_VOL && sessionMins >= MIN_SESSION_MINS) {
      alerts.push({
        type: 'unsafe_listening',
        severity: 'high',
        message: `Volume at ${vol}% for ${Math.floor(sessionMins)}+ minutes — ears need a break.`,
        recommendation: 'Lower volume below 75% and take a 10-minute silence break'
      });
      await storeAlert(
        req.session.user_id,
        'unsafe_listening',
        'high',
        `Loud (${vol}%) session ${Math.floor(sessionMins)} min`
      );
    }
    
    res.json({ alerts, hasAlerts: alerts.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/alerts', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const result = await pool.query(
      `SELECT * FROM alerts
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.session.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/alerts/:alertId/dismiss', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    await pool.query(
      `UPDATE alerts SET is_dismissed = true WHERE id = $1 AND user_id = $2`,
      [req.params.alertId, req.session.user_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW: Listening Streak Monitoring
app.get('/api/streaks', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(DISTINCT DATE(start_time)) as current_streak,
        MAX(start_time) as last_listening_date
      FROM listening_sessions
      WHERE user_id = $1
      AND start_time >= NOW() - INTERVAL '30 days'`,
      [req.session.user_id]
    );
    
    const streak = result.rows[0] || { current_streak: 0, last_listening_date: null };
    
    res.json({
      currentStreak: streak.current_streak,
      lastListeningDate: streak.last_listening_date,
      streakGoal: 30,
      streakProgress: Math.round((streak.current_streak / 30) * 100)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW: Recommended Breaks
app.get('/api/breaks/recommend', async (req, res) => {
  if (!req.session.user_id) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { sessionDuration, currentVolume } = req.query;
    
    let breakRecommendation = {
      shouldTakeBreak: false,
      recommendedDuration: 0,
      reason: '',
      urgency: 'low'
    };
    
    const duration = parseInt(sessionDuration) || 0;
    const volume = parseInt(currentVolume) || 0;
    
    if (duration > 45 || volume > 80) {
      breakRecommendation.shouldTakeBreak = true;
      breakRecommendation.recommendedDuration = 10;
      breakRecommendation.reason = duration > 45 ? 'Session duration exceeds 45 minutes' : 'Volume exceeds safe threshold';
      breakRecommendation.urgency = volume > 85 ? 'high' : 'medium';
    } else if (duration > 30) {
      breakRecommendation.shouldTakeBreak = true;
      breakRecommendation.recommendedDuration = 5;
      breakRecommendation.reason = 'Session duration exceeds 30 minutes';
      breakRecommendation.urgency = 'low';
    }
    
    res.json(breakRecommendation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper Functions
async function storeUserInDatabase(accessToken, userData) {
  try {
    if (!userData) {
      userData = await fetchSpotifyMe(accessToken, 1);
    }
    if (!userData || !userData.id) return null;

    const result = await pool.query(
      `INSERT INTO users (spotify_id, display_name, email, country)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (spotify_id) DO UPDATE SET
         display_name = excluded.display_name,
         email = excluded.email,
         updated_at = datetime('now')
       RETURNING id`,
      [userData.id, userData.display_name, userData.email, userData.country]
    );
    
    return result.rows[0]?.id;
  } catch (err) {
    console.error('Error storing user:', err.message || err);
  }
}

async function storeListeningHistory(items, userId) {
  try {
    for (const item of items) {
      const track = item.track;
      await pool.query(
        `INSERT INTO listening_sessions (user_id, spotify_track_id, track_name, artist_name, album_name, duration_ms, listened_duration_ms, start_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [userId, track.id, track.name, track.artists[0].name, track.album.name, track.duration_ms, item.played_at, item.played_at]
      );
    }
  } catch (err) {
    console.error('Error storing listening history:', err);
  }
}

function generateRecommendations(category) {
  const recommendations = {
    Low: [
      'Maintain your current healthy listening habits',
      'Continue taking regular breaks between sessions'
    ],
    Moderate: [
      'Reduce listening volume by 10-15%',
      'Take 5-minute breaks every hour',
      'Limit daily listening to under 4 hours'
    ],
    High: [
      'Reduce listening volume by 25-30%',
      'Take 10-minute breaks every 30 minutes',
      'Limit daily listening to under 2 hours',
      'Consider noise-canceling headphones at lower volumes'
    ]
  };
  return recommendations[category] || [];
}

async function storeAlert(userId, alertType, severity, message) {
  try {
    await pool.query(
      `INSERT INTO alerts (user_id, alert_type, severity, message)
       VALUES ($1, $2, $3, $4)`,
      [userId, alertType, severity, message]
    );
  } catch (err) {
    console.error('Error storing alert:', err);
  }
}

// ==================== CHALLENGE MANAGEMENT ENDPOINTS ====================

// Get available challenges for a profile
app.get('/api/challenges/available/:profileId', (req, res) => {
  const { profileId } = req.params;
  const challenges = getChallengesForProfile(profileId);
  res.json({ challenges });
});

// Start a challenge
app.post('/api/challenges/start', async (req, res) => {
  try {
    const { challengeId, userId, currentWellnessScore, currentHearingRiskAge } = req.body;
    const challenge = getChallengeById(challengeId);
    
    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }
    
    const challengeInstanceId = uuidv4();
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + challenge.duration * 24 * 60 * 60 * 1000).toISOString();
    
    await pool.query(
      `INSERT INTO user_challenges (id, user_id, challenge_id, start_date, end_date, status, current_progress, total_days, current_wellness_score, current_hearing_risk_age)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [challengeInstanceId, userId, challengeId, startDate, endDate, 'active', 0, challenge.duration, currentWellnessScore, currentHearingRiskAge]
    );
    
    res.json({
      success: true,
      challengeInstanceId,
      challenge,
      startDate,
      endDate,
      projectedImpact: challenge.expectedImpact
    });
  } catch (err) {
    console.error('Error starting challenge:', err);
    res.status(500).json({ error: 'Failed to start challenge' });
  }
});

// Get active challenges for a user
app.get('/api/challenges/active/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT * FROM user_challenges WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    
    const activeChallenges = await Promise.all(result.rows.map(async (row) => {
      const challenge = getChallengeById(row.challenge_id);
      const daysElapsed = Math.floor((Date.now() - new Date(row.start_date).getTime()) / (24 * 60 * 60 * 1000));
      const progress = Math.min(daysElapsed, row.total_days);
      
      return {
        ...row,
        challenge,
        progress,
        daysElapsed,
        completionPercent: Math.round((progress / row.total_days) * 100)
      };
    }));
    
    res.json({ activeChallenges });
  } catch (err) {
    console.error('Error fetching active challenges:', err);
    res.status(500).json({ error: 'Failed to fetch active challenges' });
  }
});

// Update challenge progress
app.post('/api/challenges/progress', async (req, res) => {
  try {
    const { challengeInstanceId, progress } = req.body;
    
    await pool.query(
      `UPDATE user_challenges SET current_progress = $1 WHERE id = $2`,
      [progress, challengeInstanceId]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating challenge progress:', err);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Complete a challenge
app.post('/api/challenges/complete', async (req, res) => {
  try {
    const { challengeInstanceId, userId } = req.body;
    
    // Update challenge status
    await pool.query(
      `UPDATE user_challenges SET status = 'completed', completed_at = $1 WHERE id = $2`,
      [new Date().toISOString(), challengeInstanceId]
    );
    
    // Get challenge details
    const result = await pool.query(
      `SELECT * FROM user_challenges WHERE id = $1`,
      [challengeInstanceId]
    );
    
    const challengeRow = result.rows[0];
    const challenge = getChallengeById(challengeRow.challenge_id);
    
    // Award achievement
    const achievementId = `challenge-${challengeRow.challenge_id}`;
    await pool.query(
      `INSERT INTO user_achievements (id, user_id, achievement_id, earned_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, achievement_id) DO NOTHING`,
      [uuidv4(), userId, achievementId, new Date().toISOString()]
    );
    
    res.json({
      success: true,
      challenge,
      impact: challenge.expectedImpact,
      achievementAwarded: true
    });
  } catch (err) {
    console.error('Error completing challenge:', err);
    res.status(500).json({ error: 'Failed to complete challenge' });
  }
});

// Get user achievements
app.get('/api/achievements/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT * FROM user_achievements WHERE user_id = $1`,
      [userId]
    );
    
    const achievements = result.rows.map(row => {
      const achievement = getAllAchievements().find(a => a.id === row.achievement_id);
      return {
        ...achievement,
        earnedAt: row.earned_at
      };
    });
    
    res.json({ achievements });
  } catch (err) {
    console.error('Error fetching achievements:', err);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

// ── Spotify connect flow for Chrome extension ─────────────
// Extension opens /spotify-connect → user logs in → /callback captures
// token → extension polls /api/extension-token to retrieve it.

app.get('/spotify-connect', (req, res) => {
  const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-library-read',
    'streaming'
  ].join(' ');
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id:     client_id,
    response_type: 'code',
    redirect_uri:  redirect_uri,
    scope:         scopes,
    state:         'extension',
    show_dialog:   'true'
  });
  res.redirect(url);
});

app.get('/api/extension-token', (req, res) => {
  if (_extensionToken) {
    res.json({ token: _extensionToken });
    _extensionToken = null; // consume once
  } else {
    res.json({ token: null });
  }
});

// ── Focus Flow extension data receiver ───────────────────
let _latestFocusData = null;

app.post('/api/focus-data', (req, res) => {
  _latestFocusData = { ...req.body, receivedAt: Date.now() };
  res.json({ ok: true });
});

app.get('/api/focus-data', (req, res) => {
  res.json(_latestFocusData || {});
});

// ==================== COACHING ENGINE ====================

const LEVELS = [
  { level: 1, title: 'Ear Explorer',      minXp: 0    },
  { level: 2, title: 'Sound Aware',       minXp: 300  },
  { level: 3, title: 'Volume Guardian',   minXp: 800  },
  { level: 4, title: 'Hearing Protector', minXp: 1800 },
  { level: 5, title: 'Wellness Champion', minXp: 3500 },
  { level: 6, title: 'HearWise Master',   minXp: 6000 },
];

function getLevelFromXp(xp) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].minXp) return LEVELS[i];
  }
  return LEVELS[0];
}

function getNextLevel(xp) {
  const cur = getLevelFromXp(xp);
  return LEVELS.find(l => l.level === cur.level + 1) || null;
}

const WEEKLY_CHALLENGES = [
  { type: 'volume',    label: 'Volume Week',    desc: 'Keep average volume ≤ 65% all week' },
  { type: 'breaks',    label: 'Break Week',     desc: 'No session over 45 min without a break' },
  { type: 'morning',   label: 'Morning Week',   desc: '10 min of calm audio each morning' },
  { type: 'reduction', label: 'Reduction Week', desc: '20% less total listening than last week' },
];

function getWeekStart() {
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

async function getOrCreateCoachingProfile(userId) {
  let result = await pool.query(`SELECT * FROM coaching_profiles WHERE user_id = ?`, [userId]);
  if (result.rows.length === 0) {
    await pool.query(
      `INSERT INTO coaching_profiles (user_id, xp, level, streak_days, longest_streak, hearing_age_score, chronological_age)
       VALUES (?,0,1,0,0,22,22)`,
      [userId]
    );
    result = await pool.query(`SELECT * FROM coaching_profiles WHERE user_id = ?`, [userId]);
  }
  return result.rows[0];
}

async function awardXp(userId, amount, eventType, description) {
  await pool.query(
    `INSERT INTO xp_events (id, user_id, xp_amount, event_type, description) VALUES (?,?,?,?,?)`,
    [uuidv4(), userId, amount, eventType, description]
  );
  const profile = await getOrCreateCoachingProfile(userId);
  const newXp = (profile.xp || 0) + amount;
  const newLevel = getLevelFromXp(newXp).level;
  await pool.query(
    `UPDATE coaching_profiles SET xp=?, level=?, updated_at=datetime('now') WHERE user_id=?`,
    [newXp, newLevel, userId]
  );
  return { newXp, newLevel, leveledUp: newLevel > (profile.level || 1) };
}

async function buildUserContext(userId) {
  let recentListening = null;
  try {
    const r = await pool.query(
      `SELECT COUNT(*) as sessions, SUM(listened_duration_ms)/60000 as total_min
       FROM listening_sessions WHERE user_id=? AND start_time >= datetime('now','-7 days')`,
      [userId]
    );
    recentListening = r.rows[0];
  } catch(e) {}

  const profile = await getOrCreateCoachingProfile(userId);
  const levelInfo = getLevelFromXp(profile.xp || 0);

  return {
    streak: profile.streak_days || 0,
    xp: profile.xp || 0,
    level: levelInfo.title,
    hearingAge: profile.hearing_age_score || profile.chronological_age || 22,
    chronologicalAge: profile.chronological_age || 22,
    weeklyMinutes: recentListening?.total_min ? Math.round(recentListening.total_min) : null,
    sessions: recentListening?.sessions || null,
  };
}

function pickMission(earComfort, breaksTaken, symptoms) {
  const missions = [
    { type: 'volume',    text: 'Keep your listening volume at or below 65% for your next 3 sessions', xp: 50 },
    { type: 'breaks',    text: 'Take a 10-minute ear break after your next listening session hits 45 minutes', xp: 50 },
    { type: 'morning',   text: 'Start today with 15 minutes of calm or acoustic audio before 10 AM', xp: 60 },
    { type: 'reduction', text: 'Listen 20% less today than your recent daily average', xp: 50 },
    { type: 'awareness', text: 'After your next session, note how your ears feel and rate your comfort', xp: 40 },
  ];
  if (symptoms && symptoms !== 'none') return missions[1];
  if (earComfort <= 2) return missions[3];
  if (breaksTaken === 'no') return missions[1];
  const hour = new Date().getHours();
  if (hour < 10) return missions[2];
  return missions[Math.floor(Math.random() * missions.length)];
}

function generateCheckinCoachResponse(ctx, mission, earComfort, breaksTaken, symptoms) {
  if (symptoms && symptoms !== 'none') {
    return `You reported ${symptoms} — take it easy on volume today. ${ctx.streak > 0 ? `Your ${ctx.streak}-day streak shows real commitment. ` : ''}Today's mission: ${mission.text}`;
  }
  if (earComfort <= 2) {
    return `Your ears rated ${earComfort}/5 today, so recovery matters. ${ctx.streak > 0 ? `You're on a ${ctx.streak}-day streak — ` : ''}here's today's mission: ${mission.text}`;
  }
  if (breaksTaken === 'no') {
    return `Breaks make a big difference for hearing health. ${ctx.streak > 0 ? `Keep your ${ctx.streak}-day streak going with ` : 'Start with '}today's mission: ${mission.text}`;
  }
  const fallbacks = [
    `You're on a ${ctx.streak}-day streak — that consistency is what hearing health is built on. Today's mission is designed around your check-in.`,
    `${ctx.streak > 0 ? `Your ${ctx.streak}-day streak shows real commitment.` : 'Every check-in makes a difference.'} Based on how your ears feel today, here's your mission.`,
    `Level ${ctx.level} and going strong. Here's today's hearing mission to keep your ears protected.`,
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

function generateChatReply(message, ctx, score, hearingAge) {
  const q = (message || '').toLowerCase().trim();
  const scoreText = score != null ? `${score}/100` : 'on your dashboard';

  if (/safe|is my listening|risky|am i ok/.test(q)) {
    return `Your Ear Score is ${scoreText}, hearing age is ${hearingAge}, and you're at level "${ctx.level}" with a ${ctx.streak}-day streak.${ctx.weeklyMinutes ? ` You listened about ${ctx.weeklyMinutes} minutes this week.` : ''} Focus on volume breaks and keeping sessions under 60 minutes when possible.`;
  }
  if (/break|rest|tired|ringing|muffled/.test(q)) {
    return `If your ears feel strained, take a 10–15 minute break in a quiet space before your next session. ${ctx.streak > 0 ? `Your ${ctx.streak}-day streak is worth protecting — ` : ''}lower volume one step when you resume.`;
  }
  if (/volume|loud|db|decibel/.test(q)) {
    return `Try keeping volume at or below 65% for your next few sessions. At level "${ctx.level}" with Ear Score ${scoreText}, small volume changes often reduce weekly dose more than cutting listening time.`;
  }
  if (/reduce|lower|change|improve|what should/.test(q)) {
    return `Based on your ${ctx.streak}-day streak and Ear Score ${scoreText}, start with one quieter session today and a break after 45 minutes. Consistency beats big one-day changes.`;
  }
  if (/score|wellness|hearing age|age/.test(q)) {
    return `You're at Ear Score ${scoreText} with hearing age ${hearingAge} (actual age ${ctx.chronologicalAge}). ${ctx.weeklyMinutes ? `This week: ~${ctx.weeklyMinutes} minutes of listening.` : ''} Ask me about volume, breaks, or safe listening habits.`;
  }

  return `I'm here to help with hearing wellness. You're at level "${ctx.level}" with a ${ctx.streak}-day streak and Ear Score ${scoreText}. Ask about safe listening, breaks, volume, or your score.`;
}

// POST /api/coaching/checkin
app.post('/api/coaching/checkin', async (req, res) => {
  try {
    const userId = req.session.user_id || req.body.userId || 'demo_user';
    const { earComfort, breaksTaken, symptoms } = req.body;
    const today = getTodayStr();

    const existing = await pool.query(
      `SELECT * FROM daily_checkins WHERE user_id=? AND checkin_date=?`, [userId, today]
    );
    if (existing.rows.length > 0) {
      return res.json({ alreadyDone: true, checkin: existing.rows[0] });
    }

    const ctx = await buildUserContext(userId);
    const mission = pickMission(earComfort, breaksTaken, symptoms);
    const coachResponse = generateCheckinCoachResponse(ctx, mission, earComfort, breaksTaken, symptoms);

    await pool.query(
      `INSERT OR REPLACE INTO daily_checkins (id,user_id,checkin_date,ear_comfort,breaks_taken,symptoms,coach_response,mission_type,mission_text,xp_awarded)
       VALUES (?,?,?,?,?,?,?,?,?,20)`,
      [uuidv4(), userId, today, earComfort, breaksTaken, symptoms, coachResponse, mission.type, mission.text]
    );

    await pool.query(
      `INSERT OR REPLACE INTO daily_missions (id,user_id,mission_date,mission_type,mission_text,xp_reward,status)
       VALUES (?,?,?,?,?,?,'active')`,
      [uuidv4(), userId, today, mission.type, mission.text, mission.xp]
    );

    const profile = await getOrCreateCoachingProfile(userId);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const wasYesterday = profile.last_checkin_date === yesterdayStr;
    const isToday = profile.last_checkin_date === today;
    const newStreak = isToday ? (profile.streak_days || 1) : (wasYesterday ? (profile.streak_days || 0) + 1 : 1);
    const longestStreak = Math.max(newStreak, profile.longest_streak || 0);
    const hearingAge = Math.max(
      (profile.chronological_age || 22) - 4,
      (profile.hearing_age_score || profile.chronological_age || 22) - (newStreak >= 7 ? 0.1 : 0)
    );

    await pool.query(
      `UPDATE coaching_profiles SET streak_days=?,longest_streak=?,last_checkin_date=?,hearing_age_score=?,updated_at=datetime('now') WHERE user_id=?`,
      [newStreak, longestStreak, today, hearingAge, userId]
    );

    const xpResult = await awardXp(userId, 20, 'checkin', 'Daily check-in completed');

    let bonusXp = 0;
    if ([3,7,14,30,60,100].includes(newStreak)) {
      const bonusMap = {3:50,7:100,14:150,30:300,60:500,100:1000};
      bonusXp = bonusMap[newStreak] || 0;
      if (bonusXp) await awardXp(userId, bonusXp, 'streak_milestone', `${newStreak}-day streak`);
    }

    res.json({
      success: true, coachResponse,
      mission: { type: mission.type, text: mission.text, xp: mission.xp },
      streak: newStreak, xpEarned: 20 + bonusXp,
      totalXp: xpResult.newXp, level: getLevelFromXp(xpResult.newXp),
      leveledUp: xpResult.leveledUp, hearingAge,
      streakMilestone: bonusXp > 0 ? newStreak : null,
    });
  } catch(err) {
    console.error('Checkin error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/coaching/today
app.get('/api/coaching/today', async (req, res) => {
  try {
    const userId = req.session.user_id || req.query.userId || 'demo_user';
    const today = getTodayStr();
    const weekStart = getWeekStart();

    const profile = await getOrCreateCoachingProfile(userId);
    const [checkin, mission, challenge] = await Promise.all([
      pool.query(`SELECT * FROM daily_checkins WHERE user_id=? AND checkin_date=?`, [userId, today]),
      pool.query(`SELECT * FROM daily_missions WHERE user_id=? AND mission_date=?`, [userId, today]),
      pool.query(`SELECT * FROM weekly_challenges WHERE user_id=? AND week_start=?`, [userId, weekStart]),
    ]);

    if (challenge.rows.length === 0) {
      const weekNum = Math.floor(Date.now() / (7*24*60*60*1000)) % 4;
      const ch = WEEKLY_CHALLENGES[weekNum];
      await pool.query(
        `INSERT OR IGNORE INTO weekly_challenges (id,user_id,week_start,challenge_type,challenge_label,daily_progress)
         VALUES (?,?,?,?,?,'0000000')`,
        [uuidv4(), userId, weekStart, ch.type, ch.label]
      );
    }

    const levelInfo = getLevelFromXp(profile.xp || 0);
    const nextLevel = getNextLevel(profile.xp || 0);
    const challengeRow = challenge.rows[0] || (await pool.query(
      `SELECT * FROM weekly_challenges WHERE user_id=? AND week_start=?`, [userId, weekStart]
    )).rows[0];

    res.json({
      streak: profile.streak_days || 0,
      longestStreak: profile.longest_streak || 0,
      xp: profile.xp || 0,
      level: levelInfo,
      nextLevel,
      xpToNext: nextLevel ? nextLevel.minXp - (profile.xp || 0) : 0,
      hearingAge: profile.hearing_age_score || profile.chronological_age || 22,
      chronologicalAge: profile.chronological_age || 22,
      checkedInToday: checkin.rows.length > 0,
      checkin: checkin.rows[0] || null,
      mission: mission.rows[0] || null,
      weeklyChallenge: challengeRow || null,
      shields: profile.streak_shields || 0,
    });
  } catch(err) {
    console.error('Today error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/coaching/mission/complete
app.post('/api/coaching/mission/complete', async (req, res) => {
  try {
    const userId = req.session.user_id || req.body.userId || 'demo_user';
    const today = getTodayStr();
    const mission = await pool.query(
      `SELECT * FROM daily_missions WHERE user_id=? AND mission_date=? AND status='active'`, [userId, today]
    );
    if (mission.rows.length === 0) return res.json({ alreadyComplete: true });

    await pool.query(
      `UPDATE daily_missions SET status='completed', completed_at=datetime('now') WHERE user_id=? AND mission_date=?`,
      [userId, today]
    );
    const xpResult = await awardXp(userId, mission.rows[0].xp_reward || 50, 'mission', 'Daily mission completed');
    await pool.query(`UPDATE coaching_profiles SET last_safe_day=? WHERE user_id=?`, [today, userId]);

    res.json({
      success: true, xpEarned: mission.rows[0].xp_reward || 50,
      totalXp: xpResult.newXp, level: getLevelFromXp(xpResult.newXp),
      leveledUp: xpResult.leveledUp,
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/coaching/chat
app.post('/api/coaching/chat', async (req, res) => {
  try {
    const userId = req.session.user_id || req.body.userId || 'demo_user';
    const { message, earScore, hearingAge: clientHearingAge } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const ctx = await buildUserContext(userId);
    const score = earScore != null ? Math.round(Number(earScore)) : null;
    const hearingAge = clientHearingAge != null ? Math.round(Number(clientHearingAge)) : ctx.hearingAge;

    const reply = generateChatReply(message, ctx, score, hearingAge);

    await pool.query(`INSERT INTO coach_conversations (id,user_id,role,message) VALUES (?,?,'user',?)`, [uuidv4(), userId, message]);
    await pool.query(`INSERT INTO coach_conversations (id,user_id,role,message) VALUES (?,?,'assistant',?)`, [uuidv4(), userId, reply]);

    res.json({ reply });
  } catch(err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/coaching/weekly-challenge/progress
app.post('/api/coaching/weekly-challenge/progress', async (req, res) => {
  try {
    const userId = req.session.user_id || req.body.userId || 'demo_user';
    const weekStart = getWeekStart();
    const ch = await pool.query(`SELECT * FROM weekly_challenges WHERE user_id=? AND week_start=?`, [userId, weekStart]);
    if (ch.rows.length === 0) return res.status(404).json({ error: 'no challenge' });

    const progress = (ch.rows[0].daily_progress || '0000000').split('');
    const idx = req.body.dayIndex !== undefined ? req.body.dayIndex : new Date().getDay();
    progress[idx] = '1';
    const progressStr = progress.join('');
    const daysComplete = progressStr.split('').filter(c => c === '1').length;
    const completed = daysComplete >= 7;

    await pool.query(
      `UPDATE weekly_challenges SET daily_progress=?,completed=? WHERE user_id=? AND week_start=?`,
      [progressStr, completed ? 1 : 0, userId, weekStart]
    );

    let xpEarned = 0;
    if (completed && !ch.rows[0].completed) {
      await awardXp(userId, 200, 'weekly_challenge', 'Weekly challenge completed');
      xpEarned = 200;
    }

    res.json({ success: true, progress: progressStr, daysComplete, completed, xpEarned });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = Number(process.env.PORT) || 3000;
const publicUrl = config.getAppUrl() || `http://127.0.0.1:${PORT}`;

const server = app.listen(PORT, () => {
  console.log(`🎧 HearWise server running at ${publicUrl}`);
  if (config.isProduction) {
    console.log('   Production mode — demo routes disabled unless ENABLE_DEMO_TOOLS=true');
  }
  if (!config.isProduction) {
    setInterval(function () {
      const mem = process.memoryUsage();
      console.log(
        '[Memory]',
        Math.round(mem.heapUsed / 1024 / 1024) + 'MB heap',
        '| Spotify API calls:', _spotifyRequestCount,
        '| 429 count:', _spotify429Count,
        '| Global backoff:', isSpotifyGloballyBackedOff(),
        '| Playback cache:', _playbackCache.size,
        '| Stats cache:', _weeklyStatsCache.size
      );
    }, 60000);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error('   Stop the other server, or run: npm run play');
    console.error(`   Or manually: lsof -ti:${PORT} | xargs kill -9\n`);
    process.exit(1);
  }
  throw err;
});

// Start Slack Bolt App (only if configured)
if (slackApp) {
  slackApp.error((error) => {
    console.log('⚠️ Slack app error (non-fatal):', error.message);
  });

  (async () => {
    try {
      await slackApp.start();
      console.log('⚡️ Slack Bolt app started');
    } catch (error) {
      console.log('⚠️ Slack Bolt app failed to start:', error.message);
      console.log('🎧 Web server continues running without Slack integration');
      slackApp = null;
    }
  })();
}

process.on('uncaughtException', (err) => {
  const msg = err && err.message ? err.message : '';
  if (/socket|SocketMode|Unhandled event/i.test(msg)) {
    console.warn('⚠️ Slack connection issue — HearWise web app still running at ' + publicUrl);
    return;
  }
  console.error(err);
  process.exit(1);
});

function shutdown(signal) {
  console.log(signal + ' received — shutting down');
  server.close(function () {
    pool.close().catch(function () {}).finally(function () {
      process.exit(0);
    });
  });
  setTimeout(function () { process.exit(1); }, 10000);
}

process.on('SIGTERM', function () { shutdown('SIGTERM'); });
process.on('SIGINT', function () { shutdown('SIGINT'); });
