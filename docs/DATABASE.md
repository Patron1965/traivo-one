# Databasstruktur

Auto-genererad översikt över alla tabeller i `shared/schema.ts`.

**Antal tabeller:** 138

## Innehåll

- [Användare & säkerhet](#användare-säkerhet) — 6 tabeller
- [Kunder & kontakter](#kunder-kontakter) — 12 tabeller
- [Objekt & geografi](#objekt-geografi) — 13 tabeller
- [Artiklar & lager](#artiklar-lager) — 10 tabeller
- [Order, planering & leverans](#order-planering-leverans) — 20 tabeller
- [Fakturering & ekonomi](#fakturering-ekonomi) — 3 tabeller
- [Väder & cache](#väder-cache) — 3 tabeller
- [Dokument & filer](#dokument-filer) — 6 tabeller
- [Loggar & historik](#loggar-historik) — 11 tabeller
- [Inställningar & integrationer](#inställningar-integrationer) — 1 tabeller
- [Övrigt](#övrigt) — 53 tabeller

---

## Användare & säkerhet

### `invitations`

Drizzle-variabel: `invitations`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `email` | `varchar` | NOT NULL |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `role` | `varchar` | NOT NULL, DEFAULT |
| `invitedBy` | `varchar` | FK→users.id |
| `status` | `varchar` | NOT NULL, DEFAULT |
| `usedBy` | `varchar` | FK→users.id |
| `usedAt` | `timestamp` |  |
| `expiresAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `sessions`

Drizzle-variabel: `sessions`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `sid` | `varchar` | PK |
| `sess` | `jsonb` | NOT NULL |
| `expire` | `timestamp` | NOT NULL |

### `tenants`

Drizzle-variabel: `tenants`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `name` | `text` | NOT NULL |
| `orgNumber` | `text` |  |
| `contactEmail` | `text` |  |
| `contactPhone` | `text` |  |
| `settings` | `jsonb` | DEFAULT |
| `customDomain` | `varchar` |  |
| `industry` | `varchar` |  |
| `smsEnabled` | `boolean` | DEFAULT |
| `smsProvider` | `varchar` |  |
| `smsFromName` | `varchar` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `user_notifications`

Drizzle-variabel: `userNotifications`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `userId` | `varchar` | NOT NULL |
| `type` | `text` | NOT NULL |
| `title` | `text` | NOT NULL |
| `message` | `text` | NOT NULL |
| `link` | `text` |  |
| `data` | `jsonb` | DEFAULT |
| `isRead` | `boolean` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `user_tenant_roles`

Drizzle-variabel: `userTenantRoles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `userId` | `varchar` | NOT NULL, FK→users.id |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | DEFAULT |

### `users`

Drizzle-variabel: `users`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `email` | `varchar` | UNIQUE |
| `firstName` | `varchar` |  |
| `lastName` | `varchar` |  |
| `profileImageUrl` | `varchar` |  |
| `passwordHash` | `varchar` |  |
| `role` | `varchar` | DEFAULT |
| `resourceId` | `varchar` |  |
| `isActive` | `boolean` | DEFAULT |
| `lastLoginAt` | `timestamp` |  |
| `createdAt` | `timestamp` | DEFAULT |
| `updatedAt` | `timestamp` | DEFAULT |

## Kunder & kontakter

### `customer_booking_requests`

Drizzle-variabel: `customerBookingRequests`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `objectId` | `varchar` | FK→objects.id |
| `workOrderId` | `varchar` | FK→workOrders.id |
| `requestType` | `text` | NOT NULL |
| `status` | `text` | NOT NULL, DEFAULT |
| `preferredDate1` | `timestamp` |  |
| `preferredDate2` | `timestamp` |  |
| `preferredTimeSlot` | `text` |  |
| `customerNotes` | `text` |  |
| `staffNotes` | `text` |  |
| `handledBy` | `varchar` | FK→users.id |
| `handledAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `customer_change_requests`

Drizzle-variabel: `customerChangeRequests`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `category` | `text` | NOT NULL |
| `description` | `text` | NOT NULL |
| `photos` | `text` | ARRAY |
| `latitude` | `real` |  |
| `longitude` | `real` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `severity` | `text` |  |
| `createdByResourceId` | `varchar` | FK→resources.id |
| `linkedDeviationId` | `varchar` | FK→deviationReports.id |
| `reviewedBy` | `varchar` | FK→users.id |
| `reviewedAt` | `timestamp` |  |
| `reviewNotes` | `text` |  |
| `linkedWorkOrderId` | `varchar` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `customer_communications`

Drizzle-variabel: `customerCommunications`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | FK→workOrders.id |
| `customerId` | `varchar` | FK→customers.id |
| `objectId` | `varchar` | FK→objects.id |
| `channel` | `text` | NOT NULL |
| `notificationType` | `text` | NOT NULL |
| `recipientName` | `text` |  |
| `recipientEmail` | `text` |  |
| `recipientPhone` | `text` |  |
| `subject` | `text` |  |
| `message` | `text` | NOT NULL |
| `aiGenerated` | `boolean` | DEFAULT |
| `status` | `text` | NOT NULL |
| `errorMessage` | `text` |  |
| `sentAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `customer_invoices`

Drizzle-variabel: `customerInvoices`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `invoiceNumber` | `text` | NOT NULL |
| `invoiceDate` | `timestamp` | NOT NULL |
| `dueDate` | `timestamp` | NOT NULL |
| `amount` | `real` | NOT NULL |
| `vatAmount` | `real` | DEFAULT |
| `totalAmount` | `real` | NOT NULL |
| `currency` | `text` | DEFAULT |
| `status` | `text` | NOT NULL, DEFAULT |
| `pdfUrl` | `text` |  |
| `fortnoxInvoiceId` | `text` |  |
| `description` | `text` |  |
| `workOrderIds` | `text` | ARRAY, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `customer_issue_reports`

Drizzle-variabel: `customerIssueReports`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `objectId` | `varchar` | FK→objects.id |
| `issueType` | `text` | NOT NULL |
| `description` | `text` |  |
| `customerContact` | `text` |  |
| `imageUrls` | `text` | ARRAY, DEFAULT |
| `staffNotes` | `text` |  |
| `assignedTo` | `varchar` | FK→users.id |
| `resolvedAt` | `timestamp` |  |
| `resolvedBy` | `varchar` | FK→users.id |
| `resolution` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `customer_notification_settings`

Drizzle-variabel: `customerNotificationSettings`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `emailNotifications` | `boolean` | DEFAULT |
| `smsNotifications` | `boolean` | DEFAULT |
| `notifyOnTechnicianOnWay` | `boolean` | DEFAULT |
| `notifyOnJobCompleted` | `boolean` | DEFAULT |
| `notifyOnInvoice` | `boolean` | DEFAULT |
| `notifyOnBookingConfirmation` | `boolean` | DEFAULT |
| `preferredContactEmail` | `text` |  |
| `preferredContactPhone` | `text` |  |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `customer_portal_messages`

Drizzle-variabel: `customerPortalMessages`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `sender` | `text` | NOT NULL |
| `message` | `text` | NOT NULL |
| `readAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `customer_portal_sessions`

Drizzle-variabel: `customerPortalSessions`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `sessionToken` | `text` | NOT NULL, UNIQUE |
| `expiresAt` | `timestamp` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `lastAccessedAt` | `timestamp` | NOT NULL, DEFAULT |
| `ipAddress` | `text` |  |
| `userAgent` | `text` |  |

### `customer_portal_tokens`

Drizzle-variabel: `customerPortalTokens`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `tokenHash` | `text` | NOT NULL |
| `email` | `text` | NOT NULL |
| `expiresAt` | `timestamp` | NOT NULL |
| `usedAt` | `timestamp` |  |
| `requestedAt` | `timestamp` | NOT NULL, DEFAULT |
| `ipAddress` | `text` |  |
| `userAgent` | `text` |  |

### `customer_service_contracts`

Drizzle-variabel: `customerServiceContracts`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `contractNumber` | `text` |  |
| `name` | `text` | NOT NULL |
| `description` | `text` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `endDate` | `timestamp` |  |
| `renewalType` | `text` | DEFAULT |
| `objectIds` | `text` | ARRAY, DEFAULT |
| `services` | `jsonb` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `customers`

Drizzle-variabel: `customers`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `customerNumber` | `text` |  |
| `orgNumber` | `text` |  |
| `contactPerson` | `text` |  |
| `email` | `text` |  |
| `phone` | `text` |  |
| `address` | `text` |  |
| `city` | `text` |  |
| `postalCode` | `text` |  |
| `invoiceEmail` | `text` |  |
| `invoiceAddress` | `text` |  |
| `invoicePostalCode` | `text` |  |
| `invoiceCity` | `text` |  |
| `notes` | `text` |  |
| `importBatchId` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `object_contacts`

Drizzle-variabel: `objectContacts`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `phone` | `text` |  |
| `email` | `text` |  |
| `role` | `text` |  |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

## Objekt & geografi

### `article_object_mappings`

Drizzle-variabel: `articleObjectMappings`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `orderConceptArticleId` | `varchar` | NOT NULL, FK→orderConceptArticles.id |
| `orderConceptObjectId` | `varchar` | NOT NULL, FK→orderConceptObjects.id |
| `quantity` | `integer` | DEFAULT |
| `metadataRead` | `jsonb` |  |
| `metadataCreate` | `jsonb` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `cluster_capacity_forecast`

Drizzle-variabel: `clusterCapacityForecast`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `clusterId` | `varchar` | NOT NULL, FK→clusters.id |
| `weekStart` | `timestamp` | NOT NULL |
| `demandHours` | `real` | NOT NULL, DEFAULT |
| `capacityHours` | `real` | NOT NULL, DEFAULT |
| `gapHours` | `real` | NOT NULL, DEFAULT |
| `weatherMultiplier` | `real` | DEFAULT |
| `computedAt` | `timestamp` | NOT NULL, DEFAULT |

### `clusters`

Drizzle-variabel: `clusters`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `description` | `text` |  |
| `defaultPreferredTime` | `text` |  |
| `centerLongitude` | `real` |  |
| `radiusKm` | `real` | DEFAULT |
| `postalCodes` | `text` | ARRAY, DEFAULT |
| `cachedActiveOrders` | `integer` | DEFAULT |
| `cachedMonthlyValue` | `integer` | DEFAULT |
| `cachedAvgSetupTime` | `integer` | DEFAULT |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `geocoding_missing_snapshots`

Drizzle-variabel: `geocodingMissingSnapshots`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `date` | `text` | NOT NULL |
| `missingCount` | `integer` | NOT NULL |
| `totalWithAddress` | `integer` | NOT NULL |
| `totalObjects` | `integer` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `object_articles`

Drizzle-variabel: `objectArticles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `articleId` | `varchar` | NOT NULL, FK→articles.id |
| `overridePrice` | `integer` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `object_images`

Drizzle-variabel: `objectImages`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `imageUrl` | `text` | NOT NULL |
| `imageDate` | `timestamp` | NOT NULL, DEFAULT |
| `description` | `text` |  |
| `uploadedBy` | `varchar` | FK→users.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `object_metadata`

Drizzle-variabel: `objectMetadata`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `definitionId` | `varchar` | NOT NULL, FK→metadataDefinitions.id |
| `validTo` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | DEFAULT |

### `object_parents`

Drizzle-variabel: `objectParents`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `parentId` | `varchar` | NOT NULL, FK→objects.id |
| `isPrimary` | `boolean` | NOT NULL, DEFAULT |
| `relationContext` | `text` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `object_payers`

Drizzle-variabel: `objectPayers`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `isPrimary` | `boolean` | NOT NULL, DEFAULT |
| `payerLabel` | `text` |  |
| `validTo` | `timestamp` |  |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `object_time_restrictions`

Drizzle-variabel: `objectTimeRestrictions`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `restrictionType` | `text` | NOT NULL |
| `description` | `text` |  |
| `weekdays` | `integer` | ARRAY, DEFAULT |
| `startTime` | `text` |  |
| `endTime` | `text` |  |
| `isBlockingAllDay` | `boolean` | DEFAULT |
| `validFromDate` | `timestamp` |  |
| `validToDate` | `timestamp` |  |
| `recurrenceInterval` | `integer` |  |
| `recurrenceUnit` | `text` |  |
| `preference` | `text` | NOT NULL, DEFAULT |
| `reason` | `text` |  |
| `isActive` | `boolean` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `objects`

Drizzle-variabel: `objects`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `parentId` | `varchar` |  |
| `name` | `text` | NOT NULL |
| `objectNumber` | `text` |  |
| `objectType` | `text` | NOT NULL, DEFAULT |
| `city` | `text` |  |
| `postalCode` | `text` |  |
| `longitude` | `real` |  |
| `entranceLongitude` | `real` |  |
| `accessCode` | `text` |  |
| `keyNumber` | `text` |  |
| `accessInfo` | `jsonb` | DEFAULT |
| `keyNumberInherited` | `boolean` | DEFAULT |
| `accessInfoInherited` | `boolean` | DEFAULT |
| `preferredTime2` | `text` |  |
| `preferredTimeInherited` | `boolean` | DEFAULT |
| `containerCountK2` | `integer` | DEFAULT |
| `containerCountK3` | `integer` | DEFAULT |
| `containerCountK4` | `integer` | DEFAULT |
| `servicePeriods` | `jsonb` | DEFAULT |
| `avgSetupTime` | `integer` | DEFAULT |
| `resolvedKeyNumber` | `text` |  |
| `resolvedAccessInfo` | `jsonb` | DEFAULT |
| `resolvedPreferredTime1` | `text` |  |
| `resolvedPreferredTime2` | `text` |  |
| `isInterimObject` | `boolean` | NOT NULL, DEFAULT |
| `polylineData` | `jsonb` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `notes` | `text` |  |
| `lastServiceDate` | `timestamp` |  |
| `importBatchId` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `order_concept_objects`

Drizzle-variabel: `orderConceptObjects`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `orderConceptId` | `varchar` | NOT NULL, FK→orderConcepts.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `metadataSnapshot` | `jsonb` |  |
| `included` | `boolean` | DEFAULT |
| `sortOrder` | `integer` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `work_order_objects`

Drizzle-variabel: `workOrderObjects`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | NOT NULL, FK→workOrders.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `isPrimary` | `boolean` | DEFAULT |
| `sortOrder` | `integer` | DEFAULT |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

## Artiklar & lager

### `articles`

Drizzle-variabel: `articles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `articleNumber` | `text` | NOT NULL |
| `name` | `text` | NOT NULL |
| `description` | `text` |  |
| `stockLongitude` | `real` |  |
| `leaveMetadataCode` | `text` |  |
| `leaveMetadataFormat` | `text` |  |
| `fetchMetadataLabelFormat` | `text` |  |
| `canUpdateMetadata` | `boolean` | DEFAULT |
| `updateMetadataLabel` | `text` |  |
| `updateMetadataFormat` | `text` |  |
| `showPreviousValue` | `boolean` | DEFAULT |
| `associationValue` | `text` |  |
| `associationOperator` | `text` | DEFAULT |
| `maxPerAddress` | `integer` |  |
| `unit` | `text` | DEFAULT |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `assignment_articles`

Drizzle-variabel: `assignmentArticles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `assignmentId` | `varchar` | NOT NULL, FK→assignments.id |
| `articleId` | `varchar` | NOT NULL, FK→articles.id |
| `completedAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `fortnox_config`

Drizzle-variabel: `fortnoxConfig`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, UNIQUE, FK→tenants.id |
| `clientId` | `varchar` |  |
| `clientSecret` | `varchar` |  |
| `accessToken` | `text` |  |
| `refreshToken` | `text` |  |
| `tokenExpiresAt` | `timestamp` |  |
| `isActive` | `boolean` | DEFAULT |
| `lastSyncAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | DEFAULT |

### `fortnox_contract_suggestions`

Drizzle-variabel: `fortnoxContractSuggestions`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `importBatchId` | `varchar` | NOT NULL |
| `customerId` | `varchar` | FK→customers.id |
| `fortnoxCustomerNumber` | `text` | NOT NULL |
| `customerName` | `text` | NOT NULL |
| `articleNumber` | `text` |  |
| `articleDescription` | `text` | NOT NULL |
| `occurrenceCount` | `integer` | NOT NULL |
| `firstSeen` | `timestamp` | NOT NULL |
| `lastSeen` | `timestamp` | NOT NULL |
| `avgIntervalDays` | `real` |  |
| `suggestedBillingCycle` | `text` | NOT NULL |
| `avgPrice` | `real` |  |
| `avgQuantity` | `real` |  |
| `totalRevenue` | `real` | NOT NULL |
| `monthlyValue` | `real` |  |
| `confidence` | `real` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdContractId` | `varchar` | FK→customerServiceContracts.id |
| `rawSamples` | `jsonb` | DEFAULT |
| `reviewedBy` | `varchar` | FK→users.id |
| `reviewedAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `fortnox_invoice_exports`

Drizzle-variabel: `fortnoxInvoiceExports`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` |  |
| `fortnoxInvoiceNumber` | `varchar` |  |
| `costCenter` | `varchar` |  |
| `project` | `varchar` |  |
| `payerId` | `varchar` |  |
| `totalAmount` | `integer` |  |
| `errorMessage` | `text` |  |
| `isCreditInvoice` | `boolean` | DEFAULT |
| `originalExportId` | `varchar` |  |
| `creditedByExportId` | `varchar` |  |
| `sourceType` | `varchar` | DEFAULT |
| `sourceId` | `varchar` |  |
| `customerId` | `varchar` |  |
| `exportedAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `fortnox_mappings`

Drizzle-variabel: `fortnoxMappings`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `unicornId` | `varchar` | NOT NULL |
| `fortnoxId` | `varchar` | NOT NULL |
| `lastSyncedAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `order_concept_articles`

Drizzle-variabel: `orderConceptArticles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `orderConceptId` | `varchar` | NOT NULL, FK→orderConcepts.id |
| `articleId` | `varchar` | NOT NULL, FK→articles.id |
| `quantity` | `integer` | DEFAULT |
| `unitPrice` | `real` |  |
| `priceOverride` | `boolean` | DEFAULT |
| `metadataRules` | `jsonb` |  |
| `sortOrder` | `integer` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `price_list_articles`

Drizzle-variabel: `priceListArticles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `priceListId` | `varchar` | NOT NULL, FK→priceLists.id |
| `articleId` | `varchar` | NOT NULL, FK→articles.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `resource_articles`

Drizzle-variabel: `resourceArticles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `articleId` | `varchar` | NOT NULL, FK→articles.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `structural_articles`

Drizzle-variabel: `structuralArticles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

## Order, planering & leverans

### `concept_filters`

Drizzle-variabel: `conceptFilters`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `orderConceptId` | `varchar` | NOT NULL, FK→orderConcepts.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `delivery_schedules`

Drizzle-variabel: `deliverySchedules`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `orderConceptId` | `varchar` | NOT NULL, FK→orderConcepts.id |
| `season` | `text` |  |
| `startDate` | `timestamp` |  |
| `endDate` | `timestamp` |  |
| `periodicityValue` | `integer` | DEFAULT |
| `periodicityUnit` | `text` | DEFAULT |
| `minDaysBetween` | `integer` | DEFAULT |
| `preferredWeekday` | `integer` |  |
| `preferredTimeFrom` | `text` |  |
| `preferredTimeTo` | `text` |  |
| `rollingExtension` | `boolean` | DEFAULT |
| `rollingMonths` | `integer` | DEFAULT |
| `active` | `boolean` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `import_column_mappings`

Drizzle-variabel: `importColumnMappings`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `batchId` | `varchar` | NOT NULL |
| `csvColumn` | `text` | NOT NULL |
| `systemField` | `text` |  |
| `metadataType` | `text` |  |
| `isIgnored` | `boolean` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `optimization_jobs`

Drizzle-variabel: `optimizationJobs`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `type` | `varchar` | NOT NULL |
| `status` | `varchar` | NOT NULL, DEFAULT |
| `input` | `jsonb` | NOT NULL |
| `result` | `jsonb` |  |
| `error` | `text` |  |
| `progress` | `integer` | NOT NULL, DEFAULT |
| `attempts` | `integer` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `startedAt` | `timestamp` |  |
| `completedAt` | `timestamp` |  |

### `order_checklist_items`

Drizzle-variabel: `orderChecklistItems`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `workOrderId` | `varchar` | NOT NULL, FK→workOrders.id |
| `stepText` | `text` | NOT NULL |
| `isAiGenerated` | `boolean` | NOT NULL, DEFAULT |
| `isCompleted` | `boolean` | NOT NULL, DEFAULT |
| `completedAt` | `timestamp` |  |
| `sortOrder` | `integer` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `order_concept_run_logs`

Drizzle-variabel: `orderConceptRunLogs`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `orderConceptId` | `varchar` | NOT NULL, FK→orderConcepts.id |
| `runType` | `text` | NOT NULL |
| `tasksSkipped` | `integer` | DEFAULT |
| `changesDetected` | `integer` | DEFAULT |
| `details` | `jsonb` |  |
| `runAt` | `timestamp` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `order_concepts`

Drizzle-variabel: `orderConcepts`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `description` | `text` |  |
| `pricePerUnit` | `real` |  |
| `monthlyFee` | `real` |  |
| `subscriptionMetadataField` | `text` |  |
| `allowedWeekdays` | `integer` | ARRAY |
| `excludedWeekdays` | `integer` | ARRAY |
| `activeSeason` | `text` |  |
| `timesPerPeriod` | `integer` |  |
| `periodType` | `text` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `customerMode` | `text` | NOT NULL, DEFAULT |
| `customerId` | `varchar` |  |
| `invoiceLevel` | `text` |  |
| `invoiceModel` | `text` |  |
| `invoicePeriod` | `text` |  |
| `invoiceLock` | `boolean` | DEFAULT |
| `deliveryModel` | `text` |  |
| `deliveryStart` | `timestamp` |  |
| `deliveryEnd` | `timestamp` |  |
| `monthlyFeeCalc` | `real` |  |
| `contractLengthMonths` | `integer` |  |
| `totalObjects` | `integer` | DEFAULT |
| `totalArticles` | `integer` | DEFAULT |
| `totalCost` | `real` | DEFAULT |
| `totalValue` | `real` | DEFAULT |
| `estimatedHours` | `real` | DEFAULT |
| `orderMetadata` | `jsonb` |  |
| `createdBy` | `varchar` | FK→users.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `route_feedback`

Drizzle-variabel: `routeFeedback`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL |
| `resourceId` | `varchar` | NOT NULL |
| `date` | `varchar` | NOT NULL |
| `rating` | `integer` | NOT NULL |
| `reasonCategory` | `varchar` |  |
| `freeText` | `text` |  |
| `workSessionId` | `varchar` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `sla_risk_settings`

Drizzle-variabel: `slaRiskSettings`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `tenantId` | `varchar` | PK, FK→tenants.id |
| `warningDaysToBreach` | `integer` | NOT NULL, DEFAULT |
| `criticalDaysToBreach` | `integer` | NOT NULL, DEFAULT |
| `backlogOverloadFactor` | `real` | NOT NULL, DEFAULT |
| `defaultMaxDaysToComplete` | `integer` | NOT NULL, DEFAULT |
| `notifyOnWarningToCritical` | `boolean` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `sla_risk_snapshots`

Drizzle-variabel: `slaRiskSnapshots`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | NOT NULL |
| `clusterId` | `varchar` |  |
| `calculatedAt` | `timestamp` | NOT NULL, DEFAULT |
| `predictedCompletionDate` | `timestamp` |  |
| `deadlineAt` | `timestamp` |  |
| `riskLevel` | `text` | NOT NULL, DEFAULT |
| `daysToBreach` | `real` |  |
| `reason` | `text` |  |
| `previousRiskLevel` | `text` |  |

### `task_dependencies`

Drizzle-variabel: `taskDependencies`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `task_dependency_instances`

Drizzle-variabel: `taskDependencyInstances`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `parentWorkOrderId` | `varchar` | NOT NULL, FK→workOrders.id |
| `childWorkOrderId` | `varchar` | NOT NULL, FK→workOrders.id |
| `dependencyType` | `text` | NOT NULL |
| `completed` | `boolean` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `task_dependency_templates`

Drizzle-variabel: `taskDependencyTemplates`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `articleId` | `varchar` | NOT NULL, FK→articles.id |
| `dependentArticleId` | `varchar` | NOT NULL, FK→articles.id |
| `dependencyType` | `text` | NOT NULL |
| `orderIndex` | `integer` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `task_desired_timewindows`

Drizzle-variabel: `taskDesiredTimewindows`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | NOT NULL, FK→workOrders.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `task_information`

Drizzle-variabel: `taskInformation`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | NOT NULL, FK→workOrders.id |
| `createdBy` | `varchar` | FK→users.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `task_metadata_updates`

Drizzle-variabel: `taskMetadataUpdates`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | NOT NULL, FK→workOrders.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `articleId` | `varchar` | FK→articles.id |
| `metadataLabel` | `text` | NOT NULL |
| `previousValue` | `text` |  |
| `newValue` | `text` | NOT NULL |
| `updatedBy` | `varchar` |  |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `urgent_job_assignments`

Drizzle-variabel: `urgentJobAssignments`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `orderId` | `varchar` | FK→workOrders.id |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `status` | `varchar` | NOT NULL, DEFAULT |
| `jobType` | `text` |  |
| `address` | `text` |  |
| `latitude` | `real` |  |
| `longitude` | `real` |  |
| `customerName` | `text` |  |
| `customerPhone` | `text` |  |
| `notes` | `text` |  |
| `articles` | `text` |  |
| `deadline` | `timestamp` |  |
| `declineReason` | `text` |  |
| `startNavigation` | `boolean` | DEFAULT |
| `assignedBy` | `varchar` |  |
| `assignedAt` | `timestamp` | NOT NULL, DEFAULT |
| `acceptedAt` | `timestamp` |  |
| `declinedAt` | `timestamp` |  |
| `arrivedAt` | `timestamp` |  |
| `completedAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `vehicle_schedule`

Drizzle-variabel: `vehicleSchedule`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `vehicleId` | `varchar` | NOT NULL, FK→vehicles.id |
| `date` | `timestamp` | NOT NULL |
| `startTime` | `text` |  |
| `endTime` | `text` |  |
| `isFullDay` | `boolean` | DEFAULT |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `work_order_lines`

Drizzle-variabel: `workOrderLines`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | NOT NULL, FK→workOrders.id |
| `articleId` | `varchar` | NOT NULL, FK→articles.id |
| `quantity` | `integer` | NOT NULL, DEFAULT |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `work_orders`

Drizzle-variabel: `workOrders`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `resourceId` | `varchar` | FK→resources.id |
| `title` | `text` | NOT NULL |
| `description` | `text` |  |
| `orderType` | `text` | NOT NULL, DEFAULT |
| `priority` | `text` | NOT NULL, DEFAULT |
| `scheduledDate` | `timestamp` |  |
| `scheduledStartTime` | `text` |  |
| `plannedWindowEnd` | `timestamp` |  |
| `estimatedDuration` | `integer` | DEFAULT |
| `actualDuration` | `integer` |  |
| `setupTime` | `integer` |  |
| `setupReason` | `text` |  |
| `completedAt` | `timestamp` |  |
| `invoicedAt` | `timestamp` |  |
| `cachedCost` | `integer` | DEFAULT |
| `cachedProductionMinutes` | `integer` | DEFAULT |
| `simulationScenarioId` | `varchar` | FK→simulationScenarios.id |
| `taskLongitude` | `real` |  |
| `onSiteAt` | `timestamp` |  |
| `inspectedAt` | `timestamp` |  |
| `plannedNotes` | `text` |  |
| `notes` | `text` |  |
| `metadata` | `jsonb` | DEFAULT |
| `importBatchId` | `text` |  |
| `etaSmsSent` | `boolean` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

## Fakturering & ekonomi

### `invoice_configurations`

Drizzle-variabel: `invoiceConfigurations`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `orderConceptId` | `varchar` | NOT NULL, FK→orderConcepts.id |
| `headerMetadata` | `jsonb` |  |
| `lineMetadata` | `jsonb` |  |
| `recipients` | `jsonb` |  |
| `showPrices` | `boolean` | DEFAULT |
| `paymentTermsDays` | `integer` | DEFAULT |
| `fortnoxExportEnabled` | `boolean` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `invoice_rules`

Drizzle-variabel: `invoiceRules`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `orderConceptId` | `varchar` | FK→orderConcepts.id |
| `customerId` | `varchar` |  |
| `invoiceType` | `text` | NOT NULL, DEFAULT |
| `contractLock` | `boolean` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `manual_invoice_lines`

Drizzle-variabel: `manualInvoiceLines`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `articleId` | `varchar` | FK→articles.id |
| `description` | `text` | NOT NULL |
| `quantity` | `integer` | NOT NULL, DEFAULT |
| `unitPrice` | `integer` | NOT NULL, DEFAULT |
| `costCenter` | `varchar` |  |
| `project` | `varchar` |  |
| `notes` | `text` |  |
| `invoiceExportId` | `varchar` |  |
| `status` | `varchar` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

## Väder & cache

### `distance_cache`

Drizzle-variabel: `distanceCache`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK |
| `fromLat` | `real` | NOT NULL |
| `fromLng` | `real` | NOT NULL |
| `toLat` | `real` | NOT NULL |
| `toLng` | `real` | NOT NULL |
| `distanceKm` | `real` | NOT NULL |
| `durationMin` | `real` | NOT NULL |
| `source` | `varchar` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `predictive_forecasts`

Drizzle-variabel: `predictiveForecasts`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `deviceId` | `varchar` | FK→iotDevices.id |
| `predictedDate` | `timestamp` | NOT NULL |
| `confidence` | `real` | NOT NULL |
| `avgIntervalDays` | `real` |  |
| `signalCount` | `integer` | DEFAULT |
| `lastSignalAt` | `timestamp` |  |
| `reasoning` | `text` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `weather_forecast_cache`

Drizzle-variabel: `weatherForecastCache`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `cacheKey` | `text` | NOT NULL |
| `forecastDate` | `text` | NOT NULL |
| `latitude` | `real` | NOT NULL |
| `longitude` | `real` | NOT NULL |
| `days` | `integer` | NOT NULL |
| `payload` | `jsonb` | NOT NULL |
| `fetchedAt` | `timestamp` | NOT NULL, DEFAULT |

## Dokument & filer

### `branding_templates`

Drizzle-variabel: `brandingTemplates`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `name` | `text` | NOT NULL |
| `slug` | `varchar` | NOT NULL, UNIQUE |
| `industry` | `text` | NOT NULL |
| `description` | `text` |  |
| `primaryLight` | `varchar` |  |
| `primaryDark` | `varchar` |  |
| `secondaryColor` | `varchar` | NOT NULL |
| `accentColor` | `varchar` | NOT NULL |
| `successColor` | `varchar` | DEFAULT |
| `errorColor` | `varchar` | DEFAULT |
| `defaultSubheading` | `text` |  |
| `usageCount` | `integer` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | DEFAULT |

### `checklist_templates`

Drizzle-variabel: `checklistTemplates`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `articleType` | `text` | NOT NULL |
| `questions` | `jsonb` | NOT NULL, DEFAULT |
| `isActive` | `boolean` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `document_configurations`

Drizzle-variabel: `documentConfigurations`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `orderConceptId` | `varchar` | NOT NULL, FK→orderConcepts.id |
| `documentType` | `text` | NOT NULL |
| `enabled` | `boolean` | DEFAULT |
| `metadataFields` | `jsonb` |  |
| `showPrice` | `boolean` | DEFAULT |
| `recipients` | `jsonb` |  |
| `distributionChannels` | `jsonb` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `resource_profile_assignments`

Drizzle-variabel: `resourceProfileAssignments`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `profileId` | `varchar` | NOT NULL, FK→resourceProfiles.id |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `resource_profiles`

Drizzle-variabel: `resourceProfiles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `description` | `text` |  |
| `executionCodes` | `text` | ARRAY, DEFAULT |
| `equipmentTypes` | `text` | ARRAY, DEFAULT |
| `defaultCostCenter` | `text` |  |
| `projectCode` | `text` |  |
| `serviceArea` | `text` | ARRAY, DEFAULT |
| `color` | `text` | DEFAULT |
| `icon` | `text` | DEFAULT |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `status_message_templates`

Drizzle-variabel: `statusMessageTemplates`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `triggerType` | `text` | NOT NULL |
| `priority` | `integer` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

## Loggar & historik

### `api_usage_logs`

Drizzle-variabel: `apiUsageLogs`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` |  |
| `service` | `varchar` | NOT NULL |
| `endpoint` | `varchar` |  |
| `method` | `varchar` |  |
| `inputTokens` | `integer` |  |
| `outputTokens` | `integer` |  |
| `totalTokens` | `integer` |  |
| `units` | `integer` | DEFAULT |
| `estimatedCostUsd` | `real` |  |
| `model` | `varchar` |  |
| `statusCode` | `integer` |  |
| `durationMs` | `integer` |  |
| `metadata` | `jsonb` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `audit_logs`

Drizzle-variabel: `auditLogs`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | FK→tenants.id |
| `userId` | `varchar` | FK→users.id |
| `resourceId` | `varchar` |  |
| `userAgent` | `text` |  |
| `metadata` | `jsonb` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `budget_alert_log`

Drizzle-variabel: `budgetAlertLog`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL |
| `thresholdPercent` | `integer` | NOT NULL |
| `currentUsageUsd` | `real` | NOT NULL |
| `monthlyBudgetUsd` | `real` | NOT NULL |
| `percentUsed` | `real` | NOT NULL |
| `monthKey` | `varchar` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `feature_audit_log`

Drizzle-variabel: `featureAuditLog`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `serial` | PK |
| `tenantId` | `varchar` | NOT NULL |
| `action` | `varchar` | NOT NULL |
| `previousTier` | `varchar` |  |
| `newTier` | `varchar` | NOT NULL |
| `previousModules` | `text` | ARRAY |
| `newModules` | `text` | NOT NULL, ARRAY |
| `changedBy` | `varchar` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `fuel_logs`

Drizzle-variabel: `fuelLogs`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `vehicleId` | `varchar` | NOT NULL, FK→vehicles.id |
| `date` | `timestamp` | NOT NULL |
| `liters` | `real` | NOT NULL |
| `costSek` | `real` |  |
| `pricePerLiter` | `real` |  |
| `fuelType` | `text` | DEFAULT |
| `odometerReading` | `integer` |  |
| `fullTank` | `boolean` | DEFAULT |
| `station` | `text` |  |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `maintenance_logs`

Drizzle-variabel: `maintenanceLogs`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `vehicleId` | `varchar` | NOT NULL, FK→vehicles.id |
| `date` | `timestamp` | NOT NULL |
| `maintenanceType` | `text` | NOT NULL |
| `description` | `text` | NOT NULL |
| `costSek` | `real` |  |
| `odometerReading` | `integer` |  |
| `workshop` | `text` |  |
| `nextMaintenanceDate` | `timestamp` |  |
| `nextMaintenanceOdometer` | `integer` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `metadata_katalog`

Drizzle-variabel: `metadataKatalog`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `namn` | `varchar` | NOT NULL |
| `beskrivning` | `text` |  |
| `datatyp` | `text` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `offline_sync_log`

Drizzle-variabel: `offlineSyncLog`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `resourceId` | `varchar` | NOT NULL |
| `clientId` | `text` | NOT NULL |
| `actionType` | `text` | NOT NULL |
| `payload` | `jsonb` | NOT NULL, DEFAULT |
| `status` | `text` | NOT NULL, DEFAULT |
| `errorMessage` | `text` |  |
| `processedAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `planning_decision_log`

Drizzle-variabel: `planningDecisionLog`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `serial` | PK |
| `tenantId` | `varchar` | NOT NULL |
| `userId` | `varchar` |  |
| `weekStart` | `varchar` | NOT NULL |
| `weekEnd` | `varchar` | NOT NULL |
| `summary` | `jsonb` | NOT NULL |
| `moveCount` | `integer` | NOT NULL, DEFAULT |
| `violationCount` | `integer` | NOT NULL, DEFAULT |
| `riskScore` | `real` | DEFAULT |
| `totalOrdersScheduled` | `integer` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `setup_time_logs`

Drizzle-variabel: `setupTimeLogs`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | FK→workOrders.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `resourceId` | `varchar` | FK→resources.id |
| `category` | `text` | NOT NULL, DEFAULT |
| `durationMinutes` | `integer` | NOT NULL |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `time_logs`

Drizzle-variabel: `timeLogs`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `week` | `integer` | NOT NULL |
| `year` | `integer` | NOT NULL |
| `work` | `integer` | NOT NULL, DEFAULT |
| `travel` | `integer` | NOT NULL, DEFAULT |
| `setup` | `integer` | NOT NULL, DEFAULT |
| `breakTime` | `integer` | NOT NULL, DEFAULT |
| `rest` | `integer` | NOT NULL, DEFAULT |
| `total` | `integer` | NOT NULL, DEFAULT |
| `budgetHours` | `integer` | NOT NULL, DEFAULT |
| `resourceName` | `varchar` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | DEFAULT |

## Inställningar & integrationer

### `mobile_user_preferences`

Drizzle-variabel: `mobileUserPreferences`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `darkMode` | `boolean` | NOT NULL, DEFAULT |
| `fontSize` | `varchar` | NOT NULL, DEFAULT |
| `hapticFeedback` | `boolean` | NOT NULL, DEFAULT |
| `pushEnabled` | `boolean` | NOT NULL, DEFAULT |
| `pushCategories` | `jsonb` | NOT NULL, DEFAULT |
| `mapType` | `varchar` | NOT NULL, DEFAULT |
| `showTraffic` | `boolean` | NOT NULL, DEFAULT |
| `breakReminders` | `boolean` | NOT NULL, DEFAULT |
| `menuOrder` | `jsonb` | NOT NULL, DEFAULT |
| `language` | `varchar` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

## Övrigt

### `annual_goals`

Drizzle-variabel: `annualGoals`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | FK→customers.id |
| `objectId` | `varchar` | FK→objects.id |
| `clusterId` | `varchar` | FK→clusters.id |
| `articleType` | `text` | NOT NULL |
| `targetCount` | `integer` | NOT NULL |
| `year` | `integer` | NOT NULL |
| `notes` | `text` |  |
| `sourceType` | `text` | DEFAULT |
| `sourceId` | `varchar` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `api_budgets`

Drizzle-variabel: `apiBudgets`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` |  |
| `service` | `varchar` | NOT NULL |
| `monthlyBudgetUsd` | `real` | NOT NULL |
| `alertThresholdPercent` | `integer` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `assignments`

Drizzle-variabel: `assignments`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `description` | `text` |  |
| `scheduledStartTime` | `text` |  |
| `scheduledEndTime` | `text` |  |
| `plannedWindowEnd` | `timestamp` |  |
| `actualDuration` | `integer` |  |
| `latitude` | `real` |  |
| `longitude` | `real` |  |
| `what3words` | `text` |  |
| `cachedCost` | `integer` | DEFAULT |
| `photoAfterId` | `varchar` |  |
| `photoBeforeRequired` | `boolean` | DEFAULT |
| `photoAfterRequired` | `boolean` | DEFAULT |
| `completedAt` | `timestamp` |  |
| `invoicedAt` | `timestamp` |  |
| `createdBy` | `varchar` | FK→users.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `conversations`

Drizzle-variabel: `conversations`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `title` | `text` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `deviation_reports`

Drizzle-variabel: `deviationReports`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `protocolId` | `varchar` | FK→protocols.id |
| `description` | `text` |  |
| `severityLevel` | `text` | NOT NULL, DEFAULT |
| `reportedByName` | `text` |  |
| `reportedAt` | `timestamp` | NOT NULL, DEFAULT |
| `longitude` | `real` |  |
| `estimatedCost` | `integer` |  |
| `resolvedBy` | `varchar` | FK→users.id |
| `resolutionNotes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | DEFAULT |

### `driver_notifications`

Drizzle-variabel: `driverNotifications`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `resourceId` | `varchar` | NOT NULL |
| `type` | `text` | NOT NULL |
| `title` | `text` | NOT NULL |
| `message` | `text` | NOT NULL |
| `orderId` | `varchar` |  |
| `data` | `jsonb` | DEFAULT |
| `isRead` | `boolean` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `environmental_data`

Drizzle-variabel: `environmentalData`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | FK→workOrders.id |
| `resourceId` | `varchar` | FK→resources.id |
| `vehicleId` | `varchar` | FK→vehicles.id |
| `odometerStart` | `integer` |  |
| `odometerEnd` | `integer` |  |
| `fuelType` | `text` |  |
| `co2CalculationMethod` | `text` | DEFAULT |
| `wasteType` | `text` |  |
| `createdBy` | `varchar` | FK→users.id |

### `equipment`

Drizzle-variabel: `equipment`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `notes` | `text` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `equipment_bookings`

Drizzle-variabel: `equipmentBookings`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `vehicleId` | `varchar` | FK→vehicles.id |
| `equipmentId` | `varchar` | FK→equipment.id |
| `resourceId` | `varchar` | FK→resources.id |
| `teamId` | `varchar` | FK→teams.id |
| `workSessionId` | `varchar` | FK→workSessions.id |
| `date` | `timestamp` | NOT NULL |
| `serviceArea` | `text` | ARRAY, DEFAULT |
| `status` | `text` | NOT NULL, DEFAULT |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `eta_notifications`

Drizzle-variabel: `etaNotifications`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | NOT NULL, FK→workOrders.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `resourceId` | `varchar` | FK→resources.id |
| `channel` | `text` | NOT NULL |
| `notificationType` | `text` | NOT NULL |
| `recipientEmail` | `text` |  |
| `recipientPhone` | `text` |  |
| `etaMinutes` | `integer` |  |
| `etaTime` | `text` |  |
| `marginMinutes` | `integer` | DEFAULT |
| `status` | `text` | NOT NULL, DEFAULT |
| `errorMessage` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `import_batches`

Drizzle-variabel: `importBatches`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `batchId` | `varchar` | NOT NULL |
| `totalRows` | `integer` | DEFAULT |
| `created` | `integer` | DEFAULT |
| `updated` | `integer` | DEFAULT |
| `errors` | `integer` | DEFAULT |
| `scorecardSummary` | `jsonb` |  |
| `metadata` | `jsonb` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `industry_package_data`

Drizzle-variabel: `industryPackageData`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `packageId` | `varchar` | NOT NULL, FK→industryPackages.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | DEFAULT |

### `industry_packages`

Drizzle-variabel: `industryPackages`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `slug` | `varchar` | NOT NULL, UNIQUE |
| `name` | `text` | NOT NULL |
| `nameEn` | `text` |  |
| `description` | `text` |  |
| `descriptionEn` | `text` |  |
| `industry` | `varchar` | NOT NULL |
| `suggestedSecondaryColor` | `varchar` | DEFAULT |
| `suggestedAccentColor` | `varchar` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `inspection_metadata`

Drizzle-variabel: `inspectionMetadata`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | FK→workOrders.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `inspectionType` | `text` | NOT NULL |
| `status` | `text` | NOT NULL |
| `issues` | `jsonb` | DEFAULT |
| `comment` | `text` |  |
| `photoUrls` | `jsonb` | DEFAULT |
| `inspectedBy` | `varchar` |  |
| `inspectedAt` | `timestamp` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `iot_api_keys`

Drizzle-variabel: `iotApiKeys`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `apiKey` | `varchar` | NOT NULL, UNIQUE |
| `name` | `varchar` | NOT NULL |
| `status` | `text` | NOT NULL, DEFAULT |
| `lastUsedAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `iot_devices`

Drizzle-variabel: `iotDevices`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `deviceType` | `text` | NOT NULL |
| `externalDeviceId` | `varchar` |  |
| `lastSignal` | `text` |  |
| `lastSignalAt` | `timestamp` |  |
| `batteryLevel` | `integer` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `iot_signals`

Drizzle-variabel: `iotSignals`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `deviceId` | `varchar` | NOT NULL, FK→iotDevices.id |
| `signalType` | `text` | NOT NULL |
| `payload` | `text` |  |
| `processed` | `boolean` | NOT NULL, DEFAULT |
| `workOrderId` | `varchar` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `messages`

Drizzle-variabel: `messages`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `conversationId` | `varchar` | NOT NULL, FK→conversations.id |
| `role` | `text` | NOT NULL |
| `content` | `text` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `metadata_definitions`

Drizzle-variabel: `metadataDefinitions`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `fieldLabel` | `text` | NOT NULL |
| `isRequired` | `boolean` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `metadata_historik`

Drizzle-variabel: `metadataHistorik`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `metadataVardenId` | `varchar` | NOT NULL, FK→metadataVarden.id |
| `objektId` | `varchar` | FK→objects.id |
| `metadataKatalogId` | `varchar` | FK→metadataKatalog.id |
| `gammaltVarde` | `text` |  |
| `nyttVarde` | `text` |  |
| `andradAv` | `varchar` |  |
| `andradVid` | `timestamp` | NOT NULL, DEFAULT |
| `andringsMetod` | `varchar` |  |

### `metadata_varden`

Drizzle-variabel: `metadataVarden`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objektId` | `varchar` | FK→objects.id |
| `vardeInteger` | `integer` |  |
| `vardeDecimal` | `real` |  |
| `vardeBoolean` | `boolean` |  |
| `vardeDatetime` | `timestamp` |  |
| `vardeJson` | `jsonb` |  |
| `vardeReferens` | `varchar` |  |
| `uppdateradAv` | `varchar` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `planning_parameters`

Drizzle-variabel: `planningParameters`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | FK→objects.id |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `portal_messages`

Drizzle-variabel: `portalMessages`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` |  |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `resourceId` | `varchar` | FK→resources.id |
| `senderType` | `text` | NOT NULL |
| `senderName` | `text` |  |
| `message` | `text` | NOT NULL |
| `messageType` | `text` | DEFAULT |
| `isRead` | `boolean` | DEFAULT |
| `readAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `price_lists`

Drizzle-variabel: `priceLists`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `validFrom` | `timestamp` |  |
| `validTo` | `timestamp` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `procurements`

Drizzle-variabel: `procurements`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | FK→customers.id |
| `title` | `text` | NOT NULL |
| `referenceNumber` | `text` |  |
| `description` | `text` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `deadline` | `timestamp` |  |
| `startDate` | `timestamp` |  |
| `endDate` | `timestamp` |  |
| `estimatedValue` | `integer` |  |
| `objectIds` | `text` | ARRAY, DEFAULT |
| `containerCountTotal` | `integer` | DEFAULT |
| `estimatedHoursPerWeek` | `integer` |  |
| `notes` | `text` |  |
| `metadata` | `jsonb` | DEFAULT |
| `submittedAt` | `timestamp` |  |
| `wonAt` | `timestamp` |  |
| `lostAt` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `protocols`

Drizzle-variabel: `protocols`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `executedBy` | `varchar` | FK→users.id |
| `executedByName` | `text` |  |
| `afterPhotoUrl` | `text` |  |
| `additionalPhotos` | `text` | ARRAY |
| `signedAt` | `timestamp` |  |
| `pdfGeneratedAt` | `timestamp` |  |
| `sentAt` | `timestamp` |  |
| `status` | `text` | NOT NULL, DEFAULT |

### `public_issue_reports`

Drizzle-variabel: `publicIssueReports`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `reporterEmail` | `text` |  |
| `reporterPhone` | `text` |  |
| `description` | `text` |  |
| `longitude` | `real` |  |
| `userAgent` | `text` |  |
| `linkedWorkOrderId` | `varchar` |  |
| `reviewedAt` | `timestamp` |  |
| `reviewNotes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `push_tokens`

Drizzle-variabel: `pushTokens`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `serial` | PK |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `expoPushToken` | `text` | NOT NULL |
| `platform` | `text` | NOT NULL |
| `createdAt` | `timestamp` | DEFAULT |
| `updatedAt` | `timestamp` | DEFAULT |

### `qr_code_links`

Drizzle-variabel: `qrCodeLinks`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `lastScannedAt` | `timestamp` |  |
| `createdBy` | `varchar` | FK→users.id |

### `recurring_slot_patterns`

Drizzle-variabel: `recurringSlotPatterns`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `dayOfWeek` | `integer` | NOT NULL |
| `startTime` | `text` | NOT NULL |
| `endTime` | `text` | NOT NULL |
| `maxBookings` | `integer` | DEFAULT |
| `serviceTypes` | `jsonb` | DEFAULT |
| `resourceId` | `varchar` | FK→resources.id |
| `isActive` | `boolean` | DEFAULT |
| `generatedUntil` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `createdBy` | `varchar` | FK→users.id |

### `resource_availability`

Drizzle-variabel: `resourceAvailability`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `resource_equipment`

Drizzle-variabel: `resourceEquipment`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `equipmentId` | `varchar` | NOT NULL, FK→equipment.id |
| `assignedTo` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `resource_positions`

Drizzle-variabel: `resourcePositions`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `latitude` | `real` | NOT NULL |
| `longitude` | `real` | NOT NULL |
| `recordedAt` | `timestamp` | NOT NULL, DEFAULT |

### `resource_vehicles`

Drizzle-variabel: `resourceVehicles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `vehicleId` | `varchar` | NOT NULL, FK→vehicles.id |
| `validTo` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `resources`

Drizzle-variabel: `resources`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `userId` | `varchar` | FK→users.id |
| `name` | `text` | NOT NULL |
| `initials` | `text` |  |
| `resourceType` | `text` | NOT NULL, DEFAULT |
| `phone` | `text` |  |
| `email` | `text` |  |
| `homeLocation` | `text` |  |
| `homeLongitude` | `real` |  |
| `currentLongitude` | `real` |  |
| `lastPositionUpdate` | `timestamp` |  |
| `weeklyHours` | `integer` | DEFAULT |
| `competencies` | `text` | ARRAY, DEFAULT |
| `availability` | `jsonb` | DEFAULT |
| `isOnline` | `boolean` | DEFAULT |
| `lastSeenAt` | `timestamp` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `smsOnExtraJob` | `boolean` | NOT NULL, DEFAULT |
| `lastSchedulePeriodStart` | `text` |  |
| `lastSchedulePeriodEnd` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `roi_share_tokens`

Drizzle-variabel: `roiShareTokens`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `token` | `varchar` | PK |
| `tenantId` | `varchar` | NOT NULL |
| `customerId` | `varchar` | NOT NULL |
| `expiresAt` | `timestamp` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `scheduling_locks`

Drizzle-variabel: `schedulingLocks`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `tenantId` | `varchar` | PK |
| `acquiredAt` | `timestamp` | NOT NULL, DEFAULT |
| `expiresAt` | `timestamp` | NOT NULL |

### `self_booking_slots`

Drizzle-variabel: `selfBookingSlots`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `resourceId` | `varchar` | FK→resources.id |
| `teamId` | `varchar` | FK→teams.id |
| `slotDate` | `timestamp` | NOT NULL |
| `startTime` | `text` | NOT NULL |
| `currentBookings` | `integer` | DEFAULT |
| `serviceTypes` | `jsonb` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `createdBy` | `varchar` | FK→users.id |

### `self_bookings`

Drizzle-variabel: `selfBookings`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `slotId` | `varchar` | FK→selfBookingSlots.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `objectId` | `varchar` | FK→objects.id |
| `serviceType` | `text` | NOT NULL |
| `status` | `text` | NOT NULL, DEFAULT |
| `customerNotes` | `text` |  |
| `confirmedAt` | `timestamp` |  |
| `cancelledAt` | `timestamp` |  |
| `cancelReason` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `simulation_scenarios`

Drizzle-variabel: `simulationScenarios`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `description` | `text` |  |
| `createdBy` | `varchar` |  |
| `baselineSnapshot` | `jsonb` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `subscription_changes`

Drizzle-variabel: `subscriptionChanges`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `orderConceptId` | `varchar` | NOT NULL, FK→orderConcepts.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `changeType` | `text` | NOT NULL |
| `newValue` | `text` |  |
| `monthlyDelta` | `real` |  |
| `approvedAt` | `timestamp` |  |
| `detectedAt` | `timestamp` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `subscriptions`

Drizzle-variabel: `subscriptions`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `objectId` | `varchar` | NOT NULL, FK→objects.id |
| `name` | `text` | NOT NULL |
| `description` | `text` |  |
| `notes` | `text` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `team_members`

Drizzle-variabel: `teamMembers`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `teamId` | `varchar` | NOT NULL, FK→teams.id |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `validTo` | `timestamp` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `teams`

Drizzle-variabel: `teams`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `description` | `text` |  |
| `color` | `text` | DEFAULT |
| `status` | `text` | NOT NULL, DEFAULT |
| `profileIds` | `text` | ARRAY, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `technician_ratings`

Drizzle-variabel: `technicianRatings`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | NOT NULL |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `resourceId` | `varchar` | FK→resources.id |
| `rating` | `integer` | NOT NULL |
| `categories` | `jsonb` | DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `tenant_branding`

Drizzle-variabel: `tenantBranding`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, UNIQUE, FK→tenants.id |
| `isPublished` | `boolean` | DEFAULT |
| `primaryLight` | `varchar` |  |
| `primaryDark` | `varchar` |  |
| `secondaryColor` | `varchar` | DEFAULT |
| `accentColor` | `varchar` | DEFAULT |
| `successColor` | `varchar` | DEFAULT |
| `errorColor` | `varchar` | DEFAULT |
| `logoIconUrl` | `varchar` |  |
| `faviconUrl` | `varchar` |  |
| `tagline` | `text` |  |
| `headingText` | `text` |  |
| `subheadingText` | `text` |  |
| `updatedBy` | `varchar` | FK→users.id |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | DEFAULT |
| `publishedAt` | `timestamp` |  |

### `tenant_features`

Drizzle-variabel: `tenantFeatures`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `tenantId` | `varchar` | PK, FK→tenants.id |
| `packageTier` | `varchar` | NOT NULL, DEFAULT |
| `enabledModules` | `text` | NOT NULL, ARRAY, DEFAULT |
| `customOverrides` | `jsonb` | DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedBy` | `varchar` |  |

### `tenant_labels`

Drizzle-variabel: `tenantLabels`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `labelKey` | `varchar` | NOT NULL |
| `labelValue` | `text` | NOT NULL |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

### `tenant_package_installations`

Drizzle-variabel: `tenantPackageInstallations`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `packageId` | `varchar` | NOT NULL, FK→industryPackages.id |
| `installedAt` | `timestamp` | NOT NULL, DEFAULT |
| `installedBy` | `varchar` | FK→users.id |
| `metadataInstalled` | `integer` | DEFAULT |
| `structuralArticlesInstalled` | `integer` | DEFAULT |

### `vehicles`

Drizzle-variabel: `vehicles`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `name` | `text` | NOT NULL |
| `notes` | `text` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `deletedAt` | `timestamp` |  |

### `visit_confirmations`

Drizzle-variabel: `visitConfirmations`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workOrderId` | `varchar` | FK→workOrders.id |
| `customerId` | `varchar` | NOT NULL, FK→customers.id |
| `confirmedAt` | `timestamp` | NOT NULL, DEFAULT |
| `confirmationStatus` | `text` | NOT NULL, DEFAULT |
| `customerComment` | `text` |  |
| `signatureUrl` | `text` |  |
| `confirmedByName` | `text` |  |
| `confirmedByEmail` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `work_entries`

Drizzle-variabel: `workEntries`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `workSessionId` | `varchar` | NOT NULL, FK→workSessions.id |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `entryType` | `text` | NOT NULL, DEFAULT |
| `workOrderId` | `varchar` | FK→workOrders.id |
| `startTime` | `timestamp` | NOT NULL |
| `endTime` | `timestamp` |  |
| `durationMinutes` | `integer` |  |
| `latitude` | `real` |  |
| `longitude` | `real` |  |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |

### `work_sessions`

Drizzle-variabel: `workSessions`

| Kolumn | Typ | Egenskaper |
|---|---|---|
| `id` | `varchar` | PK, DEFAULT |
| `tenantId` | `varchar` | NOT NULL, FK→tenants.id |
| `teamId` | `varchar` | FK→teams.id |
| `resourceId` | `varchar` | NOT NULL, FK→resources.id |
| `date` | `timestamp` | NOT NULL |
| `startTime` | `timestamp` | NOT NULL |
| `endTime` | `timestamp` |  |
| `status` | `text` | NOT NULL, DEFAULT |
| `notes` | `text` |  |
| `createdAt` | `timestamp` | NOT NULL, DEFAULT |
| `updatedAt` | `timestamp` | NOT NULL, DEFAULT |

