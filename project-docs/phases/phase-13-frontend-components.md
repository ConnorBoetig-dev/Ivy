# Phase 13: Frontend Components

## 🎯 Phase Overview
This phase implements the complete React frontend for the AI Media Search application using Next.js 14, TypeScript, Tailwind CSS, and Zustand for state management. We'll create responsive, accessible components that integrate seamlessly with the APIs from Phase 12.

## ✅ Prerequisites
- Phase 1 completed (Next.js project with TypeScript and Tailwind)
- Phase 6 completed (Firebase authentication)
- Phase 12 completed (All API routes implemented)
- Node.js and npm installed
- Understanding of React hooks and TypeScript

## 📋 Phase Checklist
- [ ] Install Zustand and create state stores
- [ ] Create upload components with drag & drop
- [ ] Build media grid with infinite scroll
- [ ] Implement AI-powered search interface
- [ ] Create dashboard with analytics visualization
- [ ] Add billing and subscription management
- [ ] Build responsive layouts with Tailwind CSS
- [ ] Add accessibility features and loading states

---

## Step 1: Install Dependencies and Setup State Management

### 1.1 Install Required Packages
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
npm install zustand @tanstack/react-query axios react-dropzone
npm install recharts react-intersection-observer framer-motion
npm install --save-dev @types/react-dropzone
```

### 1.2 Create Authentication Store
Create `src/stores/authStore.ts`:

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { auth } from '@/lib/firebase/client';
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import axios from 'axios';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  subscription: any | null;
  
  // Actions
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchUserProfile: () => Promise<void>;
  setUser: (user: User | null) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      loading: false,
      error: null,
      subscription: null,

      signIn: async (email: string, password: string) => {
        set({ loading: true, error: null });
        try {
          const credential = await signInWithEmailAndPassword(auth, email, password);
          set({ user: credential.user, loading: false });
          await get().fetchUserProfile();
        } catch (error: any) {
          set({ error: error.message, loading: false });
          throw error;
        }
      },

      signUp: async (email: string, password: string) => {
        set({ loading: true, error: null });
        try {
          const credential = await createUserWithEmailAndPassword(auth, email, password);
          set({ user: credential.user, loading: false });
        } catch (error: any) {
          set({ error: error.message, loading: false });
          throw error;
        }
      },

      logout: async () => {
        set({ loading: true });
        try {
          await signOut(auth);
          set({ user: null, subscription: null, loading: false });
        } catch (error: any) {
          set({ error: error.message, loading: false });
        }
      },

      fetchUserProfile: async () => {
        const user = get().user;
        if (!user) return;

        try {
          const token = await user.getIdToken();
          const response = await axios.get('/api/user/profile', {
            headers: { Authorization: `Bearer ${token}` }
          });
          set({ subscription: response.data.subscription });
        } catch (error) {
          console.error('Failed to fetch user profile:', error);
        }
      },

      setUser: (user) => set({ user }),
      clearError: () => set({ error: null })
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user })
    }
  )
);

// Initialize auth listener
if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, (user) => {
    useAuthStore.getState().setUser(user);
    if (user) {
      useAuthStore.getState().fetchUserProfile();
    }
  });
}
```

### 1.3 Create Upload Store
Create `src/stores/uploadStore.ts`:

```typescript
import { create } from 'zustand';
import axios from 'axios';
import { useAuthStore } from './authStore';

interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
  mediaItemId?: string;
  uploadUrl?: string;
}

interface UploadState {
  files: UploadFile[];
  isUploading: boolean;
  
  // Actions
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  uploadFile: (fileId: string) => Promise<void>;
  uploadAll: () => Promise<void>;
  clearCompleted: () => void;
  updateFileProgress: (id: string, progress: number) => void;
  updateFileStatus: (id: string, status: UploadFile['status'], error?: string) => void;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  files: [],
  isUploading: false,

  addFiles: (newFiles: File[]) => {
    const files = newFiles.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      progress: 0,
      status: 'pending' as const
    }));
    set(state => ({ files: [...state.files, ...files] }));
  },

  removeFile: (id: string) => {
    set(state => ({
      files: state.files.filter(f => f.id !== id)
    }));
  },

  uploadFile: async (fileId: string) => {
    const file = get().files.find(f => f.id === fileId);
    if (!file) return;

    const user = useAuthStore.getState().user;
    if (!user) throw new Error('User not authenticated');

    set(state => ({
      files: state.files.map(f =>
        f.id === fileId ? { ...f, status: 'uploading' } : f
      )
    }));

    try {
      const token = await user.getIdToken();
      
      // Get presigned URL
      const presignedResponse = await axios.post(
        '/api/upload/presigned',
        {
          filename: file.file.name,
          mimeType: file.file.type,
          size: file.file.size
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const { uploadUrl, mediaItemId } = presignedResponse.data;

      // Upload to S3
      await axios.put(uploadUrl, file.file, {
        headers: {
          'Content-Type': file.file.type
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            get().updateFileProgress(fileId, progress);
          }
        }
      });

      // Mark upload complete
      set(state => ({
        files: state.files.map(f =>
          f.id === fileId 
            ? { ...f, status: 'processing', mediaItemId, progress: 100 } 
            : f
        )
      }));

      // Notify backend of completion
      await axios.post(
        '/api/upload/complete',
        { mediaItemId },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      set(state => ({
        files: state.files.map(f =>
          f.id === fileId ? { ...f, status: 'completed' } : f
        )
      }));
    } catch (error: any) {
      set(state => ({
        files: state.files.map(f =>
          f.id === fileId 
            ? { ...f, status: 'error', error: error.message } 
            : f
        )
      }));
      throw error;
    }
  },

  uploadAll: async () => {
    set({ isUploading: true });
    const pendingFiles = get().files.filter(f => f.status === 'pending');
    
    try {
      await Promise.all(
        pendingFiles.map(file => get().uploadFile(file.id))
      );
    } finally {
      set({ isUploading: false });
    }
  },

  clearCompleted: () => {
    set(state => ({
      files: state.files.filter(f => f.status !== 'completed')
    }));
  },

  updateFileProgress: (id: string, progress: number) => {
    set(state => ({
      files: state.files.map(f =>
        f.id === id ? { ...f, progress } : f
      )
    }));
  },

  updateFileStatus: (id: string, status: UploadFile['status'], error?: string) => {
    set(state => ({
      files: state.files.map(f =>
        f.id === id ? { ...f, status, error } : f
      )
    }));
  }
}));
```

### 1.4 Create Media Store
Create `src/stores/mediaStore.ts`:

```typescript
import { create } from 'zustand';
import axios from 'axios';
import { useAuthStore } from './authStore';

interface MediaItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  s3Key: string;
  status: string;
  metadata: any;
  embedding: any;
  createdAt: string;
  updatedAt: string;
}

interface MediaState {
  items: MediaItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  page: number;
  filters: {
    status?: string;
    mimeType?: string;
    search?: string;
  };
  
  // Actions
  fetchMedia: (reset?: boolean) => Promise<void>;
  deleteMedia: (id: string) => Promise<void>;
  updateMedia: (id: string, updates: any) => Promise<void>;
  setFilters: (filters: MediaState['filters']) => void;
  reset: () => void;
}

export const useMediaStore = create<MediaState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  hasMore: true,
  page: 1,
  filters: {},

  fetchMedia: async (reset = false) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const state = get();
    if (state.loading || (!state.hasMore && !reset)) return;

    set({ loading: true, error: null });

    try {
      const token = await user.getIdToken();
      const page = reset ? 1 : state.page;
      
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...state.filters
      });

      const response = await axios.get(`/api/media?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const { items, pagination } = response.data;

      set({
        items: reset ? items : [...state.items, ...items],
        page: page + 1,
        hasMore: pagination.hasNext,
        loading: false
      });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  deleteMedia: async (id: string) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    try {
      const token = await user.getIdToken();
      await axios.delete(`/api/media/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      set(state => ({
        items: state.items.filter(item => item.id !== id)
      }));
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  updateMedia: async (id: string, updates: any) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    try {
      const token = await user.getIdToken();
      await axios.patch(`/api/media/${id}`, updates, {
        headers: { Authorization: `Bearer ${token}` }
      });

      set(state => ({
        items: state.items.map(item =>
          item.id === id ? { ...item, ...updates } : item
        )
      }));
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  setFilters: (filters) => {
    set({ filters, page: 1, items: [], hasMore: true });
    get().fetchMedia(true);
  },

  reset: () => {
    set({
      items: [],
      loading: false,
      error: null,
      hasMore: true,
      page: 1,
      filters: {}
    });
  }
}));
```

### 1.5 Create Search Store
Create `src/stores/searchStore.ts`:

```typescript
import { create } from 'zustand';
import axios from 'axios';
import { useAuthStore } from './authStore';

interface SearchResult {
  id: string;
  score: number;
  mediaItem: {
    id: string;
    filename: string;
    mimeType: string;
    s3Key: string;
    metadata: any;
    createdAt: string;
  };
  highlights?: string[];
  explanation?: string;
}

interface SearchState {
  query: string;
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  suggestions: string[];
  recentSearches: Array<{ query: string; resultsCount: number }>;
  filters: {
    mediaType?: string[];
    dateRange?: { start: Date; end: Date };
    minScore?: number;
  };
  
  // Actions
  search: (query: string) => Promise<void>;
  fetchSuggestions: (query: string) => Promise<void>;
  setFilters: (filters: SearchState['filters']) => void;
  clearResults: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  results: [],
  loading: false,
  error: null,
  suggestions: [],
  recentSearches: [],
  filters: {},

  search: async (query: string) => {
    const user = useAuthStore.getState().user;
    if (!user || !query.trim()) return;

    set({ loading: true, error: null, query });

    try {
      const token = await user.getIdToken();
      const response = await axios.post(
        '/api/search',
        {
          query,
          filters: get().filters,
          limit: 20
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      set({
        results: response.data.results,
        loading: false
      });

      // Fetch search history
      const historyResponse = await axios.get('/api/search', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      set({ recentSearches: historyResponse.data.history });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  fetchSuggestions: async (query: string) => {
    if (!query || query.length < 2) {
      set({ suggestions: [] });
      return;
    }

    const user = useAuthStore.getState().user;
    if (!user) return;

    try {
      const token = await user.getIdToken();
      const response = await axios.get(`/api/search/suggestions?query=${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      set({ suggestions: response.data.suggestions });
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
    }
  },

  setFilters: (filters) => {
    set({ filters });
    const currentQuery = get().query;
    if (currentQuery) {
      get().search(currentQuery);
    }
  },

  clearResults: () => {
    set({ results: [], query: '', suggestions: [] });
  }
}));
```

---

## Step 2: Create Upload Components

### 2.1 Create File Upload Dropzone
Create `src/components/upload/FileUploadDropzone.tsx`:

```typescript
'use client';

import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { CloudArrowUpIcon } from '@heroicons/react/24/outline';
import { useUploadStore } from '@/stores/uploadStore';
import { motion } from 'framer-motion';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
const ACCEPTED_TYPES = {
  'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  'video/*': ['.mp4', '.mov', '.avi', '.mkv'],
  'audio/*': ['.mp3', '.wav', '.m4a'],
  'application/pdf': ['.pdf'],
  'text/*': ['.txt', '.md', '.csv']
};

export function FileUploadDropzone() {
  const addFiles = useUploadStore(state => state.addFiles);
  const uploadAll = useUploadStore(state => state.uploadAll);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const validFiles = acceptedFiles.filter(file => file.size <= MAX_FILE_SIZE);
    
    if (validFiles.length < acceptedFiles.length) {
      alert('Some files were too large and were not added (max 5GB)');
    }

    if (validFiles.length > 0) {
      addFiles(validFiles);
      uploadAll();
    }
  }, [addFiles, uploadAll]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: true
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div
        {...getRootProps()}
        className={`
          relative overflow-hidden rounded-lg border-2 border-dashed p-12
          transition-all duration-200 cursor-pointer
          ${isDragActive 
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
            : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
          }
        `}
      >
        <input {...getInputProps()} />
        
        <div className="text-center">
          <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
          
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {isDragActive
              ? 'Drop the files here...'
              : 'Drag & drop files here, or click to select'
            }
          </p>
          
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            Images, videos, audio, PDFs, and text files up to 5GB
          </p>
        </div>

        {/* Animated background effect */}
        {isDragActive && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute inset-0 bg-blue-500/10 pointer-events-none"
          />
        )}
      </div>
    </motion.div>
  );
}
```

### 2.2 Create Upload Queue
Create `src/components/upload/UploadQueue.tsx`:

```typescript
'use client';

import React from 'react';
import { useUploadStore } from '@/stores/uploadStore';
import { UploadProgress } from './UploadProgress';
import { XMarkIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

export function UploadQueue() {
  const files = useUploadStore(state => state.files);
  const removeFile = useUploadStore(state => state.removeFile);
  const clearCompleted = useUploadStore(state => state.clearCompleted);

  if (files.length === 0) return null;

  const completedCount = files.filter(f => f.status === 'completed').length;

  return (
    <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Upload Queue ({files.length} files)
          </h3>
          
          {completedCount > 0 && (
            <button
              onClick={clearCompleted}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              Clear completed
            </button>
          )}
        </div>
      </div>

      <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
        <AnimatePresence>
          {files.map(file => (
            <motion.div
              key={file.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4"
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  {file.status === 'completed' ? (
                    <CheckCircleIcon className="h-5 w-5 text-green-500" />
                  ) : file.status === 'error' ? (
                    <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
                  ) : (
                    <div className="h-5 w-5 rounded-full bg-gray-200 dark:bg-gray-700" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {file.file.name}
                  </p>
                  
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatFileSize(file.file.size)} • {file.file.type}
                  </p>

                  {file.status === 'uploading' && (
                    <UploadProgress progress={file.progress} className="mt-2" />
                  )}

                  {file.status === 'processing' && (
                    <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                      Processing...
                    </p>
                  )}

                  {file.error && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {file.error}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => removeFile(file.id)}
                  className="flex-shrink-0 text-gray-400 hover:text-gray-500"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
```

### 2.3 Create Upload Progress Component
Create `src/components/upload/UploadProgress.tsx`:

```typescript
'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface UploadProgressProps {
  progress: number;
  className?: string;
}

export function UploadProgress({ progress, className = '' }: UploadProgressProps) {
  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
        <span>Uploading...</span>
        <span>{progress}%</span>
      </div>
      
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="bg-blue-600 h-full rounded-full"
        />
      </div>
    </div>
  );
}
```

---

## Step 3: Create Media Components

### 3.1 Create Media Grid
Create `src/components/media/MediaGrid.tsx`:

```typescript
'use client';

import React, { useEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import { useMediaStore } from '@/stores/mediaStore';
import { MediaCard } from './MediaCard';
import { motion } from 'framer-motion';

export function MediaGrid() {
  const { items, loading, hasMore, fetchMedia } = useMediaStore();
  const { ref, inView } = useInView({
    threshold: 0.5,
    triggerOnce: false
  });

  useEffect(() => {
    if (inView && hasMore && !loading) {
      fetchMedia();
    }
  }, [inView, hasMore, loading, fetchMedia]);

  useEffect(() => {
    fetchMedia(true);
  }, []);

  if (loading && items.length === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="bg-gray-200 dark:bg-gray-700 rounded-lg aspect-square" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">No media items found</p>
      </div>
    );
  }

  return (
    <>
      <motion.div 
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {items.map((item, index) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <MediaCard item={item} />
          </motion.div>
        ))}
      </motion.div>

      {hasMore && (
        <div ref={ref} className="py-4 text-center">
          {loading ? (
            <div className="inline-flex items-center space-x-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
              <span className="text-sm text-gray-500">Loading more...</span>
            </div>
          ) : (
            <span className="text-sm text-gray-400">Scroll for more</span>
          )}
        </div>
      )}
    </>
  );
}
```

### 3.2 Create Media Card
Create `src/components/media/MediaCard.tsx`:

```typescript
'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { 
  DocumentIcon, 
  FilmIcon, 
  MusicalNoteIcon,
  TrashIcon,
  EyeIcon,
  TagIcon
} from '@heroicons/react/24/outline';
import { useMediaStore } from '@/stores/mediaStore';
import { MediaDetail } from './MediaDetail';
import { motion } from 'framer-motion';

interface MediaCardProps {
  item: any;
}

export function MediaCard({ item }: MediaCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const deleteMedia = useMediaStore(state => state.deleteMedia);

  const getIcon = () => {
    if (item.mimeType.startsWith('image/')) return null;
    if (item.mimeType.startsWith('video/')) return FilmIcon;
    if (item.mimeType.startsWith('audio/')) return MusicalNoteIcon;
    return DocumentIcon;
  };

  const Icon = getIcon();

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this file?')) {
      await deleteMedia(item.id);
    }
  };

  return (
    <>
      <motion.div
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="relative group cursor-pointer"
        onClick={() => setShowDetail(true)}
      >
        <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
          {item.mimeType.startsWith('image/') ? (
            <div className="relative w-full h-full">
              <Image
                src={`/api/media/${item.id}/thumbnail`}
                alt={item.filename}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              {Icon && <Icon className="h-16 w-16 text-gray-400" />}
            </div>
          )}

          {/* Overlay on hover */}
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all duration-200 flex items-end p-4">
            <div className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <p className="text-sm font-medium truncate">{item.filename}</p>
              <p className="text-xs opacity-75">{formatDate(item.createdAt)}</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="absolute top-2 right-2 flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDetail(true);
              }}
              className="p-2 bg-white dark:bg-gray-800 rounded-full shadow-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="View details"
            >
              <EyeIcon className="h-4 w-4 text-gray-700 dark:text-gray-300" />
            </button>
            
            <button
              onClick={handleDelete}
              className="p-2 bg-white dark:bg-gray-800 rounded-full shadow-lg hover:bg-red-50 dark:hover:bg-red-900/20"
              aria-label="Delete"
            >
              <TrashIcon className="h-4 w-4 text-red-600 dark:text-red-400" />
            </button>
          </div>

          {/* Status indicator */}
          {item.status !== 'completed' && (
            <div className="absolute top-2 left-2">
              <span className={`
                inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                ${item.status === 'processing' 
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' 
                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                }
              `}>
                {item.status}
              </span>
            </div>
          )}

          {/* Tags */}
          {item.metadata?.tags?.length > 0 && (
            <div className="absolute bottom-2 left-2">
              <div className="flex items-center space-x-1">
                <TagIcon className="h-3 w-3 text-white opacity-75" />
                <span className="text-xs text-white opacity-75">
                  {item.metadata.tags.length}
                </span>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {showDetail && (
        <MediaDetail
          mediaId={item.id}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}
```

### 3.3 Create Media Detail Modal
Create `src/components/media/MediaDetail.tsx`:

```typescript
'use client';

import React, { useEffect, useState } from 'react';
import { Dialog } from '@headlessui/react';
import { XMarkIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '@/stores/authStore';
import axios from 'axios';
import Image from 'next/image';
import { motion } from 'framer-motion';

interface MediaDetailProps {
  mediaId: string;
  onClose: () => void;
}

export function MediaDetail({ mediaId, onClose }: MediaDetailProps) {
  const user = useAuthStore(state => state.user);
  const [media, setMedia] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [relatedItems, setRelatedItems] = useState<any[]>([]);

  useEffect(() => {
    loadMediaDetails();
  }, [mediaId]);

  const loadMediaDetails = async () => {
    if (!user) return;

    try {
      const token = await user.getIdToken();
      
      // Fetch media details
      const mediaResponse = await axios.get(`/api/media/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMedia(mediaResponse.data);

      // Fetch related items
      const relatedResponse = await axios.get(`/api/media/related/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRelatedItems(relatedResponse.data.relatedItems);
      
      setLoading(false);
    } catch (error) {
      console.error('Failed to load media details:', error);
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="w-full max-w-4xl bg-white dark:bg-gray-800 rounded-lg shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-gray-900 dark:text-white">
              {media?.filename || 'Loading...'}
            </Dialog.Title>
            
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
              </div>
            ) : media ? (
              <div className="p-6">
                {/* Preview */}
                <div className="mb-6">
                  {media.mimeType.startsWith('image/') ? (
                    <div className="relative aspect-video rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900">
                      <Image
                        src={media.viewUrl}
                        alt={media.filename}
                        fill
                        className="object-contain"
                      />
                    </div>
                  ) : media.mimeType.startsWith('video/') ? (
                    <video
                      src={media.viewUrl}
                      controls
                      className="w-full rounded-lg"
                    />
                  ) : (
                    <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-8 text-center">
                      <p className="text-gray-500 dark:text-gray-400">
                        Preview not available for this file type
                      </p>
                      <a
                        href={media.viewUrl}
                        download={media.filename}
                        className="mt-4 inline-flex items-center space-x-2 text-blue-600 hover:text-blue-700"
                      >
                        <ArrowDownTrayIcon className="h-5 w-5" />
                        <span>Download</span>
                      </a>
                    </div>
                  )}
                </div>

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                      File Information
                    </h3>
                    <dl className="space-y-2">
                      <div>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">Type</dt>
                        <dd className="text-sm text-gray-900 dark:text-white">{media.mimeType}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">Size</dt>
                        <dd className="text-sm text-gray-900 dark:text-white">
                          {formatFileSize(media.size)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">Created</dt>
                        <dd className="text-sm text-gray-900 dark:text-white">
                          {new Date(media.createdAt).toLocaleString()}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                      AI Analysis
                    </h3>
                    {media.metadata && (
                      <div className="space-y-2">
                        {media.metadata.labels && (
                          <div>
                            <dt className="text-xs text-gray-500 dark:text-gray-400">Labels</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                              {media.metadata.labels.slice(0, 5).join(', ')}
                            </dd>
                          </div>
                        )}
                        {media.metadata.sentiment && (
                          <div>
                            <dt className="text-xs text-gray-500 dark:text-gray-400">Sentiment</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                              {media.metadata.sentiment}
                            </dd>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Related Items */}
                {relatedItems.length > 0 && (
                  <div className="mt-8">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                      Related Items
                    </h3>
                    <div className="grid grid-cols-4 gap-2">
                      {relatedItems.slice(0, 4).map(item => (
                        <motion.div
                          key={item.id}
                          whileHover={{ scale: 1.05 }}
                          className="aspect-square rounded bg-gray-100 dark:bg-gray-700 overflow-hidden cursor-pointer"
                          onClick={() => {
                            // Could navigate to this item
                          }}
                        >
                          {item.mimeType.startsWith('image/') ? (
                            <Image
                              src={`/api/media/${item.id}/thumbnail`}
                              alt={item.filename}
                              width={100}
                              height={100}
                              className="object-cover w-full h-full"
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full">
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {item.mimeType.split('/')[0]}
                              </span>
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cost Breakdown */}
                {media.costs && media.costs.total > 0 && (
                  <div className="mt-8">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                      Processing Costs
                    </h3>
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Total</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          ${media.costs.total.toFixed(4)}
                        </span>
                      </div>
                      {media.costs.breakdown.map((cost: any, i: number) => (
                        <div key={i} className="flex justify-between items-center text-xs">
                          <span className="text-gray-500 dark:text-gray-400">
                            {cost.service} - {cost.operation}
                          </span>
                          <span className="text-gray-700 dark:text-gray-300">
                            ${parseFloat(cost.cost).toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center">
                <p className="text-gray-500 dark:text-gray-400">Failed to load media details</p>
              </div>
            )}
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
```

---

## Step 4: Create Search Components

### 4.1 Create Search Bar
Create `src/components/search/SearchBar.tsx`:

```typescript
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useSearchStore } from '@/stores/searchStore';
import { useDebounce } from '@/hooks/useDebounce';
import { motion, AnimatePresence } from 'framer-motion';

export function SearchBar() {
  const [input, setInput] = useState('');
  const { search, fetchSuggestions, suggestions, loading } = useSearchStore();
  const debouncedInput = useDebounce(input, 300);

  useEffect(() => {
    if (debouncedInput.length >= 2) {
      fetchSuggestions(debouncedInput);
    }
  }, [debouncedInput, fetchSuggestions]);

  const handleSearch = useCallback((query: string) => {
    setInput(query);
    search(query);
  }, [search]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      handleSearch(input);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search your media with natural language..."
          className="w-full px-4 py-3 pl-12 text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <MagnifyingGlassIcon className="absolute left-4 top-3.5 h-5 w-5 text-gray-400" />
        
        {loading && (
          <div className="absolute right-4 top-3.5">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
          </div>
        )}
      </div>

      {/* Suggestions dropdown */}
      <AnimatePresence>
        {suggestions.length > 0 && input.length >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSearch(suggestion)}
                className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 first:rounded-t-lg last:rounded-b-lg"
              >
                <span className="text-sm text-gray-900 dark:text-white">
                  {suggestion}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}
```

### 4.2 Create Search Results
Create `src/components/search/SearchResults.tsx`:

```typescript
'use client';

import React from 'react';
import { useSearchStore } from '@/stores/searchStore';
import { MediaCard } from '@/components/media/MediaCard';
import { motion } from 'framer-motion';

export function SearchResults() {
  const { results, query, loading } = useSearchStore();

  if (!query) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">
          Enter a search query to find your media
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="bg-gray-200 dark:bg-gray-700 rounded-lg aspect-square" />
          </div>
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">
          No results found for "{query}"
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
          Try different keywords or check your filters
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Found {results.length} results for "{query}"
        </p>
      </div>

      <motion.div 
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {results.map((result, index) => (
          <motion.div
            key={result.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <div className="relative">
              <MediaCard item={result.mediaItem} />
              
              {/* Relevance score indicator */}
              <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                {Math.round(result.score * 100)}% match
              </div>

              {/* AI explanation */}
              {result.explanation && (
                <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-900 dark:text-blue-100">
                  {result.explanation}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
```

### 4.3 Create Search History
Create `src/components/search/SearchHistory.tsx`:

```typescript
'use client';

import React from 'react';
import { useSearchStore } from '@/stores/searchStore';
import { ClockIcon } from '@heroicons/react/24/outline';

export function SearchHistory() {
  const { recentSearches, search } = useSearchStore();

  if (recentSearches.length === 0) return null;

  return (
    <div className="mt-8">
      <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center">
        <ClockIcon className="h-4 w-4 mr-2" />
        Recent Searches
      </h3>
      
      <div className="space-y-2">
        {recentSearches.map((item, index) => (
          <button
            key={index}
            onClick={() => search(item.query)}
            className="w-full text-left p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-900 dark:text-white">
                {item.query}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {item.resultsCount} results
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

---

## Step 5: Create Dashboard Components

### 5.1 Create Usage Stats
Create `src/components/dashboard/UsageStats.tsx`:

```typescript
'use client';

import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import axios from 'axios';
import { 
  CircleStackIcon, 
  CpuChipIcon, 
  CurrencyDollarIcon 
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

export function UsageStats() {
  const user = useAuthStore(state => state.user);
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchUsage();
    }
  }, [user]);

  const fetchUsage = async () => {
    try {
      const token = await user!.getIdToken();
      const response = await axios.get('/api/user/usage', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsage(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch usage:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="bg-gray-200 dark:bg-gray-700 rounded-lg h-32" />
          </div>
        ))}
      </div>
    );
  }

  if (!usage) return null;

  const stats = [
    {
      name: 'Storage Used',
      value: formatFileSize(usage.usage.storage.used),
      limit: formatFileSize(usage.usage.storage.limit),
      percentage: usage.usage.storage.percentage,
      icon: CircleStackIcon,
      color: 'blue'
    },
    {
      name: 'API Calls',
      value: usage.usage.apiCalls.total.toLocaleString(),
      limit: usage.usage.apiCalls.limit.toLocaleString(),
      percentage: (usage.usage.apiCalls.total / usage.usage.apiCalls.limit) * 100,
      icon: CpuChipIcon,
      color: 'purple'
    },
    {
      name: 'Monthly Cost',
      value: `$${usage.usage.budget.used.toFixed(2)}`,
      limit: `$${usage.usage.budget.limit.toFixed(2)}`,
      percentage: usage.usage.budget.percentage,
      icon: CurrencyDollarIcon,
      color: 'green'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.name}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center justify-between mb-4">
            <stat.icon className={`h-8 w-8 text-${stat.color}-600 dark:text-${stat.color}-400`} />
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {stat.value}
            </span>
          </div>
          
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            {stat.name}
          </h3>
          
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>of {stat.limit}</span>
              <span>{Math.round(stat.percentage)}%</span>
            </div>
            
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(stat.percentage, 100)}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className={`h-full rounded-full bg-${stat.color}-600`}
                style={{
                  backgroundColor: stat.percentage > 90 ? '#EF4444' : undefined
                }}
              />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
```

### 5.2 Create Cost Breakdown
Create `src/components/dashboard/CostBreakdown.tsx`:

```typescript
'use client';

import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import axios from 'axios';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

export function CostBreakdown() {
  const user = useAuthStore(state => state.user);
  const [costs, setCosts] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'service' | 'daily'>('service');

  useEffect(() => {
    if (user) {
      fetchCosts();
    }
  }, [user, view]);

  const fetchCosts = async () => {
    try {
      const token = await user!.getIdToken();
      const response = await axios.get(`/api/analytics/costs?days=30&groupBy=${view}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCosts(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch costs:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="animate-pulse">
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (!costs) return null;

  const COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444'];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Cost Breakdown
        </h2>
        
        <div className="flex space-x-2">
          <button
            onClick={() => setView('service')}
            className={`px-3 py-1 text-sm rounded ${
              view === 'service'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            By Service
          </button>
          <button
            onClick={() => setView('daily')}
            className={`px-3 py-1 text-sm rounded ${
              view === 'daily'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            Daily Trend
          </button>
        </div>
      </div>

      {view === 'service' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-3">
              Distribution
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={costs.breakdown}
                  dataKey="totalCost"
                  nameKey="service"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ service, percentage }) => `${service} ${percentage.toFixed(1)}%`}
                >
                  {costs.breakdown.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => `$${value.toFixed(4)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-3">
              Details
            </h3>
            <div className="space-y-2">
              {costs.breakdown.map((item: any, index: number) => (
                <div key={item.service} className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {item.service}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    ${item.totalCost.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={costs.trends}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="date" 
              stroke="#9CA3AF"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            />
            <YAxis 
              stroke="#9CA3AF"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => `$${value.toFixed(2)}`}
            />
            <Tooltip 
              formatter={(value: any) => `$${value.toFixed(4)}`}
              labelFormatter={(label) => new Date(label).toLocaleDateString()}
              contentStyle={{
                backgroundColor: '#1F2937',
                border: 'none',
                borderRadius: '0.5rem'
              }}
            />
            <Bar dataKey="cost" fill="#3B82F6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}

      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Total (30 days)
          </span>
          <span className="text-lg font-semibold text-gray-900 dark:text-white">
            ${costs.summary.totalCost.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
```

---

## Step 6: Create Utility Hooks

### 6.1 Create Debounce Hook
Create `src/hooks/useDebounce.ts`:

```typescript
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
```

### 6.2 Create Auth Hook
Create `src/hooks/useAuth.ts`:

```typescript
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';

export function useAuth(requireAuth = true) {
  const router = useRouter();
  const { user, loading } = useAuthStore();

  useEffect(() => {
    if (!loading && requireAuth && !user) {
      router.push('/login');
    }
  }, [user, loading, requireAuth, router]);

  return { user, loading, isAuthenticated: !!user };
}
```

### 6.3 Create Upload Hook
Create `src/hooks/useUpload.ts`:

```typescript
import { useCallback } from 'react';
import { useUploadStore } from '@/stores/uploadStore';

export function useUpload() {
  const {
    files,
    isUploading,
    addFiles,
    removeFile,
    uploadFile,
    uploadAll,
    clearCompleted
  } = useUploadStore();

  const handleDrop = useCallback((acceptedFiles: File[]) => {
    addFiles(acceptedFiles);
    uploadAll();
  }, [addFiles, uploadAll]);

  const handleUpload = useCallback(async (file: File) => {
    const [uploadFile] = addFiles([file]);
    if (uploadFile) {
      await uploadFile(uploadFile.id);
    }
  }, [addFiles, uploadFile]);

  return {
    files,
    isUploading,
    handleDrop,
    handleUpload,
    removeFile,
    clearCompleted,
    uploadProgress: files.filter(f => f.status === 'uploading').length
  };
}
```

---

## Testing

### Test Component Integration
Create `scripts/test-components.js`:

```javascript
// This would be a Cypress or Playwright test in a real app
// For now, we'll create a simple component test setup guide

console.log(`
Component Testing Guide:

1. Install testing dependencies:
   npm install --save-dev @testing-library/react @testing-library/jest-dom jest jest-environment-jsdom

2. Create test files next to components:
   - SearchBar.test.tsx
   - MediaGrid.test.tsx
   - FileUploadDropzone.test.tsx

3. Example test structure:

import { render, screen, fireEvent } from '@testing-library/react';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('renders search input', () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('triggers search on submit', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'test query' } });
    fireEvent.submit(input.closest('form'));
    // Assert search was triggered
  });
});

4. Run tests:
   npm test
`);
```

### Manual Testing Checklist
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search

# 1. Test upload flow
# - Drag and drop files
# - Monitor upload progress
# - Verify processing status

# 2. Test search functionality
# - Enter natural language queries
# - Check suggestions appear
# - Verify results display

# 3. Test media grid
# - Scroll to load more
# - Click to view details
# - Delete items

# 4. Test dashboard
# - Check usage stats update
# - Verify cost charts render
# - Test date range filters

# 5. Test responsive design
# - Mobile viewport
# - Tablet viewport
# - Desktop viewport
```

---

## ✅ Phase 13 Completion Checklist

### Core Implementation
- [ ] **State Management**: Zustand stores for auth, upload, media, search
- [ ] **Upload Components**: Drag & drop, progress tracking, queue management
- [ ] **Media Components**: Grid view, detail modal, infinite scroll
- [ ] **Search Components**: Natural language input, suggestions, results
- [ ] **Dashboard Components**: Usage stats, cost visualization, analytics
- [ ] **Utility Hooks**: Auth, upload, debounce, infinite scroll

### Testing & Verification
```bash
# All these should work:
npm run dev
# Visit http://localhost:3000
# Test all user flows
# Check responsive design
# Verify accessibility with keyboard navigation
```

### UI/UX Features
- [ ] Loading states for all async operations
- [ ] Error handling with user-friendly messages
- [ ] Responsive design for all screen sizes
- [ ] Dark mode support
- [ ] Smooth animations with Framer Motion
- [ ] Accessibility features (ARIA labels, keyboard nav)

---

## 🚀 Next Steps

**Phase 13 Complete!** ✅

**AI Media Search Application Complete!**

The application now has:
✅ Complete authentication flow
✅ Drag & drop file uploads with progress
✅ AI-powered natural language search
✅ Media management with infinite scroll
✅ Real-time usage and cost tracking
✅ Responsive, accessible UI components
✅ Dark mode support
✅ Comprehensive state management

**Deployment Considerations:**
- Set up CI/CD pipeline
- Configure production environment variables
- Optimize bundle size
- Add monitoring and error tracking
- Implement CDN for media delivery
- Add real-time notifications
- Consider PWA features