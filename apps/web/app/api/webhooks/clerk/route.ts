import { getDb, users } from "@bet/db";
import { eq } from "drizzle-orm";
import { Webhook } from "svix";

interface ClerkUserEvent {
  type: string;
  data: {
    id: string;
    email_addresses?: Array<{ id: string; email_address: string }>;
    primary_email_address_id?: string;
    first_name?: string | null;
    last_name?: string | null;
  };
}

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return new Response("CLERK_WEBHOOK_SIGNING_SECRET not set", { status: 500 });
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const body = await req.text();

  let event: ClerkUserEvent;
  try {
    event = new Webhook(secret).verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkUserEvent;
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "user.created" || event.type === "user.updated") {
    const { id, email_addresses, primary_email_address_id, first_name, last_name } = event.data;
    const email =
      email_addresses?.find((e) => e.id === primary_email_address_id)?.email_address ??
      email_addresses?.[0]?.email_address ??
      "";
    const displayName = [first_name, last_name].filter(Boolean).join(" ") || undefined;

    const db = getDb();
    await db
      .insert(users)
      .values({ id, email, displayName })
      .onConflictDoUpdate({ target: users.id, set: { email, displayName, updatedAt: new Date() } });
  }

  if (event.type === "user.deleted") {
    const db = getDb();
    await db.delete(users).where(eq(users.id, event.data.id));
  }

  return new Response("ok", { status: 200 });
}
