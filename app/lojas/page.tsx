"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type StoreSettings = {
  id: string;
  store: string;
  settings: {
    ml_tag?: string;
  };
};

export default function LojasPage() {
  const supabase = createClient();

  const [userId, setUserId] = useState("");
  const [settingId, setSettingId] = useState("");
  const [mlTag, setMlTag] = useState("");
  const [message, setMessage] = useState("Carregando...");

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();

      if (!userData.user) {
        window.location.href = "/login";
        return;
      }

      setUserId(userData.user.id);

      const { data } = await supabase
        .from("store_settings")
        .select("id, store, settings")
        .eq("user_id", userData.user.id)
        .eq("store", "mercado_livre")
        .maybeSingle<StoreSettings>();

      if (data) {
        setSettingId(data.id);
        setMlTag(data.settings?.ml_tag || "");
        setMessage("Configuração carregada.");
      } else {
        setMessage("Configure sua tag do Mercado Livre.");
      }
    }

    load();
  }, [supabase]);

  async function save() {
    if (!userId) return;

    const cleanTag = mlTag.trim();

    if (!cleanTag) {
      setMessage("Informe sua tag do Mercado Livre.");
      return;
    }

    if (settingId) {
      const { error } = await supabase
        .from("store_settings")
        .update({
          settings: {
            ml_tag: cleanTag,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", settingId);

      if (error) {
        setMessage(`Erro ao salvar: ${error.message}`);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("store_settings")
        .insert({
          user_id: userId,
          store: "mercado_livre",
          settings: {
            ml_tag: cleanTag,
          },
        })
        .select("id")
        .single();

      if (error) {
        setMessage(`Erro ao salvar: ${error.message}`);
        return;
      }

      setSettingId(data.id);
    }

    setMessage("Tag do Mercado Livre salva.");
  }

  return (
    <main className="min-h-screen p-8">
      <section className="mx-auto max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-3xl font-bold">Lojas</h1>
        <p className="mt-2 text-slate-300">
          Configure os dados usados para gerar links de afiliado.
        </p>

        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-6">
          <h2 className="text-xl font-bold">Mercado Livre</h2>
          <p className="mt-2 text-sm text-slate-400">
            Informe sua tag. O sistema vai aplicar essa tag nos links do Mercado Livre.
          </p>

          <label className="mt-6 block text-sm font-medium text-slate-200">
            Tag de afiliado
          </label>

          <input
            value={mlTag}
            onChange={(event) => setMlTag(event.target.value)}
            placeholder="Ex: amle9273033"
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
          />

          <button
            onClick={save}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500"
          >
            Salvar Mercado Livre
          </button>
        </div>

        <p className="mt-5 text-sm text-slate-300">{message}</p>
      </section>
    </main>
  );
}