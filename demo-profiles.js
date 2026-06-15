/**
 * HearWise demo listening profiles (NIOSH-inspired dose model).
 * Reference: 80 dB ≈ 40 h/week safe exposure; each +3 dB halves allowed time.
 * Wellness tool only — not a medical diagnosis.
 */
const DEMO_PROFILES = {
  safe: {
    id: 'safe',
    name: 'Safe Listener',
    tagline: 'Conservative volume, short daily sessions',
    persona: 'Office worker who keeps earbuds under 60% (~4 h/week) and takes listening breaks.',
    chronologicalAge: 28,

    live: {
      volume: 52,
      db: 71,
      track: { name: 'Golden', artist: 'Harry Styles', duration: 209 },
      trackIdx: 1
    },

    listeningData: {
      sessions: [
        { day: 'Mon', label: 'Morning commute', minutes: 28, avgDb: 70, peakDb: 74 },
        { day: 'Mon', label: 'Focus playlist', minutes: 35, avgDb: 72, peakDb: 76 },
        { day: 'Tue', label: 'Podcast walk', minutes: 22, avgDb: 68, peakDb: 72 },
        { day: 'Wed', label: 'Study ambient', minutes: 40, avgDb: 71, peakDb: 75 },
        { day: 'Thu', label: 'Commute', minutes: 25, avgDb: 69, peakDb: 73 },
        { day: 'Fri', label: 'Evening unwind', minutes: 45, avgDb: 73, peakDb: 77 },
        { day: 'Sat', label: 'Chores', minutes: 30, avgDb: 70, peakDb: 74 },
        { day: 'Sun', label: 'Light listening', minutes: 20, avgDb: 68, peakDb: 71 }
      ],
      totals: {
        weeklyMinutes: 245,
        weeklyHours: 4.1,
        avgDb: 71,
        minutesAbove85: 0,
        peakDb: 77
      }
    },

    weeklyExposure: {
      dosePercent: 28,
      safeHoursAt80dB: 40,
      equivalentHoursAt80dB: 11.2,
      interpretation: 'Well under the weekly safe exposure budget at your average levels (~35 min/day).',
      byDay: [
        { day: 'Mon', dosePct: 32, hours: 1.05 },
        { day: 'Tue', dosePct: 18, hours: 0.37 },
        { day: 'Wed', dosePct: 35, hours: 0.67 },
        { day: 'Thu', dosePct: 20, hours: 0.42 },
        { day: 'Fri', dosePct: 42, hours: 0.75 },
        { day: 'Sat', dosePct: 25, hours: 0.5 },
        { day: 'Sun', dosePct: 15, hours: 0.33 }
      ]
    },

    metrics: {
      todayMinutes: 63,
      avgDb: 71,
      dailyDosePct: 24,
      streakDays: 18
    },

    healthScore: 92,
    riskTier: 'low',
    riskLabel: 'Low Risk',
    riskStatusClass: 'safe',

    riskExplanation: {
      summary:
        'You listen about 35 minutes per day at ~71 dB with no sustained time above 85 dB. Weekly noise dose is about 28% of the NIOSH-style safe budget.',
      factors: [
        { label: 'Weekly listening', value: '4.1 h', impact: 'positive' },
        { label: 'Weekly dose', value: '28%', impact: 'positive' },
        { label: 'Time above 85 dB', value: '0 min', impact: 'positive' },
        { label: 'Typical volume', value: '52% (~71 dB)', impact: 'positive' }
      ]
    },

    recommendations: [
      {
        action: 'Keep daily listening to about 90 minutes or less, with a short break in the middle.',
        benefit: 'Helps you stay well inside your safe weekly listening allowance.'
      },
      {
        action: 'Take a 10-minute quiet break every hour on longer listening days.',
        benefit: 'Gives your ears recovery time so loudness adds up more slowly.'
      },
      {
        action: 'Use noise-isolating headphones on transit and in busy spaces instead of turning volume up.',
        benefit: 'You hear clearly at a lower level, which is one of the best prevention habits.'
      }
    ],

    forecast: [
      { period: '2 weeks', riskIndex: 12, label: 'Stable', detail: 'On track to remain under 40% weekly dose' },
      { period: '1 month', riskIndex: 15, label: 'Stable', detail: 'Habits support long-term prevention' },
      { period: '3 months', riskIndex: 18, label: 'Low concern', detail: 'Minimal change if patterns hold' },
      { period: '6 months', riskIndex: 22, label: 'Low concern', detail: 'Continue periodic volume checks' },
      { period: '1 year', riskIndex: 25, label: 'Low concern', detail: 'Strong prevention profile' }
    ],

    alerts: [
      {
        type: 'success',
        title: 'Safe Listening Streak',
        message: '18 days under 50% daily dose. Your habits are protecting your hearing.'
      }
    ]
  },

  student: {
    id: 'student',
    name: 'Typical Student',
    tagline: 'Study marathons and commute listening at moderate–high volume',
    persona: 'College student with ~2.4 h/day on Spotify between classes, gym, and late-night study.',
    chronologicalAge: 21,

    live: {
      volume: 68,
      db: 81,
      track: { name: 'Espresso', artist: 'Sabrina Carpenter', duration: 175 },
      trackIdx: 3
    },

    listeningData: {
      sessions: [
        { day: 'Mon', label: 'Campus commute', minutes: 35, avgDb: 79, peakDb: 84 },
        { day: 'Mon', label: 'Library focus', minutes: 120, avgDb: 78, peakDb: 83 },
        { day: 'Tue', label: 'Gym workout', minutes: 50, avgDb: 82, peakDb: 87 },
        { day: 'Tue', label: 'Between-class listening', minutes: 40, avgDb: 77, peakDb: 82 },
        { day: 'Wed', label: 'Late-night study', minutes: 150, avgDb: 80, peakDb: 86 },
        { day: 'Thu', label: 'Commute + walk', minutes: 45, avgDb: 79, peakDb: 84 },
        { day: 'Thu', label: 'Group project', minutes: 75, avgDb: 78, peakDb: 83 },
        { day: 'Fri', label: 'Social / pre-game', minutes: 120, avgDb: 83, peakDb: 88 },
        { day: 'Sat', label: 'Recovery listening', minutes: 90, avgDb: 77, peakDb: 82 },
        { day: 'Sun', label: 'Sunday reset', minutes: 95, avgDb: 76, peakDb: 81 }
      ],
      totals: {
        weeklyMinutes: 820,
        weeklyHours: 13.7,
        avgDb: 79,
        minutesAbove85: 62,
        peakDb: 88
      }
    },

    weeklyExposure: {
      dosePercent: 72,
      safeHoursAt80dB: 40,
      equivalentHoursAt80dB: 28.8,
      interpretation:
        'Approaching the weekly safe limit at ~1.9 h/day. Wednesday study blocks and Friday evenings drive most of your dose.',
      byDay: [
        { day: 'Mon', dosePct: 78, hours: 2.58 },
        { day: 'Tue', dosePct: 62, hours: 1.5 },
        { day: 'Wed', dosePct: 92, hours: 2.5 },
        { day: 'Thu', dosePct: 58, hours: 2.0 },
        { day: 'Fri', dosePct: 98, hours: 2.0 },
        { day: 'Sat', dosePct: 55, hours: 1.5 },
        { day: 'Sun', dosePct: 48, hours: 1.58 }
      ]
    },

    metrics: {
      todayMinutes: 155,
      avgDb: 79,
      dailyDosePct: 68,
      streakDays: 0
    },

    healthScore: 71,
    riskTier: 'elevated',
    riskLabel: 'Elevated Risk',
    riskStatusClass: 'warn',

    riskExplanation: {
      summary:
        'You average 79 dB over ~13.7 hours per week (~2 h/day) with 62 minutes above 85 dB. At this pace you will exceed the safe weekly dose unless volume or duration drops.',
      factors: [
        { label: 'Weekly listening', value: '13.7 h', impact: 'warning' },
        { label: 'Weekly dose', value: '72%', impact: 'warning' },
        { label: 'Time above 85 dB', value: '62 min', impact: 'warning' },
        { label: 'Wednesday study block', value: '2.5 h at 80 dB avg', impact: 'negative' }
      ]
    },

    recommendations: [
      {
        action: 'Listen one volume step lower during library study and campus commutes.',
        benefit: 'Often lets you keep the same study time with much less ear strain over the week.'
      },
      {
        action: 'On late-night study, take a 10-minute listening break every hour and end the session earlier when you can.',
        benefit: 'Wednesday-style marathons are your biggest risk — this directly targets that pattern.'
      },
      {
        action: 'At the gym, use noise-isolating headphones so you can listen one step quieter.',
        benefit: 'You still get energy from your playlist without pushing volume in a loud room.'
      }
    ],

    forecast: [
      { period: '2 weeks', riskIndex: 55, label: 'Rising', detail: 'Projected to hit 85% weekly dose' },
      { period: '1 month', riskIndex: 68, label: 'Elevated', detail: 'Repeated over-limit weeks likely' },
      { period: '3 months', riskIndex: 74, label: 'Elevated', detail: 'Without changes, dose stays high' },
      { period: '6 months', riskIndex: 78, label: 'High concern', detail: 'Cumulative exposure adds up' },
      { period: '1 year', riskIndex: 82, label: 'High concern', detail: 'Sustained elevated listening pattern' }
    ],

    alerts: [
      {
        type: 'warning',
        title: 'Weekly Dose Approaching Limit',
        message: 'You are at 72% of your safe weekly dose with two high-exposure days remaining.'
      },
      {
        type: 'warning',
        title: 'Late-Night Volume Pattern',
        message: 'Wednesday sessions averaged 80 dB for 2.5 hours. Consider a volume cap after 10 PM.'
      }
    ]
  },

  highRisk: {
    id: 'highRisk',
    name: 'High-Risk Listener',
    tagline: 'Long sessions at high volume — weekly dose over safe limits',
    persona: 'Heavy headphone user: 4.5+ hours/day, often max volume on commute and gaming playlists.',
    chronologicalAge: 22,

    live: {
      volume: 88,
      db: 93,
      track: { name: 'SICKO MODE', artist: 'Travis Scott', duration: 313 },
      trackIdx: 0
    },

    listeningData: {
      sessions: [
        { day: 'Mon', label: 'Commute (max volume)', minutes: 90, avgDb: 91, peakDb: 96 },
        { day: 'Mon', label: 'Afternoon gaming', minutes: 150, avgDb: 89, peakDb: 94 },
        { day: 'Tue', label: 'All-day background', minutes: 200, avgDb: 87, peakDb: 92 },
        { day: 'Wed', label: 'Gym + commute', minutes: 120, avgDb: 92, peakDb: 97 },
        { day: 'Thu', label: 'Late-night stream', minutes: 180, avgDb: 90, peakDb: 95 },
        { day: 'Fri', label: 'Party prep / loud playlists', minutes: 160, avgDb: 93, peakDb: 98 },
        { day: 'Sat', label: 'Gaming marathon', minutes: 240, avgDb: 88, peakDb: 93 },
        { day: 'Sun', label: 'Recovery (still loud)', minutes: 120, avgDb: 86, peakDb: 91 }
      ],
      totals: {
        weeklyMinutes: 1260,
        weeklyHours: 21,
        avgDb: 90,
        minutesAbove85: 780,
        peakDb: 98
      }
    },

    weeklyExposure: {
      dosePercent: 128,
      safeHoursAt80dB: 40,
      equivalentHoursAt80dB: 51.2,
      interpretation:
        'You are over the weekly safe exposure budget at ~3 h/day. At 90 dB, safe continuous exposure is only ~4 hours/week — you are well above that equivalent.',
      byDay: [
        { day: 'Mon', dosePct: 118, hours: 4.0 },
        { day: 'Tue', dosePct: 132, hours: 3.33 },
        { day: 'Wed', dosePct: 105, hours: 2.0 },
        { day: 'Thu', dosePct: 128, hours: 3.0 },
        { day: 'Fri', dosePct: 135, hours: 2.67 },
        { day: 'Sat', dosePct: 142, hours: 4.0 },
        { day: 'Sun', dosePct: 98, hours: 2.0 }
      ]
    },

    metrics: {
      todayMinutes: 240,
      avgDb: 90,
      dailyDosePct: 98,
      streakDays: 0
    },

    healthScore: 48,
    riskTier: 'high',
    riskLabel: 'High Risk',
    riskStatusClass: 'danger',

    riskExplanation: {
      summary:
        'Sustained listening at 87–93 dB for 21 hours per week (~3 h/day) puts you at 128% of the safe weekly dose. Most damage risk comes from long sessions above 85 dB, especially Monday, Tuesday, and Saturday.',
      factors: [
        { label: 'Weekly listening', value: '21 h', impact: 'negative' },
        { label: 'Weekly dose', value: '128%', impact: 'negative' },
        { label: 'Time above 85 dB', value: '780 min (13 h)', impact: 'negative' },
        { label: 'Typical volume', value: '88% (~93 dB)', impact: 'negative' }
      ]
    },

    recommendations: [
      {
        action: 'Turn volume down two steps for commuting, gaming, and background music.',
        benefit: 'One of the fastest ways to pull your weekly listening stress back toward a safer range.'
      },
      {
        action: 'After 60 minutes of continuous listening, take a 15-minute break with no audio.',
        benefit: 'Stops long sessions from stacking damage across your busiest days.'
      },
      {
        action: 'Use noise-isolating headphones in loud places; use speakers instead of earbuds for home gaming when possible.',
        benefit: 'Lowers ear-level loudness without giving up music during marathons or transit.'
      }
    ],

    forecast: [
      { period: '2 weeks', riskIndex: 88, label: 'Critical', detail: 'Continued over-exposure every week' },
      { period: '1 month', riskIndex: 92, label: 'Critical', detail: 'Pattern suggests chronic dose overload' },
      { period: '3 months', riskIndex: 95, label: 'Severe', detail: 'High cumulative exposure without intervention' },
      { period: '6 months', riskIndex: 97, label: 'Severe', detail: 'Urgent habit change recommended' },
      { period: '1 year', riskIndex: 98, label: 'Severe', detail: 'Prevention window narrowing — act now' }
    ],

    alerts: [
      {
        type: 'critical',
        title: 'Weekly Safe Dose Exceeded',
        message: 'You are at 128% of the safe weekly exposure. Reduce volume or listening time today.'
      },
      {
        type: 'critical',
        title: 'Sustained Levels Above 85 dB',
        message: 'Over 13 hours this week above 85 dB. At 90 dB, safe exposure is only ~4 hours per week.'
      }
    ]
  },

  aishwarya: {
    id: 'aishwarya',
    name: 'Aishu',
    tagline: 'Spotify connected with real-time hearing health tracking',
    persona: 'Spotify connected for real listening history and volume tracking.',
    chronologicalAge: 25,
    isLive: true,

    live: {
      volume: 0,
      db: 0,
      track: null,
      trackIdx: 0
    },

    spotify: {
      connected: false,
      profile: null,
      currentTrack: null,
      weeklyStats: null,
      exposureScore: null
    },

    listeningData: {
      sessions: [],
      totals: {
        weeklyMinutes: 0,
        weeklyHours: 0,
        avgDb: 0,
        minutesAbove85: 0,
        peakDb: 0
      }
    },

    weeklyExposure: {
      dosePercent: 0,
      safeHoursAt80dB: 40,
      equivalentHoursAt80dB: 0,
      interpretation: 'Connect Spotify to load your real listening history and exposure dose.',
      byDay: []
    },

    metrics: {
      todayMinutes: 0,
      avgDb: 0,
      dailyDosePct: 0,
      streakDays: 0
    },

    healthScore: 100,
    riskTier: 'live',
    riskLabel: 'Live Monitoring',
    riskStatusClass: 'live',

    riskExplanation: {
      summary: 'Live Spotify monitoring. Your wellness score, hearing age, and exposure dose update from real listening history and device volume.',
      factors: [
        { label: 'Spotify connection', value: 'Required', impact: 'neutral' },
        { label: 'Recently played', value: 'Last 7 days', impact: 'neutral' },
        { label: 'Device volume', value: 'Live', impact: 'neutral' },
        { label: 'NIOSH dose', value: 'Calculated', impact: 'neutral' }
      ]
    },

    recommendations: [
      {
        action: 'Start a Slack Huddle to test huddle detection.',
        benefit: 'HearWise will detect huddle start/end and send Slack notifications.'
      },
      {
        action: 'Join a Slack Call to test call detection.',
        benefit: 'HearWise will track call duration and exposure.'
      }
    ],

    forecast: [
      { period: '2 weeks', riskIndex: 0, label: 'Live', detail: 'Real-time data will populate forecasts' },
      { period: '1 month', riskIndex: 0, label: 'Live', detail: 'Based on actual usage patterns' },
      { period: '3 months', riskIndex: 0, label: 'Live', detail: 'Accumulated exposure tracking' },
      { period: '6 months', riskIndex: 0, label: 'Live', detail: 'Long-term trend analysis' },
      { period: '1 year', riskIndex: 0, label: 'Live', detail: 'Annual hearing health report' }
    ],

    alerts: [
      {
        type: 'info',
        title: 'Slack Workspace Monitoring Active',
        message: 'Real-time Huddle and Call detection enabled. Events will appear in timeline.'
      }
    ],

    timeline: []
  }
};

/** Demo planner blocks — seeded per profile when switching profiles */
const LP_DEMO_PLAN_BY_PROFILE = {
  safe: [
    {
      id: 'lp_first_minute',
      title: 'Research Sync Meeting',
      startTime: '09:00',
      durationMin: 30,
      type: 'meeting',
      notes: 'Weekly team sync — Join Meeting timer tracks ~70 dB call exposure; take a 5-min ear rest after',
      reminders: { ear: true, hydration: true, stretch: false },
      done: false
    },
    {
      id: 'lp_demo_focus',
      title: 'Morning Focus Block',
      startTime: '10:00',
      durationMin: 45,
      type: 'study',
      notes: 'Deep work with lofi at ≤60% — 1-Min Focus & Study sprint in Live Ear Recovery',
      reminders: { ear: true, hydration: false, stretch: true },
      done: false
    },
    {
      id: 'lp_demo_walk',
      title: 'Podcast Walk',
      startTime: '12:30',
      durationMin: 25,
      type: 'podcast',
      notes: 'Light commute listening — stay in the green volume zone',
      reminders: { ear: true, hydration: false, stretch: false },
      done: false
    }
  ],
  student: [
    {
      id: 'lp_first_minute',
      title: 'Research Sync Meeting',
      startTime: '09:30',
      durationMin: 45,
      type: 'meeting',
      notes: 'Lab sync with advisor — meeting timer runs during the call; ear rest after',
      reminders: { ear: true, hydration: true, stretch: false },
      done: false
    },
    {
      id: 'lp_demo_library',
      title: 'Library Study Block',
      startTime: '11:00',
      durationMin: 90,
      type: 'study',
      notes: 'Longest block today — use 1-Min Focus & Study sprints + mandatory ear rests',
      reminders: { ear: true, hydration: true, stretch: true },
      done: false
    },
    {
      id: 'lp_demo_gym',
      title: 'Gym Playlist',
      startTime: '17:00',
      durationMin: 50,
      type: 'music',
      notes: 'Workout mode — noise-isolating buds so you can listen quieter',
      reminders: { ear: true, hydration: true, stretch: false },
      done: false
    },
    {
      id: 'lp_demo_late',
      title: 'Late-Night Study',
      startTime: '21:00',
      durationMin: 75,
      type: 'study',
      notes: 'Highest risk block — lower volume after 10 PM',
      reminders: { ear: true, hydration: false, stretch: true },
      done: false
    }
  ],
  highRisk: [
    {
      id: 'lp_first_minute',
      title: 'Research Sync Meeting',
      startTime: '09:00',
      durationMin: 45,
      type: 'meeting',
      notes: 'Team standup — Join Meeting timer tracks call exposure; ear rest after',
      reminders: { ear: true, hydration: false, stretch: false },
      done: false
    },
    {
      id: 'lp_demo_commute',
      title: 'Commute (High Volume)',
      startTime: '08:00',
      durationMin: 75,
      type: 'music',
      notes: 'Your loudest block — try turning down 2 notches today',
      reminders: { ear: true, hydration: false, stretch: false },
      done: false
    },
    {
      id: 'lp_demo_gaming',
      title: 'Gaming Marathon Block',
      startTime: '14:00',
      durationMin: 120,
      type: 'gaming',
      notes: 'Split into 45-min sprints with 15-min silence breaks',
      reminders: { ear: true, hydration: true, stretch: true },
      done: false
    },
    {
      id: 'lp_demo_stream',
      title: 'Late-Night Stream',
      startTime: '22:00',
      durationMin: 90,
      type: 'gaming',
      notes: 'Night listening drives dose — end session by midnight if possible',
      reminders: { ear: true, hydration: false, stretch: false },
      done: false
    }
  ]
};

/** Demo safe-listening session history for Live Ear Recovery (per profile) */
const LP_DEMO_LS_BY_PROFILE = {
  safe: {
    sessions: [
      {
        id: 'ls_demo_safe_1',
        number: 1,
        mode: 'studyQuick',
        startedAt: Date.now() - 7200000,
        endedAt: Date.now() - 6900000,
        durationMin: 5,
        avgVolumePercent: 54,
        focusMinutes: 4,
        breakCount: 1,
        productivityScore: 88,
        riskLevel: 'Safe',
        trackName: 'Golden',
        artistName: 'Harry Styles',
        autoDetected: true
      }
    ],
    active: null,
    nextNumber: 2,
    defaultMode: 'studyQuick'
  },
  student: {
    sessions: [
      {
        id: 'ls_demo_stu_1',
        number: 1,
        mode: 'studyQuick',
        startedAt: Date.now() - 10800000,
        endedAt: Date.now() - 10500000,
        durationMin: 8,
        avgVolumePercent: 62,
        focusMinutes: 6,
        breakCount: 1,
        productivityScore: 76,
        riskLevel: 'Moderate',
        trackName: 'Study Beats',
        artistName: 'Lofi Girl',
        autoDetected: true
      },
      {
        id: 'ls_demo_stu_2',
        number: 2,
        mode: 'focus',
        startedAt: Date.now() - 5400000,
        endedAt: Date.now() - 3600000,
        durationMin: 30,
        avgVolumePercent: 68,
        focusMinutes: 22,
        breakCount: 2,
        productivityScore: 71,
        riskLevel: 'Elevated',
        trackName: 'Espresso',
        artistName: 'Sabrina Carpenter',
        autoDetected: true
      }
    ],
    active: null,
    nextNumber: 3,
    defaultMode: 'studyQuick'
  },
  highRisk: {
    sessions: [
      {
        id: 'ls_demo_hr_1',
        number: 1,
        mode: 'active',
        startedAt: Date.now() - 14400000,
        endedAt: Date.now() - 12600000,
        durationMin: 30,
        avgVolumePercent: 86,
        focusMinutes: 8,
        breakCount: 0,
        productivityScore: 42,
        riskLevel: 'High',
        trackName: 'SICKO MODE',
        artistName: 'Travis Scott',
        autoDetected: true
      }
    ],
    active: null,
    nextNumber: 2,
    defaultMode: 'active'
  }
};

/** Default profile for demo mode */
const DEFAULT_DEMO_PROFILE_ID = 'student';

function getDemoProfile(id) {
  return DEMO_PROFILES[id] || DEMO_PROFILES[DEFAULT_DEMO_PROFILE_ID];
}

function getDemoPlanForProfile(id) {
  return (LP_DEMO_PLAN_BY_PROFILE[id] || LP_DEMO_PLAN_BY_PROFILE.safe || []).map(function (s) {
    return Object.assign({}, s);
  });
}

function getDemoLsStoreForProfile(id) {
  var base = LP_DEMO_LS_BY_PROFILE[id];
  if (!base) return null;
  return JSON.parse(JSON.stringify(base));
}
