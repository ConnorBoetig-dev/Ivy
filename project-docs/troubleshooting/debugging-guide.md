# Debugging Guide - Trace Procedures & Tools

## 🔍 Debugging Philosophy

1. **Reproduce First**: Always reproduce the issue before attempting fixes
2. **Isolate Variables**: Change one thing at a time
3. **Document Everything**: Keep notes of what you've tried
4. **Use Scientific Method**: Form hypothesis → Test → Analyze results

---

## 🛠️ Essential Debugging Tools

### Development Environment Setup

```bash
# Install debugging tools
npm install -D @types/debug debug
npm install -D source-map-support
npm install -D why-is-node-running

# Chrome DevTools for Node.js
node --inspect server.js
# Then open chrome://inspect

# VS Code debugging config (.vscode/launch.json)
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/src/server.ts",
      "preLaunchTask": "npm: build",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "*"
      }
    }
  ]
}
```

### Environment Variables for Debugging

```bash
# Enable all debug output
DEBUG=* npm run dev

# Enable specific namespaces
DEBUG=api:*,worker:* npm run dev

# Enable SQL query logging
DEBUG_SQL=true npm run dev

# Enable AWS SDK debugging
export AWS_NODEJS_CONNECTION_REUSE_ENABLED=1
export NODE_DEBUG=aws-sdk
```

---

## 📊 Tracing User Requests

### 1. Complete Upload Flow Trace

```typescript
// Add request ID middleware (src/middleware/request-id.ts)
import { v4 as uuidv4 } from 'uuid';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  
  // Log request start
  logger.info('Request started', {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  
  // Log request completion
  res.on('finish', () => {
    logger.info('Request completed', {
      requestId,
      statusCode: res.statusCode,
      duration: Date.now() - req.startTime
    });
  });
  
  next();
}
```

#### Trace Upload Request

```bash
# 1. Monitor frontend
# Browser DevTools → Network → Look for /api/upload/presigned-url

# 2. Trace API request
tail -f logs/api.log | grep "REQUEST_ID"

# 3. Watch S3 upload
aws s3api list-objects-v2 --bucket $BUCKET --prefix "uploads/" --query "Contents[?LastModified>='$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)']"

# 4. Monitor queue job
curl http://localhost:3000/api/admin/jobs/JOB_ID

# 5. Check worker processing
docker logs worker-container -f | grep "JOB_ID"

# 6. Verify database update
psql -c "SELECT * FROM media_items WHERE id = 'MEDIA_ID'"
```

### 2. Search Request Trace

```javascript
// Add search debugging (src/api/search/route.ts)
export async function POST(req: Request) {
  const debug = {
    requestId: req.headers.get('x-request-id'),
    timestamp: new Date().toISOString(),
    steps: []
  };
  
  try {
    // 1. Parse query
    debug.steps.push({ step: 'parse_query', timestamp: Date.now() });
    const { query } = await req.json();
    
    // 2. Generate embedding
    debug.steps.push({ step: 'generate_embedding', timestamp: Date.now() });
    const embedding = await openai.generateEmbedding(query);
    debug.embeddingSize = embedding.length;
    
    // 3. Vector search
    debug.steps.push({ step: 'vector_search', timestamp: Date.now() });
    const results = await db.vectorSearch(embedding);
    debug.resultCount = results.length;
    
    // 4. Enrich results
    debug.steps.push({ step: 'enrich_results', timestamp: Date.now() });
    const enriched = await enrichResults(results);
    
    // Log complete trace
    logger.debug('Search request trace', debug);
    
    return NextResponse.json({ results: enriched });
  } catch (error) {
    logger.error('Search failed', { ...debug, error });
    throw error;
  }
}
```

---

## 🐛 Common Debugging Scenarios

### Memory Leak Detection

```javascript
// Add memory monitoring (scripts/memory-monitor.js)
const v8 = require('v8');
const fs = require('fs');

setInterval(() => {
  const heapStats = v8.getHeapStatistics();
  const usage = process.memoryUsage();
  
  console.log({
    timestamp: new Date().toISOString(),
    heapUsed: (usage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
    heapTotal: (usage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
    external: (usage.external / 1024 / 1024).toFixed(2) + ' MB',
    heapLimit: (heapStats.heap_size_limit / 1024 / 1024).toFixed(2) + ' MB'
  });
  
  // Take heap snapshot if memory > 1GB
  if (usage.heapUsed > 1024 * 1024 * 1024) {
    const snapshot = v8.writeHeapSnapshot();
    console.log('Heap snapshot written to:', snapshot);
  }
}, 30000); // Every 30 seconds

// Find what's keeping process alive
if (process.env.DEBUG_SHUTDOWN) {
  process.on('SIGTERM', () => {
    const why = require('why-is-node-running');
    why();
  });
}
```

### Database Query Debugging

```typescript
// Enable query logging (src/lib/database.ts)
import { Knex } from 'knex';

const db = knex({
  client: 'postgresql',
  connection: DATABASE_URL,
  debug: process.env.DEBUG_SQL === 'true',
  log: {
    warn(message) {
      logger.warn('Database warning', { message });
    },
    error(message) {
      logger.error('Database error', { message });
    },
    deprecate(message) {
      logger.info('Database deprecation', { message });
    },
    debug(message) {
      if (process.env.DEBUG_SQL) {
        // Parse and format SQL for readability
        const formatted = message.sql
          ? `${message.method}: ${message.sql} [${message.bindings?.join(', ')}]`
          : message;
        logger.debug('SQL', { query: formatted, duration: message.duration });
      }
    }
  }
});

// Add query timing
db.on('query', (query) => {
  query.__startTime = Date.now();
});

db.on('query-response', (response, query) => {
  const duration = Date.now() - query.__startTime;
  if (duration > 100) { // Log slow queries
    logger.warn('Slow query detected', {
      sql: query.sql,
      duration,
      bindings: query.bindings
    });
  }
});
```

### Worker Job Debugging

```typescript
// Enhanced worker with debugging (src/workers/debug-worker.ts)
export class DebugWorker extends BaseWorker {
  protected async process(job: Job) {
    const debug = {
      jobId: job.id,
      jobName: job.name,
      attempts: job.attemptsMade,
      timestamp: Date.now(),
      steps: []
    };
    
    try {
      // Add debug checkpoint
      const checkpoint = (step: string, data?: any) => {
        debug.steps.push({
          step,
          timestamp: Date.now(),
          data
        });
        logger.debug(`Job ${job.id} - ${step}`, data);
      };
      
      checkpoint('start', { data: job.data });
      
      // Your processing logic with checkpoints
      checkpoint('fetch_from_s3');
      const file = await s3.getObject(job.data.s3Key);
      
      checkpoint('process_with_ai', { fileSize: file.length });
      const result = await processWithAI(file);
      
      checkpoint('save_results');
      await saveResults(result);
      
      checkpoint('complete', { duration: Date.now() - debug.timestamp });
      
      return result;
    } catch (error) {
      debug.error = {
        message: error.message,
        stack: error.stack,
        step: debug.steps[debug.steps.length - 1]?.step
      };
      logger.error('Job processing failed', debug);
      throw error;
    }
  }
}
```

---

## 🔬 Advanced Debugging Techniques

### 1. Distributed Tracing

```typescript
// Implement OpenTelemetry tracing
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('ai-media-search', '1.0.0');

export function traceAsync<T>(
  name: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// Usage
async function processMedia(mediaId: string) {
  return traceAsync('processMedia', async (span) => {
    span.setAttributes({
      'media.id': mediaId,
      'media.type': 'image'
    });
    
    // Processing logic
    const result = await traceAsync('ai.analyze', async (childSpan) => {
      return await aiService.analyze(mediaId);
    });
    
    return result;
  });
}
```

### 2. Performance Profiling

```javascript
// CPU profiling script (scripts/profile-cpu.js)
const inspector = require('inspector');
const fs = require('fs');

const session = new inspector.Session();
session.connect();

// Start CPU profiling
session.post('Profiler.enable', () => {
  session.post('Profiler.start', () => {
    console.log('CPU profiling started...');
    
    // Run for 30 seconds
    setTimeout(() => {
      session.post('Profiler.stop', (err, { profile }) => {
        if (!err) {
          fs.writeFileSync('./cpu-profile.cpuprofile', JSON.stringify(profile));
          console.log('Profile saved to cpu-profile.cpuprofile');
          console.log('Open in Chrome DevTools: chrome://inspect → Open dedicated DevTools for Node → Profiler → Load');
        }
        session.disconnect();
        process.exit(0);
      });
    }, 30000);
  });
});
```

### 3. Network Debugging

```bash
# Monitor HTTP traffic
tcpdump -i any -s 0 -A 'tcp port 3000'

# Monitor Redis commands
redis-cli monitor | grep -E "SET|GET|DEL"

# Monitor PostgreSQL queries
tail -f /var/log/postgresql/postgresql-*.log | grep -E "LOG|ERROR"

# Monitor S3 traffic
export AWS_NODEJS_CONNECTION_REUSE_ENABLED=1
export NODE_DEBUG=aws-sdk
```

---

## 🎯 Debugging Checklists

### API Endpoint Not Working

- [ ] Check request reaches server (access logs)
- [ ] Verify authentication middleware passes
- [ ] Check request validation passes
- [ ] Verify database queries execute
- [ ] Check response formatting
- [ ] Verify CORS headers if frontend issue
- [ ] Check rate limiting not triggered

### Queue Job Stuck

- [ ] Job exists in queue (`queue.getJob(id)`)
- [ ] Worker is running (`docker ps`)
- [ ] Redis connection active (`redis-cli ping`)
- [ ] Check job attempts and errors
- [ ] Verify job data is valid
- [ ] Check worker logs for errors
- [ ] Verify dependent services available

### Search Returns No Results

- [ ] Query reaches API endpoint
- [ ] Embedding generation succeeds
- [ ] Vector dimensions match (1536)
- [ ] Database has embeddings
- [ ] Distance threshold not too strict
- [ ] User has permission to view results
- [ ] Results not filtered out by logic

---

## 📈 Performance Debugging

### Identify Bottlenecks

```javascript
// Performance timing middleware
export function performanceMiddleware(req, res, next) {
  const timings = {
    start: Date.now(),
    middleware: {},
    database: 0,
    external: 0
  };
  
  // Override res.json to add timings
  const originalJson = res.json;
  res.json = function(data) {
    res.setHeader('X-Response-Time', Date.now() - timings.start);
    res.setHeader('X-Timing-Breakdown', JSON.stringify(timings));
    return originalJson.call(this, data);
  };
  
  req.timings = timings;
  next();
}

// In your routes
router.get('/api/search', async (req, res) => {
  const dbStart = Date.now();
  const results = await db.query('...');
  req.timings.database += Date.now() - dbStart;
  
  const apiStart = Date.now();
  const enriched = await externalApi.enrich(results);
  req.timings.external += Date.now() - apiStart;
  
  res.json({ results: enriched });
});
```

### Database Query Analysis

```sql
-- Enable query timing
ALTER SYSTEM SET log_min_duration_statement = 100; -- Log queries > 100ms

-- Analyze query plan
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM media_items 
WHERE user_id = '123' 
ORDER BY created_at DESC 
LIMIT 20;

-- Find missing indexes
SELECT schemaname, tablename, attname, n_distinct, correlation
FROM pg_stats
WHERE schemaname = 'public'
  AND n_distinct > 100
  AND correlation < 0.1
ORDER BY n_distinct DESC;
```

---

## 🆘 Emergency Debugging

### Production Debugging (Minimal Impact)

```bash
# 1. Enable debug logging temporarily
kubectl set env deployment/api DEBUG=api:error,api:warn

# 2. Capture specific user's traffic
tcpdump -w user-trace.pcap -i any "host $USER_IP"

# 3. Sample 1% of traffic for debugging
iptables -A INPUT -m statistic --mode random --probability 0.01 -j LOG

# 4. Create debug snapshot
curl -X POST http://localhost:3000/api/admin/debug/snapshot \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Post-Mortem Data Collection

```bash
#!/bin/bash
# Collect debug information after incident

INCIDENT_DIR="incident-$(date +%Y%m%d-%H%M%S)"
mkdir -p $INCIDENT_DIR

# System state
dmesg > $INCIDENT_DIR/dmesg.log
ps auxf > $INCIDENT_DIR/processes.log
netstat -an > $INCIDENT_DIR/network.log
df -h > $INCIDENT_DIR/disk.log
free -m > $INCIDENT_DIR/memory.log

# Application logs
cp logs/api-*.log $INCIDENT_DIR/
cp logs/worker-*.log $INCIDENT_DIR/
docker logs api-container > $INCIDENT_DIR/docker-api.log 2>&1

# Database state
psql -c "SELECT * FROM pg_stat_activity" > $INCIDENT_DIR/db-activity.log
psql -c "SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 50" > $INCIDENT_DIR/db-slow-queries.log

# Redis state
redis-cli INFO > $INCIDENT_DIR/redis-info.log
redis-cli --scan > $INCIDENT_DIR/redis-keys.log

# Create archive
tar -czf $INCIDENT_DIR.tar.gz $INCIDENT_DIR/
echo "Debug data collected in $INCIDENT_DIR.tar.gz"
```

---

## 🔧 Debug Configuration Templates

### Development Debug Settings

```typescript
// config/debug.config.ts
export const debugConfig = {
  // Logging
  logLevel: process.env.LOG_LEVEL || 'debug',
  logSql: process.env.DEBUG_SQL === 'true',
  logRequests: process.env.DEBUG_REQUESTS === 'true',
  
  // Performance
  slowQueryThreshold: parseInt(process.env.SLOW_QUERY_MS || '100'),
  slowApiThreshold: parseInt(process.env.SLOW_API_MS || '1000'),
  
  // Debugging features
  enableTracing: process.env.ENABLE_TRACING === 'true',
  enableProfiling: process.env.ENABLE_PROFILING === 'true',
  saveHeapSnapshots: process.env.SAVE_HEAP_SNAPSHOTS === 'true',
  
  // Development helpers
  mockExternalApis: process.env.MOCK_EXTERNAL === 'true',
  bypassAuth: process.env.BYPASS_AUTH === 'true',
  verboseErrors: process.env.VERBOSE_ERRORS === 'true'
};
```

### Debug Endpoints (Development Only)

```typescript
// src/api/debug/route.ts (protected with auth)
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  
  return NextResponse.json({
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    env: {
      node: process.version,
      env: process.env.NODE_ENV
    },
    connections: {
      database: await checkDatabaseConnection(),
      redis: await checkRedisConnection(),
      s3: await checkS3Connection()
    }
  });
}
```

---

## 📚 Additional Resources

### Debug Commands Cheatsheet

```bash
# Quick commands for common debugging tasks
alias debug-api='DEBUG=api:* npm run dev'
alias debug-worker='DEBUG=worker:* npm run worker:dev'
alias debug-all='DEBUG=* npm run dev'
alias tail-errors='tail -f logs/*.log | grep -E "ERROR|FAIL"'
alias watch-queue='watch -n 5 "curl -s localhost:3000/api/admin/queues/stats | jq"'
alias slow-queries='psql -c "SELECT query, calls, mean_time FROM pg_stat_statements WHERE mean_time > 100 ORDER BY mean_time DESC LIMIT 20"'
```

### Debug Documentation
- Node.js debugging guide: https://nodejs.org/en/docs/guides/debugging-getting-started/
- Chrome DevTools for Node.js: https://nodejs.org/en/docs/inspector/
- PostgreSQL performance: https://www.postgresql.org/docs/current/performance-tips.html
- Redis debugging: https://redis.io/docs/manual/debugging/