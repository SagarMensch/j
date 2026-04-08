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

function buildNetworkErrorMessage(endpoint: string, error: unknown) {
  const suffix =
    error instanceof Error && error.message ? ` (${error.message})` : "";
  return `Backend unavailable at ${API_BASE_URL}${endpoint}${suffix}`;
}

export const apiClient = {
  async get(endpoint: string) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
          Accept: "application/json",
        },
      });
    } catch (error) {
      throw new Error(buildNetworkErrorMessage(endpoint, error));
    }
    const payload = await parseJsonSafely(res);
    if (!res.ok) {
      throw new Error(buildErrorMessage(res, payload));
    }
    return payload;
  },

  async post(endpoint: string, body: unknown) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(buildNetworkErrorMessage(endpoint, error));
    }
    const payload = await parseJsonSafely(res);
    if (!res.ok) {
      throw new Error(buildErrorMessage(res, payload));
    }
    return payload;
  },
};
