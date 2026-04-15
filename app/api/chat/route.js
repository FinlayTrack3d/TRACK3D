export async function POST(request) {
  try {
    const { messages, system } = await request.json();

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        system: system || "You are TRACK3D's AI coach - sharp, direct, data-driven accountability partner. Keep responses to 2-4 sentences. Be real, not fluffy.",
        messages: messages,
      }),
    });

    const data = await response.json();
    return Response.json({ content: data.content });
  } catch (error) {
    console.error("API Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}