const pool = require('../database/connection');

// Risk Forecasting Module
// Implements 30-day and 90-day risk trajectory predictions

class RiskForecaster {
  constructor() {
    this.forecastModels = {
      '30-day': {
        decayRate: 0.95,
        volatility: 0.1,
        trendWeight: 0.7
      },
      '90-day': {
        decayRate: 0.85,
        volatility: 0.15,
        trendWeight: 0.5
      }
    };
  }

  // Generate 30-day risk forecast
  async forecastRisk30Days(userId) {
    return this.generateForecast(userId, '30-day', 30);
  }

  // Generate 90-day risk forecast
  async forecastRisk90Days(userId) {
    return this.generateForecast(userId, '90-day', 90);
  }

  async generateForecast(userId, forecastType, days) {
    try {
      // Get historical risk predictions
      const historicalData = await this.getHistoricalRiskData(userId, 90);
      
      if (historicalData.length === 0) {
        // No historical data, generate baseline forecast
        return this.generateBaselineForecast(userId, forecastType, days);
      }

      // Calculate trend
      const trend = this.calculateTrend(historicalData);
      
      // Generate forecast points
      const forecastPoints = [];
      let currentRisk = historicalData[0].risk_score;
      
      const model = this.forecastModels[forecastType];
      
      for (let i = 1; i <= days; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        
        // Apply trend with decay
        const trendImpact = trend * Math.pow(model.decayRate, i / days);
        
        // Add volatility
        const volatility = (Math.random() - 0.5) * model.volatility * 10;
        
        // Calculate new risk score
        const predictedRisk = currentRisk + (trendImpact * model.trendWeight) + volatility;
        
        // Clamp to valid range
        const clampedRisk = Math.max(0, Math.min(100, predictedRisk));
        
        forecastPoints.push({
          date: date.toISOString().split('T')[0],
          predictedRiskScore: Math.round(clampedRisk),
          confidence: this.calculateConfidence(i, days, historicalData.length)
        });
        
        currentRisk = clampedRisk;
      }

      // Calculate summary statistics
      const finalRisk = forecastPoints[forecastPoints.length - 1].predictedRiskScore;
      const avgRisk = forecastPoints.reduce((sum, p) => sum + p.predictedRiskScore, 0) / forecastPoints.length;
      const riskCategory = this.getRiskCategory(finalRisk);

      // Store forecast in database
      await this.storeForecast(userId, forecastType, forecastPoints, finalRisk, riskCategory);

      return {
        forecastType,
        forecastPeriod: `${days}-day`,
        startDate: forecastPoints[0].date,
        endDate: forecastPoints[forecastPoints.length - 1].date,
        currentRiskScore: historicalData[0].risk_score,
        finalRiskScore: finalRisk,
        averageRiskScore: Math.round(avgRisk),
        riskCategory,
        riskTrend: trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable',
        forecastPoints,
        confidenceInterval: this.calculateConfidenceInterval(forecastPoints),
        recommendations: this.generateForecastRecommendations(trend, riskCategory)
      };
    } catch (error) {
      console.error('Error generating forecast:', error);
      throw error;
    }
  }

  async getHistoricalRiskData(userId, days) {
    const result = await pool.query(
      `SELECT risk_score, risk_category, prediction_date
       FROM risk_predictions
       WHERE user_id = $1
       AND prediction_date >= NOW() - INTERVAL '${days} days'
       ORDER BY prediction_date DESC`,
      [userId]
    );
    return result.rows;
  }

  calculateTrend(historicalData) {
    if (historicalData.length < 2) return 0;

    // Simple linear regression to calculate trend
    const n = historicalData.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      const x = i;
      const y = historicalData[i].risk_score;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  calculateConfidence(day, totalDays, dataPoints) {
    // Confidence decreases with forecast horizon and increases with historical data
    const horizonFactor = 1 - (day / totalDays) * 0.3;
    const dataFactor = Math.min(1, dataPoints / 30);
    return Math.round(horizonFactor * dataFactor * 100) / 100;
  }

  calculateConfidenceInterval(forecastPoints) {
    const risks = forecastPoints.map(p => p.predictedRiskScore);
    const mean = risks.reduce((a, b) => a + b, 0) / risks.length;
    const variance = risks.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / risks.length;
    const stdDev = Math.sqrt(variance);

    return {
      lower: Math.round(Math.max(0, mean - 1.96 * stdDev)),
      upper: Math.round(Math.min(100, mean + 1.96 * stdDev))
    };
  }

  getRiskCategory(score) {
    if (score < 30) return 'Low';
    if (score < 60) return 'Moderate';
    return 'High';
  }

  async generateBaselineForecast(userId, forecastType, days) {
    // Generate forecast based on current risk score without historical data
    const currentRisk = 50; // Default baseline
    
    const forecastPoints = [];
    const model = this.forecastModels[forecastType];
    
    for (let i = 1; i <= days; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      
      const volatility = (Math.random() - 0.5) * model.volatility * 10;
      const predictedRisk = currentRisk + volatility;
      
      forecastPoints.push({
        date: date.toISOString().split('T')[0],
        predictedRiskScore: Math.round(Math.max(0, Math.min(100, predictedRisk))),
        confidence: this.calculateConfidence(i, days, 5) // Low confidence without historical data
      });
    }

    const finalRisk = forecastPoints[forecastPoints.length - 1].predictedRiskScore;
    const riskCategory = this.getRiskCategory(finalRisk);

    return {
      forecastType,
      forecastPeriod: `${days}-day`,
      startDate: forecastPoints[0].date,
      endDate: forecastPoints[forecastPoints.length - 1].date,
      currentRiskScore: currentRisk,
      finalRiskScore: finalRisk,
      averageRiskScore: Math.round(forecastPoints.reduce((sum, p) => sum + p.predictedRiskScore, 0) / forecastPoints.length),
      riskCategory,
      riskTrend: 'stable',
      forecastPoints,
      confidenceInterval: this.calculateConfidenceInterval(forecastPoints),
      recommendations: this.generateForecastRecommendations(0, riskCategory),
      isBaseline: true
    };
  }

  async storeForecast(userId, forecastType, forecastPoints, finalRisk, riskCategory) {
    try {
      // Store each forecast point
      for (const point of forecastPoints) {
        await pool.query(
          `INSERT INTO risk_forecasts (user_id, forecast_type, forecast_date, predicted_risk_score, predicted_risk_category, model_version)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, forecast_date) DO UPDATE SET
             predicted_risk_score = EXCLUDED.predicted_risk_score,
             predicted_risk_category = EXCLUDED.predicted_risk_category`,
          [userId, forecastType, point.date, point.predictedRiskScore, riskCategory, '1.0']
        );
      }
    } catch (error) {
      console.error('Error storing forecast:', error);
    }
  }

  generateForecastRecommendations(trend, riskCategory) {
    const recommendations = [];

    if (trend > 0.5) {
      recommendations.push({
        type: 'warning',
        title: 'Increasing Risk Trend',
        description: 'Your hearing risk is projected to increase. Consider reducing listening volume and duration.'
      });
    } else if (trend < -0.5) {
      recommendations.push({
        type: 'success',
        title: 'Improving Trend',
        description: 'Your hearing risk is projected to decrease. Keep up the healthy listening habits!'
      });
    }

    if (riskCategory === 'High') {
      recommendations.push({
        type: 'urgent',
        title: 'High Risk Projection',
        description: 'Projected to remain in high-risk category. Immediate intervention recommended.'
      });
    } else if (riskCategory === 'Moderate') {
      recommendations.push({
        type: 'info',
        title: 'Moderate Risk Projection',
        description: 'Small adjustments now can prevent progression to high-risk category.'
      });
    }

    return recommendations;
  }

  // Get combined forecast for dashboard
  async getCombinedForecast(userId) {
    try {
      const forecast30 = await this.forecastRisk30Days(userId);
      const forecast90 = await this.forecastRisk90Days(userId);

      return {
        '30-day': forecast30,
        '90-day': forecast90,
        summary: this.generateForecastSummary(forecast30, forecast90)
      };
    } catch (error) {
      console.error('Error generating combined forecast:', error);
      throw error;
    }
  }

  generateForecastSummary(forecast30, forecast90) {
    const trend30 = forecast30.riskTrend;
    const trend90 = forecast90.riskTrend;
    const category30 = forecast30.riskCategory;
    const category90 = forecast90.riskCategory;

    let summary = '';

    if (trend30 === 'increasing' && trend90 === 'increasing') {
      summary = 'Your hearing risk is projected to increase over both the short and long term. Immediate action recommended.';
    } else if (trend30 === 'decreasing' && trend90 === 'decreasing') {
      summary = 'Your hearing risk is projected to decrease over both time horizons. Continue current healthy habits.';
    } else if (trend30 === 'stable') {
      summary = 'Your hearing risk is projected to remain stable. Small adjustments could lead to improvement.';
    } else {
      summary = `Your risk is projected to ${trend30} in the short term and ${trend90} in the long term.`;
    }

    return {
      trend: trend30,
      summary,
      keyInsight: category90 === 'High' ? 'Long-term intervention needed' : category30 === 'Low' ? 'Maintain healthy habits' : 'Monitor and adjust'
    };
  }
}

module.exports = RiskForecaster;
