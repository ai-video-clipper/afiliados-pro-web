"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";

type TelegramBot = { bot_token: string };
type TelegramChannel = { id: string; name: string; chat_id: string };
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
type StoreSettings = { settings: Record<string, string> | null };
type SpreadsheetRow = Record<string, unknown>;
type ImportedProduct = { title: string; price: string; oldPrice: string; offerLink: string; imageUrl: string };

function valueToString(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

function normalizeColumnName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getColumnValue(row: SpreadsheetRow, aliases: string[]) {
  const entries = Object.entries(row).map(([key, value]) => ({ key: normalizeColumnName(key), value }));

  for (const alias of aliases) {
    const found = entries.find((entry) => entry.key === normalizeColumnName(alias));
    if (found) return valueToString(found.value);
  }

  return "";
}

function extractFirstUrlFromText(value: string) {
  const urls = value.match(/https?:\/\/[^\s"',;<>]+/gi);
  return urls?.[0]?.trim() || "";
}

function extractFirstImageUrlFromText(value: string) {
  const urls = value.match(/https?:\/\/[^\s"',;<>]+/gi) || [];
  return (
    urls.find((url) => /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) ||
    urls.find((url) => /image|img|photo|picture|thumbnail|alicdn|mlstatic/i.test(url)) ||
    ""
  ).trim();
}

function getFirstUrlFromRow(row: SpreadsheetRow) {
  for (const value of Object.values(row)) {
    const url = extractFirstUrlFromText(valueToString(value));
    if (url) return url;
  }
  return "";
}

function getFirstImageUrlFromRow(row: SpreadsheetRow) {
  for (const value of Object.values(row)) {
    const url = extractFirstImageUrlFromText(valueToString(value));
    if (url) return url;
  }
  return "";
}

function mapImportedRow(row: SpreadsheetRow, store: string): ImportedProduct {
  const titles = ["title", "titulo", "título", "nome", "produto", "product name", "item name", "product title", "product desc", "description", "descricao"];
  const prices = ["price", "preco", "preço", "preco atual", "preço atual", "discount price", "sale price", "valor", "final price", "current price"];
  const oldPrices = ["old price", "preco antigo", "preço antigo", "original price", "origin price", "regular price", "price before discount", "list price"];
  const images = ["image", "imagem", "image url", "image_url", "main image", "url imagem", "foto", "photo", "picture", "thumbnail", "product image", "item image"];
  const links = ["link", "url", "offer link", "product link", "promotion url", "affiliate link", "link afiliado", "link da oferta", "link produto", "product url", "item url"];

  if (store === "shopee") {
    return {
      title: getColumnValue(row, ["Item Name", "Product Name", "Product Title", "Item Title", "Nome do produto", ...titles]),
      price: getColumnValue(row, ["Price", "Sale Price", "Discount Price", "Current Price", "Preço", ...prices]),
      oldPrice: getColumnValue(row, ["Original Price", "Price Before Discount", "Regular Price", "Preço antigo", ...oldPrices]),
      imageUrl: getColumnValue(row, ["Image URL", "Image", "Main Image", "Product Image", "Thumbnail", ...images]) || getFirstImageUrlFromRow(row),
      offerLink: getColumnValue(row, ["Offer Link", "Product Link", "Product URL", "Affiliate Link", "Promotion URL", "Item URL", ...links]) || getFirstUrlFromRow(row),
    };
  }

  if (store === "aliexpress") {
    return {
      title: getColumnValue(row, ["Product Desc", "Product Name", "Product Title", "Title", ...titles]),
      price: getColumnValue(row, ["Discount Price", "Sale Price", "Price", ...prices]),
      oldPrice: getColumnValue(row, ["Origin Price", "Original Price", "Regular Price", ...oldPrices]),
      imageUrl: getColumnValue(row, ["Image Url", "Image URL", "Image", ...images]) || getFirstImageUrlFromRow(row),
      offerLink: getColumnValue(row, ["Promotion Url", "Promotion URL", "Affiliate Link", "Product Url", "Product URL", ...links]) || getFirstUrlFromRow(row),
    };
  }

  return {
    title: getColumnValue(row, titles),
    price: getColumnValue(row, prices),
    oldPrice: getColumnValue(row, oldPrices),
    imageUrl: getColumnValue(row, images) || getFirstImageUrlFromRow(row),
    offerLink: getColumnValue(row, links) || getFirstUrlFromRow(row),
  };
}

function generateShortCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function applyMercadoLivreTag(rawUrl: string, tag: string) {
  const cleanUrl = normalizeUrl(rawUrl);

  try {
    const url = new URL(cleanUrl);
    url.hash = "";
    const allowedParams = new Set(["p", "variation", "quantity"]);
    const cleaned = new URL(`${url.origin}${url.pathname}`);
    for (const [key, value] of url.searchParams.entries()) {
      if (allowedParams.has(key)) cleaned.searchParams.set(key, value);
    }
    cleaned.searchParams.set("tag", tag);
    return cleaned.toString();
  } catch {
    return `${cleanUrl.split("#")[0].split("?")[0]}?tag=${encodeURIComponent(tag)}`;
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

  const [importStore, setImportStore] = useState("shopee");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState("Carregando...");

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        window.location.href = "/login";
        return;
      }

      setUserId(userData.user.id);

      const { data: botData } = await supabase.from("telegram_bots").select("bot_token").eq("user_id", userData.user.id).maybeSingle();
      setBot(botData);

      const { data: channelData } = await supabase.from("telegram_channels").select("id, name, chat_id").eq("user_id", userData.user.id).order("created_at", { ascending: false });
      const loadedChannels = channelData || [];
      setChannels(loadedChannels);
      if (loadedChannels.length > 0) setChannelId(loadedChannels[0].id);

      const { data: settingsData } = await supabase.from("store_settings").select("settings").eq("user_id", userData.user.id).eq("store", "mercado_livre").maybeSingle<StoreSettings>();
      setMlTag(settingsData?.settings?.ml_tag || "");

      const { data: productData } = await supabase.from("products").select("id, title, price, old_price, offer_link, image_url, status, channel_id, store, original_link, final_link, short_code").eq("user_id", userData.user.id).order("created_at", { ascending: false });
      setProducts(productData || []);
      setMessage("Pronto.");
    }

    load();
  }, [supabase]);

  function selectedChannel(productChannelId?: string | null) {
    return channels.find((channel) => channel.id === (productChannelId || channelId)) || null;
  }

  function formatPost(product: Product) {
    const lines = [`🚨 ${product.title} 🚨`, ""];
    if (product.old_price) lines.push(`🔥 De: ${product.old_price}`);
    if (product.price) lines.push(`✅ Por apenas: ${product.price}`);
    lines.push("", "👉 GARANTA O SEU AQUI:", product.offer_link, "", "⚠️ Confira o preço final antes de concluir a compra.");
    return lines.join("\n");
  }

  async function createShortLink(destinationUrl: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateShortCode();
      const { data, error } = await supabase.from("short_links").insert({ user_id: userId, code, destination_url: destinationUrl }).select("id, code").single();
      if (!error && data) return data;
    }
    throw new Error("Não foi possível gerar link curto.");
  }

  async function completeShopeeData(productUrl: string, currentTitle: string, currentPrice: string, currentImage: string) {
    if (currentImage && currentPrice) return { title: currentTitle, price: currentPrice, imageUrl: currentImage };

    try {
      const response = await fetch("/api/shopee/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: productUrl }),
      });
      const result = await response.json();
      if (!result.ok) return { title: currentTitle, price: currentPrice, imageUrl: currentImage };

      return {
        title: currentTitle || result.data?.title || "",
        price: currentPrice || result.data?.price || "",
        imageUrl: currentImage || result.data?.image_url || "",
      };
    } catch {
      return { title: currentTitle, price: currentPrice, imageUrl: currentImage };
    }
  }

  async function extractMercadoLivreData() {
    if (!offerLink.trim()) {
      setMessage("Cole o link do Mercado Livre primeiro.");
      return;
    }

    try {
      setExtracting(true);
      setMessage("Buscando dados no Mercado Livre...");
      const response = await fetch("/api/mercadolivre/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: offerLink.trim() }),
      });
      const result = await response.json();
      if (!result.ok) {
        setMessage(result.error || "Não foi possível buscar os dados.");
        return;
      }

      const data = result.data;
      setStore("mercado_livre");
      if (data.title) setTitle(data.title);
      if (data.price) setPrice(data.price);
      if (data.old_price) setOldPrice(data.old_price);
      if (data.image_url) setImageUrl(data.image_url);
      if (data.original_url) setOfferLink(data.original_url);
      setMessage("Dados encontrados. Confira e salve o produto.");
    } catch (error) {
      setMessage(`Erro ao buscar dados: ${error instanceof Error ? error.message : "Erro desconhecido."}`);
    } finally {
      setExtracting(false);
    }
  }

  async function saveProduct(payload: { title: string; price: string; oldPrice: string; offerLink: string; imageUrl: string; store: string; channelId: string }) {
    let finalOfferLink = normalizeUrl(payload.offerLink);
    const originalLink = normalizeUrl(payload.offerLink);
    let finalLink = normalizeUrl(payload.offerLink);
    let shortCode: string | null = null;
    let shortLinkId: string | null = null;

    if (payload.store === "mercado_livre") {
      if (!mlTag.trim()) throw new Error("Configure sua tag do Mercado Livre na aba Lojas.");
      finalLink = applyMercadoLivreTag(payload.offerLink, mlTag.trim());
      const shortLink = await createShortLink(finalLink);
      shortCode = shortLink.code;
      shortLinkId = shortLink.id;
      finalOfferLink = `${window.location.origin}/m/${shortLink.code}`;
    }

    const { data, error } = await supabase
      .from("products")
      .insert({
        user_id: userId,
        channel_id: payload.channelId,
        title: payload.title.trim(),
        price: payload.price.trim() || null,
        old_price: payload.oldPrice.trim() || null,
        offer_link: finalOfferLink,
        image_url: payload.imageUrl.trim() || null,
        store: payload.store,
        original_link: originalLink,
        final_link: finalLink,
        short_code: shortCode,
      })
      .select("id, title, price, old_price, offer_link, image_url, status, channel_id, store, original_link, final_link, short_code")
      .single();

    if (error) {
      if (shortLinkId) await supabase.from("short_links").delete().eq("id", shortLinkId);
      throw error;
    }

    if (shortLinkId) await supabase.from("short_links").update({ product_id: data.id }).eq("id", shortLinkId);
    return data as Product;
  }

  async function addProduct() {
    if (!userId) return;
    if (!title.trim() || !offerLink.trim()) {
      setMessage("Preencha pelo menos nome do produto e link.");
      return;
    }
    if (!channelId) {
      setMessage("Cadastre ou selecione um canal antes de salvar.");
      return;
    }

    try {
      setMessage("Salvando produto...");
      const data = await saveProduct({ title, price, oldPrice, offerLink, imageUrl, store, channelId });
      setProducts([data, ...products]);
      setTitle("");
      setPrice("");
      setOldPrice("");
      setOfferLink("");
      setImageUrl("");
      setStore("manual");
      setMessage(data.short_code ? `Produto salvo com link curto: /m/${data.short_code}` : "Produto salvo.");
    } catch (error) {
      setMessage(`Erro: ${error instanceof Error ? error.message : "Erro desconhecido."}`);
    }
  }

  async function importSpreadsheetProducts() {
    if (!userId) return;
    if (!channelId) {
      setMessage("Cadastre ou selecione um canal antes de importar.");
      return;
    }
    if (!importFile) {
      setMessage("Selecione uma planilha CSV/XLS/XLSX.");
      return;
    }

    try {
      setImporting(true);
      setMessage("Lendo planilha...");
      const buffer = await importFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        setMessage("A planilha não possui abas.");
        return;
      }

      const rows = XLSX.utils.sheet_to_json<SpreadsheetRow>(workbook.Sheets[sheetName], { defval: "" });
      const importedProducts: Product[] = [];
      let importedCount = 0;
      let skippedCount = 0;
      let completedCount = 0;

      for (let index = 0; index < rows.length; index++) {
        const mapped = mapImportedRow(rows[index], importStore);
        if (!mapped.title || !mapped.offerLink) {
          skippedCount++;
          continue;
        }

        let completed = { title: mapped.title, price: mapped.price, imageUrl: mapped.imageUrl };

        if (importStore === "shopee" && (!mapped.imageUrl || !mapped.price)) {
          setMessage(`Completando dados Shopee ${index + 1} de ${rows.length}...`);
          completed = await completeShopeeData(mapped.offerLink, mapped.title, mapped.price, mapped.imageUrl);
          if ((completed.imageUrl && !mapped.imageUrl) || (completed.price && !mapped.price)) completedCount++;
        }

        try {
          const data = await saveProduct({
            title: completed.title,
            price: completed.price,
            oldPrice: mapped.oldPrice,
            offerLink: mapped.offerLink,
            imageUrl: completed.imageUrl,
            store: importStore,
            channelId,
          });
          importedProducts.push(data);
          importedCount++;
        } catch {
          skippedCount++;
        }
      }

      setProducts([...importedProducts, ...products]);
      setImportFile(null);
      setMessage(`Importação concluída. Importados: ${importedCount}. Dados completados: ${completedCount}. Ignorados: ${skippedCount}.`);
    } catch (error) {
      setMessage(`Erro ao importar: ${error instanceof Error ? error.message : "Erro desconhecido."}`);
    } finally {
      setImporting(false);
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
    const endpoint = product.image_url ? `https://api.telegram.org/bot${bot.bot_token}/sendPhoto` : `https://api.telegram.org/bot${bot.bot_token}/sendMessage`;
    const payload = product.image_url ? { chat_id: channel.chat_id, photo: product.image_url, caption: formatPost(product) } : { chat_id: channel.chat_id, text: formatPost(product) };
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!result.ok) {
      setMessage(`Erro Telegram: ${result.description}`);
      return;
    }

    await supabase.from("products").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", product.id);
    setProducts(products.map((item) => (item.id === product.id ? { ...item, status: "sent" } : item)));
    setMessage("Produto enviado.");
  }

  async function deleteProduct(product: Product) {
    const { error } = await supabase.from("products").delete().eq("id", product.id);
    if (error) {
      setMessage(`Erro ao excluir: ${error.message}`);
      return;
    }
    if (product.short_code) await supabase.from("short_links").delete().eq("code", product.short_code);
    setProducts(products.filter((item) => item.id !== product.id));
    setMessage("Produto excluído.");
  }

  return (
    <main className="min-h-screen p-8">
      <section className="mx-auto max-w-6xl rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-3xl font-bold">Produtos</h1>
        <p className="mt-2 text-slate-300">Cadastre ofertas, importe planilhas e envie para o Telegram.</p>

        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-6">
          <h2 className="text-xl font-bold">Importar planilha</h2>
          <p className="mt-2 text-sm text-slate-400">Shopee tenta completar imagem/preço com Cookie/User-Agent da aba Lojas. AliExpress usa os dados da planilha.</p>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <select value={importStore} onChange={(event) => setImportStore(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500">
              <option value="shopee">Shopee</option>
              <option value="aliexpress">AliExpress</option>
              <option value="mercado_livre">Mercado Livre</option>
            </select>

            <select value={channelId} onChange={(event) => setChannelId(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500">
              {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
            </select>

            <input type="file" accept=".csv,.xls,.xlsx" onChange={(event) => setImportFile(event.target.files?.[0] || null)} className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
          </div>

          <button onClick={importSpreadsheetProducts} disabled={importing} className="mt-5 rounded-xl bg-purple-600 px-5 py-3 font-semibold hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60">
            {importing ? "Importando..." : "Importar produtos"}
          </button>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nome do produto" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
          <select value={channelId} onChange={(event) => setChannelId(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500">{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select>
          <select value={store} onChange={(event) => setStore(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500">
            <option value="manual">Manual / Shopee / AliExpress</option>
            <option value="mercado_livre">Mercado Livre</option>
            <option value="shopee">Shopee</option>
            <option value="aliexpress">AliExpress</option>
          </select>
          <input value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Preço. Ex: R$ 99,90" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
          <input value={oldPrice} onChange={(event) => setOldPrice(event.target.value)} placeholder="Preço antigo. Ex: R$ 149,90" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />

          <div className="md:col-span-2 flex flex-col gap-3 md:flex-row">
            <input value={offerLink} onChange={(event) => setOfferLink(event.target.value)} placeholder="Link da oferta" className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" />
            <button onClick={extractMercadoLivreData} disabled={extracting} className="rounded-xl bg-yellow-500 px-5 py-3 font-semibold text-slate-950 hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-60">{extracting ? "Buscando..." : "Buscar dados ML"}</button>
          </div>

          <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="URL da imagem opcional" className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500 md:col-span-2" />
        </div>

        <button onClick={addProduct} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500">Salvar produto</button>
        <p className="mt-5 text-sm text-slate-300">{message}</p>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <article key={product.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              {product.image_url && <img src={product.image_url} alt={product.title} className="mb-4 h-40 w-full rounded-xl object-cover" />}
              <p className="font-semibold">{product.title}</p>
              <div className="mt-3 space-y-1 text-sm text-slate-300">
                {product.old_price && <p>De: {product.old_price}</p>}
                {product.price && <p>Por: {product.price}</p>}
                <p>Status: {product.status}</p>
                <p>Loja: {product.store || "manual"}</p>
                {product.short_code && <p className="text-blue-300">Curto: /m/{product.short_code}</p>}
              </div>
              <a href={product.offer_link} target="_blank" className="mt-3 block break-all text-sm text-blue-400 hover:text-blue-300">{product.offer_link}</a>
              <div className="mt-4 flex gap-3">
                <button onClick={() => sendProduct(product)} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold hover:bg-green-500">Enviar</button>
                <button onClick={() => deleteProduct(product)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500">Excluir</button>
              </div>
            </article>
          ))}
          {products.length === 0 && <p className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-400">Nenhum produto cadastrado ainda.</p>}
        </div>
      </section>
    </main>
  );
}
