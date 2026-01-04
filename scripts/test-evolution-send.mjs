import { sendEvolutionText } from "../src/lib/evolutionTransport.js";

const to = process.env.TEST_TO || "5521983010649";
const text = process.env.TEST_TEXT || `teste nextia->evolution ${new Date().toISOString()}`;

const baseUrl = process.env.EVOLUTION_BASE_URL;
const instance = process.env.EVOLUTION_INSTANCE;
const apiKey = process.env.EVOLUTION_APIKEY;

if (!baseUrl || !instance || !apiKey) {
  console.error("Missing EVOLUTION_* env vars. Check .env.local");
  process.exit(1);
}

await sendEvolutionText({ baseUrl, instance, apiKey, number: to, text });
console.log("OK");
