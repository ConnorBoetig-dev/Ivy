# Phase 6: Cost Management Implementation

## 🎯 Phase Overview
Implement comprehensive cost tracking and management for all external services (AWS, OpenAI, Stripe), including real-time cost calculation, budget monitoring, alert systems, and cost optimization strategies to ensure the application stays within budget while maximizing efficiency.

## ✅ Prerequisites
- Phase 1-5 completed (Setup through Caching)
- Understanding of AWS and OpenAI pricing models
- Knowledge of cost optimization strategies
- Database and monitoring systems operational
- Basic understanding of financial tracking

## 📋 Phase Checklist
- [ ] Cost tracking service implementation
- [ ] Real-time cost calculation for all services
- [ ] Budget monitoring and alerting
- [ ] Cost optimization algorithms
- [ ] Usage-based feature limiting
- [ ] Cost analytics and reporting
- [ ] Subscription tier cost allocation
- [ ] Historical cost tracking
- [ ] Cost forecasting

---

## Step 1: Cost Tracking Service Setup

### 1.1 Create Cost Tracking Service
Create `src/services/cost-tracking.ts`:

```typescript
import { db } from '@/lib/database';
import { cache } from '@/lib/cache/redis-client';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

// Cost configuration per service (in USD)
export const COST_CONFIG = {
  aws: {
    rekognition: {
      detectLabels: 0.001, // per image
      detectFaces: 0.001,
      detectText: 0.001,
      detectModerationLabels: 0.001,
      recognizeCelebrities: 0.001,
      videoAnalysis: 0.10, // per minute
    },
    transcribe: {
      standard: 0.024, // per minute
    },
    comprehend: {
      detectEntities: 0.0001, // per 100 characters
      detectSentiment: 0.0001,
      detectKeyPhrases: 0.0001,
    },
    s3: {
      storage: 0.023 / 1000, // per GB per month
      getRequest: 0.0004 / 1000, // per request
      putRequest: 0.005 / 1000, // per request
      dataTransfer: 0.09 / 1000, // per GB
    },
  },
  openai: {
    embedding: {
      'text-embedding-3-small': 0.00002 / 1000, // per token
      'text-embedding-3-large': 0.00013 / 1000, // per token
    },
  },
  // Internal costs
  processing: {
    cpu: 0.10 / 3600, // per CPU hour
    memory: 0.01 / 1000, // per GB hour
  },
};

interface CostEntry {
  userId: string;
  service: string;
  operation: string;
  amount: number;
  units?: number;
  metadata?: Record<string, any>;
}

export class CostTrackingService {
  private costBuffer: CostEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic flush to database
    this.startPeriodicFlush();
  }

  private startPeriodicFlush(intervalMs: number = 60000) {
    this.flushInterval = setInterval(() => {
      this.flushCosts();
    }, intervalMs);
  }

  // Track AWS Rekognition costs
  async trackRekognitionCost(
    userId: string,
    operation: keyof typeof COST_CONFIG.aws.rekognition,
    count: number = 1,
    metadata?: Record<string, any>
  ): Promise<void> {
    const costPerUnit = COST_CONFIG.aws.rekognition[operation];
    const totalCost = costPerUnit * count;

    await this.trackCost({
      userId,
      service: 'aws-rekognition',
      operation,
      amount: totalCost,
      units: count,
      metadata: {
        ...metadata,
        unitCost: costPerUnit,
      },
    });
  }

  // Track AWS Transcribe costs
  async trackTranscribeCost(
    userId: string,
    durationMinutes: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const costPerMinute = COST_CONFIG.aws.transcribe.standard;
    const totalCost = costPerMinute * durationMinutes;

    await this.trackCost({
      userId,
      service: 'aws-transcribe',
      operation: 'transcription',
      amount: totalCost,
      units: durationMinutes,
      metadata: {
        ...metadata,
        durationMinutes,
        costPerMinute,
      },
    });
  }

  // Track AWS Comprehend costs
  async trackComprehendCost(
    userId: string,
    operation: keyof typeof COST_CONFIG.aws.comprehend,
    characterCount: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const units = Math.ceil(characterCount / 100);
    const costPerUnit = COST_CONFIG.aws.comprehend[operation];
    const totalCost = costPerUnit * units;

    await this.trackCost({
      userId,
      service: 'aws-comprehend',
      operation,
      amount: totalCost,
      units,
      metadata: {
        ...metadata,
        characterCount,
        costPer100Chars: costPerUnit,
      },
    });
  }

  // Track S3 costs
  async trackS3Cost(
    userId: string,
    operation: 'storage' | 'get' | 'put' | 'transfer',
    units: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const costPerUnit = COST_CONFIG.aws.s3[operation === 'get' ? 'getRequest' : 
                                           operation === 'put' ? 'putRequest' :
                                           operation === 'transfer' ? 'dataTransfer' : 
                                           'storage'];
    const totalCost = costPerUnit * units;

    await this.trackCost({
      userId,
      service: 'aws-s3',
      operation,
      amount: totalCost,
      units,
      metadata: {
        ...metadata,
        unitType: operation === 'storage' ? 'GB-month' : 
                  operation === 'transfer' ? 'GB' : 'requests',
      },
    });
  }

  // Track OpenAI embedding costs
  async trackEmbeddingCost(
    userId: string,
    model: string,
    tokenCount: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const costPerToken = COST_CONFIG.openai.embedding[model as keyof typeof COST_CONFIG.openai.embedding] || 0;
    const totalCost = costPerToken * tokenCount;

    await this.trackCost({
      userId,
      service: 'openai',
      operation: `embedding-${model}`,
      amount: totalCost,
      units: tokenCount,
      metadata: {
        ...metadata,
        model,
        tokenCount,
        costPerToken,
      },
    });
  }

  // Track internal processing costs
  async trackProcessingCost(
    userId: string,
    cpuHours: number,
    memoryGBHours: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const cpuCost = COST_CONFIG.processing.cpu * cpuHours;
    const memoryCost = COST_CONFIG.processing.memory * memoryGBHours;
    const totalCost = cpuCost + memoryCost;

    await this.trackCost({
      userId,
      service: 'internal',
      operation: 'processing',
      amount: totalCost,
      metadata: {
        ...metadata,
        cpuHours,
        memoryGBHours,
        cpuCost,
        memoryCost,
      },
    });
  }

  // Core cost tracking method
  private async trackCost(entry: CostEntry): Promise<void> {
    // Add to buffer
    this.costBuffer.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });

    // Track in metrics
    metrics.increment('cost.tracked', entry.amount, {
      service: entry.service,
      operation: entry.operation,
    });

    // Update real-time cache
    await this.updateRealtimeCost(entry.userId, entry.service, entry.amount);

    // Auto-flush if buffer is large
    if (this.costBuffer.length > 100) {
      await this.flushCosts();
    }

    // Check budget alerts
    await this.checkBudgetAlerts(entry.userId);

    logger.debug('Cost tracked', {
      userId: entry.userId,
      service: entry.service,
      operation: entry.operation,
      amount: `$${entry.amount.toFixed(6)}`,
    });
  }

  // Update real-time cost in cache
  private async updateRealtimeCost(
    userId: string,
    service: string,
    amount: number
  ): Promise<void> {
    const dayKey = new Date().toISOString().split('T')[0];
    const cacheKey = `cost:realtime:${userId}:${dayKey}`;

    try {
      const current = await cache.get<Record<string, number>>(cacheKey) || {};
      
      current.total = (current.total || 0) + amount;
      current[service] = (current[service] || 0) + amount;
      
      await cache.set(cacheKey, current, 86400); // 24 hour TTL
    } catch (error) {
      logger.error('Failed to update realtime cost cache:', error);
    }
  }

  // Flush costs to database
  private async flushCosts(): Promise<void> {
    if (this.costBuffer.length === 0) return;

    const costs = [...this.costBuffer];
    this.costBuffer = [];

    try {
      // Batch insert costs
      const values = costs.map(cost => [
        cost.userId,
        cost.service,
        cost.operation,
        cost.amount,
        cost.units || null,
        JSON.stringify(cost.metadata || {}),
        cost.timestamp,
      ]);

      await db.query(`
        INSERT INTO cost_tracking (
          user_id, service, operation, amount, units, metadata, tracked_at
        ) VALUES ${values.map((_, i) => 
          `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7})`
        ).join(', ')}
      `, values.flat());

      metrics.increment('cost.flushed', costs.length);
      logger.info('Costs flushed to database', { count: costs.length });

    } catch (error) {
      logger.error('Failed to flush costs:', error);
      // Re-add to buffer for retry
      this.costBuffer.unshift(...costs);
    }
  }

  // Get user's current costs
  async getUserCosts(
    userId: string,
    period: 'day' | 'week' | 'month' = 'month'
  ): Promise<{
    total: number;
    byService: Record<string, number>;
    byOperation: Record<string, number>;
    trend: number;
  }> {
    const startDate = this.getPeriodStartDate(period);

    const result = await db.query(`
      SELECT 
        SUM(amount) as total,
        service,
        operation,
        SUM(amount) as service_total
      FROM cost_tracking
      WHERE user_id = $1 AND tracked_at >= $2
      GROUP BY service, operation
    `, [userId, startDate]);

    const byService: Record<string, number> = {};
    const byOperation: Record<string, number> = {};
    let total = 0;

    result.rows.forEach(row => {
      const amount = parseFloat(row.service_total);
      total += amount;
      
      byService[row.service] = (byService[row.service] || 0) + amount;
      byOperation[`${row.service}.${row.operation}`] = amount;
    });

    // Calculate trend
    const previousStartDate = this.getPreviousPeriodStartDate(period);
    const previousResult = await db.query(`
      SELECT SUM(amount) as total
      FROM cost_tracking
      WHERE user_id = $1 AND tracked_at >= $2 AND tracked_at < $3
    `, [userId, previousStartDate, startDate]);

    const previousTotal = parseFloat(previousResult.rows[0]?.total || '0');
    const trend = previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : 0;

    return { total, byService, byOperation, trend };
  }

  // Check budget alerts
  private async checkBudgetAlerts(userId: string): Promise<void> {
    try {
      // Get user's subscription and budget
      const userResult = await db.query(`
        SELECT subscription_tier, monthly_budget_usd
        FROM users
        WHERE id = $1
      `, [userId]);

      if (userResult.rows.length === 0) return;

      const user = userResult.rows[0];
      const budget = user.monthly_budget_usd || this.getDefaultBudget(user.subscription_tier);

      // Get current month's costs
      const costs = await this.getUserCosts(userId, 'month');
      const percentage = (costs.total / budget) * 100;

      // Check thresholds
      if (percentage >= 100) {
        await this.sendBudgetAlert(userId, 'exceeded', costs.total, budget);
        metrics.increment('cost.budget_exceeded');
      } else if (percentage >= 90) {
        await this.sendBudgetAlert(userId, '90_percent', costs.total, budget);
        metrics.increment('cost.budget_warning_90');
      } else if (percentage >= 75) {
        await this.sendBudgetAlert(userId, '75_percent', costs.total, budget);
        metrics.increment('cost.budget_warning_75');
      }

    } catch (error) {
      logger.error('Failed to check budget alerts:', error);
    }
  }

  // Send budget alert
  private async sendBudgetAlert(
    userId: string,
    type: 'exceeded' | '90_percent' | '75_percent',
    current: number,
    budget: number
  ): Promise<void> {
    // Check if alert already sent today
    const alertKey = `cost:alert:${userId}:${type}:${new Date().toISOString().split('T')[0]}`;
    const alreadySent = await cache.get(alertKey);
    
    if (alreadySent) return;

    logger.warn('Budget alert triggered', {
      userId,
      type,
      current: `$${current.toFixed(2)}`,
      budget: `$${budget.toFixed(2)}`,
      percentage: `${((current / budget) * 100).toFixed(1)}%`,
    });

    // TODO: Send email/notification to user

    // Mark as sent
    await cache.set(alertKey, true, 86400); // Don't resend for 24 hours
  }

  // Get default budget by tier
  private getDefaultBudget(tier: string): number {
    const budgets = {
      free: 5,
      premium: 50,
      ultimate: 200,
    };
    return budgets[tier as keyof typeof budgets] || 10;
  }

  // Helper methods for date calculations
  private getPeriodStartDate(period: 'day' | 'week' | 'month'): Date {
    const now = new Date();
    
    switch (period) {
      case 'day':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'week':
        const dayOfWeek = now.getDay();
        const diff = now.getDate() - dayOfWeek;
        return new Date(now.getFullYear(), now.getMonth(), diff);
      case 'month':
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }

  private getPreviousPeriodStartDate(period: 'day' | 'week' | 'month'): Date {
    const current = this.getPeriodStartDate(period);
    
    switch (period) {
      case 'day':
        return new Date(current.getTime() - 24 * 60 * 60 * 1000);
      case 'week':
        return new Date(current.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(current.getFullYear(), current.getMonth() - 1, 1);
    }
  }

  // Cleanup
  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flushCosts();
  }
}

export const costTracking = new CostTrackingService();
```

---

## Step 2: Cost Optimization Service

### 2.1 Create Cost Optimizer
Create `src/services/cost-optimizer.ts`:

```typescript
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import { cache } from '@/lib/cache/redis-client';
import { embeddingCache } from '@/lib/cache/embedding-cache';

interface OptimizationStrategy {
  name: string;
  description: string;
  estimatedSavings: number;
  apply: () => Promise<void>;
}

export class CostOptimizer {
  private strategies: OptimizationStrategy[] = [];

  constructor() {
    this.registerOptimizationStrategies();
  }

  private registerOptimizationStrategies() {
    // Strategy 1: Embedding deduplication
    this.strategies.push({
      name: 'embedding-deduplication',
      description: 'Cache and reuse embeddings for similar text',
      estimatedSavings: 0.30, // 30% savings
      apply: async () => {
        logger.info('Applying embedding deduplication strategy');
        // Already implemented in embedding cache
      },
    });

    // Strategy 2: Batch processing
    this.strategies.push({
      name: 'batch-processing',
      description: 'Batch API calls to reduce overhead',
      estimatedSavings: 0.15, // 15% savings
      apply: async () => {
        logger.info('Applying batch processing strategy');
        // Implementation in respective services
      },
    });

    // Strategy 3: Tiered processing
    this.strategies.push({
      name: 'tiered-processing',
      description: 'Use cheaper models for free tier users',
      estimatedSavings: 0.25, // 25% savings
      apply: async () => {
        logger.info('Applying tiered processing strategy');
      },
    });
  }

  // Optimize file processing based on subscription tier
  async getOptimizedProcessingPlan(
    userId: string,
    fileType: 'image' | 'video',
    subscriptionTier: string
  ): Promise<{
    rekognitionFeatures: string[];
    comprehendFeatures: string[];
    embeddingModel: string;
    maxProcessingTime: number;
  }> {
    // Base configuration
    const basePlan = {
      rekognitionFeatures: ['detectLabels'],
      comprehendFeatures: ['detectSentiment'],
      embeddingModel: 'text-embedding-3-small',
      maxProcessingTime: 300, // 5 minutes
    };

    // Adjust based on tier
    switch (subscriptionTier) {
      case 'free':
        return {
          ...basePlan,
          rekognitionFeatures: ['detectLabels'], // Only basic labels
          comprehendFeatures: [], // Skip text analysis
          maxProcessingTime: 120, // 2 minutes max
        };

      case 'premium':
        return {
          ...basePlan,
          rekognitionFeatures: ['detectLabels', 'detectText', 'detectFaces'],
          comprehendFeatures: ['detectSentiment', 'detectEntities'],
          maxProcessingTime: 600, // 10 minutes
        };

      case 'ultimate':
        return {
          rekognitionFeatures: [
            'detectLabels',
            'detectText',
            'detectFaces',
            'detectModerationLabels',
            'recognizeCelebrities'
          ],
          comprehendFeatures: [
            'detectSentiment',
            'detectEntities',
            'detectKeyPhrases'
          ],
          embeddingModel: 'text-embedding-3-small', // Could upgrade to large
          maxProcessingTime: 1800, // 30 minutes
        };

      default:
        return basePlan;
    }
  }

  // Check if processing should be skipped due to cost
  async shouldSkipProcessing(
    userId: string,
    estimatedCost: number
  ): Promise<{ skip: boolean; reason?: string }> {
    try {
      // Get user's current costs and budget
      const currentCosts = await cache.get<{ total: number }>(`cost:realtime:${userId}:${new Date().toISOString().split('T')[0]}`);
      const monthlyTotal = currentCosts?.total || 0;

      // Get user's budget
      const userBudget = await this.getUserBudget(userId);
      
      // Check if adding this cost would exceed budget
      if (monthlyTotal + estimatedCost > userBudget) {
        metrics.increment('cost.processing_skipped.budget_exceeded');
        return {
          skip: true,
          reason: 'Monthly budget would be exceeded',
        };
      }

      // Check if cost is too high for single operation
      if (estimatedCost > userBudget * 0.1) { // More than 10% of budget
        metrics.increment('cost.processing_skipped.high_cost');
        return {
          skip: true,
          reason: 'Single operation cost exceeds 10% of monthly budget',
        };
      }

      return { skip: false };
    } catch (error) {
      logger.error('Failed to check processing cost limits:', error);
      return { skip: false }; // Don't block on error
    }
  }

  // Get user's budget
  private async getUserBudget(userId: string): Promise<number> {
    const cacheKey = `user:budget:${userId}`;
    const cached = await cache.get<number>(cacheKey);
    
    if (cached !== null) return cached;

    // Default budgets by tier
    const defaultBudgets = {
      free: 5,
      premium: 50,
      ultimate: 200,
    };

    // In production, fetch from database
    const budget = defaultBudgets.premium; // Placeholder
    await cache.set(cacheKey, budget, 3600); // 1 hour cache
    
    return budget;
  }

  // Batch operations for cost efficiency
  async createBatchProcessor<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    options: {
      batchSize?: number;
      maxConcurrent?: number;
      costPerBatch?: number;
    } = {}
  ): Promise<R[]> {
    const {
      batchSize = 25,
      maxConcurrent = 3,
      costPerBatch = 0,
    } = options;

    const results: R[] = [];
    const batches: T[][] = [];

    // Create batches
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    // Process batches with concurrency limit
    for (let i = 0; i < batches.length; i += maxConcurrent) {
      const concurrentBatches = batches.slice(i, i + maxConcurrent);
      
      const batchResults = await Promise.all(
        concurrentBatches.map(batch => processor(batch))
      );
      
      results.push(...batchResults.flat());

      // Track batch processing cost
      if (costPerBatch > 0) {
        metrics.increment('cost.batch_processing', costPerBatch * concurrentBatches.length);
      }
    }

    // Log savings from batching
    const individualCost = items.length * (costPerBatch / batchSize);
    const batchedCost = batches.length * costPerBatch;
    const savings = individualCost - batchedCost;
    
    if (savings > 0) {
      logger.info('Batch processing cost savings', {
        itemCount: items.length,
        batchCount: batches.length,
        savings: `$${savings.toFixed(4)}`,
        savingsPercent: `${((savings / individualCost) * 100).toFixed(1)}%`,
      });
    }

    return results;
  }

  // Find similar processed content to avoid reprocessing
  async findSimilarContent(
    contentHash: string,
    userId: string
  ): Promise<{
    found: boolean;
    similarity: number;
    existingData?: any;
  }> {
    try {
      // Check exact match first
      const exactMatch = await cache.get(`content:processed:${contentHash}`);
      if (exactMatch) {
        metrics.increment('cost.deduplication.exact_match');
        return {
          found: true,
          similarity: 1.0,
          existingData: exactMatch,
        };
      }

      // Check similar content (simplified - in production use LSH or similar)
      const similarKey = `content:similar:${contentHash.substring(0, 8)}*`;
      const similar = await cache.client.keys(cache.prefixKey(similarKey));
      
      if (similar.length > 0) {
        metrics.increment('cost.deduplication.similar_match');
        return {
          found: true,
          similarity: 0.9,
          existingData: await cache.get(similar[0]),
        };
      }

      return { found: false, similarity: 0 };
    } catch (error) {
      logger.error('Failed to find similar content:', error);
      return { found: false, similarity: 0 };
    }
  }

  // Calculate estimated processing cost
  calculateEstimatedCost(
    fileType: 'image' | 'video',
    fileSize: number,
    features: {
      rekognition?: string[];
      transcribe?: boolean;
      comprehend?: boolean;
      embedding?: boolean;
    }
  ): number {
    let cost = 0;

    if (fileType === 'image') {
      // Rekognition costs
      if (features.rekognition) {
        cost += features.rekognition.length * 0.001;
      }
      
      // Embedding cost (assume ~100 tokens for image description)
      if (features.embedding) {
        cost += 100 * 0.00002 / 1000;
      }
    } else {
      // Video costs
      const durationMinutes = fileSize / (5 * 1024 * 1024); // Rough estimate
      
      // Rekognition video analysis
      if (features.rekognition) {
        cost += durationMinutes * 0.10;
      }
      
      // Transcription
      if (features.transcribe) {
        cost += durationMinutes * 0.024;
      }
      
      // Comprehend on transcript
      if (features.comprehend) {
        const estimatedWords = durationMinutes * 150;
        const characters = estimatedWords * 5;
        cost += (characters / 100) * 0.0001 * 3; // 3 features
      }
      
      // Embedding
      if (features.embedding) {
        const estimatedTokens = durationMinutes * 200;
        cost += estimatedTokens * 0.00002 / 1000;
      }
    }

    // Add S3 storage cost
    cost += (fileSize / (1024 * 1024 * 1024)) * 0.023; // Monthly storage

    return cost;
  }

  // Get optimization recommendations
  async getOptimizationRecommendations(userId: string): Promise<{
    recommendations: Array<{
      title: string;
      description: string;
      potentialSavings: number;
      priority: 'high' | 'medium' | 'low';
    }>;
    currentEfficiency: number;
  }> {
    const recommendations = [];
    const costs = await costTracking.getUserCosts(userId, 'month');

    // Analyze cost patterns
    if (costs.byService['openai'] > costs.total * 0.4) {
      recommendations.push({
        title: 'Optimize Embedding Usage',
        description: 'Enable embedding caching to reduce OpenAI API calls',
        potentialSavings: costs.byService['openai'] * 0.3,
        priority: 'high' as const,
      });
    }

    if (costs.byService['aws-rekognition'] > costs.total * 0.3) {
      recommendations.push({
        title: 'Reduce Rekognition Features',
        description: 'Disable celebrity recognition and moderation labels for most files',
        potentialSavings: costs.byService['aws-rekognition'] * 0.2,
        priority: 'medium' as const,
      });
    }

    // Check cache hit rate
    const cacheStats = await cache.getStats();
    const hitRate = parseFloat(cacheStats.hitRate || '0');
    
    if (hitRate < 70) {
      recommendations.push({
        title: 'Improve Cache Hit Rate',
        description: 'Current cache hit rate is low. Enable cache warming for popular content.',
        potentialSavings: costs.total * 0.1,
        priority: 'medium' as const,
      });
    }

    // Calculate efficiency score
    const currentEfficiency = this.calculateEfficiencyScore(costs, hitRate);

    return { recommendations, currentEfficiency };
  }

  private calculateEfficiencyScore(
    costs: any,
    cacheHitRate: number
  ): number {
    // Simple efficiency calculation (0-100)
    let score = 100;
    
    // Penalize high costs
    if (costs.total > 100) score -= 20;
    else if (costs.total > 50) score -= 10;
    
    // Reward good cache usage
    score += (cacheHitRate - 50) * 0.5;
    
    // Ensure score is between 0 and 100
    return Math.max(0, Math.min(100, score));
  }
}

export const costOptimizer = new CostOptimizer();
```

---

## Step 3: Cost Analytics Dashboard

### 3.1 Create Cost Analytics API
Create `src/app/api/analytics/costs/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/middleware/auth';
import { costTracking } from '@/services/cost-tracking';
import { costOptimizer } from '@/services/cost-optimizer';
import { logger } from '@/lib/monitoring/logger';
import { db } from '@/lib/database';

export async function GET(req: NextRequest) {
  try {
    // Authenticate user
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;

    const userId = (req as any).user.id;
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') as 'day' | 'week' | 'month' || 'month';
    const detailed = searchParams.get('detailed') === 'true';

    // Get current costs
    const currentCosts = await costTracking.getUserCosts(userId, period);

    // Get cost history
    const history = await getCostHistory(userId, period);

    // Get optimization recommendations
    const optimizations = await costOptimizer.getOptimizationRecommendations(userId);

    const response: any = {
      success: true,
      data: {
        current: currentCosts,
        history,
        optimizations,
        period,
      },
    };

    // Add detailed breakdown if requested
    if (detailed) {
      response.data.detailed = await getDetailedBreakdown(userId, period);
    }

    logger.debug('Cost analytics retrieved', {
      userId,
      period,
      total: currentCosts.total,
    });

    return NextResponse.json(response);

  } catch (error) {
    logger.error('Failed to retrieve cost analytics:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve cost analytics',
    }, { status: 500 });
  }
}

async function getCostHistory(
  userId: string,
  period: 'day' | 'week' | 'month'
): Promise<Array<{ date: string; amount: number; services: Record<string, number> }>> {
  const days = period === 'day' ? 7 : period === 'week' ? 4 : 12;
  const interval = period === 'day' ? '1 day' : period === 'week' ? '1 week' : '1 month';

  const result = await db.query(`
    WITH date_series AS (
      SELECT generate_series(
        date_trunc($2, CURRENT_DATE - interval '${days} ${interval}'),
        date_trunc($2, CURRENT_DATE),
        interval '${interval}'
      ) as period_date
    )
    SELECT 
      ds.period_date::date as date,
      COALESCE(SUM(ct.amount), 0) as amount,
      json_object_agg(
        COALESCE(ct.service, 'none'),
        COALESCE(SUM(ct.amount), 0)
      ) FILTER (WHERE ct.service IS NOT NULL) as services
    FROM date_series ds
    LEFT JOIN cost_tracking ct ON 
      date_trunc($2, ct.tracked_at) = ds.period_date
      AND ct.user_id = $1
    GROUP BY ds.period_date
    ORDER BY ds.period_date
  `, [userId, period === 'day' ? 'day' : period === 'week' ? 'week' : 'month']);

  return result.rows.map(row => ({
    date: row.date,
    amount: parseFloat(row.amount),
    services: row.services || {},
  }));
}

async function getDetailedBreakdown(
  userId: string,
  period: 'day' | 'week' | 'month'
): Promise<any> {
  const startDate = new Date();
  if (period === 'day') {
    startDate.setDate(startDate.getDate() - 1);
  } else if (period === 'week') {
    startDate.setDate(startDate.getDate() - 7);
  } else {
    startDate.setMonth(startDate.getMonth() - 1);
  }

  const result = await db.query(`
    SELECT 
      service,
      operation,
      COUNT(*) as count,
      SUM(amount) as total,
      AVG(amount) as average,
      MAX(amount) as max_cost,
      SUM(units) as total_units
    FROM cost_tracking
    WHERE user_id = $1 AND tracked_at >= $2
    GROUP BY service, operation
    ORDER BY total DESC
  `, [userId, startDate]);

  return result.rows.map(row => ({
    service: row.service,
    operation: row.operation,
    count: parseInt(row.count),
    total: parseFloat(row.total),
    average: parseFloat(row.average),
    maxCost: parseFloat(row.max_cost),
    totalUnits: parseInt(row.total_units || '0'),
  }));
}
```

### 3.2 Create Budget Management API
Create `src/app/api/billing/budget/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/middleware/auth';
import { validateRequest } from '@/middleware/security';
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';
import Joi from 'joi';

const budgetSchema = Joi.object({
  monthlyBudget: Joi.number().min(0).max(10000).required(),
  alertThresholds: Joi.array().items(Joi.number().min(0).max(100)).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;

    const userId = (req as any).user.id;

    const result = await db.query(`
      SELECT 
        monthly_budget_usd,
        budget_alert_thresholds,
        budget_updated_at
      FROM users
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'User not found',
      }, { status: 404 });
    }

    const user = result.rows[0];

    return NextResponse.json({
      success: true,
      data: {
        monthlyBudget: user.monthly_budget_usd || 50,
        alertThresholds: user.budget_alert_thresholds || [75, 90, 100],
        lastUpdated: user.budget_updated_at,
      },
    });

  } catch (error) {
    logger.error('Failed to get budget settings:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve budget settings',
    }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;

    const validationResult = await validateRequest(req, budgetSchema);
    if (validationResult) return validationResult;

    const userId = (req as any).user.id;
    const { monthlyBudget, alertThresholds } = (req as any).validatedData;

    await db.query(`
      UPDATE users
      SET 
        monthly_budget_usd = $1,
        budget_alert_thresholds = $2,
        budget_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
    `, [monthlyBudget, alertThresholds || [75, 90, 100], userId]);

    logger.info('Budget settings updated', {
      userId,
      monthlyBudget,
      alertThresholds,
    });

    return NextResponse.json({
      success: true,
      message: 'Budget settings updated successfully',
    });

  } catch (error) {
    logger.error('Failed to update budget settings:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to update budget settings',
    }, { status: 500 });
  }
}
```

---

## Step 4: Cost Integration with Processing

### 4.1 Update Media Processor with Cost Tracking
Create `src/workers/processors/cost-aware-processor.ts`:

```typescript
import { costTracking } from '@/services/cost-tracking';
import { costOptimizer } from '@/services/cost-optimizer';
import { logger } from '@/lib/monitoring/logger';

export class CostAwareProcessor {
  async processWithCostTracking(
    jobData: any,
    processingFunction: () => Promise<any>
  ): Promise<{
    result: any;
    totalCost: number;
    breakdown: Record<string, number>;
  }> {
    const { userId, mediaFileId, fileType, fileSize } = jobData;
    const costs: Record<string, number> = {};
    
    try {
      // Get optimized processing plan
      const plan = await costOptimizer.getOptimizedProcessingPlan(
        userId,
        fileType,
        jobData.subscriptionTier
      );

      // Estimate cost before processing
      const estimatedCost = costOptimizer.calculateEstimatedCost(
        fileType,
        fileSize,
        {
          rekognition: plan.rekognitionFeatures,
          transcribe: fileType === 'video',
          comprehend: plan.comprehendFeatures.length > 0,
          embedding: true,
        }
      );

      // Check if we should skip due to cost
      const skipCheck = await costOptimizer.shouldSkipProcessing(
        userId,
        estimatedCost
      );

      if (skipCheck.skip) {
        logger.warn('Processing skipped due to cost', {
          userId,
          mediaFileId,
          reason: skipCheck.reason,
          estimatedCost,
        });
        
        throw new Error(`Processing skipped: ${skipCheck.reason}`);
      }

      // Process with cost tracking at each step
      const result = await this.executeWithCostTracking(
        processingFunction,
        costs,
        userId
      );

      // Calculate total cost
      const totalCost = Object.values(costs).reduce((sum, cost) => sum + cost, 0);

      // Log cost efficiency
      const efficiency = estimatedCost > 0 ? (totalCost / estimatedCost) : 1;
      logger.info('Processing completed with cost tracking', {
        mediaFileId,
        estimatedCost: `$${estimatedCost.toFixed(4)}`,
        actualCost: `$${totalCost.toFixed(4)}`,
        efficiency: `${(efficiency * 100).toFixed(1)}%`,
        breakdown: costs,
      });

      return {
        result,
        totalCost,
        breakdown: costs,
      };

    } catch (error) {
      logger.error('Cost-aware processing failed:', error);
      throw error;
    }
  }

  private async executeWithCostTracking(
    processingFunction: () => Promise<any>,
    costs: Record<string, number>,
    userId: string
  ): Promise<any> {
    // Wrap the processing function to track costs
    const costTrackingContext = {
      userId,
      costs,
      trackCost: (service: string, amount: number) => {
        costs[service] = (costs[service] || 0) + amount;
      },
    };

    // Execute processing with cost context
    return await processingFunction.call(costTrackingContext);
  }
}

export const costAwareProcessor = new CostAwareProcessor();
```

---

## Step 5: Cost Monitoring and Alerts

### 5.1 Create Cost Monitor Service
Create `src/services/cost-monitor.ts`:

```typescript
import { db } from '@/lib/database';
import { cache } from '@/lib/cache/redis-client';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import * as cron from 'node-cron';

export class CostMonitor {
  private monitoringTasks: cron.ScheduledTask[] = [];

  startMonitoring() {
    // Hourly cost check
    const hourlyTask = cron.schedule('0 * * * *', async () => {
      await this.performHourlyCheck();
    });
    this.monitoringTasks.push(hourlyTask);

    // Daily cost report
    const dailyTask = cron.schedule('0 9 * * *', async () => {
      await this.generateDailyReport();
    });
    this.monitoringTasks.push(dailyTask);

    // Weekly optimization check
    const weeklyTask = cron.schedule('0 10 * * 1', async () => {
      await this.performOptimizationCheck();
    });
    this.monitoringTasks.push(weeklyTask);

    logger.info('Cost monitoring started');
  }

  private async performHourlyCheck() {
    try {
      // Check for unusual spikes
      const result = await db.query(`
        SELECT 
          user_id,
          SUM(amount) as hour_total
        FROM cost_tracking
        WHERE tracked_at >= NOW() - INTERVAL '1 hour'
        GROUP BY user_id
        HAVING SUM(amount) > 10
        ORDER BY hour_total DESC
      `);

      for (const row of result.rows) {
        const hourlySpend = parseFloat(row.hour_total);
        
        if (hourlySpend > 20) {
          logger.warn('High hourly spend detected', {
            userId: row.user_id,
            amount: `$${hourlySpend.toFixed(2)}`,
          });
          
          // Could trigger immediate alert
          metrics.increment('cost.alert.hourly_spike');
        }
      }

      // Update metrics
      const totalHourly = result.rows.reduce(
        (sum, row) => sum + parseFloat(row.hour_total),
        0
      );
      metrics.gauge('cost.hourly_total', totalHourly);

    } catch (error) {
      logger.error('Hourly cost check failed:', error);
    }
  }

  private async generateDailyReport() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get daily summary
      const result = await db.query(`
        SELECT 
          COUNT(DISTINCT user_id) as active_users,
          COUNT(*) as total_operations,
          SUM(amount) as total_cost,
          AVG(amount) as avg_cost,
          MAX(amount) as max_cost,
          json_object_agg(service, service_total) as by_service
        FROM (
          SELECT 
            user_id,
            service,
            amount,
            SUM(amount) OVER (PARTITION BY service) as service_total
          FROM cost_tracking
          WHERE tracked_at >= $1 AND tracked_at < $2
        ) t
      `, [yesterday, today]);

      const summary = result.rows[0];
      
      logger.info('Daily cost report', {
        date: yesterday.toISOString().split('T')[0],
        activeUsers: summary.active_users,
        totalOperations: summary.total_operations,
        totalCost: `$${parseFloat(summary.total_cost || '0').toFixed(2)}`,
        avgCost: `$${parseFloat(summary.avg_cost || '0').toFixed(4)}`,
        maxCost: `$${parseFloat(summary.max_cost || '0').toFixed(2)}`,
      });

      // Store for analytics
      await cache.set(
        `cost:daily:${yesterday.toISOString().split('T')[0]}`,
        summary,
        30 * 86400 // 30 days
      );

    } catch (error) {
      logger.error('Daily cost report failed:', error);
    }
  }

  private async performOptimizationCheck() {
    try {
      // Find inefficient users
      const result = await db.query(`
        WITH user_efficiency AS (
          SELECT 
            u.id,
            u.email,
            u.subscription_tier,
            COUNT(DISTINCT mf.id) as files_processed,
            SUM(ct.amount) as total_cost,
            SUM(ct.amount) / NULLIF(COUNT(DISTINCT mf.id), 0) as cost_per_file
          FROM users u
          LEFT JOIN media_files mf ON mf.user_id = u.id
          LEFT JOIN cost_tracking ct ON ct.user_id = u.id
          WHERE ct.tracked_at >= NOW() - INTERVAL '7 days'
          GROUP BY u.id
        )
        SELECT *
        FROM user_efficiency
        WHERE cost_per_file > 1.0
        ORDER BY cost_per_file DESC
        LIMIT 10
      `);

      for (const user of result.rows) {
        logger.warn('Inefficient cost usage detected', {
          userId: user.id,
          email: user.email,
          costPerFile: `$${parseFloat(user.cost_per_file).toFixed(2)}`,
          recommendation: 'Enable cost optimization features',
        });

        // Could send optimization tips email
      }

    } catch (error) {
      logger.error('Optimization check failed:', error);
    }
  }

  stopMonitoring() {
    this.monitoringTasks.forEach(task => task.stop());
    this.monitoringTasks = [];
    logger.info('Cost monitoring stopped');
  }
}

export const costMonitor = new CostMonitor();
```

---

## Testing and Verification

### Create Cost Test Script
Create `scripts/test-cost-tracking.js`:

```typescript
const { costTracking, COST_CONFIG } = require('../src/services/cost-tracking');
const { costOptimizer } = require('../src/services/cost-optimizer');

async function testCostTracking() {
  console.log('🧪 Testing cost tracking system...\n');

  const testUserId = 'test-user-123';

  try {
    // Test cost tracking
    console.log('💰 Testing cost tracking...');
    
    // Track some sample costs
    await costTracking.trackRekognitionCost(testUserId, 'detectLabels', 5);
    console.log('✅ Tracked Rekognition cost');
    
    await costTracking.trackTranscribeCost(testUserId, 10);
    console.log('✅ Tracked Transcribe cost');
    
    await costTracking.trackEmbeddingCost(testUserId, 'text-embedding-3-small', 1000);
    console.log('✅ Tracked OpenAI embedding cost');

    // Test cost retrieval
    console.log('\n📊 Testing cost retrieval...');
    const costs = await costTracking.getUserCosts(testUserId, 'day');
    console.log('Daily costs:', {
      total: `$${costs.total.toFixed(4)}`,
      byService: costs.byService,
    });

    // Test cost optimization
    console.log('\n🔧 Testing cost optimization...');
    const plan = await costOptimizer.getOptimizedProcessingPlan(
      testUserId,
      'image',
      'premium'
    );
    console.log('Optimized plan:', plan);

    // Test cost estimation
    const estimated = costOptimizer.calculateEstimatedCost(
      'video',
      100 * 1024 * 1024, // 100MB
      {
        rekognition: ['detectLabels'],
        transcribe: true,
        comprehend: true,
        embedding: true,
      }
    );
    console.log('Estimated cost for 100MB video:', `$${estimated.toFixed(4)}`);

    // Test recommendations
    console.log('\n💡 Testing optimization recommendations...');
    const recommendations = await costOptimizer.getOptimizationRecommendations(testUserId);
    console.log('Recommendations:', recommendations.recommendations.length);
    console.log('Efficiency score:', recommendations.currentEfficiency);

    console.log('\n🎉 Cost tracking tests completed successfully!');

  } catch (error) {
    console.error('❌ Cost tracking test failed:', error);
    process.exit(1);
  }
}

// Run tests
testCostTracking();
```

### Run Tests
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
node scripts/test-cost-tracking.js
```

---

## ✅ Phase 6 Completion Checklist

### Cost Tracking Implementation
- [ ] **Cost Service**: Real-time cost tracking for all external services
- [ ] **Service Integration**: AWS, OpenAI, and internal cost tracking
- [ ] **Cost Buffer**: Batched cost writes to database
- [ ] **Real-time Cache**: Current costs available instantly
- [ ] **Cost Categories**: Detailed breakdown by service and operation

### Cost Optimization
- [ ] **Optimization Strategies**: Deduplication, batching, tiered processing
- [ ] **Processing Plans**: Tier-based feature selection
- [ ] **Skip Logic**: Budget-aware processing decisions
- [ ] **Batch Processing**: Cost-efficient batch operations
- [ ] **Content Deduplication**: Similar content detection

### Budget Management
- [ ] **User Budgets**: Monthly budget settings per user
- [ ] **Alert Thresholds**: 75%, 90%, and 100% alerts
- [ ] **Budget Enforcement**: Processing blocked when exceeded
- [ ] **Alert System**: Email/notification on threshold breach
- [ ] **Budget API**: User-facing budget management

### Cost Analytics
- [ ] **Cost History**: Daily, weekly, monthly tracking
- [ ] **Service Breakdown**: Costs by service type
- [ ] **Trend Analysis**: Cost trends and patterns
- [ ] **Efficiency Metrics**: Cost per operation tracking
- [ ] **Optimization Recommendations**: AI-driven suggestions

### Monitoring and Alerts
- [ ] **Hourly Checks**: Spike detection and alerting
- [ ] **Daily Reports**: Automated cost summaries
- [ ] **Weekly Analysis**: Optimization opportunities
- [ ] **Anomaly Detection**: Unusual spending patterns
- [ ] **Performance Metrics**: Cost tracking performance

### Testing & Verification
```bash
# All these should succeed:
node scripts/test-cost-tracking.js    # Test cost tracking
npm run dev                          # Start development server
# Check cost analytics API
curl http://localhost:3000/api/analytics/costs
```

---

## 🚀 Next Steps

**Phase 6 Complete!** ✅

**Ready for Phase 7**: Authentication (Firebase) Implementation
- Read: `02-phases/phase-07-authentication.md`
- Prerequisites: Firebase project created, cost tracking working
- Outcome: Complete authentication system with Firebase integration

**Quick Reference**:
- Cost optimization: `04-implementation/cost-patterns.md`
- Firebase setup: `03-reference/firebase-setup.md`
- Next phase: `02-phases/phase-07-authentication.md`

Your application now has comprehensive cost tracking and optimization to keep expenses under control!
