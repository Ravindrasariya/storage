import { QueryClient, QueryFunction } from "@tanstack/react-query";

const AUTH_TOKEN_KEY = "cold_store_auth_token";

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { "x-auth-token": token } : {};
}

export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options?.headers,
    },
    credentials: "include",
  });
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // Surface JSON body on the thrown Error so callers can read
    // structured fields like `field` and `rowIndex`, not just message.
    try {
      const json = JSON.parse(text);
      if (json.error) {
        const err = new Error(json.error) as Error & { body?: unknown; status?: number };
        err.body = json;
        err.status = res.status;
        throw err;
      }
    } catch (e) {
      if (e instanceof Error && e.message && !e.message.includes("JSON")) {
        throw e;
      }
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };
  if (data) {
    headers["Content-Type"] = "application/json";
  }
  
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Build URL by joining query key parts with "/"
    // The first part is the base path (e.g., "/api/sales-history/self-sales")
    // Additional parts are path parameters that need to be URL-encoded
    // This handles special characters like "/" in names (e.g., "s/o" in farmer names)
    const url = queryKey.length === 1 
      ? String(queryKey[0])
      : `${queryKey[0]}/${queryKey.slice(1).map(part => encodeURIComponent(String(part))).join("/")}`;
    
    const res = await fetch(url, {
      credentials: "include",
      headers: getAuthHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/**
 * Invalidate every cache key derived from sales/cash/ledger state. Call this
 * from the onSuccess of any mutation that creates, edits, reverses, or
 * otherwise affects a sale, payment, discount, exit, or cash receipt — so
 * dependent pages like NIKASI, Cash Flow, Buyer/Farmer Ledger, dashboards,
 * and reports refresh without a manual browser reload.
 *
 * Centralised on purpose: React Query treats sibling keys like
 * "/api/sales-history" and "/api/exit-register" as independent, so each one
 * needs its own invalidate call. New keys should be added here ONCE rather
 * than scattered across mutation handlers.
 */
export function invalidateSaleSideEffects(client: QueryClient): void {
  const keys: string[] = [
    "/api/sales-history",
    "/api/sales-history/by-buyer",
    "/api/sales-history/buyer-transfers",
    "/api/sales-history/years",
    "/api/sales-history/exits-summary",
    "/api/exit-register",
    "/api/exit-register/years",
    "/api/exits",
    "/api/lots",
    "/api/lots/sales-summary",
    "/api/lots/summary",
    "/api/lots/search",
    "/api/up-for-sale",
    "/api/buyer-ledger",
    "/api/farmer-ledger",
    "/api/farmer-ledger/dues-for-dropdown",
    "/api/farmer-ledger/dues-for-discount",
    "/api/cash-flow",
    "/api/cash-receipts",
    "/api/cash-receipts/buyers-with-dues",
    "/api/cash-receipts/sales-goods-buyers",
    "/api/cash-transfers",
    "/api/expenses",
    "/api/discounts",
    "/api/buyer-dues",
    "/api/merchant-advances/buyers-with-dues",
    "/api/merchant-advances/py",
    "/api/farmer-loans/farmers-with-dues",
    "/api/farmer-loans/py",
    "/api/farmers-with-dues",
    "/api/farmers-with-all-dues",
    "/api/opening-receivables",
    "/api/analytics/payments",
    "/api/analytics/merchants",
    "/api/analytics/quality",
    "/api/analytics/chambers",
    "/api/bank-accounts",
  ];
  for (const key of keys) {
    client.invalidateQueries({ queryKey: [key] });
  }
  // Prefix-matched groups
  client.invalidateQueries({
    predicate: (query) => {
      const head = String(query.queryKey[0] ?? "");
      return (
        head.startsWith("/api/dashboard/stats") ||
        head.startsWith("/api/reports/") ||
        head.startsWith("/api/farmer-receivables-with-dues") ||
        head.startsWith("/api/farmer-dues") ||
        head.startsWith("/api/buyer-dues-for-farmer") ||
        head === "/api/merchant-advances/outstanding" ||
        head === "/api/farmer-loans/outstanding"
      );
    },
  });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
