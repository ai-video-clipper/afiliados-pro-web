import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoreSettings = {
  settings?: {
    shopee_cookie?: string;
    shopee_user_agent?: string;
  };
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
  return (value || "").replace(/\s+/g, " ").trim();
}

function fixImageUrl(value: string | undefined | null) {
  if (!value) return "";

  let image = value.trim();

  image = image.replace(/\\u002F/g, "/").replace(/\\/g, "");

  if (image.startsWith("//")) {
    image = `https:${image}`;
  }

  if (image.startsWith("http://")) {
    image = image.replace("http://", "https://");
  }

  return image;
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

function parsePrice(value: string | number | undefined | null) {
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

function findImageInHtml(html: string) {
  const patterns = [
    /"image"\s*:\s*"([^"]+)"/i,
    /"image_url"\s*:\s*"([^"]+)"/i,
    /"imageUrl"\s*:\s*"([^"]+)"/i,
    /"images"\s*:\s*\[\s*"([^"]+)"/i,
    /"image_list"\s*:\s*\[\s*"([^"]+)"/i,
    /(https?:\/\/[^"'<>\\]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>\\]*)?)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return fixImageUrl(match[1]);
    }
  }

  return "";
}

function findTitle($: cheerio.CheerioAPI, html: string) {
  const metaTitle =
    getMeta($, ["og:title", "twitter:title"]) ||
    cleanText($("title").first().text());

  if (metaTitle) return metaTitle;

  const patterns = [
    /"name"\s*:\s*"([^"]+)"/i,
    /"title"\s*:\s*"([^"]+)"/i,
    /"item_name"\s*:\s*"([^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return "";
}

function findPriceInHtml(html: string) {
  const patterns = [
    /"price"\s*:\s*([0-9]+)/i,
    /"price_min"\s*:\s*([0-9]+)/i,
    /"price_max"\s*:\s*([0-9]+)/i,
    /"price_before_discount"\s*:\s*([0-9]+)/i,
    /"salePrice"\s*:\s*"?([0-9.,]+)"?/i,
    /"current_price"\s*:\s*"?([0-9.,]+)"?/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (!match?.[1]) continue;

    let price = parsePrice(match[1]);

    if (!price) continue;

    if (price > 100000) {
      price = price / 100000;
    }

    return price;
  }

  return null;
}

function findOldPriceInHtml(html: string, currentPrice: number | null) {
  const patterns = [
    /"price_before_discount"\s*:\s*([0-9]+)/i,
    /"priceBeforeDiscount"\s*:\s*([0-9]+)/i,
    /"original_price"\s*:\s*"?([0-9.,]+)"?/i,
    /"regular_price"\s*:\s*"?([0-9.,]+)"?/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (!match?.[1]) continue;

    let price = parsePrice(match[1]);

    if (!price) continue;

    if (price > 100000) {
      price = price / 100000;
    }

    if (currentPrice && price <= currentPrice) continue;

    return price;
  }

  return null;
}

function findImage($: cheerio.CheerioAPI, html: string) {
  const metaImage =
    getMeta($, ["og:image", "twitter:image", "image"]) ||
    $("img").first().attr("src") ||
    "";

  return fixImageUrl(metaImage) || findImageInHtml(html);
}

function createHeaders(cookie?: string, userAgent?: string) {
  const headers: Record<string, string> = {
    "User-Agent":
      userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    const url = normalizeUrl(body?.url || "");
    const settings = (body?.settings || {}) as StoreSettings["settings"];

    const cookie = settings?.shopee_cookie || body?.cookie || "";
    const userAgent = settings?.shopee_user_agent || body?.user_agent || "";

    if (!url) {
      return NextResponse.json(
        {
          ok: false,
          error: "Informe o link da Shopee.",
        },
        { status: 400 }
      );
    }

    const response = await fetch(url, {
      redirect: "follow",
      headers: createHeaders(cookie, userAgent),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Shopee bloqueou ou não respondeu. Status: ${response.status}`,
        },
        { status: 400 }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = findTitle($, html);
    const imageUrl = findImage($, html);
    const priceNumber = findPriceInHtml(html);
    const oldPriceNumber = findOldPriceInHtml(html, priceNumber);

    if (!title && !imageUrl && !priceNumber) {
      return NextResponse.json(
        {
          ok: false,
          error: "Não foi possível encontrar dados nesse link da Shopee.",
        },
        { status: 400 }
      );
    }

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
        error: `Erro ao buscar dados da Shopee: ${message}`,
      },
      { status: 500 }
    );
  }
}
