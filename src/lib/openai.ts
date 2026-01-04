import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "OPENAI_API_KEY não definida. As rotas que usam OpenAI vão falhar."
  );
}

export const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
