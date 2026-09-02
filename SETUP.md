# Setup pendiente

Este proyecto ya tiene el scaffolding completo (web app, cliente The Odds API, motor de
combos, servidor MCP, schema de base de datos). Ver el plan completo en
`.claude/plans` (o pedirle a Claude que lo recupere) para el diseño detallado.

## Producción

El proyecto real de producción es **`betia-web`**, en la cuenta de Vercel de Juani
(`juanis-projects-5ea574f1`) — URL: https://betia-web-brown.vercel.app. Se deploya
solo en cada push a `main` vía `.github/workflows/deploy.yml` (usa `VERCEL_TOKEN`
guardado como secret de GitHub, a nombre de esa cuenta).

Hubo en paralelo un proyecto `agustinvenutolo-3540s-projects/web` (linkeado
localmente en `apps/web/.vercel/`) que se usó para debug pero **ya fue borrado** —
no es el de producción, no confundir si aparece en historial.

Recordatorio importante de Vercel: cambiar una env var en el dashboard **no
actualiza los deployments ya corriendo** — hace falta un redeploy (push a `main`,
o "Redeploy" desde el dashboard) para que tome el valor nuevo.

## Ya hecho

- [x] Repo + monorepo pnpm (`apps/web`, `packages/{odds-api-client,combo-engine,db,mcp-tools}`)
- [x] Proyecto Vercel linkeado (`apps/web/.vercel/project.json`)
- [x] Neon Postgres provisionado y conectado (`DATABASE_URL` en Vercel)
- [x] Schema de base de datos pusheado (`users`, `api_tokens`, `bet_slips`, `bet_slip_legs`,
      `sports_cache`, `odds_cache` — estas dos últimas son el respaldo durable de
      deportes/partidos/cuotas que leen `/odds`, `/odds/[sportId]` y
      `/fixtures/[fixtureId]`; sólo `/api/ingest/poll` las escribe, nunca una página o tool)
- [x] `MCP_INTERNAL_JWT_SECRET` y `CRON_SECRET` generados y guardados en Vercel (dev/preview/prod)
- [x] `next build` compila y tipa sin errores (falta config real de Clerk para que el
      prerender de `/_not-found` no falle — ver abajo)
- [x] `ODDSAPI_API_KEY` cargado en Vercel (dev/preview/prod) y en `apps/web/.env.local`
- [x] `WATCHED_SPORT_KEYS` seteado con un default razonable (16 ligas de fútbol —
      ver `apps/web/lib/ingest/watched-sport-keys.ts` para la lista completa y por qué
      Uruguay/Colombia quedaron afuera)

## Falta (bloqueado en términos de marketplace / claves manuales)

1. **Aceptar términos de Vercel Marketplace** (alguien con acceso a la cuenta de Vercel
   del equipo tiene que hacerlo desde el navegador, la CLI no puede):
   - Upstash: https://vercel.com/agustinvenutolo-3540s-projects/~/integrations/accept-terms/upstash?source=cli
   - Clerk: https://vercel.com/agustinvenutolo-3540s-projects/~/integrations/accept-terms/clerk?source=cli

   Después de aceptar, correr:
   ```bash
   vercel integration add upstash/upstash-kv --scope agustinvenutolo-3540s-projects
   vercel integration add clerk --scope agustinvenutolo-3540s-projects
   vercel env pull apps/web/.env.local --yes --scope agustinvenutolo-3540s-projects
   ```

2. **Clerk — configuración adicional** (después de instalar la integración):
   - En el dashboard de Clerk, crear un webhook apuntando a
     `https://<tu-deploy>/api/webhooks/clerk` (eventos `user.created`, `user.updated`,
     `user.deleted`) y copiar el signing secret a `CLERK_WEBHOOK_SIGNING_SECRET`:
     ```bash
     vercel env add CLERK_WEBHOOK_SIGNING_SECRET production --scope agustinvenutolo-3540s-projects
     ```

3. **Cron de ingesta — corre fuera de Vercel**: la cuenta está en plan Hobby, que solo
   permite crons nativos de Vercel con frecuencia diaria (`vercel.json` no tiene cron
   declarado a propósito). En su lugar, `.github/workflows/poll-odds.yml` pollea
   `POST/GET /api/ingest/poll` cada 30 minutos desde GitHub Actions, sin depender del
   plan de Vercel. Requiere un secret de GitHub `CRON_SECRET` con el mismo valor que
   la env var `CRON_SECRET` del proyecto `betia-web` en Vercel.

4. **AI Gateway**: no necesita configuración manual en Vercel (usa OIDC vía
   `vercel env pull`). Si van a correr el chat del agente fuera de Vercel (CI, local sin
   `vercel dev`), necesitan `AI_GATEWAY_API_KEY` de
   https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fai-gateway%2Fapi-keys.

5. Después de todo lo anterior: `vercel env pull apps/web/.env.local --yes` una vez más
   y correr `pnpm dev` desde la raíz para levantar todo local.

## Notas de diseño a tener presentes

- Arquitectura estricta: **API → DB → cache → web**. Sólo `/api/ingest/poll` (el cron)
  puede llamar a The Odds API en vivo. Ningún tool MCP, página ni el agente de chat
  llaman a la API en vivo — todos leen `odds_cache`/`sports_cache` (Postgres) o Redis.
  Esto reemplazó el diseño anterior (varias tools con fallback en vivo) durante la
  migración de OddsPapi a The Odds API del 2026-09-02, precisamente porque ese patrón
  agotaba la cuota mensual con tráfico normal de usuarios, no sólo con el cron.
- `GET /v4/sports/{sport}/odds` de The Odds API devuelve fixtures y las cuotas de todos
  los bookmakers pedidos en una sola llamada — no hay separación fixtures/odds ni límite
  de un bookmaker por request como tenía OddsPapi. El costo real es 1 crédito por
  *market* pedido por llamada (confirmado en vivo), no por HTTP call ni por bookmaker —
  ver el comment de presupuesto en `.github/workflows/poll-odds.yml` antes de cambiar
  cadencia, ligas o markets.
- El agente de IA (`/agent`) nunca calcula cuotas — todo el cálculo determinístico vive
  en `packages/combo-engine`, el LLM solo llama a la tool `build_combo` y narra el
  resultado.
- El servidor MCP (`apps/web/app/api/mcp/route.ts`) es la única implementación de las
  tools; lo usan tanto clientes MCP externos (Claude Desktop, vía token personal desde
  `/settings/tokens`) como el agente interno (JWT de corta vida).
- The Odds API no tiene un nivel de "torneo" separado del "deporte": cada `sport_key`
  (ej. `soccer_epl`) ya identifica una liga completa. `list_sports`/`list_tournaments`
  mantienen sus nombres de tool por compatibilidad pero ahora significan "grupo"
  (`Soccer`) y "sport_key dentro de ese grupo" respectivamente — ver
  `packages/mcp-tools/src/tools/list-sports.ts` y `list-tournaments.ts`.
- The Odds API tampoco tiene un participant id estable — sólo strings `home_team`/
  `away_team`. `team_id_map` (para el cruce con Highlightly) está keyeada por
  `team_key = "${sportKey}:${slug(teamName)}"`, no por un id numérico — ver
  `packages/mcp-tools/src/team-resolution.ts`.
- Los campos que devuelve la API real (`sport_key`, `commence_time`, ids en snake_case,
  bookmakers/markets como arrays) no coinciden con los nombres que usa el resto de la
  app (camelCase, bookmakers/markets como dict) — la normalización vive toda en
  `packages/odds-api-client/src/index.ts` (`normalizeSport`, `normalizeEvent`,
  `normalizeBookmakerOdds`); el resto del código nunca ve el shape crudo.
