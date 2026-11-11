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
  /** Where the numbers came from, so the UI never shows a misleading zero:
   *  - "mock"         synthetic data (mock mode)
   *  - "per-consumer" real, attributed via the TelemetryPolicy consumer label
   *  - "unattributed" per-consumer projection missing → per-API totals (all consumers)
   *  - "none"         metrics backend unavailable or genuinely no traffic */
  metricsSource?: "mock" | "per-consumer" | "unattributed" | "none";
}
