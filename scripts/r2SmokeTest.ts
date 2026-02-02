// scripts/r2SmokeTest.ts
import * as path from "node:path";
import * as dotenv from "dotenv";

function loadEnv() {
  // Carrega .env.local manualmente (tsx não carrega sozinho)
  const envPath = path.resolve(process.cwd(), ".env.local");
  const res = dotenv.config({ path: envPath });
  return { envPath, res };
}

function safeEnvSnapshot() {
  // Não imprime segredos, só diz se existe ou não
  return {
    R2_ENDPOINT: process.env.R2_ENDPOINT ? "(ok)" : "(missing)",
    R2_BUCKET: process.env.R2_BUCKET ? "(ok)" : "(missing)",
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ? "(ok)" : "(missing)",
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ? "(ok)" : "(missing)",
  };
}

async function main() {
  const { envPath, res } = loadEnv();

  console.log(
    JSON.stringify(
      {
        step: "env_loaded",
        envPath,
        dotenvError: res.error ? String(res.error.message || res.error) : null,
        env: safeEnvSnapshot(),
      },
      null,
      2,
    ),
  );

  // Importa depois do dotenv para garantir que o módulo veja as env vars
  const { r2DeleteObject, r2GetSignedDownloadUrl, r2UploadObject, requireR2Config } = await import(
    "../src/lib/r2"
  );

  const cfg = requireR2Config();

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const key = `dev/smoke/${stamp}-r2-smoke.txt`;

  const content = `nextia-r2-smoke ${stamp}\n`;

  await r2UploadObject(
    {
      key,
      body: Buffer.from(content, "utf-8"),
      contentType: "text/plain; charset=utf-8",
      cacheControl: "no-store",
    },
    cfg,
  );

  const signed = await r2GetSignedDownloadUrl(
    {
      key,
      expiresInSeconds: 300,
      responseContentType: "text/plain; charset=utf-8",
      responseContentDisposition: `inline; filename="r2-smoke.txt"`,
    },
    cfg,
  );

  console.log(JSON.stringify({ ok: true, step: "signed_url", ...signed }, null, 2));

  const resp = await fetch(signed.url, { method: "GET" });
  const body = await resp.text();

  if (!resp.ok) {
    console.error("Falha ao baixar via Signed URL:", resp.status, resp.statusText);
    console.error(body.slice(0, 500));
    process.exit(1);
  }

  if (body !== content) {
    console.error("Conteúdo baixado não confere com o enviado.");
    console.error("Esperado:", JSON.stringify(content));
    console.error("Recebido :", JSON.stringify(body));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, step: "download_ok", bytes: body.length }, null, 2));

  await r2DeleteObject(key, cfg);
  console.log(JSON.stringify({ ok: true, step: "deleted", key }, null, 2));
}

main().catch((err) => {
  console.error("Falha no smoke test do R2:", err?.message || err);
  process.exit(1);
});
