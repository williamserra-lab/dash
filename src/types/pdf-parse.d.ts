// src/types/pdf-parse.d.ts
declare module "pdf-parse" {
  import { Buffer } from "buffer";

  export interface PDFParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
    text: string;
  }

  export default function pdfParse(
    data: Buffer | Uint8Array | ArrayBuffer
  ): Promise<PDFParseResult>;
}
