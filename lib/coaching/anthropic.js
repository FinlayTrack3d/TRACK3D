const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

// POST to the Anthropic Messages API, retrying once on temporary failures
// (rate limit, overload, server error). Keeps the provider's own error text
// so the app can show why a request failed instead of a generic message.
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
    last = { ok: false, status: response.status, error: `Coach provider failed (${response.status})${detail ? `: ${detail}` : ""}` };
    console.error("Anthropic request failed:", last.error);
    if (!RETRYABLE.has(response.status) || attempt === 1) break;
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
  return last;
}
