"use client";

import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { Button, Field, Input } from "./ui";

function Frame({ title, sub, children, onSubmit }: { title: string; sub: string; children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <form className="w-full max-w-sm space-y-4" onSubmit={onSubmit}>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-1 text-muted">{sub}</p>
        </div>
        {children}
      </form>
    </div>
  );
}

/** Runs a form action, showing a spinner and any error. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
    setBusy(false);
  };
  return { busy, error, submit };
}

/** Email + password. Each account sees only its own data (Row Level Security). */
export function LoginScreen({ notice: linkNotice }: { notice?: string }) {
  const { repo } = useStore();
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, submit } = useSubmit();
  const switchTo = (m: typeof mode) => {
    setMode(m);
    setNotice(null);
  };

  const action = submit(async () => {
    if (mode === "in") await repo.signIn(email, password);
    else if (mode === "reset") {
      await repo.requestPasswordReset(email);
      // Supabase does not reveal whether an account exists, and neither do we.
      setNotice("If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.");
    } else if ((await repo.signUp(email, password)) === "check-email") setNotice("Check your inbox to confirm your email, then sign in.");
  });

  return (
    <Frame
      title={mode === "reset" ? "Reset your password" : "Home Base (Olympus)"}
      sub={mode === "reset" ? "We'll email you a link to set a new one." : "Tasks, calendar and attendance in one place."}
      onSubmit={action}
    >
      {linkNotice && !notice && <p className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">{linkNotice}</p>}
      <Field label="Email">
        <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {mode !== "reset" && (
        <Field label="Password" hint={mode === "up" ? "At least 6 characters." : undefined}>
          <Input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {notice && <p className="rounded-xl bg-ok-bg px-3 py-2 text-sm text-ok">{notice}</p>}
      <Button type="submit" className="w-full py-3" disabled={busy}>
        {busy && <LoaderCircle size={16} className="animate-spin" />}
        {mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}
      </Button>
      <div className="flex flex-col items-center gap-2 text-sm font-semibold text-muted">
        {mode === "in" && (
          <button type="button" className="underline" onClick={() => switchTo("reset")}>
            Forgot password?
          </button>
        )}
        <button type="button" className="underline" onClick={() => switchTo(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "New here? Create an account" : "Back to sign in"}
        </button>
      </div>
    </Frame>
  );
}

/** Shown after opening a password-reset link: the person is signed in but must pick a new password. */
export function SetPasswordScreen({ email }: { email: string }) {
  const { repo } = useStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, submit } = useSubmit();
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <Frame title="Set a new password" sub={`For ${email}`} onSubmit={submit(() => repo.updatePassword(password))}>
      <Field label="New password" hint="At least 6 characters.">
        <Input type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Repeat new password">
        <Input type="password" required minLength={6} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {mismatch && <p className="text-sm text-danger">The passwords don&apos;t match.</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-full py-3" disabled={busy || mismatch || !confirm}>
        {busy && <LoaderCircle size={16} className="animate-spin" />}
        Save password
      </Button>
      <button type="button" className="w-full text-sm font-semibold text-muted underline" onClick={() => void repo.signOut()}>
        Cancel and sign out
      </button>
    </Frame>
  );
}
