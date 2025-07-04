# Troubleshooting Guide - Common Issues & Solutions

## 🚨 Quick Diagnostics

### System Health Check
```bash
# Check all services are running
npm run health:check

# Check specific services
docker ps | grep -E "postgres|redis"
curl http://localhost:3000/api/health
redis-cli ping
psql -U $DB_USER -d $DB_NAME -c "SELECT 1"
```

## 🔧 Common Issues & Solutions

### 1. Upload Issues

#### **Problem: "Failed to generate presigned URL"**
```
Error: Failed to generate presigned URL
Status: 500
```

**Causes & Solutions:**
1. **AWS Credentials Missing/Invalid**
   ```bash
   # Check AWS credentials
   aws sts get-caller-identity
   
   # Verify environment variables
   echo $AWS_ACCESS_KEY_ID
   echo $AWS_SECRET_ACCESS_KEY
   echo $AWS_REGION
   ```

2. **S3 Bucket Doesn't Exist**
   ```bash
   # List buckets
   aws s3 ls
   
   # Create bucket if missing
   aws s3 mb s3://$AWS_S3_BUCKET_NAME --region $AWS_REGION
   ```

3. **CORS Configuration Missing**
   ```bash
   # Apply CORS configuration
   aws s3api put-bucket-cors --bucket $AWS_S3_BUCKET_NAME \
     --cors-configuration file://scripts/s3-cors.json
   ```

#### **Problem: "Upload exceeded file size limit"**
**Solution:**
```typescript
// Check and update limits in src/utils/constants.ts
export const MAX_FILE_SIZE = 500 * 1024 * 1024; // Increase if needed

// Also update nginx/cloudflare limits if using reverse proxy
```

### 2. Authentication Issues

#### **Problem: "Firebase ID token verification failed"**
```
Error: Firebase ID token has expired
```

**Solutions:**
1. **Token Expired**
   ```typescript
   // Frontend: Force token refresh
   const user = auth.currentUser;
   if (user) {
     const token = await user.getIdToken(true); // Force refresh
   }
   ```

2. **Firebase Admin Not Initialized**
   ```bash
   # Check Firebase environment variables
   npm run validate:env
   
   # Verify service account file exists
   ls -la $FIREBASE_ADMIN_SDK_PATH
   ```

3. **Clock Skew**
   ```bash
   # Sync system time
   sudo ntpdate -s time.nist.gov
   ```

### 3. Queue Processing Issues

#### **Problem: "Jobs stuck in processing state"**
**Diagnosis:**
```javascript
// Check queue status
const queue = queueManager.getQueue('image-processing');
const jobs = await queue.getJobs(['active', 'waiting', 'failed']);
console.log('Active jobs:', jobs.filter(j => j.opts.delay));
```

**Solutions:**
1. **Worker Crashed**
   ```bash
   # Restart workers
   npm run worker:restart
   
   # Check worker logs
   tail -f logs/worker-*.log
   ```

2. **Redis Connection Lost**
   ```bash
   # Test Redis connection
   redis-cli ping
   
   # Restart Redis if needed
   docker restart redis
   ```

3. **Clear Stuck Jobs**
   ```javascript
   // scripts/clear-stuck-jobs.js
   const queue = queueManager.getQueue('image-processing');
   const stuckJobs = await queue.getJobs(['active']);
   
   for (const job of stuckJobs) {
     if (Date.now() - job.timestamp > 3600000) { // 1 hour
       await job.moveToFailed(new Error('Job timeout'), true);
     }
   }
   ```

### 4. Database Issues

#### **Problem: "Connection pool exhausted"**
```
Error: remaining connection slots are reserved for non-replication superuser connections
```

**Solutions:**
1. **Increase Pool Size**
   ```typescript
   // Update database configuration
   const pool = new Pool({
     max: 50, // Increase from 20
     idleTimeoutMillis: 30000,
     connectionTimeoutMillis: 2000,
   });
   ```

2. **Find Connection Leaks**
   ```sql
   -- Check active connections
   SELECT pid, usename, application_name, client_addr, state
   FROM pg_stat_activity
   WHERE state = 'active';
   
   -- Kill idle connections
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE state = 'idle' AND state_change < current_timestamp - interval '10 minutes';
   ```

#### **Problem: "pgvector extension not found"**
```
Error: type "vector" does not exist
```

**Solution:**
```sql
-- Install pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify installation
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### 5. AI Service Issues

#### **Problem: "OpenAI API rate limit exceeded"**
```
Error: Rate limit reached for requests
```

**Solutions:**
1. **Implement Exponential Backoff**
   ```typescript
   async function retryWithBackoff(fn: Function, maxRetries = 5) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await fn();
       } catch (error) {
         if (error.status === 429 && i < maxRetries - 1) {
           const delay = Math.pow(2, i) * 1000;
           await new Promise(resolve => setTimeout(resolve, delay));
         } else {
           throw error;
         }
       }
     }
   }
   ```

2. **Use Request Batching**
   ```typescript
   // Batch embedding requests
   const batchSize = 100;
   const results = [];
   
   for (let i = 0; i < items.length; i += batchSize) {
     const batch = items.slice(i, i + batchSize);
     const embeddings = await openai.embeddings.create({
       input: batch,
       model: "text-embedding-ada-002"
     });
     results.push(...embeddings.data);
   }
   ```

#### **Problem: "AWS Rekognition returning empty results"**
**Solutions:**
1. **Check Image Format**
   ```typescript
   // Ensure image is in supported format
   const supportedFormats = ['JPEG', 'PNG'];
   const image = await sharp(buffer)
     .jpeg() // Convert to JPEG
     .toBuffer();
   ```

2. **Verify S3 Permissions**
   ```json
   // S3 bucket policy for Rekognition
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": {
         "Service": "rekognition.amazonaws.com"
       },
       "Action": ["s3:GetObject"],
       "Resource": "arn:aws:s3:::your-bucket/*"
     }]
   }
   ```

### 6. Search Issues

#### **Problem: "Vector similarity search returning no results"**
```sql
-- Debug vector search
SELECT 
  id,
  embedding <=> '[0.1, 0.2, ...]'::vector as distance
FROM embeddings
ORDER BY distance
LIMIT 10;
```

**Solutions:**
1. **Embedding Dimension Mismatch**
   ```sql
   -- Check embedding dimensions
   SELECT vector_dims(embedding) as dims, COUNT(*) 
   FROM embeddings 
   GROUP BY dims;
   ```

2. **Index Not Created**
   ```sql
   -- Create index for better performance
   CREATE INDEX embeddings_vector_idx ON embeddings 
   USING ivfflat (embedding vector_cosine_ops);
   ```

### 7. Performance Issues

#### **Problem: "Slow API response times"**
**Diagnosis Tools:**
```bash
# Check API response times
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000/api/search

# Monitor database queries
tail -f /var/log/postgresql/postgresql-*.log | grep -E "duration: [0-9]{4,}"
```

**Solutions:**
1. **Enable Query Caching**
   ```typescript
   // Add Redis caching layer
   const cached = await redis.get(cacheKey);
   if (cached) return JSON.parse(cached);
   
   const result = await expensive_operation();
   await redis.setex(cacheKey, 3600, JSON.stringify(result));
   ```

2. **Database Query Optimization**
   ```sql
   -- Add indexes for common queries
   CREATE INDEX idx_media_user_created ON media_items(user_id, created_at DESC);
   CREATE INDEX idx_media_status ON media_items(processing_status);
   ```

### 8. Memory Issues

#### **Problem: "JavaScript heap out of memory"**
**Solutions:**
1. **Increase Node Memory**
   ```bash
   # In package.json scripts
   "start": "node --max-old-space-size=4096 server.js"
   ```

2. **Stream Large Files**
   ```typescript
   // Use streams for large file processing
   import { pipeline } from 'stream/promises';
   
   await pipeline(
     fs.createReadStream(inputPath),
     processStream,
     fs.createWriteStream(outputPath)
   );
   ```

## 🔍 Debugging Procedures

### Trace a Failed Upload
```bash
# 1. Check frontend console
# Browser DevTools → Network tab → Look for failed requests

# 2. Check API logs
grep "upload" logs/api-*.log | grep ERROR

# 3. Check S3 logs
aws s3api get-bucket-logging --bucket $AWS_S3_BUCKET_NAME

# 4. Check worker logs
grep $MEDIA_ID logs/worker-*.log
```

### Debug Worker Health
```javascript
// scripts/check-worker-health.js
const workers = await workerManager.getWorkers();
for (const worker of workers) {
  console.log(`Worker ${worker.name}:`, {
    isRunning: worker.isRunning(),
    isPaused: worker.isPaused(),
    jobCounts: await worker.getJobCounts()
  });
}
```

## 🚑 Recovery Procedures

### Reprocess Failed Media
```javascript
// scripts/reprocess-failed-media.js
const failedMedia = await db('media_items')
  .where('processing_status', 'failed')
  .where('created_at', '>', '2024-01-01');

for (const media of failedMedia) {
  await queueManager.addImageProcessingJob({
    userId: media.user_id,
    mediaItemId: media.id,
    s3Key: media.s3_key,
    operations: { detectLabels: true, detectText: true }
  });
}
```

### Clear Corrupted Cache
```bash
# Clear all Redis cache
redis-cli FLUSHDB

# Clear specific cache pattern
redis-cli --scan --pattern "cache:user:*" | xargs redis-cli DEL
```

### Reset User Quotas
```sql
-- Reset monthly quotas
UPDATE users 
SET 
  uploads_this_month = 0,
  searches_this_month = 0,
  quota_reset_date = CURRENT_DATE
WHERE subscription_tier = 'premium';
```

## 📊 Monitoring Commands

### Check System Resources
```bash
# Memory usage
free -h
docker stats

# Disk usage
df -h
du -sh /var/lib/postgresql/data

# Connection counts
ss -tlnp | grep -E "5432|6379|3000"
```

### Application Metrics
```bash
# Check request rates
curl http://localhost:9090/metrics | grep http_requests_total

# Check queue depths
curl http://localhost:3000/api/admin/queues/stats

# Check error rates
grep ERROR logs/api-*.log | wc -l
```

## 🆘 Emergency Contacts

### When to Escalate
- Database corruption or data loss
- Security breach indicators
- Complete service outage > 30 minutes
- Billing/payment processing errors

### Escalation Path
1. Check this troubleshooting guide
2. Check service status pages (AWS, Firebase, Stripe)
3. Review recent deployments
4. Contact on-call engineer
5. Engage third-party support if needed

## 📝 Post-Incident Actions

### After Resolving Issues
1. Document the issue and resolution
2. Update this troubleshooting guide
3. Create monitoring alert for future detection
4. Schedule post-mortem if severity > medium
5. Update runbooks if needed

### Incident Report Template
```markdown
## Incident Report - [DATE]

**Severity:** High/Medium/Low
**Duration:** XX minutes
**Impact:** X users affected

**Timeline:**
- HH:MM - Issue detected
- HH:MM - Investigation started
- HH:MM - Root cause identified
- HH:MM - Fix applied
- HH:MM - Service restored

**Root Cause:**
[Description]

**Resolution:**
[Steps taken]

**Prevention:**
[Future prevention measures]
```