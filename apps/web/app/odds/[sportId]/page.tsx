import Link from "next/link";
import { listFixtures } from "@bet/mcp-tools";

export const dynamic = "force-dynamic";

export default async function SportOddsPage({ params }: PageProps<"/odds/[sportId]">) {
  const { sportId } = await params;
  let fixtures: Awaited<ReturnType<typeof listFixtures>>["fixtures"] = [];
  let error: string | null = null;

  try {
    ({ fixtures } = await listFixtures({ sportId }));
  } catch (e) {
    error = e instanceof Error ? e.message : "No se pudieron cargar los partidos";
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/odds" className="text-sm text-gray-500 hover:underline">
        &larr; Deportes
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold">Partidos — {sportId}</h1>

      {error && <p className="text-red-600">{error}</p>}
      {!error && fixtures.length === 0 && <p className="text-gray-500">No hay partidos próximos.</p>}

      <ul className="divide-y divide-black/10 dark:divide-white/10">
        {fixtures.map((fixture) => (
          <li key={fixture.fixtureId} className="py-3">
            <Link href={`/fixtures/${fixture.fixtureId}`} className="flex items-center justify-between hover:underline">
              <span>
                {fixture.participant1Name ?? fixture.participant1Id} vs{" "}
                {fixture.participant2Name ?? fixture.participant2Id}
              </span>
              <span className="text-sm text-gray-500">{new Date(fixture.startTime).toLocaleString()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
