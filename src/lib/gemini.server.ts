type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status?: number };

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Fast, high-context model suitable for long resume HTML rewrites. */
const GEMINI_MODEL = "gemini-2.5-flash";

function statusError(status: number): string {
  if (status === 400) {
    return "The request was rejected. Check the API key and try again.";
  }
  if (status === 401 || status === 403) {
    return "The API key was rejected. Check it and try again.";
  }
  if (status === 429) {
    return "The API rate limit was hit. Wait a moment and run again.";
  }
  if (status >= 500) {
    return "The model service is unavailable. Try again shortly.";
  }
  return `The API returned an error (${status}).`;
}

async function parseGenerateBody(res: Response): Promise<string> {
  const body = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      finishReason?: string;
    }[];
    error?: { message?: string; status?: string };
  };

  if (body.error?.message) {
    throw new Error(body.error.message);
  }

  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();

  if (!text) {
    const reason = body.candidates?.[0]?.finishReason;
    throw new Error(
      reason
        ? `The model returned an empty response (${reason}).`
        : "The model returned an empty response.",
    );
  }
  return text;
}

export async function geminiChat(opts: {
  apiKey: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  json?: boolean;
}): Promise<ChatResult> {
  const systemParts = opts.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .filter(Boolean);
  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxTokens,
      temperature: opts.temperature,
      ...(opts.json
        ? { responseMimeType: "application/json" as const }
        : {}),
    },
  };

  if (systemParts.length > 0) {
    payload.systemInstruction = {
      parts: systemParts.map((text) => ({ text })),
    };
  }

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`;
  const headers = {
    "Content-Type": "application/json",
    "x-goog-api-key": opts.apiKey,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "Could not reach the model service." };
  }

  if (!res.ok && res.status >= 500) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch {
      return { ok: false, error: "Could not reach the model service." };
    }
  }

  if (!res.ok) {
    return { ok: false, error: statusError(res.status), status: res.status };
  }

  try {
    const text = await parseGenerateBody(res);
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "The model response could not be read.",
    };
  }
}

export async function verifyGeminiKey(apiKey: string): Promise<ChatResult> {
  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-goog-api-key": apiKey },
    });
  } catch {
    return { ok: false, error: "Could not reach the model service." };
  }
  if (!res.ok) {
    return { ok: false, error: statusError(res.status), status: res.status };
  }
  return { ok: true, text: "ok" };
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(fenced);
}
