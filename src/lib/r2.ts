// src/lib/r2.ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new Error("R2 deve rodar apenas no servidor (server-side).");
  }
}

export type R2Config = {
  endpoint: string; // https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function getR2ConfigOrNull(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const endpoint = (env.R2_ENDPOINT || "").trim();
  const accessKeyId = (env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = (env.R2_BUCKET || "").trim();

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

export function requireR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
  const cfg = getR2ConfigOrNull(env);
  if (!cfg) {
    throw new Error(
      "Config R2 ausente. Defina: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET",
    );
  }
  return cfg;
}

let cachedClient: S3Client | null = null;

export function getR2Client(cfg: R2Config = requireR2Config()): S3Client {
  assertServerOnly();

  if (cachedClient) return cachedClient;

  cachedClient = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    // Compatível com endpoints S3 não-AWS (R2)
    forcePathStyle: true,
  });

  return cachedClient;
}

export function normalizeR2Key(key: string): string {
  const k = (key || "").trim();
  return k.startsWith("/") ? k.slice(1) : k;
}

export type R2UploadArgs = {
  key: string;
  body: PutObjectCommandInput["Body"];
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
};

export async function r2UploadObject(args: R2UploadArgs, cfg: R2Config = requireR2Config()) {
  const client = getR2Client(cfg);
  const Key = normalizeR2Key(args.key);

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key,
      Body: args.body,
      ContentType: args.contentType,
      CacheControl: args.cacheControl,
      Metadata: args.metadata,
    }),
  );

  return { ok: true as const, bucket: cfg.bucket, key: Key };
}

export type R2SignedDownloadUrlArgs = {
  key: string;
  expiresInSeconds: number; // ex.: 300
  responseContentType?: string;
  responseContentDisposition?: string;
};

export async function r2GetSignedDownloadUrl(
  args: R2SignedDownloadUrlArgs,
  cfg: R2Config = requireR2Config(),
): Promise<{ url: string; bucket: string; key: string; expiresInSeconds: number }> {
  const client = getR2Client(cfg);
  const Key = normalizeR2Key(args.key);

  const cmd = new GetObjectCommand({
    Bucket: cfg.bucket,
    Key,
    ResponseContentType: args.responseContentType,
    ResponseContentDisposition: args.responseContentDisposition,
  });

  const url = await getSignedUrl(client, cmd, { expiresIn: args.expiresInSeconds });

  return { url, bucket: cfg.bucket, key: Key, expiresInSeconds: args.expiresInSeconds };
}

export async function r2DeleteObject(key: string, cfg: R2Config = requireR2Config()) {
  const client = getR2Client(cfg);
  const Key = normalizeR2Key(key);

  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key }));
  return { ok: true as const, bucket: cfg.bucket, key: Key };
}

export async function r2HeadObject(key: string, cfg: R2Config = requireR2Config()) {
  const client = getR2Client(cfg);
  const Key = normalizeR2Key(key);

  const res = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key }));
  return {
    ok: true as const,
    bucket: cfg.bucket,
    key: Key,
    contentLength: res.ContentLength ?? null,
    contentType: res.ContentType ?? null,
    lastModified: res.LastModified ?? null,
    metadata: res.Metadata ?? null,
  };
}
