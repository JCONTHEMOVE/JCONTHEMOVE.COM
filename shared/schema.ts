import { normalizeCustomerPhone, phoneError } from "./phone";
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, index, jsonb, decimal, integer, bigint, date, boolean, uniqueIndex, unique, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Define photo structure for job documentation
export const jobPhotoSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  type: z.enum(["before", "after", "progress", "issue"]),
  description: z.string().optional(),
  timestamp: z.string().datetime(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }).optional(),
});

export type JobPhoto = z.infer<typeof jobPhotoSchema>;

export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderNumber: serial("order_number"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  serviceType: text("service_type").notNull(), // 'residential', 'junk', 'snow', 'cleaning', 'handyman', 'demolition', 'flooring', 'painting'
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address"),
  moveDate: text("move_date"),
  propertySize: text("property_size"),
  details: text("details"),
  source: text("source"), // 'quick_request', 'web_multi_book', 'crew_add_job', etc. for funnel/source reporting
  status: text("status").notNull().default("quote_requested"), // 'quote_requested', 'available', 'completed'
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  createdByUserId: varchar("created_by_user_id").references(() => users.id), // Track employee who created the job for rewards
  truckConfig: text("truck_config"), // 'customer_truck', 'company_truck', 'no_truck'
  trailerRequested: boolean("trailer_requested").notNull().default(false),
  // Non-sensitive operational details used by the unified job card. Entry
  // codes and private arrival instructions live in the encrypted companion
  // column below so they never appear in ordinary lead projections.
  jobPlanDetails: jsonb("job_plan_details").default("{}"),
  accessInstructionsCiphertext: text("access_instructions_ciphertext"),
  // Staff intake keeps the human-readable truck choice alongside the legacy
  // configuration field so the calendar, lead detail, and quote snapshot agree.
  truckProvider: text("truck_provider"), // 'jc_on_the_move' | 'customer' | 'rental_uhaul' | 'none'
  truckSize: text("truck_size"), // 'none' | '15_ft' | '20_ft' | '26_ft' | 'custom'
  crewSize: integer("crew_size").default(2), // Number of crew members needed (2 is standard)
  acceptedByEmployees: text("accepted_by_employees").array().default(sql`ARRAY[]::text[]`), // Track which employees have accepted this job
  photos: jsonb("photos").default("[]"), // Array of photo objects with metadata
  
  // Quote and pricing fields
  confirmedDate: text("confirmed_date"), // Admin confirmed move date
  confirmedFromAddress: text("confirmed_from_address"), // Admin confirmed pickup address
  confirmedToAddress: text("confirmed_to_address"), // Admin confirmed delivery address
  basePrice: decimal("base_price", { precision: 10, scale: 2 }), // Base moving quote
  tokenAllocation: decimal("token_allocation", { precision: 18, scale: 8 }), // JCMOVES tokens allocated for this job
  // Immutable rate-card amount used for paid-completion JCMOVES. This is
  // deliberately separate from totalPrice so an approved discount or fixed
  // package never changes the rewards customers and crew were shown.
  jcmovesRewardBase: decimal("jcmoves_reward_base", { precision: 10, scale: 2 }),
  paymentPlan: text("payment_plan"),
  paymentPaidAt: timestamp("payment_paid_at"),
  financialStatus: text("financial_status").notNull().default("quote"),
  finalBalanceAmount: decimal("final_balance_amount", { precision: 10, scale: 2 }),
  finalInvoiceUrl: text("final_invoice_url"),
  closeoutStatus: text("closeout_status"),
  crewMembers: text("crew_members").array(), // Array of assigned employee IDs
  crewLeadUserId: varchar("crew_lead_user_id").references(() => users.id),
  driverUserId: varchar("driver_user_id").references(() => users.id),
  crewBonusFlags: jsonb("crew_bonus_flags").default("{}"), // Legacy only; canonical payouts use job assignments and quarterly profit-bonus weights.
  squareOrderId: varchar("square_order_id"), // Square Order ID created when Build Order is applied
  
  // Special moving items with weight tracking
  hasHotTub: boolean("has_hot_tub").default(false),
  hotTubWeight: integer("hot_tub_weight"), // Weight in pounds
  hotTubFee: decimal("hot_tub_fee", { precision: 10, scale: 2 }),
  
  hasHeavySafe: boolean("has_heavy_safe").default(false),
  heavySafeWeight: integer("heavy_safe_weight"), // Weight in pounds
  heavySafeFee: decimal("heavy_safe_fee", { precision: 10, scale: 2 }),
  
  hasPoolTable: boolean("has_pool_table").default(false),
  poolTableWeight: integer("pool_table_weight"), // Weight in pounds
  poolTableFee: decimal("pool_table_fee", { precision: 10, scale: 2 }),
  
  hasPiano: boolean("has_piano").default(false),
  pianoWeight: integer("piano_weight"), // Weight in pounds
  pianoFee: decimal("piano_fee", { precision: 10, scale: 2 }),
  
  totalSpecialItemsFee: decimal("total_special_items_fee", { precision: 10, scale: 2 }).default("0.00"),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }), // Base + special items
  
  // Quote management fields
  confirmedHours: integer("confirmed_hours"), // Confirmed job hours (from order builder package selection)
  orderLineItems: jsonb("order_line_items").default("[]"), // Itemized order line items from order builder
  quoteNotes: text("quote_notes"), // Project-specific notes and updates
  lastQuoteUpdatedAt: timestamp("last_quote_updated_at"), // Track when quote was last modified
  
  // SMS consent for customer communication
  smsConsent: boolean("sms_consent").default(false), // Customer opted in to receive SMS notifications
  smsConsentRecordedAt: timestamp("sms_consent_recorded_at"),
  smsConsentSource: text("sms_consent_source"), // e.g. 'web_form' | 'verbal_staff'
  smsConsentRecordedBy: varchar("sms_consent_recorded_by").references(() => users.id),
  
  // Token distribution tracking
  completionRewardedAt: timestamp("completion_rewarded_at"), // Timestamp when job completion tokens were distributed (idempotency flag)
  tokensDisbursedAt: timestamp("tokens_disbursed_at"), // Alias for completionRewardedAt — set by disburseJobTokens service
  
  // Promo code for discounts
  promoCode: text("promo_code"), // Customer-entered promo code for discounts

  // Reward redemption linking
  redemptionId: integer("redemption_id"), // Linked reward_redemptions.id if this job was created by a redemption
  appliedCreditNote: text("applied_credit_note"), // Human-readable summary of discount/credit applied from redemption

  // Customer-selected package from service-packages page
  selectedPackageId: text("selected_package_id"), // e.g. "moving_3m_3h", "junk_half"

  // Review/tip link token (so customers can leave a review without logging in)
  reviewToken: varchar("review_token").unique(),
  reviewRequestSentAt: timestamp("review_request_sent_at"),

  // Quote dispatch fields
  quoteSentAt: timestamp("quote_sent_at"),
  quoteViewedAt: timestamp("quote_viewed_at"),
  arrivalWindow: text("arrival_window"), // e.g. "9:00 AM – 11:00 AM"
  squarePaymentUrl: text("square_payment_url"), // hosted Square payment page URL embedded in quote email

  // Deposit gate for quote-only / out-of-area services
  depositRequired: boolean("deposit_required").default(false),
  depositAmount: decimal("deposit_amount_gate", { precision: 10, scale: 2 }),
  depositPaid: boolean("deposit_paid").default(false),
  isQuoteOnly: boolean("is_quote_only").default(false),

  // Crew dispatch tracking
  dispatchSentAt: timestamp("dispatch_sent_at"),
  dispatchNotes: text("dispatch_notes"),

  // Soft-delete: set when admin archives a job instead of permanently deleting
  archivedAt: timestamp("archived_at"),

  // Bundle follow-up email tracking
  bundleFollowupSentAt: timestamp("bundle_followup_sent_at"), // When 10% follow-up email was sent
  bundle5SentAt: timestamp("bundle5_sent_at"),               // When 5% reminder email was sent

  // Auto-applied bundle discount (Task #114). Captured at quote time so the
  // Square invoice + admin email can apply it deterministically without
  // recomputing eligibility later. Set to 0 / null when no discount applied.
  bundleDiscountAmount: decimal("bundle_discount_amount", { precision: 10, scale: 2 }).default("0"),
  bundleDiscountReason: text("bundle_discount_reason"), // 'bundle_intent' | 'cross_service_history'

  // Bundle grouping (Task #115). When a customer schedules multiple services
  // in one booking flow, every resulting record (primary quote + companion
  // leads) shares this UUID so we can render them as a single grouped card
  // in /my-jobs and present the bundle as one unit in admin views.
  bundleGroupId: text("bundle_group_id"),
  bookingId: varchar("booking_id"), // Linked multi-service booking snapshot, if created from /book
  quoteSnapshot: jsonb("quote_snapshot").default("{}"), // Frozen quote/booking details for ops review
  zoneSnapshot: jsonb("zone_snapshot").default("{}"), // Frozen pricing-zone match/rate data

  // Re-book email attribution (Task #108). Set when a customer arrives at a
  // booking page from a re-book reminder email and is tagged with the
  // service-specific utm_source (e.g. 'rebook_email_snow'). Stays NULL for
  // brand-new leads and 'organic' for returning customers who came back on
  // their own. Mirrors lawnCareQuotes.rebookSource.
  rebookSource: text("rebook_source"),
  // Timestamp of the originating re-book reminder email (forwarded as
  // rebookSentAt query param on the deep link). Server-side validated and
  // clamped to a recent window so a customer can't backdate attribution.
  rebookSentAt: timestamp("rebook_sent_at"),

  // Task #172/#173 — dispatch service state machine (columns also
  // created/maintained via raw SQL in server/dispatch/migrate.ts so the
  // app works even if drizzle push hasn't landed yet).
  dispatchState: text("dispatch_state").default("pending"),
  dispatchOfferedTo: varchar("dispatch_offered_to"),
  dispatchOfferExpiresAt: timestamp("dispatch_offer_expires_at"),
  dispatchTriedIds: text("dispatch_tried_ids").array().default(sql`ARRAY[]::text[]`),
  enRouteAt: timestamp("en_route_at"),
  onSiteAt: timestamp("on_site_at"),
  completedAt: timestamp("completed_at"),
  lat: decimal("lat", { precision: 10, scale: 7 }),
  lng: decimal("lng", { precision: 10, scale: 7 }),
  urgency: text("urgency").default("normal"),

  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Task #173 — live GPS pings from on-duty crew. One row per crew member,
// updated via upsert each time the client posts a location. Used by the
// admin dispatch map and for future geofenced on-site auto-detection.
export const crewLocations = pgTable("crew_locations", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  lat: decimal("lat", { precision: 10, scale: 7 }).notNull(),
  lng: decimal("lng", { precision: 10, scale: 7 }).notNull(),
  accuracy: decimal("accuracy", { precision: 10, scale: 2 }),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export type CrewLocation = typeof crewLocations.$inferSelect;

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Session storage table used by the local Express session store.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table used by local email/password and Google OAuth login.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  username: varchar("username").unique(), // Optional unique username for display instead of email
  passwordHash: varchar("password_hash"), // Null for Google OAuth-only users
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  phoneNumber: varchar("phone_number"), // Phone contact for employees/customers
  profileImageUrl: varchar("profile_image_url"),
  role: text("role").notNull().default("employee"), // 'admin', 'employee', 'customer'
  status: text("status").notNull().default("pending"), // 'pending', 'approved', 'removed' - user account status
  isApproved: boolean("is_approved").notNull().default(false), // DEPRECATED: Use status field instead. Kept for backward compatibility
  dateOfBirth: date("date_of_birth"), // Required for age verification (18+)
  tosAccepted: boolean("tos_accepted").notNull().default(false), // Terms of Service acceptance
  tosAcceptedAt: timestamp("tos_accepted_at"), // When TOS was accepted
  referralCode: varchar("referral_code").unique(), // Unique code for users to share
  referredByUserId: varchar("referred_by_user_id"), // Who referred this user - foreign key defined separately
  referralCount: integer("referral_count").default(0), // Number of successful referrals made
  pushSubscription: jsonb("push_subscription"), // Store push notification subscription data
  notificationsEnabled: boolean("notifications_enabled").default(true), // User preference for notifications
  jobAlertChannelPreference: text("job_alert_channel_preference").notNull().default("both"), // 'in_app' | 'discord' | 'both'
  walletMode: text("wallet_mode"), // 'personal' | 'company' - how user wants to receive JCMOVES tokens
  personalWalletAddress: text("personal_wallet_address"), // User's personal Phantom wallet address (if walletMode = 'personal')
  companyWalletId: varchar("company_wallet_id"), // Foreign key to userWallets for company-assigned wallet (if walletMode = 'company')
  isAvailable: boolean("is_available").default(false), // Worker duty status: true = available for jobs right now
  availableUntil: timestamp("available_until"), // When the availability window expires (set on go-online)
  lastActive: timestamp("last_active"), // Last heartbeat timestamp (updated every 60s while online)
  capabilities: text("capabilities").array().default(sql`ARRAY[]::text[]`), // Capability flags: 'mover','driver','truck_small','truck_large','trailer_small','trailer_large','uhaul'
  isDriver: boolean("is_driver").default(false), // Whether this employee can drive the truck
  acceptedJobTypes: text("accepted_job_types").array().default(sql`ARRAY['moving','junk','snow','handyman','labor','cleaning','demolition']::text[]`), // Job types this worker will accept
  stripeAccountId: text("stripe_account_id"),
  // Task #173 — dispatch decline tracking. Admin visibility into chronic
  // decliners. Incremented atomically on POST /api/crew/jobs/:id/decline
  // and surfaced via /api/admin/crew/decline-counts.
  dispatchDeclineCount: integer("dispatch_decline_count").notNull().default(0),
  dispatchLastDeclinedAt: timestamp("dispatch_last_declined_at"),
  rewardsEnrolled: boolean("rewards_enrolled").notNull().default(false),
  loyaltyTier: text("loyalty_tier").default("bronze"), // 'bronze', 'silver', 'gold', 'vip'
  totalCompletedSpend: decimal("total_completed_spend", { precision: 10, scale: 2 }).default("0.00"),
  tierPoints: integer("tier_points").default(0), // Activity-based tier progression points
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Audited records for owner-confirmed payments received outside an automated
// processor flow. The lead row remains the fast payment-status projection;
// this append-only record preserves who confirmed the money, how it was paid,
// and the job total used for downstream accounting and JCMOVES issuance.
export const jobPaymentRecords = pgTable("job_payment_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("manual"),
  paymentScope: text("payment_scope").notNull().default("paid_in_full"),
  status: text("status").notNull().default("confirmed"),
  method: text("method").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  reference: text("reference"),
  note: text("note"),
  recordedByUserId: varchar("recorded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  index("idx_job_payment_records_lead").on(table.leadId),
  uniqueIndex("uq_job_payment_records_manual_full")
    .on(table.leadId)
    .where(sql`${table.source} = 'manual' AND ${table.paymentScope} = 'paid_in_full' AND ${table.status} = 'confirmed'`),
]);

export type JobPaymentRecord = typeof jobPaymentRecords.$inferSelect;

// Notifications table for real-time updates
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: text("type").notNull(), // 'job_assigned', 'job_status_change', 'new_message', 'system_alert'
  title: text("title").notNull(),
  message: text("message").notNull(),
  data: jsonb("data"), // Additional data like job ID, status info
  read: boolean("read").default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const workerProfiles = pgTable("worker_profiles", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  authorityTier: text("authority_tier").notNull().default("worker"),
  payoutClassification: text("payout_classification").notNull().default("mover"),
  defaultBonusWeight: decimal("default_bonus_weight", { precision: 10, scale: 4 }).notNull().default("1.0000"),
  promoCode: varchar("promo_code").unique(),
  leadsPostedCount: integer("leads_posted_count").notNull().default(0),
  silverCompletedJobsCount: integer("silver_completed_jobs_count").notNull().default(0),
  goldEligibleAt: timestamp("gold_eligible_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const quoteRevisions = pgTable("quote_revisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  // Kept FK-free because the bookings table is declared later in this file.
  bookingId: varchar("booking_id"),
  revision: integer("revision").notNull(),
  status: text("status").notNull().default("draft"), // draft | approved | sent | superseded | void
  pricingVersionId: varchar("pricing_version_id"),
  pricingVersionCode: text("pricing_version_code"),
  currency: text("currency").notNull().default("USD"),
  lineItems: jsonb("line_items").notNull().default("[]"),
  pricingAdjustments: jsonb("pricing_adjustments").notNull().default("{}"),
  travelEligibility: jsonb("travel_eligibility").notNull().default("{}"),
  routeEvidence: jsonb("route_evidence").notNull().default("{}"),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  discountTotal: decimal("discount_total", { precision: 12, scale: 2 }).notNull().default("0"),
  finalPreTaxTotal: decimal("final_pre_tax_total", { precision: 12, scale: 2 }).notNull().default("0"),
  customerTotal: decimal("customer_total", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  ownerOverrideReason: text("owner_override_reason"),
  ownerOverrideByUserId: varchar("owner_override_by_user_id").references(() => users.id),
  ownerOverrideAt: timestamp("owner_override_at"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  sentByUserId: varchar("sent_by_user_id").references(() => users.id),
  sentAt: timestamp("sent_at"),
  supersededByQuoteId: varchar("superseded_by_quote_id"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("idx_quote_revisions_lead_revision").on(table.leadId, table.revision),
  index("idx_quote_revisions_lead_status").on(table.leadId, table.status),
  index("idx_quote_revisions_booking").on(table.bookingId),
]);

export const quoteApprovals = pgTable("quote_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").references(() => leads.id),
  bookingId: varchar("booking_id"),
  quoteRevisionId: varchar("quote_revision_id").references(() => quoteRevisions.id),
  submittedByUserId: varchar("submitted_by_user_id").references(() => users.id),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvalRole: text("approval_role").notNull().default("gold_vote"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_quote_approvals_lead").on(table.leadId),
  index("idx_quote_approvals_booking").on(table.bookingId),
  index("idx_quote_approvals_status").on(table.status),
]);

export const quoteConsensusVotes = pgTable("quote_consensus_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  choiceKey: text("choice_key").notNull(),
  choiceLabel: text("choice_label").notNull(),
  authorityTier: text("authority_tier").notNull().default("bronze"),
  notes: text("notes"),
  metadata: jsonb("metadata").default("{}"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("uq_quote_consensus_vote_lead_user").on(table.leadId, table.userId),
  index("idx_quote_consensus_votes_lead").on(table.leadId),
  index("idx_quote_consensus_votes_choice").on(table.leadId, table.choiceKey),
  index("idx_quote_consensus_votes_user").on(table.userId),
]);

export const quoteAttributions = pgTable("quote_attributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").references(() => leads.id),
  bookingId: varchar("booking_id"),
  userId: varchar("user_id").references(() => users.id),
  attributionType: text("attribution_type").notNull(),
  promoCode: text("promo_code"),
  metadata: jsonb("metadata").default("{}"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_quote_attributions_lead").on(table.leadId),
  index("idx_quote_attributions_booking").on(table.bookingId),
  index("idx_quote_attributions_user").on(table.userId),
]);

export const jobPayoutSettings = pgTable("job_payout_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().default("default"),
  isDefault: boolean("is_default").notNull().default(true),
  fuelReservePct: decimal("fuel_reserve_pct", { precision: 6, scale: 4 }).notNull().default("0.0500"),
  vehicleReservePct: decimal("vehicle_reserve_pct", { precision: 6, scale: 4 }).notNull().default("0.0500"),
  insuranceReservePct: decimal("insurance_reserve_pct", { precision: 6, scale: 4 }).notNull().default("0.0250"),
  processingFeePct: decimal("processing_fee_pct", { precision: 6, scale: 4 }).notNull().default("0.0300"),
  companyProfitPct: decimal("company_profit_pct", { precision: 6, scale: 4 }).notNull().default("0.7000"),
  crewBonusPct: decimal("crew_bonus_pct", { precision: 6, scale: 4 }).notNull().default("0.2000"),
  referralPct: decimal("referral_pct", { precision: 6, scale: 4 }).notNull().default("0.0500"),
  growthFundPct: decimal("growth_fund_pct", { precision: 6, scale: 4 }).notNull().default("0.0500"),
  leadMoverHourlyRate: decimal("lead_mover_hourly_rate", { precision: 10, scale: 2 }).notNull().default("30.00"),
  moverHourlyRate: decimal("mover_hourly_rate", { precision: 10, scale: 2 }).notNull().default("25.00"),
  helperHourlyRate: decimal("helper_hourly_rate", { precision: 10, scale: 2 }).notNull().default("20.00"),
  driverHourlyPremium: decimal("driver_hourly_premium", { precision: 10, scale: 2 }).notNull().default("5.00"),
  leadMoverBonusWeight: decimal("lead_mover_bonus_weight", { precision: 10, scale: 4 }).notNull().default("1.5000"),
  moverBonusWeight: decimal("mover_bonus_weight", { precision: 10, scale: 4 }).notNull().default("1.0000"),
  helperBonusWeight: decimal("helper_bonus_weight", { precision: 10, scale: 4 }).notNull().default("0.7500"),
  silverAuthorityBonusPct: decimal("silver_authority_bonus_pct", { precision: 6, scale: 4 }).notNull().default("0.0500"),
  goldAuthorityBonusPct: decimal("gold_authority_bonus_pct", { precision: 6, scale: 4 }).notNull().default("0.1000"),
  payrollTimezone: text("payroll_timezone").notNull().default("America/Chicago"),
  rewardPointsPerDollarEarned: decimal("reward_points_per_dollar_earned", { precision: 10, scale: 4 }).notNull().default("0.0000"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_job_payout_settings_default").on(table.isDefault),
]);

export const referralPartners = pgTable("referral_partners", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  referralCode: text("referral_code").unique(),
  defaultCommissionType: text("default_commission_type").notNull().default("percent"),
  defaultCommissionValue: decimal("default_commission_value", { precision: 10, scale: 4 }).notNull().default("0.0500"),
  isActive: boolean("is_active").notNull().default(true),
  stripeAccountId: text("stripe_account_id"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_referral_partners_active").on(table.isActive),
  index("idx_referral_partners_code").on(table.referralCode),
]);

export const jobAssignments = pgTable("job_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  workerId: varchar("worker_id").notNull().references(() => users.id),
  roleOnJob: text("role_on_job").notNull().default("mover"),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(),
  scheduledHours: decimal("scheduled_hours", { precision: 10, scale: 2 }).notNull().default("0.00"),
  hoursWorked: decimal("hours_worked", { precision: 10, scale: 2 }).notNull().default("0.00"),
  bonusWeight: decimal("bonus_weight", { precision: 10, scale: 4 }).notNull().default("0.0000"),
  bonusWeightOverrideReason: text("bonus_weight_override_reason"),
  isDriverForJob: boolean("is_driver_for_job").notNull().default(false),
  driverHourlyPremium: decimal("driver_hourly_premium", { precision: 10, scale: 2 }).notNull().default("5.00"),
  actualHoursApprovedByUserId: varchar("actual_hours_approved_by_user_id").references(() => users.id),
  actualHoursApprovedAt: timestamp("actual_hours_approved_at"),
  authorityTierSnapshot: text("authority_tier_snapshot"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_job_assignments_lead").on(table.leadId),
  index("idx_job_assignments_worker").on(table.workerId),
  uniqueIndex("uq_job_assignment_worker").on(table.leadId, table.workerId),
]);

export const jobPayoutCalculations = pgTable("job_payout_calculations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  status: text("status").notNull().default("preview"),
  grossRevenue: decimal("gross_revenue", { precision: 10, scale: 2 }).notNull().default("0.00"),
  fuelReserve: decimal("fuel_reserve", { precision: 10, scale: 2 }).notNull().default("0.00"),
  vehicleReserve: decimal("vehicle_reserve", { precision: 10, scale: 2 }).notNull().default("0.00"),
  insuranceReserve: decimal("insurance_reserve", { precision: 10, scale: 2 }).notNull().default("0.00"),
  processingFees: decimal("processing_fees", { precision: 10, scale: 2 }).notNull().default("0.00"),
  dumpFees: decimal("dump_fees", { precision: 10, scale: 2 }).notNull().default("0.00"),
  otherExpenses: decimal("other_expenses", { precision: 10, scale: 2 }).notNull().default("0.00"),
  guaranteedLaborTotal: decimal("guaranteed_labor_total", { precision: 10, scale: 2 }).notNull().default("0.00"),
  driverPremiumTotal: decimal("driver_premium_total", { precision: 10, scale: 2 }).notNull().default("0.00"),
  authorityBonusTotal: decimal("authority_bonus_total", { precision: 10, scale: 2 }).notNull().default("0.00"),
  netJobProfit: decimal("net_job_profit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  companyProfit: decimal("company_profit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  crewBonusPool: decimal("crew_bonus_pool", { precision: 10, scale: 2 }).notNull().default("0.00"),
  referralPayout: decimal("referral_payout", { precision: 10, scale: 2 }).notNull().default("0.00"),
  growthFund: decimal("growth_fund", { precision: 10, scale: 2 }).notNull().default("0.00"),
  profitMarginPct: decimal("profit_margin_pct", { precision: 10, scale: 4 }).notNull().default("0.0000"),
  profitPerLaborHour: decimal("profit_per_labor_hour", { precision: 10, scale: 2 }).notNull().default("0.00"),
  totalLaborHours: decimal("total_labor_hours", { precision: 10, scale: 2 }).notNull().default("0.00"),
  referralPartnerId: varchar("referral_partner_id").references(() => referralPartners.id),
  finalizedByUserId: varchar("finalized_by_user_id").references(() => users.id),
  finalizedAt: timestamp("finalized_at"),
  adminOverrideRequired: boolean("admin_override_required").notNull().default(false),
  adminOverrideReason: text("admin_override_reason"),
  settingsSnapshot: jsonb("settings_snapshot").notNull().default("{}"),
  calculationSnapshot: jsonb("calculation_snapshot").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_job_payout_calculations_lead").on(table.leadId),
  index("idx_job_payout_calculations_status").on(table.status),
]);

export const jobWorkerPayouts = pgTable("job_worker_payouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  calculationId: varchar("calculation_id").references(() => jobPayoutCalculations.id),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  workerId: varchar("worker_id").notNull().references(() => users.id),
  roleOnJob: text("role_on_job").notNull().default("mover"),
  hoursWorked: decimal("hours_worked", { precision: 10, scale: 2 }).notNull().default("0.00"),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull().default("0.00"),
  hourlyPay: decimal("hourly_pay", { precision: 10, scale: 2 }).notNull().default("0.00"),
  driverPremiumPay: decimal("driver_premium_pay", { precision: 10, scale: 2 }).notNull().default("0.00"),
  crewBonusPay: decimal("crew_bonus_pay", { precision: 10, scale: 2 }).notNull().default("0.00"),
  authorityBonusPct: decimal("authority_bonus_pct", { precision: 6, scale: 4 }).notNull().default("0.0000"),
  authorityBonusPay: decimal("authority_bonus_pay", { precision: 10, scale: 2 }).notNull().default("0.00"),
  jobRevenueSharePct: decimal("job_revenue_share_pct", { precision: 10, scale: 4 }).notNull().default("0.0000"),
  authorityTierSnapshot: text("authority_tier_snapshot"),
  bonusPay: decimal("bonus_pay", { precision: 10, scale: 2 }).notNull().default("0.00"),
  totalPay: decimal("total_pay", { precision: 10, scale: 2 }).notNull().default("0.00"),
  payrollPeriodId: varchar("payroll_period_id"),
  payoutStatus: text("payout_status").notNull().default("manual_pending"),
  stripeTransferId: text("stripe_transfer_id"),
  jcmovesRewardAmount: decimal("jcmoves_reward_amount", { precision: 18, scale: 8 }).notNull().default("0.00000000"),
  rewardsIssuedAt: timestamp("rewards_issued_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_job_worker_payouts_lead").on(table.leadId),
  index("idx_job_worker_payouts_worker").on(table.workerId),
  index("idx_job_worker_payouts_status").on(table.payoutStatus),
]);

export const payrollPeriods = pgTable("payroll_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  periodKey: varchar("period_key", { length: 7 }).notNull().unique(),
  timezone: text("timezone").notNull().default("America/Chicago"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: text("status").notNull().default("draft"),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  recordedPaidByUserId: varchar("recorded_paid_by_user_id").references(() => users.id),
  recordedPaidAt: timestamp("recorded_paid_at"),
  paymentReference: text("payment_reference"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_payroll_periods_status").on(table.status),
]);

export const payrollEntries = pgTable("payroll_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  periodId: varchar("period_id").notNull().references(() => payrollPeriods.id),
  workerId: varchar("worker_id").notNull().references(() => users.id),
  leadId: varchar("lead_id").references(() => leads.id),
  sourceType: text("source_type").notNull(),
  sourceId: varchar("source_id").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  earningDate: timestamp("earning_date").notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_payroll_entries_period").on(table.periodId),
  index("idx_payroll_entries_worker").on(table.workerId),
  index("idx_payroll_entries_lead").on(table.leadId),
  uniqueIndex("uq_payroll_entry_source").on(table.sourceType, table.sourceId),
]);

// Append-only record of cash handed directly to a worker for a job. Admins
// edit the target split, while deltaAmount preserves every increase or
// correction. Monthly payroll posts the inverse delta as an offset.
export const jobCashPayoutAdjustments = pgTable("job_cash_payout_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  workerId: varchar("worker_id").notNull().references(() => users.id),
  targetPercent: decimal("target_percent", { precision: 6, scale: 2 }).notNull().default("0.00"),
  previousPercent: decimal("previous_percent", { precision: 6, scale: 2 }).notNull().default("0.00"),
  eligibleEarningsSnapshot: decimal("eligible_earnings_snapshot", { precision: 10, scale: 2 }).notNull().default("0.00"),
  targetCashAmount: decimal("target_cash_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  previousCashAmount: decimal("previous_cash_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  deltaAmount: decimal("delta_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  reason: text("reason").notNull(),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_job_cash_payout_lead_worker").on(table.leadId, table.workerId, table.createdAt),
  index("idx_job_cash_payout_created").on(table.createdAt),
]);

// Rewards system tables
export const rewards = pgTable("rewards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  rewardType: text("reward_type").notNull(), // 'daily_checkin', 'booking', 'referral', 'job_completion'
  tokenAmount: decimal("token_amount", { precision: 18, scale: 8 }).notNull(),
  cashValue: decimal("cash_value", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'confirmed', 'redeemed'
  earnedDate: timestamp("earned_date").notNull().default(sql`now()`),
  redeemedDate: timestamp("redeemed_date"),
  referenceId: varchar("reference_id"), // Link to lead/booking ID that generated reward
  metadata: jsonb("metadata"), // Additional data like streak count, job details, etc.
}, (table) => [
  // General index for user rewards
  index("idx_rewards_user_type").on(table.userId, table.rewardType),
  // Partial unique index: only one signup_bonus per user (allows multiple of other types)
  uniqueIndex("uq_signup_bonus_per_user").on(table.userId, table.rewardType).where(sql`${table.rewardType} = 'signup_bonus'`),
  // NOTE: uq_reward_per_user_per_ref (disbursement idempotency) is applied at
  // server startup via safe migration in registerRoutes() so that existing
  // duplicate rows are deduplicated before the unique index is created.
]);

// Daily check-in history. Written by the unified daily rewards engine
// (server/services/daily-rewards.ts). One row per user per Eastern-time
// day. Stores streak, fraud risk score, and the IP/device-fingerprint
// captured at check-in time so suspicious patterns can be audited.
export const dailyCheckins = pgTable("daily_checkins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  checkinDate: date("checkin_date").notNull(),
  deviceFingerprint: text("device_fingerprint"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  rewardClaimed: boolean("reward_claimed").default(false),
  streakCount: integer("streak_count").default(1),
  riskScore: integer("risk_score").default(0), // 0-100 fraud risk assessment
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_user_checkin_date").on(table.userId, table.checkinDate),
]);

export const walletAccounts = pgTable("wallet_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  walletAddress: text("wallet_address"),
  tokenBalance: decimal("token_balance", { precision: 18, scale: 8 }).default("0.00000000"),
  // INVARIANT: cash_balance is USD and may only be credited on a real
  // payment received (Square webhook, prepaid top-up, admin mark-as-paid,
  // refund). Engagement rewards must credit token_balance instead.
  cashBalance: decimal("cash_balance", { precision: 10, scale: 2 }).default("0.00"),
  totalEarned: decimal("total_earned", { precision: 18, scale: 8 }).default("0.00000000"),
  totalRedeemed: decimal("total_redeemed", { precision: 18, scale: 8 }).default("0.00000000"),
  totalCashedOut: decimal("total_cashed_out", { precision: 10, scale: 2 }).default("0.00"),
  stakedBalance: decimal("staked_balance", { precision: 18, scale: 8 }).default("0.00000000"),
  unstakeCooldownUntil: timestamp("unstake_cooldown_until"),
  lastActivity: timestamp("last_activity").default(sql`now()`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Multi-currency crypto wallet system
export const supportedCurrencies = pgTable("supported_currencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull().unique(), // BTC, ETH, SOL, JCMOVES, etc.
  name: text("name").notNull(), // Bitcoin, Ethereum, Solana, JCMOVES Token
  network: text("network").notNull(), // bitcoin, ethereum, solana, polygon, etc.
  contractAddress: text("contract_address"), // For tokens (null for native currencies)
  decimals: integer("decimals").notNull().default(18), // Number of decimal places
  isActive: boolean("is_active").notNull().default(true),
  minimumBalance: decimal("minimum_balance", { precision: 18, scale: 8 }).default("0.00000000"),
  withdrawalFeePercent: decimal("withdrawal_fee_percent", { precision: 5, scale: 2 }).default("0.00"), // e.g., 2.5%
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const userWallets = pgTable("user_wallets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  currencyId: varchar("currency_id").notNull().references(() => supportedCurrencies.id),
  walletAddress: text("wallet_address").notNull(), // The actual crypto address
  privateKeyHash: text("private_key_hash"), // Encrypted private key (for custodial wallets)
  publicKey: text("public_key"),
  balance: decimal("balance", { precision: 18, scale: 8 }).notNull().default("0.00000000"),
  lastSyncedAt: timestamp("last_synced_at"),
  isActive: boolean("is_active").notNull().default(true),
  walletType: text("wallet_type").notNull().default("custodial"), // 'custodial', 'external', 'imported'
  metadata: jsonb("metadata"), // Additional data like derivation path, etc.
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  // Unique wallet per user per currency
  uniqueIndex("uq_user_currency_wallet").on(table.userId, table.currencyId),
  index("idx_wallet_address").on(table.walletAddress),
  index("idx_user_wallets").on(table.userId),
]);

// Treasury Wallets - System-level wallets for business operations
export const treasuryWallets = pgTable("treasury_wallets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  currencyId: varchar("currency_id").notNull().references(() => supportedCurrencies.id),
  walletAddress: text("wallet_address").notNull().unique(), // The actual crypto address (must be unique)
  privateKeyHash: text("private_key_hash"), // Encrypted private key (optional for cold wallets)
  publicKey: text("public_key"),
  balance: decimal("balance", { precision: 18, scale: 8 }).notNull().default("0.00000000"),
  lastSyncedAt: timestamp("last_synced_at"),
  isActive: boolean("is_active").notNull().default(true),
  walletType: text("wallet_type").notNull().default("custodial"), // 'custodial', 'cold_storage', 'hot_wallet'
  purpose: text("purpose").notNull().default("treasury"), // 'treasury', 'rewards_pool', 'operations'
  managedByUserId: varchar("managed_by_user_id").references(() => users.id), // Optional: which admin manages this wallet
  roleScope: text("role_scope").notNull().default("admin"), // 'admin' or 'business_owner' - who can access
  metadata: jsonb("metadata"), // Additional treasury-specific data
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  // One treasury wallet per currency per purpose
  uniqueIndex("uq_treasury_currency_purpose").on(table.currencyId, table.purpose),
  index("idx_treasury_wallet_address").on(table.walletAddress),
  index("idx_treasury_currency").on(table.currencyId),
]);

export const walletTransactions = pgTable("wallet_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userWalletId: varchar("user_wallet_id").references(() => userWallets.id), // Nullable - one of userWalletId or treasuryWalletId must be present
  treasuryWalletId: varchar("treasury_wallet_id").references(() => treasuryWallets.id), // Nullable - for treasury transactions
  transactionHash: text("transaction_hash"), // Blockchain transaction hash
  transactionType: text("transaction_type").notNull(), // 'deposit', 'withdrawal', 'reward', 'transfer'
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  balanceAfter: decimal("balance_after", { precision: 18, scale: 8 }).notNull(),
  fromAddress: text("from_address"),
  toAddress: text("to_address"),
  networkFee: decimal("network_fee", { precision: 18, scale: 8 }),
  status: text("status").notNull().default("pending"), // 'pending', 'confirmed', 'failed'
  blockNumber: bigint("block_number", { mode: "number" }),
  confirmations: integer("confirmations").default(0),
  metadata: jsonb("metadata"), // Additional transaction data
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  confirmedAt: timestamp("confirmed_at"),
}, (table) => [
  index("idx_wallet_transactions").on(table.userWalletId),
  index("idx_transaction_hash").on(table.transactionHash),
  index("idx_transaction_status").on(table.status),
]);

// ── Wallet Credit Grants (Task #199) ─────────────────────────────────────────
// One row per priced bundle add-on (e.g. the $100 Shop Card) that gets
// billed alongside a service. Lifecycle:
//   1. Pending — created at lead/quote time so we have an audit trail
//      *before* Square ever sees the invoice. paymentReference is null.
//   2. Granted — flipped on by the Square invoice-paid webhook (or the
//      manual mark-paid route). cash_balance on wallet_accounts has been
//      bumped by `amountUsd` and a wallet_transactions ledger row written.
//   3. Reconciled — when the customer wasn't a registered user at grant
//      time, we leave the row pending; on registration we look it up by
//      email, mint the credit, and mark it granted.
// The unique index on (sourceType, sourceId) is what guarantees we never
// double-mint when the Square webhook fires twice for the same invoice.
export const walletCreditGrants = pgTable("wallet_credit_grants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // 'lead' | 'lawn_care_quote' — extend as more booking surfaces wire in.
  sourceType: text("source_type").notNull(),
  // Stringified id of the row in the source table. Stored as text so a
  // serial lawn_care_quote.id and a uuid lead.id share the same column.
  sourceId: text("source_id").notNull(),
  // Stable id from BUNDLE_ADDONS (e.g. 'ashley_shop' or
  // 'shop_card_default') so admins can audit which bundle slot generated
  // the grant.
  addonId: text("addon_id").notNull(),
  amountUsd: decimal("amount_usd", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("JCMOVES_USD"),
  // Snapshot the customer-identifying fields at grant time so we can
  // reconcile on registration even if the source row is later edited.
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  // 'pending' | 'granted' — `pending` means the invoice hasn't been paid
  // yet OR the customer didn't have a user account when payment landed.
  status: text("status").notNull().default("pending"),
  // Square invoice id this grant is tied to. Null until the invoice is
  // actually created (we set it once we have the id back from Square).
  squareInvoiceId: text("square_invoice_id"),
  // Whatever payment id we used as proof at grant time (Square payment id
  // for webhook, 'manual' for ops, etc.). Doubles as the idempotency key
  // for the rewards-table row we write alongside the cash mint.
  paymentReference: text("payment_reference"),
  grantedToUserId: varchar("granted_to_user_id").references(() => users.id),
  grantedAt: timestamp("granted_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  // Idempotency: one grant per (sourceType, sourceId, addonId). Protects
  // both webhook double-fires and accidental double-inserts at quote time.
  uniqueIndex("uq_wallet_credit_grants_source")
    .on(table.sourceType, table.sourceId, table.addonId),
  index("idx_wallet_credit_grants_email").on(table.customerEmail),
  index("idx_wallet_credit_grants_status").on(table.status),
]);

export const insertWalletCreditGrantSchema = createInsertSchema(walletCreditGrants).omit({
  id: true,
  createdAt: true,
  grantedAt: true,
});
export type WalletCreditGrant = typeof walletCreditGrants.$inferSelect;
export type InsertWalletCreditGrant = z.infer<typeof insertWalletCreditGrantSchema>;

export const cashoutRequests = pgTable("cashout_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  tokenAmount: decimal("token_amount", { precision: 18, scale: 8 }).notNull(),
  cashAmount: decimal("cash_amount", { precision: 10, scale: 2 }).notNull(),
  conversionRate: decimal("conversion_rate", { precision: 18, scale: 8 }).notNull(), // tokens per USD
  status: text("status").notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed', 'cancelled'
  bankDetails: jsonb("bank_details"), // Encrypted bank account info
  externalTransactionId: text("external_transaction_id"), // Reference from payment processor
  processedDate: timestamp("processed_date"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const fraudLogs = pgTable("fraud_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  eventType: text("event_type").notNull(), // 'suspicious_checkin', 'multiple_devices', 'impossible_travel', etc.
  riskScore: integer("risk_score").notNull(),
  details: jsonb("details").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  actionTaken: text("action_taken"), // 'blocked', 'flagged', 'requires_verification', etc.
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Treasury management system
export const treasuryAccounts = pgTable("treasury_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountName: text("account_name").notNull().default("Main Treasury"), // Allow multiple treasury accounts
  totalFunding: decimal("total_funding", { precision: 10, scale: 2 }).notNull().default("0.00"), // Total USD deposited
  totalDistributed: decimal("total_distributed", { precision: 10, scale: 2 }).notNull().default("0.00"), // Total USD value of distributed tokens
  availableFunding: decimal("available_funding", { precision: 10, scale: 2 }).notNull().default("0.00"), // Remaining balance
  tokenReserve: decimal("token_reserve", { precision: 18, scale: 8 }).notNull().default("0.00000000"), // Tokens available for distribution
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const fundingDeposits = pgTable("funding_deposits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  treasuryAccountId: varchar("treasury_account_id").notNull().references(() => treasuryAccounts.id),
  depositedBy: varchar("deposited_by").notNull().references(() => users.id),
  depositAmount: decimal("deposit_amount", { precision: 10, scale: 2 }).notNull(), // USD amount deposited
  tokensPurchased: decimal("tokens_purchased", { precision: 18, scale: 8 }).notNull(), // Tokens acquired with deposit
  tokenPrice: decimal("token_price", { precision: 10, scale: 8 }).notNull(), // Price per token at time of deposit
  depositMethod: text("deposit_method").notNull().default("manual"), // 'manual', 'stripe', 'bank_transfer', 'moonshot'
  status: text("status").notNull().default("completed"), // 'pending', 'completed', 'failed'
  externalTransactionId: text("external_transaction_id"), // Stripe payment intent ID, Moonshot transaction hash, etc.
  moonshotMetadata: jsonb("moonshot_metadata"), // Moonshot-specific data: accountId, transferHash, tokenSymbol, etc.
  notes: text("notes"), // Optional notes about the deposit
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const reserveTransactions = pgTable("reserve_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  treasuryAccountId: varchar("treasury_account_id").notNull().references(() => treasuryAccounts.id),
  transactionType: text("transaction_type").notNull(), // 'deposit', 'distribution', 'refund', 'adjustment'
  relatedEntityType: text("related_entity_type"), // 'reward', 'signup_bonus', 'cashout'
  relatedEntityId: varchar("related_entity_id"), // ID of related record
  tokenAmount: decimal("token_amount", { precision: 18, scale: 8 }).notNull(),
  cashValue: decimal("cash_value", { precision: 10, scale: 2 }).notNull(),
  balanceAfter: decimal("balance_after", { precision: 10, scale: 2 }).notNull(), // Available funding after transaction
  tokenReserveAfter: decimal("token_reserve_after", { precision: 18, scale: 8 }).notNull(), // Token reserve after transaction
  description: text("description").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_treasury_transactions").on(table.treasuryAccountId, table.transactionType),
]);

export const priceHistory = pgTable("price_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  priceUsd: decimal("price_usd", { precision: 18, scale: 12 }).notNull(), // JCMOVES price in USD
  source: text("source").notNull(), // 'moonshot', 'dexscreener', 'manual'
  marketData: jsonb("market_data"), // Additional market data (volume, market cap, etc.)
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_price_history_created").on(table.createdAt),
]);

// Help requests for employee support
export const helpRequests = pgTable("help_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  imageUrls: text("image_urls").array(), // Array of image URLs
  status: text("status").notNull().default("pending"), // 'pending', 'in_progress', 'resolved'
  adminResponse: text("admin_response"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("idx_help_requests_user").on(table.userId),
  index("idx_help_requests_status").on(table.status),
]);

// Token mining sessions - passive JCMOVES generation (1728 tokens/24hrs per user)
// Now includes streak tracking for daily claim bonuses
export const miningSessions = pgTable("mining_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(), // One active session per user
  startTime: timestamp("start_time").notNull().default(sql`now()`),
  lastClaimTime: timestamp("last_claim_time").notNull().default(sql`now()`),
  lastClaimDate: date("last_claim_date"), // Track the date of last claim for streak calculation
  streakCount: integer("streak_count").default(0), // Consecutive days of claims (for streak bonuses)
  dailyClaimDate: date("daily_claim_date"), // Track today's date for claim counting
  dailyClaimCount: integer("daily_claim_count").default(0), // Number of claims made today (max 3)
  accumulatedTokens: decimal("accumulated_tokens", { precision: 18, scale: 8 }).notNull().default("0.00000000"),
  miningSpeed: decimal("mining_speed", { precision: 5, scale: 2 }).notNull().default("1.00"), // Speed multiplier (1X, 2X, etc.)
  pushupsCount: integer("pushups_count").default(0),
  situpsCount: integer("situps_count").default(0),
  fitnessLastUpdated: date("fitness_last_updated"),
  lastScriptureClaimDate: date("last_scripture_claim_date"),
  scriptureStreak: integer("scripture_streak").default(0),
  lastSpeedUpdateAt: timestamp("last_speed_update_at"), // When miningSpeed was last changed (for pro-rating)
  status: text("status").notNull().default("active"), // 'active', 'paused', 'completed'
  nextClaimAt: timestamp("next_claim_at").notNull(), // 24 hours from start
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_mining_sessions_user").on(table.userId),
  index("idx_mining_sessions_status").on(table.status),
  index("idx_mining_sessions_next_claim").on(table.nextClaimAt),
]);

// Mining claims history
export const miningClaims = pgTable("mining_claims", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  sessionId: varchar("session_id").notNull().references(() => miningSessions.id),
  tokenAmount: decimal("token_amount", { precision: 18, scale: 8 }).notNull(),
  claimTime: timestamp("claim_time").notNull().default(sql`now()`),
  claimType: text("claim_type").notNull().default("auto"), // 'auto', 'manual'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_mining_claims_user").on(table.userId),
  index("idx_mining_claims_session").on(table.sessionId),
]);

// Treasury withdrawal tracking for blockchain execution
export const treasuryWithdrawals = pgTable("treasury_withdrawals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  treasuryAccountId: varchar("treasury_account_id").notNull().references(() => treasuryAccounts.id),
  reserveTransactionId: varchar("reserve_transaction_id").references(() => reserveTransactions.id), // Link to database record
  requestedBy: varchar("requested_by").notNull().references(() => users.id),
  tokenAmount: decimal("token_amount", { precision: 18, scale: 8 }).notNull(),
  recipientAddress: text("recipient_address").notNull(), // Solana wallet address to receive tokens
  treasuryWalletAddress: text("treasury_wallet_address").notNull(), // Treasury wallet executing transfer
  status: text("status").notNull().default("pending"), // 'pending', 'prepared', 'signing', 'broadcasting', 'confirmed', 'failed'
  transactionSignature: text("transaction_signature"), // Solana transaction signature after broadcast
  blockNumber: bigint("block_number", { mode: "number" }),
  confirmations: integer("confirmations").default(0),
  preparedTransaction: text("prepared_transaction"), // Base64 serialized unsigned transaction
  preparedAt: timestamp("prepared_at"),
  signedAt: timestamp("signed_at"),
  broadcastAt: timestamp("broadcast_at"),
  confirmedAt: timestamp("confirmed_at"),
  failureReason: text("failure_reason"),
  metadata: jsonb("metadata"), // Additional data: nonce, fee, etc.
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_treasury_withdrawals_status").on(table.status),
  index("idx_treasury_withdrawals_signature").on(table.transactionSignature),
]);

// Token conversions for JCMOVES/SOL/ETH swaps tracking
export const tokenConversions = pgTable("token_conversions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  inputToken: text("input_token").notNull(), // 'JCMOVES', 'SOL', 'ETH', 'USDC', 'USDT'
  outputToken: text("output_token").notNull(), // 'JCMOVES', 'SOL', 'ETH', 'USDC', 'USDT'
  inputAmount: decimal("input_amount", { precision: 18, scale: 8 }).notNull(),
  outputAmount: decimal("output_amount", { precision: 18, scale: 8 }).notNull(),
  exchangeRate: decimal("exchange_rate", { precision: 18, scale: 12 }).notNull(), // Rate at time of swap
  slippagePercent: decimal("slippage_percent", { precision: 5, scale: 2 }), // Actual slippage
  transactionHash: text("transaction_hash"), // Solana transaction signature
  status: text("status").notNull().default("pending"), // 'pending', 'completed', 'failed'
  swapProvider: text("swap_provider").default("jupiter"), // 'jupiter', 'raydium', etc.
  feeAmount: decimal("fee_amount", { precision: 18, scale: 8 }), // Platform fees
  metadata: jsonb("metadata"), // Additional swap data (route info, price impact, etc.)
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_token_conversions_user").on(table.userId),
  index("idx_token_conversions_status").on(table.status),
  index("idx_token_conversions_created").on(table.createdAt),
]);

// Treasury limits - admin configurable spending limits (up to 500M JCMOVES)
export const treasuryLimits = pgTable("treasury_limits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  limitType: text("limit_type").notNull().unique(), // 'per_transaction', 'daily', 'minimum_reserve'
  limitValue: decimal("limit_value", { precision: 18, scale: 2 }).notNull(), // Amount in JCMOVES
  updatedBy: varchar("updated_by").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Admin-configurable reward settings
export const rewardSettings = pgTable("reward_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  settingKey: text("setting_key").notNull().unique(), // e.g., 'customer_quote_accepted', 'customer_quote_completed'
  label: text("label").notNull(), // Human-readable label
  description: text("description"), // Description for admin UI
  tokenAmount: decimal("token_amount", { precision: 12, scale: 2 }).notNull(), // Amount in JCMOVES
  isActive: boolean("is_active").notNull().default(true),
  updatedBy: varchar("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Shop items for marketplace - photos/videos stored as base64 data URLs
export const shopMediaSchema = z.string().refine(
  (val) => val.startsWith("data:image/") || val.startsWith("data:video/"),
  { message: "Must be a valid base64 image or video data URL" }
);

export type ShopMedia = z.infer<typeof shopMediaSchema>;

export const shopItems = pgTable("shop_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postedBy: varchar("posted_by").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  phoneNumber: text("phone_number").notNull(), // Contact number for this listing
  photos: jsonb("photos").notNull().default("[]"), // Array of photo objects for slideshow
  category: text("category"), // Optional category (furniture, electronics, etc.)
  itemType: text("item_type").notNull().default("community"), // 'community', 'moving_supplies', 'gift_card', 'official'
  jcmovesPrice: decimal("jcmoves_price", { precision: 18, scale: 8 }), // Full JCMOVES price to purchase outright
  jcmovesDiscountPercent: integer("jcmoves_discount_percent"), // % discount earned by spending JCMOVES (e.g. 10 = 10% off)
  jcmovesDiscountTokens: decimal("jcmoves_discount_tokens", { precision: 18, scale: 8 }), // JCMOVES to spend to unlock the partial discount
  giftCardValue: decimal("gift_card_value", { precision: 10, scale: 2 }), // USD value on the gift card
  status: text("status").notNull().default("active"), // 'active', 'sold', 'archived'
  views: integer("views").default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_shop_items_status").on(table.status),
  index("idx_shop_items_posted_by").on(table.postedBy),
  index("idx_shop_items_created").on(table.createdAt),
  index("idx_shop_items_active_created").on(table.status, table.createdAt),
]);

// Gift card codes issued after purchase
export const giftCards = pgTable("gift_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(), // e.g. JCMOVE-XXXX-XXXX
  purchasedByUserId: varchar("purchased_by_user_id").references(() => users.id),
  recipientEmail: text("recipient_email"),
  valueUsd: decimal("value_usd", { precision: 10, scale: 2 }).notNull(),
  shopItemId: varchar("shop_item_id").references(() => shopItems.id),
  paymentMethod: text("payment_method").notNull().default("usd"), // 'usd', 'jcmoves', 'partial'
  jcmovesSpent: decimal("jcmoves_spent", { precision: 18, scale: 8 }),
  isRedeemed: boolean("is_redeemed").default(false),
  redeemedByUserId: varchar("redeemed_by_user_id").references(() => users.id),
  redeemedAt: timestamp("redeemed_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  notes: text("notes"),
});

// Nature Made Jewls marketplace items
export const jewelryItems = pgTable("jewelry_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postedBy: varchar("posted_by").references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  shortDescription: text("short_description"),
  price: decimal("price", { precision: 10, scale: 2 }),
  category: text("category"),
  materials: text("materials"),
  imageUrl: text("image_url"),
  photos: jsonb("photos").default("[]"),
  inStock: boolean("in_stock").default(true),
  featured: boolean("featured").default(false),
  status: text("status").notNull().default("active"),
  soldAt: timestamp("sold_at"),
  pendingCreditUserId: varchar("pending_credit_user_id").references(() => users.id),
  pendingCreditCents: decimal("pending_credit_cents", { precision: 10, scale: 2 }),
  pendingExpiresAt: timestamp("pending_expires_at"),
  pendingSquareOrderId: text("pending_square_order_id"),
  sku: text("sku"),
  quantity: integer("quantity").notNull().default(1),
  tags: jsonb("tags").notNull().default("[]"),
  sourceBatchId: varchar("source_batch_id"),
  approvalStatus: text("approval_status").notNull().default("approved"),
  approvedByUserId: varchar("approved_by_user_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  lastFeaturedAt: timestamp("last_featured_at", { withTimezone: true }),
  aiMetadata: jsonb("ai_metadata").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertJewelryItemSchema = createInsertSchema(jewelryItems).omit({
  id: true,
  createdAt: true,
  soldAt: true,
});

export type InsertJewelryItem = z.infer<typeof insertJewelryItemSchema>;
export type JewelryItem = typeof jewelryItems.$inferSelect;

/**
 * Return a call-ready North American phone number, or null when the input is
 * incomplete. Leads are handled by a US phone team, so saving a partial
 * number is worse than rejecting the submission: it creates a lead we cannot
 * call back.
 */
export const normalizeLeadPhoneNumber = normalizeCustomerPhone;
export const leadPhoneNumberSchema = z.string().trim()
  .superRefine((value, ctx) => {
    const message = phoneError(value);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  })
  .transform((value) => normalizeCustomerPhone(value)!);
export const optionalPhoneNumberSchema = z.union([z.literal(""), leadPhoneNumberSchema]).nullable().optional();

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  orderNumber: true,
  status: true,
  financialStatus: true,
  finalBalanceAmount: true,
  finalInvoiceUrl: true,
  closeoutStatus: true,
  assignedToUserId: true, // Assigned internally when employee accepts job
  createdAt: true,
}).extend({
  // Apply the same validation and display format to public, marketplace, and
  // staff-created leads. This is the last line of defense before a lead is
  // written to the database.
  phone: leadPhoneNumberSchema,
});

export function formatOrderNumber(n: number): string {
  return `JC-${n}`;
}

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
}).extend({ phone: optionalPhoneNumberSchema });

export const insertUserSchema = createInsertSchema(users).omit({
  role: true, // Role set during user creation/management
  createdAt: true,
  updatedAt: true,
});

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

// Notification schemas
export const insertNotificationSchema = createInsertSchema(notifications);
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export const insertJobPayoutSettingsSchema = createInsertSchema(jobPayoutSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertReferralPartnerSchema = createInsertSchema(referralPartners).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertJobAssignmentSchema = createInsertSchema(jobAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertJobPayoutCalculationSchema = createInsertSchema(jobPayoutCalculations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertJobWorkerPayoutSchema = createInsertSchema(jobWorkerPayouts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertPayrollPeriodSchema = createInsertSchema(payrollPeriods).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertPayrollEntrySchema = createInsertSchema(payrollEntries).omit({
  id: true,
  createdAt: true,
});
export const insertJobCashPayoutAdjustmentSchema = createInsertSchema(jobCashPayoutAdjustments).omit({
  id: true,
  createdAt: true,
});

export type JobPayoutSettings = typeof jobPayoutSettings.$inferSelect;
export type InsertJobPayoutSettings = z.infer<typeof insertJobPayoutSettingsSchema>;
export type ReferralPartner = typeof referralPartners.$inferSelect;
export type InsertReferralPartner = z.infer<typeof insertReferralPartnerSchema>;
export type JobAssignment = typeof jobAssignments.$inferSelect;
export type InsertJobAssignment = z.infer<typeof insertJobAssignmentSchema>;
export type JobPayoutCalculation = typeof jobPayoutCalculations.$inferSelect;
export type InsertJobPayoutCalculation = z.infer<typeof insertJobPayoutCalculationSchema>;
export type JobWorkerPayout = typeof jobWorkerPayouts.$inferSelect;
export type InsertJobWorkerPayout = z.infer<typeof insertJobWorkerPayoutSchema>;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type InsertPayrollPeriod = z.infer<typeof insertPayrollPeriodSchema>;
export type PayrollEntry = typeof payrollEntries.$inferSelect;
export type InsertPayrollEntry = z.infer<typeof insertPayrollEntrySchema>;
export type JobCashPayoutAdjustment = typeof jobCashPayoutAdjustments.$inferSelect;
export type InsertJobCashPayoutAdjustment = z.infer<typeof insertJobCashPayoutAdjustmentSchema>;

// Push subscription schema
export const pushSubscriptionSchema = z.object({
  endpoint: z.string(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UpsertUser = typeof users.$inferInsert;

// Rewards system schemas
export const insertRewardSchema = createInsertSchema(rewards).omit({
  id: true,
  status: true,
  earnedDate: true,
  redeemedDate: true,
});

export const insertDailyCheckinSchema = createInsertSchema(dailyCheckins).omit({
  id: true,
  rewardClaimed: true,
  streakCount: true,
  riskScore: true,
  createdAt: true,
});

export const insertWalletAccountSchema = createInsertSchema(walletAccounts).omit({
  id: true,
  tokenBalance: true,
  cashBalance: true,
  totalEarned: true,
  totalRedeemed: true,
  totalCashedOut: true,
  lastActivity: true,
  createdAt: true,
});

export const insertCashoutRequestSchema = createInsertSchema(cashoutRequests).omit({
  id: true,
  status: true,
  processedDate: true,
  failureReason: true,
  createdAt: true,
});

export const insertFraudLogSchema = createInsertSchema(fraudLogs).omit({
  id: true,
  createdAt: true,
});

// Rewards system types
export type InsertReward = z.infer<typeof insertRewardSchema>;
export type Reward = typeof rewards.$inferSelect;
export type InsertDailyCheckin = z.infer<typeof insertDailyCheckinSchema>;
export type DailyCheckin = typeof dailyCheckins.$inferSelect;
export type InsertWalletAccount = z.infer<typeof insertWalletAccountSchema>;
export type WalletAccount = typeof walletAccounts.$inferSelect;
export type InsertCashoutRequest = z.infer<typeof insertCashoutRequestSchema>;
export type CashoutRequest = typeof cashoutRequests.$inferSelect;
export type InsertFraudLog = z.infer<typeof insertFraudLogSchema>;
export type FraudLog = typeof fraudLogs.$inferSelect;

// Treasury system schemas
export const insertTreasuryAccountSchema = createInsertSchema(treasuryAccounts).omit({
  id: true,
  totalFunding: true,
  totalDistributed: true,
  availableFunding: true,
  tokenReserve: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFundingDepositSchema = createInsertSchema(fundingDeposits).omit({
  id: true,
  createdAt: true,
});

export const insertReserveTransactionSchema = createInsertSchema(reserveTransactions).omit({
  id: true,
  createdAt: true,
});

export const insertTreasuryWithdrawalSchema = createInsertSchema(treasuryWithdrawals).omit({
  id: true,
  status: true,
  transactionSignature: true,
  blockNumber: true,
  confirmations: true,
  preparedTransaction: true,
  preparedAt: true,
  signedAt: true,
  broadcastAt: true,
  confirmedAt: true,
  failureReason: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
});

// Treasury system types
export type InsertTreasuryAccount = z.infer<typeof insertTreasuryAccountSchema>;
export type TreasuryAccount = typeof treasuryAccounts.$inferSelect;
export type InsertFundingDeposit = z.infer<typeof insertFundingDepositSchema>;
export type FundingDeposit = typeof fundingDeposits.$inferSelect;
export type InsertReserveTransaction = z.infer<typeof insertReserveTransactionSchema>;
export type ReserveTransaction = typeof reserveTransactions.$inferSelect;
export type InsertTreasuryWithdrawal = z.infer<typeof insertTreasuryWithdrawalSchema>;
export type TreasuryWithdrawal = typeof treasuryWithdrawals.$inferSelect;

// Token conversions schemas
export const insertTokenConversionSchema = createInsertSchema(tokenConversions).omit({
  id: true,
  status: true,
  executedAt: true,
  createdAt: true,
});
export type InsertTokenConversion = z.infer<typeof insertTokenConversionSchema>;
export type TokenConversion = typeof tokenConversions.$inferSelect;

// Treasury limits schemas
export const insertTreasuryLimitSchema = createInsertSchema(treasuryLimits).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTreasuryLimit = z.infer<typeof insertTreasuryLimitSchema>;
export type TreasuryLimit = typeof treasuryLimits.$inferSelect;

export const insertRewardSettingSchema = createInsertSchema(rewardSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRewardSetting = z.infer<typeof insertRewardSettingSchema>;
export type RewardSetting = typeof rewardSettings.$inferSelect;

// Shop system schemas
export const insertShopItemSchema = createInsertSchema(shopItems).omit({
  id: true,
  status: true,
  views: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  photos: z.array(shopMediaSchema).min(1, "At least one photo or video is required"),
  price: z.string().regex(/^\d+\.?\d{0,2}$/, "Price must be a valid number with up to 2 decimal places").or(z.coerce.number().positive("Price must be greater than 0")),
  phoneNumber: z.string().regex(/^[\d\s\-\(\)]+$/, "Phone number must contain only numbers, spaces, dashes, and parentheses").min(10, "Phone number must be at least 10 characters"),
  title: z.string().min(3, "Title must be at least 3 characters").max(200, "Title must not exceed 200 characters"),
  description: z.string().min(10, "Description must be at least 10 characters").max(2000, "Description must not exceed 2000 characters"),
});

export type InsertShopItem = z.infer<typeof insertShopItemSchema>;
export type ShopItem = typeof shopItems.$inferSelect;

export const insertGiftCardSchema = createInsertSchema(giftCards).omit({
  id: true,
  createdAt: true,
  isRedeemed: true,
  redeemedByUserId: true,
  redeemedAt: true,
});
export type InsertGiftCard = z.infer<typeof insertGiftCardSchema>;
export type GiftCard = typeof giftCards.$inferSelect;

// Faucet system tables
export const faucetConfig = pgTable("faucet_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  currency: text("currency").notNull(), // 'BTC', 'ETH', 'LTC', etc.
  rewardAmount: decimal("reward_amount", { precision: 18, scale: 8 }).notNull(), // Amount in satoshis/wei
  claimInterval: integer("claim_interval").notNull().default(3600), // Time between claims in seconds (default 1 hour)
  isEnabled: boolean("is_enabled").notNull().default(true),
  dailyLimit: decimal("daily_limit", { precision: 18, scale: 8 }), // Maximum daily rewards per currency
  minimumBalance: decimal("minimum_balance", { precision: 18, scale: 8 }), // Minimum FaucetPay balance required
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  unique("unique_currency_config").on(table.currency),
]);

export const faucetClaims = pgTable("faucet_claims", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  currency: text("currency").notNull(),
  rewardAmount: decimal("reward_amount", { precision: 18, scale: 8 }).notNull(),
  cashValue: decimal("cash_value", { precision: 10, scale: 2 }).notNull(),
  claimTime: timestamp("claim_time").notNull().default(sql`now()`),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  deviceFingerprint: text("device_fingerprint"),
  faucetpayPayoutId: text("faucetpay_payout_id"), // Reference to FaucetPay transaction
  faucetpayUserHash: text("faucetpay_user_hash"), // FaucetPay user identifier
  status: text("status").notNull().default("pending"), // 'pending', 'paid', 'failed'
  failureReason: text("failure_reason"),
  riskScore: integer("risk_score").default(0),
  metadata: jsonb("metadata"), // Additional tracking data
}, (table) => [
  index("idx_faucet_claims_user_time").on(table.userId, table.claimTime),
  index("idx_faucet_claims_currency").on(table.currency),
  index("idx_faucet_claims_ip").on(table.ipAddress),
]);

export const faucetRevenue = pgTable("faucet_revenue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: date("date").notNull(),
  currency: text("currency").notNull(),
  totalClaims: integer("total_claims").default(0),
  totalRewards: decimal("total_rewards", { precision: 18, scale: 8 }).default("0"),
  totalRevenue: decimal("total_revenue", { precision: 10, scale: 2 }).default("0"), // Estimated ad revenue
  uniqueUsers: integer("unique_users").default(0),
  adViews: integer("ad_views").default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  unique("unique_date_currency").on(table.date, table.currency),
  index("idx_faucet_revenue_date").on(table.date),
]);

export const faucetWallets = pgTable("faucet_wallets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  currency: text("currency").notNull(),
  faucetpayAddress: text("faucetpay_address"), // User's FaucetPay address for this currency
  totalEarned: decimal("total_earned", { precision: 18, scale: 8 }).default("0"),
  totalClaims: integer("total_claims").default(0),
  lastClaimTime: timestamp("last_claim_time"),
  isVerified: boolean("is_verified").default(false), // Whether address is verified with FaucetPay
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  unique("unique_user_currency").on(table.userId, table.currency),
  index("idx_faucet_wallet_user").on(table.userId),
]);

// ====================== ADVERTISING TABLES ======================
// Real advertising system for crypto faucet monetization with Bitmedia/Cointraffic

export const adImpressions = pgTable("ad_impressions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  sessionId: text("session_id"), // Anonymous tracking for non-logged users
  placementId: text("placement_id").notNull(),
  network: text("network").notNull(), // 'bitmedia', 'cointraffic', 'aads'
  adType: text("ad_type").notNull(), // 'banner', 'video', 'popup', 'interstitial'
  adUnitId: text("ad_unit_id"), // Network-specific ad unit ID
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  revenue: decimal("revenue", { precision: 10, scale: 6 }).default("0"), // in USD
  cpm: decimal("cpm", { precision: 10, scale: 6 }).default("0"), // cost per mille
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_ad_impressions_user").on(table.userId),
  index("idx_ad_impressions_network").on(table.network),
  index("idx_ad_impressions_placement").on(table.placementId),
  index("idx_ad_impressions_date").on(table.createdAt),
]);

export const adClicks = pgTable("ad_clicks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  impressionId: varchar("impression_id").notNull().references(() => adImpressions.id),
  userId: varchar("user_id").references(() => users.id),
  placementId: text("placement_id").notNull(),
  network: text("network").notNull(),
  clickUrl: text("click_url"),
  revenue: decimal("revenue", { precision: 10, scale: 6 }).default("0"), // in USD
  cpc: decimal("cpc", { precision: 10, scale: 6 }).default("0"), // cost per click
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_ad_clicks_impression").on(table.impressionId),
  index("idx_ad_clicks_user").on(table.userId),
  index("idx_ad_clicks_network").on(table.network),
]);

export const adCompletions = pgTable("ad_completions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  impressionId: varchar("impression_id").notNull().references(() => adImpressions.id),
  sessionId: text("session_id").notNull(), // For verification against bypass attempts
  network: text("network").notNull(),
  completionType: text("completion_type").notNull(), // 'view', 'click', 'conversion'
  verified: boolean("verified").default(false),
  verificationMethod: text("verification_method"), // 'callback', 'timeout', 'manual'
  revenue: decimal("revenue", { precision: 10, scale: 6 }).default("0"),
  faucetClaimId: varchar("faucet_claim_id").references(() => faucetClaims.id), // Link to faucet claim
  expiresAt: timestamp("expires_at").notNull(), // Ad completion expires (prevent reuse)
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_ad_completions_user").on(table.userId),
  index("idx_ad_completions_session").on(table.sessionId),
  index("idx_ad_completions_verified").on(table.verified),
  index("idx_ad_completions_expires").on(table.expiresAt),
]);

// Faucet system schemas
export const insertFaucetConfigSchema = createInsertSchema(faucetConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFaucetClaimSchema = createInsertSchema(faucetClaims).omit({
  id: true,
  claimTime: true,
  status: true,
  riskScore: true,
}).extend({
  sessionId: z.string().optional(), // For ad completion verification
});

export const insertFaucetRevenueSchema = createInsertSchema(faucetRevenue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFaucetWalletSchema = createInsertSchema(faucetWallets).omit({
  id: true,
  totalEarned: true,
  totalClaims: true,
  isVerified: true,
  createdAt: true,
  updatedAt: true,
});

// Faucet system types
export type InsertFaucetConfig = z.infer<typeof insertFaucetConfigSchema>;
export type FaucetConfig = typeof faucetConfig.$inferSelect;
export type InsertFaucetClaim = z.infer<typeof insertFaucetClaimSchema>;
export type FaucetClaim = typeof faucetClaims.$inferSelect;
export type InsertFaucetRevenue = z.infer<typeof insertFaucetRevenueSchema>;
export type FaucetRevenue = typeof faucetRevenue.$inferSelect;
export type InsertFaucetWallet = z.infer<typeof insertFaucetWalletSchema>;
export type FaucetWallet = typeof faucetWallets.$inferSelect;

// Employee Gamification System
export const employeeStats = pgTable("employee_stats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  totalPoints: integer("total_points").notNull().default(0),
  currentLevel: integer("current_level").notNull().default(1),
  jobsCompleted: integer("jobs_completed").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0), // Current streak of consecutive job completions
  longestStreak: integer("longest_streak").notNull().default(0), // Best streak ever achieved
  averageRating: decimal("average_rating", { precision: 3, scale: 2 }).default("0.00"), // Customer satisfaction rating
  totalRatings: integer("total_ratings").notNull().default(0),
  onTimeCompletions: integer("on_time_completions").notNull().default(0),
  monthlyGoal: integer("monthly_goal").default(10), // Jobs to complete this month
  monthlyProgress: integer("monthly_progress").notNull().default(0),
  totalEarnedTokens: decimal("total_earned_tokens", { precision: 18, scale: 8 }).default("0.00000000"),
  rankTitle: text("rank_title").default("Rookie Mover"), // Dynamic rank based on performance
  lastActivityDate: timestamp("last_activity_date").default(sql`now()`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const achievementTypes = pgTable("achievement_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // "Speed Demon", "Customer Champion", "Streak Master"
  description: text("description").notNull(),
  category: text("category").notNull(), // "performance", "quality", "consistency", "milestones"
  iconName: text("icon_name").notNull(), // Lucide icon name
  iconColor: text("icon_color").notNull().default("#3b82f6"), // Hex color
  pointsAwarded: integer("points_awarded").notNull().default(0),
  tokenReward: decimal("token_reward", { precision: 18, scale: 8 }).default("0.00000000"),
  requirements: jsonb("requirements").notNull(), // Conditions to earn this achievement
  isActive: boolean("is_active").notNull().default(true),
  rarity: text("rarity").notNull().default("common"), // "common", "rare", "epic", "legendary"
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const employeeAchievements = pgTable("employee_achievements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  achievementTypeId: varchar("achievement_type_id").notNull().references(() => achievementTypes.id),
  earnedAt: timestamp("earned_at").notNull().default(sql`now()`),
  progress: jsonb("progress"), // Track progress towards achievement if applicable
  notified: boolean("notified").default(false), // Whether user has been notified
  celebrationShown: boolean("celebration_shown").default(false), // Whether celebration animation was shown
}, (table) => [
  index("idx_employee_achievements_user").on(table.userId),
  unique("unique_user_achievement").on(table.userId, table.achievementTypeId),
]);

// Customer reviews and ratings for completed jobs
export const reviews = pgTable("reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id), // The job being reviewed
  userId: varchar("user_id").notNull().references(() => users.id), // Customer who submitted review
  employeeId: varchar("employee_id").notNull().references(() => users.id), // Employee being reviewed
  rating: integer("rating").notNull(), // 1-5 stars
  comment: text("comment"), // Optional written feedback
  serviceQuality: integer("service_quality"), // Optional: 1-5 rating for service quality
  communication: integer("communication"), // Optional: 1-5 rating for communication
  timeliness: integer("timeliness"), // Optional: 1-5 rating for timeliness
  professionalism: integer("professionalism"), // Optional: 1-5 rating for professionalism
  wouldRecommend: boolean("would_recommend").default(true), // Would recommend this service
  isHelpful: boolean("is_helpful").default(true), // Review marked as helpful
  isPublic: boolean("is_public").default(true), // Display publicly on site
  rewardedAt: timestamp("rewarded_at"), // Timestamp when employee received bonus tokens for this review
  // Tip tracking
  moverNames: text("mover_names"), // Customer-specified mover names to credit
  numberOfMovers: integer("number_of_movers"), // How many movers the customer is tipping
  tipAmount: decimal("tip_amount", { precision: 10, scale: 2 }), // Total tip amount left by customer
  tipPerMover: decimal("tip_per_mover", { precision: 10, scale: 2 }), // Per-mover tip amount
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_reviews_lead").on(table.leadId),
  index("idx_reviews_employee").on(table.employeeId),
  index("idx_reviews_rating").on(table.rating),
  unique("unique_review_per_lead").on(table.leadId, table.userId), // One review per customer per job
]);

export const reviewTipAllocations = pgTable("review_tip_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reviewId: varchar("review_id").notNull().references(() => reviews.id),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  customerUserId: varchar("customer_user_id").references(() => users.id),
  workerId: varchar("worker_id").notNull().references(() => users.id),
  workerName: text("worker_name"),
  tipMethod: text("tip_method").notNull(), // 'cart', 'bitcoin', 'jcmoves', 'jcmoves_usd'
  currency: text("currency").notNull(), // 'USD', 'BTC', 'JCMOVES', 'JCMOVES_USD'
  amountUsd: decimal("amount_usd", { precision: 10, scale: 2 }).notNull().default("0.00"),
  tokenAmount: decimal("token_amount", { precision: 18, scale: 8 }).notNull().default("0.00000000"),
  status: text("status").notNull().default("pending_payment"), // 'pending_payment', 'confirmed', 'failed'
  payrollEligibleAt: timestamp("payroll_eligible_at"),
  payrollPeriodId: varchar("payroll_period_id").references(() => payrollPeriods.id),
  payrollEntryId: varchar("payroll_entry_id").references(() => payrollEntries.id),
  payrollPaidAt: timestamp("payroll_paid_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  confirmedAt: timestamp("confirmed_at"),
}, (table) => [
  index("idx_review_tip_allocations_review").on(table.reviewId),
  index("idx_review_tip_allocations_lead").on(table.leadId),
  index("idx_review_tip_allocations_worker").on(table.workerId),
  index("idx_review_tip_allocations_customer").on(table.customerUserId),
  unique("unique_review_tip_allocation").on(table.reviewId, table.workerId, table.tipMethod),
]);

export const pointTransactions = pgTable("point_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  points: integer("points").notNull(), // Can be positive or negative
  transactionType: text("transaction_type").notNull(), // "job_completion", "bonus", "penalty", "achievement"
  relatedEntityType: text("related_entity_type"), // "lead", "achievement", "bonus"
  relatedEntityId: varchar("related_entity_id"), // ID of the related record
  description: text("description").notNull(),
  metadata: jsonb("metadata"), // Additional data like job details, performance metrics
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_point_transactions_user").on(table.userId, table.createdAt),
]);

export const weeklyLeaderboards = pgTable("weekly_leaderboards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  weekStartDate: date("week_start_date").notNull(),
  weekEndDate: date("week_end_date").notNull(),
  userId: varchar("user_id").notNull().references(() => users.id),
  pointsEarned: integer("points_earned").notNull().default(0),
  jobsCompleted: integer("jobs_completed").notNull().default(0),
  averageRating: decimal("average_rating", { precision: 3, scale: 2 }).default("0.00"),
  rank: integer("rank"), // Position in that week's leaderboard
  tokenReward: decimal("token_reward", { precision: 18, scale: 8 }).default("0.00000000"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_weekly_leaderboard_week").on(table.weekStartDate, table.rank),
  unique("unique_user_week").on(table.userId, table.weekStartDate),
]);

export const gamificationConfig = pgTable("gamification_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(), // "points_per_job", "level_threshold", "streak_bonus"
  value: text("value").notNull(), // JSON stringified value
  description: text("description"),
  category: text("category").notNull().default("general"), // "points", "levels", "rewards", "achievements"
  dataType: text("data_type").notNull().default("number"), // "number", "string", "boolean", "json"
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Gamification schemas
export const insertEmployeeStatsSchema = createInsertSchema(employeeStats).omit({
  id: true,
  totalPoints: true,
  currentLevel: true,
  jobsCompleted: true,
  currentStreak: true,
  longestStreak: true,
  averageRating: true,
  totalRatings: true,
  onTimeCompletions: true,
  monthlyProgress: true,
  totalEarnedTokens: true,
  rankTitle: true,
  lastActivityDate: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAchievementTypeSchema = createInsertSchema(achievementTypes).omit({
  id: true,
  createdAt: true,
});

export const insertEmployeeAchievementSchema = createInsertSchema(employeeAchievements).omit({
  id: true,
  earnedAt: true,
  notified: true,
  celebrationShown: true,
});

export const insertReviewSchema = createInsertSchema(reviews).omit({
  id: true,
  rewardedAt: true,
  createdAt: true,
}).extend({
  rating: z.number().int().min(1).max(5),
  serviceQuality: z.number().int().min(1).max(5).optional(),
  communication: z.number().int().min(1).max(5).optional(),
  timeliness: z.number().int().min(1).max(5).optional(),
  professionalism: z.number().int().min(1).max(5).optional(),
});

export const insertPointTransactionSchema = createInsertSchema(pointTransactions).omit({
  id: true,
  createdAt: true,
});

export const insertWeeklyLeaderboardSchema = createInsertSchema(weeklyLeaderboards).omit({
  id: true,
  rank: true,
  tokenReward: true,
  createdAt: true,
});

export const insertGamificationConfigSchema = createInsertSchema(gamificationConfig).omit({
  id: true,
  updatedAt: true,
});

// Gamification types
export type InsertEmployeeStats = z.infer<typeof insertEmployeeStatsSchema>;
export type EmployeeStats = typeof employeeStats.$inferSelect;
export type InsertAchievementType = z.infer<typeof insertAchievementTypeSchema>;
export type AchievementType = typeof achievementTypes.$inferSelect;
export type InsertEmployeeAchievement = z.infer<typeof insertEmployeeAchievementSchema>;
export type EmployeeAchievement = typeof employeeAchievements.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;
export type ReviewTipAllocation = typeof reviewTipAllocations.$inferSelect;
export type InsertPointTransaction = z.infer<typeof insertPointTransactionSchema>;
export type PointTransaction = typeof pointTransactions.$inferSelect;
export type InsertWeeklyLeaderboard = z.infer<typeof insertWeeklyLeaderboardSchema>;
export type WeeklyLeaderboard = typeof weeklyLeaderboards.$inferSelect;
export type InsertGamificationConfig = z.infer<typeof insertGamificationConfigSchema>;
export type GamificationConfig = typeof gamificationConfig.$inferSelect;

// Multi-currency wallet schemas
export const insertSupportedCurrencySchema = createInsertSchema(supportedCurrencies).omit({
  id: true,
  createdAt: true,
});

export const insertUserWalletSchema = createInsertSchema(userWallets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTreasuryWalletSchema = createInsertSchema(treasuryWallets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWalletTransactionSchema = createInsertSchema(walletTransactions).omit({
  id: true,
  createdAt: true,
});

// Multi-currency wallet types
export type SupportedCurrency = typeof supportedCurrencies.$inferSelect;
export type InsertSupportedCurrency = z.infer<typeof insertSupportedCurrencySchema>;
export type UserWallet = typeof userWallets.$inferSelect;
export type InsertUserWallet = z.infer<typeof insertUserWalletSchema>;
export type TreasuryWallet = typeof treasuryWallets.$inferSelect;
export type InsertTreasuryWallet = z.infer<typeof insertTreasuryWalletSchema>;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type InsertWalletTransaction = z.infer<typeof insertWalletTransactionSchema>;

// Price history schema and types
export const insertPriceHistorySchema = createInsertSchema(priceHistory).omit({
  id: true,
  createdAt: true,
});

export type PriceHistory = typeof priceHistory.$inferSelect;
export type InsertPriceHistory = z.infer<typeof insertPriceHistorySchema>;

// Help request schemas
export const insertHelpRequestSchema = createInsertSchema(helpRequests).omit({
  id: true,
  status: true,
  adminResponse: true,
  createdAt: true,
  resolvedAt: true,
});

export type HelpRequest = typeof helpRequests.$inferSelect;
export type InsertHelpRequest = z.infer<typeof insertHelpRequestSchema>;

// Mining session schemas
export const insertMiningSessionSchema = createInsertSchema(miningSessions).omit({
  id: true,
  accumulatedTokens: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMiningClaimSchema = createInsertSchema(miningClaims).omit({
  id: true,
  claimTime: true,
  createdAt: true,
});

export type MiningSession = typeof miningSessions.$inferSelect;
export type InsertMiningSession = z.infer<typeof insertMiningSessionSchema>;
export type MiningClaim = typeof miningClaims.$inferSelect;
export type InsertMiningClaim = z.infer<typeof insertMiningClaimSchema>;

// Customer testimonials and imported reviews for public showcase
export const testimonials = pgTable("testimonials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reviewerName: text("reviewer_name").notNull(),
  rating: integer("rating").notNull(), // 1-5 stars
  content: text("content").notNull(),
  serviceType: text("service_type"), // 'residential', 'junk', 'snow', etc. (optional)
  sourceType: text("source_type").notNull().default("customer"), // 'customer' or 'imported'
  sourcePlatform: text("source_platform"), // 'google', 'yelp', 'facebook', 'hireahelper', null for customer
  sourceUrl: text("source_url"), // Original URL of imported review
  reviewDate: text("review_date"), // Date review was left (for imported reviews)
  status: text("status").notNull().default("pending"), // 'pending', 'published', 'hidden'
  featured: boolean("featured").notNull().default(false), // Featured on homepage
  verified: boolean("verified").notNull().default(false), // Verified purchase/service
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_testimonials_status").on(table.status),
  index("idx_testimonials_source").on(table.sourceType, table.sourcePlatform),
  index("idx_testimonials_featured").on(table.featured),
]);

export const insertTestimonialSchema = createInsertSchema(testimonials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Testimonial = typeof testimonials.$inferSelect;
export type InsertTestimonial = z.infer<typeof insertTestimonialSchema>;

// Wallet payouts - Track blockchain transfers of rewards to user wallets
export const walletPayouts = pgTable("wallet_payouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  tokenAmount: decimal("token_amount", { precision: 18, scale: 8 }).notNull(), // Gross amount requested
  feeAmount: decimal("fee_amount", { precision: 18, scale: 8 }).default("0"), // Network fee deducted
  netAmount: decimal("net_amount", { precision: 18, scale: 8 }), // Net amount sent (tokenAmount - feeAmount)
  recipientAddress: text("recipient_address").notNull(),
  transactionHash: text("transaction_hash"),
  status: text("status").notNull().default("pending"), // 'pending', 'processing', 'confirmed', 'failed'
  failureReason: text("failure_reason"),
  requestedAt: timestamp("requested_at").notNull().default(sql`now()`),
  processedAt: timestamp("processed_at"),
  confirmedAt: timestamp("confirmed_at"),
  metadata: jsonb("metadata"),
}, (table) => [
  index("idx_wallet_payouts_user").on(table.userId),
  index("idx_wallet_payouts_status").on(table.status),
  index("idx_wallet_payouts_tx_hash").on(table.transactionHash),
]);

export const insertWalletPayoutSchema = createInsertSchema(walletPayouts).omit({
  id: true,
  requestedAt: true,
  processedAt: true,
  confirmedAt: true,
});

export type WalletPayout = typeof walletPayouts.$inferSelect;
export type InsertWalletPayout = z.infer<typeof insertWalletPayoutSchema>;

// Square invoices - Track invoices created through Square API
export const squareInvoices = pgTable("square_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").references(() => leads.id),
  squareInvoiceId: varchar("square_invoice_id").unique(), // Square's invoice ID
  squareInvoiceNumber: varchar("square_invoice_number"), // Human-readable number on the invoice (e.g. INV-000001)
  squareOrderId: varchar("square_order_id"), // Square's order ID
  customerId: varchar("customer_id"), // Square customer ID
  customerEmail: text("customer_email").notNull(),
  customerName: text("customer_name").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(), // Invoice amount in dollars
  giftCardPaidAmount: decimal("gift_card_paid_amount", { precision: 10, scale: 2 }).notNull().default("0.00"),
  currency: varchar("currency").notNull().default("USD"),
  description: text("description"),
  status: text("status").notNull().default("draft"), // 'draft', 'sent', 'paid', 'canceled', 'failed'
  invoiceUrl: text("invoice_url"), // Square-hosted payment URL
  dueDate: text("due_date"),
  purpose: text("purpose").notNull().default("legacy_unknown"),
  quoteRevisionId: varchar("quote_revision_id").references(() => quoteRevisions.id),
  closeoutId: varchar("closeout_id"),
  paidAt: timestamp("paid_at"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_square_invoices_lead").on(table.leadId),
  index("idx_square_invoices_status").on(table.status),
  index("idx_square_invoices_square_id").on(table.squareInvoiceId),
]);

export const insertSquareInvoiceSchema = createInsertSchema(squareInvoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  paidAt: true,
  sentAt: true,
});

export type SquareInvoice = typeof squareInvoices.$inferSelect;
export type InsertSquareInvoice = z.infer<typeof insertSquareInvoiceSchema>;

// Bonus JCMOVES earned for purchasing a Square eGift card. Square remains the
// source of truth for card delivery, balances, and redemption; these tables
// intentionally store no gift-card number, GAN, or secret card credential.
export const giftCardBonusPurchases = pgTable("gift_card_bonus_purchases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  squareOrderId: text("square_order_id").notNull().unique(),
  squarePaymentId: text("square_payment_id").unique(),
  squareLocationId: text("square_location_id"),
  buyerEmail: text("buyer_email"),
  faceValueCents: integer("face_value_cents").notNull().default(0),
  paidCents: integer("paid_cents").notNull().default(0),
  tokenRate: decimal("token_rate", { precision: 10, scale: 4 }).notNull().default("25"),
  tokenAmount: decimal("token_amount", { precision: 18, scale: 8 }).notNull().default("0"),
  redeemRateSnapshot: decimal("redeem_rate_snapshot", { precision: 18, scale: 8 }).notNull().default("500"),
  refundedCents: integer("refunded_cents").notNull().default(0),
  reversedTokens: decimal("reversed_tokens", { precision: 18, scale: 8 }).notNull().default("0"),
  status: text("status").notNull().default("awaiting_payment"),
  claimTokenHash: text("claim_token_hash").unique(),
  recipientClaimTokenHash: text("recipient_claim_token_hash").unique(),
  claimEmailSentAt: timestamp("claim_email_sent_at"),
  targetEmail: text("target_email"),
  targetUserId: varchar("target_user_id").references(() => users.id),
  targetSelectedAt: timestamp("target_selected_at"),
  recipientInviteExpiresAt: timestamp("recipient_invite_expires_at"),
  purchasedAt: timestamp("purchased_at"),
  eligibleAt: timestamp("eligible_at"),
  creditedAt: timestamp("credited_at"),
  goldEligible: boolean("gold_eligible").notNull().default(false),
  metadata: jsonb("metadata").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_gift_card_bonus_status_eligible").on(table.status, table.eligibleAt),
  index("idx_gift_card_bonus_target_user").on(table.targetUserId),
  index("idx_gift_card_bonus_buyer_email").on(table.buyerEmail),
]);

export const giftCardBonusActivations = pgTable("gift_card_bonus_activations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  squareActivityId: text("square_activity_id").notNull().unique(),
  squareOrderId: text("square_order_id").notNull(),
  lineItemUid: text("line_item_uid"),
  amountCents: integer("amount_cents").notNull(),
  activatedAt: timestamp("activated_at").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_gift_card_bonus_activation_order").on(table.squareOrderId),
]);

export const giftCardBonusAdjustments = pgTable("gift_card_bonus_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseId: varchar("purchase_id").notNull().references(() => giftCardBonusPurchases.id),
  squareAdjustmentId: text("square_adjustment_id").notNull().unique(),
  adjustmentType: text("adjustment_type").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  status: text("status").notNull(),
  metadata: jsonb("metadata").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_gift_card_bonus_adjustment_purchase").on(table.purchaseId),
]);

export type GiftCardBonusPurchase = typeof giftCardBonusPurchases.$inferSelect;

// Regional automation policy and audit records. These tables deliberately
// reference the existing pricing/route identifiers instead of duplicating
// pricing geometry or demand-zone state.
export const serviceAreaCapabilities = pgTable("service_area_capabilities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  stateCode: text("state_code").notNull(),
  locality: text("locality"),
  routeDayCode: text("route_day_code"),
  pricingZoneCode: text("pricing_zone_code"),
  serviceTypes: text("service_types").array().notNull().default(sql`ARRAY['moving','labor','junk']::text[]`),
  truckModes: text("truck_modes").array().notNull().default(sql`ARRAY['jc_on_the_move','customer','rental','none']::text[]`),
  verificationStatus: text("verification_status").notNull().default("pending"),
  autoBookEnabled: boolean("auto_book_enabled").notNull().default(false),
  adsEnabled: boolean("ads_enabled").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  verifiedByUserId: varchar("verified_by_user_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_service_area_capabilities_lookup").on(table.stateCode, table.locality, table.verificationStatus),
]);

export const jobAgreements = pgTable("job_agreements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  quoteRevisionId: varchar("quote_revision_id").references(() => quoteRevisions.id),
  termsVersion: text("terms_version").notNull(),
  termsHash: text("terms_hash").notNull(),
  acceptanceMethod: text("acceptance_method").notNull().default("web_checkbox"),
  acceptedByUserId: varchar("accepted_by_user_id").references(() => users.id),
  acceptedByName: text("accepted_by_name"),
  acceptanceEvidence: jsonb("acceptance_evidence").notNull().default("{}"),
  acceptanceTokenId: text("acceptance_token_id"),
  acceptedAt: timestamp("accepted_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_job_agreement_quote_hash").on(table.leadId, table.quoteRevisionId, table.termsHash),
  index("idx_job_agreements_lead").on(table.leadId),
]);

export const dispatchOffers = pgTable("dispatch_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  slotKey: text("slot_key").notNull(),
  roleOnJob: text("role_on_job").notNull(),
  requiresDriver: boolean("requires_driver").notNull().default(false),
  workerId: varchar("worker_id").notNull().references(() => users.id),
  status: text("status").notNull().default("offered"),
  score: integer("score").notNull().default(0),
  distanceMiles: decimal("distance_miles", { precision: 10, scale: 2 }),
  reasons: jsonb("reasons").notNull().default("[]"),
  expiresAt: timestamp("expires_at").notNull(),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_dispatch_offer_worker_slot").on(table.leadId, table.slotKey, table.workerId),
  index("idx_dispatch_offers_active").on(table.leadId, table.status, table.expiresAt),
  index("idx_dispatch_offers_worker").on(table.workerId, table.status, table.expiresAt),
]);

export const jobCloseouts = pgTable("job_closeouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().unique().references(() => leads.id),
  status: text("status").notNull().default("draft"),
  submittedByUserId: varchar("submitted_by_user_id").references(() => users.id),
  actualStartAt: timestamp("actual_start_at"),
  actualEndAt: timestamp("actual_end_at"),
  breakMinutes: integer("break_minutes").notNull().default(0),
  actualHours: decimal("actual_hours", { precision: 10, scale: 2 }).notNull().default("0"),
  proofPhotos: jsonb("proof_photos").notNull().default("[]"),
  exceptionFlags: jsonb("exception_flags").notNull().default("[]"),
  crewNotes: text("crew_notes"),
  pricingSnapshot: jsonb("pricing_snapshot").notNull().default("{}"),
  quotedTotal: decimal("quoted_total", { precision: 10, scale: 2 }).notNull().default("0"),
  calculatedFinalTotal: decimal("calculated_final_total", { precision: 10, scale: 2 }).notNull().default("0"),
  depositApplied: decimal("deposit_applied", { precision: 10, scale: 2 }).notNull().default("0"),
  creditsApplied: decimal("credits_applied", { precision: 10, scale: 2 }).notNull().default("0"),
  balanceDue: decimal("balance_due", { precision: 10, scale: 2 }).notNull().default("0"),
  customerTokenHash: text("customer_token_hash"),
  customerTokenExpiresAt: timestamp("customer_token_expires_at"),
  customerApprovedAt: timestamp("customer_approved_at"),
  customerRejectedAt: timestamp("customer_rejected_at"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  squareInvoiceId: varchar("square_invoice_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_job_closeouts_status").on(table.status, table.updatedAt),
]);

export const jobChangeOrders = pgTable("job_change_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  closeoutId: varchar("closeout_id").notNull().references(() => jobCloseouts.id),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  code: text("code").notNull(),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  catalogBacked: boolean("catalog_backed").notNull().default(true),
  customerAcknowledgedAt: timestamp("customer_acknowledged_at"),
  status: text("status").notNull().default("submitted"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("idx_job_change_orders_closeout").on(table.closeoutId)]);

export const customerJobEvents = pgTable("customer_job_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  eventType: text("event_type").notNull(),
  eventKey: text("event_key").notNull().unique(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  payload: jsonb("payload").notNull().default("{}"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("idx_customer_job_events_lead").on(table.leadId, table.occurredAt)]);

export const customerNotificationDeliveries = pgTable("customer_notification_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id").notNull().references(() => customerJobEvents.id),
  channel: text("channel").notNull(),
  destinationHash: text("destination_hash").notNull(),
  status: text("status").notNull(),
  providerReference: text("provider_reference"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [uniqueIndex("uq_customer_delivery_destination").on(table.eventId, table.channel, table.destinationHash)]);

export const squareWebhookEvents = pgTable("square_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  squareObjectId: text("square_object_id"),
  payloadHash: text("payload_hash").notNull(),
  status: text("status").notNull().default("processing"),
  lastError: text("last_error"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
});

export type ServiceAreaCapability = typeof serviceAreaCapabilities.$inferSelect;
export type JobAgreement = typeof jobAgreements.$inferSelect;
export type DispatchOffer = typeof dispatchOffers.$inferSelect;
export type JobCloseout = typeof jobCloseouts.$inferSelect;
export type JobChangeOrder = typeof jobChangeOrders.$inferSelect;
export type CustomerJobEvent = typeof customerJobEvents.$inferSelect;

// Transfer fees - Track platform fees collected on token transfers
export const transferFees = pgTable("transfer_fees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transactionHash: text("transaction_hash").notNull(), // Token transfer tx hash
  feeTransactionHash: text("fee_transaction_hash"), // Fee collection tx hash (if separate)
  fromWallet: text("from_wallet").notNull(), // Treasury wallet that sent tokens
  toWallet: text("to_wallet").notNull(), // Recipient wallet
  tokenAmount: decimal("token_amount", { precision: 20, scale: 8 }).notNull(), // JCMOVES transferred
  baseFee: decimal("base_fee", { precision: 20, scale: 9 }).notNull(), // Base Solana fee in SOL
  platformFee: decimal("platform_fee", { precision: 20, scale: 9 }).notNull(), // Platform fee (2x base) in SOL
  totalFee: decimal("total_fee", { precision: 20, scale: 9 }).notNull(), // Total fee collected
  status: text("status").notNull().default("collected"), // 'collected', 'pooled', 'used_for_buyback'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_transfer_fees_from").on(table.fromWallet),
  index("idx_transfer_fees_status").on(table.status),
  index("idx_transfer_fees_created").on(table.createdAt),
]);

export const insertTransferFeeSchema = createInsertSchema(transferFees).omit({
  id: true,
  createdAt: true,
});

export type TransferFee = typeof transferFees.$inferSelect;
export type InsertTransferFee = z.infer<typeof insertTransferFeeSchema>;

// Buyback fund - Track accumulated fees for token buybacks
export const buybackFund = pgTable("buyback_fund", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  solBalance: decimal("sol_balance", { precision: 20, scale: 9 }).notNull().default("0"), // Current SOL in fund
  totalCollected: decimal("total_collected", { precision: 20, scale: 9 }).notNull().default("0"), // Lifetime SOL collected
  totalUsedForBuyback: decimal("total_used_for_buyback", { precision: 20, scale: 9 }).notNull().default("0"), // SOL spent on buybacks
  totalTokensBought: decimal("total_tokens_bought", { precision: 20, scale: 8 }).notNull().default("0"), // Total JCMOVES bought back
  buybackCount: integer("buyback_count").notNull().default(0), // Number of buyback transactions
  // Token fee tracking (JCMOVES collected from payout fees)
  tokenBalance: decimal("token_balance", { precision: 20, scale: 8 }).notNull().default("0"), // Current JCMOVES in fund
  totalTokensCollected: decimal("total_tokens_collected", { precision: 20, scale: 8 }).notNull().default("0"), // Lifetime JCMOVES from fees
  feeContributionCount: integer("fee_contribution_count").notNull().default(0), // Number of fee contributions
  lastUpdated: timestamp("last_updated").notNull().default(sql`now()`),
});

export type BuybackFund = typeof buybackFund.$inferSelect;

// Buyback transactions - History of token buybacks
export const buybackTransactions = pgTable("buyback_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transactionHash: text("transaction_hash").notNull().unique(),
  solSpent: decimal("sol_spent", { precision: 20, scale: 9 }).notNull(),
  tokensBought: decimal("tokens_bought", { precision: 20, scale: 8 }).notNull(),
  tokenPrice: decimal("token_price", { precision: 20, scale: 12 }), // Price at time of buyback
  jupiterQuoteId: text("jupiter_quote_id"),
  slippage: decimal("slippage", { precision: 5, scale: 2 }),
  status: text("status").notNull().default("completed"), // 'pending', 'completed', 'failed'
  initiatedBy: text("initiated_by"), // Admin username who triggered buyback
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_buyback_tx_status").on(table.status),
  index("idx_buyback_tx_created").on(table.createdAt),
]);

export const insertBuybackTransactionSchema = createInsertSchema(buybackTransactions).omit({
  id: true,
  createdAt: true,
});

export type BuybackTransaction = typeof buybackTransactions.$inferSelect;
export type InsertBuybackTransaction = z.infer<typeof insertBuybackTransactionSchema>;

// Swap Requests - Manual swap request system (Option A compliant)
// Users REQUEST swaps, admin reviews and fulfills manually off-platform
export const swapRequests = pgTable("swap_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(), // User requesting the swap
  userEmail: text("user_email").notNull(),
  userName: text("user_name").notNull(),
  
  // Request details
  jcmovesAmount: decimal("jcmoves_amount", { precision: 20, scale: 8 }).notNull(), // Amount of JCMOVES to swap
  desiredAsset: text("desired_asset").notNull(), // 'SOL', 'USDC', 'USDT'
  destinationWallet: text("destination_wallet").notNull(), // User's wallet to receive asset
  
  // Acknowledgements (compliance)
  acknowledgedManualProcess: boolean("acknowledged_manual_process").notNull().default(false),
  acknowledgedNoGuaranteedRate: boolean("acknowledged_no_guaranteed_rate").notNull().default(false),
  acknowledgedTerms: boolean("acknowledged_terms").notNull().default(false),
  
  // Status tracking
  status: text("status").notNull().default("pending"), // 'pending', 'approved', 'declined', 'processing', 'completed', 'cancelled'
  
  // Admin review
  reviewedBy: text("reviewed_by"), // Admin who reviewed
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  declineReason: text("decline_reason"),
  
  // Fulfillment (done off-platform)
  fulfilledAmount: decimal("fulfilled_amount", { precision: 20, scale: 8 }), // Actual amount of desired asset sent
  fulfillmentTxHash: text("fulfillment_tx_hash"), // Transaction hash of fulfillment
  fulfilledBy: text("fulfilled_by"), // Admin who fulfilled
  fulfilledAt: timestamp("fulfilled_at"),
  fulfillmentMethod: text("fulfillment_method"), // 'dex', 'otc', 'treasury'
  
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_swap_requests_user").on(table.userId),
  index("idx_swap_requests_status").on(table.status),
  index("idx_swap_requests_created").on(table.createdAt),
]);

export const insertSwapRequestSchema = createInsertSchema(swapRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewNotes: true,
  declineReason: true,
  fulfilledAmount: true,
  fulfillmentTxHash: true,
  fulfilledBy: true,
  fulfilledAt: true,
  fulfillmentMethod: true,
});

export type SwapRequest = typeof swapRequests.$inferSelect;
export type InsertSwapRequest = z.infer<typeof insertSwapRequestSchema>;

// Treasury Swap Rules - Admin-configurable limits for compliance
export const treasurySwapRules = pgTable("treasury_swap_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Monthly limits
  monthlySwapCapTokens: decimal("monthly_swap_cap_tokens", { precision: 20, scale: 8 }).notNull().default("500000"), // Max tokens swapped per month
  monthlySwapsUsed: decimal("monthly_swaps_used", { precision: 20, scale: 8 }).notNull().default("0"),
  monthlyResetDate: timestamp("monthly_reset_date").notNull().default(sql`now()`),
  
  // Per-user limits
  maxPerUserPerMonth: decimal("max_per_user_per_month", { precision: 20, scale: 8 }).notNull().default("10000"), // Max tokens per user per month
  minSwapAmount: decimal("min_swap_amount", { precision: 20, scale: 8 }).notNull().default("100"), // Minimum swap amount
  maxSwapAmount: decimal("max_swap_amount", { precision: 20, scale: 8 }).notNull().default("50000"), // Maximum per swap
  
  // Approved assets
  approvedAssets: text("approved_assets").array().notNull().default(sql`ARRAY['SOL', 'USDC']`),
  
  // Controls
  swapsEnabled: boolean("swaps_enabled").notNull().default(true),
  requireManualReview: boolean("require_manual_review").notNull().default(true), // Always true for Option A
  
  lastUpdated: timestamp("last_updated").notNull().default(sql`now()`),
  updatedBy: text("updated_by"),
});


// ===== SNOW REMOVAL SERVICE MANAGEMENT =====

// Snow removal customers - recurring service customers
export const snowCustomers = pgTable("snow_customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull().default(""),
  phone: text("phone"),
  contactMethod: text("contact_method"), // 'phone', 'facebook', 'text'
  pricePerVisit: decimal("price_per_visit", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"), // Service notes like "just end of driveway", "double wide plus back path"
  defaultServiceTypeId: varchar("default_service_type_id"), // Most common service for this customer
  isPrepaid: boolean("is_prepaid").default(false), // If customer has prepaid arrangement (like Rita with $0)
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_snow_customers_active").on(table.isActive),
  index("idx_snow_customers_city").on(table.city),
]);

export const insertSnowCustomerSchema = createInsertSchema(snowCustomers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SnowCustomer = typeof snowCustomers.$inferSelect;
export type InsertSnowCustomer = z.infer<typeof insertSnowCustomerSchema>;

// Snow service types - different levels of service offered
export const snowServiceTypes = pgTable("snow_service_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // "End of Driveway Only", "Driveway Only", "The Works", etc.
  description: text("description"),
  defaultPrice: decimal("default_price", { precision: 10, scale: 2 }),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertSnowServiceTypeSchema = createInsertSchema(snowServiceTypes).omit({
  id: true,
  createdAt: true,
});

export type SnowServiceType = typeof snowServiceTypes.$inferSelect;
export type InsertSnowServiceType = z.infer<typeof insertSnowServiceTypeSchema>;

// Snow service logs - daily service records
export const snowServiceLogs = pgTable("snow_service_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceDate: date("service_date").notNull(),
  customerId: varchar("customer_id").notNull().references(() => snowCustomers.id),
  serviceTypeId: varchar("service_type_id").references(() => snowServiceTypes.id),
  status: text("status").notNull().default("done"), // 'done', 'paid', 'skipped', 'scheduled'
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  monthKey: text("month_key").notNull(), // Format: "YYYY-MM" for easy monthly grouping
  servicedByUserId: varchar("serviced_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_snow_logs_date").on(table.serviceDate),
  index("idx_snow_logs_customer").on(table.customerId),
  index("idx_snow_logs_month").on(table.monthKey),
  index("idx_snow_logs_status").on(table.status),
]);

export const insertSnowServiceLogSchema = createInsertSchema(snowServiceLogs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SnowServiceLog = typeof snowServiceLogs.$inferSelect;
export type InsertSnowServiceLog = z.infer<typeof insertSnowServiceLogSchema>;

export const bitcoinPayments = pgTable("bitcoin_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  referenceId: varchar("reference_id"),
  referenceType: text("reference_type").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  usdAmount: decimal("usd_amount", { precision: 10, scale: 2 }).notNull(),
  btcAmount: decimal("btc_amount", { precision: 18, scale: 8 }).notNull(),
  btcPrice: decimal("btc_price", { precision: 12, scale: 2 }).notNull(),
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).default("5.00"),
  originalUsdAmount: decimal("original_usd_amount", { precision: 10, scale: 2 }).notNull(),
  jcmovesAmount: decimal("jcmoves_amount", { precision: 18, scale: 8 }),
  jcmovesCredited: integer("jcmoves_credited").default(0),
  btcAddress: text("btc_address").notNull(),
  status: text("status").notNull().default("pending"),
  items: jsonb("items"),
  notes: text("notes"),
  verifiedByUserId: varchar("verified_by_user_id"),
  verifiedAt: timestamp("verified_at"),
  autoVerified: boolean("auto_verified").notNull().default(false),
  autoVerifiedTxid: text("auto_verified_txid"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at"),
});

export const insertBitcoinPaymentSchema = createInsertSchema(bitcoinPayments).omit({
  id: true,
  createdAt: true,
});

export type BitcoinPayment = typeof bitcoinPayments.$inferSelect;
export type InsertBitcoinPayment = z.infer<typeof insertBitcoinPaymentSchema>;

export const stakingTiers = pgTable("staking_tiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  durationDays: integer("duration_days").notNull(),
  annualRatePercent: decimal("annual_rate_percent", { precision: 5, scale: 2 }).notNull(),
  minStake: decimal("min_stake", { precision: 18, scale: 8 }).notNull().default("100.00000000"),
  maxStake: decimal("max_stake", { precision: 18, scale: 8 }),
  earlyUnstakePenaltyPercent: decimal("early_unstake_penalty_percent", { precision: 5, scale: 2 }).notNull().default("50.00"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const stakes = pgTable("stakes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  tierId: varchar("tier_id").notNull().references(() => stakingTiers.id),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 8 }).notNull(),
  totalEarned: decimal("total_earned", { precision: 18, scale: 8 }).notNull().default("0.00000000"),
  lastPayoutAt: timestamp("last_payout_at").notNull().default(sql`now()`),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at").notNull().default(sql`now()`),
  endsAt: timestamp("ends_at").notNull(),
  unstakedAt: timestamp("unstaked_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertStakingTierSchema = createInsertSchema(stakingTiers).omit({ id: true, createdAt: true });
export const insertStakeSchema = createInsertSchema(stakes).omit({ id: true, totalEarned: true, lastPayoutAt: true, status: true, unstakedAt: true, createdAt: true });

export type StakingTier = typeof stakingTiers.$inferSelect;
export type InsertStakingTier = z.infer<typeof insertStakingTierSchema>;
export type Stake = typeof stakes.$inferSelect;
export type InsertStake = z.infer<typeof insertStakeSchema>;

// ── PROMO CODES ──────────────────────────────────────────────────────────────
export const promoCodes = pgTable("promo_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  description: text("description").notNull().default(""),
  // discountPercent: applied to service total (0 = no service discount)
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).notNull().default("0.00"),
  // discountPercentJewelry: applied to jewelry/shop order (0 = no jewelry discount)
  discountPercentJewelry: decimal("discount_percent_jewelry", { precision: 5, scale: 2 }).notNull().default("0.00"),
  // rewardTokens: JCMOVES tokens credited to the customer when code is applied
  rewardTokens: decimal("reward_tokens", { precision: 18, scale: 2 }).notNull().default("0.00"),
  // referralUserId: if set, this user created the code and earns referral tokens per use
  referralUserId: varchar("referral_user_id").references(() => users.id),
  // referralRewardTokens: tokens credited to referralUserId per successful use
  referralRewardTokens: decimal("referral_reward_tokens", { precision: 18, scale: 2 }).notNull().default("0.00"),
  // Optional server-enforced offer for a specific moving package. This is
  // deliberately data rather than a frontend-only coupon so payment, quotes,
  // and staff job setup all use the same rule.
  jobOffer: jsonb("job_offer"),
  maxUses: integer("max_uses"),
  usesCount: integer("uses_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_promo_codes_code").on(table.code),
  index("idx_promo_codes_active").on(table.isActive),
]);

export const insertPromoCodeSchema = createInsertSchema(promoCodes).omit({
  id: true,
  usesCount: true,
  createdAt: true,
  updatedAt: true,
});

export type PromoCode = typeof promoCodes.$inferSelect;
export type InsertPromoCode = z.infer<typeof insertPromoCodeSchema>;

// Marketing network reps and call-click attribution. Promo codes remain the
// primary booking attribution key; call events fill the top of the funnel.
export const marketingReps = pgTable("marketing_reps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // The marketing profile can exist before a crew member has completed
  // onboarding. Once linked, this is the canonical owner for actions,
  // invitations, and promo attribution.
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  brandName: text("brand_name").notNull(),
  tagline: text("tagline").notNull().default(""),
  promoCode: text("promo_code").notNull(),
  serviceFocus: text("service_focus").array().default(sql`ARRAY[]::text[]`),
  territory: text("territory").notNull().default(""),
  audience: text("audience").notNull().default(""),
  ctaLabel: text("cta_label").notNull().default("Get Quote"),
  phoneNumber: text("phone_number").notNull().default("19062859312"),
  contentStrategy: jsonb("content_strategy").$type<{
    facebookPersonality?: string;
    weeklyPrompts?: string[];
  }>().default(sql`'{}'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_marketing_reps_slug").on(table.slug),
  index("idx_marketing_reps_active").on(table.isActive, table.sortOrder),
  index("idx_marketing_reps_promo").on(table.promoCode),
]);

export const marketingCallEvents = pgTable("marketing_call_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repId: varchar("rep_id").references(() => marketingReps.id, { onDelete: "set null" }),
  repSlug: text("rep_slug").notNull(),
  promoCode: text("promo_code").notNull(),
  sourcePath: text("source_path"),
  phoneNumber: text("phone_number"),
  referrer: text("referrer"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_marketing_calls_rep").on(table.repSlug, table.createdAt),
  index("idx_marketing_calls_promo").on(table.promoCode),
]);

export const insertMarketingRepSchema = createInsertSchema(marketingReps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertMarketingCallEventSchema = createInsertSchema(marketingCallEvents).omit({
  id: true,
  createdAt: true,
});
export type MarketingRep = typeof marketingReps.$inferSelect;
export type InsertMarketingRep = z.infer<typeof insertMarketingRepSchema>;
export type MarketingCallEvent = typeof marketingCallEvents.$inferSelect;
export type InsertMarketingCallEvent = z.infer<typeof insertMarketingCallEventSchema>;

// ── Marketing execution system ────────────────────────────────────────────
// These records drive the owner command center and the crew's marketing launch
// checklist. They are deliberately separate from worker job goals so booking
// operations and marketing accountability can progress independently.
export const marketingGoalCycles = pgTable("marketing_goal_cycles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull().unique(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  targetRevenue: decimal("target_revenue", { precision: 12, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_marketing_goal_cycles_active").on(table.isActive, table.endsOn),
]);

export const marketingActionAssignments = pgTable("marketing_action_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repId: varchar("rep_id").notNull().references(() => marketingReps.id, { onDelete: "cascade" }),
  goalCycleId: varchar("goal_cycle_id").references(() => marketingGoalCycles.id, { onDelete: "set null" }),
  actionKey: text("action_key").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  routeKey: text("route_key"),
  serviceFocus: text("service_focus"),
  status: text("status").notNull().default("assigned"),
  proofUrl: text("proof_url"),
  proofNotes: text("proof_notes"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("uq_marketing_action_rep_key").on(table.repId, table.actionKey),
  index("idx_marketing_action_rep_status").on(table.repId, table.status),
]);

export const marketingInvites = pgTable("marketing_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repId: varchar("rep_id").references(() => marketingReps.id, { onDelete: "set null" }),
  recipientUserId: varchar("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  recipientName: text("recipient_name").notNull().default("Crew member"),
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  inviteToken: varchar("invite_token").notNull().unique(),
  deliveryChannel: text("delivery_channel").notNull().default("manual"),
  status: text("status").notNull().default("draft"),
  deliveryNote: text("delivery_note"),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  accountLinkedAt: timestamp("account_linked_at"),
  tutorialCompletedAt: timestamp("tutorial_completed_at"),
  launchStartedAt: timestamp("launch_started_at"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_marketing_invite_rep").on(table.repId, table.status),
  index("idx_marketing_invite_recipient").on(table.recipientUserId, table.status),
]);

export const tutorialStepCompletions = pgTable("tutorial_step_completions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tutorialId: text("tutorial_id").notNull(),
  stepId: text("step_id").notNull(),
  completedAt: timestamp("completed_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("uq_tutorial_step_completion").on(table.userId, table.tutorialId, table.stepId),
  index("idx_tutorial_completion_user").on(table.userId, table.completedAt),
]);

export type MarketingGoalCycle = typeof marketingGoalCycles.$inferSelect;
export type MarketingActionAssignment = typeof marketingActionAssignments.$inferSelect;
export type MarketingInvite = typeof marketingInvites.$inferSelect;
export type TutorialStepCompletion = typeof tutorialStepCompletions.$inferSelect;

// ── JCMOVES Rewards Marketplace ─────────────────────────────────────────────
export const rewardCategories = pgTable("reward_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").notNull().default("🎁"),
  color: text("color").notNull().default("#f59e0b"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRewardCategorySchema = createInsertSchema(rewardCategories).omit({ id: true, createdAt: true });
export type RewardCategory = typeof rewardCategories.$inferSelect;
export type InsertRewardCategory = z.infer<typeof insertRewardCategorySchema>;

export const rewardItems = pgTable("reward_items", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull(),
  name: text("name").notNull(),
  shortDesc: text("short_desc").notNull(),
  fullDesc: text("full_desc"),
  image: text("image"),
  tokenPrice: integer("token_price").notNull(),
  salePriceTokens: integer("sale_price_tokens"),
  cashValue: decimal("cash_value", { precision: 10, scale: 2 }),
  status: text("status").notNull().default("active"), // active | hidden | draft | sold_out | archived
  featured: boolean("featured").notNull().default(false),
  inventory: integer("inventory"), // null = unlimited
  maxPerUser: integer("max_per_user").notNull().default(10),
  maxPerMonth: integer("max_per_month").notNull().default(5),
  tierRequired: text("tier_required").notNull().default("none"), // none | bronze | silver | gold | vip
  deliveryType: text("delivery_type").notNull().default("manual"), // service_credit | digital_code | manual | schedule_required
  scheduleRequired: boolean("schedule_required").notNull().default(false),
  expirationDays: integer("expiration_days"),
  promoBadge: text("promo_badge"),
  isLimitedTime: boolean("is_limited_time").notNull().default(false),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  adminNotes: text("admin_notes"),
  // ── Logic flags (fulfillment behavior classification) ──
  isInstant: boolean("is_instant").notNull().default(false),          // auto-fulfills immediately
  requiresApproval: boolean("requires_approval").notNull().default(false), // admin must approve
  requiresSchedule: boolean("requires_schedule").notNull().default(false), // user/admin must schedule
  createsInvoiceCredit: boolean("creates_invoice_credit").notNull().default(false), // attaches $ credit to job invoice
  createsServiceCredit: boolean("creates_service_credit").notNull().default(false), // creates minutes credit record
  createsSpinCredit: boolean("creates_spin_credit").notNull().default(false),       // grants spin wheel entry
  usesMysteryPool: boolean("uses_mystery_pool").notNull().default(false),            // triggers mystery prize resolution
  isBundle: boolean("is_bundle").notNull().default(false),             // hybrid bundle with sub-entitlements
  createsCouponCode: boolean("creates_coupon_code").notNull().default(false),        // auto-generates promo code on redemption
  couponDiscountPct: integer("coupon_discount_pct").default(0),                     // % discount (e.g. 10 = 10%)
  couponMaxDiscount: decimal("coupon_max_discount", { precision: 10, scale: 2 }),   // max $ value (e.g. 25.00)
  fulfillmentNote: text("fulfillment_note"),                           // "How it works" text shown in modal
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRewardItemSchema = createInsertSchema(rewardItems).omit({ id: true, createdAt: true, updatedAt: true });
export type RewardItem = typeof rewardItems.$inferSelect;
export type InsertRewardItem = z.infer<typeof insertRewardItemSchema>;

export const rewardRedemptions = pgTable("reward_redemptions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  itemId: integer("item_id").notNull(),
  itemName: text("item_name").notNull(),
  tokenCost: integer("token_cost").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | completed | cancelled | expired
  scheduledDate: timestamp("scheduled_date"),
  userNotes: text("user_notes"),
  adminNotes: text("admin_notes"),
  couponCode: text("coupon_code"),          // auto-generated promo code (for coupon-type rewards)
  fulfilledAt: timestamp("fulfilled_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRewardRedemptionSchema = createInsertSchema(rewardRedemptions).omit({ id: true, createdAt: true });
export type RewardRedemption = typeof rewardRedemptions.$inferSelect;
export type InsertRewardRedemption = z.infer<typeof insertRewardRedemptionSchema>;

// ── Reward Entitlements ──────────────────────────────────────────────────────
// Tracks active reward effects after redemption (priority booking, spin credits, etc.)
export const rewardEntitlements = pgTable("reward_entitlements", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  itemId: integer("item_id"),
  redemptionId: integer("redemption_id"),
  entitlementType: text("entitlement_type").notNull(), // priority_booking | labor_credit | support_priority | spin_credit | faucet_bonus | tier_points_bonus | invoice_credit | service_credit
  valueJson: jsonb("value_json"),   // flexible payload: { minutes, amount, code, etc. }
  status: text("status").notNull().default("active"), // active | consumed | expired | cancelled
  startsAt: timestamp("starts_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type RewardEntitlement = typeof rewardEntitlements.$inferSelect;

// ── Spin Wheel Results ───────────────────────────────────────────────────────
export const spinResults = pgTable("spin_results", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  redemptionId: integer("redemption_id"),
  prizeIndex: integer("prize_index").notNull(),
  prizeLabel: text("prize_label").notNull(),
  prizeTokens: integer("prize_tokens").notNull(),
  prizeType: text("prize_type").notNull().default("tokens"), // tokens | coupon_10pct | coupon_25pct | gift_card_coffee | mystery | mini_jackpot | major_jackpot
  jackpotTypeWon: text("jackpot_type_won"),   // 'mini' | 'major' | null
  jackpotAmountWon: integer("jackpot_amount_won"),
  couponCode: text("coupon_code"),            // auto-generated code for coupon prizes
  fulfillmentStatus: text("fulfillment_status").notNull().default("fulfilled"), // fulfilled | pending | failed
  createdAt: timestamp("created_at").defaultNow(),
});
export type SpinResult = typeof spinResults.$inferSelect;

// ── Progressive Jackpots ─────────────────────────────────────────────────────
export const jackpots = pgTable("jackpots", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().unique(), // 'mini' | 'major'
  currentValue: integer("current_value").notNull(),
  startingValue: integer("starting_value").notNull(),
  contributionPerSpin: integer("contribution_per_spin").notNull(), // JCMOVES added per spin
  winProbabilityPct: decimal("win_probability_pct", { precision: 10, scale: 7 }).notNull(), // e.g. 0.05 = 0.05%
  lastWonAt: timestamp("last_won_at"),
  lastWinnerId: varchar("last_winner_id"),
  lastWinnerName: text("last_winner_name"),
  lastWonAmount: integer("last_won_amount"),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type Jackpot = typeof jackpots.$inferSelect;

// ── Spin Wheel Config ────────────────────────────────────────────────────────
export const spinConfig = pgTable("spin_config", {
  id: serial("id").primaryKey(),
  settingKey: varchar("setting_key").unique().notNull(),
  settingValue: text("setting_value").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type SpinConfigRow = typeof spinConfig.$inferSelect;

// ── Jackpot Wins ─────────────────────────────────────────────────────────────
export const jackpotWins = pgTable("jackpot_wins", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  jackpotType: text("jackpot_type").notNull(), // 'mini' | 'major'
  amount: integer("amount").notNull(),
  spinResultId: integer("spin_result_id"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type JackpotWin = typeof jackpotWins.$inferSelect;

// ── Activity Feed Events ──────────────────────────────────────────────────────
export const activityFeedEvents = pgTable("activity_feed_events", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"),
  eventType: text("event_type").notNull(), // spin_win | jackpot_win | mystery_box | coupon_won | coffee_won | redemption
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type ActivityFeedEvent = typeof activityFeedEvents.$inferSelect;

// ── Mystery Box Results ───────────────────────────────────────────────────────
export const mysteryBoxResults = pgTable("mystery_box_results", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  parentSpinResultId: integer("parent_spin_result_id"),
  rewardType: text("reward_type").notNull(), // tokens | gift_card_coffee | coupon_10pct | free_spin
  rewardValue: text("reward_value"),
  couponCode: text("coupon_code"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type MysteryBoxResult = typeof mysteryBoxResults.$inferSelect;

// ── Gift Card Inventory ──────────────────────────────────────────────────────
export const giftCardInventory = pgTable("gift_card_inventory", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  provider: text("provider"),         // e.g. "Starbucks", "Shell", "Meijer"
  code: text("code"),                  // the gift card code
  pin: text("pin"),
  status: text("status").notNull().default("available"), // available | assigned | used | voided
  assignedRedemptionId: integer("assigned_redemption_id"),
  createdAt: timestamp("created_at").defaultNow(),
  fulfilledAt: timestamp("fulfilled_at"),
});
export type GiftCardInventory = typeof giftCardInventory.$inferSelect;

// ── Invoice Credits ──────────────────────────────────────────────────────────
// Dollar credits that apply to job invoices
export const invoiceCredits = pgTable("invoice_credits", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  redemptionId: integer("redemption_id").notNull(),
  itemId: integer("item_id").notNull(),
  creditType: text("credit_type").notNull(), // moving | junk_removal | any
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull().default("active"), // active | applied | expired | cancelled
  appliedJobId: integer("applied_job_id"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type InvoiceCredit = typeof invoiceCredits.$inferSelect;

// ── Service Credit Balances ──────────────────────────────────────────────────
// Minutes/time credits for labor rewards
export const serviceCreditBalances = pgTable("service_credit_balances", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  itemId: integer("item_id").notNull(),
  redemptionId: integer("redemption_id").notNull(),
  minutesCredit: integer("minutes_credit").notNull().default(0),
  amountCents: integer("amount_cents").notNull().default(0),
  status: text("status").notNull().default("active"), // active | used | expired | cancelled
  expiresAt: timestamp("expires_at"),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type ServiceCreditBalance = typeof serviceCreditBalances.$inferSelect;

// ── Labor Calculator Quotes ──────────────────────────────────────────────────
export const laborQuotes = pgTable("labor_quotes", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  movers: integer("movers").notNull(),
  minutes: integer("minutes").notNull(),
  serviceType: text("service_type").notNull(), // 'moving' | 'loading' | 'furniture' | 'junk'
  paymentMode: text("payment_mode").notNull(), // 'tokens' | 'split' | 'cash'
  cashPriceCents: integer("cash_price_cents").notNull(),
  tokenPrice: integer("token_price").notNull(),
  tokenCap: integer("token_cap").notNull(),
  tokenApplied: integer("token_applied").notNull().default(0),
  cashDueCents: integer("cash_due_cents").notNull().default(0),
  userNotes: text("user_notes"),
  status: text("status").notNull().default("quoted"), // 'quoted' | 'redeemed' | 'scheduled' | 'completed' | 'expired' | 'canceled'
  leadId: varchar("lead_id"), // linked auto-created lead/job
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type LaborQuote = typeof laborQuotes.$inferSelect;
export type InsertLaborQuote = typeof laborQuotes.$inferInsert;

// ── Account Recovery Tokens ─────────────────────────────────────────────────
export const recoveryTokens = pgTable("recovery_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  token: varchar("token", { length: 8 }).notNull(),    // 6-digit OTP
  method: text("method").notNull(),                     // 'email' | 'sms'
  contact: text("contact").notNull(),                   // email address or phone number used
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RecoveryToken = typeof recoveryTokens.$inferSelect;

// ── ETH Staking (JC as Validator) ───────────────────────────────────────────
export const ethStakes = pgTable("eth_stakes", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  amount: decimal("amount", { precision: 20, scale: 8 }).notNull(),
  amountUsdAtEntry: decimal("amount_usd_at_entry", { precision: 20, scale: 2 }),
  txHash: text("tx_hash"),
  status: text("status").notNull().default("pending"), // pending | active | unstaking | completed | rejected
  apy: decimal("apy", { precision: 8, scale: 4 }).notNull().default("4.50"),
  validatorFeePct: decimal("validator_fee_pct", { precision: 8, scale: 4 }).notNull().default("0.50"),
  dailyRate: decimal("daily_rate", { precision: 20, scale: 12 }).notNull().default("0.000123287"),
  totalEarned: decimal("total_earned", { precision: 20, scale: 8 }).notNull().default("0"),
  lastPayoutAt: timestamp("last_payout_at").notNull().defaultNow(),
  stakedAt: timestamp("staked_at").notNull().defaultNow(),
  unstakeRequestedAt: timestamp("unstake_requested_at"),
  completedAt: timestamp("completed_at"),
  adminNotes: text("admin_notes"),
});

export const insertEthStakeSchema = createInsertSchema(ethStakes).omit({
  id: true, totalEarned: true, lastPayoutAt: true, stakedAt: true,
  unstakeRequestedAt: true, completedAt: true, adminNotes: true,
});

export type EthStake = typeof ethStakes.$inferSelect;
export type InsertEthStake = z.infer<typeof insertEthStakeSchema>;

// ── Sponsors ─────────────────────────────────────────────────────────────────
export const sponsors = pgTable("sponsors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessName: text("business_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  website: text("website"),
  logoUrl: text("logo_url"),
  tier: text("tier").notNull(), // 'starter' | 'growth' | 'power'
  status: text("status").notNull().default("pending"), // 'pending' | 'active' | 'cancelled'
  featured: boolean("featured").notNull().default(false),
  tierPrice: integer("tier_price").notNull(),
  squarePaymentUrl: text("square_payment_url"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertSponsorSchema = createInsertSchema(sponsors).omit({
  id: true,
  createdAt: true,
});

export type InsertSponsor = z.infer<typeof insertSponsorSchema>;
export type Sponsor = typeof sponsors.$inferSelect;

// ── Worker Day Blocks (days off) ────────────────────────────────────────────
export const workerDayBlocks = pgTable("worker_day_blocks", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  date: text("date").notNull(), // 'YYYY-MM-DD'
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type WorkerDayBlock = typeof workerDayBlocks.$inferSelect;

// ── Worker Weekly Schedule (recurring availability hours) ────────────────────
export const workerSchedule = pgTable("worker_schedule", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sun … 6=Sat
  startHour: integer("start_hour").default(8),  // 0–23
  endHour: integer("end_hour").default(17),      // 0–23
  isAvailable: boolean("is_available").default(true),
}, (t) => ({
  uniq: unique().on(t.userId, t.dayOfWeek),
}));
export type WorkerScheduleRow = typeof workerSchedule.$inferSelect;

// ── Worker & Admin Goals ─────────────────────────────────────────────────────
export const workerGoals = pgTable("worker_goals", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  weeklyJobGoal: integer("weekly_job_goal").default(0),
  monthlyJobGoal: integer("monthly_job_goal").default(0),
  preferredJobSize: text("preferred_job_size").default("any"), // 'small'|'medium'|'large'|'any'
  notes: text("notes"),
  setByAdminId: varchar("set_by_admin_id"),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type WorkerGoal = typeof workerGoals.$inferSelect;

// ── Worker Hour Overrides (date-specific custom hours) ───────────────────────
export const workerHourOverrides = pgTable("worker_hour_overrides", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  date: text("date").notNull(), // 'YYYY-MM-DD'
  startHour: integer("start_hour").notNull(), // 0-23
  endHour: integer("end_hour").notNull(),     // 0-23
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uniq: unique().on(t.userId, t.date),
}));
export type WorkerHourOverride = typeof workerHourOverrides.$inferSelect;
export const insertWorkerHourOverrideSchema = createInsertSchema(workerHourOverrides).omit({ id: true, createdAt: true });
export type InsertWorkerHourOverride = z.infer<typeof insertWorkerHourOverrideSchema>;

// ── Trash Valet Subscriptions ─────────────────────────────────────────────────
export const trashSubscriptions = pgTable("trash_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default("MI"),
  zip: text("zip").notNull().default(""),
  lat: decimal("lat", { precision: 10, scale: 7 }),
  lng: decimal("lng", { precision: 10, scale: 7 }),
  distanceMiles: decimal("distance_miles", { precision: 6, scale: 3 }),
  travelSurchargeMonthly: decimal("travel_surcharge_monthly", { precision: 6, scale: 2 }).notNull().default("0"),
  cans: integer("cans").notNull().default(1),
  bagCount: integer("bag_count").notNull().default(0),
  recyclingEnabled: boolean("recycling_enabled").notNull().default(false),
  recyclingAnchorDate: date("recycling_anchor_date"),
  serviceDayOfWeek: integer("service_day_of_week").notNull().default(1),
  recyclingDayOfWeek: integer("recycling_day_of_week"),
  serviceNotes: text("service_notes"),
  planType: text("plan_type").notNull().default("monthly"),
  weeklyBasePrice: decimal("weekly_base_price", { precision: 8, scale: 2 }).notNull(),
  projectedMonthlyPrice: decimal("projected_monthly_price", { precision: 8, scale: 2 }).notNull(),
  monthlyMinimumApplied: boolean("monthly_minimum_applied").notNull().default(false),
  finalMonthlyPrice: decimal("final_monthly_price", { precision: 8, scale: 2 }).notNull(),
  // Auto-applied bundle discount (Task #114) — already baked into
  // finalMonthlyPrice; stored separately for invoice line-item display.
  bundleDiscountAmount: decimal("bundle_discount_amount", { precision: 8, scale: 2 }).notNull().default("0"),
  bundleDiscountReason: text("bundle_discount_reason"),
  billingStatus: text("billing_status").notNull().default("active"),
  nextBillingDate: date("next_billing_date"),
  status: text("status").notNull().default("active"),
  pauseStartDate: date("pause_start_date"),
  pauseEndDate: date("pause_end_date"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_trash_subs_status").on(table.status),
  index("idx_trash_subs_address").on(table.address),
]);

export const insertTrashSubscriptionSchema = createInsertSchema(trashSubscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type TrashSubscription = typeof trashSubscriptions.$inferSelect;
export type InsertTrashSubscription = z.infer<typeof insertTrashSubscriptionSchema>;

// ── Trash Valet Jobs ──────────────────────────────────────────────────────────
export const trashJobs = pgTable("trash_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: varchar("subscription_id").notNull().references(() => trashSubscriptions.id),
  serviceWeekOf: date("service_week_of").notNull(),
  serviceType: text("service_type").notNull().default("trash_valet"),
  cans: integer("cans").notNull(),
  bagCount: integer("bag_count").notNull().default(0),
  isRecyclingWeek: boolean("is_recycling_week").notNull().default(false),
  weeklyBasePrice: decimal("weekly_base_price", { precision: 8, scale: 2 }).notNull(),
  recyclingCharge: decimal("recycling_charge", { precision: 8, scale: 2 }).notNull().default("0"),
  travelChargePortion: decimal("travel_charge_portion", { precision: 8, scale: 2 }).notNull().default("0"),
  jobValue: decimal("job_value", { precision: 8, scale: 2 }).notNull(),
  pullOutDate: date("pull_out_date"),
  returnDate: date("return_date"),
  pulledOutAt: timestamp("pulled_out_at"),
  returnedAt: timestamp("returned_at"),
  status: text("status").notNull().default("scheduled"),
  completedBy: varchar("completed_by").references(() => users.id),
  completedAt: timestamp("completed_at"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_trash_jobs_sub").on(table.subscriptionId),
  index("idx_trash_jobs_week").on(table.serviceWeekOf),
  index("idx_trash_jobs_status").on(table.status),
]);

export const insertTrashJobSchema = createInsertSchema(trashJobs).omit({
  id: true,
  createdAt: true,
});
export type TrashJob = typeof trashJobs.$inferSelect;
export type InsertTrashJob = z.infer<typeof insertTrashJobSchema>;

// ── Lawn Care Quotes ──────────────────────────────────────────────────────────
export const lawnCareQuotes = pgTable("lawn_care_quotes", {
  id: serial("id").primaryKey(),

  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),

  serviceType: text("service_type").notNull().default("lawn_care"),
  serviceCategory: text("service_category").notNull(),
  serviceFrequency: text("service_frequency").notNull(),
  propertySize: text("property_size").notNull(),
  squareFootage: integer("square_footage"),
  propertyCondition: text("property_condition").notNull(),

  addOns: jsonb("add_ons").notNull().default(sql`'[]'::jsonb`),
  notes: text("notes"),
  photoUrls: jsonb("photo_urls").notNull().default(sql`'[]'::jsonb`),

  hasFence: boolean("has_fence").default(false),
  hasPets: boolean("has_pets").default(false),
  hasSteepSlope: boolean("has_steep_slope").default(false),
  needsHaulAway: boolean("needs_haul_away").default(false),

  recommendedCrewType: text("recommended_crew_type"),
  recommendedCrewSize: integer("recommended_crew_size"),

  basePrice: decimal("base_price", { precision: 10, scale: 2 }).default("0"),
  conditionMultiplier: decimal("condition_multiplier", { precision: 5, scale: 2 }).default("1.00"),
  frequencyMultiplier: decimal("frequency_multiplier", { precision: 5, scale: 2 }).default("1.00"),
  addOnTotal: decimal("add_on_total", { precision: 10, scale: 2 }).default("0"),
  travelFee: decimal("travel_fee", { precision: 10, scale: 2 }).default("0"),
  totalQuoted: decimal("total_quoted", { precision: 10, scale: 2 }).default("0"),

  // Auto-applied bundle discount (Task #114) — already baked into totalQuoted;
  // stored separately so the customer-facing pricing card can show the line.
  bundleDiscountAmount: decimal("bundle_discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  bundleDiscountReason: text("bundle_discount_reason"),

  isCustomEstimate: boolean("is_custom_estimate").default(false),

  requestedStartDate: text("requested_start_date"),
  requestedTimeWindow: text("requested_time_window"),

  status: text("status").notNull().default("quote_requested"),

  // Attribution marker for re-book funnel (e.g. "rebook_email"). Populated when
  // a quote/lead is created via the re-book flow with a known utm_source so the
  // admin dashboard can report how many re-books a campaign produced.
  rebookSource: text("rebook_source"),

  // Bundle grouping (Task #115). Mirrors leads.bundleGroupId — set on the
  // primary lawn-care quote when the customer also booked add-on services in
  // the same submission. Companion leads in the leads table carry the same id.
  bundleGroupId: text("bundle_group_id"),

  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const insertLawnCareQuoteSchema = createInsertSchema(lawnCareQuotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type LawnCareQuote = typeof lawnCareQuotes.$inferSelect;
export type InsertLawnCareQuote = z.infer<typeof insertLawnCareQuoteSchema>;

// ── Lawn Care Re-book Reminder Sends ──────────────────────────────────────────
// One row per (quoteId, sentAt) pair. The sweep checks the most recent send
// per quote against the 60-day window before sending again. Writing this row
// happens BEFORE the email is dispatched so a crash mid-batch can't cause a
// re-spam on the next run.
export const lawnCareRebookReminders = pgTable("lawn_care_rebook_reminders", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  sentAt: timestamp("sent_at").notNull().default(sql`now()`),
  status: text("status").notNull().default("sent"), // 'sent' | 'failed'
});
export type LawnCareRebookReminder = typeof lawnCareRebookReminders.$inferSelect;

// ── Generic Service Re-book Reminder Sends ───────────────────────────────────
// Used by the shared serviceRebookReminder service for non-lawn-care services
// (snow_removal, junk_removal, window_cleaning). One row per (serviceKey,
// leadId, sentAt). Same write-before-dispatch dedupe guarantee as
// lawn_care_rebook_reminders. Lawn-care keeps using its own table for
// historical continuity.
export const serviceRebookReminders = pgTable("service_rebook_reminders", {
  id: serial("id").primaryKey(),
  serviceKey: text("service_key").notNull(), // 'snow_removal' | 'junk_removal' | 'window_cleaning'
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  sentAt: timestamp("sent_at").notNull().default(sql`now()`),
  status: text("status").notNull().default("sent"), // 'sent' | 'failed'
}, (table) => [
  index("idx_svc_rebook_service_sent").on(table.serviceKey, table.sentAt),
  index("idx_svc_rebook_lead").on(table.leadId),
]);
export type ServiceRebookReminder = typeof serviceRebookReminders.$inferSelect;

// ── Service Re-book Opt-outs (snow / junk / window cleaning) ─────────────────
// Mirrors lawnCareRebookOptouts but for the generic re-book reminder engine.
// Either email or phone (or both) is recorded — whichever the unsubscribe
// link carried — and the eligibility filter checks both keys. Opting out is
// global across snow/junk/window so customers don't have to click three
// separate links to silence all re-book reminders.
export const serviceRebookOptouts = pgTable("service_rebook_optouts", {
  id: serial("id").primaryKey(),
  email: text("email"),
  phone: text("phone"),
  source: text("source").notNull().default("email_link"), // 'email_link' | 'admin' | 'reply'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("uq_svc_rebook_optout_email").on(table.email).where(sql`${table.email} IS NOT NULL`),
  uniqueIndex("uq_svc_rebook_optout_phone").on(table.phone).where(sql`${table.phone} IS NOT NULL`),
]);
export type ServiceRebookOptout = typeof serviceRebookOptouts.$inferSelect;

// ── Lawn Care Re-book Opt-outs ────────────────────────────────────────────────
// Recipients who clicked the unsubscribe link in a re-book reminder email.
// The eligibility query joins/filters against this table so opted-out
// customers never receive another reminder. Either email or phone (or both)
// is recorded — whichever the unsubscribe link carried — and the eligibility
// filter checks both keys.
export const lawnCareRebookOptouts = pgTable("lawn_care_rebook_optouts", {
  id: serial("id").primaryKey(),
  email: text("email"),
  phone: text("phone"),
  source: text("source").notNull().default("email_link"), // 'email_link' | 'admin' | 'reply'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("uq_rebook_optout_email").on(table.email).where(sql`${table.email} IS NOT NULL`),
  uniqueIndex("uq_rebook_optout_phone").on(table.phone).where(sql`${table.phone} IS NOT NULL`),
]);
export type LawnCareRebookOptout = typeof lawnCareRebookOptouts.$inferSelect;

// ── Lawn Care Recurring Plans ─────────────────────────────────────────────────
export const lawnCarePlans = pgTable("lawn_care_plans", {
  id: serial("id").primaryKey(),

  quoteId: integer("quote_id").notNull(),

  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),

  frequency: text("frequency").notNull(),
  startDate: text("start_date").notNull(),
  nextServiceDate: text("next_service_date"),
  isActive: boolean("is_active").default(true),

  crewType: text("crew_type"),
  crewSize: integer("crew_size"),

  serviceCategory: text("service_category").notNull(),
  propertySize: text("property_size").notNull(),
  propertyCondition: text("property_condition").notNull(),
  addOns: jsonb("add_ons").notNull().default(sql`'[]'::jsonb`),

  recurringPrice: decimal("recurring_price", { precision: 10, scale: 2 }).default("0"),
  notes: text("notes"),

  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const insertLawnCarePlanSchema = createInsertSchema(lawnCarePlans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type LawnCarePlan = typeof lawnCarePlans.$inferSelect;
export type InsertLawnCarePlan = z.infer<typeof insertLawnCarePlanSchema>;

// ── Rate Limit Buckets ───────────────────────────────────────────────────────
// Persistent throttle state for public endpoints. Survives process restarts
// (so abusers can't reset by waiting for a deploy) and is shared across
// processes if the app ever scales horizontally.
//   - For sliding-window limits (e.g. per-IP lookup): `hits` holds an array
//     of recent timestamps (ms epoch) within the window.
//   - For cooldown limits (e.g. per-phone rebook): `lastAt` holds the most
//     recent action timestamp (ms epoch).
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(), // "<scope>:<identifier>"
  hits: jsonb("hits").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  lastAt: bigint("last_at", { mode: "number" }),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;

// ── Idempotency Keys ─────────────────────────────────────────────────────────
export const idempotencyKeys = pgTable("idempotency_keys", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  scope: text("scope").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export const insertIdempotencyKeySchema = createInsertSchema(idempotencyKeys).omit({ id: true, createdAt: true });
export type InsertIdempotencyKey = z.infer<typeof insertIdempotencyKeySchema>;

// ── Job Trade Requests ────────────────────────────────────────────────────────
// Workers assigned to a job can request to swap their slot with another worker.
// Admin reviews and approves/denies. On approval the crewMembers array is updated.
export const jobTradeRequests = pgTable("job_trade_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id),
  requesterId: varchar("requester_id").notNull().references(() => users.id),
  targetId: varchar("target_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'denied'
  requesterNote: text("requester_note"),
  adminNote: text("admin_note"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_trade_requests_lead").on(table.leadId),
  index("idx_trade_requests_requester").on(table.requesterId),
  index("idx_trade_requests_target").on(table.targetId),
  index("idx_trade_requests_status").on(table.status),
]);

export const insertJobTradeRequestSchema = createInsertSchema(jobTradeRequests).omit({
  id: true,
  status: true,
  adminNote: true,
  reviewedByUserId: true,
  reviewedAt: true,
  createdAt: true,
});
export type JobTradeRequest = typeof jobTradeRequests.$inferSelect;
export type InsertJobTradeRequest = z.infer<typeof insertJobTradeRequestSchema>;

// ── Bundle Discount Audit (Task #114) ────────────────────────────────────────
// One row per discount application across any service. Lets us answer
// "how much did the bundle discount cost us this month" and "which discount
// reasons drive the most repeat business" without joining the per-service
// tables. Free-form referenceTable + referenceId because applications
// happen across leads / lawn_care_quotes / trash_subscriptions.
export const bundleDiscountApplications = pgTable("bundle_discount_applications", {
  id: serial("id").primaryKey(),
  referenceTable: text("reference_table").notNull(), // 'leads' | 'lawn_care_quotes' | 'trash_subscriptions'
  referenceId: text("reference_id").notNull(),
  serviceType: text("service_type").notNull(), // 'lawn_care' | 'trash_valet' | 'window_cleaning' | etc
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  subtotalBefore: decimal("subtotal_before", { precision: 10, scale: 2 }).notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).notNull(),
  discountPercent: integer("discount_percent").notNull().default(10),
  reason: text("reason").notNull(), // 'bundle_intent' | 'cross_service_history'
  triggeringServices: text("triggering_services").array().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_bundle_disc_ref").on(table.referenceTable, table.referenceId),
  index("idx_bundle_disc_phone").on(table.customerPhone),
  index("idx_bundle_disc_email").on(table.customerEmail),
  index("idx_bundle_disc_created").on(table.createdAt),
]);
export type BundleDiscountApplication = typeof bundleDiscountApplications.$inferSelect;
export const insertBundleDiscountApplicationSchema = createInsertSchema(bundleDiscountApplications).omit({ id: true, createdAt: true });
export type InsertBundleDiscountApplication = z.infer<typeof insertBundleDiscountApplicationSchema>;

// ── Multi-Service Booking Foundation (Task #128) ─────────────────────────────
// Parent `bookings` row + N `booking_service_items` children. Lets a single
// checkout carry every service the customer wants and apply one combined
// discount via `bundle_definitions`. Live alongside the legacy single-service
// tables — nothing in `leads` / `lawn_care_quotes` / `trash_subscriptions`
// changes yet. The pricing engine in `server/services/bookingPricing.ts` is
// the single source of truth for subtotal / discount / final / token estimate.
//
// IDs are varchar UUIDs for new tables (matches the existing convention used
// by `leads`, `bundleDiscountApplications` etc.) so we never need to migrate
// id types later.

// Pricing versions are immutable once published. `pricing_rules` stores one
// typed JSON rule-group per version (labor, travel, service tiers, offers,
// rewards, etc.), while the publication audit provides an operator-visible
// history of every activation or rollback.
export const pricingVersions = pgTable("pricing_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  status: text("status").notNull().default("draft"), // draft | active | archived
  currency: text("currency").notNull().default("USD"),
  effectiveAt: timestamp("effective_at"),
  notes: text("notes"),
  createdByUserId: varchar("created_by_user_id"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  publishedAt: timestamp("published_at"),
}, (table) => [
  index("idx_pricing_versions_status").on(table.status, table.createdAt),
]);

export type QuoteRevision = typeof quoteRevisions.$inferSelect;

export const pricingRules = pgTable("pricing_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pricingVersionId: varchar("pricing_version_id").notNull().references(() => pricingVersions.id, { onDelete: "cascade" }),
  ruleKey: text("rule_key").notNull(),
  serviceCode: text("service_code"),
  payload: jsonb("payload").notNull(),
  discountEligible: boolean("discount_eligible").notNull().default(true),
  isPassThrough: boolean("is_pass_through").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("idx_pricing_rules_version_key").on(table.pricingVersionId, table.ruleKey),
  index("idx_pricing_rules_service").on(table.serviceCode),
]);

export const pricingPublicationAudit = pgTable("pricing_publication_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pricingVersionId: varchar("pricing_version_id").notNull().references(() => pricingVersions.id),
  action: text("action").notNull(), // seed | publish | rollback
  previousVersionCode: text("previous_version_code"),
  actorUserId: varchar("actor_user_id"),
  actorEmail: text("actor_email"),
  metadata: jsonb("metadata").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_pricing_publication_audit_created").on(table.createdAt),
]);

export const bookings = pgTable("bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone").notNull(),
  serviceAddress: text("service_address"),
  notes: text("notes"),
  // Pricing snapshot — written by the engine when the booking is persisted
  // so admin views & invoices read deterministic numbers without recomputing.
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  discountTotal: decimal("discount_total", { precision: 10, scale: 2 }).notNull().default("0"),
  finalTotal: decimal("final_total", { precision: 10, scale: 2 }).notNull().default("0"),
  bundleAppliedCode: text("bundle_applied_code"), // bundle_definitions.code (nullable)
  tokenEstimate: integer("token_estimate").notNull().default(0), // JCMOVES estimate
  // Task #131 — reward inputs snapshot. Captured at booking creation so the
  // estimate the customer sees is byte-identical to what disburseBookingTokens
  // credits at confirmation, even if rewardSettings or bundle multipliers are
  // edited in between. Nullable for legacy rows; issuer falls back to live.
  rewardFlatBonusSnapshot: integer("reward_flat_bonus_snapshot"),
  rewardEarnRateSnapshot: decimal("reward_earn_rate_snapshot", { precision: 10, scale: 4 }),
  rewardBonusMultiplierSnapshot: decimal("reward_bonus_multiplier_snapshot", { precision: 4, scale: 2 }),
  pricingVersionId: varchar("pricing_version_id").references(() => pricingVersions.id),
  pricingVersionCode: text("pricing_version_code"),
  pricingSnapshot: jsonb("pricing_snapshot"),
  status: text("status").notNull().default("quote"), // 'quote' | 'booked' | 'in_progress' | 'completed' | 'cancelled'
  source: text("source"), // e.g. 'web_multi_book' — for analytics later
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_bookings_phone").on(table.customerPhone),
  index("idx_bookings_email").on(table.customerEmail),
  index("idx_bookings_created").on(table.createdAt),
]);

export const bookingServiceItems = pgTable("booking_service_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  serviceCode: text("service_code").notNull(), // FK-by-code into service_catalog.code
  serviceLabel: text("service_label").notNull(), // snapshot for admin/email rendering
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  lineSubtotal: decimal("line_subtotal", { precision: 10, scale: 2 }).notNull(),
  priceMode: text("price_mode").notNull().default("fixed"), // 'fixed' | 'hourly' | 'per_unit' | 'quote'
  details: jsonb("details").default("{}"), // free-form per-service detail (e.g. movers, hours)
  // Task #130: per-child lifecycle so the admin pipeline can drive each
  // service in a bundle independently. Parent `bookings.status` is rolled
  // up from the children (see rollupBookingStatus in routes/bookings.ts).
  status: text("status").notNull().default("pending"), // 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  assignedToUserId: varchar("assigned_to_user_id"), // primary crew lead
  crewMembers: text("crew_members").array().default(sql`ARRAY[]::text[]`),
  notes: text("notes"), // admin-visible per-child notes
  scheduledAt: timestamp("scheduled_at"), // Task #130: per-child scheduled date (admin sets, customer sees on chip)
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_booking_items_booking").on(table.bookingId),
  index("idx_booking_items_service").on(table.serviceCode),
]);

// Resumable, staff-only conversational booking drafts. The normalized draft
// is safe to resume across devices; raw microphone audio is never stored.
export const quickBookingSessions = pgTable("quick_booking_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(1),
  transcriptText: text("transcript_text"),
  structuredDraft: jsonb("structured_draft").notNull().default("{}"),
  fieldMeta: jsonb("field_meta").notNull().default("{}"),
  missingFields: jsonb("missing_fields").notNull().default("[]"),
  reviewReasons: jsonb("review_reasons").notNull().default("[]"),
  pricingPreview: jsonb("pricing_preview"),
  suggestedCrew: jsonb("suggested_crew").notNull().default("[]"),
  assistantMessage: text("assistant_message"),
  nextQuestion: text("next_question"),
  suggestions: jsonb("suggestions").notNull().default("[]"),
  agentMetadata: jsonb("agent_metadata").notNull().default("{}"),
  metrics: jsonb("metrics").notNull().default("{}"),
  bookingId: varchar("booking_id").references(() => bookings.id),
  leadId: varchar("lead_id").references(() => leads.id),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_quick_booking_sessions_creator").on(table.createdByUserId, table.updatedAt),
  index("idx_quick_booking_sessions_status").on(table.status, table.updatedAt),
]);

// Task #130: admin override of an auto-applied bundle discount, with an audit
// trail. Admin can change `bookings.discountTotal`; we snapshot the original
// value once on the booking row and append an audit row per change.
export const bookingDiscountAuditLog = pgTable("booking_discount_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  adminUserId: varchar("admin_user_id"), // null only for system overrides
  previousDiscount: decimal("previous_discount", { precision: 10, scale: 2 }).notNull(),
  newDiscount: decimal("new_discount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_booking_discount_audit_booking").on(table.bookingId),
]);

export const serviceCatalog = pgTable("service_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(), // e.g. 'moving', 'junk_removal', 'junk_reset'
  name: text("name").notNull(),
  category: text("category").notNull(), // 'core' | 'addon'
  defaultPriceMode: text("default_price_mode").notNull().default("fixed"), // 'fixed' | 'hourly' | 'per_unit' | 'quote'
  defaultPrice: decimal("default_price", { precision: 10, scale: 2 }), // base/unit price (nullable for 'quote')
  suggestedMin: decimal("suggested_min", { precision: 10, scale: 2 }), // small-job range low
  suggestedMax: decimal("suggested_max", { precision: 10, scale: 2 }), // small-job range high
  discountEligible: boolean("discount_eligible").notNull().default(true),
  isAddon: boolean("is_addon").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  description: text("description"),
  metadata: jsonb("metadata").default("{}"),
  // Task #218 — labor-hours backbone: every catalog row carries minCrew and
  // per-job-size default labor hours. quoteByLaborHours reads these to
  // produce crew × hours × the canonical active rate; the route layer clamps to
  // suggestedMin/suggestedMax for safety. Both columns are nullable so
  // older rows continue to fall back to the SERVICE_LABOR_DEFAULTS table
  // in shared/pricingTables.ts (single source of truth for the seed).
  minCrew: integer("min_crew"),
  defaultLaborHours: jsonb("default_labor_hours").$type<{
    small?: number;
    medium?: number;
    large?: number;
    default?: number;
  }>(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_service_catalog_active").on(table.isActive, table.sortOrder),
]);

export const bundleDefinitions = pgTable("bundle_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(), // e.g. 'move_junk_reset'
  name: text("name").notNull(),
  description: text("description"),
  // Required service codes that must all be present in the booking for this
  // bundle to apply. Matched by exact code from service_catalog.code.
  serviceComboJson: jsonb("service_combo_json").$type<string[]>().notNull(),
  discountType: text("discount_type").notNull(), // 'percent' | 'fixed'
  discountValue: decimal("discount_value", { precision: 10, scale: 2 }).notNull(),
  maxDiscount: decimal("max_discount", { precision: 10, scale: 2 }), // dollar cap (nullable)
  // Task #131 — bonus JCMOVES multiplier applied to the customer reward when
  // this bundle wins. Default 1.00 = no bonus. Stored as decimal so admins
  // can set fractional multipliers (e.g. 1.25 = +25%).
  bonusMultiplier: decimal("bonus_multiplier", { precision: 4, scale: 2 }).notNull().default("1.00"),
  isFeatured: boolean("is_featured").notNull().default(false),
  // Merchandising slot used by the upcoming /book bundle strip:
  // 'most_popular' | 'best_value' | 'fast_addon' | null
  merchandisingSlot: text("merchandising_slot"),
  priority: integer("priority").notNull().default(100), // tiebreak when multiple match
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_bundle_def_active").on(table.isActive, table.priority),
  index("idx_bundle_def_slot").on(table.merchandisingSlot),
]);

// Task #131 — durable audit trail of admin edits to bundle_definitions
// (discount values, multipliers, featured/active toggles). Mirrors the
// existing booking_discount_audit_log so admins have a queryable history.
export const bundleSettingsAuditLog = pgTable("bundle_settings_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bundleCode: text("bundle_code").notNull(),
  adminUserId: varchar("admin_user_id"),
  adminEmail: text("admin_email"),
  before: jsonb("before").notNull(),
  after: jsonb("after").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_bundle_audit_code").on(table.bundleCode),
  index("idx_bundle_audit_created").on(table.createdAt),
]);

export const crewRequirements = pgTable("crew_requirements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceCode: text("service_code").notNull().unique(), // FK-by-code into service_catalog.code
  minCrew: integer("min_crew").notNull().default(1),
  defaultCrew: integer("default_crew").notNull().default(2),
  requiresTruck: boolean("requires_truck").notNull().default(false),
  capabilities: text("capabilities").array().default(sql`ARRAY[]::text[]`),
  estimatedMinutesMin: integer("estimated_minutes_min"),
  estimatedMinutesMax: integer("estimated_minutes_max"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export type Booking = typeof bookings.$inferSelect;
export type BookingServiceItem = typeof bookingServiceItems.$inferSelect;
export type BookingDiscountAuditEntry = typeof bookingDiscountAuditLog.$inferSelect;
export type ServiceCatalogEntry = typeof serviceCatalog.$inferSelect;
export type BundleDefinition = typeof bundleDefinitions.$inferSelect;
export type CrewRequirement = typeof crewRequirements.$inferSelect;
export type PricingVersion = typeof pricingVersions.$inferSelect;
export type PricingRule = typeof pricingRules.$inferSelect;
export type PricingPublicationAuditEntry = typeof pricingPublicationAudit.$inferSelect;

export const insertBookingSchema = createInsertSchema(bookings).omit({
  id: true,
  subtotal: true,
  discountTotal: true,
  finalTotal: true,
  bundleAppliedCode: true,
  tokenEstimate: true,
  createdAt: true,
});
export const insertBookingServiceItemSchema = createInsertSchema(bookingServiceItems).omit({
  id: true,
  createdAt: true,
  lineSubtotal: true,
});
export const insertServiceCatalogSchema = createInsertSchema(serviceCatalog).omit({ id: true, createdAt: true });
export const insertBundleDefinitionSchema = createInsertSchema(bundleDefinitions).omit({ id: true, createdAt: true });
export const insertCrewRequirementSchema = createInsertSchema(crewRequirements).omit({ id: true, createdAt: true });
export const insertPricingVersionSchema = createInsertSchema(pricingVersions).omit({ id: true, createdAt: true, publishedAt: true });
export const insertPricingRuleSchema = createInsertSchema(pricingRules).omit({ id: true, createdAt: true });

export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type InsertBookingServiceItem = z.infer<typeof insertBookingServiceItemSchema>;
export type InsertServiceCatalogEntry = z.infer<typeof insertServiceCatalogSchema>;
export type InsertBundleDefinition = z.infer<typeof insertBundleDefinitionSchema>;
export type InsertCrewRequirement = z.infer<typeof insertCrewRequirementSchema>;
export type InsertPricingVersion = z.infer<typeof insertPricingVersionSchema>;
export type InsertPricingRule = z.infer<typeof insertPricingRuleSchema>;

// Quote/persist request shapes used by /api/bookings/quote and /api/bookings.
// Declared in shared/ so the upcoming frontend can import the same types and
// the route handlers don't need any `any` casts.
export const bookingQuoteItemInputSchema = z.object({
  serviceCode: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().nonnegative().optional(), // overrides catalog default
  priceMode: z.enum(["fixed", "hourly", "per_unit", "quote"]).optional(),
  label: z.string().optional(), // overrides catalog name (used when caller wants custom display)
  details: z.record(z.any()).optional(),
});
export type BookingQuoteItemInput = z.infer<typeof bookingQuoteItemInputSchema>;

export const bookingQuoteRequestSchema = z.object({
  items: z.array(bookingQuoteItemInputSchema).min(1),
  source: z.string().optional(),
  serviceAddress: z.string().trim().max(500).optional(),
  serviceStops: z.array(z.string().trim().min(4).max(500)).max(10).optional(),
  requestedDate: z.string().trim().max(50).optional(),
  promoCode: z.string().trim().max(50).optional(),
  referralSlug: z.string().trim().max(80).optional(),
  // Task #175 — JCMOVES tokens the customer wants to redeem against this
  // quote. Validated against the redemption rules (min 500 / increment
  // 500 / tier cap) on the server; rejected amounts surface as a quote
  // error rather than silently zeroing out.
  applyTokens: z.number().int().nonnegative().optional(),
  /** Customer JCMOVES tier — used to compute the redemption cap. */
  customerTier: z.string().optional(),
  /** Task #174 — service coordinates for demand/surge zone pricing. */
  serviceLat: z.number().optional(),
  serviceLng: z.number().optional(),
});
export type BookingQuoteRequest = z.infer<typeof bookingQuoteRequestSchema>;

export const bookingCreateRequestSchema = bookingQuoteRequestSchema.extend({
  customerName: z.string().min(1),
  customerEmail: z.string().email().optional().or(z.literal("")),
  customerPhone: leadPhoneNumberSchema,
  serviceAddress: z.string().optional(),
  notes: z.string().optional(),
  // Customer self-service requests receive a transactional receipt. Worker
  // entries only send it when the staff member explicitly opts in.
  sendConfirmationEmail: z.boolean().optional(),
  marketingCampaignId: z.string().trim().max(120).optional(),
  marketingTracking: z.record(z.any()).optional(),
  // Task #175 — Customer chose "Pay from JCMOVES wallet" on the review
  // step. Server attempts an atomic wallet debit; on insufficient
  // balance we mark the booking pending-payment and fall back to Square.
  payFromWallet: z.boolean().optional(),
  // Marketplace zone estimate shown to the customer at submit time.
  // Stored on the linked lead so later rate changes do not rewrite history.
  marketplaceQuotePreview: z.record(z.any()).optional(),
});
export type BookingCreateRequest = z.infer<typeof bookingCreateRequestSchema>;

// ── Site Traffic Analytics ───────────────────────────────────────────────────
export const pageViews = pgTable("page_views", {
  id: serial("id").primaryKey(),
  page: text("page").notNull(),
  visitedAt: timestamp("visited_at").defaultNow().notNull(),
  visitorId: text("visitor_id"),
  userId: varchar("user_id"),
  referrer: text("referrer"),
  userAgent: text("user_agent"),
});
export type PageView = typeof pageViews.$inferSelect;

export const bookingFunnelEvents = pgTable("booking_funnel_events", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id"),
  sessionId: text("session_id"),
  userId: varchar("user_id"),
  page: text("page").notNull().default("/book"),
  eventType: text("event_type").notNull(), // step_snapshot | quote_error | submit_error | submit_success
  step: text("step"),
  bookingId: varchar("booking_id"),
  leadId: varchar("lead_id"),
  errorMessage: text("error_message"),
  fieldSnapshot: jsonb("field_snapshot").default("{}"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_booking_funnel_created").on(table.createdAt),
  index("idx_booking_funnel_visitor").on(table.visitorId),
  index("idx_booking_funnel_type").on(table.eventType),
]);
export type BookingFunnelEvent = typeof bookingFunnelEvents.$inferSelect;

export const calibrationSessions = pgTable("calibration_sessions", {
  id: serial("id").primaryKey(),
  appliedAt: timestamp("applied_at").defaultNow(),
  appliedByUserId: varchar("applied_by_user_id"),
  appliedByName: text("applied_by_name"),
  values: jsonb("values").$type<Record<string, number>>().notNull(),
  notes: text("notes"),
});
export type CalibrationSession = typeof calibrationSessions.$inferSelect;
export const insertCalibrationSessionSchema = createInsertSchema(calibrationSessions).omit({
  id: true,
  appliedAt: true,
});
export type InsertCalibrationSession = z.infer<typeof insertCalibrationSessionSchema>;

// ── Pipeline orchestrator observability (Task #170) ──────────────────────
// One row per /api/pipeline/run invocation (and per shadow-mode run from
// /api/bookings/quote). Captures the input hash, each step's outcome, the
// decided total/crew/eta, and the parity comparison against the legacy
// /api/bookings/quote path while shadow mode is active.
export const pipelineRuns = pgTable("pipeline_runs", {
  id: serial("id").primaryKey(),
  inputHash: varchar("input_hash", { length: 64 }).notNull(),
  source: text("source").default("api"), // 'api' | 'shadow' | 'internal'
  status: text("status").notNull().default("ok"), // 'ok' | 'error' | 'partial'
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }),
  surgeMultiplier: decimal("surge_multiplier", { precision: 5, scale: 3 }),
  // Task #185 — Persist demand intelligence so the calibrate page can
  // chart 7-day patterns. theoreticalSurge captures what surge *would*
  // have applied even when calibration mode is shadow/soft.
  demandScore: decimal("demand_score", { precision: 5, scale: 3 }),
  theoreticalSurge: decimal("theoretical_surge", { precision: 5, scale: 3 }),
  zoneCode: varchar("zone_code", { length: 64 }),
  crewSize: integer("crew_size"),
  assignedCrewId: varchar("assigned_crew_id"),
  tokenEstimate: integer("token_estimate"),
  steps: jsonb("steps").notNull().default("[]"), // [{ name, ok, ms, note }]
  shadowCompare: jsonb("shadow_compare"), // { legacyTotal, pipelineTotal, match }
  elapsedMs: integer("elapsed_ms"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_pipeline_runs_created").on(table.createdAt),
  index("idx_pipeline_runs_input_hash").on(table.inputHash),
]);
export type PipelineRun = typeof pipelineRuns.$inferSelect;

// Task #184 — Operator-editable demand/dispatch zones. Replaces the
// hard-coded TERRITORIES list so the business can add neighborhoods and
// re-draw boundaries without a code release.
export const demandZones = pgTable("demand_zones", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: text("name").notNull(),
  centerLat: decimal("center_lat", { precision: 9, scale: 6 }).notNull(),
  centerLng: decimal("center_lng", { precision: 9, scale: 6 }).notNull(),
  radiusMi: decimal("radius_mi", { precision: 6, scale: 2 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export const insertDemandZoneSchema = createInsertSchema(demandZones).omit({
  id: true,
  createdAt: true,
});
export type InsertDemandZone = z.infer<typeof insertDemandZoneSchema>;
export type DemandZone = typeof demandZones.$inferSelect;
