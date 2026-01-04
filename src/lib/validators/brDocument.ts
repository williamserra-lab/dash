// src/lib/validators/brDocument.ts
// CPF/CNPJ validation and normalization (Brasil only).

export type BrDocumentType = "CPF" | "CNPJ";

export function digitsOnly(input: string): string {
  return String(input || "").replace(/\D+/g, "");
}

function isRepeatedDigits(s: string): boolean {
  return !!s && s.split("").every((c) => c === s[0]);
}

export function validateCPF(cpfRaw: string): boolean {
  const cpf = digitsOnly(cpfRaw);
  if (cpf.length !== 11) return false;
  if (isRepeatedDigits(cpf)) return false;

  const calc = (base: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Number(base[i]) * weights[i];
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };

  const d1 = calc(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(cpf.slice(0, 9) + String(d1), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);

  return cpf.slice(-2) === `${d1}${d2}`;
}

export function validateCNPJ(cnpjRaw: string): boolean {
  const cnpj = digitsOnly(cnpjRaw);
  if (cnpj.length !== 14) return false;
  if (isRepeatedDigits(cnpj)) return false;

  const calc = (base: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Number(base[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(cnpj.slice(0, 12), w1);
  const d2 = calc(cnpj.slice(0, 12) + String(d1), w2);

  return cnpj.slice(-2) === `${d1}${d2}`;
}

export function detectAndValidateDocumento(documentoRaw: string): {
  type: BrDocumentType;
  digits: string;
  isValid: boolean;
} | null {
  const digits = digitsOnly(documentoRaw);
  if (!digits) return null;

  if (digits.length === 11) {
    return { type: "CPF", digits, isValid: validateCPF(digits) };
  }
  if (digits.length === 14) {
    return { type: "CNPJ", digits, isValid: validateCNPJ(digits) };
  }
  // Unknown length
  return { type: digits.length < 14 ? "CPF" : "CNPJ", digits, isValid: false };
}
