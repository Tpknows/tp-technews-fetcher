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

    // ── Gemini proxy (POST /) ────────────────────────────────
    let body;
    try { body = await request.json(); }
    catch { return corsResponse(JSON.stringify({ error: "Invalid JSON body" }), 400); }

    const { prompt, systemPrompt } = body;
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;

    const geminiBody = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 }
    };

    const apiResponse = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    const data = await apiResponse.json();
    let text = "";
    try {
      text = data.candidates?.[0]?.content?.parts
        ?.filter(p => p.text)?.map(p => p.text)?.join("\n") || "";
    } catch (e) { text = ""; }

    if (!text) return corsResponse(JSON.stringify({ error: "Gemini returned no text", raw: data }), 500);
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
