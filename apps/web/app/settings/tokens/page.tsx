import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { apiTokens, getDb } from "@bet/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { TokenForm } from "./token-form";

async function createToken(formData: FormData) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const label = (formData.get("label") as string) || undefined;
  const raw = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");

  const db = getDb();
  await db.insert(apiTokens).values({ userId, label, tokenHash });

  revalidatePath("/settings/tokens");
  return raw;
}

async function revokeToken(formData: FormData) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const tokenId = formData.get("tokenId") as string;
  const db = getDb();
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)));

  revalidatePath("/settings/tokens");
}

export default async function TokensPage() {
  const { userId } = await auth();
  const db = getDb();
  const tokens = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId!), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));

  return (
    <div className="container-page max-w-2xl py-14">
      <span className="eyebrow">Conexión MCP</span>
      <h1
        className="mt-3 font-display font-extrabold leading-tight"
        style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.4rem)", letterSpacing: "-0.03em" }}
      >
        Tokens MCP
      </h1>
      <p className="mb-8 mt-3 text-sm text-[var(--color-ink-muted)]">
        Conectá Claude Desktop u otro cliente MCP a <code className="tnum">/api/mcp</code> con tu
        propia sesión — podrá ver y guardar tus apuestas.
      </p>

      <TokenForm createToken={createToken} />

      {tokens.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">Todavía no creaste ningún token.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {tokens.map((token) => (
            <div key={token.id} className="card flex items-center justify-between px-5 py-3.5 text-sm">
              <div>
                <p className="font-medium">{token.label ?? "Sin etiqueta"}</p>
                <p className="text-xs text-[var(--color-ink-muted)] tnum">
                  Creado {token.createdAt.toLocaleDateString("es-AR")}
                  {token.lastUsedAt ? ` · último uso ${token.lastUsedAt.toLocaleDateString("es-AR")}` : ""}
                </p>
              </div>
              <form action={revokeToken}>
                <input type="hidden" name="tokenId" value={token.id} />
                <button type="submit" className="text-sm text-[var(--color-danger)] hover:underline">
                  Revocar
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
