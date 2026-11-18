# RentEase Software Requirements Specification

## 1. Introduction

### 1.1 Purpose
This specification describes RentEase, a responsive, multi-user rental-management web application for administrators, landlords, and tenants.

### 1.2 Scope
RentEase provides authenticated accounts, property and tenant assignment workflows, persistent rent records and receipts, maintenance tracking, and live updates between connected browser sessions. It runs locally on Node.js and stores data in SQLite. Rent payments in this course application are simulated and do not transfer funds.

### 1.3 Intended users
Administrators oversee user accounts and rental activity. Landlords manage their properties, tenants, payments, and maintenance. Tenants review their assigned rental, record a demo payment, and submit maintenance requests.

## 2. Overall description

### 2.1 Product perspective
RentEase consists of a browser frontend, an Express API, a SQLite database, server-side sessions, and Socket.IO event delivery. The API filters records by the signed-in user's role and property assignments.

### 2.2 User roles
- **Admin:** Provisioned by server environment configuration; can review all accounts and rental records, manage properties, payments, and maintenance, and deactivate/reactivate non-admin accounts.
- **Landlord:** Self-registers; can create and manage owned properties, assign registered tenant accounts, record payments, view tenants, and progress maintenance requests.
- **Tenant:** Self-registers; can view only their assigned rental and records, record simulated rent payments, view/print paid receipts, and submit maintenance requests.

The public registration flow never accepts the admin role.

### 2.3 Constraints
The local application requires Node.js 20+, a modern browser, and JavaScript. Real payment processing, email invitations, lease documents, and hosted deployment are outside the current scope.

## 3. Specific requirements

### 3.1 Functional requirements
- **FR-01:** Users shall register as a landlord or tenant and authenticate with an email and password.
- **FR-02:** The server shall provision admin accounts only from protected environment configuration.
- **FR-03:** The application shall maintain authenticated sessions and provide a sign-out function.
- **FR-04:** The application shall display navigation and data according to the authenticated role.
- **FR-05:** A landlord or admin shall be able to create a rental property with address, type, room counts, and monthly rent.
- **FR-06:** A landlord or admin shall be able to assign a previously registered, unassigned tenant to a vacant property.
- **FR-07:** A landlord or admin shall be able to review available tenant and lease details.
- **FR-08:** A landlord or admin shall be able to record rent and mark pending payments as paid.
- **FR-09:** A tenant shall be able to review their assigned rental and payment history, record a simulated payment, and view/print paid receipts.
- **FR-10:** A tenant shall be able to submit a maintenance request with a title, category, priority, and description.
- **FR-11:** A landlord or admin shall be able to progress a maintenance request from Open to In progress to Resolved.
- **FR-12:** An admin shall be able to review accounts and deactivate or reactivate non-admin accounts.
- **FR-13:** Authorized clients shall receive live change notifications and refresh the role-filtered workspace data.
- **FR-14:** Users shall be able to search visible properties by name, address, or type.

### 3.2 Non-functional requirements
- **NFR-01 Usability:** Core workflows shall be usable on desktop and mobile screen sizes.
- **NFR-02 Accessibility:** Interactive controls shall have accessible labels, keyboard focus, and appropriate dialog/notification semantics.
- **NFR-03 Data safety:** The application shall clearly identify rent checkout as simulated and shall not collect card details.
- **NFR-04 Reliability:** Data shall persist in SQLite across server restarts; invalid input and permission errors shall be reported.
- **NFR-05 Security:** Passwords shall be hashed; sessions shall use HTTP-only, same-site cookies; authentication endpoints shall be rate limited; server-side authorization shall prevent cross-role access.
- **NFR-06 Realtime:** Successful data changes shall notify connected clients without requiring a manual page reload.

## 4. Process model and sprint goals

Use Scrum because the workflows can be delivered incrementally and reviewed with landlord and tenant feedback. Track work in Product Backlog, Sprint Backlog, In Progress, and Done.

- **Sprint 1 — Foundations:** Confirm requirements, create wireframes and UML/ER/DFD diagrams, set up repository conventions, authentication, sessions, and role-based API access.
- **Sprint 2 — Rental workflows:** Implement properties, tenant assignment, payment records/receipts, and maintenance requests with persistent storage and live updates.
- **Sprint 3 — Quality and demo:** Validate role isolation and mobile usability, execute acceptance tests, address defects, complete documentation, and rehearse the demo.

Keep sprint screenshots and merge feature branches through reviewed pull requests. The current workspace is not initialized as a Git repository.

## 5. Demo flow

1. Register a landlord and a tenant using separate browser sessions.
2. Sign in as landlord, add a property, and assign the registered tenant by email.
3. Keep the tenant signed in separately and confirm the property appears without reloading.
4. Record a payment and open/print the tenant's receipt.
5. Submit a maintenance request as tenant; advance it as landlord and confirm the tenant view updates live.
6. Sign in as admin, review accounts and all rental activity, and optionally deactivate/reactivate a non-admin account.
