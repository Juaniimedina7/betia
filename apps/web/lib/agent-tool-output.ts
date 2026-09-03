/** A tool UIMessage part, loosely typed across every AI SDK v7 tool state. */
export interface ToolPart {
  type: string;
  /** Present on `dynamic-tool` parts (MCP tools) — the real tool name. */
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  result?: unknown;
  errorText?: string;
}

/**
 * Recognizes both static (`tool-<name>`) and dynamic (`dynamic-tool`) parts. MCP
 * tools — which is all of ours, loaded at runtime via createMCPClient — surface as
 * `dynamic-tool` in AI SDK v7, so a `type.startsWith("tool-")` check alone misses
 * every one of them (and no result card ever renders).
 */
export function isToolPart(part: unknown): part is ToolPart {
  if (!part || typeof part !== "object") return false;
  const type = (part as { type?: unknown }).type;
  return typeof type === "string" && (type === "dynamic-tool" || type.startsWith("tool-"));
}

export function toolNameOf(part: ToolPart): string {
  return part.type === "dynamic-tool" ? (part.toolName ?? "") : part.type.replace("tool-", "");
}

/**
 * Best-effort unwrap of a tool part's output into a plain JS value. Tool output can
 * arrive as a raw object, an MCP `{ content: [{ text }] }` envelope, or a JSON string —
 * this collapses all three into one shape. Returns null on anything unexpected instead
 * of throwing, so every agent-cards/* extractor (and extractCombo) shares one safe
 * unwrap instead of each re-implementing it.
 */
export function getToolOutput(part: unknown): unknown | null {
  try {
    const p = part as { output?: unknown; result?: unknown };
    let data: unknown = p.output ?? p.result;
    if (data && typeof data === "object" && "content" in data) {
      const content = (data as { content?: Array<{ text?: string }> }).content;
      const text = content?.[0]?.text;
      if (text) data = JSON.parse(text);
    }
    if (typeof data === "string") data = JSON.parse(data);
    return data ?? null;
  } catch {
    return null;
  }
}
