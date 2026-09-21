# Amrutam Telemedicine Backend

[![CI Pipeline](https://github.com/amrutam/telemedicine-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/amrutam/telemedicine-backend/actions)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![Prisma ORM](https://img.shields.io/badge/Prisma-6.4.1-informational.svg)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-7-red.svg)](https://redis.io/)

A production-grade, high-concurrency backend for the **Amrutam Telemedicine Platform**, facilitating seamless patient consultations with verified Ayurvedic practitioners. Designed for **100,000+ daily consultations**, targeting **p95 latency below 200ms for reads and 500ms for writes**, with concurrency-safe booking, AES-256-GCM encrypted sensitive medical data, write idempotency, and full observability.

---

## Architecture Summary

```
                       [ Load Balancer / API Gateway ]
                                      â”‚
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â–¼                                               â–¼
      [ Express API Pod 1 ]                           [ Express API Pod 2 ]
      (Stateless / TS / Zod)                          (Stateless / TS / Zod)
              â”‚                                               â”‚
      â”Œâ”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”
      â–¼                               â–¼                               â–¼
[ Redis 7 Cluster ]        [ PostgreSQL 16 Primary ]        [ Async Job Worker ]
- Cache-Aside (Doctors)    - Row-Level Locking (Slots)      - Event Notification
- Rate Limiting            - AES-256-GCM PHI at Rest        - Exponential Backoff
- Session Cache            - Write Idempotency Records      - Prometheus Metrics
```

---

## Tech Stack & Core Libraries

- **Runtime & Language**: Node.js 22 LTS, TypeScript 5.7
- **Web Framework**: Express 4.21 with Helmet, CORS, and Express-Rate-Limit
- **Database & ORM**: PostgreSQL 16 with Prisma ORM 6.4.1
- **Caching & Locks**: Redis 7 via `ioredis` (with in-memory fallback for local dev)
- **Security & Crypto**: AES-256-GCM for PHI, Bcrypt (cost 12) for passwords, TOTP (RFC 6238) via `otplib`, HMAC-SHA256 JWTs
- **Validation**: Strict schema validation with Zod
- **Documentation**: OpenAPI 3.0.3 specification with Swagger UI
- **Observability**: Prometheus metrics (`prom-client`), Winston structured logging, W3C `traceparent` tracing

---

## Repository Structure

```
â”œâ”€â”€ .github/workflows/ci.yml       # GitHub Actions CI/CD Pipeline
â”œâ”€â”€ docs/                          # Technical Documentation & Diagrams
â”‚   â”œâ”€â”€ ARCHITECTURE.md            # System Architecture, LATENCY & SLAs
â”‚   â”œâ”€â”€ ER_DIAGRAM.md              # Mermaid Entity Relationship Diagram
â”‚   â”œâ”€â”€ SECURITY_AND_THREAT_MODEL.md # OWASP Checklist & STRIDE Threat Model
â”‚   â”œâ”€â”€ SCALABILITY_AND_DR.md      # Capacity Math, Partitioning & Disaster Recovery
â”‚   â”œâ”€â”€ RETRY_AND_BACKOFF.md       # Exponential Backoff with Jitter
â”‚   â””â”€â”€ openapi.yaml               # OpenAPI 3.0.3 Specification
â”œâ”€â”€ prisma/
â”‚   â”œâ”€â”€ schema.prisma              # Complete Relational Domain Schema
â”‚   â”œâ”€â”€ seed.ts                    # Idempotent Database Seeder
â”‚   â””â”€â”€ migrations/                # Database Migration History
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ config/                    # Environment & Database Configuration
â”‚   â”œâ”€â”€ middleware/                # Auth, RBAC, Idempotency, Rate Limit, Metrics
â”‚   â”œâ”€â”€ modules/                   # Domain Modules (Auth, Doctors, Bookings, Payments, Prescriptions, Admin)
â”‚   â”œâ”€â”€ utils/                     # Encryption, JWT, Caching, Retry, Tracing
â”‚   â”œâ”€â”€ app.ts                     # Express Application Factory
â”‚   â””â”€â”€ server.ts                  # Server Entry Point & Graceful Shutdown
â”œâ”€â”€ tests/
â”‚   â”œâ”€â”€ unit/                      # Fast Isolated Unit Tests
â”‚   â”œâ”€â”€ integration/               # API & Observability Integration Tests
â”‚   â””â”€â”€ concurrency/               # Real PostgreSQL Multi-Client Concurrency Tests
â”œâ”€â”€ docker-compose.yml             # Local Orchestration (API, Postgres, Redis)
â”œâ”€â”€ Dockerfile                     # Multi-Stage Production Alpine Image
â””â”€â”€ README.md
```

---

## Prerequisites

- **Node.js**: v22.x or later
- **npm**: v10.x or later
- **Docker & Docker Compose**: (Recommended for local orchestration)
- **PostgreSQL**: v16+ (if running without Docker)
- **Redis**: v7+ (optional, system falls back to in-memory cache)

---

## Quickstart & Local Setup

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/amrutam/telemedicine-backend.git
cd telemedicine-backend
npm ci
```

### 2. Configure Environment Variables
Copy the example environment configuration:
```bash
cp .env.example .env
```
*(All variables in `.env.example` contain development-safe default values).*

### 3. Launch via Docker Compose (Recommended)
To run the full stack (PostgreSQL 16, Redis 7, and the compiled API):
```bash
docker compose up --build
```
The API will be available at `http://localhost:3000`.

### 4. Running Manually (Without Docker)
Ensure PostgreSQL is running locally on port 5432, then:
```bash
# Generate Prisma client
npm run prisma:generate

# Apply database migrations
npm run prisma:migrate:deploy

# Seed initial development data
npm run prisma:seed

# Start development server with hot-reload
npm run dev
```

---

## Database Migrations & Seeding

- **Generate Client**: `npm run prisma:generate`
- **Deploy Migrations**: `npm run prisma:migrate:deploy`
- **Seed Database**: `npm run prisma:seed`
- **Open Prisma Studio**: `npm run prisma:studio`

### Development & Demo Credentials (Seeded)
The seed script populates the following accounts for testing (Password: `Password123!` for all):

| Role | Email | Password | Description |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@amrutam.co.in` | `Password123!` | System administrator with full analytics & audit access |
| **Doctor** | `dr.priya@amrutam.co.in` | `Password123!` | Verified Ayurvedic Doctor (Kayachikitsa) with active slots |
| **Doctor** | `dr.ananya@amrutam.co.in` | `Password123!` | Verified Ayurvedic Doctor (Panchakarma) with active slots |
| **Patient** | `patient.demo@amrutam.co.in` | `Password123!` | Sample patient account for booking & payments |

---

## Testing & Quality Verification

### Run All Available Tests
```bash
npm test
```

### Run Concurrency & Idempotency Tests
```bash
npm run test:concurrency
```
*(When executed in an environment connected to live PostgreSQL, this spins up 10 concurrent requests simultaneously competing for the same slot to verify atomic locking. If live PostgreSQL is not connected, it cleanly reports BLOCKED status).*

### Build Production Artifact
```bash
npm run build
```

---

## Observability & Documentation Endpoints

- **Interactive Swagger Documentation**: `http://localhost:3000/api/docs`
- **OpenAPI YAML Spec**: `http://localhost:3000/api/docs/openapi.yaml`
- **Application Health Check**: `http://localhost:3000/health`
- **Liveness Probe**: `http://localhost:3000/health/live`
- **Readiness Probe**: `http://localhost:3000/health/ready`
- **Prometheus Telemetry Metrics**: `http://localhost:3000/metrics`

---

## Booking Flow & Idempotency Example

### 1. Patient Reserves Slot (Idempotent POST)
```bash
curl -X POST http://localhost:3000/api/v1/consultations \
  -H "Authorization: Bearer <PATIENT_JWT>" \
  -H "Idempotency-Key: idemp-req-unique-uuid-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "doctorId": "22222222-2222-2222-2222-222222222222",
    "slotId": "44444444-4444-4444-4444-444444444444",
    "chiefComplaint": "Persistent digestive issues and acid reflux for two weeks"
  }'
```
- **Atomically updates slot status** to `LOCKED`.
- **Creates consultation** in `PENDING_PAYMENT` state.
- **Replaying with same key & payload** returns the cached `201` response with `X-Cache-Idempotency: HIT`.

### 2. Patient Checkout & Payment
```bash
curl -X POST http://localhost:3000/api/v1/payments/checkout \
  -H "Authorization: Bearer <PATIENT_JWT>" \
  -H "Idempotency-Key: idemp-pay-unique-uuid-67890" \
  -H "Content-Type: application/json" \
  -d '{
    "consultationId": "<CONSULTATION_ID>",
    "paymentMethod": "UPI"
  }'
```
- **On Payment Success**: Consultation transitions to `CONFIRMED`, slot transitions to `BOOKED`.
- **On Payment Failure (Saga Compensation)**: Consultation transitions to `CANCELLED`, slot is released back to `AVAILABLE`.

---

## Architectural & Security Documentation Index

For in-depth architectural and operational specifications, consult:
1. [System Architecture & SLAs](docs/ARCHITECTURE.md)
2. [Database Entity Relationship Diagram](docs/ER_DIAGRAM.md)
3. [Security Architecture & STRIDE Threat Model](docs/SECURITY_AND_THREAT_MODEL.md)
4. [Scalability, Partitioning & Disaster Recovery Plan](docs/SCALABILITY_AND_DR.md)
5. [Retry Mechanism & Exponential Backoff](docs/RETRY_AND_BACKOFF.md)

