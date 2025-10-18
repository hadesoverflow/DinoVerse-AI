const DEFAULT_MODEL = "llama3-8b-8192";
const VALID_MODELS = new Set([
  "llama3-8b-8192",
  "llama3-70b-8192",
  "mixtral-8x7b-32768",
  "gemma-7b-it"
]);
const MODEL_ALIASES = {
  "gemini-pro": "llama3-8b-8192",
  "gemini-1.0-pro": "llama3-8b-8192",
  "gemini-1.5-flash": "llama3-8b-8192",
  "gemini-1.5-flash-latest": "llama3-8b-8192",
  "gemini-1.5-pro": "llama3-70b-8192",
  "gemini-1.5-pro-latest": "llama3-70b-8192",
  "gemini-1.5-flash-8b": "llama3-8b-8192",
  "gemini-1.5-flash-8b-latest": "llama3-8b-8192",
  "gemini-2.0-flash": "llama3-8b-8192",
  "gemini-2.0-flash-latest": "llama3-8b-8192",
  "gemini-2.0-flash-exp": "llama3-8b-8192"
};

function normalizeModel(name) {
  if (typeof name !== "string") {
    return { model: DEFAULT_MODEL, resolution: "default", original: null };
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return { model: DEFAULT_MODEL, resolution: "default", original: trimmed };
  }

  const directAlias = MODEL_ALIASES[trimmed];
  if (directAlias && VALID_MODELS.has(directAlias)) {
    const resolution = directAlias === trimmed ? "exact" : "alias";
    return { model: directAlias, resolution, original: trimmed };
  }

  if (VALID_MODELS.has(trimmed)) {
    return { model: trimmed, resolution: "exact", original: trimmed };
  }

  if (trimmed.endsWith("-latest")) {
    const base = trimmed.replace(/-latest$/, "");
    const baseAlias = MODEL_ALIASES[base];
    if (baseAlias && VALID_MODELS.has(baseAlias)) {
      return { model: baseAlias, resolution: "trimmed-latest-alias", original: trimmed };
    }
    if (VALID_MODELS.has(base)) {
      return { model: base, resolution: "trimmed-latest", original: trimmed };
    }
  }

  return { model: DEFAULT_MODEL, resolution: "fallback", original: trimmed };
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const rawBody =
    typeof req.body === "string"
      ? req.body
      : await new Promise((resolve, reject) => {
          let data = "";
          req.on("data", (chunk) => {
            data += chunk;
          });
          req.on("end", () => resolve(data));
          req.on("error", reject);
        });

  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new Error("Invalid JSON payload");
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing GROQ_API_KEY environment variable" });
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const { model, resolution: modelResolution, original: originalModel } = normalizeModel(
    body?.model
  );
  const messages = Array.isArray(body?.messages) ? body.messages : [];

  if (!messages.length) {
    return res.status(400).json({ error: "Payload must include messages array" });
  }

  const contents = messages.map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }]
  }));

  try {
    const endpoint = `https://api.groq.com/openai/v1/chat/completions`;

    if (modelResolution === "fallback") {
      console.warn(
        `Model fallback applied. Requested="${originalModel}" -> Using="${model}".`
      );
    }

    const response = await fetch(
      endpoint,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model,
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content
          })),
          max_tokens: 1000,
          temperature: 0.7
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText || "Upstream error" });
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || "";

    return res.status(200).json({
      text: text.trim(),
      model,
      requestedModel: body?.model ?? null,
      normalizedFrom: originalModel,
      modelResolution
    });
  } catch (error) {
    console.error("Gemini proxy error:", error);
    return res.status(500).json({ error: "Gemini proxy error" });
  }
};
