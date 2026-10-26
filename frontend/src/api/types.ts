export type ApiProtocol = "REST" | "MCP";

export interface ApiProduct {
  id: number;
  name: string;
  displayName: string;
  description: string;
  version: string;
  status: "ACTIVE" | "DEPRECATED" | "BETA";
  owner: string;
  baseUrl: string;
  openApiSpecUrl: string;
  approvalMode: "AUTOMATIC" | "MANUAL";
  tags: string[];
  contactTeam: string;
  contactEmail: string;
  updatedAt: string;
  /** Wire protocol — REST for traditional HTTP APIs, MCP for Model Context
   * Protocol servers discovered from MCPServerRegistration CRs. */
  protocol: ApiProtocol;
  /** Public MCP endpoint URL (only set when protocol === "MCP"). */
  mcpEndpoint: string | null;
  /** When false, the API is hidden from the public catalogue (admins can
   *  still see it under /admin/apis to toggle it back). Defaults to true. */
  published: boolean;
}

export interface Plan {
  id: number;
  name: string;
  description: string;
  tier: string;
  rpmLimit: number;
  dailyQuota: number;
  monthlyQuota: number;
  approvalRequired: boolean;
  active: boolean;
  apiProductId: number | null;
  /** Recurring price in minor units (cents). 0 = free plan. */
  priceCents: number;
  currency: string;
  /** priceCents > 0 — subscribing needs a successful payment first. */
  paid: boolean;
}

export interface Application {
  id: number;
  name: string;
  description: string;
  organization: string;
  environment: string;
  callbackUrl: string;
  technicalContact: string;
  createdAt: string;
}

export interface Subscription {
  id: number;
  apiProductId: number;
  apiProductName: string;
  applicationId: number;
  applicationName: string;
  applicationPlanId: number;
  planTier: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "REVOKED";
  environment: string;
  useCase: string;
  apiKeyPreview: string | null;
  createdAt: string;
  approvedAt: string | null;
  rejectionReason: string | null;
}

export interface ApiCredential {
  keyId: string;
  apiKey: string;
  keyPreview: string;
  headerName: string;
  hostname: string;
  curlExample: string;
}

export interface SubscriptionResult {
  subscription: Subscription;
  credential: ApiCredential | null;
}

export interface Profile {
  id: number;
  username: string;
  email: string;
  displayName: string;
  organization: string;
  roles: string[];
  applications: Application[];
  subscriptions: Subscription[];
}

export interface UsagePoint {
  timestamp: string;
  requestCount: number;
  successCount: number;
  blockedCount: number;
}

export interface TopProduct {
  name: string;
  requestCount: number;
}

// ---- Billing (NMI payment gateway) ----------------------------------------

export type PaymentStatus = "PENDING" | "APPROVED" | "DECLINED" | "ERROR";

export interface BillingConfig {
  /** Billing feature is configured and surfaced in the UI. */
  enabled: boolean;
  /** "mock" = in-process fake gateway; "nmi" = real NMI sandbox calls. */
  mode: "mock" | "nmi";
  currency: string;
  /** Collect.js public tokenization key (empty in mock mode). */
  tokenizationKey: string;
}

export interface Payment {
  id: number;
  subscriptionId: number | null;
  applicationPlanId: number | null;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  kind: "SUBSCRIPTION" | "RECURRING";
  gatewayTransactionId: string | null;
  gatewayMessage: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  createdAt: string;
}

export interface PaymentMethod {
  id: number;
  cardLast4: string | null;
  cardBrand: string | null;
  expMonth: string | null;
  expYear: string | null;
  isDefault: boolean;
  createdAt: string;
}

/** POST /charge result — carries the one-time credential when the charge
 *  activated a paid subscription. */
export interface ChargeResult {
  payment: Payment;
  credential: ApiCredential | null;
}

export interface BillingState {
  config: BillingConfig;
  methods: PaymentMethod[];
  payments: Payment[];
}

export interface Usage {
  totalRequests: number;
  successCount: number;
  blockedCount: number;
  error4xxCount: number;
  error5xxCount: number;
  avgLatencyMs: number;
  limitRemaining: number;
  usagePercent: number;
  quotaResetAt: string;
  series: UsagePoint[];
  /** Per-API breakdown — only populated in the aggregate view, empty for drill-down. */
  topProducts: TopProduct[];
}
