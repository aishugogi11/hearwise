(function () {
  'use strict';

  const STORAGE = {
    timer: 'hearwise_public_timer_v1',
    history: 'hearwise_public_history_v1',
    volume: 'hearwise_public_volume_v1'
  };
  const MAX_HISTORY = 100;
  const CIRCUMFERENCE = 2 * Math.PI * 106;

  const els = {
    modeButtons: Array.from(document.querySelectorAll('.mode-button')),
    listenPresets: document.getElementById('listenPresets'),
    breakPresets: document.getElementById('breakPresets'),
    timerStatus: document.getElementById('timerStatus'),
    timerTime: document.getElementById('timerTime'),
    ringProgress: document.getElementById('ringProgress'),
    startPauseButton: document.getElementById('startPauseButton'),
    resetButton: document.getElementById('resetButton'),
    volumeSetting: document.getElementById('volumeSetting'),
    todayDate: document.getElementById('todayDate'),
    todayMinutes: document.getElementById('todayMinutes'),
    todaySessions: document.getElementById('todaySessions'),
    todayBreaks: document.getElementById('todayBreaks'),
    emptyState: document.getElementById('emptyState'),
    historyList: document.getElementById('historyList'),
    clearHistoryButton: document.getElementById('clearHistoryButton'),
    privacyButton: document.getElementById('privacyButton'),
    privacyDialog: document.getElementById('privacyDialog'),
    toast: document.getElementById('toast')
  };

  let timer = loadTimer();
  let history = loadHistory();
  let intervalId = null;
  let toastId = null;
  let audioContext = null;

  function defaultTimer(mode = 'listen') {
    const durationSec = mode === 'listen' ? 25 * 60 : 5 * 60;
    return {
      mode,
      status: 'idle',
      durationSec,
      remainingSec: durationSec,
      runStartedAt: null,
      startedAt: null
    };
  }

  function safeParse(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function loadTimer() {
    const saved = safeParse(STORAGE.timer, null);
    if (!saved || !['listen', 'break'].includes(saved.mode)) return defaultTimer();
    if (!['idle', 'running', 'paused'].includes(saved.status)) return defaultTimer(saved.mode);

    const durationSec = Math.max(60, Number(saved.durationSec) || 1500);
    const restored = {
      mode: saved.mode,
      status: saved.status,
      durationSec,
      remainingSec: Math.max(0, Math.min(durationSec, Number(saved.remainingSec) || durationSec)),
      runStartedAt: Number(saved.runStartedAt) || null,
      startedAt: Number(saved.startedAt) || null
    };

    if (restored.status === 'running' && restored.runStartedAt) {
      const elapsed = Math.floor((Date.now() - restored.runStartedAt) / 1000);
      restored.remainingSec = Math.max(0, restored.remainingSec - elapsed);
      restored.runStartedAt = Date.now();
    }
    return restored;
  }

  function loadHistory() {
    const saved = safeParse(STORAGE.history, []);
    if (!Array.isArray(saved)) return [];
    return saved.filter(function (entry) {
      return entry && ['listen', 'break'].includes(entry.type) &&
        Number.isFinite(Number(entry.completedAt)) && Number(entry.durationSec) > 0;
    }).slice(0, MAX_HISTORY);
  }

  function saveTimer() {
    try {
      localStorage.setItem(STORAGE.timer, JSON.stringify(timer));
    } catch (_) {
      showToast('Timer is running, but this browser could not save it.');
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE.history, JSON.stringify(history));
    } catch (_) {
      showToast('Session finished, but history could not be saved.');
    }
  }

  function localDayKey(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getRemainingSeconds() {
    if (timer.status !== 'running' || !timer.runStartedAt) return timer.remainingSec;
    const elapsed = Math.floor((Date.now() - timer.runStartedAt) / 1000);
    return Math.max(0, timer.remainingSec - elapsed);
  }

  function settleElapsedTime() {
    timer.remainingSec = getRemainingSeconds();
    timer.runStartedAt = null;
  }

  function setMode(mode) {
    if (mode === timer.mode) return;
    if (timer.status !== 'idle' && timer.remainingSec < timer.durationSec) {
      const confirmed = window.confirm('Switch modes and reset the current timer?');
      if (!confirmed) return;
    }
    stopInterval();
    timer = defaultTimer(mode);
    saveTimer();
    render();
  }

  function setDuration(minutes) {
    if (timer.status === 'running') return;
    const durationSec = Number(minutes) * 60;
    timer.durationSec = durationSec;
    timer.remainingSec = durationSec;
    timer.status = 'idle';
    timer.startedAt = null;
    timer.runStartedAt = null;
    saveTimer();
    render();
  }

  function startOrPause() {
    unlockAudio();
    if (timer.status === 'running') {
      settleElapsedTime();
      timer.status = 'paused';
      stopInterval();
      saveTimer();
      render();
      return;
    }

    if (timer.remainingSec <= 0) {
      timer.remainingSec = timer.durationSec;
      timer.status = 'idle';
    }

    if (!timer.startedAt) timer.startedAt = Date.now();
    timer.runStartedAt = Date.now();
    timer.status = 'running';
    saveTimer();
    startInterval();
    render();
  }

  function resetTimer() {
    if (timer.status !== 'idle' || timer.remainingSec !== timer.durationSec) {
      const confirmed = window.confirm('Reset this timer? The unfinished block will not be saved.');
      if (!confirmed) return;
    }
    stopInterval();
    const mode = timer.mode;
    const durationSec = timer.durationSec;
    timer = defaultTimer(mode);
    timer.durationSec = durationSec;
    timer.remainingSec = durationSec;
    saveTimer();
    render();
  }

  function completeTimer() {
    stopInterval();
    const completedMode = timer.mode;
    const completedDuration = timer.durationSec;
    const volume = completedMode === 'listen' ? els.volumeSetting.value : 'not-set';

    history.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: completedMode,
      durationSec: completedDuration,
      completedAt: Date.now(),
      volume
    });
    history = history.slice(0, MAX_HISTORY);
    saveHistory();
    playCompletionSound();

    const nextMode = completedMode === 'listen' ? 'break' : 'listen';
    timer = defaultTimer(nextMode);
    saveTimer();
    render();

    if (completedMode === 'listen') {
      showToast('Listening block complete. Time for a short break.');
    } else {
      showToast('Break complete. Start another block when you are ready.');
    }
  }

  function tick() {
    const remaining = getRemainingSeconds();
    if (remaining <= 0) {
      timer.remainingSec = 0;
      completeTimer();
      return;
    }
    renderClock(remaining);
    if (remaining % 5 === 0) {
      settleElapsedTime();
      timer.runStartedAt = Date.now();
      saveTimer();
    }
  }

  function startInterval() {
    stopInterval();
    intervalId = window.setInterval(tick, 250);
  }

  function stopInterval() {
    if (intervalId) window.clearInterval(intervalId);
    intervalId = null;
  }

  function renderClock(remaining) {
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    els.timerTime.textContent = display;
    els.timerTime.setAttribute('aria-label', `${minutes} minutes ${seconds} seconds remaining`);

    const progress = timer.durationSec ? remaining / timer.durationSec : 0;
    els.ringProgress.style.strokeDasharray = String(CIRCUMFERENCE);
    els.ringProgress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progress));
    document.title = timer.status === 'running' ? `${display} · HearWise` : 'HearWise — Listening Timer';
  }

  function renderTimerControls() {
    document.body.classList.toggle('break-mode', timer.mode === 'break');
    els.modeButtons.forEach(function (button) {
      button.classList.toggle('active', button.dataset.mode === timer.mode);
      button.setAttribute('aria-pressed', String(button.dataset.mode === timer.mode));
    });
    els.listenPresets.classList.toggle('hidden', timer.mode !== 'listen');
    els.breakPresets.classList.toggle('hidden', timer.mode !== 'break');

    const activePresets = timer.mode === 'listen' ? els.listenPresets : els.breakPresets;
    activePresets.querySelectorAll('.preset').forEach(function (button) {
      button.classList.toggle('active', Number(button.dataset.minutes) * 60 === timer.durationSec);
      button.disabled = timer.status === 'running';
    });

    if (timer.status === 'running') {
      els.timerStatus.textContent = timer.mode === 'listen' ? 'Listening block in progress' : 'Break in progress';
      els.startPauseButton.textContent = 'Pause';
    } else if (timer.status === 'paused') {
      els.timerStatus.textContent = 'Paused';
      els.startPauseButton.textContent = 'Resume';
    } else {
      els.timerStatus.textContent = timer.mode === 'listen' ? 'Ready when you are' : 'Give your ears a quiet moment';
      els.startPauseButton.textContent = timer.mode === 'listen' ? 'Start listening' : 'Start break';
    }
  }

  function renderStats() {
    const today = localDayKey(Date.now());
    const todayEntries = history.filter(entry => localDayKey(entry.completedAt) === today);
    const listenedSeconds = todayEntries
      .filter(entry => entry.type === 'listen')
      .reduce((total, entry) => total + Number(entry.durationSec), 0);
    els.todayMinutes.textContent = String(Math.round(listenedSeconds / 60));
    els.todaySessions.textContent = String(todayEntries.filter(entry => entry.type === 'listen').length);
    els.todayBreaks.textContent = String(todayEntries.filter(entry => entry.type === 'break').length);
    els.todayDate.textContent = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric'
    }).format(new Date());
  }

  function renderHistory() {
    els.emptyState.classList.toggle('hidden', history.length > 0);
    els.historyList.replaceChildren();
    history.slice(0, 12).forEach(function (entry) {
      const item = document.createElement('li');
      item.className = `history-item ${entry.type}`;

      const icon = document.createElement('span');
      icon.className = 'history-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = entry.type === 'listen' ? '♪' : '☕';

      const copy = document.createElement('div');
      copy.className = 'history-copy';
      const title = document.createElement('strong');
      title.textContent = entry.type === 'listen' ? 'Listening session' : 'Quiet break';
      const details = document.createElement('span');
      const volumeText = entry.type === 'listen' && entry.volume && entry.volume !== 'not-set'
        ? ` · ${entry.volume[0].toUpperCase()}${entry.volume.slice(1)} volume`
        : '';
      details.textContent = `${Math.round(entry.durationSec / 60)} minutes${volumeText}`;
      copy.append(title, details);

      const meta = document.createElement('time');
      meta.className = 'history-meta';
      meta.dateTime = new Date(entry.completedAt).toISOString();
      meta.textContent = formatHistoryDate(entry.completedAt);

      item.append(icon, copy, meta);
      els.historyList.append(item);
    });
  }

  function formatHistoryDate(timestamp) {
    const date = new Date(timestamp);
    const sameDay = localDayKey(timestamp) === localDayKey(Date.now());
    return new Intl.DateTimeFormat(undefined, sameDay
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric' }
    ).format(date);
  }

  function render() {
    renderClock(getRemainingSeconds());
    renderTimerControls();
    renderStats();
    renderHistory();
  }

  function clearHistory() {
    if (!history.length) {
      showToast('There is no history to clear.');
      return;
    }
    if (!window.confirm('Delete all completed session history from this browser?')) return;
    history = [];
    saveHistory();
    render();
    showToast('Session history cleared.');
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    if (toastId) window.clearTimeout(toastId);
    toastId = window.setTimeout(function () {
      els.toast.classList.remove('show');
    }, 3600);
  }

  function unlockAudio() {
    if (audioContext) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    try {
      audioContext = new AudioCtx();
    } catch (_) {
      audioContext = null;
    }
  }

  function playCompletionSound() {
    if (!audioContext) return;
    try {
      const now = audioContext.currentTime;
      [0, 0.22].forEach(function (delay, index) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = index === 0 ? 523.25 : 659.25;
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.16, now + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.35);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now + delay);
        oscillator.stop(now + delay + 0.38);
      });
    } catch (_) {
      // Audio is optional; timer completion still works.
    }
  }

  els.modeButtons.forEach(function (button) {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });

  document.querySelectorAll('.preset').forEach(function (button) {
    button.addEventListener('click', () => setDuration(button.dataset.minutes));
  });

  els.startPauseButton.addEventListener('click', startOrPause);
  els.resetButton.addEventListener('click', resetTimer);
  els.clearHistoryButton.addEventListener('click', clearHistory);
  els.privacyButton.addEventListener('click', function () {
    if (typeof els.privacyDialog.showModal === 'function') els.privacyDialog.showModal();
  });

  els.volumeSetting.value = localStorage.getItem(STORAGE.volume) || 'not-set';
  els.volumeSetting.addEventListener('change', function () {
    try {
      localStorage.setItem(STORAGE.volume, els.volumeSetting.value);
    } catch (_) {
      // The current selection still works for this page view.
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && timer.status === 'running') tick();
  });

  window.addEventListener('beforeunload', function () {
    if (timer.status === 'running') {
      settleElapsedTime();
      timer.runStartedAt = Date.now();
      saveTimer();
    }
  });

  if (timer.status === 'running') {
    if (timer.remainingSec <= 0) {
      completeTimer();
    } else {
      startInterval();
    }
  }
  render();
}());
