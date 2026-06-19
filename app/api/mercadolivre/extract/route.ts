import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MercadoLivreApiItem = {
  id?: string;
  title?: string;
  price?: number | string | null;
  base_price?: number | string | null;
  original_price?: number | string | null;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  pictures?: Array<{
    url?: string;
    secure_url?: string;
  }>;
  sale_price?: {
    amount?: number | string | null;
    regular_amount?: number | string | null;
  } | null;
  variations?: Array<{
    price?: number | string | null;
  }>;
};

type MercadoLivreApiProduct = {
  id?: string;
  name?: string;
  title?: string;
  pictures?: Array<{
    url?: string;
    secure_url?: string;
  }>;
  buy_box_winner?: {
    item_id?: string;
    id?: string;
    price?: number | string | null;
    original_price?: number | string | null;
    regular_amount?: number | string | null;
    permalink?: string;
  } | null;
};

function normalizeUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) return "";

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function cleanText(value: string | undefined | null) {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*Mercado Livre.*$/i, "")
    .replace(/\s*\|\s*Mercado Livre.*$/i, "")
    .trim();
}

function parseMoney(value: string | number | undefined | null) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (!value) return null;

  let text = String(value)
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!text) return null;

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  if (hasComma && hasDot) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    text = text.replace(",", ".");
  } else if (hasDot) {
    const parts = text.split(".");
    const last = parts[parts.length - 1];

    if (last.length === 3 && parts.length > 1) {
      text = text.replace(/\./g, "");
    }
  }

  const parsed = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
}

function formatBRL(value: number | null) {
  if (!value || !Number.isFinite(value)) return "";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function fixImageUrl(value: string | undefined | null) {
  if (!value) return "";

  if (value.startsWith("http://")) {
    return value.replace("http://", "https://");
  }

  return value;
}

function extractItemIdFromText(value: string | null | undefined) {
  if (!value) return "";

  const decoded = decodeURIComponent(String(value)).replace(/%2F/gi, "/");

  const itemIdMatch =
    decoded.match(/item_id[:=](MLB\d{6,})/i) ||
    decoded.match(/\b(MLB\d{9,})\b/i) ||
    decoded.match(/\bMLB-?(\d{9,})\b/i);

  if (!itemIdMatch) return "";

  if (itemIdMatch[1]?.startsWith("MLB")) {
    return itemIdMatch[1].toUpperCase();
  }

  return `MLB${itemIdMatch[1]}`;
}

function extractItemIdFromPath(pathname: string) {
  if (/\/p\/MLB\d+/i.test(pathname)) {
    return "";
  }

  const pathMatch =
    pathname.match(/\/(MLB)-?(\d{6,})(?:-|\/|$)/i) ||
    pathname.match(/\/(MLB)(\d{6,})(?:-|\/|$)/i);

  if (!pathMatch) return "";

  return `MLB${pathMatch[2]}`;
}

function extractItemIdFromSearchParams(searchParams: URLSearchParams) {
  const directCandidates = [
    searchParams.get("item_id"),
    searchParams.get("wid"),
    searchParams.get("pdp_filters"),
  ];

  for (const candidate of directCandidates) {
    const itemId = extractItemIdFromText(candidate);

    if (itemId) return itemId;
  }

  for (const [key, value] of searchParams.entries()) {
    const itemIdFromKey = extractItemIdFromText(key);
    const itemIdFromValue = extractItemIdFromText(value);

    if (itemIdFromKey) return itemIdFromKey;
    if (itemIdFromValue) return itemIdFromValue;
  }

  return "";
}

function extractItemIdFromHash(hash: string) {
  if (!hash) return "";

  const rawHash = hash.startsWith("#") ? hash.slice(1) : hash;

  const fromText = extractItemIdFromText(rawHash);

  if (fromText) return fromText;

  try {
    const params = new URLSearchParams(rawHash);
    return extractItemIdFromSearchParams(params);
  } catch {
    return "";
  }
}

function extractItemIdFromUrl(rawUrl: string) {
  try {
    const url = new URL(normalizeUrl(rawUrl));

    const fromSearch = extractItemIdFromSearchParams(url.searchParams);

    if (fromSearch) return fromSearch;

    const fromHash = extractItemIdFromHash(url.hash);

    if (fromHash) return fromHash;

    const fromPath = extractItemIdFromPath(url.pathname);

    if (fromPath) return fromPath;

    return "";
  } catch {
    return extractItemIdFromText(rawUrl);
  }
}

function extractCatalogProductIdFromUrl(rawUrl: string) {
  try {
    const url = new URL(normalizeUrl(rawUrl));

    const pathMatch = url.pathname.match(/\/p\/(MLB\d{6,})/i);

    if (pathMatch) {
      return pathMatch[1].toUpperCase();
    }

    return "";
  } catch {
    const match = rawUrl.match(/\/p\/(MLB\d{6,})/i);
    return match ? match[1].toUpperCase() : "";
  }
}

async function fetchMercadoLivreApi(itemId: string) {
  if (!itemId) return null;

  const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const item = (await response.json()) as MercadoLivreApiItem;

  const priceFromSale = parseMoney(item.sale_price?.amount);
  const regularFromSale = parseMoney(item.sale_price?.regular_amount);
  const priceFromItem = parseMoney(item.price);
  const priceFromVariation = parseMoney(item.variations?.[0]?.price);

  const currentPrice = priceFromSale || priceFromItem || priceFromVariation;

  const originalPrice = parseMoney(item.original_price);
  const basePrice = parseMoney(item.base_price);

  let oldPrice: number | null = null;

  if (regularFromSale && currentPrice && regularFromSale > currentPrice) {
    oldPrice = regularFromSale;
  } else if (originalPrice && currentPrice && originalPrice > currentPrice) {
    oldPrice = originalPrice;
  } else if (basePrice && currentPrice && basePrice > currentPrice) {
    oldPrice = basePrice;
  }

  const imageUrl =
    fixImageUrl(item.pictures?.[0]?.secure_url) ||
    fixImageUrl(item.pictures?.[0]?.url) ||
    fixImageUrl(item.secure_thumbnail) ||
    fixImageUrl(item.thumbnail);

  const title = cleanText(item.title);

  if (!title && !currentPrice && !imageUrl) {
    return null;
  }

  return {
    title: title || "Produto Mercado Livre",
    price: formatBRL(currentPrice),
    old_price: formatBRL(oldPrice),
    image_url: imageUrl,
    original_url: item.permalink || "",
  };
}

async function fetchMercadoLivreProductApi(productId: string) {
  if (!productId) return null;

  const response = await fetch(
    `https://api.mercadolibre.com/products/${productId}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) return null;

  const product = (await response.json()) as MercadoLivreApiProduct;

  const buyBoxItemId = extractItemIdFromText(
    product.buy_box_winner?.item_id || product.buy_box_winner?.id || ""
  );

  if (buyBoxItemId) {
    const itemData = await fetchMercadoLivreApi(buyBoxItemId);

    if (itemData) return itemData;
  }

  const currentPrice = parseMoney(product.buy_box_winner?.price);
  const originalPrice =
    parseMoney(product.buy_box_winner?.original_price) ||
    parseMoney(product.buy_box_winner?.regular_amount);

  let oldPrice: number | null = null;

  if (originalPrice && currentPrice && originalPrice > currentPrice) {
    oldPrice = originalPrice;
  }

  const imageUrl =
    fixImageUrl(product.pictures?.[0]?.secure_url) ||
    fixImageUrl(product.pictures?.[0]?.url);

  const title = cleanText(product.name || product.title);

  if (!title && !currentPrice && !imageUrl) {
    return null;
  }

  return {
    title: title || "Produto Mercado Livre",
    price: formatBRL(currentPrice),
    old_price: formatBRL(oldPrice),
    image_url: imageUrl,
    original_url: product.buy_box_winner?.permalink || "",
  };
}

function getMeta($: cheerio.CheerioAPI, names: string[]) {
  for (const name of names) {
    const value =
      $(`meta[property="${name}"]`).attr("content") ||
      $(`meta[name="${name}"]`).attr("content") ||
      $(`meta[itemprop="${name}"]`).attr("content");

    if (value) return cleanText(value);
  }

  return "";
}

function moneyFromElement($: cheerio.CheerioAPI, selector: string) {
  const element = $(selector).first();

  if (!element.length) return null;

  const fraction = cleanText(
    element.find(".andes-money-amount__fraction").first().text()
  );

  const cents = cleanText(
    element.find(".andes-money-amount__cents").first().text()
  );

  if (fraction) {
    return parseMoney(cents ? `${fraction},${cents}` : fraction);
  }

  return parseMoney(element.text());
}

function findTitle($: cheerio.CheerioAPI) {
  const title =
    cleanText($("h1.ui-pdp-title").first().text()) ||
    getMeta($, ["og:title", "twitter:title"]) ||
    cleanText($("title").first().text());

  return title || "Produto Mercado Livre";
}

function findImage($: cheerio.CheerioAPI) {
  const image =
    getMeta($, ["og:image", "twitter:image", "image"]) ||
    $("img.ui-pdp-image").first().attr("src") ||
    $("img.ui-pdp-gallery__figure__image").first().attr("src") ||
    "";

  return fixImageUrl(image);
}

function findJsonLdProducts($: cheerio.CheerioAPI) {
  const products: unknown[] = [];

  function scan(value: unknown) {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }

    if (typeof value === "object") {
      const objectValue = value as Record<string, unknown>;
      const type = objectValue["@type"];

      if (
        type === "Product" ||
        (Array.isArray(type) && type.includes("Product"))
      ) {
        products.push(value);
      }

      Object.values(objectValue).forEach(scan);
    }
  }

  $('script[type="application/ld+json"]').each((_, element) => {
    const text = $(element).contents().text().trim();

    if (!text) return;

    try {
      scan(JSON.parse(text));
    } catch {
      // ignora JSON inválido
    }
  });

  return products;
}

function findPriceFromJsonLd($: cheerio.CheerioAPI) {
  const products = findJsonLdProducts($);

  for (const product of products) {
    const productObject = product as {
      offers?:
        | {
            price?: string | number;
            lowPrice?: string | number;
          }
        | Array<{
            price?: string | number;
            lowPrice?: string | number;
          }>;
    };

    const offers = Array.isArray(productObject.offers)
      ? productObject.offers[0]
      : productObject.offers;

    const price = parseMoney(offers?.price || offers?.lowPrice);

    if (price) return price;
  }

  return null;
}

function findNumberByKeys(html: string, keys: string[]) {
  for (const key of keys) {
    const regex = new RegExp(
      `"${key}"\\s*:\\s*"?([0-9]+(?:[\\.,][0-9]+)?)"?`,
      "gi"
    );

    const matches = [...html.matchAll(regex)];

    for (const match of matches) {
      const value = parseMoney(match[1]);

      if (value) return value;
    }
  }

  return null;
}

function findPrice($: cheerio.CheerioAPI, html: string) {
  const metaPrice = parseMoney(getMeta($, ["product:price:amount", "price"]));

  if (metaPrice) return metaPrice;

  const jsonLdPrice = findPriceFromJsonLd($);

  if (jsonLdPrice) return jsonLdPrice;

  const selectorPrice =
    moneyFromElement($, ".ui-pdp-price__second-line .andes-money-amount") ||
    moneyFromElement($, ".ui-pdp-price .andes-money-amount") ||
    moneyFromElement($, ".andes-money-amount");

  if (selectorPrice) return selectorPrice;

  return findNumberByKeys(html, ["price", "current_price", "amount", "value"]);
}

function findOldPrice(
  $: cheerio.CheerioAPI,
  html: string,
  currentPrice: number | null
) {
  const selectorOldPrice =
    moneyFromElement($, ".ui-pdp-price__original-value .andes-money-amount") ||
    moneyFromElement($, ".andes-money-amount--previous") ||
    moneyFromElement($, ".ui-pdp-price__original-value");

  const scriptOldPrice = findNumberByKeys(html, [
    "original_price",
    "previous_price",
    "regular_price",
    "list_price",
    "base_price",
    "strike_through_price",
  ]);

  let oldPrice = selectorOldPrice || scriptOldPrice;

  if (oldPrice && currentPrice && oldPrice <= currentPrice) {
    oldPrice = null;
  }

  return oldPrice;
}

async function fetchMercadoLivreHtml(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const title = findTitle($);
  const imageUrl = findImage($);
  const priceNumber = findPrice($, html);
  const oldPriceNumber = findOldPrice($, html, priceNumber);

  return {
    title,
    price: formatBRL(priceNumber),
    old_price: formatBRL(oldPriceNumber),
    image_url: imageUrl,
    original_url: response.url || url,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const url = normalizeUrl(body?.url || "");

    if (!url) {
      return NextResponse.json(
        { ok: false, error: "Informe o link do Mercado Livre." },
        { status: 400 }
      );
    }

    const itemIdFromOriginal = extractItemIdFromUrl(url);

    if (itemIdFromOriginal) {
      const apiData = await fetchMercadoLivreApi(itemIdFromOriginal);

      if (apiData) {
        return NextResponse.json({
          ok: true,
          source: "item_api_original",
          data: {
            ...apiData,
            original_url: apiData.original_url || url,
          },
        });
      }
    }

    const catalogProductIdFromOriginal = extractCatalogProductIdFromUrl(url);

    if (catalogProductIdFromOriginal) {
      const productData = await fetchMercadoLivreProductApi(
        catalogProductIdFromOriginal
      );

      if (productData) {
        return NextResponse.json({
          ok: true,
          source: "product_api_original",
          data: {
            ...productData,
            original_url: productData.original_url || url,
          },
        });
      }
    }

    const htmlData = await fetchMercadoLivreHtml(url);

    if (htmlData?.original_url) {
      const itemIdFromResolved = extractItemIdFromUrl(htmlData.original_url);

      if (itemIdFromResolved && itemIdFromResolved !== itemIdFromOriginal) {
        const apiData = await fetchMercadoLivreApi(itemIdFromResolved);

        if (apiData) {
          return NextResponse.json({
            ok: true,
            source: "item_api_resolved",
            data: {
              ...apiData,
              original_url: apiData.original_url || htmlData.original_url,
            },
          });
        }
      }

      const catalogProductIdFromResolved = extractCatalogProductIdFromUrl(
        htmlData.original_url
      );

      if (
        catalogProductIdFromResolved &&
        catalogProductIdFromResolved !== catalogProductIdFromOriginal
      ) {
        const productData = await fetchMercadoLivreProductApi(
          catalogProductIdFromResolved
        );

        if (productData) {
          return NextResponse.json({
            ok: true,
            source: "product_api_resolved",
            data: {
              ...productData,
              original_url: productData.original_url || htmlData.original_url,
            },
          });
        }
      }
    }

    if (htmlData) {
      return NextResponse.json({
        ok: true,
        source: "html",
        data: htmlData,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error:
          "Não foi possível encontrar dados desse produto. Tente outro link direto do produto Mercado Livre.",
      },
      { status: 400 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido.";

    return NextResponse.json(
      {
        ok: false,
        error: `Não foi possível buscar os dados: ${message}`,
      },
      { status: 500 }
    );
  }
}