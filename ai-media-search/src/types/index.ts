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
  detectedLabels?: Array<{
    name: string;
    confidence: number;
  }>;
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