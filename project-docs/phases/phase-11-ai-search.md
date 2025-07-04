# Phase 11: AI & Search Implementation

## 🎯 Phase Overview
This phase integrates OpenAI for generating embeddings and implements vector similarity search using pgvector from Phase 2. We'll leverage the embedding cache from Phase 5, the queue system from Phase 10 for batch processing, and comprehensive cost tracking for all AI operations.

## ✅ Prerequisites
- Phase 2 completed (PostgreSQL with pgvector extension)
- Phase 5 completed (Redis cache for embeddings)
- Phase 7 completed (Cost tracking service)
- Phase 10 completed (Queue system for batch processing)
- OpenAI API key configured
- pgvector extension enabled in PostgreSQL

## 📋 Phase Checklist
- [ ] Install OpenAI SDK and create service at `src/lib/ai/openai-service.ts`
- [ ] Implement embedding service with cache integration
- [ ] Create search service at `src/lib/services/search-service.ts`
- [ ] Build vector similarity search with pgvector
- [ ] Implement search result ranking and filtering
- [ ] Add batch processing for embeddings via queue system
- [ ] Track all OpenAI API costs

---

## Step 1: Install Dependencies and Configure OpenAI

### 1.1 Install OpenAI SDK
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
npm install openai
npm install --save-dev @types/node
```

### 1.2 Update Environment Variables
Add to `.env.local`:
```env
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL_EMBEDDING=text-embedding-3-small
OPENAI_MODEL_CHAT=gpt-4-turbo-preview
```

### 1.3 Create AI Types
Create `src/types/ai.types.ts`:

```typescript
export interface EmbeddingRequest {
  text: string;
  model?: string;
  dimensions?: number;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
  cost: number;
}

export interface SearchQuery {
  query: string;
  userId: string;
  filters?: {
    mediaType?: string[];
    dateRange?: {
      start: Date;
      end: Date;
    };
    tags?: string[];
    minScore?: number;
  };
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  id: string;
  score: number;
  mediaItem: {
    id: string;
    filename: string;
    mimeType: string;
    s3Key: string;
    metadata: any;
    createdAt: Date;
  };
  highlights?: string[];
  explanation?: string;
}

export interface BatchEmbeddingJob {
  items: Array<{
    id: string;
    text: string;
    metadata?: any;
  }>;
  userId: string;
  priority?: 'low' | 'medium' | 'high';
}
```

---

## Step 2: Create OpenAI Service

### 2.1 Create OpenAI Service
Create `src/lib/ai/openai-service.ts`:

```typescript
import OpenAI from 'openai';
import { logger } from '@/lib/logger';
import { CostService } from '@/lib/services/cost-service';
import { getCacheManager } from '@/lib/cache/cache-manager';
import {
  EmbeddingRequest,
  EmbeddingResponse
} from '@/types/ai.types';
import crypto from 'crypto';

export class OpenAIService {
  private client: OpenAI;
  private costService: CostService;
  private cacheManager = getCacheManager();
  
  // Pricing per 1K tokens (as of 2024)
  private readonly PRICING = {
    'text-embedding-3-small': 0.00002,
    'text-embedding-3-large': 0.00013,
    'gpt-4-turbo-preview': {
      input: 0.01,
      output: 0.03
    },
    'gpt-3.5-turbo': {
      input: 0.0005,
      output: 0.0015
    }
  };

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.costService = new CostService();
  }

  async generateEmbedding(
    request: EmbeddingRequest,
    userId: string
  ): Promise<EmbeddingResponse> {
    const model = request.model || process.env.OPENAI_MODEL_EMBEDDING || 'text-embedding-3-small';
    
    try {
      // Generate cache key
      const cacheKey = this.generateCacheKey(request.text, model);
      
      // Check cache first
      const cached = await this.cacheManager.get(cacheKey);
      if (cached) {
        logger.info('Using cached embedding', { cacheKey });
        return {
          embedding: cached.embedding,
          model: cached.model,
          usage: cached.usage,
          cost: 0 // No cost for cached embeddings
        };
      }

      // Generate new embedding
      logger.info('Generating new embedding', { 
        model, 
        textLength: request.text.length 
      });

      const response = await this.client.embeddings.create({
        input: request.text,
        model: model,
        dimensions: request.dimensions
      });

      const embedding = response.data[0].embedding;
      const usage = response.usage;

      // Calculate cost
      const cost = this.calculateEmbeddingCost(model, usage.total_tokens);

      // Track cost
      await this.costService.trackUsage(
        userId,
        'openai',
        'embedding',
        cost,
        {
          model,
          tokens: usage.total_tokens,
          textLength: request.text.length
        }
      );

      const result: EmbeddingResponse = {
        embedding,
        model,
        usage: {
          prompt_tokens: usage.prompt_tokens,
          total_tokens: usage.total_tokens
        },
        cost
      };

      // Cache the result
      await this.cacheManager.set(cacheKey, result, 86400 * 7); // Cache for 7 days

      return result;
    } catch (error) {
      logger.error('Failed to generate embedding', error);
      throw error;
    }
  }

  async generateBatchEmbeddings(
    texts: string[],
    userId: string,
    model?: string
  ): Promise<EmbeddingResponse[]> {
    const actualModel = model || process.env.OPENAI_MODEL_EMBEDDING || 'text-embedding-3-small';
    const results: EmbeddingResponse[] = [];
    const uncachedTexts: Array<{ index: number; text: string }> = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const cacheKey = this.generateCacheKey(texts[i], actualModel);
      const cached = await this.cacheManager.get(cacheKey);
      
      if (cached) {
        results[i] = {
          embedding: cached.embedding,
          model: cached.model,
          usage: cached.usage,
          cost: 0
        };
      } else {
        uncachedTexts.push({ index: i, text: texts[i] });
      }
    }

    // Generate embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      try {
        logger.info(`Generating ${uncachedTexts.length} new embeddings (${texts.length - uncachedTexts.length} cached)`);

        const response = await this.client.embeddings.create({
          input: uncachedTexts.map(item => item.text),
          model: actualModel
        });

        let totalCost = 0;

        for (let i = 0; i < response.data.length; i++) {
          const originalIndex = uncachedTexts[i].index;
          const embedding = response.data[i].embedding;
          const tokensPerItem = Math.ceil(response.usage.total_tokens / response.data.length);
          
          const cost = this.calculateEmbeddingCost(actualModel, tokensPerItem);
          totalCost += cost;

          const result: EmbeddingResponse = {
            embedding,
            model: actualModel,
            usage: {
              prompt_tokens: tokensPerItem,
              total_tokens: tokensPerItem
            },
            cost
          };

          results[originalIndex] = result;

          // Cache each result
          const cacheKey = this.generateCacheKey(uncachedTexts[i].text, actualModel);
          await this.cacheManager.set(cacheKey, result, 86400 * 7);
        }

        // Track total cost
        await this.costService.trackUsage(
          userId,
          'openai',
          'batch_embedding',
          totalCost,
          {
            model: actualModel,
            totalTokens: response.usage.total_tokens,
            batchSize: uncachedTexts.length
          }
        );
      } catch (error) {
        logger.error('Failed to generate batch embeddings', error);
        throw error;
      }
    }

    return results;
  }

  async chat(
    messages: Array<{ role: string; content: string }>,
    userId: string,
    options?: {
      model?: string;
      temperature?: number;
      max_tokens?: number;
    }
  ): Promise<{ content: string; cost: number }> {
    const model = options?.model || process.env.OPENAI_MODEL_CHAT || 'gpt-4-turbo-preview';

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: messages as any,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens
      });

      const content = response.choices[0].message.content || '';
      const usage = response.usage;

      // Calculate cost
      const pricing = this.PRICING[model as keyof typeof this.PRICING];
      let cost = 0;
      
      if (pricing && typeof pricing === 'object' && usage) {
        cost = (usage.prompt_tokens / 1000) * pricing.input +
               (usage.completion_tokens / 1000) * pricing.output;
      }

      // Track cost
      await this.costService.trackUsage(
        userId,
        'openai',
        'chat',
        cost,
        {
          model,
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens
        }
      );

      return { content, cost };
    } catch (error) {
      logger.error('Failed to generate chat completion', error);
      throw error;
    }
  }

  private generateCacheKey(text: string, model: string): string {
    const hash = crypto.createHash('sha256')
      .update(`${model}:${text}`)
      .digest('hex');
    return `embedding:${model}:${hash}`;
  }

  private calculateEmbeddingCost(model: string, tokens: number): number {
    const pricing = this.PRICING[model as keyof typeof this.PRICING];
    if (typeof pricing === 'number') {
      return (tokens / 1000) * pricing;
    }
    return 0;
  }
}

export const openAIService = new OpenAIService();
```

---

## Step 3: Create Embedding Service

### 3.1 Create Embedding Service
Create `src/lib/services/embedding-service.ts`:

```typescript
import { openAIService } from '@/lib/ai/openai-service';
import { queueManager } from '@/lib/queue/queue-manager';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { BatchEmbeddingJob } from '@/types/ai.types';
import crypto from 'crypto';

export class EmbeddingService {
  async generateAndStoreEmbedding(
    mediaItemId: string,
    content: string,
    userId: string,
    metadata?: any
  ): Promise<string> {
    try {
      // Generate embedding
      const response = await openAIService.generateEmbedding(
        { text: content },
        userId
      );

      // Store in database with pgvector
      const embeddingId = crypto.randomUUID();
      
      // Convert array to pgvector format
      const vectorString = `[${response.embedding.join(',')}]`;
      
      await db('embeddings').insert({
        id: embeddingId,
        media_item_id: mediaItemId,
        embedding: vectorString,
        model: response.model,
        metadata: metadata ? JSON.stringify(metadata) : null,
        created_at: new Date()
      });

      logger.info('Embedding stored successfully', {
        embeddingId,
        mediaItemId,
        model: response.model,
        cost: response.cost
      });

      return embeddingId;
    } catch (error) {
      logger.error('Failed to generate and store embedding', error);
      throw error;
    }
  }

  async queueBatchEmbeddings(job: BatchEmbeddingJob): Promise<string[]> {
    const jobIds: string[] = [];

    try {
      // Split into smaller batches for processing
      const batchSize = 10;
      for (let i = 0; i < job.items.length; i += batchSize) {
        const batch = job.items.slice(i, i + batchSize);
        
        // Queue each item separately for better progress tracking
        for (const item of batch) {
          const jobResult = await queueManager.addEmbeddingJob({
            userId: job.userId,
            mediaItemId: item.id,
            s3Key: `batch-${item.id}`,
            costCenter: 'batch-embedding',
            content: item.text,
            contentType: 'text',
            metadata: item.metadata
          });
          
          jobIds.push(jobResult.id);
        }
      }

      logger.info(`Queued ${jobIds.length} embedding jobs`, {
        userId: job.userId,
        totalItems: job.items.length
      });

      return jobIds;
    } catch (error) {
      logger.error('Failed to queue batch embeddings', error);
      throw error;
    }
  }

  async findSimilarEmbeddings(
    embedding: number[],
    limit: number = 10,
    threshold: number = 0.8,
    filters?: {
      userId?: string;
      mediaType?: string[];
      dateRange?: { start: Date; end: Date };
    }
  ): Promise<Array<{ id: string; score: number; mediaItemId: string }>> {
    try {
      // Build query with pgvector
      let query = db('embeddings as e')
        .join('media_items as m', 'e.media_item_id', 'm.id')
        .select(
          'e.id',
          'e.media_item_id',
          db.raw('1 - (e.embedding <=> ?::vector) as score', [
            `[${embedding.join(',')}]`
          ])
        )
        .where(db.raw('1 - (e.embedding <=> ?::vector) >= ?', [
          `[${embedding.join(',')}]`,
          threshold
        ]))
        .orderBy('score', 'desc')
        .limit(limit);

      // Apply filters
      if (filters?.userId) {
        query = query.where('m.user_id', filters.userId);
      }

      if (filters?.mediaType && filters.mediaType.length > 0) {
        query = query.whereIn('m.mime_type', filters.mediaType);
      }

      if (filters?.dateRange) {
        query = query
          .where('m.created_at', '>=', filters.dateRange.start)
          .where('m.created_at', '<=', filters.dateRange.end);
      }

      const results = await query;

      return results.map(row => ({
        id: row.id,
        score: parseFloat(row.score),
        mediaItemId: row.media_item_id
      }));
    } catch (error) {
      logger.error('Failed to find similar embeddings', error);
      throw error;
    }
  }

  async updateEmbedding(
    embeddingId: string,
    content: string,
    userId: string
  ): Promise<void> {
    try {
      // Generate new embedding
      const response = await openAIService.generateEmbedding(
        { text: content },
        userId
      );

      // Update in database
      const vectorString = `[${response.embedding.join(',')}]`;
      
      await db('embeddings')
        .where('id', embeddingId)
        .update({
          embedding: vectorString,
          model: response.model,
          updated_at: new Date()
        });

      logger.info('Embedding updated successfully', {
        embeddingId,
        model: response.model,
        cost: response.cost
      });
    } catch (error) {
      logger.error('Failed to update embedding', error);
      throw error;
    }
  }

  async deleteEmbedding(embeddingId: string): Promise<void> {
    try {
      await db('embeddings')
        .where('id', embeddingId)
        .delete();

      logger.info('Embedding deleted', { embeddingId });
    } catch (error) {
      logger.error('Failed to delete embedding', error);
      throw error;
    }
  }
}

export const embeddingService = new EmbeddingService();
```

---

## Step 4: Create Search Service

### 4.1 Create Search Service
Create `src/lib/services/search-service.ts`:

```typescript
import { openAIService } from '@/lib/ai/openai-service';
import { embeddingService } from './embedding-service';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getCacheManager } from '@/lib/cache/cache-manager';
import {
  SearchQuery,
  SearchResult
} from '@/types/ai.types';
import crypto from 'crypto';

export class SearchService {
  private cacheManager = getCacheManager();

  async search(query: SearchQuery): Promise<{
    results: SearchResult[];
    totalCount: number;
    searchId: string;
  }> {
    const searchId = crypto.randomUUID();
    const startTime = Date.now();

    try {
      // Generate cache key for search results
      const cacheKey = this.generateSearchCacheKey(query);
      
      // Check cache
      const cached = await this.cacheManager.get(cacheKey);
      if (cached) {
        logger.info('Using cached search results', { searchId, cacheKey });
        
        // Still track search in history
        await this.trackSearchHistory(searchId, query, cached.results.length, 0);
        
        return {
          results: cached.results,
          totalCount: cached.totalCount,
          searchId
        };
      }

      // Generate embedding for search query
      const embeddingResponse = await openAIService.generateEmbedding(
        { text: query.query },
        query.userId
      );

      // Find similar embeddings
      const similarEmbeddings = await embeddingService.findSimilarEmbeddings(
        embeddingResponse.embedding,
        query.limit || 20,
        query.filters?.minScore || 0.7,
        {
          userId: query.userId,
          mediaType: query.filters?.mediaType,
          dateRange: query.filters?.dateRange
        }
      );

      // Fetch media items
      const mediaItemIds = similarEmbeddings.map(e => e.mediaItemId);
      const mediaItems = await db('media_items')
        .whereIn('id', mediaItemIds)
        .select('*');

      // Create a map for quick lookup
      const mediaItemMap = new Map(
        mediaItems.map(item => [item.id, item])
      );

      // Build search results
      const results: SearchResult[] = similarEmbeddings
        .map(embedding => {
          const mediaItem = mediaItemMap.get(embedding.mediaItemId);
          if (!mediaItem) return null;

          return {
            id: embedding.id,
            score: embedding.score,
            mediaItem: {
              id: mediaItem.id,
              filename: mediaItem.filename,
              mimeType: mediaItem.mime_type,
              s3Key: mediaItem.s3_key,
              metadata: mediaItem.metadata ? JSON.parse(mediaItem.metadata) : {},
              createdAt: mediaItem.created_at
            }
          };
        })
        .filter(Boolean) as SearchResult[];

      // Add explanations for top results
      if (results.length > 0 && results.length <= 5) {
        await this.addSearchExplanations(results, query.query, query.userId);
      }

      // Get total count (without pagination)
      const totalCount = await this.getSearchResultCount(
        embeddingResponse.embedding,
        query.filters
      );

      // Cache results
      await this.cacheManager.set(
        cacheKey,
        { results, totalCount },
        300 // Cache for 5 minutes
      );

      // Track search history
      const searchTime = Date.now() - startTime;
      await this.trackSearchHistory(
        searchId,
        query,
        results.length,
        embeddingResponse.cost,
        searchTime
      );

      logger.info('Search completed', {
        searchId,
        query: query.query,
        resultsCount: results.length,
        searchTime,
        cost: embeddingResponse.cost
      });

      return {
        results,
        totalCount,
        searchId
      };
    } catch (error) {
      logger.error('Search failed', { searchId, error });
      throw error;
    }
  }

  async getSearchResultCount(
    embedding: number[],
    filters?: SearchQuery['filters']
  ): Promise<number> {
    try {
      let query = db('embeddings as e')
        .join('media_items as m', 'e.media_item_id', 'm.id')
        .count('* as count')
        .where(db.raw('1 - (e.embedding <=> ?::vector) >= ?', [
          `[${embedding.join(',')}]`,
          filters?.minScore || 0.7
        ]));

      if (filters?.mediaType && filters.mediaType.length > 0) {
        query = query.whereIn('m.mime_type', filters.mediaType);
      }

      if (filters?.dateRange) {
        query = query
          .where('m.created_at', '>=', filters.dateRange.start)
          .where('m.created_at', '<=', filters.dateRange.end);
      }

      const result = await query.first();
      return parseInt(result?.count || '0');
    } catch (error) {
      logger.error('Failed to get search result count', error);
      return 0;
    }
  }

  async addSearchExplanations(
    results: SearchResult[],
    query: string,
    userId: string
  ): Promise<void> {
    try {
      // Generate explanations for why each result matches
      const explanationPromises = results.slice(0, 3).map(async (result) => {
        const prompt = `Explain in 1-2 sentences why this item matches the search query.
Query: "${query}"
Item: ${result.mediaItem.filename}
Metadata: ${JSON.stringify(result.mediaItem.metadata)}`;

        const response = await openAIService.chat(
          [{ role: 'user', content: prompt }],
          userId,
          {
            model: 'gpt-3.5-turbo',
            temperature: 0.3,
            max_tokens: 100
          }
        );

        result.explanation = response.content;
      });

      await Promise.all(explanationPromises);
    } catch (error) {
      logger.error('Failed to add search explanations', error);
      // Don't throw - explanations are optional
    }
  }

  async trackSearchHistory(
    searchId: string,
    query: SearchQuery,
    resultsCount: number,
    cost: number,
    searchTimeMs?: number
  ): Promise<void> {
    try {
      await db('search_history').insert({
        id: searchId,
        user_id: query.userId,
        query: query.query,
        filters: query.filters ? JSON.stringify(query.filters) : null,
        results_count: resultsCount,
        search_time_ms: searchTimeMs || 0,
        cost,
        created_at: new Date()
      });
    } catch (error) {
      logger.error('Failed to track search history', error);
    }
  }

  async getSearchHistory(
    userId: string,
    limit: number = 10
  ): Promise<Array<{
    id: string;
    query: string;
    resultsCount: number;
    createdAt: Date;
  }>> {
    try {
      const history = await db('search_history')
        .where('user_id', userId)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .select('id', 'query', 'results_count', 'created_at');

      return history.map(row => ({
        id: row.id,
        query: row.query,
        resultsCount: row.results_count,
        createdAt: row.created_at
      }));
    } catch (error) {
      logger.error('Failed to get search history', error);
      return [];
    }
  }

  async getSearchAnalytics(userId: string, days: number = 30): Promise<{
    totalSearches: number;
    totalCost: number;
    averageResultsCount: number;
    averageSearchTime: number;
    topQueries: Array<{ query: string; count: number }>;
  }> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get aggregate stats
      const stats = await db('search_history')
        .where('user_id', userId)
        .where('created_at', '>=', startDate)
        .select(
          db.raw('COUNT(*) as total_searches'),
          db.raw('SUM(cost) as total_cost'),
          db.raw('AVG(results_count) as avg_results'),
          db.raw('AVG(search_time_ms) as avg_search_time')
        )
        .first();

      // Get top queries
      const topQueries = await db('search_history')
        .where('user_id', userId)
        .where('created_at', '>=', startDate)
        .groupBy('query')
        .orderBy('count', 'desc')
        .limit(10)
        .select('query', db.raw('COUNT(*) as count'));

      return {
        totalSearches: parseInt(stats?.total_searches || '0'),
        totalCost: parseFloat(stats?.total_cost || '0'),
        averageResultsCount: parseFloat(stats?.avg_results || '0'),
        averageSearchTime: parseFloat(stats?.avg_search_time || '0'),
        topQueries: topQueries.map(q => ({
          query: q.query,
          count: parseInt(q.count)
        }))
      };
    } catch (error) {
      logger.error('Failed to get search analytics', error);
      throw error;
    }
  }

  private generateSearchCacheKey(query: SearchQuery): string {
    const normalized = {
      query: query.query.toLowerCase().trim(),
      filters: query.filters,
      limit: query.limit,
      offset: query.offset
    };
    
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
    
    return `search:${query.userId}:${hash}`;
  }
}

export const searchService = new SearchService();
```

---

## Step 5: Update Embedding Worker with OpenAI

### 5.1 Update Embedding Generation Worker
Update `src/workers/embedding-generation-worker.ts`:

```typescript
import { Job } from 'bullmq';
import { BaseWorker } from './base-worker';
import { EmbeddingGenerationJobData, JobStatus } from '@/types/queue.types';
import { openAIService } from '@/lib/ai/openai-service';
import { getCacheManager } from '@/lib/cache/cache-manager';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import crypto from 'crypto';

export class EmbeddingGenerationWorker extends BaseWorker<EmbeddingGenerationJobData> {
  private cacheManager = getCacheManager();

  constructor(connection: any) {
    super('embedding-generation', connection, 10); // Process 10 embeddings concurrently
  }

  protected async process(job: Job<EmbeddingGenerationJobData>) {
    const { userId, mediaItemId, content, contentType, metadata } = job.data;

    try {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.PROCESSING);

      await this.updateProgress(job, {
        current: 0,
        total: 2,
        message: 'Generating embedding',
        subTasks: {}
      });

      // Generate embedding using OpenAI
      const embeddingResponse = await openAIService.generateEmbedding(
        { text: content },
        userId
      );

      await this.updateProgress(job, {
        current: 1,
        total: 2,
        message: 'Storing embedding',
        subTasks: {
          storeEmbedding: { status: 'processing' }
        }
      });

      // Store in database with pgvector format
      const vectorString = `[${embeddingResponse.embedding.join(',')}]`;
      
      await db('embeddings').insert({
        id: crypto.randomUUID(),
        media_item_id: mediaItemId,
        embedding: vectorString,
        model: embeddingResponse.model,
        metadata: metadata ? JSON.stringify(metadata) : null,
        created_at: new Date()
      });

      await this.updateMediaItemStatus(mediaItemId, JobStatus.COMPLETED, {
        embeddingModel: embeddingResponse.model,
        embeddingCost: embeddingResponse.cost,
        processedAt: new Date().toISOString()
      });

      await this.updateProgress(job, {
        current: 2,
        total: 2,
        message: 'Embedding generation complete',
        subTasks: {}
      });

      logger.info(`Embedding generated for ${mediaItemId}`, {
        mediaItemId,
        contentType,
        model: embeddingResponse.model,
        cost: embeddingResponse.cost,
        tokensUsed: embeddingResponse.usage.total_tokens
      });

      return {
        model: embeddingResponse.model,
        cost: embeddingResponse.cost,
        tokensUsed: embeddingResponse.usage.total_tokens
      };
    } catch (error) {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.FAILED, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}
```

---

## Step 6: Create Search API Endpoints

### 6.1 Create Search Endpoint
Create `src/app/api/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { searchService } from '@/lib/services/search-service';
import { requireAuth } from '@/lib/middleware/auth';
import { validateRequest } from '@/lib/middleware/validation';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  filters: z.object({
    mediaType: z.array(z.string()).optional(),
    dateRange: z.object({
      start: z.string().transform(s => new Date(s)),
      end: z.string().transform(s => new Date(s))
    }).optional(),
    tags: z.array(z.string()).optional(),
    minScore: z.number().min(0).max(1).optional()
  }).optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0)
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await request.json();
    const validation = await validateRequest(searchSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error },
        { status: 400 }
      );
    }

    const searchResults = await searchService.search({
      ...validation.data,
      userId: auth.user.uid
    });

    return NextResponse.json(searchResults);
  } catch (error) {
    logger.error('Search request failed', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    // Get search history
    const history = await searchService.getSearchHistory(auth.user.uid, 20);

    return NextResponse.json({ history });
  } catch (error) {
    logger.error('Failed to get search history', error);
    return NextResponse.json(
      { error: 'Failed to get search history' },
      { status: 500 }
    );
  }
}
```

### 6.2 Create Search Analytics Endpoint
Create `src/app/api/search/analytics/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { searchService } from '@/lib/services/search-service';
import { requireAuth } from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '30');

    const analytics = await searchService.getSearchAnalytics(
      auth.user.uid,
      days
    );

    return NextResponse.json(analytics);
  } catch (error) {
    logger.error('Failed to get search analytics', error);
    return NextResponse.json(
      { error: 'Failed to get analytics' },
      { status: 500 }
    );
  }
}
```

### 6.3 Create Batch Embedding Endpoint
Create `src/app/api/embeddings/batch/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { embeddingService } from '@/lib/services/embedding-service';
import { requireAuth } from '@/lib/middleware/auth';
import { validateRequest } from '@/lib/middleware/validation';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const batchEmbeddingSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    text: z.string().max(8000),
    metadata: z.any().optional()
  })).min(1).max(100),
  priority: z.enum(['low', 'medium', 'high']).default('medium')
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await request.json();
    const validation = await validateRequest(batchEmbeddingSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error },
        { status: 400 }
      );
    }

    const jobIds = await embeddingService.queueBatchEmbeddings({
      items: validation.data.items,
      userId: auth.user.uid,
      priority: validation.data.priority
    });

    return NextResponse.json({
      jobIds,
      message: `Queued ${jobIds.length} embedding jobs`
    });
  } catch (error) {
    logger.error('Failed to queue batch embeddings', error);
    return NextResponse.json(
      { error: 'Failed to queue embeddings' },
      { status: 500 }
    );
  }
}
```

---

## Integration Points

### Using Cache from Phase 5
```typescript
import { getCacheManager } from '@/lib/cache/cache-manager';

// Cache embeddings to avoid duplicate API calls
const cacheManager = getCacheManager();
await cacheManager.set(cacheKey, embedding, 86400 * 7); // Cache for 7 days
```

### Using Queue System from Phase 10
```typescript
import { queueManager } from '@/lib/queue/queue-manager';

// Queue embedding generation jobs
await queueManager.addEmbeddingJob(jobData);
```

### Using Cost Tracking from Phase 7
```typescript
import { CostService } from '@/lib/services/cost-service';

// Track all OpenAI API costs
await costService.trackUsage(userId, 'openai', operation, cost, metadata);
```

### Using pgvector from Phase 2
```typescript
// Store embeddings in pgvector format
const vectorString = `[${embedding.join(',')}]`;

// Search using cosine similarity
db.raw('1 - (embedding <=> ?::vector) as score', [vectorString])
```

---

## Testing

### Test AI Search System
Create `scripts/test-ai-search.js`:

```javascript
const { openAIService } = require('../dist/lib/ai/openai-service');
const { searchService } = require('../dist/lib/services/search-service');
const { embeddingService } = require('../dist/lib/services/embedding-service');

async function testAISearch() {
  const testUserId = 'test-user-123';
  
  try {
    console.log('Testing OpenAI service...');
    
    // Test embedding generation
    const embeddingResponse = await openAIService.generateEmbedding(
      { text: 'A beautiful sunset over the ocean' },
      testUserId
    );
    console.log('Embedding generated:', {
      model: embeddingResponse.model,
      dimensions: embeddingResponse.embedding.length,
      cost: embeddingResponse.cost
    });
    
    // Test batch embeddings
    console.log('\nTesting batch embeddings...');
    const batchResponse = await openAIService.generateBatchEmbeddings(
      [
        'Mountain landscape with snow',
        'City skyline at night',
        'Forest path in autumn'
      ],
      testUserId
    );
    console.log('Batch embeddings generated:', batchResponse.length);
    
    // Test search
    console.log('\nTesting search...');
    const searchResults = await searchService.search({
      query: 'sunset photos',
      userId: testUserId,
      filters: {
        minScore: 0.7
      },
      limit: 10
    });
    console.log('Search results:', {
      count: searchResults.results.length,
      totalCount: searchResults.totalCount,
      searchId: searchResults.searchId
    });
    
    // Test search analytics
    console.log('\nTesting search analytics...');
    const analytics = await searchService.getSearchAnalytics(testUserId, 30);
    console.log('Search analytics:', analytics);
    
    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  }
  
  process.exit(0);
}

// Make sure to set OPENAI_API_KEY environment variable
if (!process.env.OPENAI_API_KEY) {
  console.error('Please set OPENAI_API_KEY environment variable');
  process.exit(1);
}

testAISearch();
```

Run the test:
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
npm run build
OPENAI_API_KEY=your-key-here node scripts/test-ai-search.js
```

---

## ✅ Phase 11 Completion Checklist

### Core Implementation
- [ ] **OpenAI Service**: Implemented at `src/lib/ai/openai-service.ts`
- [ ] **Embedding Service**: Caching, batch processing, pgvector storage
- [ ] **Search Service**: Vector similarity search with filtering and ranking
- [ ] **Integration**: Connected to queue system, cost tracking, and caching
- [ ] **API Endpoints**: Search, analytics, and batch embedding endpoints

### Testing & Verification
```bash
# All these should succeed:
npm run build
node scripts/test-ai-search.js
curl -X POST http://localhost:3000/api/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "sunset photos"}'
```

### Database Updates
- [ ] Embeddings stored in pgvector format
- [ ] Search history tracked with costs
- [ ] Media items linked to embeddings

---

## 🚀 Next Steps

**Phase 11 Complete!** ✅

**AI Media Search Application Ready!**

The application now has:
- Secure authentication and user management
- Media upload and processing with AWS services
- Real-time cost tracking and budget management
- Subscription tiers with Stripe integration
- Asynchronous job processing with queues
- AI-powered search using OpenAI embeddings
- Vector similarity search with pgvector
- Comprehensive caching and performance optimization

Next considerations:
- Add frontend UI components
- Implement real-time notifications
- Add more AI features (auto-tagging, content moderation)
- Scale with Kubernetes or serverless
- Add monitoring and alerting