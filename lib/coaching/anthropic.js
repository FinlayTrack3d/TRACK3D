const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

// What users see when the provider fails. The provider's own text (which can
// mention billing, limits or prompt sizes) stays in `error`, for the logs.
export const publicProviderError = (status) => (status === 429 || status === 529
  ? "The coach is busy right now. Please try again in a minute."
  : "The coach couldn't answer that just now. Please try again.");

// POST to the Anthropic Messages API, retrying once on temporary failures
// (rate limit, overload, server error). Failures carry the provider's text in
// `error` (logged) and a plain message for users in `publicError`.
export async function postAnthropicMessages(body, { apiKey = process.env.ANTHROPIC_API_KEY, fetchImpl = fetch, retryDelayMs = 800 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true, payload: await response.json() };
    let detail = "";
    try { detail = (await response.json())?.error?.message || ""; } catch { detail = ""; }
    last = { ok: false, status: response.status, error: `Coach provider failed (${response.status})${detail ? `: ${detail}` : ""}`, publicError: publicProviderError(response.status) };
    console.error("Anthropic request failed:", last.error);
    if (!RETRYABLE.has(response.status) || attempt === 1) break;
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
  return last;
}

// Reads Server-Sent Events from a streaming Messages API response, calling
// onText with each text delta. Resolves to { ok, text, stopReason } or an error.
export async function readAnthropicStream(response, onText = () => {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      let event;
      try { event = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        text += event.delta.text;
        onText(event.delta.text, text);
      } else if (event.type === "message_delta") {
        stopReason = event.delta?.stop_reason || stopReason;
      } else if (event.type === "error") {
        console.error("Anthropic stream error:", event.error?.message || "stream error");
        return { ok: false, status: 502, error: `Coach provider failed: ${event.error?.message || "stream error"}`, publicError: "The coach reply was cut off. Please try again.", text };
      }
    }
  }
  return { ok: true, text, stopReason };
}

// Opens a streaming Messages API request, retrying once on temporary
// failures. Resolves to { ok: true, response } once the provider has
// accepted the request, so callers can still return a normal error status.
export async function openAnthropicStream(body, { apiKey = process.env.ANTHROPIC_API_KEY, fetchImpl = fetch, retryDelayMs = 800 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (response.ok) return { ok: true, response };
    let detail = "";
    try { detail = (await response.json())?.error?.message || ""; } catch { detail = ""; }
    last = { ok: false, status: response.status, error: `Coach provider failed (${response.status})${detail ? `: ${detail}` : ""}`, publicError: publicProviderError(response.status) };
    console.error("Anthropic stream failed:", last.error);
    if (!RETRYABLE.has(response.status) || attempt === 1) break;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return last;
}

// The value of a top-level JSON string field read from a reply that is still
// arriving, e.g. the "message" of {"message":"Drop to 18 kg..."}. Returns
// null until the field has started.
export function partialJsonStringField(text = "", field = "message") {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(text);
  if (!match) return null;
  let out = "";
  for (let index = match.index + match[0].length; index < text.length; index++) {
    const char = text[index];
    if (char === "\"") return out;
    if (char !== "\\") { out += char; continue; }
    const next = text[index + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = text.slice(index + 2, index + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      index += 5;
    } else {
      out += { n: "\n", t: "\t", r: "", b: "", f: "" }[next] ?? next;
      index += 1;
    }
  }
  return out;
}
