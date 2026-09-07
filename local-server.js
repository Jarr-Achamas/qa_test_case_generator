/* =========================================================
   Plain local dev server — no Vercel CLI, no Vercel account.
   Runs api/generate.js's handler directly and serves the
   static files. GEMINI_API_KEY is read only from .env.local
   on disk (via `node --env-file`), never sent anywhere but
   to the Gemini API itself.

   Usage:
     node --env-file=.env.local local-server.js
   ========================================================= */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import handler from "./api/generate.js";

const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function toWebRequest(req) {
  const chunks = [];
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    for await (const chunk of req) chunks.push(chunk);
  }
  return new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

async function sendWebResponse(response, res) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    res.end();
    return;
  }
  for await (const chunk of response.body) res.write(chunk);
  res.end();
}

const server = createServer(async (req, res) => {
  if (req.url.startsWith("/api/generate")) {
    const request = await toWebRequest(req);
    const response = await handler(request);
    await sendWebResponse(response, res);
    return;
  }
  await serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Local dev server running at http://localhost:${PORT}`);
});
