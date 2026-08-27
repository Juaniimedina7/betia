import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="container-page flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-8 py-16">
      <div className="text-center">
        <span className="font-display text-2xl font-extrabold tracking-tight">
          BET<span style={{ color: "var(--color-edge)" }}>IA</span>
        </span>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Creá tu cuenta y pedile una combinada al agente.</p>
      </div>
      <SignUp />
    </div>
  );
}
