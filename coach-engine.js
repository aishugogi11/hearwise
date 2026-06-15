/**
 * HearWise Coach Engine — data-driven insights from profile + hearing-future prediction.
 * Wellness tool only; not medical diagnosis.
 */

function round1(n) {
  return Math.round(n * 10) / 10;
}

function profileId(profile) {
  return typeof profile === 'string' ? profile : profile && profile.id;
}

/** Infer hour bucket from session label (demo sessions use descriptive labels). */
function inferTimeBucket(label) {
  const t = (label || '').toLowerCase();
  if (/late|night|midnight|10 pm|11 pm|after 10/.test(t)) return 'night';
  if (/morning|commute|am\b/.test(t)) return 'morning';
  if (/gym|workout|afternoon/.test(t)) return 'afternoon';
  if (/study|library|focus/.test(t)) return 'study';
  if (/gaming|game|stream/.test(t)) return 'gaming';
  if (/evening|unwind|party/.test(t)) return 'evening';
  return 'general';
}

/**
 * Behavioral pattern detection from session rows.
 */
function analyzeListeningPatterns(profile) {
  const sessions = (profile.listeningData && profile.listeningData.sessions) || [];
  const totals = profile.listeningData && profile.listeningData.totals;
  const patterns = [];

  if (!sessions.length) {
    return {
      patterns: [{ id: 'no_data', title: 'No session data yet', detail: 'Connect Spotify or choose a listening profile to analyze habits.' }],
      peakSession: null,
      riskyMinutes: 0,
      nightMinutes: 0,
      weekdayDose: 0,
      weekendDose: 0
    };
  }

  let peakSession = sessions[0];
  let riskyMinutes = 0;
  let nightMinutes = 0;
  let weekdayMinutes = 0;
  let weekendMinutes = 0;
  const bucketMinutes = { night: 0, morning: 0, study: 0, gaming: 0, evening: 0, afternoon: 0, general: 0 };
  const dayDose = {};

  sessions.forEach((s) => {
    if (s.peakDb > (peakSession.peakDb || 0) || (s.avgDb > peakSession.avgDb && s.minutes >= peakSession.minutes)) {
      peakSession = s;
    }
    if (s.avgDb >= 85 || s.peakDb >= 85) riskyMinutes += s.minutes;
    const bucket = inferTimeBucket(s.label);
    bucketMinutes[bucket] += s.minutes;
    if (bucket === 'night') nightMinutes += s.minutes;

    const day = s.day || 'Mon';
    dayDose[day] = (dayDose[day] || 0) + s.minutes * (s.avgDb / 80);
    if (day === 'Sat' || day === 'Sun') weekendMinutes += s.minutes;
    else weekdayMinutes += s.minutes;
  });

  const totalMin = totals ? totals.weeklyMinutes : sessions.reduce((a, s) => a + s.minutes, 0);
  const nightPct = totalMin > 0 ? Math.round((nightMinutes / totalMin) * 100) : 0;
  const riskyPct = totalMin > 0 ? Math.round((riskyMinutes / totalMin) * 100) : 0;

  if (nightPct >= 25) {
    patterns.push({
      id: 'night_listening',
      title: 'Late-night listening cluster',
      detail:
        nightPct +
        '% of your weekly listening happens in late-night or study-after-dark sessions — when volume tends to creep up.',
      severity: nightPct >= 40 ? 'high' : 'medium'
    });
  }

  if (riskyPct >= 15) {
    patterns.push({
      id: 'above_85',
      title: 'Time above 85 dB',
      detail:
        formatMinutes(riskyMinutes) +
        ' this week (' +
        riskyPct +
        '% of listening) at levels where safe exposure time drops quickly.',
      severity: riskyPct >= 35 ? 'high' : 'medium'
    });
  }

  const topBucket = Object.entries(bucketMinutes).sort((a, b) => b[1] - a[1])[0];
  if (topBucket && topBucket[1] > totalMin * 0.3) {
    const labels = {
      study: 'Study / focus sessions',
      gaming: 'Gaming sessions',
      morning: 'Morning commutes',
      night: 'Late-night sessions',
      gym: 'Gym workouts',
      evening: 'Evening listening',
      afternoon: 'Afternoon sessions',
      general: 'General listening'
    };
    patterns.push({
      id: 'context_dominant',
      title: labels[topBucket[0]] + ' drive most exposure',
      detail:
        Math.round((topBucket[1] / totalMin) * 100) +
        '% of your weekly minutes happen during "' +
        (labels[topBucket[0]] || topBucket[0]) +
        '" — the best place to start habit changes.',
      severity: 'medium'
    });
  }

  if (weekendMinutes > 0 && weekdayMinutes > 0) {
    const weekendAvgDb =
      sessions.filter((s) => s.day === 'Sat' || s.day === 'Sun').reduce((a, s) => a + s.avgDb, 0) /
      Math.max(1, sessions.filter((s) => s.day === 'Sat' || s.day === 'Sun').length);
    const weekdayAvgDb =
      sessions.filter((s) => s.day !== 'Sat' && s.day !== 'Sun').reduce((a, s) => a + s.avgDb, 0) /
      Math.max(1, sessions.filter((s) => s.day !== 'Sat' && s.day !== 'Sun').length);
    if (Math.abs(weekendAvgDb - weekdayAvgDb) >= 4) {
      const safer = weekendAvgDb < weekdayAvgDb ? 'weekends' : 'weekdays';
      patterns.push({
        id: 'weekend_weekday',
        title: safer.charAt(0).toUpperCase() + safer.slice(1) + ' are safer for your ears',
        detail:
          'Weekend listening averages ' +
          round1(weekendAvgDb) +
          ' dB vs weekday ' +
          round1(weekdayAvgDb) +
          ' dB. Copy your safer pattern to high-exposure days.',
        severity: 'low'
      });
    }
  }

  if (peakSession) {
    patterns.push({
      id: 'peak_session',
      title: 'Highest-risk session: ' + peakSession.label,
      detail:
        peakSession.day +
        ' — ' +
        formatMinutes(peakSession.minutes) +
        ' at ~' +
        peakSession.avgDb +
        ' dB (peak ' +
        peakSession.peakDb +
        ' dB). Target this block first.',
      severity: peakSession.avgDb >= 85 ? 'high' : 'medium'
    });
  }

  const avgSessionMin = totalMin / Math.max(1, sessions.length);
  const longSessions = sessions.filter(function(s) { return (s.minutes || 0) >= 60; });
  if (avgSessionMin >= 50 || longSessions.length >= 2) {
    patterns.push({
      id: 'long_sessions',
      title: 'Long session pattern detected',
      detail:
        'Average session is ' +
        Math.round(avgSessionMin) +
        ' min (' +
        longSessions.length +
        ' session' +
        (longSessions.length === 1 ? '' : 's') +
        ' ≥ 60 min). WHO/NIOSH guidance: cap continuous listening at 45–60 min with silence breaks.',
      severity: avgSessionMin >= 75 ? 'high' : 'medium'
    });
  }

  return {
    patterns: patterns.slice(0, 4),
    peakSession,
    riskyMinutes,
    nightMinutes,
    weekdayMinutes,
    weekendMinutes,
    nightPct,
    riskyPct
  };
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}

/**
 * Trend + projection insights (uses hearing-future engine output).
 */
function generateTrendInsights(profile, prediction) {
  const hf = prediction && prediction.hearingFuture;
  const inp = prediction && prediction.inputs;
  const insights = [];

  if (!hf || !inp) return insights;

  const y1 = hf.projections && hf.projections.year1;
  const y5 = hf.projections && hf.projections.year5;
  const scoreNow = hf.currentHealthScore;
  const vol = inp.volume;
  const dose = inp.weeklyDosePercent;

  const volTrendPct = profileId(profile) === 'highRisk' ? 12 : profileId(profile) === 'student' ? 8 : profileId(profile) === 'safe' ? -6 : 0;
  if (volTrendPct !== 0) {
    insights.push({
      type: 'trend',
      headline:
        (volTrendPct > 0 ? 'Volume trend is rising' : 'Volume trend is improving') +
        ' (' +
        (volTrendPct > 0 ? '+' : '') +
        volTrendPct +
        '% vs prior week)',
      body:
        volTrendPct > 0
          ? 'At this pace, your weekly dose could push further above safe limits within a month unless you turn down one step on high-exposure days.'
          : 'Your recent volume pattern is moving in a protective direction — keep breaks consistent to hold the gain.',
      severity: volTrendPct > 0 ? 'warn' : 'good'
    });
  }

  if (y1 && y5) {
    const delta1 = y1.projectedHealthScore - scoreNow;
    insights.push({
      type: 'forecast',
      headline: '1-year wellness score outlook: ' + y1.projectedHealthScore + '/100',
      body:
        delta1 >= 0
          ? 'If habits stay the same, your score may hold near ' + y1.projectedHealthScore + '/100 over the next year.'
          : 'If habits stay the same, your score may fall to ' + y1.projectedHealthScore + '/100 within a year (from ' + scoreNow + '/100 today).',
      severity: delta1 >= -5 ? 'neutral' : 'warn'
    });
    insights.push({
      type: 'forecast',
      headline: '5-year wellness score outlook: ' + y5.projectedHealthScore + '/100',
      body:
        'Long-term drift at ' +
        dose +
        '% weekly dose projects a score of ' +
        y5.projectedHealthScore +
        '/100 in five years — prevention works best when you act before the score drops.',
      severity: y5.projectedHealthScore < 50 ? 'warn' : 'neutral'
    });
  }

  if (hf.hearingAge) {
    const ha = hf.hearingAge;
    insights.push({
      type: 'hearing_age',
      headline: 'Hearing Age: ' + ha.hearingAge + ' years (you are ' + ha.chronologicalAge + ')',
      body: ha.plainSummary,
      severity: ha.ageOffset <= 2 ? 'good' : ha.ageOffset <= 10 ? 'warn' : 'warn'
    });
  }

  return insights;
}

/**
 * Primary insight for home dashboard (single best insight).
 */
function generatePrimaryInsight(profile, prediction) {
  const analysis = analyzeListeningPatterns(profile);
  const trends = generateTrendInsights(profile, prediction);
  const pid = profileId(profile);
  const hf = prediction && prediction.hearingFuture;
  const imp = hf && hf.improvementIfRecommendationsFollowed;

  if (analysis.patterns[0] && analysis.patterns[0].id !== 'no_data') {
    const p = analysis.patterns[0];
    return {
      text: p.title + ' — ' + p.detail.split('—')[0].trim(),
      sub: p.detail,
      severity: p.severity
    };
  }

  if (trends.length) {
    return { text: trends[0].headline, sub: trends[0].body, severity: trends[0].severity };
  }

  if (imp && imp.scoreDelta > 0) {
    return {
      text: 'Following recommendations could raise your wellness score by +' + imp.scoreDelta + ' points.',
      sub: imp.interventionChanges ? imp.interventionChanges.join(' · ') : '',
      severity: 'good'
    };
  }

  const fallbacks = {
    safe: { text: 'Your listening exposure is well within safe weekly limits.', sub: 'Keep sessions under 90 minutes with hourly breaks.', severity: 'good' },
    student: { text: 'Weekly dose is approaching your safe limit.', sub: 'Wednesday study blocks and late-night sessions are your biggest drivers.', severity: 'warn' },
    highRisk: { text: 'Weekly exposure exceeds the safe listening budget.', sub: 'Volume reduction and session breaks would have the largest impact.', severity: 'warn' }
  };
  return fallbacks[pid] || fallbacks.safe;
}

/**
 * Measurable impact metrics for demo / impact dashboard.
 */
function computeImpactMetrics(profile, prediction) {
  const pid = profileId(profile);
  const hf = prediction && prediction.hearingFuture;
  const imp = hf && hf.improvementIfRecommendationsFollowed;
  const dose = profile.weeklyExposure ? profile.weeklyExposure.dosePercent : 0;
  const score = profile.healthScore || (hf && hf.currentHealthScore) || 70;
  const metrics = profile.metrics || {};
  const sessions = (profile.listeningData && profile.listeningData.sessions) || [];
  let avgSessionMin = 0;
  if (sessions.length) {
    avgSessionMin = sessions.reduce(function(a, s) { return a + (s.minutes || 0); }, 0) / sessions.length;
  }
  const sessionLimit = pid === 'highRisk' ? 30 : pid === 'student' ? 45 : 55;
  const underLimit = sessions.filter(function(s) { return (s.minutes || 0) <= sessionLimit; }).length;
  const sessionCompliancePct = sessions.length ? Math.round((underLimit / sessions.length) * 100) : 100;

  const reductionMap = { safe: 18, student: 32, highRisk: 0, aishwarya: 15 };
  const streakFromProfile = metrics.streakDays != null ? metrics.streakDays : null;
  const streakMap = { safe: 18, student: 3, highRisk: 0, aishwarya: 7 };

  return {
    riskyExposureReductionPct: reductionMap[pid] != null ? reductionMap[pid] : 10,
    safeListeningHoursWeek: profile.listeningData && profile.listeningData.totals
      ? round1(profile.listeningData.totals.weeklyHours) : 2,
    streakDays: streakFromProfile != null ? streakFromProfile : (streakMap[pid] != null ? streakMap[pid] : 3),
    avgSessionMin: round1(avgSessionMin),
    sessionCompliancePct: sessionCompliancePct,
    wellnessScore: score,
    weeklyDosePct: dose,
    scoreImprovementPotential: imp ? imp.scoreDelta : 0,
    hearingAgeYearsSaved: imp ? imp.hearingAgeYearsSaved || 0 : 0,
    year1Score: hf && hf.projections ? hf.projections.year1.projectedHealthScore : null,
    year5Score: hf && hf.projections ? hf.projections.year5.projectedHealthScore : null
  };
}

/**
 * Personalized wellness plan from engine + profile persona.
 */
function generateWellnessPlan(profile, prediction) {
  const pid = profileId(profile);
  const hf = prediction && prediction.hearingFuture;
  const intervention = prediction && prediction.intervention;
  const analysis = analyzeListeningPatterns(profile);

  const planTypes = {
    safe: { name: 'Maintenance Plan', persona: 'Keep protective habits strong' },
    student: { name: 'Student Study Plan', persona: 'Safer library, commute, and late-night listening' },
    highRisk: { name: 'Recovery Plan', persona: 'Pull weekly dose back under control' },
    aishwarya: { name: 'Live Monitoring Plan', persona: 'Real-time Spotify-aware habits' }
  };
  const plan = planTypes[pid] || planTypes.student;

  const goals = [];
  if (hf) {
    goals.push('Hold wellness score at ' + hf.currentHealthScore + '/100 or improve by +' + (hf.improvementIfRecommendationsFollowed?.scoreDelta || 0));
    if (hf.hearingAge) {
      goals.push('Keep Hearing Age within +' + hf.hearingAge.ageOffset + ' years of your real age (' + hf.hearingAge.chronologicalAge + ')');
    }
    if (hf.projections && hf.projections.year1) {
      goals.push('Prevent 1-year score drop below ' + hf.projections.year1.projectedHealthScore + '/100');
    }
  }

  const actions = [];
  if (intervention) {
    actions.push({ action: intervention.action, benefit: intervention.expectedBenefit || '' });
    if (intervention.secondAction) {
      actions.push({ action: intervention.secondAction, benefit: intervention.secondBenefit || '' });
    }
  }
  (profile.recommendations || []).slice(0, 2).forEach((r) => {
    if (typeof r === 'object' && r.action) actions.push({ action: r.action, benefit: r.benefit || '' });
  });

  const schedule = [];
  if (analysis.peakSession) {
    schedule.push('Before "' + analysis.peakSession.label + '": volume one step lower + 10-min break every hour');
  }
  schedule.push('Daily ear rest: 10–15 minutes with no audio');
  if (pid === 'student') schedule.push('After 10 PM: cap volume at 60% or switch to speakers');
  if (pid === 'highRisk') schedule.push('No back-to-back sessions over 60 minutes without a 15-min break');

  return {
    ...plan,
    goals,
    actions: actions.slice(0, 4),
    schedule,
    breakRule: '10-minute quiet break every 60 minutes of continuous listening'
  };
}

/**
 * Future Hearing Simulator — plain-language 1yr summary.
 */
function generateFutureSimulator(profile, prediction) {
  const hf = prediction && prediction.hearingFuture;
  if (!hf) return { headline: 'Select a profile to simulate your hearing future.', body: '', actions: [] };

  const y1 = hf.projections.year1;
  const y5 = hf.projections.year5;
  const imp = hf.improvementIfRecommendationsFollowed;

  return {
    headline: 'If your current habits continue for 1 year…',
    body:
      'Wellness score: ' +
      hf.currentHealthScore +
      '/100 → ' +
      y1.projectedHealthScore +
      '/100 in 1 year, ' +
      y5.projectedHealthScore +
      '/100 in 5 years. Hearing Age: ' +
      hf.hearingAge.hearingAge +
      ' years (chronological age ' +
      hf.hearingAge.chronologicalAge +
      ').',
    riskLabel: hf.currentRisk.label,
    actions: imp
      ? [
          imp.interventionChanges[0] || 'Lower volume one step on high-exposure days',
          'Take hourly 10-minute ear breaks',
          imp.hearingAgeYearsSaved > 0
            ? 'Could save ~' + imp.hearingAgeYearsSaved + ' Hearing Age years and +' + imp.scoreDelta + ' wellness points'
            : 'Could improve wellness score by +' + imp.scoreDelta + ' points'
        ]
      : []
  };
}

/**
 * Rule-based coach Q&A grounded in profile + prediction data.
 */
function generateCoachResponse(question, profile, prediction) {
  const q = (question || '').toLowerCase().trim();
  const hf = prediction && prediction.hearingFuture;
  const inp = prediction && prediction.inputs;
  const analysis = analyzeListeningPatterns(profile);
  const pid = profileId(profile);

  if (!hf || !inp) {
    return 'Choose a listening profile first — I\'ll analyze listening duration, volume, and weekly dose to give personalized guidance.';
  }

  if (/study|library|homework|4 hour|four hour/.test(q)) {
    return (
      'For long study sessions (~4 hours/day), try lower-volume instrumental music, noise-isolating headphones so you don\'t crank volume, and a **10-minute break every 60 minutes**. ' +
      'Your profile shows study blocks are a major exposure driver — even one volume step down during "' +
      (analysis.peakSession ? analysis.peakSession.label : 'study') +
      '" could cut weekly dose significantly.'
    );
  }

  if (/safe|is my listening|am i ok|risky/.test(q)) {
    return (
      'Your wellness score is **' +
      hf.currentHealthScore +
      '/100** with weekly dose at **' +
      inp.weeklyDosePercent +
      '%** of the safe limit (~' +
      inp.estimatedDb +
      ' dB average). Risk level: **' +
      hf.currentRisk.label +
      '**. ' +
      (inp.weeklyDosePercent > 100
        ? 'You are over the weekly safe budget — start with volume down one step and shorter sessions today.'
        : inp.weeklyDosePercent > 65
          ? 'You are approaching the limit — focus on breaks and quieter evenings.'
          : 'You are in a protective range — keep breaks consistent.')
    );
  }

  if (/reduce|lower|change|improve|what should/.test(q)) {
    const top = prediction.intervention;
    return (
      'Top change for your pattern: **' +
      (top ? top.action : 'Lower volume one step on your loudest sessions') +
      '**. Expected benefit: ' +
      (top && top.expectedBenefit ? top.expectedBenefit : 'less weekly ear strain') +
      '. If you follow the full plan, your score could move from ' +
      hf.currentHealthScore +
      ' → ' +
      hf.improvementIfRecommendationsFollowed.improvedScore +
      '/100 (+' +
      hf.improvementIfRecommendationsFollowed.scoreDelta +
      ').'
    );
  }

  if (/hearing age|age/.test(q)) {
    const ha = hf.hearingAge;
    return ha.plainSummary + ' Hearing Age **' + ha.hearingAge + '** vs your age **' + ha.chronologicalAge + '**. This is a wellness estimate from listening habits, not a clinical test.';
  }

  if (/future|year|5 year|predict/.test(q)) {
    const sim = generateFutureSimulator(profile, prediction);
    return sim.body + ' Preventive action: ' + (sim.actions[0] || 'reduce volume on peak sessions') + '.';
  }

  if (/gym|workout|exercise/.test(q)) {
    return 'At the gym, background noise often pushes volume up 10–15 dB. Use noise-isolating earbuds and keep volume **one step lower than you think you need** — you\'ll still hear the beat with less inner-ear strain.';
  }

  if (/game|gaming|marathon/.test(q)) {
    return (
      'Gaming marathons stack exposure fast. Your data shows long high-volume blocks — try **15-minute silent breaks between matches** and cap session length on your highest-dose days (' +
      (analysis.peakSession ? analysis.peakSession.day : 'weekends') +
      ').'
    );
  }

  if (/playlist|music|spotify/.test(q)) {
    return 'For safer playlists: favor slightly quieter mastering, avoid constant max-volume EDM/bass-heavy tracks during commutes, and use Spotify\'s volume limiter if available. Calmer morning playlists already reduce dose creep on weekday starts.';
  }

  return (
    'Based on your **' +
    (profile.name || pid) +
    '** profile: wellness **' +
    hf.currentHealthScore +
    '/100**, dose **' +
    inp.weeklyDosePercent +
    '%**, Hearing Age **' +
    hf.hearingAge.hearingAge +
    '**. Ask me: "Is my listening safe?", "What should I change?", or "I study 4 hours daily."'
  );
}

/** Daily recommendation from engine (not static copy). */
function generateDailyRecommendation(profile, prediction) {
  const intervention = prediction && prediction.intervention;
  const analysis = analyzeListeningPatterns(profile);
  if (intervention && intervention.action) {
    return {
      text: intervention.action,
      why: intervention.expectedBenefit || 'Targets your highest-impact listening pattern.'
    };
  }
  if (analysis.peakSession) {
    return {
      text: 'Before your next "' + analysis.peakSession.label + '" session, turn volume down one step.',
      why: 'This session drives the most exposure in your week (~' + analysis.peakSession.avgDb + ' dB avg).'
    };
  }
  return { text: 'Take a 10-minute ear break today with no audio.', why: 'Short quiet periods help your ears recover between sessions.' };
}

/** Risk forecast card copy from engine. */
function generateRiskForecastCard(profile, prediction) {
  const hf = prediction && prediction.hearingFuture;
  if (!hf) return null;
  const y1 = hf.projections.year1;
  const colors = { low: '#10b981', elevated: '#f59e0b', high: '#ef4444' };
  const cat = hf.currentRisk.category;
  return {
    level: hf.currentRisk.label,
    color: colors[cat] || '#0EA5E9',
    bg: cat === 'high' ? 'rgba(239,68,68,0.12)' : cat === 'elevated' ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
    text:
      'Current habit risk: **' +
      hf.currentRisk.label +
      '**. If nothing changes, your wellness score may reach **' +
      y1.projectedHealthScore +
      '/100** within one year.',
    why: y1.reasoning
  };
}
