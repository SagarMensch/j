export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function parseJsonSafely(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function buildErrorMessage(res: Response, payload: unknown) {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return `API error: ${res.status}`;
}

export const apiClient = {
  async get(endpoint: string) {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await parseJsonSafely(res);
    if (!res.ok) {
      throw new Error(buildErrorMessage(res, payload));
    }
    return payload;
  },

  async post(endpoint: string, body: unknown) {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await parseJsonSafely(res);
    if (!res.ok) {
      throw new Error(buildErrorMessage(res, payload));
    }
    return payload;
  },
};
