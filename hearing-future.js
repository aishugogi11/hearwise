/**
 * HearWise Hearing Future prediction engine.
 * Inputs: listening duration, volume (%), weekly dose (%).
 * NIOSH-inspired: 80 dB ≈ 40 h/week; +3 dB halves allowed exposure time.
 * Wellness / prevention only — not medical diagnosis.
 */

const HEARING_FUTURE_REFERENCE = {
  db80HoursPerWeek: 40,
  db85HoursPerWeek: 12,
  db90HoursPerWeek: 4
};

const SCORE_WEIGHTS = {
  dosePerPercent: 0.4,
  doseCap: 48,
  dbAbove70: 1.4,
  hoursAbove7: 2.2,
  over100DosePenalty: 10,
  loudMarathonPenalty: 8,
  loudMarathonDb: 88,
  loudMarathonHours: 12
};

const MONTHLY_DRIFT = {
  high: { scoreLoss: 2.8, riskGain: 4.5, doseThreshold: 100 },
  elevated: { scoreLoss: 1.8, riskGain: 3, doseThreshold: 70 },
  moderate: { scoreLoss: 0.9, riskGain: 1.5, doseThreshold: 40 },
  low: { scoreLoss: 0.35, riskGain: 0.6, doseThreshold: 0 }
};

function volumeToEstimatedDb(volume) {
  const v = Math.max(0, Math.min(100, Number(volume) || 0));
  /* Spotify device % → estimated in-ear dB (conservative; normal listening ~45–60% ≈ 67–76 dB) */
  return Math.round(40 + v * 0.6);
}

/** NIOSH-style weekly noise dose (% of daily 100% reference accumulated over the week). */
function computeWeeklyDosePercent(weeklyMinutes, volumePercent) {
  const mins = Math.max(0, Number(weeklyMinutes) || 0);
  const vol = Math.max(0, Math.min(100, Number(volumePercent) || 70));
  const estimatedDb = volumeToEstimatedDb(vol);
  const referenceTime = 8 * 60;
  const exchangeRate = 3;
  const dosePerMinute = Math.pow(10, (estimatedDb - 80) / exchangeRate);
  const weeklyDose = (mins * dosePerMinute) / referenceTime;
  return Math.round(Math.max(0, weeklyDose * 100));
}

/** Current-session exposure risk for live volume gauge (0–100). */
function computeSessionRiskPercent(volumePercent, sessionMinutes) {
  const mins = Math.max(0, Number(sessionMinutes) || 0);
  const vol = Math.max(0, Math.min(100, Number(volumePercent) || 0));
  const estimatedDb = volumeToEstimatedDb(vol);
  const referenceTime = 8 * 60;
  const exchangeRate = 3;
  const dosePerMinute = Math.pow(10, (estimatedDb - 80) / exchangeRate);
  const sessionDose = (mins * dosePerMinute) / referenceTime;
  return Math.min(100, Math.round(sessionDose * 100));
}

function dosePercentToRiskLevel(weeklyDosePercent) {
  const pct = Math.max(0, Number(weeklyDosePercent) || 0);
  if (pct > 80) return 'High';
  if (pct > 50) return 'Elevated';
  if (pct > 25) return 'Moderate';
  return 'Safe';
}

function toWeeklyMinutes(listeningDurationMinutes, durationScope) {
  const mins = Math.max(0, Number(listeningDurationMinutes) || 0);
  return durationScope === 'daily' ? mins * 7 : mins;
}

function getMonthlyDrift(weeklyDosePercent) {
  if (weeklyDosePercent > MONTHLY_DRIFT.high.doseThreshold) return MONTHLY_DRIFT.high;
  if (weeklyDosePercent > MONTHLY_DRIFT.elevated.doseThreshold) return MONTHLY_DRIFT.elevated;
  if (weeklyDosePercent > MONTHLY_DRIFT.moderate.doseThreshold) return MONTHLY_DRIFT.moderate;
  return MONTHLY_DRIFT.low;
}

/**
 * Explainable health score: 100 minus weighted penalties (shown to user).
 */
function computeScoreBreakdown(weeklyDosePercent, estimatedDb, weeklyHours) {
  const penalties = [];

  const dosePenalty = Math.min(SCORE_WEIGHTS.doseCap, weeklyDosePercent * SCORE_WEIGHTS.dosePerPercent);
  penalties.push({
    id: 'weekly_dose',
    label: 'Weekly noise dose',
    points: round1(dosePenalty),
    formula:
      'min(' +
      SCORE_WEIGHTS.doseCap +
      ', weekly dose ' +
      weeklyDosePercent +
      '% × ' +
      SCORE_WEIGHTS.dosePerPercent +
      ') = ' +
      round1(dosePenalty) +
      ' pts'
  });

  const dbPenalty = Math.max(0, (estimatedDb - 70) * SCORE_WEIGHTS.dbAbove70);
  if (dbPenalty > 0) {
    penalties.push({
      id: 'listening_level',
      label: 'Estimated listening level',
      points: round1(dbPenalty),
      formula:
        'max(0, (' +
        estimatedDb +
        ' dB − 70) × ' +
        SCORE_WEIGHTS.dbAbove70 +
        ') = ' +
        round1(dbPenalty) +
        ' pts'
    });
  }

  const hoursPenalty = Math.max(0, (weeklyHours - 7) * SCORE_WEIGHTS.hoursAbove7);
  if (hoursPenalty > 0) {
    penalties.push({
      id: 'listening_duration',
      label: 'Weekly listening time',
      points: round1(hoursPenalty),
      formula:
        'max(0, (' +
        round1(weeklyHours) +
        ' h − 7) × ' +
        SCORE_WEIGHTS.hoursAbove7 +
        ') = ' +
        round1(hoursPenalty) +
        ' pts'
    });
  }

  if (weeklyDosePercent > 100) {
    penalties.push({
      id: 'over_budget',
      label: 'Over weekly safe budget',
      points: SCORE_WEIGHTS.over100DosePenalty,
      formula: 'Weekly dose > 100% → +' + SCORE_WEIGHTS.over100DosePenalty + ' pts'
    });
  }

  if (estimatedDb >= SCORE_WEIGHTS.loudMarathonDb && weeklyHours > SCORE_WEIGHTS.loudMarathonHours) {
    penalties.push({
      id: 'loud_marathon',
      label: 'Loud + long sessions combined',
      points: SCORE_WEIGHTS.loudMarathonPenalty,
      formula:
        'Level ≥ ' +
        SCORE_WEIGHTS.loudMarathonDb +
        ' dB and > ' +
        SCORE_WEIGHTS.loudMarathonHours +
        ' h/week → +' +
        SCORE_WEIGHTS.loudMarathonPenalty +
        ' pts'
    });
  }

  const totalPenalty = penalties.reduce((sum, p) => sum + p.points, 0);
  const score = Math.round(Math.max(22, Math.min(98, 100 - totalPenalty)));

  return {
    score,
    totalPenalty: round1(totalPenalty),
    penalties,
    formulaSummary: 'Hearing Health Score = 100 − ' + round1(totalPenalty) + ' = ' + score
  };
}

function classifyRiskCategory(weeklyDosePercent, estimatedDb, weeklyHours) {
  const drivers = [];

  if (weeklyDosePercent > 110) drivers.push({ rule: 'Weekly dose > 110%', points: 4 });
  else if (weeklyDosePercent > 85) drivers.push({ rule: 'Weekly dose > 85%', points: 3 });
  else if (weeklyDosePercent > 55) drivers.push({ rule: 'Weekly dose > 55%', points: 2 });
  else if (weeklyDosePercent > 35) drivers.push({ rule: 'Weekly dose > 35%', points: 1 });

  if (estimatedDb >= 90) drivers.push({ rule: 'Level ≥ 90 dB (est.)', points: 3 });
  else if (estimatedDb >= 85) drivers.push({ rule: 'Level ≥ 85 dB (est.)', points: 2 });
  else if (estimatedDb >= 78) drivers.push({ rule: 'Level ≥ 78 dB (est.)', points: 1 });

  if (weeklyHours > 15) drivers.push({ rule: 'Listening > 15 h/week', points: 2 });
  else if (weeklyHours > 10) drivers.push({ rule: 'Listening > 10 h/week', points: 1 });

  const totalPoints = drivers.reduce((s, d) => s + d.points, 0);

  let category, label, statusClass;
  if (totalPoints >= 6) {
    category = 'high';
    label = 'High Risk';
    statusClass = 'danger';
  } else if (totalPoints >= 3) {
    category = 'elevated';
    label = 'Elevated Risk';
    statusClass = 'warn';
  } else {
    category = 'low';
    label = 'Low Risk';
    statusClass = 'safe';
  }

  return {
    category,
    label,
    statusClass,
    totalPoints,
    drivers,
    summary:
      'Risk points = ' +
      totalPoints +
      ' (threshold: Elevated ≥ 3, High ≥ 6). ' +
      drivers.map((d) => d.rule + ' [+' + d.points + ']').join('; ')
  };
}

function rankContributingFactors(breakdown, weeklyDosePercent, estimatedDb, weeklyHours) {
  const factors = breakdown.penalties.map((p) => ({
    id: p.id,
    label: p.label,
    points: p.points,
    formula: p.formula,
    sharePercent: breakdown.totalPenalty > 0 ? Math.round((p.points / breakdown.totalPenalty) * 100) : 0
  }));

  factors.sort((a, b) => b.points - a.points);

  const top = factors.slice(0, 3);
  while (top.length < 3 && factors.length > top.length) {
    top.push(factors[top.length]);
  }

  return top.filter(Boolean);
}

function projectHealthAtMonths(currentScore, weeklyDosePercent, months) {
  const drift = getMonthlyDrift(weeklyDosePercent);
  const loss = drift.scoreLoss * months;
  const projected = Math.round(Math.max(22, currentScore - loss));
  const riskIndex = Math.min(
    98,
    Math.round(
      (weeklyDosePercent > 100 ? 55 : weeklyDosePercent > 70 ? 35 : 15) + drift.riskGain * months
    )
  );

  return {
    months,
    projectedHealthScore: projected,
    riskIndex,
    monthlyScoreLoss: drift.scoreLoss,
    monthlyRiskGain: drift.riskGain,
    totalScoreLoss: round1(loss),
    reasoning:
      'If habits stay the same: each month −' +
      drift.scoreLoss +
      ' score pts (dose ' +
      weeklyDosePercent +
      '% tier). Over ' +
      months +
      ' mo: ' +
      currentScore +
      ' − ' +
      round1(loss) +
      ' = ' +
      projected +
      '. Risk index rises ~' +
      round1(drift.riskGain * months) +
      ' pts.'
  };
}

function applyInterventionToInputs(input, intervention) {
  const volume = input.volume;
  const weeklyMinutes = toWeeklyMinutes(input.listeningDurationMinutes, input.durationScope || 'weekly');
  const weeklyHours = weeklyMinutes / 60;
  let newVolume = volume;
  let newDose = input.weeklyDosePercent;
  let newMinutes = weeklyMinutes;
  const changes = [];

  switch (intervention.priority) {
    case 'volume_and_duration':
      newVolume = Math.max(40, volume - 20);
      newDose = Math.round(input.weeklyDosePercent * 0.5);
      newMinutes = Math.round(weeklyMinutes * 0.8);
      changes.push(
        'Volume turned down about two steps',
        'Shorter overall listening time with more breaks',
        'Less total loud exposure across the week'
      );
      break;
    case 'volume':
      newVolume = Math.max(40, volume - 10);
      newDose = Math.round(input.weeklyDosePercent * 0.62);
      changes.push(
        'Volume turned down one step on your device',
        'Same music time with less strain on your ears'
      );
      break;
    case 'duration':
      newMinutes = Math.round(weeklyMinutes * 0.78);
      newDose = Math.round(input.weeklyDosePercent * 0.72);
      changes.push(
        'Hourly 10-minute breaks and shorter long sessions',
        'Less continuous loud listening across the week'
      );
      break;
    default:
      newDose = Math.round(input.weeklyDosePercent * 0.92);
      changes.push('Steady habits with occasional quieter days');
  }

  return {
    listeningDurationMinutes:
      input.durationScope === 'daily' ? newMinutes / 7 : newMinutes,
    durationScope: input.durationScope || 'weekly',
    volume: newVolume,
    weeklyDosePercent: Math.max(15, newDose),
    changes
  };
}

function buildImprovementEstimate(currentBreakdown, input, intervention) {
  const adjustedInput = applyInterventionToInputs(input, intervention);
  const weeklyMinutes = toWeeklyMinutes(
    adjustedInput.listeningDurationMinutes,
    adjustedInput.durationScope || 'weekly'
  );
  const weeklyHours = weeklyMinutes / 60;
  const estimatedDb = volumeToEstimatedDb(adjustedInput.volume);
  const improvedBreakdown = computeScoreBreakdown(
    adjustedInput.weeklyDosePercent,
    estimatedDb,
    weeklyHours
  );
  const improvedRisk = classifyRiskCategory(
    adjustedInput.weeklyDosePercent,
    estimatedDb,
    weeklyHours
  );

  const currentScore = currentBreakdown.score;
  const improvedScore = improvedBreakdown.score;
  const delta = improvedScore - currentScore;

  const year1Before = projectHealthAtMonths(currentScore, input.weeklyDosePercent, 12);
  const year1After = projectHealthAtMonths(improvedScore, adjustedInput.weeklyDosePercent, 12);
  const year5Before = projectHealthAtMonths(currentScore, input.weeklyDosePercent, 60);
  const year5After = projectHealthAtMonths(improvedScore, adjustedInput.weeklyDosePercent, 60);

  return {
    adjustedInputs: {
      weeklyMinutes,
      weeklyHours: round1(weeklyHours),
      volume: adjustedInput.volume,
      weeklyDosePercent: adjustedInput.weeklyDosePercent,
      estimatedDb
    },
    interventionChanges: adjustedInput.changes,
    currentScore,
    improvedScore,
    scoreDelta: delta,
    improvedRisk: {
      label: improvedRisk.label,
      category: improvedRisk.category
    },
    year1Delta: year1After.projectedHealthScore - year1Before.projectedHealthScore,
    year5Delta: year5After.projectedHealthScore - year5Before.projectedHealthScore,
    reasoning:
      'Following recommendations adjusts inputs (' +
      adjustedInput.changes.join('; ') +
      '). Same formula: ' +
      improvedBreakdown.formulaSummary +
      '. Today: ' +
      currentScore +
      ' → ' +
      improvedScore +
      ' (+' +
      delta +
      '). Risk: ' +
      improvedRisk.label +
      '. 1-year outlook: ' +
      year1Before.projectedHealthScore +
      ' → ' +
      year1After.projectedHealthScore +
      ' (+' +
      (year1After.projectedHealthScore - year1Before.projectedHealthScore) +
      ' if changes held).'
  };
}

/**
 * Hearing Age — wellness metaphor mapping exposure + score to an equivalent
 * "listening age" vs chronological age. Not clinical hearing age testing.
 */
function computeHearingAge(chronologicalAge, healthScore, weeklyDosePercent, estimatedDb, weeklyHours) {
  const age = Math.max(16, Math.min(80, Number(chronologicalAge) || 22));

  const scorePart = (100 - healthScore) * 0.3;
  const dosePart = Math.max(0, weeklyDosePercent - 35) * 0.11;
  const dbPart = Math.max(0, estimatedDb - 73) * 0.55;
  const hoursPart = Math.max(0, weeklyHours - 7) * 0.35;
  const ageOffset = Math.round(scorePart + dosePart + dbPart + hoursPart);
  const hearingAge = Math.min(72, Math.max(age - 1, age + ageOffset));

  let comparisonLabel;
  let plainSummary;
  if (ageOffset <= 1) {
    comparisonLabel = 'Matches your age';
    plainSummary =
      'Your listening habits are similar to someone your own age (' + age + ').';
  } else if (ageOffset <= 10) {
    comparisonLabel = '+' + ageOffset + ' vs your age';
    plainSummary =
      'Your habits add about ' +
      ageOffset +
      ' years of listening stress — like a ' +
      hearingAge +
      '-year-old listener, not ' +
      age +
      '.';
  } else {
    comparisonLabel = '+' + ageOffset + ' vs your age';
    plainSummary =
      'High volume and duration are aging your ears faster — equivalent to listening like age ' +
      hearingAge +
      ' (you are ' +
      age +
      ').';
  }

  return {
    chronologicalAge: age,
    hearingAge,
    ageOffset,
    comparisonLabel,
    plainSummary,
    components: [
      { label: 'Wellness score effect', years: round1(scorePart) },
      { label: 'Weekly dose effect', years: round1(dosePart) },
      { label: 'Loudness (dB) effect', years: round1(dbPart) },
      { label: 'Hours per week effect', years: round1(hoursPart) }
    ],
    formula:
      'Hearing Age = ' +
      age +
      ' + ' +
      ageOffset +
      ' = ' +
      hearingAge +
      '. Offset = (100−' +
      healthScore +
      ')×0.30 + max(0,' +
      weeklyDosePercent +
      '−35)×0.11 + max(0,' +
      estimatedDb +
      '−73)×0.55 + max(0,' +
      round1(weeklyHours) +
      '−7)×0.35.'
  };
}

function buildHearingFutureReport(rawInput, ctx) {
  const { breakdown, risk, intervention } = ctx;
  const { weeklyDosePercent } = rawInput;
  const chronologicalAge = rawInput.chronologicalAge || 22;

  const year1 = projectHealthAtMonths(breakdown.score, weeklyDosePercent, 12);
  const year5 = projectHealthAtMonths(breakdown.score, weeklyDosePercent, 60);
  const topFactors = rankContributingFactors(
    breakdown,
    weeklyDosePercent,
    rawInput.estimatedDb,
    rawInput.weeklyHours
  );
  const improvement = buildImprovementEstimate(
    breakdown,
    {
      listeningDurationMinutes: rawInput.listeningDurationMinutes,
      durationScope: rawInput.durationScope,
      volume: rawInput.volume,
      weeklyDosePercent: rawInput.weeklyDosePercent
    },
    intervention
  );

  const hearingAge = computeHearingAge(
    chronologicalAge,
    breakdown.score,
    weeklyDosePercent,
    rawInput.estimatedDb,
    rawInput.weeklyHours
  );

  const hearingAgeIfImproved = computeHearingAge(
    chronologicalAge,
    improvement.improvedScore,
    improvement.adjustedInputs.weeklyDosePercent,
    improvement.adjustedInputs.estimatedDb,
    improvement.adjustedInputs.weeklyHours
  );

  improvement.hearingAgeAfter = hearingAgeIfImproved.hearingAge;
  improvement.hearingAgeYearsSaved = hearingAge.hearingAge - hearingAgeIfImproved.hearingAge;

  return {
    currentRisk: {
      level: risk.category,
      label: risk.label,
      statusClass: risk.statusClass,
      points: risk.totalPoints,
      reasoning: risk.summary
    },
    currentHealthScore: breakdown.score,
    scoreFormula: breakdown.formulaSummary,
    projections: {
      year1: {
        label: '1 year',
        ...year1,
        riskLabel: riskLabelFromIndex(year1.riskIndex)
      },
      year5: {
        label: '5 years',
        ...year5,
        riskLabel: riskLabelFromIndex(year5.riskIndex)
      }
    },
    topContributingFactors: topFactors,
    improvementIfRecommendationsFollowed: improvement,
    hearingAge
  };
}

function riskLabelFromIndex(riskIndex) {
  if (riskIndex >= 85) return 'Critical';
  if (riskIndex >= 65) return 'Elevated';
  if (riskIndex >= 40) return 'Rising';
  return 'Stable / low concern';
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function predictHearingFuture(input) {
  const durationScope = input.durationScope || 'weekly';
  const weeklyMinutes = toWeeklyMinutes(input.listeningDurationMinutes, durationScope);
  const weeklyHours = weeklyMinutes / 60;
  const volume = Math.max(0, Math.min(100, Number(input.volume) || 0));
  const weeklyDosePercent = Math.max(0, Number(input.weeklyDosePercent) || 0);
  const estimatedDb = volumeToEstimatedDb(volume);

  const risk = classifyRiskCategory(weeklyDosePercent, estimatedDb, weeklyHours);
  const breakdown = computeScoreBreakdown(weeklyDosePercent, estimatedDb, weeklyHours);
  const intervention = buildRecommendedIntervention({
    weeklyDosePercent,
    estimatedDb,
    weeklyHours,
    volume
  });

  const rawCtx = {
    listeningDurationMinutes: input.listeningDurationMinutes,
    durationScope,
    weeklyMinutes,
    weeklyHours: round1(weeklyHours),
    volume,
    weeklyDosePercent,
    estimatedDb
  };

  const explanation = buildPredictionExplanation({
    volume,
    estimatedDb,
    weeklyDosePercent,
    weeklyHours,
    weeklyMinutes,
    durationScope,
    risk
  });

  const hearingFuture = buildHearingFutureReport(
    {
      ...rawCtx,
      listeningDurationMinutes: input.listeningDurationMinutes,
      durationScope,
      chronologicalAge: input.chronologicalAge || 22
    },
    { breakdown, risk, intervention }
  );

  const timeline = buildRiskTimeline(weeklyDosePercent, breakdown.score);

  return {
    inputs: rawCtx,
    riskCategory: risk.category,
    riskLabel: risk.label,
    riskStatusClass: risk.statusClass,
    projectedHealthScore: breakdown.score,
    scoreBreakdown: breakdown,
    explanation,
    intervention,
    hearingFuture,
    timeline
  };
}

function buildPredictionExplanation(ctx) {
  const factors = [
    {
      label: 'Weekly dose',
      value: ctx.weeklyDosePercent + '%',
      impact:
        ctx.weeklyDosePercent > 100 ? 'negative' : ctx.weeklyDosePercent > 65 ? 'warning' : 'positive'
    },
    {
      label: 'Estimated level (from volume)',
      value: ctx.estimatedDb + ' dB',
      impact: ctx.estimatedDb >= 85 ? 'negative' : ctx.estimatedDb >= 78 ? 'warning' : 'positive'
    },
    {
      label: 'Listening duration',
      value: ctx.weeklyHours.toFixed(1) + ' h/week',
      impact: ctx.weeklyHours > 12 ? 'warning' : 'positive'
    },
    {
      label: 'Safe budget reference',
      value: '80 dB ≈ 40 h/week',
      impact: 'neutral'
    }
  ];

  let summary;
  if (ctx.risk.category === 'high') {
    summary =
      'At ' +
      ctx.estimatedDb +
      ' dB and ' +
      ctx.weeklyDosePercent +
      '% weekly dose over ' +
      ctx.weeklyHours.toFixed(1) +
      ' hours, exposure exceeds prevention guidelines.';
  } else if (ctx.risk.category === 'elevated') {
    summary =
      'Your mix of ' +
      ctx.weeklyHours.toFixed(1) +
      ' h/week at ~' +
      ctx.estimatedDb +
      ' dB puts weekly dose at ' +
      ctx.weeklyDosePercent +
      '% — nearing the safe limit if habits stay the same.';
  } else {
    summary =
      'With ~' +
      ctx.weeklyHours.toFixed(1) +
      ' h/week at ~' +
      ctx.estimatedDb +
      ' dB, weekly dose is ' +
      ctx.weeklyDosePercent +
      '% of the safe budget.';
  }

  return { summary, factors };
}

function buildRecommendedIntervention(ctx) {
  const { weeklyDosePercent, estimatedDb, weeklyHours } = ctx;

  if (estimatedDb >= 88 || weeklyDosePercent > 110) {
    return {
      priority: 'volume_and_duration',
      headline: 'Turn volume down and shorten loud sessions today',
      action:
        'Turn your volume down two steps on your phone or laptop. After 60 minutes of listening, take a 15-minute break with no audio.',
      expectedBenefit:
        'Your ears get recovery time during the day, which can quickly lower listening stress and improve your weekly outlook.',
      secondAction:
        'Use noise-isolating headphones on transit, at the gym, and in dorms so you are not tempted to max volume.',
      secondBenefit:
        'You can hear clearly at a lower level in noisy places, which protects hearing without missing your music.',
      rationale:
        'At 90 dB, safe exposure is only ~4 h/week. You are over budget — volume and duration must both drop.'
    };
  }

  if (weeklyDosePercent > 60 || estimatedDb >= 80) {
    return {
      priority: 'volume',
      headline: 'Listen one step quieter during your busiest sessions',
      action:
        'Listen one volume step lower during commutes, study blocks, and gym playlists.',
      expectedBenefit:
        'You can usually keep the same listening time while putting much less strain on your ears over the week.',
      secondAction:
        'Take a 10-minute listening break every hour during long study or gaming sessions.',
      secondBenefit:
        'Breaks cut total exposure without giving up music — especially helpful on your longest days.',
      rationale:
        'NIOSH-style rule: each 3 dB increase halves safe duration. A small volume drop preserves listening time safely.'
    };
  }

  if (weeklyHours > 9) {
    return {
      priority: 'duration',
      headline: 'Add breaks and trim your longest listening blocks',
      action:
        'Take a 10-minute listening break every hour, and shorten your longest session of the day (study, gaming, or background music).',
      expectedBenefit:
        'Reduces total listening stress even if your volume stays the same — good when hours are driving your risk.',
      secondAction:
        'Pick one headphone-free hour each day (meal, walk, or class break) with no earbuds in.',
      secondBenefit:
        'Gives your ears a daily reset and helps keep your Hearing Age closer to your real age.',
      rationale:
        'Duration is driving dose more than level — breaks lower cumulative exposure without sacrificing music.'
    };
  }

  return {
    priority: 'maintain',
    headline: 'Keep the habits that are already working',
    action:
      'Keep your current volume, take a short break on sessions longer than an hour, and check in after concerts or very loud days.',
    expectedBenefit:
      'Helps you stay in a safe listening range and keep Hearing Age close to your chronological age.',
    secondAction:
      'Use noise-isolating headphones in noisy environments instead of turning volume up.',
    secondBenefit:
      'Lets you enjoy music clearly without pushing volume into a risky range.',
    rationale: 'Your inputs sit in a low-risk zone — consistency is the main prevention lever.'
  };
}

/** User-facing recommendations (behavior + plain benefit). Calculations stay in intervention.priority. */
function buildDisplayRecommendations(prediction, profile) {
  const i = prediction.intervention;
  const imp = prediction.hearingFuture && prediction.hearingFuture.improvementIfRecommendationsFollowed;
  let outcomeHint = '';
  if (imp && imp.scoreDelta > 0) {
    outcomeHint =
      ' In this profile, that could raise your wellness score by about ' +
      imp.scoreDelta +
      ' points';
    if (imp.hearingAgeYearsSaved > 0) {
      outcomeHint += ' and lower your Hearing Age by about ' + imp.hearingAgeYearsSaved + ' years';
    }
    outcomeHint += '.';
  }

  const items = [
    { action: i.action, benefit: i.expectedBenefit + outcomeHint },
    { action: i.secondAction, benefit: i.secondBenefit }
  ];

  const extras = PROFILE_BEHAVIOR_TIPS[profile.id] || [];
  extras.forEach((tip) => items.push(tip));

  return items.slice(0, 3);
}

const PROFILE_BEHAVIOR_TIPS = {
  safe: [
    {
      action: 'Keep daily listening to about 90 minutes or less when possible.',
      benefit: 'Stays within a comfortable safe range for long-term hearing wellness.'
    }
  ],
  student: [
    {
      action: 'On Wednesday-style study nights, reduce listening time and pause every hour.',
      benefit: 'Targets your highest-exposure pattern without changing your whole routine.'
    }
  ],
  highRisk: [
    {
      action: 'For gaming marathons, switch to speakers across the room or take a break between matches.',
      benefit: 'Cuts ear-level loudness during your longest weekly sessions.'
    }
  ]
};

function buildRiskTimeline(weeklyDosePercent, currentScore) {
  const horizons = [
    { period: '2 weeks', months: 0.5 },
    { period: '1 month', months: 1 },
    { period: '3 months', months: 3 },
    { period: '6 months', months: 6 },
    { period: '1 year', months: 12 }
  ];

  return horizons.map((h) => {
    const proj = projectHealthAtMonths(currentScore, weeklyDosePercent, h.months);
    const label = riskLabelFromIndex(proj.riskIndex);
    return {
      period: h.period,
      months: h.months,
      riskIndex: proj.riskIndex,
      projectedHealthScore: proj.projectedHealthScore,
      label,
      detail: proj.reasoning
    };
  });
}

function profileToEngineInput(profile) {
  return {
    listeningDurationMinutes: profile.listeningData.totals.weeklyMinutes,
    durationScope: 'weekly',
    volume: profile.live.volume,
    weeklyDosePercent: profile.weeklyExposure.dosePercent,
    chronologicalAge: profile.chronologicalAge || 22
  };
}

function predictHearingFutureForProfile(profileOrId) {
  const profile =
    typeof profileOrId === 'string' ? getDemoProfile(profileOrId) : profileOrId;
  return predictHearingFuture(profileToEngineInput(profile));
}

function enrichProfileWithPrediction(profile) {
  const prediction = predictHearingFutureForProfile(profile);
  return Object.assign({}, profile, {
    healthScore: prediction.projectedHealthScore,
    riskTier: prediction.riskCategory,
    riskLabel: prediction.riskLabel,
    riskStatusClass: prediction.riskStatusClass,
    riskExplanation: prediction.explanation,
    recommendations: buildDisplayRecommendations(prediction, profile),
    forecast: prediction.timeline,
    prediction
  });
}

function getEnrichedDemoProfile(id) {
  const profile = getDemoProfile(id);
  if (profile && profile.isLive) {
    return Object.assign({}, profile, { prediction: null });
  }
  return enrichProfileWithPrediction(profile);
}
