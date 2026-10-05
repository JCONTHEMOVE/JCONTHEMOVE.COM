import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { customerPhoneIssue } from "@shared/customerPhonePolicy";
import { formatPhoneEntry } from "@shared/phone";

const NATIVE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

export function getApiBase(): string {
  if (typeof window === "undefined") return "";
  const isCapacitor = (window as any).Capacitor?.isNativePlatform?.() === true;
  if (isCapacitor) return NATIVE_API_BASE_URL;
  return "";
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem("jc_access_token");
  } catch {
    return null;
  }
}

export function storeTokens(accessToken: string, refreshToken?: string) {
  try {
    localStorage.setItem("jc_access_token", accessToken);
    if (refreshToken) localStorage.setItem("jc_refresh_token", refreshToken);
  } catch {}
}

export function clearTokens() {
  try {
    localStorage.removeItem("jc_access_token");
    localStorage.removeItem("jc_refresh_token");
  } catch {}
}

async function throwIfResNotOk(res: Response, redirectOn401 = true) {
  if (!res.ok) {
    if (res.status === 401) {
      clearTokens();
      if (redirectOn401) {
        window.location.href = "/";
      }
      throw new Error("Your session has expired. Please log in again to continue.");
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function buildHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  const token = getStoredToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const phoneIssue = customerPhoneIssue(method, url, data);
  if (phoneIssue) {
    const fields = document.querySelectorAll<HTMLInputElement>('input[data-customer-phone]');
    const field = Array.from(fields).find(input => input.value === formatPhoneEntry(String(phoneIssue.value ?? "")));
    if (field) {
      field.setCustomValidity(phoneIssue.message);
      field.reportValidity();
      field.focus();
    }
    throw new Error(phoneIssue.message);
  }
  const base = getApiBase();
  const fullUrl = url.startsWith("http") ? url : `${base}${url}`;

  const res = await fetch(fullUrl, {
    method,
    headers: buildHeaders(!!data),
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  // Don't auto-redirect on 401 for explicit API calls (mutations, POST/PUT/DELETE).
  // The calling code's onError handler will show an appropriate message instead.
  await throwIfResNotOk(res, false);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const base = getApiBase();
    const path = queryKey.join("/") as string;
    const fullUrl = path.startsWith("http") ? path : `${base}${path}`;

    const headers: Record<string, string> = {};
    const token = getStoredToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(fullUrl, {
      credentials: "include",
      headers,
    });

    if (res.status === 401) {
      clearTokens();
      if (unauthorizedBehavior === "returnNull") {
        return null;
      }
      window.location.href = "/";
      throw new Error("Session expired. Redirecting to login...");
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
