# Phase 14: Testing Implementation

## 🎯 Phase Overview
This phase implements comprehensive testing for the entire AI Media Search application, covering unit tests, integration tests, and end-to-end tests. We'll achieve 80%+ code coverage while testing all services, components, API routes, and user workflows from phases 1-13.

## ✅ Prerequisites
- All phases 1-13 completed
- Node.js and npm installed
- PostgreSQL and Redis available for testing
- Understanding of Jest, React Testing Library, and Playwright

## 📋 Phase Checklist
- [ ] Set up Jest configuration for Next.js
- [ ] Create test utilities and factories
- [ ] Implement unit tests for all services and components
- [ ] Create integration tests for API routes
- [ ] Build end-to-end tests with Playwright
- [ ] Set up CI/CD test pipeline
- [ ] Configure coverage reporting
- [ ] Add performance and security testing

---

## Step 1: Install Testing Dependencies and Setup

### 1.1 Install Testing Packages
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
npm install --save-dev jest @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm install --save-dev @types/jest jest-environment-jsdom ts-jest
npm install --save-dev supertest @types/supertest
npm install --save-dev @playwright/test
npm install --save-dev @faker-js/faker
npm install --save-dev msw whatwg-fetch
npm install --save-dev @testing-library/react-hooks
npm install --save-dev jest-mock-extended
npm install --save-dev k6
```

### 1.2 Configure Jest
Create `jest.config.js`:

```javascript
const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // Handle module aliases (this will be automatically configured for you soon)
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/components/(.*)$': '<rootDir>/src/components/$1',
    '^@/lib/(.*)$': '<rootDir>/src/lib/$1',
    '^@/hooks/(.*)$': '<rootDir>/src/hooks/$1',
    '^@/stores/(.*)$': '<rootDir>/src/stores/$1',
  },
  moduleDirectories: ['node_modules', '<rootDir>/'],
  testEnvironment: 'jest-environment-jsdom',
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
    '!src/**/__tests__/**',
    '!src/**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
      },
    }],
  },
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)
```

### 1.3 Create Jest Setup
Create `jest.setup.js`:

```javascript
// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'
import 'whatwg-fetch'
import { TextEncoder, TextDecoder } from 'util'

// Polyfill for encoding which isn't present globally in jsdom
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

// Mock environment variables
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-api-key'
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'test-auth-domain'
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-project-id'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.STRIPE_SECRET_KEY = 'test-stripe-key'
process.env.AWS_ACCESS_KEY_ID = 'test-aws-key'
process.env.AWS_SECRET_ACCESS_KEY = 'test-aws-secret'

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
    }
  },
  useSearchParams() {
    return new URLSearchParams()
  },
  usePathname() {
    return '/'
  },
}))

// Mock Firebase
jest.mock('@/lib/firebase/client', () => ({
  auth: {
    signInWithEmailAndPassword: jest.fn(),
    createUserWithEmailAndPassword: jest.fn(),
    signOut: jest.fn(),
    onAuthStateChanged: jest.fn(),
  },
}))

// Suppress console errors in tests
const originalError = console.error
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render')
    ) {
      return
    }
    originalError.call(console, ...args)
  }
})

afterAll(() => {
  console.error = originalError
})
```

---

## Step 2: Create Testing Utilities

### 2.1 Create Test Factories
Create `src/lib/testing/factories/user.factory.ts`:

```typescript
import { faker } from '@faker-js/faker';
import { User } from 'firebase/auth';

export function createMockUser(overrides?: Partial<User>): User {
  return {
    uid: faker.string.uuid(),
    email: faker.internet.email(),
    emailVerified: true,
    displayName: faker.person.fullName(),
    photoURL: faker.image.avatar(),
    phoneNumber: faker.phone.number(),
    isAnonymous: false,
    tenantId: null,
    providerId: 'firebase',
    metadata: {
      creationTime: faker.date.past().toISOString(),
      lastSignInTime: faker.date.recent().toISOString(),
    },
    refreshToken: faker.string.alphanumeric(20),
    getIdToken: jest.fn().mockResolvedValue(faker.string.alphanumeric(100)),
    getIdTokenResult: jest.fn(),
    reload: jest.fn(),
    toJSON: jest.fn(),
    delete: jest.fn(),
    providerData: [],
    ...overrides,
  } as unknown as User;
}
```

Create `src/lib/testing/factories/media.factory.ts`:

```typescript
import { faker } from '@faker-js/faker';

export interface MediaItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  s3Key: string;
  status: string;
  metadata: any;
  createdAt: string;
  updatedAt: string;
}

export function createMockMediaItem(overrides?: Partial<MediaItem>): MediaItem {
  const mimeTypes = ['image/jpeg', 'image/png', 'video/mp4', 'application/pdf'];
  const statuses = ['pending', 'uploaded', 'processing', 'completed', 'failed'];

  return {
    id: faker.string.uuid(),
    filename: faker.system.fileName(),
    mimeType: faker.helpers.arrayElement(mimeTypes),
    size: faker.number.int({ min: 1000, max: 10000000 }),
    s3Key: `users/${faker.string.uuid()}/media/${faker.string.alphanumeric(10)}`,
    status: faker.helpers.arrayElement(statuses),
    metadata: {
      tags: faker.helpers.arrayElements(['vacation', 'work', 'family', 'nature'], 2),
      labels: faker.helpers.arrayElements(['sunset', 'beach', 'mountain', 'city'], 3),
    },
    createdAt: faker.date.past().toISOString(),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  };
}

export function createMockMediaItems(count: number): MediaItem[] {
  return Array.from({ length: count }, () => createMockMediaItem());
}
```

### 2.2 Create Mock Service Utilities
Create `src/lib/testing/mocks/aws.mocks.ts`:

```typescript
export const mockS3Service = {
  uploadFile: jest.fn().mockResolvedValue('mock-s3-key'),
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-signed-url.com'),
  getPresignedUploadUrl: jest.fn().mockResolvedValue('https://mock-upload-url.com'),
  deleteFile: jest.fn().mockResolvedValue(undefined),
};

export const mockRekognitionService = {
  detectLabels: jest.fn().mockResolvedValue({
    Labels: [
      { Name: 'Sunset', Confidence: 99.5 },
      { Name: 'Beach', Confidence: 95.2 },
    ],
  }),
  detectText: jest.fn().mockResolvedValue({
    TextDetections: [
      { DetectedText: 'Sample Text', Confidence: 98.1 },
    ],
  }),
  detectFaces: jest.fn().mockResolvedValue({
    FaceDetails: [
      { Confidence: 99.9, AgeRange: { Low: 20, High: 30 } },
    ],
  }),
  detectModerationLabels: jest.fn().mockResolvedValue({
    ModerationLabels: [],
  }),
};

export const mockTranscribeService = {
  startTranscriptionJob: jest.fn().mockResolvedValue({
    TranscriptionJob: {
      TranscriptionJobName: 'test-job',
      TranscriptionJobStatus: 'IN_PROGRESS',
    },
  }),
  getTranscriptionJob: jest.fn().mockResolvedValue({
    TranscriptionJob: {
      TranscriptionJobStatus: 'COMPLETED',
      Transcript: {
        TranscriptFileUri: 'https://mock-transcript.com',
      },
    },
  }),
};

export const mockComprehendService = {
  detectSentiment: jest.fn().mockResolvedValue({
    Sentiment: 'POSITIVE',
    SentimentScore: {
      Positive: 0.95,
      Negative: 0.02,
      Neutral: 0.02,
      Mixed: 0.01,
    },
  }),
  detectEntities: jest.fn().mockResolvedValue({
    Entities: [
      { Text: 'Amazon', Type: 'ORGANIZATION', Score: 0.99 },
    ],
  }),
  detectKeyPhrases: jest.fn().mockResolvedValue({
    KeyPhrases: [
      { Text: 'artificial intelligence', Score: 0.98 },
    ],
  }),
  detectDominantLanguage: jest.fn().mockResolvedValue({
    Languages: [
      { LanguageCode: 'en', Score: 0.99 },
    ],
  }),
};
```

### 2.3 Create Test Database Utilities
Create `src/lib/testing/utils/test-db.ts`:

```typescript
import knex, { Knex } from 'knex';
import { faker } from '@faker-js/faker';

let testDb: Knex | null = null;

export async function setupTestDatabase(): Promise<Knex> {
  if (testDb) return testDb;

  testDb = knex({
    client: 'pg',
    connection: {
      host: process.env.TEST_DB_HOST || 'localhost',
      port: parseInt(process.env.TEST_DB_PORT || '5432'),
      user: process.env.TEST_DB_USER || 'test',
      password: process.env.TEST_DB_PASSWORD || 'test',
      database: process.env.TEST_DB_NAME || 'ai_media_search_test',
    },
  });

  // Run migrations
  await testDb.migrate.latest();

  return testDb;
}

export async function teardownTestDatabase(): Promise<void> {
  if (testDb) {
    await testDb.destroy();
    testDb = null;
  }
}

export async function cleanDatabase(): Promise<void> {
  if (!testDb) throw new Error('Test database not initialized');

  // Clean tables in reverse order of dependencies
  await testDb('costs').del();
  await testDb('search_history').del();
  await testDb('embeddings').del();
  await testDb('media_items').del();
  await testDb('user_subscriptions').del();
  await testDb('users').del();
}

export async function seedTestUser(overrides?: any) {
  if (!testDb) throw new Error('Test database not initialized');

  const user = {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    display_name: faker.person.fullName(),
    photo_url: faker.image.avatar(),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };

  await testDb('users').insert(user);
  return user;
}

export async function seedTestMediaItems(userId: string, count: number) {
  if (!testDb) throw new Error('Test database not initialized');

  const items = Array.from({ length: count }, () => ({
    id: faker.string.uuid(),
    user_id: userId,
    filename: faker.system.fileName(),
    mime_type: faker.helpers.arrayElement(['image/jpeg', 'video/mp4', 'application/pdf']),
    size: faker.number.int({ min: 1000, max: 10000000 }),
    s3_key: `users/${userId}/media/${faker.string.alphanumeric(10)}`,
    processing_status: 'completed',
    metadata: JSON.stringify({
      tags: faker.helpers.arrayElements(['vacation', 'work', 'family'], 2),
    }),
    created_at: faker.date.past(),
    updated_at: new Date(),
  }));

  await testDb('media_items').insert(items);
  return items;
}
```

---

## Step 3: Unit Tests for Services

### 3.1 Test Cost Service
Create `__tests__/unit/services/cost-service.test.ts`:

```typescript
import { CostService } from '@/lib/services/cost-service';
import { setupTestDatabase, teardownTestDatabase, cleanDatabase, seedTestUser } from '@/lib/testing/utils/test-db';
import { Knex } from 'knex';

describe('CostService', () => {
  let costService: CostService;
  let testDb: Knex;
  let testUser: any;

  beforeAll(async () => {
    testDb = await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase();
    testUser = await seedTestUser();
    costService = new CostService();
  });

  describe('trackUsage', () => {
    it('should track usage and create cost record', async () => {
      const cost = 0.05;
      await costService.trackUsage(
        testUser.id,
        'openai',
        'embedding',
        cost,
        { model: 'text-embedding-3-small' }
      );

      const records = await testDb('costs').where('user_id', testUser.id);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        user_id: testUser.id,
        service: 'openai',
        operation: 'embedding',
        cost: '0.05',
      });
    });

    it('should update budget alerts when threshold exceeded', async () => {
      // Create subscription with low budget
      await testDb('subscription_tiers').insert({
        id: 'test-tier',
        name: 'Test Tier',
        monthly_price: 10,
        monthly_budget: 5,
        features: JSON.stringify({}),
      });

      await testDb('user_subscriptions').insert({
        id: 'test-sub',
        user_id: testUser.id,
        tier_id: 'test-tier',
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      // Track usage that exceeds budget
      await costService.trackUsage(testUser.id, 'openai', 'chat', 6.00);

      // Verify alert was created
      const alerts = await testDb('budget_alerts').where('user_id', testUser.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].alert_type).toBe('budget_exceeded');
    });
  });

  describe('getCurrentUsage', () => {
    it('should calculate current period usage', async () => {
      // Add some costs
      await costService.trackUsage(testUser.id, 'openai', 'embedding', 0.01);
      await costService.trackUsage(testUser.id, 'aws', 'rekognition', 0.02);
      await costService.trackUsage(testUser.id, 'openai', 'chat', 0.03);

      const usage = await costService.getCurrentUsage(testUser.id);

      expect(usage.total).toBe(0.06);
      expect(usage.breakdown).toHaveLength(2);
      expect(usage.breakdown.find(b => b.service === 'openai')?.total).toBe(0.04);
      expect(usage.breakdown.find(b => b.service === 'aws')?.total).toBe(0.02);
    });
  });

  describe('checkBudgetLimit', () => {
    it('should return true when under budget', async () => {
      const result = await costService.checkBudgetLimit(testUser.id, 0.01);
      expect(result.allowed).toBe(true);
    });

    it('should return false when over budget', async () => {
      // Set up subscription with low budget
      await testDb('subscription_tiers').insert({
        id: 'limited-tier',
        name: 'Limited Tier',
        monthly_price: 5,
        monthly_budget: 1,
        features: JSON.stringify({}),
      });

      await testDb('user_subscriptions').insert({
        id: 'limited-sub',
        user_id: testUser.id,
        tier_id: 'limited-tier',
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      // Add existing costs
      await costService.trackUsage(testUser.id, 'openai', 'chat', 0.95);

      // Check if new cost would exceed
      const result = await costService.checkBudgetLimit(testUser.id, 0.10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceed');
    });
  });
});
```

### 3.2 Test Search Service
Create `__tests__/unit/services/search-service.test.ts`:

```typescript
import { searchService } from '@/lib/services/search-service';
import { openAIService } from '@/lib/ai/openai-service';
import { embeddingService } from '@/lib/services/embedding-service';
import { getCacheManager } from '@/lib/cache/cache-manager';
import { setupTestDatabase, teardownTestDatabase, cleanDatabase, seedTestUser, seedTestMediaItems } from '@/lib/testing/utils/test-db';

jest.mock('@/lib/ai/openai-service');
jest.mock('@/lib/cache/cache-manager');

describe('SearchService', () => {
  let testUser: any;
  let mockCache: any;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase();
    testUser = await seedTestUser();
    
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
    };
    (getCacheManager as jest.Mock).mockReturnValue(mockCache);
    
    jest.clearAllMocks();
  });

  describe('search', () => {
    it('should return cached results when available', async () => {
      const cachedResults = {
        results: [{ id: '1', score: 0.95, mediaItem: {} }],
        totalCount: 1,
      };
      mockCache.get.mockResolvedValue(cachedResults);

      const result = await searchService.search({
        query: 'test query',
        userId: testUser.id,
      });

      expect(mockCache.get).toHaveBeenCalled();
      expect(openAIService.generateEmbedding).not.toHaveBeenCalled();
      expect(result.results).toEqual(cachedResults.results);
    });

    it('should generate embeddings and search when not cached', async () => {
      mockCache.get.mockResolvedValue(null);
      
      const mockEmbedding = Array(1536).fill(0.1);
      (openAIService.generateEmbedding as jest.Mock).mockResolvedValue({
        embedding: mockEmbedding,
        model: 'text-embedding-3-small',
        usage: { total_tokens: 10 },
        cost: 0.0001,
      });

      // Seed test data
      const mediaItems = await seedTestMediaItems(testUser.id, 3);
      
      // Mock embedding search results
      jest.spyOn(embeddingService, 'findSimilarEmbeddings').mockResolvedValue([
        { id: 'emb-1', score: 0.95, mediaItemId: mediaItems[0].id },
        { id: 'emb-2', score: 0.85, mediaItemId: mediaItems[1].id },
      ]);

      const result = await searchService.search({
        query: 'sunset photos',
        userId: testUser.id,
      });

      expect(openAIService.generateEmbedding).toHaveBeenCalledWith(
        { text: 'sunset photos' },
        testUser.id
      );
      expect(result.results).toHaveLength(2);
      expect(result.results[0].score).toBe(0.95);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it('should apply filters correctly', async () => {
      mockCache.get.mockResolvedValue(null);
      
      const mockEmbedding = Array(1536).fill(0.1);
      (openAIService.generateEmbedding as jest.Mock).mockResolvedValue({
        embedding: mockEmbedding,
        model: 'text-embedding-3-small',
        usage: { total_tokens: 10 },
        cost: 0.0001,
      });

      await searchService.search({
        query: 'documents',
        userId: testUser.id,
        filters: {
          mediaType: ['application/pdf'],
          minScore: 0.8,
          dateRange: {
            start: new Date('2024-01-01'),
            end: new Date('2024-12-31'),
          },
        },
      });

      expect(embeddingService.findSimilarEmbeddings).toHaveBeenCalledWith(
        expect.any(Array),
        20,
        0.8,
        expect.objectContaining({
          userId: testUser.id,
          mediaType: ['application/pdf'],
          dateRange: expect.any(Object),
        })
      );
    });
  });

  describe('getSearchHistory', () => {
    it('should return user search history', async () => {
      // Create search history
      const searchId = 'search-123';
      await searchService.trackSearchHistory(
        searchId,
        { query: 'test', userId: testUser.id },
        5,
        0.001,
        150
      );

      const history = await searchService.getSearchHistory(testUser.id, 10);

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        id: searchId,
        query: 'test',
        resultsCount: 5,
      });
    });
  });
});
```

---

## Step 4: Unit Tests for React Components

### 4.1 Test Search Bar Component
Create `__tests__/unit/components/SearchBar.test.tsx`:

```typescript
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar } from '@/components/search/SearchBar';
import { useSearchStore } from '@/stores/searchStore';

jest.mock('@/stores/searchStore');

describe('SearchBar', () => {
  const mockSearch = jest.fn();
  const mockFetchSuggestions = jest.fn();

  beforeEach(() => {
    (useSearchStore as unknown as jest.Mock).mockReturnValue({
      search: mockSearch,
      fetchSuggestions: mockFetchSuggestions,
      suggestions: [],
      loading: false,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders search input', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/search your media/i);
    expect(input).toBeInTheDocument();
  });

  it('calls search on form submit', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    
    const input = screen.getByPlaceholderText(/search your media/i);
    await user.type(input, 'test query');
    await user.keyboard('{Enter}');

    expect(mockSearch).toHaveBeenCalledWith('test query');
  });

  it('fetches suggestions on input change', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    
    const input = screen.getByPlaceholderText(/search your media/i);
    await user.type(input, 'sun');

    await waitFor(() => {
      expect(mockFetchSuggestions).toHaveBeenCalledWith('sun');
    }, { timeout: 500 });
  });

  it('displays suggestions dropdown', async () => {
    (useSearchStore as unknown as jest.Mock).mockReturnValue({
      search: mockSearch,
      fetchSuggestions: mockFetchSuggestions,
      suggestions: ['sunset photos', 'sunrise videos'],
      loading: false,
    });

    const user = userEvent.setup();
    render(<SearchBar />);
    
    const input = screen.getByPlaceholderText(/search your media/i);
    await user.type(input, 'sun');

    await waitFor(() => {
      expect(screen.getByText('sunset photos')).toBeInTheDocument();
      expect(screen.getByText('sunrise videos')).toBeInTheDocument();
    });
  });

  it('selects suggestion on click', async () => {
    (useSearchStore as unknown as jest.Mock).mockReturnValue({
      search: mockSearch,
      fetchSuggestions: mockFetchSuggestions,
      suggestions: ['sunset photos'],
      loading: false,
    });

    const user = userEvent.setup();
    render(<SearchBar />);
    
    const input = screen.getByPlaceholderText(/search your media/i);
    await user.type(input, 'sun');

    await waitFor(() => {
      expect(screen.getByText('sunset photos')).toBeInTheDocument();
    });

    await user.click(screen.getByText('sunset photos'));
    expect(mockSearch).toHaveBeenCalledWith('sunset photos');
  });

  it('shows loading indicator when searching', () => {
    (useSearchStore as unknown as jest.Mock).mockReturnValue({
      search: mockSearch,
      fetchSuggestions: mockFetchSuggestions,
      suggestions: [],
      loading: true,
    });

    render(<SearchBar />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });
});
```

### 4.2 Test Media Card Component
Create `__tests__/unit/components/MediaCard.test.tsx`:

```typescript
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MediaCard } from '@/components/media/MediaCard';
import { useMediaStore } from '@/stores/mediaStore';
import { createMockMediaItem } from '@/lib/testing/factories/media.factory';

jest.mock('@/stores/mediaStore');
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img {...props} />,
}));

describe('MediaCard', () => {
  const mockDeleteMedia = jest.fn();
  const mockItem = createMockMediaItem({
    mimeType: 'image/jpeg',
    filename: 'test-image.jpg',
    status: 'completed',
  });

  beforeEach(() => {
    (useMediaStore as unknown as jest.Mock).mockReturnValue({
      deleteMedia: mockDeleteMedia,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders media item correctly', () => {
    render(<MediaCard item={mockItem} />);
    
    expect(screen.getByAltText(mockItem.filename)).toBeInTheDocument();
    expect(screen.getByText(mockItem.filename)).toBeInTheDocument();
  });

  it('shows correct icon for non-image media types', () => {
    const videoItem = createMockMediaItem({
      mimeType: 'video/mp4',
      filename: 'test-video.mp4',
    });

    render(<MediaCard item={videoItem} />);
    expect(screen.getByTestId('video-icon')).toBeInTheDocument();
  });

  it('displays processing status', () => {
    const processingItem = createMockMediaItem({
      status: 'processing',
    });

    render(<MediaCard item={processingItem} />);
    expect(screen.getByText('processing')).toBeInTheDocument();
  });

  it('opens detail modal on click', async () => {
    render(<MediaCard item={mockItem} />);
    
    const card = screen.getByRole('article');
    fireEvent.click(card);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('handles delete action', async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    
    render(<MediaCard item={mockItem} />);
    
    const deleteButton = screen.getByLabelText('Delete');
    fireEvent.click(deleteButton);

    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to delete this file?');
    expect(mockDeleteMedia).toHaveBeenCalledWith(mockItem.id);
  });

  it('displays tags when available', () => {
    const itemWithTags = createMockMediaItem({
      metadata: {
        tags: ['vacation', 'beach'],
      },
    });

    render(<MediaCard item={itemWithTags} />);
    expect(screen.getByText('2')).toBeInTheDocument(); // Tag count
  });

  it('applies hover effects', () => {
    render(<MediaCard item={mockItem} />);
    
    const card = screen.getByRole('article');
    fireEvent.mouseEnter(card);

    const overlay = screen.getByTestId('hover-overlay');
    expect(overlay).toHaveClass('opacity-100');
  });
});
```

### 4.3 Test Upload Dropzone Component
Create `__tests__/unit/components/FileUploadDropzone.test.tsx`:

```typescript
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileUploadDropzone } from '@/components/upload/FileUploadDropzone';
import { useUploadStore } from '@/stores/uploadStore';

jest.mock('@/stores/uploadStore');
jest.mock('react-dropzone', () => ({
  useDropzone: ({ onDrop }: any) => ({
    getRootProps: () => ({
      onClick: () => {},
      onDrop: (e: any) => {
        e.preventDefault();
        onDrop(e.dataTransfer.files);
      },
    }),
    getInputProps: () => ({}),
    isDragActive: false,
  }),
}));

describe('FileUploadDropzone', () => {
  const mockAddFiles = jest.fn();
  const mockUploadAll = jest.fn();

  beforeEach(() => {
    (useUploadStore as unknown as jest.Mock).mockReturnValue({
      addFiles: mockAddFiles,
      uploadAll: mockUploadAll,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders dropzone area', () => {
    render(<FileUploadDropzone />);
    
    expect(screen.getByText(/drag & drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/Images, videos, audio, PDFs/i)).toBeInTheDocument();
  });

  it('handles file drop', async () => {
    render(<FileUploadDropzone />);
    
    const dropzone = screen.getByRole('button');
    const files = [
      new File(['content'], 'test.jpg', { type: 'image/jpeg' }),
      new File(['content'], 'test.pdf', { type: 'application/pdf' }),
    ];

    const dataTransfer = {
      files,
      items: files.map((file) => ({
        kind: 'file',
        getAsFile: () => file,
      })),
      types: ['Files'],
    };

    fireEvent.drop(dropzone, { dataTransfer });

    await waitFor(() => {
      expect(mockAddFiles).toHaveBeenCalledWith(files);
      expect(mockUploadAll).toHaveBeenCalled();
    });
  });

  it('filters out large files', async () => {
    window.alert = jest.fn();
    render(<FileUploadDropzone />);
    
    const dropzone = screen.getByRole('button');
    const files = [
      new File(['small'], 'small.jpg', { type: 'image/jpeg' }),
      Object.defineProperty(
        new File(['large'], 'large.jpg', { type: 'image/jpeg' }),
        'size',
        { value: 6 * 1024 * 1024 * 1024 } // 6GB
      ),
    ];

    const dataTransfer = {
      files,
      items: files.map((file) => ({
        kind: 'file',
        getAsFile: () => file,
      })),
      types: ['Files'],
    };

    fireEvent.drop(dropzone, { dataTransfer });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        'Some files were too large and were not added (max 5GB)'
      );
      expect(mockAddFiles).toHaveBeenCalledWith([files[0]]);
    });
  });

  it('shows drag active state', () => {
    jest.unmock('react-dropzone');
    jest.mock('react-dropzone', () => ({
      useDropzone: () => ({
        getRootProps: () => ({}),
        getInputProps: () => ({}),
        isDragActive: true,
      }),
    }));

    render(<FileUploadDropzone />);
    
    expect(screen.getByText('Drop the files here...')).toBeInTheDocument();
    const dropzone = screen.getByRole('button').parentElement;
    expect(dropzone).toHaveClass('border-blue-500');
  });
});
```

---

## Step 5: Integration Tests

### 5.1 Test Upload API Routes
Create `__tests__/integration/api/upload.test.ts`:

```typescript
import { createMocks } from 'node-mocks-http';
import handler from '@/app/api/upload/presigned/route';
import { POST as uploadCompleteHandler } from '@/app/api/upload/complete/route';
import { setupTestDatabase, teardownTestDatabase, cleanDatabase, seedTestUser } from '@/lib/testing/utils/test-db';
import { mockS3Service } from '@/lib/testing/mocks/aws.mocks';

jest.mock('@/lib/aws/s3-service', () => ({
  s3Service: mockS3Service,
}));

jest.mock('@/lib/middleware/auth', () => ({
  requireAuth: jest.fn().mockResolvedValue({
    success: true,
    user: { uid: 'test-user-id' },
  }),
}));

describe('/api/upload', () => {
  let testUser: any;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase();
    testUser = await seedTestUser({ id: 'test-user-id' });
    jest.clearAllMocks();
  });

  describe('POST /api/upload/presigned', () => {
    it('should generate presigned URL for valid request', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer test-token',
        },
        body: {
          filename: 'test-image.jpg',
          mimeType: 'image/jpeg',
          size: 1024 * 1024, // 1MB
        },
      });

      await handler.POST(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      const json = JSON.parse(res._getData());
      expect(json).toMatchObject({
        uploadUrl: 'https://mock-upload-url.com',
        mediaItemId: expect.any(String),
        s3Key: expect.any(String),
        expiresIn: 3600,
      });
      expect(mockS3Service.getPresignedUploadUrl).toHaveBeenCalled();
    });

    it('should reject oversized files', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer test-token',
        },
        body: {
          filename: 'huge-file.mp4',
          mimeType: 'video/mp4',
          size: 6 * 1024 * 1024 * 1024, // 6GB
        },
      });

      await handler.POST(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      const json = JSON.parse(res._getData());
      expect(json.error).toContain('Invalid request');
    });

    it('should check storage quota', async () => {
      // Seed existing media to fill quota
      await seedTestMediaItems(testUser.id, 10);
      
      const { req, res } = createMocks({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer test-token',
        },
        body: {
          filename: 'another-file.jpg',
          mimeType: 'image/jpeg',
          size: 1024 * 1024 * 1024, // 1GB
        },
      });

      await handler.POST(req as any, res as any);

      expect(res._getStatusCode()).toBe(403);
      const json = JSON.parse(res._getData());
      expect(json.error).toContain('Storage quota exceeded');
    });
  });

  describe('POST /api/upload/complete', () => {
    it('should mark upload complete and queue processing', async () => {
      // Create a media item first
      const mediaItem = await seedTestMediaItems(testUser.id, 1);
      
      const { req, res } = createMocks({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer test-token',
        },
        body: {
          mediaItemId: mediaItem[0].id,
          operations: {
            generateEmbedding: true,
            detectLabels: true,
          },
        },
      });

      await uploadCompleteHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      const json = JSON.parse(res._getData());
      expect(json).toMatchObject({
        mediaItemId: mediaItem[0].id,
        status: 'processing',
        queuedJobs: expect.any(Array),
      });
    });
  });
});
```

### 5.2 Test Search API Routes
Create `__tests__/integration/api/search.test.ts`:

```typescript
import { createMocks } from 'node-mocks-http';
import { POST as searchHandler } from '@/app/api/search/route';
import { GET as suggestionsHandler } from '@/app/api/search/suggestions/route';
import { setupTestDatabase, teardownTestDatabase, cleanDatabase, seedTestUser } from '@/lib/testing/utils/test-db';
import { searchService } from '@/lib/services/search-service';

jest.mock('@/lib/services/search-service');
jest.mock('@/lib/middleware/auth', () => ({
  requireAuth: jest.fn().mockResolvedValue({
    success: true,
    user: { uid: 'test-user-id' },
  }),
}));

describe('/api/search', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedTestUser({ id: 'test-user-id' });
    jest.clearAllMocks();
  });

  describe('POST /api/search', () => {
    it('should perform search with valid query', async () => {
      const mockResults = {
        results: [
          {
            id: 'result-1',
            score: 0.95,
            mediaItem: {
              id: 'media-1',
              filename: 'sunset.jpg',
              mimeType: 'image/jpeg',
            },
          },
        ],
        totalCount: 1,
        searchId: 'search-123',
      };

      (searchService.search as jest.Mock).mockResolvedValue(mockResults);

      const { req, res } = createMocks({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer test-token',
        },
        body: {
          query: 'sunset photos',
          filters: {
            mediaType: ['image/jpeg'],
            minScore: 0.8,
          },
          limit: 20,
        },
      });

      await searchHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      const json = JSON.parse(res._getData());
      expect(json).toMatchObject(mockResults);
      expect(searchService.search).toHaveBeenCalledWith({
        query: 'sunset photos',
        userId: 'test-user-id',
        filters: {
          mediaType: ['image/jpeg'],
          minScore: 0.8,
        },
        limit: 20,
      });
    });

    it('should validate search query', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer test-token',
        },
        body: {
          query: '', // Empty query
        },
      });

      await searchHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      const json = JSON.parse(res._getData());
      expect(json.error).toContain('Invalid request');
    });
  });

  describe('GET /api/search/suggestions', () => {
    it('should return search suggestions', async () => {
      const { req, res } = createMocks({
        method: 'GET',
        headers: {
          'authorization': 'Bearer test-token',
        },
        query: {
          query: 'sun',
        },
      });

      await suggestionsHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      const json = JSON.parse(res._getData());
      expect(json).toHaveProperty('suggestions');
      expect(json).toHaveProperty('recent');
    });
  });
});
```

---

## Step 6: End-to-End Tests with Playwright

### 6.1 Configure Playwright
Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile tests
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

### 6.2 Create Auth E2E Tests
Create `e2e/auth.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { createMockUser } from '@/lib/testing/factories/user.factory';

test.describe('Authentication Flow', () => {
  test('should allow user to sign up', async ({ page }) => {
    await page.goto('/signup');

    // Fill signup form
    await page.fill('input[name="email"]', 'newuser@example.com');
    await page.fill('input[name="password"]', 'SecurePassword123!');
    await page.fill('input[name="confirmPassword"]', 'SecurePassword123!');

    // Submit form
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('text=Welcome')).toBeVisible();
  });

  test('should allow user to sign in', async ({ page }) => {
    await page.goto('/login');

    // Fill login form
    await page.fill('input[name="email"]', 'existing@example.com');
    await page.fill('input[name="password"]', 'Password123!');

    // Submit form
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard');
  });

  test('should handle invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.fill('input[name="email"]', 'wrong@example.com');
    await page.fill('input[name="password"]', 'WrongPassword');
    await page.click('button[type="submit"]');

    // Should show error message
    await expect(page.locator('text=Invalid email or password')).toBeVisible();
  });

  test('should protect authenticated routes', async ({ page }) => {
    // Try to access dashboard without auth
    await page.goto('/dashboard');

    // Should redirect to login
    await expect(page).toHaveURL('/login');
  });

  test('should allow user to sign out', async ({ page, context }) => {
    // Set auth cookie to simulate logged in user
    await context.addCookies([
      {
        name: 'auth-token',
        value: 'mock-token',
        domain: 'localhost',
        path: '/',
      },
    ]);

    await page.goto('/dashboard');
    await page.click('button[aria-label="User menu"]');
    await page.click('text=Sign out');

    // Should redirect to home
    await expect(page).toHaveURL('/');
  });
});
```

### 6.3 Create Upload E2E Tests
Create `e2e/upload.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('File Upload Flow', () => {
  test.beforeEach(async ({ page, context }) => {
    // Mock authentication
    await context.addCookies([
      {
        name: 'auth-token',
        value: 'mock-token',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/dashboard');
  });

  test('should upload file via drag and drop', async ({ page }) => {
    // Navigate to upload page
    await page.click('text=Upload');

    // Create test file
    const filePath = path.join(__dirname, 'fixtures', 'test-image.jpg');

    // Drag and drop file
    const dropzone = page.locator('[data-testid="dropzone"]');
    await dropzone.dispatchEvent('drop', {
      dataTransfer: {
        files: [filePath],
      },
    });

    // Should show upload progress
    await expect(page.locator('text=Uploading')).toBeVisible();
    
    // Should show completion
    await expect(page.locator('text=Upload complete')).toBeVisible({ timeout: 10000 });
  });

  test('should upload multiple files', async ({ page }) => {
    await page.click('text=Upload');

    const input = page.locator('input[type="file"]');
    await input.setInputFiles([
      path.join(__dirname, 'fixtures', 'test-image.jpg'),
      path.join(__dirname, 'fixtures', 'test-document.pdf'),
    ]);

    // Should show both files in queue
    await expect(page.locator('text=test-image.jpg')).toBeVisible();
    await expect(page.locator('text=test-document.pdf')).toBeVisible();

    // Should process both files
    await expect(page.locator('[data-testid="upload-progress"]')).toHaveCount(2);
  });

  test('should handle upload errors', async ({ page }) => {
    await page.click('text=Upload');

    // Try to upload oversized file
    const oversizedFile = path.join(__dirname, 'fixtures', 'large-file.mp4');
    const input = page.locator('input[type="file"]');
    await input.setInputFiles([oversizedFile]);

    // Should show error
    await expect(page.locator('text=File too large')).toBeVisible();
  });

  test('should cancel upload', async ({ page }) => {
    await page.click('text=Upload');

    const filePath = path.join(__dirname, 'fixtures', 'test-video.mp4');
    const input = page.locator('input[type="file"]');
    await input.setInputFiles([filePath]);

    // Cancel upload
    await page.click('[aria-label="Cancel upload"]');

    // Should remove from queue
    await expect(page.locator('text=test-video.mp4')).not.toBeVisible();
  });
});
```

### 6.4 Create Search E2E Tests
Create `e2e/search.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Search Functionality', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      {
        name: 'auth-token',
        value: 'mock-token',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/search');
  });

  test('should search for media', async ({ page }) => {
    // Type search query
    await page.fill('[placeholder*="Search"]', 'sunset photos');
    await page.keyboard.press('Enter');

    // Should show loading
    await expect(page.locator('[data-testid="search-loading"]')).toBeVisible();

    // Should show results
    await expect(page.locator('[data-testid="search-results"]')).toBeVisible();
    await expect(page.locator('[data-testid="media-card"]')).toHaveCount(3);
  });

  test('should show search suggestions', async ({ page }) => {
    // Start typing
    await page.fill('[placeholder*="Search"]', 'sun');

    // Should show suggestions dropdown
    await expect(page.locator('[data-testid="suggestions"]')).toBeVisible();
    await expect(page.locator('text=sunset photos')).toBeVisible();
    await expect(page.locator('text=sunrise videos')).toBeVisible();

    // Click suggestion
    await page.click('text=sunset photos');

    // Should perform search
    await expect(page.locator('[data-testid="search-results"]')).toBeVisible();
  });

  test('should filter search results', async ({ page }) => {
    await page.fill('[placeholder*="Search"]', 'vacation');
    await page.keyboard.press('Enter');

    // Open filters
    await page.click('button:has-text("Filters")');

    // Select image type
    await page.check('input[value="image"]');
    
    // Set date range
    await page.fill('input[name="startDate"]', '2024-01-01');
    await page.fill('input[name="endDate"]', '2024-12-31');

    // Apply filters
    await page.click('button:has-text("Apply")');

    // Should update results
    await expect(page.locator('[data-testid="media-card"]')).toHaveCount(2);
    await expect(page.locator('text=Filters applied')).toBeVisible();
  });

  test('should show no results message', async ({ page }) => {
    await page.fill('[placeholder*="Search"]', 'asdfghjklqwertyuiop');
    await page.keyboard.press('Enter');

    await expect(page.locator('text=No results found')).toBeVisible();
    await expect(page.locator('text=Try different keywords')).toBeVisible();
  });

  test('should navigate to media detail from search', async ({ page }) => {
    await page.fill('[placeholder*="Search"]', 'beach');
    await page.keyboard.press('Enter');

    // Click first result
    await page.click('[data-testid="media-card"]:first-child');

    // Should open detail modal
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('text=AI Analysis')).toBeVisible();
  });
});
```

---

## Step 7: Performance and Load Testing

### 7.1 Create K6 Load Test Script
Create `k6/load-test.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 users
    { duration: '1m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '2m', target: 100 },  // Stay at 100 users
    { duration: '1m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.1'],    // Error rate must be below 10%
  },
};

const BASE_URL = 'http://localhost:3000';

// Load test data
const testUsers = new SharedArray('users', function () {
  return JSON.parse(open('./test-users.json'));
});

export default function () {
  // Get random user
  const user = testUsers[Math.floor(Math.random() * testUsers.length)];
  const authToken = user.token;

  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  };

  // Scenario 1: Search for media
  let searchRes = http.post(
    `${BASE_URL}/api/search`,
    JSON.stringify({
      query: 'sunset photos',
      limit: 20,
    }),
    params
  );

  check(searchRes, {
    'search status is 200': (r) => r.status === 200,
    'search returned results': (r) => JSON.parse(r.body).results.length > 0,
    'search response time OK': (r) => r.timings.duration < 500,
  });

  sleep(1);

  // Scenario 2: Get media list
  let mediaRes = http.get(`${BASE_URL}/api/media?limit=20`, params);

  check(mediaRes, {
    'media list status is 200': (r) => r.status === 200,
    'media list has items': (r) => JSON.parse(r.body).items.length > 0,
  });

  sleep(1);

  // Scenario 3: Get user usage stats
  let usageRes = http.get(`${BASE_URL}/api/user/usage`, params);

  check(usageRes, {
    'usage status is 200': (r) => r.status === 200,
    'usage has data': (r) => JSON.parse(r.body).usage !== undefined,
  });

  sleep(2);
}

// Run with: k6 run k6/load-test.js
```

### 7.2 Create API Performance Test
Create `__tests__/performance/api-performance.test.ts`:

```typescript
import { performance } from 'perf_hooks';
import axios from 'axios';
import { setupTestDatabase, teardownTestDatabase, seedTestUser, seedTestMediaItems } from '@/lib/testing/utils/test-db';

describe('API Performance Tests', () => {
  const API_BASE = 'http://localhost:3000/api';
  let authToken: string;
  let testUser: any;

  beforeAll(async () => {
    await setupTestDatabase();
    testUser = await seedTestUser();
    // Seed a large dataset
    await seedTestMediaItems(testUser.id, 1000);
    authToken = 'mock-auth-token';
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('should handle search requests under 200ms', async () => {
    const start = performance.now();
    
    const response = await axios.post(
      `${API_BASE}/search`,
      { query: 'test query' },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );

    const duration = performance.now() - start;
    
    expect(response.status).toBe(200);
    expect(duration).toBeLessThan(200);
  });

  it('should handle concurrent requests efficiently', async () => {
    const requests = Array(50).fill(null).map(() => 
      axios.get(`${API_BASE}/media?limit=20`, {
        headers: { Authorization: `Bearer ${authToken}` }
      })
    );

    const start = performance.now();
    const responses = await Promise.all(requests);
    const duration = performance.now() - start;

    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(duration / requests.length).toBeLessThan(100); // Average < 100ms per request
  });

  it('should paginate large datasets efficiently', async () => {
    const pages = [];
    const pageSize = 50;
    
    for (let page = 1; page <= 5; page++) {
      const start = performance.now();
      
      const response = await axios.get(
        `${API_BASE}/media?page=${page}&limit=${pageSize}`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      
      const duration = performance.now() - start;
      pages.push({ page, duration, itemCount: response.data.items.length });
    }

    // Each page should load in similar time
    const durations = pages.map(p => p.duration);
    const avgDuration = durations.reduce((a, b) => a + b) / durations.length;
    const maxDeviation = Math.max(...durations.map(d => Math.abs(d - avgDuration)));
    
    expect(maxDeviation).toBeLessThan(50); // Max 50ms deviation
  });
});
```

---

## Step 8: Security Testing

### 8.1 Create Security Test Suite
Create `__tests__/security/api-security.test.ts`:

```typescript
import { createMocks } from 'node-mocks-http';
import axios from 'axios';

describe('API Security Tests', () => {
  const API_BASE = 'http://localhost:3000/api';

  describe('Authentication', () => {
    it('should reject requests without auth token', async () => {
      try {
        await axios.get(`${API_BASE}/media`);
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(401);
      }
    });

    it('should reject requests with invalid token', async () => {
      try {
        await axios.get(`${API_BASE}/media`, {
          headers: { Authorization: 'Bearer invalid-token' }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(401);
      }
    });
  });

  describe('Input Validation', () => {
    it('should sanitize SQL injection attempts', async () => {
      const maliciousQuery = "'; DROP TABLE users; --";
      
      try {
        await axios.post(
          `${API_BASE}/search`,
          { query: maliciousQuery },
          { headers: { Authorization: 'Bearer valid-token' } }
        );
      } catch (error: any) {
        // Should handle gracefully, not expose DB error
        expect(error.response.data.error).not.toContain('DROP TABLE');
      }
    });

    it('should prevent XSS in user input', async () => {
      const xssPayload = '<script>alert("XSS")</script>';
      
      const response = await axios.patch(
        `${API_BASE}/media/test-id`,
        { filename: xssPayload },
        { headers: { Authorization: 'Bearer valid-token' } }
      );

      // Should sanitize the input
      expect(response.data).not.toContain('<script>');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const requests = Array(100).fill(null).map(() =>
        axios.post(
          `${API_BASE}/upload/presigned`,
          { filename: 'test.jpg', mimeType: 'image/jpeg', size: 1000 },
          { headers: { Authorization: 'Bearer valid-token' } }
        ).catch(e => e.response)
      );

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);
      
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('Access Control', () => {
    it('should prevent access to other users data', async () => {
      try {
        // Try to access media item belonging to another user
        await axios.get(`${API_BASE}/media/other-user-media-id`, {
          headers: { Authorization: 'Bearer user-a-token' }
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(404); // Not found, not forbidden
      }
    });
  });
});
```

---

## Step 9: CI/CD Test Pipeline

### 9.1 Create GitHub Actions Test Workflow
Create `.github/workflows/test.yml`:

```yaml
name: Test Suite

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: ai_media_search_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Run type checking
      run: npm run type-check

    - name: Run linting
      run: npm run lint

    - name: Run unit tests
      run: npm run test:unit -- --coverage
      env:
        DATABASE_URL: postgresql://test:test@localhost:5432/ai_media_search_test
        REDIS_URL: redis://localhost:6379
        JWT_SECRET: test-secret

    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage/coverage-final.json
        flags: unit

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: ai_media_search_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Run database migrations
      run: npm run db:migrate:test
      env:
        DATABASE_URL: postgresql://test:test@localhost:5432/ai_media_search_test

    - name: Run integration tests
      run: npm run test:integration
      env:
        DATABASE_URL: postgresql://test:test@localhost:5432/ai_media_search_test
        REDIS_URL: redis://localhost:6379

  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Install Playwright browsers
      run: npx playwright install --with-deps

    - name: Build application
      run: npm run build

    - name: Run E2E tests
      run: npm run test:e2e
      env:
        CI: true

    - name: Upload Playwright report
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: playwright-report
        path: playwright-report/
        retention-days: 30

  performance-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    
    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Install k6
      run: |
        sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
        echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
        sudo apt-get update
        sudo apt-get install k6

    - name: Start test server
      run: |
        npm run build
        npm run start &
        npx wait-on http://localhost:3000

    - name: Run load tests
      run: k6 run k6/load-test.js --out json=k6-results.json

    - name: Upload k6 results
      uses: actions/upload-artifact@v3
      with:
        name: k6-results
        path: k6-results.json
```

### 9.2 Update Package.json Scripts
Add to `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest --testPathPattern=__tests__/unit",
    "test:integration": "jest --testPathPattern=__tests__/integration --runInBand",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:performance": "jest --testPathPattern=__tests__/performance",
    "test:security": "jest --testPathPattern=__tests__/security",
    "test:coverage": "jest --coverage",
    "test:watch": "jest --watch",
    "type-check": "tsc --noEmit",
    "lint": "next lint",
    "db:migrate:test": "knex migrate:latest --env test"
  }
}
```

---

## Testing

### Run All Tests
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
# Unit tests with coverage
npm run test:coverage

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Performance tests
npm run test:performance

# Security tests
npm run test:security

# Run specific test file
npm test -- __tests__/unit/services/cost-service.test.ts

# Run tests in watch mode
npm run test:watch
```

### Check Coverage Report
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
npm run test:coverage
open coverage/lcov-report/index.html
```

---

## ✅ Phase 14 Completion Checklist

### Core Implementation
- [ ] **Jest Configuration**: Next.js compatible setup with TypeScript
- [ ] **Test Utilities**: Factories, mocks, database helpers
- [ ] **Unit Tests**: 80%+ coverage for services, components, utils
- [ ] **Integration Tests**: API routes, database operations, queues
- [ ] **E2E Tests**: Complete user workflows with Playwright
- [ ] **Performance Tests**: Load testing with k6, API benchmarks
- [ ] **Security Tests**: Auth, input validation, access control
- [ ] **CI/CD Pipeline**: GitHub Actions with all test types

### Testing & Verification
```bash
# All these should pass:
npm run test:coverage
npm run test:e2e
npm run type-check
npm run lint

# Coverage should be > 80%
# All E2E scenarios should pass
# Performance benchmarks should be met
```

### Test Categories Covered
- [ ] Authentication flows from Phase 7
- [ ] Payment workflows from Phase 8
- [ ] AWS service mocks from Phase 9
- [ ] Queue processing from Phase 10
- [ ] AI/Search functionality from Phase 11
- [ ] All API endpoints from Phase 12
- [ ] React components from Phase 13

---

## 🚀 Next Steps

**Phase 14 Complete!** ✅

**Ready for Phase 15**: Docker & Deployment
- Read: `phases/phase-15-docker-deployment.md`
- Prerequisites: All tests passing with good coverage
- Outcome: Containerized, production-ready application