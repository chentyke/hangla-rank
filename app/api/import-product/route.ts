import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import type {
  ProductImportCandidate,
  ProductImportSiteItem,
  ProductImportSitePayload,
} from "@/lib/product-import/types";
import {
  ProductImportError,
  fetchLimited,
  imageProxyUrl,
  normalizeHostnameForSecurity,
  parseHttpUrl,
} from "@/lib/product-import/server";

export const runtime = "nodejs";

const STANDARD_PRODUCTS_PATH = "/.well-known/hangla-products.json";
const MAX_JSON_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 8000;
const PRESIGNED_URL_EXPIRY_SKEW_MS = 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    const siteUrl = parseHttpUrl(body?.url, "官网链接");
    const sourceUrl = new URL(STANDARD_PRODUCTS_PATH, siteUrl.origin);

    const { bytes, response, url: resolvedSourceUrl } = await fetchLimited(sourceUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "HanglaProductImporter/1.0",
      },
      maxBytes: MAX_JSON_BYTES,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (!response.ok) {
      const message =
        response.status === 404
          ? "未找到标准对接文件：/.well-known/hangla-products.json。"
          : `标准对接文件请求失败：${response.status}。`;
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const payload = parseJsonPayload(bytes);
    const { items, warnings } = normalizeItems(payload, resolvedSourceUrl, siteUrl);

    if (!items.length) {
      return NextResponse.json(
        {
          error: warnings[0] || "标准对接文件里没有可导入的产品项。",
          warnings,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      items,
      sourceUrl: resolvedSourceUrl.toString(),
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (error) {
    if (error instanceof ProductImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `导入失败：${message}` }, { status: 500 });
  }
}

function parseJsonPayload(bytes: ArrayBuffer): ProductImportSitePayload {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as ProductImportSitePayload;
  } catch {
    throw new ProductImportError("标准对接文件不是有效 JSON。", 422);
  }
}

function normalizeItems(payload: ProductImportSitePayload, sourceUrl: URL, inputUrl: URL) {
  if (!Array.isArray(payload.items)) {
    throw new ProductImportError("标准对接文件必须包含 items 数组。", 422);
  }

  const warnings: string[] = [];
  const seen = new Set<string>();
  const items: ProductImportCandidate[] = [];

  payload.items.forEach((rawItem, index) => {
    const item = rawItem as ProductImportSiteItem;
    const title = cleanText(item.title, 120);
    const text = cleanText(item.text, 500);
    const remoteImageUrl = normalizeImageUrl(item.imageUrl, sourceUrl);
    const itemSourceUrl = normalizeSourceUrl(item.sourceUrl, inputUrl) || inputUrl.toString();

    if (!title) {
      warnings.push(`第 ${index + 1} 项缺少 title。`);
      return;
    }

    if (!remoteImageUrl) {
      warnings.push(`第 ${index + 1} 项缺少有效 imageUrl。`);
      return;
    }

    if (isExpiredAwsPresignedUrl(remoteImageUrl)) {
      warnings.push(`第 ${index + 1} 项 imageUrl 已过期。`);
      return;
    }

    const dedupeKey = `${remoteImageUrl}::${title}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    items.push({
      id: stableId(cleanText(item.id, 100), remoteImageUrl, title, String(index)),
      imageUrl: imageProxyUrl(remoteImageUrl),
      remoteImageUrl,
      sourceUrl: itemSourceUrl,
      text,
      title,
    });
  });

  return { items, warnings };
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function toAbsoluteHttpUrl(value: unknown, baseUrl: URL) {
  if (typeof value !== "string" || !value.trim()) return "";

  try {
    const url = new URL(value.trim(), baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeImageUrl(value: unknown, baseUrl: URL) {
  const imageUrl = toAbsoluteHttpUrl(value, baseUrl);
  if (!imageUrl) return "";

  const parsedUrl = new URL(imageUrl);
  if (!isLocalhostUrl(parsedUrl)) return imageUrl;

  const nestedUrl = parsedUrl.searchParams.get("url");
  if (!nestedUrl) return "";

  return toAbsoluteHttpUrl(nestedUrl, baseUrl);
}

function normalizeSourceUrl(value: unknown, inputUrl: URL) {
  const sourceUrl = toAbsoluteHttpUrl(value, inputUrl);
  if (!sourceUrl) return "";

  const parsedUrl = new URL(sourceUrl);
  if (!isLocalhostUrl(parsedUrl)) return sourceUrl;

  return new URL(`${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`, inputUrl.origin).toString();
}

function isLocalhostUrl(url: URL) {
  const hostname = normalizeHostnameForSecurity(url.hostname);
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isExpiredAwsPresignedUrl(value: string, nowMs = Date.now()) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const signedAt = parseAwsDate(url.searchParams.get("X-Amz-Date"));
  const expiresSeconds = Number(url.searchParams.get("X-Amz-Expires"));
  if (!signedAt || !Number.isFinite(expiresSeconds) || expiresSeconds < 0) return false;

  const expiresAtMs = signedAt.getTime() + expiresSeconds * 1000;
  return expiresAtMs <= nowMs + PRESIGNED_URL_EXPIRY_SKEW_MS;
}

function parseAwsDate(value: string | null) {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function stableId(...parts: string[]) {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}
