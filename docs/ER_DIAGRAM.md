# Database Entity Relationship (ER) Diagram

The following Mermaid ER diagram models the domain entities, relational integrity constraints, and foreign keys implemented in the Amrutam Telemedicine database schema (`prisma/schema.prisma`).

```mermaid
erDiagram
    users ||--o| profiles : "has profile (1:1)"
    users ||--o| doctors : "has doctor profile (1:1)"
    users ||--o{ refresh_tokens : "owns"
    users ||--o{ idempotency_keys : "originates"
    users ||--o{ audit_logs : "triggers"
    users ||--o{ consultations : "books as patient"
    users ||--o{ prescriptions : "receives as patient"
    users ||--o{ payments : "makes"

    doctors ||--o{ availability_slots : "publishes (1:N)"
    doctors ||--o{ consultations : "attends (1:N)"
    doctors ||--o{ prescriptions : "issues (1:N)"

    availability_slots ||--o| consultations : "reserved by (1:1 UNIQUE)"

    consultations ||--o| prescriptions : "has prescription (1:1 UNIQUE)"
    consultations ||--o{ payments : "paid through (1:N)"

    users {
        uuid id PK
        string email UK
        string password_hash
        UserRole role "PATIENT | DOCTOR | ADMIN"
        boolean is_active
        boolean is_email_verified
        boolean mfa_enabled
        string mfa_secret
        datetime created_at
        datetime updated_at
    }

    profiles {
        uuid id PK
        uuid user_id FK,UK
        string first_name
        string last_name
        string phone
        string gender
        datetime date_of_birth
        string blood_group
        string emergency_contact
    }

    doctors {
        uuid id PK
        uuid user_id FK,UK
        string specialization "Indexed"
        string license_number UK
        int experience_years
        string bio
        decimal consultation_fee
        string_array languages
        boolean is_verified "Indexed"
        decimal average_rating
        int total_reviews
    }

    availability_slots {
        uuid id PK
        uuid doctor_id FK
        datetime start_time "Indexed"
        datetime end_time "Indexed"
        SlotStatus status "AVAILABLE | LOCKED | BOOKED | CANCELLED"
        int lock_version "Optimistic Lock Counter"
        datetime created_at
        datetime updated_at
    }

    consultations {
        uuid id PK
        string consultation_number UK
        uuid patient_id FK
        uuid doctor_id FK
        uuid slot_id FK,UK "Enforces Single-Consultation Guarantee"
        ConsultationStatus status "PENDING_PAYMENT | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED | NO_SHOW"
        string chief_complaint
        string notes
        string meeting_link
        datetime scheduled_at "Indexed"
        datetime started_at
        datetime ended_at
        datetime created_at
        datetime updated_at
    }

    prescriptions {
        uuid id PK
        uuid consultation_id FK,UK
        uuid doctor_id FK
        uuid patient_id FK
        string diagnosis "AES-256-GCM Encrypted"
        jsonb medications "AES-256-GCM Encrypted"
        string lifestyle_advice "AES-256-GCM Encrypted"
        datetime follow_up_date
        string digital_signature
        datetime created_at
        datetime updated_at
    }

    payments {
        uuid id PK
        uuid consultation_id FK
        uuid user_id FK
        decimal amount
        string currency
        PaymentStatus status "INITIATED | SUCCESS | FAILED | REFUNDED"
        string payment_method
        string transaction_reference UK
        string idempotency_key UK
        datetime created_at
        datetime updated_at
    }

    audit_logs {
        uuid id PK
        uuid user_id FK
        string action "Indexed"
        string resource "Indexed"
        string resource_id
        string ip_address
        string user_agent
        jsonb details
        datetime created_at "Indexed"
    }

    idempotency_keys {
        uuid id PK
        string key UK
        uuid user_id FK
        string endpoint
        string request_hash
        int response_status
        jsonb response_body
        datetime expires_at "Indexed (TTL)"
        datetime created_at
    }

    refresh_tokens {
        uuid id PK
        uuid user_id FK
        string token_hash UK
        boolean revoked
        datetime expires_at "Indexed"
        datetime created_at
    }
```
