# Project Structure Reference

## 📁 Complete Directory Layout

```
ai-media-search/
├── 📁 project-docs/                    # Claude Code context files
│   ├── 📁 01-overview/
│   ├── 📁 02-phases/
│   ├── 📁 03-reference/
│   ├── 📁 04-implementation/
│   └── 📁 05-checklists/
├── 📁 src/                            # Main application source
│   ├── 📁 app/                        # Next.js App Router
│   │   ├── 📁 api/                    # API routes
│   │   │   ├── 📁 upload/
│   │   │   │   ├── presigned/route.ts
│   │   │   │   └── complete/route.ts
│   │   │   ├── 📁 search/
│   │   │   │   └── route.ts
│   │   │   ├── 📁 media/
│   │   │   │   ├── route.ts
│   │   │   │   └── [id]/route.ts
│   │   │   ├── 📁 billing/
│   │   │   │   ├── checkout/route.ts
│   │   │   │   ├── portal/route.ts
│   │   │   │   └── webhook/route.ts
│   │   │   ├── 📁 auth/
│   │   │   │   ├── login/route.ts
│   │   │   │   └── logout/route.ts
│   │   │   └── 📁 health/
│   │   │       └── route.ts
│   │   ├── 📁 dashboard/              # Dashboard pages
│   │   │   ├── page.tsx
│   │   │   ├── upload/page.tsx
│   │   │   ├── search/page.tsx
│   │   │   ├── media/page.tsx
│   │   │   └── billing/page.tsx
│   │   ├── 📁 auth/                   # Authentication pages
│   │   │   ├── login/page.tsx
│   │   │   └── signup/page.tsx
│   │   ├── layout.tsx                 # Root layout
│   │   ├── page.tsx                   # Home page
│   │   ├── loading.tsx                # Global loading UI
│   │   ├── error.tsx                  # Global error UI
│   │   └── not-found.tsx              # 404 page
│   ├── 📁 components/                 # React components
│   │   ├── 📁 ui/                     # Base UI components
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── modal.tsx
│   │   │   ├── loading-spinner.tsx
│   │   │   └── alert.tsx
│   │   ├── 📁 auth/                   # Authentication components
│   │   │   ├── AuthProvider.tsx
│   │   │   ├── LoginForm.tsx
│   │   │   ├── SignupForm.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── 📁 upload/                 # Upload components
│   │   │   ├── UploadDropzone.tsx
│   │   │   ├── UploadProgress.tsx
│   │   │   ├── UploadQueue.tsx
│   │   │   └── FileValidator.tsx
│   │   ├── 📁 search/                 # Search components
│   │   │   ├── SearchBar.tsx
│   │   │   ├── SearchFilters.tsx
│   │   │   ├── SearchResults.tsx
│   │   │   └── SearchHistory.tsx
│   │   ├── 📁 media/                  # Media display components
│   │   │   ├── MediaCard.tsx
│   │   │   ├── MediaGallery.tsx
│   │   │   ├── MediaViewer.tsx
│   │   │   ├── VideoPlayer.tsx
│   │   │   └── ThumbnailGenerator.tsx
│   │   ├── 📁 billing/                # Billing components
│   │   │   ├── PricingCard.tsx
│   │   │   ├── UsageIndicator.tsx
│   │   │   ├── UpgradePrompt.tsx
│   │   │   └── BillingDashboard.tsx
│   │   └── 📁 layout/                 # Layout components
│   │       ├── Header.tsx
│   │       ├── Sidebar.tsx
│   │       ├── Footer.tsx
│   │       └── Navigation.tsx
│   ├── 📁 lib/                        # Core utilities and config
│   │   ├── 📁 firebase/
│   │   │   ├── config.ts              # Client config
│   │   │   ├── admin.ts               # Admin SDK
│   │   │   └── auth.ts                # Auth helpers
│   │   ├── 📁 stripe/
│   │   │   ├── server.ts              # Server-side Stripe
│   │   │   └── client.ts              # Client-side Stripe
│   │   ├── 📁 monitoring/
│   │   │   ├── logger.ts              # Winston logger
│   │   │   ├── metrics.ts             # Custom metrics
│   │   │   └── health.ts              # Health checks
│   │   ├── 📁 cache/
│   │   │   └── redis-client.ts        # Redis cache manager
│   │   ├── 📁 validation/
│   │   │   └── input-validator.ts     # Joi validation schemas
│   │   ├── 📁 security/
│   │   │   ├── encryption.ts          # Data encryption
│   │   │   └── sanitization.ts       # Input sanitization
│   │   ├── 📁 queue/
│   │   │   └── bull-queue.ts          # BullMQ setup
│   │   ├── 📁 performance/
│   │   │   └── optimization.ts        # Performance utilities
│   │   └── database.ts                # Database connection
│   ├── 📁 services/                   # Business logic services
│   │   ├── 📁 aws/
│   │   │   ├── s3-service.ts          # S3 operations
│   │   │   ├── rekognition-service.ts # Image/video analysis
│   │   │   ├── transcribe-service.ts  # Audio transcription
│   │   │   └── comprehend-service.ts  # Text analysis
│   │   ├── 📁 openai/
│   │   │   └── embedding-service.ts   # OpenAI embeddings
│   │   ├── 📁 payment/
│   │   │   └── stripe-service.ts      # Payment processing
│   │   ├── cost-tracking.ts           # Cost management
│   │   ├── cost-optimizer.ts          # Cost optimization
│   │   └── cloudflare-service.ts      # Cloudflare integration
│   ├── 📁 workers/                    # Background job processors
│   │   ├── 📁 processors/
│   │   │   ├── image-processor.ts     # Image processing worker
│   │   │   ├── video-processor.ts     # Video processing worker
│   │   │   ├── text-processor.ts      # Text analysis worker
│   │   │   └── embedding-processor.ts # Embedding generation
│   │   ├── 📁 schedulers/
│   │   │   ├── usage-reset.ts         # Monthly usage reset
│   │   │   └── cleanup.ts             # Data cleanup jobs
│   │   ├── media-processor.ts         # Main processing coordinator
│   │   └── index.ts                   # Worker entry point
│   ├── 📁 hooks/                      # Custom React hooks
│   │   ├── useAuth.ts                 # Authentication hook
│   │   ├── useUpload.ts               # File upload hook
│   │   ├── useSearch.ts               # Search functionality
│   │   ├── useSubscription.ts         # Subscription management
│   │   ├── useUsage.ts                # Usage tracking
│   │   └── useMediaQuery.ts           # Responsive design
│   ├── 📁 stores/                     # State management (Zustand)
│   │   ├── authStore.ts               # Authentication state
│   │   ├── uploadStore.ts             # Upload queue state
│   │   ├── searchStore.ts             # Search state
│   │   ├── subscriptionStore.ts       # Billing state
│   │   └── uiStore.ts                 # UI state (modals, etc.)
│   ├── 📁 types/                      # TypeScript definitions
│   │   ├── index.ts                   # Main type exports
│   │   ├── api.ts                     # API response types
│   │   ├── database.ts                # Database types
│   │   ├── aws.ts                     # AWS service types
│   │   └── stripe.ts                  # Payment types
│   ├── 📁 utils/                      # Helper functions
│   │   ├── constants.ts               # App constants
│   │   ├── formatters.ts              # Data formatting
│   │   ├── validators.ts              # Validation helpers
│   │   ├── date-utils.ts              # Date manipulation
│   │   └── file-utils.ts              # File operations
│   └── 📁 middleware/                 # Request middleware
│       ├── auth.ts                    # Authentication middleware
│       ├── security.ts                # Security middleware
│       ├── rate-limiting.ts           # Rate limiting
│       └── cors.ts                    # CORS configuration
├── 📁 scripts/                        # Utility scripts
│   ├── 📁 deployment/
│   │   ├── deploy-production.js       # Production deployment
│   │   ├── deploy-staging.js          # Staging deployment
│   │   └── rollback.js                # Deployment rollback
│   ├── 📁 maintenance/
│   │   ├── cleanup-data.js            # Data cleanup
│   │   ├── reset-usage.js             # Reset monthly usage
│   │   └── backup-database.js         # Database backup
│   ├── 📁 testing/
│   │   ├── load-test.js               # Load testing
│   │   └── seed-test-data.js          # Test data generation
│   ├── migrate-database.js            # Database migrations
│   ├── setup-stripe-products.js      # Stripe product setup
│   ├── setup-aws.js                  # AWS infrastructure setup
│   ├── setup-cloudflare.js           # Cloudflare configuration
│   ├── validate-environment.js       # Environment validation
│   ├── start-worker.js               # Worker process starter
│   └── health-check.js               # Health check script
├── 📁 docker/                        # Docker configuration
│   ├── 📁 development/
│   │   └── docker-compose.dev.yml    # Development environment
│   ├── 📁 production/
│   │   └── docker-compose.prod.yml   # Production environment
│   ├── Dockerfile                    # Main app container
│   ├── Dockerfile.worker             # Worker container
│   └── nginx.conf                    # Nginx configuration
├── 📁 tests/                         # Test files
│   ├── 📁 unit/
│   │   ├── services/                 # Service unit tests
│   │   ├── utils/                    # Utility function tests
│   │   └── components/               # Component tests
│   ├── 📁 integration/
│   │   ├── api/                      # API integration tests
│   │   └── database/                 # Database tests
│   └── 📁 e2e/
│       ├── auth-flow.spec.ts         # Authentication E2E
│       ├── upload-flow.spec.ts       # Upload workflow E2E
│       └── search-flow.spec.ts       # Search workflow E2E
├── 📁 docs/                          # Documentation
│   ├── 📁 architecture/
│   │   ├── database-design.md
│   │   ├── api-design.md
│   │   └── security-model.md
│   ├── 📁 api/
│   │   ├── endpoints.md
│   │   └── authentication.md
│   └── 📁 deployment/
│       ├── environment-setup.md
│       └── monitoring.md
├── 📁 .github/                       # GitHub configuration
│   └── 📁 workflows/
│       ├── ci-cd.yml                 # Main CI/CD pipeline
│       ├── security-scan.yml         # Security scanning
│       └── dependency-update.yml     # Automated updates
├── 📁 logs/                          # Application logs
│   ├── error.log
│   ├── combined.log
│   └── access.log
├── 📄 Configuration Files
├── package.json                      # Dependencies and scripts
├── package-lock.json                 # Locked dependencies
├── tsconfig.json                     # TypeScript configuration
├── next.config.js                    # Next.js configuration
├── tailwind.config.js                # Tailwind CSS configuration
├── .eslintrc.json                    # ESLint configuration
├── .prettierrc                       # Prettier configuration
├── jest.config.js                    # Jest testing configuration
├── playwright.config.ts              # Playwright E2E configuration
├── .gitignore                        # Git ignore rules
├── .env.example                      # Environment template
├── .env.local                        # Local environment (not committed)
├── Dockerfile                        # Docker container config
├── docker-compose.yml                # Local development compose
├── nginx.conf                        # Nginx reverse proxy config
└── README.md                         # Project documentation
```

## 🎯 Key Directories Explained

### `/src/app` - Next.js App Router
- **API Routes**: RESTful endpoints organized by feature
- **Pages**: React components for each route
- **Layouts**: Shared layout components
- **Loading/Error**: Global loading and error states

### `/src/components` - React Components
- **Organized by Feature**: Each directory contains related components
- **Reusable UI**: Base components used throughout the app
- **Feature-Specific**: Components tied to specific functionality

### `/src/lib` - Core Infrastructure
- **Configuration**: Firebase, Stripe, database setup
- **Utilities**: Logging, caching, validation, security
- **Shared Logic**: Code used across multiple features

### `/src/services` - Business Logic
- **External APIs**: AWS, OpenAI, Stripe integrations
- **Business Rules**: Cost tracking, optimization logic
- **Data Processing**: File processing, analysis workflows

### `/src/workers` - Background Processing
- **Job Processors**: Individual workers for different tasks
- **Schedulers**: Cron-like scheduled tasks
- **Queue Management**: Job coordination and retry logic

### `/src/hooks` - React Hooks
- **Feature Hooks**: Authentication, upload, search functionality
- **Utility Hooks**: Common patterns and state management
- **API Hooks**: Data fetching and mutation

### `/src/stores` - State Management
- **Global State**: User authentication, UI state
- **Feature State**: Upload progress, search results
- **Persistent State**: User preferences, settings

## 📋 File Naming Conventions

### React Components
- **PascalCase**: `MediaCard.tsx`, `UploadDropzone.tsx`
- **Descriptive Names**: Clear purpose and functionality
- **Feature Prefixes**: Group related components

### Services and Utilities
- **kebab-case**: `s3-service.ts`, `cost-optimizer.ts`
- **Suffix Patterns**: `-service.ts`, `-utils.ts`, `-helpers.ts`
- **Clear Purpose**: Name indicates functionality

### API Routes
- **Lowercase**: `/api/upload/presigned`
- **RESTful**: Standard HTTP methods and resource patterns
- **Nested Resources**: Clear hierarchy

### Configuration Files
- **Standard Names**: Follow framework conventions
- **Environment Specific**: `.env.local`, `.env.production`

## 🔧 Import Patterns

### Absolute Imports
```typescript
import { AuthProvider } from '@/components/auth/AuthProvider';
import { s3Service } from '@/services/aws/s3-service';
import { db } from '@/lib/database';
```

### Feature-Based Imports
```typescript
// Group imports by source
import React from 'react';
import { NextRequest, NextResponse } from 'next/server';

import { authenticateUser } from '@/middleware/auth';
import { uploadStore } from '@/stores/uploadStore';
```

## 📚 Dependencies by Directory

### `/src/app` - Next.js Framework
- Next.js App Router
- React 18+ with TypeScript
- Tailwind CSS for styling

### `/src/services` - External APIs
- AWS SDK (S3, Rekognition, Transcribe, Comprehend)
- OpenAI API client
- Stripe payment processing
- Firebase Admin SDK

### `/src/workers` - Background Processing
- BullMQ for job queues
- Redis for queue storage
- FFmpeg for video processing
- Sharp for image processing

### `/src/lib` - Infrastructure
- PostgreSQL with pgvector
- Winston for logging
- Joi for validation
- Helmet for security

---

**Usage Notes**:
- Follow the established patterns when adding new files
- Keep components small and focused on single responsibilities
- Use TypeScript for all new files
- Organize imports and exports consistently
- Follow the naming conventions for consistency

**Next**: Review specific implementation patterns in `04-implementation/`
