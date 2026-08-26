import { createHash } from "node:crypto";
import { apiTokens, getDb } from "@bet/db";
import { and, eq, isNull } from "drizzle-orm";
import { verifyInternalMcpToken } from "./internal-token";

/**
 * Dual verifyToken for withMcpAuth: accepts either the short-lived internal
 * JWT minted by the webapp's own agent, or a long-lived hashed personal
 * access token minted via /settings/tokens for external MCP clients. Public,
 * read-only tools work with no token at all (required: false at the handler
 * level); this only resolves a userId for the user-scoped tools to check.
 */
export async function verifyMcpToken(
  _req: Request,
  bearerToken?: string,
): Promise<{ token: string; clientId: string; scopes: string[]; extra?: Record<string, unknown> } | undefined> {
  if (!bearerToken) return undefined;

  const internal = await verifyInternalMcpToken(bearerToken);
  if (internal) {
    return {
      token: bearerToken,
      clientId: "internal-agent",
      scopes: ["user"],
      extra: { userId: internal.userId },
    };
  }

  const tokenHash = createHash("sha256").update(bearerToken).digest("hex");
  const db = getDb();
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)))
    .limit(1);

  if (!row) return undefined;

  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));

  return {
    token: bearerToken,
    clientId: row.id,
    scopes: ["user"],
    extra: { userId: row.userId },
  };
}
