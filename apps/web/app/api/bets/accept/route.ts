import { auth } from "@clerk/nextjs/server";
import { saveBetSlip, saveBetSlipInput } from "@bet/mcp-tools";

/**
 * One-click "Aceptar apuesta" from the chat's ComboTicket — calls saveBetSlip directly
 * (same function the agent's save_bet_slip MCP tool uses) instead of round-tripping
 * through the LLM/internal MCP client, since there's nothing for the model to decide
 * here: the user already picked exactly this combo.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = saveBetSlipInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await saveBetSlip(parsed.data, { userId });
    return Response.json(result);
  } catch {
    return Response.json({ error: "save_failed" }, { status: 500 });
  }
}
