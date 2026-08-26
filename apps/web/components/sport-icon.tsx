/** Minimal line icons keyed off the sport name. Falls back to a target glyph. */
export function SportIcon({ name, className = "" }: { name: string; className?: string }) {
  const key = name.toLowerCase();
  const common = {
    className,
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (/soccer|foot|fútbol|futbol|calcio/.test(key) && !/american/.test(key)) {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5l3.2 2.3-1.2 3.7h-4L8.8 9.8 12 7.5z" />
        <path d="M12 3v2.2M4.5 9l2 1.4M19.5 9l-2 1.4M7.5 20l1.3-2.4M16.5 20l-1.3-2.4" />
      </svg>
    );
  }
  if (/basket|nba|básquet|basquet/.test(key)) {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3v18M5.6 5.6c3 2.4 3 10.4 0 12.8M18.4 5.6c-3 2.4-3 10.4 0 12.8" />
      </svg>
    );
  }
  if (/tennis|tenis/.test(key)) {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M5.5 5.5c4 3 4 10 0 13M18.5 5.5c-4 3-4 10 0 13" />
      </svg>
    );
  }
  if (/baseball|béisbol|beisbol/.test(key)) {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M7 4.5c1.8 2 1.8 13 0 15M17 4.5c-1.8 2-1.8 13 0 15" />
      </svg>
    );
  }
  if (/hockey/.test(key)) {
    return (
      <svg {...common} aria-hidden>
        <path d="M5 4v9a4 4 0 0 0 8 0" />
        <path d="M13 13l5 6" />
        <ellipse cx="8" cy="20" rx="3" ry="1.3" />
      </svg>
    );
  }
  if (/american|nfl|rugby/.test(key)) {
    return (
      <svg {...common} aria-hidden>
        <ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-40 12 12)" />
        <path d="M9.5 14.5l5-5M10.5 12l1.5 1.5M12 10.5l1.5 1.5" />
      </svg>
    );
  }
  if (/volley|vóley|voley/.test(key)) {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3c-3 3-4.5 12-3 18M12 3c3 3 8 6 9 8M3.2 13c4-1 12-1 17.6 3" />
      </svg>
    );
  }
  // Default: a target — the "value" motif
  return (
    <svg {...common} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}
