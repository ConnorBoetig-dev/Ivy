# Performance Optimization Guide

## 🚀 Key Performance Optimization Points

This guide identifies critical performance optimization opportunities throughout the AI Media Search application.

---

## 📊 Database Optimizations

### 1. Index Optimization (Phase 2)
**Location**: `src/lib/database.ts`
**Priority**: HIGH

```sql
-- ⚡ PERFORMANCE: Essential indexes for common queries
CREATE INDEX CONCURRENTLY idx_media_items_user_created 
ON media_items(user_id, created_at DESC);

CREATE INDEX CONCURRENTLY idx_media_items_status 
ON media_items(processing_status) 
WHERE processing_status IN ('pending', 'processing');

CREATE INDEX CONCURRENTLY idx_embeddings_media_id 
ON embeddings(media_item_id);

-- ⚡ PERFORMANCE: Vector similarity search optimization
CREATE INDEX embeddings_vector_idx ON embeddings 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);
```

### 2. Query Optimization
**Location**: Multiple API endpoints
**Priority**: HIGH

```typescript
// ⚡ PERFORMANCE: Use query builder for efficient queries
const getMediaWithPagination = async (userId: string, limit: number, offset: number) => {
  return db('media_items')
    .select('id', 'filename', 'file_type', 'created_at', 'thumbnail_url')  // Only select needed fields
    .where('user_id', userId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);
};

// ⚡ PERFORMANCE: Use joins instead of N+1 queries
const getMediaWithEmbeddings = async (userId: string) => {
  return db('media_items as m')
    .leftJoin('embeddings as e', 'm.id', 'e.media_item_id')
    .select(
      'm.id', 'm.filename', 'm.file_type',
      'e.embedding', 'e.created_at as embedding_created'
    )
    .where('m.user_id', userId);
};
```

---

## 🔄 Caching Optimizations

### 1. Multi-Layer Caching Strategy (Phase 5)
**Location**: Throughout the application
**Priority**: HIGH

```typescript
// ⚡ PERFORMANCE: Implement cache-aside pattern with TTL
class OptimizedCacheService {
  // Short-term cache for frequently accessed data
  async getUserMedia(userId: string): Promise<MediaItem[]> {
    const cacheKey = `user:${userId}:media`;
    
    // Check cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      metrics.increment('cache.hit', { type: 'user_media' });
      return JSON.parse(cached);
    }
    
    // Cache miss - fetch from database
    metrics.increment('cache.miss', { type: 'user_media' });
    const media = await db.getUserMedia(userId);
    
    // Cache with appropriate TTL
    await redis.setex(cacheKey, 300, JSON.stringify(media)); // 5 minutes
    return media;
  }
  
  // ⚡ PERFORMANCE: Cache expensive AI operations
  async getCachedEmbedding(contentHash: string): Promise<number[] | null> {
    const cacheKey = `embedding:${contentHash}`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      metrics.increment('embedding.cache.hit');
      return JSON.parse(cached);
    }
    
    return null;
  }
}
```

### 2. Search Result Caching
**Location**: `src/app/api/search/route.ts`
**Priority**: MEDIUM

```typescript
// ⚡ PERFORMANCE: Cache search results with query hash
const searchWithCache = async (query: string, filters: any) => {
  const queryHash = crypto.createHash('md5')
    .update(JSON.stringify({ query, filters }))
    .digest('hex');
  
  const cacheKey = `search:${queryHash}`;
  const cached = await redis.get(cacheKey);
  
  if (cached) {
    return { ...JSON.parse(cached), fromCache: true };
  }
  
  const results = await performVectorSearch(query, filters);
  
  // Cache for 1 hour
  await redis.setex(cacheKey, 3600, JSON.stringify(results));
  return results;
};
```

---

## 🔄 Queue & Worker Optimizations

### 1. Batch Processing (Phase 10)
**Location**: `src/workers/*`
**Priority**: HIGH

```typescript
// ⚡ PERFORMANCE: Process multiple items in batches
class OptimizedImageWorker extends BaseWorker {
  protected async process(job: Job<ImageProcessingJobData[]>) {
    const batchSize = 10;
    const items = job.data;
    
    // Process in smaller batches to avoid memory issues
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      // Process batch in parallel
      await Promise.all(
        batch.map(item => this.processImage(item))
      );
      
      // Update progress
      await this.updateProgress(job, {
        current: i + batch.length,
        total: items.length,
        message: `Processed ${i + batch.length}/${items.length} images`
      });
    }
  }
}
```

### 2. Connection Pooling
**Location**: `src/workers/base-worker.ts`
**Priority**: MEDIUM

```typescript
// ⚡ PERFORMANCE: Reuse connections in workers
class OptimizedBaseWorker {
  private static sharedDBPool: Pool;
  private static sharedRedisClient: Redis;
  
  protected getDBConnection(): Pool {
    if (!OptimizedBaseWorker.sharedDBPool) {
      OptimizedBaseWorker.sharedDBPool = new Pool({
        max: 10,
        min: 2,
        acquireTimeoutMillis: 30000
      });
    }
    return OptimizedBaseWorker.sharedDBPool;
  }
}
```

---

## 🔍 Search Performance

### 1. Vector Search Optimization (Phase 11)
**Location**: `src/lib/ai/search-service.ts`
**Priority**: HIGH

```typescript
// ⚡ PERFORMANCE: Optimize vector similarity search
class OptimizedSearchService {
  async vectorSearch(
    embedding: number[],
    limit: number = 20,
    threshold: number = 0.7
  ) {
    // Use parameterized query to avoid SQL injection and enable query planning
    const query = `
      SELECT 
        m.id,
        m.filename,
        m.thumbnail_url,
        (e.embedding <=> $1) as distance
      FROM media_items m
      JOIN embeddings e ON m.id = e.media_item_id
      WHERE (e.embedding <=> $1) < $2
      ORDER BY e.embedding <=> $1
      LIMIT $3
    `;
    
    return await db.raw(query, [
      JSON.stringify(embedding),
      1 - threshold, // Convert similarity to distance
      limit
    ]);
  }
  
  // ⚡ PERFORMANCE: Pre-filter by user before vector search
  async userVectorSearch(userId: string, embedding: number[], limit: number) {
    const query = `
      SELECT 
        m.id,
        m.filename,
        (e.embedding <=> $1) as distance
      FROM media_items m
      JOIN embeddings e ON m.id = e.media_item_id
      WHERE m.user_id = $2
        AND (e.embedding <=> $1) < 0.3
      ORDER BY e.embedding <=> $1
      LIMIT $3
    `;
    
    return await db.raw(query, [JSON.stringify(embedding), userId, limit]);
  }
}
```

---

## 🖼️ Media Processing Optimizations

### 1. Image Optimization (Phase 9)
**Location**: `src/services/aws/s3-service.ts`
**Priority**: MEDIUM

```typescript
// ⚡ PERFORMANCE: Generate multiple thumbnail sizes
class OptimizedMediaService {
  async generateThumbnails(s3Key: string): Promise<string[]> {
    const sizes = [150, 300, 600]; // Different thumbnail sizes
    const thumbnailKeys: string[] = [];
    
    // Process thumbnails in parallel
    await Promise.all(
      sizes.map(async (size) => {
        const thumbnailKey = `thumbnails/${s3Key}-${size}w.jpg`;
        
        const resized = await sharp(originalBuffer)
          .resize(size, size, { fit: 'cover' })
          .jpeg({ quality: 85 })
          .toBuffer();
        
        await s3Service.uploadObject(thumbnailKey, resized, 'image/jpeg');
        thumbnailKeys.push(thumbnailKey);
      })
    );
    
    return thumbnailKeys;
  }
  
  // ⚡ PERFORMANCE: Lazy load media content
  async getOptimizedMediaUrl(s3Key: string, size?: 'small' | 'medium' | 'large') {
    if (size) {
      const thumbnailKey = `thumbnails/${s3Key}-${this.getSizeWidth(size)}w.jpg`;
      return await s3Service.getSignedUrl(thumbnailKey);
    }
    
    return await s3Service.getSignedUrl(s3Key);
  }
}
```

---

## 🌐 API Performance

### 1. Response Optimization (Phase 12)
**Location**: API routes
**Priority**: HIGH

```typescript
// ⚡ PERFORMANCE: Implement streaming for large responses
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stream = searchParams.get('stream') === 'true';
  
  if (stream) {
    // Stream large datasets
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const results = await getSearchResults();
        
        for (const result of results) {
          const chunk = encoder.encode(JSON.stringify(result) + '\n');
          controller.enqueue(chunk);
        }
        
        controller.close();
      }
    });
    
    return new Response(readable, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked'
      }
    });
  }
  
  // Regular response
  return NextResponse.json(await getSearchResults());
}

// ⚡ PERFORMANCE: Use compression for large responses
import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);

export async function POST(request: NextRequest) {
  const results = await getLargeDataset();
  
  // Compress large responses
  if (JSON.stringify(results).length > 10000) {
    const compressed = await gzipAsync(JSON.stringify(results));
    
    return new Response(compressed, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'X-Uncompressed-Size': JSON.stringify(results).length.toString()
      }
    });
  }
  
  return NextResponse.json(results);
}
```

---

## 🎯 Frontend Performance

### 1. Component Optimization (Phase 13)
**Location**: React components
**Priority**: MEDIUM

```typescript
// ⚡ PERFORMANCE: Implement virtual scrolling for large lists
import { FixedSizeList as List } from 'react-window';

const OptimizedMediaGrid = ({ media }: { media: MediaItem[] }) => {
  const itemsPerRow = 4;
  const itemHeight = 200;
  
  const Row = ({ index, style }: { index: number; style: any }) => {
    const startIndex = index * itemsPerRow;
    const items = media.slice(startIndex, startIndex + itemsPerRow);
    
    return (
      <div style={style} className="flex gap-4">
        {items.map(item => (
          <MediaCard key={item.id} item={item} />
        ))}
      </div>
    );
  };
  
  return (
    <List
      height={600}
      itemCount={Math.ceil(media.length / itemsPerRow)}
      itemSize={itemHeight}
    >
      {Row}
    </List>
  );
};

// ⚡ PERFORMANCE: Implement intersection observer for lazy loading
const LazyMediaCard = ({ item }: { item: MediaItem }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [imageRef, inView] = useInView({
    triggerOnce: true,
    threshold: 0.1
  });
  
  useEffect(() => {
    if (inView) {
      setIsVisible(true);
    }
  }, [inView]);
  
  return (
    <div ref={imageRef}>
      {isVisible ? (
        <img src={item.thumbnailUrl} alt={item.filename} />
      ) : (
        <div className="placeholder h-48 bg-gray-200" />
      )}
    </div>
  );
};
```

---

## 📡 Network Optimizations

### 1. CDN Configuration (Phase 3)
**Location**: Cloudflare settings
**Priority**: HIGH

```typescript
// ⚡ PERFORMANCE: Implement aggressive caching for static assets
const cloudflareCache = {
  // Images and videos - cache for 30 days
  "*.{jpg,jpeg,png,gif,webp,mp4,mov}": {
    ttl: 2592000,
    browserTtl: 604800
  },
  
  // API responses - cache for 5 minutes
  "/api/search*": {
    ttl: 300,
    browserTtl: 0,
    cacheKey: "url,headers.authorization" // Cache per user
  },
  
  // Static assets - cache for 1 year
  "*.{js,css,woff2,ico}": {
    ttl: 31536000,
    browserTtl: 31536000
  }
};
```

---

## 📊 Monitoring Performance

### 1. Performance Metrics (Phase 4)
**Location**: `src/lib/monitoring/metrics.ts`
**Priority**: HIGH

```typescript
// ⚡ PERFORMANCE: Track key performance metrics
class PerformanceMonitor {
  // Database query performance
  trackQueryPerformance(queryName: string, duration: number) {
    metrics.histogram('db.query.duration', duration, {
      query: queryName
    });
    
    if (duration > 1000) {
      logger.warn('Slow query detected', {
        query: queryName,
        duration,
        threshold: 1000
      });
    }
  }
  
  // API endpoint performance
  trackAPIPerformance(endpoint: string, method: string, duration: number) {
    metrics.histogram('api.request.duration', duration, {
      endpoint,
      method
    });
    
    // Alert on slow endpoints
    if (duration > 2000) {
      this.alertSlowEndpoint(endpoint, duration);
    }
  }
  
  // Search performance
  trackSearchPerformance(
    query: string,
    resultCount: number,
    duration: number
  ) {
    metrics.histogram('search.duration', duration);
    metrics.histogram('search.results', resultCount);
    
    // Track search efficiency
    const efficiency = resultCount / duration; // results per ms
    metrics.gauge('search.efficiency', efficiency);
  }
}
```

---

## 🎯 Performance Targets

### Response Time SLAs
- **API Endpoints**: < 500ms (p95)
- **Search Queries**: < 1000ms (p95)
- **File Uploads**: < 100ms for presigned URL generation
- **Page Load**: < 2 seconds (First Contentful Paint)

### Throughput Targets
- **Concurrent Users**: 1000+
- **Uploads/minute**: 100
- **Searches/minute**: 500
- **Queue Processing**: 95% of jobs completed within 5 minutes

### Resource Utilization
- **Database Connections**: < 80% of pool
- **Memory Usage**: < 80% of available
- **CPU Usage**: < 70% average
- **Cache Hit Rate**: > 80%

---

## 🔧 Performance Testing

### Load Testing Script
```javascript
// k6 load testing example
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 200 }, // Ramp to 200 users
    { duration: '5m', target: 200 }, // Stay at 200 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
};

export default function () {
  const response = http.post('http://api.example.com/api/search', {
    query: 'sunset beach vacation',
    limit: 20
  }, {
    headers: {
      'Authorization': `Bearer ${__ENV.TEST_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
  
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
    'has results': (r) => JSON.parse(r.body).results.length > 0
  });
}
```

---

## 📈 Performance Monitoring Dashboard

Create these Grafana dashboard panels:

1. **Response Time Distribution** (histogram)
2. **Error Rate by Endpoint** (gauge)
3. **Database Query Performance** (time series)
4. **Cache Hit Rates** (percentage)
5. **Queue Depth** (gauge)
6. **Memory and CPU Usage** (time series)
7. **Search Performance** (combined metrics)

---

**Remember**: Performance optimization is an ongoing process. Regularly review these metrics and adjust optimizations based on actual usage patterns.