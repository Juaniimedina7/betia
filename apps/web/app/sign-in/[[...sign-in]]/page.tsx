import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="container-page flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-8 py-16">
      <div className="text-center">
        <span className="font-display text-2xl font-extrabold tracking-tight">
          BET<span style={{ color: "var(--color-edge)" }}>IA</span>
        </span>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Entrá para armar y guardar tus combinadas.</p>
      </div>
      <SignIn />
    </div>
  );
}
