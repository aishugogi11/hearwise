/**
 * HearWise Sound Sanctuary — companion progression layer.
 * Hooks: focus sessions, safe sprints, ear rests, wellness habits.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'hearwise_companion_v1';
  var DAILY_HARMONY_CAP = 300;
  var XP_PER_SUBLEVEL = 100;
  var SUBLEVELS_PER_STAGE = 5;
  var WEEKLY_QUEST_GOAL = 5;
  var WEEKLY_RESONANCE_BONUS = 100;
  var SHIELD_EVERY_N_DAYS = 7;

  var COMPANIONS = {
    echo_bunny: {
      id: 'echo_bunny', name: 'Echo Bunny', emoji: '🐰', eggEmoji: '🥚', rarity: 'common',
      starter: true,
      stages: ['Echo Egg', 'Echo Bunny', 'Harmony Rabbit', 'Audio Guardian Rabbit'],
      evolutionReq: [
        null,
        { focus: 1, sprints: 0, rests: 0, streak: 0 },
        { focus: 10, sprints: 5, rests: 15, streak: 3 },
        { focus: 30, sprints: 20, rests: 50, streak: 7 }
      ]
    },
    rhythm_penguin: {
      id: 'rhythm_penguin', name: 'Rhythm Penguin', emoji: '🐧', eggEmoji: '🥚', rarity: 'common',
      unlock: { sprints: 3 },
      stages: ['Rhythm Egg', 'Rhythm Penguin', 'Beat Guardian', 'Polar Conductor'],
      evolutionReq: [null, { sprints: 3, rests: 2 }, { sprints: 15, rests: 10, streak: 3 }, { sprints: 40, rests: 30, streak: 7 }]
    },
    melody_panda: {
      id: 'melody_panda', name: 'Melody Panda', emoji: '🐼', eggEmoji: '🥚', rarity: 'uncommon',
      unlock: { rests: 5 },
      stages: ['Melody Egg', 'Melody Panda', 'Dream Keeper', 'Moonlight Panda'],
      evolutionReq: [null, { rests: 5 }, { rests: 20, focus: 5 }, { rests: 45, streak: 5 }]
    },
    harmony_owl: {
      id: 'harmony_owl', name: 'Harmony Owl', emoji: '🦉', eggEmoji: '🥚', rarity: 'uncommon',
      unlock: { focus: 2 },
      stages: ['Harmony Egg', 'Harmony Owl', 'Study Sage', 'Night Listener'],
      evolutionReq: [null, { focus: 2 }, { focus: 12, rests: 8 }, { focus: 35, rests: 25, streak: 5 }]
    },
    sonic_fox: {
      id: 'sonic_fox', name: 'Sonic Fox', emoji: '🦊', eggEmoji: '🥚', rarity: 'rare',
      unlock: { streak: 7 },
      stages: ['Sonic Egg', 'Sonic Fox', 'Pulse Runner', 'Frequency Fox'],
      evolutionReq: [null, { streak: 3 }, { streak: 7, focus: 10 }, { streak: 14, sprints: 25 }]
    },
    aurora_butterfly: {
      id: 'aurora_butterfly', name: 'Aurora Butterfly', emoji: '🦋', eggEmoji: '🥚', rarity: 'rare',
      unlock: { wellnessDays: 3 },
      stages: ['Aurora Cocoon', 'Aurora Butterfly', 'Prism Wing', 'Light Weaver'],
      evolutionReq: [null, { rests: 10, sprints: 5 }, { rests: 25, focus: 15 }, { rests: 60, streak: 10 }]
    }
  };

  var ZONES = {
    quiet_grove: { id: 'quiet_grove', name: 'Quiet Grove', emoji: '🌿', unlock: null },
    flow_stream: { id: 'flow_stream', name: 'Flow Stream', emoji: '💧', unlock: { rests: 5 } },
    harmony_meadow: { id: 'harmony_meadow', name: 'Harmony Meadow', emoji: '🌸', unlock: { streak: 3 } },
    starlit_den: { id: 'starlit_den', name: 'Starlit Den', emoji: '✨', unlock: { focus: 20 } },
    aurora_ridge: { id: 'aurora_ridge', name: 'Aurora Ridge', emoji: '🌌', unlock: { streak: 30 } }
  };

  var AVATAR_ACCESSORIES = [
    { id: 'flower', name: 'Flower', emoji: '🌸', slot: 'hat', cost: 15 },
    { id: 'bow', name: 'Pink Bow', emoji: '🎀', slot: 'hat', cost: 20 },
    { id: 'party_hat', name: 'Party Hat', emoji: '🎉', slot: 'hat', cost: 25 },
    { id: 'glasses', name: 'Cool Glasses', emoji: '👓', slot: 'face', cost: 30 },
    { id: 'scarf', name: 'Cozy Scarf', emoji: '🧣', slot: 'body', cost: 35 },
    { id: 'star_badge', name: 'Star Badge', emoji: '⭐', slot: 'body', cost: 40 },
    { id: 'cape', name: 'Hero Cape', emoji: '🦸', slot: 'body', cost: 60 },
    { id: 'crown', name: 'Gold Crown', emoji: '👑', slot: 'hat', cost: 80 }
  ];

  var DECOR_SHOP = [
    { id: 'lantern', name: 'Soft Lantern', emoji: '🏮', cost: 30, zone: 'quiet_grove' },
    { id: 'fern', name: 'Green Fern', emoji: '🌿', cost: 25, zone: 'quiet_grove' },
    { id: 'bench', name: 'Rest Bench', emoji: '🪑', cost: 40, zone: 'flow_stream' },
    { id: 'windchimes', name: 'Wind Chimes', emoji: '🎐', cost: 50, zone: 'harmony_meadow' },
    { id: 'moon_lamp', name: 'Moon Lamp', emoji: '🌙', cost: 60, zone: 'starlit_den' },
    { id: 'crystal', name: 'Resonance Crystal', emoji: '💎', cost: 80, zone: 'aurora_ridge' }
  ];

  var EVENT_REWARDS = {
    focus_complete: { harmony: 50, care: 0, label: 'Focus block complete' },
    break_complete: { harmony: 15, care: 2, label: 'Recovery break' },
    sprint_complete: { harmony: 15, care: 1, label: 'Safe sprint complete' },
    ear_rest_complete: { harmony: 25, care: 3, label: 'Ear rest complete' },
    safe_session: { harmony: 10, care: 1, label: 'Safe listening session' },
    daily_quest: { harmony: 50, care: 5, resonance: 25, label: 'Daily quest complete' },
    first_session_today: { harmony: 10, care: 1, label: 'First session today' },
    evolution: { harmony: 0, care: 0, resonance: 50, label: 'Evolution!' },
    zone_unlock: { harmony: 0, resonance: 40, label: 'Sanctuary expanded' }
  };

  function todayKey() {
    return new Date().toISOString().split('T')[0];
  }

  function weekStartKey() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().split('T')[0];
  }

  function defaultState() {
    return {
      activeCompanionId: 'echo_bunny',
      companions: {
        echo_bunny: { stage: 0, xp: 0, energy: 88, happiness: 92, unlocked: true, unlockedAt: Date.now() }
      },
      sanctuary: { zones: ['quiet_grove'], decor: [], resonance: 20 },
      avatar: { owned: [], equipped: { hat: null, face: null, body: null } },
      careTokens: 0,
      streakShields: 0,
      daily: { date: todayKey(), harmonyXpEarned: 0, firstSessionAwarded: false, wellnessAwarded: false },
      weekly: { weekStart: weekStartKey(), resonanceAwarded: false, dailyQuests: 0 },
      stats: { focus: 0, breaks: 0, sprints: 0, earRests: 0, safeSessions: 0, wellnessDays: 0 },
      lastSessionAt: null,
      lastNote: null,
      lastShieldStreak: 0,
      processedEvents: []
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      if (!s.companions) return defaultState();
      if (!s.sanctuary) s.sanctuary = defaultState().sanctuary;
      if (!s.avatar) s.avatar = defaultState().avatar;
      if (!s.avatar.equipped) s.avatar.equipped = { hat: null, face: null, body: null };
      if (!s.avatar.owned) s.avatar.owned = [];
      if (!s.stats) s.stats = defaultState().stats;
      if (!s.daily || s.daily.date !== todayKey()) {
        s.daily = { date: todayKey(), harmonyXpEarned: 0, firstSessionAwarded: false, wellnessAwarded: false };
      }
      if (!s.weekly || s.weekly.weekStart !== weekStartKey()) {
        s.weekly = { weekStart: weekStartKey(), resonanceAwarded: false, dailyQuests: 0 };
      }
      if (!s.processedEvents) s.processedEvents = [];
      if (s.processedEvents.length > 200) s.processedEvents = s.processedEvents.slice(-100);
      return s;
    } catch (e) {
      return defaultState();
    }
  }

  function saveState(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  function getActiveCompanion(state) {
    state = state || loadState();
    var id = state.activeCompanionId || 'echo_bunny';
    if (!state.companions[id]) {
      state.companions[id] = { stage: 0, xp: 0, energy: 85, happiness: 90, unlocked: true, unlockedAt: Date.now() };
    }
    return { def: COMPANIONS[id] || COMPANIONS.echo_bunny, data: state.companions[id], id: id };
  }

  function stageName(companionId, stage) {
    var c = COMPANIONS[companionId];
    if (!c) return 'Companion';
    return c.stages[stage] || c.stages[c.stages.length - 1];
  }

  function displayEmoji(companionId, data) {
    var c = COMPANIONS[companionId];
    if (!c) return '🐰';
    if (data.stage === 0) return c.eggEmoji || '🥚';
    return c.emoji;
  }

  function getAccessory(id) {
    return AVATAR_ACCESSORIES.find(function (a) { return a.id === id; }) || null;
  }

  function avatarEquippedHtml(state, size) {
    state = state || loadState();
    var eq = (state.avatar && state.avatar.equipped) || {};
    var slots = ['hat', 'face', 'body'];
    return slots.map(function (slot) {
      var item = eq[slot] ? getAccessory(eq[slot]) : null;
      if (!item) return '';
      return '<span class="hw-avatar-acc hw-avatar-acc-' + slot + ' hw-avatar-acc-' + size + '" title="' + esc(item.name) + '">' + item.emoji + '</span>';
    }).join('');
  }

  function avatarPreviewHtml(state, size) {
    state = state || loadState();
    var active = getActiveCompanion(state);
    size = size || 'md';
    return '<div class="hw-avatar-preview hw-avatar-preview-' + size + '">' +
      avatarEquippedHtml(state, size) +
      '<span class="hw-avatar-core">' + displayEmoji(active.id, active.data) + '</span>' +
    '</div>';
  }

  function subLevelProgress(data) {
    return (data.xp || 0) % XP_PER_SUBLEVEL;
  }

  function meetsEvolutionReq(companionId, stage, stats, coaching) {
    var c = COMPANIONS[companionId];
    if (!c || !c.evolutionReq) return false;
    var req = c.evolutionReq[stage];
    if (!req) return false;
    var streak = coaching && coaching.streak ? coaching.streak : 0;
    var totalRests = (stats.earRests || 0) + (stats.breaks || 0);
    if (req.focus && stats.focus < req.focus) return false;
    if (req.sprints && stats.sprints < req.sprints) return false;
    if (req.rests && totalRests < req.rests) return false;
    if (req.streak && streak < req.streak) return false;
    return true;
  }

  function checkUnlocks(state, coaching) {
    Object.keys(COMPANIONS).forEach(function (id) {
      if (state.companions[id] && state.companions[id].unlocked) return;
      var c = COMPANIONS[id];
      if (c.starter) return;
      var u = c.unlock;
      if (!u) return;
      var ok = true;
      if (u.sprints && state.stats.sprints < u.sprints) ok = false;
      if (u.rests && state.stats.earRests < u.rests) ok = false;
      if (u.focus && state.stats.focus < u.focus) ok = false;
      if (u.streak && (!coaching || coaching.streak < u.streak)) ok = false;
      if (u.wellnessDays && state.stats.wellnessDays < u.wellnessDays) ok = false;
      if (ok) {
        state.companions[id] = { stage: 0, xp: 0, energy: 85, happiness: 90, unlocked: true, unlockedAt: Date.now() };
        state.lastNote = c.name + ' joined your sanctuary!';
        notify(c.emoji + ' ' + c.name + ' unlocked!', 'New companion');
      }
    });
  }

  function checkZoneUnlocks(state, coaching) {
    Object.keys(ZONES).forEach(function (zid) {
      if (state.sanctuary.zones.indexOf(zid) >= 0) return;
      var z = ZONES[zid];
      if (!z.unlock) return;
      var ok = true;
      var streak = coaching && coaching.streak ? coaching.streak : 0;
      if (z.unlock.rests && state.stats.earRests < z.unlock.rests) ok = false;
      if (z.unlock.focus && state.stats.focus < z.unlock.focus) ok = false;
      if (z.unlock.streak && streak < z.unlock.streak) ok = false;
      if (ok) {
        state.sanctuary.zones.push(zid);
        state.sanctuary.resonance += EVENT_REWARDS.zone_unlock.resonance || 40;
        state.lastNote = z.name + ' opened in your sanctuary.';
        notify(z.emoji + ' ' + z.name + ' unlocked!', 'Sanctuary grew');
      }
    });
  }

  function tryEvolve(state, coaching) {
    var active = getActiveCompanion(state);
    var data = active.data;
    var c = active.def;
    var nextStage = data.stage + 1;
    if (nextStage >= c.stages.length) return;
    if (!meetsEvolutionReq(active.id, nextStage, state.stats, coaching)) return;
    if (data.energy < 30) {
      state.lastNote = active.def.name + ' needs more energy to evolve — start a session or take a rest.';
      return;
    }
    data.stage = nextStage;
    data.xp = 0;
    data.happiness = Math.min(100, (data.happiness || 80) + 15);
    state.sanctuary.resonance += EVENT_REWARDS.evolution.resonance || 50;
    state.lastNote = stageName(active.id, data.stage) + ' evolved! ✦';
    notify('✦ ' + stageName(active.id, data.stage) + ' evolved!', 'Evolution');
  }

  function applyEnergyHappiness(state, eventType) {
    var active = getActiveCompanion(state);
    var data = active.data;
    state.lastSessionAt = Date.now();
    if (eventType === 'ear_rest_complete' || eventType === 'break_complete') {
      data.energy = Math.min(100, (data.energy || 70) + 18);
      data.happiness = Math.min(100, (data.happiness || 70) + 12);
    } else if (eventType === 'focus_complete' || eventType === 'sprint_complete') {
      data.energy = Math.min(100, (data.energy || 70) + 8);
      data.happiness = Math.min(100, (data.happiness || 70) + 6);
    }
    tickIdleEnergy(state);
  }

  function tickIdleEnergy(state) {
    if (!state.lastSessionAt) return;
    var hours = (Date.now() - state.lastSessionAt) / 3600000;
    if (hours >= 48) {
      var active = getActiveCompanion(state);
      active.data.energy = Math.max(25, (active.data.energy || 70) - 10);
      active.data.happiness = Math.max(30, (active.data.happiness || 70) - 5);
    }
  }

  function awardHarmony(state, amount, label) {
    var remaining = DAILY_HARMONY_CAP - (state.daily.harmonyXpEarned || 0);
    if (remaining <= 0) return 0;
    var grant = Math.min(amount, remaining);
    state.daily.harmonyXpEarned = (state.daily.harmonyXpEarned || 0) + grant;
    if (typeof global.localAwardXp === 'function' && typeof global.getCoachingState === 'function') {
      global.localAwardXp(global.getCoachingState(), grant, label);
    }
    var active = getActiveCompanion(state);
    active.data.xp = (active.data.xp || 0) + grant;
    return grant;
  }

  function notify(msg, label) {
    if (typeof global.showNotification === 'function') global.showNotification(msg);
    else if (typeof global.showXpToast === 'function') global.showXpToast(0, label || msg);
  }

  function recordWellnessDay(state) {
    if (state.daily.wellnessAwarded) return;
    state.daily.wellnessAwarded = true;
    state.stats.wellnessDays = (state.stats.wellnessDays || 0) + 1;
  }

  function checkWeeklyResonanceChest(state) {
    if (!state.weekly) state.weekly = { weekStart: weekStartKey(), resonanceAwarded: false, dailyQuests: 0 };
    state.weekly.dailyQuests = (state.weekly.dailyQuests || 0) + 1;
    if (state.weekly.resonanceAwarded || state.weekly.dailyQuests < WEEKLY_QUEST_GOAL) return;
    state.weekly.resonanceAwarded = true;
    state.sanctuary.resonance += WEEKLY_RESONANCE_BONUS;
    state.lastNote = '✨ Weekly Resonance Chest — +' + WEEKLY_RESONANCE_BONUS + ' Resonance!';
    notify('✨ Weekly Resonance Chest opened!', 'Weekly reward');
  }

  function onStreakExtended(streak) {
    if (!streak || streak % SHIELD_EVERY_N_DAYS !== 0) return;
    var state = loadState();
    if (state.lastShieldStreak === streak) return;
    state.lastShieldStreak = streak;
    state.streakShields = (state.streakShields || 0) + 1;
    state.lastNote = '🛡️ Streak Shield earned — protects one missed day.';
    saveState(state);
    notify('🛡️ Streak Shield earned!', 'Milestone');
    renderCompanionUI(state);
  }

  function tryProtectStreak() {
    var state = loadState();
    if ((state.streakShields || 0) < 1) return false;
    state.streakShields -= 1;
    state.lastNote = '🛡️ Streak Shield used — your streak is safe.';
    saveState(state);
    notify('🛡️ Streak Shield protected your streak!', 'Streak saved');
    renderCompanionUI(state);
    return true;
  }

  function onEvent(type, meta) {
    meta = meta || {};
    var state = loadState();
    var eventId = meta.eventId || (type + '_' + Date.now());
    if (state.processedEvents.indexOf(eventId) >= 0) return state;
    state.processedEvents.push(eventId);

    var rewards = EVENT_REWARDS[type];
    if (!rewards) return state;

    var coaching = typeof global.getCoachingState === 'function' ? global.getCoachingState() : null;

    if (type === 'focus_complete') state.stats.focus += 1;
    if (type === 'break_complete') state.stats.breaks += 1;
    if (type === 'sprint_complete') state.stats.sprints += 1;
    if (type === 'ear_rest_complete') state.stats.earRests += 1;
    if (type === 'safe_session') state.stats.safeSessions += 1;

    if (!state.daily.firstSessionAwarded && type !== 'daily_quest') {
      state.daily.firstSessionAwarded = true;
      awardHarmony(state, EVENT_REWARDS.first_session_today.harmony, EVENT_REWARDS.first_session_today.label);
      state.careTokens += EVENT_REWARDS.first_session_today.care || 0;
    }

    var harmony = awardHarmony(state, rewards.harmony || 0, rewards.label);
    if (rewards.care) state.careTokens += rewards.care;
    if (rewards.resonance) state.sanctuary.resonance += rewards.resonance;

    if (type === 'daily_quest') {
      recordWellnessDay(state);
      checkWeeklyResonanceChest(state);
    }

    applyEnergyHappiness(state, type);
    checkUnlocks(state, coaching);
    checkZoneUnlocks(state, coaching);
    tryEvolve(state, coaching);

    if (harmony > 0) {
      var active = getActiveCompanion(state);
      state.lastNote = displayEmoji(active.id, active.data) + ' +' + harmony + ' Harmony · ' + rewards.label;
    }

    saveState(state);
    renderCompanionUI(state);
    renderAvatarStudio(state);
    return state;
  }

  function useCareTokens(amount) {
    var state = loadState();
    if (state.careTokens < amount) return false;
    state.careTokens -= amount;
    var active = getActiveCompanion(state);
    active.data.energy = Math.min(100, (active.data.energy || 50) + 25);
    active.data.happiness = Math.min(100, (active.data.happiness || 50) + 20);
    state.lastNote = 'You cared for ' + active.def.name + ' — energy restored.';
    saveState(state);
    renderCompanionUI(state);
    return true;
  }

  function buyAccessory(accessoryId) {
    var state = loadState();
    var item = getAccessory(accessoryId);
    if (!item) return { ok: false, reason: 'unknown' };
    if (!state.avatar) state.avatar = defaultState().avatar;
    if (state.avatar.owned.indexOf(accessoryId) >= 0) return { ok: false, reason: 'owned' };
    if (state.sanctuary.resonance < item.cost) return { ok: false, reason: 'insufficient' };
    state.sanctuary.resonance -= item.cost;
    state.avatar.owned.push(accessoryId);
    state.avatar.equipped[item.slot] = accessoryId;
    state.lastNote = item.emoji + ' ' + item.name + ' equipped on your companion!';
    saveState(state);
    renderAvatarStudio(state);
    renderCompanionUI(state);
    return { ok: true, item: item };
  }

  function equipAccessory(accessoryId) {
    var state = loadState();
    var item = getAccessory(accessoryId);
    if (!item) return { ok: false, reason: 'unknown' };
    if (!state.avatar || state.avatar.owned.indexOf(accessoryId) < 0) return { ok: false, reason: 'not_owned' };
    state.avatar.equipped[item.slot] = accessoryId;
    state.lastNote = item.emoji + ' ' + item.name + ' equipped.';
    saveState(state);
    renderAvatarStudio(state);
    renderCompanionUI(state);
    return { ok: true, item: item };
  }

  function unequipAccessory(slot) {
    var state = loadState();
    if (!state.avatar || !state.avatar.equipped) return { ok: false, reason: 'empty' };
    if (!state.avatar.equipped[slot]) return { ok: false, reason: 'empty' };
    state.avatar.equipped[slot] = null;
    state.lastNote = 'Accessory removed.';
    saveState(state);
    renderAvatarStudio(state);
    renderCompanionUI(state);
    return { ok: true };
  }

  function buyDecor(decorId) {
    var state = loadState();
    var item = DECOR_SHOP.find(function (d) { return d.id === decorId; });
    if (!item) return { ok: false, reason: 'unknown' };
    if (state.sanctuary.decor.indexOf(decorId) >= 0) return { ok: false, reason: 'owned' };
    if (state.sanctuary.zones.indexOf(item.zone) < 0) return { ok: false, reason: 'zone_locked' };
    if (state.sanctuary.resonance < item.cost) return { ok: false, reason: 'insufficient' };
    state.sanctuary.resonance -= item.cost;
    state.sanctuary.decor.push(decorId);
    state.lastNote = item.emoji + ' ' + item.name + ' placed in sanctuary.';
    saveState(state);
    renderSanctuaryModal(state);
    renderCompanionUI(state);
    return { ok: true, item: item };
  }

  function setActiveCompanion(id) {
    var state = loadState();
    if (!state.companions[id] || !state.companions[id].unlocked) return;
    state.activeCompanionId = id;
    saveState(state);
    renderCompanionUI(state);
    renderSanctuaryModal(state);
  }

  function getPayload() {
    var state = loadState();
    var active = getActiveCompanion(state);
    var coaching = typeof global.getCoachingState === 'function' ? global.getCoachingState() : {};
    return {
      activeId: active.id,
      name: stageName(active.id, active.data.stage),
      emoji: displayEmoji(active.id, active.data),
      stage: active.data.stage,
      xp: active.data.xp,
      xpPct: Math.round((subLevelProgress(active.data) / XP_PER_SUBLEVEL) * 100),
      energy: active.data.energy,
      happiness: active.data.happiness,
      careTokens: state.careTokens,
      streakShields: state.streakShields || 0,
      weeklyQuests: (state.weekly && state.weekly.dailyQuests) || 0,
      weeklyQuestGoal: WEEKLY_QUEST_GOAL,
      weeklyChestOpen: !!(state.weekly && state.weekly.resonanceAwarded),
      resonance: state.sanctuary.resonance,
      zones: state.sanctuary.zones.slice(),
      decor: state.sanctuary.decor.slice(),
      avatarOwned: (state.avatar && state.avatar.owned) ? state.avatar.owned.slice() : [],
      avatarEquipped: Object.assign({ hat: null, face: null, body: null }, state.avatar && state.avatar.equipped),
      stats: Object.assign({}, state.stats),
      streak: coaching.streak || 0,
      lastNote: state.lastNote,
      unlockedCount: Object.keys(state.companions).filter(function (k) { return state.companions[k].unlocked; }).length
    };
  }

  function enrichCoachPlan(plan) {
    if (!plan) plan = {};
    var p = getPayload();
    if (!p.lastNote && p.energy >= 60) return plan;
    var line = p.lastNote || (p.emoji + ' ' + p.name + ' · Energy ' + p.energy + '% · Happiness ' + p.happiness + '%');
    plan.reason = (plan.reason || '') + (plan.reason ? ' ' : '') + line;
    plan.chips = (plan.chips || []).concat([
      { label: p.emoji + ' ' + p.name, cls: p.energy >= 50 ? 'good' : 'warn' },
      { label: p.careTokens + ' Care', cls: '' },
      { label: p.resonance + ' Resonance', cls: '' }
    ]);
    return plan;
  }

  function companionCardHtml(state) {
    state = state || loadState();
    var active = getActiveCompanion(state);
    var xpPct = Math.round((subLevelProgress(active.data) / XP_PER_SUBLEVEL) * 100);
    var mood = active.data.happiness >= 70 ? 'content' : active.data.happiness >= 45 ? 'quiet' : 'needs care';
    var moodTxt = mood === 'content' ? 'Happy & growing' : mood === 'quiet' ? 'Resting — a session helps' : 'Send care — ear rest helps most';
    return '<div class="hw-companion-card" id="hwCompanionCard">' +
      '<div class="hw-companion-main">' +
        '<div class="hw-companion-avatar" title="' + esc(active.def.name) + '">' + avatarPreviewHtml(state, 'sm') + '</div>' +
        '<div class="hw-companion-info">' +
          '<div class="hw-companion-name">' + esc(stageName(active.id, active.data.stage)) + '</div>' +
          '<div class="hw-companion-mood">' + moodTxt + '</div>' +
          '<div class="hw-companion-bars">' +
            '<span>⚡ ' + Math.round(active.data.energy) + '%</span>' +
            '<span>💜 ' + Math.round(active.data.happiness) + '%</span>' +
            '<span>🎵 ' + xpPct + '% stage</span>' +
          '</div>' +
          '<div class="hw-companion-xp-track"><div class="hw-companion-xp-fill" style="width:' + xpPct + '%"></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="hw-companion-actions">' +
        '<span class="hw-companion-token">🌸 ' + state.careTokens + ' Care</span>' +
        '<span class="hw-companion-token">✨ ' + state.sanctuary.resonance + ' Resonance</span>' +
        (state.streakShields ? '<span class="hw-companion-token">🛡️ ' + state.streakShields + '</span>' : '') +
        '<button type="button" class="hw-companion-btn" onclick="hwOpenAvatarStudio()">Decorate</button>' +
        '<button type="button" class="hw-companion-btn secondary" onclick="hwOpenSanctuary()">Sanctuary</button>' +
        (state.careTokens >= 3 ? '<button type="button" class="hw-companion-btn secondary" onclick="hwCompanionUseCare()">Care</button>' : '') +
      '</div>' +
      (state.lastNote ? '<div class="hw-companion-note">' + esc(state.lastNote) + '</div>' : '') +
    '</div>';
  }

  function sanctuaryModalHtml(state) {
    state = state || loadState();
    var active = getActiveCompanion(state);
    var zonesHtml = Object.keys(ZONES).map(function (zid) {
      var z = ZONES[zid];
      var unlocked = state.sanctuary.zones.indexOf(zid) >= 0;
      var decors = DECOR_SHOP.filter(function (d) { return d.zone === zid && state.sanctuary.decor.indexOf(d.id) >= 0; });
      return '<div class="hw-sanc-zone' + (unlocked ? '' : ' locked') + '">' +
        '<div class="hw-sanc-zone-hd">' + z.emoji + ' ' + z.name + (unlocked ? '' : ' 🔒') + '</div>' +
        (unlocked
          ? '<div class="hw-sanc-decor-row">' + (decors.length ? decors.map(function (d) { return d.emoji; }).join(' ') : '— add decor below —') + '</div>'
          : '<div class="hw-sanc-lock-hint">Keep healthy habits to unlock</div>') +
      '</div>';
    }).join('');

    var shopHtml = DECOR_SHOP.map(function (item) {
      var owned = state.sanctuary.decor.indexOf(item.id) >= 0;
      var zoneOk = state.sanctuary.zones.indexOf(item.zone) >= 0;
      return '<button type="button" class="hw-sanc-shop-item' + (owned ? ' owned' : '') + '" ' +
        (owned || !zoneOk ? 'disabled' : '') +
        ' onclick="hwSanctuaryBuyDecor(\'' + item.id + '\')">' +
        item.emoji + ' ' + item.name + ' · ' + item.cost + ' ✨' +
        (owned ? ' ✓' : '') +
      '</button>';
    }).join('');

    var rosterHtml = Object.keys(COMPANIONS).map(function (id) {
      var c = COMPANIONS[id];
      var data = state.companions[id];
      if (!data || !data.unlocked) return '';
      var on = id === state.activeCompanionId ? ' active' : '';
      return '<button type="button" class="hw-sanc-roster-item' + on + '" onclick="hwCompanionSetActive(\'' + id + '\')">' +
        displayEmoji(id, data) + '<span>' + c.name + '</span></button>';
    }).join('');

    return '<div class="hw-sanc-overlay" id="hwSanctuaryOverlay" onclick="if(event.target===this)hwCloseSanctuary()">' +
      '<div class="hw-sanc-card" role="dialog">' +
        '<button type="button" class="hw-sanc-close" onclick="hwCloseSanctuary()" aria-label="Close">×</button>' +
        '<h2 class="hw-sanc-title">🎵 Sound Sanctuary</h2>' +
        '<p class="hw-sanc-sub">Your companions and habitats grow with focus, safe listening, and ear rests.</p>' +
        '<div class="hw-sanc-hero">' + displayEmoji(active.id, active.data) + ' <strong>' + esc(stageName(active.id, active.data.stage)) + '</strong></div>' +
        '<div class="hw-sanc-weekly">' +
          '<div class="hw-sanc-weekly-label">Weekly Resonance Chest · ' + (state.weekly.dailyQuests || 0) + '/' + WEEKLY_QUEST_GOAL + ' daily quests</div>' +
          '<div class="hw-sanc-weekly-bar"><div class="hw-sanc-weekly-fill" style="width:' +
            Math.min(100, Math.round(((state.weekly.dailyQuests || 0) / WEEKLY_QUEST_GOAL) * 100)) + '%"></div></div>' +
          (state.weekly.resonanceAwarded
            ? '<div class="hw-sanc-weekly-done">✨ Chest opened this week</div>'
            : '<div class="hw-sanc-weekly-hint">Complete ' + WEEKLY_QUEST_GOAL + ' daily quests for +' + WEEKLY_RESONANCE_BONUS + ' Resonance</div>') +
          (state.streakShields ? '<div class="hw-sanc-shield">🛡️ ' + state.streakShields + ' Streak Shield' + (state.streakShields === 1 ? '' : 's') + ' · earned every ' + SHIELD_EVERY_N_DAYS + ' days</div>' : '') +
        '</div>' +
        '<div class="hw-sanc-zones">' + zonesHtml + '</div>' +
        '<div class="hw-sanc-section-label">Decor · ' + state.sanctuary.resonance + ' Resonance</div>' +
        '<div class="hw-sanc-shop">' + shopHtml + '</div>' +
        '<div class="hw-sanc-section-label">Companions (' + Object.keys(state.companions).filter(function (k) { return state.companions[k].unlocked; }).length + ')</div>' +
        '<div class="hw-sanc-roster">' + rosterHtml + '</div>' +
      '</div></div>';
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function avatarStudioHtml(state) {
    state = state || loadState();
    var active = getActiveCompanion(state);
    var owned = (state.avatar && state.avatar.owned) || [];
    var equipped = (state.avatar && state.avatar.equipped) || { hat: null, face: null, body: null };

    var shopHtml = AVATAR_ACCESSORIES.map(function (item) {
      var isOwned = owned.indexOf(item.id) >= 0;
      var isEquipped = equipped[item.slot] === item.id;
      var btnLabel = isEquipped ? 'Equipped ✓' : isOwned ? 'Equip' : item.cost + ' ✨';
      var onclick = isEquipped
        ? 'hwAvatarUnequip(\'' + item.slot + '\')'
        : isOwned
          ? 'hwAvatarEquip(\'' + item.id + '\')'
          : 'hwAvatarBuy(\'' + item.id + '\')';
      return '<button type="button" class="hw-avatar-shop-item' + (isOwned ? ' owned' : '') + (isEquipped ? ' equipped' : '') + '" onclick="' + onclick + '">' +
        '<span class="hw-avatar-shop-emoji">' + item.emoji + '</span>' +
        '<span class="hw-avatar-shop-name">' + esc(item.name) + '</span>' +
        '<span class="hw-avatar-shop-cost">' + btnLabel + '</span>' +
      '</button>';
    }).join('');

    return '<div class="hw-avatar-studio-card">' +
      '<div class="hw-avatar-studio-hd">' +
        '<div><div class="hw-avatar-studio-title">🎨 Companion Studio</div>' +
        '<div class="hw-avatar-studio-sub">Earn Resonance from ear rests, quests, and evolutions — spend it to dress up your companion.</div></div>' +
        '<span class="hw-companion-token">✨ ' + state.sanctuary.resonance + ' Resonance</span>' +
      '</div>' +
      '<div class="hw-avatar-studio-preview">' +
        avatarPreviewHtml(state, 'lg') +
        '<div class="hw-avatar-studio-meta">' +
          '<div class="hw-avatar-studio-name">' + esc(stageName(active.id, active.data.stage)) + '</div>' +
          '<div class="hw-avatar-studio-hint">Your personal progress — no competing with others.</div>' +
        '</div>' +
      '</div>' +
      '<div class="hw-sanc-section-label">Accessories · hat · face · body</div>' +
      '<div class="hw-avatar-shop">' + shopHtml + '</div>' +
      (state.lastNote ? '<div class="hw-companion-note">' + esc(state.lastNote) + '</div>' : '') +
    '</div>';
  }

  function renderAvatarStudio(state) {
    state = state || loadState();
    var mount = document.getElementById('hwAvatarStudioMount');
    if (mount) mount.innerHTML = avatarStudioHtml(state);
  }

  function renderCompanionUI(state) {
    state = state || loadState();
    var mount = document.getElementById('hwCompanionMount');
    if (mount) mount.innerHTML = companionCardHtml(state);
    var questStrip = document.getElementById('hwCompanionQuestStrip');
    if (questStrip) {
      var p = getPayload();
      questStrip.innerHTML = p.emoji + ' <strong>' + p.name + '</strong> · ' + p.xpPct + '% to next evolution step';
      questStrip.style.display = 'block';
    }
  }

  function renderSanctuaryModal(state) {
    var existing = document.getElementById('hwSanctuaryOverlay');
    if (existing) existing.remove();
    var wrap = document.createElement('div');
    wrap.innerHTML = sanctuaryModalHtml(state);
    var overlay = wrap.firstChild;
    if (overlay) document.body.appendChild(overlay);
  }

  function ensureSanctuaryMount() {
    if (!document.getElementById('hwCompanionMount')) {
      var betaWrap = document.getElementById('hwBetaCompanionMount');
      if (betaWrap) {
        var betaMount = document.createElement('div');
        betaMount.id = 'hwCompanionMount';
        betaMount.className = 'hw-companion-mount';
        betaWrap.appendChild(betaMount);
      } else {
        var mission = document.getElementById('wpMissionCard');
        if (mission) {
          var mount = document.createElement('div');
          mount.id = 'hwCompanionMount';
          mount.className = 'hw-companion-mount';
          var phase = document.getElementById('wpMissionPhase');
          if (phase && phase.parentNode) phase.parentNode.insertBefore(mount, phase.nextSibling);
          else mission.insertBefore(mount, mission.children[1] || null);
        }
      }
    }
    if (!document.getElementById('hwCompanionQuestStrip')) {
      var banner = document.querySelector('.gw-streak-banner');
      if (banner && banner.parentNode) {
        var strip = document.createElement('div');
        strip.id = 'hwCompanionQuestStrip';
        strip.className = 'hw-companion-quest-strip';
        strip.style.display = 'none';
        banner.parentNode.insertBefore(strip, banner.nextSibling);
      }
    }
  }

  function init() {
    ensureSanctuaryMount();
    var state = loadState();
    tickIdleEnergy(state);
    saveState(state);
    renderCompanionUI(state);
    renderAvatarStudio(state);
  }

  var ProgressionModule = {
    onEvent: onEvent,
    getPayload: getPayload,
    loadState: loadState,
    saveState: saveState,
    enrichCoachPlan: enrichCoachPlan,
    renderUI: renderCompanionUI,
    renderAvatarStudio: renderAvatarStudio,
    useCareTokens: useCareTokens,
    buyAccessory: buyAccessory,
    equipAccessory: equipAccessory,
    unequipAccessory: unequipAccessory,
    buyDecor: buyDecor,
    setActiveCompanion: setActiveCompanion,
    onStreakExtended: onStreakExtended,
    tryProtectStreak: tryProtectStreak,
    COMPANIONS: COMPANIONS,
    ZONES: ZONES,
    DECOR_SHOP: DECOR_SHOP,
    AVATAR_ACCESSORIES: AVATAR_ACCESSORIES,
    init: init
  };

  global.hwCompanionProgression = ProgressionModule;
  global.hwCompanionOnEvent = function (type, meta) { return ProgressionModule.onEvent(type, meta); };
  global.hwOpenAvatarStudio = function () {
    if (typeof global.hwSwitchTab === 'function') global.hwSwitchTab('progress');
    setTimeout(function () {
      renderAvatarStudio(loadState());
      var wrap = document.getElementById('hwAvatarStudioWrap');
      if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  };
  global.hwAvatarBuy = function (id) {
    var r = buyAccessory(id);
    if (!r.ok && typeof global.showNotification === 'function') {
      if (r.reason === 'insufficient') global.showNotification('Need more Resonance ✨ — complete ear rests and daily quests.');
      else if (r.reason === 'owned') global.showNotification('You already own that accessory.');
    }
  };
  global.hwAvatarEquip = function (id) { equipAccessory(id); };
  global.hwAvatarUnequip = function (slot) { unequipAccessory(slot); };
  global.hwOpenSanctuary = function () {
    renderSanctuaryModal(loadState());
  };
  global.hwCloseSanctuary = function () {
    var el = document.getElementById('hwSanctuaryOverlay');
    if (el) el.remove();
  };
  global.hwSanctuaryBuyDecor = function (id) {
    var r = buyDecor(id);
    if (!r.ok && typeof global.showNotification === 'function') {
      if (r.reason === 'insufficient') global.showNotification('Need more Resonance ✨ — complete weekly goals and evolutions.');
      else if (r.reason === 'zone_locked') global.showNotification('Unlock that sanctuary zone first through healthy habits.');
    }
  };
  global.hwCompanionUseCare = function () {
    if (!useCareTokens(3) && typeof global.showNotification === 'function') {
      global.showNotification('Need 3 Care Tokens — take ear rests to earn more.');
    }
  };
  global.hwCompanionSetActive = function (id) { setActiveCompanion(id); };
  global.hwCompanionOnStreakExtended = function (streak) { onStreakExtended(streak); };
  global.hwCompanionTryProtectStreak = function () { return tryProtectStreak(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 400); });
  } else {
    setTimeout(init, 400);
  }
  document.addEventListener('hearwise:appReady', function () { setTimeout(init, 200); });

})(typeof window !== 'undefined' ? window : global);
