"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Kpi,
  StatusBadge,
  type CampaignStatus,
} from "@/components/ui";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DEFAULT_CLIENT_ID = "catia_foods";

type Contact = {
  id: string;
  name?: string | null;
  phone?: string | null;
  channel: string;
  vip?: boolean;
  optOutMarketing?: boolean;
  blockedGlobal?: boolean;
};

type Campaign = {
  id: string;
  clientId: string;
  channel: "whatsapp";
  name: string;
  // Canonical: API usa "message".
  // Backward-compat: versões antigas do UI usavam "messageTemplate".
  message?: string;
  messageTemplate?: string;
  target?: {
    vipOnly: boolean;
    contactIds?: string[];
    tagsAny?: string[];
    listIds?: string[];
    excludeOptOut?: boolean;
    excludeBlocked?: boolean;
  };
  status: CampaignStatus;
  createdAt: string;
  updatedAt?: string;
};

type CreateFormState = {
  name: string;
  message: string;
  vipOnly: boolean;
  // Destinatarios (1:1)
  // - all: todos os elegiveis (respeitando vipOnly/opt-out/bloqueados)
  // - selected: apenas os contatos escolhidos
  targetMode: "all" | "selected";
  contactIds: string[];
};

type Simulation = {
  totalContacts: number;
  eligibleContacts: number;
  vipContacts: number;
  excludedOptOut?: number;
  excludedBlocked?: number;
  targets: Array<{
    contactId: string;
    identifier: string;
    vip: boolean;
  }>;
};

type CampaignSendSummary = {
  total: number;
  simulado: number;
  agendado: number;
  enviado: number;
  erro: number;
  replied24h?: number;
  replied7d?: number;
  lastAt?: string | null;
};

type DispatchSummary = {
  totalTargets: number;
  cappedTargets: number;
  eligible: number;
  attempted: number;
  enqueued: number;
  errors: number;
  skippedAlreadyHandled: number;
  skippedDueToDailyLimit: number;
};

type DispatchResponse = {
  ok: boolean;
  mode: "send" | "resume" | "retry_errors";
  clientId: string;
  campaignId: string;
  statusAfter: CampaignStatus;
  summary: DispatchSummary;
  daily?: {
    date: string;
    limit: number;
    usedAfter: number;
    remainingAfter: number;
  };
  campaign?: Campaign;
};

async function readJsonSafe<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function CampanhasPage({ clientId: clientIdProp }: { clientId?: string } = {}) {
  const searchParams = useSearchParams();
  const clientId = useMemo(
    () => String(searchParams.get("clientId") || DEFAULT_CLIENT_ID).trim(),
    [searchParams]
  );

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sendSummaryById, setSendSummaryById] = useState<Record<string, CampaignSendSummary>>({});

  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [simulatingId, setSimulatingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastDispatch, setLastDispatch] = useState<DispatchResponse | null>(null);

  const [createForm, setCreateForm] = useState<CreateFormState>({
    name: "",
    message: "",
    vipOnly: false,
    targetMode: "all",
    contactIds: [],
  });

  const selectedContacts = useMemo(() => {
    const set = new Set(createForm.contactIds);
    return contacts.filter((c) => set.has(String(c.id)));
  }, [contacts, createForm.contactIds]);

  const eligibleContacts = useMemo(() => {
    return contacts.filter((c) => c.channel === "whatsapp");
  }, [contacts]);

  async function loadContacts() {
    const res = await fetch(`/api/clients/${clientId}/contacts`);
    const data = await readJsonSafe<unknown>(res);
    if (!res.ok) {
      throw new Error(
        isRecord(data) && typeof data.error === "string" ? data.error : "Falha ao carregar contatos."
      );
    }
    if (!Array.isArray(data)) return;
    setContacts(data as Contact[]);
  }

  async function loadCampaigns() {
    const res = await fetch(`/api/clients/${clientId}/campaigns`);
    const data = await readJsonSafe<unknown>(res);
    if (!res.ok) {
      throw new Error(
        isRecord(data) && typeof data.error === "string" ? data.error : "Falha ao carregar campanhas."
      );
    }
    if (!Array.isArray(data)) return;
    setCampaigns(data as Campaign[]);
  }

  async function loadSummaries(campaignIds: string[]) {
    // best-effort: não falha o page load
    const next: Record<string, CampaignSendSummary> = {};
    await Promise.all(
      campaignIds.map(async (id) => {
        try {
          const res = await fetch(`/api/clients/${clientId}/campaigns/${id}/results`);
          const data = await readJsonSafe<unknown>(res);
          if (!res.ok || !isRecord(data)) return;
          next[id] = data as CampaignSendSummary;
        } catch {
          // ignore
        }
      })
    );
    setSendSummaryById(next);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccessMessage(null);
        setLastDispatch(null);

        await loadContacts();
        await loadCampaigns();
      } catch (err) {
        if (!mounted) return;
        setError(getErrorMessage(err));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (campaigns.length === 0) return;
    loadSummaries(campaigns.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns.length, clientId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    try {
      setCreating(true);
      setError(null);
      setSuccessMessage(null);
      setLastDispatch(null);

      const payload = {
        name: createForm.name.trim(),
        channel: "whatsapp",
        message: createForm.message,
        target: {
          vipOnly: createForm.vipOnly,
          contactIds: createForm.targetMode === "selected" ? createForm.contactIds : undefined,
          excludeOptOut: true,
          excludeBlocked: true,
        },
      };

      const res = await fetch(`/api/clients/${clientId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await readJsonSafe<unknown>(res);
      if (!res.ok) {
        throw new Error(
          (isRecord(data) && typeof data.error === "string" ? data.error : undefined) ||
            "Falha ao criar campanha."
        );
      }

      setCreateForm({
        name: "",
        message: "",
        vipOnly: false,
        targetMode: "all",
        contactIds: [],
      });

      setSuccessMessage("Campanha criada.");
      await loadCampaigns();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleSimulate(campaignId: string) {
    try {
      setSimulatingId(campaignId);
      setError(null);
      setSuccessMessage(null);
      setLastDispatch(null);

      const res = await fetch(`/api/clients/${clientId}/campaigns/${campaignId}/simulate`, {
        method: "POST",
      });

      const data = await readJsonSafe<unknown>(res);

      if (!res.ok) {
        throw new Error(
          (isRecord(data) && typeof data.error === "string" ? data.error : undefined) ||
            "Falha ao simular campanha."
        );
      }

      // A simulação atual do backend retorna os contadores; aqui mantemos simples.
      const sim = (isRecord(data) ? (data as Simulation) : null) as Simulation | null;
      if (sim) {
        setSuccessMessage(`Simulação pronta: ${sim.eligibleContacts} elegíveis (de ${sim.totalContacts}).`);
      } else {
        setSuccessMessage("Simulação pronta.");
      }

      await loadCampaigns();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSimulatingId(null);
    }
  }

  async function postDispatch(endpoint: string, mode: DispatchResponse["mode"]) {
    const res = await fetch(endpoint, { method: "POST" });
    const data = await readJsonSafe<unknown>(res);

    if (!res.ok) {
      throw new Error(
        (isRecord(data) && typeof data.error === "string" ? data.error : undefined) ||
          "Falha ao executar operação."
      );
    }

    // Backend agora padroniza este payload.
    if (!isRecord(data)) {
      throw new Error("Resposta inesperada do servidor.");
    }

    const parsed = data as DispatchResponse;
    // Garantia mínima para evitar UI quebrada
    if (!parsed || parsed.ok !== true || parsed.mode !== mode) {
      setLastDispatch(null);
    } else {
      setLastDispatch(parsed);
    }

    return parsed;
  }

  async function handleSend(campaignId: string) {
    try {
      setSendingId(campaignId);
      setError(null);
      setSuccessMessage(null);
      setLastDispatch(null);

      const parsed = await postDispatch(`/api/clients/${clientId}/campaigns/${campaignId}/send`, "send");

      setSuccessMessage(
        parsed.summary.skippedDueToDailyLimit > 0
          ? "Envio iniciado (parcial por limite diário)."
          : "Envio iniciado."
      );

      await loadContacts();
      await loadCampaigns();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSendingId(null);
    }
  }

  async function handleResumeSend(campaignId: string) {
    try {
      setResumingId(campaignId);
      setError(null);
      setSuccessMessage(null);
      setLastDispatch(null);

      const parsed = await postDispatch(
        `/api/clients/${clientId}/campaigns/${campaignId}/resume-send`,
        "resume"
      );

      setSuccessMessage(
        parsed.summary.attempted === 0
          ? "Nada pendente para retomar."
          : parsed.summary.skippedDueToDailyLimit > 0
            ? "Retomada iniciada (parcial por limite diário)."
            : "Retomada iniciada."
      );

      await loadCampaigns();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setResumingId(null);
    }
  }

  async function handleRetryErrors(campaignId: string) {
    try {
      setRetryingId(campaignId);
      setError(null);
      setSuccessMessage(null);
      setLastDispatch(null);

      const parsed = await postDispatch(`/api/clients/${clientId}/campaigns/${campaignId}/retry-errors`, "retry_errors");

      setSuccessMessage(parsed.summary.attempted === 0 ? "Não há erros para retentar." : "Retentativa iniciada.");

      await loadCampaigns();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRetryingId(null);
    }
  }

  const kpiData = useMemo(() => {
    const total = campaigns.length;
    const inProgress = campaigns.filter((c) => c.status === "em_andamento").length;
    const sent = campaigns.filter((c) => c.status === "disparada").length;
    const drafts = campaigns.filter((c) => c.status === "rascunho").length;
    return { total, inProgress, sent, drafts };
  }, [campaigns]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Campanhas</h1>
            <p className="mt-1 text-sm text-gray-600">
              Cliente: <span className="font-mono">{clientId}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-lg bg-white px-3 py-2 text-sm text-gray-700 ring-1 ring-black/5">
              Contatos WhatsApp: <span className="font-semibold tabular-nums">{eligibleContacts.length}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Total" value={kpiData.total} />
          <Kpi label="Em andamento" value={kpiData.inProgress} />
          <Kpi label="Disparadas" value={kpiData.sent} />
          <Kpi label="Rascunhos" value={kpiData.drafts} />
        </div>

        {(error || successMessage) && (
          <div className="mt-6 space-y-2">
            {error ? <Alert variant="error">{error}</Alert> : null}
            {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}
          </div>
        )}

        {lastDispatch ? (
          <Card className="mt-6 p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">Resumo da última operação</div>
                <div className="mt-1 text-xs text-gray-600">
                  Modo: <span className="font-mono">{lastDispatch.mode}</span> • Status após:{" "}
                  <span className="font-mono">{lastDispatch.statusAfter}</span>
                </div>
              </div>
              {lastDispatch.daily ? (
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700 ring-1 ring-gray-200">
                  Quota {lastDispatch.daily.date}: restante{" "}
                  <span className="font-semibold tabular-nums">{lastDispatch.daily.remainingAfter}</span> (limite{" "}
                  <span className="tabular-nums">{lastDispatch.daily.limit}</span>)
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Elegíveis" value={lastDispatch.summary.eligible} />
              <Kpi label="Tentados" value={lastDispatch.summary.attempted} />
              <Kpi label="Enfileirados" value={lastDispatch.summary.enqueued} />
              <Kpi label="Erros" value={lastDispatch.summary.errors} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Já tratados" value={lastDispatch.summary.skippedAlreadyHandled} />
              <Kpi label="Cortados (limite)" value={lastDispatch.summary.skippedDueToDailyLimit} />
              <Kpi label="Total alvo" value={lastDispatch.summary.totalTargets} />
              <Kpi label="Cap (policy)" value={lastDispatch.summary.cappedTargets} />
            </div>
          </Card>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Criar campanha</CardTitle>
              <CardDescription>
                Crie campanhas WhatsApp com segmentação simples (VIP e seleção de contatos).
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-900">Nome</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                    value={createForm.name}
                    onChange={(e) => setCreateForm((s) => ({ ...s, name: e.target.value }))}
                    placeholder="Ex.: Promoção de Janeiro"
                    required
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-900">Mensagem</label>
                  <textarea
                    className="mt-1 min-h-[120px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                    value={createForm.message}
                    onChange={(e) => setCreateForm((s) => ({ ...s, message: e.target.value }))}
                    placeholder="Digite a mensagem que será enviada no WhatsApp."
                    required
                  />
                  <div className="mt-1 text-xs text-gray-500">
                    Dica: mantenha a mensagem curta. Evite links e linguagem agressiva para reduzir bloqueios.
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      checked={createForm.vipOnly}
                      onChange={(e) => setCreateForm((s) => ({ ...s, vipOnly: e.target.checked }))}
                    />
                    Apenas VIP
                  </label>

                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-sm text-gray-600">Destinatários:</span>
                    <select
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                      value={createForm.targetMode}
                      onChange={(e) =>
                        setCreateForm((s) => ({
                          ...s,
                          targetMode: e.target.value === "selected" ? "selected" : "all",
                          contactIds: [],
                        }))
                      }
                    >
                      <option value="all">Todos elegíveis</option>
                      <option value="selected">Selecionar contatos</option>
                    </select>
                  </div>
                </div>

                {createForm.targetMode === "selected" ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="text-sm font-medium text-gray-900">Selecionar contatos</div>
                    <div className="mt-2 max-h-56 overflow-auto rounded-lg bg-white p-2 ring-1 ring-black/5">
                      {eligibleContacts.length === 0 ? (
                        <div className="p-3 text-sm text-gray-600">Nenhum contato WhatsApp encontrado.</div>
                      ) : (
                        <div className="space-y-2">
                          {eligibleContacts.map((c) => {
                            const id = String(c.id);
                            const checked = createForm.contactIds.includes(id);
                            return (
                              <label
                                key={id}
                                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const on = e.target.checked;
                                    setCreateForm((s) => ({
                                      ...s,
                                      contactIds: on
                                        ? Array.from(new Set([...s.contactIds, id]))
                                        : s.contactIds.filter((x) => x !== id),
                                    }));
                                  }}
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-gray-900">
                                    {c.name || "(sem nome)"}
                                  </div>
                                  <div className="truncate text-xs text-gray-600">
                                    {c.phone || "(sem telefone)"} • {c.vip ? "VIP" : "Não VIP"}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {selectedContacts.length > 0 ? (
                      <div className="mt-2 text-xs text-gray-600">
                        Selecionados: <span className="font-semibold tabular-nums">{selectedContacts.length}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={creating || !createForm.name.trim() || !createForm.message.trim()}
                  >
                    {creating ? "Criando..." : "Criar campanha"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-start justify-between gap-3 md:flex-row md:items-center">
              <div>
                <CardTitle>Campanhas existentes</CardTitle>
                <CardDescription>
                  Simule antes de enviar. Use “Retomar” para campanhas em andamento e “Retry erros” para retentar falhas.
                </CardDescription>
              </div>
              <Button
                variant="secondary"
                disabled={loading}
                onClick={async () => {
                  try {
                    setLoading(true);
                    setError(null);
                    setSuccessMessage(null);
                    setLastDispatch(null);
                    await loadCampaigns();
                  } catch (err) {
                    setError(getErrorMessage(err));
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Atualizar
              </Button>
            </CardHeader>

            <CardContent>
              <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Campanha
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Resultado
                      </th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {campaigns.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6">
                          <EmptyState
                            title="Nenhuma campanha ainda"
                            description="Crie a primeira campanha ao lado para começar a enviar."
                          />
                        </td>
                      </tr>
                    ) : (
                      campaigns
                        .slice()
                        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
                        .map((c) => {
                          const summary = sendSummaryById[c.id];
                          const hasErrors = summary?.erro && summary.erro > 0;
                          const busy =
                            simulatingId === c.id ||
                            sendingId === c.id ||
                            resumingId === c.id ||
                            retryingId === c.id;

                          const allBusy = Boolean(simulatingId || sendingId || resumingId || retryingId);

                          return (
                            <tr key={c.id} className={busy ? "opacity-70" : undefined}>
                              <td className="px-4 py-4">
                                <div className="text-sm font-semibold text-gray-900">{c.name}</div>
                                <div className="mt-1 text-xs text-gray-600">
                                  <span className="font-mono">{c.id}</span>
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <StatusBadge status={c.status} />
                                <div className="mt-2 text-xs text-gray-600">
                                  VIP: <span className="font-mono">{String(Boolean(c.target?.vipOnly))}</span>
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                {summary ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="text-xs text-gray-600">
                                      Agendado:{" "}
                                      <span className="font-semibold tabular-nums">{summary.agendado}</span>
                                    </div>
                                    <div className="text-xs text-gray-600">
                                      Enviado:{" "}
                                      <span className="font-semibold tabular-nums">{summary.enviado}</span>
                                    </div>
                                    <div className="text-xs text-gray-600">
                                      Erro: <span className="font-semibold tabular-nums">{summary.erro}</span>
                                    </div>
                                    <div className="text-xs text-gray-600">
                                      Total: <span className="font-semibold tabular-nums">{summary.total}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-xs text-gray-500">(sem dados)</div>
                                )}
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button
                                    variant="secondary"
                                    disabled={allBusy}
                                    onClick={() => handleSimulate(c.id)}
                                  >
                                    {simulatingId === c.id ? "Simulando..." : "Simular"}
                                  </Button>

                                  <Button variant="primary" disabled={allBusy} onClick={() => handleSend(c.id)}>
                                    {sendingId === c.id ? "Enviando..." : "Enviar"}
                                  </Button>

                                  {c.status === "em_andamento" ? (
                                    <Button
                                      variant="secondary"
                                      disabled={allBusy}
                                      onClick={() => handleResumeSend(c.id)}
                                    >
                                      {resumingId === c.id ? "Retomando..." : "Retomar"}
                                    </Button>
                                  ) : null}

                                  {hasErrors ? (
                                    <Button
                                      variant="secondary"
                                      disabled={allBusy}
                                      onClick={() => handleRetryErrors(c.id)}
                                    >
                                      {retryingId === c.id ? "Retry..." : "Retry erros"}
                                    </Button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 text-xs text-gray-500">
                Observação: “Retry erros” só aparece se houver falhas registradas em Results. “Retomar” só aparece em campanhas
                <span className="font-mono"> em_andamento</span>.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
