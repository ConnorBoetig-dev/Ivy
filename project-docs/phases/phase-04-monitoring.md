# Phase 4: Monitoring & Observability Implementation

## 🎯 Phase Overview
Implement comprehensive monitoring, logging, and observability systems including structured logging with Winston, custom metrics collection, health check endpoints, and real-time performance monitoring to ensure production reliability and quick issue resolution.

## ✅ Prerequisites
- Phase 1-3 completed (Setup, Database, Security)
- Basic understanding of logging best practices
- Understanding of metrics and monitoring concepts
- Knowledge of correlation IDs for request tracing
- Familiarity with health check patterns

## 📋 Phase Checklist
- [ ] Winston logger configured with proper transports
- [ ] Structured logging with correlation IDs
- [ ] Custom metrics collection system
- [ ] Application performance monitoring
- [ ] Cost tracking integration
- [ ] Health check endpoints
- [ ] Log rotation and retention
- [ ] Error tracking and alerting
- [ ] Performance benchmarking

---

## Step 1: Winston Logger Setup

### 1.1 Install Logging Dependencies
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
npm install winston winston-daily-rotate-file @sentry/nextjs pino pino-pretty
npm install -D @types/winston
```

### 1.2 Create Logger Configuration
Create `src/lib/monitoring/logger.ts`:

```typescript
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { hostname } from 'os';

// Define log levels
const logLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

// Define colors for each level
const logColors = {
  fatal: 'red',
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  trace: 'gray',
};

// Create the base logger configuration
const createLogger = () => {
  const environment = process.env.NODE_ENV || 'development';
  const logLevel = process.env.LOG_LEVEL || (environment === 'production' ? 'info' : 'debug');

  // Custom format for structured logging
  const structuredFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.metadata({
      fillExcept: ['message', 'level', 'timestamp', 'label'],
    }),
    winston.format.json(),
  );

  // Console format for development
  const consoleFormat = winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
    winston.format.printf(({ timestamp, level, message, metadata, ...rest }) => {
      let msg = `${timestamp} [${level}]: ${message}`;
      
      // Add metadata if present
      if (metadata && Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
      }
      
      // Add any other fields
      if (Object.keys(rest).length > 0) {
        msg += ` ${JSON.stringify(rest)}`;
      }
      
      return msg;
    }),
  );

  // Create transports array
  const transports: winston.transport[] = [];

  // Console transport
  if (environment !== 'test') {
    transports.push(
      new winston.transports.Console({
        format: environment === 'production' ? structuredFormat : consoleFormat,
      })
    );
  }

  // File transports for production
  if (environment === 'production') {
    // All logs
    transports.push(
      new DailyRotateFile({
        filename: 'logs/application-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '30d',
        format: structuredFormat,
      })
    );

    // Error logs only
    transports.push(
      new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '30d',
        level: 'error',
        format: structuredFormat,
      })
    );
  }

  // Create the logger instance
  const logger = winston.createLogger({
    levels: logLevels,
    level: logLevel,
    defaultMeta: {
      service: 'ai-media-search',
      environment,
      hostname: hostname(),
      pid: process.pid,
    },
    transports,
    exitOnError: false,
  });

  // Add colors to winston
  winston.addColors(logColors);

  return logger;
};

// Create the singleton logger instance
export const logger = createLogger();

// Convenience methods for structured logging
export function logRequest(req: any, res: any, responseTime: number) {
  logger.info('HTTP Request', {
    method: req.method,
    url: req.url,
    status: res.statusCode,
    responseTime,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    correlationId: req.correlationId,
    userId: req.user?.id,
  });
}

export function logError(error: Error, context: Record<string, any> = {}) {
  logger.error(error.message, {
    stack: error.stack,
    name: error.name,
    ...context,
  });
}

export function logMetric(name: string, value: number, tags: Record<string, any> = {}) {
  logger.debug('Metric', {
    metric: name,
    value,
    tags,
    timestamp: Date.now(),
  });
}

// Create child logger with persistent metadata
export function createChildLogger(metadata: Record<string, any>) {
  return logger.child(metadata);
}

// Performance logging helper
export function logPerformance(operation: string, duration: number, metadata: Record<string, any> = {}) {
  const level = duration > 1000 ? 'warn' : duration > 100 ? 'info' : 'debug';
  
  logger.log(level, `Performance: ${operation}`, {
    operation,
    duration,
    durationMs: duration,
    ...metadata,
  });
}

// Audit logging for security-sensitive operations
export function auditLog(action: string, userId: string, metadata: Record<string, any> = {}) {
  logger.info('Audit Log', {
    type: 'audit',
    action,
    userId,
    timestamp: new Date().toISOString(),
    ...metadata,
  });
}

// Development helpers
export const log = {
  fatal: (message: string, meta?: any) => logger.fatal(message, meta),
  error: (message: string, meta?: any) => logger.error(message, meta),
  warn: (message: string, meta?: any) => logger.warn(message, meta),
  info: (message: string, meta?: any) => logger.info(message, meta),
  debug: (message: string, meta?: any) => logger.debug(message, meta),
  trace: (message: string, meta?: any) => logger.log('trace', message, meta),
};

export default logger;
```

### 1.3 Create Request Logger Middleware
Create `src/middleware/request-logger.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { logger, logRequest } from '@/lib/monitoring/logger';
import { v4 as uuidv4 } from 'uuid';

export interface RequestWithCorrelationId extends NextRequest {
  correlationId?: string;
}

export function requestLogger(req: RequestWithCorrelationId): void {
  // Generate correlation ID if not present
  if (!req.correlationId) {
    req.correlationId = req.headers.get('x-correlation-id') || uuidv4();
  }

  // Log request start
  logger.info('Request started', {
    method: req.method,
    url: req.url,
    correlationId: req.correlationId,
    headers: {
      'user-agent': req.headers.get('user-agent'),
      'content-type': req.headers.get('content-type'),
      'content-length': req.headers.get('content-length'),
    },
  });
}

// Response logging helper
export function logResponse(
  req: RequestWithCorrelationId,
  response: NextResponse,
  startTime: number
): NextResponse {
  const duration = Date.now() - startTime;
  
  // Add correlation ID to response headers
  if (req.correlationId) {
    response.headers.set('x-correlation-id', req.correlationId);
  }

  // Log based on status code
  const level = response.status >= 500 ? 'error' : 
                response.status >= 400 ? 'warn' : 'info';

  logger.log(level, 'Request completed', {
    method: req.method,
    url: req.url,
    status: response.status,
    duration,
    correlationId: req.correlationId,
    userId: (req as any).user?.id,
  });

  return response;
}
```

---

## Step 2: Custom Metrics System

### 2.1 Create Metrics Collector
Create `src/lib/monitoring/metrics.ts`:

```typescript
import { logger } from './logger';

interface MetricData {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  tags?: Record<string, string>;
  timestamp: number;
}

class MetricsCollector {
  private metrics: Map<string, MetricData[]> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private metricsBuffer: MetricData[] = [];

  constructor() {
    // Start periodic flush
    if (process.env.NODE_ENV === 'production') {
      this.startPeriodicFlush();
    }
  }

  private startPeriodicFlush(intervalMs: number = 60000) {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, intervalMs);
  }

  // Counter - for counting events
  increment(name: string, value: number = 1, tags?: Record<string, string>) {
    this.record({
      name,
      value,
      type: 'counter',
      tags,
      timestamp: Date.now(),
    });
  }

  // Gauge - for recording current values
  gauge(name: string, value: number, tags?: Record<string, string>) {
    this.record({
      name,
      value,
      type: 'gauge',
      tags,
      timestamp: Date.now(),
    });
  }

  // Histogram - for recording distributions
  histogram(name: string, value: number, tags?: Record<string, string>) {
    this.record({
      name,
      value,
      type: 'histogram',
      tags,
      timestamp: Date.now(),
    });
  }

  // Summary - for recording percentiles
  summary(name: string, value: number, tags?: Record<string, string>) {
    this.record({
      name,
      value,
      type: 'summary',
      tags,
      timestamp: Date.now(),
    });
  }

  private record(metric: MetricData) {
    this.metricsBuffer.push(metric);

    // Log in development
    if (process.env.NODE_ENV === 'development') {
      logger.debug('Metric recorded', metric);
    }

    // Auto-flush if buffer is large
    if (this.metricsBuffer.length > 1000) {
      this.flush();
    }
  }

  flush() {
    if (this.metricsBuffer.length === 0) return;

    try {
      // In production, send to metrics service
      if (process.env.NODE_ENV === 'production') {
        this.sendToMetricsService(this.metricsBuffer);
      }

      // Store aggregated metrics
      this.aggregateMetrics(this.metricsBuffer);

      // Clear buffer
      this.metricsBuffer = [];
    } catch (error) {
      logger.error('Failed to flush metrics', { error });
    }
  }

  private aggregateMetrics(metrics: MetricData[]) {
    metrics.forEach(metric => {
      const key = this.getMetricKey(metric);
      
      if (!this.metrics.has(key)) {
        this.metrics.set(key, []);
      }
      
      const metricArray = this.metrics.get(key)!;
      metricArray.push(metric);

      // Keep only last 1000 data points per metric
      if (metricArray.length > 1000) {
        metricArray.splice(0, metricArray.length - 1000);
      }
    });
  }

  private getMetricKey(metric: MetricData): string {
    const tagString = metric.tags 
      ? Object.entries(metric.tags)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${v}`)
          .join(',')
      : '';
    
    return `${metric.name}:${metric.type}:${tagString}`;
  }

  private async sendToMetricsService(metrics: MetricData[]) {
    // Placeholder for sending to external service
    // In production, this would send to DataDog, CloudWatch, etc.
    logger.debug('Sending metrics to service', { count: metrics.length });
  }

  // Get metrics for internal use
  getMetrics(name?: string): Record<string, any> {
    if (name) {
      const filtered = new Map();
      for (const [key, value] of this.metrics.entries()) {
        if (key.startsWith(name)) {
          filtered.set(key, value);
        }
      }
      return Object.fromEntries(filtered);
    }
    
    return Object.fromEntries(this.metrics);
  }

  // Calculate statistics for a metric
  getStats(name: string): Record<string, number> {
    const values: number[] = [];
    
    for (const [key, metrics] of this.metrics.entries()) {
      if (key.startsWith(name)) {
        values.push(...metrics.map(m => m.value));
      }
    }

    if (values.length === 0) {
      return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
    }

    values.sort((a, b) => a - b);
    
    return {
      count: values.length,
      sum: values.reduce((a, b) => a + b, 0),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: values[0],
      max: values[values.length - 1],
      p50: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)],
    };
  }

  // Cleanup
  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }
}

// Singleton instance
export const metrics = new MetricsCollector();

// Application-specific metric helpers
export const appMetrics = {
  // User activity metrics
  recordUserAction(action: string, userId: string, metadata?: Record<string, string>) {
    metrics.increment('user.action', 1, { action, userId, ...metadata });
  },

  // API performance metrics
  recordApiCall(endpoint: string, method: string, duration: number, status: number) {
    metrics.histogram('api.response_time', duration, { endpoint, method, status: status.toString() });
    metrics.increment('api.requests', 1, { endpoint, method, status: status.toString() });
  },

  // File processing metrics
  recordFileProcessing(fileType: string, processingTime: number, success: boolean) {
    metrics.histogram('file.processing_time', processingTime, { 
      fileType, 
      status: success ? 'success' : 'failure' 
    });
    metrics.increment(`file.processed.${success ? 'success' : 'failure'}`, 1, { fileType });
  },

  // Cost tracking metrics
  recordServiceCost(service: string, cost: number, operation: string) {
    metrics.increment('cost.total', cost, { service, operation });
    metrics.gauge('cost.current', cost, { service, operation });
  },

  // Search metrics
  recordSearch(query: string, resultCount: number, responseTime: number, userId: string) {
    metrics.histogram('search.response_time', responseTime);
    metrics.histogram('search.result_count', resultCount);
    metrics.increment('search.queries', 1, { userId });
  },

  // Queue metrics
  recordQueueMetrics(queueName: string, waiting: number, active: number, completed: number, failed: number) {
    metrics.gauge('queue.waiting', waiting, { queue: queueName });
    metrics.gauge('queue.active', active, { queue: queueName });
    metrics.gauge('queue.completed', completed, { queue: queueName });
    metrics.gauge('queue.failed', failed, { queue: queueName });
  },

  // Database metrics
  recordDatabaseQuery(operation: string, table: string, duration: number, success: boolean) {
    metrics.histogram('db.query_time', duration, { operation, table, status: success ? 'success' : 'failure' });
    metrics.increment('db.queries', 1, { operation, table, status: success ? 'success' : 'failure' });
  },

  // Memory and system metrics
  recordSystemMetrics() {
    const usage = process.memoryUsage();
    metrics.gauge('system.memory.rss', usage.rss);
    metrics.gauge('system.memory.heap_total', usage.heapTotal);
    metrics.gauge('system.memory.heap_used', usage.heapUsed);
    metrics.gauge('system.memory.external', usage.external);
    
    const cpuUsage = process.cpuUsage();
    metrics.gauge('system.cpu.user', cpuUsage.user);
    metrics.gauge('system.cpu.system', cpuUsage.system);
  },
};

// Start collecting system metrics periodically
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    appMetrics.recordSystemMetrics();
  }, 30000); // Every 30 seconds
}

export default metrics;
```

---

## Step 3: Health Check System

### 3.1 Create Health Check Service
Create `src/lib/monitoring/health.ts`:

```typescript
import { db } from '@/lib/database';
import { cache } from '@/lib/cache/redis-client';
import { logger } from './logger';
import { metrics } from './metrics';
import { s3Service } from '@/services/aws/s3-service';

export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  details?: Record<string, any>;
  error?: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: HealthCheckResult[];
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
}

class HealthCheckService {
  private startTime = Date.now();
  private healthChecks: Map<string, () => Promise<HealthCheckResult>> = new Map();

  constructor() {
    this.registerDefaultChecks();
  }

  private registerDefaultChecks() {
    // Database health check
    this.register('database', async () => {
      const start = Date.now();
      try {
        const result = await db.query('SELECT 1 as health_check');
        const poolInfo = db.getPoolInfo();
        
        return {
          service: 'database',
          status: 'healthy',
          responseTime: Date.now() - start,
          details: {
            totalConnections: poolInfo.totalCount,
            idleConnections: poolInfo.idleCount,
            waitingConnections: poolInfo.waitingCount,
          },
        };
      } catch (error) {
        logger.error('Database health check failed', { error });
        return {
          service: 'database',
          status: 'unhealthy',
          responseTime: Date.now() - start,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    // Redis health check
    this.register('redis', async () => {
      const start = Date.now();
      try {
        await cache.ping();
        const info = await cache.info();
        
        return {
          service: 'redis',
          status: 'healthy',
          responseTime: Date.now() - start,
          details: {
            connected: true,
            version: info.redis_version,
            usedMemory: info.used_memory_human,
            connectedClients: info.connected_clients,
          },
        };
      } catch (error) {
        logger.error('Redis health check failed', { error });
        return {
          service: 'redis',
          status: 'unhealthy',
          responseTime: Date.now() - start,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    // AWS S3 health check
    this.register('aws-s3', async () => {
      const start = Date.now();
      try {
        const buckets = await s3Service.listBuckets();
        
        return {
          service: 'aws-s3',
          status: 'healthy',
          responseTime: Date.now() - start,
          details: {
            bucketsAccessible: buckets.length > 0,
            bucketCount: buckets.length,
          },
        };
      } catch (error) {
        logger.error('AWS S3 health check failed', { error });
        return {
          service: 'aws-s3',
          status: 'degraded', // Degraded because app can still function with cached data
          responseTime: Date.now() - start,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    // OpenAI API health check
    this.register('openai', async () => {
      const start = Date.now();
      try {
        // Simple test embedding
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: 'health check',
          }),
        });

        if (!response.ok) {
          throw new Error(`OpenAI API returned ${response.status}`);
        }
        
        return {
          service: 'openai',
          status: 'healthy',
          responseTime: Date.now() - start,
        };
      } catch (error) {
        logger.error('OpenAI health check failed', { error });
        return {
          service: 'openai',
          status: 'degraded', // Degraded because cached embeddings can still be used
          responseTime: Date.now() - start,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    // Disk space health check
    this.register('disk-space', async () => {
      const start = Date.now();
      try {
        const { execSync } = require('child_process');
        const output = execSync('df -h /').toString();
        const lines = output.trim().split('\n');
        const data = lines[1].split(/\s+/);
        const usedPercent = parseInt(data[4]);
        
        const status = usedPercent > 90 ? 'unhealthy' : 
                      usedPercent > 80 ? 'degraded' : 'healthy';
        
        return {
          service: 'disk-space',
          status,
          responseTime: Date.now() - start,
          details: {
            used: data[2],
            available: data[3],
            usedPercent: `${usedPercent}%`,
          },
        };
      } catch (error) {
        return {
          service: 'disk-space',
          status: 'degraded',
          responseTime: Date.now() - start,
          error: 'Unable to check disk space',
        };
      }
    });
  }

  register(name: string, check: () => Promise<HealthCheckResult>) {
    this.healthChecks.set(name, check);
  }

  async checkHealth(): Promise<SystemHealth> {
    const checks = await Promise.all(
      Array.from(this.healthChecks.values()).map(check => 
        check().catch(error => ({
          service: 'unknown',
          status: 'unhealthy' as const,
          responseTime: 0,
          error: error.message,
        }))
      )
    );

    // Determine overall status
    const hasUnhealthy = checks.some(c => c.status === 'unhealthy');
    const hasDegraded = checks.some(c => c.status === 'degraded');
    
    const overallStatus = hasUnhealthy ? 'unhealthy' : 
                         hasDegraded ? 'degraded' : 'healthy';

    // Record metrics
    metrics.gauge('health.status', overallStatus === 'healthy' ? 1 : 0);
    checks.forEach(check => {
      metrics.gauge(`health.service.${check.service}`, 
        check.status === 'healthy' ? 1 : 0
      );
      metrics.histogram(`health.response_time.${check.service}`, check.responseTime);
    });

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      checks,
      memory: {
        rss: process.memoryUsage().rss,
        heapTotal: process.memoryUsage().heapTotal,
        heapUsed: process.memoryUsage().heapUsed,
        external: process.memoryUsage().external,
      },
    };
  }

  async checkSpecificService(serviceName: string): Promise<HealthCheckResult | null> {
    const check = this.healthChecks.get(serviceName);
    if (!check) {
      return null;
    }
    
    try {
      return await check();
    } catch (error) {
      return {
        service: serviceName,
        status: 'unhealthy',
        responseTime: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const healthCheck = new HealthCheckService();

// Periodic health check logging
if (process.env.NODE_ENV === 'production') {
  setInterval(async () => {
    try {
      const health = await healthCheck.checkHealth();
      
      if (health.status !== 'healthy') {
        logger.warn('System health degraded', health);
      }
    } catch (error) {
      logger.error('Health check monitoring failed', { error });
    }
  }, 60000); // Every minute
}
```

### 3.2 Create Health Check API Route
Create `src/app/api/health/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { healthCheck } from '@/lib/monitoring/health';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Check if detailed health check is requested
    const detailed = req.nextUrl.searchParams.get('detailed') === 'true';
    
    if (!detailed) {
      // Simple health check for load balancers
      return NextResponse.json({ status: 'ok' }, { status: 200 });
    }

    // Detailed health check
    const health = await healthCheck.checkHealth();
    
    // Determine HTTP status code
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'degraded' ? 200 : 503;

    // Record metrics
    const duration = Date.now() - startTime;
    metrics.histogram('health_check.duration', duration);
    metrics.increment('health_check.requests', 1, { 
      status: health.status 
    });

    logger.debug('Health check completed', {
      status: health.status,
      duration,
      checks: health.checks.length,
    });

    return NextResponse.json(health, { 
      status: statusCode,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      }
    });

  } catch (error) {
    logger.error('Health check failed', { error });
    
    return NextResponse.json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
```

---

## Step 4: Performance Monitoring

### 4.1 Create Performance Monitor
Create `src/lib/monitoring/performance.ts`:

```typescript
import { logger } from './logger';
import { metrics } from './metrics';

interface PerformanceEntry {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

class PerformanceMonitor {
  private entries: Map<string, PerformanceEntry> = new Map();
  private thresholds: Map<string, number> = new Map();

  constructor() {
    this.setDefaultThresholds();
  }

  private setDefaultThresholds() {
    // Set performance thresholds in milliseconds
    this.thresholds.set('api.request', 1000);
    this.thresholds.set('db.query', 100);
    this.thresholds.set('file.upload', 5000);
    this.thresholds.set('file.processing', 30000);
    this.thresholds.set('search.query', 2000);
    this.thresholds.set('embedding.generation', 500);
  }

  startTimer(name: string, metadata?: Record<string, any>): string {
    const id = `${name}-${Date.now()}-${Math.random()}`;
    
    this.entries.set(id, {
      name,
      startTime: Date.now(),
      metadata,
    });
    
    return id;
  }

  endTimer(id: string): number {
    const entry = this.entries.get(id);
    
    if (!entry) {
      logger.warn('Performance timer not found', { id });
      return 0;
    }
    
    entry.endTime = Date.now();
    entry.duration = entry.endTime - entry.startTime;
    
    // Check threshold
    const threshold = this.getThreshold(entry.name);
    if (threshold && entry.duration > threshold) {
      logger.warn('Performance threshold exceeded', {
        name: entry.name,
        duration: entry.duration,
        threshold,
        metadata: entry.metadata,
      });
      
      metrics.increment('performance.threshold_exceeded', 1, {
        operation: entry.name,
      });
    }
    
    // Record metrics
    metrics.histogram(`performance.${entry.name}`, entry.duration, {
      ...entry.metadata,
    });
    
    // Log if slow
    if (entry.duration > 1000) {
      logger.info('Slow operation completed', {
        name: entry.name,
        duration: entry.duration,
        metadata: entry.metadata,
      });
    }
    
    // Clean up
    this.entries.delete(id);
    
    return entry.duration;
  }

  private getThreshold(name: string): number | undefined {
    // Check exact match
    if (this.thresholds.has(name)) {
      return this.thresholds.get(name);
    }
    
    // Check prefix match
    for (const [key, value] of this.thresholds.entries()) {
      if (name.startsWith(key)) {
        return value;
      }
    }
    
    return undefined;
  }

  setThreshold(name: string, milliseconds: number) {
    this.thresholds.set(name, milliseconds);
  }

  // Async operation wrapper
  async measure<T>(
    name: string, 
    operation: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const id = this.startTimer(name, metadata);
    
    try {
      const result = await operation();
      this.endTimer(id);
      return result;
    } catch (error) {
      this.endTimer(id);
      throw error;
    }
  }

  // Sync operation wrapper
  measureSync<T>(
    name: string,
    operation: () => T,
    metadata?: Record<string, any>
  ): T {
    const id = this.startTimer(name, metadata);
    
    try {
      const result = operation();
      this.endTimer(id);
      return result;
    } catch (error) {
      this.endTimer(id);
      throw error;
    }
  }

  // Get current performance stats
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    // Get metrics stats
    for (const [key, value] of Object.entries(metrics.getMetrics())) {
      if (key.startsWith('performance.')) {
        stats[key] = metrics.getStats(key.split(':')[0]);
      }
    }
    
    return stats;
  }
}

export const performance = new PerformanceMonitor();

// Convenience functions
export async function measureAsync<T>(
  name: string,
  operation: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  return performance.measure(name, operation, metadata);
}

export function measureSync<T>(
  name: string,
  operation: () => T,
  metadata?: Record<string, any>
): T {
  return performance.measureSync(name, operation, metadata);
}

// Decorator for measuring method performance
export function measure(name?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const measurementName = name || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      return performance.measure(
        measurementName,
        () => originalMethod.apply(this, args),
        { className: target.constructor.name, method: propertyKey }
      );
    };

    return descriptor;
  };
}
```

---

## Step 5: Error Tracking

### 5.1 Create Error Tracking Service
Create `src/lib/monitoring/error-tracker.ts`:

```typescript
import { logger } from './logger';
import { metrics } from './metrics';
import * as Sentry from '@sentry/nextjs';

interface ErrorContext {
  userId?: string;
  correlationId?: string;
  service?: string;
  operation?: string;
  metadata?: Record<string, any>;
}

class ErrorTracker {
  private errorCounts: Map<string, number> = new Map();
  private errorPatterns: Map<string, Date[]> = new Map();

  constructor() {
    this.initializeSentry();
  }

  private initializeSentry() {
    if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV,
        tracesSampleRate: 0.1,
        beforeSend(event, hint) {
          // Filter out sensitive data
          if (event.request) {
            delete event.request.cookies;
            delete event.request.headers?.authorization;
          }
          return event;
        },
      });
    }
  }

  captureError(error: Error, context?: ErrorContext) {
    // Log the error
    logger.error(error.message, {
      stack: error.stack,
      ...context,
    });

    // Track metrics
    const errorType = error.constructor.name;
    metrics.increment('errors.captured', 1, {
      type: errorType,
      service: context?.service || 'unknown',
    });

    // Track error patterns
    this.trackErrorPattern(errorType);

    // Send to Sentry in production
    if (process.env.NODE_ENV === 'production') {
      Sentry.withScope((scope) => {
        if (context?.userId) {
          scope.setUser({ id: context.userId });
        }
        
        if (context?.correlationId) {
          scope.setTag('correlationId', context.correlationId);
        }
        
        if (context?.metadata) {
          scope.setContext('metadata', context.metadata);
        }
        
        Sentry.captureException(error);
      });
    }

    // Check for error spikes
    this.checkErrorSpike(errorType);
  }

  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: ErrorContext) {
    // Log the message
    logger[level](message, context);

    // Send to Sentry in production
    if (process.env.NODE_ENV === 'production') {
      Sentry.withScope((scope) => {
        if (context?.userId) {
          scope.setUser({ id: context.userId });
        }
        
        if (context?.metadata) {
          scope.setContext('metadata', context.metadata);
        }
        
        Sentry.captureMessage(message, level);
      });
    }
  }

  private trackErrorPattern(errorType: string) {
    if (!this.errorPatterns.has(errorType)) {
      this.errorPatterns.set(errorType, []);
    }
    
    const pattern = this.errorPatterns.get(errorType)!;
    pattern.push(new Date());
    
    // Keep only last hour of errors
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const filtered = pattern.filter(date => date > oneHourAgo);
    this.errorPatterns.set(errorType, filtered);
  }

  private checkErrorSpike(errorType: string) {
    const pattern = this.errorPatterns.get(errorType);
    if (!pattern) return;

    // Check if more than 10 errors in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentErrors = pattern.filter(date => date > fiveMinutesAgo);
    
    if (recentErrors.length > 10) {
      logger.error('Error spike detected', {
        errorType,
        count: recentErrors.length,
        timeWindow: '5 minutes',
      });
      
      metrics.increment('errors.spike_detected', 1, { type: errorType });
      
      // Could trigger alerts here
      this.notifyErrorSpike(errorType, recentErrors.length);
    }
  }

  private notifyErrorSpike(errorType: string, count: number) {
    // Placeholder for notification logic
    // In production, this would send alerts via email, Slack, PagerDuty, etc.
    logger.warn('Error spike notification would be sent', {
      errorType,
      count,
      severity: 'high',
    });
  }

  // Get error statistics
  getErrorStats(): Record<string, any> {
    const stats: Record<string, any> = {
      totalErrors: 0,
      errorsByType: {},
      recentErrors: {},
    };

    for (const [errorType, dates] of this.errorPatterns.entries()) {
      stats.errorsByType[errorType] = dates.length;
      stats.totalErrors += dates.length;
      
      // Count recent errors (last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      stats.recentErrors[errorType] = dates.filter(date => date > fiveMinutesAgo).length;
    }

    return stats;
  }
}

export const errorTracker = new ErrorTracker();

// Global error handlers
if (typeof window === 'undefined') {
  // Server-side unhandled rejections
  process.on('unhandledRejection', (reason, promise) => {
    errorTracker.captureError(
      new Error(`Unhandled Promise Rejection: ${reason}`),
      { service: 'node', operation: 'unhandledRejection' }
    );
  });

  // Server-side uncaught exceptions
  process.on('uncaughtException', (error) => {
    errorTracker.captureError(error, {
      service: 'node',
      operation: 'uncaughtException',
    });
    
    // Give time to flush logs before exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
}
```

---

## Step 6: Monitoring Dashboard Data

### 6.1 Create Monitoring API Routes
Create `src/app/api/monitoring/metrics/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, requireSubscriptionTier } from '@/middleware/auth';
import { metrics } from '@/lib/monitoring/metrics';
import { performance } from '@/lib/monitoring/performance';
import { errorTracker } from '@/lib/monitoring/error-tracker';
import { logger } from '@/lib/monitoring/logger';

export async function GET(req: NextRequest) {
  try {
    // Only allow admin users or ultimate tier
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;

    const tierCheck = requireSubscriptionTier('ultimate')(req as any);
    if (tierCheck) return tierCheck;

    // Get monitoring data
    const metricsData = metrics.getMetrics();
    const performanceData = performance.getStats();
    const errorData = errorTracker.getErrorStats();

    // Aggregate key metrics
    const aggregated = {
      timestamp: new Date().toISOString(),
      metrics: {
        requests: metrics.getStats('api.requests'),
        responseTime: metrics.getStats('api.response_time'),
        errors: metrics.getStats('errors.captured'),
        searches: metrics.getStats('search.queries'),
        uploads: metrics.getStats('file.processed.success'),
        costs: metrics.getStats('cost.total'),
      },
      performance: performanceData,
      errors: errorData,
      system: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        cpuUsage: process.cpuUsage(),
      },
    };

    logger.debug('Monitoring metrics requested', {
      userId: (req as any).user?.id,
    });

    return NextResponse.json({
      success: true,
      data: aggregated,
    });

  } catch (error) {
    logger.error('Failed to retrieve monitoring metrics', { error });
    
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve metrics',
    }, { status: 500 });
  }
}
```

---

## Testing and Verification

### Create Test Script
Create `scripts/test-monitoring.js`:

```javascript
const { logger } = require('../src/lib/monitoring/logger');
const { metrics } = require('../src/lib/monitoring/metrics');
const { performance } = require('../src/lib/monitoring/performance');
const { healthCheck } = require('../src/lib/monitoring/health');

async function testMonitoring() {
  console.log('🧪 Testing monitoring systems...');

  try {
    // Test logging
    console.log('\n📝 Testing logger...');
    logger.info('Test info message', { test: true });
    logger.warn('Test warning', { severity: 'medium' });
    logger.error('Test error (not real)', { test: true });
    console.log('✅ Logger working');

    // Test metrics
    console.log('\n📊 Testing metrics...');
    metrics.increment('test.counter', 1);
    metrics.gauge('test.gauge', 42);
    metrics.histogram('test.histogram', 150);
    console.log('✅ Metrics recorded');

    // Test performance monitoring
    console.log('\n⏱️ Testing performance monitoring...');
    await performance.measure('test.operation', async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    console.log('✅ Performance monitoring working');

    // Test health checks
    console.log('\n🏥 Testing health checks...');
    const health = await healthCheck.checkHealth();
    console.log('System health:', health.status);
    console.log('Health checks:', health.checks.map(c => 
      `${c.service}: ${c.status} (${c.responseTime}ms)`
    ).join(', '));

    console.log('\n🎉 All monitoring systems working!');

  } catch (error) {
    console.error('❌ Monitoring test failed:', error);
    process.exit(1);
  }
}

testMonitoring();
```

### Run Tests
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
node scripts/test-monitoring.js
```

---

## ✅ Phase 4 Completion Checklist

### Logging System
- [ ] **Winston Logger**: Configured with file rotation and structured logging
- [ ] **Log Levels**: Appropriate log levels for different environments
- [ ] **Correlation IDs**: Request tracing with correlation IDs
- [ ] **Performance Logging**: Slow operation detection and logging
- [ ] **Audit Logging**: Security-sensitive operations logged

### Metrics Collection
- [ ] **Custom Metrics**: Counter, gauge, histogram, and summary metrics
- [ ] **Application Metrics**: User actions, API calls, processing times
- [ ] **Cost Metrics**: Service cost tracking integrated
- [ ] **System Metrics**: Memory, CPU, and resource usage tracked
- [ ] **Metric Aggregation**: Statistics calculation for all metrics

### Health Monitoring
- [ ] **Health Checks**: Database, Redis, AWS, OpenAI health checks
- [ ] **Overall Status**: Aggregated health status calculation
- [ ] **Health Endpoint**: API endpoint for health checks
- [ ] **Degraded States**: Proper handling of partially healthy systems
- [ ] **Performance Thresholds**: Response time monitoring

### Error Tracking
- [ ] **Error Capture**: Comprehensive error catching and logging
- [ ] **Error Patterns**: Spike detection and alerting
- [ ] **Context Enrichment**: Errors include user and request context
- [ ] **Sentry Integration**: Production error tracking setup
- [ ] **Error Statistics**: Error rate and pattern analysis

### Performance Monitoring
- [ ] **Operation Timing**: Start/end timer functionality
- [ ] **Threshold Alerts**: Performance threshold violations detected
- [ ] **Async Wrappers**: Easy performance measurement helpers
- [ ] **Method Decorators**: @measure decorator for methods
- [ ] **Statistics**: Performance statistics aggregation

### Testing & Verification
```bash
# All these should succeed:
npm run dev                          # Start development server
curl http://localhost:3000/api/health # Health check endpoint
curl http://localhost:3000/api/health?detailed=true # Detailed health
node scripts/test-monitoring.js      # Test monitoring systems
```

---

## 🚀 Next Steps

**Phase 4 Complete!** ✅

**Ready for Phase 5**: Caching & Performance Implementation
- Read: `02-phases/phase-05-caching.md`
- Prerequisites: Redis installed, monitoring working
- Outcome: Complete caching layer for optimal performance

**Quick Reference**:
- Monitoring patterns: `04-implementation/monitoring-patterns.md`
- Performance optimization: `05-checklists/performance-checklist.md`
- Next phase: `02-phases/phase-05-caching.md`

Your application now has comprehensive monitoring and observability for production operations!
