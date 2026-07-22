export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Image proxy (/proxy-image?url=...) ──────────────────
    if (url.pathname === "/proxy-image") {
      const imgUrl = url.searchParams.get("url");
      if (!imgUrl) return new Response("Missing url param", { status: 400 });
      try {
        const imgRes = await fetch(imgUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
            "Referer": new URL(imgUrl).origin,
          }
        });
        const contentType = imgRes.headers.get("content-type") || "image/jpeg";
        return new Response(imgRes.body, {
          status: imgRes.status,
          headers: {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=86400",
          }
        });
      } catch (e) {
        return new Response("Image fetch failed: " + e.message, { status: 502 });
      }
    }

    // ── CORS preflight ───────────────────────────────────────
    if (request.method === "OPTIONS") return corsResponse(null, 204);
    if (request.method !== "POST") return corsResponse(JSON.stringify({ error: "Method not allowed" }), 405);

    let body;
    try { body = await request.json(); }
    catch { return corsResponse(JSON.stringify({ error: "Invalid JSON body" }), 400); }

    const { prompt, systemPrompt } = body;

    // ── Step 1: Search with Tavily ───────────────────────────
    let searchContext = "";
    try {
      const tavilyRes = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query: "latest PC hardware GPU CPU motherboard news this week",
          search_depth: "advanced",
          max_results: 8,
          include_images: true,
          include_answer: false,
        })
      });
      const tavilyData = await tavilyRes.json();
      const results = tavilyData.results || [];
      searchContext = results.map(r =>
        `TITLE: ${r.title}\nURL: ${r.url}\nIMAGE: ${r.image || ""}\nSNIPPET: ${r.content?.slice(0, 400) || ""}`
      ).join("\n\n---\n\n");
    } catch (e) {
      searchContext = "(Search unavailable — use your training knowledge for recent PC hardware news)";
    }

    // ── Step 2: Generate captions with Groq ─────────────────
    const fullPrompt = `Here are today's PC hardware news search results:\n\n${searchContext}\n\n---\n\n${prompt}`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 4096,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: fullPrompt }
        ]
      })
    });

    const groqData = await groqRes.json();
    const text = groqData.choices?.[0]?.message?.content || "";

    if (!text) return corsResponse(JSON.stringify({ error: "Groq returned no text", raw: groqData }), 500);
    return corsResponse(JSON.stringify({ text }), 200);
  },
};

function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
