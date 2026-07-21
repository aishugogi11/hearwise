(function () {
  'use strict';

  const STORAGE = {
    history: 'hearwise_public_history_v1'
  };
  const MAX_HISTORY = 100;

  const els = {
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

  let history = loadHistory();
  let toastId = null;

  function safeParse(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function loadHistory() {
    const saved = safeParse(STORAGE.history, []);
    if (!Array.isArray(saved)) return [];
    return saved.filter(function (entry) {
      return entry && ['listen', 'break'].includes(entry.type) &&
        Number.isFinite(Number(entry.completedAt)) && Number(entry.durationSec) > 0;
    }).slice(0, MAX_HISTORY);
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE.history, JSON.stringify(history));
    } catch (_) {
      showToast('History could not be saved.');
    }
  }

  function localDayKey(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function renderStats() {
    if (!els.todayMinutes) return;
    const today = localDayKey(Date.now());
    const todayEntries = history.filter(entry => localDayKey(entry.completedAt) === today);
    const listenedSeconds = todayEntries
      .filter(entry => entry.type === 'listen')
      .reduce((total, entry) => total + Number(entry.durationSec), 0);
    els.todayMinutes.textContent = String(Math.round(listenedSeconds / 60));
    els.todaySessions.textContent = String(todayEntries.filter(entry => entry.type === 'listen').length);
    els.todayBreaks.textContent = String(todayEntries.filter(entry => entry.type === 'break').length);
    if (els.todayDate) {
      els.todayDate.textContent = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric'
      }).format(new Date());
    }
  }

  function renderHistory() {
    if (!els.historyList) return;
    if (els.emptyState) els.emptyState.classList.toggle('hidden', history.length > 0);
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
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    if (toastId) window.clearTimeout(toastId);
    toastId = window.setTimeout(function () {
      els.toast.classList.remove('show');
    }, 3600);
  }

  if (els.clearHistoryButton) els.clearHistoryButton.addEventListener('click', clearHistory);
  if (els.privacyButton && els.privacyDialog) {
    els.privacyButton.addEventListener('click', function () {
      if (typeof els.privacyDialog.showModal === 'function') els.privacyDialog.showModal();
    });
  }

  render();
}());
