import { NextRequest, NextResponse } from "next/server";

import {
  ProductImportError,
  fetchLimited,
  isImageContentType,
  parseHttpUrl,
} from "@/lib/product-import/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10000;

export async function GET(request: NextRequest) {
  try {
    const imageUrl = parseHttpUrl(request.nextUrl.searchParams.get("src"), "图片链接");

    const { bytes, response } = await fetchLimited(imageUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "User-Agent": "HanglaProductImporter/1.0",
      },
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (!response.ok) {
      return NextResponse.json({ error: `图片请求失败：${response.status}。` }, { status: 502 });
    }

    const contentType = response.headers.get("content-type");
    if (!isImageContentType(contentType)) {
      return NextResponse.json({ error: "远程链接未返回图片内容。" }, { status: 415 });
    }

    return new NextResponse(bytes, {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": contentType || "image/jpeg",
      },
    });
  } catch (error) {
    if (error instanceof ProductImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `图片代理失败：${message}` }, { status: 500 });
  }
}
