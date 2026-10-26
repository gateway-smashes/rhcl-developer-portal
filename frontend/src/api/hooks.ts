import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type {
  ApiCredential,
  ApiProduct,
  Application,
  BillingConfig,
  BillingState,
  ChargeResult,
  Plan,
  PaymentMethod,
  Profile,
  Subscription,
  SubscriptionResult,
  Usage,
} from "./types";

// ---- Catalog (public) ------------------------------------------------------
export const useApis = () =>
  useQuery({ queryKey: ["apis"], queryFn: () => api.get<ApiProduct[]>("/api/catalog/apis") });

export const useApi = (id: number) =>
  useQuery({ queryKey: ["api", id], queryFn: () => api.get<ApiProduct>(`/api/catalog/apis/${id}`) });

export const useApiPlans = (id: number) =>
  useQuery({ queryKey: ["api", id, "plans"], queryFn: () => api.get<Plan[]>(`/api/catalog/apis/${id}/plans`) });

export const usePlans = () =>
  useQuery({ queryKey: ["plans"], queryFn: () => api.get<Plan[]>("/api/plans") });

// ---- Me (consumer) ---------------------------------------------------------
export const useProfile = () =>
  useQuery({ queryKey: ["me"], queryFn: () => api.get<Profile>("/api/me") });

export const useApplications = () =>
  useQuery({ queryKey: ["applications"], queryFn: () => api.get<Application[]>("/api/me/applications") });

export const useSubscriptions = () =>
  useQuery({ queryKey: ["subscriptions"], queryFn: () => api.get<Subscription[]>("/api/me/subscriptions") });

/**
 * Pass `undefined` for `subscriptionId` to get the aggregate view across
 * every APPROVED subscription. The backend's `/api/me/usage` skips the
 * filter and sums everything; the dashboard treats that as the default.
 */
export const useUsage = (subscriptionId?: number, days = 7) =>
  useQuery({
    queryKey: ["usage", subscriptionId ?? "all", days],
    queryFn: () =>
      api.get<Usage>(
        subscriptionId != null
          ? `/api/me/usage?subscriptionId=${subscriptionId}&days=${days}`
          : `/api/me/usage?days=${days}`,
      ),
  });

export function useCreateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Application>) => api.post<Application>("/api/me/applications", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      apiProductId: number;
      applicationId: number;
      applicationPlanId: number;
      environment?: string;
      useCase?: string;
    }) => api.post<SubscriptionResult>("/api/me/subscriptions", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useRotateKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subscriptionId: number) =>
      api.post<ApiCredential>(`/api/me/subscriptions/${subscriptionId}/rotate-key`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subscriptions"] }),
  });
}

// ---- Billing (NMI) ---------------------------------------------------------
export const useBillingConfig = () =>
  useQuery({
    queryKey: ["billing", "config"],
    queryFn: () => api.get<BillingConfig>("/api/me/billing/config"),
    staleTime: 5 * 60_000,
  });

export const useBilling = () =>
  useQuery({ queryKey: ["billing"], queryFn: () => api.get<BillingState>("/api/me/billing") });

/** Charge a subscription's plan price with a Collect.js payment token.
 *  On approval the backend activates the subscription and returns the key. */
export function useChargeSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { subscriptionId: number; paymentToken: string; saveCard?: boolean }) =>
      api.post<ChargeResult>("/api/me/billing/charge", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

/** Save a card to the NMI Customer Vault for later recurring charges. */
export function useSaveCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { paymentToken: string }) =>
      api.post<PaymentMethod>("/api/me/billing/methods", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }),
  });
}

export function useRemoveCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/me/billing/methods/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }),
  });
}

/** Run a recurring charge of the subscription's plan against the saved card. */
export function useChargeRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subscriptionId: number) =>
      api.post<ChargeResult>(`/api/me/billing/subscriptions/${subscriptionId}/renew`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });
}

// ---- Admin -----------------------------------------------------------------
export const useAdminSubscriptions = (status?: string) =>
  useQuery({
    queryKey: ["admin", "subscriptions", status],
    queryFn: () =>
      api.get<Subscription[]>(`/api/admin/subscriptions${status ? `?status=${status}` : ""}`),
  });

export function useApproveSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<SubscriptionResult>(`/api/admin/subscriptions/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] }),
  });
}

export function useRejectSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.post<Subscription>(`/api/admin/subscriptions/${id}/reject`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] }),
  });
}

export function useSuspendSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<Subscription>(`/api/admin/subscriptions/${id}/suspend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] }),
  });
}

export function useCreateApi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ApiProduct>) => api.post<ApiProduct>("/api/admin/apis", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apis"] }),
  });
}

export function useUpdateApi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ApiProduct> }) =>
      api.put<ApiProduct>(`/api/admin/apis/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apis"] }),
  });
}

// ---- System settings -------------------------------------------------------

export interface SettingView {
  key: string;
  value: string;
  envDefault: string;
  overridden: boolean;
  requiresRestart: boolean;
  description: string;
}

/** Map<key, SettingView>; admin only. */
export const useAdminSettings = () =>
  useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api.get<Record<string, SettingView>>("/api/admin/settings"),
  });

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api.put<SettingView>(`/api/admin/settings/${key}`, { value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "settings"] }),
  });
}

export function useResetSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.del<SettingView>(`/api/admin/settings/${key}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "settings"] }),
  });
}

export function useTestPrometheus() {
  return useMutation({
    mutationFn: (url: string) =>
      api.post<{ ok: boolean; status?: number; snippet?: string; error?: string }>(
        "/api/admin/settings/test-prometheus",
        { url },
      ),
  });
}

/** Public — tenant name/description, read on portal boot before login. */
export const useSystemTenant = () =>
  useQuery({
    queryKey: ["system", "tenant"],
    queryFn: () => api.get<{ name: string; description: string }>("/api/system/tenant"),
    staleTime: 5 * 60_000,
  });

/** Public — current OIDC config (issuer + clientId) for the admin display. */
export const useSystemOidcInfo = () =>
  useQuery({
    queryKey: ["system", "oidc"],
    queryFn: () => api.get<{ authority: string; clientId: string }>("/api/system/oidc-info"),
    staleTime: 5 * 60_000,
  });
