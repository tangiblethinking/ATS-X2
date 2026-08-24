type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status?: number };

const XAI_CHAT = "https://api.x.ai/v1/chat/completions";
const XAI_MODELS = "https://api.x.ai/v1/models";

function statusError(status: number): string {
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

async function parseChatBody(res: Response): Promise<string> {
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  const text = body.choices?.[0]?.message?.content ?? "";
  if (!text) {
    throw new Error(body.error?.message || "The model returned an empty response.");
  }
  return text;
}

export async function xaiChat(opts: {
  apiKey: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  json?: boolean;
}): Promise<ChatResult> {
  const payload = {
    model: "grok-4.5",
    messages: opts.messages,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${opts.apiKey}`,
  };

  let res: Response;
  try {
    res = await fetch(XAI_CHAT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "Could not reach the model service." };
  }

  if (!res.ok && res.status >= 500) {
    try {
      res = await fetch(XAI_CHAT, {
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
    const text = await parseChatBody(res);
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The model response could not be read.",
    };
  }
}

export async function verifyXaiKey(apiKey: string): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(XAI_MODELS, {
      headers: { Authorization: `Bearer ${apiKey}` },
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
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(fenced);
}
