# Implementation Patterns Guide

## 🎯 Key Implementation Patterns

This guide provides essential patterns and best practices for implementing core features in the AI Media Search application. Use these patterns for consistency and reliability across the codebase.

---

## 1. API Route Implementation Pattern

### Standard API Route Structure
Every API route should follow this pattern for consistency:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, trackUsage, AuthenticatedRequest } from '@/middleware/auth';
import { validateRequest } from '@/middleware/security';
import { rateLimiters } from '@/middleware/rate-limiting';
import { schemas } from '@/lib/validation/input-validator';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const correlationId = crypto.randomUUID();
  
  try {
    // 1. Rate limiting (before authentication to prevent abuse)
    const rateLimitResult = await rateLimiters.api.checkLimit(req);
    if (rateLimitResult) return rateLimitResult;

    // 2. Authentication
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;
    const authenticatedReq = req as AuthenticatedRequest;

    // 3. Input validation
    const validationResult = await validateRequest(req, schemas.yourSchema);
    if (validationResult) return validationResult;

    // 4. Usage tracking (after auth, before business logic)
    const usageResult = await trackUsage(authenticatedReq, 'api_call');
    if (usageResult) return usageResult;

    // 5. Business logic with correlation ID
    const result = await performBusinessLogic(
      (req as any).validatedData,
      authenticatedReq.user!.id,
      correlationId
    );

    // 6. Success response with metrics
    const duration = Date.now() - startTime;
    metrics.histogram('api.endpoint.duration', duration, { 
      endpoint: req.nextUrl.pathname,
      method: req.method,
      status: 'success'
    });

    logger.info('API request completed', {
      correlationId,
      userId: authenticatedReq.user!.id,
      endpoint: req.nextUrl.pathname,
      duration,
    });

    return NextResponse.json({
      success: true,
      data: result,
      requestId: correlationId,
    });

  } catch (error) {
    // 7. Error handling with correlation ID
    const duration = Date.now() - startTime;
    metrics.histogram('api.endpoint.duration', duration, { 
      endpoint: req.nextUrl.pathname,
      method: req.method,
      status: 'error'
    });

    logger.error('API request failed', {
      correlationId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      endpoint: req.nextUrl.pathname,
      duration,
    });

    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId: correlationId,
      }
    }, { status: 500 });
  }
}
```

---

## 2. Service Class Implementation Pattern

### Standard Service Structure
All service classes should follow this pattern:

```typescript
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import { cache } from '@/lib/cache/redis-client';

interface ServiceConfig {
  timeout?: number;
  retries?: number;
  cacheEnabled?: boolean;
}

interface OperationOptions {
  userId?: string;
  correlationId?: string;
  skipCache?: boolean;
}

export class ExampleService {
  private config: ServiceConfig;
  private serviceName = 'example-service';

  constructor(config: ServiceConfig = {}) {
    this.config = {
      timeout: 30000,
      retries: 3,
      cacheEnabled: true,
      ...config,
    };
  }

  async performOperation(
    input: any,
    options: OperationOptions = {}
  ): Promise<any> {
    const { userId, correlationId = crypto.randomUUID(), skipCache = false } = options;
    const startTime = Date.now();
    const operationName = 'perform-operation';

    // Create contextual logger
    const contextLogger = logger.child({
      service: this.serviceName,
      operation: operationName,
      correlationId,
      userId,
    });

    try {
      contextLogger.info('Operation started', { input });

      // 1. Cache check (if enabled)
      if (this.config.cacheEnabled && !skipCache) {
        const cacheKey = `${this.serviceName}:${operationName}:${this.hashInput(input)}`;
        const cached = await cache.get(cacheKey);
        
        if (cached) {
          contextLogger.debug('Cache hit');
          metrics.increment(`${this.serviceName}.${operationName}.cache_hit`);
          return cached;
        }
        
        metrics.increment(`${this.serviceName}.${operationName}.cache_miss`);
      }

      // 2. Main operation with retry logic
      const result = await this.executeWithRetry(
        () => this.internalOperation(input, contextLogger),
        this.config.retries,
        contextLogger
      );

      // 3. Cache result (if enabled)
      if (this.config.cacheEnabled && !skipCache) {
        const cacheKey = `${this.serviceName}:${operationName}:${this.hashInput(input)}`;
        await cache.set(cacheKey, result, 3600); // 1 hour TTL
      }

      // 4. Success metrics and logging
      const duration = Date.now() - startTime;
      metrics.histogram(`${this.serviceName}.${operationName}.duration`, duration);
      metrics.increment(`${this.serviceName}.${operationName}.success`);

      contextLogger.info('Operation completed', {
        duration,
        resultSize: JSON.stringify(result).length,
      });

      return result;

    } catch (error) {
      // 5. Error handling
      const duration = Date.now() - startTime;
      metrics.histogram(`${this.serviceName}.${operationName}.duration`, duration);
      metrics.increment(`${this.serviceName}.${operationName}.error`);

      contextLogger.error('Operation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration,
      });

      throw error;
    }
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    logger: any
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt === maxRetries) {
          break; // Don't retry on final attempt
        }

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
        logger.warn(`Operation failed, retrying in ${delay}ms`, {
          attempt,
          maxRetries,
          error: lastError.message,
        });

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async internalOperation(input: any, logger: any): Promise<any> {
    // Implement the actual business logic here
    // This is where you'd call external APIs, process data, etc.
    return { processed: input };
  }

  private hashInput(input: any): string {
    // Simple hash for caching - in production, use a proper hash function
    return Buffer.from(JSON.stringify(input)).toString('base64').substring(0, 32);
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Implement health check logic
      return true;
    } catch (error) {
      logger.error(`${this.serviceName} health check failed`, error);
      return false;
    }
  }
}

export const exampleService = new ExampleService();
```

---

## 3. Database Operation Pattern

### Standard Database Operations
Use this pattern for all database operations:

```typescript
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

interface DatabaseOperationOptions {
  userId?: string;
  correlationId?: string;
  transaction?: boolean;
}

export class DatabaseService {
  async createRecord(
    data: any,
    options: DatabaseOperationOptions = {}
  ): Promise<any> {
    const { userId, correlationId = crypto.randomUUID(), transaction = false } = options;
    const startTime = Date.now();
    const operation = 'create-record';

    const contextLogger = logger.child({
      service: 'database',
      operation,
      correlationId,
      userId,
    });

    try {
      contextLogger.info('Database operation started', { data });

      const executeQuery = async (queryFn: any) => {
        return await queryFn(`
          INSERT INTO your_table (column1, column2, user_id, created_at)
          VALUES ($1, $2, $3, NOW())
          RETURNING *
        `, [data.column1, data.column2, userId]);
      };

      let result;
      if (transaction) {
        result = await db.transaction(executeQuery);
      } else {
        result = await executeQuery(db.query.bind(db));
      }

      // Success metrics
      const duration = Date.now() - startTime;
      metrics.histogram('database.operation.duration', duration, { operation });
      metrics.increment('database.operation.success', 1, { operation });

      contextLogger.info('Database operation completed', {
        duration,
        recordId: result.rows[0]?.id,
      });

      return result.rows[0];

    } catch (error) {
      // Error handling
      const duration = Date.now() - startTime;
      metrics.histogram('database.operation.duration', duration, { operation });
      metrics.increment('database.operation.error', 1, { operation });

      contextLogger.error('Database operation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      });

      throw error;
    }
  }

  async findWithPagination(
    filters: any,
    pagination: { page: number; limit: number },
    options: DatabaseOperationOptions = {}
  ): Promise<{ items: any[]; total: number; pagination: any }> {
    const { correlationId = crypto.randomUUID() } = options;
    const startTime = Date.now();

    try {
      // Build dynamic query
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (filters.userId) {
        whereClause += ` AND user_id = $${paramIndex}`;
        params.push(filters.userId);
        paramIndex++;
      }

      if (filters.status) {
        whereClause += ` AND status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
      }

      // Count total records
      const countQuery = `SELECT COUNT(*) as total FROM your_table ${whereClause}`;
      const countResult = await db.query(countQuery, params);
      const total = parseInt(countResult.rows[0].total);

      // Get paginated records
      const offset = (pagination.page - 1) * pagination.limit;
      const dataQuery = `
        SELECT * FROM your_table 
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(pagination.limit, offset);

      const dataResult = await db.query(dataQuery, params);

      // Success metrics
      const duration = Date.now() - startTime;
      metrics.histogram('database.query.duration', duration, { type: 'paginated' });
      metrics.histogram('database.query.result_count', dataResult.rows.length);

      return {
        items: dataResult.rows,
        total,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          pages: Math.ceil(total / pagination.limit),
          hasNext: pagination.page * pagination.limit < total,
          hasPrev: pagination.page > 1,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      metrics.histogram('database.query.duration', duration, { type: 'paginated' });
      metrics.increment('database.query.error');

      logger.error('Paginated query failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        correlationId,
        filters,
        pagination,
        duration,
      });

      throw error;
    }
  }
}

export const databaseService = new DatabaseService();
```

---

## 4. Queue Job Processing Pattern

### Standard Job Processor
Use this pattern for all background job processing:

```typescript
import { Job } from 'bullmq';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import { db } from '@/lib/database';

interface JobData {
  mediaFileId: string;
  userId: string;
  correlationId?: string;
  settings?: any;
}

interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  cost?: number;
}

export class JobProcessor {
  async processJob(job: Job<JobData>): Promise<JobResult> {
    const { mediaFileId, userId, correlationId = crypto.randomUUID(), settings } = job.data;
    const startTime = Date.now();
    const jobType = job.name;

    const contextLogger = logger.child({
      service: 'job-processor',
      jobType,
      jobId: job.id,
      mediaFileId,
      userId,
      correlationId,
    });

    try {
      contextLogger.info('Job processing started', {
        jobData: job.data,
        attempts: job.attemptsMade,
      });

      // 1. Update job status in database
      await this.updateJobStatus(mediaFileId, 'processing', 0, null, correlationId);
      await job.updateProgress(10);

      // 2. Validate prerequisites
      const mediaFile = await this.validateMediaFile(mediaFileId, userId);
      if (!mediaFile) {
        throw new Error('Media file not found or inaccessible');
      }
      await job.updateProgress(20);

      // 3. Main processing logic with progress updates
      const result = await this.executeProcessing(
        mediaFile,
        settings,
        contextLogger,
        (progress) => job.updateProgress(20 + (progress * 0.7)) // 20-90%
      );
      await job.updateProgress(90);

      // 4. Save results to database
      await this.saveResults(mediaFileId, result, correlationId);
      await job.updateProgress(100);

      // 5. Update final status
      await this.updateJobStatus(mediaFileId, 'completed', 100, null, correlationId);

      // 6. Success metrics
      const duration = Date.now() - startTime;
      metrics.histogram('job.processing.duration', duration, { jobType });
      metrics.increment('job.processing.success', 1, { jobType });
      
      if (result.cost) {
        metrics.histogram('job.processing.cost', result.cost, { jobType });
      }

      contextLogger.info('Job processing completed', {
        duration,
        cost: result.cost,
      });

      return {
        success: true,
        data: result,
        cost: result.cost,
      };

    } catch (error) {
      // Error handling
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Update job status
      await this.updateJobStatus(
        mediaFileId, 
        'failed', 
        job.attemptsMade,
        errorMessage,
        correlationId
      );

      // Error metrics
      metrics.histogram('job.processing.duration', duration, { jobType });
      metrics.increment('job.processing.error', 1, { jobType });

      contextLogger.error('Job processing failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        duration,
        attempts: job.attemptsMade,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private async validateMediaFile(mediaFileId: string, userId: string): Promise<any> {
    const result = await db.query(`
      SELECT id, filename, file_type, s3_key, status
      FROM media_files
      WHERE id = $1 AND user_id = $2
    `, [mediaFileId, userId]);

    return result.rows[0] || null;
  }

  private async executeProcessing(
    mediaFile: any,
    settings: any,
    logger: any,
    progressCallback: (progress: number) => Promise<void>
  ): Promise<any> {
    // Implement the actual processing logic here
    // Call external services, process data, etc.
    
    // Example progress updates
    await progressCallback(0.1); // 10% of processing
    // ... do some work
    await progressCallback(0.5); // 50% of processing
    // ... do more work
    await progressCallback(1.0); // 100% of processing

    return {
      processed: true,
      cost: 0.05, // Example cost
    };
  }

  private async saveResults(mediaFileId: string, result: any, correlationId: string): Promise<void> {
    await db.query(`
      UPDATE media_files
      SET 
        processing_completed_at = NOW(),
        ai_summary = $1,
        updated_at = NOW()
      WHERE id = $2
    `, [result.summary || null, mediaFileId]);
  }

  private async updateJobStatus(
    mediaFileId: string,
    status: string,
    progress: number,
    errorMessage: string | null,
    correlationId: string
  ): Promise<void> {
    try {
      await db.query(`
        UPDATE processing_jobs
        SET 
          status = $1,
          progress_percentage = $2,
          error_message = $3,
          updated_at = NOW()
        WHERE media_file_id = $4 AND status IN ('pending', 'processing', 'retrying')
      `, [status, progress, errorMessage, mediaFileId]);
    } catch (error) {
      logger.error('Failed to update job status', {
        error,
        mediaFileId,
        status,
        correlationId,
      });
    }
  }
}

export const jobProcessor = new JobProcessor();
```

---

## 5. React Component Pattern

### Standard Component Structure
Use this pattern for all React components:

```typescript
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

interface ComponentProps {
  // Define all props with proper types
  title?: string;
  data?: any[];
  onAction?: (data: any) => void;
  className?: string;
  children?: React.ReactNode;
}

interface ComponentState {
  loading: boolean;
  error: string | null;
  data: any[];
}

export function StandardComponent({ 
  title,
  data = [],
  onAction,
  className = '',
  children 
}: ComponentProps) {
  // 1. State management
  const [state, setState] = useState<ComponentState>({
    loading: false,
    error: null,
    data: [],
  });

  // 2. Memoized callbacks to prevent unnecessary re-renders
  const handleAction = useCallback(async (actionData: any) => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      // Track user interaction
      metrics.increment('component.action', 1, { 
        component: 'StandardComponent',
        action: 'primary'
      });

      await onAction?.(actionData);
      
      logger.debug('Component action completed', {
        component: 'StandardComponent',
        action: 'primary',
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Action failed';
      setState(prev => ({ ...prev, error: errorMessage }));
      
      logger.error('Component action failed', {
        component: 'StandardComponent',
        error: errorMessage,
      });
    } finally {
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [onAction]);

  // 3. Effects for component lifecycle
  useEffect(() => {
    logger.debug('Component mounted', { component: 'StandardComponent' });
    
    // Track component usage
    metrics.increment('component.mount', 1, { component: 'StandardComponent' });

    return () => {
      logger.debug('Component unmounted', { component: 'StandardComponent' });
    };
  }, []);

  // 4. Data synchronization effect
  useEffect(() => {
    if (data && data.length > 0) {
      setState(prev => ({ ...prev, data, error: null }));
    }
  }, [data]);

  // 5. Error boundary equivalent for specific errors
  if (state.error) {
    return (
      <div className={`error-container p-4 bg-red-50 border border-red-200 rounded-lg ${className}`}>
        <div className="flex items-center space-x-2">
          <span className="text-red-600 text-sm font-medium">Error:</span>
          <span className="text-red-700 text-sm">{state.error}</span>
        </div>
        <button 
          onClick={() => setState(prev => ({ ...prev, error: null }))}
          className="mt-2 text-red-600 text-sm underline hover:text-red-800"
        >
          Dismiss
        </button>
      </div>
    );
  }

  // 6. Loading state
  if (state.loading) {
    return (
      <div className={`loading-container ${className}`}>
        <div className="animate-pulse flex space-x-4">
          <div className="rounded-full bg-gray-300 h-10 w-10"></div>
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 bg-gray-300 rounded w-3/4"></div>
            <div className="h-4 bg-gray-300 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }

  // 7. Main render
  return (
    <div className={`standard-component ${className}`}>
      {title && (
        <h2 className="text-xl font-semibold mb-4 text-gray-900">
          {title}
        </h2>
      )}

      <div className="component-content">
        {state.data.length > 0 ? (
          <div className="data-display space-y-2">
            {state.data.map((item, index) => (
              <div 
                key={item.id || index}
                className="item p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <span className="text-gray-800">{item.name || `Item ${index + 1}`}</span>
                <button
                  onClick={() => handleAction(item)}
                  className="ml-2 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                >
                  Action
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state text-center py-8 text-gray-500">
            <p>No data available</p>
          </div>
        )}
      </div>

      {children && (
        <div className="children-content mt-4">
          {children}
        </div>
      )}
    </div>
  );
}
```

---

## 6. Error Handling Patterns

### Centralized Error Handling
Use these patterns for consistent error handling:

```typescript
// Error types
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED = 'AUTHORIZATION_FAILED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Error handler utility
export function handleError(error: unknown, context: string): AppError {
  logger.error(`Error in ${context}`, {
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
    context,
  });

  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    // Map known error types
    if (error.message.includes('not found')) {
      return new AppError(ErrorCode.RESOURCE_NOT_FOUND, error.message, 404);
    }
    
    if (error.message.includes('unauthorized')) {
      return new AppError(ErrorCode.AUTHENTICATION_FAILED, error.message, 401);
    }
  }

  return new AppError(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred');
}

// API error response
export function createErrorResponse(error: AppError, correlationId?: string): NextResponse {
  metrics.increment('api.errors', 1, { code: error.code });

  return NextResponse.json({
    success: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: correlationId,
    }
  }, { status: error.statusCode });
}
```

---

## 7. Testing Patterns

### Unit Test Pattern
Use this pattern for unit tests:

```typescript
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ExampleService } from '@/services/example-service';

// Mock external dependencies
jest.mock('@/lib/monitoring/logger');
jest.mock('@/lib/monitoring/metrics');
jest.mock('@/lib/cache/redis-client');

describe('ExampleService', () => {
  let service: ExampleService;
  
  beforeEach(() => {
    service = new ExampleService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('performOperation', () => {
    test('should successfully process valid input', async () => {
      // Arrange
      const input = { test: 'data' };
      const expectedResult = { processed: input };

      // Act
      const result = await service.performOperation(input);

      // Assert
      expect(result).toEqual(expectedResult);
    });

    test('should handle errors gracefully', async () => {
      // Arrange
      const input = { invalid: 'data' };
      
      // Mock internal method to throw error
      jest.spyOn(service as any, 'internalOperation').mockRejectedValue(
        new Error('Processing failed')
      );

      // Act & Assert
      await expect(service.performOperation(input)).rejects.toThrow('Processing failed');
    });

    test('should use cache when available', async () => {
      // Arrange
      const input = { cached: 'data' };
      const cachedResult = { cached: true };
      
      const mockCache = require('@/lib/cache/redis-client');
      mockCache.cache.get.mockResolvedValue(cachedResult);

      // Act
      const result = await service.performOperation(input);

      // Assert
      expect(result).toEqual(cachedResult);
      expect(mockCache.cache.get).toHaveBeenCalledWith(
        expect.stringContaining('example-service:perform-operation')
      );
    });
  });
});
```

---

These patterns provide a solid foundation for implementing consistent, maintainable, and observable code throughout the AI Media Search application. Use them as templates and adapt as needed for specific requirements.
