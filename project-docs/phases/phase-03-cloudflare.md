# Phase 3: Cloudflare & Security Implementation

## 🎯 Phase Overview
Implement comprehensive security measures including Cloudflare integration for DDoS protection and CDN, input validation and sanitization systems, rate limiting, security headers, and file upload validation to create a production-ready secure application.

## ✅ Prerequisites
- Phase 1 (Setup) completed successfully
- Phase 2 (Database) completed and tested
- Cloudflare account created and domain configured
- Basic understanding of web security principles
- Understanding of CORS and CSRF protection

## 📋 Phase Checklist
- [ ] Cloudflare zone configured with security settings
- [ ] Turnstile bot protection implemented
- [ ] Input validation system with Joi schemas
- [ ] Rate limiting middleware for all endpoints
- [ ] Security headers and CORS configuration
- [ ] File upload validation and sanitization
- [ ] Authentication middleware enhanced
- [ ] Security monitoring and logging
- [ ] HTTPS enforced with proper certificates

---

## Step 1: Cloudflare Setup and Configuration

### 1.1 Cloudflare Account and Domain Setup
```bash
# Install Cloudflare CLI (optional)
npm install -g @cloudflare/wrangler

# Set up environment variables
echo "CLOUDFLARE_ZONE_ID=your-zone-id" >> .env.local
echo "CLOUDFLARE_API_TOKEN=your-api-token" >> .env.local
echo "CLOUDFLARE_TURNSTILE_SITE_KEY=your-site-key" >> .env.local
echo "CLOUDFLARE_TURNSTILE_SECRET_KEY=your-secret-key" >> .env.local
```

### 1.2 Configure Cloudflare Security Settings
Create `scripts/setup-cloudflare.js`:

```javascript
const fetch = require('node-fetch');

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

async function cfRequest(endpoint, method = 'GET', data = null) {
  const response = await fetch(`${CF_API_BASE}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify(data) : null,
  });
  
  return response.json();
}

async function setupCloudflareSettings() {
  console.log('🔧 Configuring Cloudflare settings...');

  try {
    // Enable security features
    await cfRequest(`/zones/${zoneId}/settings/security_level`, 'PATCH', {
      value: 'medium'
    });

    await cfRequest(`/zones/${zoneId}/settings/ssl`, 'PATCH', {
      value: 'full'
    });

    await cfRequest(`/zones/${zoneId}/settings/always_use_https`, 'PATCH', {
      value: 'on'
    });

    await cfRequest(`/zones/${zoneId}/settings/min_tls_version`, 'PATCH', {
      value: '1.2'
    });

    // Enable performance features
    await cfRequest(`/zones/${zoneId}/settings/brotli`, 'PATCH', {
      value: 'on'
    });

    await cfRequest(`/zones/${zoneId}/settings/minify`, 'PATCH', {
      value: { css: 'on', html: 'on', js: 'on' }
    });

    console.log('✅ Cloudflare settings configured successfully!');
  } catch (error) {
    console.error('❌ Failed to configure Cloudflare:', error);
  }
}

setupCloudflareSettings();
```

### 1.3 Create Cloudflare Service Integration
Create `src/services/cloudflare-service.ts`:

```typescript
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

export class CloudflareService {
  private config = {
    zoneId: process.env.CLOUDFLARE_ZONE_ID!,
    apiToken: process.env.CLOUDFLARE_API_TOKEN!,
    baseUrl: 'https://api.cloudflare.com/client/v4',
  };

  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`Cloudflare API error: ${response.status}`);
      }

      metrics.increment('cloudflare.api.success');
      return await response.json();
    } catch (error) {
      logger.error('Cloudflare API request failed:', { endpoint, error });
      metrics.increment('cloudflare.api.error');
      throw error;
    }
  }

  async validateTurnstile(token: string, ip: string): Promise<boolean> {
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          secret: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY!,
          response: token,
          remoteip: ip,
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        metrics.increment('turnstile.validation.success');
        return true;
      } else {
        metrics.increment('turnstile.validation.failure');
        logger.warn('Turnstile validation failed:', data['error-codes']);
        return false;
      }
    } catch (error) {
      logger.error('Turnstile validation error:', error);
      metrics.increment('turnstile.validation.error');
      return false;
    }
  }

  async purgeCache(urls?: string[]): Promise<void> {
    const endpoint = `/zones/${this.config.zoneId}/purge_cache`;
    const body = urls ? { files: urls } : { purge_everything: true };

    await this.makeRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}

export const cloudflareService = new CloudflareService();
```

---

## Step 2: Input Validation System

### 2.1 Create Validation Schemas
Create `src/lib/validation/input-validator.ts`:

```typescript
import Joi from 'joi';
import { logger } from '@/lib/monitoring/logger';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedData?: any;
}

// Common validation schemas
export const schemas = {
  // User registration/update
  user: Joi.object({
    email: Joi.string().email().required(),
    name: Joi.string().min(1).max(100).optional(),
    displayName: Joi.string().min(1).max(100).optional(),
  }),

  // File upload
  upload: Joi.object({
    filename: Joi.string().min(1).max(255).pattern(/^[a-zA-Z0-9._-]+$/).required(),
    fileSize: Joi.number().positive().max(500 * 1024 * 1024).required(),
    mimeType: Joi.string().valid(
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/x-msvideo'
    ).required(),
  }),

  // Search queries
  search: Joi.object({
    query: Joi.string().min(1).max(500).required(),
    filters: Joi.object({
      fileType: Joi.string().valid('image', 'video').optional(),
      dateRange: Joi.object({
        start: Joi.date().optional(),
        end: Joi.date().min(Joi.ref('start')).optional(),
      }).optional(),
      tags: Joi.array().items(Joi.string().max(50)).max(10).optional(),
    }).optional(),
    limit: Joi.number().min(1).max(100).default(20),
    offset: Joi.number().min(0).default(0),
  }),

  // Media file updates
  mediaUpdate: Joi.object({
    tags: Joi.array().items(Joi.string().max(50)).max(20).optional(),
    customMetadata: Joi.object().max(50).optional(), // Limit object size
    isPrivate: Joi.boolean().optional(),
  }),

  // Billing/subscription
  checkout: Joi.object({
    priceId: Joi.string().pattern(/^price_/).required(),
    tier: Joi.string().valid('premium', 'ultimate').required(),
    successUrl: Joi.string().uri().required(),
    cancelUrl: Joi.string().uri().required(),
  }),
};

export function validateInput(data: any, schema: Joi.ObjectSchema): ValidationResult {
  try {
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
      allowUnknown: false,
    });

    if (error) {
      const errors = error.details.map(detail => detail.message);
      logger.debug('Validation failed:', { errors, data: JSON.stringify(data) });
      
      return {
        isValid: false,
        errors,
      };
    }

    return {
      isValid: true,
      errors: [],
      sanitizedData: value,
    };
  } catch (error) {
    logger.error('Validation error:', error);
    return {
      isValid: false,
      errors: ['Validation failed'],
    };
  }
}

// Sanitize strings to prevent XSS
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .replace(/[&<>"']/g, (match) => {
      const htmlEntities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
      };
      return htmlEntities[match] || match;
    })
    .trim();
}

// Validate and sanitize search query
export function sanitizeSearchQuery(query: string): string {
  // Remove potential SQL injection attempts
  const dangerous = ['select', 'insert', 'update', 'delete', 'drop', 'union', 'script'];
  let sanitized = query.toLowerCase();
  
  dangerous.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    sanitized = sanitized.replace(regex, '');
  });
  
  return sanitized.trim().substring(0, 500).replace(/\s+/g, ' ');
}

// Validate file upload security
export function validateFileUpload(file: File): ValidationResult {
  const errors: string[] = [];
  const maxSize = 500 * 1024 * 1024; // 500MB
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/x-msvideo'
  ];
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi'];

  // Size validation
  if (file.size > maxSize) {
    errors.push(`File size exceeds ${maxSize / (1024 * 1024)}MB limit`);
  }

  if (file.size === 0) {
    errors.push('File is empty');
  }

  // MIME type validation
  if (!allowedTypes.includes(file.type)) {
    errors.push(`File type ${file.type} is not allowed`);
  }

  // Extension validation
  const extension = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    errors.push(`File extension ${extension} is not allowed`);
  }

  // Filename validation (prevent path traversal)
  if (file.name.includes('..') || file.name.includes('/') || file.name.includes('\\')) {
    errors.push('Invalid filename - path traversal detected');
  }

  // Check for potentially malicious filenames
  const maliciousPatterns = [/\.php$/i, /\.jsp$/i, /\.asp$/i, /\.exe$/i, /\.bat$/i];
  if (maliciousPatterns.some(pattern => pattern.test(file.name))) {
    errors.push('Filename contains potentially malicious extension');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
```

### 2.2 Create Validation Middleware
Create `src/middleware/validation.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateInput, schemas } from '@/lib/validation/input-validator';
import { logger } from '@/lib/monitoring/logger';

export async function validateRequest(
  req: NextRequest, 
  schema: any
): Promise<NextResponse | null> {
  try {
    const body = await req.json();
    const validation = validateInput(body, schema);
    
    if (!validation.isValid) {
      logger.warn('Input validation failed:', {
        errors: validation.errors,
        path: req.nextUrl.pathname,
        method: req.method,
      });
      
      return NextResponse.json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: validation.errors,
        }
      }, { status: 400 });
    }
    
    // Attach sanitized data to request
    (req as any).validatedData = validation.sanitizedData;
    return null; // Validation passed
  } catch (error) {
    logger.error('Request validation error:', error);
    return NextResponse.json({
      success: false,
      error: {
        code: 'INVALID_REQUEST_FORMAT',
        message: 'Invalid request format'
      }
    }, { status: 400 });
  }
}
```

---

## Step 3: Rate Limiting Implementation

### 3.1 Create Rate Limiting Middleware
Create `src/middleware/rate-limiting.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cache } from '@/lib/cache/redis-client';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: NextRequest) => string;
  skipIf?: (req: NextRequest) => boolean;
  message?: string;
}

export class RateLimiter {
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = {
      keyGenerator: (req) => this.getClientIdentifier(req),
      message: 'Too many requests, please try again later.',
      ...config,
    };
  }

  private getClientIdentifier(req: NextRequest): string {
    // Try to get user ID from authenticated request
    const userId = (req as any).user?.id;
    if (userId) {
      return `user:${userId}`;
    }

    // Fall back to IP address
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : 
               req.headers.get('x-real-ip') || 
               req.ip || 'unknown';
    
    return `ip:${ip}`;
  }

  async checkLimit(req: NextRequest): Promise<NextResponse | null> {
    if (this.config.skipIf && this.config.skipIf(req)) {
      return null;
    }

    const key = this.config.keyGenerator!(req);
    const cacheKey = `ratelimit:${key}:${Math.floor(Date.now() / this.config.windowMs)}`;

    try {
      const current = await cache.get(cacheKey) || 0;
      const remaining = Math.max(0, this.config.maxRequests - current - 1);
      const resetTime = Math.ceil(Date.now() / this.config.windowMs) * this.config.windowMs;

      // Set rate limit headers
      const headers = new Headers({
        'X-RateLimit-Limit': this.config.maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': Math.floor(resetTime / 1000).toString(),
        'X-RateLimit-Window': this.config.windowMs.toString(),
      });

      if (current >= this.config.maxRequests) {
        logger.warn('Rate limit exceeded', {
          key,
          current,
          limit: this.config.maxRequests,
          path: req.nextUrl.pathname,
        });

        metrics.increment('rate_limit.exceeded', 1, {
          key_type: key.split(':')[0],
          endpoint: req.nextUrl.pathname,
        });

        return NextResponse.json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: this.config.message,
            retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
          }
        }, { 
          status: 429,
          headers 
        });
      }

      // Increment counter
      await cache.set(cacheKey, current + 1, Math.ceil(this.config.windowMs / 1000));

      // Add headers to successful response (will be handled by Next.js)
      (req as any).rateLimitHeaders = headers;

      return null; // Rate limit passed
    } catch (error) {
      logger.error('Rate limiting error:', error);
      // Allow request on cache failure
      return null;
    }
  }
}

// Pre-configured rate limiters
export const rateLimiters = {
  global: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 1000,
  }),

  upload: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 50, // Will be adjusted per subscription tier
    message: 'Upload rate limit exceeded. Please upgrade your subscription for higher limits.',
  }),

  search: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 50, // Will be adjusted per subscription tier
    message: 'Search rate limit exceeded. Please try again in a minute.',
  }),

  auth: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    message: 'Too many authentication attempts. Please try again later.',
  }),

  api: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
  }),
};

// Subscription-based rate limit adjustments
export function adjustRateLimitForTier(
  baseLimiter: RateLimiter, 
  tier: string
): RateLimiter {
  const multipliers = {
    free: 1,
    premium: 5,
    ultimate: 10,
  };

  const multiplier = multipliers[tier as keyof typeof multipliers] || 1;
  
  return new RateLimiter({
    ...(baseLimiter as any).config,
    maxRequests: (baseLimiter as any).config.maxRequests * multiplier,
  });
}
```

---

## Step 4: Security Headers and CORS

### 4.1 Create Security Middleware
Create `src/middleware/security.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cloudflareService } from '@/services/cloudflare-service';
import { logger } from '@/lib/monitoring/logger';

// Security headers configuration
export const securityHeaders = {
  // Prevent clickjacking
  'X-Frame-Options': 'DENY',
  
  // Prevent MIME type sniffing
  'X-Content-Type-Options': 'nosniff',
  
  // Enable XSS protection
  'X-XSS-Protection': '1; mode=block',
  
  // Referrer policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // Content Security Policy
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https:",
    "connect-src 'self' https://api.openai.com https://api.stripe.com",
    "media-src 'self' https: blob:",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  
  // HSTS (will be set by Cloudflare in production)
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  
  // Permissions policy
  'Permissions-Policy': [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
  ].join(', '),
};

// CORS configuration
export const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.NEXT_PUBLIC_APP_URL!] 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'cf-turnstile-response'
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
};

export function applyCorsHeaders(response: NextResponse, origin?: string): NextResponse {
  const isAllowedOrigin = !origin || corsOptions.origin.includes(origin);
  
  if (isAllowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin || '*');
    response.headers.set('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    response.headers.set('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Max-Age', corsOptions.maxAge.toString());
  }
  
  return response;
}

export function applySecurityHeaders(response: NextResponse): NextResponse {
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  
  return response;
}

// Turnstile validation middleware
export async function validateTurnstile(req: NextRequest): Promise<NextResponse | null> {
  const turnstileToken = req.headers.get('cf-turnstile-response');
  const clientIP = req.headers.get('cf-connecting-ip') || 
                   req.headers.get('x-forwarded-for') || 
                   req.headers.get('x-real-ip') || 
                   'unknown';
  
  if (!turnstileToken) {
    logger.warn('Missing Turnstile token', { ip: clientIP, path: req.nextUrl.pathname });
    return NextResponse.json({
      success: false,
      error: {
        code: 'CAPTCHA_REQUIRED',
        message: 'Captcha verification required'
      }
    }, { status: 400 });
  }
  
  const isValid = await cloudflareService.validateTurnstile(turnstileToken, clientIP);
  
  if (!isValid) {
    logger.warn('Turnstile validation failed', { ip: clientIP, path: req.nextUrl.pathname });
    return NextResponse.json({
      success: false,
      error: {
        code: 'CAPTCHA_VERIFICATION_FAILED',
        message: 'Captcha verification failed'
      }
    }, { status: 400 });
  }
  
  return null; // Validation passed
}

// CSRF protection for state-changing operations
export function validateCSRF(req: NextRequest): NextResponse | null {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    
    const allowedOrigins = corsOptions.origin;
    const isValidOrigin = origin && allowedOrigins.includes(origin);
    const isValidReferer = referer && allowedOrigins.some(allowed => 
      referer.startsWith(allowed)
    );
    
    if (!isValidOrigin && !isValidReferer) {
      logger.warn('CSRF validation failed', {
        origin,
        referer,
        method: req.method,
        path: req.nextUrl.pathname,
      });
      
      return NextResponse.json({
        success: false,
        error: {
          code: 'CSRF_VALIDATION_FAILED',
          message: 'Invalid request origin'
        }
      }, { status: 403 });
    }
  }
  
  return null; // CSRF check passed
}
```

---

## Step 5: Enhanced Authentication Middleware

### 5.1 Update Authentication Middleware
Update `src/middleware/auth.ts` to include security enhancements:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken } from '@/lib/firebase/admin';
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import { rateLimiters } from './rate-limiting';

export interface AuthenticatedRequest extends NextRequest {
  user?: {
    id: string;
    firebaseUid: string;
    email: string;
    subscriptionTier: string;
    subscriptionStatus: string;
    isActive: boolean;
    emailVerified: boolean;
  };
}

export async function authenticateUser(req: NextRequest): Promise<NextResponse | null> {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      metrics.increment('auth.missing_token');
      return NextResponse.json({
        success: false,
        error: {
          code: 'TOKEN_MISSING',
          message: 'Missing or invalid authorization header'
        }
      }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    if (!idToken) {
      metrics.increment('auth.invalid_token_format');
      return NextResponse.json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid token format'
        }
      }, { status: 401 });
    }

    // Verify Firebase token
    const decodedToken = await verifyIdToken(idToken);
    
    // Get user from database with security checks
    const userResult = await db.query(`
      SELECT 
        id, firebase_uid, email, email_verified,
        subscription_tier, subscription_status, is_active,
        failed_login_attempts, account_locked_until,
        last_login_at, created_at
      FROM users 
      WHERE firebase_uid = $1
    `, [decodedToken.uid]);

    if (userResult.rows.length === 0) {
      // Create user if doesn't exist (with security defaults)
      const newUserResult = await db.query(`
        INSERT INTO users (
          firebase_uid, email, email_verified, 
          subscription_tier, subscription_status,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, 'free', 'active', NOW(), NOW())
        RETURNING id, firebase_uid, email, email_verified,
                  subscription_tier, subscription_status, is_active
      `, [decodedToken.uid, decodedToken.email, decodedToken.email_verified || false]);
      
      (req as AuthenticatedRequest).user = newUserResult.rows[0];
      metrics.increment('auth.user.created');
      
      logger.info('New user created', {
        userId: newUserResult.rows[0].id,
        email: decodedToken.email,
      });
    } else {
      const user = userResult.rows[0];
      
      // Security checks
      if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
        logger.warn('Blocked login attempt for locked account', { 
          firebaseUid: decodedToken.uid,
          lockedUntil: user.account_locked_until 
        });
        
        return NextResponse.json({
          success: false,
          error: {
            code: 'ACCOUNT_LOCKED',
            message: 'Account temporarily locked due to security reasons'
          }
        }, { status: 423 });
      }
      
      if (!user.is_active) {
        logger.warn('Login attempt for inactive account', { 
          firebaseUid: decodedToken.uid 
        });
        
        return NextResponse.json({
          success: false,
          error: {
            code: 'ACCOUNT_INACTIVE',
            message: 'Account has been deactivated'
          }
        }, { status: 403 });
      }

      // Check email verification for sensitive operations
      if (!user.email_verified && req.nextUrl.pathname.includes('/upload')) {
        return NextResponse.json({
          success: false,
          error: {
            code: 'EMAIL_VERIFICATION_REQUIRED',
            message: 'Please verify your email address before uploading files'
          }
        }, { status: 403 });
      }
      
      // Update last login and reset failed attempts
      await db.query(`
        UPDATE users 
        SET 
          last_login_at = NOW(),
          failed_login_attempts = 0,
          account_locked_until = NULL,
          updated_at = NOW()
        WHERE firebase_uid = $1
      `, [decodedToken.uid]);
      
      (req as AuthenticatedRequest).user = user;
    }

    // Set user context for RLS
    await db.query('SELECT set_config($1, $2, true)', [
      'app.current_user_id', 
      (req as AuthenticatedRequest).user!.id
    ]);

    metrics.increment('auth.success');
    return null; // Authentication successful
    
  } catch (error) {
    logger.error('Authentication failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      path: req.nextUrl.pathname,
    });
    
    metrics.increment('auth.failure');
    
    return NextResponse.json({
      success: false,
      error: {
        code: 'AUTHENTICATION_FAILED',
        message: 'Authentication failed'
      }
    }, { status: 401 });
  }
}

// Subscription tier middleware with security checks
export function requireSubscriptionTier(minTier: 'free' | 'premium' | 'ultimate') {
  const tierLevels = { free: 0, premium: 1, ultimate: 2 };
  
  return (req: AuthenticatedRequest): NextResponse | null => {
    const user = req.user;
    if (!user) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required'
        }
      }, { status: 401 });
    }

    // Check subscription status
    if (user.subscriptionStatus !== 'active' && minTier !== 'free') {
      logger.warn('Access denied for inactive subscription', {
        userId: user.id,
        subscriptionStatus: user.subscriptionStatus,
        requiredTier: minTier,
      });
      
      return NextResponse.json({
        success: false,
        error: {
          code: 'SUBSCRIPTION_INACTIVE',
          message: 'Active subscription required',
          subscriptionStatus: user.subscriptionStatus,
        }
      }, { status: 402 });
    }

    const userTierLevel = tierLevels[user.subscriptionTier as keyof typeof tierLevels] ?? 0;
    const requiredTierLevel = tierLevels[minTier];

    if (userTierLevel < requiredTierLevel) {
      logger.warn('Insufficient subscription tier', {
        userId: user.id,
        currentTier: user.subscriptionTier,
        requiredTier: minTier,
      });
      
      return NextResponse.json({
        success: false,
        error: {
          code: 'SUBSCRIPTION_UPGRADE_REQUIRED',
          message: 'Subscription upgrade required',
          currentTier: user.subscriptionTier,
          requiredTier: minTier,
        }
      }, { status: 402 });
    }

    return null; // Authorization successful
  };
}
```

---

## ✅ Phase 3 Completion Checklist

### Cloudflare Integration
- [ ] **Cloudflare Zone Configured**: Security, SSL, and performance settings optimized
- [ ] **Turnstile Implemented**: Bot protection working on sensitive endpoints
- [ ] **CDN Configuration**: Static assets and media files cached properly
- [ ] **Security Rules**: WAF rules and rate limiting configured

### Input Validation & Sanitization
- [ ] **Joi Schemas**: Comprehensive validation schemas for all endpoints
- [ ] **File Upload Validation**: Secure file type, size, and content validation
- [ ] **XSS Prevention**: All user input properly sanitized
- [ ] **SQL Injection Prevention**: Parameterized queries enforced

### Rate Limiting
- [ ] **Global Rate Limits**: Overall request limits implemented
- [ ] **Endpoint-Specific Limits**: Upload and search rate limits by subscription tier
- [ ] **Redis Integration**: Rate limiting state stored in Redis
- [ ] **Proper Headers**: Rate limit headers returned to clients

### Security Headers & CORS
- [ ] **Security Headers**: CSP, HSTS, XFO, and other security headers set
- [ ] **CORS Configuration**: Proper origin validation and headers
- [ ] **CSRF Protection**: State-changing operations protected
- [ ] **Certificate Management**: HTTPS enforced with valid certificates

### Authentication Security
- [ ] **Token Validation**: Firebase ID tokens properly verified
- [ ] **Account Security**: Account locking and failed attempt tracking
- [ ] **Email Verification**: Required for sensitive operations
- [ ] **Subscription Checks**: Tier-based access control working

### Testing & Verification
```bash
# These security tests should pass:
curl -H "Origin: https://malicious.com" http://localhost:3000/api/test  # Should be blocked
curl -X POST http://localhost:3000/api/upload/presigned              # Should require auth
curl -H "Authorization: Bearer invalid" http://localhost:3000/api/media # Should return 401

# Rate limiting test (should eventually return 429)
for i in {1..200}; do curl http://localhost:3000/api/health; done
```

---

## 🚀 Next Steps

**Phase 3 Complete!** ✅

**Ready for Phase 4**: Monitoring & Observability Implementation
- Read: `02-phases/phase-04-monitoring.md`
- Prerequisites: Security working, logging requirements understood
- Outcome: Comprehensive monitoring, logging, and alerting system

**Quick Reference**:
- Security checklist: `05-checklists/security-checklist.md`
- API endpoints: `03-reference/api-endpoints.md`
- Next phase: `02-phases/phase-04-monitoring.md`

Your application now has production-grade security implemented and is ready for comprehensive monitoring!
