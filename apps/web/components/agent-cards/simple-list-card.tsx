interface SimpleItem {
  id: string;
  name: string;
}

/** A plain name+id picker list — shared by list_sports and list_tournaments, whose
 * outputs are both just "here are your options" catalogs with nothing else to show. */
export function SimpleListCard({ title, items }: { title: string; items: SimpleItem[] }) {
  if (items.length === 0) {
    return (
      <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        No encontré nada para mostrar en {title.toLowerCase()}.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <span className="eyebrow">{title}</span>
        <span className="chip tnum">{items.length}</span>
      </div>
      <ul className="flex flex-wrap gap-2 px-5 py-4">
        {items.map((item) => (
          <li key={item.id} className="chip">
            {item.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
