(function (global) {
  'use strict';

  var STORAGE_KEY = 'hearwise_manual_timer_v1';
  var intervalId = null;

  var timer = defaultTimer();

  function defaultTimer(mode) {
    mode = mode || 'listen';
    var durationSec = mode === 'listen' ? 25 * 60 : 5 * 60;
    return {
      mode: mode,
      status: 'idle',
      durationSec: durationSec,
      remainingSec: durationSec,
      runStartedAt: null
    };
  }

  function els() {
    return {
      overlay: document.getElementById('hwManualTimerOverlay'),
      card: document.getElementById('hwManualTimerCard'),
      status: document.getElementById('hwManualTimerStatus'),
      display: document.getElementById('hwManualTimerDisplay'),
      startBtn: document.getElementById('hwManualTimerStartBtn'),
      listenPresets: document.getElementById('hwManualListenPresets'),
      breakPresets: document.getElementById('hwManualBreakPresets'),
      modeButtons: Array.from(document.querySelectorAll('.hw-manual-timer-mode'))
    };
  }

  function saveTimer() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(timer));
    } catch (_) { /* ignore */ }
  }

  function loadTimer() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultTimer();
      var saved = JSON.parse(raw);
      if (!saved || !['listen', 'break'].includes(saved.mode)) return defaultTimer();
      var durationSec = Math.max(60, Number(saved.durationSec) || 1500);
      return {
        mode: saved.mode,
        status: 'idle',
        durationSec: durationSec,
        remainingSec: durationSec,
        runStartedAt: null
      };
    } catch (_) {
      return defaultTimer();
    }
  }

  function getRemainingSeconds() {
    if (timer.status !== 'running' || !timer.runStartedAt) return timer.remainingSec;
    var elapsed = Math.floor((Date.now() - timer.runStartedAt) / 1000);
    return Math.max(0, timer.remainingSec - elapsed);
  }

  function settleElapsedTime() {
    timer.remainingSec = getRemainingSeconds();
    timer.runStartedAt = null;
  }

  function stopInterval() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }

  function formatTime(secs) {
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function render() {
    var ui = els();
    if (!ui.overlay) return;

    var remaining = getRemainingSeconds();
    if (ui.display) ui.display.textContent = formatTime(remaining);

    if (ui.card) ui.card.classList.toggle('break-mode', timer.mode === 'break');

    ui.modeButtons.forEach(function (btn) {
      var on = btn.dataset.mode === timer.mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (ui.listenPresets) ui.listenPresets.hidden = timer.mode !== 'listen';
    if (ui.breakPresets) ui.breakPresets.hidden = timer.mode !== 'break';

    var activePresets = timer.mode === 'listen' ? ui.listenPresets : ui.breakPresets;
    if (activePresets) {
      activePresets.querySelectorAll('.hw-manual-timer-preset').forEach(function (btn) {
        btn.classList.toggle('active', Number(btn.dataset.minutes) * 60 === timer.durationSec);
        btn.disabled = timer.status === 'running';
      });
    }

    if (ui.status && ui.startBtn) {
      if (timer.status === 'running') {
        ui.status.textContent = timer.mode === 'listen' ? 'Listening block in progress' : 'Break in progress';
        ui.startBtn.textContent = 'Pause';
      } else if (timer.status === 'paused') {
        ui.status.textContent = 'Paused';
        ui.startBtn.textContent = 'Resume';
      } else if (timer.status === 'armed') {
        ui.status.textContent = timer.mode === 'listen'
          ? 'Start your music, then tap Start below'
          : 'Find a quiet spot, then tap Start below';
        ui.startBtn.textContent = timer.mode === 'listen' ? 'Start listening' : 'Start break';
      } else {
        ui.status.textContent = timer.mode === 'listen'
          ? 'Pick a duration, then tap Ready to start'
          : 'Pick a break length, then tap Ready to start';
        ui.startBtn.textContent = 'Ready to start';
      }
    }
  }

  function tick() {
    if (getRemainingSeconds() <= 0) {
      completeTimer();
      return;
    }
    render();
  }

  function startInterval() {
    stopInterval();
    intervalId = setInterval(tick, 250);
  }

  function completeTimer() {
    stopInterval();
    var completedMode = timer.mode;
    timer = defaultTimer(completedMode === 'listen' ? 'break' : 'listen');
    saveTimer();
    render();
    if (typeof global.showXpToast === 'function') {
      global.showXpToast(10, completedMode === 'listen' ? 'Listening block complete — time for a break' : 'Break complete');
    }
  }

  function setMode(mode) {
    if (mode === timer.mode) return;
    if (timer.status === 'running') return;
    timer = defaultTimer(mode);
    saveTimer();
    render();
  }

  function setDuration(minutes) {
    if (timer.status === 'running') return;
    var durationSec = Number(minutes) * 60;
    timer.durationSec = durationSec;
    timer.remainingSec = durationSec;
    timer.status = 'idle';
    timer.runStartedAt = null;
    saveTimer();
    render();
  }

  function startOrPause() {
    if (timer.status === 'running') {
      settleElapsedTime();
      timer.status = 'paused';
      stopInterval();
      saveTimer();
      render();
      return;
    }

    if (timer.status === 'idle') {
      timer.status = 'armed';
      saveTimer();
      render();
      return;
    }

    if (timer.remainingSec <= 0) {
      timer.remainingSec = timer.durationSec;
      timer.status = 'armed';
    }

    timer.runStartedAt = Date.now();
    timer.status = 'running';
    saveTimer();
    startInterval();
    render();
  }

  function resetTimer() {
    stopInterval();
    var mode = timer.mode;
    var durationSec = timer.durationSec;
    timer = defaultTimer(mode);
    timer.durationSec = durationSec;
    timer.remainingSec = durationSec;
    saveTimer();
    render();
  }

  function bindEvents() {
    var ui = els();
    if (!ui.overlay) return;

    ui.modeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.dataset.mode); });
    });

    document.querySelectorAll('#hwManualListenPresets .hw-manual-timer-preset, #hwManualBreakPresets .hw-manual-timer-preset')
      .forEach(function (btn) {
        btn.addEventListener('click', function () { setDuration(btn.dataset.minutes); });
      });

    if (ui.startBtn) ui.startBtn.addEventListener('click', startOrPause);

    var resetBtn = document.getElementById('hwManualTimerResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetTimer);

    var closeBtn = document.getElementById('hwManualTimerCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeManualTimer);

    ui.overlay.addEventListener('click', function (event) {
      if (event.target === ui.overlay) closeManualTimer();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && ui.overlay.classList.contains('open')) closeManualTimer();
    });
  }

  function openManualTimer() {
    var ui = els();
    if (!ui.overlay) return;
    timer = loadTimer();
    ui.overlay.classList.add('open');
    ui.overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    render();
  }

  function closeManualTimer() {
    var ui = els();
    if (!ui.overlay) return;
    if (timer.status === 'running') settleElapsedTime();
    saveTimer();
    ui.overlay.classList.remove('open');
    ui.overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function init() {
    timer = loadTimer();
    bindEvents();
    render();
  }

  global.hwOpenManualTimer = openManualTimer;
  global.hwCloseManualTimer = closeManualTimer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : global);
