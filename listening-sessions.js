/**
 * HearWise — Auto Listening Sessions (Spotify)
 * Tracks listening + focus sprints: duration, safe-volume deep focus, productivity breaks.
 */
(function (global) {
  'use strict';

  var SESSION_GAP_MS = 10 * 60 * 1000;
  var BREAK_MS = 3 * 60 * 1000;
  var NUDGE_MINS = 60;
  var STRONG_NUDGE_MINS = 120;
  var NUDGE_THROTTLE_MS = 12 * 60 * 1000;
  var UI_TICK_MS = 1000;

  var MODES = {
    focus: {
      label: 'Focus & Study', defaultSprintMins: 25, configurable: true, emoji: '🎯',
      bestFor: 'Study, work & deep focus',
      tip: 'Pomodoro sprints while Spotify plays — short breaks between cycles, WHO ear rest every 4 pomodoros.'
    },
    active: {
      label: 'Chill & Workout', defaultSprintMins: 45, configurable: true, emoji: '🎵',
      bestFor: 'Everyday listening, R&B & gym',
      tip: 'Choose how long you listen — mandatory ear rests follow health guidelines.'
    },
    sleep: {
      label: 'Sleep', defaultSprintMins: 30, configurable: true, emoji: '🌙',
      bestFor: 'Bedtime wind-down',
      tip: 'Keep under 55 dB — break timing is fixed for overnight ear recovery.'
    }
  };

  function getCustomSessionModesFromProfile() {
    try {
      var raw = localStorage.getItem('hearwise_user_profile');
      if (!raw) return [];
      var list = JSON.parse(raw).customSessionModes;
      return Array.isArray(list) ? list.filter(function (c) { return c && c.id && c.label; }) : [];
    } catch (e) {
      return [];
    }
  }

  function getCustomModeDef(custom) {
    return {
      label: custom.label,
      defaultSprintMins: custom.defaultSprintMins || 25,
      configurable: true,
      emoji: custom.emoji || '✨',
      bestFor: custom.bestFor || 'Your custom listening',
      tip: 'Custom session — ear rest follows safe-listening guidelines.',
      custom: true
    };
  }

  function modeExists(mode) {
    mode = normalizeMode(mode);
    if (MODES[mode]) return true;
    return getCustomSessionModesFromProfile().some(function (c) { return c.id === mode; });
  }

  function getAllModeKeys() {
    var keys = Object.keys(MODES);
    getCustomSessionModesFromProfile().forEach(function (c) {
      if (keys.indexOf(c.id) < 0) keys.push(c.id);
    });
    return keys;
  }

  /** Ear-rest durations — fixed from hearing-health research; not user-adjustable. */
  var RESEARCH_BREAK_MINS = {
    focus: 10,
    active: 10,
    sleep: 5
  };

  var RESEARCH_BREAK_LABELS = {
    focus: 'WHO/ITU — 10-min silence gap after sustained listening',
    active: 'NIOSH — ear rest every ~60 min at moderate levels',
    sleep: 'Lower stimulation — short quiet recovery between wind-down blocks'
  };

  var SPRINT_LIMITS = {
    focus: { min: 15, max: 120 },
    active: { min: 10, max: 90 },
    sleep: { min: 15, max: 60 }
  };

  /** Pomodoro presets — shared with focus orchestrator (25/5 default for study sessions). */
  var POMODORO_PRESETS = {
    '25/5': { id: '25/5', focusMin: 25, breakMin: 5, label: '25 / 5' },
    '50/10': { id: '50/10', focusMin: 50, breakMin: 10, label: '50 / 10' },
    '90/15': { id: '90/15', focusMin: 90, breakMin: 15, label: '90 / 15' }
  };
  var POMODORO_PRESET_KEY = 'hearwise_pomodoro_preset';
  var POMODORO_WHO_EVERY = 4;
  var POMODORO_MODES = { focus: true, study: true };

  var _state = {
    pauseStartedAt: null,
    continuousStart: null,
    lastPlayTickAt: null,
    lastNudgeAt: 0,
    lastSprintNudged: 0,
    uiTick: null,
    frozenContinuousMin: null,
    lastHighlightedMode: null,
    modeFlashUntil: 0,
    breakPauseInProgress: false,
    sprintAwaitingContinue: false,
    frozenListeningMin: null,
    sprintHoldingForBreak: false
  };

  function isSprintTimerHeld() {
    return _state.sprintAwaitingContinue || _state.sprintHoldingForBreak ||
      _state.breakPauseInProgress || isBreakLocked();
  }

  function holdSprintForBreak(store, now) {
    if (!store || !store.active) return;
    refreshActiveMetrics(store, now);
    _state.frozenContinuousMin = store.active.continuousMin || 0;
    _state.frozenListeningMin = null;
    _state.pauseStartedAt = null;
    _state.sprintHoldingForBreak = true;
    saveStore(store);
  }

  function isSpotifyPaused() {
    if (isBreakLocked() || _state.sprintAwaitingContinue || _state.breakPauseInProgress) return false;
    if (_state.pauseStartedAt == null) return false;
    var pb = typeof global._lpLastPlayback !== 'undefined' ? global._lpLastPlayback : null;
    if (pb && pb.is_playing && pb.item) return false;
    return true;
  }

  function snapshotListeningPause(store, now) {
    if (!store.active || isBreakLocked() || _state.sprintAwaitingContinue) return;
    refreshActiveMetrics(store, now);
    _state.frozenListeningMin = store.active.continuousMin || 0;
  }

  function resumeListeningTimer(now) {
    if (_state.frozenListeningMin == null || isBreakLocked()) return;
    _state.continuousStart = now - _state.frozenListeningMin * 60000;
    _state.frozenListeningMin = null;
  }

  function shouldFlashMode(mode) {
    return _state.modeFlashUntil > Date.now() && _state.lastHighlightedMode === mode;
  }

  function notifyModeHighlight(mode, forceFlash, opts) {
    opts = opts || {};
    if (!mode) return;
    var changed = mode !== _state.lastHighlightedMode;
    if (!changed && !forceFlash) return;

    if (typeof global.hwLsHasActiveSession === 'function' && global.hwLsHasActiveSession()) {
      if (typeof global.auraClearSessionBreakTimer === 'function') {
        global.auraClearSessionBreakTimer();
      }
    } else if (typeof global.auraSyncSessionBreakTimer === 'function') {
      global.auraSyncSessionBreakTimer(mode);
    }

    _state.lastHighlightedMode = mode;
    _state.modeFlashUntil = Date.now() + 2200;

    if (opts.manual) return;

    var inActiveSprint = typeof global.hwLsHasActiveSession === 'function' && global.hwLsHasActiveSession() &&
      !(typeof isEarRestBreakActive === 'function' && isEarRestBreakActive());
    if (inActiveSprint) return;

    if (typeof global.auraPrepareSessionBreakTimer === 'function') {
      global.auraPrepareSessionBreakTimer(mode, { openCoach: changed, speak: changed, skipSync: true });
    }

    if (changed) {
      var needsSurvey = typeof global.needsMusicGenreSurvey === 'function' && global.needsMusicGenreSurvey();
      if (!needsSurvey && typeof global.hwSwitchTab === 'function') {
        global.hwSwitchTab('stats');
      }
    }

    var delay = changed ? 350 : 80;
    setTimeout(function () {
      if (typeof global.lpHighlightSection === 'function') {
        global.lpHighlightSection('lpEarRecoveryBlock');
      }
      var banner = document.getElementById('lsActiveModeBanner');
      if (banner && typeof banner.scrollIntoView === 'function') {
        try { banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* ignore */ }
      }
      if (changed) {
        var recoveryTab = document.querySelector('.hw-tab[data-tab="stats"]');
        if (recoveryTab) {
          recoveryTab.classList.add('hw-tab-mode-pulse');
          setTimeout(function () {
            recoveryTab.classList.remove('hw-tab-mode-pulse');
          }, 2200);
        }
      }
    }, delay);
  }

  function isBreakLocked() {
    if (typeof isEarRestBreakActive === 'function') return isEarRestBreakActive();
    return typeof wpTimerRunning !== 'undefined' && wpTimerRunning &&
      typeof _earRestLockedSource !== 'undefined' &&
      (_earRestLockedSource === 'listening' || _earRestLockedSource === 'planner');
  }

  function isScreenLocked() {
    return typeof _earRestLocked !== 'undefined' && _earRestLocked;
  }

  function todayKey() {
    return new Date().toISOString().split('T')[0];
  }

  function storageKey() {
    return 'hearwise_ls_user_' + todayKey();
  }

  function normalizeMode(mode) {
    if (mode === 'study' || mode === 'studyQuick') return 'focus';
    if (mode === 'chill' || mode === 'workout' || mode === 'quick') return 'active';
    return mode;
  }

  /** Prefer auto-detected mode so UI matches classification (e.g. during ear rest). */
  function effectiveDisplayMode(store) {
    var a = store && store.active;
    if (a) {
      if (a.detectedMode) return normalizeMode(a.detectedMode);
      if (a.mode) return normalizeMode(a.mode);
    }
    return normalizeMode((store && store.defaultMode) || 'active');
  }

  function effectiveSessionMode(session) {
    if (!session) return 'active';
    if (session.detectedMode) return normalizeMode(session.detectedMode);
    return normalizeMode(session.mode || 'active');
  }

  function normalizeStore(store) {
    if (!store) return store;
    store.defaultMode = normalizeMode(store.defaultMode || 'active');
    if (store.active && store.active.mode) store.active.mode = normalizeMode(store.active.mode);
    if (store.active && store.active.detectedMode) store.active.detectedMode = normalizeMode(store.active.detectedMode);
    (store.sessions || []).forEach(function (s) {
      if (s.mode) s.mode = normalizeMode(s.mode);
    });
    return store;
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return { sessions: [], active: null, nextNumber: 1, defaultMode: 'active' };
      var s = normalizeStore(JSON.parse(raw));
      s.sessions = s.sessions || [];
      s.nextNumber = s.nextNumber || s.sessions.length + 1;
      s.defaultMode = s.defaultMode || 'active';
      return s;
    } catch (e) {
      return { sessions: [], active: null, nextNumber: 1, defaultMode: 'active' };
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(store));
    } catch (e) { /* ignore */ }
  }

  function isTrackingEnabled() {
    if (typeof _spotifyConnected !== 'undefined' && _spotifyConnected) return true;
    if (typeof _demoModeBypass !== 'undefined' && _demoModeBypass) return true;
    return false;
  }

  function getFocusVolCap() {
    if (typeof earHealthGetCap === 'function') return earHealthGetCap();
    return 65;
  }

  function getPomodoroPresetId() {
    try {
      var id = localStorage.getItem(POMODORO_PRESET_KEY);
      if (id && POMODORO_PRESETS[id]) return id;
    } catch (e) { /* ignore */ }
    return '25/5';
  }

  function getPomodoroPreset() {
    return POMODORO_PRESETS[getPomodoroPresetId()] || POMODORO_PRESETS['25/5'];
  }

  function isPomodoroMode(mode) {
    return !!POMODORO_MODES[normalizeMode(mode)];
  }

  function usesPomodoro(session) {
    var mode = normalizeMode((session && session.mode) || (session && session.detectedMode) || 'focus');
    return isPomodoroMode(mode);
  }

  function setPomodoroPreset(id, opts) {
    opts = opts || {};
    if (!POMODORO_PRESETS[id]) return;
    try { localStorage.setItem(POMODORO_PRESET_KEY, id); } catch (e) { /* ignore */ }
    if (!opts.skipOrch && typeof global.hwOrcSelectPreset === 'function') {
      global.hwOrcSelectPreset(id, { skipLs: true });
    }
    var store = loadStore();
    if (store.active && usesPomodoro(store.active)) {
      store.active.pomodoroPresetId = id;
      _state.lastSprintNudged = Math.floor((store.active.continuousMin || 0) / getSprintMins(store.active));
      saveStore(store);
    }
    renderAll();
  }

  function nextBreakKind(session) {
    if (!usesPomodoro(session)) return 'ear';
    var nextPom = ((session && session.pomodoroCount) || 0) + 1;
    if (nextPom % POMODORO_WHO_EVERY === 0) return 'who';
    return 'pomodoro';
  }

  function getUserSprintPrefs() {
    try {
      var raw = localStorage.getItem('hearwise_user_profile');
      if (!raw) return {};
      return JSON.parse(raw).sessionSprintMins || {};
    } catch (e) {
      return {};
    }
  }

  function clampSprintMins(mode, mins) {
    mode = normalizeMode(mode);
    var lim = SPRINT_LIMITS[mode];
    if (!lim && modeExists(mode) && !MODES[mode]) lim = { min: 5, max: 120 };
    if (!lim) lim = { min: 10, max: 120 };
    return Math.max(lim.min, Math.min(lim.max, Math.round(Number(mins) || lim.min)));
  }

  function getDefaultSprintMins(mode) {
    var key = normalizeMode(mode);
    var base = MODES[key];
    if (!base) {
      var custom = getCustomSessionModesFromProfile().find(function (c) { return c.id === key; });
      if (custom) return custom.defaultSprintMins || 25;
      return MODES.focus.defaultSprintMins;
    }
    return base.defaultSprintMins != null ? base.defaultSprintMins : 45;
  }

  function getResearchBreakMins(mode) {
    mode = normalizeMode(mode);
    if (RESEARCH_BREAK_MINS[mode] != null) return RESEARCH_BREAK_MINS[mode];
    var custom = getCustomSessionModesFromProfile().find(function (c) { return c.id === mode; });
    if (custom && custom.breakMins) return custom.breakMins;
    return RESEARCH_BREAK_MINS.focus;
  }

  function getModeConfig(mode) {
    var key = normalizeMode(mode);
    var base = MODES[key];
    if (!base) {
      var custom = getCustomSessionModesFromProfile().find(function (c) { return c.id === key; });
      base = custom ? getCustomModeDef(custom) : MODES.focus;
    }
    return Object.assign({}, base, {
      sprintMins: getSprintMins({ mode: key }),
      breakMins: getResearchBreakMins(key)
    });
  }

  function getSprintMins(session) {
    var mode = normalizeMode((session && session.mode) || 'focus');
    if (isPomodoroMode(mode)) {
      return getPomodoroPreset().focusMin;
    }
    var prefs = getUserSprintPrefs();
    if (prefs[mode] != null && !isNaN(Number(prefs[mode]))) {
      return clampSprintMins(mode, Number(prefs[mode]));
    }
    return getDefaultSprintMins(mode);
  }

  function getBreakMins(session) {
    var mode = normalizeMode((session && session.mode) || 'focus');
    if (usesPomodoro(session || { mode: mode })) {
      if (nextBreakKind(session || { mode: mode, pomodoroCount: 0 }) === 'who') {
        return getResearchBreakMins(mode);
      }
      return getPomodoroPreset().breakMin;
    }
    return getResearchBreakMins(mode);
  }

  function getActiveSessionMode() {
    var store = loadStore();
    if (!store || !store.active) return null;
    return effectiveDisplayMode(store);
  }

  function getBreakMinsForMode(mode) {
    return getResearchBreakMins(normalizeMode(mode));
  }

  function getResearchBreakLabel(mode) {
    mode = normalizeMode(mode);
    return RESEARCH_BREAK_LABELS[mode] || RESEARCH_BREAK_LABELS.focus;
  }

  function getSprintLimitsForMode(mode) {
    mode = normalizeMode(mode);
    if (SPRINT_LIMITS[mode]) return SPRINT_LIMITS[mode];
    if (modeExists(mode) && !MODES[mode]) return { min: 5, max: 120 };
    return { min: 10, max: 120 };
  }

  function isModeSprintConfigurable(mode) {
    mode = normalizeMode(mode);
    if (isPomodoroMode(mode)) return false;
    var cfg = MODES[mode];
    if (cfg) {
      return !!(cfg.configurable !== false && SPRINT_LIMITS[mode].min !== SPRINT_LIMITS[mode].max);
    }
    return modeExists(mode);
  }

  function getModeLabel(mode) {
    return getModeConfig(normalizeMode(mode)).label;
  }

  function getSprintMinsForMode(mode) {
    return getModeConfig(normalizeMode(mode)).sprintMins;
  }

  function riskLevel(avgVol, durationMin) {
    var vol = avgVol != null ? avgVol : 70;
    var mins = Math.max(0, Number(durationMin) || 0);
    var dose = typeof computeWeeklyDosePercent === 'function'
      ? computeWeeklyDosePercent(mins, vol)
      : Math.round(mins * Math.pow(10, (Math.round(40 + vol * 0.6) - 80) / 3) / (8 * 60) * 100);
    if (dose > 80 || vol >= 85) return 'High';
    if (dose > 50 || vol >= 75) return 'Elevated';
    if (dose > 25 || vol >= 65) return 'Moderate';
    return 'Safe';
  }

  function riskClass(level) {
    if (level === 'High') return 'ls-risk-high';
    if (level === 'Elevated') return 'ls-risk-elevated';
    if (level === 'Moderate') return 'ls-risk-mod';
    return 'ls-risk-safe';
  }

  function formatDuration(min) {
    var m = Math.round(Math.max(0, min || 0));
    if (m < 1) return '0 min';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    var r = m % 60;
    return h + ' hr' + (r ? ' ' + r + ' min' : '');
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  /** Session points: completed safe sprint + ear rests taken. */
  function calcProductivityScore(s) {
    if (!s) return 0;
    var breaks = s.breakCount || 0;
    var completed = s.endedAt ? 1 : 0;
    var cap = getFocusVolCap();
    var volOk = (s.avgVolumePercent || 70) <= cap + 5;
    var score = completed * 50 + Math.min(50, breaks * 15);
    if (volOk) score += 10;
    return Math.min(100, Math.round(score));
  }

  function accumulateFocusTime(a, vol, now) {
    if (!_state.lastPlayTickAt || vol == null) {
      _state.lastPlayTickAt = now;
      return;
    }
    var deltaMin = (now - _state.lastPlayTickAt) / 60000;
    if (deltaMin > 0 && deltaMin < 2 && vol <= getFocusVolCap()) {
      a.focusMinutes = (a.focusMinutes || 0) + deltaMin;
    }
    _state.lastPlayTickAt = now;
  }

  function sprintElapsedMin(session) {
    if (!session) return 0;
    if (session.continuousMin != null && !isNaN(session.continuousMin)) return session.continuousMin;
    return session.durationMin || 0;
  }

  function refreshActiveMetrics(store, now) {
    var a = store.active;
    if (!a) return;
    if (a.volumeCount > 0) {
      a.avgVolumePercent = Math.round(a.volumeSum / a.volumeCount);
    }
    a.durationMin = (now - a.startedAt) / 60000;
    if (_state.frozenContinuousMin != null && isSprintTimerHeld()) {
      a.continuousMin = _state.frozenContinuousMin;
    } else if (isSpotifyPaused() && _state.frozenListeningMin != null) {
      a.continuousMin = _state.frozenListeningMin;
    } else if (_state.continuousStart) {
      a.continuousMin = (now - _state.continuousStart) / 60000;
    } else {
      a.continuousMin = a.durationMin;
    }
    a.riskLevel = riskLevel(a.avgVolumePercent, a.durationMin);
    a.productivityScore = calcProductivityScore(a);
    a.sprintsCompleted = a.breakCount || 0;
  }

  function finalizeActive(store, endAt) {
    var a = store.active;
    if (!a) return store;
    refreshActiveMetrics(store, endAt);
    a.endedAt = endAt;
    a.durationMin = Math.round((endAt - a.startedAt) / 60000);
    if (a.durationMin < 1) {
      store.active = null;
      return store;
    }
    a.productivityScore = calcProductivityScore(a);
    a.riskLevel = riskLevel(a.avgVolumePercent, a.durationMin);
    if (a.riskLevel === 'Safe' && typeof global.hwCompanionOnEvent === 'function') {
      global.hwCompanionOnEvent('safe_session', { eventId: 'safe_' + a.id + '_' + endAt });
    }
    store.sessions.unshift(a);
    if (store.sessions.length > 24) store.sessions = store.sessions.slice(0, 24);
    store.active = null;
    _state.continuousStart = null;
    _state.lastPlayTickAt = null;
    _state.lastSprintNudged = 0;
    _state.frozenListeningMin = null;
    _state.pauseStartedAt = null;
    _state.sprintHoldingForBreak = false;
    return store;
  }

  function startSession(store, pb, now) {
    var num = store.nextNumber || store.sessions.length + 1;
    var mode = 'active';

    if (pb && pb.item && typeof hwSessionClassifierSync === 'function') {
      var detected = hwSessionClassifierSync(pb.item, pb);
      if (detected && detected.mode) {
        mode = detected.mode;
        store.defaultMode = mode;
        notifyModeHighlight(mode, true);
      }
    } else {
      mode = normalizeMode(store.defaultMode || 'active');
      store.defaultMode = mode;
    }

    store.active = {
      id: 'ls_' + now,
      number: num,
      mode: mode,
      startedAt: now,
      volumeSum: 0,
      volumeCount: 0,
      avgVolumePercent: 0,
      peakVolumePercent: 0,
      breakCount: 0,
      focusMinutes: 0,
      sprintsCompleted: 0,
      pomodoroCount: 0,
      pomodoroPresetId: getPomodoroPresetId(),
      productivityScore: 0,
      continuousMin: 0,
      durationMin: 0,
      riskLevel: 'Safe',
      trackName: pb && pb.item ? pb.item.name : '',
      artistName: pb && pb.item && pb.item.artists && pb.item.artists[0] ? pb.item.artists[0].name : '',
      trackId: pb && pb.item ? pb.item.id : null,
      autoDetected: !!(pb && pb.item && typeof hwSessionClassifierSync === 'function')
    };

    if (pb && pb.item && typeof hwSessionClassifierSync === 'function') {
      var syncMeta = hwSessionClassifierSync(pb.item, pb);
      if (syncMeta) {
        store.active.modeReason = syncMeta.reason;
        store.active.modeConfidence = Math.round(syncMeta.confidence * 100);
      }
    }

    store.nextNumber = num + 1;
    _state.continuousStart = now;
    _state.lastPlayTickAt = now;
    _state.lastSprintNudged = 0;
    if (typeof global.hwUpdateSpotifyPollCadence === 'function') {
      global.hwUpdateSpotifyPollCadence();
    }
    return store;
  }

  function openManualTimer() {
    if (typeof global.hwOpenManualTimer === 'function') {
      global.hwOpenManualTimer();
    }
  }

  function updateActiveFromPlayback(store, pb, now) {
    var a = store.active;
    if (!a) return store;
    var vol = pb && pb.device && pb.device.volume_percent != null ? pb.device.volume_percent : null;
    if (vol != null) {
      accumulateFocusTime(a, vol, now);
      a.volumeSum = (a.volumeSum || 0) + vol;
      a.volumeCount = (a.volumeCount || 0) + 1;
      a.peakVolumePercent = Math.max(a.peakVolumePercent || 0, vol);
    } else {
      _state.lastPlayTickAt = now;
    }
    if (pb && pb.item) {
      var prevId = a.trackId;
      a.trackName = pb.item.name;
      a.artistName = pb.item.artists && pb.item.artists[0] ? pb.item.artists[0].name : '';
      a.trackId = pb.item.id || a.trackId;
      if (a.trackId && a.trackId !== prevId && typeof hwSessionClassifierOnTrack === 'function') {
        hwSessionClassifierOnTrack(pb, store, { force: true });
      }
    }
    refreshActiveMetrics(store, now);
    return store;
  }

  function onPlayback(pb) {
    if (!pb) return;
    if (typeof global.hwShouldRunSafeSessionTimers === 'function' && !global.hwShouldRunSafeSessionTimers()) return;
    if (!isTrackingEnabled() && !pb._demo) return;

    var playing = !!(pb.is_playing && pb.item);
    var now = Date.now();
    var store = loadStore();

    if (playing) {
      if (_state.pauseStartedAt) {
        var pauseDur = now - _state.pauseStartedAt;
        if (store.active && !isBreakLocked() && pauseDur >= BREAK_MS && pauseDur < SESSION_GAP_MS) {
          store.active.breakCount = (store.active.breakCount || 0) + 1;
          store.active.sprintsCompleted = store.active.breakCount;
          _state.continuousStart = now;
          _state.frozenListeningMin = null;
          _state.lastSprintNudged = Math.floor((store.active.continuousMin || 0) / getSprintMins(store.active));
        } else if (store.active && !isBreakLocked()) {
          resumeListeningTimer(now);
        }
        if (store.active && pauseDur >= SESSION_GAP_MS) {
          store = finalizeActive(store, _state.pauseStartedAt);
        }
        _state.pauseStartedAt = null;
      }

      if (!store.active) {
        store = startSession(store, pb, now);
        if (pb.item && typeof hwSessionClassifierOnTrack === 'function') {
          hwSessionClassifierOnTrack(pb, store, { force: true, isNewSession: true });
        }
        saveStore(store);
        renderAll();
      } else {
        store = updateActiveFromPlayback(store, pb, now);
      }
      startUiTick();
    } else {
      _state.lastPlayTickAt = null;
      if (store.active && !_state.pauseStartedAt && !isBreakLocked() && !_state.breakPauseInProgress) {
        snapshotListeningPause(store, now);
        _state.pauseStartedAt = now;
      }
      if (store.active && _state.pauseStartedAt && (now - _state.pauseStartedAt) >= SESSION_GAP_MS) {
        store = finalizeActive(store, _state.pauseStartedAt);
        _state.pauseStartedAt = null;
        stopUiTick();
      }
    }

    saveStore(store);
    checkProductivityNudges(store, now);
    renderAll();
  }

  function checkProductivityNudges(store, now) {
    if (isSprintTimerHeld() || isSpotifyPaused()) return;
    var a = store.active;
    if (!a) return;
    refreshActiveMetrics(store, now);
    var cont = sprintElapsedMin(a);
    var sprint = getSprintMins(a);
    var sprintIndex = Math.floor(cont / sprint);

    if (sprintIndex >= 1 && sprintIndex > _state.lastSprintNudged && cont >= sprint) {
      if (now - _state.lastNudgeAt >= NUDGE_THROTTLE_MS || sprintIndex > _state.lastSprintNudged) {
        _state.lastNudgeAt = now;
        _state.lastSprintNudged = sprintIndex;
        var modeCfg = getModeConfig(effectiveSessionMode(a));
        var brk = getBreakMins(a);
        var breakKind = nextBreakKind(a);
        if (usesPomodoro(a)) {
          a.pendingBreakMins = brk;
          a.pendingBreakKind = breakKind;
          a.pomodoroCount = (a.pomodoroCount || 0) + 1;
          saveStore(store);
        }
        if (typeof global.hwQuestOnLsEvent === 'function') {
          global.hwQuestOnLsEvent('sprint', {
            eventId: 'sprint_' + a.id + '_' + sprintIndex,
            sprintIndex: sprintIndex,
            pomodoro: usesPomodoro(a) ? a.pomodoroCount : null
          });
        }
        var sprintLabel = usesPomodoro(a)
          ? '🍅 <strong>Pomodoro ' + a.pomodoroCount + ' complete</strong> (' + sprint + ' min focus)'
          : modeCfg.emoji + ' <strong>' + modeCfg.label + ' sprint complete</strong> (' + sprint + ' min)';
        var breakLabel = breakKind === 'who'
          ? 'Starting your ' + brk + '-minute WHO ear rest — take headphones off.'
          : 'Starting your ' + brk + '-minute break — silence while the timer runs.';
        triggerAutoFocusBreak(sprintLabel + '. ' + breakLabel, true);
        return;
      }
    }

    if (cont < NUDGE_MINS) return;
    if (now - _state.lastNudgeAt < NUDGE_THROTTLE_MS) return;
    _state.lastNudgeAt = now;

    var msg = cont >= STRONG_NUDGE_MINS
      ? 'You\'ve been listening for ' + formatDuration(cont) + '. Starting a 10-minute ear rest now.'
      : 'You\'ve been at it for ' + formatDuration(cont) + '. Starting an ear rest to protect your hearing.';

    triggerAutoFocusBreak(msg, false);
  }

  function triggerAutoFocusBreak(msg, isSprint) {
    var store = loadStore();
    holdSprintForBreak(store, Date.now());
    if (typeof global.hwPlayAlertRing === 'function') global.hwPlayAlertRing('break');
    showBreakNudge(msg, isSprint);
    startFocusBreak();
  }

  function breakNudgeAction() {
    startFocusBreak();
  }

  function showBreakNudge(msg, isSprint) {
    var els = breakNudgeEls();
    var title = els.el ? els.el.querySelector('.ls-break-title') : null;
    if (els.el && els.txt) {
      els.txt.innerHTML = msg;
      els.el.classList.add('visible');
      els.el.classList.toggle('ls-sprint-nudge', !!isSprint);
      if (title) {
        title.textContent = isBreakLocked() ? '⏸ Ear rest in progress' : 'Ear rest required';
      }
    }
    updateBreakNudgeUI();
    if (!isBreakLocked() && !isSprint && typeof auraSuggestEarRest === 'function') {
      auraSuggestEarRest(els.txt ? els.txt.textContent : msg.replace(/<[^>]+>/g, ''));
    }
  }

  function formatTimerSecs(secs) {
    var m = Math.floor(Math.max(0, secs) / 60);
    var s = Math.max(0, secs) % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateBreakNudgeUI() {
    var els = breakNudgeEls();
    if (!els.btn || !els.el) return;
    if (isBreakLocked()) {
      els.btn.style.display = 'none';
      els.el.classList.add('visible');
      if (els.txt && typeof wpTimerSecs !== 'undefined') {
        els.txt.innerHTML = 'Spotify paused — ear rest <strong>' + formatTimerSecs(wpTimerSecs) + '</strong> remaining. ' +
          'Take headphones off — your cochlea recovers fastest in silence.';
      }
    } else {
      els.btn.style.display = '';
      els.btn.textContent = 'Start rest ▶';
      els.btn.classList.remove('ls-break-continue');
    }
    var store = loadStore();
    renderEarAiInsight(store);
  }

  function dismissBreakNudge() {
    var els = breakNudgeEls();
    if (els.el) els.el.classList.remove('visible', 'ls-sprint-nudge');
  }

  function logBreakComplete() {
    _state.sprintAwaitingContinue = false;
    var store = loadStore();
    if (store.active) {
      store.active.awaitingBreakContinue = false;
      store.active.breakCount = (store.active.breakCount || 0) + 1;
      store.active.sprintsCompleted = store.active.breakCount;
      saveStore(store);
    }
    _state.continuousStart = Date.now();
    _state.frozenContinuousMin = null;
    _state.sprintHoldingForBreak = false;
    _state.lastNudgeAt = Date.now();
    dismissBreakNudge();
    if (typeof global.hwCompanionOnEvent !== 'function' && typeof showXpToast === 'function') {
      showXpToast(25, 'Ear rest complete — hearing protected');
    }
    if (typeof global.hwQuestOnLsEvent === 'function') {
      var sid = store.active ? store.active.id : 'ls';
      var bc = store.active ? (store.active.breakCount || 0) : 0;
      global.hwQuestOnLsEvent('ear_rest', { eventId: 'rest_' + sid + '_' + bc });
    }
    renderAll();
  }

  function ackBreak() {
    if (isScreenLocked()) return;
    logBreakComplete();
  }

  function onBreakTimerComplete() {
    logBreakComplete();
  }

  function pauseSpotifyForBreak(done) {
    if (typeof global.hwPauseSpotify === 'function') {
      global.hwPauseSpotify({ notify: false }).then(function (ok) {
        if (typeof global.hwSpotifyBurstPoll === 'function') global.hwSpotifyBurstPoll();
        if (done) done(ok);
      });
      return;
    }
    if (typeof global._spotifyConnected !== 'undefined' && !global._spotifyConnected) {
      if (done) done(false);
      return;
    }
    fetch('/api/spotify/pause', { method: 'PUT', credentials: 'include' })
      .then(function (r) {
        if (r.ok && typeof global.hwMarkSpotifyPausedLocally === 'function') {
          global.hwMarkSpotifyPausedLocally();
        }
        if (done) done(r.ok);
      })
      .catch(function () { if (done) done(false); });
  }

  function startFocusBreak() {
    if (isBreakLocked()) return;
    var store = loadStore();
    if (store.active) {
      refreshActiveMetrics(store, Date.now());
      _state.frozenContinuousMin = store.active.continuousMin || 0;
      saveStore(store);
    }
    var breakMins = store.active && store.active.pendingBreakMins != null
      ? store.active.pendingBreakMins
      : (store.active ? getBreakMins(store.active) : 10);
    var breakKind = store.active && store.active.pendingBreakKind
      ? store.active.pendingBreakKind
      : (store.active ? nextBreakKind(store.active) : 'ear');
    if (store.active) {
      store.active.pendingBreakMins = null;
      store.active.pendingBreakKind = null;
      saveStore(store);
    }
    var modeCfg = store.active ? getModeConfig(store.active.mode) : null;
    var isPom = store.active && usesPomodoro(store.active);
    var title = breakKind === 'who'
      ? 'WHO Ear Rest — ' + breakMins + ' Minutes'
      : (isPom ? 'Pomodoro Break — ' + breakMins + ' Minutes' : 'Ear Rest — ' + breakMins + ' Minutes');
    if (modeCfg) title += ' (' + modeCfg.label + ')';
    var breakDesc = isPom && breakKind === 'pomodoro'
      ? 'Spotify paused. Pomodoro silence break — stretch, hydrate, headphones off. Press play when the timer ends.'
      : 'Spotify paused. Silence break — headphones off while the timer runs.';
    _state.pauseStartedAt = null;
    _state.breakPauseInProgress = true;

    function beginBreakTimer() {
      _state.breakPauseInProgress = false;
      if (typeof auraEarRestStart === 'function') {
        auraEarRestStart(breakMins, false, {
          lock: false,
          autoStart: true,
          source: 'listening',
          title: title,
          desc: breakDesc
        });
      }
      updateBreakNudgeUI();
      renderAll();
    }

    pauseSpotifyForBreak(function () {
      beginBreakTimer();
    });
  }

  function setMode(mode, opts) {
    opts = opts || {};
    if (!opts.auto && !opts.manual) return;
    mode = normalizeMode(mode);
    if (!modeExists(mode)) return;
    var store = loadStore();
    var prevMode = store.active ? normalizeMode(store.active.mode || store.defaultMode) : null;
    var modeChanged = !!(store.active && prevMode && prevMode !== mode);
    var wasBreakOrHold = isBreakLocked() || _state.sprintAwaitingContinue ||
      _state.sprintHoldingForBreak || _state.breakPauseInProgress;

    if (modeChanged && store.active) {
      opts.resetSprint = true;
      if (wasBreakOrHold && typeof global.hwCancelEarRestBreak === 'function') {
        global.hwCancelEarRestBreak();
      }
    }
    store.defaultMode = mode;
    if (store.active) {
      store.active.mode = mode;
      store.active.detectedMode = mode;
      if (opts.manual) {
        store.active.modeManual = true;
        store.active.autoDetected = false;
        store.active.modeReason = 'You selected ' + getModeConfig(mode).label;
        store.active.modeConfidence = 100;
        store.active.matchedTags = [];
        var pb = typeof global._lpLastPlayback !== 'undefined' ? global._lpLastPlayback : null;
        if (pb && pb.item && pb.item.id) store.active.manualTrackId = pb.item.id;
      }
      _state.lastSprintNudged = Math.floor(sprintElapsedMin(store.active) / getSprintMins(store.active));
      if (opts.resetSprint) {
        var now = Date.now();
        _state.continuousStart = now;
        _state.lastPlayTickAt = now;
        _state.lastSprintNudged = 0;
        _state.lastNudgeAt = 0;
        _state.pauseStartedAt = null;
        store.active.continuousMin = 0;
        store.active.pomodoroCount = 0;
        store.active.pendingBreakMins = null;
        store.active.pendingBreakKind = null;
        store.active.awaitingBreakContinue = false;
        _state.frozenContinuousMin = null;
        _state.frozenListeningMin = null;
        _state.sprintHoldingForBreak = false;
        _state.sprintAwaitingContinue = false;
        _state.breakPauseInProgress = false;
        dismissBreakNudge();
        if (typeof global.auraClearSessionBreakTimer === 'function') {
          global.auraClearSessionBreakTimer();
        }
        if (wasBreakOrHold && typeof global.hwResumeSpotify === 'function') {
          global.hwResumeSpotify({ notify: false });
        }
        startUiTick();
      }
    } else {
      _state.lastSprintNudged = 0;
    }
    saveStore(store);
    if (opts.manual && typeof global.hwSessionClassifierMarkManual === 'function') {
      global.hwSessionClassifierMarkManual(mode);
    }
    if (!store.active && typeof global.auraSyncSessionBreakTimer === 'function') {
      global.auraSyncSessionBreakTimer(mode);
    }
    if (opts.manual) {
      if (typeof global.showNotification === 'function') {
        global.showNotification('Session type: ' + getModeConfig(mode).label);
      } else if (typeof global.showXpToast === 'function') {
        global.showXpToast(0, getModeConfig(mode).label + ' session');
      }
    }
    notifyModeHighlight(mode, modeChanged || !!opts.resetSprint, { manual: !!opts.manual });
    renderAll();
  }

  function pickMode(mode) {
    setMode(mode, { manual: true });
  }

  function clearManualMode() {
    var store = loadStore();
    if (store.active) {
      store.active.modeManual = false;
      store.active.manualTrackId = null;
      store.active.modeReason = '';
      saveStore(store);
    }
    if (typeof global.hwSessionClassifierClearManual === 'function') {
      global.hwSessionClassifierClearManual();
    }
    var pb = typeof global._lpLastPlayback !== 'undefined' ? global._lpLastPlayback : null;
    if (pb && pb.item && typeof global.hwSessionClassifierOnTrack === 'function') {
      global.hwSessionClassifierOnTrack(pb, store, { force: true });
    } else {
      renderAll();
    }
  }

  function setDetectedMeta(meta) {
    if (!meta) return;
    var store = loadStore();
    if (store.active && store.active.modeManual) return;
    if (store.active) {
      var mode = normalizeMode(meta.mode);
      var modeChanged = normalizeMode(store.active.mode || store.defaultMode) !== mode;
      store.active.detectedMode = mode;
      store.active.mode = mode;
      store.active.modeReason = meta.reason;
      store.active.modeConfidence = meta.confidence;
      store.active.matchedTags = meta.matchedTags || [];
      store.defaultMode = mode;
      saveStore(store);
      notifyModeHighlight(mode, modeChanged);
      renderAll();
    }
  }

  function breakNudgeEls() {
    return {
      el: document.getElementById('lpBreakNudge') || document.getElementById('hwBreakNudge'),
      txt: document.getElementById('lpBreakNudgeText') || document.getElementById('hwBreakNudgeText'),
      btn: document.getElementById('lpBreakNudgeBtn') || document.getElementById('hwBreakNudgeBtn')
    };
  }

  function getDosePercent(session) {
    if (!session) return 0;
    var vol = session.avgVolumePercent != null ? session.avgVolumePercent : 70;
    var mins = session.durationMin || 0;
    if (typeof computeWeeklyDosePercent === 'function') {
      return Math.round(computeWeeklyDosePercent(mins, vol));
    }
    return Math.min(100, Math.round(mins * 2));
  }

  function renderEarAiInsight(store) {
    var el = document.getElementById('lpEarAiInsight');
    if (!el) return;
    var enabled = isTrackingEnabled();
    var a = store.active;
    if (isBreakLocked()) {
      var left = typeof wpTimerSecs !== 'undefined' ? formatTimerSecs(wpTimerSecs) : '10:00';
      el.innerHTML = '<strong>⏸ Ear rest in progress.</strong> Your cochlea recovers fastest in the first minutes of silence. ' +
        left + ' remaining — take headphones off until the timer finishes.';
      return;
    }
    if (a) {
      var dose = getDosePercent(a);
      var cap = getFocusVolCap();
      var sprint = getSprintMins(a);
      var cont = sprintElapsedMin(a);
      var toBreak = Math.max(0, sprint - (cont % sprint));
      var vol = a.avgVolumePercent != null ? a.avgVolumePercent : '—';
      var modeCfg = getModeConfig(effectiveSessionMode(a));
      var detectLine = a.modeReason
        ? ' · <span style="color:#4338ca;">Aura detected ' + esc(modeCfg.label) + ' from your music</span>'
        : '';
      if (a.mode === 'active' && (a.popTrack || (a.artistName && /taylor swift/i.test(a.artistName)))) {
        detectLine = ' · <span style="color:#4338ca;">🎵 Pop listening detected</span>';
      } else if (a.mode === 'focus' && (a.lofiFocus || a.focusInstrumental)) {
        detectLine = ' · <span style="color:#4338ca;">🎯 Focus & Study detected</span>';
      }
      var timerLine = isSpotifyPaused()
        ? '<strong>⏸ Sprint timer paused</strong> while Spotify is paused — press play to continue.'
        : (usesPomodoro(a)
          ? '<strong>🍅 Pomodoro ' + ((a.pomodoroCount || 0) + 1) + ' · ' + getPomodoroPreset().label +
            ' — ' + getBreakMins(a) + '-min ' + (nextBreakKind(a) === 'who' ? 'WHO ear rest' : 'break') +
            ' in ' + formatBreakRemaining(toBreak) + '.</strong>'
          : '<strong>' + getBreakMins(a) + '-min ear rest in ' + formatBreakRemaining(toBreak) + '.</strong>');
      el.innerHTML = '<strong>Live dose update:</strong> Session #' + a.number + ' · ' + modeCfg.emoji + ' ' + esc(modeCfg.label) +
        ' · ~' + dose + '% daily dose · avg volume ' + vol + '% ' +
        (a.avgVolumePercent > cap ? '(above ' + cap + '% cap)' : '(within cap)') + detectLine + '. ' +
        timerLine;
      return;
    }
    if (enabled) {
      var modeCfg = getModeConfig(store.defaultMode || 'focus');
      var pomNote = isPomodoroMode(store.defaultMode || 'focus')
        ? ' Pomodoro <strong>' + getPomodoroPreset().label + '</strong> cycles while you study.'
        : ' auto-starts a <strong>' + (modeCfg.sprintMins) + '-min sprint</strong> then a silence break.';
      el.innerHTML = '<strong>Ready to protect your ears.</strong> Press play on Spotify — Aura tracks volume + duration, forecasts your safe dose, and' +
        pomNote + ' No calendar needed.';
      return;
    }
    el.innerHTML = 'Connect Spotify — Aura tracks your <strong>noise dose</strong> in real time and starts a recovery timer when safe-listening limits are reached. ' +
      'Prevent hearing damage <strong>before</strong> it becomes permanent.';
  }

  function formatBreakRemaining(remainingMin) {
    if (remainingMin <= 0.05) return 'now — ear rest starting';
    if (remainingMin < 2) {
      return Math.max(1, Math.ceil(remainingMin * 60)) + ' sec to ear rest';
    }
    return Math.ceil(remainingMin) + ' min to ear rest';
  }

  function activeModeBannerHtml(store) {
    var mode = effectiveDisplayMode(store);
    var m = getModeConfig(mode);
    var a = store.active;
    var flash = shouldFlashMode(mode) ? ' ls-mode-banner-flash' : '';
    var pb = typeof _lpLastPlayback !== 'undefined' ? _lpLastPlayback : null;
    var track = (pb && pb.item && pb.item.name) || (a && a.trackName) || '';
    var artist = (pb && pb.item && pb.item.artists && pb.item.artists[0] && pb.item.artists[0].name) ||
      (a && a.artistName) || '';
    var playing = !!(pb && pb.is_playing && pb.item);
    var reason = a && a.modeReason ? String(a.modeReason).replace(/<[^>]+>/g, '') : '';
    if (a && a.modeManual) {
      reason = 'You selected this session type';
    } else if (!reason && playing && track) {
      reason = 'Detected from ♪ ' + track + (artist ? ' · ' + artist : '');
    }
    var status = playing ? '● LIVE NOW' : (track ? 'PAUSED' : 'READY');
    return '<div class="ls-active-mode-banner' + flash + '" id="lsActiveModeBanner">' +
      '<div class="ls-active-mode-badge">' + status + '</div>' +
      '<div class="ls-active-mode-emoji">' + m.emoji + '</div>' +
      '<div class="ls-active-mode-main">' +
        '<div class="ls-active-mode-title">' + esc(m.label) + '</div>' +
        '<div class="ls-active-mode-sub">' + (isPomodoroMode(mode)
          ? '🍅 Pomodoro ' + getPomodoroPreset().label + ' · WHO rest every ' + POMODORO_WHO_EVERY + ' cycles'
          : m.sprintMins + '-min sprint · ' + (m.breakMins || 10) + '-min ear rest') + '</div>' +
        (reason ? '<div class="ls-active-mode-reason">' + esc(reason) + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  function pomodoroPickerHtml() {
    var id = getPomodoroPresetId();
    var preset = getPomodoroPreset();
    return '<div class="ls-pomodoro-picker" id="lsPomodoroPicker">' +
      '<div class="ls-pomodoro-hd">' +
        '<span class="ls-pomodoro-title">🍅 Pomodoro timer</span>' +
        '<span class="ls-pomodoro-sub">' + preset.focusMin + ' min focus · ' + preset.breakMin + ' min break · WHO ear rest every ' + POMODORO_WHO_EVERY + '</span>' +
      '</div>' +
      '<div class="ls-pomodoro-presets">' +
      Object.keys(POMODORO_PRESETS).map(function (key) {
        var p = POMODORO_PRESETS[key];
        var on = key === id ? ' ls-pomodoro-on' : '';
        return '<button type="button" class="ls-pomodoro-btn' + on + '" data-preset="' + key + '" onclick="hwLsSetPomodoroPreset(\'' + key + '\')">' + p.label + '</button>';
      }).join('') +
      '</div>' +
    '</div>';
  }

  function modeLegendHtml(activeMode) {
    return '<div class="ls-mode-legend">' +
      getAllModeKeys().map(function (key) {
        var m = getModeConfig(key);
        var active = key === activeMode ? ' ls-mode-legend-active' : '';
        var pulse = key === activeMode && shouldFlashMode(activeMode) ? ' ls-mode-legend-flash' : '';
        var sprintNote = isPomodoroMode(key)
          ? 'Pomodoro ' + getPomodoroPreset().label
          : (m.sprintMins + ' min sprint · ' + m.breakMins + ' min rest (fixed)');
        return '<div class="ls-mode-legend-row' + active + pulse + '">' +
          '<strong>' + m.emoji + ' ' + m.label + '</strong>' +
          '<span class="ls-mode-sprint">' + sprintNote + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function modePickerSectionHtml(store) {
    var mode = effectiveDisplayMode(store);
    var m = getModeConfig(mode);
    var manual = !!(store.active && store.active.modeManual);
    var statusLabel = manual ? 'You selected' : (store.active && store.active.autoDetected !== false ? 'Auto-detected' : 'Session type');
    var resetLink = manual
      ? ' <button type="button" class="ls-mode-auto-link" onclick="hwLsClearManualMode()">↺ Auto-detect</button>'
      : '';
    return '<div class="ls-mode-picker-label">' + statusLabel + ' · <span class="ls-mode-current">' + m.emoji + ' ' + esc(m.label) + '</span>' + resetLink + '</div>' +
      '<div class="ls-mode-picker-hint">Wrong type? Tap a session below to change it.</div>' +
      modeDisplayHtml(mode, manual) +
      modeLegendHtml(mode);
  }

  function renderActiveModeBanner(store) {
    var el = document.getElementById('lpListeningSessionsActiveMode');
    if (!el) return;
    var enabled = isTrackingEnabled();
    if (!enabled && !store.active) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = activeModeBannerHtml(store);
  }

  function sprintProgressHtml(s, isLive) {
    var sprint = getSprintMins(s);
    var modeCfg = getModeConfig(s.mode);
    if ((_state.sprintHoldingForBreak || _state.breakPauseInProgress) && isLive && !isBreakLocked()) {
      return '<div class="ls-sprint-wrap ls-sprint-await ls-sprint-active">' +
        '<div class="ls-sprint-hd"><span>✓ Sprint complete</span><span>Spotify pausing…</span></div>' +
        '<div class="ls-sprint-countdown">Starting ear rest<small>Timer paused — break begins in a moment</small></div>' +
        '<div class="ls-sprint-track"><div class="ls-sprint-fill" style="width:100%;background:linear-gradient(90deg,#10b981,#22d3ee)"></div></div>' +
      '</div>';
    }
    if (isBreakLocked()) {
      var remain = typeof wpTimerSecs !== 'undefined' ? formatTimerSecs(wpTimerSecs) : '10:00';
      return '<div class="ls-sprint-wrap ls-sprint-break">' +
        '<div class="ls-sprint-hd"><span>⏸ Ear rest</span><span>' + remain + ' left</span></div>' +
        '<div class="ls-sprint-countdown">Break in progress<small>Timer in Aura coach ✦ — open the chat panel bottom-right</small></div>' +
        '<div class="ls-sprint-track"><div class="ls-sprint-fill" style="width:100%;background:linear-gradient(90deg,#f59e0b,#f97316)"></div></div>' +
      '</div>';
    }
    if (!isLive) {
      return '<div class="ls-sprint-wrap ls-sprint-idle">' +
        '<div class="ls-sprint-hd"><span>' + modeCfg.emoji + ' ' + esc(modeCfg.label) + '</span>' +
        '<span>' + sprint + ' min sprints</span></div>' +
        '<div class="ls-sprint-countdown">Manual listening timer<small>Use any music app — pick a block length and take breaks when time is up</small></div>' +
        '<div class="ls-sprint-track"><div class="ls-sprint-fill" style="width:0%"></div></div>' +
        '<button type="button" class="ls-sprint-continue-btn" onclick="hwLsOpenManualTimer()">Ready to start</button>' +
      '</div>';
    }
    if (isSpotifyPaused()) {
      var pausedCont = _state.frozenListeningMin != null ? _state.frozenListeningMin : (s.continuousMin || 0);
      var pausedInSprint = pausedCont % sprint;
      var pausedPct = Math.min(100, Math.max(0, Math.round((pausedInSprint / sprint) * 100)));
      var pausedRemaining = Math.max(0, sprint - pausedInSprint);
      var pausedElapsed = Math.floor(pausedInSprint);
      var pomPaused = usesPomodoro(s);
      var pausedHd = pomPaused
        ? '🍅 Pomodoro ' + ((s.pomodoroCount || 0) + 1) + ' · paused'
        : modeCfg.emoji + ' ' + esc(modeCfg.label) + ' · paused';
      return '<div class="ls-sprint-wrap ls-sprint-active ls-sprint-paused">' +
        '<div class="ls-sprint-hd"><span>' + pausedHd + '</span><span>' + pausedElapsed + ' / ' + sprint + ' min</span></div>' +
        '<div class="ls-sprint-countdown">Timer paused<small>Press play in Spotify to continue · ' + formatBreakRemaining(pausedRemaining) + ' left in sprint</small></div>' +
        '<div class="ls-sprint-track"><div class="ls-sprint-fill" style="width:' + pausedPct + '%;opacity:.55"></div></div>' +
      '</div>';
    }
    var cont = sprintElapsedMin(s);
    var inSprint = cont % sprint;
    var pct = Math.min(100, Math.max(0, Math.round((inSprint / sprint) * 100)));
    var remaining = Math.max(0, sprint - inSprint);
    var countdown = formatBreakRemaining(remaining);
    var elapsedInSprint = Math.floor(inSprint);
    var pom = usesPomodoro(s);
    var sprintHd = pom
      ? '🍅 Pomodoro ' + ((s.pomodoroCount || 0) + 1) + ' · ' + getPomodoroPreset().label
      : modeCfg.emoji + ' ' + esc(modeCfg.label) + ' sprint';
    var breakHint = pom
      ? (nextBreakKind(s) === 'who'
        ? getResearchBreakMins(s.mode) + '-min WHO ear rest next'
        : getPomodoroPreset().breakMin + '-min Pomodoro break next')
      : (getResearchBreakMins(s.mode) + '-min ear rest (WHO/NIOSH)');
    return '<div class="ls-sprint-wrap' + (isLive ? ' ls-sprint-active' : '') + (pom ? ' ls-sprint-pomodoro' : '') + '">' +
      '<div class="ls-sprint-hd">' +
        '<span>' + sprintHd + '</span>' +
        '<span>' + elapsedInSprint + ' / ' + sprint + ' min</span>' +
      '</div>' +
        '<div class="ls-sprint-countdown">' + countdown +
        '<small>' + breakHint + '</small></div>' +
      '<div class="ls-sprint-track"><div class="ls-sprint-fill" style="width:' + pct + '%"></div></div>' +
    '</div>';
  }

  function sprintPreviewHtml(mode) {
    var m = getModeConfig(mode);
    return sprintProgressHtml({ mode: mode, continuousMin: 0, durationMin: 0 }, false);
  }

  function modeDisplayHtml(activeMode, manual) {
    var flash = shouldFlashMode(activeMode);
    return '<div class="ls-mode-row ls-mode-row-pick">' +
      getAllModeKeys().map(function (key) {
        var m = getModeConfig(key);
        var on = key === activeMode ? ' ls-mode-on' : '';
        var pulse = key === activeMode && flash ? ' ls-mode-flash' : '';
        var manualOn = manual && key === activeMode ? ' ls-mode-manual' : '';
        return '<button type="button" class="ls-mode-chip' + on + pulse + manualOn + '" onclick="hwLsPickMode(\'' + key + '\')" title="Use ' + esc(m.label) + ' timers">' +
          m.emoji + ' ' + m.label +
        '</button>';
      }).join('') +
    '</div>';
  }

  function liveTrackRowHtml(s) {
    var pb = typeof _lpLastPlayback !== 'undefined' ? _lpLastPlayback : null;
    var trackName = (pb && pb.item && pb.item.name) || s.trackName || '';
    var artist = (pb && pb.item && pb.item.artists && pb.item.artists[0] && pb.item.artists[0].name) || s.artistName || '';
    var vol = pb && pb.device && pb.device.volume_percent != null ? pb.device.volume_percent : (s.avgVolumePercent != null ? s.avgVolumePercent : null);
    var playing = !!(pb && pb.is_playing && pb.item);
    var artUrl = pb && pb.item && pb.item.album && pb.item.album.images && pb.item.album.images[0]
      ? pb.item.album.images[0].url : null;
    if (!trackName && !playing) return '';
    var volColor = vol != null ? (vol <= 60 ? '#059669' : vol <= 75 ? '#d97706' : '#dc2626') : 'var(--txt-secondary)';
    if (vol != null && typeof global.hwSpotifyVolumeColor === 'function') volColor = global.hwSpotifyVolumeColor(vol);
    var volHigh = vol != null && typeof global.hwGetVolumeBand === 'function' && global.hwGetVolumeBand(vol) === 'high';
    return '<div class="ls-live-track-row">' +
      '<div class="ls-live-track-art">' + (artUrl ? '<img src="' + esc(artUrl) + '" alt="">' : '♪') + '</div>' +
      '<div class="ls-live-track-body">' +
        '<div class="ls-live-track-name">' + esc(trackName || 'Waiting for track…') + '</div>' +
        '<div class="ls-live-track-meta">' + esc(artist) + (playing ? ' · ● Live' : (trackName ? ' · Paused' : '')) + '</div>' +
      '</div>' +
      '<div class="ls-live-track-vol' + (volHigh ? ' spb-vol-high' : '') + '" style="color:' + volColor + '">' + (vol != null ? vol + '%' : '—') + '</div>' +
    '</div>';
  }

  function sessionCardHtml(s, isLive) {
    var liveTag = isLive ? '<span class="ls-live-pill"><span class="ls-live-dot"></span> Live</span>' : '';
    var dur = formatDuration(s.durationMin);
    var avg = s.avgVolumePercent != null ? s.avgVolumePercent + '%' : '—';
    var focus = formatDuration(s.focusMinutes || 0);
    var prod = s.productivityScore != null ? s.productivityScore : calcProductivityScore(s);
    var breaks = s.breakCount || 0;
    var modeCfg = getModeConfig(isLive ? effectiveSessionMode(s) : (s.mode || 'active'));
    var autoTag = s.modeManual
      ? ' <span style="font-size:9px;font-weight:800;color:#059669;background:rgba(16,185,129,.12);padding:2px 6px;border-radius:6px;vertical-align:middle;">YOU</span>'
      : (s.autoDetected ? ' <span style="font-size:9px;font-weight:800;color:#6366f1;background:#eef2ff;padding:2px 6px;border-radius:6px;vertical-align:middle;">AUTO</span>' : '');
    var questBadge = typeof global.hwQuestSessionBadgeHtml === 'function' ? global.hwQuestSessionBadgeHtml() : '';

    return '<div class="ls-session' + (isLive ? ' ls-session-live' : '') + '">' +
      '<div class="ls-session-top">' +
        '<div class="ls-session-num">🎧 Session #' + s.number + ' · ' + modeCfg.emoji + ' ' + esc(modeCfg.label) + autoTag + questBadge + '</div>' +
        liveTag +
      '</div>' +
      sprintProgressHtml(s, isLive) +
      '<div class="ls-session-stats ls-session-stats-4">' +
        '<div class="ls-stat"><span class="ls-stat-val">' + dur + '</span><span class="ls-stat-lbl">Duration</span></div>' +
        '<div class="ls-stat"><span class="ls-stat-val">' + focus + '</span><span class="ls-stat-lbl">Safe-volume</span></div>' +
        '<div class="ls-stat"><span class="ls-stat-val ls-prod-val">' + prod + '</span><span class="ls-stat-lbl">Ear-safe</span></div>' +
        '<div class="ls-stat"><span class="ls-stat-val ' + riskClass(s.riskLevel) + '">' + esc(s.riskLevel) + '</span><span class="ls-stat-lbl">Ear risk</span></div>' +
      '</div>' +
      '<div class="ls-meta-row"><span>Avg volume ' + avg + '</span>' +
        (breaks ? '<strong>☕ ' + breaks + ' ear rest' + (breaks > 1 ? 's' : '') + '</strong>' : '<span>Ear rests enforced at each sprint</span>') +
      '</div>' +
      (isLive ? liveTrackRowHtml(s) : (s.trackName ? '<div class="ls-now-playing">♪ ' + esc(s.trackName) + '</div>' : '')) +
    '</div>';
  }

  function todayProductivitySummary(store) {
    var all = store.sessions.slice();
    if (store.active) all.push(store.active);
    var focusMin = 0;
    var prodSum = 0;
    var breaks = 0;
    all.forEach(function (s) {
      focusMin += s.focusMinutes || 0;
      prodSum += s.productivityScore != null ? s.productivityScore : calcProductivityScore(s);
      breaks += s.breakCount || 0;
    });
    var avgProd = all.length ? Math.round(prodSum / all.length) : 0;
    return {
      focusMin: focusMin,
      avgProd: avgProd,
      breaks: breaks,
      sessionCount: all.length
    };
  }

  function renderModePickers(store) {
    renderActiveModeBanner(store);
    var html = pomodoroPickerHtml() + modePickerSectionHtml(store);
    var plannerPicker = document.getElementById('lpListeningSessionsModePicker');
    if (plannerPicker) plannerPicker.innerHTML = html;
  }

  function renderHome() {
    /* Focus sessions live in Planner only */
  }

  function renderPlanner() {
    var block = document.getElementById('lpEarRecoveryBlock');
    var list = document.getElementById('lpListeningSessionsList');
    if (!list) return;
    var store = loadStore();

    if (block) block.style.display = 'block';

    renderModePickers(store);
    renderEarAiInsight(store);

    var html = '';
    if (store.active) {
      refreshActiveMetrics(store, Date.now());
      html += sessionCardHtml(store.active, true);
    } else {
      html += sprintPreviewHtml(store.defaultMode || effectiveDisplayMode(store));
      if (isTrackingEnabled()) {
        html += '<div class="ls-idle" style="margin-top:8px;">Spotify connected — press play for auto-detected sprints, or tap Ready to start for the manual timer.</div>';
      } else {
        html += '<div class="ls-idle" style="margin-top:8px;">Tap Ready to start to open the listening timer — no Spotify required.</div>';
      }
    }
    list.innerHTML = html;
    updateBreakNudgeUI();
  }

  function renderAll() {
    renderPlanner();
  }

  function startUiTick() {
    if (_state.uiTick) return;
    _state.uiTick = setInterval(function () {
      var store = loadStore();
      if (!store.active) {
        stopUiTick();
        return;
      }
      var pb = typeof global._lpLastPlayback !== 'undefined' ? global._lpLastPlayback : null;
      var playing = !!(pb && pb.is_playing && pb.item);
      var vol = null;
      if (pb && pb.device) {
        vol = pb.device.volume_percent;
      }
      if (playing && vol != null) {
        accumulateFocusTime(store.active, vol, Date.now());
      }
      refreshActiveMetrics(store, Date.now());
      saveStore(store);
      checkProductivityNudges(store, Date.now());
      renderAll();
      if (isBreakLocked()) updateBreakNudgeUI();
      if (typeof hwUpdateLiveSpotifyUI === 'function' && typeof _lpLastPlayback !== 'undefined') {
        hwUpdateLiveSpotifyUI(_lpLastPlayback);
      }
      if (store.active && typeof global.hwMaybeTriggerHearingAlert === 'function') {
        var v = null;
        if (typeof _lpLastPlayback !== 'undefined' && _lpLastPlayback && _lpLastPlayback.device) {
          v = _lpLastPlayback.device.volume_percent;
        }
        if (v != null) {
          global.hwMaybeTriggerHearingAlert({ vol: v, playing: true, sessionMins: store.active.durationMin });
        }
      }
    }, UI_TICK_MS);
  }

  function stopUiTick() {
    if (_state.uiTick) {
      clearInterval(_state.uiTick);
      _state.uiTick = null;
    }
  }

  function getTodayStats() {
    var store = loadStore();
    var sum = todayProductivitySummary(store);
    return {
      sessionCount: sum.sessionCount,
      totalMinutes: store.sessions.reduce(function (t, s) { return t + (s.durationMin || 0); }, 0) + (store.active ? store.active.durationMin || 0 : 0),
      focusMinutes: sum.focusMin,
      productivityScore: sum.avgProd,
      breaks: sum.breaks,
      active: store.active,
      sessions: store.sessions
    };
  }

  function pauseSafeSessionTracking() {
    stopUiTick();
    dismissBreakNudge();
    _state.pauseStartedAt = null;
    _state.lastPlayTickAt = null;
    _state.continuousStart = null;
    _state.frozenContinuousMin = null;
    _state.sprintHoldingForBreak = false;
    _state.lastSprintNudged = 0;
    var store = loadStore();
    if (store.active) {
      store = finalizeActive(store, Date.now());
      saveStore(store);
    }
    renderAll();
  }

  global.hwLsOpenManualTimer = openManualTimer;
  global.hwLsOnPlayback = onPlayback;
  global.hwLsRenderAll = renderAll;
  global.hwLsRenderHome = renderHome;
  global.hwLsRenderPlanner = renderPlanner;
  global.hwLsAckBreak = ackBreak;
  global.hwLsStartFocusBreak = startFocusBreak;
  global.hwLsContinueToBreak = startFocusBreak;
  global.hwLsBreakNudgeAction = breakNudgeAction;
  global.hwLsOnBreakTimerComplete = onBreakTimerComplete;
  global.hwLsUpdateBreakNudge = updateBreakNudgeUI;
  global.hwLsSetMode = setMode;
  global.hwLsPickMode = pickMode;
  global.hwLsClearManualMode = clearManualMode;
  global.hwLsSetDetectedMeta = setDetectedMeta;
  global.hwLsDismissBreak = dismissBreakNudge;
  global.hwLsGetTodayStats = getTodayStats;
  global.hwLsGetActiveSessionMode = getActiveSessionMode;
  global.hwLsGetBreakMinsForMode = getBreakMinsForMode;
  global.hwLsGetSprintMinsForMode = getSprintMinsForMode;
  global.hwLsGetDefaultSprintMinsForMode = getDefaultSprintMins;
  global.hwLsGetResearchBreakLabelForMode = getResearchBreakLabel;
  global.hwLsGetSprintLimitsForMode = getSprintLimitsForMode;
  global.hwLsIsModeSprintConfigurable = isModeSprintConfigurable;
  global.hwLsSanitizeSessionSprintMins = function (prefs) {
    var out = {};
    Object.keys(prefs || {}).forEach(function (mode) {
      if (!isModeSprintConfigurable(mode)) return;
      var v = Number(prefs[mode]);
      if (!isNaN(v)) out[normalizeMode(mode)] = clampSprintMins(mode, v);
    });
    return out;
  };
  global.hwLsModeExists = modeExists;
  global.hwLsGetAllModeKeys = getAllModeKeys;
  global.hwLsGetModeLabel = getModeLabel;
  global.hwLsPauseSafeSessionTracking = pauseSafeSessionTracking;
  global.hwLsHasActiveSession = function () {
    return !!loadStore().active;
  };
  global.hwLsGetPomodoroPreset = getPomodoroPreset;
  global.hwLsGetPomodoroPresetId = getPomodoroPresetId;
  global.hwLsSetPomodoroPreset = setPomodoroPreset;
  global.hwLsUsesPomodoro = usesPomodoro;

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(renderAll, 800);
  });
  document.addEventListener('hearwise:appReady', function () {
    setTimeout(renderAll, 300);
  });

})(typeof window !== 'undefined' ? window : global);
