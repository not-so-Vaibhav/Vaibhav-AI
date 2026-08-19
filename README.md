# Vaibhav personal chatbot API

An API that answers public questions about Vaibhav from the curated `knowledge.md` file. It uses the Gemini API's free tier and never exposes the Gemini API key to clients.

## Run locally

1. Create a free Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Copy `.env.example` to `.env` and add that key as `GEMINI_API_KEY`.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:3000/health` to confirm it is working.

## Use the API

`POST /v1/chat`

```json
{
  "message": "What projects has Vaibhav worked on?",
  "history": [
    { "role": "user", "content": "Tell me about Vaibhav." },
    { "role": "assistant", "content": "Vaibhav is..." }
  ]
}
```

The `history` field is optional. Send at most the latest few visible messages; the API already caps it for safety.

Example with a server-side key:

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: replace_with_a_long_random_value' \
  -d '{"message":"What is Solace?"}'
```

The response shape is:

```json
{ "answer": "...", "model": "gpt-5.6-luna" }
```

## Deploy to Render

1. Put this folder in a new private GitHub repository and push it.
2. In Render, choose **New > Blueprint** and select that repository. Render will read `render.yaml`.
3. Create a free Gemini key at [Google AI Studio](https://aistudio.google.com/app/apikey), then enter it as `GEMINI_API_KEY` when Render requests it. Never put this key in code, a frontend app, or Git.
4. Set `ALLOWED_ORIGINS` to your real website domain(s), separated by commas. Do not leave `*` in production.
5. `CLIENT_API_KEY` is intentionally not configured by default, so a browser-based project can call the API. The API still has rate limiting. If you later call it only from a backend you control, set a long random `CLIENT_API_KEY` in Render and send it as the `x-api-key` header.
6. After deploying, test `https://YOUR-SERVICE.onrender.com/health` and call `https://YOUR-SERVICE.onrender.com/v1/chat`.

## Update the bot

Edit `knowledge.md`, commit the change, and redeploy. Keep only facts you are comfortable making available to your visitors. The system prompt is intentionally designed to refuse unverified facts and instructions that attempt to override the bot's rules.
