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
  return (value || "").replace(/\s+/g, " ").trim();
}

function fixImageUrl(value: string | undefined | null) {
  if (!value) return "";

  let image = value.trim();

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
      return fixImageUrl(match[1].replace(/\\u002F/g, "/").replace(/\\/g, ""));
    }
  }

  return "";
}

function findTitle($: cheerio.CheerioAPI) {
  return (
    getMeta($, ["og:title", "twitter:title"]) ||
    cleanText($("title").first().text()) ||
    ""
  );
}

function findImage($: cheerio.CheerioAPI, html: string) {
  const metaImage =
    getMeta($, ["og:image", "twitter:image", "image"]) ||
    $("img").first().attr("src") ||
    "";

  return fixImageUrl(metaImage) || findImageInHtml(html);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const url = normalizeUrl(body?.url || "");

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

    const title = findTitle($);
    const imageUrl = findImage($, html);

    if (!title && !imageUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "Não foi possível encontrar imagem nesse link da Shopee.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        title,
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
        error: `Erro ao buscar imagem da Shopee: ${message}`,
      },
      { status: 500 }
    );
  }
}