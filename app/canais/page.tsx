"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type TelegramBot = {
  bot_token: string;
  bot_username: string | null;
};

type TelegramChannel = {
  id: string;
  name: string;
  chat_id: string;
  is_active: boolean;
};

export default function CanaisPage() {
  const supabase = createClient();

  const [userId, setUserId] = useState("");
  const [bot, setBot] = useState<TelegramBot | null>(null);
  const [channels, setChannels] = useState<TelegramChannel[]>([]);
  const [name, setName] = useState("");
  const [chatId, setChatId] = useState("");
  const [message, setMessage] = useState("Carregando...");

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();

      if (!userData.user) {
        window.location.href = "/login";
        return;
      }

      setUserId(userData.user.id);

      const { data: botData } = await supabase
        .from("telegram_bots")
        .select("bot_token, bot_username")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      setBot(botData);

      const { data: channelData } = await supabase
        .from("telegram_channels")
        .select("id, name, chat_id, is_active")
        .eq("user_id", userData.user.id)
        .order("created_at", { ascending: false });

      setChannels(channelData || []);
      setMessage("Pronto.");
    }

    load();
  }, [supabase]);

  async function addChannel() {
    if (!userId) return;

    const cleanChatId = chatId.trim();

    if (!name.trim() || !cleanChatId) {
      setMessage("Preencha o nome e o @ do canal.");
      return;
    }

    const { data, error } = await supabase
      .from("telegram_channels")
      .insert({
        user_id: userId,
        name: name.trim(),
        chat_id: cleanChatId,
      })
      .select("id, name, chat_id, is_active")
      .single();

    if (error) {
      setMessage(`Erro ao salvar canal: ${error.message}`);
      return;
    }

    setChannels([data, ...channels]);
    setName("");
    setChatId("");
    setMessage("Canal salvo.");
  }

  async function sendTest(channel: TelegramChannel) {
    if (!bot?.bot_token) {
      setMessage("Configure o bot primeiro na aba Telegram.");
      return;
    }

    setMessage(`Enviando teste para ${channel.chat_id}...`);

    const response = await fetch(
      `https://api.telegram.org/bot${bot.bot_token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: channel.chat_id,
          text: "Teste do Afiliados Pro: canal conectado com sucesso.",
        }),
      }
    );

    const result = await response.json();

    if (!result.ok) {
      setMessage(`Erro Telegram: ${result.description}`);
      return;
    }

    setMessage(`Teste enviado para ${channel.name}.`);
  }

  async function deleteChannel(channel: TelegramChannel) {
    const { error } = await supabase
      .from("telegram_channels")
      .delete()
      .eq("id", channel.id);

    if (error) {
      setMessage(`Erro ao excluir: ${error.message}`);
      return;
    }

    setChannels(channels.filter((item) => item.id !== channel.id));
    setMessage("Canal excluído.");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-8">
      <section className="mx-auto max-w-5xl rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-3xl font-bold">Canais Telegram</h1>
        <p className="mt-2 text-slate-300">
          Cadastre canais ou grupos onde o bot vai postar.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome da lista. Ex: Ofertas Geral"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
          />

          <input
            value={chatId}
            onChange={(event) => setChatId(event.target.value)}
            placeholder="@canal ou chat_id"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
          />

          <button
            onClick={addChannel}
            className="rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500"
          >
            Adicionar
          </button>
        </div>

        <p className="mt-5 text-sm text-slate-300">{message}</p>

        <div className="mt-8 space-y-3">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <p className="font-semibold">{channel.name}</p>
                <p className="text-sm text-slate-400">{channel.chat_id}</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => sendTest(channel)}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold hover:bg-green-500"
                >
                  Testar envio
                </button>

                <button
                  onClick={() => deleteChannel(channel)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500"
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}

          {channels.length === 0 && (
            <p className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-400">
              Nenhum canal cadastrado ainda.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}