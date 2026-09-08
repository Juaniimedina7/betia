import { auth } from "@clerk/nextjs/server";
import { getUserBetProfile, saveProfileTestResult } from "@bet/db";
import { RESULTS, TEAMS } from "@/lib/profile-test";

/**
 * Perfil actual del usuario, para las pantallas que no pueden leerlo en el
 * servidor. `/agent` es un client component entero (a diferencia del tablero de
 * home, que recibe el perfil como prop desde `app/page.tsx`) y necesita esto
 * para decidir si muestra el CTA del test.
 *
 * Devuelve `betProfile: null` si algo falla, en vez de un 500: el CTA es un
 * extra y no vale la pena romper el chat por él — misma lógica que el
 * `.catch(() => undefined)` de `app/page.tsx`.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return Response.json({ betProfile: await getUserBetProfile(userId) });
  } catch (err) {
    console.error("[profile-test] read_failed", err);
    return Response.json({ betProfile: null });
  }
}

/**
 * Persiste el resultado de `/profileTest` en `users.bet_profile` y `users.team`.
 *
 * El body manda el `resultId` del test (p. ej. "el-cinco") y el `teamId` de la
 * lista de clubes, no los valores de las columnas: el mapeo perfil→enum vive en
 * `lib/profile-test.ts` junto al resto del contenido, y el cliente no debería
 * poder escribir un `bet_profile` ni un club arbitrarios.
 *
 * `teamId: null` (el "Prefiero no decirlo" del test) es válido y borra el club
 * que hubiera de un intento anterior.
 *
 * Del payload que pide el handoff de diseño siguen faltando el puntaje, las
 * respuestas y el historial de intentos: `users` no tiene columnas para eso.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let resultId: unknown;
  let teamId: unknown;
  try {
    ({ resultId, teamId } = await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = RESULTS.find((r) => r.id === resultId);
  if (!result) {
    return Response.json({ error: "unknown_result" }, { status: 400 });
  }

  const team = teamId == null ? null : (TEAMS.find((t) => t.id === teamId)?.id ?? undefined);
  if (team === undefined) {
    return Response.json({ error: "unknown_team" }, { status: 400 });
  }

  try {
    await saveProfileTestResult(userId, { betProfile: result.betProfile, team });
    return Response.json({ betProfile: result.betProfile, team });
  } catch (err) {
    console.error("[profile-test] save_failed", err);
    return Response.json({ error: "save_failed" }, { status: 500 });
  }
}
