"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type TelegramBot = {
  bot_token: string;
};

type TelegramChannel = {
  id: string;
  name: string;
  chat_id: string;
};

type Product = {
  id: string;
  title: string;
  price: string | null;
  old_price: string | null;
  offer_link: string;
  image_url: string | null;
  status: string;
  channel_id: string | null;
  store: string | null;
  original_link: string | null;
  final_link: string | null;
  short_code: string | null;
};

type StoreSettings = {
  settings: {
    ml_tag?: string;
  };
};

function generateShortCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) return "";

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function applyMercadoLivreTag(rawUrl: string, tag: string) {
  const cleanUrl = normalizeUrl(rawUrl);

  try {
    const url = new URL(cleanUrl);

    url.hash = "";

    const allowedParams = new Set(["p", "variation", "quantity"]);
    const cleanedUrl = new URL(`${url.origin}${url.pathname}`);

    for (const [key, value] of url.searchParams.entries()) {
      if (allowedParams.has(key)) {
        cleanedUrl.searchParams.set(key, value);
      }
    }

    cleanedUrl.searchParams.set("tag", tag);

    return cleanedUrl.toString();
  } catch {
    const urlWithoutHash = cleanUrl.split("#")[0];
    const urlWithoutQuery = urlWithoutHash.split("?")[0];

    return `${urlWithoutQuery}?tag=${encodeURIComponent(tag)}`;
  }
}

export default function ProdutosPage() {
  const supabase = useMemo(() => createClient(), []);

  const [userId, setUserId] = useState("");
  const [bot, setBot] = useState<TelegramBot | null>(null);
  const [channels, setChannels] = useState<TelegramChannel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [mlTag, setMlTag] = useState("");

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [oldPrice, setOldPrice] = useState("");
  const [offerLink, setOfferLink] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [channelId, setChannelId] = useState("");
  const [store, setStore] = useState("manual");

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
        .select("bot_token")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      setBot(botData);

      const { data: channelData } = await supabase
        .from("telegram_channels")
        .select("id, name, chat_id")
        .eq("user_id", userData.user.id)
        .order("created_at", { ascending: false });

      const loadedChannels = channelData || [];
      setChannels(loadedChannels);

      if (loadedChannels.length > 0) {
        setChannelId(loadedChannels[0].id);
      }

      const { data: settingsData } = await supabase
        .from("store_settings")
        .select("settings")
        .eq("user_id", userData.user.id)
        .eq("store", "mercado_livre")
        .maybeSingle<StoreSettings>();

      setMlTag(settingsData?.settings?.ml_tag || "");

      const { data: productData } = await supabase
        .from("products")
        .select(
          "id, title, price, old_price, offer_link, image_url, status, channel_id, store, original_link, final_link, short_code"
        )
        .eq("user_id", userData.user.id)
        .order("created_at", { ascending: false });

      setProducts(productData || []);
      setMessage("Pronto.");
    }

    load();
  }, [supabase]);

  function selectedChannel(productChannelId?: string | null) {
    const id = productChannelId || channelId;
    return channels.find((channel) => channel.id === id) || null;
  }

  function formatPost(product: Product) {
    const lines = [`🚨 ${product.title} 🚨`, ""];

    if (product.old_price) {
      lines.push(`🔥 De: ${product.old_price}`);
    }

    if (product.price) {
      lines.push(`✅ Por apenas: ${product.price}`);
    }

    lines.push("");
    lines.push("👉 GARANTA O SEU AQUI:");
    lines.push(product.offer_link);
    lines.push("");
    lines.push("⚠️ Confira o preço final antes de concluir a compra.");

    return lines.join("\n");
  }

  async function createShortLink(destinationUrl: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateShortCode();

      const { data, error } = await supabase
        .from("short_links")
        .insert({
          user_id: userId,
          code,
          destination_url: destinationUrl,
        })
        .select("id, code")
        .single();

      if (!error && data) {
        return data;
      }
    }

    throw new Error("Não foi possível gerar o link curto. Tente novamente.");
  }

  async function addProduct() {
    if (!userId) return;

    if (!title.trim() || !offerLink.trim()) {
      setMessage("Preencha pelo menos o nome do produto e o link da oferta.");
      return;
    }

    if (!channelId) {
      setMessage("Cadastre ou selecione um canal antes de salvar.");
      return;
    }

    try {
      setMessage("Salvando produto...");

      let finalOfferLink = normalizeUrl(offerLink);
      const originalLink: string | null = normalizeUrl(offerLink);
      let finalLink: string | null = normalizeUrl(offerLink);
      let shortCode: string | null = null;
      let shortLinkId: string | null = null;

      if (store === "mercado_livre") {
        if (!mlTag.trim()) {
          setMessage("Configure sua tag do Mercado Livre na aba Lojas.");
          return;
        }

        finalLink = applyMercadoLivreTag(offerLink, mlTag.trim());

        const shortLink = await createShortLink(finalLink);

        shortCode = shortLink.code;
        shortLinkId = shortLink.id;
        finalOfferLink = `${window.location.origin}/m/${shortLink.code}`;
      }

      const { data, error } = await supabase
        .from("products")
        .insert({
          user_id: userId,
          channel_id: channelId || null,
          title: title.trim(),
          price: price.trim() || null,
          old_price: oldPrice.trim() || null,
          offer_link: finalOfferLink,
          image_url: imageUrl.trim() || null,
          store,
          original_link: originalLink,
          final_link: finalLink,
          short_code: shortCode,
        })
        .select(
          "id, title, price, old_price, offer_link, image_url, status, channel_id, store, original_link, final_link, short_code"
        )
        .single();

      if (error) {
        if (shortLinkId) {
          await supabase.from("short_links").delete().eq("id", shortLinkId);
        }

        setMessage(`Erro ao salvar produto: ${error.message}`);
        return;
      }

      if (shortLinkId) {
        await supabase
          .from("short_links")
          .update({
            product_id: data.id,
          })
          .eq("id", shortLinkId);
      }

      setProducts([data, ...products]);
      setTitle("");
      setPrice("");
      setOldPrice("");
      setOfferLink("");
      setImageUrl("");
      setStore("manual");

      if (shortCode) {
        setMessage(`Produto salvo com link curto: /m/${shortCode}`);
      } else {
        setMessage("Produto salvo.");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Erro desconhecido.";

      setMessage(`Erro: ${errorMessage}`);
    }
  }

  async function sendProduct(product: Product) {
    if (!bot?.bot_token) {
      setMessage("Configure o bot primeiro.");
      return;
    }

    const channel = selectedChannel(product.channel_id);

    if (!channel) {
      setMessage("Selecione/cadastre um canal para enviar.");
      return;
    }

    setMessage(`Enviando ${product.title}...`);

    const text = formatPost(product);

    const endpoint = product.image_url
      ? `https://api.telegram.org/bot${bot.bot_token}/sendPhoto`
      : `https://api.telegram.org/bot${bot.bot_token}/sendMessage`;

    const payload = product.image_url
      ? {
          chat_id: channel.chat_id,
          photo: product.image_url,
          caption: text,
        }
      : {
          chat_id: channel.chat_id,
          text,
        };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!result.ok) {
      setMessage(`Erro Telegram: ${result.description}`);
      return;
    }

    await supabase
      .from("products")
      .update({
        status: "sent",
        updated_at: new Date().toISOString(),
      })
      .eq("id", product.id);

    setProducts(
      products.map((item) =>
        item.id === product.id ? { ...item, status: "sent" } : item
      )
    );

    setMessage("Produto enviado.");
  }

  async function deleteProduct(product: Product) {
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id);

    if (error) {
      setMessage(`Erro ao excluir: ${error.message}`);
      return;
    }

    if (product.short_code) {
      await supabase.from("short_links").delete().eq("code", product.short_code);
    }

    setProducts(products.filter((item) => item.id !== product.id));
    setMessage("Produto excluído.");
  }

  return (
    <main className="min-h-screen p-8">
      <section className="mx-auto max-w-6xl rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-3xl font-bold">Produtos</h1>

        <p className="mt-2 text-slate-300">
          Cadastre uma oferta e envie para o Telegram.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Nome do produto"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
          />

          <select
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>

          <select
            value={store}
            onChange={(event) => setStore(event.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
          >
            <option value="manual">Manual / Shopee / AliExpress</option>
            <option value="mercado_livre">Mercado Livre</option>
          </select>

          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="Preço. Ex: R$ 99,90"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
          />

          <input
            value={oldPrice}
            onChange={(event) => setOldPrice(event.target.value)}
            placeholder="Preço antigo. Ex: R$ 149,90"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
          />

          <input
            value={offerLink}
            onChange={(event) => setOfferLink(event.target.value)}
            placeholder="Link da oferta"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
          />

          <input
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="URL da imagem opcional"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500 md:col-span-2"
          />
        </div>

        {store === "mercado_livre" && (
          <div className="mt-4 rounded-xl border border-blue-900 bg-blue-950/40 p-4 text-sm text-blue-100">
            Mercado Livre ativo: o sistema vai aplicar sua tag, limpar o link e
            gerar um link curto no formato <strong>/m/CODIGO</strong>.
          </div>
        )}

        <button
          onClick={addProduct}
          className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500"
        >
          Salvar produto
        </button>

        <p className="mt-5 text-sm text-slate-300">{message}</p>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <article
              key={product.id}
              className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
            >
              {product.image_url && (
                <img
                  src={product.image_url}
                  alt={product.title}
                  className="mb-4 h-40 w-full rounded-xl object-cover"
                />
              )}

              <p className="font-semibold">{product.title}</p>

              <div className="mt-3 space-y-1 text-sm text-slate-300">
                {product.old_price && <p>De: {product.old_price}</p>}
                {product.price && <p>Por: {product.price}</p>}
                <p>Status: {product.status}</p>
                <p>Loja: {product.store || "manual"}</p>

                {product.short_code && (
                  <p className="text-blue-300">Curto: /m/{product.short_code}</p>
                )}
              </div>

              <a
                href={product.offer_link}
                target="_blank"
                className="mt-3 block break-all text-sm text-blue-400 hover:text-blue-300"
              >
                {product.offer_link}
              </a>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => sendProduct(product)}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold hover:bg-green-500"
                >
                  Enviar
                </button>

                <button
                  onClick={() => deleteProduct(product)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500"
                >
                  Excluir
                </button>
              </div>
            </article>
          ))}

          {products.length === 0 && (
            <p className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-400">
              Nenhum produto cadastrado ainda.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}