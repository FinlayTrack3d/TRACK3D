import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request) {
  try {
    const { messages, system } = await request.json();

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      system: system || "You are TRACK3D's AI coach - sharp, direct, data-driven accountability partner. Keep responses to 2-4 sentences. Be real, not fluffy.",
      messages: messages,
    });

    return Response.json({ content: response.content });
  } catch (error) {
    console.error("API Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}