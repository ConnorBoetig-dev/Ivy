# AI Media Search Application - Development Guide

## 🎯 Project Overview
Building a production-ready AI-powered media search application where users upload photos/videos that are automatically processed through AWS AI services (Rekognition, Transcribe, Comprehend) and vectorized using OpenAI embeddings for natural language search.

## 💻 System Requirements

### Development Environment
- **Node.js**: v18.0.0 or higher (LTS recommended)
- **npm**: v9.0.0 or higher
- **RAM**: Minimum 8GB (16GB recommended for running all services locally)
- **Disk Space**: At least 10GB free space for dependencies and local data
- **Operating System**: macOS, Linux, or Windows with WSL2

### Required Services & Tools
- **Docker**: v20.10+ (for local PostgreSQL, Redis)
- **Git**: v2.30+
- **PostgreSQL**: v15+ with pgvector extension
- **Redis**: v7.0+
- **AWS CLI**: v2.0+ (configured with credentials)

### Cloud Service Requirements
- **AWS Account**: With access to Rekognition, Transcribe, Comprehend, S3, Textract
- **Firebase Account**: For authentication services
- **Stripe Account**: For payment processing
- **Cloudflare Account**: For CDN and security layer
- **OpenAI API Key**: For embedding generation

### Network Requirements
- **Ports**: 
  - 3000 (Next.js development server)
  - 5432 (PostgreSQL)
  - 6379 (Redis)
  - 9090 (Prometheus)
  - 3001 (Grafana)
- **Internet**: Stable connection required for cloud services

## 🚀 Quick Start for Claude Code

### Current Development Status
- [ ] **Phase 1**: Environment & Project Setup
- [ ] **Phase 2**: Database Infrastructure  
- [ ] **Phase 3**: Cloudflare & Security
- [ ] **Phase 4**: Monitoring & Observability
- [ ] **Phase 5**: Caching & Performance
- [ ] **Phase 6**: Cost Management
- [ ] **Phase 7**: Authentication (Firebase)
- [ ] **Phase 8**: Payments (Stripe)
- [ ] **Phase 9**: AWS Services Integration
- [ ] **Phase 10**: Queue System & Workers
- [ ] **Phase 11**: AI & Search Implementation
- [ ] **Phase 12**: API Routes
- [ ] **Phase 13**: Frontend Components
- [ ] **Phase 14**: Testing Implementation
- [ ] **Phase 15**: Docker & Deployment
- [ ] **Phase 16**: Production Deployment
- [ ] **Phase 17**: Operations & Monitoring

### 📚 Essential Reading Order
1. **Start Here**: `overview/project-overview.md` - Complete project understanding
2. **Architecture**: `overview/technical-architecture.md` - System design
3. **Current Phase**: `phases/phase-01-setup.md` - Begin implementation
4. **Reference**: Use `reference/` for specific details during development

### 🔧 Key Reference Files
- **Environment Setup**: `reference/environment-variables.md`
- **Database Schema**: `reference/database-schema.md`
- **API Documentation**: `reference/api-endpoints.md`
- **File Structure**: `reference/project-structure.md`

### ✅ Verification Checklists
- **Security**: `checklists/security-checklist.md`
- **Progress Tracking**: `checklists/check-progress.md`

## 🏗️ Development Workflow

### For Each Phase:
1. Read the phase file: `phases/phase-XX-[name].md`
2. Check prerequisites and dependencies
3. Follow step-by-step implementation
4. Reference implementation details in `implementation/`
5. Verify completion with appropriate checklist
6. Update this README's progress tracker

### Getting Help:
- **Stuck on implementation?** Check `implementation/` for detailed patterns
- **Need specific reference?** Use `reference/` files
- **Ready to verify?** Use `checklists/` for validation

## 🎨 Code Templates
- **Complete Templates**: `templates/code-templates.md`

## 📊 Success Metrics
- **Performance**: Sub-2-second search response times, 99.9% uptime
- **Cost Efficiency**: Stay within $150/month budget for moderate usage
- **User Experience**: 95%+ successful upload rate, high search relevance
- **Security**: Zero security incidents, comprehensive protection
- **Scalability**: Handle 1000+ concurrent users without degradation

---

**Next Action**: Read `overview/project-overview.md` to understand the complete vision, then begin with `phases/phase-01-setup.md`
