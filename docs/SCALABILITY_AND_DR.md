# Amrutam Telemedicine Scalability, Data Partitioning & Disaster Recovery Plan

## 1. Capacity Planning for 100,000 Consultations / Day

### 1.1 Throughput & Bandwidth Mathematics
To sustain **100,000 completed consultations per day**:
- **Operating Window**: Assuming consultations occur primarily across a 14-hour daily window (8:00 AM to 10:00 PM):
  - **Average Consultations per Second**:
    $$\frac{100,000 \text{ consultations}}{14 \times 3600 \text{ seconds}} \approx 1.98 \approx 2 \text{ bookings/sec}$$
  - **Peak Hour Factor**: Using a standard 4x peak traffic multiplier:
    $$\text{Peak Booking Throughput} \approx 8 \text{ completed bookings/sec}$$
- **Read-to-Write Ratio**:
  - Healthcare platforms typically exhibit a **20:1 read-to-write ratio** (browsing doctor specializations, checking schedules, reading reviews, polling status):
    $$\text{Peak Read Traffic} \approx 8 \times 20 = 160 \text{ read requests/sec}$$
  - **Total API Request Volume**: $\approx 200 \text{ RPS}$ under normal peak conditions, scaling to $\approx 500 \text{ RPS}$ during marketing flash campaigns or seasonal health surges.

### 1.2 Storage Growth Projections
- Average Consultation Record: $\approx 1.5 \text{ KB}$ (metadata + status history)
- Average Prescription Record (Encrypted): $\approx 2.5 \text{ KB}$
- Associated Audit Logs & Payment Records: $\approx 2.0 \text{ KB}$
- **Total per Consultation**: $\approx 6.0 \text{ KB}$
- **Daily Storage Growth**:
  $$100,000 \times 6.0 \text{ KB} = 600,000 \text{ KB} \approx 600 \text{ MB/day} \approx 18 \text{ GB/month} \approx 216 \text{ GB/year}$$
- *Conclusion*: A properly indexed PostgreSQL cluster on modern cloud hardware easily handles this write and storage throughput for multiple years without requiring complex sharding.

---

## 2. Horizontal Scaling Architecture

```
                       [ Cloudflare / AWS CloudFront CDN ]
                                        │
                               [ AWS ALB / NGINX ]
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
     [ API Pod 1 ]              [ API Pod 2 ]              [ API Pod N ]
             │                          │                          │
   (Stateless Express)        (Stateless Express)        (Stateless Express)
             │                          │                          │
             ├──────────────────────────┼──────────────────────────┤
             ▼                          ▼                          ▼
       [ Redis Cluster ]         [ PgBouncer Pooler ]       [ Async Job Queue ]
   (Slots Cache, Rate Limits)           │                    (BullMQ / SQS)
                                ┌───────┴───────┐                  │
                                ▼               ▼                  ▼
                         [ PG Primary ]   [ PG Replica ]    [ Worker Nodes ]
                            (Writes)      (Search/Reports)  (Emails / SMS)
```

### 2.1 Key Architectural Mechanisms
1. **Stateless API Services**:
   - Express nodes maintain no sticky sessions or in-memory state; JWTs and Redis cache provide all authentication and session context.
   - Autoscaling governed by CPU utilization (> 70%) and P95 latency (> 100 ms) via Kubernetes HPA.
2. **PgBouncer Connection Pooling**:
   - Prevents connection exhaustion on PostgreSQL when dozens of API replicas scale out.
   - Operates in transaction pooling mode to multiplex thousands of client connections into a manageable pool (e.g., 50–100 active connections) against PostgreSQL.
3. **Read-Through Cache-Aside (Redis)**:
   - Doctor profiles and verified practitioner search queries cached with 5-minute TTL.
   - Cache invalidated proactively upon doctor profile updates or new slot publication.

---

## 3. Data Partitioning Strategy (Production Recommendation)

> **Implementation Note**: The current local Prisma schema utilizes single indexed tables for local developer ergonomics. In production, the following declarative PostgreSQL partitioning strategy is recommended for high-volume append-heavy tables.

### 3.1 Consultations Table Partitioning
- **Strategy**: Range partitioning by `scheduled_at` on a monthly cadence.
- **Rationale**:
  - 95% of active consultation queries target the current month or upcoming appointments.
  - Partition pruning allows the query planner to scan only the active partition, keeping working sets comfortably in RAM (buffer cache).
  - Historical partitions older than 7 years can be archived to cold storage (e.g., AWS S3 via Parquet export) to satisfy medical record retention laws without bloating the live primary database.

```sql
-- Production DDL for Partitioned Consultations Table:
CREATE TABLE consultations (
    id UUID NOT NULL,
    consultation_number TEXT NOT NULL,
    patient_id UUID NOT NULL,
    doctor_id UUID NOT NULL,
    slot_id UUID NOT NULL,
    status "ConsultationStatus" NOT NULL,
    chief_complaint TEXT NOT NULL,
    scheduled_at TIMESTAMP(3) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,
    PRIMARY KEY (id, scheduled_at)
) PARTITION BY RANGE (scheduled_at);

-- Monthly partitions
CREATE TABLE consultations_y2026m09 PARTITION OF consultations
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE consultations_y2026m10 PARTITION OF consultations
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
```

### 3.2 Audit Logs Table Partitioning
- **Strategy**: Range partitioning by `created_at` on a monthly or quarterly cadence.
- **Rationale**:
  - Audit logs are purely append-only; updates and deletes are never performed.
  - Detaching and archiving aged partitions (e.g., older than 1 year) is an $O(1)$ metadata operation (`ALTER TABLE audit_logs DETACH PARTITION ...`), avoiding expensive `DELETE` queries that trigger table vacuuming and lock contention.

---

## 4. Disaster Recovery & Backup Strategy

### 4.1 Objectives (RPO & RTO Targets)
- **Recovery Point Objective (RPO)**: **< 5 minutes**. (Maximum potential data loss in a catastrophic failure).
- **Recovery Time Objective (RTO)**: **< 30 minutes**. (Maximum duration to restore complete system operations).

*Note: These figures represent engineered production architecture targets rather than simulated local test guarantees.*

### 4.2 Backup Procedures
1. **Continuous Write-Ahead Log (WAL) Archiving**:
   - Streaming WAL archiving to encrypted, versioned object storage (AWS S3 / Google Cloud Storage) enabling Point-In-Time Recovery (PITR) to any second within the retention window (35 days).
2. **Automated Daily Snapshots**:
   - Full automated database snapshot taken daily at 02:00 UTC during off-peak hours.
3. **Multi-AZ Hot Standby Replication**:
   - Synchronous or semi-synchronous physical streaming replication to a standby instance in an alternate Availability Zone (e.g., AWS us-east-1a to us-east-1b).
   - Automated health failover via Patroni or AWS RDS Multi-AZ within 60–120 seconds.
4. **Drills & Verification**:
   - Automated weekly staging restore pipeline verifying snapshot integrity and measuring actual recovery duration.
