# Phase 5: Caching & Performance Implementation

## 🎯 Phase Overview
Implement a comprehensive caching strategy using Redis for search results, embeddings, and session management. Optimize database queries, implement image processing pipelines, and establish performance optimization patterns to ensure sub-2-second search response times.

## ✅ Prerequisites
- Phase 1-4 completed (Setup, Database, Security, Monitoring)
- Redis server installed and running
- Understanding of caching strategies
- Knowledge of database query optimization
- Familiarity with image optimization techniques

## 📋 Phase Checklist
- [ ] Redis client configured with connection pooling
- [ ] Embedding cache implementation
- [ ] Search result caching with invalidation
- [ ] Session management via Redis
- [ ] Database query optimization
- [ ] Image processing pipeline
- [ ] CDN integration for media files
- [ ] Performance testing and benchmarking
- [ ] Cache warming strategies

---

## Step 1: Redis Setup and Configuration

### 1.1 Install Redis Server
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search

# Install Redis
sudo apt-get update
sudo apt-get install -y redis-server redis-tools

# Configure Redis for production
sudo nano /etc/redis/redis.conf

# Key settings to modify:
# maxmemory 2gb
# maxmemory-policy allkeys-lru
# save 900 1
# save 300 10
# save 60 10000
# appendonly yes
# appendfsync everysec

# Start Redis
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Verify Redis is running
redis-cli ping  # Should return PONG
```

### 1.2 Create Redis Client Manager
Create `src/lib/cache/redis-client.ts`:

```typescript
import Redis from 'ioredis';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

interface CacheConfig {
  ttl?: number; // Default TTL in seconds
  prefix?: string;
  maxRetries?: number;
}

class CacheManager {
  private client: Redis;
  private subscriber: Redis;
  private publisher: Redis;
  private isConnected: boolean = false;
  private config: CacheConfig;

  constructor(config: CacheConfig = {}) {
    this.config = {
      ttl: 3600, // 1 hour default
      prefix: 'ams:', // AI Media Search prefix
      maxRetries: 3,
      ...config,
    };

    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      maxRetriesPerRequest: this.config.maxRetries,
      enableReadyCheck: true,
      lazyConnect: true,
    };

    // Create Redis clients
    this.client = new Redis(redisConfig);
    this.subscriber = new Redis(redisConfig);
    this.publisher = new Redis(redisConfig);

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Client events
    this.client.on('connect', () => {
      logger.info('Redis client connected');
      this.isConnected = true;
      metrics.gauge('redis.connected', 1);
    });

    this.client.on('error', (error) => {
      logger.error('Redis client error:', error);
      metrics.increment('redis.errors');
    });

    this.client.on('close', () => {
      logger.warn('Redis client disconnected');
      this.isConnected = false;
      metrics.gauge('redis.connected', 0);
    });

    // Monitor Redis performance
    this.client.on('commandQueued', (command) => {
      metrics.increment('redis.commands.queued');
    });
  }

  async connect(): Promise<void> {
    try {
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect(),
      ]);
      logger.info('All Redis clients connected successfully');
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all([
      this.client.quit(),
      this.subscriber.quit(),
      this.publisher.quit(),
    ]);
  }

  // Basic cache operations
  async get<T = any>(key: string): Promise<T | null> {
    const startTime = Date.now();
    
    try {
      const value = await this.client.get(this.prefixKey(key));
      const duration = Date.now() - startTime;
      
      metrics.histogram('redis.operation.duration', duration, { operation: 'get' });
      metrics.increment(value ? 'redis.hits' : 'redis.misses');
      
      if (!value) return null;
      
      return JSON.parse(value);
    } catch (error) {
      logger.error('Redis get error:', { key, error });
      metrics.increment('redis.errors', 1, { operation: 'get' });
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const serialized = JSON.stringify(value);
      const prefixedKey = this.prefixKey(key);
      const expiry = ttl || this.config.ttl!;
      
      await this.client.setex(prefixedKey, expiry, serialized);
      
      const duration = Date.now() - startTime;
      metrics.histogram('redis.operation.duration', duration, { operation: 'set' });
      
      return true;
    } catch (error) {
      logger.error('Redis set error:', { key, error });
      metrics.increment('redis.errors', 1, { operation: 'set' });
      return false;
    }
  }

  async delete(key: string | string[]): Promise<number> {
    const startTime = Date.now();
    
    try {
      const keys = Array.isArray(key) ? key.map(k => this.prefixKey(k)) : [this.prefixKey(key)];
      const result = await this.client.del(...keys);
      
      const duration = Date.now() - startTime;
      metrics.histogram('redis.operation.duration', duration, { operation: 'delete' });
      
      return result;
    } catch (error) {
      logger.error('Redis delete error:', { key, error });
      metrics.increment('redis.errors', 1, { operation: 'delete' });
      return 0;
    }
  }

  // Pattern-based operations
  async deletePattern(pattern: string): Promise<number> {
    const startTime = Date.now();
    
    try {
      const keys = await this.client.keys(this.prefixKey(pattern));
      if (keys.length === 0) return 0;
      
      const result = await this.client.del(...keys);
      
      const duration = Date.now() - startTime;
      metrics.histogram('redis.operation.duration', duration, { 
        operation: 'deletePattern',
        keyCount: keys.length 
      });
      
      return result;
    } catch (error) {
      logger.error('Redis deletePattern error:', { pattern, error });
      return 0;
    }
  }

  // Advanced operations
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Lock to prevent thundering herd
    const lockKey = `lock:${key}`;
    const lockAcquired = await this.acquireLock(lockKey, 10); // 10 second lock

    try {
      // Double-check after acquiring lock
      const cachedAfterLock = await this.get<T>(key);
      if (cachedAfterLock !== null) {
        return cachedAfterLock;
      }

      // Generate value
      const value = await factory();
      
      // Store in cache
      await this.set(key, value, ttl);
      
      return value;
    } finally {
      if (lockAcquired) {
        await this.releaseLock(lockKey);
      }
    }
  }

  // Lock implementation for preventing race conditions
  private async acquireLock(key: string, ttl: number): Promise<boolean> {
    const result = await this.client.set(
      this.prefixKey(key),
      '1',
      'EX',
      ttl,
      'NX'
    );
    return result === 'OK';
  }

  private async releaseLock(key: string): Promise<void> {
    await this.client.del(this.prefixKey(key));
  }

  // Pub/Sub for cache invalidation
  async publish(channel: string, message: any): Promise<void> {
    await this.publisher.publish(
      this.prefixKey(channel),
      JSON.stringify(message)
    );
  }

  async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
    await this.subscriber.subscribe(this.prefixKey(channel));
    
    this.subscriber.on('message', (receivedChannel, message) => {
      if (receivedChannel === this.prefixKey(channel)) {
        try {
          const parsed = JSON.parse(message);
          handler(parsed);
        } catch (error) {
          logger.error('Failed to parse pub/sub message:', error);
        }
      }
    });
  }

  // Utility methods
  private prefixKey(key: string): string {
    return `${this.config.prefix}${key}`;
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async info(): Promise<any> {
    const info = await this.client.info();
    const parsed: any = {};
    
    info.split('\n').forEach(line => {
      const [key, value] = line.split(':');
      if (key && value) {
        parsed[key.trim()] = value.trim();
      }
    });
    
    return parsed;
  }

  // Get cache statistics
  async getStats(): Promise<Record<string, any>> {
    const info = await this.info();
    
    return {
      connected: this.isConnected,
      memoryUsed: info.used_memory_human,
      hits: parseInt(info.keyspace_hits || '0'),
      misses: parseInt(info.keyspace_misses || '0'),
      hitRate: info.keyspace_hits && info.keyspace_misses
        ? (parseInt(info.keyspace_hits) / (parseInt(info.keyspace_hits) + parseInt(info.keyspace_misses)) * 100).toFixed(2) + '%'
        : 'N/A',
      connectedClients: parseInt(info.connected_clients || '0'),
      evictedKeys: parseInt(info.evicted_keys || '0'),
    };
  }
}

// Create singleton instance
export const cache = new CacheManager();

// Initialize connection
cache.connect().catch(error => {
  logger.error('Failed to initialize Redis connection:', error);
});

// Export specific cache implementations
export { cache as default };
```

---

## Step 2: Embedding Cache Implementation

### 2.1 Create Embedding Cache Service
Create `src/lib/cache/embedding-cache.ts`:

```typescript
import { cache } from './redis-client';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import crypto from 'crypto';

interface EmbeddingCacheOptions {
  ttl?: number; // Time to live in seconds
  version?: string; // Cache version for invalidation
}

export class EmbeddingCache {
  private readonly PREFIX = 'embedding:';
  private readonly TTL = 7 * 24 * 60 * 60; // 7 days
  private readonly VERSION = 'v1';

  constructor(private options: EmbeddingCacheOptions = {}) {
    this.TTL = options.ttl || this.TTL;
    this.VERSION = options.version || this.VERSION;
  }

  // Generate cache key for text
  private generateKey(text: string, model: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(text)
      .update(model)
      .update(this.VERSION)
      .digest('hex')
      .substring(0, 16);
    
    return `${this.PREFIX}${model}:${hash}`;
  }

  // Get embedding from cache
  async get(text: string, model: string): Promise<number[] | null> {
    const key = this.generateKey(text, model);
    const startTime = Date.now();
    
    try {
      const cached = await cache.get<{ embedding: number[], text: string }>(key);
      
      if (cached && cached.text === text) {
        const duration = Date.now() - startTime;
        metrics.histogram('embedding_cache.get.duration', duration);
        metrics.increment('embedding_cache.hits');
        
        logger.debug('Embedding cache hit', {
          model,
          textLength: text.length,
          duration,
        });
        
        return cached.embedding;
      }
      
      metrics.increment('embedding_cache.misses');
      return null;
    } catch (error) {
      logger.error('Embedding cache get error:', error);
      metrics.increment('embedding_cache.errors', 1, { operation: 'get' });
      return null;
    }
  }

  // Store embedding in cache
  async set(text: string, model: string, embedding: number[]): Promise<void> {
    const key = this.generateKey(text, model);
    const startTime = Date.now();
    
    try {
      await cache.set(
        key,
        { embedding, text, model, cachedAt: new Date().toISOString() },
        this.TTL
      );
      
      const duration = Date.now() - startTime;
      metrics.histogram('embedding_cache.set.duration', duration);
      
      logger.debug('Embedding cached', {
        model,
        textLength: text.length,
        embeddingSize: embedding.length,
        duration,
      });
    } catch (error) {
      logger.error('Embedding cache set error:', error);
      metrics.increment('embedding_cache.errors', 1, { operation: 'set' });
    }
  }

  // Batch get embeddings
  async getBatch(
    texts: string[],
    model: string
  ): Promise<Map<string, number[] | null>> {
    const results = new Map<string, number[] | null>();
    
    // Create batches to avoid overwhelming Redis
    const batchSize = 100;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const promises = batch.map(text => 
        this.get(text, model).then(embedding => ({ text, embedding }))
      );
      
      const batchResults = await Promise.all(promises);
      batchResults.forEach(({ text, embedding }) => {
        results.set(text, embedding);
      });
    }
    
    return results;
  }

  // Batch set embeddings
  async setBatch(
    items: Array<{ text: string; embedding: number[] }>,
    model: string
  ): Promise<void> {
    const batchSize = 100;
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(
        batch.map(({ text, embedding }) => this.set(text, model, embedding))
      );
    }
  }

  // Invalidate cache for a specific text
  async invalidate(text: string, model: string): Promise<void> {
    const key = this.generateKey(text, model);
    await cache.delete(key);
  }

  // Clear all embeddings cache
  async clear(): Promise<void> {
    await cache.deletePattern(`${this.PREFIX}*`);
    logger.info('Embedding cache cleared');
  }

  // Get cache statistics
  async getStats(): Promise<Record<string, any>> {
    const stats = await cache.getStats();
    return {
      ...stats,
      prefix: this.PREFIX,
      ttl: this.TTL,
      version: this.VERSION,
    };
  }
}

// Export singleton instance
export const embeddingCache = new EmbeddingCache();
```

---

## Step 3: Search Result Caching

### 3.1 Create Search Cache Service
Create `src/lib/cache/search-cache.ts`:

```typescript
import { cache } from './redis-client';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import crypto from 'crypto';
import { SearchResult } from '@/types';

interface SearchCacheOptions {
  ttl?: number;
  maxResults?: number;
}

export class SearchCache {
  private readonly PREFIX = 'search:';
  private readonly TTL = 60 * 60; // 1 hour
  private readonly MAX_RESULTS = 100;

  constructor(private options: SearchCacheOptions = {}) {
    this.TTL = options.ttl || this.TTL;
    this.MAX_RESULTS = options.maxResults || this.MAX_RESULTS;
  }

  // Generate cache key for search query
  private generateKey(
    userId: string,
    query: string,
    filters?: Record<string, any>
  ): string {
    const filterStr = filters ? JSON.stringify(filters, Object.keys(filters).sort()) : '';
    const hash = crypto
      .createHash('sha256')
      .update(userId)
      .update(query.toLowerCase().trim())
      .update(filterStr)
      .digest('hex')
      .substring(0, 16);
    
    return `${this.PREFIX}${userId}:${hash}`;
  }

  // Get search results from cache
  async get(
    userId: string,
    query: string,
    filters?: Record<string, any>
  ): Promise<SearchResult[] | null> {
    const key = this.generateKey(userId, query, filters);
    const startTime = Date.now();
    
    try {
      const cached = await cache.get<{
        results: SearchResult[];
        query: string;
        timestamp: string;
      }>(key);
      
      if (cached) {
        const duration = Date.now() - startTime;
        metrics.histogram('search_cache.get.duration', duration);
        metrics.increment('search_cache.hits');
        
        // Check if results are still fresh
        const age = Date.now() - new Date(cached.timestamp).getTime();
        if (age > this.TTL * 1000) {
          await cache.delete(key);
          metrics.increment('search_cache.expired');
          return null;
        }
        
        logger.debug('Search cache hit', {
          userId,
          query,
          resultCount: cached.results.length,
          age: Math.floor(age / 1000),
          duration,
        });
        
        return cached.results;
      }
      
      metrics.increment('search_cache.misses');
      return null;
    } catch (error) {
      logger.error('Search cache get error:', error);
      metrics.increment('search_cache.errors', 1, { operation: 'get' });
      return null;
    }
  }

  // Store search results in cache
  async set(
    userId: string,
    query: string,
    results: SearchResult[],
    filters?: Record<string, any>
  ): Promise<void> {
    const key = this.generateKey(userId, query, filters);
    const startTime = Date.now();
    
    try {
      // Limit cached results
      const limitedResults = results.slice(0, this.MAX_RESULTS);
      
      await cache.set(
        key,
        {
          results: limitedResults,
          query,
          filters,
          timestamp: new Date().toISOString(),
          totalResults: results.length,
        },
        this.TTL
      );
      
      const duration = Date.now() - startTime;
      metrics.histogram('search_cache.set.duration', duration);
      
      // Track popular searches
      await this.trackSearchPopularity(query);
      
      logger.debug('Search results cached', {
        userId,
        query,
        resultCount: limitedResults.length,
        duration,
      });
    } catch (error) {
      logger.error('Search cache set error:', error);
      metrics.increment('search_cache.errors', 1, { operation: 'set' });
    }
  }

  // Track search popularity for cache warming
  private async trackSearchPopularity(query: string): Promise<void> {
    const popularityKey = `${this.PREFIX}popularity`;
    const normalizedQuery = query.toLowerCase().trim();
    
    try {
      await cache.client.zincrby(
        cache.prefixKey(popularityKey),
        1,
        normalizedQuery
      );
      
      // Keep only top 1000 popular searches
      await cache.client.zremrangebyrank(
        cache.prefixKey(popularityKey),
        0,
        -1001
      );
    } catch (error) {
      logger.error('Failed to track search popularity:', error);
    }
  }

  // Get popular searches for cache warming
  async getPopularSearches(limit: number = 100): Promise<string[]> {
    const popularityKey = `${this.PREFIX}popularity`;
    
    try {
      const popular = await cache.client.zrevrange(
        cache.prefixKey(popularityKey),
        0,
        limit - 1
      );
      
      return popular;
    } catch (error) {
      logger.error('Failed to get popular searches:', error);
      return [];
    }
  }

  // Invalidate user's search cache
  async invalidateUserCache(userId: string): Promise<void> {
    await cache.deletePattern(`${this.PREFIX}${userId}:*`);
    logger.info('User search cache invalidated', { userId });
  }

  // Invalidate all search cache
  async clear(): Promise<void> {
    await cache.deletePattern(`${this.PREFIX}*`);
    logger.info('Search cache cleared');
  }

  // Warm cache with popular searches
  async warmCache(
    userId: string,
    searchFunction: (query: string) => Promise<SearchResult[]>
  ): Promise<void> {
    const popular = await this.getPopularSearches(20);
    
    logger.info('Warming search cache', {
      userId,
      searchCount: popular.length,
    });
    
    for (const query of popular) {
      try {
        const results = await searchFunction(query);
        await this.set(userId, query, results);
      } catch (error) {
        logger.error('Failed to warm cache for query:', { query, error });
      }
    }
  }
}

export const searchCache = new SearchCache();
```

---

## Step 4: Session Management

### 4.1 Create Session Store
Create `src/lib/cache/session-store.ts`:

```typescript
import { cache } from './redis-client';
import { logger } from '@/lib/monitoring/logger';
import crypto from 'crypto';

interface SessionData {
  userId: string;
  firebaseUid: string;
  email: string;
  subscriptionTier: string;
  lastActivity: string;
  metadata?: Record<string, any>;
}

export class SessionStore {
  private readonly PREFIX = 'session:';
  private readonly TTL = 24 * 60 * 60; // 24 hours

  // Generate secure session ID
  generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // Create session
  async create(sessionId: string, data: SessionData): Promise<void> {
    const key = `${this.PREFIX}${sessionId}`;
    
    try {
      await cache.set(key, {
        ...data,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      }, this.TTL);
      
      logger.debug('Session created', {
        sessionId: sessionId.substring(0, 8) + '...',
        userId: data.userId,
      });
    } catch (error) {
      logger.error('Failed to create session:', error);
      throw error;
    }
  }

  // Get session
  async get(sessionId: string): Promise<SessionData | null> {
    const key = `${this.PREFIX}${sessionId}`;
    
    try {
      const session = await cache.get<SessionData>(key);
      
      if (session) {
        // Update last activity
        session.lastActivity = new Date().toISOString();
        await cache.set(key, session, this.TTL);
      }
      
      return session;
    } catch (error) {
      logger.error('Failed to get session:', error);
      return null;
    }
  }

  // Update session
  async update(sessionId: string, updates: Partial<SessionData>): Promise<void> {
    const session = await this.get(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }
    
    const key = `${this.PREFIX}${sessionId}`;
    const updated = {
      ...session,
      ...updates,
      lastActivity: new Date().toISOString(),
    };
    
    await cache.set(key, updated, this.TTL);
  }

  // Delete session
  async delete(sessionId: string): Promise<void> {
    const key = `${this.PREFIX}${sessionId}`;
    await cache.delete(key);
    
    logger.debug('Session deleted', {
      sessionId: sessionId.substring(0, 8) + '...',
    });
  }

  // Get all user sessions
  async getUserSessions(userId: string): Promise<string[]> {
    // This would require maintaining a separate index
    // For now, return empty array
    return [];
  }

  // Clean expired sessions (called by cron job)
  async cleanExpired(): Promise<number> {
    // Redis handles TTL automatically
    return 0;
  }
}

export const sessionStore = new SessionStore();
```

---

## Step 5: Database Query Optimization

### 5.1 Create Query Optimizer Service
Create `src/lib/performance/query-optimizer.ts`:

```typescript
import { db } from '@/lib/database';
import { cache } from '@/lib/cache/redis-client';
import { logger } from '@/lib/monitoring/logger';
import { performance } from '@/lib/monitoring/performance';

interface QueryPlan {
  query: string;
  params: any[];
  cacheKey?: string;
  cacheTTL?: number;
}

export class QueryOptimizer {
  // Prepared statements cache
  private preparedStatements = new Map<string, string>();

  constructor() {
    this.initializePreparedStatements();
  }

  private initializePreparedStatements() {
    // Common queries that benefit from preparation
    this.preparedStatements.set('getUserById', `
      SELECT u.*, 
        COUNT(DISTINCT mf.id) as total_files,
        SUM(mf.file_size_bytes) as total_storage
      FROM users u
      LEFT JOIN media_files mf ON mf.user_id = u.id
      WHERE u.id = $1
      GROUP BY u.id
    `);

    this.preparedStatements.set('getMediaWithEmbeddings', `
      SELECT 
        mf.*,
        me.embedding,
        me.embedding_model,
        array_agg(DISTINCT pj.job_type) as processed_jobs
      FROM media_files mf
      LEFT JOIN media_embeddings me ON me.media_file_id = mf.id AND me.is_primary = true
      LEFT JOIN processing_jobs pj ON pj.media_file_id = mf.id AND pj.status = 'completed'
      WHERE mf.id = ANY($1::uuid[])
      GROUP BY mf.id, me.id
    `);

    this.preparedStatements.set('searchMediaVector', `
      WITH search_embedding AS (
        SELECT $1::vector(1536) as query_embedding
      )
      SELECT 
        mf.*,
        me.embedding <=> se.query_embedding as distance,
        1 - (me.embedding <=> se.query_embedding) as similarity
      FROM media_embeddings me
      CROSS JOIN search_embedding se
      INNER JOIN media_files mf ON mf.id = me.media_file_id
      WHERE 
        mf.user_id = $2
        AND mf.status = 'completed'
        AND me.is_primary = true
      ORDER BY me.embedding <=> se.query_embedding
      LIMIT $3
    `);
  }

  // Execute optimized query with caching
  async executeOptimized<T = any>(plan: QueryPlan): Promise<T[]> {
    return performance.measure(`db.query.${plan.cacheKey || 'direct'}`, async () => {
      // Try cache first if cache key provided
      if (plan.cacheKey) {
        const cached = await cache.get<T[]>(plan.cacheKey);
        if (cached) {
          logger.debug('Query cache hit', { cacheKey: plan.cacheKey });
          return cached;
        }
      }

      // Execute query
      const result = await db.query<T>(plan.query, plan.params);

      // Cache result if cache key provided
      if (plan.cacheKey && result.rows.length > 0) {
        await cache.set(plan.cacheKey, result.rows, plan.cacheTTL || 300);
      }

      return result.rows;
    });
  }

  // Get user with stats (optimized)
  async getUserWithStats(userId: string): Promise<any> {
    const plan: QueryPlan = {
      query: this.preparedStatements.get('getUserById')!,
      params: [userId],
      cacheKey: `user:stats:${userId}`,
      cacheTTL: 300, // 5 minutes
    };

    const results = await this.executeOptimized(plan);
    return results[0] || null;
  }

  // Batch load media files with embeddings
  async batchLoadMedia(mediaIds: string[]): Promise<Map<string, any>> {
    if (mediaIds.length === 0) return new Map();

    // Use prepared statement for batch loading
    const results = await this.executeOptimized({
      query: this.preparedStatements.get('getMediaWithEmbeddings')!,
      params: [mediaIds],
    });

    // Convert to map for O(1) lookup
    const mediaMap = new Map<string, any>();
    results.forEach(media => {
      mediaMap.set(media.id, media);
    });

    return mediaMap;
  }

  // Optimized vector search
  async vectorSearch(
    embedding: number[],
    userId: string,
    limit: number = 20
  ): Promise<any[]> {
    return this.executeOptimized({
      query: this.preparedStatements.get('searchMediaVector')!,
      params: [JSON.stringify(embedding), userId, limit],
      // Don't cache vector search results as embeddings are unique
    });
  }

  // Analyze query performance
  async analyzeQuery(query: string, params: any[] = []): Promise<any> {
    try {
      const explainQuery = `EXPLAIN (ANALYZE, BUFFERS) ${query}`;
      const result = await db.query(explainQuery, params);
      
      const analysis = {
        plan: result.rows,
        recommendations: this.generateRecommendations(result.rows),
      };

      logger.debug('Query analysis completed', analysis);
      return analysis;
    } catch (error) {
      logger.error('Query analysis failed:', error);
      throw error;
    }
  }

  private generateRecommendations(explainResult: any[]): string[] {
    const recommendations: string[] = [];
    const planText = JSON.stringify(explainResult);

    // Check for common performance issues
    if (planText.includes('Seq Scan')) {
      recommendations.push('Consider adding indexes to avoid sequential scans');
    }

    if (planText.includes('Nested Loop') && planText.includes('rows=1000')) {
      recommendations.push('High row count in nested loop - consider query restructuring');
    }

    if (planText.includes('Sort') && !planText.includes('Index Scan')) {
      recommendations.push('Consider adding indexes for ORDER BY columns');
    }

    return recommendations;
  }

  // Create missing indexes
  async createOptimalIndexes(): Promise<void> {
    const indexes = [
      // User activity indexes
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_activity 
       ON users(last_login_at DESC, created_at DESC)`,
      
      // Media file composite indexes
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_files_user_status 
       ON media_files(user_id, status, uploaded_at DESC)`,
      
      // Processing job indexes
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_processing_jobs_status 
       ON processing_jobs(status, created_at DESC) 
       WHERE status IN ('pending', 'processing')`,
      
      // Search history indexes
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_search_history_user_created 
       ON search_history(user_id, created_at DESC)`,
    ];

    for (const indexSql of indexes) {
      try {
        await db.query(indexSql);
        logger.info('Index created or already exists', { 
          index: indexSql.match(/INDEX (\w+)/)?.[1] 
        });
      } catch (error) {
        logger.error('Failed to create index:', error);
      }
    }
  }
}

export const queryOptimizer = new QueryOptimizer();
```

---

## Step 6: Image Processing Pipeline

### 6.1 Create Image Optimization Service
Create `src/lib/performance/image-optimizer.ts`:

```typescript
import sharp from 'sharp';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import { performance } from '@/lib/monitoring/performance';
import fs from 'fs/promises';
import path from 'path';

interface ImageOptimizationOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
  generateThumbnail?: boolean;
  thumbnailSize?: number;
}

export class ImageOptimizer {
  private readonly DEFAULT_OPTIONS: ImageOptimizationOptions = {
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 85,
    format: 'jpeg',
    generateThumbnail: true,
    thumbnailSize: 300,
  };

  async optimizeImage(
    inputPath: string,
    outputPath: string,
    options: ImageOptimizationOptions = {}
  ): Promise<{
    optimizedPath: string;
    thumbnailPath?: string;
    metadata: any;
  }> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    return performance.measure('image.optimization', async () => {
      try {
        // Read image metadata
        const image = sharp(inputPath);
        const metadata = await image.metadata();
        
        logger.debug('Processing image', {
          input: inputPath,
          width: metadata.width,
          height: metadata.height,
          format: metadata.format,
        });

        // Calculate resize dimensions
        const { width, height } = this.calculateDimensions(
          metadata.width!,
          metadata.height!,
          opts.maxWidth!,
          opts.maxHeight!
        );

        // Process main image
        await image
          .resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: opts.quality, progressive: true })
          .toFile(outputPath);

        const result: any = {
          optimizedPath: outputPath,
          metadata: {
            original: {
              width: metadata.width,
              height: metadata.height,
              size: metadata.size,
              format: metadata.format,
            },
            optimized: {
              width,
              height,
              format: opts.format,
            },
          },
        };

        // Generate thumbnail if requested
        if (opts.generateThumbnail) {
          const thumbnailPath = this.getThumbnailPath(outputPath);
          await this.generateThumbnail(
            inputPath,
            thumbnailPath,
            opts.thumbnailSize!
          );
          result.thumbnailPath = thumbnailPath;
        }

        // Track metrics
        const originalSize = (await fs.stat(inputPath)).size;
        const optimizedSize = (await fs.stat(outputPath)).size;
        const compressionRatio = ((originalSize - optimizedSize) / originalSize) * 100;
        
        metrics.histogram('image.compression_ratio', compressionRatio);
        metrics.histogram('image.processing_time', Date.now());
        
        logger.info('Image optimized', {
          originalSize,
          optimizedSize,
          compressionRatio: `${compressionRatio.toFixed(2)}%`,
        });

        return result;
      } catch (error) {
        logger.error('Image optimization failed:', error);
        metrics.increment('image.optimization.errors');
        throw error;
      }
    });
  }

  private calculateDimensions(
    originalWidth: number,
    originalHeight: number,
    maxWidth: number,
    maxHeight: number
  ): { width: number; height: number } {
    const aspectRatio = originalWidth / originalHeight;

    let width = originalWidth;
    let height = originalHeight;

    if (width > maxWidth) {
      width = maxWidth;
      height = Math.round(width / aspectRatio);
    }

    if (height > maxHeight) {
      height = maxHeight;
      width = Math.round(height * aspectRatio);
    }

    return { width, height };
  }

  async generateThumbnail(
    inputPath: string,
    outputPath: string,
    size: number
  ): Promise<void> {
    await sharp(inputPath)
      .resize(size, size, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 80 })
      .toFile(outputPath);
  }

  private getThumbnailPath(imagePath: string): string {
    const dir = path.dirname(imagePath);
    const ext = path.extname(imagePath);
    const name = path.basename(imagePath, ext);
    return path.join(dir, `${name}_thumb${ext}`);
  }

  // Batch process images
  async batchOptimize(
    images: Array<{ input: string; output: string }>,
    options: ImageOptimizationOptions = {}
  ): Promise<any[]> {
    const batchSize = 5; // Process 5 images concurrently
    const results = [];

    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(({ input, output }) =>
          this.optimizeImage(input, output, options)
        )
      );
      results.push(...batchResults);
    }

    return results;
  }

  // Extract dominant colors for visual search
  async extractColors(imagePath: string, count: number = 5): Promise<string[]> {
    try {
      const { dominant } = await sharp(imagePath)
        .resize(100, 100) // Resize for faster processing
        .raw()
        .toBuffer({ resolveWithObject: true })
        .then(({ data, info }) => {
          // Simple color extraction logic
          // In production, use a proper color extraction library
          return { dominant: ['#000000'] }; // Placeholder
        });

      return dominant;
    } catch (error) {
      logger.error('Color extraction failed:', error);
      return [];
    }
  }

  // Generate responsive image set
  async generateResponsiveSet(
    inputPath: string,
    outputDir: string,
    sizes: number[] = [320, 640, 1024, 1920]
  ): Promise<Record<number, string>> {
    const results: Record<number, string> = {};
    const ext = path.extname(inputPath);
    const name = path.basename(inputPath, ext);

    await fs.mkdir(outputDir, { recursive: true });

    for (const size of sizes) {
      const outputPath = path.join(outputDir, `${name}_${size}w${ext}`);
      
      await sharp(inputPath)
        .resize(size, null, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85, progressive: true })
        .toFile(outputPath);
      
      results[size] = outputPath;
    }

    return results;
  }
}

export const imageOptimizer = new ImageOptimizer();
```

---

## Step 7: Performance Testing

### 7.1 Create Performance Test Suite
Create `scripts/test-performance.js`:

```typescript
const { cache } = require('../src/lib/cache/redis-client');
const { embeddingCache } = require('../src/lib/cache/embedding-cache');
const { searchCache } = require('../src/lib/cache/search-cache');
const { queryOptimizer } = require('../src/lib/performance/query-optimizer');
const { performance } = require('../src/lib/monitoring/performance');

async function testPerformance() {
  console.log('🧪 Testing performance optimizations...\n');

  try {
    // Test Redis cache
    console.log('📊 Testing Redis cache...');
    const testKey = 'test:performance';
    const testData = { test: true, timestamp: Date.now() };
    
    const setStart = Date.now();
    await cache.set(testKey, testData, 60);
    console.log(`✅ Cache set: ${Date.now() - setStart}ms`);
    
    const getStart = Date.now();
    const retrieved = await cache.get(testKey);
    console.log(`✅ Cache get: ${Date.now() - getStart}ms`);
    
    // Test embedding cache
    console.log('\n📊 Testing embedding cache...');
    const testText = 'This is a test text for embedding cache';
    const testEmbedding = new Array(1536).fill(0.1);
    
    await embeddingCache.set(testText, 'text-embedding-3-small', testEmbedding);
    const cachedEmbedding = await embeddingCache.get(testText, 'text-embedding-3-small');
    console.log(`✅ Embedding cache working: ${cachedEmbedding !== null}`);
    
    // Test search cache
    console.log('\n📊 Testing search cache...');
    const testResults = [
      { id: '1', filename: 'test1.jpg', similarityScore: 0.95 },
      { id: '2', filename: 'test2.jpg', similarityScore: 0.85 },
    ];
    
    await searchCache.set('test-user', 'test query', testResults);
    const cachedResults = await searchCache.get('test-user', 'test query');
    console.log(`✅ Search cache working: ${cachedResults !== null}`);
    
    // Test cache stats
    console.log('\n📊 Cache statistics:');
    const stats = await cache.getStats();
    console.log(stats);
    
    // Performance benchmark
    console.log('\n⏱️ Running performance benchmarks...');
    
    // Benchmark cache operations
    const iterations = 1000;
    const cacheWriteStart = Date.now();
    for (let i = 0; i < iterations; i++) {
      await cache.set(`bench:${i}`, { index: i }, 60);
    }
    const cacheWriteTime = Date.now() - cacheWriteStart;
    console.log(`Cache writes: ${iterations} in ${cacheWriteTime}ms (${(iterations / cacheWriteTime * 1000).toFixed(2)} ops/sec)`);
    
    const cacheReadStart = Date.now();
    for (let i = 0; i < iterations; i++) {
      await cache.get(`bench:${i}`);
    }
    const cacheReadTime = Date.now() - cacheReadStart;
    console.log(`Cache reads: ${iterations} in ${cacheReadTime}ms (${(iterations / cacheReadTime * 1000).toFixed(2)} ops/sec)`);
    
    // Cleanup
    await cache.deletePattern('bench:*');
    await cache.delete(testKey);
    
    console.log('\n🎉 Performance tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Performance test failed:', error);
    process.exit(1);
  }
}

// Run tests
testPerformance();
```

### 7.2 Run Performance Tests
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
node scripts/test-performance.js
```

---

## ✅ Phase 5 Completion Checklist

### Redis Caching Infrastructure
- [ ] **Redis Server**: Installed and configured for production
- [ ] **Cache Manager**: Connection pooling and error handling
- [ ] **Cache Operations**: Get, set, delete with TTL support
- [ ] **Pub/Sub**: Cache invalidation messaging
- [ ] **Monitoring**: Cache hit/miss rates tracked

### Specialized Caches
- [ ] **Embedding Cache**: Text embeddings cached with deduplication
- [ ] **Search Cache**: Query results cached per user
- [ ] **Session Store**: User sessions managed in Redis
- [ ] **Popular Searches**: Tracked for cache warming
- [ ] **Batch Operations**: Efficient bulk cache operations

### Database Optimization
- [ ] **Query Optimizer**: Prepared statements and query plans
- [ ] **Batch Loading**: Efficient multi-record queries
- [ ] **Index Creation**: Optimal indexes for common queries
- [ ] **Query Analysis**: EXPLAIN plan analysis
- [ ] **Connection Pooling**: Database connection optimization

### Image Processing
- [ ] **Image Optimization**: Resize and compress images
- [ ] **Thumbnail Generation**: Automatic thumbnail creation
- [ ] **Responsive Images**: Multiple sizes for different devices
- [ ] **Format Conversion**: WebP and progressive JPEG
- [ ] **Batch Processing**: Concurrent image optimization

### Performance Monitoring
- [ ] **Cache Metrics**: Hit rates, operation times tracked
- [ ] **Query Performance**: Database query timing
- [ ] **Image Processing**: Compression ratios and timing
- [ ] **Benchmarking**: Performance test suite
- [ ] **Bottleneck Detection**: Slow operation identification

### Testing & Verification
```bash
# All these should succeed:
redis-cli ping                      # Redis is running
node scripts/test-performance.js    # Performance tests pass
npm run dev                         # Development server runs
# Check http://localhost:3000/api/health?detailed=true
```

---

## 🚀 Next Steps

**Phase 5 Complete!** ✅

**Ready for Phase 6**: Cost Management Implementation
- Read: `02-phases/phase-06-cost-management.md`
- Prerequisites: Monitoring working, understanding of AWS/OpenAI pricing
- Outcome: Real-time cost tracking and budget management

**Quick Reference**:
- Cache patterns: `04-implementation/caching-patterns.md`
- Performance checklist: `05-checklists/performance-checklist.md`
- Next phase: `02-phases/phase-06-cost-management.md`

Your application now has comprehensive caching and performance optimization for production scale!
