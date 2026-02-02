// src/app/clientes/page.tsx
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { detectAndValidateDocumento, digitsOnly as digitsOnlyDoc } from "@/lib/validators/brDocument";

type ClientStatus = "active" | "inactive";

type ClientRecord = {
  id: string;
  name: string;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
  segment?: string;
  whatsappNumbers?: Array<{
    id: string;
    phoneNumber: string;
    label?: string;
    active?: boolean;
    isDefault?: boolean;
  }>;
  profile?: {
    tipoPessoa?: "PF" | "PJ";
    documento?: string;
    documentoTipo?: "CPF" | "CNPJ";
    documentoValidado?: boolean;
    razaoSocial?: string;
    nomeFantasia?: string;
    emailPrincipal?: string;
  };
};

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function isValidEmail(v: string): boolean {
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function digitsOnly(v: unknown): string {
  return String(v ?? "").replace(/\D+/g, "");
}

function isValidE164Digits(digits: string): boolean {
  return digits.length >= 10 && digits.length <= 15;
}

export default function ClientesPage() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");

  const [segment, setSegment] = useState("");
  const [razaoSocial, setRazaoSocial] = useState("");
  const [nomeFantasia, setNomeFantasia] = useState("");
  const [tipoPessoa, setTipoPessoa] = useState<"PF" | "PJ">("PJ");
  const [documento, setDocumento] = useState("");
  const [emailPrincipal, setEmailPrincipal] = useState("");

  const docDet = useMemo(() => {
    const d = String(documento || "").trim();
    if (!d) return null;
    return detectAndValidateDocumento(d);
  }, [documento]);

  // Auto-derive PF/PJ from documento when válido
  useEffect(() => {
    if (docDet?.isValid) {
      setTipoPessoa(docDet.type === "CPF" ? "PF" : "PJ");
    }
  }, [docDet?.isValid, docDet?.type]);

  const whatsappDigits = useMemo(() => digitsOnly(whatsappNumber), [whatsappNumber]);
  const whatsappOk = useMemo(
    () => !whatsappDigits || isValidE164Digits(whatsappDigits),
    [whatsappDigits]
  );

  const emailNorm = useMemo(() => normalizeEmail(emailPrincipal), [emailPrincipal]);
  const emailOk = useMemo(() => isValidEmail(emailNorm), [emailNorm]);

  const canCreate = useMemo(() => {
    if (name.trim().length <= 1) return false;
    if (clientId.trim().length <= 1) return false;
    if (!docDet || !docDet.isValid) return false;
    if (razaoSocial.trim().length <= 1) return false;
    if (!emailOk) return false;
    if (!whatsappOk) return false;
    return true;
  }, [name, clientId, docDet, razaoSocial, emailOk, whatsappOk]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", { cache: "no-store", credentials: "include" });
      const data = await readJsonSafe<{ clients?: ClientRecord[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || "Erro ao carregar clientes.");
      setClients(Array.isArray(data?.clients) ? data!.clients : []);
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Erro ao carregar clientes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: clientId.trim(),
          name: name.trim(),
          segment: segment.trim() || undefined,
          whatsappNumber: whatsappDigits || undefined,
          profile: {
            tipoPessoa,
            documento: (docDet?.digits || digitsOnlyDoc(documento)).trim(),
            razaoSocial: razaoSocial.trim(),
            nomeFantasia: nomeFantasia.trim() || undefined,
            emailPrincipal: emailNorm,
          },
        }),
      });

      const data = await readJsonSafe<{ error?: string; message?: string }>(res);
      if (!res.ok) throw new Error(data?.error || data?.message || "Erro ao criar cliente.");

      // Reset form
      setName("");
      setClientId("");
      setWhatsappNumber("");
      setSegment("");
      setRazaoSocial("");
      setNomeFantasia("");
      setTipoPessoa("PJ");
      setDocumento("");
      setEmailPrincipal("");

      await load();
    } catch (e2: unknown) {
      setError(getErrorMessage(e2) || "Erro ao criar cliente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function renameClient(id: string) {
    const newName = prompt("Novo nome do cliente:", clients.find((c) => c.id === id)?.name || "");
    if (!newName || newName.trim().length < 2) return;

    setError(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || "Erro ao renomear cliente.");
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Erro ao renomear cliente.");
    }
  }

  async function toggleStatus(id: string, next: ClientStatus) {
    setError(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await readJsonSafe<{ error?: string; message?: string }>(res);
      if (!res.ok) throw new Error(data?.error || data?.message || "Erro ao atualizar status.");
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Erro ao atualizar status.");
    }
  }

  async function deleteClientById(id: string) {
    setError(null);
    const confirm = prompt(`Para excluir definitivamente, digite o clientId: ${id}`);
    if (confirm !== id) return;

    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const data = await readJsonSafe<{ error?: string; message?: string }>(res);
      if (!res.ok) throw new Error(data?.error || data?.message || "Erro ao excluir cliente.");
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Erro ao excluir cliente.");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Clientes</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Cadastro mínimo para evitar tenant “solto”. Sem cliente válido, o app não deveria operar.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Ex.: Loja Exemplo"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">clientId</label>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="ex.: loja_teste"
            />
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Letras/números/underscore/hífen. É o identificador usado no URL e nos dados.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              WhatsApp (opcional)
            </label>
            <input
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="DDI+DDD+número (somente dígitos)"
            />
            {!whatsappOk && (
              <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                WhatsApp inválido. Use DDI+DDD+número (10 a 15 dígitos).
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Razão social (obrigatório)
            </label>
            <input
              value={razaoSocial}
              onChange={(e) => setRazaoSocial(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Ex.: Loja Exemplo LTDA"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Nome fantasia
            </label>
            <input
              value={nomeFantasia}
              onChange={(e) => setNomeFantasia(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Opcional"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Tipo pessoa (obrigatório)
            </label>
            <select
              value={tipoPessoa}
              onChange={(e) => setTipoPessoa(e.target.value as any)}
              disabled={!!docDet?.isValid}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         disabled:opacity-70
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="PF">PF</option>
              <option value="PJ">PJ</option>
            </select>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Definido automaticamente quando CPF/CNPJ é válido.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              CPF/CNPJ (obrigatório)
            </label>
            <input
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Somente dígitos ou com máscara"
            />
            {documento.trim() ? (
              docDet?.isValid ? (
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                  {docDet.type} válido
                </p>
              ) : (
                <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                  Documento inválido
                </p>
              )
            ) : null}
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Email principal (obrigatório)
            </label>
            <input
              value={emailPrincipal}
              onChange={(e) => setEmailPrincipal(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="ex.: contato@empresa.com"
            />
            {!!emailNorm && !emailOk && (
              <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">Email inválido</p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Segmento / ramo
            </label>
            <input
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Opcional"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="submit"
            disabled={!canCreate || submitting}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {submitting ? "Criando..." : "Criar cliente"}
          </button>

          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            onClick={() => load()}
          >
            Recarregar
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Lista</h2>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-slate-600 dark:text-slate-300">Carregando...</div>
        ) : clients.length === 0 ? (
          <div className="p-4 text-sm text-slate-600 dark:text-slate-300">
            Nenhum cliente cadastrado.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {clients.map((c) => (
              <div key={c.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900 dark:text-slate-100">{c.name}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      {c.id}
                    </span>
                    <span
                      className={
                        c.status === "active"
                          ? "rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                          : "rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                      }
                    >
                      {c.status === "active" ? "ativo" : "inativo"}
                    </span>
                    {c.profile?.documentoTipo && (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {c.profile.documentoTipo}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    {c.profile?.razaoSocial ? <span>{c.profile.razaoSocial}</span> : null}
                    {c.profile?.emailPrincipal ? (
                      <>
                        {c.profile?.razaoSocial ? " • " : ""}
                        <span>{c.profile.emailPrincipal}</span>
                      </>
                    ) : null}
                    {c.segment ? (
                      <>
                        {(c.profile?.razaoSocial || c.profile?.emailPrincipal) ? " • " : ""}
                        <span>segmento: {c.segment}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    href={`/clientes/${encodeURIComponent(c.id)}/painel`}
                  >
                    Abrir
                  </a>

                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    onClick={() => renameClient(c.id)}
                  >
                    Renomear
                  </button>

                  {c.status === "active" ? (
                    <button
                      className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                      onClick={() => toggleStatus(c.id, "inactive")}
                    >
                      Desativar
                    </button>
                  ) : (
                    <button
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                      onClick={() => toggleStatus(c.id, "active")}
                    >
                      Ativar
                    </button>
                  )}

                  <button
                    className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
                    onClick={() => deleteClientById(c.id)}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
