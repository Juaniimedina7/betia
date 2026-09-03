import type { ReactNode } from "react";

/**
 * Minimal, dependency-free renderer for the agent's text: turns GFM pipe tables
 * into a styled component, plus basic paragraphs, lists and inline **bold** /
 * *italic* / `code`. React escapes all text nodes, so this never injects raw HTML.
 * Anything it doesn't recognize falls through as plain text.
 */
export function AgentMarkdown({ text }: { text: string }) {
  return <div className="space-y-2 text-sm leading-relaxed">{renderBlocks(text)}</div>;
}

const isTableSeparator = (line: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
const splitRow = (line: string) =>
  line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());

function renderBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`}>
        {paragraph.map((ln, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {renderInline(ln)}
          </span>
        ))}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items;
    const key = `l-${blocks.length}`;
    blocks.push(
      list.ordered ? (
        <ol key={key} className="ml-5 list-decimal space-y-1">
          {items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="ml-5 list-disc space-y-1">
          {items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ul>
      ),
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Table: header row with pipes followed by a separator row.
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      flushParagraph();
      flushList();
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2; // skip header + separator
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      i--; // step back; the for-loop will advance
      blocks.push(<MarkdownTable key={`t-${blocks.length}`} header={header} rows={rows} />);
      continue;
    }

    const listMatch = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      const ordered = listMatch[1] !== undefined;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(listMatch[2]!);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function MarkdownTable({ header, rows }: { header: string[]; rows: string[][] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">
            {header.map((h, i) => (
              <th key={i} className="px-4 py-2.5 font-medium">
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-[var(--line)]">
              {row.map((cell, c) => (
                <td key={c} className={`px-4 py-2 ${c === 0 ? "font-medium" : "text-[var(--color-ink-muted)] tnum"}`}>
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Inline **bold**, *italic*, `code`. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] !== undefined)
      nodes.push(
        <code key={key++} className="tnum rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">
          {m[3]}
        </code>,
      );
    else if (m[4] !== undefined) nodes.push(<em key={key++}>{m[4]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
