import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { getUserBetProfile } from "@bet/db";
import { ProfileTest } from "@/components/profile-test";

export const metadata: Metadata = {
  title: "¿Qué tipo de apostador sos? — BETIA",
  description:
    "Test de entretenimiento para conocer tu estilo de juego. No constituye asesoramiento ni recomendación de apuestas.",
};

// El resultado se guarda contra el usuario logueado, así que la ruta no puede ser estática.
export const dynamic = "force-dynamic";

export default async function ProfileTestPage() {
  let userId: string | null = null;
  try {
    ({ userId } = await auth());
  } catch {
    userId = null;
  }

  if (!userId) {
    return (
      <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-14 text-center">
        <h1 className="font-display text-2xl font-extrabold">Iniciá sesión para hacer el test</h1>
        <p className="mt-2 max-w-sm text-sm text-[var(--color-ink-muted)]">
          Guardamos tu perfil de apostador en tu cuenta para que el agente arme las combinadas a tu
          estilo.
        </p>
        <Link href="/" className="btn btn-primary mt-6">
          Volver al inicio
        </Link>
      </div>
    );
  }

  // Si Postgres no responde el test igual se puede hacer — sólo se pierde el aviso
  // de que ya lo había hecho antes.
  const betProfile = await getUserBetProfile(userId).catch(() => undefined);

  return <ProfileTest initialBetProfile={betProfile} />;
}
