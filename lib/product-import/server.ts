import dns from "node:dns/promises";
import net from "node:net";
import type { LookupAddress } from "node:dns";

const MAX_REDIRECTS = 4;

type FetchLimitedOptions = {
  allowPrivate?: boolean;
  headers?: HeadersInit;
  maxBytes: number;
  timeoutMs: number;
};

export class ProductImportError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProductImportError";
    this.status = status;
  }
}

export function parseHttpUrl(value: unknown, fieldName = "url") {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProductImportError(`缺少 ${fieldName}。`, 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ProductImportError(`${fieldName} 不是有效网址。`, 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ProductImportError(`${fieldName} 只支持 http 或 https。`, 400);
  }

  if (!parsed.hostname) {
    throw new ProductImportError(`${fieldName} 缺少主机名。`, 400);
  }

  return parsed;
}

export async function assertPublicHttpUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ProductImportError("只支持 http 或 https 链接。", 400);
  }

  const hostname = normalizeHostnameForSecurity(url.hostname);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0" ||
    hostname.endsWith(".local")
  ) {
    throw new ProductImportError("不支持 localhost、内网或本地地址。", 400);
  }

  if (isPrivateIp(hostname)) {
    throw new ProductImportError("不支持 localhost、内网或本地地址。", 400);
  }

  if (net.isIP(hostname)) return;

  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ProductImportError("无法解析官网域名。", 400);
  }

  if (!addresses.length || addresses.some((address) => isPrivateIp(address.address))) {
    throw new ProductImportError("不支持解析到 localhost、内网或本地地址的域名。", 400);
  }
}

export async function fetchLimited(url: URL, options: FetchLimitedOptions) {
  let currentUrl = new URL(url);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!["http:", "https:"].includes(currentUrl.protocol)) {
      throw new ProductImportError("只支持 http 或 https 链接。", 400);
    }

    if (!options.allowPrivate) await assertPublicHttpUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        cache: "no-store",
        headers: options.headers,
        redirect: "manual",
        signal: controller.signal,
      });

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new ProductImportError("对接接口重定向缺少 Location。", 502);
        }

        currentUrl = new URL(location, currentUrl);
        continue;
      }

      const bytes = await readLimitedBytes(response, options.maxBytes);
      return { bytes, response, url: currentUrl };
    } catch (error) {
      if (error instanceof ProductImportError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProductImportError("请求超时。", 504);
      }
      throw new ProductImportError("请求失败。", 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new ProductImportError("对接接口重定向次数过多。", 502);
}

export function imageProxyUrl(remoteImageUrl: string) {
  return `/api/import-product/image?src=${encodeURIComponent(remoteImageUrl)}`;
}

export function isImageContentType(contentType: string | null) {
  return Boolean(contentType?.toLowerCase().startsWith("image/"));
}

export function normalizeHostnameForSecurity(hostname: string) {
  return hostname.trim().replace(/^\[|\]$/g, "").toLowerCase();
}

function isRedirect(status: number) {
  return status >= 300 && status < 400;
}

async function readLimitedBytes(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new ProductImportError("响应内容过大。", 413);
  }

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new ProductImportError("响应内容过大。", 413);
    }
    return arrayBuffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ProductImportError("响应内容过大。", 413);
    }
    chunks.push(value);
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output.buffer;
}

function isPrivateIp(value: string) {
  const ipType = net.isIP(value);
  if (ipType === 4) return isPrivateIpv4(value);
  if (ipType === 6) return isPrivateIpv6(value);
  return false;
}

function isPrivateIpv4(value: string) {
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(value: string) {
  const normalized = value.toLowerCase();
  const embeddedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);

  if (embeddedIpv4) {
    return isPrivateIpv4(embeddedIpv4[1]);
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}
