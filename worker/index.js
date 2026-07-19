export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204);
    }

    if (request.method !== "POST") {
      return corsResponse(JSON.stringify({ error: "Method not allowed" }), 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(JSON.stringify({ error: "Invalid JSON body" }), 400);
    }

    const { prompt, systemPrompt } = body;

    // Gemini 3.1 Flash-Lite — current GA model, free tier, supports Google
    // Search grounding. Using the explicit stable name instead of the
    // "-latest" alias avoids that alias silently pointing at a newer/preview
    // model with its own separate (and possibly stricter) quota.
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`;

    const geminiBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        { role: "user", parts: [{ text: prompt }] }
      ],
      tools: [{ google_search: {} }],  // free built-in Google Search grounding
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.7
      }
    };

    const apiResponse = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    const data = await apiResponse.json();

    // Extract text from Gemini's response format
    let text = "";
    try {
      text = data.candidates?.[0]?.content?.parts
        ?.filter(p => p.text)
        ?.map(p => p.text)
        ?.join("\n") || "";
    } catch (e) {
      text = "";
    }

    if (!text) {
      return corsResponse(JSON.stringify({ error: "Gemini returned no text", raw: data }), 500);
    }

    return corsResponse(JSON.stringify({ text }), 200);
  },
};

function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
