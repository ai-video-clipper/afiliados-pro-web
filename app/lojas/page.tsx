"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type StoreSettings = {
  store: string;
  settings: Record<string, string> | null;
};

const initialMercadoLivre = {
  ml_tag: "",
  ml_cookie: "",
  ml_user_agent: "",
};

const initialShopee = {
  shopee_partner_id: "",
  shopee_secret_key: "",
  shopee_affiliate_id: "",
  shopee_sub_id: "",
  shopee_cookie: "",
  shopee_user_agent: "",
};

const initialAliExpress = {
  aliexpress_app_key: "",
  aliexpress_app_secret: "",
  aliexpress_tracking_id: "",
  aliexpress_adzone_id: "",
};

export default function LojasPage() {
  const supabase = useMemo(() => createClient(), []);

  const [userId, setUserId] = useState("");
  const [mercadoLivre, setMercadoLivre] = useState(initialMercadoLivre);
  const [shopee, setShopee] = useState(initialShopee);
  const [aliexpress, setAliExpress] = useState(initialAliExpress);
  const [message, setMessage] = useState("Carregando...");
  const [saving, setSaving] = useState(false);

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
        .select("store, settings")
        .eq("user_id", userData.user.id)
        .in("store", ["mercado_livre", "shopee", "aliexpress"]);

      const rows = (data || []) as StoreSettings[];

      const ml = rows.find((row) => row.store === "mercado_livre")?.settings || {};
      const sp = rows.find((row) => row.store === "shopee")?.settings || {};
      const ali = rows.find((row) => row.store === "aliexpress")?.settings || {};

      setMercadoLivre({ ...initialMercadoLivre, ...ml });
      setShopee({ ...initialShopee, ...sp });
      setAliExpress({ ...initialAliExpress, ...ali });
      setMessage("Pronto.");
    }

    load();
  }, [supabase]);

  async function saveStore(store: string, settings: Record<string, string>) {
    if (!userId) return;

    const cleanSettings = Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [key, value.trim()])
    );

    const { error } = await supabase.from("store_settings").upsert(
      {
        user_id: userId,
        store,
        settings: cleanSettings,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,store",
      }
    );

    if (error) throw error;
  }

  async function saveAll() {
    try {
      setSaving(true);
      setMessage("Salvando configurações das lojas...");

      await saveStore("mercado_livre", mercadoLivre);
      await saveStore("shopee", shopee);
      await saveStore("aliexpress", aliexpress);

      setMessage("Configurações salvas.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Erro desconhecido.";
      setMessage(`Erro ao salvar: ${text}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen p-8">
      <section className="mx-auto max-w-5xl rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-3xl font-bold">Lojas</h1>
        <p className="mt-2 text-slate-300">
          Configure as credenciais usadas para gerar links, completar imagens e atualizar preços.
        </p>

        <div className="mt-8 grid gap-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
            <h2 className="text-xl font-bold">Mercado Livre</h2>
            <p className="mt-2 text-sm text-slate-400">
              A tag é usada para gerar o link final. Cookie e User-Agent são opcionais para capturar preço real da sessão quando o ML bloquear visitante comum.
            </p>

            <div className="mt-5 grid gap-4">
              <input
                value={mercadoLivre.ml_tag}
                onChange={(event) => setMercadoLivre({ ...mercadoLivre, ml_tag: event.target.value })}
                placeholder="Tag Mercado Livre. Ex: amle9273033"
                className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
              />

              <textarea
                value={mercadoLivre.ml_cookie}
                onChange={(event) => setMercadoLivre({ ...mercadoLivre, ml_cookie: event.target.value })}
                placeholder="Cookie Mercado Livre opcional"
                rows={4}
                className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
              />

              <input
                value={mercadoLivre.ml_user_agent}
                onChange={(event) => setMercadoLivre({ ...mercadoLivre, ml_user_agent: event.target.value })}
                placeholder="User-Agent opcional"
                className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
            <h2 className="text-xl font-bold">Shopee</h2>
            <p className="mt-2 text-sm text-slate-400">
              Guarde as keys da Shopee para a próxima etapa de API oficial. Cookie/User-Agent ajudam na captura da página quando a planilha não traz imagem.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <input value={shopee.shopee_partner_id} onChange={(event) => setShopee({ ...shopee, shopee_partner_id: event.target.value })} placeholder="Partner ID" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
              <input value={shopee.shopee_secret_key} onChange={(event) => setShopee({ ...shopee, shopee_secret_key: event.target.value })} placeholder="Secret Key" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
              <input value={shopee.shopee_affiliate_id} onChange={(event) => setShopee({ ...shopee, shopee_affiliate_id: event.target.value })} placeholder="Affiliate ID" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
              <input value={shopee.shopee_sub_id} onChange={(event) => setShopee({ ...shopee, shopee_sub_id: event.target.value })} placeholder="Sub ID opcional" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
              <textarea value={shopee.shopee_cookie} onChange={(event) => setShopee({ ...shopee, shopee_cookie: event.target.value })} placeholder="Cookie Shopee opcional" rows={4} className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500 md:col-span-2" />
              <input value={shopee.shopee_user_agent} onChange={(event) => setShopee({ ...shopee, shopee_user_agent: event.target.value })} placeholder="User-Agent opcional" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500 md:col-span-2" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
            <h2 className="text-xl font-bold">AliExpress</h2>
            <p className="mt-2 text-sm text-slate-400">
              Credenciais do programa de afiliados para links e atualização de preço/imagem.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <input value={aliexpress.aliexpress_app_key} onChange={(event) => setAliExpress({ ...aliexpress, aliexpress_app_key: event.target.value })} placeholder="App Key" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
              <input value={aliexpress.aliexpress_app_secret} onChange={(event) => setAliExpress({ ...aliexpress, aliexpress_app_secret: event.target.value })} placeholder="App Secret" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
              <input value={aliexpress.aliexpress_tracking_id} onChange={(event) => setAliExpress({ ...aliexpress, aliexpress_tracking_id: event.target.value })} placeholder="Tracking ID" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
              <input value={aliexpress.aliexpress_adzone_id} onChange={(event) => setAliExpress({ ...aliexpress, aliexpress_adzone_id: event.target.value })} placeholder="Adzone ID opcional" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
            </div>
          </div>
        </div>

        <button onClick={saveAll} disabled={saving} className="mt-6 rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? "Salvando..." : "Salvar configurações"}
        </button>

        <p className="mt-5 text-sm text-slate-300">{message}</p>
      </section>
    </main>
  );
}
