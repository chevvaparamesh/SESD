# RentEase design diagrams

These Mermaid diagrams describe the local multi-user RentEase application. A real payment provider is intentionally outside this demo; rent payment is simulated.

## Use case diagram

```mermaid
flowchart LR
  Landlord([Landlord])
  Tenant([Tenant])
  Admin([Admin])
  subgraph RentEase
    UC1((Manage properties))
    UC2((Assign registered tenants))
    UC3((Record demo rent))
    UC4((View or print receipt))
    UC5((Submit maintenance request))
    UC6((Update maintenance status))
    UC7((Manage user accounts))
    UC8((Register and sign in))
  end
  Landlord --- UC1
  Landlord --- UC2
  Landlord --- UC3
  Landlord --- UC6
  Tenant --- UC3
  Tenant --- UC4
  Tenant --- UC5
  Landlord --- UC8
  Tenant --- UC8
  Admin --- UC7
  Admin --- UC1
  Admin --- UC3
  Admin --- UC6
```

## Class diagram

```mermaid
classDiagram
  class User {
    +id: UUID
    +name: string
    +email: string
    +passwordHash: string
    +role: Role
    +active: boolean
  }
  class Property {
    +id: UUID
    +address: string
    +type: string
    +bedrooms: int
    +bathrooms: int
    +monthlyRent: decimal
    +leaseEnd: date
  }
  class Payment {
    +id: UUID
    +amount: decimal
    +date: date
    +status: PaymentStatus
    +method: string
  }
  class MaintenanceRequest {
    +id: UUID
    +title: string
    +category: string
    +priority: Priority
    +status: RequestStatus
    +description: string
  }
  User "1" --> "0..*" Property : owns
  User "0..1" --> "0..1" Property : tenant assignment
  User "1" --> "0..*" Payment : pays
  Property "1" --> "0..*" Payment : rent records
  User "1" --> "0..*" MaintenanceRequest : submits
  Property "1" --> "0..*" MaintenanceRequest : concerns
```

## Rent-payment sequence

```mermaid
sequenceDiagram
  actor Tenant
  participant UI as RentEase UI
  participant API as Express API
  participant DB as SQLite
  participant Live as Socket.IO
  Tenant->>UI: Confirm simulated payment
  UI->>API: Submit payment method
  API->>DB: Verify tenant assignment and record payment
  DB-->>API: Persisted payment
  API->>Live: Broadcast data changed
  API-->>UI: Confirmation
  Live-->>UI: Refresh authorized workspace data
  UI-->>Tenant: Show payment and receipt
```

## Entity-relationship diagram

```mermaid
erDiagram
  USER {
    uuid id PK
    string name
    string email UK
    string password_hash
    string role
    boolean active
    string created_at
  }
  PROPERTY {
    uuid id PK
    uuid landlord_id FK
    uuid tenant_id FK
    string name
    string address
    string city
    string type
    int bedrooms
    int bathrooms
    int sqft
    decimal rent
    decimal deposit
    string status
    date lease_end
  }
  LEASE {
    uuid id PK
    uuid property_id FK
    uuid tenant_id FK
    uuid landlord_id FK
    date start_date
    date end_date
    decimal rent_amount
    decimal deposit_amount
    string status
  }
  PAYMENT {
    uuid id PK
    uuid property_id FK
    uuid tenant_id FK
    string reference_no UK
    string period_month
    decimal amount
    date date
    string status
    string method
    string notes
  }
  MAINTENANCE_REQUEST {
    uuid id PK
    uuid property_id FK
    uuid tenant_id FK
    string title
    string description
    string category
    string priority
    string status
    string resolution_notes
    datetime resolved_at
  }
  ACTIVITY_LOG {
    uuid id PK
    uuid user_id FK
    string role
    string action_type
    string title
    string details
    string entity_type
    string entity_id
    datetime created_at
  }
  EXPENSE {
    uuid id PK
    uuid property_id FK
    uuid landlord_id FK
    string category
    decimal amount
    date date
    string description
  }
  ANNOUNCEMENT {
    uuid id PK
    uuid landlord_id FK
    uuid property_id FK
    string title
    string content
    string priority
  }
  MESSAGE {
    uuid id PK
    uuid sender_id FK
    uuid recipient_id FK
    uuid property_id FK
    string message
    datetime created_at
  }
  USER ||--o{ PROPERTY : owns
  USER o|--o| PROPERTY : is_assigned_to
  PROPERTY ||--o{ LEASE : has
  USER ||--o{ LEASE : holds
  PROPERTY ||--o{ PAYMENT : has
  USER ||--o{ PAYMENT : makes
  PROPERTY ||--o{ MAINTENANCE_REQUEST : has
  USER ||--o{ MAINTENANCE_REQUEST : submits
  USER ||--o{ EXPENSE : logs
  PROPERTY ||--o{ EXPENSE : incurs
  USER ||--o{ ANNOUNCEMENT : posts
  USER ||--o{ MESSAGE : sends
  USER ||--o{ ACTIVITY_LOG : triggers
```

## DFD level 0 (context)

```mermaid
flowchart LR
  Landlord[Landlord]
  Tenant[Tenant]
  Admin[Admin]
  App((RentEase application))
  Landlord -->|Properties, assignments, payment updates| App
  Tenant -->|Sign-in, demo rent, maintenance requests| App
  Admin -->|Account administration| App
  App -->|Portfolio, payment and request status| Landlord
  App -->|Lease details, receipts and request status| Tenant
  App -->|Account and portfolio overview| Admin
  App -->|Realtime change event| Landlord
  App -->|Realtime change event| Tenant
```

## DFD level 1

```mermaid
flowchart LR
  Landlord[Landlord]
  Tenant[Tenant]
  Admin[Admin]
  P1((1. Manage properties and assignments))
  P2((2. Record demo rent payment))
  P3((3. Manage maintenance request))
  P4((4. Authenticate and manage accounts))
  D1[(D1 Users and properties)]
  D2[(D2 Payments)]
  D3[(D3 Maintenance requests)]
  D4[(D4 Sessions)]
  Live((Socket.IO events))
  Landlord -->|Property and tenant assignment| P1
  P1 <--> D1
  Tenant -->|Payment choice| P2
  D1 -->|Tenant assignment and rent| P2
  P2 -->|Payment record| D2
  Landlord -->|Status update| P3
  Tenant -->|Issue details| P3
  P3 <--> D3
  Tenant -->|Sign up and sign in| P4
  Landlord -->|Sign up and sign in| P4
  Admin -->|Account management| P4
  P4 <--> D1
  P4 <--> D4
  P1 --> Live
  P2 --> Live
  P3 --> Live
  Live -->|Refresh authorized views| Landlord
  Live -->|Refresh authorized views| Tenant
  Live -->|Refresh authorized views| Admin
```
