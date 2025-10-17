const DEFAULT_MODEL = "microsoft/DialoGPT-large";
const VALID_MODELS = new Set([
  "microsoft/DialoGPT-large",
  "microsoft/DialoGPT-medium",
  "facebook/blenderbot-400M-distill"
]);
const MODEL_ALIASES = {
  "gemini-pro": "gemini-1.5-flash-latest",
  "gemini-1.0-pro": "gemini-1.5-flash-latest",
  "gemini-1.5-flash": "gemini-1.5-flash-latest",
  "gemini-1.5-flash-latest": "gemini-1.5-flash-latest",
  "gemini-1.5-pro": "gemini-1.5-pro-latest",
  "gemini-1.5-pro-latest": "gemini-1.5-pro-latest",
  "gemini-1.5-flash-8b": "gemini-1.5-flash-latest",
  "gemini-1.5-flash-8b-latest": "gemini-1.5-flash-latest",
  "gemini-2.0-flash": "gemini-1.5-flash-latest",
  "gemini-2.0-flash-latest": "gemini-1.5-flash-latest",
  "gemini-2.0-flash-exp": "gemini-1.5-flash-latest"
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

  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing HUGGINGFACE_API_KEY environment variable" });
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
    const endpoint = `https://api-inference.huggingface.co/models/${model}`;

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
          inputs: messages[messages.length - 1]?.content || "",
          parameters: {
            max_length: 1000,
            temperature: 0.7,
            do_sample: true
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText || "Upstream error" });
    }

    const data = await response.json();
    let text = "";
    
    if (Array.isArray(data) && data[0]?.generated_text) {
      text = data[0].generated_text;
    } else if (data?.generated_text) {
      text = data.generated_text;
    } else if (typeof data === "string") {
      text = data;
    }

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
