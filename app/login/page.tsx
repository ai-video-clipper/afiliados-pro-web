"use client";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  async function loginWithGoogle() {
    const supabase = createClient();

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-3xl font-bold">Afiliados Pro</h1>
        <p className="mt-3 text-slate-300">
          Entre com sua conta Google para acessar o painel.
        </p>

        <button
          onClick={loginWithGoogle}
          className="mt-8 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold hover:bg-blue-500"
        >
          Entrar com Google
        </button>
      </section>
    </main>
  );
}