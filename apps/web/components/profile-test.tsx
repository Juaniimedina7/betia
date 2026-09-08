"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  DIMENSIONS,
  DISCLAIMER,
  QUESTIONS,
  RESULTS,
  TEAMS,
  normalizeTeamQuery,
  scoreAnswers,
  type Answers,
  type OptionId,
  type Team,
} from "@/lib/profile-test";

/** Delay antes del auto-avance: alcanza para ver la opción marcada sin que se sienta lento. */
const AUTO_ADVANCE_MS = 200;

type Stage = "intro" | "q" | "team" | "result";

const OPTION_KEYS: OptionId[] = ["a", "b", "c", "d"];

/**
 * Test de perfil de apostador: intro → 10 preguntas → selector de club → resultado.
 *
 * Todo el estado es local (no hace falta store global); lo único que sale del
 * componente es el `resultId` que se persiste en `users.bet_profile` al llegar
 * al resultado. El club y el puntaje todavía no tienen dónde guardarse.
 */
export function ProfileTest({ initialBetProfile }: { initialBetProfile?: string }) {
  const [stage, setStage] = useState<Stage>("intro");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [team, setTeam] = useState<string | null>(null);
  const [teamQuery, setTeamQuery] = useState("");
  const [saveError, setSaveError] = useState(false);

  const scoring = useMemo(() => scoreAnswers(answers), [answers]);
  const question = QUESTIONS[idx];
  const answer = answers[question.id];
  const isLast = idx >= QUESTIONS.length - 1;

  /**
   * Único camino hacia el resultado: tanto "Ver mi perfil" como "Prefiero no
   * decirlo" pasan por acá, así el perfil y el club se persisten exactamente una
   * vez por intento. Un fallo de red no bloquea la pantalla — se avisa y listo.
   *
   * El club llega por parámetro y no del estado: "Prefiero no decirlo" lo limpia
   * justo antes de llamar acá, y `team` todavía tendría el valor viejo.
   */
  const finish = (teamId: string | null) => {
    setStage("result");
    setSaveError(false);
    fetch("/api/profile-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultId: scoring.result.id, teamId }),
    })
      .then((res) => {
        if (!res.ok) setSaveError(true);
      })
      .catch(() => setSaveError(true));
  };

  const pick = (optionId: OptionId) => {
    setAnswers((prev) => ({ ...prev, [question.id]: optionId }));
    window.setTimeout(() => {
      if (isLast) setStage("team");
      else setIdx((i) => i + 1);
    }, AUTO_ADVANCE_MS);
  };

  const back = () => {
    if (stage === "team") {
      setStage("q");
      return;
    }
    if (idx === 0) setStage("intro");
    else setIdx((i) => i - 1);
  };

  const restart = () => {
    setAnswers({});
    setTeam(null);
    setTeamQuery("");
    setIdx(0);
    setStage("intro");
  };

  return (
    <div className="container-page max-w-3xl pt-10 pb-14">
      {stage === "intro" && <Intro onStart={() => setStage("q")} />}

      {stage === "q" && (
        <QuestionStage
          idx={idx}
          answer={answer}
          onPick={pick}
          onBack={back}
          onNext={() => (isLast ? setStage("team") : setIdx((i) => i + 1))}
        />
      )}

      {stage === "team" && (
        <TeamStage
          team={team}
          query={teamQuery}
          onQueryChange={setTeamQuery}
          onPick={setTeam}
          onBack={back}
          onSkip={() => {
            setTeam(null);
            finish(null);
          }}
          onDone={() => finish(team)}
        />
      )}

      {stage === "result" && (
        <ResultStage
          scoring={scoring}
          team={TEAMS.find((t) => t.id === team) ?? null}
          saveError={saveError}
          onRestart={restart}
        />
      )}

      {initialBetProfile && initialBetProfile !== "unspecified" && stage === "intro" && (
        <p className="mt-8 text-xs text-[var(--color-ink-faint)]">
          Ya hiciste el test antes. Si lo rehacés, el resultado nuevo reemplaza al anterior.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ intro */

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div>
        <p className="eyebrow flex items-center gap-2.5">
          <span className="live-dot" />
          10 preguntas · 2 minutos
        </p>
        <h1
          className="mt-5 font-display font-black"
          style={{
            fontSize: "clamp(2.4rem, 6vw, 4rem)",
            letterSpacing: "-0.045em",
            lineHeight: 0.98,
          }}
        >
          ¿Qué tipo
          <br />
          de apostador
          <br />
          <span style={{ color: "var(--color-edge)" }}>sos?</span>
        </h1>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onStart}
            className="btn btn-primary"
            style={{ padding: "15px 26px", borderRadius: 14, fontSize: "1rem" }}
          >
            Empezar el test
          </button>
          <span className="text-[0.8125rem] text-[var(--color-ink-muted)]">
            Podés rehacerlo cuando quieras desde tu perfil.
          </span>
        </div>
      </div>

      <div>
        <p className="eyebrow">Los cuatro perfiles</p>
        <ul className="mt-4 flex flex-col gap-2.5">
          {RESULTS.map((result) => (
            <li
              key={result.id}
              className="card flex items-center gap-3.5"
              style={{ borderRadius: 16, padding: "14px 16px" }}
            >
              <span
                aria-hidden
                className="h-[34px] w-[34px] shrink-0"
                style={{ borderRadius: 10, background: result.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-extrabold">
                  {result.titulo}
                </span>
                <span className="block truncate text-[0.8125rem] text-[var(--color-ink-muted)]">
                  {result.subtitulo}
                </span>
              </span>
              <span className="tnum shrink-0 text-[0.72rem] text-[var(--color-ink-muted)]">
                {result.rango.min}-{result.rango.max}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-[var(--color-ink-muted)]">
          Test de entretenimiento para conocer tu estilo de juego. No constituye asesoramiento ni
          recomendación de apuestas.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- preguntas */

function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="mt-5 h-1 w-full overflow-hidden rounded-full"
      style={{ background: "rgba(255,255,255,0.07)" }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${value * 100}%`,
          background: "var(--color-edge)",
          transition: "width .45s cubic-bezier(0.16,1,0.3,1)",
        }}
      />
    </div>
  );
}

function QuestionStage({
  idx,
  answer,
  onPick,
  onBack,
  onNext,
}: {
  idx: number;
  answer?: OptionId;
  onPick: (id: OptionId) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const question = QUESTIONS[idx];
  const groupRef = useRef<HTMLDivElement>(null);

  // Roving focus dentro del radiogroup: flechas mueven y eligen, a/b/c/d son atajos.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    const shortcut = OPTION_KEYS.indexOf(key as OptionId);
    if (shortcut !== -1) {
      event.preventDefault();
      onPick(OPTION_KEYS[shortcut]);
      return;
    }

    const delta =
      key === "arrowdown" || key === "arrowright"
        ? 1
        : key === "arrowup" || key === "arrowleft"
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();

    const current = answer ? question.opciones.findIndex((o) => o.id === answer) : -1;
    const next = (current + delta + question.opciones.length) % question.opciones.length;
    const target = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next];
    target?.focus();
    onPick(question.opciones[next].id);
  };

  const progress = (idx + (answer ? 1 : 0)) / QUESTIONS.length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">
          Pregunta {String(idx + 1).padStart(2, "0")} de {QUESTIONS.length}
        </p>
        <span className="chip">{DIMENSIONS[question.dimension]}</span>
      </div>

      <ProgressBar value={progress} />

      <h2
        className="mt-9 font-display font-extrabold"
        style={{
          fontSize: "clamp(1.5rem, 3.4vw, 2.1rem)",
          letterSpacing: "-0.03em",
          maxWidth: "34ch",
        }}
      >
        {question.texto}
      </h2>

      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={question.texto}
        onKeyDown={onKeyDown}
        className="mt-7 flex flex-col gap-2.5"
      >
        {question.opciones.map((option) => {
          const selected = answer === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (!answer && option.id === "a") ? 0 : -1}
              onClick={() => onPick(option.id)}
              className="profile-test-option flex w-full items-start gap-3.5 text-left"
              data-selected={selected ? "true" : undefined}
            >
              <span
                aria-hidden
                className="profile-test-option-key tnum flex h-7 w-7 shrink-0 items-center justify-center text-xs"
              >
                {option.id}
              </span>
              <span className="text-[0.9375rem] leading-[1.55]">{option.texto}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-7 flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="btn btn-ghost !text-[var(--color-ink-muted)]">
          Atrás
        </button>
        {answer && (
          <button type="button" onClick={onNext} className="btn btn-primary">
            Siguiente
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ club picker */

function TeamStage({
  team,
  query,
  onQueryChange,
  onPick,
  onBack,
  onSkip,
  onDone,
}: {
  team: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onPick: (id: string) => void;
  onBack: () => void;
  onSkip: () => void;
  onDone: () => void;
}) {
  const normalized = normalizeTeamQuery(query).trim();
  const filtered = normalized
    ? TEAMS.filter((t) => normalizeTeamQuery(t.name).includes(normalized))
    : TEAMS;
  const picked = TEAMS.find((t) => t.id === team) ?? null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Última · Personalización</p>
        <span className="chip">No puntúa</span>
      </div>

      <ProgressBar value={1} />

      <h2
        className="mt-9 font-display font-extrabold"
        style={{ fontSize: "clamp(1.5rem, 3.4vw, 2.1rem)", letterSpacing: "-0.03em" }}
      >
        ¿De qué equipo sos?
      </h2>
      <p className="mt-3 max-w-[52ch] text-[0.9375rem] leading-relaxed text-[var(--color-ink-muted)]">
        Lo usamos para ordenar tu tablero y avisarte cuando hay valor en sus partidos. Podés no
        contestar.
      </p>

      <div className="card mt-7 w-full max-w-[30rem] overflow-hidden">
        <label className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
          <span className="eyebrow shrink-0">Buscar</span>
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Escribí el nombre del club…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--color-ink-faint)]"
          />
        </label>

        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
            No encontramos ese club. Elegí &ldquo;Otro equipo&rdquo; al final de la lista.
          </p>
        ) : (
          <div
            role="listbox"
            aria-label="Clubes"
            className="profile-test-wheel overflow-y-auto"
            style={{ height: 264 }}
          >
            {filtered.map((club) => (
              <ClubRow
                key={club.id}
                club={club}
                selected={club.id === team}
                onPick={() => onPick(club.id)}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3">
          <span className="tnum text-[0.72rem] text-[var(--color-ink-muted)]">
            {filtered.length} de {TEAMS.length} clubes
          </span>
          <span
            className="truncate text-[0.72rem]"
            style={{ color: picked ? "var(--color-edge)" : "var(--color-ink-muted)" }}
          >
            {picked ? picked.name : "Ninguno elegido"}
          </span>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="btn btn-ghost !text-[var(--color-ink-muted)]">
          Atrás
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            Prefiero no decirlo
          </button>
          <button type="button" onClick={onDone} className="btn btn-primary">
            Ver mi perfil
          </button>
        </div>
      </div>
    </div>
  );
}

function ClubRow({
  club,
  selected,
  onPick,
}: {
  club: Team;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className="profile-test-club flex w-full items-center gap-3 px-4 text-left"
      data-selected={selected ? "true" : undefined}
    >
      <Crest club={club} size={22} />
      <span className="min-w-0 flex-1 truncate text-[0.9375rem]">{club.name}</span>
      {selected && (
        <span aria-hidden style={{ color: "var(--color-edge)" }}>
          ✓
        </span>
      )}
    </button>
  );
}

/**
 * Escudo del club. Los que tienen imagen van sin borde ni fondo — son PNG
 * transparentes recortados, así que el marco del placeholder los ensuciaría.
 * Los que no (Godoy Cruz, San Martín de San Juan y las dos opciones de escape)
 * caen al gradiente de dos colores del prototipo.
 */
function Crest({ club, size }: { club: Team; size: number }) {
  if (club.crest) {
    return (
      // next/image no aporta acá: son PNG estáticos de 96px y ~4 KB que ya se
      // sirven al tamaño final — optimizarlos en runtime sería un round-trip de más.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={club.crest}
        alt=""
        aria-hidden
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="shrink-0 object-contain"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: size > 12 ? 7 : 3,
        background: club.fallback,
        border: "1px solid rgba(255,255,255,0.13)",
      }}
    />
  );
}

/* ---------------------------------------------------------------- result */

function ResultStage({
  scoring,
  team,
  saveError,
  onRestart,
}: {
  scoring: ReturnType<typeof scoreAnswers>;
  team: Team | null;
  saveError: boolean;
  onRestart: () => void;
}) {
  const { result, score, breakdown } = scoring;

  return (
    <div className="reveal in">
      <p className="eyebrow">Tu perfil</p>

      <div className="mt-4 flex flex-col gap-5">
        {/* a) tarjeta de perfil */}
        <section className="card overflow-hidden" style={{ borderRadius: 26, padding: 28 }}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: 0.55,
              background: `radial-gradient(40rem 22rem at 88% -30%, ${result.color}, transparent 70%)`,
            }}
          />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className="chip"
                style={{ background: result.color, color: "#ffffff", borderColor: "transparent" }}
              >
                {result.subtitulo}
              </span>
              {team && (
                <span className="chip">
                  <Crest club={team} size={8} />
                  {team.name}
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <h1
                className="font-display font-black"
                style={{ fontSize: "clamp(2.1rem, 5vw, 3rem)", letterSpacing: "-0.035em" }}
              >
                {result.titulo}
              </h1>
              <div className="text-right">
                <p className="eyebrow">Puntaje</p>
                <p className="mt-1">
                  <span
                    className="font-display font-black"
                    style={{ fontSize: "2.6rem", color: "var(--color-gold)", lineHeight: 1 }}
                  >
                    {score}
                  </span>
                  <span className="tnum ml-1 text-sm text-[var(--color-ink-muted)]">/40</span>
                </p>
              </div>
            </div>

            <p
              className="mt-4 text-base text-[var(--color-ink-muted)]"
              style={{ lineHeight: 1.75, maxWidth: "62ch" }}
            >
              {result.descripcion}
            </p>
          </div>
        </section>

        {/* b) desglose por dimensión */}
        <section className="card" style={{ padding: "20px 22px" }}>
          <p className="eyebrow">Cómo se compone</p>
          <ul className="mt-4 flex flex-col gap-3.5">
            {breakdown.map((row) => (
              <li key={row.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">{row.label}</span>
                  <span className="tnum text-xs" style={{ color: row.color }}>
                    {row.tag}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full"
                  style={{ background: "rgba(255,255,255,0.07)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${row.width}%`,
                      background: row.color,
                      transition: "width .45s cubic-bezier(0.16,1,0.3,1)",
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

      </div>

      {saveError && (
        <p className="mt-6 text-sm" style={{ color: "var(--color-danger)" }}>
          No pudimos guardar tu perfil. El resultado de arriba es válido, pero el agente todavía no
          lo va a tener en cuenta — probá rehacer el test más tarde.
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/" className="btn btn-primary">
          Ir a mi tablero
        </Link>
        <button type="button" onClick={onRestart} className="btn btn-ghost">
          Rehacer el test
        </button>
      </div>

      <p
        className="mt-6 text-xs leading-relaxed text-[var(--color-ink-muted)]"
        style={{ maxWidth: "70ch" }}
      >
        {DISCLAIMER}
      </p>
    </div>
  );
}
