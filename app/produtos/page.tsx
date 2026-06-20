"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
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

type ImportedProduct = {
  title: string;
  price: string;
  oldPrice: string;
  offerLink: string;
  imageUrl: string;
};

type SpreadsheetRow = Record<string, unknown>;

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

function normalizeColumnName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function valueToString(value: unknown) {
  if (value === null || value === undefined) return "";

  return String(value).trim();
}

function getColumnValue(row: SpreadsheetRow, aliases: string[]) {
  const normalizedEntries = Object.entries(row).map(([key, value]) => ({
    normalizedKey: normalizeColumnName(key),
    value,
  }));

  for (const alias of aliases) {
    const normalizedAlias = normalizeColumnName(alias);
    const found = normalizedEntries.find(
      (entry) => entry.normalizedKey === normalizedAlias
    );

    if (found) return valueToString(found.value);
  }

  return "";
}

function extractFirstUrlFromText(value: string) {
  const text = valueToString(value);

  if (!text) return "";

  const urls = text.match(/https?:\/\/[^\s"',;<>]+/gi);

  if (!urls || urls.length === 0) return "";

  return urls[0].trim();
}

function extractFirstImageUrlFromText(value: string) {
  const text = valueToString(value);

  if (!text) return "";

  const urls = text.match(/https?:\/\/[^\s"',;<>]+/gi);

  if (!urls || urls.length === 0) return "";

  const imageUrl =
    urls.find((url) =>
      /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url.trim())
    ) ||
    urls.find((url) =>
      /image|img|photo|picture|thumbnail|shopee|alicdn|mlstatic/i.test(url)
    ) ||
    "";

  return imageUrl.trim();
}

function getFirstImageUrlFromRow(row: SpreadsheetRow) {
  for (const value of Object.values(row)) {
    const imageUrl = extractFirstImageUrlFromText(valueToString(value));

    if (imageUrl) return imageUrl;
  }

  return "";
}

function getFirstUrlFromRow(row: SpreadsheetRow) {
  for (const value of Object.values(row)) {
    const url = extractFirstUrlFromText(valueToString(value));

    if (url) return url;
  }

  return "";
}

function mapImportedRow(row: SpreadsheetRow, store: string): ImportedProduct {
  const commonTitleAliases = [
    "title",
    "titulo",
    "título",
    "nome",
    "produto",
    "product name",
    "nome do produto",
    "item name",
    "item title",
    "product title",
    "product desc",
    "description",
    "descricao",
    "descrição",
  ];

  const commonPriceAliases = [
    "price",
    "preco",
    "preço",
    "preco atual",
    "preço atual",
    "discount price",
    "sale price",
    "valor",
    "final price",
    "price after discount",
    "current price",
  ];

  const commonOldPriceAliases = [
    "old price",
    "preco antigo",
    "preço antigo",
    "original price",
    "origin price",
    "regular price",
    "price before discount",
    "normal price",
    "list price",
  ];

  const commonImageAliases = [
    "image",
    "imagem",
    "image url",
    "image_url",
    "main image",
    "main image url",
    "url imagem",
    "foto",
    "photo",
    "picture",
    "thumbnail",
    "thumbnail url",
    "cover image",
    "cover image url",
    "product image",
    "product image url",
    "item image",
    "item image url",
    "item picture",
    "item picture url",
    "image link",
    "img",
    "img url",
    "picture url",
    "product thumbnail",
    "product thumbnail url",
  ];

  const commonLinkAliases = [
    "link",
    "url",
    "offer link",
    "product link",
    "promotion url",
    "affiliate link",
    "link afiliado",
    "link da oferta",
    "link produto",
    "product url",
    "item url",
    "item link",
  ];

  if (store === "shopee") {
    const title = getColumnValue(row, [
      "Item Name",
      "Product Name",
      "Product Title",
      "Item Title",
      "Nome do produto",
      "Nome Produto",
      "Title",
      ...commonTitleAliases,
    ]);

    const price = getColumnValue(row, [
      "Price",
      "Sale Price",
      "Discount Price",
      "Current Price",
      "Preço",
      "Preco",
      "Preço atual",
      ...commonPriceAliases,
    ]);

    const oldPrice = getColumnValue(row, [
      "Original Price",
      "Price Before Discount",
      "Regular Price",
      "Preço antigo",
      ...commonOldPriceAliases,
    ]);

    const imageUrl =
      getColumnValue(row, [
        "Image URL",
        "Image Url",
        "Image",
        "Imagem",
        "Main Image",
        "Main Image URL",
        "Product Image",
        "Product Image URL",
        "Item Image",
        "Item Image URL",
        "Item Picture",
        "Item Picture URL",
        "Cover Image",
        "Cover Image URL",
        "Thumbnail",
        "Thumbnail URL",
        "Product Thumbnail",
        "Image Link",
        "Picture URL",
        ...commonImageAliases,
      ]) || getFirstImageUrlFromRow(row);

    const offerLink =
      getColumnValue(row, [
        "Offer Link",
        "Product Link",
        "Product URL",
        "Affiliate Link",
        "Promotion URL",
        "Link afiliado",
        "Item URL",
        "Item Link",
        ...commonLinkAliases,
      ]) || getFirstUrlFromRow(row);

    return {
      title,
      price,
      oldPrice,
      imageUrl,
      offerLink,
    };
  }

  if (store === "aliexpress") {
    return {
      title: getColumnValue(row, [
        "Product Desc",
        "Product Name",
        "Product Title",
        "Title",
        ...commonTitleAliases,
      ]),
      price: getColumnValue(row, [
        "Discount Price",
        "Sale Price",
        "Price",
        "Preço",
        ...commonPriceAliases,
      ]),
      oldPrice: getColumnValue(row, [
        "Origin Price",
        "Original Price",
        "Regular Price",
        "Preço antigo",
        ...commonOldPriceAliases,
      ]),
      imageUrl:
        getColumnValue(row, [
          "Image Url",
          "Image URL",
          "Image",
          "Imagem",
          ...commonImageAliases,
        ]) || getFirstImageUrlFromRow(row),
      offerLink:
        getColumnValue(row, [
          "Promotion Url",
          "Promotion URL",
          "Affiliate Link",
          "Product Url",
          "Product URL",
          "Link afiliado",
          ...commonLinkAliases,
        ]) || getFirstUrlFromRow(row),
    };
  }

  if (store === "mercado_livre") {
    return {
      title: getColumnValue(row, [
        "title",
        "titulo",
        "título",
        "nome",
        "produto",
        "Product Name",
        ...commonTitleAliases,
      ]),
      price: getColumnValue(row, [
        "price",
        "preco",
        "preço",
        "Preço atual",
        ...commonPriceAliases,
      ]),
      oldPrice: getColumnValue(row, [
        "old_price",
        "old price",
        "preco_antigo",
        "preço antigo",
        "Original Price",
        ...commonOldPriceAliases,
      ]),
      imageUrl:
        getColumnValue(row, [
          "image_url",
          "image",
          "imagem",
          "Image URL",
          ...commonImageAliases,
        ]) || getFirstImageUrlFromRow(row),
      offerLink:
        getColumnValue(row, [
          "link",
          "url",
          "link_produto",
          "Product Link",
          "offer_link",
          ...commonLinkAliases,
        ]) || getFirstUrlFromRow(row),
    };
  }

  return {
    title: getColumnValue(row, commonTitleAliases),
    price: getColumnValue(row, commonPriceAliases),
    oldPrice: getColumnValue(row, commonOldPriceAliases),
    imageUrl: getColumnValue(row, commonImageAliases) || getFirstImageUrlFromRow(row),
    offerLink: getColumnValue(row, commonLinkAliases) || getFirstUrlFromRow(row),
  };
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

  const [importStore, setImportStore] = useState("shopee");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const [message, setMessage] = useState("Carregando...");
  const [extracting, setExtracting] = useState(false);

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

  async function fetchShopeeImage(productUrl: string) {
    try {
      const response = await fetch("/api/shopee/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: productUrl,
        }),
      });

      const result = await response.json();

      if (!result.ok) return "";

      return result.data?.image_url || "";
    } catch {
      return "";
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: offerLink.trim(),
        }),
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
      const errorMessage =
        error instanceof Error ? error.message : "Erro desconhecido.";

      setMessage(`Erro ao buscar dados: ${errorMessage}`);
    } finally {
      setExtracting(false);
    }
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

    if (importStore === "mercado_livre" && !mlTag.trim()) {
      setMessage("Configure sua tag do Mercado Livre na aba Lojas.");
      return;
    }

    try {
      setImporting(true);
      setMessage("Lendo planilha...");

      const buffer = await importFile.arrayBuffer();
      const workbook = XLSX.read(buffer, {
        type: "array",
      });

      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        setMessage("A planilha não possui abas.");
        return;
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<SpreadsheetRow>(worksheet, {
        defval: "",
      });

      if (rows.length === 0) {
        setMessage("Nenhum produto encontrado na planilha.");
        return;
      }

      setMessage(`Importando ${rows.length} linhas...`);

      const importedProducts: Product[] = [];
      const shopeeImageCache = new Map<string, string>();

      let importedCount = 0;
      let skippedCount = 0;
      let imagesFoundCount = 0;

      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const mapped = mapImportedRow(row, importStore);

        if (!mapped.title || !mapped.offerLink) {
          skippedCount++;
          continue;
        }

        let importedImageUrl = mapped.imageUrl;

        if (importStore === "shopee" && !importedImageUrl) {
          const normalizedShopeeLink = normalizeUrl(mapped.offerLink);

          if (shopeeImageCache.has(normalizedShopeeLink)) {
            importedImageUrl = shopeeImageCache.get(normalizedShopeeLink) || "";
          } else {
            setMessage(
              `Buscando imagem Shopee ${index + 1} de ${rows.length}...`
            );

            importedImageUrl = await fetchShopeeImage(normalizedShopeeLink);
            shopeeImageCache.set(normalizedShopeeLink, importedImageUrl);

            if (importedImageUrl) {
              imagesFoundCount++;
            }
          }
        }

        let finalOfferLink = normalizeUrl(mapped.offerLink);
        const originalLink = normalizeUrl(mapped.offerLink);
        let finalLink = normalizeUrl(mapped.offerLink);
        let shortCode: string | null = null;
        let shortLinkId: string | null = null;

        if (importStore === "mercado_livre") {
          finalLink = applyMercadoLivreTag(mapped.offerLink, mlTag.trim());

          const shortLink = await createShortLink(finalLink);

          shortCode = shortLink.code;
          shortLinkId = shortLink.id;
          finalOfferLink = `${window.location.origin}/m/${shortLink.code}`;
        }

        const { data, error } = await supabase
          .from("products")
          .insert({
            user_id: userId,
            channel_id: channelId,
            title: mapped.title,
            price: mapped.price || null,
            old_price: mapped.oldPrice || null,
            offer_link: finalOfferLink,
            image_url: importedImageUrl || null,
            store: importStore,
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

          skippedCount++;
          continue;
        }

        if (shortLinkId) {
          await supabase
            .from("short_links")
            .update({
              product_id: data.id,
            })
            .eq("id", shortLinkId);
        }

        importedProducts.push(data);
        importedCount++;
      }

      setProducts([...importedProducts, ...products]);
      setImportFile(null);

      if (importStore === "shopee") {
        setMessage(
          `Importação concluída. Importados: ${importedCount}. Imagens Shopee encontradas: ${imagesFoundCount}. Ignorados: ${skippedCount}.`
        );
      } else {
        setMessage(
          `Importação concluída. Importados: ${importedCount}. Ignorados: ${skippedCount}.`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Erro desconhecido.";

      setMessage(`Erro ao importar planilha: ${errorMessage}`);
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
          Cadastre ofertas, importe planilhas e envie para o Telegram.
        </p>

        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-6">
          <h2 className="text-xl font-bold">Importar planilha</h2>

          <p className="mt-2 text-sm text-slate-400">
            Use CSV, XLS ou XLSX. Na Shopee, se a planilha não tiver imagem, o
            sistema tenta buscar a imagem pelo link do produto.
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <select
              value={importStore}
              onChange={(event) => setImportStore(event.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
            >
              <option value="shopee">Shopee</option>
              <option value="aliexpress">AliExpress</option>
              <option value="mercado_livre">Mercado Livre</option>
            </select>

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

            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={(event) =>
                setImportFile(event.target.files?.[0] || null)
              }
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={importSpreadsheetProducts}
            disabled={importing}
            className="mt-5 rounded-xl bg-purple-600 px-5 py-3 font-semibold hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {importing ? "Importando..." : "Importar produtos"}
          </button>
        </div>

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

          <div className="md:col-span-2">
            <div className="flex flex-col gap-3 md:flex-row">
              <input
                value={offerLink}
                onChange={(event) => setOfferLink(event.target.value)}
                placeholder="Link da oferta"
                className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
              />

              <button
                onClick={extractMercadoLivreData}
                disabled={extracting}
                className="rounded-xl bg-yellow-500 px-5 py-3 font-semibold text-slate-950 hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {extracting ? "Buscando..." : "Buscar dados ML"}
              </button>
            </div>
          </div>

          <input
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="URL da imagem opcional"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500 md:col-span-2"
          />
        </div>

        {store === "mercado_livre" && (
          <div className="mt-4 rounded-xl border border-blue-900 bg-blue-950/40 p-4 text-sm text-blue-100">
            Mercado Livre ativo: o sistema aplica sua tag, limpa o link e gera
            um link curto no formato <strong>/m/CODIGO</strong>.
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