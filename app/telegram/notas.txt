"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type TelegramBot = {
  id: string;
  bot_token: string;
  bot_username: string | null;
};

export default function TelegramPage() {
  const supabase = createClient();

  const [userId, setUserId] = useState("");
  const [bot, setBot] = useState<TelegramBot | null>(null);
  const [botToken, setBotToken] = useState("");
  const [status, setStatus] = useState("Carregando...");

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();

      if (!userData.user) {
        window.location.href = "/login";
        return;
      }

      setUserId(userData.user.id);

      const { data } = await supabase
        .from("telegram_bots")
        .select("id, bot_token, bot_username")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (data) {
        setBot(data);
        setBotToken(data.bot_token);
        setStatus("Bot configurado.");
      } else {
        setStatus("Nenhum bot configurado.");
      }
    }

    load();
  }, [supabase]);

  async function testBot(token: string) {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.description || "Token inválido.");
    }

    return result.result.username as string;
  }

  async function saveBot() {
    try {
      setStatus("Testando token no Telegram...");

      const username = await testBot(botToken.trim());

      if (bot) {
        const { error } = await supabase
          .from("telegram_bots")
          .update({
            bot_token: botToken.trim(),
            bot_username: username,
            updated_at: new Date().toISOString(),
          })
          .eq("id", bot.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("telegram_bots")
          .insert({
            user_id: userId,
            bot_token: botToken.trim(),
            bot_username: username,
          })
          .select("id, bot_token, bot_username")
          .single();

        if (error) throw error;
        setBot(data);
      }

      setStatus(`Bot salvo: @${username}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido.";
      setStatus(`Erro: ${message}`);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-8">
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-3xl font-bold">Telegram</h1>
        <p className="mt-2 text-slate-300">
          Configure o token do bot que será usado para postar nos canais.
        </p>

        <label className="mt-8 block text-sm font-medium text-slate-200">
          Token do bot
        </label>

        <input
          value={botToken}
          onChange={(event) => setBotToken(event.target.value)}
          placeholder="Cole aqui o token do BotFather"
          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
        />

        <button
          onClick={saveBot}
          className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500"
        >
          Salvar e testar bot
        </button>

        <p className="mt-5 text-sm text-slate-300">{status}</p>
      </section>
    </main>
  );
}