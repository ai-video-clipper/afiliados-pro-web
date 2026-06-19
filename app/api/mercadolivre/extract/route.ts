import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawProductData = {
  title: string;
  currentPrice: number | null;
  oldPrice: number | null;
  imageUrl: string;
  originalUrl: string;
  source: string;
};

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

function safeDecode(value: string) {
  let result = value;

  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(result);

      if (decoded === result) break;

      result = decoded;
    } catch {
      break;
    }
  }

  return result;
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

  if (!Number.isFinite(parsed)) return null;

  return parsed;
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

function normalizeOldPrice(oldPrice: number | null, currentPrice: number | null) {
  if (!oldPrice) return null;
  if (currentPrice && oldPrice <= currentPrice) return null;

  return oldPrice;
}

function isUsefulTitle(value: string) {
  const title = cleanText(value).toLowerCase();

  if (!title) return false;
  if (title === "produto mercado livre") return false;
  if (title === "mercado livre") return false;

  return true;
}

function extractItemIdFromText(value: string | null | undefined) {
  if (!value) return "";

  const decoded = safeDecode(String(value));

  const fullPatterns = [
    /pdp_filters=[^#&]*?item_id[:=](MLB\d{6,})/i,
    /item_id[:=](MLB\d{6,})/i,
    /wid[:=](MLB\d{6,})/i,
    /"item_id"\s*:\s*"(MLB\d{6,})"/i,
    /"itemId"\s*:\s*"(MLB\d{6,})"/i,
    /\b(MLB\d{9,})\b/i,
  ];

  for (const pattern of fullPatterns) {
    const match = decoded.match(pattern);

    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  const digitPatterns = [
    /\/MLB-?(\d{9,})(?:-|\/|$)/i,
    /\bMLB-?(\d{9,})\b/i,
  ];

  for (const pattern of digitPatterns) {
    const match = decoded.match(pattern);

    if (match?.[1]) {
      return `MLB${match[1]}`;
    }
  }

  return "";
}

function extractItemIdFromUrl(rawUrl: string) {
  const fromRaw = extractItemIdFromText(rawUrl);

  if (fromRaw) return fromRaw;

  try {
    const url = new URL(normalizeUrl(rawUrl));

    const priorityParams = [
      url.searchParams.get("pdp_filters"),
      url.searchParams.get("item_id"),
      url.searchParams.get("wid"),
    ];

    for (const param of priorityParams) {
      const itemId = extractItemIdFromText(param);

      if (itemId) return itemId;
    }

    for (const [key, value] of url.searchParams.entries()) {
      const fromKey = extractItemIdFromText(key);
      const fromValue = extractItemIdFromText(value);

      if (fromKey) return fromKey;
      if (fromValue) return fromValue;
    }

    if (url.hash) {
      const fromHash = extractItemIdFromText(url.hash);

      if (fromHash) return fromHash;
    }

    return "";
  } catch {
    return "";
  }
}

function extractCatalogProductIdFromText(value: string | null | undefined) {
  if (!value) return "";

  const decoded = safeDecode(String(value));
  const match = decoded.match(/\/p\/(MLB\d{6,})/i);

  return match?.[1] ? match[1].toUpperCase() : "";
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

  const ariaLabel = element.attr("aria-label");

  if (ariaLabel) {
    const fromAria = parseMoney(ariaLabel);

    if (fromAria) return fromAria;
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

function findPriceFromJsonLd($: cheerio.CheerioAPI) {
  let found: number | null = null;

  $('script[type="application/ld+json"]').each((_, element) => {
    if (found) return;

    const text = $(element).contents().text().trim();

    if (!text) return;

    try {
      const json = JSON.parse(text);

      function scan(value: unknown) {
        if (found || !value) return;

        if (Array.isArray(value)) {
          value.forEach(scan);
          return;
        }

        if (typeof value !== "object") return;

        const objectValue = value as Record<string, unknown>;
        const type = objectValue["@type"];

        if (
          type === "Product" ||
          (Array.isArray(type) && type.includes("Product"))
        ) {
          const offers = Array.isArray(objectValue.offers)
            ? objectValue.offers[0]
            : objectValue.offers;

          if (offers && typeof offers === "object") {
            const offerObject = offers as Record<string, unknown>;

            found = parseMoney(
              (offerObject.price as string | number | undefined) ||
                (offerObject.lowPrice as string | number | undefined)
            );
          }
        }

        Object.values(objectValue).forEach(scan);
      }

      scan(json);
    } catch {
      // ignora JSON inválido
    }
  });

  return found;
}

function findNumberByKeys(html: string, keys: string[]) {
  for (const key of keys) {
    const patterns = [
      new RegExp(
        `"${key}"\\s*:\\s*"?([0-9]+(?:[\\.,][0-9]+)?)"?`,
        "gi"
      ),
      new RegExp(
        `"${key}"\\s*:\\s*\\{[^}]{0,250}"amount"\\s*:\\s*"?([0-9]+(?:[\\.,][0-9]+)?)"?`,
        "gi"
      ),
    ];

    for (const pattern of patterns) {
      const matches = [...html.matchAll(pattern)];

      for (const match of matches) {
        const value = parseMoney(match[1]);

        if (value && value > 1 && value < 500000) {
          return value;
        }
      }
    }
  }

  return null;
}

function findPrice($: cheerio.CheerioAPI, html: string) {
  const selectorPrice =
    moneyFromElement($, ".ui-pdp-price__second-line .andes-money-amount") ||
    moneyFromElement($, ".ui-pdp-price .andes-money-amount") ||
    moneyFromElement($, "[data-testid='price-part'] .andes-money-amount") ||
    moneyFromElement($, ".andes-money-amount:not(.andes-money-amount--previous)");

  if (selectorPrice) return selectorPrice;

  const metaPrice = parseMoney(getMeta($, ["product:price:amount", "price"]));

  if (metaPrice) return metaPrice;

  const jsonPrice = findPriceFromJsonLd($);

  if (jsonPrice) return jsonPrice;

  return findNumberByKeys(html, [
    "current_price",
    "sale_price",
    "price",
    "amount",
  ]);
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

  const oldFromSelector = normalizeOldPrice(selectorOldPrice, currentPrice);

  if (oldFromSelector) return oldFromSelector;

  const scriptOldPrice = findNumberByKeys(html, [
    "original_price",
    "previous_price",
    "regular_price",
    "list_price",
    "base_price",
    "strike_through_price",
  ]);

  return normalizeOldPrice(scriptOldPrice, currentPrice);
}

async function fetchHtmlData(url: string) {
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

  if (!response.ok) return null;

  const html = await response.text();
  const $ = cheerio.load(html);

  const title = findTitle($);
  const imageUrl = findImage($);
  const currentPrice = findPrice($, html);
  const oldPrice = findOldPrice($, html, currentPrice);
  const originalUrl = response.url || url;

  return {
    data: {
      title,
      currentPrice,
      oldPrice,
      imageUrl,
      originalUrl,
      source: "html",
    } as RawProductData,
    html,
    resolvedUrl: originalUrl,
  };
}

async function fetchItemApiData(itemId: string) {
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

  const currentPrice =
    parseMoney(item.sale_price?.amount) ||
    parseMoney(item.price) ||
    parseMoney(item.variations?.[0]?.price);

  const regularFromSale = parseMoney(item.sale_price?.regular_amount);
  const originalPrice = parseMoney(item.original_price);
  const basePrice = parseMoney(item.base_price);

  const oldPrice =
    normalizeOldPrice(regularFromSale, currentPrice) ||
    normalizeOldPrice(originalPrice, currentPrice) ||
    normalizeOldPrice(basePrice, currentPrice);

  const imageUrl =
    fixImageUrl(item.pictures?.[0]?.secure_url) ||
    fixImageUrl(item.pictures?.[0]?.url) ||
    fixImageUrl(item.secure_thumbnail) ||
    fixImageUrl(item.thumbnail);

  const title = cleanText(item.title);

  if (!title && !currentPrice && !imageUrl) return null;

  return {
    title: title || "Produto Mercado Livre",
    currentPrice,
    oldPrice,
    imageUrl,
    originalUrl: item.permalink || "",
    source: "item_api",
  } as RawProductData;
}

async function fetchProductApiData(productId: string) {
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
    const itemData = await fetchItemApiData(buyBoxItemId);

    if (itemData) return itemData;
  }

  const currentPrice = parseMoney(product.buy_box_winner?.price);

  const oldPrice = normalizeOldPrice(
    parseMoney(product.buy_box_winner?.original_price) ||
      parseMoney(product.buy_box_winner?.regular_amount),
    currentPrice
  );

  const imageUrl =
    fixImageUrl(product.pictures?.[0]?.secure_url) ||
    fixImageUrl(product.pictures?.[0]?.url);

  const title = cleanText(product.name || product.title);

  if (!title && !currentPrice && !imageUrl) return null;

  return {
    title: title || "Produto Mercado Livre",
    currentPrice,
    oldPrice,
    imageUrl,
    originalUrl: product.buy_box_winner?.permalink || "",
    source: "product_api",
  } as RawProductData;
}

function mergeData(
  htmlData: RawProductData | null,
  itemApiData: RawProductData | null,
  productApiData: RawProductData | null,
  fallbackUrl: string
) {
  const apiData = itemApiData || productApiData;

  const title =
    (htmlData && isUsefulTitle(htmlData.title) ? htmlData.title : "") ||
    (apiData && isUsefulTitle(apiData.title) ? apiData.title : "") ||
    "Produto Mercado Livre";

  const currentPrice =
    htmlData?.currentPrice || apiData?.currentPrice || null;

  const oldPrice =
    normalizeOldPrice(htmlData?.oldPrice || null, currentPrice) ||
    normalizeOldPrice(apiData?.oldPrice || null, currentPrice);

  const imageUrl = htmlData?.imageUrl || apiData?.imageUrl || "";

  const originalUrl =
    apiData?.originalUrl || htmlData?.originalUrl || fallbackUrl;

  const source = [
    htmlData?.source,
    itemApiData?.source,
    productApiData?.source,
  ]
    .filter(Boolean)
    .join("+");

  if (!title && !currentPrice && !imageUrl) return null;

  return {
    title,
    price: formatBRL(currentPrice),
    old_price: formatBRL(oldPrice),
    image_url: imageUrl,
    original_url: originalUrl,
    source,
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

    const rawItemId = extractItemIdFromUrl(url);
    const rawCatalogId = extractCatalogProductIdFromText(url);

    if (rawItemId) {
      const itemApiData = await fetchItemApiData(rawItemId);

      if (itemApiData) {
        return NextResponse.json({
          ok: true,
          data: {
            title: itemApiData.title,
            price: formatBRL(itemApiData.currentPrice),
            old_price: formatBRL(itemApiData.oldPrice),
            image_url: itemApiData.imageUrl,
            original_url: itemApiData.originalUrl || url,
            source: "item_api_raw",
          },
          debug: {
            raw_item_id: rawItemId,
            raw_catalog_id: rawCatalogId,
          },
        });
      }
    }

    if (rawCatalogId) {
      const productApiData = await fetchProductApiData(rawCatalogId);

      if (productApiData) {
        return NextResponse.json({
          ok: true,
          data: {
            title: productApiData.title,
            price: formatBRL(productApiData.currentPrice),
            old_price: formatBRL(productApiData.oldPrice),
            image_url: productApiData.imageUrl,
            original_url: productApiData.originalUrl || url,
            source: "product_api_raw",
          },
          debug: {
            raw_item_id: rawItemId,
            raw_catalog_id: rawCatalogId,
          },
        });
      }
    }

    const htmlResult = await fetchHtmlData(url);

    const resolvedUrl = htmlResult?.resolvedUrl || url;

    const resolvedItemId =
      extractItemIdFromUrl(resolvedUrl) ||
      extractItemIdFromText(htmlResult?.html || "");

    const resolvedCatalogId =
      extractCatalogProductIdFromText(resolvedUrl) ||
      extractCatalogProductIdFromText(htmlResult?.html || "");

    const itemApiData = resolvedItemId
      ? await fetchItemApiData(resolvedItemId)
      : null;

    const productApiData =
      !itemApiData && resolvedCatalogId
        ? await fetchProductApiData(resolvedCatalogId)
        : null;

    const merged = mergeData(
      htmlResult?.data || null,
      itemApiData,
      productApiData,
      url
    );

    if (merged) {
      return NextResponse.json({
        ok: true,
        data: merged,
        debug: {
          raw_item_id: rawItemId,
          raw_catalog_id: rawCatalogId,
          resolved_item_id: resolvedItemId,
          resolved_catalog_id: resolvedCatalogId,
          resolved_url: resolvedUrl,
          source: merged.source,
        },
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: `Não foi possível encontrar dados. Diagnóstico: raw_item_id=${
          rawItemId || "não encontrado"
        }, raw_catalog_id=${
          rawCatalogId || "não encontrado"
        }, resolved_item_id=${
          resolvedItemId || "não encontrado"
        }, resolved_catalog_id=${resolvedCatalogId || "não encontrado"}.`,
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