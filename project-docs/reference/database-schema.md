# Database Schema Documentation

## 🗄️ Complete Database Design for AI Media Search

### 🎯 Overview
This document defines the complete PostgreSQL database schema with pgvector extension for the AI Media Search application, including all tables, relationships, indexes, and Row Level Security policies.

---

## 📊 Database Architecture

### **Technology Stack**
- **Database**: PostgreSQL 15+
- **Vector Extension**: pgvector for similarity search
- **Connection Pooling**: Built-in PostgreSQL pooling
- **Security**: Row Level Security (RLS) for data isolation
- **Backup**: Automated daily backups with point-in-time recovery

---

## 🏗️ Schema Overview

```sql
-- Database Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Schema Structure
ai_media_search/
├── users                    # User accounts and subscription info
├── media_files             # Uploaded media file metadata
├── media_embeddings        # Vector embeddings for search
├── processing_jobs         # Background job tracking
├── search_history          # User search analytics
├── cost_tracking           # Service cost monitoring
├── usage_limits            # Subscription tier limits
└── audit_logs              # System audit trail
```

---

## 📋 Core Tables

### **1. Users Table**
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firebase_uid VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    avatar_url TEXT,
    
    -- Subscription Information
    subscription_tier VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'premium', 'ultimate')),
    subscription_status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'inactive', 'cancelled', 'suspended')),
    subscription_started_at TIMESTAMP WITH TIME ZONE,
    subscription_ends_at TIMESTAMP WITH TIME ZONE,
    stripe_customer_id VARCHAR(255) UNIQUE,
    stripe_subscription_id VARCHAR(255),
    
    -- Usage Tracking
    uploads_this_month INTEGER NOT NULL DEFAULT 0,
    searches_this_month INTEGER NOT NULL DEFAULT 0,
    storage_used_bytes BIGINT NOT NULL DEFAULT 0,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Billing Period Tracking
    billing_period_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    billing_period_end TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '1 month'),
    
    -- Audit Fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT positive_storage CHECK (storage_used_bytes >= 0),
    CONSTRAINT positive_usage CHECK (uploads_this_month >= 0 AND searches_this_month >= 0)
);

-- Indexes
CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_subscription_tier ON users(subscription_tier);
CREATE INDEX idx_users_subscription_status ON users(subscription_status);
CREATE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX idx_users_last_activity ON users(last_activity_at);
CREATE INDEX idx_users_billing_period ON users(billing_period_start, billing_period_end);
```

### **2. Media Files Table**
```sql
CREATE TABLE media_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- File Information
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(10) NOT NULL CHECK (file_type IN ('image', 'video')),
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    
    -- Storage Information
    s3_key VARCHAR(500) NOT NULL UNIQUE,
    s3_bucket VARCHAR(100) NOT NULL,
    thumbnail_s3_key VARCHAR(500),
    
    -- Processing Status
    status VARCHAR(20) NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'queued', 'processing', 'completed', 'failed', 'deleted')),
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    processing_error TEXT,
    
    -- Media Metadata
    width INTEGER,
    height INTEGER,
    duration_seconds DECIMAL(10,3), -- For videos
    frame_rate DECIMAL(5,2), -- For videos
    has_audio BOOLEAN DEFAULT false,
    
    -- AI Analysis Results
    ai_summary TEXT,
    detected_labels JSONB DEFAULT '[]'::jsonb,
    detected_faces_count INTEGER DEFAULT 0,
    detected_text TEXT[],
    transcription_text TEXT, -- For videos with audio
    sentiment VARCHAR(20) CHECK (sentiment IN ('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED')),
    content_warnings TEXT[],
    
    -- User Metadata
    tags TEXT[],
    custom_metadata JSONB DEFAULT '{}'::jsonb,
    is_private BOOLEAN NOT NULL DEFAULT false,
    
    -- Analytics
    view_count INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit Fields
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT positive_file_size CHECK (file_size_bytes > 0),
    CONSTRAINT valid_dimensions CHECK (width > 0 AND height > 0),
    CONSTRAINT valid_duration CHECK (duration_seconds >= 0),
    CONSTRAINT valid_frame_rate CHECK (frame_rate > 0),
    CONSTRAINT positive_face_count CHECK (detected_faces_count >= 0),
    CONSTRAINT positive_view_count CHECK (view_count >= 0)
);

-- Indexes
CREATE INDEX idx_media_files_user_id ON media_files(user_id);
CREATE INDEX idx_media_files_file_type ON media_files(file_type);
CREATE INDEX idx_media_files_status ON media_files(status);
CREATE INDEX idx_media_files_uploaded_at ON media_files(uploaded_at);
CREATE INDEX idx_media_files_s3_key ON media_files(s3_key);
CREATE INDEX idx_media_files_tags ON media_files USING GIN(tags);
CREATE INDEX idx_media_files_detected_labels ON media_files USING GIN(detected_labels);
CREATE INDEX idx_media_files_custom_metadata ON media_files USING GIN(custom_metadata);
CREATE INDEX idx_media_files_processing_status ON media_files(status, processing_started_at);
```

### **3. Media Embeddings Table**
```sql
CREATE TABLE media_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    media_file_id UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    
    -- Embedding Information
    embedding vector(1536) NOT NULL, -- OpenAI text-embedding-3-small dimension
    source_text TEXT NOT NULL, -- The text that was embedded
    embedding_model VARCHAR(50) NOT NULL DEFAULT 'text-embedding-3-small',
    embedding_version VARCHAR(10) NOT NULL DEFAULT 'v1',
    
    -- Temporal Information (for video segments)
    start_time_seconds DECIMAL(10,3), -- For video segment embeddings
    end_time_seconds DECIMAL(10,3),
    segment_type VARCHAR(20) DEFAULT 'full' CHECK (segment_type IN ('full', 'temporal', 'audio', 'visual')),
    
    -- Quality Metrics
    confidence_score DECIMAL(5,4), -- 0.0 to 1.0
    source_quality VARCHAR(20) CHECK (source_quality IN ('high', 'medium', 'low')),
    
    -- Audit Fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_time_range CHECK (start_time_seconds <= end_time_seconds),
    CONSTRAINT valid_confidence CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0)
);

-- Indexes for Vector Search
CREATE INDEX idx_media_embeddings_media_file_id ON media_embeddings(media_file_id);
CREATE INDEX idx_media_embeddings_vector ON media_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_media_embeddings_segment_type ON media_embeddings(segment_type);
CREATE INDEX idx_media_embeddings_temporal ON media_embeddings(start_time_seconds, end_time_seconds);
```

### **4. Processing Jobs Table**
```sql
CREATE TABLE processing_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    media_file_id UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Job Information
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('image_analysis', 'video_analysis', 'transcription', 'text_analysis', 'embedding_generation')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retrying')),
    priority INTEGER NOT NULL DEFAULT 5, -- 1 = highest, 10 = lowest
    
    -- Progress Tracking
    progress_percentage INTEGER NOT NULL DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    estimated_completion_at TIMESTAMP WITH TIME ZONE,
    
    -- Job Configuration
    job_config JSONB DEFAULT '{}'::jsonb,
    subscription_tier VARCHAR(20) NOT NULL,
    
    -- Retry Logic
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    retry_at TIMESTAMP WITH TIME ZONE,
    
    -- Results
    result_data JSONB,
    error_message TEXT,
    error_code VARCHAR(50),
    
    -- Cost Tracking
    estimated_cost DECIMAL(10,4),
    actual_cost DECIMAL(10,4),
    cost_currency VARCHAR(3) DEFAULT 'USD',
    
    -- Timing
    queued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit Fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_priority CHECK (priority >= 1 AND priority <= 10),
    CONSTRAINT valid_attempts CHECK (attempts <= max_attempts),
    CONSTRAINT positive_cost CHECK (estimated_cost >= 0 AND actual_cost >= 0)
);

-- Indexes
CREATE INDEX idx_processing_jobs_media_file_id ON processing_jobs(media_file_id);
CREATE INDEX idx_processing_jobs_user_id ON processing_jobs(user_id);
CREATE INDEX idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX idx_processing_jobs_job_type ON processing_jobs(job_type);
CREATE INDEX idx_processing_jobs_priority ON processing_jobs(priority, queued_at);
CREATE INDEX idx_processing_jobs_retry ON processing_jobs(retry_at) WHERE retry_at IS NOT NULL;
CREATE INDEX idx_processing_jobs_subscription_tier ON processing_jobs(subscription_tier);
```

### **5. Search History Table**
```sql
CREATE TABLE search_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Search Information
    query_text TEXT NOT NULL,
    query_embedding vector(1536), -- Embedded query for analysis
    
    -- Search Configuration
    filters JSONB DEFAULT '{}'::jsonb,
    sort_by VARCHAR(50),
    sort_order VARCHAR(4) CHECK (sort_order IN ('asc', 'desc')),
    limit_count INTEGER,
    offset_count INTEGER DEFAULT 0,
    
    -- Results
    results_count INTEGER NOT NULL DEFAULT 0,
    response_time_ms INTEGER,
    cache_hit BOOLEAN NOT NULL DEFAULT false,
    
    -- User Interaction
    clicked_results UUID[], -- Array of media_file_id that were clicked
    click_through_rate DECIMAL(5,4), -- Percentage of results clicked
    
    -- Analytics
    search_session_id UUID, -- Group related searches
    source_page VARCHAR(100), -- Where search originated
    user_agent TEXT,
    ip_address INET,
    
    -- Audit Fields
    searched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT positive_results CHECK (results_count >= 0),
    CONSTRAINT positive_response_time CHECK (response_time_ms >= 0),
    CONSTRAINT valid_click_rate CHECK (click_through_rate >= 0.0 AND click_through_rate <= 1.0)
);

-- Indexes
CREATE INDEX idx_search_history_user_id ON search_history(user_id);
CREATE INDEX idx_search_history_searched_at ON search_history(searched_at);
CREATE INDEX idx_search_history_query_text ON search_history USING GIN(to_tsvector('english', query_text));
CREATE INDEX idx_search_history_session ON search_history(search_session_id);
CREATE INDEX idx_search_history_performance ON search_history(response_time_ms, cache_hit);
```

### **6. Cost Tracking Table**
```sql
CREATE TABLE cost_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Service Information
    service_name VARCHAR(50) NOT NULL CHECK (service_name IN ('aws_rekognition', 'aws_transcribe', 'aws_comprehend', 'aws_s3', 'openai_embeddings', 'openai_gpt')),
    operation_type VARCHAR(50) NOT NULL,
    
    -- Cost Details
    amount DECIMAL(10,4) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    billing_unit VARCHAR(20), -- 'per_request', 'per_mb', 'per_token', etc.
    units_consumed DECIMAL(12,4),
    
    -- Context
    media_file_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
    processing_job_id UUID REFERENCES processing_jobs(id) ON DELETE SET NULL,
    reference_id VARCHAR(255), -- External service reference
    
    -- Billing Period
    billing_period_month INTEGER NOT NULL,
    billing_period_year INTEGER NOT NULL,
    
    -- Metadata
    service_metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Audit Fields
    incurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT positive_amount CHECK (amount >= 0),
    CONSTRAINT valid_month CHECK (billing_period_month >= 1 AND billing_period_month <= 12),
    CONSTRAINT valid_year CHECK (billing_period_year >= 2024),
    CONSTRAINT positive_units CHECK (units_consumed >= 0)
);

-- Indexes
CREATE INDEX idx_cost_tracking_user_id ON cost_tracking(user_id);
CREATE INDEX idx_cost_tracking_service ON cost_tracking(service_name, operation_type);
CREATE INDEX idx_cost_tracking_billing_period ON cost_tracking(billing_period_year, billing_period_month);
CREATE INDEX idx_cost_tracking_media_file ON cost_tracking(media_file_id);
CREATE INDEX idx_cost_tracking_incurred_at ON cost_tracking(incurred_at);
```

### **7. Usage Limits Table**
```sql
CREATE TABLE usage_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Tier Configuration
    tier_name VARCHAR(20) NOT NULL UNIQUE CHECK (tier_name IN ('free', 'premium', 'ultimate')),
    
    -- Monthly Limits
    max_uploads_per_month INTEGER NOT NULL,
    max_searches_per_month INTEGER NOT NULL,
    max_storage_bytes BIGINT NOT NULL,
    
    -- Processing Limits
    max_file_size_bytes BIGINT NOT NULL,
    max_video_duration_seconds INTEGER,
    priority_level INTEGER NOT NULL DEFAULT 5,
    
    -- Feature Access
    features_enabled TEXT[] NOT NULL DEFAULT '{}',
    ai_features_enabled TEXT[] NOT NULL DEFAULT '{}',
    
    -- Cost Limits
    max_monthly_cost DECIMAL(10,2),
    cost_alert_threshold DECIMAL(5,4) DEFAULT 0.8, -- 80%
    
    -- API Rate Limits (per hour)
    api_rate_limit INTEGER NOT NULL DEFAULT 100,
    upload_rate_limit INTEGER NOT NULL DEFAULT 10,
    search_rate_limit INTEGER NOT NULL DEFAULT 50,
    
    -- Support Level
    support_level VARCHAR(20) NOT NULL DEFAULT 'community' CHECK (support_level IN ('community', 'email', 'priority')),
    
    -- Audit Fields
    effective_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    effective_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT positive_limits CHECK (
        max_uploads_per_month >= 0 AND 
        max_searches_per_month >= 0 AND 
        max_storage_bytes >= 0 AND
        max_file_size_bytes > 0
    ),
    CONSTRAINT valid_priority CHECK (priority_level >= 1 AND priority_level <= 10),
    CONSTRAINT valid_cost_threshold CHECK (cost_alert_threshold > 0.0 AND cost_alert_threshold <= 1.0)
);

-- Insert default tier configurations
INSERT INTO usage_limits (tier_name, max_uploads_per_month, max_searches_per_month, max_storage_bytes, max_file_size_bytes, max_video_duration_seconds, priority_level, features_enabled, ai_features_enabled, max_monthly_cost, api_rate_limit, upload_rate_limit, search_rate_limit, support_level) VALUES
('free', 10, 50, 5368709120, 104857600, 300, 5, '{"basic_upload", "basic_search"}', '{"basic_analysis"}', 5.00, 100, 5, 50, 'community'),
('premium', 100, 500, 53687091200, 524288000, 1800, 3, '{"advanced_upload", "advanced_search", "export", "sharing"}', '{"full_analysis", "celebrity_detection", "content_moderation"}', 50.00, 500, 20, 200, 'email'),
('ultimate', -1, -1, 536870912000, 2147483648, 7200, 1, '{"all_features"}', '{"all_ai_features", "custom_models", "api_access"}', 200.00, 1000, 50, 500, 'priority');
```

### **8. Audit Logs Table**
```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Event Information
    event_type VARCHAR(50) NOT NULL,
    event_category VARCHAR(30) NOT NULL CHECK (event_category IN ('auth', 'upload', 'search', 'billing', 'admin', 'security')),
    
    -- Actor Information
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_type VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system', 'admin', 'service')),
    actor_identifier VARCHAR(255), -- email, service name, etc.
    
    -- Target Information
    target_type VARCHAR(50), -- 'media_file', 'user', 'subscription', etc.
    target_id UUID,
    
    -- Event Details
    action VARCHAR(50) NOT NULL, -- 'create', 'update', 'delete', 'view', etc.
    description TEXT,
    
    -- Context
    ip_address INET,
    user_agent TEXT,
    session_id VARCHAR(255),
    request_id UUID,
    
    -- Changes (for update operations)
    old_values JSONB,
    new_values JSONB,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    risk_level VARCHAR(10) DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    
    -- Timing
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT audit_logs_check_target CHECK (
        (target_type IS NOT NULL AND target_id IS NOT NULL) OR 
        (target_type IS NULL AND target_id IS NULL)
    )
);

-- Indexes
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_event_category ON audit_logs(event_category);
CREATE INDEX idx_audit_logs_occurred_at ON audit_logs(occurred_at);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_type, actor_identifier);
CREATE INDEX idx_audit_logs_risk_level ON audit_logs(risk_level);
CREATE INDEX idx_audit_logs_ip_address ON audit_logs(ip_address);
```

---

## 🔒 Row Level Security (RLS) Policies

### **Enable RLS on All Tables**
```sql
-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
```

### **User Data Isolation Policies**
```sql
-- Users can only see their own data
CREATE POLICY users_isolation_policy ON users
    FOR ALL USING (id = current_setting('app.current_user_id')::uuid);

-- Media files access policy
CREATE POLICY media_files_user_policy ON media_files
    FOR ALL USING (user_id = current_setting('app.current_user_id')::uuid);

-- Media embeddings follow media files policy
CREATE POLICY media_embeddings_user_policy ON media_embeddings
    FOR ALL USING (
        media_file_id IN (
            SELECT id FROM media_files 
            WHERE user_id = current_setting('app.current_user_id')::uuid
        )
    );

-- Processing jobs policy
CREATE POLICY processing_jobs_user_policy ON processing_jobs
    FOR ALL USING (user_id = current_setting('app.current_user_id')::uuid);

-- Search history policy
CREATE POLICY search_history_user_policy ON search_history
    FOR ALL USING (user_id = current_setting('app.current_user_id')::uuid);

-- Cost tracking policy
CREATE POLICY cost_tracking_user_policy ON cost_tracking
    FOR ALL USING (user_id = current_setting('app.current_user_id')::uuid);

-- Audit logs - users can see their own actions
CREATE POLICY audit_logs_user_policy ON audit_logs
    FOR SELECT USING (user_id = current_setting('app.current_user_id')::uuid);
```

### **Admin Access Policies**
```sql
-- Admin users can access all data
CREATE POLICY admin_access_policy ON users
    FOR ALL TO admin_role USING (true);

CREATE POLICY admin_media_policy ON media_files
    FOR ALL TO admin_role USING (true);

CREATE POLICY admin_audit_policy ON audit_logs
    FOR ALL TO admin_role USING (true);
```

---

## ⚡ Performance Optimizations

### **Vector Search Optimization**
```sql
-- Optimize vector index for large datasets
CREATE INDEX CONCURRENTLY idx_media_embeddings_vector_hnsw 
ON media_embeddings USING hnsw (embedding vector_cosine_ops);

-- Partition large tables by date
CREATE TABLE search_history_2024 PARTITION OF search_history
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

-- Partial indexes for common queries
CREATE INDEX idx_media_files_active ON media_files(user_id, uploaded_at) 
    WHERE status = 'completed' AND deleted_at IS NULL;
```

### **Query Optimization Views**
```sql
-- User dashboard summary view
CREATE VIEW user_dashboard_summary AS
SELECT 
    u.id,
    u.subscription_tier,
    u.uploads_this_month,
    u.searches_this_month,
    u.storage_used_bytes,
    ul.max_uploads_per_month,
    ul.max_searches_per_month,
    ul.max_storage_bytes,
    COUNT(mf.id) as total_files,
    COUNT(CASE WHEN mf.status = 'completed' THEN 1 END) as processed_files,
    COALESCE(SUM(ct.amount), 0) as current_month_cost
FROM users u
LEFT JOIN usage_limits ul ON u.subscription_tier = ul.tier_name
LEFT JOIN media_files mf ON u.id = mf.user_id AND mf.deleted_at IS NULL
LEFT JOIN cost_tracking ct ON u.id = ct.user_id 
    AND ct.billing_period_year = EXTRACT(YEAR FROM NOW())
    AND ct.billing_period_month = EXTRACT(MONTH FROM NOW())
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.subscription_tier, u.uploads_this_month, u.searches_this_month, 
         u.storage_used_bytes, ul.max_uploads_per_month, ul.max_searches_per_month, ul.max_storage_bytes;
```

---

## 🔧 Database Functions & Triggers

### **Automatic Timestamp Updates**
```sql
-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_media_files_updated_at BEFORE UPDATE ON media_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_processing_jobs_updated_at BEFORE UPDATE ON processing_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### **Usage Tracking Functions**
```sql
-- Function to reset monthly usage
CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS void AS $$
BEGIN
    UPDATE users SET 
        uploads_this_month = 0,
        searches_this_month = 0,
        billing_period_start = NOW(),
        billing_period_end = NOW() + INTERVAL '1 month'
    WHERE billing_period_end <= NOW();
END;
$$ LANGUAGE plpgsql;

-- Schedule monthly reset (requires pg_cron extension)
-- SELECT cron.schedule('reset-monthly-usage', '0 0 1 * *', 'SELECT reset_monthly_usage();');
```

---

## 📊 Sample Queries

### **Vector Similarity Search**
```sql
-- Find similar media by embedding
SELECT 
    mf.id,
    mf.filename,
    mf.ai_summary,
    1 - (me.embedding <=> $1::vector) as similarity_score
FROM media_embeddings me
JOIN media_files mf ON me.media_file_id = mf.id
WHERE mf.user_id = $2
    AND mf.status = 'completed'
    AND mf.deleted_at IS NULL
ORDER BY me.embedding <=> $1::vector
LIMIT 20;
```

### **User Analytics Query**
```sql
-- User activity summary
SELECT 
    DATE_TRUNC('day', sh.searched_at) as date,
    COUNT(sh.id) as search_count,
    AVG(sh.response_time_ms) as avg_response_time,
    AVG(sh.click_through_rate) as avg_click_rate
FROM search_history sh
WHERE sh.user_id = $1
    AND sh.searched_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', sh.searched_at)
ORDER BY date DESC;
```

---

## 🚀 Migration Scripts

### **Initial Migration (001_initial_schema.sql)**
```sql
-- This file would contain all the CREATE TABLE statements above
-- Run with: psql -d ai_media_search -f migrations/001_initial_schema.sql
```

### **Add Indexes Migration (002_add_indexes.sql)**
```sql
-- All index creation statements
-- Run with: psql -d ai_media_search -f migrations/002_add_indexes.sql
```

---

## 🔍 Monitoring & Maintenance

### **Performance Monitoring Queries**
```sql
-- Table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(tablename::text)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(tablename::text) DESC;

-- Index usage statistics
SELECT 
    indexrelname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

### **Backup & Recovery**
```bash
# Daily backup script
pg_dump -h localhost -U postgres -d ai_media_search -f backup_$(date +%Y%m%d).sql

# Point-in-time recovery setup
# Enable archive_mode and configure archive_command in postgresql.conf
```

---

**Last Updated**: 2024-01-15  
**Schema Version**: 1.0  
**Next Review**: When adding new features or optimizations