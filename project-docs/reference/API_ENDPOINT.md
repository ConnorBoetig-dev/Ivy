# API Endpoints Documentation

## 🌐 Complete API Reference

### 🎯 API Overview
The AI Media Search API provides endpoints for user authentication, file upload and processing, vector-based search, subscription management, and system monitoring. All endpoints except public ones require authentication.

**Base URL**: `https://your-domain.com/api`  
**Authentication**: Bearer token in Authorization header  
**Content Type**: `application/json` (except file uploads)

---

## 1. Authentication Endpoints

### `POST /api/auth/verify`
Verify Firebase ID token and get user information.

**Request Headers:**
```
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "firebaseUid": "firebase-uid",
    "email": "user@example.com",
    "subscriptionTier": "premium",
    "subscriptionStatus": "active",
    "uploadsThisMonth": 45,
    "searchesThisMonth": 123,
    "storageUsedMb": 2048,
    "storageQuotaMb": 50000
  }
}
```

**Error Responses:**
- `401`: Invalid or expired token
- `403`: Account inactive or suspended

---

## 2. Upload Endpoints

### `POST /api/upload/presigned`
Generate presigned URL for direct S3 upload.

**Authentication**: Required  
**Rate Limit**: 10 requests per hour per user

**Request Body:**
```json
{
  "filename": "vacation-video.mp4",
  "fileSize": 52428800,
  "mimeType": "video/mp4"
}
```

**Request Validation:**
- `filename`: 1-255 characters, no path traversal
- `fileSize`: 1 byte to 500MB
- `mimeType`: Must be supported (image/*, video/*)

**Response:**
```json
{
  "success": true,
  "uploadUrl": "https://s3.amazonaws.com/bucket/...",
  "fields": {
    "key": "user-id/timestamp-filename.mp4",
    "AWSAccessKeyId": "...",
    "policy": "...",
    "signature": "..."
  },
  "key": "user-id/timestamp-filename.mp4",
  "expiresIn": 3600
}
```

**Error Responses:**
- `400`: Invalid file type or size
- `402`: Upload limit exceeded
- `413`: File too large

### `POST /api/upload/complete`
Complete upload and queue for processing.

**Authentication**: Required

**Request Body:**
```json
{
  "key": "user-id/timestamp-filename.mp4",
  "filename": "vacation-video.mp4",
  "fileSize": 52428800,
  "mimeType": "video/mp4"
}
```

**Response:**
```json
{
  "success": true,
  "mediaFileId": "uuid",
  "status": "queued",
  "estimatedProcessingTime": "5-10 minutes"
}
```

---

## 3. Media Management Endpoints

### `GET /api/media`
List user's media files with pagination.

**Authentication**: Required  
**Rate Limit**: 100 requests per minute

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (1-100, default: 20)
- `fileType`: Filter by 'image' or 'video'
- `status`: Filter by processing status
- `search`: Text search in filenames
- `sortBy`: 'uploadedAt', 'filename', 'fileSize' (default: 'uploadedAt')
- `sortOrder`: 'asc' or 'desc' (default: 'desc')

**Example Request:**
```
GET /api/media?page=1&limit=20&fileType=video&status=completed&sortBy=uploadedAt&sortOrder=desc
```

**Response:**
```json
{
  "success": true,
  "media": [
    {
      "id": "uuid",
      "filename": "vacation-video.mp4",
      "fileType": "video",
      "fileSize": 52428800,
      "status": "completed",
      "thumbnailS3Key": "thumbnails/uuid-thumb.jpg",
      "uploadedAt": "2024-01-15T10:30:00Z",
      "processingCompletedAt": "2024-01-15T10:35:00Z",
      "aiSummary": "A family vacation video at the beach...",
      "detectedLabels": ["Beach", "Family", "Sunset"],
      "sentiment": "POSITIVE",
      "duration": 120.5,
      "viewCount": 5
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "pages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### `GET /api/media/[id]`
Get detailed information about a specific media file.

**Authentication**: Required

**Query Parameters:**
- `includeDownloadUrl`: Include presigned download URL (default: false)

**Response:**
```json
{
  "success": true,
  "media": {
    "id": "uuid",
    "filename": "vacation-video.mp4",
    "originalFilename": "Family Vacation 2024.mp4",
    "fileType": "video",
    "fileSize": 52428800,
    "status": "completed",
    "s3Key": "processed/uuid",
    "thumbnailS3Key": "thumbnails/uuid-thumb.jpg",
    "downloadUrl": "https://s3.amazonaws.com/...", // if requested
    "uploadedAt": "2024-01-15T10:30:00Z",
    "processingStartedAt": "2024-01-15T10:31:00Z",
    "processingCompletedAt": "2024-01-15T10:35:00Z",
    "processingTimeSeconds": 240,
    "aiSummary": "A family vacation video...",
    "detectedLabels": [
      {"Name": "Beach", "Confidence": 95.5},
      {"Name": "Family", "Confidence": 89.2}
    ],
    "detectedFacesCount": 4,
    "detectedText": ["Welcome to Paradise Beach"],
    "transcriptionText": "Look at this beautiful sunset...",
    "sentiment": "POSITIVE",
    "contentWarnings": [],
    "duration": 120.5,
    "width": 1920,
    "height": 1080,
    "frameRate": 30,
    "hasAudio": true,
    "tags": ["vacation", "family", "beach"],
    "customMetadata": {},
    "viewCount": 5,
    "processingJobs": [
      {
        "type": "video-analysis",
        "status": "completed",
        "progress": 100,
        "error": null
      }
    ],
    "hasEmbedding": true
  }
}
```

**Error Responses:**
- `404`: Media file not found or not accessible

### `PUT /api/media/[id]`
Update media file metadata.

**Authentication**: Required

**Request Body:**
```json
{
  "tags": ["vacation", "family", "2024"],
  "customMetadata": {
    "location": "Paradise Beach",
    "event": "Family Vacation"
  },
  "isPrivate": false
}
```

**Response:**
```json
{
  "success": true,
  "media": {
    "id": "uuid",
    "tags": ["vacation", "family", "2024"],
    "customMetadata": {
      "location": "Paradise Beach",
      "event": "Family Vacation"
    },
    "updatedAt": "2024-01-15T11:00:00Z"
  }
}
```

### `DELETE /api/media/[id]`
Delete a media file and all associated data.

**Authentication**: Required

**Response:**
```json
{
  "success": true,
  "message": "Media file deleted successfully"
}
```

**Error Responses:**
- `404`: Media file not found
- `409`: Media file currently being processed

---

## 4. Search Endpoints

### `POST /api/search`
Perform natural language search across user's media.

**Authentication**: Required  
**Rate Limit**: 50 requests per minute

**Request Body:**
```json
{
  "query": "family playing on the beach during sunset",
  "filters": {
    "fileType": "video",
    "dateRange": {
      "start": "2024-01-01T00:00:00Z",
      "end": "2024-12-31T23:59:59Z"
    },
    "tags": ["vacation"],
    "minDuration": 30,
    "maxDuration": 300
  },
  "limit": 20,
  "offset": 0,
  "includeEmbeddings": false
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "id": "uuid",
      "filename": "beach-sunset.mp4",
      "fileType": "video",
      "thumbnailS3Key": "thumbnails/uuid-thumb.jpg",
      "uploadedAt": "2024-01-15T10:30:00Z",
      "similarityScore": 0.892,
      "relevance": 0.945,
      "aiSummary": "Family playing volleyball on beach...",
      "detectedLabels": ["Beach", "Family", "Sunset"],
      "sentiment": "POSITIVE",
      "matchReasons": [
        "Visual content matches 'beach' and 'sunset'",
        "Detected activities include 'playing'",
        "Multiple people identified as 'family'"
      ]
    }
  ],
  "total": 12,
  "query": "family playing on the beach during sunset",
  "responseTime": 1.24,
  "cached": false,
  "searchId": "uuid"
}
```

### `GET /api/search/suggestions`
Get search suggestions based on user's content.

**Authentication**: Required

**Query Parameters:**
- `q`: Partial query string
- `limit`: Number of suggestions (default: 5)

**Response:**
```json
{
  "success": true,
  "suggestions": [
    {
      "text": "family beach vacation",
      "frequency": 15,
      "category": "common_searches"
    },
    {
      "text": "sunset videos",
      "frequency": 8,
      "category": "content_based"
    }
  ]
}
```

### `GET /api/search/history`
Get user's search history.

**Authentication**: Required

**Query Parameters:**
- `limit`: Number of results (default: 50, max: 100)
- `page`: Page number

**Response:**
```json
{
  "success": true,
  "searches": [
    {
      "id": "uuid",
      "query": "family beach vacation",
      "resultsCount": 12,
      "createdAt": "2024-01-15T14:30:00Z",
      "responseTime": 1.24,
      "clickedResults": 3
    }
  ],
  "pagination": {
    "page": 1,
    "total": 89,
    "hasNext": true
  }
}
```

---

## 5. Processing Status Endpoints

### `GET /api/processing/status/[mediaFileId]`
Get processing status for a media file.

**Authentication**: Required

**Response:**
```json
{
  "success": true,
  "status": {
    "mediaFileId": "uuid",
    "overallStatus": "processing",
    "overallProgress": 65,
    "jobs": [
      {
        "id": "uuid",
        "type": "video-analysis",
        "status": "completed",
        "progress": 100,
        "startedAt": "2024-01-15T10:31:00Z",
        "completedAt": "2024-01-15T10:33:00Z"
      },
      {
        "id": "uuid",
        "type": "transcription",
        "status": "processing",
        "progress": 65,
        "startedAt": "2024-01-15T10:33:00Z",
        "estimatedCompletion": "2024-01-15T10:38:00Z"
      }
    ],
    "estimatedCompletion": "2024-01-15T10:40:00Z"
  }
}
```

### `GET /api/processing/queue`
Get current processing queue status.

**Authentication**: Required (Premium+ only)

**Response:**
```json
{
  "success": true,
  "queue": {
    "userPosition": 3,
    "totalJobs": 25,
    "estimatedWaitTime": "2-3 minutes",
    "processing": [
      {
        "mediaFileId": "uuid",
        "filename": "video.mp4",
        "queuedAt": "2024-01-15T10:35:00Z",
        "estimatedStart": "2024-01-15T10:37:00Z"
      }
    ]
  }
}
```

---

## 6. Billing & Subscription Endpoints

### `GET /api/billing/usage`
Get current usage statistics and limits.

**Authentication**: Required

**Response:**
```json
{
  "success": true,
  "usage": {
    "tier": "premium",
    "status": "active",
    "currentPeriodEnd": "2024-02-15T00:00:00Z",
    "daysRemaining": 18,
    "uploads": {
      "current": 45,
      "limit": 100,
      "percentage": 45,
      "resetsAt": "2024-02-01T00:00:00Z"
    },
    "searches": {
      "current": 234,
      "limit": 500,
      "percentage": 47,
      "resetsAt": "2024-02-01T00:00:00Z"
    },
    "storage": {
      "currentMb": 15360,
      "quotaMb": 51200,
      "percentage": 30
    },
    "costs": {
      "thisMonth": 8.45,
      "lastMonth": 12.30,
      "breakdown": {
        "aws": 6.20,
        "openai": 2.25
      }
    }
  }
}
```

### `POST /api/billing/checkout`
Create Stripe checkout session for subscription upgrade.

**Authentication**: Required

**Request Body:**
```json
{
  "priceId": "price_premium_monthly",
  "tier": "premium",
  "successUrl": "https://yourapp.com/billing/success",
  "cancelUrl": "https://yourapp.com/billing/cancel"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "cs_stripe_session_id",
  "url": "https://checkout.stripe.com/pay/cs_..."
}
```

### `POST /api/billing/portal`
Create Stripe customer portal session.

**Authentication**: Required

**Request Body:**
```json
{
  "returnUrl": "https://yourapp.com/billing"
}
```

**Response:**
```json
{
  "success": true,
  "url": "https://billing.stripe.com/session/..."
}
```

### `POST /api/billing/webhook`
Handle Stripe webhook events.

**Authentication**: Stripe webhook signature  
**Content-Type**: `application/json`

**Request Headers:**
```
Stripe-Signature: stripe_signature
```

**Response:**
```json
{
  "received": true
}
```

---

## 7. System & Monitoring Endpoints

### `GET /api/health`
System health check endpoint.

**Authentication**: Not required  
**Rate Limit**: No limit

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T15:30:00Z",
  "version": "1.0.0",
  "uptime": 345600,
  "checks": [
    {
      "name": "database",
      "status": "healthy",
      "responseTime": 15,
      "metadata": {
        "totalConnections": 8,
        "idleConnections": 6
      }
    },
    {
      "name": "redis",
      "status": "healthy",
      "responseTime": 3
    },
    {
      "name": "aws",
      "status": "healthy",
      "responseTime": 120
    },
    {
      "name": "openai",
      "status": "healthy",
      "responseTime": 250
    }
  ]
}
```

**Health Status Values:**
- `healthy`: All systems operational
- `degraded`: Some non-critical issues
- `unhealthy`: Critical issues affecting service

### `GET /api/analytics/stats`
Get application statistics (Admin only).

**Authentication**: Required (Admin role)

**Query Parameters:**
- `period`: 'day', 'week', 'month' (default: 'week')

**Response:**
```json
{
  "success": true,
  "stats": {
    "period": "week",
    "users": {
      "total": 1250,
      "active": 890,
      "newSignups": 45,
      "churnRate": 2.1
    },
    "content": {
      "totalFiles": 15680,
      "newUploads": 234,
      "processingQueue": 12,
      "storageUsedGb": 2340
    },
    "usage": {
      "searches": 12450,
      "averageResponseTime": 1.8,
      "cacheHitRate": 78.5
    },
    "costs": {
      "aws": 145.60,
      "openai": 89.20,
      "total": 234.80
    }
  }
}
```

---

## 8. Error Responses

### Standard Error Format
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": [
      {
        "field": "fileSize",
        "message": "File size exceeds maximum limit of 500MB"
      }
    ],
    "timestamp": "2024-01-15T15:30:00Z",
    "requestId": "uuid"
  }
}
```

### Common Error Codes

**Authentication Errors:**
- `INVALID_TOKEN`: Invalid or expired authentication token
- `TOKEN_MISSING`: No authentication token provided
- `INSUFFICIENT_PERMISSIONS`: User lacks required permissions

**Validation Errors:**
- `VALIDATION_ERROR`: Request validation failed
- `INVALID_FILE_TYPE`: Unsupported file type
- `FILE_TOO_LARGE`: File exceeds size limit
- `MISSING_REQUIRED_FIELD`: Required field not provided

**Rate Limiting:**
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `UPLOAD_LIMIT_EXCEEDED`: Monthly upload limit exceeded
- `SEARCH_LIMIT_EXCEEDED`: Monthly search limit exceeded

**Resource Errors:**
- `NOT_FOUND`: Requested resource not found
- `ALREADY_EXISTS`: Resource already exists
- `PROCESSING_ERROR`: Error during file processing
- `STORAGE_QUOTA_EXCEEDED`: User storage quota exceeded

**System Errors:**
- `INTERNAL_ERROR`: Unexpected server error
- `SERVICE_UNAVAILABLE`: External service unavailable
- `MAINTENANCE_MODE`: System under maintenance

---

## 9. Rate Limits

### Rate Limit Headers
All responses include rate limiting headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705329000
X-RateLimit-Window: 3600
```

### Rate Limits by Endpoint

| Endpoint | Free Tier | Premium | Ultimate |
|----------|-----------|---------|----------|
| Upload | 5/hour | 20/hour | 50/hour |
| Search | 50/hour | 200/hour | 500/hour |
| API General | 100/hour | 500/hour | 1000/hour |
| Processing Status | 60/hour | 300/hour | Unlimited |

---

## 10. Webhooks

### Processing Complete Webhook
When file processing completes, a webhook can be sent to your configured endpoint.

**Webhook URL Configuration**: Set via environment variable or admin panel

**Request:**
```json
{
  "event": "processing.completed",
  "mediaFileId": "uuid",
  "userId": "uuid",
  "status": "completed",
  "processingTime": 240,
  "timestamp": "2024-01-15T10:35:00Z",
  "data": {
    "aiSummary": "A family vacation video...",
    "detectedLabels": ["Beach", "Family"],
    "sentiment": "POSITIVE",
    "hasEmbedding": true
  }
}
```

### Webhook Verification
Webhooks include signature header for verification:
```
X-Webhook-Signature: sha256=calculated_signature
```

---

**API Version**: 1.0  
**Last Updated**: [Date]  
**Support**: api-support@yourdomain.com
