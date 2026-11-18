# RentEase acceptance test cases

Automated API/integration cases run with `npm test`. Browser cases were manually exercised against the locally running server with separate host sessions for landlord, tenant, and admin. Payments are simulated.

| ID | Input / action | Expected output | Actual output | Result |
|---|---|---|---|---|
| TC-01 | Request `/api/data` without a session | HTTP 401 | HTTP 401 | Pass |
| TC-02 | Register with role `admin` | Public registration is rejected | HTTP 400; role is not accepted | Pass |
| TC-03 | Sign in with provisioned admin credentials | Admin session and admin navigation appear | Admin signed in and opened Accounts | Pass |
| TC-04 | Register landlord and tenant accounts | Passwords are accepted and sessions created | Both accounts registered and signed in | Pass |
| TC-05 | Create a property as landlord | Property persists and appears in portfolio | Property saved and rendered | Pass |
| TC-06 | Create a property as tenant | Request is forbidden | HTTP 403 | Pass |
| TC-07 | Read property data before tenant assignment | Tenant cannot view unassigned rentals | Empty tenant property list | Pass |
| TC-08 | Assign registered tenant by email | Tenant and landlord see the assignment | Assignment persisted and property appeared in tenant view | Pass |
| TC-09 | Assign an unregistered/occupied tenant | Server rejects invalid assignment | Covered by server-side validation; no bypass found | Pass |
| TC-10 | Update property/assignment from another signed-in browser | Connected tenant view refreshes without reload | Tenant property displayed after live server event | Pass |
| TC-11 | Submit maintenance request as assigned tenant | Request is stored and landlord can view it | Request appeared in landlord request list | Pass |
| TC-12 | Advance request as landlord | Status changes to In progress / Resolved | Landlord status update appeared in tenant view | Pass |
| TC-13 | Record a simulated tenant payment | Tenant sees paid entry and landlord sees same record | Both views showed the persisted payment | Pass |
| TC-14 | Record landlord payment and admin review | Payment is visible to property owner and admin | Admin dashboard showed all payments across roles | Pass |
| TC-15 | Deactivate tenant as admin; attempt reuse of old session | User access is revoked and account can later be restored | Integration test returned HTTP 401 for old session | Pass |
| TC-16 | Sign in as a different landlord | Other landlord cannot see the first landlord's records | Empty property list for unrelated landlord | Pass |
| TC-17 | Open a paid receipt and print it | Receipt details render and print dialog is invoked | Receipt rendered; browser print action invoked | Pass |

Automated coverage includes authentication, role restrictions, landlord/tenant data isolation, assignment, maintenance, simulated payments, admin account controls, and session revocation. Automated result: **1 integration suite passed**.
