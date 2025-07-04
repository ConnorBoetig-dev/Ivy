# Operational Runbooks

## 📋 Daily Operations

### Morning Health Check (9:00 AM)
**Time Required:** 15 minutes

```bash
#!/bin/bash
# Daily health check script

echo "🏥 Starting Daily Health Check - $(date)"

# 1. Check service status
echo "1️⃣ Checking services..."
systemctl status nginx
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 2. Check disk space
echo "2️⃣ Checking disk space..."
df -h | grep -E "^/|%"

# 3. Check database connections
echo "3️⃣ Checking database..."
psql -U $DB_USER -d $DB_NAME -c "SELECT count(*) FROM pg_stat_activity;"

# 4. Check Redis
echo "4️⃣ Checking Redis..."
redis-cli info stats | grep instantaneous_ops_per_sec

# 5. Check queue depths
echo "5️⃣ Checking queues..."
curl -s http://localhost:3000/api/admin/queues/stats | jq

# 6. Check error rates
echo "6️⃣ Checking errors (last 24h)..."
grep -c ERROR logs/api-$(date +%Y-%m-%d).log || echo "0"

echo "✅ Health check complete"
```

### User Metrics Review
**Frequency:** Daily at 10:00 AM

1. **Check active users**
   ```sql
   -- Daily active users
   SELECT COUNT(DISTINCT user_id) as dau
   FROM user_activity
   WHERE created_at >= CURRENT_DATE;
   
   -- New signups
   SELECT COUNT(*) as new_users
   FROM users
   WHERE created_at >= CURRENT_DATE;
   ```

2. **Check usage metrics**
   ```sql
   -- Upload activity
   SELECT 
     COUNT(*) as uploads_today,
     SUM(file_size) / 1024 / 1024 as mb_uploaded
   FROM media_items
   WHERE created_at >= CURRENT_DATE;
   
   -- Search activity
   SELECT COUNT(*) as searches_today
   FROM search_history
   WHERE created_at >= CURRENT_DATE;
   ```

3. **Check system performance**
   ```bash
   # Average response times
   grep "POST /api" logs/access.log | awk '{sum+=$10; count++} END {print sum/count}'
   ```

---

## 📅 Weekly Operations

### Monday: Backup Verification
**Time Required:** 30 minutes

```bash
#!/bin/bash
# Weekly backup verification

# 1. Verify database backups
echo "Checking database backups..."
aws s3 ls s3://your-backup-bucket/postgres/ --recursive | tail -5

# 2. Test restore process (on staging)
echo "Testing restore on staging..."
pg_restore -h staging-db -U postgres -d test_restore latest_backup.dump

# 3. Verify media file backups
echo "Checking media backups..."
aws s3 ls s3://your-backup-bucket/media/ --summarize

# 4. Document backup sizes and times
echo "Backup completed at $(date)" >> backup-log.txt
```

### Wednesday: Security Review
**Time Required:** 45 minutes

1. **Review authentication logs**
   ```bash
   # Failed login attempts
   grep "authentication failed" logs/auth-*.log | wc -l
   
   # Suspicious patterns
   grep -E "SQL injection|XSS|../|<script" logs/api-*.log
   ```

2. **Check for unusual activity**
   ```sql
   -- Unusual upload patterns
   SELECT user_id, COUNT(*) as upload_count
   FROM media_items
   WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
   GROUP BY user_id
   HAVING COUNT(*) > 100
   ORDER BY upload_count DESC;
   
   -- Large number of searches
   SELECT user_id, COUNT(*) as search_count
   FROM search_history
   WHERE created_at >= CURRENT_DATE - INTERVAL '1 day'
   GROUP BY user_id
   HAVING COUNT(*) > 500;
   ```

3. **Review AWS access logs**
   ```bash
   # Check for unauthorized S3 access
   aws s3api get-bucket-logging --bucket $AWS_S3_BUCKET_NAME
   ```

### Friday: Performance Review
**Time Required:** 1 hour

```bash
#!/bin/bash
# Weekly performance review

# 1. Generate performance report
echo "=== Weekly Performance Report ===" > weekly-report.txt
echo "Generated: $(date)" >> weekly-report.txt

# 2. Database performance
psql -U $DB_USER -d $DB_NAME << EOF >> weekly-report.txt
-- Slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Table sizes
SELECT schemaname, tablename, 
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
EOF

# 3. Redis performance
redis-cli info stats >> weekly-report.txt

# 4. API performance
echo "=== API Performance ===" >> weekly-report.txt
curl -s http://localhost:9090/metrics | grep -E "http_request_duration|http_requests_total" >> weekly-report.txt
```

---

## 📆 Monthly Operations

### Cost Review (1st of Month)
**Time Required:** 2 hours

1. **AWS Cost Analysis**
   ```bash
   # Get monthly AWS costs
   aws ce get-cost-and-usage \
     --time-period Start=$(date -d "1 month ago" +%Y-%m-01),End=$(date +%Y-%m-01) \
     --granularity MONTHLY \
     --metrics "UnblendedCost" \
     --group-by Type=DIMENSION,Key=SERVICE
   ```

2. **Service Cost Breakdown**
   ```sql
   -- Cost by service
   SELECT 
     service,
     COUNT(*) as api_calls,
     SUM(cost) as total_cost,
     AVG(cost) as avg_cost
   FROM cost_tracking
   WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
   GROUP BY service
   ORDER BY total_cost DESC;
   
   -- Cost by user tier
   SELECT 
     u.subscription_tier,
     COUNT(DISTINCT ct.user_id) as users,
     SUM(ct.cost) as total_cost,
     AVG(ct.cost) as avg_cost_per_user
   FROM cost_tracking ct
   JOIN users u ON ct.user_id = u.id
   WHERE ct.created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
   GROUP BY u.subscription_tier;
   ```

3. **Generate cost report**
   ```bash
   # Create monthly cost report
   python scripts/generate_cost_report.py --month $(date -d "1 month ago" +%Y-%m)
   ```

### Database Maintenance (15th of Month)
**Time Required:** 3 hours (can run overnight)

```sql
-- 1. Update statistics
ANALYZE;

-- 2. Reindex tables
REINDEX TABLE media_items;
REINDEX TABLE embeddings;
REINDEX TABLE search_history;

-- 3. Vacuum tables
VACUUM ANALYZE media_items;
VACUUM ANALYZE embeddings;

-- 4. Check for bloat
SELECT 
  schemaname, tablename, 
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  n_dead_tup, n_live_tup,
  round(n_dead_tup::float / NULLIF(n_live_tup, 0), 4) as dead_ratio
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY dead_ratio DESC;
```

### Security Audit (Last Monday)
**Time Required:** 4 hours

1. **Dependency audit**
   ```bash
   # Check for vulnerabilities
   npm audit
   npm audit fix --dry-run
   
   # Check Docker images
   docker scan ai-media-search:latest
   ```

2. **Access review**
   ```bash
   # Review SSH access
   last -20
   
   # Review sudo usage
   grep sudo /var/log/auth.log | tail -50
   ```

3. **Certificate check**
   ```bash
   # Check SSL certificate expiration
   echo | openssl s_client -servername yourdomain.com -connect yourdomain.com:443 2>/dev/null | openssl x509 -noout -dates
   ```

---

## 🚨 Emergency Procedures

### Complete Service Outage

**Severity:** Critical  
**Response Time:** Immediate

1. **Immediate Actions** (First 5 minutes)
   ```bash
   # Check if services are running
   systemctl status nginx
   docker ps
   
   # Check disk space (common cause)
   df -h
   
   # Check memory
   free -h
   
   # Restart critical services
   docker-compose restart
   systemctl restart nginx
   ```

2. **Diagnostics** (5-15 minutes)
   ```bash
   # Check recent logs
   tail -100 /var/log/syslog
   journalctl -u nginx -n 100
   docker logs api-container --tail 100
   
   # Check for DDoS
   netstat -an | grep :443 | wc -l
   ```

3. **Recovery** (15-30 minutes)
   ```bash
   # If database issue
   docker restart postgres
   
   # If Redis issue
   docker restart redis
   
   # If application issue
   docker-compose down
   docker-compose up -d
   ```

### Database Connection Exhaustion

**Severity:** High  
**Response Time:** 5 minutes

```sql
-- 1. Check current connections
SELECT count(*) FROM pg_stat_activity;

-- 2. Kill idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle' 
  AND state_change < current_timestamp - interval '5 minutes';

-- 3. Identify connection hogs
SELECT usename, application_name, count(*)
FROM pg_stat_activity
GROUP BY usename, application_name
ORDER BY count DESC;
```

```bash
# 4. Restart connection pool
docker restart api-container

# 5. Monitor recovery
watch -n 5 'psql -c "SELECT count(*) FROM pg_stat_activity"'
```

### Disk Space Emergency

**Severity:** High  
**Response Time:** Immediate

```bash
#!/bin/bash
# Emergency disk cleanup

# 1. Find large files
du -h / | sort -rh | head -20

# 2. Clean logs
find /logs -name "*.log" -mtime +7 -delete
journalctl --vacuum-time=2d

# 3. Clean Docker
docker system prune -af
docker volume prune -f

# 4. Clean old backups
find /backups -name "*.dump" -mtime +30 -delete

# 5. Clean tmp
rm -rf /tmp/*
```

### Payment Processing Failure

**Severity:** High  
**Response Time:** 15 minutes

1. **Check Stripe status**
   ```bash
   curl https://status.stripe.com/api/v2/status.json | jq
   ```

2. **Check webhook logs**
   ```bash
   grep webhook logs/api-*.log | grep -E "failed|error"
   ```

3. **Replay failed webhooks**
   ```javascript
   // scripts/replay-webhooks.js
   const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
   
   // List failed events
   const events = await stripe.events.list({
     type: 'invoice.payment_failed',
     created: { gte: Math.floor(Date.now() / 1000) - 86400 }
   });
   
   // Replay each event
   for (const event of events.data) {
     await processWebhook(event);
   }
   ```

---

## 📊 Monitoring & Alerting

### Alert Response Procedures

#### High CPU Alert (>80% for 5 minutes)
1. Identify process: `top -b -n 1 | head -20`
2. Check for runaway queries: `SELECT * FROM pg_stat_activity WHERE state = 'active'`
3. Scale horizontally if needed: `docker-compose scale worker=4`

#### High Memory Alert (>90%)
1. Check for memory leaks: `ps aux --sort=-%mem | head`
2. Restart affected service: `docker restart [container]`
3. Analyze heap dump if Node.js: `node --inspect`

#### Queue Depth Alert (>1000 jobs)
1. Check worker status: `docker logs worker-container`
2. Scale workers: `docker-compose scale worker=8`
3. Check for failed jobs: `curl http://localhost:3000/api/admin/queues/failed`

---

## 🔧 Maintenance Windows

### Planned Maintenance Template

**Pre-Maintenance (T-24 hours)**
1. Send notification to users
2. Update status page
3. Prepare rollback plan
4. Test changes on staging

**Maintenance Window**
```bash
#!/bin/bash
# Maintenance script

# 1. Enable maintenance mode
touch /var/www/maintenance.flag

# 2. Stop job processing
docker stop worker-container

# 3. Backup database
pg_dump -U $DB_USER $DB_NAME > backup-$(date +%Y%m%d-%H%M%S).dump

# 4. Apply changes
[Your maintenance tasks here]

# 5. Test critical paths
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/auth/test

# 6. Resume services
docker start worker-container
rm /var/www/maintenance.flag
```

**Post-Maintenance**
1. Verify all services operational
2. Monitor error rates for 30 minutes
3. Update status page
4. Document any issues

---

## 📝 Incident Response

### Incident Commander Checklist

1. **Assess** (0-5 minutes)
   - [ ] Determine severity
   - [ ] Identify affected systems
   - [ ] Estimate user impact

2. **Communicate** (5-10 minutes)
   - [ ] Update status page
   - [ ] Notify team members
   - [ ] Start incident channel/call

3. **Mitigate** (10-30 minutes)
   - [ ] Apply immediate fixes
   - [ ] Scale resources if needed
   - [ ] Enable circuit breakers

4. **Resolve** (30+ minutes)
   - [ ] Implement permanent fix
   - [ ] Verify resolution
   - [ ] Monitor for recurrence

5. **Document** (Post-incident)
   - [ ] Create incident report
   - [ ] Schedule post-mortem
   - [ ] Update runbooks

---

## 🔄 Automated Tasks

### Cron Schedule
```cron
# Database backup - every 6 hours
0 */6 * * * /scripts/backup-database.sh

# Log rotation - daily at 2 AM
0 2 * * * /scripts/rotate-logs.sh

# Usage report - daily at 6 AM
0 6 * * * /scripts/generate-usage-report.sh

# Cost tracking - hourly
0 * * * * /scripts/update-cost-tracking.sh

# Health check - every 5 minutes
*/5 * * * * /scripts/health-check.sh

# Certificate renewal check - weekly
0 0 * * 0 /scripts/check-certs.sh

# Database maintenance - monthly
0 3 15 * * /scripts/db-maintenance.sh
```

---

## 📚 Reference Commands

### Quick Diagnostics
```bash
# System resources
alias sysinfo='echo "=== CPU ===" && top -bn1 | head -5 && echo -e "\n=== Memory ===" && free -h && echo -e "\n=== Disk ===" && df -h'

# Service status
alias status='docker ps && echo -e "\n=== Redis ===" && redis-cli ping && echo -e "\n=== Postgres ===" && psql -c "SELECT 1"'

# Recent errors
alias errors='grep ERROR logs/api-$(date +%Y-%m-%d).log | tail -20'

# Queue status
alias queues='curl -s http://localhost:3000/api/admin/queues/stats | jq'
```

### Database Queries
```sql
-- Active operations
CREATE VIEW active_operations AS
SELECT 
  'upload' as operation, COUNT(*) as count
FROM media_items 
WHERE processing_status IN ('pending', 'processing')
UNION ALL
SELECT 
  'search' as operation, COUNT(*) as count
FROM search_history
WHERE created_at > NOW() - INTERVAL '1 minute';

-- User activity summary
CREATE VIEW user_activity_summary AS
SELECT 
  u.email,
  u.subscription_tier,
  COUNT(DISTINCT m.id) as media_count,
  COUNT(DISTINCT s.id) as search_count,
  MAX(m.created_at) as last_upload,
  MAX(s.created_at) as last_search
FROM users u
LEFT JOIN media_items m ON u.id = m.user_id
LEFT JOIN search_history s ON u.id = s.user_id
GROUP BY u.id, u.email, u.subscription_tier;
```

---

## 🎯 Success Metrics

Track these KPIs:
1. **Uptime**: Target 99.9% (43 minutes/month downtime)
2. **Response Time**: p95 < 500ms for API calls
3. **Queue Processing**: 95% of jobs completed within 5 minutes
4. **Error Rate**: < 0.1% of requests
5. **Cost Efficiency**: < $0.10 per active user per month