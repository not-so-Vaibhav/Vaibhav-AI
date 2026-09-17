import "dotenv/config";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { GoogleGenAI } from "@google/genai";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const knowledge1 = await readFile(path.join(__dirname, "knowledge.md"), "utf8");
const knowledge2 = await readFile(path.join(__dirname, "knowledge2.md"), "utf8");
const knowledge3 = await readFile(path.join(__dirname, "knowledge3.md"), "utf8");
const atlasKnowledge = await readFile(path.join(__dirname, "atlas_additional_personal_knowledge.md"), "utf8");

const knowledge = `${knowledge1}\n\n${knowledge2}\n\n${knowledge3}\n\n${atlasKnowledge}`;
const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required. Add it to your .env file or Render environment variables.");
}

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "32kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("This website is not allowed to use the API."));
    },
    methods: ["GET", "POST"],
  }),
);
app.use(
  "/v1",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX || 60),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again shortly." },
  }),
);

function requireClientKey(req, res, next) {
  const expected = process.env.CLIENT_API_KEY;
  if (!expected || req.get("x-api-key") === expected) return next();
  return res.status(401).json({ error: "Invalid or missing x-api-key." });
}

// Build strictly valid Gemini contents array:
// 1. Must start with role 'user'
// 2. Must strictly alternate: user -> model -> user -> model -> user
// 3. Filters out any error notices or greeting messages
function formatGeminiContents(history, currentMessage) {
  const contents = [];
  let expectedRole = "user";

  const rawHistory = Array.isArray(history) ? history : [];
  
  for (const item of rawHistory) {
    if (!item || typeof item.content !== "string") continue;
    const text = item.content.trim();
    if (!text) continue;

    // Ignore error messages and greeting messages
    if (text.includes("having a moment connecting") || text.includes("I am **Atlas'AI**") || text.includes("I am Vaibhav Bariyar's portfolio assistant")) {
      continue;
    }

    const itemRole = item.role === "assistant" || item.role === "bot" || item.role === "model" ? "model" : "user";

    // Gemini multi-turn MUST start with user
    if (contents.length === 0) {
      if (itemRole === "user") {
        contents.push({ role: "user", parts: [{ text: text.slice(0, 1500) }] });
        expectedRole = "model";
      }
      continue;
    }

    // Only add if it strictly alternates
    if (itemRole === expectedRole) {
      contents.push({ role: itemRole, parts: [{ text: text.slice(0, 1500) }] });
      expectedRole = expectedRole === "user" ? "model" : "user";
    }
  }

  // Ensure last item in history wasn't already a user message before appending currentMessage
  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents.pop();
  }

  // Append current user message
  contents.push({ role: "user", parts: [{ text: currentMessage }] });

  return contents;
}

const instructions = `You are Atlas'AI, the digital headquarters intelligence assistant for Vaibhav Bariyar.
Answer questions about Vaibhav using ONLY the verified context below.
Be articulate, warm, concise, factual, and deeply knowledgeable about his engineering, startup (Solace), design, AI/ML projects, photography, and philosophy.
Speak about Vaibhav in the third person unless asked otherwise.
Never invent dates, credentials, or private personal data. If you don't know, state that politely.
Solace is a student-focused peer-support platform, not clinical therapy.

FORMATTING GUIDELINES:
- Use clean Markdown with bullet points and bold highlights for readability.
- When referring to rooms or pages in Atlas, you can use markdown links like [Projects](/projects), [Founder](/founder), [Experience](/experience), [Skills](/skills), [Photography](/photography), or [Contact](/contact).
- Keep replies structured, clear, and complete. Never cut off mid-sentence.

VERIFIED CONTEXT
${knowledge}`;

// Resilient generation with model fallback & exponential retry against 503/429 spikes
async function generateWithFallback(contents) {
  const candidateModels = [
    process.env.GEMINI_MODEL || "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.6-pro",
  ];

  let lastError = null;

  for (const m of candidateModels) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.models.generateContent({
          model: m,
          contents,
          config: {
            systemInstruction: instructions,
            maxOutputTokens: 2048,
            temperature: 0.3,
          },
        });

        const answer = response.text?.trim();
        if (answer) {
          return { answer, model: m };
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Gemini] ${m} attempt ${attempt + 1} failed: ${err.message}`);
        // Small backoff before retrying or switching models
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error("All AI models were temporarily unavailable.");
}

app.get("/", (_req, res) => {
  res.json({ name: "Vaibhav Personal Chatbot API", status: "ok", chat_endpoint: "/v1/chat" });
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/v1/chat", requireClientKey, async (req, res) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message || message.length > 2000) {
      return res.status(400).json({ error: "message must be between 1 and 2000 characters." });
    }

    const contents = formatGeminiContents(req.body?.history, message);
    const result = await generateWithFallback(contents);

    return res.json(result);
  } catch (error) {
    console.error("Chat generation error:", error);
    return res.status(500).json({
      error: error?.message || "The assistant could not respond right now."
    });
  }
});

app.use((error, _req, res, _next) => {
  console.error("Express unhandled error:", error);
  const status = error?.status && error.status < 500 ? error.status : 500;
  res.status(status).json({ error: error.message || "An unexpected error occurred." });
});

app.listen(port, () => console.log(`Vaibhav chatbot API listening on port ${port}`));




