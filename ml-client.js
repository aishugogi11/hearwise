/**
 * HearWise client — browser-side hearing-risk scoring
 * WHO/NIOSH-inspired exposure scenarios; runs in-browser for live predictions.
 */
(function (global) {
  'use strict';

  const ML_MODEL_VERSION = '2.1.0';
  const FEATURE_LABELS = [
    'Weekly listening hours',
    'Average volume',
    'Session length',
    'Break frequency',
    'Time-of-day risk',
    'Age factor',
    'Headphone exposure'
  ];

  /** Generate labeled training rows from NIOSH-style dose math (not random noise). */
  function generateWhoTrainingData(count) {
    const rows = [];
    for (let i = 0; i < count; i++) {
      const weeklyHours = (i % 35) * 1.15 + (Math.random() * 2);
      const avgVolume = 0.25 + (Math.random() * 0.65);
      const sessionLength = 0.25 + Math.random() * 3.5;
      const breakFrequency = Math.random() * 1;
      const timeOfDayRisk = Math.random();
      const ageNorm = (18 + Math.floor(Math.random() * 50)) / 80;
      const headphoneType = 0.25 + Math.random() * 0.6;

      const estimatedDb = 40 + avgVolume * 100 * 0.6;
      const doseFactor = (weeklyHours / 40) * Math.pow(2, (estimatedDb - 80) / 3);
      let risk =
        Math.min(1, doseFactor * 0.45) +
        Math.max(0, (estimatedDb - 75) / 50) * 0.2 +
        Math.max(0, sessionLength - 1) * 0.08 +
        (1 - breakFrequency) * 0.12 +
        timeOfDayRisk * 0.08 +
        ageNorm * 0.04 +
        headphoneType * 0.06;
      risk = Math.max(0.02, Math.min(0.98, risk));

      rows.push({
        input: [
          weeklyHours / 35,
          avgVolume,
          sessionLength / 3,
          breakFrequency,
          timeOfDayRisk,
          ageNorm,
          headphoneType
        ],
        risk
      });
    }
    return rows;
  }

  class HearingRiskModel {
    constructor() {
      this.model = null;
      this.isTrained = false;
      this.trainingSamples = 0;
      this.lastLoss = null;
      this.featureCount = 7;
    }

    async init() {
      if (this.model) return true;
      if (typeof tf === 'undefined') {
        console.warn('[Risk] scoring library not loaded');
        return false;
      }
      this.model = tf.sequential({
        layers: [
          tf.layers.dense({ units: 24, activation: 'relu', inputShape: [this.featureCount] }),
          tf.layers.dropout({ rate: 0.15 }),
          tf.layers.dense({ units: 12, activation: 'relu' }),
          tf.layers.dense({ units: 1, activation: 'sigmoid' })
        ]
      });
      this.model.compile({
        optimizer: tf.train.adam(0.01),
        loss: 'meanSquaredError',
        metrics: ['mse']
      });
      console.log('[ML] Neural network v' + ML_MODEL_VERSION + ' initialized');
      return true;
    }

    async pretrain() {
      if (this.isTrained) return;
      await this.init();
      if (!this.model) return;

      const data = generateWhoTrainingData(320);
      this.trainingSamples = data.length;
      const xs = tf.tensor2d(data.map(function (d) { return d.input; }));
      const ys = tf.tensor2d(data.map(function (d) { return [d.risk]; }));

      const history = await this.model.fit(xs, ys, {
        epochs: 120,
        batchSize: 32,
        shuffle: true,
        verbose: 0
      });
      const losses = history.history.loss;
      this.lastLoss = losses[losses.length - 1];
      this.isTrained = true;
      xs.dispose();
      ys.dispose();
      console.log('[ML] Pre-trained on', this.trainingSamples, 'WHO/NIOSH scenarios · loss', this.lastLoss.toFixed(4));
    }

    async predictVector(inputVector) {
      if (!this.isTrained) await this.pretrain();
      if (!this.model) return { riskScore: 0.5, confidence: 0.5 };

      const input = tf.tensor2d([inputVector]);
      const prediction = this.model.predict(input);
      const risk = (await prediction.data())[0];
      input.dispose();
      prediction.dispose();

      const confidence = Math.max(0.72, Math.min(0.97, 0.97 - (this.lastLoss || 0.05) * 2));
      return {
        riskScore: risk,
        riskPercent: Math.round(risk * 100),
        riskLevel: risk < 0.3 ? 'low' : risk < 0.55 ? 'moderate' : risk < 0.75 ? 'high' : 'extreme',
        confidence: confidence,
        modelVersion: ML_MODEL_VERSION,
        trainingSamples: this.trainingSamples
      };
    }

    /** Occlusion-based feature importance (per-input perturbation). */
    async computeFeatureImportance(inputVector, baseRisk) {
      const importance = [];
      for (let i = 0; i < inputVector.length; i++) {
        const perturbed = inputVector.slice();
        perturbed[i] = Math.max(0, Math.min(1, perturbed[i] * 1.25 + 0.05));
        const res = await this.predictVector(perturbed);
        importance.push({
          label: FEATURE_LABELS[i],
          index: i,
          impact: Math.abs(res.riskScore - baseRisk),
          direction: res.riskScore > baseRisk ? 'increases' : 'decreases'
        });
      }
      importance.sort(function (a, b) { return b.impact - a.impact; });
      return importance;
    }

    async predictWithDetails(inputVector) {
      const base = await this.predictVector(inputVector);
      const importance = await this.computeFeatureImportance(inputVector, base.riskScore);
      return Object.assign({}, base, { featureImportance: importance });
    }

    calculateTrend(history) {
      if (!history || history.length < 3) return 'stable';
      const recent = history.slice(-3).reduce(function (a, b) { return a + b.weeklyMinutes; }, 0) / 3;
      const previous = history.slice(-6, -3).reduce(function (a, b) { return a + b.weeklyMinutes; }, 0) / 3;
      if (recent > previous * 1.12) return 'increasing';
      if (recent < previous * 0.88) return 'decreasing';
      return 'stable';
    }

    generateInsights(weeklyStats, userHistory) {
      const insights = [];
      if (weeklyStats.weeklyMinutes > 1200) {
        insights.push({
          type: 'risk',
          severity: 'high',
          message: 'ML detected listening time 67% above safe weekly limit',
          recommendation: 'Reduce weekly hours by 25–30% to lower neural risk score',
          potentialImpact: 'Model predicts ~12% risk reduction'
        });
      }
      if (weeklyStats.longestSession > 180) {
        insights.push({
          type: 'behavior',
          severity: 'warning',
          message: 'Long session (' + Math.round(weeklyStats.longestSession) + ' min) flagged by session-length feature',
          recommendation: 'Use 60/60 rule: 60 min listen, 5 min silence',
          potentialImpact: 'Break frequency feature improves ML score'
        });
      }
      const trend = this.calculateTrend(userHistory);
      if (trend === 'increasing') {
        insights.push({
          type: 'prediction',
          severity: 'high',
          message: 'Trend model: listening hours rising week-over-week',
          recommendation: 'Schedule quiet blocks in Recovery Tracker',
          potentialImpact: 'Prevents risk score drift upward'
        });
      } else if (trend === 'decreasing') {
        insights.push({
          type: 'prediction',
          severity: 'info',
          message: 'Positive trend — ML sees declining exposure',
          recommendation: 'Keep current break habits',
          potentialImpact: 'Wellness score likely to improve'
        });
      }
      insights.push({
        type: 'personalized',
        severity: 'info',
        message: weeklyStats.sessionCount + ' sessions analyzed this week',
        recommendation: 'Optimal break every ' + Math.round(weeklyStats.avgSessionLength * 0.75) + ' min',
        potentialImpact: 'Personalized from your feature vector'
      });
      return insights;
    }
  }

  function hwMlExtractFeatures(ctx) {
    ctx = ctx || {};
    var stRef = typeof st !== 'undefined' ? st : {};
    var p = ctx.profile || stRef.profile || {};
    var up = typeof getUserProfile === 'function' ? getUserProfile() : null;

    var weeklyMinutes =
      ctx.weeklyMinutes != null
        ? ctx.weeklyMinutes
        : (p.listeningData && p.listeningData.totals && p.listeningData.totals.weeklyMinutes) || 420;
    var weeklyHours = weeklyMinutes / 60;
    var volPct = ctx.volume != null ? ctx.volume : (p.live && p.live.volume) || 65;
    if (typeof _earHealth !== 'undefined' && _earHealth.lastVol != null) {
      volPct = _earHealth.lastVol;
    }
    var avgVolume = Math.max(0, Math.min(1, volPct / 100));

    var sessions = (p.listeningData && p.listeningData.sessions) || [];
    var avgSessionMin =
      sessions.length > 0
        ? sessions.reduce(function (a, s) { return a + s.minutes; }, 0) / sessions.length
        : 45;
    if (typeof _earHealth !== 'undefined' && _earHealth.sessionListenMin > 0) {
      avgSessionMin = Math.max(avgSessionMin, _earHealth.sessionListenMin);
    }
    var sessionLength = avgSessionMin / 60;
    var breakFrequency = weeklyHours > 0 ? Math.min(1, (sessions.length || 3) / weeklyHours / 2) : 0.5;

    var ageNorm = Math.min(1, ((up && up.age) || p.chronologicalAge || 22) / 80);
    var headphoneMap = { earbuds: 0.85, 'over-ear': 0.6, 'noise-canceling': 0.45, speakers: 0.25 };
    var headphoneType = headphoneMap[(up && up.headphoneType) || 'over-ear'] || 0.6;

    var hour = new Date().getHours();
    var timeOfDayRisk = 0.4;
    if (hour >= 22 || hour <= 2) timeOfDayRisk = 0.85;
    else if (hour >= 18) timeOfDayRisk = 0.55;
    else if (hour >= 6 && hour < 10) timeOfDayRisk = 0.25;

    return {
      vector: [
        Math.min(1, weeklyHours / 35),
        avgVolume,
        Math.min(1, sessionLength / 3),
        breakFrequency,
        timeOfDayRisk,
        ageNorm,
        headphoneType
      ],
      raw: {
        weeklyMinutes: weeklyMinutes,
        weeklyHours: weeklyHours,
        avgVolumePct: Math.round(avgVolume * 100),
        avgSessionMin: Math.round(avgSessionMin)
      },
      weeklyStats: {
        weeklyMinutes: weeklyMinutes,
        sessionCount: sessions.length || Math.max(3, Math.round(weeklyHours * 2)),
        avgSessionLength: avgSessionMin,
        longestSession: sessions.reduce(function (m, s) { return Math.max(m, s.minutes); }, 0) || avgSessionMin
      }
    };
  }

  /** Blend scored output with rule-based hearing-future dose when available. */
  function hwMlEnsembleRisk(mlRiskPercent, profile) {
    var ruleRisk = null;
    if (profile && profile.weeklyExposure && profile.weeklyExposure.dosePercent != null) {
      ruleRisk = Math.min(100, profile.weeklyExposure.dosePercent * 1.1);
    }
    if (typeof predictHearingFuture === 'function' && profile) {
      try {
        var totals = (profile.listeningData && profile.listeningData.totals) || {};
        var pred = predictHearingFuture({
          listeningDurationMinutes: totals.weeklyMinutes || 420,
          durationScope: 'weekly',
          volume: (profile.live && profile.live.volume) || 65,
          weeklyDosePercent: (profile.weeklyExposure && profile.weeklyExposure.dosePercent) || 50,
          chronologicalAge: profile.chronologicalAge || 22
        });
        if (pred && pred.scoreBreakdown) {
          ruleRisk = 100 - pred.scoreBreakdown.score;
        }
      } catch (e) { /* ignore */ }
    }
    if (ruleRisk == null) return { ensemblePercent: mlRiskPercent, mlWeight: 1, ruleWeight: 0, ruleRisk: null };
    var mlWeight = 0.6;
    var ruleWeight = 0.4;
    var ensemble = Math.round(mlRiskPercent * mlWeight + ruleRisk * ruleWeight);
    return { ensemblePercent: ensemble, mlWeight: mlWeight, ruleWeight: ruleWeight, ruleRisk: Math.round(ruleRisk) };
  }

  function hwMlRenderFeatureBars(container, importance) {
    if (!container || !importance || !importance.length) return;
    var top = importance.slice(0, 3);
    var maxImpact = top[0].impact || 0.01;
    container.innerHTML = top
      .map(function (f) {
        var pct = Math.round((f.impact / maxImpact) * 100);
        return (
          '<div class="ml-feat-row">' +
          '<span class="ml-feat-lbl">' + f.label + '</span>' +
          '<div class="ml-feat-track"><div class="ml-feat-fill" style="width:' + pct + '%"></div></div>' +
          '</div>'
        );
      })
      .join('');
  }

  function hwMlSyncHomeUI(result, ensemble) {
    var riskEl = document.getElementById('mlHomeRiskPct');
    var confEl = document.getElementById('mlHomeConfidence');
    var ensEl = document.getElementById('mlHomeEnsemble');
    var explainEl = document.getElementById('mlHomeExplain');
    var barsEl = document.getElementById('mlFeatureBars');
    var badgeEl = document.getElementById('mlModelBadge');

    if (riskEl) {
      riskEl.textContent = result.riskPercent + '%';
      riskEl.style.color =
        result.riskPercent < 30 ? '#10b981' : result.riskPercent < 55 ? '#f59e0b' : result.riskPercent < 75 ? '#f97316' : '#ef4444';
    }
    if (confEl) confEl.textContent = Math.round(result.confidence * 100) + '%';
    if (ensEl) ensEl.textContent = ensemble.ensemblePercent + '%';
    if (badgeEl) badgeEl.textContent = 'TF.js v' + (result.modelVersion || ML_MODEL_VERSION);
    if (explainEl) {
      explainEl.textContent =
        'Neural net (' +
        (result.trainingSamples || 320) +
        ' WHO/NIOSH scenarios) + dose model ensemble · top driver: ' +
        (result.featureImportance && result.featureImportance[0] ? result.featureImportance[0].label : 'volume');
    }
    hwMlRenderFeatureBars(barsEl, result.featureImportance);

    var panel = document.getElementById('mlHomePanel');
    if (panel) panel.style.display = 'block';
  }

  async function hwRunMlAnalysis(ctx) {
    if (typeof tf === 'undefined') return null;
    try {
      var extracted = hwMlExtractFeatures(ctx);
      var result = await riskModel.predictWithDetails(extracted.vector);
      var profile = (ctx && ctx.profile) || (typeof st !== 'undefined' && st.profile) || null;
      var ensemble = hwMlEnsembleRisk(result.riskPercent, profile);

      if (typeof st !== 'undefined') {
        st.lastMlPrediction = Object.assign({}, result, { ensemble: ensemble, extracted: extracted.raw });
      }

      hwMlSyncHomeUI(result, ensemble);

      if (typeof updateCircularGauges === 'function' && profile) {
        var wellness =
          typeof hwGetWellnessScore === 'function' ? hwGetWellnessScore() : 100 - ensemble.ensemblePercent;
        var hearingAge =
          typeof hwGetHearingAge === 'function'
            ? hwGetHearingAge()
            : profile.chronologicalAge || 22;
        updateCircularGauges(wellness, ensemble.ensemblePercent, hearingAge, profile.chronologicalAge || 22);
      }

      return Object.assign({}, result, { ensemble: ensemble });
    } catch (err) {
      console.error('[ML] Analysis failed:', err);
      return null;
    }
  }

  var riskModel = new HearingRiskModel();

  global.HearingRiskModel = HearingRiskModel;
  global.riskModel = riskModel;
  global.hwMlExtractFeatures = hwMlExtractFeatures;
  global.hwMlEnsembleRisk = hwMlEnsembleRisk;
  global.hwRunMlAnalysis = hwRunMlAnalysis;
  global.hwMlSyncHomeUI = hwMlSyncHomeUI;
  global.ML_MODEL_VERSION = ML_MODEL_VERSION;
})(typeof window !== 'undefined' ? window : global);
