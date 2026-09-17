export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues?: unknown,
  ) {
    super(code);
    this.name = "ApiRequestError";
  }
}

type Payload = { error?: string; issues?: unknown };

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Payload;
    throw new ApiRequestError(response.status, payload.error ?? "REQUEST_FAILED", payload.issues);
  }

  return (await response.json()) as T;
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, { method: "POST", body: JSON.stringify(body) });
}

export function patchJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, { method: "PATCH", body: JSON.stringify(body) });
}

export function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
