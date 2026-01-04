# Deploy Linux (mínimo)

## Objetivo
Rodar NextIA + Postgres fora do Windows, mantendo o core (DB obrigatório) e o envio via outbox runner.

## Subir stack
1) Copie `.env.example.linux` para `.env` e ajuste `EVOLUTION_*`.
2) Suba:
- `docker compose up --build`

## Envio de mensagens
O painel e o inbound **enfileiram** na outbox.
Para enviar de verdade:
- `npm run outbox:run`

## Checklist
- `NEXTIA_DB_URL` setado
- Webhooks apontando para `/api/webhooks/evolution` (ou direto para `/api/webhooks/whatsapp/inbound`)
- Evolution API acessível pelo container (ou use endpoint externo)
