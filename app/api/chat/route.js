export async function POST(request) {
  try {
    const { messages, system } = await request.json();
    const key = process.env.ANTHROPIC_API_KEY;
    
    if (!key) {
      return Response.json({ error: "No API key found" }, { status: 500 });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        system: system || "You are TRACK3D's AI coach.",
        messages: messages,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("Anthropic error:", JSON.stringify(data));
      return Response.json({ error: data.error?.message || "Anthropic error" }, { status: 500 });
    }
    
    return Response.json({ content: data.content });
  } catch (error) {
    console.error("Route error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}