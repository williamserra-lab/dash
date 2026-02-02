# Patch — Subir Evolution em container no MESMO compose do Nextia (resolve /api/health 503)

## Objetivo
- Eliminar o 503 HEALTH_EVOLUTION_UNREACHABLE
- Rodar Evolution + Postgres + Redis em containers no servidor 192.168.3.252
- Manter tudo concentrado (um único docker compose) e previsível para a futura VPS Ubuntu

## O que este patch faz
1) Atualiza C:\dev\nextia\docker-compose.yml para incluir:
   - evolution-postgres (postgres:16, sem porta publicada)
   - evolution-redis (redis:7-alpine, sem porta publicada)
   - evolution (evoapicloud/evolution-api:v2.3.7, porta 8080 publicada)
2) Cria C:\dev\nextia\.env.docker com:
   - EVOLUTION_BASE_URL=http://evolution:8080
   - EVOLUTION_API_KEY=...
3) Cria C:\dev\nextia\infra\evolution\.env (env do Evolution)

## IMPORTANTE
- NÃO rode `docker compose down -v` (isso apagaria volumes: evolution_instances, evolution_pgdata etc.)
- Esse patch não mexe no projeto nextiafarma_core.

## Aplicar
1) Substitua / crie os arquivos do patch em C:\dev\nextia
2) Recrie o projeto:
   cd C:\dev\nextia
   docker compose -p nextia up -d --force-recreate

## Validar
- curl -i http://localhost:8080 (Evolution UI/API no host)
- curl -i http://localhost:3000/api/health (esperado 200)
