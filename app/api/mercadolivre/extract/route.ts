import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

function cleanText(value: string | undefined | null) {
  return (value || "").replace(/\s+/g, " ").replace(/\s*-\s*Mercado Livre.*$/i, "").trim();
}

function parseMoney(value: string | number | undefined | null) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  let text = String(value).replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!text) return null;
  if (text.includes(",") && text.includes(".")) text = text.replace(/\./g, "").replace(",", ".");
  else if (text.includes(",")) text = text.replace(",", ".");
  else if (text.includes(".")) {
    const parts = text.split(".");
    if (parts.at(-1)?.length === 3 && parts.length > 1) text = text.replace(/\./g, "");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatBRL(value: number | null) {
  if (!value) return "";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function fixImageUrl(value: string | undefined | null) {
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("http://")) return value.replace("http://", "https://");
  return value;
}

function getMeta($: cheerio.CheerioAPI, names: string[]) {
  for (const name of names) {
    const value = $(`meta[property="${name}"]`).attr("content") || $(`meta[name="${name}"]`).attr("content") || $(`meta[itemprop="${name}"]`).attr("content");
    if (value) return cleanText(value);
  }
  return "";
}

function moneyFromElement($: cheerio.CheerioAPI, selector: string) {
  const element = $(selector).first();
  if (!element.length) return null;
  const fraction = cleanText(element.find(".andes-money-amount__fraction").first().text());
  const cents = cleanText(element.find(".andes-money-amount__cents").first().text());
  if (fraction) return parseMoney(cents ? `${fraction},${cents}` : fraction);
  return parseMoney(element.attr("aria-label") || element.text());
}

function findTitle($: cheerio.CheerioAPI) {
  return cleanText($("h1.ui-pdp-title").first().text()) || getMeta($, ["og:title", "twitter:title"]) || cleanText($("title").first().text()) || "";
}

function findImage($: cheerio.CheerioAPI, html: string) {
  const meta = getMeta($, ["og:image", "twitter:image", "image"]);
  if (meta) return fixImageUrl(meta);
  const src = $("img.ui-pdp-image").first().attr("src") || $("img.ui-pdp-gallery__figure__image").first().attr("src") || "";
  if (src) return fixImageUrl(src);
  const match = html.match(/https?:\/\/[^"'<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>]*)?/i);
  return fixImageUrl(match?.[0]);
}

function findPrice($: cheerio.CheerioAPI, html: string) {
  return (
    moneyFromElement($, ".ui-pdp-price__second-line .andes-money-amount") ||
    moneyFromElement($, ".ui-pdp-price .andes-money-amount") ||
    moneyFromElement($, "[data-testid='price-part'] .andes-money-amount") ||
    parseMoney(getMeta($, ["product:price:amount", "price"])) ||
    parseMoney(html.match(/"price"\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1])
  );
}

function findOldPrice($: cheerio.CheerioAPI, html: string, currentPrice: number | null) {
  const old =
    moneyFromElement($, ".ui-pdp-price__original-value .andes-money-amount") ||
    moneyFromElement($, ".andes-money-amount--previous") ||
    parseMoney(html.match(/"original_price"\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1]) ||
    parseMoney(html.match(/"regular_price"\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1]);
  if (old && currentPrice && old > currentPrice) return old;
  return null;
}

async function getMercadoLivreSettings() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return {} as Record<string, string>;

  const { data } = await supabase
    .from("store_settings")
    .select("settings")
    .eq("user_id", userData.user.id)
    .eq("store", "mercado_livre")
    .maybeSingle();

  return (data?.settings || {}) as Record<string, string>;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const url = normalizeUrl(body?.url || "");

    if (!url) {
      return NextResponse.json({ ok: false, error: "Informe o link do Mercado Livre." }, { status: 400 });
    }

    const settings = await getMercadoLivreSettings();
    const userAgent = settings.ml_user_agent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

    const headers: Record<string, string> = {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    };

    if (settings.ml_cookie) headers.Cookie = settings.ml_cookie;

    const response = await fetch(url, { redirect: "follow", headers, cache: "no-store" });

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: `Mercado Livre não respondeu. Status: ${response.status}` }, { status: 400 });
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const currentPrice = findPrice($, html);
    const oldPrice = findOldPrice($, html, currentPrice);

    const data = {
      title: findTitle($) || "Produto Mercado Livre",
      price: formatBRL(currentPrice),
      old_price: formatBRL(oldPrice),
      image_url: findImage($, html),
      original_url: response.url || url,
    };

    if (!data.title && !data.price && !data.image_url) {
      return NextResponse.json({ ok: false, error: "Não foi possível capturar dados. Salve Cookie/User-Agent do Mercado Livre na aba Lojas." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return NextResponse.json({ ok: false, error: `Erro Mercado Livre: ${message}` }, { status: 500 });
  }
}
