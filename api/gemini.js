const DEFAULT_MODEL = "gemini-1.5-flash-latest";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing GEMINI_API_KEY environment variable" });
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const model = body?.model || DEFAULT_MODEL;
  const messages = Array.isArray(body?.messages) ? body.messages : [];

  if (!messages.length) {
    return res.status(400).json({ error: "Payload must include messages array" });
  }

  const contents = messages.map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }]
  }));

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents,
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUAL", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS", threshold: "BLOCK_NONE" }
          ]
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText || "Upstream error" });
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map((part) => part.text ?? "").join("\n").trim();

    return res.status(200).json({ text });
  } catch (error) {
    console.error("Gemini proxy error:", error);
    return res.status(500).json({ error: "Gemini proxy error" });
  }
}
