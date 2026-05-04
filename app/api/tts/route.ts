import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";

import { NextRequest, NextResponse } from "next/server";

import {
  ProductImportError,
  assertPublicHttpUrl,
  fetchLimited,
} from "@/lib/product-import/server";

export const runtime = "nodejs";
export const maxDuration = 180;

type TtsResponse = {
  audio?: string;
  audioUrl?: string;
  code?: number | string;
  data?: {
    audio?: string;
    audioUrl?: string;
    data?: string;
    url?: string;
  };
  detail?: string;
  error?: string | { message?: string };
  file_id?: string;
  message?: string;
  msg?: string;
  url?: string;
};

type MimoResponse = TtsResponse & {
  choices?: Array<{
    message?: {
      audio?: {
        b64_json?: string;
        data?: string;
        format?: string;
        url?: string;
      };
      content?: string;
    };
  }>;
};

type TtsRequestBody = {
  apiUrlTemplate?: unknown;
  format?: unknown;
  provider?: unknown;
  style?: unknown;
  text?: unknown;
  voice?: unknown;
};

type TtsRequestOptions = {
  apiUrlTemplate?: string;
  format?: string;
  provider?: string;
  style?: string;
  voice?: string;
};

const DEFAULT_TTS_PROVIDER = "mimo";
const CUSTOM_TTS_PROVIDER = "custom";
const DEFAULT_TTS_API_TEMPLATE = "https://freetts.org/api/tts";
const MIMO_TTS_MODEL = "mimo-v2.5-tts";
const MIMO_VOICE_CLONE_TTS_MODEL = "mimo-v2.5-tts-voiceclone";
const MIMO_CHAT_COMPLETIONS_URL =
  process.env.MIMO_CHAT_COMPLETIONS_URL?.trim() || "https://api.xiaomimimo.com/v1/chat/completions";
const MIMO_DEFAULT_CLONE_VOICE = "mimo_voice_clone_default";
const MIMO_BUILTIN_DEFAULT_VOICE = "mimo_builtin_default";
const MIMO_BUILTIN_DEFAULT_VOICE_ID = "mimo_default";
const MIMO_DEFAULT_VOICE = MIMO_DEFAULT_CLONE_VOICE;
const MIMO_LEGACY_DEFAULT_VOICES = new Set(["default_zh", "default_en", MIMO_BUILTIN_DEFAULT_VOICE_ID]);
const MIMO_DEFAULT_STYLE = "自然、清晰、适合短视频解说";
const MIMO_DEFAULT_FORMAT = "mp3";
const MIMO_SUPPORTED_FORMATS = new Set(["mp3", "wav"]);
const MIMO_DEFAULT_VOICE_CLONE_REFERENCE_PATH =
  process.env.MIMO_VOICE_CLONE_REFERENCE_PATH?.trim() || ".voice-clone/default-reference.mp3";
const MIMO_VOICE_CLONE_MAX_BASE64_BYTES = 10 * 1024 * 1024;
const FREETTS_ORIGIN = "https://freetts.org";
const FREETTS_TTS_PATH = "/api/tts";
const FREETTS_AUDIO_PATH = "/api/audio/";
const FREETTS_DEFAULT_RATE = "+0%";
const FREETTS_DEFAULT_PITCH = "+0Hz";
const FREETTS_DEFAULT_CHINESE_VOICE = "zh-CN-XiaoxiaoNeural";
const FREETTS_DEFAULT_ENGLISH_VOICE = "en-US-JennyNeural";
const FREETTS_RATE_LIMIT_STATUS = 429;
const FREETTS_MAX_RATE_LIMIT_RETRIES = 2;
const FREETTS_DEFAULT_RETRY_DELAY_MS = 60_000;
const FREETTS_MIN_RETRY_DELAY_MS = 1_000;
const FREETTS_MAX_RETRY_DELAY_MS = 75_000;
const MAX_TTS_AUDIO_BYTES = readPositiveIntegerEnv("TTS_MAX_AUDIO_BYTES", 12 * 1024 * 1024);
const MAX_TTS_JSON_BYTES = readPositiveIntegerEnv("TTS_MAX_JSON_BYTES", 1024 * 1024);
const MAX_TTS_TEXT_LENGTH = readPositiveIntegerEnv("TTS_MAX_TEXT_LENGTH", 1000);
const MAX_TTS_STYLE_LENGTH = readPositiveIntegerEnv("TTS_MAX_STYLE_LENGTH", 160);
const MAX_TTS_VOICE_LENGTH = readPositiveIntegerEnv("TTS_MAX_VOICE_LENGTH", 80);
const UPSTREAM_TTS_TIMEOUT_MS = 60_000;
const UPSTREAM_TTS_MAX_RETRIES = 2;
const UPSTREAM_TTS_RETRY_BASE_DELAY_MS = 1_200;
const UPSTREAM_TTS_MAX_REDIRECTS = 4;
const TTS_RATE_LIMIT_WINDOW_MS = readPositiveIntegerEnv("TTS_RATE_LIMIT_WINDOW_MS", 60_000);
const TTS_RATE_LIMIT_MAX_REQUESTS = readPositiveIntegerEnv("TTS_RATE_LIMIT_MAX_REQUESTS", 20);
const ALLOW_PRIVATE_TTS_UPSTREAMS = process.env.ALLOW_PRIVATE_TTS_UPSTREAMS === "true";
const TEXT_PLACEHOLDER = "{text}";
const MAX_TTS_API_TEMPLATE_LENGTH = 2048;
const MAX_ERROR_TEXT_LENGTH = 500;
const RETRYABLE_UPSTREAM_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 524]);

type RateLimitBucket = {
  count: number;
  windowStartedAt: number;
};

const ttsRateLimitBuckets = new Map<string, RateLimitBucket>();
let defaultVoiceCloneDataUriPromise: Promise<string> | null = null;

export async function GET(request: NextRequest) {
  const text = request.nextUrl.searchParams.get("text");
  const apiUrlTemplate =
    request.nextUrl.searchParams.get("apiUrlTemplate") ?? request.nextUrl.searchParams.get("api");

  return handleTtsRequest(request, text, {
    apiUrlTemplate: apiUrlTemplate ?? undefined,
    format: request.nextUrl.searchParams.get("format") ?? undefined,
    provider: request.nextUrl.searchParams.get("provider") ?? undefined,
    style: request.nextUrl.searchParams.get("style") ?? undefined,
    voice: request.nextUrl.searchParams.get("voice") ?? undefined,
  });
}

export async function POST(request: NextRequest) {
  let body: TtsRequestBody;

  try {
    body = (await request.json()) as TtsRequestBody;
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON" }, { status: 400 });
  }

  return handleTtsRequest(request, typeof body.text === "string" ? body.text : "", {
    apiUrlTemplate: typeof body.apiUrlTemplate === "string" ? body.apiUrlTemplate : undefined,
    format: typeof body.format === "string" ? body.format : undefined,
    provider: typeof body.provider === "string" ? body.provider : undefined,
    style: typeof body.style === "string" ? body.style : undefined,
    voice: typeof body.voice === "string" ? body.voice : undefined,
  });
}

async function handleTtsRequest(request: NextRequest, rawText: string | null, options: TtsRequestOptions) {
  const text = rawText?.trim();

  if (!text) {
    return NextResponse.json({ error: "缺少语音文案" }, { status: 400 });
  }

  if (text.length > MAX_TTS_TEXT_LENGTH) {
    return NextResponse.json({ error: `语音文案不能超过 ${MAX_TTS_TEXT_LENGTH} 个字符` }, { status: 413 });
  }

  const rateLimitResponse = checkTtsRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const provider = options.provider?.trim() || DEFAULT_TTS_PROVIDER;

    if (provider === CUSTOM_TTS_PROVIDER) {
      return await fetchCustomTtsAudio(text, options.apiUrlTemplate?.trim() || DEFAULT_TTS_API_TEMPLATE);
    }

    if (provider !== DEFAULT_TTS_PROVIDER) {
      return NextResponse.json({ error: "不支持的 TTS 服务商" }, { status: 400 });
    }

    return await fetchMimoTtsAudio(text, options);
  } catch (error) {
    if (error instanceof ProductImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `语音生成失败：${message}` }, { status: 500 });
  }
}

async function fetchMimoTtsAudio(text: string, options: TtsRequestOptions) {
  const apiKey = getMimoApiKey();

  if (!apiKey) {
    return NextResponse.json({ error: "缺少服务端环境变量 MIMO_API_KEY" }, { status: 500 });
  }

  const format = normalizeAudioFormat(options.format);
  const voiceConfig = await resolveMimoVoiceConfig(options.voice);
  const payload: Record<string, unknown> = {
    audio: {
      format,
      voice: voiceConfig.voice,
    },
    messages: [
      {
        content: cleanTtsOption(options.style, MAX_TTS_STYLE_LENGTH) || MIMO_DEFAULT_STYLE,
        role: "user",
      },
      {
        content: text,
        role: "assistant",
      },
    ],
    model: voiceConfig.model,
    stream: false,
  };

  if (voiceConfig.model === MIMO_TTS_MODEL) {
    payload.modalities = ["text", "audio"];
  }

  const response = await fetchWithRetry(MIMO_CHAT_COMPLETIONS_URL, {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    method: "POST",
  });

  const responseContentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    return NextResponse.json({ error: await readUpstreamError(response, "MiMo TTS 请求失败") }, { status: 502 });
  }

  if (!responseContentType.includes("json")) {
    return proxyAudioResponse(response, getAudioContentType(format));
  }

  const mimoPayload = (await response.json()) as MimoResponse;
  const audioUrl = getMimoAudioUrl(mimoPayload);
  const audioData = getMimoAudioBase64(mimoPayload);

  if (audioData) {
    const audioBuffer = decodeBase64Audio(audioData);
    return audioBufferResponse(audioBuffer, getAudioContentType(format));
  }

  if (audioUrl) {
    const audioResponse = await fetchWithRetry(new URL(audioUrl, MIMO_CHAT_COMPLETIONS_URL).toString(), {
      cache: "no-store",
    });

    if (!audioResponse.ok) {
      return NextResponse.json(
        { error: await readUpstreamError(audioResponse, "MiMo 音频下载失败") },
        { status: 502 },
      );
    }

    return proxyAudioResponse(audioResponse, getAudioContentType(format));
  }

  return NextResponse.json({ error: getPayloadErrorMessage(mimoPayload) || "MiMo TTS 未返回音频数据" }, { status: 502 });
}

async function fetchCustomTtsAudio(text: string, apiTemplate: string) {
  if (isFreeTtsApi(apiTemplate)) {
    return fetchFreeTtsAudio(text, apiTemplate);
  }

  const upstreamUrl = buildTtsUrl(text, apiTemplate);
  const {
    bytes: ttsBytes,
    response: ttsResponse,
    url: resolvedUpstreamUrl,
  } = await fetchLimited(new URL(upstreamUrl), {
    allowPrivate: ALLOW_PRIVATE_TTS_UPSTREAMS,
    headers: {
      Accept: "application/json,audio/*,*/*;q=0.8",
      "User-Agent": "HanglaTtsProxy/1.0",
    },
    maxBytes: MAX_TTS_AUDIO_BYTES,
    timeoutMs: UPSTREAM_TTS_TIMEOUT_MS,
  });

  if (!ttsResponse.ok) {
    return NextResponse.json(
      { error: await readUpstreamError(ttsResponse, "语音接口请求失败", ttsBytes) },
      { status: 502 },
    );
  }

  const ttsContentType = ttsResponse.headers.get("content-type") || "";
  if (!ttsContentType.includes("json")) {
    return audioBufferResponse(ttsBytes, ttsContentType || "audio/mpeg");
  }

  if (ttsBytes.byteLength > MAX_TTS_JSON_BYTES) {
    return NextResponse.json({ error: "语音接口 JSON 响应过大" }, { status: 413 });
  }

  const payload = parseJsonBytes<TtsResponse>(ttsBytes);
  if (!payload) {
    return NextResponse.json({ error: "语音接口未返回有效 JSON" }, { status: 502 });
  }

  const audioUrl = getAudioUrl(payload);

  if (payload.code !== undefined && String(payload.code) !== "200") {
    return NextResponse.json({ error: getPayloadErrorMessage(payload) || "语音接口未返回音频地址" }, { status: 502 });
  }

  if (!audioUrl) {
    return NextResponse.json({ error: getPayloadErrorMessage(payload) || "语音接口未返回音频地址" }, { status: 502 });
  }

  const audioSourceUrl = new URL(audioUrl, resolvedUpstreamUrl);
  const { bytes: audioBytes, response: audioResponse } = await fetchLimited(audioSourceUrl, {
    allowPrivate: ALLOW_PRIVATE_TTS_UPSTREAMS,
    headers: {
      Accept: "audio/*,*/*;q=0.8",
      "User-Agent": "HanglaTtsProxy/1.0",
    },
    maxBytes: MAX_TTS_AUDIO_BYTES,
    timeoutMs: UPSTREAM_TTS_TIMEOUT_MS,
  });

  if (!audioResponse.ok) {
    return NextResponse.json(
      { error: await readUpstreamError(audioResponse, "音频下载失败", audioBytes) },
      { status: 502 },
    );
  }

  return audioBufferResponse(audioBytes, audioResponse.headers.get("content-type") || "audio/mpeg");
}

function buildTtsUrl(text: string, template: string) {
  if (template.length > MAX_TTS_API_TEMPLATE_LENGTH) {
    throw new Error("TTS API 地址过长");
  }

  const renderedUrl = template.includes(TEXT_PLACEHOLDER)
    ? template.split(TEXT_PLACEHOLDER).join(encodeURIComponent(text))
    : appendTextQuery(template, text);
  const url = new URL(renderedUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("TTS API 只支持 http 或 https 地址");
  }

  return url.toString();
}

function isFreeTtsApi(template: string) {
  const url = parseHttpUrl(template);
  return url.origin === FREETTS_ORIGIN && url.pathname.replace(/\/+$/, "") === FREETTS_TTS_PATH;
}

async function fetchFreeTtsAudio(text: string, apiTemplate: string) {
  const ttsUrl = parseHttpUrl(apiTemplate);
  const voice = ttsUrl.searchParams.get("voice")?.trim() || getDefaultFreeTtsVoice(text);
  const rate = ttsUrl.searchParams.get("rate")?.trim() || FREETTS_DEFAULT_RATE;
  const pitch = ttsUrl.searchParams.get("pitch")?.trim() || FREETTS_DEFAULT_PITCH;
  const requestBody = JSON.stringify({ text, voice, rate, pitch });

  const { payload, response: ttsResponse } = await postFreeTtsWithRetry(requestBody);

  if (!ttsResponse.ok) {
    return NextResponse.json(
      { error: getPayloadErrorMessage(payload) || `FreeTTS 请求失败：${ttsResponse.status}` },
      { status: 502 },
    );
  }

  if (!payload.file_id) {
    return NextResponse.json(
      { error: getPayloadErrorMessage(payload) || "FreeTTS 未返回 file_id" },
      { status: 502 },
    );
  }

  const audioResponse = await fetchWithRetry(new URL(`${FREETTS_AUDIO_PATH}${payload.file_id}`, FREETTS_ORIGIN).toString(), {
    cache: "no-store",
  });

  if (!audioResponse.ok) {
    return NextResponse.json({ error: await readUpstreamError(audioResponse, "FreeTTS 音频下载失败") }, { status: 502 });
  }

  return proxyAudioResponse(audioResponse);
}

async function postFreeTtsWithRetry(body: string) {
  let lastResponse: Response | null = null;
  let lastPayload: TtsResponse = {};

  for (let attempt = 0; attempt <= FREETTS_MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const response = await postFreeTts(body);
    const payload = (await response.json().catch(() => ({}))) as TtsResponse;
    lastResponse = response;
    lastPayload = payload;

    if (response.status !== FREETTS_RATE_LIMIT_STATUS || attempt === FREETTS_MAX_RATE_LIMIT_RETRIES) {
      break;
    }

    await wait(getFreeTtsRetryDelay(response));
  }

  if (!lastResponse) throw new Error("FreeTTS 请求未发送");

  return { payload: lastPayload, response: lastResponse };
}

function postFreeTts(body: string) {
  return fetchWithTimeout(`${FREETTS_ORIGIN}${FREETTS_TTS_PATH}`, {
    body,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Origin: FREETTS_ORIGIN,
    },
    method: "POST",
  });
}

function getMimoApiKey() {
  return process.env.MIMO_API_KEY?.trim() || process.env.XIAOMI_API_KEY?.trim() || "";
}

function normalizeAudioFormat(format: string | undefined) {
  const normalizedFormat = format?.trim().toLowerCase();
  return normalizedFormat && MIMO_SUPPORTED_FORMATS.has(normalizedFormat) ? normalizedFormat : MIMO_DEFAULT_FORMAT;
}

function normalizeMimoVoice(voice: string | undefined) {
  const normalizedVoice = cleanTtsOption(voice, MAX_TTS_VOICE_LENGTH);
  if (!normalizedVoice || MIMO_LEGACY_DEFAULT_VOICES.has(normalizedVoice)) return MIMO_DEFAULT_VOICE;
  if (normalizedVoice === MIMO_BUILTIN_DEFAULT_VOICE) return MIMO_BUILTIN_DEFAULT_VOICE_ID;
  return normalizedVoice;
}

async function resolveMimoVoiceConfig(voice: string | undefined) {
  const normalizedVoice = normalizeMimoVoice(voice);

  if (normalizedVoice === MIMO_DEFAULT_CLONE_VOICE) {
    return {
      model: MIMO_VOICE_CLONE_TTS_MODEL,
      voice: await getDefaultVoiceCloneDataUri(),
    };
  }

  return {
    model: MIMO_TTS_MODEL,
    voice: normalizedVoice,
  };
}

function getDefaultVoiceCloneDataUri() {
  if (!defaultVoiceCloneDataUriPromise) {
    defaultVoiceCloneDataUriPromise = readDefaultVoiceCloneDataUri().catch((error: unknown) => {
      defaultVoiceCloneDataUriPromise = null;
      throw error;
    });
  }

  return defaultVoiceCloneDataUriPromise;
}

async function readDefaultVoiceCloneDataUri() {
  const referencePath = resolveVoiceCloneReferencePath();
  const mimeType = getVoiceCloneMimeType(referencePath);

  let audioBuffer: Buffer;
  try {
    audioBuffer = await readFile(referencePath);
  } catch {
    throw new ProductImportError(
      `默认克隆声线参考音频不存在：${referencePath}。请放入授权的 mp3/wav 样本，或设置 MIMO_VOICE_CLONE_REFERENCE_PATH。`,
      500,
    );
  }

  const base64Audio = audioBuffer.toString("base64");
  if (Buffer.byteLength(base64Audio, "utf8") > MIMO_VOICE_CLONE_MAX_BASE64_BYTES) {
    throw new ProductImportError("默认克隆声线参考音频过大，Base64 后不能超过 10 MB。", 413);
  }

  return `data:${mimeType};base64,${base64Audio}`;
}

function resolveVoiceCloneReferencePath() {
  return isAbsolute(MIMO_DEFAULT_VOICE_CLONE_REFERENCE_PATH)
    ? MIMO_DEFAULT_VOICE_CLONE_REFERENCE_PATH
    : join(/* turbopackIgnore: true */ process.cwd(), MIMO_DEFAULT_VOICE_CLONE_REFERENCE_PATH);
}

function getVoiceCloneMimeType(filePath: string) {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".mp3" || extension === ".mpeg") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";

  throw new ProductImportError("默认克隆声线参考音频只支持 mp3 或 wav。", 500);
}

function getAudioContentType(format: string) {
  return format === "wav" ? "audio/wav" : "audio/mpeg";
}

function getMimoAudioBase64(payload: MimoResponse) {
  return payload.choices?.find((choice) => choice.message?.audio?.data || choice.message?.audio?.b64_json)?.message
    ?.audio?.data ||
    payload.choices?.find((choice) => choice.message?.audio?.b64_json)?.message?.audio?.b64_json ||
    payload.audio ||
    payload.data?.data ||
    payload.data?.audio ||
    "";
}

function getMimoAudioUrl(payload: MimoResponse) {
  return (
    payload.choices?.find((choice) => choice.message?.audio?.url)?.message?.audio?.url ||
    payload.url ||
    payload.audioUrl ||
    payload.data?.url ||
    payload.data?.audioUrl ||
    ""
  );
}

function decodeBase64Audio(value: string) {
  const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const audioBuffer = Buffer.from(base64, "base64");

  if (!audioBuffer.byteLength) {
    throw new Error("MiMo TTS 返回了空音频");
  }

  if (audioBuffer.byteLength > MAX_TTS_AUDIO_BYTES) {
    throw new ProductImportError("音频内容过大。", 413);
  }

  return audioBuffer;
}

type FetchRetryOptions = {
  publicOnly?: boolean;
};

async function fetchWithRetry(url: string, init: RequestInit, options: FetchRetryOptions = {}) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= UPSTREAM_TTS_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init, options);

      if (!RETRYABLE_UPSTREAM_STATUSES.has(response.status) || attempt === UPSTREAM_TTS_MAX_RETRIES) {
        return response;
      }
    } catch (error) {
      if (error instanceof ProductImportError) throw error;

      lastError = error;

      if (attempt === UPSTREAM_TTS_MAX_RETRIES) {
        break;
      }
    }

    await wait(UPSTREAM_TTS_RETRY_BASE_DELAY_MS * 2 ** attempt);
  }

  throw lastError instanceof Error ? lastError : new Error("上游 TTS 请求失败");
}

async function fetchWithTimeout(url: string, init: RequestInit, options: FetchRetryOptions = {}) {
  let currentUrl = new URL(url);

  for (let redirectCount = 0; redirectCount <= UPSTREAM_TTS_MAX_REDIRECTS; redirectCount += 1) {
    if (!["http:", "https:"].includes(currentUrl.protocol)) {
      throw new Error("TTS 上游只支持 http 或 https 地址");
    }

    if (options.publicOnly) await assertPublicHttpUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TTS_TIMEOUT_MS);

    try {
      const response = await fetch(currentUrl, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });

      if (!isRedirect(response.status)) return response;

      const location = response.headers.get("location");
      if (!location) throw new Error("上游重定向缺少 Location");

      currentUrl = new URL(location, currentUrl);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("上游重定向次数过多");
}

async function readUpstreamError(response: Response, fallback: string, bodyBytes?: ArrayBuffer) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("json")) {
    const payload = bodyBytes
      ? parseJsonBytes<TtsResponse>(bodyBytes) || {}
      : ((await response.json().catch(() => ({}))) as TtsResponse);
    return getPayloadErrorMessage(payload) || `${fallback}：${response.status}`;
  }

  const text = bodyBytes
    ? new TextDecoder().decode(bodyBytes).trim()
    : (await response.text().catch(() => "")).trim();
  return text ? `${fallback}：${response.status} ${text.slice(0, MAX_ERROR_TEXT_LENGTH)}` : `${fallback}：${response.status}`;
}

function getPayloadErrorMessage(payload: TtsResponse) {
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  return payload.detail || payload.message || payload.msg || "";
}

function getFreeTtsRetryDelay(response: Response) {
  const retryAfter = response.headers.get("retry-after")?.trim();
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
  const retryAfterMs = Number.isFinite(retryAfterSeconds)
    ? retryAfterSeconds * 1000
    : parseRetryAfterDateMs(retryAfter);

  if (!Number.isFinite(retryAfterMs)) return FREETTS_DEFAULT_RETRY_DELAY_MS;
  return Math.min(Math.max(retryAfterMs, FREETTS_MIN_RETRY_DELAY_MS), FREETTS_MAX_RETRY_DELAY_MS);
}

function parseRetryAfterDateMs(value: string | undefined) {
  if (!value) return Number.NaN;

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return Number.NaN;

  return timestamp - Date.now();
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function checkTtsRateLimit(request: NextRequest) {
  const key = getClientRateLimitKey(request);
  const now = Date.now();
  const existingBucket = ttsRateLimitBuckets.get(key);

  if (!existingBucket || now - existingBucket.windowStartedAt >= TTS_RATE_LIMIT_WINDOW_MS) {
    ttsRateLimitBuckets.set(key, { count: 1, windowStartedAt: now });
    cleanupRateLimitBuckets(now);
    return null;
  }

  existingBucket.count += 1;

  if (existingBucket.count <= TTS_RATE_LIMIT_MAX_REQUESTS) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((existingBucket.windowStartedAt + TTS_RATE_LIMIT_WINDOW_MS - now) / 1000));
  return NextResponse.json(
    { error: "语音生成请求过于频繁，请稍后再试" },
    {
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
      status: 429,
    },
  );
}

function getClientRateLimitKey(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function cleanupRateLimitBuckets(now: number) {
  if (ttsRateLimitBuckets.size < 1000) return;

  for (const [key, bucket] of ttsRateLimitBuckets) {
    if (now - bucket.windowStartedAt >= TTS_RATE_LIMIT_WINDOW_MS) {
      ttsRateLimitBuckets.delete(key);
    }
  }
}

function cleanTtsOption(value: string | undefined, maxLength: number) {
  return value?.replace(/\s+/g, " ").trim().slice(0, maxLength) || "";
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseJsonBytes<T>(bytes: ArrayBuffer) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

function isRedirect(status: number) {
  return status >= 300 && status < 400;
}

function parseHttpUrl(rawUrl: string) {
  if (rawUrl.length > MAX_TTS_API_TEMPLATE_LENGTH) {
    throw new Error("TTS API 地址过长");
  }

  const url = new URL(rawUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("TTS API 只支持 http 或 https 地址");
  }

  return url;
}

function getDefaultFreeTtsVoice(text: string) {
  return /[\u3400-\u9fff]/.test(text) ? FREETTS_DEFAULT_CHINESE_VOICE : FREETTS_DEFAULT_ENGLISH_VOICE;
}

function appendTextQuery(template: string, text: string) {
  const url = new URL(template);
  url.searchParams.set("text", text);
  return url.toString();
}

function getAudioUrl(payload: TtsResponse) {
  return payload.url || payload.audioUrl || payload.audio || payload.data?.url || payload.data?.audioUrl || payload.data?.audio || "";
}

async function proxyAudioResponse(response: Response, fallbackContentType = "audio/mpeg") {
  const audioBuffer = await readResponseLimitedBytes(response, MAX_TTS_AUDIO_BYTES);

  return audioBufferResponse(audioBuffer, response.headers.get("content-type") || fallbackContentType);
}

async function readResponseLimitedBytes(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new ProductImportError("音频内容过大。", 413);
  }

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new ProductImportError("音频内容过大。", 413);
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
      throw new ProductImportError("音频内容过大。", 413);
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

function audioBufferResponse(audioBuffer: ArrayBuffer | Uint8Array, contentType: string) {
  const body = toArrayBuffer(audioBuffer);

  return new NextResponse(new Blob([body], { type: contentType }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Length": String(audioBuffer.byteLength),
      "Content-Type": contentType,
    },
  });
}

function toArrayBuffer(audioBuffer: ArrayBuffer | Uint8Array) {
  if (audioBuffer instanceof ArrayBuffer) return audioBuffer;

  const copy = new ArrayBuffer(audioBuffer.byteLength);
  new Uint8Array(copy).set(audioBuffer);
  return copy;
}
