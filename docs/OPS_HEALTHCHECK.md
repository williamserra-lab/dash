# Ops — Healthcheck / Integridade (NextIA)

## Objetivo
Detectar cedo (e de forma repetível) falhas comuns em produção:
- **DB não configurado** ou indisponível (NEXTIA_DB_URL)
- **Migrations/tabelas** não aplicadas (ex.: timeline/outbox/messages)
- **Evolution** indisponível ou com env faltando (EVOLUTION_*)

> Convenção do NextIA: todo endpoint operacional deve retornar `traceId` e erros com `errorCode`. (mesmo padrão usado no follow-up)

---

## Endpoints

### 1) Health público (para orquestrador / monitoração simples)
`GET /api/health`

- Retorna **200** somente se:
  - DB está habilitado (`NEXTIA_DB_URL`) e responde um `select 1`
  - Se `EVOLUTION_BASE_URL` estiver configurado, a base URL é alcançável (reachability)
- Retorna **503** se algo essencial falhar.
- Sempre devolve JSON com `traceId`.

Exemplo:
```bash
curl -s http://SEU_HOST:3000/api/health | jq
```

### 2) Health administrativo (diagnóstico)
`GET /api/admin/health` (exige admin)

O que verifica:
- DB liveness (`select 1`) + presença de tabelas mínimas: `nextia_timeline_events`, `nextia_outbox`, `nextia_messages`
- Contagem de itens `queued` na outbox
- Evolution:
  - se `NEXTIA_HEALTHCHECK_REMOTE_JID` estiver setado, faz um `findMessages` (valida reachability + auth)
  - se não estiver setado, apenas avisa que o check é “básico”

Exemplo:
```bash
curl -s http://SEU_HOST:3000/api/admin/health -H "x-nextia-admin-key: SEU_ADMIN_KEY" | jq
```

---

## Variáveis opcionais (produção)
- `NEXTIA_HEALTH_EVOLUTION_TIMEOUT_MS` (default 2000)
- `NEXTIA_HEALTHCHECK_REMOTE_JID` (ex.: `5511999990000@s.whatsapp.net`)

---

## Docker Compose
O `docker-compose.yml` foi atualizado para:
- `postgres` com `healthcheck` usando `pg_isready`
- `nextia` com `healthcheck` chamando `/api/health` via `node -e fetch(...)`
- `nextia` só sobe depois que `postgres` estiver saudável
