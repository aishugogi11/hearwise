(function () {
  'use strict';

  var FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfT1Wac7l2h7MgTdxdBo2o07FyA8cSxYdLQ_AXuZQSHFBgsCA/viewform';
  var STORAGE_KEY = 'hearwise_feedback_widget_v1';

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function writeState(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_) {
      /* ignore */
    }
  }

  function init() {
    var root = document.getElementById('hwFeedbackWidget');
    if (!root) return;

    var panel = document.getElementById('hwFeedbackPanel');
    var fab = document.getElementById('hwFeedbackFab');
    var closeBtn = document.getElementById('hwFeedbackClose');
    var laterBtn = document.getElementById('hwFeedbackLater');
    var cta = document.getElementById('hwFeedbackCta');
    if (!panel || !fab) return;

    if (cta) cta.href = FORM_URL;

    var state = readState();
    if (state.hidden) {
      root.style.display = 'none';
      return;
    }

    function setOpen(open) {
      panel.hidden = !open;
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
      fab.classList.toggle('pulse', !open && !state.openedOnce);
    }

    function dismissWidget() {
      writeState({ hidden: true, openedOnce: true });
      root.style.display = 'none';
    }

    function markOpened() {
      if (state.openedOnce) return;
      state.openedOnce = true;
      writeState(state);
      fab.classList.remove('pulse');
    }

    fab.addEventListener('click', function () {
      var willOpen = panel.hidden;
      setOpen(willOpen);
      if (willOpen) markOpened();
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        setOpen(false);
      });
    }

    if (laterBtn) {
      laterBtn.addEventListener('click', function () {
        dismissWidget();
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !panel.hidden) setOpen(false);
    });

    document.addEventListener('click', function (event) {
      if (panel.hidden) return;
      if (root.contains(event.target)) return;
      setOpen(false);
    });

    if (!state.openedOnce) {
      fab.classList.add('pulse');
      window.setTimeout(function () {
        if (root.style.display === 'none') return;
        if (!state.openedOnce && panel.hidden) {
          setOpen(true);
          markOpened();
        }
      }, 5000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
