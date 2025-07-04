# Phase 6: Authentication (Firebase) Implementation

## 🎯 Phase Overview
Implement a complete authentication system using Firebase Auth, including user registration, login, session management, email verification, password reset, and integration with the database for user profiles and subscription management.

## ✅ Prerequisites
- Phase 1-5 completed (Setup through Caching)
- Firebase project created with Authentication enabled
- Firebase Admin SDK service account key
- Understanding of JWT tokens and session management
- Email service configured for verification emails

## 📋 Phase Checklist
- [ ] Firebase project configuration
- [ ] Firebase Admin SDK setup
- [ ] Client-side Firebase integration
- [ ] Authentication middleware
- [ ] User registration flow
- [ ] Email verification system
- [ ] Password reset functionality
- [ ] Session management
- [ ] Protected routes implementation
- [ ] User profile management

---

## Step 1: Firebase Project Setup

### 1.1 Create Firebase Project
```bash
# Go to https://console.firebase.google.com
# 1. Create a new project: "ai-media-search"
# 2. Enable Authentication
# 3. Enable Email/Password provider
# 4. Optional: Enable Google provider
# 5. Get your configuration

# Add to .env.local:
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-auth-domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-storage-bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id

# For Admin SDK (server-side):
# 1. Go to Project Settings > Service Accounts
# 2. Generate new private key
# 3. Save the JSON file securely
# 4. Add to .env.local:
FIREBASE_ADMIN_PROJECT_ID=your-project-id
FIREBASE_ADMIN_CLIENT_EMAIL=your-client-email
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### 1.2 Create Firebase Client Configuration
Create `src/lib/firebase/config.ts`:

```typescript
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { 
  getAuth, 
  Auth,
  connectAuthEmulator,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { logger } from '@/lib/monitoring/logger';

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Validate configuration
function validateConfig(): boolean {
  const required = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
  ];

  for (const key of required) {
    if (!firebaseConfig[key as keyof typeof firebaseConfig]) {
      logger.error(`Missing Firebase config: ${key}`);
      return false;
    }
  }

  return true;
}

// Initialize Firebase
let app: FirebaseApp | undefined;
let auth: Auth | undefined;

try {
  if (!validateConfig()) {
    throw new Error('Invalid Firebase configuration');
  }

  // Initialize app only if not already initialized
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
    logger.info('Firebase app initialized');
  } else {
    app = getApps()[0];
  }

  // Get Auth instance
  auth = getAuth(app);

  // Set persistence to local (survives browser restarts)
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    logger.error('Failed to set auth persistence:', error);
  });

  // Connect to emulator in development
  if (process.env.NODE_ENV === 'development' && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
    logger.info('Connected to Firebase Auth emulator');
  }

} catch (error) {
  logger.error('Failed to initialize Firebase:', error);
}

export { app, auth };

// Export typed auth instance
export function getFirebaseAuth(): Auth {
  if (!auth) {
    throw new Error('Firebase Auth not initialized');
  }
  return auth;
}
```

### 1.3 Create Firebase Admin SDK Setup
Create `src/lib/firebase/admin.ts`:

```typescript
import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { logger } from '@/lib/monitoring/logger';

// Admin SDK configuration
const serviceAccount: ServiceAccount = {
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID!,
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
  privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')!,
};

// Initialize Admin SDK
let adminInitialized = false;

try {
  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
    });
    adminInitialized = true;
    logger.info('Firebase Admin SDK initialized');
  }
} catch (error) {
  logger.error('Failed to initialize Firebase Admin SDK:', error);
}

// Get Admin Auth instance
export const adminAuth = getAuth();

// Verify ID token
export async function verifyIdToken(idToken: string): Promise<any> {
  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    logger.error('Failed to verify ID token:', error);
    throw error;
  }
}

// Create custom token
export async function createCustomToken(uid: string, claims?: object): Promise<string> {
  try {
    const customToken = await adminAuth.createCustomToken(uid, claims);
    return customToken;
  } catch (error) {
    logger.error('Failed to create custom token:', error);
    throw error;
  }
}

// Set custom user claims
export async function setCustomUserClaims(
  uid: string,
  claims: object
): Promise<void> {
  try {
    await adminAuth.setCustomUserClaims(uid, claims);
    logger.info('Custom claims set for user', { uid, claims });
  } catch (error) {
    logger.error('Failed to set custom claims:', error);
    throw error;
  }
}

// Get user by email
export async function getUserByEmail(email: string): Promise<any> {
  try {
    const user = await adminAuth.getUserByEmail(email);
    return user;
  } catch (error) {
    if ((error as any).code === 'auth/user-not-found') {
      return null;
    }
    throw error;
  }
}

// Delete user
export async function deleteUser(uid: string): Promise<void> {
  try {
    await adminAuth.deleteUser(uid);
    logger.info('User deleted from Firebase', { uid });
  } catch (error) {
    logger.error('Failed to delete user:', error);
    throw error;
  }
}

// List users with pagination
export async function listUsers(
  maxResults: number = 100,
  pageToken?: string
): Promise<{ users: any[]; pageToken?: string }> {
  try {
    const listResult = await adminAuth.listUsers(maxResults, pageToken);
    
    return {
      users: listResult.users.map(user => ({
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        disabled: user.disabled,
        createdAt: user.metadata.creationTime,
        lastSignIn: user.metadata.lastSignInTime,
      })),
      pageToken: listResult.pageToken,
    };
  } catch (error) {
    logger.error('Failed to list users:', error);
    throw error;
  }
}

// Revoke refresh tokens
export async function revokeRefreshTokens(uid: string): Promise<void> {
  try {
    await adminAuth.revokeRefreshTokens(uid);
    logger.info('Refresh tokens revoked for user', { uid });
  } catch (error) {
    logger.error('Failed to revoke refresh tokens:', error);
    throw error;
  }
}
```

---

## Step 2: Authentication Service

### 2.1 Create Auth Service
Create `src/lib/firebase/auth.ts`:

```typescript
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  User,
  UserCredential,
} from 'firebase/auth';
import { getFirebaseAuth } from './config';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

export class AuthService {
  private auth = getFirebaseAuth();

  // Register new user
  async register(
    email: string,
    password: string,
    displayName?: string
  ): Promise<AuthResult> {
    const startTime = Date.now();

    try {
      // Create user
      const credential: UserCredential = await createUserWithEmailAndPassword(
        this.auth,
        email,
        password
      );

      const user = credential.user;

      // Update display name if provided
      if (displayName && user) {
        await updateProfile(user, { displayName });
      }

      // Send verification email
      if (user && !user.emailVerified) {
        await this.sendVerificationEmail(user);
      }

      metrics.increment('auth.register.success');
      metrics.histogram('auth.register.duration', Date.now() - startTime);

      logger.info('User registered successfully', {
        uid: user.uid,
        email: user.email,
      });

      return { success: true, user };
    } catch (error: any) {
      metrics.increment('auth.register.failure');
      
      let errorMessage = 'Registration failed';
      
      switch (error.code) {
        case 'auth/email-already-in-use':
          errorMessage = 'Email is already registered';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/weak-password':
          errorMessage = 'Password is too weak';
          break;
        case 'auth/operation-not-allowed':
          errorMessage = 'Email/password accounts are not enabled';
          break;
      }

      logger.error('Registration failed', {
        error: error.code,
        message: error.message,
      });

      return { success: false, error: errorMessage };
    }
  }

  // Sign in user
  async signIn(email: string, password: string): Promise<AuthResult> {
    const startTime = Date.now();

    try {
      const credential: UserCredential = await signInWithEmailAndPassword(
        this.auth,
        email,
        password
      );

      const user = credential.user;

      metrics.increment('auth.signin.success');
      metrics.histogram('auth.signin.duration', Date.now() - startTime);

      logger.info('User signed in successfully', {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
      });

      return { success: true, user };
    } catch (error: any) {
      metrics.increment('auth.signin.failure');
      
      let errorMessage = 'Sign in failed';
      
      switch (error.code) {
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/user-disabled':
          errorMessage = 'Account has been disabled';
          break;
        case 'auth/user-not-found':
          errorMessage = 'Email not found';
          break;
        case 'auth/wrong-password':
          errorMessage = 'Incorrect password';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'Too many failed attempts. Please try again later';
          break;
      }

      logger.warn('Sign in failed', {
        error: error.code,
        email,
      });

      return { success: false, error: errorMessage };
    }
  }

  // Sign out user
  async signOut(): Promise<void> {
    try {
      await signOut(this.auth);
      metrics.increment('auth.signout.success');
      logger.info('User signed out successfully');
    } catch (error) {
      logger.error('Sign out failed:', error);
      throw error;
    }
  }

  // Send password reset email
  async sendPasswordReset(email: string): Promise<AuthResult> {
    try {
      await sendPasswordResetEmail(this.auth, email);
      
      metrics.increment('auth.password_reset.sent');
      logger.info('Password reset email sent', { email });

      return { 
        success: true, 
        error: 'Password reset email sent. Check your inbox.' 
      };
    } catch (error: any) {
      let errorMessage = 'Failed to send password reset email';
      
      switch (error.code) {
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/user-not-found':
          errorMessage = 'No account found with this email';
          break;
      }

      logger.error('Password reset failed', {
        error: error.code,
        email,
      });

      return { success: false, error: errorMessage };
    }
  }

  // Send email verification
  async sendVerificationEmail(user?: User): Promise<AuthResult> {
    try {
      const currentUser = user || this.auth.currentUser;
      
      if (!currentUser) {
        return { success: false, error: 'No user signed in' };
      }

      if (currentUser.emailVerified) {
        return { success: true, error: 'Email already verified' };
      }

      await sendEmailVerification(currentUser);
      
      metrics.increment('auth.verification_email.sent');
      logger.info('Verification email sent', {
        uid: currentUser.uid,
        email: currentUser.email,
      });

      return { 
        success: true, 
        error: 'Verification email sent. Check your inbox.' 
      };
    } catch (error: any) {
      logger.error('Failed to send verification email:', error);
      return { 
        success: false, 
        error: 'Failed to send verification email' 
      };
    }
  }

  // Update user password
  async updatePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<AuthResult> {
    try {
      const user = this.auth.currentUser;
      
      if (!user || !user.email) {
        return { success: false, error: 'No user signed in' };
      }

      // Re-authenticate user
      const credential = EmailAuthProvider.credential(
        user.email,
        currentPassword
      );
      
      await reauthenticateWithCredential(user, credential);
      
      // Update password
      await updatePassword(user, newPassword);
      
      metrics.increment('auth.password_update.success');
      logger.info('Password updated successfully', {
        uid: user.uid,
      });

      return { success: true };
    } catch (error: any) {
      let errorMessage = 'Failed to update password';
      
      switch (error.code) {
        case 'auth/wrong-password':
          errorMessage = 'Current password is incorrect';
          break;
        case 'auth/weak-password':
          errorMessage = 'New password is too weak';
          break;
      }

      logger.error('Password update failed:', error);
      return { success: false, error: errorMessage };
    }
  }

  // Get current user
  getCurrentUser(): User | null {
    return this.auth.currentUser;
  }

  // Get ID token
  async getIdToken(forceRefresh: boolean = false): Promise<string | null> {
    try {
      const user = this.auth.currentUser;
      if (!user) return null;
      
      const token = await user.getIdToken(forceRefresh);
      return token;
    } catch (error) {
      logger.error('Failed to get ID token:', error);
      return null;
    }
  }

  // Monitor auth state
  onAuthStateChange(callback: (user: User | null) => void): () => void {
    return this.auth.onAuthStateChanged(callback);
  }

  // Monitor ID token changes
  onIdTokenChange(callback: (user: User | null) => void): () => void {
    return this.auth.onIdTokenChanged(callback);
  }
}

export const authService = new AuthService();
```

---

## Step 3: React Authentication Components

### 3.1 Create Auth Provider
Create `src/components/auth/AuthProvider.tsx`:

```typescript
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { authService } from '@/lib/firebase/auth';
import { logger } from '@/lib/monitoring/logger';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string, displayName?: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<boolean>;
  sendVerificationEmail: () => Promise<boolean>;
  refreshToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Monitor auth state changes
  useEffect(() => {
    const unsubscribe = authService.onAuthStateChange(async (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);

      if (firebaseUser) {
        logger.debug('Auth state changed - user signed in', {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          emailVerified: firebaseUser.emailVerified,
        });

        // Sync with backend
        try {
          const token = await firebaseUser.getIdToken();
          await syncUserWithBackend(token);
        } catch (error) {
          logger.error('Failed to sync user with backend:', error);
        }
      } else {
        logger.debug('Auth state changed - user signed out');
      }
    });

    return () => unsubscribe();
  }, []);

  // Sync user with backend database
  const syncUserWithBackend = async (idToken: string) => {
    try {
      const response = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to sync user');
      }

      logger.debug('User synced with backend');
    } catch (error) {
      logger.error('User sync failed:', error);
    }
  };

  // Sign in
  const signIn = async (email: string, password: string): Promise<boolean> => {
    setError(null);
    
    const result = await authService.signIn(email, password);
    
    if (!result.success) {
      setError(result.error || 'Sign in failed');
      return false;
    }

    router.push('/dashboard');
    return true;
  };

  // Sign up
  const signUp = async (
    email: string,
    password: string,
    displayName?: string
  ): Promise<boolean> => {
    setError(null);
    
    const result = await authService.register(email, password, displayName);
    
    if (!result.success) {
      setError(result.error || 'Registration failed');
      return false;
    }

    router.push('/auth/verify-email');
    return true;
  };

  // Sign out
  const signOut = async () => {
    try {
      await authService.signOut();
      router.push('/');
    } catch (error) {
      logger.error('Sign out error:', error);
      setError('Failed to sign out');
    }
  };

  // Send password reset
  const sendPasswordReset = async (email: string): Promise<boolean> => {
    const result = await authService.sendPasswordReset(email);
    
    if (!result.success) {
      setError(result.error || 'Failed to send reset email');
      return false;
    }

    return true;
  };

  // Send verification email
  const sendVerificationEmail = async (): Promise<boolean> => {
    const result = await authService.sendVerificationEmail();
    
    if (!result.success) {
      setError(result.error || 'Failed to send verification email');
      return false;
    }

    return true;
  };

  // Refresh token
  const refreshToken = async (): Promise<string | null> => {
    return authService.getIdToken(true);
  };

  const value = {
    user,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    sendVerificationEmail,
    refreshToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading ? children : (
        <div className="flex h-screen items-center justify-center">
          <LoadingSpinner size="large" />
        </div>
      )}
    </AuthContext.Provider>
  );
}
```

### 3.2 Create Login Form Component
Create `src/components/auth/LoginForm.tsx`:

```typescript
'use client';

import React, { useState } from 'react';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { logger } from '@/lib/monitoring/logger';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, error } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      return;
    }

    setLoading(true);

    try {
      const success = await signIn(email, password);
      
      if (success) {
        router.push('/dashboard');
      }
    } catch (error) {
      logger.error('Login form error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <Link
            href="/auth/forgot-password"
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            Forgot your password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
            loading
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500'
          }`}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>

        <div className="text-center">
          <span className="text-sm text-gray-600">
            Don't have an account?{' '}
            <Link href="/auth/signup" className="font-medium text-indigo-600 hover:text-indigo-500">
              Sign up
            </Link>
          </span>
        </div>
      </form>
    </div>
  );
}
```

### 3.3 Create Protected Route Component
Create `src/components/auth/ProtectedRoute.tsx`:

```typescript
'use client';

import { useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireEmailVerification?: boolean;
  requiredTier?: 'free' | 'premium' | 'ultimate';
  fallbackUrl?: string;
}

export function ProtectedRoute({
  children,
  requireEmailVerification = false,
  requiredTier,
  fallbackUrl = '/auth/login',
}: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push(fallbackUrl);
    }

    if (!loading && user && requireEmailVerification && !user.emailVerified) {
      router.push('/auth/verify-email');
    }
  }, [user, loading, router, fallbackUrl, requireEmailVerification]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (requireEmailVerification && !user.emailVerified) {
    return null;
  }

  return <>{children}</>;
}
```

---

## Step 4: Authentication API Routes

### 4.1 Create Auth Sync API
Create `src/app/api/auth/sync/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken } from '@/lib/firebase/admin';
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({
        success: false,
        error: 'Missing authorization header',
      }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await verifyIdToken(idToken);

    // Check if user exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE firebase_uid = $1',
      [decodedToken.uid]
    );

    if (existingUser.rows.length === 0) {
      // Create new user
      await db.query(`
        INSERT INTO users (
          firebase_uid, 
          email, 
          email_verified,
          display_name,
          photo_url,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      `, [
        decodedToken.uid,
        decodedToken.email,
        decodedToken.email_verified || false,
        decodedToken.name || null,
        decodedToken.picture || null,
      ]);

      logger.info('New user created from Firebase', {
        firebaseUid: decodedToken.uid,
        email: decodedToken.email,
      });
    } else {
      // Update existing user
      await db.query(`
        UPDATE users 
        SET 
          email_verified = $1,
          display_name = $2,
          photo_url = $3,
          last_login_at = NOW(),
          updated_at = NOW()
        WHERE firebase_uid = $4
      `, [
        decodedToken.email_verified || false,
        decodedToken.name || null,
        decodedToken.picture || null,
        decodedToken.uid,
      ]);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    logger.error('User sync failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to sync user',
    }, { status: 500 });
  }
}
```

### 4.2 Create Auth Verification API
Create `src/app/api/auth/verify/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken } from '@/lib/firebase/admin';
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      metrics.increment('auth.verify.missing_token');
      return NextResponse.json({
        success: false,
        error: 'Missing or invalid authorization header',
      }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    // Verify token with Firebase
    const decodedToken = await verifyIdToken(idToken);
    
    // Get user from database
    const userResult = await db.query(`
      SELECT 
        id,
        firebase_uid,
        email,
        email_verified,
        subscription_tier,
        subscription_status,
        is_active,
        uploads_this_month,
        searches_this_month,
        storage_used_mb,
        storage_quota_mb
      FROM users 
      WHERE firebase_uid = $1
    `, [decodedToken.uid]);

    if (userResult.rows.length === 0) {
      metrics.increment('auth.verify.user_not_found');
      return NextResponse.json({
        success: false,
        error: 'User not found',
      }, { status: 404 });
    }

    const user = userResult.rows[0];

    // Check if account is active
    if (!user.is_active) {
      metrics.increment('auth.verify.account_inactive');
      return NextResponse.json({
        success: false,
        error: 'Account is inactive',
      }, { status: 403 });
    }

    // Update last activity
    await db.query(
      'UPDATE users SET last_activity_at = NOW() WHERE id = $1',
      [user.id]
    );

    const duration = Date.now() - startTime;
    metrics.histogram('auth.verify.duration', duration);
    metrics.increment('auth.verify.success');

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        firebaseUid: user.firebase_uid,
        email: user.email,
        emailVerified: user.email_verified,
        subscriptionTier: user.subscription_tier,
        subscriptionStatus: user.subscription_status,
        usage: {
          uploadsThisMonth: user.uploads_this_month,
          searchesThisMonth: user.searches_this_month,
          storageUsedMb: user.storage_used_mb,
          storageQuotaMb: user.storage_quota_mb,
        },
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.histogram('auth.verify.duration', duration);
    metrics.increment('auth.verify.error');

    logger.error('Token verification failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Invalid or expired token',
    }, { status: 401 });
  }
}
```

---

## Step 5: User Profile Management

### 5.1 Create Profile Update API
Create `src/app/api/user/profile/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, AuthenticatedRequest } from '@/middleware/auth';
import { validateRequest } from '@/middleware/security';
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';
import Joi from 'joi';

const profileSchema = Joi.object({
  displayName: Joi.string().min(1).max(100).optional(),
  bio: Joi.string().max(500).optional(),
  preferences: Joi.object({
    emailNotifications: Joi.boolean().optional(),
    darkMode: Joi.boolean().optional(),
    language: Joi.string().valid('en', 'es', 'fr', 'de').optional(),
  }).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;

    const userId = (req as AuthenticatedRequest).user!.id;

    const result = await db.query(`
      SELECT 
        id,
        email,
        display_name,
        bio,
        photo_url,
        preferences,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'User not found',
      }, { status: 404 });
    }

    const user = result.rows[0];

    return NextResponse.json({
      success: true,
      profile: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        bio: user.bio,
        photoUrl: user.photo_url,
        preferences: user.preferences || {},
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });

  } catch (error) {
    logger.error('Failed to get user profile:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve profile',
    }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;

    const validationResult = await validateRequest(req, profileSchema);
    if (validationResult) return validationResult;

    const userId = (req as AuthenticatedRequest).user!.id;
    const updates = (req as any).validatedData;

    // Build update query dynamically
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    if (updates.displayName !== undefined) {
      updateFields.push(`display_name = $${paramIndex}`);
      values.push(updates.displayName);
      paramIndex++;
    }

    if (updates.bio !== undefined) {
      updateFields.push(`bio = $${paramIndex}`);
      values.push(updates.bio);
      paramIndex++;
    }

    if (updates.preferences !== undefined) {
      updateFields.push(`preferences = $${paramIndex}`);
      values.push(JSON.stringify(updates.preferences));
      paramIndex++;
    }

    if (updateFields.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No fields to update',
      }, { status: 400 });
    }

    updateFields.push('updated_at = NOW()');
    values.push(userId);

    const query = `
      UPDATE users 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, display_name, bio, preferences, updated_at
    `;

    const result = await db.query(query, values);

    logger.info('User profile updated', {
      userId,
      fields: Object.keys(updates),
    });

    return NextResponse.json({
      success: true,
      profile: result.rows[0],
    });

  } catch (error) {
    logger.error('Failed to update user profile:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to update profile',
    }, { status: 500 });
  }
}
```

### 5.2 Create User Hook
Create `src/hooks/useUser.ts`:

```typescript
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { logger } from '@/lib/monitoring/logger';

interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  bio?: string;
  photoUrl?: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  usage: {
    uploadsThisMonth: number;
    searchesThisMonth: number;
    storageUsedMb: number;
    storageQuotaMb: number;
  };
  preferences: Record<string, any>;
}

export function useUser() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    fetchUserProfile();
  }, [user]);

  const fetchUserProfile = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = await user?.getIdToken();
      if (!token) throw new Error('No auth token');

      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch profile');
      }

      const data = await response.json();
      setProfile(data.profile);

    } catch (err) {
      logger.error('Failed to fetch user profile:', err);
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('No auth token');

      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error('Failed to update profile');
      }

      const data = await response.json();
      setProfile(prev => ({ ...prev!, ...data.profile }));

      return true;
    } catch (err) {
      logger.error('Failed to update profile:', err);
      throw err;
    }
  };

  return {
    profile,
    loading,
    error,
    refetch: fetchUserProfile,
    updateProfile,
  };
}
```

---

## Testing Authentication

### Create Auth Test Script
Create `scripts/test-auth.js`:

```typescript
const { initializeApp } = require('firebase/app');
const { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('firebase/auth');

// Test Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

async function testAuth() {
  console.log('🧪 Testing Firebase authentication...\n');

  try {
    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    console.log('✅ Firebase initialized');

    // Test user credentials
    const testEmail = `test-${Date.now()}@example.com`;
    const testPassword = 'Test123!@#';

    // Test registration
    console.log('\n📝 Testing registration...');
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      testEmail,
      testPassword
    );
    console.log('✅ User registered:', userCredential.user.email);

    // Test sign out
    await auth.signOut();
    console.log('✅ User signed out');

    // Test sign in
    console.log('\n🔐 Testing sign in...');
    const signInResult = await signInWithEmailAndPassword(
      auth,
      testEmail,
      testPassword
    );
    console.log('✅ User signed in:', signInResult.user.email);

    // Get ID token
    const idToken = await signInResult.user.getIdToken();
    console.log('✅ ID token obtained:', idToken.substring(0, 20) + '...');

    // Clean up - delete test user
    await signInResult.user.delete();
    console.log('✅ Test user deleted');

    console.log('\n🎉 Authentication tests completed successfully!');

  } catch (error) {
    console.error('❌ Authentication test failed:', error);
    process.exit(1);
  }
}

// Run tests
testAuth();
```

### Run Tests
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
node scripts/test-auth.js
```

---

## ✅ Phase 6 Completion Checklist

### Firebase Setup
- [ ] **Firebase Project**: Created and configured
- [ ] **Authentication Enabled**: Email/password provider active
- [ ] **Admin SDK**: Service account configured
- [ ] **Environment Variables**: All Firebase keys added
- [ ] **Client SDK**: Firebase initialized in app

### Authentication Service
- [ ] **User Registration**: Email/password signup working
- [ ] **User Login**: Authentication flow complete
- [ ] **Email Verification**: Verification emails sent
- [ ] **Password Reset**: Reset flow implemented
- [ ] **Token Management**: ID tokens handled properly

### React Components
- [ ] **Auth Provider**: Context provider wrapping app
- [ ] **Login Form**: User-friendly login interface
- [ ] **Signup Form**: Registration with validation
- [ ] **Protected Routes**: Route protection working
- [ ] **User Profile**: Profile management UI

### Backend Integration
- [ ] **User Sync**: Firebase users synced to database
- [ ] **Token Verification**: Middleware validates tokens
- [ ] **Profile API**: User profile CRUD operations
- [ ] **Session Management**: User sessions tracked
- [ ] **Security**: Proper error handling and logging

### Testing & Verification
```bash
# All these should succeed:
node scripts/test-auth.js            # Test Firebase auth
npm run dev                          # Start development server
# Test registration flow
# Test login flow
# Test protected routes
```

---

## 🚀 Next Steps

**Phase 6 Complete!** ✅

**Ready for Phase 7**: Cost Management Implementation
- Read: `phases/phase-07-cost-management.md`
- Prerequisites: Authentication working, understanding of service pricing
- Outcome: Real-time cost tracking and budget management

**Quick Reference**:
- Authentication patterns: `implementation/auth-patterns.md`
- Security checklist: `checklists/security-checklist.md`
- Next phase: `phases/phase-07-cost-management.md`

Your application now has a complete authentication system with Firebase!