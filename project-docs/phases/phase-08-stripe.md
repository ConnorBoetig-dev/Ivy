# Phase 8: Payments (Stripe) Implementation

## 🎯 Phase Overview
Implement a complete subscription billing system using Stripe, including product/pricing setup, checkout flow, subscription management, usage-based billing tracking, webhooks for payment events, and customer portal integration.

## ✅ Prerequisites
- Phase 1-7 completed (Setup through Authentication)
- Stripe account created and verified
- Understanding of subscription billing models
- Webhook endpoint accessible (ngrok for local development)
- Basic knowledge of payment processing compliance

## 📋 Phase Checklist
- [ ] Stripe products and pricing configured
- [ ] Stripe SDK integration (server and client)
- [ ] Checkout session creation
- [ ] Subscription management endpoints
- [ ] Webhook event handling
- [ ] Customer portal integration
- [ ] Usage tracking and metered billing
- [ ] Payment method management
- [ ] Invoice and receipt handling
- [ ] Subscription upgrade/downgrade flow

---

## Step 1: Stripe Configuration

### 1.1 Create Stripe Products
```bash
# Go to https://dashboard.stripe.com
# 1. Create Products:
#    - Free Tier (for record keeping)
#    - Premium Tier
#    - Ultimate Tier

# 2. Create Prices for each product:
#    - Free: $0/month
#    - Premium: $9.99/month
#    - Ultimate: $29.99/month

# 3. Get your API keys:
#    - Publishable key (for client)
#    - Secret key (for server)
#    - Webhook signing secret

# Add to .env.local:
STRIPE_SECRET_KEY=sk_test_your-secret-key
STRIPE_PUBLISHABLE_KEY=pk_test_your-publishable-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret

# Product/Price IDs (get from Stripe dashboard)
STRIPE_PRICE_FREE=price_free_monthly
STRIPE_PRICE_PREMIUM=price_premium_monthly
STRIPE_PRICE_ULTIMATE=price_ultimate_monthly
```

### 1.2 Create Stripe Setup Script
Create `scripts/setup-stripe-products.js`:

```javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function setupStripeProducts() {
  console.log('🔧 Setting up Stripe products and prices...\n');

  try {
    // Create products
    const products = [
      {
        name: 'AI Media Search - Free',
        description: 'Basic media search with limited features',
        metadata: {
          tier: 'free',
          uploads_limit: '10',
          searches_limit: '50',
          storage_gb: '5',
        },
      },
      {
        name: 'AI Media Search - Premium',
        description: 'Enhanced media search with AI features',
        metadata: {
          tier: 'premium',
          uploads_limit: '100',
          searches_limit: '500',
          storage_gb: '50',
        },
      },
      {
        name: 'AI Media Search - Ultimate',
        description: 'Unlimited media search with all features',
        metadata: {
          tier: 'ultimate',
          uploads_limit: 'unlimited',
          searches_limit: 'unlimited',
          storage_gb: '500',
        },
      },
    ];

    const createdProducts = [];

    for (const product of products) {
      const existing = await stripe.products.list({
        limit: 100,
      });

      let stripeProduct = existing.data.find(p => p.name === product.name);

      if (!stripeProduct) {
        stripeProduct = await stripe.products.create(product);
        console.log(`✅ Created product: ${product.name}`);
      } else {
        console.log(`✓ Product exists: ${product.name}`);
      }

      createdProducts.push(stripeProduct);
    }

    // Create prices
    const prices = [
      {
        product: createdProducts[0].id,
        unit_amount: 0,
        currency: 'usd',
        recurring: { interval: 'month' },
        nickname: 'Free Monthly',
        metadata: { tier: 'free' },
      },
      {
        product: createdProducts[1].id,
        unit_amount: 999, // $9.99
        currency: 'usd',
        recurring: { interval: 'month' },
        nickname: 'Premium Monthly',
        metadata: { tier: 'premium' },
      },
      {
        product: createdProducts[2].id,
        unit_amount: 2999, // $29.99
        currency: 'usd',
        recurring: { interval: 'month' },
        nickname: 'Ultimate Monthly',
        metadata: { tier: 'ultimate' },
      },
    ];

    const createdPrices = [];

    for (const price of prices) {
      const existing = await stripe.prices.list({
        product: price.product,
        limit: 100,
      });

      let stripePrice = existing.data.find(p => 
        p.unit_amount === price.unit_amount && 
        p.recurring?.interval === price.recurring.interval
      );

      if (!stripePrice) {
        stripePrice = await stripe.prices.create(price);
        console.log(`✅ Created price: ${price.nickname}`);
      } else {
        console.log(`✓ Price exists: ${price.nickname}`);
      }

      createdPrices.push(stripePrice);
    }

    // Output price IDs for environment variables
    console.log('\n📋 Add these to your .env.local:');
    console.log(`STRIPE_PRICE_FREE=${createdPrices[0].id}`);
    console.log(`STRIPE_PRICE_PREMIUM=${createdPrices[1].id}`);
    console.log(`STRIPE_PRICE_ULTIMATE=${createdPrices[2].id}`);

    console.log('\n🎉 Stripe setup completed!');

  } catch (error) {
    console.error('❌ Stripe setup failed:', error);
    process.exit(1);
  }
}

setupStripeProducts();
```

---

## Step 2: Stripe Service Implementation

### 2.1 Create Server-Side Stripe Service
Create `src/lib/stripe/server.ts`:

```typescript
import Stripe from 'stripe';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  typescript: true,
});

// Subscription tier mapping
export const SUBSCRIPTION_TIERS = {
  free: process.env.STRIPE_PRICE_FREE!,
  premium: process.env.STRIPE_PRICE_PREMIUM!,
  ultimate: process.env.STRIPE_PRICE_ULTIMATE!,
};

export class StripeService {
  // Create or get customer
  async createOrGetCustomer(
    userId: string,
    email: string,
    name?: string
  ): Promise<Stripe.Customer> {
    try {
      // Check if customer already exists
      const existingCustomers = await stripe.customers.list({
        email,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        logger.debug('Existing Stripe customer found', {
          customerId: existingCustomers.data[0].id,
          email,
        });
        return existingCustomers.data[0];
      }

      // Create new customer
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          userId,
        },
      });

      logger.info('Stripe customer created', {
        customerId: customer.id,
        userId,
        email,
      });

      metrics.increment('stripe.customer.created');
      return customer;

    } catch (error) {
      logger.error('Failed to create/get Stripe customer:', error);
      throw error;
    }
  }

  // Create checkout session
  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    metadata?: Record<string, string>
  ): Promise<Stripe.Checkout.Session> {
    try {
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        subscription_data: {
          trial_settings: {
            end_behavior: {
              missing_payment_method: 'cancel',
            },
          },
          metadata,
        },
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
        },
      });

      logger.info('Checkout session created', {
        sessionId: session.id,
        customerId,
        priceId,
      });

      metrics.increment('stripe.checkout_session.created');
      return session;

    } catch (error) {
      logger.error('Failed to create checkout session:', error);
      metrics.increment('stripe.checkout_session.error');
      throw error;
    }
  }

  // Create billing portal session
  async createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<Stripe.BillingPortal.Session> {
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      logger.info('Portal session created', {
        sessionId: session.id,
        customerId,
      });

      metrics.increment('stripe.portal_session.created');
      return session;

    } catch (error) {
      logger.error('Failed to create portal session:', error);
      throw error;
    }
  }

  // Get subscription
  async getSubscription(
    subscriptionId: string
  ): Promise<Stripe.Subscription | null> {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      
      if (subscription.status === 'canceled') {
        return null;
      }

      return subscription;
    } catch (error) {
      logger.error('Failed to get subscription:', error);
      return null;
    }
  }

  // Update subscription
  async updateSubscription(
    subscriptionId: string,
    newPriceId: string,
    prorationBehavior: 'create_prorations' | 'none' = 'create_prorations'
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      
      const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
        items: [
          {
            id: subscription.items.data[0].id,
            price: newPriceId,
          },
        ],
        proration_behavior: prorationBehavior,
      });

      logger.info('Subscription updated', {
        subscriptionId,
        newPriceId,
        oldPriceId: subscription.items.data[0].price.id,
      });

      metrics.increment('stripe.subscription.updated');
      return updatedSubscription;

    } catch (error) {
      logger.error('Failed to update subscription:', error);
      throw error;
    }
  }

  // Cancel subscription
  async cancelSubscription(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean = true
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: cancelAtPeriodEnd,
      });

      logger.info('Subscription cancellation scheduled', {
        subscriptionId,
        cancelAtPeriodEnd,
      });

      metrics.increment('stripe.subscription.canceled');
      return subscription;

    } catch (error) {
      logger.error('Failed to cancel subscription:', error);
      throw error;
    }
  }

  // Get customer's subscriptions
  async getCustomerSubscriptions(
    customerId: string
  ): Promise<Stripe.Subscription[]> {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
      });

      return subscriptions.data;
    } catch (error) {
      logger.error('Failed to get customer subscriptions:', error);
      return [];
    }
  }

  // Get payment methods
  async getPaymentMethods(
    customerId: string
  ): Promise<Stripe.PaymentMethod[]> {
    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });

      return paymentMethods.data;
    } catch (error) {
      logger.error('Failed to get payment methods:', error);
      return [];
    }
  }

  // Detach payment method
  async detachPaymentMethod(
    paymentMethodId: string
  ): Promise<Stripe.PaymentMethod> {
    try {
      const paymentMethod = await stripe.paymentMethods.detach(paymentMethodId);
      
      logger.info('Payment method detached', { paymentMethodId });
      return paymentMethod;

    } catch (error) {
      logger.error('Failed to detach payment method:', error);
      throw error;
    }
  }

  // Get invoices
  async getInvoices(
    customerId: string,
    limit: number = 10
  ): Promise<Stripe.Invoice[]> {
    try {
      const invoices = await stripe.invoices.list({
        customer: customerId,
        limit,
      });

      return invoices.data;
    } catch (error) {
      logger.error('Failed to get invoices:', error);
      return [];
    }
  }

  // Get upcoming invoice
  async getUpcomingInvoice(
    customerId: string
  ): Promise<Stripe.Invoice | null> {
    try {
      const invoice = await stripe.invoices.retrieveUpcoming({
        customer: customerId,
      });

      return invoice;
    } catch (error) {
      if ((error as any).code === 'invoice_upcoming_none') {
        return null;
      }
      logger.error('Failed to get upcoming invoice:', error);
      return null;
    }
  }

  // Create usage record for metered billing
  async createUsageRecord(
    subscriptionItemId: string,
    quantity: number,
    action: 'increment' | 'set' = 'increment'
  ): Promise<Stripe.UsageRecord> {
    try {
      const usageRecord = await stripe.subscriptionItems.createUsageRecord(
        subscriptionItemId,
        {
          quantity,
          action,
          timestamp: Math.floor(Date.now() / 1000),
        }
      );

      logger.debug('Usage record created', {
        subscriptionItemId,
        quantity,
        action,
      });

      return usageRecord;

    } catch (error) {
      logger.error('Failed to create usage record:', error);
      throw error;
    }
  }

  // Verify webhook signature
  constructWebhookEvent(
    payload: string | Buffer,
    signature: string
  ): Stripe.Event {
    try {
      return stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (error) {
      logger.error('Invalid webhook signature:', error);
      throw error;
    }
  }

  // Get price tier from price ID
  getPriceTier(priceId: string): string {
    const tierMap = Object.entries(SUBSCRIPTION_TIERS).find(
      ([_, id]) => id === priceId
    );
    return tierMap ? tierMap[0] : 'free';
  }
}

export const stripeService = new StripeService();
```

### 2.2 Create Client-Side Stripe Configuration
Create `src/lib/stripe/client.ts`:

```typescript
import { loadStripe, Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null>;

export const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  }
  return stripePromise;
};

// Helper to redirect to checkout
export async function redirectToCheckout(sessionId: string) {
  const stripe = await getStripe();
  if (!stripe) {
    throw new Error('Stripe not loaded');
  }

  const { error } = await stripe.redirectToCheckout({ sessionId });
  
  if (error) {
    throw error;
  }
}

// Helper to redirect to customer portal
export async function redirectToCustomerPortal(url: string) {
  window.location.href = url;
}
```

---

## Step 3: Payment API Routes

### 3.1 Create Checkout API
Create `src/app/api/billing/checkout/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, AuthenticatedRequest } from '@/middleware/auth';
import { validateRequest } from '@/middleware/security';
import { stripeService, SUBSCRIPTION_TIERS } from '@/lib/stripe/server';
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';
import { schemas } from '@/lib/validation/input-validator';

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;

    const validationResult = await validateRequest(req, schemas.checkout);
    if (validationResult) return validationResult;

    const user = (req as AuthenticatedRequest).user!;
    const { priceId, tier, successUrl, cancelUrl } = (req as any).validatedData;

    // Validate price ID matches tier
    if (SUBSCRIPTION_TIERS[tier as keyof typeof SUBSCRIPTION_TIERS] !== priceId) {
      return NextResponse.json({
        success: false,
        error: 'Invalid price ID for selected tier',
      }, { status: 400 });
    }

    // Don't allow checkout for free tier
    if (tier === 'free') {
      return NextResponse.json({
        success: false,
        error: 'Cannot checkout for free tier',
      }, { status: 400 });
    }

    // Get or create Stripe customer
    const customer = await stripeService.createOrGetCustomer(
      user.id,
      user.email,
      user.displayName
    );

    // Update user with Stripe customer ID
    await db.query(
      'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
      [customer.id, user.id]
    );

    // Check for existing active subscription
    const subscriptions = await stripeService.getCustomerSubscriptions(customer.id);
    const activeSubscription = subscriptions.find(
      sub => sub.status === 'active' || sub.status === 'trialing'
    );

    if (activeSubscription) {
      return NextResponse.json({
        success: false,
        error: 'You already have an active subscription. Please use the billing portal to make changes.',
      }, { status: 400 });
    }

    // Create checkout session
    const session = await stripeService.createCheckoutSession(
      customer.id,
      priceId,
      successUrl,
      cancelUrl,
      {
        userId: user.id,
        tier,
      }
    );

    logger.info('Checkout session created', {
      userId: user.id,
      tier,
      sessionId: session.id,
    });

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });

  } catch (error) {
    logger.error('Checkout session creation failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to create checkout session',
    }, { status: 500 });
  }
}
```

### 3.2 Create Billing Portal API
Create `src/app/api/billing/portal/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, AuthenticatedRequest } from '@/middleware/auth';
import { stripeService } from '@/lib/stripe/server';
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateUser(req);
    if (authResult) return authResult;

    const user = (req as AuthenticatedRequest).user!;
    const { returnUrl } = await req.json();

    // Get user's Stripe customer ID
    const result = await db.query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [user.id]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      return NextResponse.json({
        success: false,
        error: 'No billing account found. Please subscribe first.',
      }, { status: 404 });
    }

    const customerId = result.rows[0].stripe_customer_id;

    // Create portal session
    const session = await stripeService.createPortalSession(
      customerId,
      returnUrl || `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing`
    );

    logger.info('Portal session created', {
      userId: user.id,
      customerId,
    });

    return NextResponse.json({
      success: true,
      url: session.url,
    });

  } catch (error) {
    logger.error('Portal session creation failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to create billing portal session',
    }, { status: 500 });
  }
}
```

### 3.3 Create Webhook Handler
Create `src/app/api/billing/webhook/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { stripeService } from '@/lib/stripe/server';
import { db } from '@/lib/database';
import { logger } from '@/lib/monitoring/logger';
import { metrics } from '@/lib/monitoring/metrics';
import type Stripe from 'stripe';

// Disable body parsing for webhooks
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripeService.constructWebhookEvent(body, signature);
  } catch (error) {
    logger.error('Webhook signature verification failed:', error);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  logger.info('Stripe webhook received', {
    type: event.type,
    id: event.id,
  });

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'customer.updated':
        await handleCustomerUpdated(event.data.object as Stripe.Customer);
        break;

      default:
        logger.debug('Unhandled webhook event type', { type: event.type });
    }

    metrics.increment('stripe.webhook.success', 1, { type: event.type });
    
    return NextResponse.json({ received: true });

  } catch (error) {
    logger.error('Webhook handler error:', {
      error,
      eventType: event.type,
      eventId: event.id,
    });

    metrics.increment('stripe.webhook.error', 1, { type: event.type });
    
    // Return success to avoid retries for handler errors
    return NextResponse.json({ received: true });
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const { customer, subscription, metadata } = session;

  if (!metadata?.userId) {
    logger.error('Checkout session missing userId in metadata', { sessionId: session.id });
    return;
  }

  logger.info('Checkout completed', {
    userId: metadata.userId,
    customerId: customer,
    subscriptionId: subscription,
  });

  // Update user subscription in database
  await db.query(`
    UPDATE users 
    SET 
      stripe_customer_id = $1,
      stripe_subscription_id = $2,
      subscription_tier = $3,
      subscription_status = 'active',
      subscription_current_period_end = NOW() + INTERVAL '1 month',
      updated_at = NOW()
    WHERE id = $4
  `, [customer, subscription, metadata.tier, metadata.userId]);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0].price.id;
  const tier = stripeService.getPriceTier(priceId);

  // Map Stripe status to our status
  const statusMap: Record<string, string> = {
    active: 'active',
    past_due: 'past_due',
    unpaid: 'unpaid',
    canceled: 'canceled',
    incomplete: 'incomplete',
    incomplete_expired: 'expired',
    trialing: 'trialing',
  };

  const status = statusMap[subscription.status] || 'unknown';

  logger.info('Subscription updated', {
    customerId,
    subscriptionId: subscription.id,
    status: subscription.status,
    tier,
  });

  // Update user subscription
  await db.query(`
    UPDATE users 
    SET 
      subscription_tier = $1,
      subscription_status = $2,
      subscription_current_period_end = to_timestamp($3),
      updated_at = NOW()
    WHERE stripe_customer_id = $4
  `, [tier, status, subscription.current_period_end, customerId]);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  logger.info('Subscription deleted', {
    customerId,
    subscriptionId: subscription.id,
  });

  // Downgrade to free tier
  await db.query(`
    UPDATE users 
    SET 
      subscription_tier = 'free',
      subscription_status = 'canceled',
      stripe_subscription_id = NULL,
      subscription_current_period_end = NULL,
      updated_at = NOW()
    WHERE stripe_customer_id = $1
  `, [customerId]);
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  logger.info('Invoice payment succeeded', {
    customerId,
    invoiceId: invoice.id,
    amount: invoice.amount_paid,
  });

  // Record payment in our system
  await db.query(`
    INSERT INTO payment_history (
      user_id,
      stripe_invoice_id,
      amount_cents,
      currency,
      status,
      paid_at
    )
    SELECT 
      id,
      $2,
      $3,
      $4,
      'succeeded',
      to_timestamp($5)
    FROM users
    WHERE stripe_customer_id = $1
  `, [customerId, invoice.id, invoice.amount_paid, invoice.currency, invoice.created]);

  // Reset monthly usage counters if it's a new billing period
  await resetMonthlyUsage(customerId);
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  logger.warn('Invoice payment failed', {
    customerId,
    invoiceId: invoice.id,
    amount: invoice.amount_due,
  });

  // Update subscription status
  await db.query(`
    UPDATE users 
    SET 
      subscription_status = 'past_due',
      updated_at = NOW()
    WHERE stripe_customer_id = $1
  `, [customerId]);

  // Send payment failure notification
  await sendPaymentFailureEmail(customer.email, {
    amount: invoice.amount_due,
    currency: invoice.currency,
    attemptCount: invoice.attempt_count,
    nextPaymentAttempt: invoice.next_payment_attempt
  });
}

async function handleCustomerUpdated(customer: Stripe.Customer) {
  logger.info('Customer updated', {
    customerId: customer.id,
    email: customer.email,
  });

  // Update email if changed
  if (customer.email) {
    await db.query(`
      UPDATE users 
      SET 
        email = $1,
        updated_at = NOW()
      WHERE stripe_customer_id = $2
    `, [customer.email, customer.id]);
  }
}

async function resetMonthlyUsage(customerId: string) {
  const result = await db.query(`
    UPDATE users 
    SET 
      uploads_this_month = 0,
      searches_this_month = 0,
      usage_reset_at = NOW(),
      updated_at = NOW()
    WHERE stripe_customer_id = $1
    RETURNING id
  `, [customerId]);

  if (result.rows.length > 0) {
    logger.info('Monthly usage reset', {
      userId: result.rows[0].id,
      customerId,
    });
  }
}
```

---

## Step 4: Billing Components

### 4.1 Create Pricing Component
Create `src/components/billing/PricingCard.tsx`:

```typescript
'use client';

import React from 'react';
import { CheckIcon } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';

interface PricingTier {
  name: string;
  tier: 'free' | 'premium' | 'ultimate';
  price: number;
  priceId: string;
  features: string[];
  limits: {
    uploads: number | 'unlimited';
    searches: number | 'unlimited';
    storage: number;
  };
  recommended?: boolean;
}

const pricingTiers: PricingTier[] = [
  {
    name: 'Free',
    tier: 'free',
    price: 0,
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_FREE!,
    features: [
      'Basic AI analysis',
      'Standard support',
      'Basic search filters',
    ],
    limits: {
      uploads: 10,
      searches: 50,
      storage: 5,
    },
  },
  {
    name: 'Premium',
    tier: 'premium',
    price: 9.99,
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PREMIUM!,
    features: [
      'Advanced AI analysis',
      'Priority support',
      'Advanced search filters',
      'API access',
      'Export capabilities',
    ],
    limits: {
      uploads: 100,
      searches: 500,
      storage: 50,
    },
    recommended: true,
  },
  {
    name: 'Ultimate',
    tier: 'ultimate',
    price: 29.99,
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ULTIMATE!,
    features: [
      'Full AI capabilities',
      'Premium support',
      'All features included',
      'API access',
      'Priority processing',
      'Custom integrations',
    ],
    limits: {
      uploads: 'unlimited',
      searches: 'unlimited',
      storage: 500,
    },
  },
];

interface PricingCardProps {
  currentTier?: string;
  onSelectPlan?: (tier: PricingTier) => void;
}

export function PricingCard({ currentTier, onSelectPlan }: PricingCardProps) {
  const { user } = useAuth();
  const router = useRouter();

  const handleSelectPlan = async (tier: PricingTier) => {
    if (!user) {
      router.push('/auth/login');
      return;
    }

    if (onSelectPlan) {
      onSelectPlan(tier);
    } else {
      // Default behavior - redirect to checkout
      if (tier.tier === 'free') {
        // Handle downgrade through customer portal
        router.push('/dashboard/billing');
      } else {
        // Redirect to checkout
        const response = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await user.getIdToken()}`,
          },
          body: JSON.stringify({
            priceId: tier.priceId,
            tier: tier.tier,
            successUrl: `${window.location.origin}/dashboard/billing?success=true`,
            cancelUrl: `${window.location.origin}/dashboard/billing?canceled=true`,
          }),
        });

        const data = await response.json();
        
        if (data.success && data.url) {
          window.location.href = data.url;
        }
      }
    }
  };

  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {pricingTiers.map((tier) => (
        <div
          key={tier.tier}
          className={`relative rounded-2xl ${
            tier.recommended
              ? 'border-2 border-indigo-600 shadow-xl'
              : 'border border-gray-200'
          } p-8 shadow-sm`}
        >
          {tier.recommended && (
            <div className="absolute -top-5 left-0 right-0 mx-auto w-32 rounded-full bg-indigo-600 px-3 py-2 text-center text-sm font-medium text-white">
              Recommended
            </div>
          )}

          <div className="text-center">
            <h3 className="text-2xl font-semibold text-gray-900">{tier.name}</h3>
            <div className="mt-4">
              <span className="text-4xl font-bold text-gray-900">${tier.price}</span>
              <span className="text-base font-medium text-gray-500">/month</span>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="text-center text-sm text-gray-600">
              <p>{tier.limits.uploads === 'unlimited' ? 'Unlimited' : tier.limits.uploads} uploads/month</p>
              <p>{tier.limits.searches === 'unlimited' ? 'Unlimited' : tier.limits.searches} searches/month</p>
              <p>{tier.limits.storage}GB storage</p>
            </div>
          </div>

          <ul className="mt-8 space-y-3">
            {tier.features.map((feature) => (
              <li key={feature} className="flex items-start">
                <CheckIcon className="h-5 w-5 flex-shrink-0 text-green-500" />
                <span className="ml-3 text-sm text-gray-700">{feature}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={() => handleSelectPlan(tier)}
            disabled={currentTier === tier.tier}
            className={`mt-8 w-full rounded-lg px-4 py-2 text-center text-sm font-semibold ${
              currentTier === tier.tier
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : tier.recommended
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-900 text-white hover:bg-gray-800'
            } transition-colors`}
          >
            {currentTier === tier.tier
              ? 'Current Plan'
              : currentTier && tier.price < pricingTiers.find(t => t.tier === currentTier)?.price!
              ? 'Downgrade'
              : 'Upgrade'}
          </button>
        </div>
      ))}
    </div>
  );
}
```

### 4.2 Create Usage Tracking Hook
Create `src/hooks/useSubscription.ts`:

```typescript
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { logger } from '@/lib/monitoring/logger';

interface SubscriptionData {
  tier: 'free' | 'premium' | 'ultimate';
  status: string;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  usage: {
    uploads: { current: number; limit: number | 'unlimited' };
    searches: { current: number; limit: number | 'unlimited' };
    storage: { current: number; limit: number };
  };
  canUpload: boolean;
  canSearch: boolean;
}

export function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    fetchSubscription();
  }, [user]);

  const fetchSubscription = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = await user?.getIdToken();
      if (!token) throw new Error('No auth token');

      const response = await fetch('/api/billing/subscription', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch subscription');
      }

      const data = await response.json();
      
      const sub: SubscriptionData = {
        tier: data.tier,
        status: data.status,
        currentPeriodEnd: data.currentPeriodEnd ? new Date(data.currentPeriodEnd) : undefined,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        usage: data.usage,
        canUpload: data.usage.uploads.current < data.usage.uploads.limit || data.usage.uploads.limit === 'unlimited',
        canSearch: data.usage.searches.current < data.usage.searches.limit || data.usage.searches.limit === 'unlimited',
      };

      setSubscription(sub);

    } catch (err) {
      logger.error('Failed to fetch subscription:', err);
      setError('Failed to load subscription');
    } finally {
      setLoading(false);
    }
  };

  const createCheckoutSession = async (
    tier: 'premium' | 'ultimate'
  ): Promise<{ sessionId?: string; url?: string; error?: string }> => {
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('No auth token');

      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tier,
          priceId: tier === 'premium' 
            ? process.env.NEXT_PUBLIC_STRIPE_PRICE_PREMIUM 
            : process.env.NEXT_PUBLIC_STRIPE_PRICE_ULTIMATE,
          successUrl: `${window.location.origin}/dashboard/billing?success=true`,
          cancelUrl: `${window.location.origin}/dashboard/billing?canceled=true`,
        }),
      });

      const data = await response.json();
      
      if (!data.success) {
        return { error: data.error };
      }

      return { sessionId: data.sessionId, url: data.url };

    } catch (err) {
      logger.error('Failed to create checkout session:', err);
      return { error: 'Failed to create checkout session' };
    }
  };

  const createPortalSession = async (): Promise<{ url?: string; error?: string }> => {
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('No auth token');

      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          returnUrl: window.location.href,
        }),
      });

      const data = await response.json();
      
      if (!data.success) {
        return { error: data.error };
      }

      return { url: data.url };

    } catch (err) {
      logger.error('Failed to create portal session:', err);
      return { error: 'Failed to open billing portal' };
    }
  };

  return {
    subscription,
    loading,
    error,
    refetch: fetchSubscription,
    createCheckoutSession,
    createPortalSession,
  };
}
```

---

## Testing and Verification

### Create Stripe Test Script
Create `scripts/test-stripe.js`:

```javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function testStripe() {
  console.log('🧪 Testing Stripe integration...\n');

  try {
    // Test connection
    console.log('📊 Testing Stripe connection...');
    const balance = await stripe.balance.retrieve();
    console.log('✅ Connected to Stripe');
    console.log(`   Available balance: ${balance.available[0]?.amount || 0} ${balance.available[0]?.currency || 'usd'}`);

    // List products
    console.log('\n📦 Listing products...');
    const products = await stripe.products.list({ limit: 10 });
    console.log(`✅ Found ${products.data.length} products:`);
    products.data.forEach(product => {
      console.log(`   - ${product.name} (${product.id})`);
    });

    // List prices
    console.log('\n💰 Listing prices...');
    const prices = await stripe.prices.list({ limit: 10 });
    console.log(`✅ Found ${prices.data.length} prices:`);
    prices.data.forEach(price => {
      const amount = price.unit_amount ? `$${price.unit_amount / 100}` : 'custom';
      console.log(`   - ${price.nickname || price.id}: ${amount} ${price.currency}`);
    });

    // Test customer creation
    console.log('\n👤 Testing customer creation...');
    const testCustomer = await stripe.customers.create({
      email: `test-${Date.now()}@example.com`,
      name: 'Test User',
      metadata: {
        userId: 'test-user-123',
      },
    });
    console.log('✅ Customer created:', testCustomer.id);

    // Clean up
    await stripe.customers.del(testCustomer.id);
    console.log('✅ Test customer deleted');

    console.log('\n🎉 Stripe tests completed successfully!');

  } catch (error) {
    console.error('❌ Stripe test failed:', error);
    process.exit(1);
  }
}

// Run tests
testStripe();
```

### Test Webhook Locally
```bash
# Install Stripe CLI
curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg
echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee -a /etc/apt/sources.list.d/stripe.list
sudo apt update
sudo apt install stripe

# Login to Stripe
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/billing/webhook

# In another terminal, trigger test events
stripe trigger payment_intent.succeeded
```

---

## ✅ Phase 8 Completion Checklist

### Stripe Configuration
- [ ] **Stripe Account**: Created and verified
- [ ] **Products Created**: Free, Premium, Ultimate tiers
- [ ] **Prices Set**: Monthly subscription prices
- [ ] **Webhook Endpoint**: Configured in Stripe dashboard
- [ ] **Environment Variables**: All Stripe keys added

### Backend Implementation
- [ ] **Stripe Service**: Complete service with all methods
- [ ] **Checkout API**: Session creation working
- [ ] **Portal API**: Customer portal access
- [ ] **Webhook Handler**: All events handled properly
- [ ] **Database Updates**: Subscription data synced

### Frontend Components
- [ ] **Pricing Display**: Tier comparison cards
- [ ] **Checkout Flow**: Redirect to Stripe checkout
- [ ] **Billing Portal**: Access to Stripe portal
- [ ] **Usage Display**: Current usage vs limits
- [ ] **Upgrade Prompts**: When limits reached

### Testing & Verification
```bash
# All these should succeed:
node scripts/setup-stripe-products.js  # Setup products
node scripts/test-stripe.js           # Test Stripe connection
npm run dev                          # Start development server
stripe listen --forward-to localhost:3000/api/billing/webhook
# Test subscription flow
# Test portal access
# Test webhook events
```

---

## 🚀 Next Steps

**Phase 8 Complete!** ✅

**Ready for Phase 9**: AWS Services Integration
- Read: `02-phases/phase-09-aws-services.md`
- Prerequisites: AWS account, Stripe billing working
- Outcome: Complete AWS AI service integration

**Quick Reference**:
- Stripe dashboard: https://dashboard.stripe.com
- Webhook testing: Use Stripe CLI
- Next phase: `02-phases/phase-09-aws-services.md`

Your application now has a complete subscription billing system with Stripe!
