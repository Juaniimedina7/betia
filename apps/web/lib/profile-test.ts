/**
 * Contenido canónico del test de perfil de apostador (`/profileTest`).
 *
 * Los textos son literales del cliente (`test-perfil-apostador.json` del handoff
 * de diseño): preguntas, opciones, puntajes, perfiles, mensaje de juego
 * responsable y disclaimer. **No reescribirlos** — si hay que cambiar el copy,
 * viene del cliente, no de acá.
 */

export const PROFILE_TEST_SCALE = { min: 10, max: 40 } as const;

/** Etiquetas en español de las 8 dimensiones, en el orden del desglose del resultado. */
export const DIMENSIONS = {
  gestion_de_banca: "Gestión de banca",
  tolerancia_a_la_cuota: "Tolerancia a la cuota",
  control_de_impulsos: "Control de impulsos",
  metodo_de_decision: "Método de decisión",
  amplitud_de_mercados: "Amplitud de mercados",
  juego_en_vivo: "Juego en vivo",
  horizonte_temporal: "Horizonte temporal",
  sesgo_emocional: "Sesgo emocional",
} as const;

export type DimensionId = keyof typeof DIMENSIONS;

export type OptionId = "a" | "b" | "c" | "d";

export interface TestOption {
  id: OptionId;
  texto: string;
  puntos: 1 | 2 | 3 | 4;
  /** Sólo en las preguntas con `controlFlag`; alimenta el flag de juego responsable. */
  riesgo?: number;
}

export interface TestQuestion {
  id: number;
  texto: string;
  dimension: DimensionId;
  /** Marca las preguntas que detectan chasing losses / reinversión total (3 y 10). */
  controlFlag: boolean;
  opciones: TestOption[];
}

export const QUESTIONS: TestQuestion[] = [
  {
    id: 1,
    texto: "Arrancás la fecha con $10.000 en la cuenta. ¿Cómo la repartís?",
    dimension: "gestion_de_banca",
    controlFlag: false,
    opciones: [
      { id: "a", texto: "En una sola apuesta chica, el resto queda en el banco de suplentes", puntos: 1 },
      { id: "b", texto: "4 o 5 apuestas parejas, como un equipo bien distribuido en la cancha", puntos: 2 },
      { id: "c", texto: "Un par de apuestas fuertes y algunas chicas de relleno", puntos: 3 },
      { id: "d", texto: "Todo a una jugada. El que no arriesga no gana finales", puntos: 4 },
    ],
  },
  {
    id: 2,
    texto: "River juega contra el último de la tabla. La cuota es 1.15. ¿Qué hacés?",
    dimension: "tolerancia_a_la_cuota",
    controlFlag: false,
    opciones: [
      { id: "a", texto: "Es lo más parecido a un partido ganado. Voy con confianza", puntos: 1 },
      { id: "b", texto: "La juego, pero combinada con otro favorito para que rinda algo", puntos: 2 },
      { id: "c", texto: "Paso. A esa cuota no me mueve la aguja", puntos: 3 },
      { id: "d", texto: "Voy al contragolpe: apuesto al batacazo del último", puntos: 4 },
    ],
  },
  {
    id: 3,
    texto: "Perdiste las últimas tres apuestas del fin de semana. Es domingo a la noche.",
    dimension: "control_de_impulsos",
    controlFlag: true,
    opciones: [
      { id: "a", texto: "Cierro la app. La fecha terminó", puntos: 1, riesgo: 0 },
      { id: "b", texto: "Sigo con mi plan de siempre, sin cambiar nada", puntos: 2, riesgo: 0 },
      { id: "c", texto: "Bajo el monto pero busco un partido más para cerrar mejor", puntos: 3, riesgo: 1 },
      { id: "d", texto: "Doblo la apuesta. Hay que ir a buscarlo con todo", puntos: 4, riesgo: 2 },
    ],
  },
  {
    id: 4,
    texto: "¿Cómo elegís a qué apostar?",
    dimension: "metodo_de_decision",
    controlFlag: false,
    opciones: [
      { id: "a", texto: "Estadísticas, historial, lesiones. Estudio el partido como un DT", puntos: 1 },
      { id: "b", texto: "Miro datos pero también cómo viene el equipo anímicamente", puntos: 2 },
      { id: "c", texto: "Bastante intuición, algo de información", puntos: 3 },
      { id: "d", texto: "Corazonada pura. Se me da por dónde va la cosa", puntos: 4 },
    ],
  },
  {
    id: 5,
    texto: "Combinada de 6 patas que paga 40 veces, o simple que paga 1.80.",
    dimension: "tolerancia_a_la_cuota",
    controlFlag: false,
    opciones: [
      { id: "a", texto: "Simple, siempre. Prefiero el 1-0 sufrido", puntos: 1 },
      { id: "b", texto: "Simple, y de vez en cuando una combinada de 2", puntos: 2 },
      { id: "c", texto: "Combinada de 3 o 4 patas, es mi zona cómoda", puntos: 3 },
      { id: "d", texto: "Las 6 patas. Un solo gol me cambia el mes", puntos: 4 },
    ],
  },
  {
    id: 6,
    texto: "Además del fútbol, ¿qué tocás?",
    dimension: "amplitud_de_mercados",
    controlFlag: false,
    opciones: [
      { id: "a", texto: "Solo Liga Profesional y las cinco grandes de Europa", puntos: 1 },
      { id: "b", texto: "Fútbol y algo de NBA, ligas que conozco", puntos: 2 },
      { id: "c", texto: "Me meto en básquet, tenis, lo que haya en cartelera", puntos: 3 },
      { id: "d", texto: "Segunda de Corea, vóley, e-sports. Si hay cuota, hay partido", puntos: 4 },
    ],
  },
  {
    id: 7,
    texto: "Apuestas en vivo: van 0-0 a los 30 del segundo tiempo y el local va a buscarlo.",
    dimension: "juego_en_vivo",
    controlFlag: false,
    opciones: [
      { id: "a", texto: "No juego en vivo, me pone nervioso", puntos: 1 },
      { id: "b", texto: "Miro un rato antes de entrar, si es que entro", puntos: 2 },
      { id: "c", texto: "Entro rápido cuando veo que el partido se abre", puntos: 3 },
      { id: "d", texto: "Ya entré tres veces y voy por la cuarta", puntos: 4 },
    ],
  },
  {
    id: 8,
    texto: "Te ofrecen apostar al campeón de la liga en agosto, con la temporada por delante.",
    dimension: "horizonte_temporal",
    controlFlag: false,
    opciones: [
      { id: "a", texto: "Muy largo. Prefiero saber el resultado el mismo día", puntos: 1 },
      { id: "b", texto: "Un monto chico, como para tener el partido enganchado", puntos: 2 },
      { id: "c", texto: "Me gusta. Encontrar valor temprano es donde está la diferencia", puntos: 3 },
      { id: "d", texto: "Voy fuerte a un tapado de cuota alta", puntos: 4 },
    ],
  },
  {
    id: 9,
    texto: "Juega tu equipo y está para perder según todos los números.",
    dimension: "sesgo_emocional",
    controlFlag: false,
    opciones: [
      { id: "a", texto: "No apuesto cuando juega mi equipo, mezclo las cosas", puntos: 1 },
      { id: "b", texto: "Apuesto en contra si los números lo dicen, sin dramas", puntos: 2 },
      { id: "c", texto: "Le apuesto a favor igual, pero con poco", puntos: 3 },
      { id: "d", texto: "Le apuesto a favor y fuerte. Se banca hasta las últimas", puntos: 4 },
    ],
  },
  {
    id: 10,
    texto: "Pegaste una combinada y triplicaste tu saldo.",
    dimension: "control_de_impulsos",
    controlFlag: true,
    opciones: [
      { id: "a", texto: "Retiro todo. Fue una linda tarde", puntos: 1, riesgo: 0 },
      { id: "b", texto: "Retiro la mayoría y dejo algo para seguir jugando", puntos: 2, riesgo: 0 },
      { id: "c", texto: "Dejo casi todo en la cuenta, viene la próxima fecha", puntos: 3, riesgo: 1 },
      { id: "d", texto: "Reinvierto todo y voy por una más grande", puntos: 4, riesgo: 2 },
    ],
  },
];

/** Valores que acepta `users.bet_profile` (ver packages/db/src/schema.ts). */
export type BetProfile = "risky" | "balanced" | "moderate" | "conservative" | "unspecified";

export interface TestResult {
  id: string;
  titulo: string;
  subtitulo: string;
  rango: { min: number; max: number };
  descripcion: string;
  color: string;
  /**
   * Perfil que se persiste en `users.bet_profile`. La columna tiene cuatro
   * valores útiles y el test cuatro perfiles, así que el mapeo es 1:1 por nivel
   * de riesgo creciente: conservative → moderate → balanced → risky.
   */
  betProfile: Exclude<BetProfile, "unspecified">;
}

export const RESULTS: TestResult[] = [
  {
    id: "catenaccio",
    titulo: "El Catenaccio",
    subtitulo: "Perfil conservador",
    rango: { min: 10, max: 17 },
    descripcion:
      "Jugás cerrado, con la línea de cuatro bien parada. Priorizás cuidar el saldo por encima de ganar rápido, apostás poco y a favoritos, y no te tienta la combinada. Te sirve más apuntar a constancia que a un golpe grande.",
    color: "#1B4D3E",
    betProfile: "conservative",
  },
  {
    id: "el-cinco",
    titulo: "El Cinco",
    subtitulo: "Perfil moderado",
    rango: { min: 18, max: 25 },
    descripcion:
      "Equilibrado, como un volante central que recupera y distribuye. Mezclás apuestas seguras con alguna arriesgada, tenés un plan y en general lo respetás. Es el perfil más sostenible en el tiempo.",
    color: "#2E6F95",
    betProfile: "moderate",
  },
  {
    id: "el-enganche",
    titulo: "El Enganche",
    subtitulo: "Perfil arriesgado",
    rango: { min: 26, max: 33 },
    descripcion:
      "Buscás el pase entre líneas. Te movés en cuotas medias y altas, te gustan las combinadas y las apuestas en vivo, y confiás en tu lectura del partido. Rendís mucho cuando estás fino, pero necesitás disciplina con los montos.",
    color: "#C9902B",
    betProfile: "balanced",
  },
  {
    id: "killer-del-area",
    titulo: "El Killer del Área",
    subtitulo: "Perfil muy arriesgado",
    rango: { min: 34, max: 40 },
    descripcion:
      "Todo o nada, definís de primera. Vas a cuotas altas, combinadas largas y apostás fuerte cuando te la jugás. Es el perfil de mayor volatilidad: los premios son grandes y las rachas negativas también.",
    color: "#A63232",
    betProfile: "risky",
  },
];

export const DISCLAIMER =
  "Este test es contenido de entretenimiento y no constituye asesoramiento financiero ni recomendación de apuestas. Las apuestas implican riesgo de pérdida de dinero. Prohibida la participación a menores de 18 años. Jugá responsablemente.";

/** Niveles del desglose por dimensión, indexados por promedio de puntos redondeado (1-4). */
export const LEVELS = [
  { tag: "Bajo", color: "var(--color-live)" },
  { tag: "Moderado", color: "var(--color-edge)" },
  { tag: "Alto", color: "var(--color-gold)" },
  { tag: "Muy alto", color: "#ff6b5e" },
] as const;

/**
 * Gradiente diagonal con los dos colores del club, para los que todavía no
 * tienen escudo real. Es el mismo placeholder que traía el prototipo de diseño.
 */
function gradient(a: string, b: string): string {
  return `linear-gradient(135deg, ${a} 0 48%, ${b} 48% 100%)`;
}

export interface Team {
  id: string;
  name: string;
  /**
   * Escudo real en `public/crests/<id>.png` (96×96, transparente). Hoy sólo las
   * dos opciones de escape ("Otro club argentino" / "Un club del exterior") no
   * tienen uno y caen al `fallback`.
   */
  crest?: string;
  /** Gradiente que se dibuja cuando no hay `crest`. */
  fallback: string;
}

/**
 * 30 clubes + dos escapes. Arrancó siendo la Liga Profesional del handoff de
 * diseño, pero se ajustó a los escudos que tenemos: Godoy Cruz y San Martín de
 * San Juan salieron (no vino su escudo) y entraron Estudiantes de Río Cuarto y
 * Gimnasia y Esgrima de Mendoza, que sí lo tenían — o sea que la lista ya no es
 * exactamente la Primera División. En producción conviene traerla del backend.
 */
export const TEAMS: Team[] = [
  { id: "aldosivi", name: "Aldosivi", crest: "/crests/aldosivi.png", fallback: gradient("#f2c53d", "#1b7a3f") },
  { id: "argentinos", name: "Argentinos Juniors", crest: "/crests/argentinos.png", fallback: gradient("#d8232a", "#ffffff") },
  { id: "atleticotucuman", name: "Atlético Tucumán", crest: "/crests/atleticotucuman.png", fallback: gradient("#1b4b9c", "#ffffff") },
  { id: "banfield", name: "Banfield", crest: "/crests/banfield.png", fallback: gradient("#1b7a3f", "#ffffff") },
  { id: "barracas", name: "Barracas Central", crest: "/crests/barracas.png", fallback: gradient("#ffffff", "#d8232a") },
  { id: "belgrano", name: "Belgrano", crest: "/crests/belgrano.png", fallback: gradient("#6fb0e6", "#ffffff") },
  { id: "boca", name: "Boca Juniors", crest: "/crests/boca.png", fallback: gradient("#0a4a9c", "#f2c53d") },
  { id: "centralcordoba", name: "Central Córdoba", crest: "/crests/centralcordoba.png", fallback: gradient("#111111", "#ffffff") },
  { id: "defensa", name: "Defensa y Justicia", crest: "/crests/defensa.png", fallback: gradient("#f2c53d", "#1b7a3f") },
  { id: "riestra", name: "Deportivo Riestra", crest: "/crests/riestra.png", fallback: gradient("#111111", "#f2c53d") },
  { id: "estudiantes", name: "Estudiantes", crest: "/crests/estudiantes.png", fallback: gradient("#d8232a", "#ffffff") },
  { id: "estudiantesrc", name: "Estudiantes de Río Cuarto", crest: "/crests/estudiantesrc.png", fallback: gradient("#d8232a", "#ffffff") },
  { id: "gimnasia", name: "Gimnasia La Plata", crest: "/crests/gimnasia.png", fallback: gradient("#1b4b9c", "#ffffff") },
  { id: "gimnasiamendoza", name: "Gimnasia y Esgrima de Mendoza", crest: "/crests/gimnasiamendoza.png", fallback: gradient("#1b4b9c", "#ffffff") },
  { id: "huracan", name: "Huracán", crest: "/crests/huracan.png", fallback: gradient("#ffffff", "#d8232a") },
  { id: "independiente", name: "Independiente", crest: "/crests/independiente.png", fallback: gradient("#d8232a", "#7d1418") },
  { id: "indeprivadavia", name: "Independiente Rivadavia", crest: "/crests/indeprivadavia.png", fallback: gradient("#1b4b9c", "#d8232a") },
  { id: "instituto", name: "Instituto", crest: "/crests/instituto.png", fallback: gradient("#d8232a", "#ffffff") },
  { id: "lanus", name: "Lanús", crest: "/crests/lanus.png", fallback: gradient("#7d1418", "#ffffff") },
  { id: "newells", name: "Newell's Old Boys", crest: "/crests/newells.png", fallback: gradient("#d8232a", "#111111") },
  { id: "platense", name: "Platense", crest: "/crests/platense.png", fallback: gradient("#8a4b2a", "#ffffff") },
  { id: "racing", name: "Racing Club", crest: "/crests/racing.png", fallback: gradient("#6fb0e6", "#ffffff") },
  { id: "river", name: "River Plate", crest: "/crests/river.png", fallback: gradient("#ffffff", "#d8232a") },
  { id: "central", name: "Rosario Central", crest: "/crests/central.png", fallback: gradient("#f2c53d", "#1b4b9c") },
  { id: "sanlorenzo", name: "San Lorenzo", crest: "/crests/sanlorenzo.png", fallback: gradient("#1b4b9c", "#d8232a") },
  { id: "sarmiento", name: "Sarmiento", crest: "/crests/sarmiento.png", fallback: gradient("#1b7a3f", "#ffffff") },
  { id: "talleres", name: "Talleres", crest: "/crests/talleres.png", fallback: gradient("#1b4b9c", "#ffffff") },
  { id: "tigre", name: "Tigre", crest: "/crests/tigre.png", fallback: gradient("#1b4b9c", "#d8232a") },
  { id: "union", name: "Unión", crest: "/crests/union.png", fallback: gradient("#d8232a", "#ffffff") },
  { id: "velez", name: "Vélez Sarsfield", crest: "/crests/velez.png", fallback: gradient("#ffffff", "#1b4b9c") },
  { id: "otroarg", name: "Otro club argentino", fallback: "rgba(255,255,255,0.13)" },
  { id: "extranjero", name: "Un club del exterior", fallback: "rgba(61,216,255,0.35)" },
];

/** Normaliza para el buscador de clubes: minúsculas y sin diacríticos. */
export function normalizeTeamQuery(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export type Answers = Record<number, OptionId>;

export interface DimensionBreakdown {
  id: DimensionId;
  label: string;
  tag: string;
  color: string;
  /** 0-100, para el ancho de la barra. */
  width: number;
}

export interface Scoring {
  /** Suma de puntos de las opciones elegidas (10-40 con el test completo). */
  score: number;
  /**
   * Suma del campo `riesgo` de las preguntas con `controlFlag` (3 y 10). Nada la
   * muestra: el bloque de juego responsable que la usaba se sacó del resultado.
   * Queda calculada porque es el único dato del test que detecta chasing losses
   * y reinversión total — si alguna vez se guarda el intento, va esto.
   */
  riesgo: number;
  result: TestResult;
  breakdown: DimensionBreakdown[];
}

/**
 * Puntaje, perfil y desglose por dimensión. Tolera respuestas incompletas — una
 * dimensión sin responder queda en "Sin dato" con la barra en 0 en lugar de romper.
 */
export function scoreAnswers(answers: Answers): Scoring {
  let score = 0;
  let riesgo = 0;
  const byDimension = new Map<DimensionId, number[]>();

  for (const question of QUESTIONS) {
    const option = question.opciones.find((o) => o.id === answers[question.id]);
    if (!option) continue;
    score += option.puntos;
    riesgo += option.riesgo ?? 0;
    const bucket = byDimension.get(question.dimension) ?? [];
    bucket.push(option.puntos);
    byDimension.set(question.dimension, bucket);
  }

  const breakdown = (Object.keys(DIMENSIONS) as DimensionId[]).map<DimensionBreakdown>((id) => {
    const values = byDimension.get(id) ?? [];
    if (values.length === 0) {
      return { id, label: DIMENSIONS[id], tag: "Sin dato", color: "var(--color-ink-faint)", width: 0 };
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const level = LEVELS[Math.min(3, Math.max(0, Math.round(avg) - 1))];
    return { id, label: DIMENSIONS[id], tag: level.tag, color: level.color, width: (avg / 4) * 100 };
  });

  const result = RESULTS.find((r) => score >= r.rango.min && score <= r.rango.max) ?? RESULTS[0];

  return { score, riesgo, result, breakdown };
}
