# Phase 1: Project Setup & Infrastructure

## 🎯 Phase Overview
Set up the complete development environment, initialize the Next.js project with all dependencies, and configure the foundational infrastructure including environment variables and project structure.

## ✅ Prerequisites
- Debian VM or Linux environment
- Basic understanding of TypeScript and React
- Node.js 20+ installed
- Git configured
- VS Code or preferred editor

## 📋 Phase Checklist
- [ ] Development environment setup
- [ ] Next.js project initialization
- [ ] All dependencies installed
- [ ] Environment variables configured
- [ ] Project structure created
- [ ] Git repository setup
- [ ] Basic configuration files created
- [ ] Development server running

---

## Step 1: Development Environment Setup

### 1.1 Install Required System Dependencies
```bash
# Update system packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Docker and Docker Compose
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER

# Install additional tools
sudo apt-get install -y git curl wget vim build-essential

# Verify installations
node --version    # Should be 20.x
npm --version     # Should be 10.x
docker --version  # Should be 24.x+
```

### 1.2 Configure VS Code Extensions
Install these essential extensions:
- TypeScript and JavaScript Language Features
- Tailwind CSS IntelliSense
- ESLint
- Prettier - Code formatter
- Auto Rename Tag
- GitLens
- Thunder Client (for API testing)

### 1.3 Configure Git
```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
git config --global init.defaultBranch main
```

---

## Step 2: Initialize Next.js Project

### 2.1 Create Next.js Application
```bash
# Navigate to your projects directory
cd ~/projects

# Create the project with optimal settings
npx create-next-app@latest ai-media-search \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"

# Navigate to project directory
cd ai-media-search
```

### 2.2 Install Core Dependencies
```bash
# Firebase for authentication
npm install firebase firebase-admin

# React Query and state management
npm install @tanstack/react-query zustand

# AWS SDK for AI services
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install @aws-sdk/client-rekognition @aws-sdk/client-transcribe @aws-sdk/client-comprehend

# Database and caching
npm install pg @types/pg
npm install bullmq ioredis

# File processing
npm install multer @types/multer
npm install sharp ffmpeg-static fluent-ffmpeg @types/fluent-ffmpeg

# AI and payments
npm install openai
npm install stripe @stripe/stripe-js

# Utilities
npm install node-cron @types/node-cron
npm install uuid @types/uuid
npm install crypto-js @types/crypto-js
```

### 2.3 Install Security Dependencies
```bash
# Input validation and security
npm install joi helmet cors express-rate-limit
npm install bcryptjs @types/bcryptjs

# Authentication helpers
npm install jsonwebtoken @types/jsonwebtoken
```

### 2.4 Install Monitoring Dependencies
```bash
# Logging and monitoring
npm install @sentry/nextjs winston pino
npm install @opentelemetry/api @opentelemetry/auto-instrumentations-node
```

### 2.5 Install Development Dependencies
```bash
# Testing frameworks
npm install -D jest @testing-library/react @testing-library/jest-dom
npm install -D @playwright/test

# Code quality tools
npm install -D @types/node eslint-config-prettier prettier
npm install -D husky lint-staged

# Build and analysis tools
npm install -D @next/bundle-analyzer
npm install -D typescript

# Git hooks setup
npx husky-init && npm run prepare
```

---

## Step 3: Project Structure Setup

### 3.1 Create Directory Structure
```bash
# Create main source directories
mkdir -p src/{app,components,lib,services,workers,hooks,stores,types,utils,middleware}

# Create app subdirectories
mkdir -p src/app/{api,dashboard,auth}

# Create API route structure
mkdir -p src/app/api/{upload,search,media,billing,health,auth}

# Create library subdirectories
mkdir -p src/lib/{security,monitoring,cache,validation,queue}

# Create service subdirectories
mkdir -p src/services/{aws,openai,payment,cost-tracking}

# Create worker subdirectories
mkdir -p src/workers/{processors,schedulers}

# Create component subdirectories
mkdir -p src/components/{ui,auth,upload,search,media,billing}

# Create utility directories
mkdir -p scripts/{deployment,maintenance,testing}
mkdir -p docker/{development,production}
mkdir -p docs/{architecture,api,deployment}
mkdir -p tests/{unit,integration,e2e}

# Create configuration directories
mkdir -p .github/workflows
mkdir -p logs
```

### 3.2 Create Essential Configuration Files

#### package.json Scripts
Add these scripts to your `package.json`:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "lint:fix": "next lint --fix",
    "type-check": "tsc --noEmit",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:e2e": "playwright test",
    "db:migrate": "node scripts/migrate-database.js",
    "db:seed": "node scripts/seed-database.js",
    "worker:start": "node scripts/start-worker.js",
    "validate-env": "node scripts/validate-environment.js",
    "setup:stripe": "node scripts/setup-stripe-products.js",
    "setup:aws": "node scripts/setup-aws.js"
  }
}
```

#### TypeScript Configuration
Update `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "es6"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

#### ESLint Configuration
Update `.eslintrc.json`:
```json
{
  "extends": [
    "next/core-web-vitals",
    "eslint:recommended",
    "@typescript-eslint/recommended",
    "prettier"
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2021,
    "sourceType": "module"
  },
  "rules": {
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/no-explicit-any": "warn",
    "prefer-const": "error",
    "no-console": "warn"
  }
}
```

#### Prettier Configuration
Create `.prettierrc`:
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false
}
```

---

## Step 4: Environment Configuration

### 4.1 Create Environment Files
```bash
# Create environment template
touch .env.example .env.local

# Add to .gitignore
echo ".env.local" >> .gitignore
echo ".env.*.local" >> .gitignore
echo "logs/" >> .gitignore
echo "coverage/" >> .gitignore
```

### 4.2 Set Up Environment Variables
Copy the template from `03-reference/environment-variables.md` and create your `.env.local` with placeholder values:

```bash
# Core Application
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
LOG_LEVEL=debug

# Database (you'll set this up in Phase 2)
DATABASE_URL=postgresql://mediauser:password@localhost:5432/media_search

# Redis (you'll set this up in Phase 2)  
REDIS_URL=redis://localhost:6379

# AWS (get these from AWS console)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1

# Firebase (get these from Firebase console)
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
FIREBASE_ADMIN_PRIVATE_KEY="your-private-key"
FIREBASE_ADMIN_CLIENT_EMAIL=your-admin-email

# Stripe (get these from Stripe dashboard)
STRIPE_SECRET_KEY=sk_test_your-secret-key
STRIPE_PUBLISHABLE_KEY=pk_test_your-publishable-key

# OpenAI (get from platform.openai.com)
OPENAI_API_KEY=sk-proj-your-openai-key

# Cloudflare (get from Cloudflare dashboard)
CLOUDFLARE_ZONE_ID=your-zone-id
CLOUDFLARE_API_TOKEN=your-api-token
```

### 4.3 Create Environment Validation Script
Create `scripts/validate-environment.js`:
```javascript
// This script will validate that all required environment variables are set
const requiredEnvVars = [
  'NEXT_PUBLIC_APP_URL',
  'DATABASE_URL',
  'REDIS_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'FIREBASE_ADMIN_PRIVATE_KEY',
  'STRIPE_SECRET_KEY',
  'OPENAI_API_KEY'
];

console.log('🔍 Validating environment variables...');

const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(envVar => console.error(`  - ${envVar}`));
  process.exit(1);
} else {
  console.log('✅ All required environment variables are set');
}
```

---

## Step 5: Git Repository Setup

### 5.1 Initialize Git Repository
```bash
# Initialize git if not already done
git init

# Create comprehensive .gitignore
cat > .gitignore << EOF
# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
coverage/
.nyc_output

# Next.js
.next/
out/
build

# Production
dist/

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Debug logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Logs
logs
*.log

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Database
*.db
*.sqlite

# Docker
.dockerignore

# Cache
.cache/
.parcel-cache/

# Temporary files
tmp/
temp/
EOF
```

### 5.2 Create Pre-commit Hooks
Create `.husky/pre-commit`:
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "🔍 Running pre-commit checks..."

# Type checking
echo "📝 Checking TypeScript..."
npm run type-check

# Linting
echo "🔧 Running ESLint..."
npm run lint

# Run tests
echo "🧪 Running tests..."
npm run test --passWithNoTests

echo "✅ Pre-commit checks passed!"
```

### 5.3 Initial Commit
```bash
# Add all files
git add .

# Create initial commit
git commit -m "Initial project setup with Next.js, TypeScript, and all dependencies

- Set up Next.js 14 with App Router and TypeScript
- Installed all core dependencies for AI, auth, payments
- Configured project structure and build tools
- Set up environment configuration
- Added comprehensive .gitignore and pre-commit hooks"
```

---

## Step 6: Development Server Test

### 6.1 Start Development Server
```bash
# Start the development server
npm run dev
```

### 6.2 Verify Setup
1. Open browser to `http://localhost:3000`
2. Verify the default Next.js page loads
3. Check the browser console for any errors
4. Verify TypeScript compilation works

### 6.3 Test Build Process
```bash
# Test production build
npm run build

# Verify no build errors
echo "✅ Build completed successfully"
```

---

## Step 7: Create Basic Project Files

### 7.1 Create Types Directory
Create `src/types/index.ts`:
```typescript
// Global type definitions for the application

export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  subscriptionTier: 'free' | 'premium' | 'ultimate';
  subscriptionStatus: string;
  isActive: boolean;
}

export interface MediaFile {
  id: string;
  userId: string;
  filename: string;
  fileType: 'image' | 'video';
  fileSize: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  uploadedAt: string;
  s3Key: string;
  thumbnailS3Key?: string;
  aiSummary?: string;
  detectedLabels?: any[];
  transcriptionText?: string;
  sentiment?: string;
}

export interface SearchResult extends MediaFile {
  similarityScore: number;
  relevance: number;
}

export interface ProcessingJob {
  id: string;
  mediaFileId: string;
  jobType: string;
  status: string;
  progress: number;
  errorMessage?: string;
  createdAt: string;
}
```

### 7.2 Create Utils Directory
Create `src/utils/constants.ts`:
```typescript
// Application constants

export const SUBSCRIPTION_LIMITS = {
  free: {
    uploads: 10,
    searches: 50,
    storage: 5 * 1024, // 5GB in MB
  },
  premium: {
    uploads: 100,
    searches: 500,
    storage: 50 * 1024, // 50GB in MB
  },
  ultimate: {
    uploads: -1, // unlimited
    searches: -1, // unlimited
    storage: 500 * 1024, // 500GB in MB
  },
};

export const SUPPORTED_FILE_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/x-msvideo'],
};

export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

export const QUEUE_NAMES = {
  IMAGE_ANALYSIS: 'image-analysis',
  VIDEO_ANALYSIS: 'video-analysis',
  TRANSCRIPTION: 'transcription',
  TEXT_ANALYSIS: 'text-analysis',
  EMBEDDING_GENERATION: 'embedding-generation',
};
```

---

## ✅ Phase 1 Completion Checklist

### Verify Each Item:
- [ ] **Environment Setup**: Node.js 20, Docker, Git configured
- [ ] **Project Created**: Next.js with TypeScript and Tailwind
- [ ] **Dependencies Installed**: All packages from package.json
- [ ] **Project Structure**: All directories created as specified
- [ ] **Configuration Files**: TypeScript, ESLint, Prettier configured
- [ ] **Environment Variables**: .env.local created with placeholders
- [ ] **Git Repository**: Initialized with proper .gitignore
- [ ] **Pre-commit Hooks**: Husky configured with type checking
- [ ] **Development Server**: Runs without errors on localhost:3000
- [ ] **Build Process**: `npm run build` completes successfully
- [ ] **Basic Types**: Type definitions created
- [ ] **Constants**: Application constants defined

### Test Commands:
```bash
# Verify all these work without errors
npm run lint
npm run type-check
npm run build
npm run dev
```

---

## 🚀 Next Steps

**Phase 1 Complete!** ✅

**Ready for Phase 2**: Database Infrastructure Setup
- Read: `02-phases/phase-02-database.md`
- Prerequisites: PostgreSQL installation and pgvector setup
- Outcome: Complete database schema with vector search capabilities

**Quick Reference**:
- Environment variables: `03-reference/environment-variables.md`
- Database schema: `03-reference/database-schema.md`
- Project structure: All files created in proper directories

The foundation is now set for building your AI-powered media search application!
