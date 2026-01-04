"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function getErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || null;
  if (typeof err === "object") {
    const maybe = err as { message?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
  }
  return null;
}


type Contact = {
  id: string;
  clientId: string;
  channel: string;
  identifier: string;
  name?: string;
  vip: boolean;
  optOutMarketing: boolean;
  blockedGlobal: boolean;
  createdAt: string;
  updatedAt: string;
  whatsappNumberId?: string;
  lastMessage?: string;
  lastInteractionAt?: string;
  conversationSummary?: string;
};

const DEFAULT_CLIENT_ID = "catia_foods";

export default function ContatosPage() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") || DEFAULT_CLIENT_ID;

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [vipOnly, setVipOnly] = useState(false);
  const [hideOptOut, setHideOptOut] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  async function loadContacts() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/clients/${clientId}/contacts`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Erro ao carregar contatos (${res.status})`);
      }

      const data = await res.json();
      const items: Contact[] = data.contacts ?? [];

      setContacts(items);

      if (items.length > 0) {
        setSelectedContactId((current) => {
          if (current && items.some((c) => c.id === current)) {
            return current;
          }
          return items[0].id;
        });
      } else {
        setSelectedContactId(null);
      }
    } catch (err: unknown) {
      console.error("Erro ao carregar contatos:", err);
      setError(getErrorMessage(err) || "Erro ao carregar contatos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function updateContact(
    contactId: string,
    patch: Partial<Pick<Contact, "name" | "vip" | "optOutMarketing" | "blockedGlobal">>
  ) {
    try {
      setUpdatingId(contactId);
      setError(null);

      const res = await fetch(`/api/clients/${clientId}/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Erro ao atualizar contato (${res.status})`);
      }

      const data = await res.json();
      const updated: Contact = data.contact;

      setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err: unknown) {
      console.error("Erro ao atualizar contato:", err);
      setError(getErrorMessage(err) || "Erro ao atualizar contato.");
    } finally {
      setUpdatingId(null);
    }
  }

  function handleToggle(contact: Contact, field: "vip" | "optOutMarketing" | "blockedGlobal") {
    const newValue = !contact[field];
    const patch = { [field]: newValue } as Partial<Pick<Contact, "vip" | "optOutMarketing" | "blockedGlobal">>;
    updateContact(contact.id, patch);
}

  async function handleGenerateSummaries() {
    try {
      setSummaryLoading(true);
      setError(null);

      const res = await fetch(`/api/clients/${clientId}/contacts/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error || `Erro ao gerar resumos de conversa (${res.status})`
        );
      }

      // recarrega a lista com os resumos atualizados
      await loadContacts();
    } catch (err: unknown) {
      console.error("Erro ao gerar resumos de conversa:", err);
      setError(getErrorMessage(err) || "Erro ao gerar resumos de conversa.");
    } finally {
      setSummaryLoading(false);
    }
  }

  const filteredContacts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return contacts.filter((c) => {
      if (vipOnly && !c.vip) return false;
      if (hideOptOut && (c.optOutMarketing || c.blockedGlobal)) return false;

      if (!term) return true;

      const name = (c.name || "").toLowerCase();
      const identifier = c.identifier.toLowerCase();

      return name.includes(term) || identifier.includes(term);
    });
  }, [contacts, searchTerm, vipOnly, hideOptOut]);

  const selectedContact =
    filteredContacts.find((c) => c.id === selectedContactId) ||
    contacts.find((c) => c.id === selectedContactId) ||
    null;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-bold text-slate-900">
              Contatos – {clientId}
            </h1>
            <p className="max-w-2xl text-sm text-slate-600">
              Lista de pessoas que já falaram com este cliente pelo WhatsApp. Use os
              indicadores para marcar VIP, opt-out de marketing e bloqueio global. O
              resumo da conversa ajuda o humano a assumir o atendimento com contexto.
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={loadContacts}
                disabled={loading || summaryLoading}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Atualizando..." : "Recarregar"}
              </button>
              <button
                type="button"
                onClick={handleGenerateSummaries}
                disabled={summaryLoading || loading}
                className="rounded-md border border-sky-500 px-3 py-1 text-sm text-sky-700 shadow-sm hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {summaryLoading ? "Gerando resumos..." : "Atualizar resumos"}
              </button>
            </div>
            {error && (
              <div className="max-w-xs rounded-md bg-red-100 px-3 py-2 text-xs text-red-800">
                {error}
              </div>
            )}
          </div>
        </header>

        <section className="flex flex-col gap-4 lg:flex-row">
          {/* Tabela de contatos */}
          <div className="flex-1 rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Buscar por nome ou número..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-56 rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <label className="flex items-center gap-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={vipOnly}
                    onChange={(e) => setVipOnly(e.target.checked)}
                    className="h-3 w-3 rounded border-slate-300"
                  />
                  Mostrar apenas VIP
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={hideOptOut}
                    onChange={(e) => setHideOptOut(e.target.checked)}
                    className="h-3 w-3 rounded border-slate-300"
                  />
                  Ocultar opt-out / bloqueados
                </label>
              </div>
              <p className="text-xs text-slate-500">
                {filteredContacts.length} contato(s) de {contacts.length} carregado(s)
              </p>
            </div>

            <div className="overflow-x-auto">
              {contacts.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Nenhum contato ainda. Quando chegarem mensagens pelo WhatsApp
                  (webhook), eles aparecem aqui.
                </p>
              ) : (
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <th className="px-3 py-2">Nome</th>
                      <th className="px-3 py-2">Canal</th>
                      <th className="px-3 py-2">Número</th>
                      <th className="px-3 py-2">VIP</th>
                      <th className="px-3 py-2">Opt-out</th>
                      <th className="px-3 py-2">Bloqueado</th>
                      <th className="px-3 py-2">Última interação</th>
                      <th className="px-3 py-2">Selecionar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map((c) => (
                      <tr
                        key={c.id}
                        className={`border-b border-slate-100 ${
                          selectedContactId === c.id ? "bg-sky-50" : "bg-white"
                        }`}
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => setSelectedContactId(c.id)}
                          >
                            <div className="font-medium text-slate-900">
                              {c.name || "-"}
                            </div>
                            <div className="text-xs text-slate-500">id: {c.id}</div>
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {c.channel}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {c.identifier}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <button
                            type="button"
                            onClick={() => handleToggle(c, "vip")}
                            disabled={updatingId === c.id}
                            className={
                              c.vip
                                ? "rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-700 disabled:opacity-50"
                                : "rounded-full border border-slate-300 px-3 py-1 text-slate-600 disabled:opacity-50"
                            }
                          >
                            {c.vip ? "VIP" : "Normal"}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <button
                            type="button"
                            onClick={() => handleToggle(c, "optOutMarketing")}
                            disabled={updatingId === c.id}
                            className={
                              c.optOutMarketing
                                ? "rounded-full bg-red-100 px-3 py-1 font-semibold text-red-700 disabled:opacity-50"
                                : "rounded-full border border-slate-300 px-3 py-1 text-slate-600 disabled:opacity-50"
                            }
                          >
                            {c.optOutMarketing ? "Não receber" : "Ativo"}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <button
                            type="button"
                            onClick={() => handleToggle(c, "blockedGlobal")}
                            disabled={updatingId === c.id}
                            className={
                              c.blockedGlobal
                                ? "rounded-full bg-slate-800 px-3 py-1 font-semibold text-slate-50 disabled:opacity-50"
                                : "rounded-full border border-slate-300 px-3 py-1 text-slate-600 disabled:opacity-50"
                            }
                          >
                            {c.blockedGlobal ? "Bloqueado" : "Liberado"}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {c.lastInteractionAt
                            ? new Date(c.lastInteractionAt).toLocaleString("pt-BR")
                            : "-"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <button
                            type="button"
                            onClick={() => setSelectedContactId(c.id)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                          >
                            Ver resumo
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Painel de resumo do contato */}
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-sm lg:w-80">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Resumo do contato
            </h2>

            {!selectedContact ? (
              <p className="text-sm text-slate-500">
                Selecione um contato na tabela para ver o resumo da conversa e os
                principais dados.
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Identificação
                  </p>
                  <p className="font-medium text-slate-900">
                    {selectedContact.name || "-"}
                  </p>
                  <p className="text-xs text-slate-600">
                    {selectedContact.identifier} · {selectedContact.channel}
                  </p>
                  {selectedContact.whatsappNumberId && (
                    <p className="text-xs text-slate-500">
                      Número WhatsApp interno: {selectedContact.whatsappNumberId}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-1 text-xs">
                  <span
                    className={
                      selectedContact.vip
                        ? "rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700"
                        : "rounded-full border border-slate-300 px-2 py-0.5 text-slate-600"
                    }
                  >
                    {selectedContact.vip ? "VIP" : "Normal"}
                  </span>
                  <span
                    className={
                      selectedContact.optOutMarketing
                        ? "rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700"
                        : "rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-green-700"
                    }
                  >
                    {selectedContact.optOutMarketing
                      ? "Opt-out marketing"
                      : "Aceita marketing"}
                  </span>
                  <span
                    className={
                      selectedContact.blockedGlobal
                        ? "rounded-full bg-slate-800 px-2 py-0.5 font-semibold text-slate-50"
                        : "rounded-full border border-slate-300 px-2 py-0.5 text-slate-600"
                    }
                  >
                    {selectedContact.blockedGlobal ? "Bloqueado global" : "Liberado"}
                  </span>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Última interação
                  </p>
                  <p className="text-xs text-slate-600">
                    {selectedContact.lastInteractionAt
                      ? new Date(
                          selectedContact.lastInteractionAt
                        ).toLocaleString("pt-BR")
                      : "Sem registro de última interação."}
                  </p>
                  {selectedContact.lastMessage && (
                    <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700">
                      “{selectedContact.lastMessage}”
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Resumo da conversa
                  </p>
                  <p className="mt-1 whitespace-pre-line rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-700">
                    {selectedContact.conversationSummary?.trim()
                      ? selectedContact.conversationSummary
                      : "Nenhum resumo disponível ainda para este contato. Use o botão 'Atualizar resumos' para gerar um resumo com base nas informações já registradas pelo sistema."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}