import Link from "next/link";
import { listSports } from "@bet/mcp-tools";

export const dynamic = "force-dynamic";

export default async function OddsPage() {
  let sports: Awaited<ReturnType<typeof listSports>>["sports"] = [];
  let error: string | null = null;

  try {
    ({ sports } = await listSports({}));
  } catch (e) {
    error = e instanceof Error ? e.message : "No se pudo cargar la lista de deportes";
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Cuotas en vivo</h1>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}. Verificá que <code>ODDSPAPI_API_KEY</code> esté configurada.
        </p>
      )}

      {!error && sports.length === 0 && <p className="text-gray-500">No hay deportes disponibles.</p>}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {sports.map((sport) => (
          <li key={sport.sportId}>
            <Link
              href={`/odds/${sport.sportId}`}
              className="block rounded border border-black/10 px-4 py-3 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              {sport.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
