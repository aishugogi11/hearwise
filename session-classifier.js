/**
 * HearWise — Live session classifier
 * Detects music style from Spotify (track/artist names, audio features,
 * artist genres, and playlist/album context), then maps to session mode
 * using the user's survey preferences.
 */
(function (global) {
  'use strict';

  var STYLE_TAGS = {
    lofi: { label: 'Lofi / beats', keywords: ['lofi', 'lo-fi', 'chillhop', 'study beats', 'lo fi', 'beats to'] },
    classical: { label: 'Classical / piano', keywords: ['classical', 'piano', 'mozart', 'beethoven', 'symphony', 'bach'] },
    ambient: { label: 'Ambient', keywords: ['ambient', 'atmospheric', 'drone', 'soundscape'] },
    instrumental: { label: 'Instrumental / OST', keywords: ['instrumental', 'soundtrack', ' score'] },
    podcast: { label: 'Podcasts / talk', keywords: ['podcast', 'episode', 'talk', 'interview'] },
    edm: { label: 'EDM / electronic', keywords: ['edm', 'electronic', 'house', 'techno', 'trance', 'dubstep'] },
    hiphop: { label: 'Hip-hop / rap', keywords: ['hip hop', 'hip-hop', 'rap', 'trap', 'drill'] },
    rock: { label: 'Rock / metal', keywords: ['rock', 'metal', 'punk', 'grunge'] },
    pop: { label: 'Pop', keywords: ['pop'] },
    indie: { label: 'Indie / alt', keywords: ['indie', 'alternative', 'alt rock'] },
    jazz: { label: 'Jazz / blues', keywords: ['jazz', 'blues', 'swing'] },
    rnb: { label: 'R&B / soul', keywords: ['r&b', 'rnb', 'soul', 'neo soul'] },
    whitenoise: { label: 'White noise / nature', keywords: ['white noise', 'rain sounds', 'ocean sounds', 'thunder'] },
    piano: { label: 'Calm piano / sleep', keywords: ['lullaby', 'sleep music', 'bedtime', 'meditation'] },
    audiobook: { label: 'Audiobooks', keywords: ['audiobook', 'audible', 'chapter'] }
  };

  var GENRE_TO_TAG = [
    { re: /\bpop\b|dance pop|indie pop|k-pop|j-pop|synth-pop|electropop/, tag: 'pop' },
    { re: /hip hop|rap|trap|drill|grime/, tag: 'hiphop' },
    { re: /edm|electro|house|techno|trance|dubstep|drum and bass/, tag: 'edm' },
    { re: /rock|metal|punk|grunge|hard rock/, tag: 'rock' },
    { re: /indie|alternative/, tag: 'indie' },
    { re: /jazz|blues|swing/, tag: 'jazz' },
    { re: /r&b|rnb|soul|neo soul/, tag: 'rnb' },
    { re: /lo-fi|lofi|chillhop|study beats/, tag: 'lofi' },
    { re: /classical|piano|orchestra|symphony/, tag: 'classical' },
    { re: /ambient|new age|meditation/, tag: 'ambient' },
    { re: /soundtrack|score|ost|game/, tag: 'instrumental' },
    { re: /podcast|spoken|audiobook/, tag: 'podcast' },
    { re: /sleep|white noise|nature sounds/, tag: 'whitenoise' }
  ];

  var CONTEXT_PATTERNS = [
    { re: /workout|gym|cardio|run|pump|beast mode|power hour|hiit|training/, tag: 'pop', mode: 'active', weight: 0.88 },
    { re: /sleep|bedtime|night|dream|lullaby|wind down|deep sleep|rest/, tag: 'piano', mode: 'sleep', weight: 0.92 },
    { re: /focus|deep work|concentration|productivity|coding|flow state/, tag: 'lofi', mode: 'focus', weight: 0.88 },
    { re: /study|exam|homework|library|reading|learn/, tag: 'lofi', mode: 'focus', weight: 0.88 },
    { re: /lofi|lo-fi|chillhop|study beats|beats to/, tag: 'lofi', mode: 'focus', weight: 0.9 },
    { re: /top hits|today'?s top|viral|chart|hot hits|mainstream/, tag: 'pop', mode: 'active', weight: 0.85 },
    { re: /pop hits|pop mix|teen pop|dance pop/, tag: 'pop', mode: 'active', weight: 0.88 },
    { re: /hip hop|rap|cypher|bars|trap/, tag: 'hiphop', mode: 'active', weight: 0.85 },
    { re: /edm|electronic|house|techno|club|party|rave|dance/, tag: 'edm', mode: 'active', weight: 0.88 },
    { re: /rock|metal|punk|grunge|alternative rock/, tag: 'rock', mode: 'active', weight: 0.82 },
    { re: /jazz|blues|soul|r&b|rnb/, tag: 'jazz', mode: 'active', weight: 0.8 },
    { re: /classical|piano|orchestra|symphony|instrumental/, tag: 'classical', mode: 'focus', weight: 0.85 },
    { re: /ambient|meditation|calm|spa|nature sounds|white noise|rain sounds/, tag: 'ambient', mode: 'sleep', weight: 0.88 },
    { re: /podcast|talk|spoken|audiobook|story/, tag: 'podcast', mode: 'focus', weight: 0.9 }
  ];

  var MODE_STYLE_MAP = {
    focus: ['lofi', 'classical', 'ambient', 'instrumental', 'podcast'],
    active: ['pop', 'rnb', 'edm', 'hiphop', 'rock', 'indie', 'jazz'],
    sleep: ['whitenoise', 'piano', 'audiobook', 'ambient']
  };

  /**
   * Exact demo songs (title + artist) — checked before genre heuristics.
   * Play these on Spotify for reliable mode switching during demos.
   */
  var DEMO_TRACK_RULES = {
    focus: [
      { title: /^snowman$/i, artist: /\bwys\b/i, label: 'Snowman — WYS' },
      { title: /^snowman$/i, artist: /idealism/i, label: 'Snowman — Idealism' },
      { title: /^her$/i, artist: /idealism/i, label: 'Her — Idealism' },
      { title: /study beats/i, artist: /lofi girl/i, label: 'Study Beats — Lofi Girl' },
      { title: /^5:32pm$/i, artist: null, label: '5:32pm' },
      { title: /^affection$/i, artist: /jinsang/i, label: 'Affection — Jinsang' },
      { title: /^mood$/i, artist: /idealism/i, label: 'Mood — Idealism' },
      { title: /.*/i, artist: /lofi girl/i, label: 'Lofi Girl' },
      { title: /.*/i, artist: /idealism/i, label: 'Idealism' },
      { title: /.*/i, artist: /\bwys\b/i, label: 'WYS' }
    ],
    active: [
      { title: /blinding lights/i, artist: /weeknd/i, label: 'Blinding Lights — The Weeknd' },
      { title: /as it was/i, artist: /harry styles/i, label: 'As It Was — Harry Styles' },
      { title: /espresso/i, artist: /sabrina carpenter/i, label: 'Espresso — Sabrina Carpenter' },
      { title: /^golden$/i, artist: /harry styles/i, label: 'Golden — Harry Styles' }
    ]
  };

  global.SESSION_DEMO_SONGS = {
    focus: [
      'Snowman — WYS',
      'Her — Idealism',
      'Study Beats — Lofi Girl',
      '5:32pm (Lofi Girl playlist)',
      'Any track by Lofi Girl'
    ],
    active: [
      'Blinding Lights — The Weeknd',
      'As It Was — Harry Styles',
      'Espresso — Sabrina Carpenter'
    ],
    quick: ['Any Taylor Swift track']
  };

  var POP_ARTIST_PATTERNS = [
    /harry styles/, /sabrina carpenter/, /olivia rodrigo/, /dua lipa/, /ariana grande/,
    /ed sheeran/, /the weeknd/, /\bweeknd\b/, /billie eilish/, /bruno mars/, /katy perry/,
    /miley cyrus/, /shawn mendes/, /charlie puth/, /post malone/, /doja cat/, /lana del rey/,
    /justin bieber/, /tate mcrae/, /conan gray/, /lewis capaldi/
  ];

  var RNB_ARTIST_PATTERNS = [
    /the weeknd/, /\bweeknd\b/, /\bsza\b/, /frank ocean/, /khalid/, /\bher\b/,
    /summer walker/, /brent faiyaz/, /partynextdoor/, /daniel caesar/, /giveon/,
    /h\.?e\.?r\.?/, /tyla/, /lucky daye/, /snoh aalegra/, /jazmine sullivan/,
    /usher/, /chris brown/, /miguel/, /john legend/, /alicia keys/, /beyonc[eé]/,
    /rihanna/, /d'angelo/, /maxwell/, /erykah badu/, /jill scott/
  ];

  var LOFI_ARTIST_PATTERNS = [
    /lofi girl/, /lo-fi girl/, /lo fi girl/, /chilledcow/, /chillhop music/,
    /tomppabeats/, /idealism/, /\bwys\b/, /j\.?san/, /kudasaibeats/, /eevee/, /saib/,
    /quickly quickly/, /mt\.?\s*argento/, /team astro/, /steezy prime/,
    /bookworm/, /xmichaelanthony/, /drxnk/, /in your eyes/, /potsu/, /jinsang/,
    /softy/, /brconti/, /bassti/, /bluntone/, /josl bee/, /tender spring/,
    /fccpv/, /nohc/, /xander\.?/, /bank on the rain/, /onyx beats/, /lofi sleep/,
    /lofi hip hop/, /lo-fi hip hop/, /chill beats/, /chillhop/, /jazzhop/,
    /sleepless/, /no\s+sleepless/, /ak\.?\s*the\s*debonair/, /flovry/, /tarvelo/,
    /tony romera/, /dryhope/, /morning routine/, /cozy coffee/, /steezy prime/
  ];

  var MODE_LABELS = { focus: 'Focus & Study', active: 'Chill & Workout', sleep: 'Sleep', quick: '1-Min Sprint', studyQuick: '1-Min Focus & Study' };
  var MODES = ['focus', 'active', 'sleep', 'studyQuick'];

  var _contextCache = {};
  var _lastTrackId = null;
  var _inFlight = null;
  var _manualModeLock = null;

  global.SESSION_MUSIC_SURVEY = [
    { mode: 'focus', label: 'Focus & Study', emoji: '🎯', tags: ['lofi', 'classical', 'ambient', 'instrumental', 'podcast'] },
    { mode: 'active', label: 'Chill & Workout', emoji: '🎵', tags: ['pop', 'rnb', 'indie', 'jazz', 'edm', 'hiphop', 'rock'] },
    { mode: 'sleep', label: 'Sleep', emoji: '🌙', tags: ['whitenoise', 'piano', 'ambient', 'audiobook'] }
  ];

  function normalizeMode(mode) {
    if (mode === 'study') return 'focus';
    if (mode === 'chill' || mode === 'workout') return 'active';
    return mode;
  }

  function mergeLegacyPrefs(prefs) {
    if (!prefs) return {};
    prefs = JSON.parse(JSON.stringify(prefs));
    if (prefs.study) {
      prefs.focus = prefs.focus || [];
      prefs.study.forEach(function (tag) {
        if (prefs.focus.indexOf(tag) < 0) prefs.focus.push(tag);
      });
      delete prefs.study;
    }
    if (prefs.chill || prefs.workout) {
      prefs.active = prefs.active || [];
      ['chill', 'workout'].forEach(function (m) {
        (prefs[m] || []).forEach(function (tag) {
          if (prefs.active.indexOf(tag) < 0) prefs.active.push(tag);
        });
      });
      delete prefs.chill;
      delete prefs.workout;
    }
    return prefs;
  }

  function getUserMusicPrefs() {
    try {
      var raw = localStorage.getItem('hearwise_user_profile');
      if (!raw) return {};
      return mergeLegacyPrefs((JSON.parse(raw).sessionMusicPrefs) || {});
    } catch (e) {
      return {};
    }
  }

  function getUserMusicCustom() {
    try {
      var raw = localStorage.getItem('hearwise_user_profile');
      if (!raw) return {};
      return JSON.parse(raw).sessionMusicCustom || {};
    } catch (e) {
      return {};
    }
  }

  function parseCustomEntries(text) {
    return String(text || '').split(/[,;\n]+/).map(function (s) {
      return s.trim().toLowerCase();
    }).filter(Boolean);
  }

  function matchCustomEntries(track, meta, customByMode) {
    var text = trackContextText(track, meta);
    var hits = {};
    MODES.forEach(function (mode) {
      hits[mode] = [];
      parseCustomEntries(customByMode[mode]).forEach(function (entry) {
        if (entry && text.indexOf(entry) >= 0) hits[mode].push(entry);
      });
    });
    return hits;
  }

  function applyCustomModeBoost(modeScores, track, meta, customByMode) {
    var hits = matchCustomEntries(track, meta, customByMode || {});
    var matchedCustom = [];
    MODES.forEach(function (mode) {
      if (hits[mode] && hits[mode].length) {
        modeScores[mode] += 1.55 + hits[mode].length * 0.35;
        hits[mode].forEach(function (entry) {
          if (matchedCustom.indexOf(entry) < 0) matchedCustom.push(entry);
        });
      }
    });
    return matchedCustom;
  }

  function textHasKeyword(text, kw) {
    if (kw === 'pop') return /\bpop\b/.test(text);
    return text.indexOf(kw) >= 0;
  }

  function normalizeDemoTitle(name) {
    return (name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
  }

  function matchDemoTrackRule(track, mode) {
    var rules = DEMO_TRACK_RULES[mode] || [];
    if (!track || !rules.length) return null;
    var title = normalizeDemoTitle(track.name);
    var artist = trackArtistText(track);
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      var titleOk = !rule.title || rule.title.test(title);
      var artistOk = !rule.artist || rule.artist.test(artist);
      if (titleOk && artistOk) return rule;
    }
    return null;
  }

  function buildDemoFocusResult(track, rule, trackName, styleScores, contextSource, features) {
    return {
      mode: 'focus',
      confidence: 0.99,
      reason: rule.label + ' → Focus & Study · "' + trackName + '"',
      scores: { focus: 0.99, active: 0.05 },
      styleScores: styleScores || { lofi: 0.99, _contextSource: contextSource || '' },
      matchedTags: ['lofi'],
      contextSource: contextSource || '',
      focusInstrumental: true,
      lofiFocus: true,
      demoTrack: true
    };
  }

  function buildDemoActiveResult(track, rule, trackName, styleScores, contextSource, features) {
    return {
      mode: 'active',
      confidence: 0.99,
      reason: rule.label + ' → Chill & Workout · "' + trackName + '"',
      scores: { active: 0.99, focus: 0.05 },
      styleScores: styleScores || { pop: 0.99, _contextSource: contextSource || '' },
      matchedTags: ['pop'],
      contextSource: contextSource || '',
      activeListening: true,
      popTrack: true,
      demoTrack: true
    };
  }

  /** Demo-friendly: Taylor Swift → 1-min safe-listening sprint (quick mode). */
  function isTaylorSwiftArtist(name) {
    var n = (name || '').toLowerCase().trim();
    return n.indexOf('taylor swift') >= 0;
  }

  function isTaylorSwiftTrack(track) {
    if (!track) return false;
    var artists = track.artists || [];
    for (var i = 0; i < artists.length; i++) {
      if (isTaylorSwiftArtist(artists[i] && artists[i].name)) return true;
    }
    return isTaylorSwiftArtist(track.artist || '');
  }

  function isTaylorSwiftPlayback(pb) {
    return !!(pb && pb.item && isTaylorSwiftTrack(pb.item));
  }

  /** Demo-friendly: Idealism (lofi producer) → Focus & Study. */
  function isIdealismArtist(name) {
    return (name || '').toLowerCase().trim().indexOf('idealism') >= 0;
  }

  function isIdealismTrack(track) {
    if (!track) return false;
    var artists = track.artists || [];
    for (var i = 0; i < artists.length; i++) {
      if (isIdealismArtist(artists[i] && artists[i].name)) return true;
    }
    return isIdealismArtist(track.artist);
  }

  /** Demo-friendly: WYS (lofi producer) + Snowman → Focus & Study. */
  function isWysArtist(name) {
    var n = (name || '').toLowerCase().trim();
    return n === 'wys' || n === 'wys?' || /\bwys\b/.test(n);
  }

  function isWysTrack(track) {
    if (!track) return false;
    var artists = track.artists || [];
    for (var i = 0; i < artists.length; i++) {
      if (isWysArtist(artists[i] && artists[i].name)) return true;
    }
    return isWysArtist(track.artist);
  }

  function normalizeTrackTitle(name) {
    return (name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
  }

  function isSnowmanByWysTrack(track) {
    if (!track) return false;
    var title = normalizeTrackTitle(track.name);
    if (title !== 'snowman' && !/^snowman\b/.test(title)) return false;
    return isWysTrack(track);
  }

  function isFocusStudyProducerTrack(track) {
    return isIdealismTrack(track) || isWysTrack(track) || isSnowmanByWysTrack(track);
  }

  function focusStudyProducerLabel(track, meta) {
    if (isLofiGirlTrack(track, meta)) return 'Lofi Girl';
    if (isIdealismTrack(track)) return 'Idealism';
    if (isWysTrack(track) || isSnowmanByWysTrack(track)) return 'WYS';
    return 'Lofi';
  }

  function isLofiGirlArtist(name) {
    return /lofi girl|lo-fi girl|lo fi girl|chilledcow/.test((name || '').toLowerCase());
  }

  function isLofiGirlTrack(track, meta) {
    if (!track) return false;
    meta = meta || {};
    var artists = track.artists || [];
    var i;
    for (i = 0; i < artists.length; i++) {
      if (isLofiGirlArtist(artists[i] && artists[i].name)) return true;
    }
    if (track.album && track.album.artists) {
      for (i = 0; i < track.album.artists.length; i++) {
        if (isLofiGirlArtist(track.album.artists[i] && track.album.artists[i].name)) return true;
      }
    }
    var albumName = (track.album && track.album.name) || meta.albumName || '';
    var label = (track.album && track.album.label) || meta.albumLabel || '';
    var blob = (albumName + ' ' + label + ' ' + (meta.playlistName || '')).toLowerCase();
    if (/lofi girl|lo-fi girl|lo fi girl|chilledcow/.test(blob)) return true;
    if (/beats to relax\/study|beats to study|lofi hip hop radio|study to|relax\/study/.test(blob)) return true;
    return false;
  }

  function isLofiPlaylistListening(meta, features, track, genres, styleScores) {
    meta = meta || {};
    if (meta.contextType !== 'playlist') return false;
    if (isPopArtist(trackArtistText(track)) || trackHasPopArtist(track)) return false;
    if (hasPopGenre(genres)) return false;
    if (hasLofiGenre(genres)) return true;
    if ((styleScores.lofi || 0) >= 0.3) return true;
    if (/lofi|lo-fi|chillhop|study|beats to|focus|relax|chilledcow/.test((meta.playlistName || meta.albumName || '').toLowerCase())) {
      return true;
    }
    if (features && isLofiAudioProfile(features, track, genres, styleScores)) return true;
    return false;
  }

  function trackHasPopArtist(track) {
    if (!track) return false;
    var artists = track.artists || [];
    for (var i = 0; i < artists.length; i++) {
      if (isPopArtist(artists[i] && artists[i].name)) return true;
    }
    return isPopArtist(track.artist);
  }

  function isPopArtist(name) {
    var n = (name || '').toLowerCase().trim();
    if (!n) return false;
    for (var i = 0; i < POP_ARTIST_PATTERNS.length; i++) {
      if (POP_ARTIST_PATTERNS[i].test(n)) return true;
    }
    return false;
  }

  function isPopTrack(track, genres, meta, styleScores, features) {
    if (!track) return false;
    if (isTaylorSwiftTrack(track)) return false;
    if (isLofiTrack(track, genres, meta, features, styleScores)) return false;
    styleScores = styleScores || {};
    if ((styleScores.lofi || 0) >= 0.4 || hasLofiGenre(genres)) return false;

    var artists = track.artists || [];
    for (var pi = 0; pi < artists.length; pi++) {
      if (isPopArtist(artists[pi] && artists[pi].name)) return true;
    }
    if (isPopArtist(track.artist)) return true;
    if (isPopDominant(styleScores, genres, track)) return true;
    if (hasPopGenre(genres) && (styleScores.lofi || 0) < 0.35) return true;
    return false;
  }

  function isRnbArtist(name) {
    var n = (name || '').toLowerCase().trim();
    if (!n) return false;
    for (var i = 0; i < RNB_ARTIST_PATTERNS.length; i++) {
      if (RNB_ARTIST_PATTERNS[i].test(n)) return true;
    }
    return false;
  }

  function hasRnbGenre(genres) {
    return (genres || []).some(function (genre) {
      return /r&b|rnb|soul|neo soul|alternative r&b|contemporary r&b/.test(genre.toLowerCase());
    });
  }

  function isRnbTrack(track, genres) {
    if (!track) return false;
    var artists = track.artists || [];
    for (var i = 0; i < artists.length; i++) {
      if (isRnbArtist(artists[i] && artists[i].name)) return true;
    }
    if (isRnbArtist(track.artist)) return true;
    return hasRnbGenre(genres);
  }

  function hasPopGenre(genres) {
    return (genres || []).some(function (genre) {
      return /\bpop\b|dance pop|indie pop|synth-pop|electropop|teen pop|k-pop|j-pop/.test(genre.toLowerCase());
    });
  }

  function isPopDominant(styleScores, genres, track) {
    var pop = (styleScores && styleScores.pop) || 0;
    var rnb = (styleScores && styleScores.rnb) || 0;
    var lofi = (styleScores && styleScores.lofi) || 0;
    if (lofi >= 0.35) return false;
    if (rnb >= 0.5 && rnb >= pop) return false;
    if (trackHasPopArtist(track)) return true;
    if (hasPopGenre(genres) && rnb < 0.45) return true;
    if (pop >= 0.72 && lofi < 0.25) return true;
    return false;
  }

  function isLofiArtist(name) {
    var n = (name || '').toLowerCase().trim();
    if (!n) return false;
    for (var i = 0; i < LOFI_ARTIST_PATTERNS.length; i++) {
      if (LOFI_ARTIST_PATTERNS[i].test(n)) return true;
    }
    return false;
  }

  function hasLofiGenre(genres) {
    return (genres || []).some(function (genre) {
      return /lo-fi|lofi|chillhop|study beats|chill beats|beats to|jazzhop|downtempo|trip hop|instrumental hip hop/.test(genre.toLowerCase());
    });
  }

  function trackArtistText(track) {
    if (!track) return '';
    var names = (track.artists || []).map(function (a) { return (a && a.name) || ''; }).filter(Boolean);
    if (names.length) return names.join(' ').toLowerCase();
    return (track.artist || '').toLowerCase();
  }

  function textLooksLofi(text) {
    if (!text) return false;
    var t = text.toLowerCase();
    var kws = STYLE_TAGS.lofi.keywords;
    for (var i = 0; i < kws.length; i++) {
      if (textHasKeyword(t, kws[i])) return true;
    }
    return /beats to (relax|study|sleep|chill|focus)|study music|focus music|chill beats|relaxing beats|jazzhop|homework beats|lofi hip|lo-fi hip|rainy day beats|late night beats|coffee beats/.test(t);
  }

  function isLofiAudioProfile(features, track, genres, styleScores) {
    if (!features || features.energy == null) return false;
    styleScores = styleScores || {};
    if (isRnbTrack(track, genres) || isPopDominant(styleScores, genres, track)) return false;
    if ((styleScores.pop || 0) >= 0.62 || (styleScores.rnb || 0) >= 0.55) return false;

    var e = features.energy;
    var sp = features.speechiness || 0;
    var d = features.danceability || 0;
    var t = features.tempo || 0;
    var ac = features.acousticness || 0;
    var ins = features.instrumentalness;

    if (sp >= 0.24) return false;

    if ((styleScores.lofi || 0) >= 0.3 || hasLofiGenre(genres)) {
      if (t >= 55 && t <= 125 && e <= 0.72 && sp < 0.2) return true;
    }

    if (t >= 58 && t <= 110 && e >= 0.1 && e <= 0.62 && d >= 0.25 && d <= 0.82 && sp < 0.14) {
      if (ins == null || ins >= 0.08) return true;
    }

    if (e <= 0.45 && sp < 0.1 && ac >= 0.3 && t <= 108) return true;
    return false;
  }

  function isLofiTrack(track, genres, meta, features, styleScores) {
    if (!track) return false;
    meta = meta || {};
    styleScores = styleScores || {};
    if (isLofiGirlTrack(track, meta)) return true;
    if (isIdealismTrack(track) || isWysTrack(track)) return true;
    if (isLofiPlaylistListening(meta, features, track, genres, styleScores)) return true;
    if ((styleScores.lofi || 0) >= 0.35) return true;
    var artists = track.artists || [];
    for (var i = 0; i < artists.length; i++) {
      if (isLofiArtist(artists[i] && artists[i].name)) return true;
    }
    if (isLofiArtist(track.artist)) return true;
    if (hasLofiGenre(genres)) return true;
    var text = [
      track.name || '',
      trackArtistText(track),
      meta.playlistName || '',
      meta.albumName || ''
    ].join(' ');
    if (textLooksLofi(text)) return true;
    if (isLofiAudioProfile(features, track, genres, styleScores) && (hasLofiGenre(genres) || (styleScores.lofi || 0) >= 0.25)) {
      return true;
    }
    return false;
  }

  function isFocusInstrumentalTrack(track, genres, meta, styleScores, features) {
    meta = meta || {};
    styleScores = styleScores || {};
    if (isIdealismTrack(track) || isWysTrack(track)) return true;
    if (isLofiTrack(track, genres, meta, features, styleScores)) return true;
    var text = trackContextText(track, meta);
    if (/instrumental|no vocals|without lyrics|classical|symphony|orchestra|piano solo|soundtrack|game ost|ambient|study beats|chillhop|meditation|white noise|rain sounds/.test(text)) {
      return true;
    }
    var focusStyles = Math.max(
      styleScores.lofi || 0,
      styleScores.classical || 0,
      styleScores.ambient || 0,
      styleScores.instrumental || 0
    );
    var vocalStyles = Math.max(
      styleScores.pop || 0,
      styleScores.rnb || 0,
      styleScores.hiphop || 0,
      styleScores.rock || 0
    );
    if (focusStyles >= 0.45 && focusStyles >= vocalStyles + 0.12) return true;
    if (features && features.instrumentalness != null && features.instrumentalness >= 0.5) return true;
    return false;
  }

  function extractPlaybackContext(pb) {
    if (!pb) return { playlistName: '', albumName: '', albumLabel: '', contextType: '', contextUri: '' };
    var ctx = pb.context || {};
    var item = pb.item || {};
    var album = item.album || {};
    return {
      playlistName: ctx.type === 'playlist' ? (ctx.name || '') : '',
      albumName: album.name || '',
      albumLabel: album.label || '',
      contextType: ctx.type || '',
      contextUri: ctx.uri || ''
    };
  }

  var _playlistNameCache = {};

  function playlistIdFromUri(uri) {
    if (!uri || uri.indexOf('spotify:playlist:') !== 0) return '';
    return uri.split(':').pop();
  }

  function fetchPlaylistName(playlistId) {
    if (!playlistId) return Promise.resolve('');
    if (_playlistNameCache[playlistId]) return Promise.resolve(_playlistNameCache[playlistId]);
    return fetch('/api/spotify/playlist/' + encodeURIComponent(playlistId) + '/name', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (data) {
        var name = (data && data.name) || '';
        if (name) _playlistNameCache[playlistId] = name;
        return name;
      })
      .catch(function () { return ''; });
  }

  function enrichPlaybackMeta(pb) {
    var meta = extractPlaybackContext(pb);
    var pid = playlistIdFromUri(meta.contextUri);
    if (!pid || meta.playlistName) return Promise.resolve(meta);
    return fetchPlaylistName(pid).then(function (name) {
      if (name) meta.playlistName = name;
      return meta;
    });
  }

  function detectContextStyleScores(meta) {
    meta = meta || {};
    var text = ((meta.playlistName || '') + ' ' + (meta.albumName || '')).toLowerCase();
    if (!text.trim()) return { scores: {}, modeHints: {}, source: '' };

    var scores = {};
    var modeHints = {};
    var source = meta.playlistName || meta.albumName || '';

    function boost(tag, amount) {
      scores[tag] = Math.min(1, Math.max(scores[tag] || 0, amount));
    }

    CONTEXT_PATTERNS.forEach(function (row) {
      if (row.re.test(text)) {
        boost(row.tag, row.weight);
        if (row.mode) modeHints[row.mode] = Math.max(modeHints[row.mode] || 0, row.weight);
      }
    });

    Object.keys(STYLE_TAGS).forEach(function (tag) {
      STYLE_TAGS[tag].keywords.forEach(function (kw) {
        if (textHasKeyword(text, kw)) boost(tag, 0.72);
      });
    });

    return { scores: scores, modeHints: modeHints, source: source };
  }

  function detectStyleScores(track, features, genres, meta) {
    var trackName = (track.name || '').toLowerCase();
    var artistName = ((track.artists && track.artists[0] && track.artists[0].name) || track.artist || '').toLowerCase();
    var text = trackName + ' ' + artistName;
    var scores = {};
    var contextInfo = detectContextStyleScores(meta);

    function boost(tag, amount) {
      scores[tag] = Math.min(1, Math.max(scores[tag] || 0, amount));
    }

    Object.keys(contextInfo.scores).forEach(function (tag) {
      boost(tag, contextInfo.scores[tag]);
    });

    Object.keys(STYLE_TAGS).forEach(function (tag) {
      STYLE_TAGS[tag].keywords.forEach(function (kw) {
        if (textHasKeyword(text, kw)) boost(tag, 0.55);
      });
    });

    (genres || []).forEach(function (genre) {
      var g = genre.toLowerCase();
      GENRE_TO_TAG.forEach(function (row) {
        if (row.re.test(g)) boost(row.tag, 0.88);
      });
    });

    if (features && features.energy != null) {
      var e = features.energy;
      var d = features.danceability || 0;
      var t = features.tempo || 0;
      var ac = features.acousticness || 0;
      var sp = features.speechiness || 0;
      var ins = features.instrumentalness || 0;

      if (e >= 0.72 && t >= 118 && d >= 0.62) boost('edm', 0.82);
      if (e >= 0.68 && d >= 0.58 && sp < 0.35) boost('pop', 0.78);
      if (e >= 0.35 && e <= 0.82 && d >= 0.42 && sp < 0.38 && t >= 85) boost('pop', 0.72);
      if (e >= 0.55 && t >= 100 && d >= 0.5 && sp < 0.33) boost('pop', Math.max(scores.pop || 0, 0.68));
      if (e >= 0.62 && d >= 0.55 && sp >= 0.08 && sp <= 0.45) boost('hiphop', 0.7);
      if (e >= 0.55 && ins < 0.25 && t >= 110) boost('rock', 0.65);
      if (e >= 0.28 && e <= 0.55 && d >= 0.35 && d <= 0.65 && sp < 0.12) boost('indie', 0.6);
      if (ins >= 0.55 && e <= 0.45 && sp < 0.08) boost('lofi', 0.72);
      if (ins >= 0.45 && e <= 0.4) boost('classical', 0.65);
      if (sp >= 0.5) boost('podcast', 0.85);

      if (e < 0.22 && t < 75 && ac > 0.55 && d < 0.25) boost('whitenoise', 0.75);
      if (e < 0.28 && t < 88 && ac > 0.45 && /sleep|lullaby|night|dream|bedtime/.test(text)) boost('piano', 0.8);
    }

    if (/workout|gym|run|cardio|pump/.test(text)) boost('edm', 0.7);
    if (/study|exam|homework|focus/.test(text)) boost('lofi', 0.65);

    var artists = track.artists || [];
    for (var ai = 0; ai < artists.length; ai++) {
      if (isRnbArtist(artists[ai] && artists[ai].name)) boost('rnb', 0.96);
    }
    if (isRnbArtist(track.artist)) boost('rnb', 0.96);

    for (var ai2 = 0; ai2 < artists.length; ai2++) {
      if (isIdealismArtist(artists[ai2] && artists[ai2].name)) boost('lofi', 0.98);
    }
    if (isIdealismArtist(track.artist)) boost('lofi', 0.98);
    for (var wi = 0; wi < artists.length; wi++) {
      if (isWysArtist(artists[wi] && artists[wi].name)) boost('lofi', 0.98);
    }
    if (isWysArtist(track.artist)) boost('lofi', 0.98);
    if (isLofiGirlTrack(track, meta)) boost('lofi', 0.99);
    for (var pj = 0; pj < artists.length; pj++) {
      if (isPopArtist(artists[pj] && artists[pj].name)) boost('pop', 0.96);
    }
    if (isPopArtist(track.artist)) boost('pop', 0.96);

    scores._contextSource = contextInfo.source;
    scores._modeHints = contextInfo.modeHints;
    return scores;
  }

  function resolveMode(styleScores, prefs, customByMode, track, meta) {
    var modeScores = { focus: 0, active: 0, sleep: 0 };
    var hasPrefs = MODES.some(function (m) {
      return (prefs[m] && prefs[m].length) || parseCustomEntries((customByMode || {})[m]).length;
    });
    var matchedTags = [];

    var modeHints = styleScores._modeHints || {};
    Object.keys(modeHints).forEach(function (mode) {
      modeScores[mode] += modeHints[mode] * 0.95;
    });

    Object.keys(styleScores).forEach(function (tag) {
      if (tag.charAt(0) === '_') return;
      var strength = styleScores[tag];
      if (strength < 0.22) return;
      matchedTags.push(tag);

      MODES.forEach(function (mode) {
        if ((prefs[mode] || []).indexOf(tag) >= 0) {
          modeScores[mode] += strength * 1.35 + 0.45;
        }
      });

      MODES.forEach(function (mode) {
        if ((MODE_STYLE_MAP[mode] || []).indexOf(tag) >= 0) {
          modeScores[mode] += strength * (hasPrefs ? 0.4 : 0.85);
        }
      });
    });

    var sleepStyles = Math.max(styleScores.whitenoise || 0, styleScores.piano || 0, styleScores.audiobook || 0);
    var activeStyles = Math.max(styleScores.pop || 0, styleScores.edm || 0, styleScores.rock || 0, styleScores.hiphop || 0, styleScores.indie || 0);

    if (activeStyles > 0.35 && sleepStyles < 0.5) {
      modeScores.sleep *= 0.03;
    } else if (sleepStyles < 0.4) {
      modeScores.sleep *= 0.12;
    }

    if (!matchedTags.length) {
      modeScores.focus = 0.25;
      modeScores.active = 0.25;
    }

    var lofiStrength = styleScores.lofi || 0;
    var popStrength = styleScores.pop || 0;
    var rnbStrength = styleScores.rnb || 0;
    if (lofiStrength >= 0.45) {
      modeScores.focus += 1.4;
      modeScores.active *= 0.45;
    } else if (rnbStrength >= 0.45 || popStrength >= 0.45) {
      modeScores.active += 1.35;
    }

    var best = 'active';
    var bestScore = 0;
    MODES.forEach(function (mode) {
      if (modeScores[mode] > bestScore) {
        bestScore = modeScores[mode];
        best = mode;
      }
    });

    var matchedCustom = track ? applyCustomModeBoost(modeScores, track, meta, customByMode) : [];
    if (matchedCustom.length) {
      MODES.forEach(function (mode) {
        if (modeScores[mode] > bestScore) {
          bestScore = modeScores[mode];
          best = mode;
        }
      });
    }

    return {
      mode: normalizeMode(best),
      confidence: Math.min(0.98, bestScore),
      modeScores: modeScores,
      matchedTags: matchedTags,
      matchedCustom: matchedCustom
    };
  }

  function buildReason(mode, trackName, prefs, matchedTags, contextSource, matchedCustom) {
    var fromPlaylist = contextSource ? ' · from "' + contextSource + '"' : '';
    if (matchedCustom && matchedCustom.length) {
      return 'Your picks (' + matchedCustom.slice(0, 3).join(', ') + ') → ' +
        (MODE_LABELS[mode] || mode) + fromPlaylist + ' · "' + trackName + '"';
    }
    var userTags = (prefs[mode] || []).filter(function (t) { return matchedTags.indexOf(t) >= 0; });
    if (userTags.length) {
      var labels = userTags.map(function (t) { return STYLE_TAGS[t] ? STYLE_TAGS[t].label : t; });
      return 'Your ' + (MODE_LABELS[mode] || mode) + ' picks (' + labels.join(', ') + ')' + fromPlaylist + ' · "' + trackName + '"';
    }
    if (matchedTags.length) {
      var detected = matchedTags.map(function (t) { return STYLE_TAGS[t] ? STYLE_TAGS[t].label : t; });
      return 'Detected ' + detected.slice(0, 2).join(', ') + ' → ' + (MODE_LABELS[mode] || mode) + fromPlaylist + ' · "' + trackName + '"';
    }
    return (MODE_LABELS[mode] || mode) + ' session' + fromPlaylist + ' · "' + trackName + '"';
  }

  function isStudyFocusTrack(track, meta) {
    meta = meta || {};
    var text = trackContextText(track, meta);
    return /study|exam|homework|library|deep work|concentration|reading|learn/.test(text);
  }

  /** Lofi → Focus & Study; pop → Chill & Workout. */
  function trackContextText(track, meta) {
    meta = meta || {};
    return [
      track.name || '',
      trackArtistText(track),
      meta.playlistName || '',
      meta.albumName || ''
    ].join(' ').toLowerCase();
  }

  function isSleepTrack(track, genres, meta, styleScores, features) {
    styleScores = styleScores || {};
    meta = meta || {};
    var modeHints = styleScores._modeHints || {};
    var sleepStyles = Math.max(styleScores.whitenoise || 0, styleScores.piano || 0, styleScores.ambient || 0);
    if ((modeHints.sleep || 0) >= 0.82) return true;
    if (sleepStyles >= 0.62) return true;
    var text = trackContextText(track, meta);
    if (/sleep|bedtime|lullaby|white noise|rain sounds|ocean sounds|weightless|wind down|deep sleep/.test(text)) return true;
    if (features && features.energy != null) {
      var e = features.energy;
      var t = features.tempo || 0;
      var ac = features.acousticness || 0;
      if (e < 0.22 && t < 75 && ac > 0.5 && /sleep|rain|night|dream|ambient|calm/.test(text)) return true;
    }
    return false;
  }

  /**
   * Returns true when the track has singing/vocals, false when instrumental/no vocals,
   * or null when unknown (before audio features load).
   */
  function detectHasVocals(track, features, genres, meta, styleScores) {
    styleScores = styleScores || {};
    meta = meta || {};

    if (isFocusInstrumentalTrack(track, genres, meta, styleScores, features)) {
      return false;
    }

    var text = trackContextText(track, meta);

    if (/feat\.|featuring|vocal version|acoustic version/.test(text) && !/instrumental/.test(text)) {
      return true;
    }

    if (features) {
      var ins = features.instrumentalness;
      var sp = features.speechiness || 0;
      if (ins != null) {
        if (ins >= 0.45) return false;
        if (isLofiAudioProfile(features, track, genres, styleScores)) return false;
        if (ins <= 0.12 && sp < 0.33) return true;
        if (sp >= 0.45) return false;
        return ins < 0.28 && sp >= 0.18;
      }
      if (sp >= 0.5) return false;
    }

    if (isRnbTrack(track, genres) || (styleScores.rnb || 0) >= 0.45) return true;
    if (isPopDominant(styleScores, genres, track) || (styleScores.pop || 0) >= 0.55) return true;
    if ((styleScores.hiphop || 0) >= 0.55 && (styleScores.lofi || 0) < 0.35 && !hasLofiGenre(genres)) return true;
    if ((styleScores.rock || 0) >= 0.55) return true;

    return null;
  }

  function resolvedInstrumentalTags(styleScores) {
    var tags = ['lofi', 'classical', 'ambient', 'instrumental', 'podcast'];
    return tags.filter(function (t) { return (styleScores[t] || 0) >= 0.35; }).slice(0, 3);
  }

  function resolvedVocalTags(styleScores, genres, track) {
    var tags = [];
    if ((styleScores.rnb || 0) >= 0.4 || isRnbTrack(track, genres)) tags.push('rnb');
    if ((styleScores.pop || 0) >= 0.4 || isPopDominant(styleScores, genres, track)) tags.push('pop');
    ['hiphop', 'rock', 'edm', 'indie', 'jazz'].forEach(function (t) {
      if ((styleScores[t] || 0) >= 0.4) tags.push(t);
    });
    return tags.length ? tags.slice(0, 3) : ['pop'];
  }

  function classifyTrack(track, features, prefs, genres, meta) {
    prefs = prefs || getUserMusicPrefs();
    var trackName = track.name || '';

    if (isTaylorSwiftTrack(track)) {
      return {
        mode: 'quick',
        confidence: 0.99,
        reason: 'Taylor Swift · 1-min safe-listening sprint, then a 5-min ear rest · "' + trackName + '"',
        scores: { quick: 0.99 },
        styleScores: { pop: 0.85, _contextSource: '' },
        matchedTags: ['pop'],
        contextSource: '',
        taylorSwiftSprint: true
      };
    }

    var demoFocus = matchDemoTrackRule(track, 'focus');
    if (demoFocus) {
      return buildDemoFocusResult(track, demoFocus, trackName, null, '', null);
    }

    var demoActive = matchDemoTrackRule(track, 'active');
    if (demoActive) {
      return buildDemoActiveResult(track, demoActive, trackName, null, '', null);
    }

    var styleScores = detectStyleScores(track, features, genres, meta);
    var contextSource = styleScores._contextSource || '';

    if (isSleepTrack(track, genres, meta, styleScores, features)) {
      return {
        mode: 'sleep',
        confidence: 0.9,
        reason: 'Sleep / calm audio → Sleep session · "' + trackName + '"',
        scores: { sleep: 0.9, focus: 0.12 },
        styleScores: styleScores,
        matchedTags: ['piano', 'whitenoise', 'ambient'].filter(function (t) { return (styleScores[t] || 0) >= 0.4; }),
        contextSource: contextSource,
        sleepTrack: true
      };
    }

    if (isLofiTrack(track, genres, meta, features, styleScores)) {
      if (isStudyFocusTrack(track, meta)) {
        return {
          mode: 'studyQuick',
          confidence: 0.92,
          reason: 'Lofi study · 1-min Focus & Study sprint, then 5-min ear rest · "' + trackName + '"',
          scores: { studyQuick: 0.92, focus: 0.75 },
          styleScores: styleScores,
          matchedTags: ['lofi'],
          contextSource: contextSource,
          studyQuickSprint: true
        };
      }
      var lofiLabel = focusStudyProducerLabel(track, meta);
      var lofiReason = lofiLabel !== 'Lofi' ? (lofiLabel + ' → Focus & Study') : 'Lofi → Focus & Study';
      return {
        mode: 'focus',
        confidence: features ? 0.96 : 0.88,
        reason: lofiReason + ' · "' + trackName + '"',
        scores: { focus: features ? 0.96 : 0.88, active: 0.1 },
        styleScores: styleScores,
        matchedTags: ['lofi'],
        contextSource: contextSource,
        focusInstrumental: true,
        lofiFocus: true,
        lofiGirlFocus: isLofiGirlTrack(track, meta)
      };
    }

    if (isPopTrack(track, genres, meta, styleScores, features)) {
      return {
        mode: 'active',
        confidence: features ? 0.94 : 0.82,
        reason: 'Pop → Chill & Workout · "' + trackName + '"',
        scores: { active: features ? 0.94 : 0.82, focus: 0.1 },
        styleScores: styleScores,
        matchedTags: ['pop'],
        contextSource: contextSource,
        activeListening: true,
        popTrack: true
      };
    }

    var custom = getUserMusicCustom();
    var resolved = resolveMode(styleScores, prefs, custom, track, meta);
    return {
      mode: resolved.mode,
      confidence: resolved.confidence,
      reason: buildReason(resolved.mode, trackName, prefs, resolved.matchedTags, contextSource, resolved.matchedCustom),
      scores: resolved.modeScores,
      styleScores: styleScores,
      matchedTags: resolved.matchedTags,
      matchedCustom: resolved.matchedCustom,
      contextSource: contextSource
    };
  }

  function fetchTrackContext(trackId, artistId) {
    var cacheKey = trackId + ':' + (artistId || '');
    if (_contextCache[cacheKey]) return Promise.resolve(_contextCache[cacheKey]);
    var url = '/api/spotify/track-context/' + encodeURIComponent(trackId);
    if (artistId) url += '?artistId=' + encodeURIComponent(artistId);
    return fetch(url, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : { features: null, genres: [] }; })
      .then(function (data) {
        var ctx = { features: data.features || null, genres: data.genres || [] };
        _contextCache[cacheKey] = ctx;
        return ctx;
      })
      .catch(function () { return { features: null, genres: [] }; });
  }

  function getCurrentMode(store) {
    if (store && store.active && store.active.mode) return normalizeMode(store.active.mode);
    try {
      var raw = localStorage.getItem('hearwise_ls_' + new Date().toISOString().split('T')[0]);
      if (raw) {
        var s = JSON.parse(raw);
        if (s.active && s.active.mode) return normalizeMode(s.active.mode);
        if (s.defaultMode) return normalizeMode(s.defaultMode);
      }
    } catch (e) { /* ignore */ }
    return 'active';
  }

  function applyDetectedMode(result, store, opts) {
    opts = opts || {};
    if (!result || !result.mode) return false;
    if (typeof global.hwLsSetMode !== 'function') return false;
    if (store && store.active && store.active.modeManual && !opts.manual) return false;

    var current = getCurrentMode(store);
    var modeChanged = result.mode !== current;
    var isTaylorSprint = !!result.taylorSwiftSprint;

    if (!modeChanged && !opts.force && !isTaylorSprint) return false;

    var resetSprint = modeChanged || isTaylorSprint || !!opts.isNewSession;
    global.hwLsSetMode(result.mode, { auto: true, resetSprint: resetSprint });

    if (typeof global.hwLsSetDetectedMeta === 'function') {
      global.hwLsSetDetectedMeta({
        mode: result.mode,
        reason: result.reason,
        confidence: Math.round(result.confidence * 100),
        trackName: result.trackName,
        matchedTags: result.matchedTags
      });
    }

    var shouldNotify = modeChanged || (isTaylorSprint && (opts.isNewSession || opts.isNewTrack || opts.force)) ||
      ((result.lofiFocus || result.popTrack) && !!opts.isNewTrack);

    if (typeof global.showXpToast === 'function' && shouldNotify) {
      if (result.mode === 'quick' || isTaylorSprint) {
        global.showXpToast(0, '⚡ Taylor Swift → 1-min safe-listening sprint');
      } else if (result.mode === 'studyQuick' || result.studyQuickSprint) {
        global.showXpToast(0, '📚 1-Min Focus & Study sprint');
      } else if (result.lofiFocus || result.focusInstrumental) {
        var focusLabel = '🎯 Lofi → Focus & Study session';
        if (result.reason) {
          if (result.reason.indexOf('Lofi Girl') >= 0 || result.lofiGirlFocus) focusLabel = '🎯 Lofi Girl → Focus & Study session';
          else if (result.reason.indexOf('Idealism') >= 0) focusLabel = '🎯 Idealism → Focus & Study session';
          else if (result.reason.indexOf('WYS') >= 0) focusLabel = '🎯 WYS → Focus & Study session';
        }
        global.showXpToast(0, focusLabel);
      } else if (result.activeListening || result.popTrack) {
        global.showXpToast(0, '🎵 Pop → Chill & Workout session');
      } else {
        global.showXpToast(0, '🎵 Switched to ' + (MODE_LABELS[result.mode] || result.mode) + ' from your music');
      }
    }

    if ((result.mode === 'quick' || isTaylorSprint) && shouldNotify && typeof global.auraCoachSay === 'function') {
      global.auraCoachSay(
        'Taylor Swift detected — starting a <strong>1-minute safe-listening sprint</strong>. ' +
        'When the minute is up, I\'ll start a <strong>5-minute ear rest</strong>. Keep volume in the green.',
        [{ label: 'Got it', _back: false }]
      );
      if (typeof global.auraTogglePanel === 'function') global.auraTogglePanel(true);
    }

    if ((result.mode === 'studyQuick' || result.studyQuickSprint) && modeChanged && typeof global.auraCoachSay === 'function') {
      global.auraCoachSay(
        'Study / focus music detected — starting a <strong>1-minute Focus & Study sprint</strong>. ' +
        'When the minute is up, I\'ll start a <strong>5-minute ear rest</strong>. Keep volume under 60%.',
        [{ label: 'Got it', _back: false }]
      );
      if (typeof global.auraTogglePanel === 'function') global.auraTogglePanel(true);
    }

    if (typeof global.hwLsRenderAll === 'function') global.hwLsRenderAll();
    return true;
  }

  function runClassification(pb, store, opts) {
    opts = opts || {};
    if (!pb || !pb.item || !pb.is_playing) return;

    var trackId = pb.item.id;
    if (!trackId) return;

    var artistId = pb.item.artists && pb.item.artists[0] && pb.item.artists[0].id;
    var prefs = getUserMusicPrefs();

    if (_inFlight === trackId && !opts.force) return;
    _inFlight = trackId;

    enrichPlaybackMeta(pb).then(function (playbackMeta) {
      var syncResult = classifyTrack(pb.item, null, prefs, [], playbackMeta);
      syncResult.trackName = pb.item.name || '';
      applyDetectedMode(syncResult, store, { force: true, isNewSession: !!opts.isNewSession, isNewTrack: !!opts.isNewTrack });

      return fetchTrackContext(trackId, artistId).then(function (ctx) {
        if (isTaylorSwiftTrack(pb.item)) {
          _inFlight = null;
          return;
        }
        var refined = classifyTrack(pb.item, ctx.features, prefs, ctx.genres, playbackMeta);
        refined.trackName = pb.item.name || '';
        applyDetectedMode(refined, store, { force: true, isNewTrack: !!opts.isNewTrack });
        _inFlight = null;
      });
    }).catch(function () {
      _inFlight = null;
    });
  }

  function syncClassifyTrack(track, pb) {
    if (!track) return null;
    var prefs = getUserMusicPrefs();
    var meta = pb ? extractPlaybackContext(pb) : {};
    var result = classifyTrack(track, null, prefs, [], meta);
    result.trackName = track.name || '';
    return result;
  }

  function onTrackFromPlayback(pb, store, opts) {
    opts = opts || {};
    if (!pb || !pb.item || !pb.is_playing) return;

    var trackId = pb.item.id;
    if (!trackId) return;

    var isNewTrack = trackId !== _lastTrackId;
    var isTS = isTaylorSwiftTrack(pb.item);

    if (!opts.force && !isNewTrack) {
      if (isTS && getCurrentMode(store) !== 'quick') {
        opts.force = true;
      } else {
        return;
      }
    }

    _lastTrackId = trackId;
    runClassification(pb, store, Object.assign({}, opts, { isNewTrack: isNewTrack }));
  }

  global.hwSessionClassifierClassify = classifyTrack;
  global.hwSessionClassifierSync = syncClassifyTrack;
  global.hwSessionClassifierOnTrack = onTrackFromPlayback;
  global.hwIsTaylorSwiftPlayback = isTaylorSwiftPlayback;
  global.hwIsLofiGirlTrack = isLofiGirlTrack;
  global.hwIsIdealismTrack = isIdealismTrack;
  global.hwIsWysTrack = isWysTrack;
  global.hwIsSnowmanByWysTrack = isSnowmanByWysTrack;
  global.hwIsPopTrack = isPopTrack;
  global.hwSessionClassifierMarkManual = function (mode) {
    _manualModeLock = normalizeMode(mode || 'active');
  };
  global.hwSessionClassifierClearManual = function () {
    _manualModeLock = null;
  };
  global.SESSION_STYLE_TAGS = STYLE_TAGS;

})(typeof window !== 'undefined' ? window : global);
