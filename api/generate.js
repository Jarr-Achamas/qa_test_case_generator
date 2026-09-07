/* =========================================================
   Vercel Edge Function — Google Gemini proxy
   ---------------------------------------------------------
   Receives { model, prompt } from the browser, calls the
   Google Gemini streamGenerateContent endpoint with the
   server-side key, and streams the response back to the
   client as SSE (Server-Sent Events).

   Env vars required (set in Vercel Project Settings):
     - GEMINI_API_KEY   : your Google Gemini API key
     - ALLOWED_ORIGINS  : (optional) comma-separated allow-list
                          e.g. "https://qa.example.com"
                          If unset, requests from any origin
                          are accepted.
   ========================================================= */

export const config = { runtime: "edge" };

const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_OUTPUT_TOKENS = 16000;

function cors(origin) {
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin =
    allowed.length === 0 || allowed.includes(origin) ? origin || "*" : "null";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

export default async function handler(request) {
  const origin = request.headers.get("origin") || "";
  const corsHeaders = cors(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(
      { error: "GEMINI_API_KEY is not configured on the server." },
      500,
      corsHeaders
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const { model, prompt } = body || {};
  if (!prompt || typeof prompt !== "string") {
    return json({ error: "Missing 'prompt' string" }, 400, corsHeaders);
  }

  const modelId = model || "gemini-2.5-flash";
  const url = `${GEMINI_BASE}/${encodeURIComponent(
    modelId
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.4,
      },
      // Relax safety filters so security-testing scenarios
      // (SQL injection, IDOR, etc.) don't get filtered out.
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_ONLY_HIGH",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_ONLY_HIGH",
        },
      ],
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return json(
      { error: `Gemini error ${upstream.status}: ${errText.slice(0, 500)}` },
      upstream.status,
      corsHeaders
    );
  }

  // Pass the SSE stream straight through.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...corsHeaders,
    },
  });
}
