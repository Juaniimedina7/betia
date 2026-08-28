"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { RankedTournament } from "@/lib/popular-leagues";

export function CompetitionBrowser({
  sportId,
  tournaments,
  regionLabel,
}: {
  sportId: string;
  tournaments: RankedTournament[];
  regionLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("all");

  const countries = useMemo(
    () => [...new Set(tournaments.map((t) => t.country))].sort((a, b) => a.localeCompare(b)),
    [tournaments],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tournaments.filter(
      (t) =>
        (country === "all" || t.country === country) &&
        (q === "" || t.name.toLowerCase().includes(q)),
    );
  }, [tournaments, query, country]);

  const popular = useMemo(
    () =>
      filtered
        .filter((t) => t.popularRank !== null)
        .sort((a, b) => (a.popularRank! - b.popularRank!) || a.name.localeCompare(b.name))
        .slice(0, 12),
    [filtered],
  );

  const byCountry = useMemo(() => {
    const map = new Map<string, RankedTournament[]>();
    for (const t of [...filtered].sort((a, b) => a.name.localeCompare(b.name))) {
      const list = map.get(t.country);
      if (list) list.push(t);
      else map.set(t.country, [t]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className="mt-8">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar competición (ej. Libertadores, Premier)…"
          className="flex-1 rounded-xl border border-[var(--line-strong)] bg-transparent px-4 py-2.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-edge)] focus:outline-none"
        />
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="rounded-xl border border-[var(--line-strong)] bg-transparent px-4 py-2.5 text-sm outline-none focus:border-[var(--color-edge)] sm:w-56"
        >
          <option value="all" className="bg-[var(--color-pitch-850)]">Todos los países</option>
          {countries.map((c) => (
            <option key={c} value={c} className="bg-[var(--color-pitch-850)]">
              {c}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 && (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">
          No encontramos competiciones con esos filtros.
        </p>
      )}

      {/* Popular in region */}
      {popular.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[var(--color-edge)]">★</span>
            <h2 className="font-display text-lg font-bold">Populares en {regionLabel}</h2>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {popular.map((t) => (
              <CompCard key={t.tournamentId} sportId={sportId} t={t} featured />
            ))}
          </div>
        </section>
      )}

      {/* All by country */}
      {byCountry.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-display text-lg font-bold">Todas las competiciones</h2>
          <div className="flex flex-col gap-6">
            {byCountry.map(([countryLabel, comps]) => (
              <div key={countryLabel}>
                <p className="eyebrow mb-2">{countryLabel}</p>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {comps.map((t) => (
                    <CompCard key={t.tournamentId} sportId={sportId} t={t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CompCard({
  sportId,
  t,
  featured,
}: {
  sportId: string;
  t: RankedTournament;
  featured?: boolean;
}) {
  return (
    <Link
      href={`/odds/${sportId}?comp=${encodeURIComponent(t.tournamentId)}`}
      className="card card-hover group flex items-center justify-between gap-3 px-4 py-3"
      style={featured ? { borderColor: "rgba(184,255,53,0.25)" } : undefined}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{t.name}</p>
        <p className="truncate text-xs text-[var(--color-ink-faint)]">{t.country}</p>
      </div>
      <span
        aria-hidden
        className="shrink-0 text-[var(--color-ink-faint)] transition-all group-hover:translate-x-1 group-hover:text-[var(--color-edge)]"
      >
        →
      </span>
    </Link>
  );
}
