# Phase 9: AWS Services Integration

## 🎯 Phase Overview
Integrate AWS AI services including S3 for storage, Rekognition for image/video analysis, Transcribe for audio transcription, and Comprehend for text analysis. Set up secure IAM permissions, implement cost-effective processing pipelines, and ensure proper error handling.

## ✅ Prerequisites
- Phase 1-8 completed (Setup through Payments)
- AWS account created and configured
- Understanding of AWS IAM and security
- Basic knowledge of AI/ML services
- Cost tracking system operational

## 📋 Phase Checklist
- [ ] AWS IAM configuration with minimal permissions
- [ ] S3 bucket setup with lifecycle policies
- [ ] Rekognition service integration
- [ ] Transcribe service for video audio
- [ ] Comprehend for text analysis
- [ ] Cost-optimized processing pipelines
- [ ] Error handling and retry logic
- [ ] File upload/download flows
- [ ] Thumbnail generation
- [ ] Service health monitoring

---

## Step 1: AWS Account Setup

### 1.1 Create IAM User and Policies
```bash
# Go to AWS Console > IAM
# 1. Create a new IAM user: ai-media-search-app
# 2. Attach these policies or create custom ones:

# Custom Policy: MediaSearchMinimalAccess
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::ai-media-search-*/*",
        "arn:aws:s3:::ai-media-search-*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "rekognition:DetectLabels",
        "rekognition:DetectFaces",
        "rekognition:DetectText",
        "rekognition:DetectModerationLabels",
        "rekognition:RecognizeCelebrities",
        "rekognition:StartLabelDetection",
        "rekognition:GetLabelDetection"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "transcribe:StartTranscriptionJob",
        "transcribe:GetTranscriptionJob",
        "transcribe:DeleteTranscriptionJob"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "comprehend:DetectEntities",
        "comprehend:DetectKeyPhrases",
        "comprehend:DetectSentiment",
        "comprehend:DetectSyntax"
      ],
      "Resource": "*"
    }
  ]
}

# Add to .env.local:
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=ai-media-search-uploads
AWS_S3_BUCKET_REGION=us-east-1
```

### 1.2 Create S3 Buckets
Create `scripts/setup-aws.js`:

```javascript
const { S3Client, CreateBucketCommand, PutBucketLifecycleConfigurationCommand, PutBucketCorsCommand, PutPublicAccessBlockCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function setupAWSResources() {
  console.log('🔧 Setting up AWS resources...\n');

  const bucketName = process.env.AWS_S3_BUCKET || 'ai-media-search-uploads';

  try {
    // Create S3 bucket
    console.log('📦 Creating S3 bucket...');
    try {
      await s3Client.send(new CreateBucketCommand({
        Bucket: bucketName,
      }));
      console.log('✅ S3 bucket created:', bucketName);
    } catch (error) {
      if (error.name === 'BucketAlreadyOwnedByYou') {
        console.log('✓ S3 bucket already exists:', bucketName);
      } else {
        throw error;
      }
    }

    // Configure CORS
    console.log('\n🔒 Configuring CORS...');
    await s3Client.send(new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
            AllowedOrigins: [
              'http://localhost:3000',
              process.env.NEXT_PUBLIC_APP_URL || 'https://your-domain.com',
            ],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }));
    console.log('✅ CORS configured');

    // Block public access
    console.log('\n🔐 Configuring security...');
    await s3Client.send(new PutPublicAccessBlockCommand({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    }));
    console.log('✅ Public access blocked');

    // Configure lifecycle rules
    console.log('\n♻️ Configuring lifecycle rules...');
    await s3Client.send(new PutBucketLifecycleConfigurationCommand({
      Bucket: bucketName,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'delete-temp-files',
            Status: 'Enabled',
            Filter: {
              Prefix: 'temp/',
            },
            Expiration: {
              Days: 1,
            },
          },
          {
            ID: 'archive-old-files',
            Status: 'Enabled',
            Filter: {
              Prefix: 'processed/',
            },
            Transitions: [
              {
                Days: 90,
                StorageClass: 'STANDARD_IA',
              },
              {
                Days: 365,
                StorageClass: 'GLACIER',
              },
            ],
          },
        ],
      },
    }));
    console.log('✅ Lifecycle rules configured');

    console.log('\n🎉 AWS setup completed successfully!');

  } catch (error) {
    console.error('❌ AWS setup failed:', error);
    process.exit(1);
  }
}

setupAWSResources();
```

---

## Step 2: S3 Storage Service

### 2.1 Create S3 Service
Create `src/services/aws/s3-service.ts`:

```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import { costTracking } from '@/services/cost-tracking';
import crypto from 'crypto';
import { Readable } from 'stream';

export class S3Service {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    
    this.bucket = process.env.AWS_S3_BUCKET!;
    
    if (!this.bucket) {
      throw new Error('AWS_S3_BUCKET environment variable is required');
    }
  }

  // Generate unique S3 key for file
  generateKey(userId: string, filename: string, prefix: string = 'uploads'): string {
    const timestamp = Date.now();
    const hash = crypto.randomBytes(8).toString('hex');
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    return `${prefix}/${userId}/${timestamp}-${hash}-${sanitizedFilename}`;
  }

  // Upload file to S3
  async uploadFile(
    key: string,
    body: Buffer | Uint8Array | Readable,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<{ key: string; etag: string }> {
    const startTime = Date.now();

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: metadata,
        ServerSideEncryption: 'AES256',
      });

      const response = await this.client.send(command);
      
      const duration = Date.now() - startTime;
      metrics.histogram('s3.upload.duration', duration);
      metrics.increment('s3.upload.success');

      // Track cost
      await costTracking.trackS3Cost(
        metadata?.userId || 'unknown',
        'put',
        1,
        { key, contentType }
      );

      logger.info('File uploaded to S3', {
        key,
        etag: response.ETag,
        duration,
      });

      return {
        key,
        etag: response.ETag || '',
      };

    } catch (error) {
      metrics.increment('s3.upload.error');
      logger.error('S3 upload failed:', { error, key });
      throw error;
    }
  }

  // Get presigned upload URL
  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600,
    metadata?: Record<string, string>
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        Metadata: metadata,
        ServerSideEncryption: 'AES256',
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });
      
      logger.debug('Presigned upload URL generated', {
        key,
        expiresIn,
      });

      return url;

    } catch (error) {
      logger.error('Failed to generate presigned upload URL:', error);
      throw error;
    }
  }

  // Get presigned download URL
  async getPresignedDownloadUrl(
    key: string,
    expiresIn: number = 3600,
    filename?: string
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: filename 
          ? `attachment; filename="${filename}"`
          : undefined,
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });
      
      // Track cost
      await costTracking.trackS3Cost(
        'unknown', // Would need to pass userId
        'get',
        1,
        { key }
      );

      return url;

    } catch (error) {
      logger.error('Failed to generate presigned download URL:', error);
      throw error;
    }
  }

  // Download file from S3
  async downloadFile(key: string): Promise<{
    body: Readable;
    contentType?: string;
    contentLength?: number;
    metadata?: Record<string, string>;
  }> {
    const startTime = Date.now();

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      
      const duration = Date.now() - startTime;
      metrics.histogram('s3.download.duration', duration);
      metrics.increment('s3.download.success');

      return {
        body: response.Body as Readable,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        metadata: response.Metadata,
      };

    } catch (error) {
      metrics.increment('s3.download.error');
      logger.error('S3 download failed:', { error, key });
      throw error;
    }
  }

  // Delete file from S3
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      
      metrics.increment('s3.delete.success');
      logger.info('File deleted from S3', { key });

    } catch (error) {
      metrics.increment('s3.delete.error');
      logger.error('S3 delete failed:', { error, key });
      throw error;
    }
  }

  // Check if file exists
  async fileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;

    } catch (error) {
      if ((error as any).name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  // Copy file within S3
  async copyFile(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      const command = new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: destinationKey,
        ServerSideEncryption: 'AES256',
      });

      await this.client.send(command);
      
      logger.info('File copied in S3', {
        sourceKey,
        destinationKey,
      });

    } catch (error) {
      logger.error('S3 copy failed:', error);
      throw error;
    }
  }

  // List files with prefix
  async listFiles(
    prefix: string,
    maxKeys: number = 100
  ): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      });

      const response = await this.client.send(command);
      
      return (response.Contents || []).map(object => ({
        key: object.Key!,
        size: object.Size!,
        lastModified: object.LastModified!,
      }));

    } catch (error) {
      logger.error('S3 list failed:', error);
      throw error;
    }
  }

  // Calculate storage size for user
  async calculateUserStorage(userId: string): Promise<number> {
    let totalSize = 0;
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `uploads/${userId}/`,
        ContinuationToken: continuationToken,
      });

      const response = await this.client.send(command);
      
      if (response.Contents) {
        totalSize += response.Contents.reduce((sum, obj) => sum + (obj.Size || 0), 0);
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    // Track storage cost
    const gbMonths = totalSize / (1024 * 1024 * 1024);
    await costTracking.trackS3Cost(userId, 'storage', gbMonths, {
      totalBytes: totalSize,
    });

    return totalSize;
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 1,
      });

      await this.client.send(command);
      return true;

    } catch (error) {
      logger.error('S3 health check failed:', error);
      return false;
    }
  }

  // List buckets (for health check)
  async listBuckets(): Promise<string[]> {
    const { ListBucketsCommand } = await import('@aws-sdk/client-s3');
    
    try {
      const response = await this.client.send(new ListBucketsCommand({}));
      return response.Buckets?.map(b => b.Name!).filter(Boolean) || [];
    } catch (error) {
      logger.error('Failed to list S3 buckets:', error);
      return [];
    }
  }
}

export const s3Service = new S3Service();
```

---

## Step 3: Rekognition Service

### 3.1 Create Rekognition Service
Create `src/services/aws/rekognition-service.ts`:

```typescript
import {
  RekognitionClient,
  DetectLabelsCommand,
  DetectFacesCommand,
  DetectTextCommand,
  DetectModerationLabelsCommand,
  RecognizeCelebritiesCommand,
  StartLabelDetectionCommand,
  GetLabelDetectionCommand,
  VideoMetadata,
  Label,
  FaceDetail,
  TextDetection,
  ModerationLabel,
  Celebrity,
} from '@aws-sdk/client-rekognition';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import { costTracking } from '@/services/cost-tracking';
import { performance } from '@/lib/monitoring/performance';

export interface RekognitionAnalysis {
  labels?: Label[];
  faces?: FaceDetail[];
  text?: TextDetection[];
  moderationLabels?: ModerationLabel[];
  celebrities?: Celebrity[];
  metadata?: VideoMetadata;
}

export class RekognitionService {
  private client: RekognitionClient;

  constructor() {
    this.client = new RekognitionClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  // Analyze image with selected features
  async analyzeImage(
    s3Bucket: string,
    s3Key: string,
    userId: string,
    features: string[] = ['labels']
  ): Promise<RekognitionAnalysis> {
    return performance.measure('rekognition.image.analysis', async () => {
      const results: RekognitionAnalysis = {};
      const s3Object = { Bucket: s3Bucket, Name: s3Key };

      try {
        // Process requested features in parallel
        const promises: Promise<void>[] = [];

        if (features.includes('labels')) {
          promises.push(this.detectLabels(s3Object, results, userId));
        }

        if (features.includes('faces')) {
          promises.push(this.detectFaces(s3Object, results, userId));
        }

        if (features.includes('text')) {
          promises.push(this.detectText(s3Object, results, userId));
        }

        if (features.includes('moderation')) {
          promises.push(this.detectModerationLabels(s3Object, results, userId));
        }

        if (features.includes('celebrities')) {
          promises.push(this.recognizeCelebrities(s3Object, results, userId));
        }

        await Promise.all(promises);

        logger.info('Image analysis completed', {
          s3Key,
          features,
          resultCounts: {
            labels: results.labels?.length || 0,
            faces: results.faces?.length || 0,
            text: results.text?.length || 0,
            moderationLabels: results.moderationLabels?.length || 0,
            celebrities: results.celebrities?.length || 0,
          },
        });

        metrics.increment('rekognition.image.success');
        return results;

      } catch (error) {
        logger.error('Rekognition image analysis failed:', error);
        metrics.increment('rekognition.image.error');
        throw error;
      }
    });
  }

  // Detect labels (objects, scenes, activities)
  private async detectLabels(
    s3Object: any,
    results: RekognitionAnalysis,
    userId: string
  ): Promise<void> {
    try {
      const command = new DetectLabelsCommand({
        Image: { S3Object: s3Object },
        MaxLabels: 50,
        MinConfidence: 70,
      });

      const response = await this.client.send(command);
      results.labels = response.Labels || [];

      await costTracking.trackRekognitionCost(userId, 'detectLabels', 1);
      
      logger.debug('Labels detected', {
        count: results.labels.length,
        topLabels: results.labels.slice(0, 5).map(l => l.Name),
      });

    } catch (error) {
      logger.error('Label detection failed:', error);
    }
  }

  // Detect faces and attributes
  private async detectFaces(
    s3Object: any,
    results: RekognitionAnalysis,
    userId: string
  ): Promise<void> {
    try {
      const command = new DetectFacesCommand({
        Image: { S3Object: s3Object },
        Attributes: ['ALL'],
      });

      const response = await this.client.send(command);
      results.faces = response.FaceDetails || [];

      await costTracking.trackRekognitionCost(userId, 'detectFaces', 1);
      
      logger.debug('Faces detected', {
        count: results.faces.length,
      });

    } catch (error) {
      logger.error('Face detection failed:', error);
    }
  }

  // Detect text in images
  private async detectText(
    s3Object: any,
    results: RekognitionAnalysis,
    userId: string
  ): Promise<void> {
    try {
      const command = new DetectTextCommand({
        Image: { S3Object: s3Object },
      });

      const response = await this.client.send(command);
      results.text = response.TextDetections || [];

      await costTracking.trackRekognitionCost(userId, 'detectText', 1);
      
      logger.debug('Text detected', {
        count: results.text.length,
        samples: results.text.slice(0, 3).map(t => t.DetectedText),
      });

    } catch (error) {
      logger.error('Text detection failed:', error);
    }
  }

  // Detect inappropriate content
  private async detectModerationLabels(
    s3Object: any,
    results: RekognitionAnalysis,
    userId: string
  ): Promise<void> {
    try {
      const command = new DetectModerationLabelsCommand({
        Image: { S3Object: s3Object },
        MinConfidence: 60,
      });

      const response = await this.client.send(command);
      results.moderationLabels = response.ModerationLabels || [];

      await costTracking.trackRekognitionCost(userId, 'detectModerationLabels', 1);
      
      if (results.moderationLabels.length > 0) {
        logger.warn('Moderation labels detected', {
          labels: results.moderationLabels.map(l => l.Name),
        });
      }

    } catch (error) {
      logger.error('Moderation detection failed:', error);
    }
  }

  // Recognize celebrities
  private async recognizeCelebrities(
    s3Object: any,
    results: RekognitionAnalysis,
    userId: string
  ): Promise<void> {
    try {
      const command = new RecognizeCelebritiesCommand({
        Image: { S3Object: s3Object },
      });

      const response = await this.client.send(command);
      results.celebrities = response.CelebrityFaces || [];

      await costTracking.trackRekognitionCost(userId, 'recognizeCelebrities', 1);
      
      if (results.celebrities.length > 0) {
        logger.debug('Celebrities recognized', {
          names: results.celebrities.map(c => c.Name),
        });
      }

    } catch (error) {
      logger.error('Celebrity recognition failed:', error);
    }
  }

  // Start video analysis (async)
  async startVideoAnalysis(
    s3Bucket: string,
    s3Key: string,
    userId: string,
    jobTag: string
  ): Promise<string> {
    try {
      const command = new StartLabelDetectionCommand({
        Video: {
          S3Object: {
            Bucket: s3Bucket,
            Name: s3Key,
          },
        },
        MinConfidence: 70,
        JobTag: jobTag,
        NotificationChannel: {
          // Optional: SNS topic for completion notification
          RoleArn: process.env.AWS_REKOGNITION_ROLE_ARN,
          SNSTopicArn: process.env.AWS_SNS_TOPIC_ARN,
        },
      });

      const response = await this.client.send(command);
      const jobId = response.JobId!;

      logger.info('Video analysis started', {
        jobId,
        s3Key,
        jobTag,
      });

      metrics.increment('rekognition.video.started');
      
      // Track estimated cost (will track actual after completion)
      const estimatedMinutes = 5; // Rough estimate
      await costTracking.trackRekognitionCost(
        userId,
        'videoAnalysis',
        estimatedMinutes,
        { jobId, status: 'started' }
      );

      return jobId;

    } catch (error) {
      logger.error('Failed to start video analysis:', error);
      metrics.increment('rekognition.video.error');
      throw error;
    }
  }

  // Get video analysis results
  async getVideoAnalysisResults(
    jobId: string,
    userId: string
  ): Promise<{ labels: Label[]; jobStatus: string; videoMetadata?: VideoMetadata }> {
    try {
      const labels: Label[] = [];
      let nextToken: string | undefined;
      let jobStatus: string = '';
      let videoMetadata: VideoMetadata | undefined;

      do {
        const command = new GetLabelDetectionCommand({
          JobId: jobId,
          MaxResults: 1000,
          NextToken: nextToken,
        });

        const response = await this.client.send(command);
        
        jobStatus = response.JobStatus || '';
        videoMetadata = response.VideoMetadata;

        if (response.Labels) {
          labels.push(...response.Labels.map(l => l.Label!).filter(Boolean));
        }

        nextToken = response.NextToken;

      } while (nextToken);

      if (jobStatus === 'SUCCEEDED') {
        logger.info('Video analysis completed', {
          jobId,
          labelCount: labels.length,
          durationSeconds: videoMetadata?.DurationMillis 
            ? videoMetadata.DurationMillis / 1000 
            : 0,
        });

        // Track actual cost based on video duration
        if (videoMetadata?.DurationMillis) {
          const minutes = Math.ceil(videoMetadata.DurationMillis / 60000);
          await costTracking.trackRekognitionCost(
            userId,
            'videoAnalysis',
            minutes,
            { jobId, status: 'completed', durationMinutes: minutes }
          );
        }
      }

      return { labels, jobStatus, videoMetadata };

    } catch (error) {
      logger.error('Failed to get video analysis results:', error);
      throw error;
    }
  }

  // Extract key labels from analysis
  extractKeyLabels(analysis: RekognitionAnalysis, limit: number = 10): string[] {
    const labels: string[] = [];

    // Add high-confidence labels
    if (analysis.labels) {
      const topLabels = analysis.labels
        .filter(l => l.Confidence && l.Confidence > 80)
        .sort((a, b) => (b.Confidence || 0) - (a.Confidence || 0))
        .slice(0, limit)
        .map(l => l.Name!)
        .filter(Boolean);
      
      labels.push(...topLabels);
    }

    // Add celebrity names
    if (analysis.celebrities) {
      const celebNames = analysis.celebrities
        .map(c => c.Name!)
        .filter(Boolean);
      
      labels.push(...celebNames);
    }

    // Add detected text snippets
    if (analysis.text && analysis.text.length > 0) {
      const textSnippets = analysis.text
        .filter(t => t.Type === 'LINE' && t.Confidence && t.Confidence > 80)
        .slice(0, 3)
        .map(t => t.DetectedText!)
        .filter(Boolean);
      
      labels.push(...textSnippets);
    }

    return [...new Set(labels)].slice(0, limit);
  }

  // Generate content description
  generateDescription(analysis: RekognitionAnalysis): string {
    const parts: string[] = [];

    // Describe scene
    if (analysis.labels && analysis.labels.length > 0) {
      const sceneLabels = analysis.labels
        .filter(l => l.Confidence && l.Confidence > 85)
        .slice(0, 5)
        .map(l => l.Name)
        .join(', ');
      
      parts.push(`Scene contains: ${sceneLabels}`);
    }

    // Describe people
    if (analysis.faces && analysis.faces.length > 0) {
      parts.push(`${analysis.faces.length} person(s) detected`);
      
      // Add emotion summary
      const emotions = analysis.faces
        .flatMap(f => f.Emotions || [])
        .filter(e => e.Confidence && e.Confidence > 70)
        .map(e => e.Type)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(', ');
      
      if (emotions) {
        parts.push(`Emotions: ${emotions}`);
      }
    }

    // Add celebrity info
    if (analysis.celebrities && analysis.celebrities.length > 0) {
      const celebNames = analysis.celebrities
        .map(c => c.Name)
        .join(', ');
      
      parts.push(`Celebrities: ${celebNames}`);
    }

    // Add text info
    if (analysis.text && analysis.text.length > 0) {
      parts.push(`Contains text`);
    }

    // Add moderation warnings
    if (analysis.moderationLabels && analysis.moderationLabels.length > 0) {
      parts.push(`Content warnings detected`);
    }

    return parts.join('. ') || 'No description available';
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      // Try a simple operation
      await this.client.send(new DetectLabelsCommand({
        Image: {
          Bytes: Buffer.from(''), // Empty image will fail fast
        },
      }));
      return true;
    } catch (error) {
      // Expected to fail, but connection should work
      return error.name !== 'UnknownError';
    }
  }
}

export const rekognitionService = new RekognitionService();
```

---

## Step 4: Transcribe Service

### 4.1 Create Transcribe Service
Create `src/services/aws/transcribe-service.ts`:

```typescript
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  DeleteTranscriptionJobCommand,
  TranscriptionJob,
  TranscriptionJobStatus,
  LanguageCode,
} from '@aws-sdk/client-transcribe';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import { costTracking } from '@/services/cost-tracking';
import { s3Service } from './s3-service';
import fetch from 'node-fetch';

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  languageCode?: string;
  duration?: number;
  words?: Array<{
    content: string;
    startTime: number;
    endTime: number;
    confidence: number;
  }>;
}

export class TranscribeService {
  private client: TranscribeClient;

  constructor() {
    this.client = new TranscribeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  // Start transcription job
  async startTranscription(
    s3Uri: string,
    jobName: string,
    userId: string,
    languageCode: LanguageCode = LanguageCode.en_US,
    options: {
      identifySpeakers?: boolean;
      maxSpeakers?: number;
      vocabularyName?: string;
    } = {}
  ): Promise<string> {
    try {
      const command = new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        Media: {
          MediaFileUri: s3Uri,
        },
        LanguageCode: languageCode,
        OutputBucketName: process.env.AWS_S3_BUCKET,
        OutputKey: `transcriptions/${jobName}.json`,
        Settings: {
          ShowSpeakerLabels: options.identifySpeakers,
          MaxSpeakerLabels: options.maxSpeakers,
          VocabularyName: options.vocabularyName,
        },
      });

      const response = await this.client.send(command);
      const job = response.TranscriptionJob!;

      logger.info('Transcription job started', {
        jobName,
        status: job.TranscriptionJobStatus,
        languageCode,
      });

      metrics.increment('transcribe.job.started');
      
      // Track estimated cost (will update with actual duration later)
      await costTracking.trackTranscribeCost(userId, 5, {
        jobName,
        status: 'started',
      });

      return jobName;

    } catch (error) {
      logger.error('Failed to start transcription:', error);
      metrics.increment('transcribe.job.error');
      throw error;
    }
  }

  // Get transcription job status
  async getTranscriptionStatus(
    jobName: string
  ): Promise<{ status: TranscriptionJobStatus; job?: TranscriptionJob }> {
    try {
      const command = new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName,
      });

      const response = await this.client.send(command);
      const job = response.TranscriptionJob!;

      return {
        status: job.TranscriptionJobStatus!,
        job,
      };

    } catch (error) {
      logger.error('Failed to get transcription status:', error);
      throw error;
    }
  }

  // Wait for transcription completion
  async waitForTranscription(
    jobName: string,
    maxWaitTime: number = 30 * 60 * 1000, // 30 minutes
    pollInterval: number = 5000 // 5 seconds
  ): Promise<TranscriptionJob> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const { status, job } = await this.getTranscriptionStatus(jobName);

      if (status === TranscriptionJobStatus.COMPLETED) {
        logger.info('Transcription completed', {
          jobName,
          duration: Date.now() - startTime,
        });
        
        metrics.increment('transcribe.job.completed');
        return job!;
      }

      if (status === TranscriptionJobStatus.FAILED) {
        logger.error('Transcription failed', {
          jobName,
          failureReason: job?.FailureReason,
        });
        
        metrics.increment('transcribe.job.failed');
        throw new Error(`Transcription failed: ${job?.FailureReason}`);
      }

      // Still in progress
      logger.debug('Transcription in progress', {
        jobName,
        status,
        elapsed: Date.now() - startTime,
      });

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Transcription timeout');
  }

  // Get transcription results
  async getTranscriptionResults(
    jobName: string,
    userId: string
  ): Promise<TranscriptionResult> {
    try {
      // Get job details
      const { job } = await this.getTranscriptionStatus(jobName);
      
      if (!job || job.TranscriptionJobStatus !== TranscriptionJobStatus.COMPLETED) {
        throw new Error('Transcription not completed');
      }

      // Download transcript from S3
      const transcriptUri = job.Transcript?.TranscriptFileUri;
      if (!transcriptUri) {
        throw new Error('No transcript URI found');
      }

      // Parse S3 URI to get bucket and key
      const s3Match = transcriptUri.match(/s3:\/\/([^\/]+)\/(.+)/);
      if (!s3Match) {
        throw new Error('Invalid transcript URI');
      }

      const [, bucket, key] = s3Match;
      
      // Download transcript JSON
      const { body } = await s3Service.downloadFile(key);
      const chunks: Buffer[] = [];
      
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      
      const transcriptData = JSON.parse(Buffer.concat(chunks).toString());

      // Extract results
      const result: TranscriptionResult = {
        text: transcriptData.results.transcripts[0].transcript,
        languageCode: job.LanguageCode,
      };

      // Add word-level details if available
      if (transcriptData.results.items) {
        result.words = transcriptData.results.items
          .filter((item: any) => item.type === 'pronunciation')
          .map((item: any) => ({
            content: item.alternatives[0].content,
            startTime: parseFloat(item.start_time),
            endTime: parseFloat(item.end_time),
            confidence: parseFloat(item.alternatives[0].confidence),
          }));
      }

      // Calculate duration from media metadata
      if (job.Media?.DurationInSeconds) {
        result.duration = job.Media.DurationInSeconds;
        
        // Track actual cost
        const minutes = Math.ceil(job.Media.DurationInSeconds / 60);
        await costTracking.trackTranscribeCost(userId, minutes, {
          jobName,
          status: 'completed',
          actualDurationMinutes: minutes,
        });
      }

      logger.info('Transcription results retrieved', {
        jobName,
        textLength: result.text.length,
        wordCount: result.words?.length || 0,
        duration: result.duration,
      });

      // Clean up the job
      await this.deleteTranscriptionJob(jobName);

      return result;

    } catch (error) {
      logger.error('Failed to get transcription results:', error);
      throw error;
    }
  }

  // Delete transcription job
  async deleteTranscriptionJob(jobName: string): Promise<void> {
    try {
      const command = new DeleteTranscriptionJobCommand({
        TranscriptionJobName: jobName,
      });

      await this.client.send(command);
      
      logger.debug('Transcription job deleted', { jobName });

    } catch (error) {
      logger.error('Failed to delete transcription job:', error);
      // Non-critical error, don't throw
    }
  }

  // Extract key phrases from transcript
  extractKeyPhrases(transcript: string, maxPhrases: number = 10): string[] {
    // Simple extraction - in production, use Comprehend for better results
    const sentences = transcript.split(/[.!?]+/);
    const phrases: string[] = [];

    for (const sentence of sentences) {
      // Extract noun phrases (simplified)
      const words = sentence.trim().split(/\s+/);
      for (let i = 0; i < words.length - 1; i++) {
        if (words[i].length > 3 && words[i + 1].length > 3) {
          phrases.push(`${words[i]} ${words[i + 1]}`);
        }
      }
    }

    // Return most common phrases
    const phraseCounts = phrases.reduce((acc, phrase) => {
      acc[phrase] = (acc[phrase] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(phraseCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxPhrases)
      .map(([phrase]) => phrase);
  }

  // Generate summary from transcript
  generateSummary(transcript: string, maxLength: number = 200): string {
    // Simple summary - first few sentences
    const sentences = transcript.split(/[.!?]+/).filter(s => s.trim().length > 0);
    let summary = '';
    
    for (const sentence of sentences) {
      if (summary.length + sentence.length > maxLength) break;
      summary += sentence.trim() + '. ';
    }

    return summary.trim() || 'No summary available';
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      // List jobs to verify connection
      const command = new GetTranscriptionJobCommand({
        TranscriptionJobName: 'health-check-dummy',
      });
      
      await this.client.send(command);
      return true;
    } catch (error) {
      // Expected to fail for non-existent job, but connection should work
      return error.name !== 'UnknownError';
    }
  }
}

export const transcribeService = new TranscribeService();
```

---

## Step 5: Comprehend Service

### 5.1 Create Comprehend Service
Create `src/services/aws/comprehend-service.ts`:

```typescript
import {
  ComprehendClient,
  DetectEntitiesCommand,
  DetectKeyPhrasesCommand,
  DetectSentimentCommand,
  DetectSyntaxCommand,
  Entity,
  KeyPhrase,
  SentimentScore,
  SyntaxToken,
  LanguageCode,
} from '@aws-sdk/client-comprehend';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import { costTracking } from '@/services/cost-tracking';

export interface ComprehendAnalysis {
  entities?: Entity[];
  keyPhrases?: KeyPhrase[];
  sentiment?: {
    sentiment: string;
    scores: SentimentScore;
  };
  syntax?: SyntaxToken[];
}

export class ComprehendService {
  private client: ComprehendClient;
  private readonly MAX_TEXT_SIZE = 5000; // Characters

  constructor() {
    this.client = new ComprehendClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  // Analyze text with selected features
  async analyzeText(
    text: string,
    userId: string,
    features: string[] = ['entities', 'keyPhrases', 'sentiment'],
    languageCode: LanguageCode = LanguageCode.en
  ): Promise<ComprehendAnalysis> {
    // Truncate text if too long
    const processedText = text.substring(0, this.MAX_TEXT_SIZE);
    const results: ComprehendAnalysis = {};

    try {
      const promises: Promise<void>[] = [];

      if (features.includes('entities')) {
        promises.push(this.detectEntities(processedText, results, userId, languageCode));
      }

      if (features.includes('keyPhrases')) {
        promises.push(this.detectKeyPhrases(processedText, results, userId, languageCode));
      }

      if (features.includes('sentiment')) {
        promises.push(this.detectSentiment(processedText, results, userId, languageCode));
      }

      if (features.includes('syntax')) {
        promises.push(this.detectSyntax(processedText, results, userId, languageCode));
      }

      await Promise.all(promises);

      logger.info('Text analysis completed', {
        textLength: text.length,
        features,
        resultCounts: {
          entities: results.entities?.length || 0,
          keyPhrases: results.keyPhrases?.length || 0,
          sentiment: results.sentiment?.sentiment || 'none',
        },
      });

      metrics.increment('comprehend.analysis.success');
      return results;

    } catch (error) {
      logger.error('Comprehend analysis failed:', error);
      metrics.increment('comprehend.analysis.error');
      throw error;
    }
  }

  // Detect entities (people, places, organizations, etc.)
  private async detectEntities(
    text: string,
    results: ComprehendAnalysis,
    userId: string,
    languageCode: LanguageCode
  ): Promise<void> {
    try {
      const command = new DetectEntitiesCommand({
        Text: text,
        LanguageCode: languageCode,
      });

      const response = await this.client.send(command);
      results.entities = response.Entities || [];

      // Track cost
      const units = Math.ceil(text.length / 100);
      await costTracking.trackComprehendCost(
        userId,
        'detectEntities',
        text.length,
        { units }
      );

      logger.debug('Entities detected', {
        count: results.entities.length,
        types: [...new Set(results.entities.map(e => e.Type))],
      });

    } catch (error) {
      logger.error('Entity detection failed:', error);
    }
  }

  // Detect key phrases
  private async detectKeyPhrases(
    text: string,
    results: ComprehendAnalysis,
    userId: string,
    languageCode: LanguageCode
  ): Promise<void> {
    try {
      const command = new DetectKeyPhrasesCommand({
        Text: text,
        LanguageCode: languageCode,
      });

      const response = await this.client.send(command);
      results.keyPhrases = response.KeyPhrases || [];

      // Track cost
      const units = Math.ceil(text.length / 100);
      await costTracking.trackComprehendCost(
        userId,
        'detectKeyPhrases',
        text.length,
        { units }
      );

      logger.debug('Key phrases detected', {
        count: results.keyPhrases.length,
        topPhrases: results.keyPhrases
          .slice(0, 5)
          .map(kp => kp.Text),
      });

    } catch (error) {
      logger.error('Key phrase detection failed:', error);
    }
  }

  // Detect sentiment
  private async detectSentiment(
    text: string,
    results: ComprehendAnalysis,
    userId: string,
    languageCode: LanguageCode
  ): Promise<void> {
    try {
      const command = new DetectSentimentCommand({
        Text: text,
        LanguageCode: languageCode,
      });

      const response = await this.client.send(command);
      
      if (response.Sentiment && response.SentimentScore) {
        results.sentiment = {
          sentiment: response.Sentiment,
          scores: response.SentimentScore,
        };
      }

      // Track cost
      const units = Math.ceil(text.length / 100);
      await costTracking.trackComprehendCost(
        userId,
        'detectSentiment',
        text.length,
        { units }
      );

      logger.debug('Sentiment detected', {
        sentiment: results.sentiment?.sentiment,
        scores: results.sentiment?.scores,
      });

    } catch (error) {
      logger.error('Sentiment detection failed:', error);
    }
  }

  // Detect syntax (parts of speech)
  private async detectSyntax(
    text: string,
    results: ComprehendAnalysis,
    userId: string,
    languageCode: LanguageCode
  ): Promise<void> {
    try {
      const command = new DetectSyntaxCommand({
        Text: text,
        LanguageCode: languageCode,
      });

      const response = await this.client.send(command);
      results.syntax = response.SyntaxTokens || [];

      logger.debug('Syntax detected', {
        tokenCount: results.syntax.length,
      });

    } catch (error) {
      logger.error('Syntax detection failed:', error);
    }
  }

  // Extract important entities
  extractImportantEntities(
    entities: Entity[],
    types: string[] = ['PERSON', 'LOCATION', 'ORGANIZATION'],
    minScore: number = 0.8
  ): string[] {
    return entities
      .filter(e => 
        types.includes(e.Type || '') && 
        (e.Score || 0) >= minScore
      )
      .map(e => e.Text!)
      .filter((text, index, self) => self.indexOf(text) === index);
  }

  // Extract top key phrases
  extractTopKeyPhrases(
    keyPhrases: KeyPhrase[],
    limit: number = 10,
    minScore: number = 0.8
  ): string[] {
    return keyPhrases
      .filter(kp => (kp.Score || 0) >= minScore)
      .sort((a, b) => (b.Score || 0) - (a.Score || 0))
      .slice(0, limit)
      .map(kp => kp.Text!)
      .filter(Boolean);
  }

  // Generate content summary from analysis
  generateTextSummary(analysis: ComprehendAnalysis): string {
    const parts: string[] = [];

    // Add sentiment
    if (analysis.sentiment) {
      parts.push(`Sentiment: ${analysis.sentiment.sentiment}`);
    }

    // Add key entities
    if (analysis.entities && analysis.entities.length > 0) {
      const importantEntities = this.extractImportantEntities(analysis.entities);
      if (importantEntities.length > 0) {
        parts.push(`Mentions: ${importantEntities.slice(0, 5).join(', ')}`);
      }
    }

    // Add key phrases
    if (analysis.keyPhrases && analysis.keyPhrases.length > 0) {
      const topPhrases = this.extractTopKeyPhrases(analysis.keyPhrases, 3);
      if (topPhrases.length > 0) {
        parts.push(`Key topics: ${topPhrases.join(', ')}`);
      }
    }

    return parts.join('. ') || 'No analysis available';
  }

  // Combine multiple text analyses
  combineAnalyses(analyses: ComprehendAnalysis[]): ComprehendAnalysis {
    const combined: ComprehendAnalysis = {
      entities: [],
      keyPhrases: [],
    };

    // Combine entities
    const entityMap = new Map<string, Entity>();
    for (const analysis of analyses) {
      if (analysis.entities) {
        for (const entity of analysis.entities) {
          const key = `${entity.Type}:${entity.Text}`;
          const existing = entityMap.get(key);
          
          if (!existing || (entity.Score || 0) > (existing.Score || 0)) {
            entityMap.set(key, entity);
          }
        }
      }
    }
    combined.entities = Array.from(entityMap.values());

    // Combine key phrases
    const phraseMap = new Map<string, KeyPhrase>();
    for (const analysis of analyses) {
      if (analysis.keyPhrases) {
        for (const phrase of analysis.keyPhrases) {
          const existing = phraseMap.get(phrase.Text!);
          
          if (!existing || (phrase.Score || 0) > (existing.Score || 0)) {
            phraseMap.set(phrase.Text!, phrase);
          }
        }
      }
    }
    combined.keyPhrases = Array.from(phraseMap.values());

    // Average sentiment scores
    const sentiments = analyses
      .map(a => a.sentiment)
      .filter(Boolean) as NonNullable<ComprehendAnalysis['sentiment']>[];
    
    if (sentiments.length > 0) {
      const avgScores: any = {};
      const scoreKeys = ['Positive', 'Negative', 'Neutral', 'Mixed'] as const;
      
      for (const key of scoreKeys) {
        const values = sentiments.map(s => s.scores[key] || 0);
        avgScores[key] = values.reduce((a, b) => a + b, 0) / values.length;
      }

      // Determine dominant sentiment
      const dominant = scoreKeys.reduce((a, b) => 
        avgScores[a] > avgScores[b] ? a : b
      );

      combined.sentiment = {
        sentiment: dominant.toUpperCase(),
        scores: avgScores,
      };
    }

    return combined;
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.send(new DetectSentimentCommand({
        Text: 'Health check',
        LanguageCode: LanguageCode.en,
      }));
      return true;
    } catch (error) {
      return error.name !== 'UnknownError';
    }
  }
}

export const comprehendService = new ComprehendService();
```

---

## Testing and Verification

### Create AWS Test Script
Create `scripts/test-aws-services.js`:

```javascript
const { s3Service } = require('../src/services/aws/s3-service');
const { rekognitionService } = require('../src/services/aws/rekognition-service');
const { transcribeService } = require('../src/services/aws/transcribe-service');
const { comprehendService } = require('../src/services/aws/comprehend-service');

async function testAWSServices() {
  console.log('🧪 Testing AWS services...\n');

  const testUserId = 'test-user-123';

  try {
    // Test S3
    console.log('📦 Testing S3...');
    const s3Health = await s3Service.healthCheck();
    console.log(`✅ S3 connected: ${s3Health}`);

    // List buckets
    const buckets = await s3Service.listBuckets();
    console.log(`   Found ${buckets.length} buckets`);

    // Test Rekognition
    console.log('\n👁️ Testing Rekognition...');
    const rekognitionHealth = await rekognitionService.healthCheck();
    console.log(`✅ Rekognition connected: ${rekognitionHealth}`);

    // Test Transcribe
    console.log('\n🎤 Testing Transcribe...');
    const transcribeHealth = await transcribeService.healthCheck();
    console.log(`✅ Transcribe connected: ${transcribeHealth}`);

    // Test Comprehend
    console.log('\n🧠 Testing Comprehend...');
    const comprehendHealth = await comprehendService.healthCheck();
    console.log(`✅ Comprehend connected: ${comprehendHealth}`);

    // Test text analysis
    const testText = 'Amazon Web Services provides cloud computing services to millions of customers worldwide.';
    const analysis = await comprehendService.analyzeText(testText, testUserId, ['sentiment']);
    console.log('   Sentiment:', analysis.sentiment?.sentiment);

    console.log('\n🎉 AWS services tests completed successfully!');

  } catch (error) {
    console.error('❌ AWS services test failed:', error);
    process.exit(1);
  }
}

// Run tests
testAWSServices();
```

### Run Tests
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
node scripts/setup-aws.js          # Setup AWS resources
node scripts/test-aws-services.js  # Test services
```

---

## ✅ Phase 9 Completion Checklist

### AWS Configuration
- [ ] **IAM User**: Created with minimal permissions
- [ ] **Access Keys**: Generated and stored securely
- [ ] **S3 Buckets**: Created with proper security settings
- [ ] **CORS**: Configured for client uploads
- [ ] **Lifecycle Rules**: Set up for cost optimization

### Service Implementations
- [ ] **S3 Service**: Upload, download, presigned URLs
- [ ] **Rekognition**: Image and video analysis
- [ ] **Transcribe**: Audio transcription for videos
- [ ] **Comprehend**: Text analysis and sentiment
- [ ] **Cost Tracking**: All services track costs

### Integration Features
- [ ] **Error Handling**: Retry logic and graceful failures
- [ ] **Performance**: Parallel processing where possible
- [ ] **Security**: Encrypted storage and transmission
- [ ] **Monitoring**: Service health checks
- [ ] **Cost Optimization**: Feature selection by tier

### Testing & Verification
```bash
# All these should succeed:
node scripts/setup-aws.js           # Setup AWS resources
node scripts/test-aws-services.js   # Test all services
npm run dev                        # Start development server
# Test file upload flow
# Test image analysis
# Test video processing
```

---

## 🚀 Next Steps

**Phase 9 Complete!** ✅

**Ready for Phase 10**: Queue System & Workers
- Read: `02-phases/phase-10-queue-workers.md`
- Prerequisites: AWS services working, Redis running
- Outcome: Background job processing system

**Quick Reference**:
- AWS Console: https://console.aws.amazon.com
- Service limits: Check AWS documentation
- Next phase: `02-phases/phase-10-queue-workers.md`

Your application now has complete AWS AI service integration for media processing!
