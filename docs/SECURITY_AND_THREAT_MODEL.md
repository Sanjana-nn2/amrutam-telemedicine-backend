# Amrutam Telemedicine Security Architecture & STRIDE Threat Model

## 1. Security Overview

Amrutam Telemedicine processes protected health information (PHI), confidential patient identities, doctor credentials, and financial transactions. This document details the security safeguards implemented across the system, adhering to OWASP Top 10 principles and a comprehensive STRIDE threat model.

> **Disclaimer**: This document details technical controls implemented in the software architecture. It does not constitute formal regulatory compliance certification (e.g., HIPAA/GDPR/NABH) which requires organizational, administrative, physical, and infrastructure auditing.

---

## 2. Data Classification Matrix

| Classification | Definition | Examples in System | Technical Controls Implemented |
| :--- | :--- | :--- | :--- |
| **Public** | Unrestricted data accessible by anyone | Doctor names, bios, specializations, ratings, languages, public slot times | CDN caching, rate-limited public APIs. |
| **Internal** | Non-sensitive operational data | System metrics, application route maps, database schema migrations | Protected Prometheus `/metrics`, internal health checks. |
| **Confidential** | Sensitive identity, contact, & financial info | User emails, phone numbers, transaction references, TOTP QR secrets | Scoped RBAC, bcrypt cost 12 password hashing, TLS in transit, masked logs. |
| **Restricted (PHI)** | Highly sensitive medical & clinical data | Clinical diagnoses, medication schedules, lifestyle advice | **AES-256-GCM field-level encryption at rest**, strict doctor/patient ownership checks, zero logging. |

---

## 3. OWASP Top 10 Security Checklist

### A01: Broken Access Control
- **Role-Based Access Control (RBAC)**: Centralized middleware (`requireRole`) restricts sensitive endpoints to `PATIENT`, `DOCTOR`, or `ADMIN`.
- **Resource Ownership Verification**: Every mutation and retrieval verifies that the requesting user owns the resource or is the assigned practitioner. Doctors cannot view other doctors' patients or prescriptions.
- **Direct Object Reference (IDOR) Mitigation**: All internal entities use cryptographically strong UUIDv4 keys rather than predictable sequential integers.

### A02: Cryptographic Failures
- **Application Field Encryption**: Clinical fields (`diagnosis`, `medications`, `lifestyleAdvice`) are encrypted using **AES-256-GCM** with a 256-bit key and unique 96-bit initialization vectors (IV) per record.
- **Password Storage**: Passwords hashed using `bcrypt` with a computational work factor of 12.
- **Refresh Token Storage**: Opaque 48-byte refresh tokens are hashed using SHA-256 before persistence in PostgreSQL.
- **Data in Transit**: Production deployments must enforce TLS 1.3 termination via reverse proxy/load balancer.

### A03: Injection
- **SQL Injection**: Parameterized SQL queries enforced exclusively via Prisma ORM; raw user input is never concatenated into SQL strings.
- **Input Sanitization**: Strict Zod schema validation applied to all route inputs (`validateBody`, `validateQuery`, `validateParams`). Unknown keys are stripped.

### A04: Insecure Design
- **Deterministic Write Idempotency**: Mitigates duplicate booking charges and concurrent race conditions via payload-hashed idempotency records.
- **Rate Limiting**: Tiered IP-based sliding window rate limiters protect authentication endpoints against brute-force credential stuffing.
- **Two-Factor Authentication**: TOTP (RFC 6238) provides step-up multi-factor authentication with QR code pairing.

### A05: Security Misconfiguration
- **HTTP Security Headers**: `helmet` configured with strict Content Security Policy, X-Frame-Options (`DENY`), and X-Content-Type-Options (`nosniff`).
- **Error Obfuscation**: Production error middleware never leaks database error traces, file paths, or internal runtime internals to client callers.
- **Container Security**: Production Dockerfile executes under a dedicated non-privileged user (`amrutam`, UID 1001).

### A06: Vulnerable and Outdated Components
- **Dependency Auditing**: Automated `npm audit` integrated into GitHub Actions CI pipeline.
- **Minimal Base Images**: Multi-stage Docker builds based on Alpine Linux with devDependencies pruned from the runtime layer.

### A07: Identification and Authentication Failures
- **Short-Lived Access Tokens**: JWT access tokens expire after 15 minutes.
- **Token Invalidation**: Dedicated `/auth/logout` endpoint revokes refresh tokens immediately.
- **Step-Up Verification**: Users with MFA enabled receive a limited-scope temporary token allowing only TOTP challenge completion.

### A08: Software and Data Integrity Failures
- **Digital Signatures**: Doctor digital signatures stored with prescriptions to record prescribing clinician identity.
- **Transaction Atomicity**: All state-modifying operations (booking, payment, cancellation) execute inside isolated database transactions.

### A09: Security Logging and Monitoring Failures
- **Structured Audit Logging**: Dedicated `audit_logs` table records actor ID, action, resource, IP address, and metadata.
- **PII/PHI Sanitization in Logs**: Winston logger automatically excludes passwords, tokens, and encrypted clinical data from standard output.

### A10: Server-Side Request Forgery (SSRF)
- The application does not fetch arbitrary external URLs specified by end-users. Outgoing webhooks and payment gateways are restricted to configured external hostnames.

---

## 4. STRIDE Threat Model

| STRIDE Category | Asset / Surface | Threat Description | Implemented Mitigation | Residual Risk & Production Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **Spoofing** | Authentication & Token Verification | Attacker creates forged JWT access tokens or impersonates another doctor. | HMAC-SHA256 signature verification with minimum 32-character secret; TOTP 2FA. | Use asymmetric Ed25519 or RS256 keypairs with AWS KMS in multi-region deployments. |
| **Tampering** | Stored Medical Prescriptions | Attacker alters prescribed medication dosages or diagnoses in the database. | AES-256-GCM authenticated encryption; authentication tag verification fails if ciphertext is modified. | Store database write-ahead logs in write-once-read-many (WORM) storage for forensic integrity. |
| **Repudiation** | Appointment Cancellations & Prescription Creation | Doctor or patient denies creating a prescription or canceling an appointment. | Comprehensive immutable `audit_logs` capturing user ID, timestamp, and IP address. | Stream audit records to a centralized SIEM (Splunk, Elastic, Datadog) with tamper-evident hashing. |
| **Information Disclosure** | Database Backup Leakage | Backup snapshot is compromised, exposing sensitive health histories. | Sensitive clinical fields are AES-256-GCM encrypted prior to database insertion. | Combine application field encryption with AWS RDS / EBS volume-level encryption at rest (KMS). |
| **Denial of Service** | Booking Endpoint Race Conditions | Attacker floods booking endpoint to crash API or corrupt availability slots. | Atomic row updates (`UPDATE ... WHERE status = 'AVAILABLE'`); sliding window rate limiters. | Deploy Cloudflare Enterprise or AWS Shield DDoS protection upstream of the load balancer. |
| **Elevation of Privilege** | Normal Patient Account | Patient attempts to call doctor slot creation or prescription issuance APIs. | RBAC middleware checks `req.user.role === 'DOCTOR'` and verifies doctor profile is verified in DB. | Perform continuous static code analysis and quarterly external penetration testing. |

---

## 5. Key Rotation & Secrets Management

1. **Environment Separation**: Secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`) are injected via environment variables and never baked into Docker images or checked into source control.
2. **Field Encryption Key Rotation**:
   - For planned key rotation, implement a two-key version prefix (e.g., `v1:<iv>:<tag>:<ciphertext>`).
   - A batch migration task reads records with older key versions and re-encrypts using the new primary key.
