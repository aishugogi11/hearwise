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
    quick: { label: '1-Min Sprint', sprintMins: 1, breakMins: 5, emoji: '⚡', bestFor: 'Quick listening check', tip: '1-min sprint → locked ear rest. Great for a fast session reset.' },
    studyQuick: { label: '1-Min Focus & Study', sprintMins: 1, breakMins: 5, emoji: '📚', bestFor: 'Quick study & focus check', tip: '1-min study sprint → locked ear rest. Ideal before a deep focus block.' },
    focus: { label: 'Focus & Study', sprintMins: 90, breakMins: 10, emoji: '🎯', bestFor: 'Study, work & deep focus', tip: '90 min cap aligned with safe-listening guidance — silence breaks are mandatory.' },
    active: { label: 'Chill & Workout', sprintMins: 45, breakMins: 10, emoji: '🎵', bestFor: 'Everyday listening, R&B & gym', tip: 'Pop, R&B, and workout playlists — keep under 75–80 dB and take ear rests between songs or sets.' },
    sleep: { label: 'Sleep', sprintMins: 30, breakMins: 5, emoji: '🌙', bestFor: 'Bedtime wind-down', tip: 'Keep under 55 dB — lower volume aids sleep and overnight ear recovery.' }
  };

  var _state = {
    pauseStartedAt: null,
    continuousStart: null,
    lastPlayTickAt: null,
    lastNudgeAt: 0,
    lastSprintNudged: 0,
    uiTick: null,
    frozenContinuousMin: null,
    lastHighlightedMode: null,
    modeFlashUntil: 0
  };

  function shouldFlashMode(mode) {
    return _state.modeFlashUntil > Date.now() && _state.lastHighlightedMode === mode;
  }

  function notifyModeHighlight(mode, forceFlash) {
    if (!mode) return;
    var changed = mode !== _state.lastHighlightedMode;
    if (!changed && !forceFlash) return;

    if (typeof global.auraSyncSessionBreakTimer === 'function') {
      global.auraSyncSessionBreakTimer(mode);
    }

    _state.lastHighlightedMode = mode;
    _state.modeFlashUntil = Date.now() + 2200;

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
      if (typeof global.auraPrepareSessionBreakTimer === 'function') {
        global.auraPrepareSessionBreakTimer(mode, { openCoach: changed, speak: changed, skipSync: true });
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
    var pid = 'safe';
    if (typeof st !== 'undefined' && st && st.profileId && st.profileId !== 'aishwarya') {
      pid = st.profileId;
    }
    return 'hearwise_ls_' + pid + '_' + todayKey();
  }

  function normalizeMode(mode) {
    if (mode === 'study') return 'focus';
    if (mode === 'chill' || mode === 'workout') return 'active';
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

  function getModeConfig(mode) {
    return MODES[normalizeMode(mode)] || MODES.focus;
  }

  function getSprintMins(session) {
    var mode = normalizeMode((session && session.mode) || 'focus');
    return getModeConfig(mode).sprintMins;
  }

  function getBreakMins(session) {
    var mode = normalizeMode((session && session.mode) || 'focus');
    return getModeConfig(mode).breakMins || 10;
  }

  function getActiveSessionMode() {
    var store = loadStore();
    if (!store || !store.active) return null;
    return effectiveDisplayMode(store);
  }

  function getBreakMinsForMode(mode) {
    return getBreakMins({ mode: normalizeMode(mode) });
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

  /** Productivity score: deep focus at safe volume + breaks + pacing. */
  function calcProductivityScore(s) {
    if (!s) return 0;
    var dur = Math.max(1, s.durationMin || 0);
    var focus = s.focusMinutes || 0;
    var breaks = s.breakCount || 0;
    var sprint = getSprintMins(s);
    var cap = getFocusVolCap();
    var volOk = (s.avgVolumePercent || 70) <= cap + 5;
    var score = 0;
    score += Math.min(45, Math.round((focus / dur) * 45));
    score += Math.min(25, breaks * 12);
    if (volOk) score += 15;
    if (breaks >= Math.max(1, Math.floor(dur / sprint) - 1) || dur <= sprint) score += 15;
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

  function refreshActiveMetrics(store, now) {
    var a = store.active;
    if (!a) return;
    if (a.volumeCount > 0) {
      a.avgVolumePercent = Math.round(a.volumeSum / a.volumeCount);
    }
    a.durationMin = (now - a.startedAt) / 60000;
    if (isBreakLocked() && _state.frozenContinuousMin != null) {
      a.continuousMin = _state.frozenContinuousMin;
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
    store.sessions.unshift(a);
    if (store.sessions.length > 24) store.sessions = store.sessions.slice(0, 24);
    store.active = null;
    _state.continuousStart = null;
    _state.lastPlayTickAt = null;
    _state.lastSprintNudged = 0;
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
    return store;
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
    if (!isTrackingEnabled() && !pb._demo) return;

    var playing = !!(pb.is_playing && pb.item);
    var now = Date.now();
    var store = loadStore();

    if (playing) {
      if (_state.pauseStartedAt) {
        var pauseDur = now - _state.pauseStartedAt;
        if (store.active && pauseDur >= BREAK_MS && pauseDur < SESSION_GAP_MS) {
          store.active.breakCount = (store.active.breakCount || 0) + 1;
          store.active.sprintsCompleted = store.active.breakCount;
          _state.continuousStart = now;
          _state.lastSprintNudged = Math.floor((store.active.continuousMin || 0) / getSprintMins(store.active));
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
      } else {
        store = updateActiveFromPlayback(store, pb, now);
      }
      startUiTick();
    } else {
      _state.lastPlayTickAt = null;
      if (store.active && !_state.pauseStartedAt) {
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
    if (isBreakLocked()) return;
    var a = store.active;
    if (!a) return;
    refreshActiveMetrics(store, now);
    var cont = a.continuousMin || a.durationMin || 0;
    var sprint = getSprintMins(a);
    var sprintIndex = Math.floor(cont / sprint);

    if (sprintIndex >= 1 && sprintIndex > _state.lastSprintNudged && cont >= sprint) {
      if (now - _state.lastNudgeAt >= NUDGE_THROTTLE_MS || sprintIndex > _state.lastSprintNudged) {
        _state.lastNudgeAt = now;
        _state.lastSprintNudged = sprintIndex;
        var modeCfg = getModeConfig(effectiveSessionMode(a));
        var brk = getBreakMins(a);
        if (typeof global.hwQuestOnLsEvent === 'function') {
          global.hwQuestOnLsEvent('sprint', { eventId: 'sprint_' + a.id + '_' + sprintIndex, sprintIndex: sprintIndex });
        }
        triggerAutoFocusBreak(
          modeCfg.emoji + ' <strong>' + modeCfg.label + ' sprint complete</strong> (' + sprint + ' min). ' +
          'Starting your ' + brk + '-minute ear rest — take headphones off while the timer runs.',
          true
        );
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
    if (typeof global.hwPlayAlertRing === 'function') global.hwPlayAlertRing('break');
    showBreakNudge(msg, isSprint);
    startFocusBreak();
  }

  function showBreakNudge(msg, isSprint) {
    var els = breakNudgeEls();
    var title = els.el ? els.el.querySelector('.ls-break-title') : null;
    if (els.el && els.txt) {
      els.txt.innerHTML = msg;
      els.el.classList.add('visible');
      els.el.classList.toggle('ls-sprint-nudge', !!isSprint);
      if (title) title.textContent = isBreakLocked() ? '⏸ Ear rest in progress' : 'Ear rest required';
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
        els.txt.innerHTML = 'Ear rest — <strong>' + formatTimerSecs(wpTimerSecs) + '</strong> remaining. ' +
          'Take headphones off — your cochlea recovers fastest in silence.';
      }
    } else {
      els.btn.style.display = '';
    }
    var store = loadStore();
    renderEarAiInsight(store);
  }

  function dismissBreakNudge() {
    var els = breakNudgeEls();
    if (els.el) els.el.classList.remove('visible', 'ls-sprint-nudge');
  }

  function logBreakComplete() {
    var store = loadStore();
    if (store.active) {
      store.active.breakCount = (store.active.breakCount || 0) + 1;
      store.active.sprintsCompleted = store.active.breakCount;
      saveStore(store);
    }
    _state.continuousStart = Date.now();
    _state.frozenContinuousMin = null;
    _state.lastNudgeAt = Date.now();
    dismissBreakNudge();
    if (typeof showXpToast === 'function') showXpToast(25, 'Ear rest complete — hearing protected');
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

  function startFocusBreak() {
    if (isBreakLocked()) return;
    var store = loadStore();
    if (store.active) {
      refreshActiveMetrics(store, Date.now());
      _state.frozenContinuousMin = store.active.continuousMin || 0;
      saveStore(store);
    }
    var breakMins = store.active ? getBreakMins(store.active) : 10;
    var modeCfg = store.active ? getModeConfig(store.active.mode) : null;
    if (typeof auraEarRestStart === 'function') {
      auraEarRestStart(breakMins, false, {
        lock: false,
        autoStart: true,
        source: 'listening',
        title: 'Ear Rest — ' + breakMins + ' Minutes' + (modeCfg ? ' (' + modeCfg.label + ')' : ''),
        desc: 'Silence break — headphones off while the timer runs. You can keep using HearWise in the background.'
      });
    }
    updateBreakNudgeUI();
    renderAll();
  }

  function setMode(mode, opts) {
    opts = opts || {};
    if (!opts.auto) return;
    mode = normalizeMode(mode);
    if (!MODES[mode]) return;
    var breakLocked = isBreakLocked();
    if (breakLocked && opts.resetSprint) opts = Object.assign({}, opts, { resetSprint: false });
    var store = loadStore();
    store.defaultMode = mode;
    if (store.active) {
      store.active.mode = mode;
      store.active.detectedMode = mode;
      _state.lastSprintNudged = Math.floor((store.active.continuousMin || 0) / getSprintMins(store.active));
      if (opts.resetSprint && !breakLocked) {
        _state.continuousStart = Date.now();
        _state.lastSprintNudged = 0;
        store.active.continuousMin = 0;
      }
    } else {
      _state.lastSprintNudged = 0;
    }
    saveStore(store);
    if (typeof global.auraSyncSessionBreakTimer === 'function') {
      global.auraSyncSessionBreakTimer(mode);
    }
    notifyModeHighlight(mode, !!opts.resetSprint || breakLocked);
    renderAll();
    if (!opts.auto && typeof showXpToast === 'function') {
      showXpToast(0, getModeConfig(mode).label + ' · ' + getModeConfig(mode).sprintMins + ' min sprints · ' + getBreakMins({ mode: mode }) + ' min rests');
    }
  }

  function setDetectedMeta(meta) {
    if (!meta) return;
    var store = loadStore();
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
      var cont = a.continuousMin || 0;
      var toBreak = Math.max(0, sprint - (cont % sprint));
      var vol = a.avgVolumePercent != null ? a.avgVolumePercent : '—';
      var modeCfg = getModeConfig(effectiveSessionMode(a));
      var detectLine = a.modeReason
        ? ' · <span style="color:#4338ca;">Aura detected ' + esc(modeCfg.label) + ' from your music</span>'
        : '';
      if (a.mode === 'quick' || (a.artistName && /taylor swift/i.test(a.artistName))) {
        detectLine = ' · <span style="color:#4338ca;">⚡ Taylor Swift → 1-min sprint active</span>';
      } else if (a.mode === 'studyQuick') {
        detectLine = ' · <span style="color:#4338ca;">📚 1-Min Focus & Study sprint active</span>';
      }
      el.innerHTML = '<strong>Live dose update:</strong> Session #' + a.number + ' · ' + modeCfg.emoji + ' ' + esc(modeCfg.label) +
        ' · ~' + dose + '% daily dose · avg volume ' + vol + '% ' +
        (a.avgVolumePercent > cap ? '(above ' + cap + '% cap)' : '(within cap)') + detectLine + '. ' +
        '<strong>' + getBreakMins(a) + '-min ear rest in ' + formatBreakRemaining(toBreak) + '.</strong>';
      return;
    }
    if (enabled) {
      var modeCfg = getModeConfig(store.defaultMode || 'focus');
      el.innerHTML = '<strong>Ready to protect your ears.</strong> Press play on Spotify — Aura tracks volume + duration, forecasts your safe dose, and ' +
        'auto-starts a <strong>' + (modeCfg.sprintMins) + '-min sprint</strong> then a silence break. No calendar needed.';
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
    if (!reason && playing && track) {
      reason = 'Detected from ♪ ' + track + (artist ? ' · ' + artist : '');
    }
    var status = playing ? '● LIVE NOW' : (track ? 'PAUSED' : 'READY');
    return '<div class="ls-active-mode-banner' + flash + '" id="lsActiveModeBanner">' +
      '<div class="ls-active-mode-badge">' + status + '</div>' +
      '<div class="ls-active-mode-emoji">' + m.emoji + '</div>' +
      '<div class="ls-active-mode-main">' +
        '<div class="ls-active-mode-title">' + esc(m.label) + '</div>' +
        '<div class="ls-active-mode-sub">' + m.sprintMins + '-min sprint · ' + (m.breakMins || 10) + '-min ear rest</div>' +
        (reason ? '<div class="ls-active-mode-reason">' + esc(reason) + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  function modeLegendHtml(activeMode) {
    return '<div class="ls-mode-legend">' +
      Object.keys(MODES).map(function (key) {
        var m = MODES[key];
        var active = key === activeMode ? ' ls-mode-legend-active' : '';
        var pulse = key === activeMode && shouldFlashMode(activeMode) ? ' ls-mode-legend-flash' : '';
        return '<div class="ls-mode-legend-row' + active + pulse + '">' +
          '<strong>' + m.emoji + ' ' + m.label + '</strong>' +
          '<span class="ls-mode-sprint">' + m.sprintMins + ' min sprint · ' + (m.breakMins || 10) + ' min rest</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function modePickerSectionHtml(store) {
    var mode = effectiveDisplayMode(store);
    var m = getModeConfig(mode);
    return '<div class="ls-mode-picker-label">Session type · <span class="ls-mode-current">' + m.emoji + ' ' + esc(m.label) + ' active</span></div>' +
      modeDisplayHtml(mode) +
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
        '<div class="ls-sprint-countdown">Ready to start<small>Press play on Spotify — Aura picks your session type and starts the sprint timer</small></div>' +
        '<div class="ls-sprint-track"><div class="ls-sprint-fill" style="width:0%"></div></div>' +
      '</div>';
    }
    var cont = s.continuousMin || s.durationMin || 0;
    var inSprint = cont % sprint;
    var pct = Math.min(100, Math.max(0, Math.round((inSprint / sprint) * 100)));
    var remaining = Math.max(0, sprint - inSprint);
    var countdown = formatBreakRemaining(remaining);
    var elapsedInSprint = Math.floor(inSprint);
    return '<div class="ls-sprint-wrap' + (isLive ? ' ls-sprint-active' : '') + '">' +
      '<div class="ls-sprint-hd">' +
        '<span>' + modeCfg.emoji + ' ' + esc(modeCfg.label) + ' sprint</span>' +
        '<span>' + elapsedInSprint + ' / ' + sprint + ' min</span>' +
      '</div>' +
        '<div class="ls-sprint-countdown">' + countdown +
        '<small>NIOSH/WHO-aligned sprint · ear rest when timer hits zero</small></div>' +
      '<div class="ls-sprint-track"><div class="ls-sprint-fill" style="width:' + pct + '%"></div></div>' +
    '</div>';
  }

  function sprintPreviewHtml(mode) {
    var m = getModeConfig(mode);
    return sprintProgressHtml({ mode: mode, continuousMin: 0, durationMin: 0 }, false);
  }

  function modeDisplayHtml(activeMode) {
    var flash = shouldFlashMode(activeMode);
    return '<div class="ls-mode-row">' +
      Object.keys(MODES).map(function (key) {
        var m = MODES[key];
        var on = key === activeMode ? ' ls-mode-on' : '';
        var pulse = key === activeMode && flash ? ' ls-mode-flash' : '';
        return '<span class="ls-mode-chip ls-mode-readonly' + on + pulse + '">' +
          m.emoji + ' ' + m.label +
        '</span>';
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
    var autoTag = s.autoDetected ? ' <span style="font-size:9px;font-weight:800;color:#6366f1;background:#eef2ff;padding:2px 6px;border-radius:6px;vertical-align:middle;">AUTO</span>' : '';
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
    var html = modePickerSectionHtml(store);
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
    var enabled = isTrackingEnabled();

    if (block) block.style.display = 'block';

    renderModePickers(store);
    renderEarAiInsight(store);

    var html = '';
    if (store.active) {
      refreshActiveMetrics(store, Date.now());
      html += sessionCardHtml(store.active, true);
    } else if (enabled) {
      html += sprintPreviewHtml(store.defaultMode || 'focus') +
        '<div class="ls-idle" style="margin-top:8px;">Press play on Spotify — Aura detects your session type from the song, selects the mode, and starts timing automatically.</div>';
    } else {
      html = '<div class="ls-idle">Connect Spotify for live dose tracking and mandatory ear rests — no calendar planning required.</div>';
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
      var vol = null;
      if (typeof _lpLastPlayback !== 'undefined' && _lpLastPlayback && _lpLastPlayback.device) {
        vol = _lpLastPlayback.device.volume_percent;
      }
      if (vol != null) {
        accumulateFocusTime(store.active, vol, Date.now());
      }
      refreshActiveMetrics(store, Date.now());
      saveStore(store);
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

  global.hwLsOnPlayback = onPlayback;
  global.hwLsRenderAll = renderAll;
  global.hwLsRenderHome = renderHome;
  global.hwLsRenderPlanner = renderPlanner;
  global.hwLsAckBreak = ackBreak;
  global.hwLsStartFocusBreak = startFocusBreak;
  global.hwLsOnBreakTimerComplete = onBreakTimerComplete;
  global.hwLsUpdateBreakNudge = updateBreakNudgeUI;
  global.hwLsSetMode = setMode;
  global.hwLsSetDetectedMeta = setDetectedMeta;
  global.hwLsDismissBreak = dismissBreakNudge;
  global.hwLsGetTodayStats = getTodayStats;
  global.hwLsGetActiveSessionMode = getActiveSessionMode;
  global.hwLsGetBreakMinsForMode = getBreakMinsForMode;
  global.hwLsGetSprintMinsForMode = getSprintMinsForMode;
  global.hwLsGetModeLabel = getModeLabel;

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(renderAll, 800);
  });
  document.addEventListener('hearwise:appReady', function () {
    setTimeout(renderAll, 300);
  });

})(typeof window !== 'undefined' ? window : global);
