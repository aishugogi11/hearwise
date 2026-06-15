// Challenge Data Structure and Preset Challenges

const CHALLENGE_TEMPLATES = {
  safe: [
    {
      id: 'safe-maintain-volume',
      title: 'Maintain Safe Volume',
      description: 'Keep your average listening volume below 60% during all listening sessions.',
      whyItMatters: 'Even safe listeners can benefit from maintaining consistent healthy volume levels for long-term hearing preservation.',
      expectedImpact: {
        wellnessScore: 5,
        hearingRiskAge: 0,
        safetyScore: 5,
        riskScore: -3
      },
      duration: 7,
      icon: 'fa-volume-low',
      category: 'volume',
      impactLevel: 'low'
    },
    {
      id: 'safe-weekly-checkin',
      title: 'Weekly Hearing Check-In',
      description: 'Complete a weekly hearing wellness assessment to track your progress.',
      whyItMatters: 'Regular check-ins help you stay aware of your hearing health and catch issues early.',
      expectedImpact: {
        wellnessScore: 3,
        hearingRiskAge: 0,
        safetyScore: 3,
        riskScore: -2
      },
      duration: 7,
      icon: 'fa-clipboard-check',
      category: 'checkin',
      impactLevel: 'low'
    },
    {
      id: 'safe-safe-streak',
      title: 'Safe Listening Streak',
      description: 'Maintain safe listening habits for 7 consecutive days.',
      whyItMatters: 'Building consistent safe habits reinforces healthy listening patterns.',
      expectedImpact: {
        wellnessScore: 5,
        hearingRiskAge: 0,
        safetyScore: 5,
        riskScore: -3
      },
      duration: 7,
      icon: 'fa-fire',
      category: 'streak',
      impactLevel: 'low'
    },
    {
      id: 'safe-habit-audit',
      title: 'Listening Habit Audit',
      description: 'Review your listening patterns and identify areas for improvement.',
      whyItMatters: 'Self-awareness is the first step to maintaining optimal hearing health.',
      expectedImpact: {
        wellnessScore: 3,
        hearingRiskAge: 0,
        safetyScore: 3,
        riskScore: -2
      },
      duration: 7,
      icon: 'fa-chart-line',
      category: 'audit',
      impactLevel: 'low'
    },
    {
      id: 'safe-protect-progress',
      title: 'Protect Your Progress',
      description: 'Continue your healthy listening habits and avoid risky behaviors.',
      whyItMatters: 'Protecting your progress ensures long-term hearing wellness.',
      expectedImpact: {
        wellnessScore: 4,
        hearingRiskAge: 0,
        safetyScore: 4,
        riskScore: -2
      },
      duration: 7,
      icon: 'fa-shield-check',
      category: 'protection',
      impactLevel: 'low'
    }
  ],
  student: [
    {
      id: 'student-lower-volume',
      title: 'Lower Volume by 15%',
      description: 'Reduce your listening volume by 15% across all sessions.',
      whyItMatters: 'A 15% volume reduction can significantly lower your weekly hearing exposure.',
      expectedImpact: {
        wellnessScore: 10,
        hearingRiskAge: -2,
        safetyScore: 10,
        riskScore: -8
      },
      duration: 7,
      icon: 'fa-volume-down',
      category: 'volume',
      impactLevel: 'medium'
    },
    {
      id: 'student-daily-breaks',
      title: 'Daily Listening Breaks',
      description: 'Take a 10-minute break after every 60 minutes of listening.',
      whyItMatters: 'Regular breaks prevent cumulative hearing damage during long study sessions.',
      expectedImpact: {
        wellnessScore: 10,
        hearingRiskAge: -1,
        safetyScore: 10,
        riskScore: -7
      },
      duration: 7,
      icon: 'fa-clock',
      category: 'breaks',
      impactLevel: 'medium'
    },
    {
      id: 'student-time-reduction',
      title: 'Listening Time Reduction',
      description: 'Reduce your total daily listening time by 30 minutes.',
      whyItMatters: 'Less listening time means less cumulative exposure to sound.',
      expectedImpact: {
        wellnessScore: 10,
        hearingRiskAge: -2,
        safetyScore: 10,
        riskScore: -8
      },
      duration: 7,
      icon: 'fa-hourglass-half',
      category: 'time',
      impactLevel: 'medium'
    },
    {
      id: 'student-ear-recovery',
      title: 'Ear Recovery Sessions',
      description: 'Schedule 30-minute quiet recovery periods after long listening sessions.',
      whyItMatters: 'Recovery periods help your ears rest and recover from extended use.',
      expectedImpact: {
        wellnessScore: 10,
        hearingRiskAge: -1,
        safetyScore: 10,
        riskScore: -7
      },
      duration: 7,
      icon: 'fa-ear-listen',
      category: 'recovery',
      impactLevel: 'medium'
    },
    {
      id: 'student-safe-commute',
      title: 'Safe Commute Listening',
      description: 'Use noise-canceling headphones during commutes to listen at lower volumes.',
      whyItMatters: 'Commutes are long sessions; lower volume significantly reduces exposure.',
      expectedImpact: {
        wellnessScore: 10,
        hearingRiskAge: -2,
        safetyScore: 10,
        riskScore: -8
      },
      duration: 7,
      icon: 'fa-bus',
      category: 'commute',
      impactLevel: 'medium'
    }
  ],
  highRisk: [
    {
      id: 'highrisk-recovery-program',
      title: '7-Day Hearing Recovery Program',
      description: 'Complete a comprehensive 7-day program to recover from high-risk listening.',
      whyItMatters: 'Intensive recovery is needed to reverse cumulative hearing damage from high exposure.',
      expectedImpact: {
        wellnessScore: 15,
        hearingRiskAge: -4,
        safetyScore: 15,
        riskScore: -15
      },
      duration: 7,
      icon: 'fa-heart-pulse',
      category: 'recovery',
      impactLevel: 'high'
    },
    {
      id: 'highrisk-volume-reduction',
      title: 'Volume Reduction Program',
      description: 'Reduce your listening volume by 25% across all sessions.',
      whyItMatters: 'Aggressive volume reduction is necessary to lower your high-risk exposure.',
      expectedImpact: {
        wellnessScore: 15,
        hearingRiskAge: -3,
        safetyScore: 15,
        riskScore: -12
      },
      duration: 7,
      icon: 'fa-volume-low',
      category: 'volume',
      impactLevel: 'high'
    },
    {
      id: 'highrisk-noise-tracker',
      title: 'Noise Exposure Tracker',
      description: 'Monitor and limit your exposure to high-noise environments.',
      whyItMatters: 'Identifying and avoiding high-noise situations is crucial for hearing protection.',
      expectedImpact: {
        wellnessScore: 15,
        hearingRiskAge: -3,
        safetyScore: 15,
        riskScore: -12
      },
      duration: 7,
      icon: 'fa-wave-square',
      category: 'tracking',
      impactLevel: 'high'
    },
    {
      id: 'highrisk-safe-reset',
      title: 'Safe Listening Reset',
      description: 'Reset your listening habits to safe levels for 7 consecutive days.',
      whyItMatters: 'A complete reset is necessary to break high-risk patterns and establish safe habits.',
      expectedImpact: {
        wellnessScore: 15,
        hearingRiskAge: -4,
        safetyScore: 15,
        riskScore: -15
      },
      duration: 7,
      icon: 'fa-rotate',
      category: 'reset',
      impactLevel: 'high'
    },
    {
      id: 'highrisk-bootcamp',
      title: 'Hearing Protection Bootcamp',
      description: 'Complete an intensive hearing protection training program.',
      whyItMatters: 'Bootcamp-style training reinforces safe habits and prevents future damage.',
      expectedImpact: {
        wellnessScore: 15,
        hearingRiskAge: -4,
        safetyScore: 15,
        riskScore: -15
      },
      duration: 7,
      icon: 'fa-dumbbell',
      category: 'bootcamp',
      impactLevel: 'high'
    }
  ]
};

const ACHIEVEMENTS = {
  'safe-listening-streak': {
    id: 'safe-listening-streak',
    title: 'Safe Listening Streak',
    description: 'Complete a 7-day challenge without any high-risk sessions',
    icon: 'fa-shield-halved',
    rarity: 'common'
  },
  'recovery-champion': {
    id: 'recovery-champion',
    title: 'Recovery Champion',
    description: 'Complete 3 break-related challenges',
    icon: 'fa-clock',
    rarity: 'rare'
  },
  'volume-control-expert': {
    id: 'volume-control-expert',
    title: 'Volume Control Expert',
    description: 'Complete 5 volume-related challenges',
    icon: 'fa-volume-low',
    rarity: 'rare'
  },
  'healthy-commute': {
    id: 'healthy-commute',
    title: 'Healthy Commute Listener',
    description: 'Complete a commute volume challenge',
    icon: 'fa-bus',
    rarity: 'common'
  },
  'gaming-wellness': {
    id: 'gaming-wellness',
    title: 'Gaming Wellness Champion',
    description: 'Complete a gaming volume challenge',
    icon: 'fa-gamepad',
    rarity: 'rare'
  },
  'weekend-warrior': {
    id: 'weekend-warrior',
    title: 'Weekend Warrior',
    description: 'Complete a weekend recovery challenge',
    icon: 'fa-calendar-week',
    rarity: 'common'
  },
  'perfect-week': {
    id: 'perfect-week',
    title: 'Perfect Week',
    description: 'Complete 3 challenges in a single week',
    icon: 'fa-star',
    rarity: 'legendary'
  },
  'hearing-hero': {
    id: 'hearing-hero',
    title: 'Hearing Hero',
    description: 'Complete 10 total challenges',
    icon: 'fa-trophy',
    rarity: 'legendary'
  }
};

function getChallengesForProfile(profileId) {
  return CHALLENGE_TEMPLATES[profileId] || CHALLENGE_TEMPLATES.safe;
}

function getChallengeById(challengeId) {
  for (const profile in CHALLENGE_TEMPLATES) {
    const challenge = CHALLENGE_TEMPLATES[profile].find(c => c.id === challengeId);
    if (challenge) return challenge;
  }
  return null;
}

function getAchievementById(achievementId) {
  return ACHIEVEMENTS[achievementId] || null;
}

function getAllAchievements() {
  return Object.values(ACHIEVEMENTS);
}

module.exports = { getChallengesForProfile, getChallengeById, getAllAchievements };
