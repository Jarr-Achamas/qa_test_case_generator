/* =========================================================
   QA Test Case Generator — App Logic
   ---------------------------------------------------------
   Calls /api/generate (Vercel Edge Function) which holds the
   Anthropic API key server-side. The browser never sees the
   key.

   Also supports a "Show Prompt Only" flow so users can copy
   the prompt into a different LLM if they want.

   Dependencies (loaded in index.html):
     - marked (CDN)        — markdown -> HTML
     - prompt-template.js  — buildPrompt(data)
   ========================================================= */

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);

// ---------- Config ----------
const GENERATE_ENDPOINT = "/api/generate";

// ---------- State ----------
let currentController = null;
let accumulatedText = "";

// ---------- Form helpers ----------
function getFormData() {
  return {
    feature: $("feature").value,
    platform: $("platform").value,
    roles: $("roles").value,
    specLink: $("specLink").value,
    userFlowLink: $("userFlowLink").value,
    figmaLink: $("figmaLink").value,
    apiSpecLink: $("apiSpecLink").value,
    designDocLink: $("designDocLink").value,
    extraContext: $("extraContext").value,
    adjacent: $("adjacent").value,
    mustInclude: $("mustInclude").value,
  };
}

function showToast(msg, isError) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", !!isError);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

function setStatus(msg, kind) {
  const s = $("status");
  s.textContent = msg;
  s.className = "status show " + (kind || "info");
}
function clearStatus() {
  $("status").className = "status";
}

// ---------- SSE stream parser (Google Gemini format) ----------
async function streamFromEndpoint(prompt, model, onDelta, signal) {
  const response = await fetch(GENERATE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, model }),
    signal,
  });

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error) msg += `: ${errJson.error}`;
    } catch {
      try {
        msg += `: ${await response.text()}`;
      } catch {}
    }
    throw new Error(msg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function processEventBlock(eventBlock) {
    // Each event line starts with "data: " followed by JSON.
    const dataLines = eventBlock
      .split("\n")
      .filter((l) => l.startsWith("data: "));

    for (const line of dataLines) {
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const obj = JSON.parse(jsonStr);
        // Gemini payload:
        //   { candidates: [ { content: { parts: [ { text: "..." } ] }, finishReason?: "..." } ] }
        const parts = obj?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (typeof p.text === "string" && p.text.length) {
              onDelta(p.text);
            }
          }
        }
        const finishReason = obj?.candidates?.[0]?.finishReason;
        if (
          finishReason &&
          finishReason !== "STOP" &&
          finishReason !== "MAX_TOKENS"
        ) {
          throw new Error(`Gemini finish reason: ${finishReason}`);
        }
        if (obj?.promptFeedback?.blockReason) {
          throw new Error(
            `Prompt blocked by Gemini: ${obj.promptFeedback.blockReason}`
          );
        }
      } catch (e) {
        // ignore parse errors for keepalive/non-JSON lines
        if (e instanceof Error && e.message.startsWith("Gemini")) throw e;
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // Normalize CRLF to LF — some proxies preserve the upstream's \r\n line
    // endings, which would otherwise never match the "\n\n" event separator.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    // Gemini SSE events are separated by blank lines.
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const eventBlock = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      processEventBlock(eventBlock);
    }
  }

  // The stream can end without a trailing blank line after the final event.
  if (buffer.trim()) processEventBlock(buffer);
}

// ---------- Render markdown output ----------
function stripOuterCodeFence(text) {
  // Some LLMs wrap the whole answer in a single ```markdown ... ``` fence
  // even when not asked to. That turns the table into a <pre><code> block
  // instead of a real <table>, so unwrap it before parsing.
  const match = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}

// Some LLMs put multi-item cell content (numbered steps, multiple
// prerequisites, etc.) on separate physical lines inside a table cell.
// GFM requires each row to be a single line, so that breaks marked's table
// parser entirely. Reconstruct one-line rows by tracking pipe counts against
// the header's column count and joining wrapped continuation lines with
// "<br>" instead of a raw newline.
function repairMultilineTableRows(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const headerPipes = (line.match(/\|/g) || []).length;
    const next = lines[i + 1] || "";
    const isDelimiter = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(
      next.trim()
    );
    if (headerPipes < 2 || !isDelimiter) {
      out.push(line);
      i++;
      continue;
    }

    out.push(line, next);
    i += 2;

    let rowBuffer = "";
    let rowPipes = 0;
    while (i < lines.length && lines[i].trim() !== "") {
      const bodyLine = lines[i];
      rowBuffer = rowBuffer ? rowBuffer + "<br>" + bodyLine.trim() : bodyLine;
      rowPipes += (bodyLine.match(/\|/g) || []).length;
      i++;
      if (rowPipes >= headerPipes) {
        out.push(rowBuffer);
        rowBuffer = "";
        rowPipes = 0;
      }
    }
    if (rowBuffer.trim()) out.push(rowBuffer);
  }
  return out.join("\n");
}

function renderOutput(text) {
  const html = marked.parse(repairMultilineTableRows(stripOuterCodeFence(text)), {
    gfm: true,
    breaks: false,
  });
  $("renderedOutput").innerHTML = html;
  $("rawOutput").textContent = text;

  let totalRows = 0;
  $("renderedOutput")
    .querySelectorAll("table")
    .forEach((tbl) => {
      totalRows += tbl.querySelectorAll("tbody tr").length;
    });
  $("caseCount").textContent =
    `${totalRows} test case row(s) · ${text.length.toLocaleString()} chars`;
}

// ---------- Generate ----------
$("generateBtn").addEventListener("click", async () => {
  const data = getFormData();
  if (!data.feature.trim()) {
    setStatus("Feature name is required.", "error");
    $("feature").focus();
    return;
  }

  const prompt = buildPrompt(data);
  const model = $("model").value;

  $("outputPanel").style.display = "block";
  $("manualMode").classList.add("hidden");
  $("resultArea").classList.remove("hidden");
  $("renderedOutput").innerHTML = "";
  $("rawOutput").textContent = "";
  $("caseCount").textContent = "Streaming…";

  $("generateBtn").disabled = true;
  $("generateBtn").innerHTML = '<span class="spinner"></span> Generating...';
  $("stopBtn").disabled = false;

  setStatus(
    "Calling Gemini. First rows appear within seconds; long lists can take 30–90 seconds.",
    "info"
  );

  accumulatedText = "";
  const stats = $("streamStats");
  stats.classList.remove("hidden");
  const startTime = Date.now();

  currentController = new AbortController();

  try {
    await streamFromEndpoint(
      prompt,
      model,
      (delta) => {
        accumulatedText += delta;
        renderOutput(accumulatedText);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        stats.textContent = `${accumulatedText.length.toLocaleString()} chars · ${elapsed}s`;
      },
      currentController.signal
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    setStatus(
      `Done in ${elapsed}s. Review the table below and download as CSV.`,
      "success"
    );
    renderOutput(accumulatedText);
  } catch (err) {
    if (err.name === "AbortError") {
      setStatus("Stopped by user. Partial output preserved below.", "info");
    } else {
      console.error(err);
      setStatus("Error: " + err.message, "error");
    }
  } finally {
    $("generateBtn").disabled = false;
    $("generateBtn").textContent = "Generate Test Cases";
    $("stopBtn").disabled = true;
    currentController = null;
  }
});

$("stopBtn").addEventListener("click", () => {
  if (currentController) currentController.abort();
});

// ---------- Show Prompt Only (manual mode) ----------
$("showPromptBtn").addEventListener("click", () => {
  const data = getFormData();
  if (!data.feature.trim()) {
    setStatus("Feature name is required.", "error");
    $("feature").focus();
    return;
  }
  const prompt = buildPrompt(data);
  $("outputPanel").style.display = "block";
  $("manualMode").classList.remove("hidden");
  $("resultArea").classList.add("hidden");
  $("promptDisplay").textContent = prompt;
  $("promptStats").textContent = `${prompt.length.toLocaleString()} chars · ${prompt
    .split(/\s+/)
    .length.toLocaleString()} words`;
  setStatus(
    "Copy the prompt below into your LLM of choice, then paste the response back and click Render Response.",
    "info"
  );
  $("outputPanel").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("copyPromptBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("promptDisplay").textContent);
    showToast("Prompt copied");
  } catch {
    showToast("Copy failed — select & copy manually", true);
  }
});

$("downloadPromptBtn").addEventListener("click", () => {
  const blob = new Blob([$("promptDisplay").textContent], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const feat = ($("feature").value || "feature")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();
  a.href = url;
  a.download = `qa_prompt_${feat}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

$("renderResponseBtn").addEventListener("click", () => {
  const raw = $("llmResponse").value.trim();
  if (!raw) {
    setStatus("Paste a response first.", "error");
    $("llmResponse").focus();
    return;
  }
  accumulatedText = raw;
  $("resultArea").classList.remove("hidden");
  renderOutput(raw);
  setStatus("Rendered. Download CSV when ready.", "success");
  $("resultArea").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("clearResponseBtn").addEventListener("click", () => {
  $("llmResponse").value = "";
  $("renderedOutput").innerHTML = "";
  $("rawOutput").textContent = "";
  $("caseCount").textContent = "";
  $("resultArea").classList.add("hidden");
  accumulatedText = "";
});

// ---------- Reset ----------
$("resetBtn").addEventListener("click", () => {
  if (!confirm("Reset all form fields?")) return;
  [
    "feature",
    "roles",
    "specLink",
    "userFlowLink",
    "figmaLink",
    "apiSpecLink",
    "designDocLink",
    "extraContext",
    "adjacent",
    "mustInclude",
    "llmResponse",
  ].forEach((id) => {
    $(id).value = "";
  });
  $("platform").value = "mobile";
  $("model").value = "gemini-2.5-flash";
  $("outputPanel").style.display = "none";
  $("manualMode").classList.add("hidden");
  $("resultArea").classList.add("hidden");
  $("streamStats").classList.add("hidden");
  clearStatus();
});

// ---------- Result controls ----------
$("copyMdBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(accumulatedText);
    showToast("Markdown copied");
  } catch {
    showToast("Copy failed", true);
  }
});

$("toggleRawBtn").addEventListener("click", () => {
  const raw = $("rawOutput");
  const rendered = $("renderedOutput");
  if (raw.classList.contains("hidden")) {
    raw.classList.remove("hidden");
    rendered.style.display = "none";
    $("toggleRawBtn").textContent = "Show Rendered";
  } else {
    raw.classList.add("hidden");
    rendered.style.display = "block";
    $("toggleRawBtn").textContent = "Show Raw Markdown";
  }
});

// ---------- CSV export ----------
function escCsv(v) {
  if (v == null) return "";
  v = String(v).replace(/\r?\n/g, " ").trim();
  if (/[",]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

$("downloadCsvBtn").addEventListener("click", () => {
  const table = $("renderedOutput").querySelector("table");
  if (!table) {
    showToast("No table to export yet", true);
    return;
  }
  const rows = [];
  const headers = Array.from(table.querySelectorAll("thead th")).map(
    (th) => th.innerText
  );
  rows.push(headers.map(escCsv).join(","));

  table.querySelectorAll("tbody tr").forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll("td")).map((td) =>
      escCsv(td.innerText)
    );
    rows.push(cells.join(","));
  });

  const blob = new Blob([rows.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const feat = ($("feature").value || "test_cases")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();
  a.href = url;
  a.download = `${feat}_test_cases.csv`;
  a.click();
  URL.revokeObjectURL(url);
});
