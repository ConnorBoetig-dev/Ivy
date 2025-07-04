# Technical Architecture - AI Media Search Application

## 🏗️ System Architecture Overview

### Core Components
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Cloudflare    │────│   Next.js App   │────│   PostgreSQL    │
│ (CDN/Security)  │    │  (API + Frontend)│    │  (+ pgvector)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                       ┌─────────────────┐
                       │      Redis      │
                       │ (Cache + Queue) │
                       └─────────────────┘
                                │
                       ┌─────────────────┐
                       │  BullMQ Workers │
                       │ (AI Processing) │
                       └─────────────────┘
                                │
        ┌─────────────────────────────────────────────────────┐
        │                AWS Services                          │
        │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
        │  │     S3      │ │ Rekognition │ │ Transcribe  │   │
        │  │  Storage    │ │   Vision    │ │   Audio     │   │
        │  └─────────────┘ └─────────────┘ └─────────────┘   │
        │         ┌─────────────┐                             │
        │         │ Comprehend  │                             │
        │         │    Text     │                             │
        │         └─────────────┘                             │
        └─────────────────────────────────────────────────────┘
                                │
                       ┌─────────────────┐
                       │   OpenAI API    │
                       │   Embeddings    │
                       └─────────────────┘
```

## 🔄 Data Flow Architecture

### Upload & Processing Flow
1. **Frontend Upload**: User selects files → Validates client-side → Requests presigned URL
2. **Backend Validation**: Checks user limits → Validates file type/size → Generates S3 presigned URL
3. **Direct S3 Upload**: Browser uploads directly to S3 → Returns success to frontend
4. **Processing Trigger**: Backend creates media record → Queues processing job
5. **Worker Processing**: BullMQ worker picks up job → Processes through AI pipeline
6. **Result Storage**: Stores analysis results → Generates embedding → Updates database

### Search Flow
1. **User Query**: Natural language input → Frontend validation
2. **Embedding Generation**: Query → OpenAI API → Vector embedding
3. **Vector Search**: Embedding → PostgreSQL pgvector similarity search
4. **Result Assembly**: Database results → Metadata enrichment → Relevance scoring
5. **Response**: Formatted results → Frontend display

## 🗄️ Database Schema Architecture

### Core Tables Structure
```sql
users (id, firebase_uid, subscription_tier, usage_tracking, costs)
    ↓
media_files (id, user_id, s3_keys, processing_status, metadata)
    ↓
media_embeddings (id, media_file_id, embedding[1536], source_text)
    ↓
processing_jobs (id, media_file_id, status, retry_logic, costs)

search_history (id, user_id, query, results, performance_metrics)
cost_tracking (id, user_id, service, amount, billing_period)
```

### Key Relationships
- **Users** → **Media Files** (1:many, with RLS)
- **Media Files** → **Embeddings** (1:many, for temporal segments)
- **Media Files** → **Processing Jobs** (1:many, for different AI services)
- **Users** → **Search History** (1:many, for analytics)

## 🔒 Security Architecture

### Authentication Flow
```
User → Firebase Auth → ID Token → Next.js Middleware → Database RLS
```

### Security Layers
1. **Cloudflare**: DDoS protection, bot detection, rate limiting
2. **Application**: Input validation, authentication middleware, CORS
3. **Database**: Row-level security, encrypted connections
4. **Storage**: Presigned URLs, file validation, encryption at rest

### Data Isolation
- **Row-Level Security**: Users can only access their own data
- **API Middleware**: Authentication required for all protected routes
- **File Access**: Presigned URLs with expiration for secure file access

## ⚡ Performance Architecture

### Caching Strategy
```
Cloudflare CDN → Application Cache → Redis Cache → Database
```

### Cache Layers
1. **Cloudflare**: Static assets, media files (24h TTL)
2. **Application**: API responses, computed results (5min TTL)
3. **Redis**: Search results, embeddings, sessions (1h TTL)
4. **Database**: Query result caching, connection pooling

### Optimization Techniques
- **Vector Indexing**: pgvector IVFFLAT indexes for fast similarity search
- **Connection Pooling**: Optimized database connections
- **Batch Processing**: Group operations for cost efficiency
- **Lazy Loading**: Progressive media loading in frontend

## 🏭 Queue & Worker Architecture

### Processing Queues
```
Upload → [image-analysis] → [video-analysis] → [transcription] 
           ↓                    ↓                ↓
       [text-analysis] → [embedding-generation] → [completion]
```

### Worker Distribution
- **Image Workers**: Process photos (3 concurrent)
- **Video Workers**: Process videos (2 concurrent)
- **Text Workers**: Analyze content (5 concurrent)
- **Embedding Workers**: Generate vectors (4 concurrent)

### Job Management
- **Priority Queue**: Premium users get priority processing
- **Retry Logic**: Exponential backoff for failed jobs
- **Dead Letter Queue**: Manual intervention for persistent failures
- **Cost Tracking**: Real-time cost accumulation per job

## 💰 Cost Architecture

### Cost Tracking Flow
```
AI Service Call → Cost Calculator → Database Storage → Budget Monitor → Alert System
```

### Budget Management
- **Real-time Tracking**: Costs recorded with each API call
- **Budget Alerts**: 80% threshold warnings, 100% processing blocks
- **User Limits**: Subscription-based processing restrictions
- **Optimization**: Caching and batch processing to reduce costs

## 🌐 Deployment Architecture

### Container Structure
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Nginx Proxy   │    │  Next.js App    │    │  Media Workers  │
│ (Load Balancer) │────│  (2 replicas)   │    │  (3 replicas)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                       ┌─────────────────┐    ┌─────────────────┐
                       │   PostgreSQL    │    │     Redis       │
                       │  (Persistent)   │    │  (Persistent)   │
                       └─────────────────┘    └─────────────────┘
```

### Scaling Strategy
- **Horizontal Scaling**: Multiple app and worker replicas
- **Database Scaling**: Read replicas for analytics queries
- **Cache Scaling**: Redis cluster for high availability
- **Auto-scaling**: Based on queue length and CPU usage

## 📊 Monitoring Architecture

### Observability Stack
```
Application → Logs → Winston → File/Console
            → Metrics → Custom Collector → External Service
            → Health → Check System → Load Balancer
            → Traces → Correlation IDs → Request Tracking
```

### Key Metrics
- **Performance**: Response times, throughput, error rates
- **Business**: User actions, conversion rates, revenue
- **Technical**: Queue length, processing times, resource usage
- **Cost**: Service usage, budget tracking, optimization opportunities

## 🔧 Development Architecture

### Environment Separation
- **Development**: Local with Docker Compose
- **Staging**: Production-like with test data
- **Production**: Full scale with monitoring

### CI/CD Pipeline
```
Git Push → GitHub Actions → Tests → Build → Security Scan → Deploy → Health Check
```

### Code Organization
```
src/
├── app/                 # Next.js App Router
├── components/          # React components
├── lib/                 # Utilities and configurations
├── services/            # Business logic and external APIs
├── workers/             # Background job processors
├── hooks/               # Custom React hooks
├── stores/              # State management
├── types/               # TypeScript definitions
├── utils/               # Helper functions
└── middleware/          # Request processing
```

## 🚀 Scalability Considerations

### Performance Bottlenecks
1. **Vector Search**: Optimize with proper indexing and query limits
2. **File Processing**: Queue management and worker scaling
3. **Database Connections**: Connection pooling and read replicas
4. **External APIs**: Rate limiting and caching strategies

### Scaling Solutions
- **Database**: Horizontal partitioning by user_id
- **Storage**: S3 with CloudFront for global distribution
- **Processing**: Auto-scaling workers based on queue depth
- **Search**: Elasticsearch for advanced search features (future)

---

**Implementation Notes**:
- Start with single replicas and scale as needed
- Monitor resource usage to optimize container sizing
- Use feature flags for gradual rollout of new capabilities
- Plan for disaster recovery and data backup strategies

**Next**: Begin implementation with `phases/phase-01-setup.md`
