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
    // Try to parse JSON error response
    try {
      const json = JSON.parse(text);
      if (json.error) {
        throw new Error(json.error);
      }
    } catch (e) {
      // Re-throw if it's our Error with the error code
      if (e instanceof Error && e.message && !e.message.includes("JSON")) {
        throw e;
      }
      // Not JSON or no error field, fall through
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
