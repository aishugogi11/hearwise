/**
 * HearWise V1 Beta — retention-focused mode (enhance, not redesign).
 * Hides non-daily features, simplifies onboarding, quest-first streaks.
 */
(function (global) {
  'use strict';

  var FIRST_REST_KEY = 'hearwise_first_ear_rest_done';
  var BETA_ONBOARD_KEY = 'hearwise_beta_v1_onboarded';
  var QUEST_STREAK_KEY = 'hearwise_quest_streak_awarded';

  function isBeta() {
    if (global.hwAppConfig && global.hwAppConfig.betaMode === false) return false;
    return true;
  }

  function todayKey() {
    return new Date().toISOString().split('T')[0];
  }

  function ensureMinimalProfile() {
    if (typeof global.getUserProfile !== 'function') return;
    var p = global.getUserProfile();
    if (p && p.age && p.headphoneType) return;
    p = p || {};
    if (!p.age) p.age = 20;
    if (!p.headphoneType) p.headphoneType = 'earbuds';
    if (!p.onboardedAt) p.onboardedAt = new Date().toISOString();
    if (typeof global.applyUserProfileToApp === 'function') {
      global.applyUserProfileToApp(p);
    } else {
      try { localStorage.setItem('hearwise_user_profile', JSON.stringify(p)); } catch (e) { /* ignore */ }
    }
  }

  function needsUserProfileSetupBeta() {
    if (!isBeta()) return null;
    ensureMinimalProfile();
    return false;
  }

  function needsMusicGenreSurveyBeta() {
    if (!isBeta()) return null;
    try {
      if (localStorage.getItem(FIRST_REST_KEY) === '1') {
        if (typeof global.needsMusicGenreSurvey === 'function') {
          return global.__hwOrigNeedsMusicSurvey
            ? global.__hwOrigNeedsMusicSurvey()
            : false;
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function markFirstEarRestDone() {
    try { localStorage.setItem(FIRST_REST_KEY, '1'); } catch (e) { /* ignore */ }
  }

  function applyBetaOnboardingCopy() {
    var sub = document.getElementById('spotifyConnectSubtext');
    if (sub) {
      sub.textContent = 'Connect Spotify to unlock today\'s quest and safe listening sprints.';
    }
    var steps = document.querySelectorAll('#spotifyConnectView .hw-beta-step-text');
    var copy = [
      'Connect your Spotify account',
      'Accept today\'s quest on Home',
      'Complete one sprint + ear rest in Recovery Tracker'
    ];
    steps.forEach(function (el, i) {
      if (copy[i]) el.textContent = copy[i];
    });
    var title = document.getElementById('dashboardHeaderTitle');
    if (title) title.textContent = 'Your daily listening companion';
    var headerSub = document.getElementById('dashboardHeaderSub');
    if (headerSub) {
      headerSub.textContent = 'Finish today\'s quest to protect your ears while you listen.';
    }
  }

  function applyBetaUI() {
    if (!isBeta()) {
      document.documentElement.removeAttribute('data-hw-beta');
      return;
    }
    document.documentElement.setAttribute('data-hw-beta', '1');

    var stack = document.getElementById('gamifyStack');
    var bar = document.getElementById('spotifyPlanBar');
    if (stack && bar && bar.parentNode !== stack) {
      stack.insertBefore(bar, stack.firstChild);
      bar.classList.add('visible');
    }

    var auraCard = document.getElementById('hwBetaAuraCard');
    if (auraCard) auraCard.style.display = 'none';

    var fab = document.getElementById('auraCoachFab');
    if (fab) fab.style.display = 'none';

    applyBetaOnboardingCopy();
    simplifyQuestCopy();
    updateBetaAuraCard();
  }

  function simplifyQuestCopy() {
    var target = document.getElementById('chTarget');
    if (target && !target.dataset.betaCopy) {
      target.dataset.betaCopy = '1';
      target.textContent = 'Complete 1 safe-listening sprint and 1 ear rest in Recovery Tracker.';
    }
    var title = document.getElementById('chTitle');
    if (title) title.textContent = "Today's Quest";
    var cta = document.getElementById('chCtaText');
    if (cta && !_challengeAccepted()) cta.textContent = 'Start today\'s quest';
  }

  function _challengeAccepted() {
    return typeof global.hwIsQuestActive === 'function' && global.hwIsQuestActive();
  }

  function ensureQuestActive() {
    if (!isBeta() || typeof global.challengeHandleAction !== 'function') return;
    if (_challengeAccepted()) return;
    if (typeof global.renderHomeEnhancements === 'function') {
      global.renderHomeEnhancements();
    }
    setTimeout(function () {
      if (!_challengeAccepted()) global.challengeHandleAction();
    }, 300);
  }

  function awardQuestStreak() {
    if (!isBeta() || typeof global.getCoachingState !== 'function') return;
    var dk = todayKey();
    if (localStorage.getItem(QUEST_STREAK_KEY) === dk) return;
    var coaching = global.getCoachingState();
    if (coaching.lastSafeDay === dk) {
      localStorage.setItem(QUEST_STREAK_KEY, dk);
      return;
    }
    var y = new Date();
    y.setDate(y.getDate() - 1);
    var yKey = y.toISOString().split('T')[0];
    coaching.streak = coaching.lastSafeDay === yKey ? (coaching.streak || 0) + 1 : 1;
    coaching.lastSafeDay = dk;
    coaching.longestStreak = Math.max(coaching.longestStreak || 0, coaching.streak);
    if (typeof global.saveCoachingState === 'function') global.saveCoachingState(coaching);
    if (typeof global.localAwardXp === 'function') {
      global.localAwardXp(coaching, 40, 'Daily quest complete!');
    }
    if (typeof global.showXpToast === 'function') {
      global.showXpToast(40, '🔥 Day ' + coaching.streak + ' streak!');
    }
    if (typeof global.updateCoachingUI === 'function') global.updateCoachingUI(coaching);
    if (typeof global.hwCompanionOnStreakExtended === 'function') {
      global.hwCompanionOnStreakExtended(coaching.streak);
    }
    localStorage.setItem(QUEST_STREAK_KEY, dk);
  }

  function onQuestProgress(pct) {
    if (!isBeta()) return;
    if (pct >= 100) awardQuestStreak();
    updateBetaAuraCard();
  }

  function onDashboardReady() {
    if (!isBeta()) return;
    applyBetaUI();
    ensureMinimalProfile();
    setTimeout(function () {
      ensureQuestActive();
      updateBetaAuraCard();
    }, 800);
  }

  function updateBetaAuraCard() {
    var el = document.getElementById('hwBetaAuraText');
    if (!el) return;
    var pts = typeof global.hwGetQuestLsPoints === 'function'
      ? global.hwGetQuestLsPoints() : { sprints: 0, rests: 0 };
    var pct = parseInt((document.getElementById('chProgressPct') || {}).textContent, 10) || 0;
    var coaching = typeof global.getCoachingState === 'function' ? global.getCoachingState() : { streak: 0 };
    if (pct >= 100) {
      el.textContent = 'Quest complete! Your streak is locked for today. See you tomorrow.';
    } else if (pts.sprints >= 1 && pts.rests < 1) {
      el.textContent = 'Sprint done — take your ear rest to finish today\'s quest.';
    } else if (pts.sprints < 1) {
      el.textContent = 'Press play on Spotify, open Recovery Tracker, and complete one safe sprint to start.';
    } else {
      el.textContent = 'You\'re on track. Finish the quest to extend your ' + (coaching.streak || 0) + '-day streak.';
    }
  }

  function patchGlobals() {
    if (!isBeta() || global.__hwBetaPatched) return;
    global.__hwBetaPatched = true;

    if (typeof global.needsUserProfileSetup === 'function') {
      global.__hwOrigNeedsProfile = global.needsUserProfileSetup;
      global.needsUserProfileSetup = function () {
        var beta = needsUserProfileSetupBeta();
        if (beta !== null) return beta;
        return global.__hwOrigNeedsProfile();
      };
    }

    if (typeof global.needsMusicGenreSurvey === 'function') {
      global.__hwOrigNeedsMusicSurvey = global.needsMusicGenreSurvey;
      global.needsMusicGenreSurvey = function () {
        var beta = needsMusicGenreSurveyBeta();
        if (beta !== null) return beta;
        return global.__hwOrigNeedsMusicSurvey();
      };
    }

    if (typeof global.hwMaybeAwardStreakDay === 'function') {
      global.__hwOrigAwardStreakDay = global.hwMaybeAwardStreakDay;
      global.hwMaybeAwardStreakDay = function () {
        if (isBeta()) return;
        return global.__hwOrigAwardStreakDay.apply(global, arguments);
      };
    }

    if (typeof global.hwQuestOnLsEvent === 'function') {
      global.__hwOrigQuestOnLsEvent = global.hwQuestOnLsEvent;
      global.hwQuestOnLsEvent = function (type, meta) {
        global.__hwOrigQuestOnLsEvent(type, meta);
        if (type === 'ear_rest') markFirstEarRestDone();
        var pct = parseInt((document.getElementById('chProgressPct') || {}).textContent, 10) || 0;
        onQuestProgress(pct);
      };
    }

    if (typeof global.enterHearWiseDashboard === 'function') {
      global.__hwOrigEnterDashboard = global.enterHearWiseDashboard;
      global.enterHearWiseDashboard = function () {
        global.__hwOrigEnterDashboard.apply(global, arguments);
        onDashboardReady();
      };
    }

    if (typeof global.applyPlanHomeView === 'function') {
      global.__hwOrigApplyPlanHomeView = global.applyPlanHomeView;
      global.applyPlanHomeView = function () {
        global.__hwOrigApplyPlanHomeView.apply(global, arguments);
        if (isBeta()) {
          var fab = document.getElementById('auraCoachFab');
          if (fab) fab.style.display = 'none';
        }
      };
    }

    if (typeof global.renderChallengeHero === 'function') {
      global.__hwOrigRenderChallengeHero = global.renderChallengeHero;
      global.renderChallengeHero = function (ch) {
        global.__hwOrigRenderChallengeHero(ch);
        if (isBeta()) {
          simplifyQuestCopy();
          updateBetaAuraCard();
        }
      };
    }

    if (typeof global.auraOnChallengeComplete === 'function') {
      global.__hwOrigAuraChallengeComplete = global.auraOnChallengeComplete;
      global.auraOnChallengeComplete = function () {
        if (isBeta()) {
          updateBetaAuraCard();
          return;
        }
        return global.__hwOrigAuraChallengeComplete.apply(global, arguments);
      };
    }

    if (typeof global.hwApplyAppConfig === 'function') {
      global.__hwOrigApplyAppConfig = global.hwApplyAppConfig;
      global.hwApplyAppConfig = function (cfg) {
        global.__hwOrigApplyAppConfig(cfg);
        applyBetaUI();
      };
    }
  }

  global.hwBeta = {
    isBeta: isBeta,
    applyBetaUI: applyBetaUI,
    onDashboardReady: onDashboardReady,
    awardQuestStreak: awardQuestStreak,
    markFirstEarRestDone: markFirstEarRestDone,
    updateBetaAuraCard: updateBetaAuraCard,
    ensureQuestActive: ensureQuestActive
  };

  patchGlobals();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(applyBetaUI, 300);
    });
  } else {
    setTimeout(applyBetaUI, 300);
  }
  document.addEventListener('hearwise:appReady', function () {
    setTimeout(onDashboardReady, 400);
  });

})(typeof window !== 'undefined' ? window : global);
