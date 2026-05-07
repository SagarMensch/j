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

type SseHandlers = {
  onEvent: (event: string, payload: unknown) => void;
};

export async function postJsonSse(
  endpoint: string,
  body: unknown,
  handlers: SseHandlers,
) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(buildNetworkErrorMessage(endpoint, error));
  }

  if (!res.ok || !res.body) {
    const payload = await parseJsonSafely(res);
    throw new Error(buildErrorMessage(res, payload));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");

    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);

      if (rawEvent) {
        let eventName = "message";
        const dataLines: string[] = [];

        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const dataText = dataLines.join("\n");
        if (dataText) {
          handlers.onEvent(eventName, JSON.parse(dataText));
        }
      }

      boundary = buffer.indexOf("\n\n");
    }
  }
}
