# Phase 2: Database Infrastructure Setup

## 🎯 Phase Overview
Set up PostgreSQL with pgvector extension, implement the complete database schema with vector search capabilities, create the database connection layer, and establish Row Level Security for data isolation.

## ✅ Prerequisites
- Phase 1 completed successfully
- Basic understanding of PostgreSQL
- Knowledge of vector databases and similarity search
- Understanding of database security principles

## 📋 Phase Checklist
- [ ] PostgreSQL 15 with pgvector extension installed
- [ ] Database and user created with proper permissions
- [ ] Complete schema implemented with all tables
- [ ] Vector indexes configured for search performance
- [ ] Row Level Security policies implemented
- [ ] Database connection layer created
- [ ] Migration scripts working
- [ ] Health checks functional

---

## Step 1: PostgreSQL Installation with pgvector

### 1.1 Install PostgreSQL 15
```bash
# Add PostgreSQL official repository
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt-get update

# Install PostgreSQL 15 and contrib packages
sudo apt-get install -y postgresql-15 postgresql-contrib-15 postgresql-client-15

# Install development headers (needed for pgvector)
sudo apt-get install -y postgresql-server-dev-15 build-essential git
```

### 1.2 Install pgvector Extension
```bash
# Clone and build pgvector
cd /tmp
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install

# Verify installation
sudo -u postgres psql -c "CREATE EXTENSION IF NOT EXISTS vector;" postgres
```

### 1.3 Configure PostgreSQL for Performance
```bash
# Edit PostgreSQL configuration
sudo nano /etc/postgresql/15/main/postgresql.conf

# Add these optimizations:
# shared_preload_libraries = 'pg_stat_statements'
# max_connections = 100
# shared_buffers = 256MB
# effective_cache_size = 1GB
# work_mem = 4MB
# maintenance_work_mem = 64MB
# checkpoint_completion_target = 0.9
# wal_buffers = 16MB
# default_statistics_target = 100

# Restart PostgreSQL
sudo systemctl restart postgresql
```

---

## Step 2: Database and User Setup

### 2.1 Create Database User
```bash
# Switch to postgres user
sudo -u postgres psql

# Execute these SQL commands:
```

```sql
-- Create user with limited privileges
CREATE USER mediauser WITH PASSWORD 'your_secure_password_here';

-- Create database
CREATE DATABASE media_search OWNER mediauser;

-- Connect to the new database
\c media_search

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Grant permissions to user
GRANT ALL PRIVILEGES ON DATABASE media_search TO mediauser;
GRANT ALL ON SCHEMA public TO mediauser;
GRANT CREATE ON SCHEMA public TO mediauser;

-- Exit psql
\q
```

### 2.2 Test Connection
```bash
# Test connection with new user
psql -h localhost -U mediauser -d media_search -c "SELECT version();"
```

---

## Step 3: Schema Implementation

### 3.1 Create Schema File
Create `src/lib/schema.sql` with the complete schema from `03-reference/database-schema.md`. Key tables include:

- **users**: Authentication, subscriptions, usage tracking
- **media_files**: File metadata and processing status
- **media_embeddings**: Vector embeddings for search
- **processing_jobs**: Background job management
- **search_history**: Analytics and performance tracking
- **cost_tracking**: Budget and cost management

### 3.2 Implement Core Tables
```sql
-- Users table with comprehensive subscription management
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  firebase_uid VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  email_verified BOOLEAN DEFAULT false,
  subscription_tier VARCHAR(20) DEFAULT 'free',
  subscription_status VARCHAR(20) DEFAULT 'active',
  uploads_this_month INTEGER DEFAULT 0,
  searches_this_month INTEGER DEFAULT 0,
  storage_used_mb BIGINT DEFAULT 0,
  storage_quota_mb BIGINT DEFAULT 5000,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Media files with processing status
CREATE TABLE IF NOT EXISTS media_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename VARCHAR(500) NOT NULL,
  file_type VARCHAR(50) NOT NULL CHECK (file_type IN ('image', 'video')),
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  file_hash VARCHAR(64) UNIQUE,
  s3_bucket VARCHAR(255) NOT NULL,
  s3_key VARCHAR(1000) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  ai_summary TEXT,
  detected_labels JSONB DEFAULT '[]',
  transcription_text TEXT,
  sentiment VARCHAR(20),
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vector embeddings for similarity search
CREATE TABLE IF NOT EXISTS media_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  media_file_id UUID NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  embedding_model VARCHAR(100) DEFAULT 'text-embedding-3-small',
  source_text TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3.3 Create Essential Indexes
```sql
-- User indexes
CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_subscription_tier ON users(subscription_tier);

-- Media file indexes
CREATE INDEX idx_media_files_user_id ON media_files(user_id);
CREATE INDEX idx_media_files_status ON media_files(status);
CREATE INDEX idx_media_files_uploaded_at ON media_files(uploaded_at DESC);
CREATE INDEX idx_media_files_file_hash ON media_files(file_hash);

-- Vector search index (crucial for performance)
CREATE INDEX idx_embeddings_vector ON media_embeddings 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_embeddings_media_file ON media_embeddings(media_file_id);
CREATE INDEX idx_embeddings_is_primary ON media_embeddings(media_file_id) WHERE is_primary = true;
```

---

## Step 4: Database Connection Layer

### 4.1 Create Database Manager
Create `src/lib/database.ts`:

```typescript
import { Pool, PoolConfig, QueryResult } from 'pg';
import { logger } from './monitoring/logger';

interface DatabaseConfig extends PoolConfig {
  connectionString?: string;
  max: number;
  min: number;
  idleTimeoutMillis: number;
}

class DatabaseManager {
  private pool: Pool;
  private static instance: DatabaseManager;

  constructor() {
    const config: DatabaseConfig = {
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.DATABASE_POOL_MAX || '20'),
      min: parseInt(process.env.DATABASE_POOL_MIN || '2'),
      idleTimeoutMillis: 30000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };

    this.pool = new Pool(config);
    this.setupEventHandlers();
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private setupEventHandlers() {
    this.pool.on('connect', () => {
      logger.debug('Database client connected');
    });

    this.pool.on('error', (err) => {
      logger.error('Database pool error:', err);
    });
  }

  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug(`Query executed in ${duration}ms: ${text.substring(0, 100)}...`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Database query error:', { error, query: text, params, duration });
      throw error;
    }
  }

  async transaction<T>(callback: (query: (text: string, params?: any[]) => Promise<QueryResult>) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const transactionQuery = (text: string, params?: any[]) => client.query(text, params);
      const result = await callback(transactionQuery);
      
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Database health check failed:', error);
      return false;
    }
  }

  getPoolInfo() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export const db = DatabaseManager.getInstance();
```

### 4.2 Create Migration System
Create `scripts/migrate-database.js`:

```javascript
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function migrateDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔄 Starting database migration...');
    
    // Read schema file
    const schemaPath = path.join(__dirname, '../src/lib/schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error('Schema file not found at: ' + schemaPath);
    }
    
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute schema
    await pool.query(schema);
    
    console.log('✅ Database migration completed successfully!');
    
    // Verify key tables exist
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('📊 Created tables:', tables.rows.map(row => row.table_name).join(', '));
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateDatabase();
}

module.exports = { migrateDatabase };
```

---

## Step 5: Row Level Security Implementation

### 5.1 Enable RLS on Tables
```sql
-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_history ENABLE ROW LEVEL SECURITY;
```

### 5.2 Create Security Policies
```sql
-- Users can only access their own data
CREATE POLICY users_own_data ON users
  FOR ALL USING (firebase_uid = current_setting('app.current_user_id', true));

-- Users can only access their own media files
CREATE POLICY media_files_own_data ON media_files
  FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));

-- Users can only access embeddings for their own media
CREATE POLICY embeddings_own_data ON media_embeddings
  FOR ALL USING (
    media_file_id IN (
      SELECT id FROM media_files 
      WHERE user_id::text = current_setting('app.current_user_id', true)
    )
  );

-- Users can only access their own search history
CREATE POLICY search_history_own_data ON search_history
  FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));
```

### 5.3 Create RLS Helper Function
Create `src/lib/database-security.ts`:

```typescript
import { db } from './database';

export async function setUserContext(userId: string): Promise<void> {
  await db.query('SELECT set_config($1, $2, true)', [
    'app.current_user_id',
    userId
  ]);
}

export async function clearUserContext(): Promise<void> {
  await db.query('SELECT set_config($1, $2, true)', [
    'app.current_user_id',
    ''
  ]);
}
```

---

## Step 6: Database Functions and Triggers

### 6.1 Storage Tracking Function
```sql
-- Function to automatically update user storage
CREATE OR REPLACE FUNCTION update_user_storage() 
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users 
    SET storage_used_mb = storage_used_mb + (NEW.file_size_bytes / 1048576::float),
        updated_at = NOW()
    WHERE id = NEW.user_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users 
    SET storage_used_mb = GREATEST(0, storage_used_mb - (OLD.file_size_bytes / 1048576::float)),
        updated_at = NOW()
    WHERE id = OLD.user_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER update_storage_on_media_change
  AFTER INSERT OR DELETE ON media_files
  FOR EACH ROW EXECUTE FUNCTION update_user_storage();
```

### 6.2 Updated At Triggers
```sql
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to all tables with updated_at
CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_media_files_updated_at 
  BEFORE UPDATE ON media_files 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

## Step 7: Testing and Verification

### 7.1 Create Database Test Script
Create `scripts/test-database.js`:

```javascript
const { db } = require('../src/lib/database');

async function testDatabase() {
  try {
    console.log('🧪 Testing database connection...');
    
    // Test basic connection
    const result = await db.query('SELECT version()');
    console.log('✅ Database connected:', result.rows[0].version.substring(0, 50) + '...');
    
    // Test vector extension
    const vectorTest = await db.query('SELECT vector_dims($1) as dims', ['[1,2,3]']);
    console.log('✅ Vector extension working, dims:', vectorTest.rows[0].dims);
    
    // Test table creation
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('✅ Tables created:', tables.rows.map(r => r.table_name).join(', '));
    
    // Test indexes
    const indexes = await db.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
    `);
    console.log('✅ Indexes created:', indexes.rows.length);
    
    console.log('🎉 Database test completed successfully!');
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

testDatabase();
```

### 7.2 Run All Tests
```bash
# Run migration
npm run db:migrate

# Test database
node scripts/test-database.js

# Verify environment
npm run validate-env
```

---

## Step 8: Performance Optimization

### 8.1 Vector Index Optimization
```sql
-- Optimize vector index for your data size
-- For < 1M vectors: lists = 100
-- For 1M+ vectors: lists = sqrt(number_of_rows)

-- Monitor index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes 
WHERE indexname LIKE '%vector%';
```

### 8.2 Query Performance Monitoring
```sql
-- Enable query statistics
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Monitor slow queries
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  rows
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
```

---

## ✅ Phase 2 Completion Checklist

### Database Infrastructure
- [ ] **PostgreSQL 15 Installed**: With pgvector extension working
- [ ] **Database Created**: media_search database with mediauser
- [ ] **Extensions Enabled**: uuid-ossp, vector, pg_trgm, pg_stat_statements
- [ ] **Configuration Optimized**: PostgreSQL settings tuned for performance

### Schema Implementation
- [ ] **All Tables Created**: users, media_files, media_embeddings, processing_jobs, search_history
- [ ] **Relationships Established**: Foreign keys and constraints working
- [ ] **Indexes Created**: All performance indexes including vector index
- [ ] **Functions and Triggers**: Storage tracking and timestamp updates working

### Security and Access
- [ ] **Row Level Security**: RLS enabled on all user tables
- [ ] **Security Policies**: Users can only access their own data
- [ ] **User Context**: Helper functions for setting user context
- [ ] **Connection Security**: SSL configured for production

### Connection Layer
- [ ] **Database Manager**: Connection pooling and query methods working
- [ ] **Transaction Support**: Transaction wrapper functions implemented
- [ ] **Health Checks**: Database health monitoring functional
- [ ] **Error Handling**: Comprehensive error logging and handling

### Testing and Verification
- [ ] **Migration Scripts**: Database migration runs successfully
- [ ] **Test Scripts**: Database tests pass all checks
- [ ] **Vector Search**: Vector similarity search working
- [ ] **Performance**: Query performance acceptable (< 100ms for simple queries)

### Verification Commands
```bash
# These should all succeed:
npm run db:migrate                    # Run migrations
node scripts/test-database.js        # Test database functionality
psql $DATABASE_URL -c "SELECT 1"     # Test connection
npm run validate-env                 # Verify environment
```

---

## 🚀 Next Steps

**Phase 2 Complete!** ✅

**Ready for Phase 3**: Cloudflare & Security Implementation
- Read: `02-phases/phase-03-security.md`
- Prerequisites: Database working, Cloudflare account setup
- Outcome: Complete security middleware and Cloudflare integration

**Quick Reference**:
- Database schema: `03-reference/database-schema.md`
- Environment setup: `03-reference/environment-variables.md`
- Security implementation: `04-implementation/security-patterns.md`

Your database infrastructure is now ready to support the full AI media search application!
