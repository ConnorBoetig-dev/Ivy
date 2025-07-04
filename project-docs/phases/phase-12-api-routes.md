# Phase 12: API Routes Development

## 🎯 Phase Overview
This phase implements all REST API endpoints for the AI Media Search application, integrating with all previous phases. We'll create comprehensive APIs for upload management, media operations, search functionality, user billing, and analytics - all with proper authentication, validation, and error handling.

## ✅ Prerequisites
- Phase 6 completed (Firebase authentication middleware at `src/lib/middleware/auth.ts`)
- Phase 7 completed (Cost tracking service at `src/lib/services/cost-service.ts`)
- Phase 8 completed (Stripe integration and webhooks)
- Phase 9 completed (AWS services for S3, Rekognition, etc.)
- Phase 10 completed (Queue system for job processing)
- Phase 11 completed (AI search functionality)
- All services running (Redis, PostgreSQL, Firebase)

## 📋 Phase Checklist
- [ ] Create upload API endpoints with S3 presigned URLs
- [ ] Implement media management CRUD operations
- [ ] Extend search API with suggestions and related items
- [ ] Build user profile and usage tracking endpoints
- [ ] Create analytics API for dashboard data
- [ ] Add proper validation, rate limiting, and error handling
- [ ] Write integration tests for all endpoints

---

## Step 1: Upload API Implementation

### 1.1 Create Presigned URL Endpoint
Create `src/app/api/upload/presigned/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { s3Service } from '@/lib/aws/s3-service';
import { requireAuth } from '@/lib/middleware/auth';
import { validateRequest } from '@/lib/middleware/validation';
import { rateLimit } from '@/lib/middleware/rate-limit';
import { db } from '@/lib/db';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import crypto from 'crypto';

const presignedUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().regex(/^(image|video|audio|text|application)\/.+/),
  size: z.number().min(1).max(5 * 1024 * 1024 * 1024), // 5GB max
  metadata: z.record(z.string()).optional()
});

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitResult = await rateLimit(request, {
      interval: 60 * 1000, // 1 minute
      uniqueTokenPerInterval: 500,
      limit: 10 // 10 uploads per minute
    });

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    // Authenticate user
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    // Validate request
    const body = await request.json();
    const validation = await validateRequest(presignedUrlSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error },
        { status: 400 }
      );
    }

    const { filename, mimeType, size, metadata } = validation.data;
    const userId = auth.user.uid;

    // Check user's storage quota
    const userStats = await db('media_items')
      .where('user_id', userId)
      .sum('size as total_size')
      .first();

    const subscription = await db('user_subscriptions')
      .where('user_id', userId)
      .where('status', 'active')
      .first();

    const storageLimit = subscription?.storage_limit || 1024 * 1024 * 1024; // 1GB default
    const currentUsage = parseInt(userStats?.total_size || '0');

    if (currentUsage + size > storageLimit) {
      return NextResponse.json(
        { error: 'Storage quota exceeded', currentUsage, limit: storageLimit },
        { status: 403 }
      );
    }

    // Generate unique S3 key
    const fileExtension = filename.split('.').pop() || '';
    const s3Key = `users/${userId}/media/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${fileExtension}`;

    // Create media item record
    const mediaItemId = crypto.randomUUID();
    await db('media_items').insert({
      id: mediaItemId,
      user_id: userId,
      filename,
      mime_type: mimeType,
      size,
      s3_key: s3Key,
      processing_status: 'pending',
      metadata: metadata ? JSON.stringify(metadata) : null,
      created_at: new Date()
    });

    // Generate presigned URL
    const presignedUrl = await s3Service.getPresignedUploadUrl(s3Key, mimeType, {
      'x-amz-meta-user-id': userId,
      'x-amz-meta-media-item-id': mediaItemId
    });

    logger.info('Presigned URL generated', {
      userId,
      mediaItemId,
      filename,
      size,
      s3Key
    });

    return NextResponse.json({
      uploadUrl: presignedUrl,
      mediaItemId,
      s3Key,
      expiresIn: 3600 // 1 hour
    });
  } catch (error) {
    logger.error('Failed to generate presigned URL', error);
    return NextResponse.json(
      { error: 'Failed to generate upload URL' },
      { status: 500 }
    );
  }
}
```

### 1.2 Create Upload Complete Endpoint
Create `src/app/api/upload/complete/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { validateRequest } from '@/lib/middleware/validation';
import { queueManager } from '@/lib/queue/queue-manager';
import { db } from '@/lib/db';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const uploadCompleteSchema = z.object({
  mediaItemId: z.string().uuid(),
  operations: z.object({
    generateEmbedding: z.boolean().default(true),
    detectLabels: z.boolean().optional(),
    detectText: z.boolean().optional(),
    detectFaces: z.boolean().optional(),
    transcribe: z.boolean().optional(),
    analyzeSentiment: z.boolean().optional()
  }).optional()
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await request.json();
    const validation = await validateRequest(uploadCompleteSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error },
        { status: 400 }
      );
    }

    const { mediaItemId, operations = {} } = validation.data;
    const userId = auth.user.uid;

    // Verify media item belongs to user
    const mediaItem = await db('media_items')
      .where('id', mediaItemId)
      .where('user_id', userId)
      .first();

    if (!mediaItem) {
      return NextResponse.json(
        { error: 'Media item not found' },
        { status: 404 }
      );
    }

    // Update status to uploaded
    await db('media_items')
      .where('id', mediaItemId)
      .update({
        processing_status: 'uploaded',
        updated_at: new Date()
      });

    const queuedJobs = [];

    // Queue appropriate processing jobs based on mime type
    const mimeType = mediaItem.mime_type;
    
    if (mimeType.startsWith('image/')) {
      const imageJob = await queueManager.addImageProcessingJob({
        userId,
        mediaItemId,
        s3Key: mediaItem.s3_key,
        costCenter: 'user-upload',
        operations: {
          detectLabels: operations.detectLabels ?? true,
          detectText: operations.detectText ?? true,
          detectFaces: operations.detectFaces ?? false,
          detectModerationLabels: true
        }
      });
      queuedJobs.push({ type: 'image-processing', jobId: imageJob.id });
    } else if (mimeType.startsWith('video/')) {
      const videoJob = await queueManager.addVideoProcessingJob({
        userId,
        mediaItemId,
        s3Key: mediaItem.s3_key,
        costCenter: 'user-upload',
        operations: {
          transcribe: operations.transcribe ?? true,
          detectLabels: operations.detectLabels ?? true,
          generateThumbnails: true
        }
      });
      queuedJobs.push({ type: 'video-processing', jobId: videoJob.id });
    } else if (mimeType.startsWith('text/') || mimeType === 'application/pdf') {
      // For text files, we'd extract text first (simplified here)
      const textJob = await queueManager.addTextAnalysisJob({
        userId,
        mediaItemId,
        s3Key: mediaItem.s3_key,
        costCenter: 'user-upload',
        text: 'Extracted text would go here', // In production, extract from S3
        operations: {
          detectSentiment: operations.analyzeSentiment ?? true,
          detectEntities: true,
          detectKeyPhrases: true,
          detectLanguage: true
        }
      });
      queuedJobs.push({ type: 'text-analysis', jobId: textJob.id });
    }

    // Always queue embedding generation
    if (operations.generateEmbedding !== false) {
      const embeddingJob = await queueManager.addEmbeddingJob({
        userId,
        mediaItemId,
        s3Key: mediaItem.s3_key,
        costCenter: 'user-upload',
        content: `${mediaItem.filename} ${JSON.stringify(mediaItem.metadata || {})}`,
        contentType: mimeType.startsWith('image/') ? 'image' : 
                     mimeType.startsWith('video/') ? 'video' : 'text'
      });
      queuedJobs.push({ type: 'embedding-generation', jobId: embeddingJob.id });
    }

    logger.info('Upload processing queued', {
      userId,
      mediaItemId,
      queuedJobs
    });

    return NextResponse.json({
      mediaItemId,
      status: 'processing',
      queuedJobs
    });
  } catch (error) {
    logger.error('Failed to complete upload', error);
    return NextResponse.json(
      { error: 'Failed to process upload' },
      { status: 500 }
    );
  }
}
```

### 1.3 Create Upload Status Endpoint
Create `src/app/api/upload/status/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { db } from '@/lib/db';
import { queueManager } from '@/lib/queue/queue-manager';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const mediaItemId = params.id;
    const userId = auth.user.uid;

    // Get media item
    const mediaItem = await db('media_items')
      .where('id', mediaItemId)
      .where('user_id', userId)
      .first();

    if (!mediaItem) {
      return NextResponse.json(
        { error: 'Media item not found' },
        { status: 404 }
      );
    }

    // Get associated jobs from metadata
    const metadata = mediaItem.metadata ? JSON.parse(mediaItem.metadata) : {};
    const jobStatuses = [];

    if (metadata.queuedJobs) {
      for (const job of metadata.queuedJobs) {
        try {
          const jobStatus = await queueManager.getJob(job.type, job.jobId);
          if (jobStatus) {
            jobStatuses.push({
              type: job.type,
              jobId: job.jobId,
              state: await jobStatus.getState(),
              progress: jobStatus.progress,
              finishedOn: jobStatus.finishedOn,
              failedReason: jobStatus.failedReason
            });
          }
        } catch (error) {
          logger.warn('Failed to get job status', { jobId: job.jobId, error });
        }
      }
    }

    return NextResponse.json({
      mediaItem: {
        id: mediaItem.id,
        filename: mediaItem.filename,
        status: mediaItem.processing_status,
        size: mediaItem.size,
        createdAt: mediaItem.created_at,
        metadata: metadata
      },
      jobs: jobStatuses
    });
  } catch (error) {
    logger.error('Failed to get upload status', error);
    return NextResponse.json(
      { error: 'Failed to get status' },
      { status: 500 }
    );
  }
}
```

---

## Step 2: Media Management API

### 2.1 Create Media List and Create Endpoints
Create `src/app/api/media/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { db } from '@/lib/db';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const listMediaSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort: z.enum(['created_at', 'updated_at', 'filename', 'size']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  filter: z.object({
    status: z.enum(['pending', 'uploaded', 'processing', 'completed', 'failed']).optional(),
    mimeType: z.string().optional(),
    search: z.string().optional()
  }).optional()
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const validation = listMediaSchema.safeParse(searchParams);
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: validation.error },
        { status: 400 }
      );
    }

    const { page, limit, sort, order, filter } = validation.data;
    const userId = auth.user.uid;
    const offset = (page - 1) * limit;

    // Build query
    let query = db('media_items')
      .where('user_id', userId)
      .orderBy(sort, order);

    let countQuery = db('media_items')
      .where('user_id', userId);

    // Apply filters
    if (filter?.status) {
      query = query.where('processing_status', filter.status);
      countQuery = countQuery.where('processing_status', filter.status);
    }

    if (filter?.mimeType) {
      query = query.where('mime_type', 'like', `${filter.mimeType}%`);
      countQuery = countQuery.where('mime_type', 'like', `${filter.mimeType}%`);
    }

    if (filter?.search) {
      const searchTerm = `%${filter.search}%`;
      query = query.where(function() {
        this.where('filename', 'ilike', searchTerm)
            .orWhereRaw('metadata::text ilike ?', searchTerm);
      });
      countQuery = countQuery.where(function() {
        this.where('filename', 'ilike', searchTerm)
            .orWhereRaw('metadata::text ilike ?', searchTerm);
      });
    }

    // Execute queries
    const [items, countResult] = await Promise.all([
      query.limit(limit).offset(offset),
      countQuery.count('* as total').first()
    ]);

    const total = parseInt(countResult?.total || '0');
    const totalPages = Math.ceil(total / limit);

    // Get embeddings for items
    const itemIds = items.map(item => item.id);
    const embeddings = await db('embeddings')
      .whereIn('media_item_id', itemIds)
      .select('media_item_id', 'id as embedding_id', 'created_at as embedding_created_at');

    const embeddingMap = new Map(
      embeddings.map(e => [e.media_item_id, e])
    );

    // Format response
    const formattedItems = items.map(item => ({
      id: item.id,
      filename: item.filename,
      mimeType: item.mime_type,
      size: item.size,
      s3Key: item.s3_key,
      status: item.processing_status,
      metadata: item.metadata ? JSON.parse(item.metadata) : {},
      embedding: embeddingMap.get(item.id) || null,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }));

    return NextResponse.json({
      items: formattedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    logger.error('Failed to list media items', error);
    return NextResponse.json(
      { error: 'Failed to list media' },
      { status: 500 }
    );
  }
}
```

### 2.2 Create Media Detail and Update Endpoints
Create `src/app/api/media/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { validateRequest } from '@/lib/middleware/validation';
import { s3Service } from '@/lib/aws/s3-service';
import { embeddingService } from '@/lib/services/embedding-service';
import { db } from '@/lib/db';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const updateMediaSchema = z.object({
  filename: z.string().min(1).max(255).optional(),
  metadata: z.record(z.any()).optional(),
  tags: z.array(z.string()).optional()
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const mediaItemId = params.id;
    const userId = auth.user.uid;

    // Get media item with embeddings
    const mediaItem = await db('media_items as m')
      .leftJoin('embeddings as e', 'm.id', 'e.media_item_id')
      .where('m.id', mediaItemId)
      .where('m.user_id', userId)
      .select(
        'm.*',
        'e.id as embedding_id',
        'e.model as embedding_model',
        'e.created_at as embedding_created_at'
      )
      .first();

    if (!mediaItem) {
      return NextResponse.json(
        { error: 'Media item not found' },
        { status: 404 }
      );
    }

    // Get presigned URL for viewing
    const viewUrl = await s3Service.getSignedUrl(mediaItem.s3_key, 3600); // 1 hour

    // Get processing costs
    const costs = await db('costs')
      .where('user_id', userId)
      .whereRaw(`metadata->>'mediaItemId' = ?`, [mediaItemId])
      .select('service', 'operation', 'cost', 'created_at');

    const totalCost = costs.reduce((sum, cost) => sum + parseFloat(cost.cost), 0);

    return NextResponse.json({
      id: mediaItem.id,
      filename: mediaItem.filename,
      mimeType: mediaItem.mime_type,
      size: mediaItem.size,
      s3Key: mediaItem.s3_key,
      status: mediaItem.processing_status,
      metadata: mediaItem.metadata ? JSON.parse(mediaItem.metadata) : {},
      embedding: mediaItem.embedding_id ? {
        id: mediaItem.embedding_id,
        model: mediaItem.embedding_model,
        createdAt: mediaItem.embedding_created_at
      } : null,
      viewUrl,
      costs: {
        total: totalCost,
        breakdown: costs
      },
      createdAt: mediaItem.created_at,
      updatedAt: mediaItem.updated_at
    });
  } catch (error) {
    logger.error('Failed to get media item', error);
    return NextResponse.json(
      { error: 'Failed to get media item' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const mediaItemId = params.id;
    const userId = auth.user.uid;

    const body = await request.json();
    const validation = await validateRequest(updateMediaSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error },
        { status: 400 }
      );
    }

    // Verify ownership
    const mediaItem = await db('media_items')
      .where('id', mediaItemId)
      .where('user_id', userId)
      .first();

    if (!mediaItem) {
      return NextResponse.json(
        { error: 'Media item not found' },
        { status: 404 }
      );
    }

    const updates: any = {
      updated_at: new Date()
    };

    if (validation.data.filename) {
      updates.filename = validation.data.filename;
    }

    if (validation.data.metadata || validation.data.tags) {
      const currentMetadata = mediaItem.metadata ? JSON.parse(mediaItem.metadata) : {};
      const newMetadata = {
        ...currentMetadata,
        ...validation.data.metadata,
        tags: validation.data.tags || currentMetadata.tags
      };
      updates.metadata = JSON.stringify(newMetadata);
    }

    await db('media_items')
      .where('id', mediaItemId)
      .update(updates);

    logger.info('Media item updated', { mediaItemId, userId, updates });

    return NextResponse.json({
      message: 'Media item updated successfully',
      mediaItemId
    });
  } catch (error) {
    logger.error('Failed to update media item', error);
    return NextResponse.json(
      { error: 'Failed to update media item' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const mediaItemId = params.id;
    const userId = auth.user.uid;

    // Get media item
    const mediaItem = await db('media_items')
      .where('id', mediaItemId)
      .where('user_id', userId)
      .first();

    if (!mediaItem) {
      return NextResponse.json(
        { error: 'Media item not found' },
        { status: 404 }
      );
    }

    // Start transaction
    await db.transaction(async (trx) => {
      // Delete embeddings
      await trx('embeddings')
        .where('media_item_id', mediaItemId)
        .delete();

      // Delete search history references
      await trx('search_history')
        .where('user_id', userId)
        .whereRaw(`results @> ?`, JSON.stringify([mediaItemId]))
        .delete();

      // Delete media item
      await trx('media_items')
        .where('id', mediaItemId)
        .delete();

      // Delete from S3
      await s3Service.deleteFile(mediaItem.s3_key);
    });

    logger.info('Media item deleted', { mediaItemId, userId });

    return NextResponse.json({
      message: 'Media item deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete media item', error);
    return NextResponse.json(
      { error: 'Failed to delete media item' },
      { status: 500 }
    );
  }
}
```

### 2.3 Create Related Media Endpoint
Create `src/app/api/media/related/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { embeddingService } from '@/lib/services/embedding-service';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const mediaItemId = params.id;
    const userId = auth.user.uid;
    
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);

    // Get the media item's embedding
    const embedding = await db('embeddings')
      .join('media_items', 'embeddings.media_item_id', 'media_items.id')
      .where('media_items.id', mediaItemId)
      .where('media_items.user_id', userId)
      .select('embeddings.*')
      .first();

    if (!embedding) {
      return NextResponse.json(
        { error: 'No embedding found for this media item' },
        { status: 404 }
      );
    }

    // Parse embedding from pgvector format
    const embeddingArray = JSON.parse(embedding.embedding.replace('[', '[').replace(']', ']'));

    // Find similar items
    const similarItems = await embeddingService.findSimilarEmbeddings(
      embeddingArray,
      limit + 1, // Get one extra to exclude self
      0.7,
      { userId }
    );

    // Filter out the source item
    const filteredItems = similarItems.filter(item => item.mediaItemId !== mediaItemId);

    // Get media item details
    const mediaItemIds = filteredItems.map(item => item.mediaItemId);
    const mediaItems = await db('media_items')
      .whereIn('id', mediaItemIds)
      .select('*');

    const mediaItemMap = new Map(
      mediaItems.map(item => [item.id, item])
    );

    // Format results
    const results = filteredItems.map(item => {
      const mediaItem = mediaItemMap.get(item.mediaItemId);
      if (!mediaItem) return null;

      return {
        id: mediaItem.id,
        filename: mediaItem.filename,
        mimeType: mediaItem.mime_type,
        size: mediaItem.size,
        similarity: item.score,
        metadata: mediaItem.metadata ? JSON.parse(mediaItem.metadata) : {},
        createdAt: mediaItem.created_at
      };
    }).filter(Boolean);

    return NextResponse.json({
      sourceId: mediaItemId,
      relatedItems: results
    });
  } catch (error) {
    logger.error('Failed to get related media', error);
    return NextResponse.json(
      { error: 'Failed to get related media' },
      { status: 500 }
    );
  }
}
```

---

## Step 3: Extended Search API

### 3.1 Create Search Suggestions Endpoint
Create `src/app/api/search/suggestions/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const suggestionsSchema = z.object({
  query: z.string().min(2).max(100)
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const validation = suggestionsSchema.safeParse(searchParams);
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid query parameter' },
        { status: 400 }
      );
    }

    const { query } = validation.data;
    const userId = auth.user.uid;

    // Get recent searches that match the query
    const recentSearches = await db('search_history')
      .where('user_id', userId)
      .where('query', 'ilike', `${query}%`)
      .orderBy('created_at', 'desc')
      .limit(5)
      .distinct('query')
      .select('query', 'results_count');

    // Get popular tags/keywords from media metadata
    const mediaKeywords = await db('media_items')
      .where('user_id', userId)
      .whereRaw('metadata::text ilike ?', [`%${query}%`])
      .select(db.raw(`
        jsonb_array_elements_text(
          CASE 
            WHEN metadata->'tags' IS NOT NULL 
            THEN metadata->'tags' 
            ELSE '[]'::jsonb 
          END
        ) as tag
      `))
      .groupBy('tag')
      .orderBy(db.raw('count(*) desc'))
      .limit(5);

    // Combine and deduplicate suggestions
    const suggestions = new Set<string>();
    
    recentSearches.forEach(search => {
      suggestions.add(search.query);
    });

    mediaKeywords.forEach(item => {
      if (item.tag && item.tag.toLowerCase().includes(query.toLowerCase())) {
        suggestions.add(item.tag);
      }
    });

    // Add smart suggestions based on common patterns
    const smartSuggestions = generateSmartSuggestions(query);
    smartSuggestions.forEach(s => suggestions.add(s));

    return NextResponse.json({
      suggestions: Array.from(suggestions).slice(0, 10),
      recent: recentSearches.map(s => ({
        query: s.query,
        resultsCount: s.results_count
      }))
    });
  } catch (error) {
    logger.error('Failed to get search suggestions', error);
    return NextResponse.json(
      { error: 'Failed to get suggestions' },
      { status: 500 }
    );
  }
}

function generateSmartSuggestions(query: string): string[] {
  const suggestions: string[] = [];
  const lowerQuery = query.toLowerCase();

  // Time-based suggestions
  if (lowerQuery.includes('today') || lowerQuery.includes('yesterday')) {
    suggestions.push(`${query} photos`, `${query} videos`);
  }

  // Content type suggestions
  if (!lowerQuery.includes('photo') && !lowerQuery.includes('video')) {
    suggestions.push(`${query} photos`, `${query} videos`, `${query} documents`);
  }

  // Location suggestions
  if (lowerQuery.includes('in ')) {
    suggestions.push(`${query} 2024`, `${query} this year`);
  }

  return suggestions;
}
```

---

## Step 4: User & Billing API

### 4.1 Create User Profile Endpoint
Create `src/app/api/user/profile/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const userId = auth.user.uid;

    // Get user data
    const user = await db('users').where('id', userId).first();
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Get subscription info
    const subscription = await db('user_subscriptions as us')
      .join('subscription_tiers as st', 'us.tier_id', 'st.id')
      .where('us.user_id', userId)
      .where('us.status', 'active')
      .select(
        'us.*',
        'st.name as tier_name',
        'st.monthly_price',
        'st.features'
      )
      .first();

    // Get usage stats
    const mediaStats = await db('media_items')
      .where('user_id', userId)
      .select(
        db.raw('COUNT(*) as total_items'),
        db.raw('COALESCE(SUM(size), 0) as total_size'),
        db.raw(`COUNT(CASE WHEN mime_type LIKE 'image/%' THEN 1 END) as total_images`),
        db.raw(`COUNT(CASE WHEN mime_type LIKE 'video/%' THEN 1 END) as total_videos`),
        db.raw(`COUNT(CASE WHEN mime_type LIKE 'text/%' OR mime_type = 'application/pdf' THEN 1 END) as total_documents`)
      )
      .first();

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        photoUrl: user.photo_url,
        createdAt: user.created_at
      },
      subscription: subscription ? {
        id: subscription.id,
        tierName: subscription.tier_name,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        features: subscription.features,
        monthlyPrice: subscription.monthly_price
      } : null,
      stats: {
        totalItems: parseInt(mediaStats.total_items),
        totalSize: parseInt(mediaStats.total_size),
        itemsByType: {
          images: parseInt(mediaStats.total_images),
          videos: parseInt(mediaStats.total_videos),
          documents: parseInt(mediaStats.total_documents)
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get user profile', error);
    return NextResponse.json(
      { error: 'Failed to get profile' },
      { status: 500 }
    );
  }
}
```

### 4.2 Create User Usage Endpoint
Create `src/app/api/user/usage/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { costService } from '@/lib/services/cost-service';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const userId = auth.user.uid;
    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get('period') || 'current'; // current, last30days, all

    // Get subscription limits
    const subscription = await db('user_subscriptions as us')
      .join('subscription_tiers as st', 'us.tier_id', 'st.id')
      .where('us.user_id', userId)
      .where('us.status', 'active')
      .select('st.*', 'us.current_period_start', 'us.current_period_end')
      .first();

    const limits = subscription ? {
      storageLimit: subscription.storage_limit,
      apiCallsLimit: subscription.api_calls_limit,
      monthlyBudget: subscription.monthly_budget
    } : {
      storageLimit: 1024 * 1024 * 1024, // 1GB default
      apiCallsLimit: 1000,
      monthlyBudget: 10.00
    };

    // Calculate period dates
    let startDate: Date;
    let endDate = new Date();

    if (period === 'current' && subscription) {
      startDate = new Date(subscription.current_period_start);
    } else if (period === 'last30days') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    } else {
      startDate = new Date('2020-01-01'); // All time
    }

    // Get storage usage
    const storageUsage = await db('media_items')
      .where('user_id', userId)
      .sum('size as total')
      .first();

    // Get API usage
    const apiUsage = await db('costs')
      .where('user_id', userId)
      .whereBetween('created_at', [startDate, endDate])
      .groupBy('service')
      .select(
        'service',
        db.raw('COUNT(*) as call_count'),
        db.raw('SUM(cost) as total_cost')
      );

    // Get budget usage
    const budgetUsage = await costService.getCurrentUsage(userId);

    // Get processing stats
    const processingStats = await db('media_items')
      .where('user_id', userId)
      .whereBetween('created_at', [startDate, endDate])
      .groupBy('processing_status')
      .select(
        'processing_status',
        db.raw('COUNT(*) as count')
      );

    return NextResponse.json({
      period: {
        type: period,
        start: startDate,
        end: endDate
      },
      limits,
      usage: {
        storage: {
          used: parseInt(storageUsage?.total || '0'),
          limit: limits.storageLimit,
          percentage: (parseInt(storageUsage?.total || '0') / limits.storageLimit) * 100
        },
        apiCalls: {
          breakdown: apiUsage.map(service => ({
            service: service.service,
            calls: parseInt(service.call_count),
            cost: parseFloat(service.total_cost)
          })),
          total: apiUsage.reduce((sum, s) => sum + parseInt(s.call_count), 0),
          limit: limits.apiCallsLimit
        },
        budget: {
          used: budgetUsage.total,
          limit: limits.monthlyBudget,
          percentage: (budgetUsage.total / limits.monthlyBudget) * 100,
          breakdown: budgetUsage.breakdown
        },
        processing: {
          breakdown: processingStats.map(stat => ({
            status: stat.processing_status,
            count: parseInt(stat.count)
          })),
          total: processingStats.reduce((sum, s) => sum + parseInt(s.count), 0)
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get usage data', error);
    return NextResponse.json(
      { error: 'Failed to get usage' },
      { status: 500 }
    );
  }
}
```

---

## Step 5: Analytics API

### 5.1 Create Dashboard Analytics Endpoint
Create `src/app/api/analytics/dashboard/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const userId = auth.user.uid;

    // Get time periods
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);
    const thisMonth = new Date(today);
    thisMonth.setDate(thisMonth.getDate() - 30);

    // Media upload trends
    const uploadTrends = await db('media_items')
      .where('user_id', userId)
      .where('created_at', '>=', thisMonth)
      .select(
        db.raw(`DATE(created_at) as date`),
        db.raw('COUNT(*) as uploads'),
        db.raw('SUM(size) as total_size')
      )
      .groupBy(db.raw('DATE(created_at)'))
      .orderBy('date', 'asc');

    // Search activity
    const searchActivity = await db('search_history')
      .where('user_id', userId)
      .where('created_at', '>=', thisWeek)
      .select(
        db.raw(`DATE(created_at) as date`),
        db.raw('COUNT(*) as searches'),
        db.raw('AVG(results_count) as avg_results')
      )
      .groupBy(db.raw('DATE(created_at)'))
      .orderBy('date', 'asc');

    // Top media types
    const mediaTypes = await db('media_items')
      .where('user_id', userId)
      .select(
        db.raw(`
          CASE 
            WHEN mime_type LIKE 'image/%' THEN 'Images'
            WHEN mime_type LIKE 'video/%' THEN 'Videos'
            WHEN mime_type LIKE 'audio/%' THEN 'Audio'
            WHEN mime_type LIKE 'text/%' OR mime_type = 'application/pdf' THEN 'Documents'
            ELSE 'Other'
          END as type
        `),
        db.raw('COUNT(*) as count'),
        db.raw('SUM(size) as total_size')
      )
      .groupBy('type');

    // Processing success rate
    const processingStats = await db('media_items')
      .where('user_id', userId)
      .where('created_at', '>=', thisMonth)
      .select(
        'processing_status',
        db.raw('COUNT(*) as count')
      )
      .groupBy('processing_status');

    const totalProcessed = processingStats.reduce((sum, s) => sum + parseInt(s.count), 0);
    const successRate = totalProcessed > 0 
      ? (processingStats.find(s => s.processing_status === 'completed')?.count || 0) / totalProcessed * 100
      : 0;

    // Recent activity
    const recentActivity = await db('media_items')
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .limit(10)
      .select('id', 'filename', 'mime_type', 'processing_status', 'created_at');

    return NextResponse.json({
      summary: {
        totalMedia: await db('media_items').where('user_id', userId).count('* as count').first().then(r => r?.count || 0),
        totalSearches: await db('search_history').where('user_id', userId).count('* as count').first().then(r => r?.count || 0),
        processingSuccessRate: successRate,
        storageUsed: await db('media_items').where('user_id', userId).sum('size as total').first().then(r => r?.total || 0)
      },
      trends: {
        uploads: uploadTrends.map(t => ({
          date: t.date,
          count: parseInt(t.uploads),
          size: parseInt(t.total_size)
        })),
        searches: searchActivity.map(s => ({
          date: s.date,
          count: parseInt(s.searches),
          avgResults: parseFloat(s.avg_results)
        }))
      },
      mediaTypes: mediaTypes.map(m => ({
        type: m.type,
        count: parseInt(m.count),
        size: parseInt(m.total_size)
      })),
      recentActivity: recentActivity.map(a => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mime_type,
        status: a.processing_status,
        createdAt: a.created_at
      }))
    });
  } catch (error) {
    logger.error('Failed to get dashboard analytics', error);
    return NextResponse.json(
      { error: 'Failed to get analytics' },
      { status: 500 }
    );
  }
}
```

### 5.2 Create Cost Analytics Endpoint
Create `src/app/api/analytics/costs/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const userId = auth.user.uid;
    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '30');
    const groupBy = searchParams.get('groupBy') || 'service'; // service, operation, day

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Base query
    let query = db('costs')
      .where('user_id', userId)
      .where('created_at', '>=', startDate);

    let results;

    switch (groupBy) {
      case 'service':
        results = await query
          .groupBy('service')
          .select(
            'service',
            db.raw('SUM(cost) as total_cost'),
            db.raw('COUNT(*) as operation_count'),
            db.raw('json_agg(DISTINCT operation) as operations')
          )
          .orderBy('total_cost', 'desc');
        break;

      case 'operation':
        results = await query
          .groupBy('service', 'operation')
          .select(
            'service',
            'operation',
            db.raw('SUM(cost) as total_cost'),
            db.raw('COUNT(*) as count')
          )
          .orderBy('total_cost', 'desc');
        break;

      case 'day':
        results = await query
          .select(
            db.raw('DATE(created_at) as date'),
            'service',
            db.raw('SUM(cost) as total_cost'),
            db.raw('COUNT(*) as operation_count')
          )
          .groupBy(db.raw('DATE(created_at)'), 'service')
          .orderBy('date', 'desc');
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid groupBy parameter' },
          { status: 400 }
        );
    }

    // Get total cost
    const totalCost = await query
      .sum('cost as total')
      .first()
      .then(r => parseFloat(r?.total || '0'));

    // Get cost trends
    const trends = await db('costs')
      .where('user_id', userId)
      .where('created_at', '>=', startDate)
      .select(
        db.raw('DATE(created_at) as date'),
        db.raw('SUM(cost) as daily_cost')
      )
      .groupBy(db.raw('DATE(created_at)'))
      .orderBy('date', 'asc');

    // Format response
    let formattedResults;
    
    if (groupBy === 'service') {
      formattedResults = results.map(r => ({
        service: r.service,
        totalCost: parseFloat(r.total_cost),
        operationCount: parseInt(r.operation_count),
        operations: r.operations,
        percentage: (parseFloat(r.total_cost) / totalCost) * 100
      }));
    } else if (groupBy === 'operation') {
      formattedResults = results.map(r => ({
        service: r.service,
        operation: r.operation,
        totalCost: parseFloat(r.total_cost),
        count: parseInt(r.count),
        averageCost: parseFloat(r.total_cost) / parseInt(r.count)
      }));
    } else {
      formattedResults = results.map(r => ({
        date: r.date,
        service: r.service,
        totalCost: parseFloat(r.total_cost),
        operationCount: parseInt(r.operation_count)
      }));
    }

    return NextResponse.json({
      period: {
        days,
        startDate,
        endDate: new Date()
      },
      summary: {
        totalCost,
        averageDailyCost: totalCost / days,
        servicesUsed: new Set(results.map(r => r.service)).size
      },
      breakdown: formattedResults,
      trends: trends.map(t => ({
        date: t.date,
        cost: parseFloat(t.daily_cost)
      }))
    });
  } catch (error) {
    logger.error('Failed to get cost analytics', error);
    return NextResponse.json(
      { error: 'Failed to get cost analytics' },
      { status: 500 }
    );
  }
}
```

---

## Integration Points

### Using Authentication from Phase 6
```typescript
import { requireAuth } from '@/lib/middleware/auth';

// All endpoints use Firebase authentication
const auth = await requireAuth(request);
if (!auth.success) {
  return NextResponse.json({ error: auth.error }, { status: 401 });
}
```

### Using AWS Services from Phase 9
```typescript
import { s3Service } from '@/lib/aws/s3-service';

// Generate presigned URLs for uploads
const presignedUrl = await s3Service.getPresignedUploadUrl(s3Key, mimeType);
```

### Using Queue System from Phase 10
```typescript
import { queueManager } from '@/lib/queue/queue-manager';

// Queue processing jobs
await queueManager.addImageProcessingJob(jobData);
```

### Using Search from Phase 11
```typescript
import { searchService } from '@/lib/services/search-service';

// Perform AI-powered search
const results = await searchService.search(query);
```

---

## Testing

### Test API Routes
Create `scripts/test-api-routes.js`:

```javascript
const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';
const TEST_TOKEN = process.env.TEST_AUTH_TOKEN;

async function testAPIRoutes() {
  const headers = {
    'Authorization': `Bearer ${TEST_TOKEN}`,
    'Content-Type': 'application/json'
  };

  try {
    console.log('Testing Upload API...');
    
    // Test presigned URL
    const presignedResponse = await axios.post(
      `${API_BASE}/upload/presigned`,
      {
        filename: 'test-image.jpg',
        mimeType: 'image/jpeg',
        size: 1024 * 1024 // 1MB
      },
      { headers }
    );
    console.log('✓ Presigned URL generated:', presignedResponse.data.mediaItemId);

    // Test media list
    console.log('\nTesting Media API...');
    const mediaListResponse = await axios.get(
      `${API_BASE}/media?limit=10`,
      { headers }
    );
    console.log('✓ Media list retrieved:', mediaListResponse.data.pagination);

    // Test search
    console.log('\nTesting Search API...');
    const searchResponse = await axios.post(
      `${API_BASE}/search`,
      { query: 'test search' },
      { headers }
    );
    console.log('✓ Search completed:', searchResponse.data.searchId);

    // Test user profile
    console.log('\nTesting User API...');
    const profileResponse = await axios.get(
      `${API_BASE}/user/profile`,
      { headers }
    );
    console.log('✓ User profile retrieved:', profileResponse.data.user.email);

    // Test analytics
    console.log('\nTesting Analytics API...');
    const analyticsResponse = await axios.get(
      `${API_BASE}/analytics/dashboard`,
      { headers }
    );
    console.log('✓ Analytics retrieved:', analyticsResponse.data.summary);

    console.log('\nAll API tests passed! ✨');
  } catch (error) {
    console.error('API test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Check for auth token
if (!TEST_TOKEN) {
  console.error('Please set TEST_AUTH_TOKEN environment variable');
  process.exit(1);
}

testAPIRoutes();
```

Run the test:
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
npm install axios
TEST_AUTH_TOKEN=your-firebase-token node scripts/test-api-routes.js
```

### Test with cURL Commands
```bash
# Test upload presigned URL
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
curl -X POST http://localhost:3000/api/upload/presigned \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.jpg", "mimeType": "image/jpeg", "size": 1048576}'

# Test media list
curl http://localhost:3000/api/media?limit=10 \
  -H "Authorization: Bearer $TOKEN"

# Test search
curl -X POST http://localhost:3000/api/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "sunset photos"}'

# Test user profile
curl http://localhost:3000/api/user/profile \
  -H "Authorization: Bearer $TOKEN"

# Test analytics
curl http://localhost:3000/api/analytics/dashboard \
  -H "Authorization: Bearer $TOKEN"
```

---

## ✅ Phase 12 Completion Checklist

### Core Implementation
- [ ] **Upload API**: Presigned URLs, completion tracking, status checks
- [ ] **Media Management**: CRUD operations, related media, batch operations
- [ ] **Search Extensions**: Suggestions, history, advanced filtering
- [ ] **User & Billing**: Profile, usage tracking, subscription management
- [ ] **Analytics**: Dashboard stats, cost breakdown, trends

### Testing & Verification
```bash
# All these should succeed:
npm run build
node scripts/test-api-routes.js
curl http://localhost:3000/api/media -H "Authorization: Bearer $TOKEN"
curl http://localhost:3000/api/user/usage -H "Authorization: Bearer $TOKEN"
```

### Integration Points
- [ ] All routes authenticated with Firebase
- [ ] Rate limiting applied to sensitive endpoints
- [ ] Costs tracked for all operations
- [ ] Queue jobs created for processing
- [ ] Proper error handling and validation

---

## 🚀 Next Steps

**Phase 12 Complete!** ✅

**Ready for Phase 13**: Frontend Components
- Read: `phases/phase-13-frontend-components.md`
- Prerequisites: All API routes implemented
- Outcome: Complete React frontend with state management