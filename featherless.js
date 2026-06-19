/**
 * Featherless.ai — OpenAI-compatible chat API for HearWise coach copy.
 * Falls back to null when FEATHERLESS_API_KEY is unset; callers use templates.
 */

const fetch = require('node-fetch');

const AURA_SYSTEM =
  'You are Aura, the HearWise hearing wellness coach. Write concise Slack mrkdwn (bold with *asterisks*). ' +
  'Use ONLY numbers given in the prompt — never invent scores. Max 3–4 sentences. One clear action item. No hashtags.';

function isConfigured() {
  const key = process.env.FEATHERLESS_API_KEY;
  return !!(key && !/^your_/i.test(key) && key !== 'your_key_here');
}

async function featherlessChat(messages, maxTokens = 200) {
  if (!isConfigured()) return null;

  try {
    const res = await fetch('https://api.featherless.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.FEATHERLESS_API_KEY}`,
        'HTTP-Referer': process.env.APP_URL || 'http://127.0.0.1:3000',
        'X-Title': 'HearWise',
      },
      body: JSON.stringify({
        model: process.env.FEATHERLESS_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
        messages,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(function () { return ''; });
      console.log('Featherless API error:', res.status, errText.slice(0, 200));
      return null;
    }

    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim() || null;
  } catch (err) {
    console.log('Featherless request failed:', err.message);
    return null;
  }
}

/** Slack DM after huddle/call ends */
async function featherlessSlackMeetingEnd(opts) {
  const {
    slackUserId,
    eventType,
    duration,
    exposureObj,
    weeklyExposurePercent,
    fallbackRecommendation,
  } = opts;

  return featherlessChat(
    [
      { role: 'system', content: AURA_SYSTEM },
      {
        role: 'user',
        content:
          `Slack user ID: ${slackUserId}. Event: ${eventType} ended. ` +
          `Duration: ${duration} min. Exposure dose: ${exposureObj.dose}%. Risk level: ${exposureObj.level}. ` +
          `Weekly exposure so far: ${weeklyExposurePercent}%. ` +
          `If helpful, align with this fallback advice: ${fallbackRecommendation}`,
      },
    ],
    180
  );
}

/** /hearwise health overview */
async function featherlessSlackOverview(userName, slackUserId, overview) {
  return featherlessChat(
    [
      { role: 'system', content: AURA_SYSTEM },
      {
        role: 'user',
        content:
          `Slack user ${slackUserId} (${userName}) asked for HearWise overview. ` +
          `Risk score: ${overview.riskScore}/100. Level: ${overview.riskLevel}. ` +
          `Hearing age: ${overview.hearingAge} years. Weekly exposure: ${overview.weeklyExposure} hours. ` +
          `Top recommendation from engine: ${overview.topRecommendation}. Summarize warmly for Slack.`,
      },
    ],
    200
  );
}

/** /hearwise risk */
async function featherlessSlackRisk(userName, slackUserId, risk) {
  return featherlessChat(
    [
      { role: 'system', content: AURA_SYSTEM },
      {
        role: 'user',
        content:
          `Slack user ${slackUserId} (${userName}) asked for risk assessment. ` +
          `Overall risk: ${risk.overallRisk}/100. Category: ${risk.riskCategory}. Confidence: ${risk.confidence}%. Trend: ${risk.trend}. ` +
          `Recommendations: ${risk.recommendations.join('; ')}. Explain in plain language for Slack.`,
      },
    ],
    220
  );
}

/** /hearwise summary */
async function featherlessSlackSummary(userName, slackUserId, period, summary) {
  return featherlessChat(
    [
      { role: 'system', content: AURA_SYSTEM },
      {
        role: 'user',
        content:
          `Slack user ${slackUserId} (${userName}) asked for ${period} listening summary. ` +
          `Hours: ${summary.totalHours}. Avg volume: ${summary.avgVolume}%. Sessions: ${summary.sessionCount}. Breaks: ${summary.breakCount}. ` +
          `Engine insight: ${summary.insights}. Give a brief Slack summary with one tip.`,
      },
    ],
    200
  );
}

module.exports = {
  featherlessChat,
  featherlessSlackMeetingEnd,
  featherlessSlackOverview,
  featherlessSlackRisk,
  featherlessSlackSummary,
  isFeatherlessConfigured: isConfigured,
};
