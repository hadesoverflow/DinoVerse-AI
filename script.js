const chatLog = document.getElementById("chat-log");
const promptInput = document.getElementById("prompt-input");
const composer = document.getElementById("composer");
const promptSuggestions = document.getElementById("prompt-suggestions");
const newChatBtn = document.getElementById("new-chat-btn");
const historyList = document.getElementById("conversation-history");
const toggleThemeBtn = document.getElementById("toggle-theme-btn");
const modelPill = document.querySelector(".model-pill");

const DEFAULT_GEMINI_MODEL = "llama-3.1-8b-instant";
const searchParams = new URLSearchParams(window.location.search);
const requestedModelParamRaw = searchParams.get("model");
const requestedModelParam =
  requestedModelParamRaw && requestedModelParamRaw.trim() ? requestedModelParamRaw.trim() : "";
const GEMINI_MODEL = requestedModelParam || DEFAULT_GEMINI_MODEL;
let currentModel = GEMINI_MODEL;

const API_BASE =
  window.location.protocol === "file:" || window.location.hostname === "localhost"
    ? "https://dino-verse-ai.vercel.app"
    : "";

updateModelPill(currentModel, {
  requested: requestedModelParam || null,
  resolution: requestedModelParam ? "requested" : "default"
});

const conversations = [];
let activeConversation = createConversation();

function createConversation() {
  return {
    id: `conv-${Date.now()}`,
    title: "Cuộc trò chuyện mới",
    messages: [
      {
        role: "assistant",
        content: "Xin chào! Tôi là DinoVerse AI. Bạn muốn khám phá điều gì hôm nay?"
      }
    ],
    createdAt: new Date()
  };
}

function renderMessages() {
  chatLog.innerHTML = "";
  activeConversation.messages.forEach((message) => {
    const messageEl = document.createElement("div");
    messageEl.classList.add("message", `message--${message.role === "user" ? "user" : "assistant"}`);

    const avatar = document.createElement("div");
    avatar.classList.add("avatar");
    if (message.role === "user") {
      avatar.classList.add("avatar--user");
      const img = document.createElement("img");
      img.src = "images/User.png";
      img.alt = "User avatar";
      avatar.appendChild(img);
    } else {
      avatar.classList.add("avatar--assistant");
      const img = document.createElement("img");
      img.src = "images/DinoVerse%20Bot.png";
      img.alt = "Dino bot avatar";
      avatar.appendChild(img);
    }

    const bubble = document.createElement("div");
    bubble.classList.add("bubble");
    bubble.innerHTML = sanitize(message.content);

    messageEl.appendChild(avatar);
    messageEl.appendChild(bubble);
    chatLog.appendChild(messageEl);
  });

  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderHistory() {
  historyList.innerHTML = "";
  const ordered = [...conversations].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  ordered.forEach((conversation) => {
    const item = document.createElement("button");
    item.classList.add("history__item");
    if (conversation.id === activeConversation.id) {
      item.classList.add("history__item--active");
    }

    item.textContent = conversation.title;
    item.addEventListener("click", () => {
      setActiveConversation(conversation.id);
    });

    historyList.appendChild(item);
  });
}

function setActiveConversation(id) {
  const target = conversations.find((conv) => conv.id === id);
  if (!target) return;

  activeConversation = target;
  renderMessages();
  renderHistory();
  promptInput.focus();
}

function addMessage(role, content) {
  activeConversation.messages.push({ role, content });
  renderMessages();
}

function sanitize(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, "<br>");
}

function autoResizeTextarea() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${promptInput.scrollHeight}px`;
}

function updateModelPill(model, meta = {}) {
  if (!modelPill) return;

  const requested = typeof meta.requested === "string" ? meta.requested.trim() : "";
  const resolution = meta.resolution || "exact";
  const normalizedRequested = requested && requested !== model ? requested : "";

  if (resolution === "fallback" && normalizedRequested) {
    modelPill.textContent = `Mô hình: ${model} (không hỗ trợ "${normalizedRequested}")`;
    return;
  }

  if (
    normalizedRequested &&
    ["alias", "trimmed-latest", "trimmed-latest-alias", "requested"].includes(resolution)
  ) {
    modelPill.textContent = `Mô hình: ${model} (chuẩn hóa từ "${normalizedRequested}")`;
    return;
  }

  modelPill.textContent = `Mô hình: ${model}`;
}

async function requestAssistantResponse(prompt) {
  const pendingMessage = { role: "assistant", content: "Đang xử lý..." };
  activeConversation.messages.push(pendingMessage);
  renderMessages();

  try {
    const { text } = await callGeminiAPI(activeConversation.messages.slice(0, -1));
    pendingMessage.content = text;
  } catch (error) {
    pendingMessage.content = `Xin lỗi, có lỗi xảy ra khi kết nối tới DinoVerse AI. Vui lòng thử lại.\n\nChi tiết: ${error.message}`;
    console.error("DinoVerse AI error:", error);
  } finally {
    renderMessages();
  }
}

async function callGeminiAPI(messages) {
  const payload = {
    model: currentModel,
    messages: messages.filter((msg) => msg.role === "user" || msg.role === "assistant")
  };

  const response = await fetch(`${API_BASE}/api/gemini`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DinoVerse AI ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const text = (data?.text || "").trim();
  if (!text) {
    throw new Error("DinoVerse AI returned empty response.");
  }
  const resolvedModel =
    typeof data?.model === "string" && data.model.trim() ? data.model.trim() : currentModel;
  const requestedModel =
    typeof data?.requestedModel === "string" && data.requestedModel.trim()
      ? data.requestedModel.trim()
      : currentModel;
  const normalizedFrom =
    typeof data?.normalizedFrom === "string" && data.normalizedFrom.trim()
      ? data.normalizedFrom.trim()
      : "";
  const resolution =
    typeof data?.modelResolution === "string" && data.modelResolution.trim()
      ? data.modelResolution.trim()
      : resolvedModel === requestedModel
        ? "exact"
        : "alias";

  currentModel = resolvedModel;
  const requestedForDisplay = normalizedFrom || requestedModel || resolvedModel;
  updateModelPill(resolvedModel, { requested: requestedForDisplay, resolution });

  return {
    text,
    model: resolvedModel,
    requestedModel,
    normalizedFrom,
    resolution
  };
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  addMessage("user", prompt);
  activeConversation.title = activeConversation.messages.find((msg) => msg.role === "user")?.content.slice(0, 45) || activeConversation.title;
  renderHistory();

  promptInput.value = "";
  autoResizeTextarea();
  requestAssistantResponse(prompt).catch((error) => {
    console.error(error);
  });
});

promptInput.addEventListener("input", autoResizeTextarea);

promptSuggestions.addEventListener("click", (event) => {
  if (!event.target.classList.contains("suggestion")) return;
  promptInput.value = event.target.textContent;
  autoResizeTextarea();
  promptInput.focus();
});

newChatBtn.addEventListener("click", () => {
  const hasUserMessage = activeConversation.messages.some((msg) => msg.role === "user");
  if (!hasUserMessage) {
    const idx = conversations.findIndex((conv) => conv.id === activeConversation.id);
    if (idx !== -1) {
      conversations.splice(idx, 1);
    }
  }
  activeConversation = createConversation();
  conversations.push(activeConversation);
  renderMessages();
  renderHistory();
  promptInput.focus();
});

toggleThemeBtn.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const mode = document.body.classList.contains("dark") ? "dark" : "light";
  localStorage.setItem("dinov-theme", mode);
  toggleThemeBtn.textContent = mode === "dark" ? "🌕 Giảm tương phản" : "🌘 Tăng tương phản";
});

function restoreTheme() {
  const mode = localStorage.getItem("dinov-theme");
  if (mode === "dark") {
    document.body.classList.add("dark");
    toggleThemeBtn.textContent = "🌕 Giảm tương phản";
  }
}

function init() {
  conversations.push(activeConversation);
  renderMessages();
  renderHistory();
  restoreTheme();
  autoResizeTextarea();
}

init();
