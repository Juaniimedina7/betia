# Setup pendiente

Este proyecto ya tiene el scaffolding completo (web app, cliente OddsPapi, motor de
combos, servidor MCP, schema de base de datos) y está desplegado en Vercel como
`agustinvenutolo-3540s-projects/web`. Ver el plan completo en
`.claude/plans` (o pedirle a Claude que lo recupere) para el diseño detallado.

## Ya hecho

- [x] Repo + monorepo pnpm (`apps/web`, `packages/{oddspapi-client,combo-engine,db,mcp-tools}`)
- [x] Proyecto Vercel linkeado (`apps/web/.vercel/project.json`)
- [x] Neon Postgres provisionado y conectado (`DATABASE_URL` en Vercel)
- [x] Schema de base de datos pusheado (`users`, `api_tokens`, `bet_slips`, `bet_slip_legs`)
- [x] `MCP_INTERNAL_JWT_SECRET` y `CRON_SECRET` generados y guardados en Vercel (dev/preview/prod)
- [x] `next build` compila y tipa sin errores (falta config real de Clerk para que el
      prerender de `/_not-found` no falle — ver abajo)
- [x] `ODDSPAPI_API_KEY` cargado en Vercel (dev/preview/prod) y en `apps/web/.env.local`
- [x] `WATCHED_TOURNAMENT_IDS` seteado con un default razonable (Champions/Europa League,
      las 5 grandes ligas europeas, Copa Libertadores y Liga Profesional Argentina —
      ver `apps/web/.env.example` para la lista completa de ids y cómo ajustarla)

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

3. **Plan de Vercel (Hobby vs Pro)**: la cuenta está en el plan Hobby, que solo permite
   crons con frecuencia diaria. `vercel.json` quedó con `0 0 * * *` (una vez por día)
   para poder deployar; el diseño original pensaba en pollear cada 1-2 minutos. Para
   eso hace falta pasar el proyecto a Pro y volver a poner algo como `*/2 * * * *`.

4. **AI Gateway**: no necesita configuración manual en Vercel (usa OIDC vía
   `vercel env pull`). Si van a correr el chat del agente fuera de Vercel (CI, local sin
   `vercel dev`), necesitan `AI_GATEWAY_API_KEY` de
   https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fai-gateway%2Fapi-keys.

5. Después de todo lo anterior: `vercel env pull apps/web/.env.local --yes` una vez más
   y correr `pnpm dev` desde la raíz para levantar todo local.

## Notas de diseño a tener presentes

- El WebSocket de OddsPapi requiere plan B2B — por eso la ingesta hoy es polling REST
  vía cron. Ver `packages/oddspapi-client/src/ingestion/` (interfaz intercambiable).
- El agente de IA (`/agent`) nunca calcula cuotas — todo el cálculo determinístico vive
  en `packages/combo-engine`, el LLM solo llama a la tool `build_combo` y narra el
  resultado.
- El servidor MCP (`apps/web/app/api/mcp/route.ts`) es la única implementación de las
  tools; lo usan tanto clientes MCP externos (Claude Desktop, vía token personal desde
  `/settings/tokens`) como el agente interno (JWT de corta vida).
- `GET /v4/odds-by-tournaments` de OddsPapi exige exactamente un `bookmaker` por request
  (rechaza con 400 si falta). El cron de ingesta, `build_combo` y la tool MCP
  `get_odds_by_tournament` usan `pinnacle` como default (configurable vía
  `ODDSPAPI_BOOKMAKER` para el cron); ver `GET /v4/bookmakers` para otros slugs.
