import Link from "next/link";
import { getOdds } from "@bet/mcp-tools";
import { LiveOddsTable } from "@/components/live-odds-table";

export const dynamic = "force-dynamic";

export default async function FixturePage({ params }: PageProps<"/fixtures/[fixtureId]">) {
  const { fixtureId } = await params;

  let bookmakerOdds: Awaited<ReturnType<typeof getOdds>>["bookmakerOdds"] = {};
  let error: string | null = null;

  try {
    ({ bookmakerOdds } = await getOdds({ fixtureId }));
  } catch (e) {
    error = e instanceof Error ? e.message : "No se pudieron cargar las cuotas";
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/odds" className="text-sm text-gray-500 hover:underline">
        &larr; Deportes
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold">Partido {fixtureId}</h1>

      {error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <LiveOddsTable fixtureId={fixtureId} initialOdds={bookmakerOdds} />
      )}
    </div>
  );
}
