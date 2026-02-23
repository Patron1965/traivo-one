const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";

export async function apiGet(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, ok: res.ok };
}

export async function apiPost(path: string, data?: any, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, ok: res.ok };
}

export async function apiPatch(path: string, data?: any, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, ok: res.ok };
}

export async function apiDelete(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, ok: res.ok };
}

export function randomId() {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
