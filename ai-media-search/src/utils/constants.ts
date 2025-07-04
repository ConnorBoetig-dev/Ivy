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