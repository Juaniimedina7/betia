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
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold">Tokens MCP</h1>
      <p className="mb-6 text-sm text-gray-500">
        Usá un token acá para conectar Claude Desktop u otro cliente MCP a{" "}
        <code>/api/mcp</code> con tu propia sesión (podrá ver y guardar tus apuestas).
      </p>

      <TokenForm createToken={createToken} />

      <ul className="divide-y divide-black/10 dark:divide-white/10">
        {tokens.map((token) => (
          <li key={token.id} className="flex items-center justify-between py-3 text-sm">
            <div>
              <p className="font-medium">{token.label ?? "Sin etiqueta"}</p>
              <p className="text-gray-500">
                Creado {token.createdAt.toLocaleDateString()}
                {token.lastUsedAt ? ` · último uso ${token.lastUsedAt.toLocaleDateString()}` : ""}
              </p>
            </div>
            <form action={revokeToken}>
              <input type="hidden" name="tokenId" value={token.id} />
              <button type="submit" className="text-red-600 hover:underline">
                Revocar
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
