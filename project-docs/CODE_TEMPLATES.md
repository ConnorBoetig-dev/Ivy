# Code Templates for Development

## 🎨 Component Templates

### React Component Template
```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { logger } from '@/lib/monitoring/logger';

interface ComponentNameProps {
  // Define props here
  className?: string;
  children?: React.ReactNode;
}

export function ComponentName({ 
  className = '',
  children,
  ...props 
}: ComponentNameProps) {
  // State management
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Effects
  useEffect(() => {
    // Component initialization
    logger.debug('ComponentName mounted');
    
    return () => {
      // Cleanup
      logger.debug('ComponentName unmounted');
    };
  }, []);

  // Event handlers
  const handleAction = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Implementation here
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      logger.error('ComponentName action failed:', err);
    } finally {
      setLoading(false);
    }
  };

  // Early returns for loading/error states
  if (loading) {
    return <div className="animate-pulse">Loading...</div>;
  }

  if (error) {
    return (
      <div className="text-red-600 p-4 bg-red-50 rounded-lg">
        Error: {error}
      </div>
    );
  }

  return (
    <div className={`component-container ${className}`}>
      {/* Component JSX here */}
      {children}
    </div>
  );
}
```

### React Hook Template
```typescript
import { useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/monitoring/logger';

interface UseHookNameOptions {
  // Define options here
  enabled?: boolean;
}

interface UseHookNameReturn {
  // Define return type here
  data: any;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useHookName(options: UseHookNameOptions = {}): UseHookNameReturn {
  const { enabled = true } = options;
  
  // State
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Main function
  const fetchData = useCallback(async () => {
    if (!enabled) return;

    try {
      setLoading(true);
      setError(null);
      
      // Implementation here
      const result = await someAsyncFunction();
      setData(result);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      logger.error('useHookName failed:', err);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  // Effects
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
}
```

## 🔧 Service Templates

### Service Class Template
```typescript
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

interface ServiceConfig {
  // Configuration options
  timeout?: number;
  retries?: number;
}

interface ServiceOptions {
  // Method options
  userId?: string;
}

export class ServiceName {
  private config: ServiceConfig;

  constructor(config: ServiceConfig = {}) {
    this.config = {
      timeout: 30000,
      retries: 3,
      ...config,
    };
  }

  async performAction(
    input: any,
    options: ServiceOptions = {}
  ): Promise<any> {
    const startTime = Date.now();
    const { userId } = options;

    try {
      logger.info('ServiceName.performAction started', {
        userId,
        input: JSON.stringify(input),
      });

      // Implementation here
      const result = await this.internalMethod(input);

      // Track success metrics
      const duration = Date.now() - startTime;
      metrics.histogram('service_name.action.duration', duration);
      metrics.increment('service_name.action.success');

      logger.info('ServiceName.performAction completed', {
        userId,
        duration,
        resultSize: JSON.stringify(result).length,
      });

      return result;
    } catch (error) {
      // Track error metrics
      const duration = Date.now() - startTime;
      metrics.histogram('service_name.action.duration', duration);
      metrics.increment('service_name.action.error');

      logger.error('ServiceName.performAction failed:', {
        error,
        userId,
        duration,
      });

      throw error;
    }
  }

  private async internalMethod(input: any): Promise<any> {
    // Private implementation methods
    return input;
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      // Simple health check implementation
      return true;
    } catch (error) {
      logger.error('ServiceName health check failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const serviceName = new ServiceName();
```

## 🌐 API Route Templates

### API Route Template
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, trackUsage, AuthenticatedRequest } from '@/middleware/auth';
import { validateRequest } from '@/middleware/security';
import { schemas } from '@/lib/validation/input-validator';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Authentication
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;

    const authenticatedReq = req as AuthenticatedRequest;

    // Track usage (if needed)
    const usageResult = await trackUsage(authenticatedReq, 'api_call');
    if (usageResult) return usageResult;

    // Extract query parameters
    const { searchParams } = new URL(req.url);
    const param = searchParams.get('param');

    // Business logic here
    const result = await performBusinessLogic(param);

    // Track success metrics
    const duration = Date.now() - startTime;
    metrics.histogram('api.endpoint.duration', duration);
    metrics.increment('api.endpoint.success');

    logger.info('API endpoint success', {
      userId: authenticatedReq.user?.id,
      duration,
      result: JSON.stringify(result).length,
    });

    return NextResponse.json({ 
      success: true, 
      data: result 
    });

  } catch (error) {
    // Track error metrics
    const duration = Date.now() - startTime;
    metrics.histogram('api.endpoint.duration', duration);
    metrics.increment('api.endpoint.error');

    logger.error('API endpoint error:', {
      error,
      duration,
      url: req.url,
    });

    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Authentication
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;

    const authenticatedReq = req as AuthenticatedRequest;

    // Validate request body
    const validationResult = await validateRequest(req, schemas.endpoint);
    if (validationResult) return validationResult;

    // Parse body
    const body = await req.json();

    // Business logic here
    const result = await performBusinessLogic(body);

    // Track success metrics
    const duration = Date.now() - startTime;
    metrics.histogram('api.endpoint.post.duration', duration);
    metrics.increment('api.endpoint.post.success');

    return NextResponse.json({ 
      success: true, 
      data: result 
    }, { status: 201 });

  } catch (error) {
    // Error handling
    const duration = Date.now() - startTime;
    metrics.histogram('api.endpoint.post.duration', duration);
    metrics.increment('api.endpoint.post.error');

    logger.error('API POST endpoint error:', error);

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to process request' 
      },
      { status: 500 }
    );
  }
}

async function performBusinessLogic(input: any): Promise<any> {
  // Implement business logic here
  return { processed: input };
}
```

## 🔄 Worker Templates

### BullMQ Worker Template
```typescript
import { Job } from 'bullmq';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

interface JobData {
  // Define job data structure
  id: string;
  userId: string;
  input: any;
}

interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
}

export async function processJob(job: Job<JobData>): Promise<JobResult> {
  const { id, userId, input } = job.data;
  const startTime = Date.now();

  try {
    logger.info('Job processing started', {
      jobId: job.id,
      jobName: job.name,
      userId,
      dataId: id,
    });

    // Update job progress
    await job.updateProgress(10);

    // Main processing logic
    const result = await performProcessing(input);
    await job.updateProgress(50);

    // Additional processing steps
    const finalResult = await finalizeProcessing(result);
    await job.updateProgress(100);

    // Track success metrics
    const duration = Date.now() - startTime;
    metrics.histogram('worker.job.duration', duration, { jobType: job.name });
    metrics.increment('worker.job.success', 1, { jobType: job.name });

    logger.info('Job processing completed', {
      jobId: job.id,
      userId,
      duration,
    });

    return {
      success: true,
      data: finalResult,
    };

  } catch (error) {
    // Track error metrics
    const duration = Date.now() - startTime;
    metrics.histogram('worker.job.duration', duration, { jobType: job.name });
    metrics.increment('worker.job.error', 1, { jobType: job.name });

    logger.error('Job processing failed:', {
      error,
      jobId: job.id,
      userId,
      duration,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function performProcessing(input: any): Promise<any> {
  // Main processing implementation
  return input;
}

async function finalizeProcessing(result: any): Promise<any> {
  // Finalization logic
  return result;
}
```

## 🗄️ Database Templates

### Database Service Template
```typescript
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

interface CreateEntityParams {
  // Define creation parameters
  name: string;
  userId: string;
}

interface UpdateEntityParams {
  // Define update parameters
  id: string;
  updates: Partial<any>;
}

interface EntityFilters {
  // Define filter options
  userId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export class EntityService {
  async createEntity(params: CreateEntityParams): Promise<any> {
    const startTime = Date.now();

    try {
      const result = await db.query(`
        INSERT INTO entities (name, user_id, created_at)
        VALUES ($1, $2, NOW())
        RETURNING *
      `, [params.name, params.userId]);

      const duration = Date.now() - startTime;
      metrics.histogram('db.entity.create.duration', duration);
      metrics.increment('db.entity.create.success');

      logger.info('Entity created', {
        entityId: result.rows[0].id,
        userId: params.userId,
        duration,
      });

      return result.rows[0];

    } catch (error) {
      const duration = Date.now() - startTime;
      metrics.histogram('db.entity.create.duration', duration);
      metrics.increment('db.entity.create.error');

      logger.error('Failed to create entity:', {
        error,
        params,
        duration,
      });

      throw error;
    }
  }

  async getEntity(id: string, userId: string): Promise<any | null> {
    const startTime = Date.now();

    try {
      const result = await db.query(`
        SELECT * FROM entities 
        WHERE id = $1 AND user_id = $2
      `, [id, userId]);

      const duration = Date.now() - startTime;
      metrics.histogram('db.entity.get.duration', duration);

      return result.rows[0] || null;

    } catch (error) {
      logger.error('Failed to get entity:', { error, id, userId });
      throw error;
    }
  }

  async updateEntity(params: UpdateEntityParams): Promise<any> {
    const { id, updates } = params;
    const startTime = Date.now();

    try {
      // Build dynamic update query
      const updateFields = Object.keys(updates);
      const updateValues = Object.values(updates);
      const setClause = updateFields.map((field, index) => 
        `${field} = $${index + 2}`
      ).join(', ');

      const result = await db.query(`
        UPDATE entities 
        SET ${setClause}, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, ...updateValues]);

      const duration = Date.now() - startTime;
      metrics.histogram('db.entity.update.duration', duration);
      metrics.increment('db.entity.update.success');

      return result.rows[0];

    } catch (error) {
      const duration = Date.now() - startTime;
      metrics.histogram('db.entity.update.duration', duration);
      metrics.increment('db.entity.update.error');

      logger.error('Failed to update entity:', { error, params });
      throw error;
    }
  }

  async listEntities(filters: EntityFilters): Promise<any[]> {
    const { userId, status, limit = 20, offset = 0 } = filters;
    const startTime = Date.now();

    try {
      let query = 'SELECT * FROM entities WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (userId) {
        query += ` AND user_id = $${paramIndex}`;
        params.push(userId);
        paramIndex++;
      }

      if (status) {
        query += ` AND status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await db.query(query, params);

      const duration = Date.now() - startTime;
      metrics.histogram('db.entity.list.duration', duration);

      return result.rows;

    } catch (error) {
      logger.error('Failed to list entities:', { error, filters });
      throw error;
    }
  }

  async deleteEntity(id: string, userId: string): Promise<boolean> {
    const startTime = Date.now();

    try {
      const result = await db.query(`
        DELETE FROM entities 
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `, [id, userId]);

      const duration = Date.now() - startTime;
      metrics.histogram('db.entity.delete.duration', duration);

      if (result.rows.length > 0) {
        metrics.increment('db.entity.delete.success');
        logger.info('Entity deleted', { entityId: id, userId });
        return true;
      } else {
        logger.warn('Entity not found for deletion', { entityId: id, userId });
        return false;
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      metrics.histogram('db.entity.delete.duration', duration);
      metrics.increment('db.entity.delete.error');

      logger.error('Failed to delete entity:', { error, id, userId });
      throw error;
    }
  }
}

export const entityService = new EntityService();
```

## 📊 Store Templates

### Zustand Store Template
```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { logger } from '@/lib/monitoring/logger';

interface StoreState {
  // State properties
  items: any[];
  loading: boolean;
  error: string | null;
  
  // Actions
  addItem: (item: any) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, updates: Partial<any>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearItems: () => void;
}

export const useStoreNameStore = create<StoreState>()(
  persist(
    (set, get) => ({
      // Initial state
      items: [],
      loading: false,
      error: null,

      // Actions
      addItem: (item) => {
        set((state) => ({
          items: [...state.items, { ...item, id: Date.now().toString() }],
          error: null,
        }));
        
        logger.debug('Item added to store', { itemId: item.id });
      },

      removeItem: (id) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
          error: null,
        }));
        
        logger.debug('Item removed from store', { itemId: id });
      },

      updateItem: (id, updates) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, ...updates } : item
          ),
          error: null,
        }));
        
        logger.debug('Item updated in store', { itemId: id, updates });
      },

      setLoading: (loading) => {
        set({ loading });
      },

      setError: (error) => {
        set({ error });
        if (error) {
          logger.error('Store error set:', error);
        }
      },

      clearItems: () => {
        set({ items: [], error: null });
        logger.debug('Store items cleared');
      },
    }),
    {
      name: 'store-name-storage',
      partialize: (state) => ({
        // Only persist certain parts of the state
        items: state.items,
      }),
    }
  )
);
```

---

## 🔍 Usage Instructions

### When to Use Each Template

**React Components**: Use for all UI components that manage their own state and handle user interactions.

**React Hooks**: Use for reusable logic that needs to be shared across multiple components.

**Service Classes**: Use for business logic that interacts with external APIs or performs complex operations.

**API Routes**: Use for all Next.js API endpoints with proper authentication and error handling.

**Workers**: Use for background job processing with BullMQ.

**Database Services**: Use for all database operations with proper error handling and metrics.

**Zustand Stores**: Use for global state management that needs to persist across sessions.

### Customization Guidelines

1. **Replace placeholders** with actual names and types
2. **Add specific business logic** in the marked sections
3. **Customize error handling** based on specific requirements
4. **Adjust logging levels** based on the importance of operations
5. **Add additional metrics** for business-specific KPIs

### Best Practices

- Always include proper TypeScript types
- Add comprehensive error handling
- Include logging for debugging and monitoring
- Track metrics for performance monitoring
- Follow naming conventions consistently
- Add JSDoc comments for complex functions
