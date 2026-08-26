import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const EXPIRES_IN = "5m";

function getSecret(): Uint8Array {
  const secret = process.env.MCP_INTERNAL_JWT_SECRET;
  if (!secret) throw new Error("MCP_INTERNAL_JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

/** Minted by the internal agent chat route, presented as a bearer token to /api/mcp. */
export async function mintInternalMcpToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(getSecret());
}

export async function verifyInternalMcpToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] });
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
