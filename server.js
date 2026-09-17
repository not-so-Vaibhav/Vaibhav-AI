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
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
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

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-8)
    .filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 2000) }))
    .filter((item) => item.content.length > 0);
}

const instructions = `You are Atlas'AI, the digital headquarters intelligence assistant for Vaibhav Bariyar.
Answer questions about Vaibhav using ONLY the verified context below.
Be articulate, warm, concise, factual, and deeply knowledgeable about his engineering, startup (Solace), design, AI/ML projects, photography, and philosophy.
Speak about Vaibhav in the third person unless asked otherwise.
Never invent dates, credentials, or achievements. If you don't know, state that clearly.
Solace is a student-focused peer-support platform, not clinical therapy.

FORMATTING GUIDELINES:
- Use clean Markdown with bullet points and bold highlights for readability.
- When referring to rooms or pages in Atlas, you can use markdown links like [Projects](/projects), [Founder](/founder), [Experience](/experience), [Skills](/skills), [Photography](/photography), or [Contact](/contact).
- Keep replies structured, clear, and complete. Never cut off mid-sentence.

VERIFIED CONTEXT
${knowledge}`;

app.get("/", (_req, res) => {
  res.json({ name: "Vaibhav Personal Chatbot API", status: "ok", chat_endpoint: "/v1/chat" });
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/v1/chat", requireClientKey, async (req, res, next) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message || message.length > 2000) {
      return res.status(400).json({ error: "message must be between 1 and 2000 characters." });
    }

    const response = await client.models.generateContent({
      model,
      contents: [
        ...cleanHistory(req.body?.history).map((item) => ({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: item.content }],
        })),
        { role: "user", parts: [{ text: message }] },
      ],
      config: {
        systemInstruction: instructions,
        maxOutputTokens: 2048,
        thinkingConfig: {
          thinkingBudget: 0,
        },
        temperature: 0.3,
      },
    });

    const answer = response.text?.trim();
    if (!answer) throw new Error("Gemini returned an empty response.");
    return res.json({ answer, model });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error?.status && error.status < 500 ? error.status : 500;
  res.status(status).json({ error: status === 500 ? "The assistant could not respond right now." : error.message });
});

app.listen(port, () => console.log(`Vaibhav chatbot API listening on port ${port}`));

