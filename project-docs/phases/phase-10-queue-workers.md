# Phase 10: Queue System & Workers

## 🎯 Phase Overview
This phase implements a robust job queue system using BullMQ with the existing Redis instance from Phase 5. We'll create specialized workers to process different media types using AWS services from Phase 9, with comprehensive cost tracking and progress monitoring.

## ✅ Prerequisites
- Phase 5 completed (Redis cache setup at `src/lib/cache/redis-client.ts`)
- Phase 7 completed (Cost tracking service at `src/services/cost-tracking.ts`)
- Phase 9 completed (AWS services at `src/services/aws/`)
- Phase 4 completed (Winston logger)
- Redis server running
- AWS credentials configured

## 📋 Phase Checklist
- [ ] Install BullMQ and create queue manager at `src/lib/queue/queue-manager.ts`
- [ ] Create job type definitions and interfaces
- [ ] Build workers for image, video, and text processing at `src/workers/`
- [ ] Integrate cost tracking for all processing jobs
- [ ] Implement job progress tracking and status updates
- [ ] Add retry logic with exponential backoff
- [ ] Create queue monitoring endpoints

---

## Step 1: Install Dependencies and Create Queue Types

### 1.1 Install BullMQ
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
npm install bullmq pdf-parse @aws-sdk/client-textract
npm install --save-dev @types/node
```

### 1.2 Create Job Type Definitions
Create `src/types/queue.types.ts`:

```typescript
export enum JobType {
  IMAGE_PROCESSING = 'image-processing',
  VIDEO_PROCESSING = 'video-processing',
  TEXT_ANALYSIS = 'text-analysis',
  DOCUMENT_PROCESSING = 'document-processing',
  EMBEDDING_GENERATION = 'embedding-generation'
}

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface BaseJobData {
  userId: string;
  mediaItemId: string;
  s3Key: string;
  costCenter: string;
}

export interface ImageProcessingJobData extends BaseJobData {
  operations: {
    detectLabels?: boolean;
    detectText?: boolean;
    detectFaces?: boolean;
    detectModerationLabels?: boolean;
  };
}

export interface VideoProcessingJobData extends BaseJobData {
  operations: {
    transcribe?: boolean;
    detectLabels?: boolean;
    generateThumbnails?: boolean;
  };
  duration?: number;
}

export interface TextAnalysisJobData extends BaseJobData {
  text: string;
  operations: {
    detectSentiment?: boolean;
    detectEntities?: boolean;
    detectKeyPhrases?: boolean;
    detectLanguage?: boolean;
  };
}

export interface DocumentProcessingJobData extends BaseJobData {
  documentType: 'pdf' | 'docx' | 'txt';
  operations: {
    extractText?: boolean;
    detectTables?: boolean;
    detectForms?: boolean;
  };
}

export interface EmbeddingGenerationJobData extends BaseJobData {
  content: string;
  contentType: 'text' | 'image' | 'video';
  metadata?: Record<string, string | number | boolean>;
}

export interface JobProgress {
  current: number;
  total: number;
  message: string;
  subTasks?: {
    [key: string]: {
      status: 'pending' | 'processing' | 'completed' | 'failed';
      message?: string;
    };
  };
}
```

---

## Step 2: Create Queue Manager

### 2.1 Create Queue Manager Service
Create `src/lib/queue/queue-manager.ts`:

```typescript
import { Queue, Worker, Job, QueueEvents, ConnectionOptions } from 'bullmq';
import { getRedisClient } from '@/lib/cache/redis-client';
import { logger } from '@/lib/monitoring/logger';
import {
  JobType,
  ImageProcessingJobData,
  VideoProcessingJobData,
  TextAnalysisJobData,
  DocumentProcessingJobData,
  EmbeddingGenerationJobData,
  JobProgress
} from '@/types/queue.types';

export class QueueManager {
  private static instance: QueueManager;
  private queues: Map<JobType, Queue> = new Map();
  private queueEvents: Map<JobType, QueueEvents> = new Map();
  private connection: ConnectionOptions;

  private constructor() {}

  static getInstance(): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager();
    }
    return QueueManager.instance;
  }

  async initialize(): Promise<void> {
    try {
      const redisClient = getRedisClient();
      this.connection = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      };

      // Initialize queues for each job type
      for (const jobType of Object.values(JobType)) {
        const queue = new Queue(jobType, { connection: this.connection });
        this.queues.set(jobType, queue);

        const queueEvents = new QueueEvents(jobType, { connection: this.connection });
        this.queueEvents.set(jobType, queueEvents);

        logger.info(`Queue initialized: ${jobType}`);
      }
    } catch (error) {
      logger.error('Failed to initialize queue manager', error);
      throw error;
    }
  }

  async addImageProcessingJob(data: ImageProcessingJobData) {
    const queue = this.queues.get(JobType.IMAGE_PROCESSING);
    if (!queue) throw new Error('Image processing queue not initialized');

    return await queue.add('process-image', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour
        count: 100, // Keep last 100 completed jobs
      },
      removeOnFail: {
        age: 24 * 3600, // Keep failed jobs for 24 hours
      },
    });
  }

  async addVideoProcessingJob(data: VideoProcessingJobData) {
    const queue = this.queues.get(JobType.VIDEO_PROCESSING);
    if (!queue) throw new Error('Video processing queue not initialized');

    return await queue.add('process-video', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: {
        age: 3600,
        count: 50,
      },
      removeOnFail: {
        age: 24 * 3600,
      },
    });
  }

  async addTextAnalysisJob(data: TextAnalysisJobData) {
    const queue = this.queues.get(JobType.TEXT_ANALYSIS);
    if (!queue) throw new Error('Text analysis queue not initialized');

    return await queue.add('analyze-text', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: {
        age: 3600,
        count: 200,
      },
      removeOnFail: {
        age: 24 * 3600,
      },
    });
  }

  async addDocumentProcessingJob(data: DocumentProcessingJobData) {
    const queue = this.queues.get(JobType.DOCUMENT_PROCESSING);
    if (!queue) throw new Error('Document processing queue not initialized');

    return await queue.add('process-document', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600,
        count: 100,
      },
      removeOnFail: {
        age: 24 * 3600,
      },
    });
  }

  async addEmbeddingJob(data: EmbeddingGenerationJobData) {
    const queue = this.queues.get(JobType.EMBEDDING_GENERATION);
    if (!queue) throw new Error('Embedding generation queue not initialized');

    return await queue.add('generate-embedding', data, {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 3000,
      },
      removeOnComplete: {
        age: 3600,
        count: 500,
      },
      removeOnFail: {
        age: 24 * 3600,
      },
    });
  }

  async getJobCounts(jobType: JobType) {
    const queue = this.queues.get(jobType);
    if (!queue) throw new Error(`Queue ${jobType} not initialized`);

    return await queue.getJobCounts();
  }

  async getJob(jobType: JobType, jobId: string) {
    const queue = this.queues.get(jobType);
    if (!queue) throw new Error(`Queue ${jobType} not initialized`);

    return await queue.getJob(jobId);
  }

  async updateJobProgress(job: Job, progress: JobProgress) {
    await job.updateProgress(progress);
  }

  getQueue(jobType: JobType): Queue | undefined {
    return this.queues.get(jobType);
  }

  getQueueEvents(jobType: JobType): QueueEvents | undefined {
    return this.queueEvents.get(jobType);
  }

  async shutdown(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    for (const queueEvents of this.queueEvents.values()) {
      await queueEvents.close();
    }
  }
}

export const queueManager = QueueManager.getInstance();
```

---

## Step 3: Create Workers

### 3.1 Create Base Worker Class
Create `src/workers/base-worker.ts`:

```typescript
import { Worker, Job, ConnectionOptions } from 'bullmq';
import { logger } from '@/lib/monitoring/logger';
import { CostTrackingService } from '@/services/cost-tracking';
import { db } from '@/lib/database';
import { JobProgress } from '@/types/queue.types';

export abstract class BaseWorker<T> {
  protected worker: Worker<T>;
  protected costService: CostTrackingService;

  constructor(
    queueName: string,
    connection: ConnectionOptions,
    concurrency: number = 1
  ) {
    this.costService = new CostTrackingService();
    
    this.worker = new Worker<T>(
      queueName,
      async (job: Job<T>) => {
        try {
          logger.info(`Processing job ${job.id} in queue ${queueName}`, {
            jobId: job.id,
            queueName,
            data: job.data
          });

          const startTime = Date.now();
          const result = await this.process(job);
          const processingTime = Date.now() - startTime;

          logger.info(`Job ${job.id} completed`, {
            jobId: job.id,
            queueName,
            processingTime,
            result
          });

          return result;
        } catch (error) {
          logger.error(`Job ${job.id} failed`, {
            jobId: job.id,
            queueName,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
          });
          throw error;
        }
      },
      {
        connection,
        concurrency,
        autorun: true,
      }
    );

    this.setupEventHandlers();
  }

  protected abstract process(job: Job<T>): Promise<unknown>;

  protected async updateProgress(job: Job<T>, progress: JobProgress): Promise<void> {
    await job.updateProgress(progress);
  }

  protected async updateMediaItemStatus(
    mediaItemId: string,
    status: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      await db('media_items')
        .where('id', mediaItemId)
        .update({
          processing_status: status,
          metadata: metadata ? JSON.stringify(metadata) : undefined,
          updated_at: new Date()
        });
    } catch (error) {
      logger.error('Failed to update media item status', { mediaItemId, status, error });
    }
  }

  protected async trackCost(
    userId: string,
    service: string,
    operation: string,
    cost: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.costService.trackUsage(
        userId,
        service,
        operation,
        cost,
        metadata
      );
    } catch (error) {
      logger.error('Failed to track cost', { userId, service, operation, cost, error });
    }
  }

  private setupEventHandlers() {
    this.worker.on('completed', (job, result) => {
      logger.info(`Job completed: ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      logger.error(`Job failed: ${job?.id}`, err);
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn(`Job stalled: ${jobId}`);
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}
```

### 3.2 Create Image Processing Worker
Create `src/workers/image-processing-worker.ts`:

```typescript
import { Job } from 'bullmq';
import { BaseWorker } from '@/workers/base-worker';
import { rekognitionService } from '@/services/aws/rekognition-service';
import { s3Service } from '@/services/aws/s3-service';
import { ImageProcessingJobData, JobStatus } from '@/types/queue.types';
import { logger } from '@/lib/monitoring/logger';

interface ImageProcessingResult {
  labels?: any[];
  text?: any[];
  faces?: any[];
  moderation?: any[];
}

export class ImageProcessingWorker extends BaseWorker<ImageProcessingJobData> {
  constructor(connection: ConnectionOptions) {
    super('image-processing', connection, 3); // Process 3 images concurrently
  }

  protected async process(job: Job<ImageProcessingJobData>): Promise<ImageProcessingResult> {
    const { userId, mediaItemId, s3Key, operations } = job.data;
    const results: ImageProcessingResult = {};
    let totalCost = 0;

    try {
      // Update status to processing
      await this.updateMediaItemStatus(mediaItemId, JobStatus.PROCESSING);

      // Get image from S3
      await this.updateProgress(job, {
        current: 0,
        total: Object.keys(operations).length,
        message: 'Retrieving image from S3',
        subTasks: {}
      });

      const imageUrl = await s3Service.getSignedUrl(s3Key);

      let currentStep = 0;
      const totalSteps = Object.keys(operations).length;

      // Process each requested operation
      if (operations.detectLabels) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Detecting labels',
          subTasks: {
            detectLabels: { status: 'processing' }
          }
        });

        const labels = await rekognitionService.detectLabels(s3Key);
        results.labels = labels;
        const labelCost = 0.001; // $0.001 per image for label detection
        totalCost += labelCost;
        await this.trackCost(userId, 'rekognition', 'detectLabels', labelCost, { mediaItemId });
        
        currentStep++;
      }

      if (operations.detectText) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Detecting text',
          subTasks: {
            detectText: { status: 'processing' }
          }
        });

        const text = await rekognitionService.detectText(s3Key);
        results.text = text;
        const textCost = 0.001; // $0.001 per image for text detection
        totalCost += textCost;
        await this.trackCost(userId, 'rekognition', 'detectText', textCost, { mediaItemId });
        
        currentStep++;
      }

      if (operations.detectFaces) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Detecting faces',
          subTasks: {
            detectFaces: { status: 'processing' }
          }
        });

        const faces = await rekognitionService.detectFaces(s3Key);
        results.faces = faces;
        const faceCost = 0.001; // $0.001 per image for face detection
        totalCost += faceCost;
        await this.trackCost(userId, 'rekognition', 'detectFaces', faceCost, { mediaItemId });
        
        currentStep++;
      }

      if (operations.detectModerationLabels) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Detecting moderation labels',
          subTasks: {
            detectModerationLabels: { status: 'processing' }
          }
        });

        const moderation = await rekognitionService.detectModerationLabels(s3Key);
        results.moderation = moderation;
        const moderationCost = 0.001; // $0.001 per image for moderation
        totalCost += moderationCost;
        await this.trackCost(userId, 'rekognition', 'detectModerationLabels', moderationCost, { mediaItemId });
        
        currentStep++;
      }

      // Update media item with results
      await this.updateMediaItemStatus(mediaItemId, JobStatus.COMPLETED, {
        ...results,
        processingCost: totalCost,
        processedAt: new Date().toISOString()
      });

      await this.updateProgress(job, {
        current: totalSteps,
        total: totalSteps,
        message: 'Processing complete',
        subTasks: {}
      });

      logger.info(`Image processing completed for ${mediaItemId}`, {
        mediaItemId,
        totalCost,
        operations: Object.keys(operations)
      });

      return results;
    } catch (error) {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.FAILED, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}
```

### 3.3 Create Video Processing Worker
Create `src/workers/video-processing-worker.ts`:

```typescript
import { Job } from 'bullmq';
import { BaseWorker } from '@/workers/base-worker';
import { transcribeService } from '@/services/aws/transcribe-service';
import { rekognitionService } from '@/services/aws/rekognition-service';
import { s3Service } from '@/services/aws/s3-service';
import { VideoProcessingJobData, JobStatus } from '@/types/queue.types';
import { logger } from '@/lib/monitoring/logger';

interface VideoProcessingResult {
  transcription?: any;
  labels?: any[];
  thumbnails?: {
    count: number;
    s3Keys: string[];
  };
}

export class VideoProcessingWorker extends BaseWorker<VideoProcessingJobData> {
  constructor(connection: ConnectionOptions) {
    super('video-processing', connection, 2); // Process 2 videos concurrently
  }

  protected async process(job: Job<VideoProcessingJobData>): Promise<VideoProcessingResult> {
    const { userId, mediaItemId, s3Key, operations, duration = 0 } = job.data;
    const results: VideoProcessingResult = {};
    let totalCost = 0;

    try {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.PROCESSING);

      let currentStep = 0;
      const totalSteps = Object.keys(operations).length;

      if (operations.transcribe) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Starting transcription',
          subTasks: {
            transcribe: { status: 'processing' }
          }
        });

        const transcriptionJobName = `transcribe-${mediaItemId}-${Date.now()}`;
        const transcriptResult = await transcribeService.startTranscriptionJob(
          transcriptionJobName,
          s3Key,
          'en-US'
        );

        // Poll for transcription completion
        let transcriptionComplete = false;
        while (!transcriptionComplete) {
          const status = await transcribeService.getTranscriptionJob(transcriptionJobName);
          
          if (status.TranscriptionJob?.TranscriptionJobStatus === 'COMPLETED') {
            transcriptionComplete = true;
            results.transcription = status.TranscriptionJob.Transcript;
            
            // Calculate cost: $0.0004 per second
            const transcribeCost = (duration / 60) * 0.024; // Convert to minutes
            totalCost += transcribeCost;
            await this.trackCost(userId, 'transcribe', 'transcription', transcribeCost, {
              mediaItemId,
              durationSeconds: duration
            });
          } else if (status.TranscriptionJob?.TranscriptionJobStatus === 'FAILED') {
            throw new Error('Transcription failed');
          }

          // Wait 5 seconds before checking again
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        currentStep++;
      }

      if (operations.detectLabels) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Detecting video labels',
          subTasks: {
            detectLabels: { status: 'processing' }
          }
        });

        // Start video label detection job
        const labelJobName = `labels-${mediaItemId}-${Date.now()}`;
        const startLabelResult = await rekognitionService.startLabelDetection({
          Video: {
            S3Object: {
              Bucket: process.env.AWS_S3_BUCKET,
              Name: s3Key
            }
          },
          MinConfidence: 70,
          ClientRequestToken: labelJobName,
          NotificationChannel: {
            SNSTopic: process.env.AWS_SNS_TOPIC_ARN,
            RoleArn: process.env.AWS_REKOGNITION_ROLE_ARN
          },
          JobTag: labelJobName
        });

        // Poll for label detection completion
        let labelDetectionComplete = false;
        let labelJobId = startLabelResult.JobId;
        
        while (!labelDetectionComplete) {
          const labelStatus = await rekognitionService.getLabelDetection({
            JobId: labelJobId,
            MaxResults: 1000
          });
          
          if (labelStatus.JobStatus === 'SUCCEEDED') {
            labelDetectionComplete = true;
            results.labels = labelStatus.Labels || [];
            
            // Calculate cost: $0.10 per minute of video
            const labelCost = 0.10 * (duration / 60);
            totalCost += labelCost;
            await this.trackCost(userId, 'rekognition', 'videoLabels', labelCost, {
              mediaItemId,
              durationSeconds: duration,
              labelsFound: results.labels.length
            });
          } else if (labelStatus.JobStatus === 'FAILED') {
            throw new Error(`Video label detection failed: ${labelStatus.StatusMessage}`);
          }
          
          // Wait 5 seconds before checking again
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        currentStep++;
      }

      if (operations.generateThumbnails) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Generating thumbnails',
          subTasks: {
            generateThumbnails: { status: 'processing' }
          }
        });

        // Extract frames at regular intervals
        const thumbnailCount = 5;
        const interval = Math.floor(duration / thumbnailCount);
        const thumbnailKeys: string[] = [];
        
        for (let i = 0; i < thumbnailCount; i++) {
          const timestamp = i * interval;
          const thumbnailKey = `${s3Key.replace(/\.[^/.]+$/, '')}-thumb-${i}.jpg`;
          
          // Use Rekognition to extract frame
          // In production, you might use AWS MediaConvert for better quality
          const frameResult = await rekognitionService.getVideoFrame({
            S3Object: {
              Bucket: process.env.AWS_S3_BUCKET,
              Name: s3Key
            },
            Timestamp: timestamp * 1000 // Convert to milliseconds
          });
          
          // Upload extracted frame to S3
          if (frameResult.Frame) {
            await s3Service.uploadObject(
              thumbnailKey,
              Buffer.from(frameResult.Frame, 'base64'),
              'image/jpeg',
              { 
                parentVideo: s3Key,
                timestamp: timestamp.toString()
              }
            );
            thumbnailKeys.push(thumbnailKey);
          }
        }
        
        results.thumbnails = {
          count: thumbnailKeys.length,
          s3Keys: thumbnailKeys
        };

        // Rekognition frame extraction cost: ~$0.003 per frame
        const thumbnailCost = 0.003 * thumbnailCount;
        totalCost += thumbnailCost;
        await this.trackCost(userId, 'rekognition', 'frameExtraction', thumbnailCost, { 
          mediaItemId,
          frameCount: thumbnailCount
        });

        currentStep++;
      }

      await this.updateMediaItemStatus(mediaItemId, JobStatus.COMPLETED, {
        ...results,
        processingCost: totalCost,
        processedAt: new Date().toISOString()
      });

      await this.updateProgress(job, {
        current: totalSteps,
        total: totalSteps,
        message: 'Processing complete',
        subTasks: {}
      });

      logger.info(`Video processing completed for ${mediaItemId}`, {
        mediaItemId,
        totalCost,
        operations: Object.keys(operations),
        duration
      });

      return results;
    } catch (error) {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.FAILED, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}
```

### 3.4 Create Text Analysis Worker
Create `src/workers/text-analysis-worker.ts`:

```typescript
import { Job } from 'bullmq';
import { BaseWorker } from '@/workers/base-worker';
import { comprehendService } from '@/services/aws/comprehend-service';
import { TextAnalysisJobData, JobStatus } from '@/types/queue.types';
import { logger } from '@/lib/monitoring/logger';

interface TextAnalysisResult {
  sentiment?: any;
  entities?: any[];
  keyPhrases?: any[];
  language?: any;
}

export class TextAnalysisWorker extends BaseWorker<TextAnalysisJobData> {
  constructor(connection: ConnectionOptions) {
    super('text-analysis', connection, 5); // Process 5 text analyses concurrently
  }

  protected async process(job: Job<TextAnalysisJobData>): Promise<TextAnalysisResult> {
    const { userId, mediaItemId, text, operations } = job.data;
    const results: TextAnalysisResult = {};
    let totalCost = 0;

    try {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.PROCESSING);

      let currentStep = 0;
      const totalSteps = Object.keys(operations).length;
      const textLength = text.length;
      const units = Math.ceil(textLength / 100); // Comprehend charges per 100 characters

      if (operations.detectSentiment) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Detecting sentiment',
          subTasks: {
            detectSentiment: { status: 'processing' }
          }
        });

        const sentiment = await comprehendService.detectSentiment(text);
        results.sentiment = sentiment;
        const sentimentCost = units * 0.0001; // $0.0001 per unit
        totalCost += sentimentCost;
        await this.trackCost(userId, 'comprehend', 'detectSentiment', sentimentCost, {
          mediaItemId,
          textLength
        });

        currentStep++;
      }

      if (operations.detectEntities) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Detecting entities',
          subTasks: {
            detectEntities: { status: 'processing' }
          }
        });

        const entities = await comprehendService.detectEntities(text);
        results.entities = entities;
        const entitiesCost = units * 0.0001;
        totalCost += entitiesCost;
        await this.trackCost(userId, 'comprehend', 'detectEntities', entitiesCost, {
          mediaItemId,
          textLength
        });

        currentStep++;
      }

      if (operations.detectKeyPhrases) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Detecting key phrases',
          subTasks: {
            detectKeyPhrases: { status: 'processing' }
          }
        });

        const keyPhrases = await comprehendService.detectKeyPhrases(text);
        results.keyPhrases = keyPhrases;
        const keyPhrasesCost = units * 0.0001;
        totalCost += keyPhrasesCost;
        await this.trackCost(userId, 'comprehend', 'detectKeyPhrases', keyPhrasesCost, {
          mediaItemId,
          textLength
        });

        currentStep++;
      }

      if (operations.detectLanguage) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Detecting language',
          subTasks: {
            detectLanguage: { status: 'processing' }
          }
        });

        const language = await comprehendService.detectDominantLanguage(text);
        results.language = language;
        const languageCost = units * 0.0001;
        totalCost += languageCost;
        await this.trackCost(userId, 'comprehend', 'detectLanguage', languageCost, {
          mediaItemId,
          textLength
        });

        currentStep++;
      }

      await this.updateMediaItemStatus(mediaItemId, JobStatus.COMPLETED, {
        ...results,
        processingCost: totalCost,
        processedAt: new Date().toISOString()
      });

      await this.updateProgress(job, {
        current: totalSteps,
        total: totalSteps,
        message: 'Processing complete',
        subTasks: {}
      });

      logger.info(`Text analysis completed for ${mediaItemId}`, {
        mediaItemId,
        totalCost,
        operations: Object.keys(operations),
        textLength
      });

      return results;
    } catch (error) {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.FAILED, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}
```

### 3.5 Create Embedding Generation Worker
Create `src/workers/embedding-generation-worker.ts`:

```typescript
import { Job } from 'bullmq';
import { BaseWorker } from '@/workers/base-worker';
import { EmbeddingGenerationJobData, JobStatus } from '@/types/queue.types';
import { getCacheManager } from '@/lib/cache/cache-manager';
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';
import crypto from 'crypto';

interface EmbeddingResult {
  source: 'cache' | 'generated';
  embedding: number[];
}

export class EmbeddingGenerationWorker extends BaseWorker<EmbeddingGenerationJobData> {
  private cacheManager = getCacheManager();

  constructor(connection: ConnectionOptions) {
    super('embedding-generation', connection, 10); // Process 10 embeddings concurrently
  }

  protected async process(job: Job<EmbeddingGenerationJobData>): Promise<EmbeddingResult> {
    const { userId, mediaItemId, content, contentType, metadata } = job.data;

    try {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.PROCESSING);

      await this.updateProgress(job, {
        current: 0,
        total: 2,
        message: 'Checking cache for existing embedding',
        subTasks: {}
      });

      // Generate cache key
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');
      const cacheKey = `embedding:${contentType}:${contentHash}`;

      // Check cache first
      const cachedEmbedding = await this.cacheManager.get(cacheKey);
      if (cachedEmbedding) {
        logger.info(`Using cached embedding for ${mediaItemId}`);
        
        // Store in database
        await this.storeEmbedding(mediaItemId, cachedEmbedding, metadata);
        
        await this.updateMediaItemStatus(mediaItemId, JobStatus.COMPLETED, {
          embeddingSource: 'cache',
          processedAt: new Date().toISOString()
        });

        return { source: 'cache', embedding: cachedEmbedding };
      }

      await this.updateProgress(job, {
        current: 1,
        total: 2,
        message: 'Generating new embedding',
        subTasks: {
          generateEmbedding: { status: 'processing' }
        }
      });

      // Generate embedding using OpenAI API
      const embedding = await this.generateEmbedding(content, contentType);
      
      // Cache the embedding
      await this.cacheManager.set(cacheKey, embedding, 86400); // Cache for 24 hours

      // Store in database
      await this.storeEmbedding(mediaItemId, embedding, metadata);

      // Track cost - OpenAI ada-002 pricing
      const tokens = Math.ceil(content.length / 4); // Rough estimate
      const embeddingCost = (tokens / 1000) * 0.0001; // $0.0001 per 1K tokens
      await this.trackCost(userId, 'openai', 'embedding', embeddingCost, {
        mediaItemId,
        contentLength: content.length
      });

      await this.updateMediaItemStatus(mediaItemId, JobStatus.COMPLETED, {
        embeddingSource: 'generated',
        processedAt: new Date().toISOString()
      });

      await this.updateProgress(job, {
        current: 2,
        total: 2,
        message: 'Embedding generation complete',
        subTasks: {}
      });

      logger.info(`Embedding generated for ${mediaItemId}`, {
        mediaItemId,
        contentType,
        contentLength: content.length
      });

      return { source: 'generated', embedding: embedding };
    } catch (error) {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.FAILED, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private async generateEmbedding(content: string, contentType: string): Promise<number[]> {
    try {
      // Use different strategies based on content type
      let textContent = content;
      
      if (contentType === 'image') {
        // For images, use the detected labels and text as content
        const imageData = await db('media_items')
          .where('id', content) // content is mediaItemId for images
          .first();
        
        if (imageData?.metadata) {
          const metadata = JSON.parse(imageData.metadata);
          textContent = [
            metadata.labels?.map((l: any) => l.Name).join(' '),
            metadata.text?.map((t: any) => t.DetectedText).join(' '),
            metadata.faces?.length ? `${metadata.faces.length} faces detected` : ''
          ].filter(Boolean).join('. ');
        }
      } else if (contentType === 'video') {
        // For videos, use transcription and labels
        const videoData = await db('media_items')
          .where('id', content)
          .first();
        
        if (videoData?.metadata) {
          const metadata = JSON.parse(videoData.metadata);
          textContent = metadata.transcription?.TranscriptFileUri || content;
        }
      }

      // Call OpenAI API
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'text-embedding-ada-002',
          input: textContent.substring(0, 8191) // Max token limit
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      logger.error('Failed to generate embedding', error);
      throw error;
    }
  }

  private async storeEmbedding(
    mediaItemId: string,
    embedding: number[],
    metadata?: Record<string, string | number | boolean>
  ): Promise<void> {
    // Store embedding in pgvector format
    const vectorString = `[${embedding.join(',')}]`;
    
    await db('embeddings').insert({
      id: crypto.randomUUID(),
      media_item_id: mediaItemId,
      embedding: db.raw(`'${vectorString}'::vector`), // Proper pgvector format
      metadata: metadata ? JSON.stringify(metadata) : null,
      created_at: new Date()
    });
  }
}
```

### 3.6 Create Document Processing Worker
Create `src/workers/document-processing-worker.ts`:

```typescript
import { Job } from 'bullmq';
import { BaseWorker } from '@/workers/base-worker';
import { s3Service } from '@/services/aws/s3-service';
import { DocumentProcessingJobData, JobStatus } from '@/types/queue.types';
import { logger } from '@/lib/monitoring/logger';
import * as pdfParse from 'pdf-parse';
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';

interface DocumentProcessingResult {
  text?: string;
  textLength?: number;
  pages?: number;
  info?: any;
  tables?: any[];
  forms?: any[];
}

export class DocumentProcessingWorker extends BaseWorker<DocumentProcessingJobData> {
  private textractClient: TextractClient;

  constructor(connection: ConnectionOptions) {
    super('document-processing', connection, 3); // Process 3 documents concurrently
    this.textractClient = new TextractClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }

  protected async process(job: Job<DocumentProcessingJobData>): Promise<DocumentProcessingResult> {
    const { userId, mediaItemId, s3Key, documentType, operations } = job.data;
    const results: DocumentProcessingResult = {};
    let totalCost = 0;

    try {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.PROCESSING);

      let currentStep = 0;
      const totalSteps = Object.keys(operations).length;

      if (operations.extractText) {
        await this.updateProgress(job, {
          current: currentStep,
          total: totalSteps,
          message: 'Extracting text from document',
          subTasks: {
            extractText: { status: 'processing' }
          }
        });

        let extractedText = '';
        
        if (documentType === 'pdf') {
          // For PDFs, we can use pdf-parse library or AWS Textract
          const documentBuffer = await s3Service.getObject(s3Key);
          
          if (operations.detectTables || operations.detectForms) {
            // Use Textract for complex documents with tables/forms
            const command = new DetectDocumentTextCommand({
              Document: {
                S3Object: {
                  Bucket: process.env.AWS_S3_BUCKET,
                  Name: s3Key
                }
              }
            });
            
            const response = await this.textractClient.send(command);
            extractedText = response.Blocks
              ?.filter(block => block.BlockType === 'LINE')
              .map(block => block.Text)
              .join(' ') || '';
            
            // Textract pricing: $1.50 per 1000 pages
            const pageCount = Math.max(1, Math.ceil((response.Blocks?.length || 0) / 30));
            const textractCost = (pageCount / 1000) * 1.50;
            totalCost += textractCost;
            await this.trackCost(userId, 'textract', 'detectDocumentText', textractCost, {
              mediaItemId,
              pageCount
            });
            
            if (operations.detectTables) {
              results.tables = response.Blocks?.filter(block => block.BlockType === 'TABLE') || [];
            }
            
            if (operations.detectForms) {
              results.forms = response.Blocks?.filter(block => 
                block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('KEY')
              ) || [];
            }
          } else {
            // Use pdf-parse for simple text extraction
            const pdfData = await pdfParse(documentBuffer);
            extractedText = pdfData.text;
            results.pages = pdfData.numpages;
            results.info = pdfData.info;
          }
        } else if (documentType === 'txt') {
          // For text files, simply read the content
          const documentBuffer = await s3Service.getObject(s3Key);
          extractedText = documentBuffer.toString('utf-8');
        } else if (documentType === 'docx') {
          // For Word documents, use Textract
          const command = new DetectDocumentTextCommand({
            Document: {
              S3Object: {
                Bucket: process.env.AWS_S3_BUCKET,
                Name: s3Key
              }
            }
          });
          
          const response = await this.textractClient.send(command);
          extractedText = response.Blocks
            ?.filter(block => block.BlockType === 'LINE')
            .map(block => block.Text)
            .join(' ') || '';
          
          const pageCount = 1; // DOCX usually processed as single page
          const textractCost = (pageCount / 1000) * 1.50;
          totalCost += textractCost;
          await this.trackCost(userId, 'textract', 'detectDocumentText', textractCost, {
            mediaItemId,
            documentType
          });
        }

        results.text = extractedText;
        results.textLength = extractedText.length;
        
        // If text was extracted, queue it for text analysis
        if (extractedText && extractedText.length > 0) {
          const queueManager = (await import('@/lib/queue/queue-manager')).queueManager;
          await queueManager.addTextAnalysisJob({
            userId,
            mediaItemId,
            s3Key,
            costCenter: job.data.costCenter,
            text: extractedText,
            operations: {
              detectSentiment: true,
              detectEntities: true,
              detectKeyPhrases: true,
              detectLanguage: true
            }
          });
          
          logger.info(`Queued text analysis for document ${mediaItemId}`);
        }

        currentStep++;
      }

      await this.updateMediaItemStatus(mediaItemId, JobStatus.COMPLETED, {
        ...results,
        processingCost: totalCost,
        processedAt: new Date().toISOString()
      });

      await this.updateProgress(job, {
        current: totalSteps,
        total: totalSteps,
        message: 'Processing complete',
        subTasks: {}
      });

      logger.info(`Document processing completed for ${mediaItemId}`, {
        mediaItemId,
        totalCost,
        operations: Object.keys(operations),
        documentType,
        textLength: results.textLength
      });

      return results;
    } catch (error) {
      await this.updateMediaItemStatus(mediaItemId, JobStatus.FAILED, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}
```

---

## Step 4: Create Worker Manager

### 4.1 Create Worker Manager
Create `src/lib/queue/worker-manager.ts`:

```typescript
import { ImageProcessingWorker } from '@/workers/image-processing-worker';
import { VideoProcessingWorker } from '@/workers/video-processing-worker';
import { TextAnalysisWorker } from '@/workers/text-analysis-worker';
import { DocumentProcessingWorker } from '@/workers/document-processing-worker';
import { EmbeddingGenerationWorker } from '@/workers/embedding-generation-worker';
import { logger } from '@/lib/monitoring/logger';

interface WorkerInstance {
  close(): Promise<void>;
}

export class WorkerManager {
  private static instance: WorkerManager;
  private workers: WorkerInstance[] = [];
  private connection: ConnectionOptions;

  private constructor() {}

  static getInstance(): WorkerManager {
    if (!WorkerManager.instance) {
      WorkerManager.instance = new WorkerManager();
    }
    return WorkerManager.instance;
  }

  async initialize(): Promise<void> {
    try {
      this.connection = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      };

      // Initialize all workers
      this.workers.push(new ImageProcessingWorker(this.connection));
      this.workers.push(new VideoProcessingWorker(this.connection));
      this.workers.push(new TextAnalysisWorker(this.connection));
      this.workers.push(new DocumentProcessingWorker(this.connection));
      this.workers.push(new EmbeddingGenerationWorker(this.connection));

      logger.info('All workers initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize workers', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down workers...');
    
    await Promise.all(
      this.workers.map(worker => worker.close())
    );
    
    logger.info('All workers shut down');
  }
}

export const workerManager = WorkerManager.getInstance();
```

---

## Step 5: Create Queue API Endpoints

### 5.1 Create Queue Routes
Create `src/app/api/queues/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { queueManager } from '@/lib/queue/queue-manager';
import { JobType } from '@/types/queue.types';
import { validateRequest } from '@/lib/middleware/validation';
import { requireAuth } from '@/lib/middleware/auth';
import { logger } from '@/lib/monitoring/logger';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const queues = await Promise.all(
      Object.values(JobType).map(async (jobType) => {
        const counts = await queueManager.getJobCounts(jobType);
        return {
          name: jobType,
          counts
        };
      })
    );

    return NextResponse.json({ queues });
  } catch (error) {
    logger.error('Failed to get queue stats', error);
    return NextResponse.json(
      { error: 'Failed to get queue stats' },
      { status: 500 }
    );
  }
}
```

### 5.2 Create Job Status Endpoint
Create `src/app/api/queues/[jobType]/[jobId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { queueManager } from '@/lib/queue/queue-manager';
import { requireAuth } from '@/lib/middleware/auth';
import { logger } from '@/lib/monitoring/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: { jobType: string; jobId: string } }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const job = await queueManager.getJob(params.jobType as any, params.jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Verify user owns this job
    if (job.data.userId !== auth.user.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    return NextResponse.json({
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace
    });
  } catch (error) {
    logger.error('Failed to get job status', error);
    return NextResponse.json(
      { error: 'Failed to get job status' },
      { status: 500 }
    );
  }
}
```

---

## Step 6: Initialize Queue System on Startup

### 6.1 Create Initialization Script
Create `src/lib/queue/initialize.ts`:

```typescript
import { queueManager } from '@/lib/queue/queue-manager';
import { workerManager } from '@/lib/queue/worker-manager';
import { logger } from '@/lib/monitoring/logger';

let initialized = false;

export async function initializeQueueSystem() {
  if (initialized) {
    logger.warn('Queue system already initialized');
    return;
  }

  try {
    logger.info('Initializing queue system...');
    
    // Initialize queue manager
    await queueManager.initialize();
    
    // Initialize workers only if not in serverless environment
    if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_WORKERS === 'true') {
      await workerManager.initialize();
    }
    
    initialized = true;
    logger.info('Queue system initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize queue system', error);
    throw error;
  }
}

export async function shutdownQueueSystem() {
  if (!initialized) {
    return;
  }

  try {
    logger.info('Shutting down queue system...');
    await workerManager.shutdown();
    await queueManager.shutdown();
    initialized = false;
    logger.info('Queue system shut down successfully');
  } catch (error) {
    logger.error('Failed to shutdown queue system', error);
    throw error;
  }
}
```

---

## Integration Points

### Using Redis from Phase 5
```typescript
import { getRedisClient } from '@/lib/cache/redis-client';

// The queue manager uses the existing Redis connection
const redisClient = getRedisClient();
```

### Using AWS Services from Phase 9
```typescript
import { rekognitionService } from '@/services/aws/rekognition-service';
import { transcribeService } from '@/services/aws/transcribe-service';
import { comprehendService } from '@/services/aws/comprehend-service';
```

### Using Cost Tracking from Phase 7
```typescript
import { CostTrackingService } from '@/services/cost-tracking';

// Track costs for each operation
await this.costService.trackUsage(userId, service, operation, cost, metadata);
```

### Using Logger from Phase 4
```typescript
import { logger } from '@/lib/monitoring/logger';

// Comprehensive logging throughout the queue system
logger.info('Processing job', { jobId, queueName, data });
```

---

## Testing

### Test Queue System
Create `scripts/test-queue-system.js`:

```javascript
const { queueManager } = require('../dist/lib/queue/queue-manager');
const { workerManager } = require('../dist/lib/queue/worker-manager');

async function testQueueSystem() {
  try {
    console.log('Initializing queue system...');
    await queueManager.initialize();
    await workerManager.initialize();
    
    console.log('Adding test jobs...');
    
    // Test image processing job
    const imageJob = await queueManager.addImageProcessingJob({
      userId: 'test-user-123',
      mediaItemId: 'media-123',
      s3Key: 'test-images/sample.jpg',
      costCenter: 'test',
      operations: {
        detectLabels: true,
        detectText: true
      }
    });
    console.log('Image job added:', imageJob.id);
    
    // Test text analysis job
    const textJob = await queueManager.addTextAnalysisJob({
      userId: 'test-user-123',
      mediaItemId: 'media-456',
      s3Key: 'test-docs/sample.txt',
      costCenter: 'test',
      text: 'This is a sample text for analysis.',
      operations: {
        detectSentiment: true,
        detectEntities: true
      }
    });
    console.log('Text job added:', textJob.id);
    
    // Get queue stats
    const stats = await Promise.all(
      ['image-processing', 'text-analysis'].map(async (queueName) => {
        const counts = await queueManager.getJobCounts(queueName);
        return { queue: queueName, counts };
      })
    );
    console.log('Queue stats:', JSON.stringify(stats, null, 2));
    
    // Wait a bit for processing
    console.log('Waiting for jobs to process...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check job status
    const imageJobStatus = await queueManager.getJob('image-processing', imageJob.id);
    console.log('Image job status:', imageJobStatus?.progress);
    
    const textJobStatus = await queueManager.getJob('text-analysis', textJob.id);
    console.log('Text job status:', textJobStatus?.progress);
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await workerManager.shutdown();
    await queueManager.shutdown();
    process.exit(0);
  }
}

testQueueSystem();
```

Run the test:
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
npm run build
node scripts/test-queue-system.js
```

---

## ✅ Phase 10 Completion Checklist

### Core Implementation
- [ ] **Queue Manager**: Implemented at `src/lib/queue/queue-manager.ts`
- [ ] **Workers**: Created workers for image, video, text, and embedding processing
- [ ] **Integration**: Connected to existing Redis, AWS services, and cost tracking
- [ ] **Progress Tracking**: Real-time job progress updates
- [ ] **Error Handling**: Retry logic with exponential backoff

### Testing & Verification
```bash
# All these should succeed:
npm run build
node scripts/test-queue-system.js
curl http://localhost:3000/api/queues -H "Authorization: Bearer $TOKEN"
```

### Database Updates
- [ ] Media items table updated with processing_status field
- [ ] Cost tracking integrated for all processing operations
- [ ] Job metadata stored in media_items

---

## 🚀 Next Steps

**Phase 10 Complete!** ✅

**Ready for Phase 11**: AI & Search Implementation
- Read: `phases/phase-11-ai-search.md`
- Prerequisites: Queue system for batch processing
- Outcome: Full AI-powered search with OpenAI embeddings and pgvector