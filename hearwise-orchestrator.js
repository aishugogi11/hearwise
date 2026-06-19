/**
 * HearWise Orchestrator — internal coordination layer (not user-facing).
 * Modules: Focus · Audio Wellness · Music · Recovery · Memory · Auto-Pilot
 */
(function (global) {
  'use strict';

  var PRESETS = {
    '25/5': { id: '25/5', focusMin: 25, breakMin: 5 },
    '50/10': { id: '50/10', focusMin: 50, breakMin: 10 },
    '90/15': { id: '90/15', focusMin: 90, breakMin: 15 }
  };

  var KEYS = {
    prefs: 'hearwise_orch_prefs',
    memory: 'hearwise_orch_memory_v1',
    sessions: 'hearwise_orch_sessions_v1',
    snapshots: 'hearwise_orch_wellness_snapshots_v1',
    autopilotLog: 'hearwise_orch_autopilot_log_v1'
  };

  var VOLUME_COOLDOWN_MS = 8000;
  var FOCUS_COMPLETE_POINTS = 50;
  var BREAK_POINTS = 15;

  /* ── Auto-Pilot (global listening + focus) ── */
  var AutoPilotState = {
    loopTick: null,
    lastVolumeAdjust: 0,
    recoveryTriggered: false,
    lastNote: null,
    actions: [],
    peakVol: 0,
    volumeInFlight: false
  };

  function manageAutoPilotLoop() {
    if (AutoPilotState.loopTick) {
      clearInterval(AutoPilotState.loopTick);
      AutoPilotState.loopTick = null;
    }
    if (!MemoryModule.prefs().audioAutoPilot) return;
    AutoPilotState.loopTick = setInterval(globalListenTick, 5000);
    if (typeof global.hwStartSystemVolumePoll === 'function') global.hwStartSystemVolumePoll();
    globalListenTick();
  }

  function globalListenTick() {
    var prefs = MemoryModule.prefs();
    if (!prefs.audioAutoPilot) {
      manageAutoPilotLoop();
      return;
    }
    if (!isListeningActive()) {
      AutoPilotState.recoveryTriggered = false;
      AutoPilotState.peakVol = 0;
      syncAutoPilotUI();
      return;
    }
    var vol = AudioWellnessModule.effectiveVolume();
    if (vol != null) AutoPilotState.peakVol = Math.max(AutoPilotState.peakVol, vol);
    runAutoPilot();
    syncAutoPilotUI();
  }

  function spotifyDeviceId() {
    var pb = global._lastGoodSpotifyPlayback;
    if (pb && pb.device && pb.device.id) return pb.device.id;
    return null;
  }

  function resolveSpotifyDevice() {
    var cached = spotifyDeviceId();
    if (cached) return Promise.resolve({ id: cached, name: null });
    return fetch('/api/spotify/devices', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.devices || !data.devices.length) return null;
        var d = data.devices.find(function (x) { return x.is_active; })
          || data.devices.find(function (x) { return x.type === 'Computer'; })
          || data.devices[0];
        if (d && d.id && global._lastGoodSpotifyPlayback && global._lastGoodSpotifyPlayback.device) {
          global._lastGoodSpotifyPlayback.device.id = d.id;
        }
        return d ? { id: d.id, name: d.name, volume: d.volume_percent } : null;
      })
      .catch(function () { return null; });
  }

  function ensurePlaybackFresh() {
    if (typeof global.updateSpotifyLiveDisplay === 'function') {
      return global.updateSpotifyLiveDisplay(true).catch(function () { /* ignore */ });
    }
    if (typeof global.lpFetchSpotifyPlayback === 'function') {
      return global.lpFetchSpotifyPlayback(true).catch(function () { /* ignore */ });
    }
    return Promise.resolve();
  }

  function isListeningActive() {
    if (MusicModule.isPlaying()) return true;
    var live = global._spotifyLive;
    if (live && live.isPlaying) return true;
    var pb = global._lastGoodSpotifyPlayback;
    if (pb && pb.item && pb.is_playing) return true;
    return !!(pb && pb.item && pb.updatedAt && (Date.now() - pb.updatedAt) < 120000);
  }

  function refreshVolumeUI(spotifyVol, effectiveVol) {
    if (spotifyVol != null) global.lastSpotifyVolume = spotifyVol;
    if (global._lastGoodSpotifyPlayback && global._lastGoodSpotifyPlayback.device) {
      global._lastGoodSpotifyPlayback.device.spotify_volume_percent = spotifyVol;
      global._lastGoodSpotifyPlayback.device.volume_percent = spotifyVol;
    }
    if (typeof global.hwUpdateSpotifyLiveFromPlayback === 'function' && global._lastGoodSpotifyPlayback) {
      global.hwUpdateSpotifyLiveFromPlayback(global._lastGoodSpotifyPlayback);
    } else if (typeof global.updateSpotifyLiveDisplay === 'function') {
      global.updateSpotifyLiveDisplay(true);
    } else if (typeof global.lpFetchSpotifyPlayback === 'function') {
      global.lpFetchSpotifyPlayback(true);
    }
  }

  function defaultPrefs() {
    return {
      audioAutoPilot: false,
      safeVolumeMax: null,
      preferredVolume: null,
      autoLowerVolume: false,
      autoLowerSystemVolume: true,
      autoRecoveryBreak: true,
      recoveryBudgetThreshold: 85,
      autoPauseOnComplete: true,
      autoBreakOnComplete: true
    };
  }

  function normalizePrefs(raw) {
    var d = defaultPrefs();
    if (!raw || typeof raw !== 'object') return d;
    return {
      audioAutoPilot: !!raw.audioAutoPilot,
      safeVolumeMax: raw.safeVolumeMax != null ? Number(raw.safeVolumeMax) : null,
      preferredVolume: raw.preferredVolume != null ? Number(raw.preferredVolume) : null,
      autoLowerVolume: raw.autoLowerVolume !== false,
      autoLowerSystemVolume: raw.autoLowerSystemVolume !== false,
      autoRecoveryBreak: raw.autoRecoveryBreak !== false,
      recoveryBudgetThreshold: raw.recoveryBudgetThreshold != null
        ? Number(raw.recoveryBudgetThreshold) : 85,
      autoPauseOnComplete: raw.autoPauseOnComplete !== false,
      autoBreakOnComplete: raw.autoBreakOnComplete !== false
    };
  }

  /* ── Memory Module ── */
  var MemoryModule = {
    load: function () {
      try {
        return JSON.parse(localStorage.getItem(KEYS.memory) || '{}');
      } catch (e) {
        return {};
      }
    },
    save: function (data) {
      try { localStorage.setItem(KEYS.memory, JSON.stringify(data)); } catch (e) { /* ignore */ }
    },
    sessions: function () {
      try {
        return JSON.parse(localStorage.getItem(KEYS.sessions) || '[]');
      } catch (e) {
        return [];
      }
    },
    saveSessions: function (list) {
      try {
        localStorage.setItem(KEYS.sessions, JSON.stringify(list.slice(-120)));
      } catch (e) { /* ignore */ }
    },
    prefs: function () {
      try {
        return normalizePrefs(JSON.parse(localStorage.getItem(KEYS.prefs) || '{}'));
      } catch (e) {
        return defaultPrefs();
      }
    },
    savePrefs: function (p) {
      try { localStorage.setItem(KEYS.prefs, JSON.stringify(normalizePrefs(p))); } catch (e) { /* ignore */ }
    },
    recordSession: function (record) {
      var list = MemoryModule.sessions();
      list.push(record);
      MemoryModule.saveSessions(list);
      var mem = MemoryModule.load();
      mem.totalFocusSessions = (mem.totalFocusSessions || 0) + 1;
      mem.totalFocusMinutes = (mem.totalFocusMinutes || 0) + (record.focusMin || 0);
      mem.lastSessionAt = record.completedAt;
      mem.hourBuckets = mem.hourBuckets || {};
      var h = new Date(record.completedAt).getHours();
      mem.hourBuckets[h] = (mem.hourBuckets[h] || 0) + 1;
      MemoryModule.save(mem);
    },
    recordBreak: function () {
      var mem = MemoryModule.load();
      mem.totalBreaks = (mem.totalBreaks || 0) + 1;
      MemoryModule.save(mem);
    },
    lifetimeFocusPoints: function () {
      var mem = MemoryModule.load();
      return (mem.totalFocusSessions || 0) * FOCUS_COMPLETE_POINTS +
        (mem.totalBreaks || 0) * BREAK_POINTS;
    },
    wellnessSnapshots: function () {
      try {
        return JSON.parse(localStorage.getItem(KEYS.snapshots) || '[]');
      } catch (e) {
        return [];
      }
    },
    saveWellnessSnapshot: function (snap) {
      var list = MemoryModule.wellnessSnapshots();
      var day = snap.date || new Date().toISOString().split('T')[0];
      list = list.filter(function (s) { return s.date !== day; });
      list.push(snap);
      try {
        localStorage.setItem(KEYS.snapshots, JSON.stringify(list.slice(-90)));
      } catch (e) { /* ignore */ }
    },
    bestFocusHours: function () {
      var mem = MemoryModule.load();
      var buckets = mem.hourBuckets || {};
      var best = null;
      Object.keys(buckets).forEach(function (h) {
        if (!best || buckets[h] > best.count) best = { hour: parseInt(h, 10), count: buckets[h] };
      });
      return best;
    },
    recordAutoPilotAction: function (action) {
      try {
        var list = JSON.parse(localStorage.getItem(KEYS.autopilotLog) || '[]');
        list.push(action);
        localStorage.setItem(KEYS.autopilotLog, JSON.stringify(list.slice(-200)));
      } catch (e) { /* ignore */ }
      var mem = MemoryModule.load();
      mem.autopilotActions = (mem.autopilotActions || 0) + 1;
      MemoryModule.save(mem);
    },
    autopilotActions: function () {
      try {
        return JSON.parse(localStorage.getItem(KEYS.autopilotLog) || '[]');
      } catch (e) {
        return [];
      }
    }
  };

  /* ── Focus Module ── */
  var FocusModule = {
    state: {
      phase: 'idle',
      presetId: '25/5',
      secsLeft: 0,
      secsTotal: 0,
      sessionId: null,
      startedAt: null,
      paused: false,
      tick: null,
      observeTick: null,
      autoActions: [],
      lastAutoPilotNote: null,
      breaksThisSession: 0,
      focusCompleted: false
    },
    autoPilot: {
      lastVolumeAdjust: 0,
      recoveryTriggered: false
    },
    stats: {
      listeningMin: 0,
      volSum: 0,
      volCount: 0,
      peakVol: 0,
      playingMin: 0,
      samples: []
    },
    preset: function () {
      return PRESETS[FocusModule.state.presetId] || PRESETS['25/5'];
    },
    focusScore: function () {
      var total = MemoryModule.lifetimeFocusPoints();
      if (FocusModule.state.phase !== 'idle') {
        total += FocusModule.currentSessionPoints();
      }
      return total;
    },
    currentSessionPoints: function () {
      var breaks = FocusModule.state.breaksThisSession || 0;
      var completed = FocusModule.state.focusCompleted ? 1 : 0;
      return completed * FOCUS_COMPLETE_POINTS + breaks * BREAK_POINTS;
    },
    resetStats: function () {
      FocusModule.stats = {
        listeningMin: 0, volSum: 0, volCount: 0, peakVol: 0, playingMin: 0, samples: []
      };
      FocusModule.state.autoActions = [];
      FocusModule.state.lastAutoPilotNote = null;
      FocusModule.state.breaksThisSession = 0;
      FocusModule.state.focusCompleted = false;
      FocusModule.autoPilot.lastVolumeAdjust = 0;
      FocusModule.autoPilot.recoveryTriggered = false;
    }
  };

  /* ── Audio Wellness Module ── */
  var AudioWellnessModule = {
    effectiveVolume: function () {
      if (typeof global.hwGetEffectiveVolume === 'function') {
        var spotify = global.lastSpotifyVolume;
        if (spotify == null && global._lastGoodSpotifyPlayback && global._lastGoodSpotifyPlayback.device) {
          spotify = global._lastGoodSpotifyPlayback.device.volume_percent;
        }
        if (spotify != null) return global.hwGetEffectiveVolume(spotify);
      }
      var pb = global._lastGoodSpotifyPlayback;
      return pb && pb.device ? pb.device.volume_percent : null;
    },
    spotifyVolume: function () {
      if (global.lastSpotifyVolume != null) return global.lastSpotifyVolume;
      var pb = global._lastGoodSpotifyPlayback;
      if (pb && pb.device) {
        if (pb.device.spotify_volume_percent != null) return pb.device.spotify_volume_percent;
        return pb.device.volume_percent;
      }
      var live = global._spotifyLive;
      if (live && live.spotifyVolume != null) return live.spotifyVolume;
      return null;
    },
    systemVolume: function () {
      if (global._systemVolumeAvailable && global.lastSystemVolume != null) return global.lastSystemVolume;
      var live = global._spotifyLive;
      if (live && live.systemVolume != null) return live.systemVolume;
      return null;
    },
    hasSystemVolume: function () {
      return global._systemVolumeAvailable && global.lastSystemVolume != null;
    },
    volumeNeedsLower: function () {
      var prefs = MemoryModule.prefs();
      var cap = AudioWellnessModule.safeVolumeCap();
      var effective = AudioWellnessModule.effectiveVolume();
      var spotify = AudioWellnessModule.spotifyVolume();
      var hasSystem = AudioWellnessModule.hasSystemVolume();

      if (hasSystem && prefs.autoLowerSystemVolume !== false) {
        return effective != null && effective > cap;
      }
      if (prefs.autoLowerVolume !== false && spotify != null && spotify > cap) return true;
      if (effective != null && effective > cap) return true;
      return false;
    },
    computeSpotifyTarget: function () {
      var spotify = AudioWellnessModule.spotifyVolume();
      var preferred = AudioWellnessModule.preferredVolume();
      var cap = AudioWellnessModule.safeVolumeCap();
      var system = global.lastSystemVolume;
      var hasSystem = global._systemVolumeAvailable && system != null && system > 0;
      if (spotify == null) return null;

      var target = preferred;
      if (hasSystem) {
        var effectiveTarget = preferred;
        var fromEffective = Math.round(effectiveTarget * 100 / system);
        target = Math.min(fromEffective, spotify - 1);
      }
      if (spotify > cap) {
        target = Math.min(target, spotify > preferred + 10 ? Math.max(preferred, spotify - 15) : preferred);
      }
      target = Math.max(0, Math.min(100, Math.round(target)));
      if (target >= spotify) target = Math.max(0, spotify - 10);
      return target < spotify ? target : null;
    },
    computeSystemTarget: function () {
      var spotify = AudioWellnessModule.spotifyVolume();
      var system = AudioWellnessModule.systemVolume();
      var preferred = AudioWellnessModule.preferredVolume();
      var cap = AudioWellnessModule.safeVolumeCap();
      var effective = AudioWellnessModule.effectiveVolume();
      if (system == null || system <= 0) return null;
      if (effective == null || effective <= cap) return null;

      var targetEffective = preferred;
      if (spotify != null && spotify > 0) {
        var targetSystem = Math.round(targetEffective * 100 / spotify);
        targetSystem = Math.max(0, Math.min(100, Math.min(system - 1, targetSystem)));
        return targetSystem < system ? targetSystem : null;
      }
      if (system > cap) {
        var fallback = Math.max(preferred, Math.min(system - 1, cap));
        return fallback < system ? fallback : null;
      }
      return null;
    },
    computeVolumePlan: function () {
      var prefs = MemoryModule.prefs();
      var hasSystem = AudioWellnessModule.hasSystemVolume();

      if (hasSystem && prefs.autoLowerSystemVolume !== false) {
        var systemTarget = AudioWellnessModule.computeSystemTarget();
        if (systemTarget == null) return null;
        return { spotify: null, system: systemTarget };
      }

      if (prefs.autoLowerVolume !== false) {
        var spotifyTarget = AudioWellnessModule.computeSpotifyTarget();
        if (spotifyTarget == null) return null;
        return { spotify: spotifyTarget, system: null };
      }

      return null;
    },
    safeVolumeCap: function () {
      var prefs = MemoryModule.prefs();
      if (prefs.safeVolumeMax != null && !isNaN(prefs.safeVolumeMax)) return prefs.safeVolumeMax;
      if (global._fcalState && global._fcalState.volCap) return global._fcalState.volCap;
      var pid = global.st && global.st.profileId;
      if (pid === 'highRisk') return 55;
      if (pid === 'student') return 60;
      if (pid === 'safe') return 70;
      return 65;
    },
    preferredVolume: function () {
      var prefs = MemoryModule.prefs();
      if (prefs.preferredVolume != null && !isNaN(prefs.preferredVolume)) return prefs.preferredVolume;
      return Math.max(40, AudioWellnessModule.safeVolumeCap() - 5);
    },
    sessionBudget: function () {
      var vol = FocusModule.stats.peakVol || AutoPilotState.peakVol ||
        AudioWellnessModule.effectiveVolume() || 70;
      var mins = FocusModule.stats.listeningMin;
      if (FocusModule.state.phase === 'focus' && FocusModule.state.startedAt) {
        mins = Math.max(mins, (Date.now() - FocusModule.state.startedAt) / 60000);
      } else if (global._spotifyLive && global._spotifyLive.sessionMinutes != null) {
        mins = global._spotifyLive.sessionMinutes;
      } else if (global._spotifySessionStart) {
        mins = (Date.now() - global._spotifySessionStart) / 60000;
      }
      if (typeof global.computeSessionRiskPercent === 'function') {
        return global.computeSessionRiskPercent(vol, Math.max(1, mins));
      }
      return Math.min(100, Math.round(mins * (vol / 100) * 1.2));
    },
    wellnessScore: function () {
      if (typeof global.predictHearingFutureForProfile === 'function' && global.st && global.st.profile) {
        var p = global.predictHearingFutureForProfile(global.st.profile);
        return p && p.projectedHealthScore != null ? p.projectedHealthScore : null;
      }
      if (global.st && global.st.profile && global.st.profile.healthScore != null) {
        return global.st.profile.healthScore;
      }
      return null;
    },
    fatigueLevel: function () {
      var budget = AudioWellnessModule.sessionBudget();
      var threshold = MemoryModule.prefs().recoveryBudgetThreshold || 85;
      if (budget >= threshold) return 'high';
      if (budget >= threshold - 20) return 'moderate';
      return 'low';
    },
    volumeRisk: function () {
      var vol = AudioWellnessModule.effectiveVolume();
      if (vol == null) return 'unknown';
      var cap = AudioWellnessModule.safeVolumeCap();
      if (vol > cap + 8) return 'critical';
      if (vol > cap) return 'high';
      return 'ok';
    },
    budgetRisk: function () {
      var budget = AudioWellnessModule.sessionBudget();
      var threshold = MemoryModule.prefs().recoveryBudgetThreshold || 85;
      if (budget >= threshold) return 'high';
      if (budget >= threshold - 15) return 'moderate';
      return 'ok';
    },
    detectRisk: function () {
      return {
        volume: AudioWellnessModule.volumeRisk(),
        budget: AudioWellnessModule.budgetRisk(),
        effectiveVolume: AudioWellnessModule.effectiveVolume(),
        safeCap: AudioWellnessModule.safeVolumeCap(),
        budgetPct: AudioWellnessModule.sessionBudget(),
        playing: MusicModule.isPlaying()
      };
    }
  };

  /* ── Music Module ── */
  var MusicModule = {
    context: function () {
      if (typeof global.hwSessionClassifierGetMode === 'function') {
        return global.hwSessionClassifierGetMode();
      }
      var pb = global._lastGoodSpotifyPlayback;
      if (!pb || !pb.item) return 'general';
      return 'listening';
    },
    trackLabel: function () {
      var pb = global._lastGoodSpotifyPlayback;
      if (!pb || !pb.item) return null;
      return pb.item.name;
    },
    isPlaying: function () {
      return !!(global._lastGoodSpotifyPlayback && global._lastGoodSpotifyPlayback.is_playing);
    },
    insight: function () {
      if (!MusicModule.isPlaying()) return null;
      var ctx = MusicModule.context();
      if (ctx === 'focus' || ctx === 'study' || ctx === 'studyQuick') {
        return 'Study-context listening detected — volume patterns are tracked for your wellness score.';
      }
      return null;
    },
    setSpotifyVolume: function (targetSpotify, deviceId, skipRefresh) {
      targetSpotify = Math.max(0, Math.min(100, Math.round(targetSpotify)));

      function callApi(id) {
        var payload = { volume_percent: targetSpotify };
        if (id) payload.device_id = id;
        return fetch('/api/spotify/volume', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function (r) {
          return r.json().then(function (data) {
            return { ok: !!(r.ok && data && data.success !== false), data: data, status: r.status };
          }).catch(function () {
            return { ok: r.ok, data: null, status: r.status };
          });
        }).catch(function () { return { ok: false, data: null, status: 0 }; });
      }

      function finish(result, dev) {
        if (result.ok && !skipRefresh) refreshVolumeUI(targetSpotify, null);
        return Object.assign({ spotify: targetSpotify, device: dev }, result);
      }

      if (deviceId) {
        return callApi(deviceId).then(function (result) { return finish(result, { id: deviceId }); });
      }

      return resolveSpotifyDevice().then(function (dev) {
        return callApi(dev && dev.id).then(function (result) { return finish(result, dev); });
      });
    },
    setEffectiveVolume: function (targetEffective) {
      var spotify = AudioWellnessModule.spotifyVolume();
      if (spotify == null) return Promise.resolve({ ok: false, reason: 'no_spotify_volume' });

      targetEffective = Math.max(20, Math.min(100, Math.round(targetEffective)));
      var system = global.lastSystemVolume;
      var hasSystem = global._systemVolumeAvailable && system != null;

      if (hasSystem && system > 0) {
        var newSpotify = Math.round(targetEffective * 100 / system);
        newSpotify = Math.max(0, Math.min(100, newSpotify));
        if (newSpotify >= spotify) newSpotify = Math.max(0, spotify - 10);
        return MusicModule.setSpotifyVolume(newSpotify, null, true).then(function (result) {
          if (!result.ok) return result;
          var projected = Math.round(newSpotify * system / 100);
          if (projected > targetEffective + 2 && newSpotify > 0) {
            return MusicModule.setSystemVolume(Math.round(targetEffective * 100 / newSpotify)).then(function (sysResult) {
              refreshVolumeUI(newSpotify, targetEffective);
              return {
                ok: sysResult.ok,
                spotify: newSpotify,
                system: global.lastSystemVolume,
                effective: targetEffective
              };
            });
          }
          refreshVolumeUI(newSpotify, projected);
          return { ok: true, spotify: newSpotify, effective: projected };
        });
      }

      return MusicModule.setSpotifyVolume(targetEffective);
    },
    setSystemVolume: function (targetSystem) {
      targetSystem = Math.max(0, Math.min(100, Math.round(targetSystem)));
      return fetch('/api/system/volume', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume_percent: targetSystem })
      }).then(function (r) {
        return r.json().then(function (data) {
          var ok = !!(r.ok && data && data.available !== false && !data.error);
          if (ok && data.volume_percent != null) {
            global.lastSystemVolume = data.volume_percent;
            global._systemVolumeAvailable = true;
          }
          return { ok: ok, system: targetSystem, data: data, status: r.status };
        }).catch(function () {
          return { ok: r.ok, system: targetSystem, data: null, status: r.status };
        });
      }).catch(function () {
        return { ok: false, system: targetSystem, data: null, status: 0 };
      });
    },
    applyVolumePlan: function (plan) {
      if (!plan || (plan.spotify == null && plan.system == null)) {
        return Promise.resolve({ ok: false, reason: 'no_plan' });
      }
      var fromSpotify = AudioWellnessModule.spotifyVolume();
      var fromSystem = AudioWellnessModule.systemVolume();
      var spotifyPromise = plan.spotify != null
        ? MusicModule.setSpotifyVolume(plan.spotify, null, true)
        : Promise.resolve({ ok: true, skipped: true });

      return spotifyPromise.then(function (spotifyResult) {
        if (plan.spotify != null && (!spotifyResult || !spotifyResult.ok)) {
          return { ok: false, spotifyResult: spotifyResult, fromSpotify: fromSpotify, fromSystem: fromSystem };
        }
        if (plan.system == null) {
          return {
            ok: true,
            spotify: plan.spotify,
            fromSpotify: fromSpotify,
            fromSystem: fromSystem,
            spotifyResult: spotifyResult
          };
        }
        return MusicModule.setSystemVolume(plan.system).then(function (systemResult) {
          return {
            ok: !!(systemResult && systemResult.ok),
            spotify: plan.spotify,
            system: plan.system,
            fromSpotify: fromSpotify,
            fromSystem: fromSystem,
            spotifyResult: spotifyResult,
            systemResult: systemResult
          };
        });
      }).then(function (result) {
        if (typeof global.hwFetchSystemVolume === 'function') global.hwFetchSystemVolume();
        var spotifyVol = plan.spotify != null ? plan.spotify : AudioWellnessModule.spotifyVolume();
        refreshVolumeUI(spotifyVol, null);
        return result;
      });
    }
  };

  /* ── Recovery Module ── */
  var RecoveryModule = {
    breakRecommendation: function () {
      var prefs = MemoryModule.prefs();
      var fatigue = AudioWellnessModule.fatigueLevel();
      if (fatigue === 'high') {
        if (prefs.audioAutoPilot && prefs.autoRecoveryBreak) {
          return 'Audio budget is high — Auto-Pilot will start a recovery break.';
        }
        return 'Take a full recovery break now — your session audio budget is high.';
      }
      if (FocusModule.state.secsLeft <= 0 && FocusModule.state.phase === 'focus') {
        return 'Focus block complete. A short break helps reset audio fatigue.';
      }
      return 'Take regular breaks to protect long-term listening wellness.';
    },
    triggerEarlyBreak: function (message) {
      if (FocusModule.state.phase !== 'focus') {
        return RecoveryModule.triggerListeningBreak(message);
      }
      clearInterval(FocusModule.state.tick);
      clearInterval(FocusModule.state.observeTick);
      var prefs = MemoryModule.prefs();
      if (prefs.autoPauseOnComplete) {
        Tools.pauseSpotify().then(function (ok) {
          logAutoAction('pause_spotify', 'Paused Spotify — high audio budget', { ok: ok });
        });
      }
      AutoPilotState.lastNote = message || 'Recovery break started by Auto-Pilot.';
      FocusModule.state.lastAutoPilotNote = AutoPilotState.lastNote;
      logAutoAction('recovery_break_start', 'High audio budget — starting recovery break', {});
      startBreakPhase(message, true);
    },
    triggerListeningBreak: function (message) {
      var prefs = MemoryModule.prefs();
      if (prefs.autoPauseOnComplete) {
        Tools.pauseSpotify().then(function (ok) {
          logAutoAction('pause_spotify', 'Paused Spotify — high audio budget', { ok: ok });
        });
      }
      AutoPilotState.lastNote = message || 'Recovery break — give your ears a reset.';
      logAutoAction('recovery_break_start', 'High audio budget during listening', {});
      var overlay = document.getElementById('lpBreakAlert');
      var t = document.getElementById('lpBreakTitle');
      var m = document.getElementById('lpBreakMsg');
      if (overlay && t && m) {
        t.textContent = 'Recovery break — Auto-Pilot';
        m.innerHTML = message ||
          '<strong>Your session audio budget is high.</strong> Take a short break before continuing.';
        overlay.classList.add('show');
      }
      syncAutoPilotUI();
    },
    actions: function () {
      var prefs = MemoryModule.prefs();
      if (!prefs.audioAutoPilot) return [];
      var list = [];
      if (prefs.autoPauseOnComplete) list.push('pause_spotify');
      if (prefs.autoBreakOnComplete) list.push('start_break_timer');
      if (prefs.autoLowerVolume) list.push('lower_volume');
      if (prefs.autoLowerSystemVolume) list.push('lower_system_volume');
      if (prefs.autoRecoveryBreak) list.push('recovery_break');
      return list;
    }
  };

  /* ── Tools (internal actions) ── */
  var Tools = {
    pauseSpotify: function () {
      return fetch('/api/spotify/pause', { method: 'PUT', credentials: 'include' })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    },
    playSpotify: function () {
      return fetch('/api/spotify/play', { method: 'PUT', credentials: 'include' })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    },
    lowerVolume: function (step) {
      var vol = AudioWellnessModule.effectiveVolume();
      if (vol == null) return Promise.resolve(false);
      return MusicModule.setEffectiveVolume(Math.max(20, vol - (step || 10)));
    }
  };

  function logAutoAction(type, detail, meta) {
    var action = {
      type: type,
      at: new Date().toISOString(),
      detail: detail,
      meta: meta || {},
      context: FocusModule.state.phase === 'focus' || FocusModule.state.phase === 'break'
        ? 'focus' : 'listening'
    };
    if (action.context === 'focus') {
      FocusModule.state.autoActions.push(action);
    } else {
      AutoPilotState.actions.push(action);
      MemoryModule.recordAutoPilotAction(action);
    }
    return action;
  }

  function lastAutoPilotNote() {
    return AutoPilotState.lastNote || FocusModule.state.lastAutoPilotNote || null;
  }

  function setAutoPilotNote(text) {
    AutoPilotState.lastNote = text;
    FocusModule.state.lastAutoPilotNote = text;
  }

  function runVolumeAutoPilot(prefs) {
    var hasSystem = AudioWellnessModule.hasSystemVolume();
    var canLowerSpotify = !hasSystem && prefs.autoLowerVolume !== false;
    var canLowerSystem = hasSystem && prefs.autoLowerSystemVolume !== false;
    if ((!canLowerSpotify && !canLowerSystem) || !isListeningActive()) return Promise.resolve();
    if (AutoPilotState.volumeInFlight) return Promise.resolve();
    if (!AudioWellnessModule.volumeNeedsLower()) return Promise.resolve();

    var spotify = AudioWellnessModule.spotifyVolume();
    var system = AudioWellnessModule.systemVolume();
    var cap = AudioWellnessModule.safeVolumeCap();
    var effective = AudioWellnessModule.effectiveVolume();
    var overBy = hasSystem
      ? Math.max(effective != null ? effective - cap : 0, 0)
      : Math.max(
        spotify != null ? spotify - cap : 0,
        effective != null ? effective - cap : 0,
        system != null ? system - cap : 0
      );
    var bypassCooldown = overBy >= 12;
    if (!bypassCooldown && Date.now() - AutoPilotState.lastVolumeAdjust < VOLUME_COOLDOWN_MS) {
      return Promise.resolve();
    }

    if (spotify == null && system == null) {
      return ensurePlaybackFresh().then(function () { runAutoPilot(); });
    }

    var plan = AudioWellnessModule.computeVolumePlan();
    if (!plan) return Promise.resolve();

    AutoPilotState.lastVolumeAdjust = Date.now();
    AutoPilotState.volumeInFlight = true;
    var fromSpotify = spotify;
    var fromSystem = system;

    return MusicModule.applyVolumePlan(plan).then(function (result) {
      AutoPilotState.volumeInFlight = false;
      if (result && result.ok) {
        var parts = [];
        if (plan.spotify != null && fromSpotify != null) {
          logAutoAction('volume_lower', 'Spotify ' + fromSpotify + '% → ' + plan.spotify + '%', {
            from: fromSpotify, to: plan.spotify
          });
          parts.push('Spotify ' + plan.spotify + '%');
        }
        if (plan.system != null && fromSystem != null) {
          logAutoAction('system_volume_lower', 'System ' + fromSystem + '% → ' + plan.system + '%', {
            from: fromSystem, to: plan.system
          });
          parts.push('Mac ' + plan.system + '%');
        }
        if (plan.system != null && plan.spotify == null) {
          setAutoPilotNote('Auto-Pilot set Mac volume to ' + plan.system + '% (Spotify unchanged).');
          if (typeof global.showNotification === 'function') {
            global.showNotification('✦ Auto-Pilot lowered Mac volume to ' + plan.system + '%');
          }
        } else {
          setAutoPilotNote('Auto-Pilot set ' + parts.join(' · ') + '.');
          if (typeof global.showNotification === 'function') {
            global.showNotification('✦ Auto-Pilot lowered volume — ' + parts.join(' · '));
          }
        }
        setTimeout(function () { ensurePlaybackFresh(); }, 1200);
        syncExistingUI();
        syncAutoPilotUI();
        return;
      }
      if (plan.system != null && result && result.systemResult && !result.systemResult.ok) {
        setAutoPilotNote('Auto-Pilot could not change Mac system volume — run HearWise locally on your Mac.');
      } else if (result && result.spotifyResult && result.spotifyResult.status === 403) {
        setAutoPilotNote('Auto-Pilot needs Spotify Premium to move the volume slider remotely.');
      } else if (result && result.spotifyResult && result.spotifyResult.status === 404) {
        setAutoPilotNote('Start playback in the Spotify desktop app — browser player cannot always be controlled.');
      } else if (result && result.spotifyResult && result.spotifyResult.status === 429) {
        setAutoPilotNote('Spotify rate limit — Auto-Pilot will retry shortly.');
      } else {
        setAutoPilotNote('Auto-Pilot could not change volume — check Premium, desktop app, and local server.');
      }
      if (typeof global.showNotification === 'function') {
        global.showNotification('⚠️ Auto-Pilot could not change volume — check Premium & desktop app.');
      }
      syncExistingUI();
      syncAutoPilotUI();
    }).catch(function () {
      AutoPilotState.volumeInFlight = false;
    });
  }

  function runAutoPilot() {
    var prefs = MemoryModule.prefs();
    if (!prefs.audioAutoPilot) return;
    if (FocusModule.state.phase === 'focus' && FocusModule.state.paused) return;
    if (!isListeningActive()) return;

    runVolumeAutoPilot(prefs);

    var risk = AudioWellnessModule.detectRisk();
    var threshold = prefs.recoveryBudgetThreshold || 85;

    if (prefs.autoRecoveryBreak && risk.budgetPct >= threshold && !AutoPilotState.recoveryTriggered) {
      AutoPilotState.recoveryTriggered = true;
      RecoveryModule.triggerEarlyBreak(
        '<strong>Audio budget at ' + risk.budgetPct + '%.</strong> Auto-Pilot started your recovery break — stand up and give your ears a reset.'
      );
    } else if (!prefs.autoRecoveryBreak && risk.budget === 'high') {
      setAutoPilotNote('Audio budget ' + risk.budgetPct + '% — consider a recovery break soon.');
    }
  }

  function uid() {
    return 'orch_' + Date.now().toString(36);
  }

  function fmtTime(secs) {
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setSessionActive(on) {
    global._hwOrchestratorActive = !!on;
    global._hwManualFocusActive = !!on;
  }

  function observeTick() {
    if (FocusModule.state.phase !== 'focus') return;
    var vol = AudioWellnessModule.effectiveVolume();
    var playing = MusicModule.isPlaying();
    FocusModule.stats.samples.push({ t: Date.now(), vol: vol, playing: playing });
    if (vol != null) {
      FocusModule.stats.volSum += vol;
      FocusModule.stats.volCount++;
      FocusModule.stats.peakVol = Math.max(FocusModule.stats.peakVol, vol);
    }
    if (playing) FocusModule.stats.playingMin += 0.25;
    FocusModule.stats.listeningMin = FocusModule.stats.playingMin;
    syncExistingUI();
  }

  function timerTick() {
    if (FocusModule.state.paused) return;
    if (FocusModule.state.secsLeft <= 0) {
      if (FocusModule.state.phase === 'focus') onFocusEnd();
      else if (FocusModule.state.phase === 'break') onBreakEnd();
      return;
    }
    FocusModule.state.secsLeft--;
    syncExistingUI();
  }

  function onFocusEnd() {
    clearInterval(FocusModule.state.tick);
    clearInterval(FocusModule.state.observeTick);
    FocusModule.state.focusCompleted = true;
    var prefs = MemoryModule.prefs();
    if (prefs.audioAutoPilot && prefs.autoPauseOnComplete) {
      Tools.pauseSpotify().then(function (ok) {
        logAutoAction('pause_spotify', 'Paused Spotify at focus end', { ok: ok });
      });
    }
    showSessionSummary('focus');
    if (prefs.audioAutoPilot && prefs.autoBreakOnComplete) {
      logAutoAction('break_timer_start', 'Started recovery break at focus end', {});
      startBreakPhase(null, false);
    } else {
      finalizeSession();
    }
  }

  function onBreakEnd() {
    clearInterval(FocusModule.state.tick);
    var prefs = MemoryModule.prefs();
    if (prefs.audioAutoPilot && prefs.autoPauseOnComplete) {
      Tools.playSpotify().then(function (ok) {
        logAutoAction('spotify_resume', 'Resumed Spotify after break', { ok: ok });
      });
    }
    showSessionSummary('complete');
    finalizeSession();
  }

  function recordBreakTaken(label) {
    FocusModule.state.breaksThisSession = (FocusModule.state.breaksThisSession || 0) + 1;
    MemoryModule.recordBreak();
    if (typeof global.localAwardXp === 'function' && typeof global.getCoachingState === 'function') {
      if (typeof global.hwCompanionOnEvent !== 'function') {
        global.localAwardXp(global.getCoachingState(), BREAK_POINTS, label || 'Recovery break');
      }
    }
    if (typeof global.hwCompanionOnEvent === 'function') {
      global.hwCompanionOnEvent('break_complete', {
        eventId: 'orch_break_' + Date.now() + '_' + FocusModule.state.breaksThisSession
      });
    }
    syncExistingUI();
  }

  function startBreakPhase(customMsg, early) {
    var preset = FocusModule.preset();
    FocusModule.state.phase = 'break';
    FocusModule.state.secsTotal = preset.breakMin * 60;
    FocusModule.state.secsLeft = FocusModule.state.secsTotal;
    FocusModule.state.paused = false;
    clearInterval(FocusModule.state.tick);
    FocusModule.state.tick = setInterval(timerTick, 1000);
    var overlay = document.getElementById('lpBreakAlert');
    var t = document.getElementById('lpBreakTitle');
    var m = document.getElementById('lpBreakMsg');
    recordBreakTaken(early ? 'Auto-Pilot recovery break' : 'Focus break');
    if (overlay && t && m) {
      t.textContent = early ? 'Recovery break — Auto-Pilot' : 'Recovery break';
      m.innerHTML = (customMsg ||
        '<strong>Focus block complete.</strong> Stand up, look away from the screen, and hydrate.') +
        (typeof global.hwCompanionProgression !== 'undefined'
          ? '<br><span style="font-size:12px;color:#059669;margin-top:6px;display:inline-block;">🌸 Ear rests earn Care Tokens for your companion</span>'
          : '');
      overlay.classList.add('show');
    }
    syncExistingUI();
  }

  function formatAutoActionsSummary(actions) {
    if (!actions || !actions.length) return '';
    var labels = {
      volume_lower: 'Spotify volume adjusted',
      system_volume_lower: 'Mac volume adjusted',
      recovery_break_start: 'recovery break',
      pause_spotify: 'Spotify paused',
      break_timer_start: 'break started',
      spotify_resume: 'Spotify resumed'
    };
    var counts = {};
    actions.forEach(function (a) {
      var key = labels[a.type] || a.type;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.keys(counts).map(function (k) {
      return counts[k] > 1 ? k + ' ×' + counts[k] : k;
    }).join(' · ');
  }

  function finalizeSession() {
    var preset = FocusModule.preset();
    var sessionPoints = FocusModule.currentSessionPoints();
    var avgVol = FocusModule.stats.volCount
      ? Math.round(FocusModule.stats.volSum / FocusModule.stats.volCount) : null;
    var actions = (FocusModule.state.autoActions || []).slice();
    var breaks = FocusModule.state.breaksThisSession || 0;
    var record = {
      id: FocusModule.state.sessionId,
      preset: preset.id,
      focusMin: preset.focusMin,
      breakMin: preset.breakMin,
      completedAt: new Date().toISOString(),
      focusScore: sessionPoints,
      focusPoints: sessionPoints,
      breaksTaken: breaks,
      focusCompleted: !!FocusModule.state.focusCompleted,
      avgVolume: avgVol,
      peakVolume: FocusModule.stats.peakVol,
      listeningMin: Math.round(FocusModule.stats.listeningMin * 10) / 10,
      audioBudget: AudioWellnessModule.sessionBudget(),
      musicContext: MusicModule.context(),
      audioAutoPilot: MemoryModule.prefs().audioAutoPilot,
      autoActions: actions
    };
    MemoryModule.recordSession(record);
    var wellness = AudioWellnessModule.wellnessScore();
    MemoryModule.saveWellnessSnapshot({
      date: new Date().toISOString().split('T')[0],
      wellnessScore: wellness,
      focusScore: sessionPoints,
      focusPoints: sessionPoints,
      audioBudget: record.audioBudget
    });
    if (typeof global.localAwardXp === 'function' && typeof global.getCoachingState === 'function') {
      if (FocusModule.state.focusCompleted && typeof global.hwCompanionOnEvent !== 'function') {
        global.localAwardXp(global.getCoachingState(), FOCUS_COMPLETE_POINTS, 'Focus block complete');
      }
    }
    updateProductivityStreak();
    if (FocusModule.state.focusCompleted && typeof global.hwCompanionOnEvent === 'function') {
      global.hwCompanionOnEvent('focus_complete', { eventId: 'focus_' + (FocusModule.state.sessionId || Date.now()) });
    }
    FocusModule.state.phase = 'idle';
    FocusModule.state.paused = false;
    FocusModule.state.secsLeft = 0;
    setSessionActive(false);
    syncExistingUI();
    syncAutoPilotUI();
    if (typeof global.renderPriorityCoach === 'function' && global.st && global.st.profile) {
      global.renderPriorityCoach(global.st.profile, global.st.prediction, global.st.profileId);
    }
  }

  function updateProductivityStreak() {
    if (typeof global.getCoachingState !== 'function' || typeof global.saveCoachingState !== 'function') return;
    var coach = global.getCoachingState();
    var today = new Date().toISOString().split('T')[0];
    if (coach.lastSafeDay === today) return;
    var y = new Date();
    y.setDate(y.getDate() - 1);
    var yKey = y.toISOString().split('T')[0];
    coach.streak = coach.lastSafeDay === yKey ? (coach.streak || 0) + 1 : 1;
    coach.lastSafeDay = today;
    coach.longestStreak = Math.max(coach.longestStreak || 0, coach.streak);
    global.saveCoachingState(coach);
    if (typeof global.updateCoachingUI === 'function') global.updateCoachingUI(coach);
  }

  function showSessionSummary(kind) {
    ensureSummaryModal();
    var modal = document.getElementById('hwOrchSummary');
    var body = document.getElementById('hwOrchSummaryBody');
    var title = document.getElementById('hwOrchSummaryTitle');
    var preset = FocusModule.preset();
    var avg = FocusModule.stats.volCount
      ? Math.round(FocusModule.stats.volSum / FocusModule.stats.volCount) : '—';
    var actions = FocusModule.state.autoActions || [];
    var actionLine = formatAutoActionsSummary(actions);
    if (kind === 'focus') {
      if (title) title.textContent = 'Session summary';
      if (body) {
        body.innerHTML =
          '<strong>' + preset.focusMin + '-min focus complete</strong><br>' +
          'Session points: <strong>+' + FocusModule.currentSessionPoints() + '</strong> ' +
          '(+' + FOCUS_COMPLETE_POINTS + ' complete' +
          ((FocusModule.state.breaksThisSession || 0)
            ? ', +' + ((FocusModule.state.breaksThisSession || 0) * BREAK_POINTS) + ' from ' +
              FocusModule.state.breaksThisSession + ' break' +
              (FocusModule.state.breaksThisSession === 1 ? '' : 's') : '') +
          ') · Total focus points: <strong>' + FocusModule.focusScore() + '</strong>.' +
          (typeof global.hwCompanionProgression !== 'undefined'
            ? (function () {
              var p = global.hwCompanionProgression.getPayload();
              return '<br><span style="font-size:12px;color:#059669;">' + p.emoji + ' ' + p.name + ' gained Harmony XP</span>';
            })()
            : '') +
          (actionLine ? '<br><span style="font-size:12px;color:#7c3aed;">Auto-Pilot: ' + actionLine + '</span>' : '');
      }
    } else {
      if (title) title.textContent = 'Session complete';
      if (body) {
        body.innerHTML = 'Great work. Your wellness trends and AI insights will reflect this session.' +
          (actionLine ? '<br><span style="font-size:12px;color:#7c3aed;">Auto-Pilot actions: ' + actionLine + '</span>' : '');
      }
    }
    if (modal) modal.classList.add('show');
  }

  function ensureSummaryModal() {
    if (document.getElementById('hwOrchSummary')) return;
    var wrap = document.createElement('div');
    wrap.id = 'hwOrchSummary';
    wrap.className = 'hw-orch-summary';
    wrap.innerHTML =
      '<div class="hw-orch-summary-card">' +
        '<h3 id="hwOrchSummaryTitle">Session summary</h3>' +
        '<p id="hwOrchSummaryBody"></p>' +
        '<button type="button" class="hw-orch-summary-btn" onclick="hwOrchestrator.dismissSummary()">Continue</button>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  function syncAutoPilotUI() {
    var prefs = MemoryModule.prefs();
    var statusEl = document.getElementById('hwAutoPilotStatus');
    var toggle = document.getElementById('hwAutoPilotToggle');
    var opts = document.getElementById('hwAutoPilotOptions');
    if (toggle) toggle.classList.toggle('on', !!prefs.audioAutoPilot);
    if (opts) opts.style.display = prefs.audioAutoPilot ? 'block' : 'none';
    if (statusEl) {
      if (prefs.audioAutoPilot) {
        statusEl.style.display = 'block';
        var note = lastAutoPilotNote();
        var spotify = AudioWellnessModule.spotifyVolume();
        var cap = AudioWellnessModule.safeVolumeCap();
        if (FocusModule.state.phase === 'focus' || FocusModule.state.phase === 'break') {
          statusEl.textContent = '✦ ' + (note || ('Auto-Pilot active · safe cap ' + cap + '%'));
        } else if (isListeningActive()) {
          var sysTxt = AudioWellnessModule.hasSystemVolume()
            ? ' · Mac ' + Math.round(AudioWellnessModule.systemVolume()) + '%' : '';
          statusEl.textContent = '✦ ' + (note || ('Auto-Pilot watching · Spotify ' +
            (spotify != null ? Math.round(spotify) + '%' : '—') + sysTxt + ' · cap ' + cap + '%'));
        } else {
          statusEl.textContent = '✦ Audio Auto-Pilot on — active whenever Spotify is playing.';
        }
      } else {
        statusEl.style.display = 'none';
      }
    }
    if (typeof global.hwOrcSyncAutoPilotSettings === 'function') {
      global.hwOrcSyncAutoPilotSettings(prefs);
    }
  }

  function syncExistingUI() {
    var st = FocusModule.state;
    var preset = FocusModule.preset();
    var prefs = MemoryModule.prefs();
    var display = document.getElementById('wpTimerDisplay');
    var ring = document.getElementById('wpTimerRing');
    var btn = document.getElementById('wpTimerStartBtn');
    var impact = document.getElementById('wpMissionImpact');
    var badge = document.getElementById('wpMissionBadge');
    var focusScoreEl = document.getElementById('hwFocusScoreVal');
    var circumf = 213.6;
    var total = st.secsTotal || preset.focusMin * 60;
    var left = st.phase === 'idle' ? preset.focusMin * 60 : st.secsLeft;
    var progress = total > 0 ? left / total : 1;

    if (display) display.textContent = fmtTime(left);
    if (ring) ring.style.strokeDashoffset = circumf * (1 - progress);
    if (badge) {
      badge.textContent = st.phase === 'focus' ? 'Focus' : st.phase === 'break' ? 'Break' : 'Ready';
    }
    if (btn) {
      if (st.phase === 'idle') btn.textContent = '▶ Start focus block';
      else if (st.paused) btn.textContent = '▶ Resume';
      else btn.textContent = '⏸ Pause';
    }
    if (impact && st.phase === 'focus') {
      var rec = RecoveryModule.breakRecommendation();
      var mem = MemoryModule.load();
      var ptsLine = 'Focus points: ' + FocusModule.focusScore() +
        ' (' + (mem.totalFocusSessions || 0) + ' sessions · ' + (mem.totalBreaks || 0) + ' breaks)';
      if (prefs.audioAutoPilot && st.autoActions.length) {
        impact.textContent = ptsLine + ' · Auto-Pilot: ' + st.autoActions.length + ' action' +
          (st.autoActions.length === 1 ? '' : 's') + ' · ' + rec;
      } else {
        impact.textContent = ptsLine + ' · ' + rec;
      }
    } else if (impact && st.phase === 'break') {
      impact.textContent = '☕ Recovery break — protect your listening wellness.';
    }
    if (focusScoreEl) {
      focusScoreEl.textContent = st.phase === 'idle' ? '—' : String(FocusModule.focusScore());
    }
    syncAutoPilotUI();
    if (typeof global.hwCompanionProgression !== 'undefined' && global.hwCompanionProgression.renderUI) {
      global.hwCompanionProgression.renderUI();
    }
  }

  /* ── Orchestrator public API (internal + thin UI hooks) ── */
  var Orchestrator = {
    init: function () {
      var preset = FocusModule.preset();
      FocusModule.state.secsLeft = preset.focusMin * 60;
      FocusModule.state.secsTotal = preset.focusMin * 60;
      syncExistingUI();
      manageAutoPilotLoop();
    },

    selectPreset: function (id) {
      if (FocusModule.state.phase !== 'idle') return;
      if (!PRESETS[id]) return;
      FocusModule.state.presetId = id;
      var preset = FocusModule.preset();
      FocusModule.state.secsLeft = preset.focusMin * 60;
      FocusModule.state.secsTotal = preset.focusMin * 60;
      document.querySelectorAll('.hw-orch-preset').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-preset') === id);
      });
      syncExistingUI();
    },

    toggleSession: function () {
      var st = FocusModule.state;
      if (st.phase === 'idle') {
        st.phase = 'focus';
        st.sessionId = uid();
        st.startedAt = Date.now();
        st.paused = false;
        var preset = FocusModule.preset();
        st.secsTotal = preset.focusMin * 60;
        st.secsLeft = st.secsTotal;
        FocusModule.resetStats();
        setSessionActive(true);
        clearInterval(st.tick);
        clearInterval(st.observeTick);
        st.tick = setInterval(timerTick, 1000);
        var intervalMs = MemoryModule.prefs().audioAutoPilot ? 5000 : 15000;
        st.observeTick = setInterval(observeTick, intervalMs);
        ensurePlaybackFresh().then(function () {
          observeTick();
        });
        syncExistingUI();
        if (typeof global.renderPriorityCoach === 'function' && global.st && global.st.profile) {
          global.renderPriorityCoach(global.st.profile, global.st.prediction, global.st.profileId);
        }
        return;
      }
      st.paused = !st.paused;
      syncExistingUI();
    },

    cancelSession: function () {
      clearInterval(FocusModule.state.tick);
      clearInterval(FocusModule.state.observeTick);
      FocusModule.state.phase = 'idle';
      FocusModule.state.paused = false;
      setSessionActive(false);
      var modal = document.getElementById('hwOrchSummary');
      if (modal) modal.classList.remove('show');
      syncExistingUI();
    },

    dismissSummary: function () {
      var modal = document.getElementById('hwOrchSummary');
      if (modal) modal.classList.remove('show');
    },

    setAutoPilot: function (enabled) {
      var prefs = MemoryModule.prefs();
      prefs.audioAutoPilot = !!enabled;
      MemoryModule.savePrefs(prefs);
      manageAutoPilotLoop();
      syncAutoPilotUI();
      if (typeof global.renderPriorityCoach === 'function' && global.st && global.st.profile) {
        global.renderPriorityCoach(global.st.profile, global.st.prediction, global.st.profileId);
      }
    },

    onPlayback: function () {
      if (!MemoryModule.prefs().audioAutoPilot) return;
      if (isListeningActive()) globalListenTick();
    },

    onVolumeReading: function (spotifyVol, isPlaying) {
      if (!MemoryModule.prefs().audioAutoPilot) return;
      if (!isPlaying) return;
      var prefs = MemoryModule.prefs();
      var cap = AudioWellnessModule.safeVolumeCap();
      var hasSystem = AudioWellnessModule.hasSystemVolume();

      if (spotifyVol != null && global._lastGoodSpotifyPlayback && global._lastGoodSpotifyPlayback.device) {
        global._lastGoodSpotifyPlayback.device.spotify_volume_percent = spotifyVol;
      }

      var effective = spotifyVol != null && typeof global.hwGetEffectiveVolume === 'function'
        ? global.hwGetEffectiveVolume(spotifyVol)
        : (spotifyVol != null ? spotifyVol : null);

      if (hasSystem && prefs.autoLowerSystemVolume !== false) {
        if (effective != null && effective > cap) runAutoPilot();
        return;
      }

      var system = AudioWellnessModule.systemVolume();
      if (spotifyVol == null && system == null) return;
      if ((spotifyVol != null && spotifyVol > cap) ||
          (effective != null && effective > cap) ||
          (system != null && system > cap)) {
        runAutoPilot();
      }
    },

    updatePrefs: function (partial) {
      var prefs = MemoryModule.prefs();
      Object.keys(partial || {}).forEach(function (k) {
        prefs[k] = partial[k];
      });
      MemoryModule.savePrefs(prefs);
      syncAutoPilotUI();
    },

    getPayload: function () {
      var mem = MemoryModule.load();
      var sessions = MemoryModule.sessions();
      var best = MemoryModule.bestFocusHours();
      var prefs = MemoryModule.prefs();
      return {
        phase: FocusModule.state.phase,
        focusScore: FocusModule.focusScore(),
        wellnessScore: AudioWellnessModule.wellnessScore(),
        audioBudget: AudioWellnessModule.sessionBudget(),
        fatigue: AudioWellnessModule.fatigueLevel(),
        musicInsight: MusicModule.insight(),
        recoveryTip: RecoveryModule.breakRecommendation(),
        totalFocusSessions: mem.totalFocusSessions || sessions.length,
        totalFocusMinutes: mem.totalFocusMinutes || 0,
        bestFocusHour: best,
        weeklyInsight: Orchestrator.getWeeklyInsight(),
        audioAutoPilot: prefs.audioAutoPilot,
        safeVolumeCap: AudioWellnessModule.safeVolumeCap(),
        autoActionsThisSession: (FocusModule.state.autoActions || []).length,
        autoPilotActionsTotal: (MemoryModule.load().autopilotActions || 0) + AutoPilotState.actions.length,
        listeningActive: isListeningActive(),
        risk: AudioWellnessModule.detectRisk()
      };
    },

    enrichCoachPlan: function (plan) {
      if (!plan) plan = {};
      var p = Orchestrator.getPayload();
      var prefs = MemoryModule.prefs();
      var extra = [];
      if (p.totalFocusSessions > 0) {
        extra.push({ label: p.totalFocusSessions + ' focus sessions', cls: '' });
      }
      if (prefs.audioAutoPilot) {
        extra.push({ label: 'Auto-Pilot on', cls: 'good' });
        if (isListeningActive()) {
          extra.push({
            label: 'Spotify ' + (AudioWellnessModule.spotifyVolume() || '—') + '%',
            cls: AudioWellnessModule.volumeNeedsLower() ? 'warn' : 'good'
          });
        }
      }
      if (p.phase === 'focus') {
        extra.push({ label: 'Audio budget ' + p.audioBudget + '%', cls: p.audioBudget >= 70 ? 'warn' : 'good' });
        if (prefs.audioAutoPilot && p.autoActionsThisSession > 0) {
          extra.push({ label: p.autoActionsThisSession + ' auto actions', cls: '' });
        }
      }
      plan.chips = (plan.chips || []).concat(extra);
      if (prefs.audioAutoPilot && !plan._orchAutoPilotMerged) {
        var cap = p.safeVolumeCap;
        plan.reason = (plan.reason || '') +
          (plan.reason ? ' ' : '') +
          'Audio Auto-Pilot is active — HearWise manages volume near ' + cap + '% whenever you listen.';
        plan._orchAutoPilotMerged = true;
      }
      if (p.weeklyInsight && !plan._orchMerged) {
        plan.reason = (plan.reason || '') + (plan.reason ? ' ' : '') + p.weeklyInsight;
        plan._orchMerged = true;
      }
      if (typeof global.hwCompanionProgression !== 'undefined' && global.hwCompanionProgression.enrichCoachPlan) {
        plan = global.hwCompanionProgression.enrichCoachPlan(plan);
      }
      return plan;
    },

    getWeeklyInsight: function () {
      var sessions = MemoryModule.sessions();
      var weekAgo = Date.now() - 7 * 86400000;
      var recent = sessions.filter(function (s) {
        return new Date(s.completedAt).getTime() >= weekAgo;
      });
      if (!recent.length) {
        return 'Start a focus block to connect productivity with your listening wellness trends.';
      }
      var avgPoints = Math.round(recent.reduce(function (a, s) {
        return a + (s.focusPoints != null ? s.focusPoints : (s.focusScore || 0));
      }, 0) / recent.length);
      var totalBreaks = recent.reduce(function (a, s) { return a + (s.breaksTaken || 0); }, 0);
      var autoSessions = recent.filter(function (s) { return s.audioAutoPilot && s.autoActions && s.autoActions.length; });
      var autoTxt = autoSessions.length
        ? ' Auto-Pilot took action in ' + autoSessions.length + ' session' + (autoSessions.length === 1 ? '' : 's') + '.'
        : '';
      var best = MemoryModule.bestFocusHours();
      var hourTxt = best ? ' You focus most around ' + best.hour + ':00.' : '';
      return 'This week: ' + recent.length + ' completed sessions · ' + totalBreaks +
        ' breaks · avg ' + avgPoints + ' pts/session.' + autoTxt + hourTxt;
    },

    getSessions: MemoryModule.sessions,
    getPrefs: MemoryModule.prefs,
    savePrefs: MemoryModule.savePrefs,
    isActive: function () {
      return FocusModule.state.phase !== 'idle';
    },
    syncSettingsUI: syncAutoPilotUI
  };

  global.hwOrchestrator = Orchestrator;
  global.hwOrcSelectPreset = function (id) { Orchestrator.selectPreset(id); };
  global.hwOrcSessionToggle = function () { Orchestrator.toggleSession(); };
  global.hwOrcSessionCancel = function () { Orchestrator.cancelSession(); };
  global.hwOrcToggleAutoPilot = function () {
    var prefs = MemoryModule.prefs();
    Orchestrator.setAutoPilot(!prefs.audioAutoPilot);
  };
  global.hwOrcSaveAutoPilotPrefs = function () {
    var prefs = MemoryModule.prefs();
    var capEl = document.getElementById('hwAutoPilotSafeCap');
    var prefEl = document.getElementById('hwAutoPilotPreferred');
    var threshEl = document.getElementById('hwAutoPilotBudgetThreshold');
    if (capEl && capEl.value) prefs.safeVolumeMax = parseInt(capEl.value, 10);
    if (prefEl && prefEl.value) prefs.preferredVolume = parseInt(prefEl.value, 10);
    if (threshEl && threshEl.value) prefs.recoveryBudgetThreshold = parseInt(threshEl.value, 10);
    ['hwAutoPilotLowerVol', 'hwAutoPilotLowerSystem', 'hwAutoPilotRecovery', 'hwAutoPilotPauseEnd', 'hwAutoPilotBreakEnd'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (id === 'hwAutoPilotLowerVol') prefs.autoLowerVolume = el.classList.contains('on');
      if (id === 'hwAutoPilotLowerSystem') prefs.autoLowerSystemVolume = el.classList.contains('on');
      if (id === 'hwAutoPilotRecovery') prefs.autoRecoveryBreak = el.classList.contains('on');
      if (id === 'hwAutoPilotPauseEnd') prefs.autoPauseOnComplete = el.classList.contains('on');
      if (id === 'hwAutoPilotBreakEnd') prefs.autoBreakOnComplete = el.classList.contains('on');
    });
    MemoryModule.savePrefs(prefs);
    manageAutoPilotLoop();
    syncAutoPilotUI();
  };
  global.hwOrcSyncAutoPilotSettings = function (prefs) {
    prefs = prefs || MemoryModule.prefs();
    var capEl = document.getElementById('hwAutoPilotSafeCap');
    var prefEl = document.getElementById('hwAutoPilotPreferred');
    var threshEl = document.getElementById('hwAutoPilotBudgetThreshold');
    var cap = prefs.safeVolumeMax != null ? prefs.safeVolumeMax : AudioWellnessModule.safeVolumeCap();
    var preferred = prefs.preferredVolume != null ? prefs.preferredVolume : AudioWellnessModule.preferredVolume();
    if (capEl) capEl.value = cap;
    if (prefEl) prefEl.value = preferred;
    if (threshEl) threshEl.value = prefs.recoveryBudgetThreshold || 85;
    ['hwAutoPilotLowerVol', 'hwAutoPilotLowerSystem', 'hwAutoPilotRecovery', 'hwAutoPilotPauseEnd', 'hwAutoPilotBreakEnd'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var on = true;
      if (id === 'hwAutoPilotLowerVol') on = prefs.autoLowerVolume;
      if (id === 'hwAutoPilotLowerSystem') on = prefs.autoLowerSystemVolume;
      if (id === 'hwAutoPilotRecovery') on = prefs.autoRecoveryBreak;
      if (id === 'hwAutoPilotPauseEnd') on = prefs.autoPauseOnComplete;
      if (id === 'hwAutoPilotBreakEnd') on = prefs.autoBreakOnComplete;
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var spotifyRow = document.getElementById('hwAutoPilotLowerVolRow');
    if (spotifyRow) spotifyRow.style.display = global._systemVolumeAvailable ? 'none' : '';
  };
  global.hwOrcToggleAutoPilotSub = function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('on');
    el.setAttribute('aria-pressed', el.classList.contains('on') ? 'true' : 'false');
    hwOrcSaveAutoPilotPrefs();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Orchestrator.init);
  } else {
    setTimeout(Orchestrator.init, 80);
  }
})(typeof window !== 'undefined' ? window : global);
