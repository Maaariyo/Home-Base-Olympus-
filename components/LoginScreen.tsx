"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Field, Input } from "./ui";

/** Email + password. Each account sees only its own data (Row Level Security). */
export function LoginScreen() {
  const { repo } = useStore();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            if (mode === "in") await repo.signIn(email, password);
            else if ((await repo.signUp(email, password)) === "check-email") setNotice("Check your inbox to confirm your email, then sign in.");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
          }
          setBusy(false);
        }}
      >
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Campus Planner</h1>
          <p className="mt-1 text-muted">Tasks, calendar and attendance in one place.</p>
        </div>
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
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
        {error && <p className="text-sm text-danger">{error}</p>}
        {notice && <p className="rounded-xl bg-ok-bg px-3 py-2 text-sm text-ok">{notice}</p>}
        <Button type="submit" className="w-full py-3" disabled={busy}>
          {busy && <LoaderCircle size={16} className="animate-spin" />}
          {mode === "in" ? "Sign in" : "Create account"}
        </Button>
        <button type="button" className="w-full text-sm font-semibold text-muted underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
