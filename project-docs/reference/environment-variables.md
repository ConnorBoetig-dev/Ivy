# Environment Variables Configuration

## 🌐 Complete Environment Setup Guide

### 🎯 Overview
This guide provides all environment variables needed for the AI Media Search application across development, staging, and production environments.

---

## 📁 Environment Files Structure

```
├── .env.example              # Template with all variables (committed)
├── .env.local                # Development environment (not committed)
├── .env.staging              # Staging environment (not committed)
├── .env.production           # Production environment (not committed)
```

---

## 🔧 Core Application Variables

### **Database Configuration**
```bash
# PostgreSQL Database
DATABASE_URL="postgresql://username:password@localhost:5432/ai_media_search"
DATABASE_SSL=false                    # Set to true in production
DATABASE_POOL_MAX=20                  # Maximum connections
DATABASE_POOL_MIN=5                   # Minimum connections
DATABASE_TIMEOUT=30000                # Connection timeout (ms)

# Database Extensions
POSTGRES_USER="ai_media_admin"
POSTGRES_PASSWORD="secure_password_here"
POSTGRES_DB="ai_media_search"
POSTGRES_HOST="localhost"
POSTGRES_PORT=5432
```

### **Redis Configuration**
```bash
# Redis Cache & Queue
REDIS_URL="redis://localhost:6379"
REDIS_PASSWORD=""                     # Leave empty for local dev
REDIS_DB=0                           # Database number
REDIS_MAX_RETRIES=3
REDIS_CONNECT_TIMEOUT=10000          # Connection timeout (ms)
REDIS_COMMAND_TIMEOUT=5000           # Command timeout (ms)
```

---

## 🔐 Authentication & Security

### **Firebase Configuration**
```bash
# Firebase Authentication
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----"
FIREBASE_AUTH_DOMAIN="your-project-id.firebaseapp.com"
FIREBASE_API_KEY="your-web-api-key"
FIREBASE_APP_ID="1:123456789:web:abcdef"

# Firebase Admin SDK
FIREBASE_ADMIN_SDK_PATH="/path/to/firebase-admin-sdk.json"  # Alternative to private key
```

### **Security Keys**
```bash
# Application Security
NEXTAUTH_SECRET="your-nextauth-secret-key-here"            # 32+ character random string
NEXTAUTH_URL="http://localhost:3000"                       # Your app URL
JWT_SECRET="your-jwt-secret-key-here"                      # For custom JWT tokens
SESSION_SECRET="your-session-secret-here"                  # Session encryption
ENCRYPTION_KEY="your-32-character-encryption-key"          # Data encryption
```

---

## 💳 Payment Processing

### **Stripe Configuration**
```bash
# Stripe Payment Processing
STRIPE_SECRET_KEY="sk_test_xxxxx"                          # Use sk_live_ in production
STRIPE_PUBLISHABLE_KEY="pk_test_xxxxx"                     # Use pk_live_ in production
STRIPE_WEBHOOK_SECRET="whsec_xxxxx"                        # Webhook endpoint secret
STRIPE_CUSTOMER_PORTAL_URL="https://billing.stripe.com/p/login/xxxxx"

# Stripe Product IDs
STRIPE_PRICE_FREE="price_xxxxx"                            # Free tier (if applicable)
STRIPE_PRICE_PREMIUM="price_xxxxx"                         # Premium monthly
STRIPE_PRICE_ULTIMATE="price_xxxxx"                        # Ultimate monthly
STRIPE_PRICE_PREMIUM_ANNUAL="price_xxxxx"                  # Premium annual
STRIPE_PRICE_ULTIMATE_ANNUAL="price_xxxxx"                 # Ultimate annual
```

---

## ☁️ AWS Services

### **AWS Credentials**
```bash
# AWS Configuration
AWS_ACCESS_KEY_ID="AKIAXXXXXXXXXXXXX"
AWS_SECRET_ACCESS_KEY="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
AWS_REGION="us-east-1"                                     # Your preferred region
AWS_ACCOUNT_ID="123456789012"

# S3 Storage
AWS_S3_BUCKET_NAME="ai-media-search-storage"
AWS_S3_REGION="us-east-1"
AWS_S3_MEDIA_BUCKET="ai-media-search-media"
AWS_S3_THUMBNAILS_BUCKET="ai-media-search-thumbnails"
AWS_S3_PRESIGNED_URL_EXPIRY=3600                          # 1 hour in seconds

# AI Services
AWS_REKOGNITION_MAX_LABELS=50
AWS_REKOGNITION_MIN_CONFIDENCE=80
AWS_TRANSCRIBE_LANGUAGE_CODE="en-US"
AWS_COMPREHEND_LANGUAGE_CODE="en"
```

---

## 🤖 OpenAI Configuration

### **OpenAI API**
```bash
# OpenAI Services
OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
OPENAI_ORGANIZATION="org-xxxxxxxxxxxxxxxxxxxxxxxx"        # Optional
OPENAI_MODEL_EMBEDDING="text-embedding-3-small"           # Cost-effective embeddings
OPENAI_MODEL_CHAT="gpt-3.5-turbo"                        # For text processing
OPENAI_MAX_TOKENS=4000
OPENAI_TEMPERATURE=0.1                                    # Low for consistent results
```

---

## 🌐 Cloudflare Configuration

### **Cloudflare Settings**
```bash
# Cloudflare
CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"
CLOUDFLARE_ZONE_ID="your-zone-id"
CLOUDFLARE_ACCOUNT_ID="your-account-id"
CLOUDFLARE_TURNSTILE_SITE_KEY="0x4AAAAAAAxxx"
CLOUDFLARE_TURNSTILE_SECRET_KEY="0x4AAAAAAAxxx"

# CDN Configuration
CLOUDFLARE_CDN_URL="https://cdn.yourdomain.com"
CLOUDFLARE_CACHE_TTL=86400                                # 24 hours
```

---

## 📊 Monitoring & Logging

### **Application Monitoring**
```bash
# Logging Configuration
LOG_LEVEL="info"                                          # debug, info, warn, error
LOG_FILE_PATH="./logs"
LOG_MAX_SIZE="10m"                                        # Max log file size
LOG_MAX_FILES=10                                          # Number of log files to keep
LOG_DATE_PATTERN="YYYY-MM-DD"

# Metrics & Analytics
METRICS_ENABLED=true
METRICS_PORT=9090                                         # Prometheus metrics port
ANALYTICS_ENABLED=true
```

### **Error Tracking**
```bash
# Sentry Error Tracking (Optional)
SENTRY_DSN="https://xxxxx@sentry.io/xxxxx"
SENTRY_ENVIRONMENT="development"                          # development, staging, production
SENTRY_TRACES_SAMPLE_RATE=0.1                           # 10% trace sampling
```

---

## 🚀 Application Configuration

### **General Settings**
```bash
# Application
NODE_ENV="development"                                    # development, staging, production
PORT=3000                                                # Application port
HOST="localhost"                                         # Application host
APP_URL="http://localhost:3000"                         # Full application URL
API_BASE_URL="/api"                                      # API base path

# Feature Flags
ENABLE_FILE_UPLOADS=true
ENABLE_VIDEO_PROCESSING=true
ENABLE_COST_TRACKING=true
ENABLE_DEBUG_MODE=false                                  # Set to false in production
ENABLE_WEBHOOK_PROCESSING=true
```

### **Rate Limiting**
```bash
# Rate Limiting Configuration
RATE_LIMIT_WINDOW=3600000                               # 1 hour in milliseconds
RATE_LIMIT_FREE_UPLOADS=5                               # Per hour
RATE_LIMIT_PREMIUM_UPLOADS=20                           # Per hour
RATE_LIMIT_ULTIMATE_UPLOADS=50                          # Per hour
RATE_LIMIT_API_CALLS=100                                # Per hour for general API
RATE_LIMIT_SEARCH_CALLS=50                              # Per hour for search
```

---

## 🎯 Environment-Specific Configurations

### **Development Environment (.env.local)**
```bash
NODE_ENV=development
LOG_LEVEL=debug
ENABLE_DEBUG_MODE=true
DATABASE_SSL=false
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=sk_test_xxxxx
AWS_S3_BUCKET_NAME=ai-media-search-dev
OPENAI_MODEL_EMBEDDING=text-embedding-3-small
```

### **Staging Environment (.env.staging)**
```bash
NODE_ENV=staging
LOG_LEVEL=info
ENABLE_DEBUG_MODE=false
DATABASE_SSL=true
APP_URL=https://staging.yourdomain.com
STRIPE_SECRET_KEY=sk_test_xxxxx
AWS_S3_BUCKET_NAME=ai-media-search-staging
```

### **Production Environment (.env.production)**
```bash
NODE_ENV=production
LOG_LEVEL=warn
ENABLE_DEBUG_MODE=false
DATABASE_SSL=true
APP_URL=https://yourdomain.com
STRIPE_SECRET_KEY=sk_live_xxxxx
AWS_S3_BUCKET_NAME=ai-media-search-production
SENTRY_ENVIRONMENT=production
```

---

## 🔍 Environment Validation

### **Required Variables by Environment**
| Variable | Development | Staging | Production |
|----------|-------------|---------|------------|
| DATABASE_URL | ✅ Required | ✅ Required | ✅ Required |
| REDIS_URL | ✅ Required | ✅ Required | ✅ Required |
| FIREBASE_PROJECT_ID | ✅ Required | ✅ Required | ✅ Required |
| STRIPE_SECRET_KEY | ✅ Required | ✅ Required | ✅ Required |
| AWS_ACCESS_KEY_ID | ✅ Required | ✅ Required | ✅ Required |
| OPENAI_API_KEY | ✅ Required | ✅ Required | ✅ Required |
| NEXTAUTH_SECRET | ✅ Required | ✅ Required | ✅ Required |

### **Validation Script**
```typescript
// scripts/validate-environment.js
const requiredVars = [
  'DATABASE_URL',
  'REDIS_URL', 
  'FIREBASE_PROJECT_ID',
  'STRIPE_SECRET_KEY',
  'AWS_ACCESS_KEY_ID',
  'OPENAI_API_KEY'
];

requiredVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ Missing required environment variable: ${varName}`);
    process.exit(1);
  }
});

console.log('✅ All required environment variables are present');
```

---

## 🛡️ Security Best Practices

### **Environment Security Checklist**
- [ ] **Never commit** .env files to version control
- [ ] **Use different keys** for each environment
- [ ] **Rotate secrets** regularly (quarterly)
- [ ] **Use strong passwords** (32+ characters)
- [ ] **Enable database SSL** in production
- [ ] **Use HTTPS URLs** in staging/production
- [ ] **Limit API key permissions** to minimum required
- [ ] **Monitor for exposed secrets** in logs and error messages

### **Secret Management**
- Store production secrets in secure vault (AWS Secrets Manager, HashiCorp Vault)
- Use environment-specific service accounts
- Implement secret rotation schedules
- Monitor for secret exposure in code and logs

---

## 📋 Setup Instructions

### **1. Initial Setup**
```bash
# Copy template
cp .env.example .env.local

# Edit with your values
nano .env.local

# Validate configuration
npm run validate:env
```

### **2. Development Environment**
```bash
# Install dependencies
npm install

# Start local services
docker-compose up -d postgres redis

# Run database migrations
npm run db:migrate

# Start development server
npm run dev
```

### **3. Production Deployment**
```bash
# Set production environment variables
# Deploy with your CI/CD pipeline
# Verify all services are healthy
npm run health:check
```

---

**Last Updated**: 2024-01-15  
**Next Review**: When adding new services or updating integrations