/**
 * Live Monitoring Service for HearWise
 * Detects Slack workspace events (Huddles, Calls) and sends real-time notifications
 * Uses actual listening behavior and calculated risk levels for intelligent alerts
 */

class LiveMonitoringService {
  constructor(slackClient, slackApp) {
    this.slackClient = slackClient;
    this.slackApp = slackApp;
    this.isMonitoring = false;
    this.timeline = [];
    this.currentHuddle = null;
    this.currentCall = null;
    this.slackUserId = null;
    this.surveyData = null;
    this.riskModifiers = null;
    this.weeklyExposure = 0;
    this.currentDecibel = 75;
    this.huddleActiveByUser = {};
  }

  setSlackUserId(userId) {
    this.slackUserId = userId;
  }

  setSurveyData(surveyData) {
    this.surveyData = surveyData;
    this.riskModifiers = this.calculateRiskModifiers(surveyData);
  }

  setWeeklyExposure(exposure) {
    this.weeklyExposure = exposure;
  }

  setCurrentDecibel(decibel) {
    this.currentDecibel = decibel;
  }

  calculateRiskModifiers(surveyData) {
    if (!surveyData) return null;
    
    const modifiers = {
      ageMultiplier: 1.0,
      usageMultiplier: 1.0,
      volumeMultiplier: 1.0,
      headphoneMultiplier: 1.0,
      environmentMultiplier: 1.0,
      ringingMultiplier: 1.0
    };
    
    // Age multiplier (older = higher risk)
    const ageValue = surveyData.age;
    if (ageValue === '18-24') modifiers.ageMultiplier = 0.9;
    else if (ageValue === '25-34') modifiers.ageMultiplier = 1.0;
    else if (ageValue === '35-44') modifiers.ageMultiplier = 1.1;
    else if (ageValue === '45-54') modifiers.ageMultiplier = 1.2;
    else if (ageValue === '55-64') modifiers.ageMultiplier = 1.3;
    else if (ageValue === '65+') modifiers.ageMultiplier = 1.4;
    
    // Volume multiplier
    const volumeValue = surveyData.volume;
    if (volumeValue === 'low') modifiers.volumeMultiplier = 0.8;
    else if (volumeValue === 'medium') modifiers.volumeMultiplier = 1.0;
    else if (volumeValue === 'high') modifiers.volumeMultiplier = 1.3;
    
    // Headphone type multiplier
    const headphoneValue = surveyData.headphoneType;
    if (headphoneValue === 'earbuds') modifiers.headphoneMultiplier = 1.2;
    else if (headphoneValue === 'on-ear') modifiers.headphoneMultiplier = 1.1;
    else if (headphoneValue === 'over-ear') modifiers.headphoneMultiplier = 1.0;
    else if (headphoneValue === 'noise-canceling') modifiers.headphoneMultiplier = 0.9;
    else if (headphoneValue === 'open-back') modifiers.headphoneMultiplier = 0.85;
    
    // Ear ringing multiplier (symptom of damage)
    const ringingValue = surveyData.earRinging;
    if (ringingValue === 'never') modifiers.ringingMultiplier = 1.0;
    else if (ringingValue === 'rarely') modifiers.ringingMultiplier = 1.1;
    else if (ringingValue === 'sometimes') modifiers.ringingMultiplier = 1.3;
    else if (ringingValue === 'often') modifiers.ringingMultiplier = 1.5;
    else if (ringingValue === 'always') modifiers.ringingMultiplier = 1.8;
    
    return modifiers;
  }

  setUserHuddleState(userId, inMeeting) {
    if (!userId) return;
    this.huddleActiveByUser[userId] = !!inMeeting;
  }

  isUserInHuddle(userId) {
    return !!(userId && this.huddleActiveByUser[userId]);
  }

  setupSlackEventHandlers() {
    // Real-time: fires when a specific user joins/leaves a huddle (Slack desktop/mobile)
    this.slackApp.event('user_huddle_changed', async ({ event }) => {
      var user = event && event.user;
      if (!user || !user.id) return;

      var huddleState = user.profile && user.profile.huddle_state;
      var inMeeting = huddleState === 'in_a_huddle';
      this.setUserHuddleState(user.id, inMeeting);
      console.log('🔔 user_huddle_changed:', user.id, huddleState, inMeeting ? 'JOINED' : 'LEFT');

      if (inMeeting) {
        this.currentHuddle = { userId: user.id, startTime: new Date() };
        this.addTimelineEvent({
          type: 'huddle_started',
          userId: user.id,
          timestamp: new Date().toISOString()
        });
        if (this.isMonitoring && this.slackUserId === user.id) {
          await this.sendHuddleNotification(user.id, 'started');
        }
        return;
      }

      if (this.currentHuddle && this.currentHuddle.userId === user.id) {
        var duration = this.calculateDuration(this.currentHuddle.startTime);
        var exposure = this.calculateExposure(duration);
        this.addTimelineEvent({
          type: 'huddle_ended',
          userId: user.id,
          duration: duration,
          exposure: exposure,
          timestamp: new Date().toISOString()
        });
        if (this.isMonitoring && this.slackUserId === user.id) {
          await this.sendHuddleNotification(user.id, 'ended', duration, exposure);
        }
        this.currentHuddle = null;
      }
    });

    // Handle Slack Huddle start event (channel-level fallback)
    this.slackApp.event('huddle_space_created', async ({ event }) => {
      if (!this.isMonitoring) return;
      
      const huddleEvent = {
        type: 'huddle_started',
        channel: event.channel,
        timestamp: new Date().toISOString()
      };
      
      this.currentHuddle = {
        channel: event.channel,
        startTime: new Date()
      };
      
      this.addTimelineEvent(huddleEvent);
      await this.sendHuddleNotification(event.channel, 'started');
    });

    // Handle Slack Huddle end event
    this.slackApp.event('huddle_space_deleted', async ({ event }) => {
      if (!this.isMonitoring) return;
      
      if (this.currentHuddle) {
        const duration = this.calculateDuration(this.currentHuddle.startTime);
        const exposure = this.calculateExposure(duration);
        
        const huddleEvent = {
          type: 'huddle_ended',
          channel: event.channel,
          duration: duration,
          exposure: exposure,
          timestamp: new Date().toISOString()
        };
        
        this.addTimelineEvent(huddleEvent);
        await this.sendHuddleNotification(event.channel, 'ended', duration, exposure);
        
        this.currentHuddle = null;
      }
    });

    // Handle Slack Call start event
    this.slackApp.event('call_started', async ({ event }) => {
      if (!this.isMonitoring) return;
      
      const callEvent = {
        type: 'call_started',
        channel: event.channel,
        timestamp: new Date().toISOString()
      };
      
      this.currentCall = {
        channel: event.channel,
        startTime: new Date()
      };
      
      this.addTimelineEvent(callEvent);
      await this.sendCallNotification(event.channel, 'started');
    });

    // Handle Slack Call end event
    this.slackApp.event('call_ended', async ({ event }) => {
      if (!this.isMonitoring) return;
      
      if (this.currentCall) {
        const duration = this.calculateDuration(this.currentCall.startTime);
        const exposure = this.calculateExposure(duration);
        
        const callEvent = {
          type: 'call_ended',
          channel: event.channel,
          duration: duration,
          exposure: exposure,
          timestamp: new Date().toISOString()
        };
        
        this.addTimelineEvent(callEvent);
        await this.sendCallNotification(event.channel, 'ended', duration, exposure);
        
        this.currentCall = null;
      }
    });
  }

  async startMonitoring() {
    if (this.isMonitoring) {
      console.log('Monitoring already active');
      return;
    }

    this.isMonitoring = true;
    console.log('🎧 Slack workspace monitoring started');
  }

  async stopMonitoring() {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    console.log('🎧 Slack workspace monitoring stopped');
  }

  calculateDuration(startTime) {
    const endTime = new Date();
    const diffMs = endTime - startTime;
    const diffMins = Math.floor(diffMs / 60000);
    return diffMins;
  }

  calculateExposure(durationMinutes) {
    // Use personalized decibel level from dashboard
    const avgDb = this.currentDecibel || 75;
    
    // NIOSH formula: safe time = 8 hours at 80 dB with 3 dB exchange rate
    const safeMinutesAt80dB = 480; // 8 hours
    const dbDifference = avgDb - 80;
    const safeMinutes = safeMinutesAt80dB / Math.pow(2, dbDifference / 3);
    
    // Calculate dose percentage
    const dosePercent = (durationMinutes / safeMinutes) * 100;
    
    // Apply risk modifiers from survey data
    let adjustedDose = dosePercent;
    if (this.riskModifiers) {
      const combinedMultiplier = 
        this.riskModifiers.ageMultiplier * 
        this.riskModifiers.volumeMultiplier * 
        this.riskModifiers.headphoneMultiplier * 
        this.riskModifiers.ringingMultiplier;
      adjustedDose = dosePercent * combinedMultiplier;
    }
    
    // Add to weekly exposure tracking
    this.weeklyExposure += adjustedDose;
    
    // Determine risk level based on adjusted dose
    if (adjustedDose < 25) return { level: 'Low', dose: adjustedDose.toFixed(1) };
    if (adjustedDose < 50) return { level: 'Moderate', dose: adjustedDose.toFixed(1) };
    if (adjustedDose < 75) return { level: 'Elevated', dose: adjustedDose.toFixed(1) };
    return { level: 'High', dose: adjustedDose.toFixed(1) };
  }

  addTimelineEvent(event) {
    this.timeline.push(event);
    console.log('📝 Timeline event added:', event.type);
  }

  getTimeline() {
    return this.timeline;
  }

  isUserInActiveMeeting() {
    if (this.currentHuddle || this.currentCall) return true;
    for (var i = this.timeline.length - 1; i >= 0; i--) {
      var ev = this.timeline[i];
      if (ev.type === 'huddle_started' || ev.type === 'call_started') {
        var ended = this.timeline.slice(i + 1).some(function (e) {
          return e.type === 'huddle_ended' || e.type === 'call_ended';
        });
        if (!ended) return true;
      }
    }
    return false;
  }

  async fetchUserHuddleState(slackUserId) {
    if (!this.slackClient || !slackUserId) return { inMeeting: false, source: 'none' };

    if (this.isUserInHuddle(slackUserId)) {
      return { inMeeting: true, source: 'realtime_event' };
    }

    try {
      var result = await this.slackClient.users.profile.get({ user: slackUserId });
      var profile = result.profile || {};
      var huddleState = profile.huddle_state;
      var inMeeting = huddleState === 'in_a_huddle';
      this.setUserHuddleState(slackUserId, inMeeting);
      return {
        inMeeting: inMeeting,
        huddleState: huddleState || null,
        source: 'slack_profile'
      };
    } catch (err) {
      try {
        var info = await this.slackClient.users.info({ user: slackUserId });
        var infoProfile = info.user && info.user.profile;
        var state = infoProfile && infoProfile.huddle_state;
        var inMeetingFallback = state === 'in_a_huddle';
        this.setUserHuddleState(slackUserId, inMeetingFallback);
        return {
          inMeeting: inMeetingFallback,
          huddleState: state || null,
          userName: (info.user && (info.user.real_name || info.user.name)) || null,
          source: 'slack_api'
        };
      } catch (innerErr) {
        return { inMeeting: false, error: innerErr.message, source: 'slack_api' };
      }
    }
  }

  async sendHuddleNotification(channel, status, duration = null, exposure = null) {
    if (!this.slackClient || !this.slackUserId) {
      console.log('Slack not configured, skipping notification');
      return;
    }

    try {
      const dmResult = await this.slackClient.conversations.open({
        users: this.slackUserId
      });
      
      const channelId = dmResult.channel.id;
      
      let text = '';
      let blocks = [];
      
      if (status === 'started') {
        text = `🎧 Huddle Started`;
        blocks = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🎧 *Huddle Started*\n\n*Channel:* <#${channel}>\n*Time:* ${new Date().toLocaleTimeString()}\n*Estimated Volume:* ${this.currentDecibel} dB\n\nTracking listening exposure based on your hearing profile.`
            }
          }
        ];
      } else {
        const exposureObj = typeof exposure === 'string' ? { level: exposure, dose: 'N/A' } : exposure;
        const recommendation = this.getPersonalizedRecommendation(exposureObj);
        const weeklyExposurePercent = Math.min(100, this.weeklyExposure).toFixed(1);
        
        text = `Huddle Complete`;
        blocks = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Huddle Complete*\n\n*Channel:* <#${channel}>\n*Duration:* ${duration} min\n*Exposure Dose:* ${exposureObj.dose}%\n*Risk Level:* ${exposureObj.level}\n*Weekly Exposure:* ${weeklyExposurePercent}%\n\n*Personalized Recommendation:*\n${recommendation}`
            }
          }
        ];
      }
      
      await this.slackClient.chat.postMessage({
        channel: channelId,
        text: text,
        blocks: blocks
      });
      
      console.log(`✅ Huddle ${status} notification sent`);
    } catch (error) {
      console.error('Error sending huddle notification:', error.message);
    }
  }

  async sendCallNotification(channel, status, duration = null, exposure = null) {
    if (!this.slackClient || !this.slackUserId) {
      console.log('Slack not configured, skipping notification');
      return;
    }

    try {
      const dmResult = await this.slackClient.conversations.open({
        users: this.slackUserId
      });
      
      const channelId = dmResult.channel.id;
      
      let text = '';
      let blocks = [];
      
      if (status === 'started') {
        text = `📞 Call Started`;
        blocks = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📞 *Call Started*\n\n*Channel:* <#${channel}>\n*Time:* ${new Date().toLocaleTimeString()}\n*Estimated Volume:* ${this.currentDecibel} dB\n\nTracking listening exposure based on your hearing profile.`
            }
          }
        ];
      } else {
        const exposureObj = typeof exposure === 'string' ? { level: exposure, dose: 'N/A' } : exposure;
        const recommendation = this.getPersonalizedRecommendation(exposureObj);
        const weeklyExposurePercent = Math.min(100, this.weeklyExposure).toFixed(1);
        
        text = `Call Complete`;
        blocks = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Call Complete*\n\n*Channel:* <#${channel}>\n*Duration:* ${duration} min\n*Exposure Dose:* ${exposureObj.dose}%\n*Risk Level:* ${exposureObj.level}\n*Weekly Exposure:* ${weeklyExposurePercent}%\n\n*Personalized Recommendation:*\n${recommendation}`
            }
          }
        ];
      }
      
      await this.slackClient.chat.postMessage({
        channel: channelId,
        text: text,
        blocks: blocks
      });
      
      console.log(`✅ Call ${status} notification sent`);
    } catch (error) {
      console.error('Error sending call notification:', error.message);
    }
  }

  getPersonalizedRecommendation(exposure) {
    const level = exposure.level || 'Unknown';
    const dose = parseFloat(exposure.dose) || 0;
    
    // Base recommendations by risk level
    let baseRecommendation = '';
    switch (level) {
      case 'Low':
        baseRecommendation = 'Great job! Your exposure was within safe limits.';
        break;
      case 'Moderate':
        baseRecommendation = 'Take a 5-minute listening break to let your ears recover.';
        break;
      case 'Elevated':
        baseRecommendation = 'Take a 10-minute break before any more listening to protect your hearing.';
        break;
      case 'High':
        baseRecommendation = 'Take a 15-20 minute break before any more listening. Your exposure is approaching unsafe levels.';
        break;
      default:
        baseRecommendation = 'Take a short break to ensure hearing health.';
    }
    
    // Add personalized context based on survey data
    let personalizedContext = '';
    if (this.surveyData) {
      if (this.surveyData.earRinging === 'sometimes' || this.surveyData.earRinging === 'often' || this.surveyData.earRinging === 'always') {
        personalizedContext += '\n⚠️ Given your history of ear ringing, be extra cautious with exposure.';
      }
      if (this.surveyData.headphoneType === 'earbuds') {
        personalizedContext += '\n💡 Consider switching to over-ear headphones to reduce eardrum proximity.';
      }
      if (this.surveyData.volume === 'high') {
        personalizedContext += '\n🔊 Your typical high volume usage compounds this exposure risk.';
      }
    }
    
    // Add weekly context
    if (this.weeklyExposure > 80) {
      personalizedContext += '\n📊 Your weekly exposure is high - consider reducing overall listening time.';
    }
    
    return baseRecommendation + personalizedContext;
  }

  async sendTestNotification() {
    if (!this.slackClient || !this.slackUserId) {
      console.log('Slack not configured, skipping test notification');
      return { success: false, error: 'Slack not configured' };
    }

    try {
      const dmResult = await this.slackClient.conversations.open({
        users: this.slackUserId
      });
      
      const channelId = dmResult.channel.id;
      
      await this.slackClient.chat.postMessage({
        channel: channelId,
        text: `✅ HearWise Test Notification`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *HearWise Test Notification*\n\nThis is a test message from your live monitoring system.\n\nLive monitoring is ready to detect:\n• Slack Huddles (start/end)\n• Slack Calls (start/end)\n\nTimestamp: ${new Date().toLocaleString()}`
            }
          }
        ]
      });
      
      console.log('✅ Test notification sent');
      return { success: true };
    } catch (error) {
      console.error('Error sending test notification:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = LiveMonitoringService;
