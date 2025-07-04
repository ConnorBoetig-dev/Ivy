# API Documentation with Examples

## 🔐 Authentication

All API endpoints (except auth endpoints) require authentication via Firebase ID token.

### Headers Required
```http
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
X-Request-Id: <optional-uuid-for-tracing>
```

### Getting Authentication Token
```javascript
// Frontend example
const user = auth.currentUser;
const token = await user.getIdToken();

// Make authenticated request
const response = await fetch('/api/media', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

---

## 📤 Upload APIs

### Get Presigned Upload URL
**POST** `/api/upload/presigned-url`

Generate a presigned URL for direct S3 upload.

#### Request
```json
{
  "filename": "vacation-photo.jpg",
  "fileType": "image/jpeg",
  "fileSize": 2485760
}
```

#### Response (200 OK)
```json
{
  "uploadUrl": "https://s3.amazonaws.com/bucket/...",
  "mediaId": "550e8400-e29b-41d4-a716-446655440000",
  "expiresAt": "2024-01-20T15:30:00Z"
}
```

#### Response (400 Bad Request)
```json
{
  "error": "File size exceeds maximum allowed (500MB)",
  "code": "FILE_TOO_LARGE",
  "maxSize": 524288000
}
```

#### CURL Example
```bash
curl -X POST https://api.example.com/api/upload/presigned-url \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "test.jpg",
    "fileType": "image/jpeg",
    "fileSize": 1048576
  }'
```

### Confirm Upload Complete
**POST** `/api/upload/confirm`

Confirm successful S3 upload and trigger processing.

#### Request
```json
{
  "mediaId": "550e8400-e29b-41d4-a716-446655440000",
  "s3Key": "uploads/550e8400/vacation-photo.jpg"
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "mediaItem": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "processing",
    "createdAt": "2024-01-20T14:30:00Z",
    "processingJobs": [
      {
        "id": "job-123",
        "type": "image-processing",
        "status": "queued"
      }
    ]
  }
}
```

---

## 🔍 Search APIs

### Natural Language Search
**POST** `/api/search`

Search media using natural language queries.

#### Request
```json
{
  "query": "sunset at the beach with palm trees",
  "filters": {
    "mediaType": ["image", "video"],
    "dateRange": {
      "start": "2024-01-01",
      "end": "2024-12-31"
    }
  },
  "limit": 20,
  "offset": 0
}
```

#### Response (200 OK)
```json
{
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "filename": "beach-sunset.jpg",
      "fileType": "image",
      "thumbnailUrl": "https://cdn.example.com/thumbs/...",
      "similarity": 0.945,
      "metadata": {
        "labels": ["sunset", "beach", "palm tree", "ocean"],
        "location": "Maldives",
        "dateTaken": "2024-06-15"
      },
      "highlights": {
        "labels": ["<mark>sunset</mark>", "<mark>beach</mark>", "<mark>palm tree</mark>"]
      }
    }
  ],
  "totalCount": 42,
  "nextOffset": 20,
  "searchId": "search-789",
  "processingTime": 145
}
```

#### Advanced Search Example
```javascript
// Search with multiple filters
const response = await fetch('/api/search', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    query: "family vacation 2024",
    filters: {
      mediaType: ["image"],
      dateRange: {
        start: "2024-01-01",
        end: "2024-12-31"
      },
      labels: ["people", "outdoor"],
      hasTranscription: false
    },
    sort: "relevance", // or "date", "size"
    limit: 50
  })
});
```

### Get Search Suggestions
**GET** `/api/search/suggestions?q=beach`

Get search suggestions based on partial query.

#### Response (200 OK)
```json
{
  "suggestions": [
    "beach sunset",
    "beach vacation",
    "beach wedding",
    "beach volleyball"
  ]
}
```

---

## 📁 Media Management APIs

### Get Media Item
**GET** `/api/media/{mediaId}`

Retrieve detailed information about a media item.

#### Response (200 OK)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "vacation-video.mp4",
  "fileType": "video",
  "fileSize": 52428800,
  "duration": 180,
  "uploadedAt": "2024-01-20T14:30:00Z",
  "processingStatus": "completed",
  "s3Key": "media/550e8400/vacation-video.mp4",
  "thumbnails": [
    "https://cdn.example.com/thumbs/550e8400-0.jpg",
    "https://cdn.example.com/thumbs/550e8400-1.jpg"
  ],
  "metadata": {
    "transcription": "This is our family vacation in Hawaii...",
    "labels": ["beach", "family", "vacation", "hawaii"],
    "sentiment": "positive",
    "entities": ["Hawaii", "Waikiki Beach"],
    "processingCosts": {
      "transcribe": 0.072,
      "rekognition": 0.18,
      "comprehend": 0.001
    }
  },
  "downloadUrl": "https://s3.amazonaws.com/...", // Presigned URL, expires in 1 hour
  "shareUrl": "https://app.example.com/share/abc123"
}
```

### List User Media
**GET** `/api/media?limit=20&offset=0&sort=date&order=desc`

List all media items for authenticated user.

#### Query Parameters
- `limit` (number): Items per page (max 100)
- `offset` (number): Pagination offset
- `sort` (string): Sort by `date`, `name`, `size`
- `order` (string): `asc` or `desc`
- `status` (string): Filter by processing status
- `type` (string): Filter by media type

#### Response (200 OK)
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "filename": "photo.jpg",
      "fileType": "image",
      "fileSize": 2485760,
      "uploadedAt": "2024-01-20T14:30:00Z",
      "status": "completed",
      "thumbnailUrl": "https://cdn.example.com/thumbs/..."
    }
  ],
  "pagination": {
    "total": 156,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

### Delete Media Item
**DELETE** `/api/media/{mediaId}`

Delete a media item and all associated data.

#### Response (200 OK)
```json
{
  "success": true,
  "deleted": {
    "mediaItem": true,
    "s3Objects": 3,
    "embeddings": 1,
    "searchHistory": 5
  }
}
```

### Batch Operations
**POST** `/api/media/batch`

Perform operations on multiple media items.

#### Request
```json
{
  "operation": "delete", // or "reprocess", "download"
  "mediaIds": [
    "550e8400-e29b-41d4-a716-446655440000",
    "660f9500-f39c-52d5-b827-557766550111"
  ]
}
```

#### Response (202 Accepted)
```json
{
  "batchId": "batch-999",
  "operation": "delete",
  "itemCount": 2,
  "status": "processing",
  "estimatedCompletion": "2024-01-20T15:00:00Z"
}
```

---

## 💰 Billing APIs

### Get Current Usage
**GET** `/api/billing/usage`

Get current billing period usage statistics.

#### Response (200 OK)
```json
{
  "period": {
    "start": "2024-01-01",
    "end": "2024-01-31",
    "daysRemaining": 11
  },
  "subscription": {
    "tier": "premium",
    "status": "active",
    "renewsAt": "2024-02-01"
  },
  "usage": {
    "uploads": {
      "used": 45,
      "limit": 100,
      "percentage": 45
    },
    "storage": {
      "used": 15728640000, // bytes
      "limit": 53687091200, // 50GB
      "percentage": 29.3
    },
    "searches": {
      "used": 234,
      "limit": 500,
      "percentage": 46.8
    },
    "apiCalls": {
      "breakdown": {
        "rekognition": 450,
        "transcribe": 23,
        "comprehend": 234,
        "openai": 567
      },
      "totalCost": 12.45
    }
  },
  "costs": {
    "current": 12.45,
    "projected": 41.50,
    "budget": 50.00
  }
}
```

### Update Subscription
**POST** `/api/billing/subscription`

Update subscription tier.

#### Request
```json
{
  "tier": "ultimate",
  "interval": "monthly" // or "annual"
}
```

#### Response (200 OK)
```json
{
  "subscription": {
    "id": "sub_1234567890",
    "tier": "ultimate",
    "interval": "monthly",
    "status": "active",
    "currentPeriodEnd": "2024-02-01",
    "cancelAtPeriodEnd": false
  },
  "paymentIntent": {
    "clientSecret": "pi_xxxx_secret_xxxx",
    "amount": 4900, // cents
    "currency": "usd"
  }
}
```

### Get Billing History
**GET** `/api/billing/history?limit=12`

Get billing history and invoices.

#### Response (200 OK)
```json
{
  "invoices": [
    {
      "id": "inv_123",
      "date": "2024-01-01",
      "amount": 2900,
      "status": "paid",
      "description": "Premium Plan - January 2024",
      "downloadUrl": "https://stripe.com/invoice/..."
    }
  ]
}
```

---

## 📊 Analytics APIs

### Get Media Analytics
**GET** `/api/analytics/media?period=30d`

Get analytics for media usage.

#### Response (200 OK)
```json
{
  "period": "30d",
  "summary": {
    "totalUploads": 156,
    "totalSize": 4294967296,
    "averageProcessingTime": 34.5,
    "mostCommonLabels": [
      { "label": "outdoor", "count": 89 },
      { "label": "people", "count": 67 },
      { "label": "nature", "count": 45 }
    ]
  },
  "timeline": [
    {
      "date": "2024-01-20",
      "uploads": 5,
      "searches": 23,
      "size": 134217728
    }
  ],
  "mediaTypes": {
    "image": { "count": 134, "size": 2147483648 },
    "video": { "count": 22, "size": 2147483648 }
  }
}
```

### Get Search Analytics
**GET** `/api/analytics/search?period=7d`

Get search query analytics.

#### Response (200 OK)
```json
{
  "period": "7d",
  "summary": {
    "totalSearches": 234,
    "uniqueQueries": 89,
    "averageResultsPerSearch": 12.3,
    "clickThroughRate": 0.67
  },
  "topQueries": [
    { "query": "family vacation", "count": 23, "avgResults": 15 },
    { "query": "beach sunset", "count": 19, "avgResults": 8 }
  ],
  "searchPatterns": {
    "byHour": {
      "0": 2, "1": 1, "2": 0, // ... hourly data
      "20": 15, "21": 12, "22": 8, "23": 5
    },
    "byType": {
      "natural_language": 180,
      "label_based": 54
    }
  }
}
```

---

## ⚙️ Admin APIs

### Queue Statistics
**GET** `/api/admin/queues/stats`

Get queue processing statistics (admin only).

#### Response (200 OK)
```json
{
  "queues": {
    "image-processing": {
      "waiting": 5,
      "active": 2,
      "completed": 1234,
      "failed": 3,
      "avgProcessingTime": 23.4
    },
    "video-processing": {
      "waiting": 1,
      "active": 1,
      "completed": 89,
      "failed": 0,
      "avgProcessingTime": 145.2
    }
  },
  "workers": {
    "total": 4,
    "active": 3,
    "idle": 1
  }
}
```

### System Health
**GET** `/api/health`

Check system health status (public endpoint).

#### Response (200 OK)
```json
{
  "status": "healthy",
  "timestamp": "2024-01-20T15:30:00Z",
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "s3": "healthy",
    "workers": "healthy"
  },
  "version": "1.0.0",
  "uptime": 864000
}
```

---

## 🔄 Webhook Events

### Processing Complete
**POST** `<your-webhook-url>`

Sent when media processing is complete.

#### Webhook Payload
```json
{
  "event": "media.processing.complete",
  "timestamp": "2024-01-20T15:30:00Z",
  "data": {
    "mediaId": "550e8400-e29b-41d4-a716-446655440000",
    "userId": "user-123",
    "filename": "video.mp4",
    "status": "completed",
    "processingTime": 145,
    "costs": {
      "total": 0.253,
      "breakdown": {
        "transcribe": 0.072,
        "rekognition": 0.18,
        "openai": 0.001
      }
    }
  }
}
```

### Webhook Security
```javascript
// Verify webhook signature
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return hash === signature;
}

// In your webhook handler
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const isValid = verifyWebhookSignature(
    JSON.stringify(req.body),
    signature,
    process.env.WEBHOOK_SECRET
  );
  
  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process webhook
});
```

---

## 🚨 Error Responses

All errors follow a consistent format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {
    // Additional context
  },
  "requestId": "req-123",
  "timestamp": "2024-01-20T15:30:00Z"
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `RATE_LIMITED` | 429 | Too many requests |
| `QUOTA_EXCEEDED` | 403 | Subscription limit reached |
| `FILE_TOO_LARGE` | 400 | File exceeds size limit |
| `UNSUPPORTED_FORMAT` | 400 | File type not supported |
| `PROCESSING_FAILED` | 500 | Media processing error |
| `PAYMENT_REQUIRED` | 402 | Payment method required |

### Rate Limiting Headers
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1705765800
```

---

## 🧪 Testing with Postman

### Postman Collection
Import this collection for testing:

```json
{
  "info": {
    "name": "AI Media Search API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "auth": {
    "type": "bearer",
    "bearer": [
      {
        "key": "token",
        "value": "{{firebaseToken}}",
        "type": "string"
      }
    ]
  },
  "variable": [
    {
      "key": "baseUrl",
      "value": "https://api.example.com"
    },
    {
      "key": "firebaseToken",
      "value": ""
    }
  ],
  "item": [
    {
      "name": "Upload",
      "item": [
        {
          "name": "Get Presigned URL",
          "request": {
            "method": "POST",
            "header": [],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"filename\": \"test.jpg\",\n  \"fileType\": \"image/jpeg\",\n  \"fileSize\": 1048576\n}",
              "options": {
                "raw": {
                  "language": "json"
                }
              }
            },
            "url": {
              "raw": "{{baseUrl}}/api/upload/presigned-url",
              "host": ["{{baseUrl}}"],
              "path": ["api", "upload", "presigned-url"]
            }
          }
        }
      ]
    }
  ]
}
```

### Environment Variables
```javascript
// Pre-request Script to get Firebase token
pm.sendRequest({
  url: 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + pm.environment.get('firebaseApiKey'),
  method: 'POST',
  header: {
    'Content-Type': 'application/json'
  },
  body: {
    mode: 'raw',
    raw: JSON.stringify({
      email: pm.environment.get('testEmail'),
      password: pm.environment.get('testPassword'),
      returnSecureToken: true
    })
  }
}, function (err, res) {
  if (!err) {
    var jsonData = res.json();
    pm.environment.set('firebaseToken', jsonData.idToken);
  }
});
```

---

## 📝 SDK Examples

### JavaScript/TypeScript SDK
```typescript
// Initialize client
import { AIMediaSearchClient } from '@ai-media-search/sdk';

const client = new AIMediaSearchClient({
  apiUrl: 'https://api.example.com',
  getAuthToken: async () => {
    const user = auth.currentUser;
    return user ? user.getIdToken() : null;
  }
});

// Upload file
const { uploadUrl, mediaId } = await client.upload.getPresignedUrl({
  filename: 'photo.jpg',
  fileType: 'image/jpeg',
  fileSize: file.size
});

await fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: {
    'Content-Type': 'image/jpeg'
  }
});

await client.upload.confirm({ mediaId, s3Key });

// Search
const results = await client.search.query({
  query: 'sunset beach',
  limit: 20
});

// Get media
const media = await client.media.get(mediaId);
```

### Python SDK
```python
from ai_media_search import Client

# Initialize
client = Client(
    api_url="https://api.example.com",
    auth_token=firebase_token
)

# Upload
presigned = client.upload.get_presigned_url(
    filename="video.mp4",
    file_type="video/mp4",
    file_size=10485760
)

# Upload to S3
with open("video.mp4", "rb") as f:
    requests.put(presigned["upload_url"], data=f)

client.upload.confirm(
    media_id=presigned["media_id"],
    s3_key=presigned["s3_key"]
)

# Search
results = client.search.query("family vacation 2024")

for result in results:
    print(f"{result.filename} - {result.similarity}")
```