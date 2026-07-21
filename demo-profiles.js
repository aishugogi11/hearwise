/**
 * HearWise — personal user listening profile (device-local only).
 * Built from the user's name, survey answers, and Spotify data when connected.
 */
const USER_PROFILE_ID = 'user';
const DEFAULT_DEMO_PROFILE_ID = USER_PROFILE_ID;

/** @deprecated Legacy export — no preset demo personas. */
const DEMO_PROFILES = {};

const LP_DEMO_PLAN_BY_PROFILE = {};
const LP_DEMO_LS_BY_PROFILE = {};

function readStoredUserProfile() {
  try {
    var raw = localStorage.getItem('hearwise_user_profile');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function getSpotifyStateForProfile() {
  if (typeof st !== 'undefined' && st && st.spotify) return st.spotify;
  return { connected: false };
}

function buildUserListeningProfile(spotifyState) {
  spotifyState = spotifyState || getSpotifyStateForProfile();
  var up = readStoredUserProfile() || {};
  var name = String(up.displayName || up.name || 'You').trim() || 'You';
  var age = Number(up.age) || 22;
  var ws = spotifyState.weeklyStats;
  var ex = spotifyState.exposureScore;
  var connected = !!spotifyState.connected;
  var weeklyMinutes = ws ? (Number(ws.weeklyMinutes) || 0) : 0;
  var todayMinutes = ws ? (Number(ws.todayMinutes) || 0) : 0;
  var avgDb = (ex && ex.estimatedDb != null) ? ex.estimatedDb
    : ((ws && ws.estimatedDb != null) ? ws.estimatedDb : 72);
  var volume = (ws && ws.volumePercent != null) ? ws.volumePercent
    : ((ex && ex.volumePercent != null) ? ex.volumePercent : 55);
  var dose = (ex && ex.weeklyExposurePercent != null) ? ex.weeklyExposurePercent
    : (weeklyMinutes > 0 ? Math.min(100, Math.round(weeklyMinutes / 6)) : 12);

  return {
    id: USER_PROFILE_ID,
    name: name,
    tagline: 'Your personal listening profile',
    persona: 'Private to this device — only you can see your data here.',
    chronologicalAge: age,
    isLive: connected,
    live: {
      volume: volume,
      db: avgDb,
      track: spotifyState.currentTrack || null,
      trackIdx: 0
    },
    listeningData: {
      sessions: [],
      totals: {
        weeklyMinutes: weeklyMinutes,
        weeklyHours: Math.round((weeklyMinutes / 60) * 10) / 10,
        todayMinutes: todayMinutes,
        avgDb: avgDb,
        minutesAbove85: avgDb >= 85 ? Math.round(weeklyMinutes * 0.25) : 0,
        peakDb: Math.min(100, avgDb + 6)
      }
    },
    weeklyExposure: {
      dosePercent: dose,
      safeHoursAt80dB: 40,
      equivalentHoursAt80dB: Math.round((weeklyMinutes / 60) * 10) / 10,
      interpretation: connected && weeklyMinutes > 0
        ? 'Based on your Spotify listening this week.'
        : 'Connect Spotify to unlock live listening stats, or use HearWise timers to track sessions.',
      byDay: []
    },
    metrics: {
      todayMinutes: todayMinutes,
      avgDb: avgDb,
      dailyDosePct: Math.max(0, Math.round(dose / 7)),
      streakDays: 0
    },
    spotify: spotifyState,
    healthScore: 85,
    riskTier: 'low',
    riskLabel: 'Getting started',
    riskStatusClass: 'safe',
    riskExplanation: {
      summary: connected
        ? 'Your hearing wellness updates from your real Spotify listening on this device.'
        : 'Add your name and connect Spotify to personalize your hearing age, dose, and safe-volume targets.',
      factors: [
        { label: 'Profile', value: name, impact: 'positive' },
        { label: 'Weekly listening', value: weeklyMinutes > 0 ? (Math.round((weeklyMinutes / 60) * 10) / 10) + ' h' : '—', impact: 'positive' },
        { label: 'Weekly dose', value: weeklyMinutes > 0 ? dose + '%' : '—', impact: dose > 80 ? 'warning' : 'positive' }
      ]
    },
    recommendations: [
      {
        action: 'Keep volume under 60% when possible and take a short break every hour.',
        benefit: 'Helps protect your hearing during long study or music sessions.'
      },
      {
        action: 'Connect Spotify so HearWise can track your real listening dose.',
        benefit: 'Unlocks live sprint timers, ear-rest alerts, and personalized scores.'
      }
    ],
    forecast: [
      { period: '2 weeks', riskIndex: 15, label: 'Stable', detail: 'Personalized once listening data is available' },
      { period: '1 month', riskIndex: 18, label: 'Stable', detail: 'Follow ear-rest prompts to stay on track' },
      { period: '3 months', riskIndex: 20, label: 'Low concern', detail: 'Consistency matters more than perfection' }
    ],
    alerts: []
  };
}

function getDemoProfile(id) {
  return buildUserListeningProfile(getSpotifyStateForProfile());
}

function getDemoPlanForProfile(id) {
  return [];
}

function getDemoLsStoreForProfile(id) {
  return null;
}
