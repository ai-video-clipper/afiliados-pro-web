import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  return image;
}

function findJsonLdProducts($: cheerio.CheerioAPI) {
  const products: any[] = [];

  function scan(value: any) {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }

    if (typeof value === "object") {
      const type = value["@type"];

      if (
        type === "Product" ||
        (Array.isArray(type) && type.includes("Product"))
      ) {
        products.push(value);
      }

      Object.values(value).forEach(scan);
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
    const offers = Array.isArray(product.offers)
      ? product.offers[0]
      : product.offers;

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
  const metaPrice = parseMoney(
    getMeta($, ["product:price:amount", "price"])
  );

  if (metaPrice) return metaPrice;

  const jsonLdPrice = findPriceFromJsonLd($);

  if (jsonLdPrice) return jsonLdPrice;

  const selectorPrice =
    moneyFromElement($, ".ui-pdp-price__second-line .andes-money-amount") ||
    moneyFromElement($, ".ui-pdp-price .andes-money-amount") ||
    moneyFromElement($, ".andes-money-amount");

  if (selectorPrice) return selectorPrice;

  return findNumberByKeys(html, [
    "price",
    "current_price",
    "amount",
    "value",
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

  const scriptOldPrice =
    findNumberByKeys(html, [
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

    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Mercado Livre respondeu com erro ${response.status}.`,
        },
        { status: 400 }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = findTitle($);
    const imageUrl = findImage($);
    const priceNumber = findPrice($, html);
    const oldPriceNumber = findOldPrice($, html, priceNumber);

    return NextResponse.json({
      ok: true,
      data: {
        title,
        price: formatBRL(priceNumber),
        old_price: formatBRL(oldPriceNumber),
        image_url: imageUrl,
        original_url: response.url || url,
      },
    });
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