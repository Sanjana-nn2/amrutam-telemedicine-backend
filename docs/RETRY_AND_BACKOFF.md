# Retry Mechanism & Exponential Backoff Architecture

## 1. Overview & Objectives

In a distributed telemedicine system, temporary network partitions, transient database deadlocks, and external payment gateway fluctuations can cause transient request failures. The Amrutam backend implements an enterprise-grade retry utility (`src/utils/retry.ts`) combining **exponential backoff**, **randomized full jitter**, and **strict error classification**.

---

## 2. Exponential Backoff with Jitter

### 2.1 The Mathematical Formulation
When multiple clients encounter an external service hiccup simultaneously, retrying at fixed intervals produces the **thundering herd problem**, where clients bombard the recovering service in synchronized waves.

To mitigate this, Amrutam utilizes exponential backoff with full jitter:

$$T_{\text{backoff}} = \min(M, B \times 2^{\text{attempt}})$$
$$\text{Sleep Time} = \text{random}(0, T_{\text{backoff}})$$

Where:
- $B$ = Base delay (default: $100 \text{ ms}$)
- $M$ = Maximum backoff cap (default: $2000 \text{ ms}$)
- $\text{attempt}$ = Zero-indexed retry iteration count

```typescript
// Core implementation from src/utils/retry.ts:
const exponentialDelay = Math.min(
  maxDelayMs,
  baseDelayMs * Math.pow(2, attempt)
);
const jitteredDelay = Math.round(
  exponentialDelay * (1 - jitterFactor + Math.random() * jitterFactor)
);
```

---

## 3. Error Classification: Transient vs Business Errors

A critical architectural principle is that **only transient, recoverable errors must be retried**. Non-transient business errors must fail fast to avoid unnecessary latency and duplicate side effects.

### 3.1 Retryable Failures
The system retries operations that fail due to:
- **Network Glitches**: `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`.
- **Database Concurrency Contention**:
  - PostgreSQL transaction serialization failures (`40001`).
  - PostgreSQL deadlock detection (`40P01`).
  - Prisma connection pool acquisition timeouts (`P2024`).
- **External Payment Gateway HTTP Responses**: HTTP 429 (Too Many Requests), HTTP 500, HTTP 502, HTTP 503, HTTP 504.

### 3.2 Non-Retryable Business Errors (Fail-Fast)
The system **immediately aborts** without retrying for:
- **Authentication & Authorization**: HTTP 401 Unauthorized, HTTP 403 Forbidden.
- **Validation Errors**: HTTP 400 Bad Request, Zod schema validation failures.
- **Domain State Conflicts**:
  - HTTP 409 Conflict (e.g., slot already taken by another patient).
  - Slot status !== `AVAILABLE`.
- **Business Rejections**:
  - Insufficient patient funds or invalid card number returned by payment gateway.
  - Doctor account unverified or inactive.

---

## 4. Usage Patterns in the Codebase

### 4.1 Payment Gateway Processing
```typescript
import { withRetry } from '../../utils/retry';

const paymentResponse = await withRetry(
  async () => {
    return await externalPaymentGateway.charge({
      amount,
      token,
      idempotencyKey,
    });
  },
  {
    maxAttempts: 3,
    baseDelayMs: 200,
    maxDelayMs: 2000,
    operationName: 'PaymentGatewayCharge',
  }
);
```

### 4.2 Background Job Queue Retries
The asynchronous job worker (`src/utils/asyncJob.ts`) wraps all notification and webhook dispatch jobs in `withRetry`, ensuring downstream notification failures (e.g., Twilio SMS or SendGrid email outages) are automatically reattempted before moving to the dead-letter handling path.
