const pool = require('../database/connection');

// Listening pattern helpers
// Implements user segmentation, listening pattern analysis, and habit detection

class BehavioralAnalyzer {
  constructor() {
    this.segments = {
      'safe_listener': {
        criteria: { avgVolume: 75, weeklyHours: 20, dosePercent: 100 },
        description: 'Users with healthy listening habits'
      },
      'moderate_user': {
        criteria: { avgVolume: 85, weeklyHours: 30, dosePercent: 150 },
        description: 'Users with moderate risk patterns'
      },
      'high_risk_user': {
        criteria: { avgVolume: 95, weeklyHours: 40, dosePercent: 200 },
        description: 'Users with high-risk listening patterns'
      },
      'power_user': {
        criteria: { avgVolume: 80, weeklyHours: 50, dosePercent: 180 },
        description: 'Heavy users with moderate volume'
      }
    };
  }

  // User Segmentation
  async segmentUser(userId) {
    try {
      const result = await pool.query(
        `SELECT 
          AVG(volume_percent) as avg_volume,
          SUM(listened_duration_ms) / 60000 as weekly_hours,
          AVG(dose_percent) as avg_dose
        FROM listening_sessions
        WHERE user_id = $1
        AND start_time >= NOW() - INTERVAL '7 days'`,
        [userId]
      );

      const userData = result.rows[0] || { avg_volume: 0, weekly_hours: 0, avg_dose: 0 };

      let segment = 'safe_listener';
      let maxScore = 0;

      for (const [segmentName, segmentData] of Object.entries(this.segments)) {
        const score = this.calculateSegmentScore(userData, segmentData.criteria);
        if (score > maxScore) {
          maxScore = score;
          segment = segmentName;
        }
      }

      // Store segment in database
      await pool.query(
        `INSERT INTO listening_patterns (user_id, pattern_type, pattern_name, description, severity, confidence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [userId, 'segment', segment, this.segments[segment].description, this.getSegmentSeverity(segment), maxScore]
      );

      return {
        segment,
        description: this.segments[segment].description,
        confidence: maxScore,
        userData
      };
    } catch (error) {
      console.error('Error segmenting user:', error);
      throw error;
    }
  }

  calculateSegmentScore(userData, criteria) {
    let score = 0;
    let totalCriteria = 0;

    for (const [key, threshold] of Object.entries(criteria)) {
      totalCriteria++;
      const userValue = userData[key] || 0;

      // Calculate how close user is to this segment's criteria
      const difference = Math.abs(userValue - threshold);
      const maxDifference = threshold; // Normalize
      const matchScore = 1 - (difference / maxDifference);
      score += matchScore;
    }

    return score / totalCriteria;
  }

  getSegmentSeverity(segment) {
    const severityMap = {
      'safe_listener': 'low',
      'moderate_user': 'medium',
      'high_risk_user': 'high',
      'power_user': 'medium'
    };
    return severityMap[segment] || 'low';
  }

  // Listening Pattern Analysis
  async analyzeListeningPatterns(userId) {
    try {
      const patterns = [];

      // Time-of-day pattern
      const timePattern = await this.analyzeTimeOfDayPattern(userId);
      if (timePattern) patterns.push(timePattern);

      // Day-of-week pattern
      const dayPattern = await this.analyzeDayOfWeekPattern(userId);
      if (dayPattern) patterns.push(dayPattern);

      // Session duration pattern
      const durationPattern = await this.analyzeSessionDurationPattern(userId);
      if (durationPattern) patterns.push(durationPattern);

      // Volume pattern
      const volumePattern = await this.analyzeVolumePattern(userId);
      if (volumePattern) patterns.push(volumePattern);

      // Store patterns in database
      for (const pattern of patterns) {
        await pool.query(
          `INSERT INTO listening_patterns (user_id, pattern_type, pattern_name, description, severity, confidence)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [userId, pattern.type, pattern.name, pattern.description, pattern.severity, pattern.confidence]
        );
      }

      return patterns;
    } catch (error) {
      console.error('Error analyzing listening patterns:', error);
      throw error;
    }
  }

  async analyzeTimeOfDayPattern(userId) {
    const result = await pool.query(
      `SELECT 
        EXTRACT(HOUR FROM start_time) as hour,
        COUNT(*) as session_count,
        AVG(volume_percent) as avg_volume
      FROM listening_sessions
      WHERE user_id = $1
      AND start_time >= NOW() - INTERVAL '30 days'
      GROUP BY EXTRACT(HOUR FROM start_time)
      ORDER BY session_count DESC
      LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) return null;

    const peakHour = result.rows[0];
    const hour = parseInt(peakHour.hour);

    let timeOfDay = 'morning';
    if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
    else if (hour >= 21 || hour < 6) timeOfDay = 'night';

    return {
      type: 'time_pattern',
      name: `${timeOfDay}_listener`,
      description: `Peak listening occurs during ${timeOfDay} (${hour}:00)`,
      severity: timeOfDay === 'night' ? 'medium' : 'low',
      confidence: 0.75,
      data: peakHour
    };
  }

  async analyzeDayOfWeekPattern(userId) {
    const result = await pool.query(
      `SELECT 
        EXTRACT(DOW FROM start_time) as day_of_week,
        COUNT(*) as session_count,
        SUM(listened_duration_ms) / 60000 as total_minutes
      FROM listening_sessions
      WHERE user_id = $1
      AND start_time >= NOW() - INTERVAL '30 days'
      GROUP BY EXTRACT(DOW FROM start_time)
      ORDER BY session_count DESC
      LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) return null;

    const peakDay = result.rows[0];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[parseInt(peakDay.day_of_week)];

    return {
      type: 'day_pattern',
      name: `${dayName}_listener`,
      description: `Highest listening activity on ${dayName}s`,
      severity: 'low',
      confidence: 0.70,
      data: peakDay
    };
  }

  async analyzeSessionDurationPattern(userId) {
    const result = await pool.query(
      `SELECT 
        AVG(listened_duration_ms / 60000) as avg_duration,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY listened_duration_ms / 60000) as median_duration,
        MAX(listened_duration_ms / 60000) as max_duration
      FROM listening_sessions
      WHERE user_id = $1
      AND start_time >= NOW() - INTERVAL '30 days'`,
      [userId]
    );

    if (result.rows.length === 0) return null;

    const duration = result.rows[0];
    const avgDuration = duration.avg_duration || 0;

    let severity = 'low';
    let description = 'Normal session durations';

    if (avgDuration > 60) {
      severity = 'high';
      description = 'Extended listening sessions detected (avg > 1 hour)';
    } else if (avgDuration > 30) {
      severity = 'medium';
      description = 'Long listening sessions detected (avg > 30 min)';
    }

    return {
      type: 'duration_pattern',
      name: 'session_duration',
      description,
      severity,
      confidence: 0.80,
      data: duration
    };
  }

  async analyzeVolumePattern(userId) {
    const result = await pool.query(
      `SELECT 
        AVG(volume_percent) as avg_volume,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY volume_percent) as p90_volume,
        MAX(volume_percent) as max_volume
      FROM listening_sessions
      WHERE user_id = $1
      AND start_time >= NOW() - INTERVAL '30 days'`,
      [userId]
    );

    if (result.rows.length === 0) return null;

    const volume = result.rows[0];
    const avgVolume = volume.avg_volume || 0;

    let severity = 'low';
    let description = 'Safe volume levels';

    if (avgVolume > 80) {
      severity = 'high';
      description = 'High volume levels detected (avg > 80%)';
    } else if (avgVolume > 65) {
      severity = 'medium';
      description = 'Elevated volume levels detected (avg > 65%)';
    }

    return {
      type: 'volume_pattern',
      name: 'volume_levels',
      description,
      severity,
      confidence: 0.85,
      data: volume
    };
  }

  // Habit Detection
  async detectHabits(userId) {
    try {
      const habits = [];

      // Detect consecutive listening habit
      const consecutiveHabit = await this.detectConsecutiveListening(userId);
      if (consecutiveHabit) habits.push(consecutiveHabit);

      // Detect break-taking habit
      const breakHabit = await this.detectBreakHabit(userId);
      if (breakHabit) habits.push(breakHabit);

      // Detect weekend vs weekday pattern
      const weekendHabit = await this.detectWeekdayPattern(userId);
      if (weekendHabit) habits.push(weekendHabit);

      // Store habits in database
      for (const habit of habits) {
        await pool.query(
          `INSERT INTO listening_patterns (user_id, pattern_type, pattern_name, description, severity, confidence)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [userId, 'habit', habit.name, habit.description, habit.severity, habit.confidence]
        );
      }

      return habits;
    } catch (error) {
      console.error('Error detecting habits:', error);
      throw error;
    }
  }

  async detectConsecutiveListening(userId) {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as consecutive_sessions,
        SUM(listened_duration_ms) / 60000 as total_minutes
      FROM (
        SELECT 
          listened_duration_ms,
          LAG(start_time) OVER (ORDER BY start_time) as prev_start_time,
          start_time
        FROM listening_sessions
        WHERE user_id = $1
        AND start_time >= NOW() - INTERVAL '7 days'
        ORDER BY start_time
      ) sessions
      WHERE prev_start_time IS NOT NULL
      AND EXTRACT(EPOCH FROM (start_time - prev_start_time)) / 60 < 10`,
      [userId]
    );

    if (result.rows.length === 0) return null;

    const data = result.rows[0];
    if (data.consecutive_sessions < 5) return null;

    return {
      name: 'consecutive_listener',
      description: `Frequently listens in consecutive sessions (${data.consecutive_sessions} instances)`,
      severity: 'medium',
      confidence: 0.72,
      data
    };
  }

  async detectBreakHabit(userId) {
    const result = await pool.query(
      `SELECT 
        AVG(listened_duration_ms / 60000) as avg_session_length,
        COUNT(*) as total_sessions
      FROM listening_sessions
      WHERE user_id = $1
      AND start_time >= NOW() - INTERVAL '30 days'`,
      [userId]
    );

    if (result.rows.length === 0) return null;

    const data = result.rows[0];
    const avgLength = data.avg_session_length || 0;

    let severity = 'low';
    let description = 'Good break habits';

    if (avgLength > 45) {
      severity = 'high';
      description = 'Long sessions without adequate breaks (avg > 45 min)';
    } else if (avgLength > 30) {
      severity = 'medium';
      description = 'Could benefit from more frequent breaks (avg > 30 min)';
    }

    return {
      name: 'break_habit',
      description,
      severity,
      confidence: 0.78,
      data
    };
  }

  async detectWeekdayPattern(userId) {
    const result = await pool.query(
      `SELECT 
        SUM(CASE WHEN EXTRACT(DOW FROM start_time) IN (0, 6) THEN 1 ELSE 0 END) as weekend_sessions,
        SUM(CASE WHEN EXTRACT(DOW FROM start_time) NOT IN (0, 6) THEN 1 ELSE 0 END) as weekday_sessions
      FROM listening_sessions
      WHERE user_id = $1
      AND start_time >= NOW() - INTERVAL '30 days'`,
      [userId]
    );

    if (result.rows.length === 0) return null;

    const data = result.rows[0];
    const total = data.weekend_sessions + data.weekday_sessions;
    if (total === 0) return null;

    const weekendRatio = data.weekend_sessions / total;

    if (weekendRatio > 0.6) {
      return {
        name: 'weekend_listener',
        description: 'Majority of listening occurs on weekends',
        severity: 'low',
        confidence: 0.65,
        data
      };
    } else if (weekendRatio < 0.3) {
      return {
        name: 'weekday_listener',
        description: 'Majority of listening occurs on weekdays',
        severity: 'low',
        confidence: 0.65,
        data
      };
    }

    return null;
  }

  // Comprehensive Analysis
  async performFullAnalysis(userId) {
    try {
      console.log(`🔍 Performing full behavioral analysis for user ${userId}...`);

      const segment = await this.segmentUser(userId);
      const patterns = await this.analyzeListeningPatterns(userId);
      const habits = await this.detectHabits(userId);

      console.log(`✅ Analysis complete for user ${userId}`);
      console.log(`   Segment: ${segment.segment}`);
      console.log(`   Patterns detected: ${patterns.length}`);
      console.log(`   Habits detected: ${habits.length}`);

      return {
        segment,
        patterns,
        habits,
        insights: this.generateInsights(segment, patterns, habits)
      };
    } catch (error) {
      console.error('Error performing full analysis:', error);
      throw error;
    }
  }

  generateInsights(segment, patterns, habits) {
    const insights = [];

    // Segment-based insights
    if (segment.segment === 'high_risk_user') {
      insights.push({
        type: 'warning',
        title: 'High Risk Profile',
        description: 'Your listening patterns indicate elevated hearing risk. Consider reducing volume and taking more breaks.'
      });
    }

    // Pattern-based insights
    patterns.forEach(pattern => {
      if (pattern.severity === 'high') {
        insights.push({
          type: 'warning',
          title: `${pattern.name.replace('_', ' ').toUpperCase()}`,
          description: pattern.description
        });
      }
    });

    // Habit-based insights
    habits.forEach(habit => {
      if (habit.severity === 'high') {
        insights.push({
          type: 'warning',
          title: `${habit.name.replace('_', ' ').toUpperCase()}`,
          description: habit.description
        });
      }
    });

    return insights;
  }
}

module.exports = BehavioralAnalyzer;
