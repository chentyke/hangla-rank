"use client";

import type { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Captions,
  CheckCircle2,
  Download,
  ExternalLink,
  FileVideo,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Music,
  PanelLeftOpen,
  PanelRightOpen,
  Palette,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type RankAsset = {
  id: string;
  name: string;
  url: string;
};

type ImportCandidate = {
  id: string;
  imageUrl: string;
  remoteImageUrl: string;
  sourceUrl: string;
  text: string;
  title: string;
};

type ImportProductResponse = {
  error?: string;
  items?: ImportCandidate[];
  sourceUrl?: string;
  warnings?: string[];
};

type RankRow = {
  id: string;
  label: string;
  color: string;
};

type PhaseName = "focus" | "place";
type TimelinePhaseName = PhaseName | "intro";
type TtsProvider = "mimo" | "custom";

type PhaseVoiceText = Record<PhaseName, string>;

type GenerationStep = {
  id: string;
  assetId: string;
  targetRowId: string;
  phaseVoiceText: PhaseVoiceText;
  nextStepId: string | null;
};

type RenderRect = {
  x: number;
  y: number;
  size: number;
};

type OutputSize = {
  width: number;
  height: number;
};

type PreparedPhase = {
  id: string;
  step: GenerationStep | null;
  stepIndex: number;
  phase: TimelinePhaseName;
  voiceText: string;
  audioBuffer: AudioBuffer | null;
  animationMs: number;
  durationMs: number;
  startMs: number;
  endMs: number;
};

type PreparedPhaseDraft = Omit<PreparedPhase, "audioBuffer" | "durationMs" | "startMs" | "endMs">;

type PreparedTimeline = {
  phases: PreparedPhase[];
  chain: GenerationStep[];
  totalDurationMs: number;
};

type FfmpegTools = {
  fetchFile: (input: Blob | File | string) => Promise<Uint8Array>;
};

type SavedWorkspaceAsset = {
  id: string;
  name: string;
  dataUrl: string;
};

type WorkspaceState = {
  rows: RankRow[];
  assets: RankAsset[];
  selectedRowId: string;
  title: string;
  subtitle: string;
  tableRatioPreset: TableRatioPresetId;
  customTableRatioWidth: string;
  customTableRatioHeight: string;
  introText: string;
  generationSteps: GenerationStep[];
  subtitlesEnabled: boolean;
  bgmEnabled: boolean;
  ttsProvider: TtsProvider;
  mimoVoice: MimoVoiceId;
  mimoStyle: string;
  ttsApiTemplate: string;
  defaultPauseMs: number;
  importUrl: string;
};

type SavedWorkspaceFile = {
  app: "hangla-rank";
  version: 1;
  savedAt: string;
  state: Omit<WorkspaceState, "assets"> & {
    assets: SavedWorkspaceAsset[];
  };
};

const OUTPUT_LONG_EDGE = 3840;
const TABLE_MARGIN_X = 144;
const TABLE_TOP = 360;
const TABLE_MAX_HEIGHT = 1500;
const TABLE_MAX_WIDTH = OUTPUT_LONG_EDGE - TABLE_MARGIN_X * 2;
const DEFAULT_TABLE_ASPECT_RATIO = TABLE_MAX_WIDTH / TABLE_MAX_HEIGHT;
const FRAME_RATE = 30;
const FFMPEG_CORE_VERSION = "0.12.10";
const FFMPEG_CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
const BGM_AUDIO_PATH = "/audio/si-tu-vois-ma-mere.mp3";
const BGM_VOLUME = 0.18;
const BGM_FADE_SECONDS = 1.2;
const DEFAULT_TTS_PROVIDER: TtsProvider = "mimo";
const CUSTOM_TTS_PROVIDER: TtsProvider = "custom";
const DEFAULT_TTS_API_TEMPLATE = "https://freetts.org/api/tts";
const LEGACY_DEFAULT_TTS_API_TEMPLATE = "https://api.milorapart.top/apis/mbAIsc?text={text}";
const DEFAULT_MIMO_VOICE = "mimo_voice_clone_default";
const MIMO_BUILTIN_DEFAULT_VOICE = "mimo_builtin_default";
const DEFAULT_MIMO_STYLE = "自然、清晰、适合短视频解说";
const MIMO_VOICE_PREVIEW_TEXT = "这是一段 Hangla 声线试听。";
const TTS_CONCURRENCY = 3;
const TTS_MAX_RETRIES = 2;
const TTS_RETRY_BASE_DELAY_MS = 1200;
const TTS_PROVIDER_STORAGE_KEY = "hangla-tts-provider";
const MIMO_VOICE_STORAGE_KEY = "hangla-mimo-voice";
const MIMO_STYLE_STORAGE_KEY = "hangla-mimo-style";
const TTS_API_TEMPLATE_STORAGE_KEY = "hangla-tts-api-template";
const WORKSPACE_FILE_APP = "hangla-rank";
const WORKSPACE_FILE_VERSION = 1;

const phaseLabels: Record<PhaseName, string> = {
  focus: "居中放大展示",
  place: "缩小归位",
};

const phaseAnimationMs: Record<PhaseName, number> = {
  focus: 900,
  place: 1000,
};
const introAnimationMs = 1000;

const rowPalette = [
  "#ff2a1f",
  "#ff7a1a",
  "#f3a331",
  "#f4ff36",
  "#c8ff3d",
  "#27d95f",
  "#15d6b5",
  "#24b8ff",
  "#0057ff",
  "#7b4dff",
  "#c64dff",
  "#ff5bbd",
  "#ff9fb2",
  "#ffe6bf",
  "#ffffff",
  "#d9d9d9",
  "#8f8f8f",
  "#000000",
];

const defaultRows: RankRow[] = [
  { id: "hang", label: "夯", color: "#ff2a1f" },
  { id: "top", label: "顶级", color: "#f3a331" },
  { id: "elite", label: "人上人", color: "#f4ff36" },
  { id: "npc", label: "NPC", color: "#ffe6bf" },
  { id: "la", label: "拉完了", color: "#ffffff" },
];

const tableRatioPresets = [
  { id: "default", label: "默认 2.37:1", aspectRatio: DEFAULT_TABLE_ASPECT_RATIO },
  { id: "16:9", label: "16:9", aspectRatio: 16 / 9 },
  { id: "2:1", label: "2:1", aspectRatio: 2 },
  { id: "21:9", label: "21:9", aspectRatio: 21 / 9 },
  { id: "3:2", label: "3:2", aspectRatio: 3 / 2 },
  { id: "4:3", label: "4:3", aspectRatio: 4 / 3 },
  { id: "1:1", label: "1:1", aspectRatio: 1 },
  { id: "custom", label: "自定义", aspectRatio: null },
] as const;

type TableRatioPresetId = (typeof tableRatioPresets)[number]["id"];

const ttsProviderOptions = [
  { id: "mimo", label: "MiMo v2.5 TTS" },
  { id: "custom", label: "自定义 TTS API" },
] as const;

const mimoVoiceOptions = [
  { id: "mimo_voice_clone_default", label: "默认克隆声线" },
  { id: MIMO_BUILTIN_DEFAULT_VOICE, label: "MiMo 内置默认声线" },
  { id: "Mia", label: "Mia" },
  { id: "Chloe", label: "Chloe" },
  { id: "Milo", label: "Milo" },
  { id: "Dean", label: "Dean" },
] as const;

type MimoVoiceId = (typeof mimoVoiceOptions)[number]["id"];
const legacyMimoVoiceIds = new Set(["default_zh", "default_en", "mimo_default"]);

const emptyVoiceText: PhaseVoiceText = {
  focus: "",
  place: "",
};

const uid = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2);
};

const clamp = (value: number, min = 0, max = 1) => Math.min(Math.max(value, min), max);

const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

const getRowTextColor = (_color: string) => "#000000";
const getRowInitial = (label: string) => Array.from(label.trim())[0] ?? "?";
const normalizeTtsApiTemplate = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === LEGACY_DEFAULT_TTS_API_TEMPLATE) return DEFAULT_TTS_API_TEMPLATE;
  return trimmed;
};

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const revokeAssetUrl = (url: string) => {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
};

const getRecorderMimeType = () =>
  [
    "video/mp4",
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";

function hasValidCustomTableRatio(widthValue: string, heightValue: string) {
  const width = Number(widthValue);
  const height = Number(heightValue);

  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function normalizeTableAspectRatio(value: number) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TABLE_ASPECT_RATIO;

  return clamp(value, 0.5, 4);
}

function roundToEven(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function getTableAspectRatio(
  presetId: TableRatioPresetId,
  customWidthValue: string,
  customHeightValue: string,
) {
  const preset = tableRatioPresets.find((item) => item.id === presetId);
  if (preset?.aspectRatio) return preset.aspectRatio;
  if (!hasValidCustomTableRatio(customWidthValue, customHeightValue)) return DEFAULT_TABLE_ASPECT_RATIO;

  return normalizeTableAspectRatio(Number(customWidthValue) / Number(customHeightValue));
}

function getOutputSize(tableAspectRatio: number): OutputSize {
  const normalizedRatio = normalizeTableAspectRatio(tableAspectRatio);

  if (normalizedRatio >= 1) {
    return {
      width: OUTPUT_LONG_EDGE,
      height: roundToEven(OUTPUT_LONG_EDGE / normalizedRatio),
    };
  }

  return {
    width: roundToEven(OUTPUT_LONG_EDGE * normalizedRatio),
    height: OUTPUT_LONG_EDGE,
  };
}

function getLayoutScale(outputSize: OutputSize) {
  return Math.min(outputSize.width / OUTPUT_LONG_EDGE, outputSize.height / 2160);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readFiniteNumber(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function isTableRatioPresetId(value: string): value is TableRatioPresetId {
  return tableRatioPresets.some((preset) => preset.id === value);
}

function isTtsProvider(value: string): value is TtsProvider {
  return ttsProviderOptions.some((option) => option.id === value);
}

function isMimoVoiceId(value: string): value is MimoVoiceId {
  return mimoVoiceOptions.some((option) => option.id === value);
}

function normalizeMimoVoiceId(value: string) {
  const trimmed = value.trim();
  if (!trimmed || legacyMimoVoiceIds.has(trimmed)) return DEFAULT_MIMO_VOICE;
  return isMimoVoiceId(trimmed) ? trimmed : DEFAULT_MIMO_VOICE;
}

function isRetryableTtsError(error: unknown) {
  if (!(error instanceof Error)) return false;

  return /(?:408|425|429|500|502|503|504|524|timeout|timed out|network|failed to fetch|aborted)/i.test(
    error.message,
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

function isImportableImageUrl(value: string) {
  return value.startsWith("data:image/") || value.startsWith("/") || /^https?:\/\//i.test(value);
}

function readWorkspaceRows(value: unknown) {
  if (!Array.isArray(value)) throw new Error("工作区 JSON 缺少有效的行设置。");

  const rows = value
    .filter(isRecord)
    .map((row) => ({
      id: readString(row.id).trim(),
      label: readString(row.label, "未命名行"),
      color: readString(row.color, "#ffffff"),
    }))
    .filter((row) => row.id);

  if (!rows.length) throw new Error("工作区 JSON 至少需要保留一行。");
  return rows;
}

function readWorkspaceAssets(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isRecord)
    .map((asset) => {
      const id = readString(asset.id).trim();
      const name = readString(asset.name, "导入素材");
      const url = readString(asset.dataUrl) || readString(asset.url);

      if (!id || !url || !isImportableImageUrl(url)) return null;
      return { id, name, url };
    })
    .filter((asset): asset is RankAsset => Boolean(asset));
}

function readWorkspaceVoiceText(value: unknown): PhaseVoiceText {
  if (!isRecord(value)) return { ...emptyVoiceText };

  return {
    focus: readString(value.focus),
    place: readString(value.place),
  };
}

function readWorkspaceSteps(value: unknown, assets: RankAsset[], rows: RankRow[]) {
  if (!Array.isArray(value)) return [];

  const assetIds = new Set(assets.map((asset) => asset.id));
  const rowIds = new Set(rows.map((row) => row.id));
  const usedStepIds = new Set<string>();
  const steps: GenerationStep[] = [];

  value.filter(isRecord).forEach((step) => {
    const assetId = readString(step.assetId).trim();
    if (!assetIds.has(assetId)) return;

    const importedId = readString(step.id).trim();
    const id = importedId && !usedStepIds.has(importedId) ? importedId : uid();
    const importedTargetRowId = readString(step.targetRowId).trim();
    usedStepIds.add(id);

    steps.push({
      id,
      assetId,
      targetRowId: rowIds.has(importedTargetRowId) ? importedTargetRowId : rows[0].id,
      phaseVoiceText: readWorkspaceVoiceText(step.phaseVoiceText),
      nextStepId: null,
    });
  });

  return buildStepChain(steps);
}

function readWorkspaceState(value: unknown): WorkspaceState {
  if (!isRecord(value)) throw new Error("请选择有效的工作区 JSON 文件。");
  if (value.app && value.app !== WORKSPACE_FILE_APP) throw new Error("这不是 Hangla 工作区 JSON。");

  const rawState = isRecord(value.state) ? value.state : value;
  const rows = readWorkspaceRows(rawState.rows);
  const assets = readWorkspaceAssets(rawState.assets);
  const importedSelectedRowId = readString(rawState.selectedRowId).trim();
  const importedPresetId = readString(rawState.tableRatioPreset, "default");
  const importedTtsProvider = readString(rawState.ttsProvider, DEFAULT_TTS_PROVIDER);
  const defaultPauseMs = Math.max(0, readFiniteNumber(rawState.defaultPauseMs, 900));

  return {
    rows,
    assets,
    selectedRowId: rows.some((row) => row.id === importedSelectedRowId) ? importedSelectedRowId : rows[0].id,
    title: readString(rawState.title, "从夯到拉排行榜"),
    subtitle: readString(rawState.subtitle),
    tableRatioPreset: isTableRatioPresetId(importedPresetId) ? importedPresetId : "default",
    customTableRatioWidth: readString(rawState.customTableRatioWidth, "296"),
    customTableRatioHeight: readString(rawState.customTableRatioHeight, "125"),
    introText: readString(rawState.introText),
    generationSteps: readWorkspaceSteps(rawState.generationSteps, assets, rows),
    subtitlesEnabled: readBoolean(rawState.subtitlesEnabled, true),
    bgmEnabled: readBoolean(rawState.bgmEnabled, true),
    ttsProvider: isTtsProvider(importedTtsProvider) ? importedTtsProvider : DEFAULT_TTS_PROVIDER,
    mimoVoice: normalizeMimoVoiceId(readString(rawState.mimoVoice, DEFAULT_MIMO_VOICE)),
    mimoStyle: readString(rawState.mimoStyle, DEFAULT_MIMO_STYLE),
    ttsApiTemplate: normalizeTtsApiTemplate(readString(rawState.ttsApiTemplate, DEFAULT_TTS_API_TEMPLATE)),
    defaultPauseMs,
    importUrl: readString(rawState.importUrl, "chargedb.cn"),
  };
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("素材读取失败。"));
    reader.readAsDataURL(blob);
  });
}

export default function Home() {
  const [rows, setRows] = useState<RankRow[]>(defaultRows);
  const [assets, setAssets] = useState<RankAsset[]>([]);
  const [selectedRowId, setSelectedRowId] = useState(defaultRows[0].id);
  const [title, setTitle] = useState("从夯到拉排行榜");
  const [subtitle, setSubtitle] = useState("");
  const [tableRatioPreset, setTableRatioPreset] = useState<TableRatioPresetId>("default");
  const [customTableRatioWidth, setCustomTableRatioWidth] = useState("296");
  const [customTableRatioHeight, setCustomTableRatioHeight] = useState("125");
  const [introText, setIntroText] = useState("");
  const [generationSteps, setGenerationSteps] = useState<GenerationStep[]>([]);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [bgmEnabled, setBgmEnabled] = useState(true);
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>(DEFAULT_TTS_PROVIDER);
  const [mimoVoice, setMimoVoice] = useState<MimoVoiceId>(DEFAULT_MIMO_VOICE);
  const [mimoStyle, setMimoStyle] = useState(DEFAULT_MIMO_STYLE);
  const [ttsApiTemplate, setTtsApiTemplate] = useState(DEFAULT_TTS_API_TEMPLATE);
  const [defaultPauseMs, setDefaultPauseMs] = useState(900);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("待生成");
  const [errorMessage, setErrorMessage] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [importUrl, setImportUrl] = useState("chargedb.cn");
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSearchQuery, setImportSearchQuery] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [workspaceTransferMessage, setWorkspaceTransferMessage] = useState("");
  const [workspaceTransferError, setWorkspaceTransferError] = useState(false);
  const [previewingMimoVoice, setPreviewingMimoVoice] = useState<MimoVoiceId | null>(null);
  const [mimoPreviewMessage, setMimoPreviewMessage] = useState("");
  const [mimoPreviewError, setMimoPreviewError] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegToolsRef = useRef<FfmpegTools | null>(null);
  const assetsRef = useRef<RankAsset[]>([]);
  const videoUrlRef = useRef("");
  const workspaceImportInputRef = useRef<HTMLInputElement | null>(null);
  const mimoPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const mimoPreviewUrlRef = useRef("");

  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const selectedRow = rows.find((row) => row.id === selectedRowId) ?? rows[0];
  const selectedImportCount = selectedImportIds.size;
  const tableAspectRatio = useMemo(
    () => getTableAspectRatio(tableRatioPreset, customTableRatioWidth, customTableRatioHeight),
    [customTableRatioHeight, customTableRatioWidth, tableRatioPreset],
  );
  const outputSize = useMemo(() => getOutputSize(tableAspectRatio), [tableAspectRatio]);
  const filteredImportCandidates = useMemo(() => {
    const keyword = importSearchQuery.trim().toLowerCase();
    if (!keyword) return importCandidates;

    return importCandidates.filter((candidate) => candidate.title.toLowerCase().includes(keyword));
  }, [importCandidates, importSearchQuery]);

  const chainSteps = useMemo(() => buildStepChain(generationSteps), [generationSteps]);

  useEffect(() => {
    setGenerationSteps((currentSteps) => {
      const assetIds = new Set(assets.map((asset) => asset.id));
      const currentByAssetId = new Map(currentSteps.map((step) => [step.assetId, step]));
      const existing = currentSteps.filter((step) => assetIds.has(step.assetId));
      const missing = assets
        .filter((asset) => !currentByAssetId.has(asset.id))
        .map((asset) => ({
          id: uid(),
          assetId: asset.id,
          targetRowId: selectedRowId,
          phaseVoiceText: { ...emptyVoiceText },
          nextStepId: null,
        }));

      return buildStepChain([...existing, ...missing]);
    });
  }, [assets, selectedRowId]);

  useEffect(() => {
    setGenerationSteps((currentSteps) =>
      buildStepChain(
        currentSteps.map((step) =>
          rowMap.has(step.targetRowId) ? step : { ...step, targetRowId: rows[0]?.id ?? "" },
        ),
      ),
    );
  }, [rowMap, rows]);

  useEffect(() => {
    if (selectedRow && !rowMap.has(selectedRowId)) {
      setSelectedRowId(selectedRow.id);
    }
  }, [rowMap, selectedRow, selectedRowId]);

  useEffect(() => {
    if (isGenerating) return;
    let cancelled = false;

    const render = async () => {
      await preloadImages();
      if (!cancelled) {
        renderStaticPreview();
      }
    };

    void render();

    return () => {
      cancelled = true;
    };
  }, [assets, chainSteps, rows, subtitlesEnabled, title, subtitle, tableAspectRatio, isGenerating]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);

  useEffect(() => {
    const storedTtsProvider = window.localStorage.getItem(TTS_PROVIDER_STORAGE_KEY);
    if (storedTtsProvider && isTtsProvider(storedTtsProvider)) {
      setTtsProvider(storedTtsProvider);
    }

    const storedMimoVoice = window.localStorage.getItem(MIMO_VOICE_STORAGE_KEY);
    if (storedMimoVoice) {
      const normalizedMimoVoice = normalizeMimoVoiceId(storedMimoVoice);
      setMimoVoice(normalizedMimoVoice);
      if (normalizedMimoVoice !== storedMimoVoice) {
        window.localStorage.setItem(MIMO_VOICE_STORAGE_KEY, normalizedMimoVoice);
      }
    }

    const storedMimoStyle = window.localStorage.getItem(MIMO_STYLE_STORAGE_KEY);
    if (storedMimoStyle) {
      setMimoStyle(storedMimoStyle);
    }

    const storedTtsApiTemplate = window.localStorage.getItem(TTS_API_TEMPLATE_STORAGE_KEY);
    if (storedTtsApiTemplate) {
      const normalizedTtsApiTemplate = normalizeTtsApiTemplate(storedTtsApiTemplate);
      setTtsApiTemplate(normalizedTtsApiTemplate);
      if (normalizedTtsApiTemplate !== storedTtsApiTemplate) {
        window.localStorage.setItem(TTS_API_TEMPLATE_STORAGE_KEY, normalizedTtsApiTemplate);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      assetsRef.current.forEach((asset) => revokeAssetUrl(asset.url));
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      mimoPreviewAudioRef.current?.pause();
      if (mimoPreviewUrlRef.current) URL.revokeObjectURL(mimoPreviewUrlRef.current);
    };
  }, []);

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));

    if (!files.length) return;

    const nextAssets = files.map((file) => ({
      id: uid(),
      name: file.name.replace(/\.[^/.]+$/, ""),
      url: URL.createObjectURL(file),
    }));

    setAssets((currentAssets) => [...currentAssets, ...nextAssets]);
    event.target.value = "";
  };

  const importProducts = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isImporting) return;

    const rawUrl = importUrl.trim();
    if (!rawUrl) {
      setImportError("请输入官网链接。");
      return;
    }

    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    setImportUrl(url);
    setIsImporting(true);
    setImportError("");
    setImportWarnings([]);

    try {
      const response = await fetch("/api/import-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json().catch(() => ({}))) as ImportProductResponse;

      if (!response.ok) {
        throw new Error(payload.error || `导入接口请求失败：${response.status}`);
      }

      const items = payload.items ?? [];
      if (!items.length) {
        throw new Error("未找到可导入的产品项。");
      }

      setImportCandidates(items);
      setSelectedImportIds(new Set(items.map((item) => item.id)));
      setImportSearchQuery("");
      setImportWarnings(payload.warnings ?? []);
      setImportDialogOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败。";
      setImportError(message);
      setImportCandidates([]);
      setImportSearchQuery("");
      setSelectedImportIds(new Set());
    } finally {
      setIsImporting(false);
    }
  };

  const toggleImportCandidate = (candidateId: string) => {
    setSelectedImportIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(candidateId)) {
        nextIds.delete(candidateId);
      } else {
        nextIds.add(candidateId);
      }
      return nextIds;
    });
  };

  const selectAllImportCandidates = () => {
    setSelectedImportIds((currentIds) => {
      const nextIds = new Set(currentIds);
      filteredImportCandidates.forEach((candidate) => nextIds.add(candidate.id));
      return nextIds;
    });
  };

  const clearImportCandidates = () => {
    if (!importSearchQuery.trim()) {
      setSelectedImportIds(new Set());
      return;
    }

    setSelectedImportIds((currentIds) => {
      const nextIds = new Set(currentIds);
      filteredImportCandidates.forEach((candidate) => nextIds.delete(candidate.id));
      return nextIds;
    });
  };

  const addSelectedImportCandidates = () => {
    const selectedCandidates = importCandidates.filter((candidate) => selectedImportIds.has(candidate.id));
    if (!selectedCandidates.length) {
      setImportError("请至少选择一个产品项。");
      return;
    }

    setAssets((currentAssets) => {
      const existingUrls = new Set(currentAssets.map((asset) => asset.url));
      const nextAssets = selectedCandidates
        .filter((candidate) => !existingUrls.has(candidate.imageUrl))
        .map((candidate) => ({
          id: uid(),
          name: candidate.title || candidate.text || "导入产品",
          url: candidate.imageUrl,
        }));

      return [...currentAssets, ...nextAssets];
    });

    setImportDialogOpen(false);
    setImportError("");
    setImportSearchQuery("");
  };

  const removeAsset = (assetId: string) => {
    setAssets((currentAssets) => {
      const target = currentAssets.find((asset) => asset.id === assetId);
      if (target) revokeAssetUrl(target.url);
      return currentAssets.filter((asset) => asset.id !== assetId);
    });
    imageCacheRef.current.delete(assetId);
  };

  const updateAssetName = (assetId: string, value: string) => {
    setAssets((currentAssets) =>
      currentAssets.map((asset) => (asset.id === assetId ? { ...asset, name: value } : asset)),
    );
  };

  const commitAssetName = (assetId: string) => {
    setAssets((currentAssets) =>
      currentAssets.map((asset) => {
        if (asset.id !== assetId) return asset;
        const name = asset.name.trim();
        return { ...asset, name: name || "未命名素材" };
      }),
    );
  };

  const updateRow = (rowId: string, patch: Partial<Pick<RankRow, "label" | "color">>) => {
    setRows((currentRows) => currentRows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    const nextRow = {
      id: uid(),
      label: "新行",
      color: rowPalette[rows.length % rowPalette.length],
    };

    setRows((currentRows) => [...currentRows, nextRow]);
    setSelectedRowId(nextRow.id);
  };

  const deleteRow = (rowId: string) => {
    if (rows.length <= 1) return;

    const nextRows = rows.filter((row) => row.id !== rowId);
    const fallbackRowId = nextRows[0]?.id ?? defaultRows[0].id;

    setRows(nextRows);
    setGenerationSteps((currentSteps) =>
      buildStepChain(
        currentSteps.map((step) => (step.targetRowId === rowId ? { ...step, targetRowId: fallbackRowId } : step)),
      ),
    );

    if (selectedRowId === rowId) {
      setSelectedRowId(fallbackRowId);
    }
  };

  const resetRows = () => {
    setRows(defaultRows);
    setSelectedRowId(defaultRows[0].id);
    setGenerationSteps((currentSteps) =>
      buildStepChain(currentSteps.map((step) => ({ ...step, targetRowId: defaultRows[0].id }))),
    );
  };

  const handleRowDragStart = (event: DragEvent<HTMLElement>, rowId: string) => {
    event.dataTransfer.setData("application/x-hangla-row", rowId);
    event.dataTransfer.effectAllowed = "move";
    setDraggingRowId(rowId);
  };

  const handleRowDragOver = (event: DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("application/x-hangla-row")) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleRowDrop = (event: DragEvent<HTMLElement>, targetRowId: string) => {
    event.preventDefault();
    const movingRowId = event.dataTransfer.getData("application/x-hangla-row");
    if (!movingRowId || movingRowId === targetRowId) return;

    const targetBounds = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY > targetBounds.top + targetBounds.height / 2 ? "after" : "before";

    setRows((currentRows) => reorderByDropPosition(currentRows, movingRowId, targetRowId, placement));
    setDraggingRowId(null);
  };

  const updateStep = (stepId: string, patch: Partial<GenerationStep>) => {
    setGenerationSteps((currentSteps) =>
      buildStepChain(currentSteps.map((step) => (step.id === stepId ? { ...step, ...patch } : step))),
    );
  };

  const updateStepVoice = (stepId: string, phase: PhaseName, value: string) => {
    setGenerationSteps((currentSteps) =>
      buildStepChain(
        currentSteps.map((step) =>
          step.id === stepId
            ? { ...step, phaseVoiceText: { ...step.phaseVoiceText, [phase]: value } }
            : step,
        ),
      ),
    );
  };

  const updateTtsProvider = (value: string) => {
    if (!isTtsProvider(value)) return;

    if (value !== DEFAULT_TTS_PROVIDER) {
      stopMimoVoicePreview();
      setPreviewingMimoVoice(null);
    }
    setTtsProvider(value);
    window.localStorage.setItem(TTS_PROVIDER_STORAGE_KEY, value);
  };

  const updateMimoVoice = (value: string) => {
    if (!isMimoVoiceId(value)) return;

    setMimoVoice(value);
    window.localStorage.setItem(MIMO_VOICE_STORAGE_KEY, value);
  };

  const updateMimoStyle = (value: string) => {
    setMimoStyle(value);
    window.localStorage.setItem(MIMO_STYLE_STORAGE_KEY, value.trim() || DEFAULT_MIMO_STYLE);
  };

  const stopMimoVoicePreview = () => {
    mimoPreviewAudioRef.current?.pause();
    mimoPreviewAudioRef.current = null;

    if (mimoPreviewUrlRef.current) {
      URL.revokeObjectURL(mimoPreviewUrlRef.current);
      mimoPreviewUrlRef.current = "";
    }
  };

  const previewMimoVoice = async (voiceId: MimoVoiceId) => {
    if (isGenerating) return;

    const voiceLabel = mimoVoiceOptions.find((option) => option.id === voiceId)?.label ?? voiceId;
    stopMimoVoicePreview();
    setPreviewingMimoVoice(voiceId);
    setMimoPreviewError(false);
    setMimoPreviewMessage(`正在试听 ${voiceLabel}`);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "mp3",
          provider: DEFAULT_TTS_PROVIDER,
          style: mimoStyle.trim() || DEFAULT_MIMO_STYLE,
          text: MIMO_VOICE_PREVIEW_TEXT,
          voice: voiceId,
        }),
      });

      if (!response.ok) {
        let message = `声线试听失败：${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) message = payload.error;
        } catch {
          // Keep the status-based fallback when the upstream response is not JSON.
        }

        throw new Error(message);
      }

      const audioUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl);
      mimoPreviewAudioRef.current = audio;
      mimoPreviewUrlRef.current = audioUrl;

      audio.onended = () => {
        if (mimoPreviewAudioRef.current !== audio) return;
        stopMimoVoicePreview();
        setPreviewingMimoVoice(null);
        setMimoPreviewError(false);
        setMimoPreviewMessage(`已试听 ${voiceLabel}`);
      };
      audio.onerror = () => {
        if (mimoPreviewAudioRef.current !== audio) return;
        stopMimoVoicePreview();
        setPreviewingMimoVoice(null);
        setMimoPreviewError(true);
        setMimoPreviewMessage("试听音频播放失败。");
      };

      await audio.play();
      setMimoPreviewMessage(`正在播放 ${voiceLabel}`);
    } catch (error) {
      stopMimoVoicePreview();
      setPreviewingMimoVoice(null);
      setMimoPreviewError(true);
      setMimoPreviewMessage(error instanceof Error ? error.message : "声线试听失败。");
    }
  };

  const updateTtsApiTemplate = (value: string) => {
    const nextValue = normalizeTtsApiTemplate(value);
    setTtsApiTemplate(value);
    window.localStorage.setItem(TTS_API_TEMPLATE_STORAGE_KEY, nextValue);
  };

  const moveStep = (stepId: string, direction: -1 | 1) => {
    setGenerationSteps((currentSteps) => {
      const index = currentSteps.findIndex((step) => step.id === stepId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= currentSteps.length) return currentSteps;

      const nextSteps = [...currentSteps];
      const [movingStep] = nextSteps.splice(index, 1);
      nextSteps.splice(nextIndex, 0, movingStep);
      return buildStepChain(nextSteps);
    });
  };

  const handleStepDragStart = (event: DragEvent<HTMLElement>, stepId: string) => {
    event.dataTransfer.setData("application/x-hangla-step", stepId);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleStepDrop = (event: DragEvent<HTMLElement>, targetStepId: string) => {
    event.preventDefault();
    const movingStepId = event.dataTransfer.getData("application/x-hangla-step");
    if (!movingStepId || movingStepId === targetStepId) return;

    setGenerationSteps((currentSteps) => {
      const movingStep = currentSteps.find((step) => step.id === movingStepId);
      if (!movingStep) return currentSteps;

      const withoutMoving = currentSteps.filter((step) => step.id !== movingStepId);
      const targetIndex = withoutMoving.findIndex((step) => step.id === targetStepId);
      if (targetIndex < 0) return currentSteps;

      const nextSteps = [...withoutMoving];
      nextSteps.splice(targetIndex, 0, movingStep);
      return buildStepChain(nextSteps);
    });
  };

  const preloadImages = async () => {
    await Promise.all(
      assets.map(
        (asset) =>
          new Promise<void>((resolve) => {
            const cachedImage = imageCacheRef.current.get(asset.id);
            if (cachedImage?.complete) {
              resolve();
              return;
            }

            const image = new Image();
            image.onload = () => {
              imageCacheRef.current.set(asset.id, image);
              resolve();
            };
            image.onerror = () => resolve();
            image.src = asset.url;
          }),
      ),
    );
  };

  const renderStaticPreview = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = outputSize.width;
    canvas.height = outputSize.height;

    const context = canvas.getContext("2d");
    if (!context) return;

    drawCanvasFrame(context, {
      activePhase: null,
      assetMap,
      chain: chainSteps,
      imageCache: imageCacheRef.current,
      placedAssetIds: new Set(chainSteps.map((step) => step.assetId)),
      rows,
      subtitle,
      subtitlesEnabled: false,
      outputSize,
      tableAspectRatio,
      title,
    });
  };

  const exportImage = async () => {
    await preloadImages();
    renderStaticPreview();

    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "hangla-rank-4k.png";
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const serializeWorkspaceAsset = async (asset: RankAsset): Promise<SavedWorkspaceAsset> => {
    if (asset.url.startsWith("data:image/")) {
      return { id: asset.id, name: asset.name, dataUrl: asset.url };
    }

    const response = await fetch(asset.url);
    if (!response.ok) {
      throw new Error(`素材「${asset.name}」读取失败：${response.status}`);
    }

    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith("image/")) {
      throw new Error(`素材「${asset.name}」不是可保存的图片。`);
    }

    return {
      id: asset.id,
      name: asset.name,
      dataUrl: await blobToDataUrl(blob),
    };
  };

  const saveWorkspace = async () => {
    if (isSavingWorkspace || isGenerating) return;

    setIsSavingWorkspace(true);
    setWorkspaceTransferError(false);
    setWorkspaceTransferMessage("正在保存工作区");

    try {
      const workspaceFile: SavedWorkspaceFile = {
        app: WORKSPACE_FILE_APP,
        version: WORKSPACE_FILE_VERSION,
        savedAt: new Date().toISOString(),
        state: {
          rows,
          assets: await Promise.all(assets.map(serializeWorkspaceAsset)),
          selectedRowId,
          title,
          subtitle,
          tableRatioPreset,
          customTableRatioWidth,
          customTableRatioHeight,
          introText,
          generationSteps: buildStepChain(generationSteps),
          subtitlesEnabled,
          bgmEnabled,
          ttsProvider,
          mimoVoice,
          mimoStyle: mimoStyle.trim() || DEFAULT_MIMO_STYLE,
          ttsApiTemplate,
          defaultPauseMs,
          importUrl,
        },
      };
      const blob = new Blob([JSON.stringify(workspaceFile, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `hangla-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setWorkspaceTransferMessage(`已保存 ${assets.length} 个素材、${generationSteps.length} 个步骤`);
    } catch (error) {
      setWorkspaceTransferError(true);
      setWorkspaceTransferMessage(error instanceof Error ? error.message : "工作区保存失败。");
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const applyWorkspaceState = (workspaceState: WorkspaceState) => {
    assetsRef.current.forEach((asset) => revokeAssetUrl(asset.url));
    imageCacheRef.current.clear();

    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = "";
    }

    setRows(workspaceState.rows);
    setAssets(workspaceState.assets);
    setSelectedRowId(workspaceState.selectedRowId);
    setTitle(workspaceState.title);
    setSubtitle(workspaceState.subtitle);
    setTableRatioPreset(workspaceState.tableRatioPreset);
    setCustomTableRatioWidth(workspaceState.customTableRatioWidth);
    setCustomTableRatioHeight(workspaceState.customTableRatioHeight);
    setIntroText(workspaceState.introText);
    setGenerationSteps(workspaceState.generationSteps);
    setSubtitlesEnabled(workspaceState.subtitlesEnabled);
    setBgmEnabled(workspaceState.bgmEnabled);
    setTtsProvider(workspaceState.ttsProvider);
    setMimoVoice(workspaceState.mimoVoice);
    setMimoStyle(workspaceState.mimoStyle);
    const normalizedTtsApiTemplate = normalizeTtsApiTemplate(workspaceState.ttsApiTemplate);
    setTtsApiTemplate(normalizedTtsApiTemplate);
    setDefaultPauseMs(workspaceState.defaultPauseMs);
    setImportUrl(workspaceState.importUrl);
    setErrorMessage("");
    setStatusMessage("工作区已导入");
    setVideoUrl("");
    window.localStorage.setItem(TTS_PROVIDER_STORAGE_KEY, workspaceState.ttsProvider);
    window.localStorage.setItem(MIMO_VOICE_STORAGE_KEY, workspaceState.mimoVoice);
    window.localStorage.setItem(MIMO_STYLE_STORAGE_KEY, workspaceState.mimoStyle);
    window.localStorage.setItem(TTS_API_TEMPLATE_STORAGE_KEY, normalizedTtsApiTemplate);
  };

  const importWorkspace = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || isGenerating) return;

    setWorkspaceTransferError(false);
    setWorkspaceTransferMessage("正在导入工作区");

    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const workspaceState = readWorkspaceState(payload);
      applyWorkspaceState(workspaceState);
      setWorkspaceTransferMessage(`已导入 ${workspaceState.assets.length} 个素材、${workspaceState.generationSteps.length} 个步骤`);
    } catch (error) {
      setWorkspaceTransferError(true);
      setWorkspaceTransferMessage(error instanceof Error ? error.message : "工作区导入失败。");
    } finally {
      event.target.value = "";
    }
  };

  const validateGeneration = () => {
    if (!assets.length) return "请先上传图片素材。";
    if (!generationSteps.length) return "请先配置动画步骤。";

    const assetIds = new Set(assets.map((asset) => asset.id));
    const stepAssetIds = generationSteps.map((step) => step.assetId);
    const uniqueStepAssetIds = new Set(stepAssetIds);

    if (uniqueStepAssetIds.size !== stepAssetIds.length) return "动画步骤里存在重复素材。";
    if (uniqueStepAssetIds.size !== assetIds.size) return "动画步骤未覆盖所有素材。";

    for (const step of generationSteps) {
      if (!assetIds.has(step.assetId)) return "动画步骤包含已删除素材。";
      if (!rowMap.has(step.targetRowId)) return "每个动画步骤都需要选择目标行。";
    }

    if (defaultPauseMs < 0) return "默认停顿时间不能为负数。";
    if (!canvasRef.current?.captureStream) return "当前浏览器不支持 Canvas 录制。";
    if (typeof MediaRecorder === "undefined") return "当前浏览器不支持视频录制。";
    if (!getRecorderMimeType()) return "当前浏览器不支持 WebM 录制。";
    if (tableRatioPreset === "custom" && !hasValidCustomTableRatio(customTableRatioWidth, customTableRatioHeight)) {
      return "自定义表格比例需要填写大于 0 的宽和高。";
    }

    return "";
  };

  const generateVideo = async () => {
    if (isGenerating) return;

    const validationError = validateGeneration();
    if (validationError) {
      setErrorMessage(validationError);
      setStatusMessage("待修正");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    stopMimoVoicePreview();
    setPreviewingMimoVoice(null);
    setIsGenerating(true);
    setErrorMessage("");
    setStatusMessage("准备素材");

    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl("");
    }

    const audioContext = new AudioContext();

    try {
      await audioContext.resume();
      await preloadImages();

      const timeline = await prepareTimeline(audioContext);
      const bgmBuffer = bgmEnabled ? await fetchBuiltInBgm(audioContext) : null;

      setStatusMessage(`录制动画（${Math.ceil(timeline.totalDurationMs / 1000)} 秒）`);
      const recordedBlob = await recordTimeline(canvas, timeline, audioContext, bgmBuffer);
      let mp4Blob = recordedBlob;

      if (!recordedBlob.type.includes("mp4")) {
        setStatusMessage("加载 MP4 转码器");
        const { ffmpeg, fetchFile } = await loadFfmpeg();

        setStatusMessage("转码 MP4");
        mp4Blob = await transcodeWebmToMp4(ffmpeg, fetchFile, recordedBlob);
      } else {
        setStatusMessage("封装 MP4");
        mp4Blob = new Blob([recordedBlob], { type: "video/mp4" });
      }

      setVideoUrl(URL.createObjectURL(mp4Blob));
      setStatusMessage("生成完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setErrorMessage(message);
      setStatusMessage("生成失败");
    } finally {
      await audioContext.close().catch(() => undefined);
      setIsGenerating(false);
      renderStaticPreview();
    }
  };

  const prepareTimeline = async (audioContext: AudioContext): Promise<PreparedTimeline> => {
    const chain = buildStepChain(generationSteps);
    const phaseDrafts: PreparedPhaseDraft[] = [];
    const introVoiceText = introText.trim();

    if (introVoiceText) {
      phaseDrafts.push({
        id: "intro",
        step: null,
        stepIndex: 0,
        phase: "intro",
        voiceText: introVoiceText,
        animationMs: introAnimationMs,
      });
    }

    for (const [stepIndex, step] of chain.entries()) {
      for (const phase of Object.keys(phaseLabels) as PhaseName[]) {
        const voiceText = step.phaseVoiceText[phase].trim();
        const animationMs = phaseAnimationMs[phase];

        phaseDrafts.push({
          id: `${step.id}-${phase}`,
          step,
          stepIndex,
          phase,
          voiceText,
          animationMs,
        });
      }
    }

    const voiceDrafts = phaseDrafts.filter((draft) => draft.voiceText);
    const audioBuffers = new Map<string, AudioBuffer>();

    if (voiceDrafts.length) {
      let completedVoices = 0;
      setStatusMessage(`生成语音 0/${voiceDrafts.length}`);

      const voiceResults = await mapWithConcurrency(voiceDrafts, TTS_CONCURRENCY, async (draft) => {
        const audioBuffer = await fetchVoiceAudio(draft.voiceText, audioContext);
        completedVoices += 1;
        setStatusMessage(`生成语音 ${completedVoices}/${voiceDrafts.length}`);
        return { audioBuffer, id: draft.id };
      });

      voiceResults.forEach((result) => audioBuffers.set(result.id, result.audioBuffer));
    }

    const phases: PreparedPhase[] = [];
    let cursorMs = 0;

    for (const draft of phaseDrafts) {
      const audioBuffer = audioBuffers.get(draft.id) ?? null;
      const voiceMs = audioBuffer ? audioBuffer.duration * 1000 + 300 : 0;
      const durationMs = Math.max(draft.animationMs + defaultPauseMs, voiceMs || draft.animationMs + defaultPauseMs);

      phases.push({
        ...draft,
        audioBuffer,
        durationMs,
        startMs: cursorMs,
        endMs: cursorMs + durationMs,
      });

      cursorMs += durationMs;
    }

    return {
      phases,
      chain,
      totalDurationMs: Math.max(cursorMs, 1000),
    };
  };

  const fetchVoiceAudio = async (text: string, audioContext: AudioContext) => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= TTS_MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiUrlTemplate: ttsApiTemplate.trim() || DEFAULT_TTS_API_TEMPLATE,
            provider: ttsProvider,
            style: mimoStyle.trim() || DEFAULT_MIMO_STYLE,
            text,
            voice: mimoVoice,
          }),
        });

        if (!response.ok) {
          let message = `语音生成失败：${response.status}`;
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload.error) message = payload.error;
          } catch {
            // Ignore invalid error JSON and use the status-based fallback.
          }

          throw new Error(message);
        }

        const arrayBuffer = await response.arrayBuffer();
        return audioContext.decodeAudioData(arrayBuffer.slice(0));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("语音生成失败");

        if (attempt >= TTS_MAX_RETRIES || !isRetryableTtsError(lastError)) {
          break;
        }

        setStatusMessage(`语音失败重试 ${attempt + 1}/${TTS_MAX_RETRIES}`);
        await wait(TTS_RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }

    throw lastError ?? new Error("语音生成失败");
  };

  const fetchBuiltInBgm = async (audioContext: AudioContext) => {
    setStatusMessage("加载内置 BGM");
    const response = await fetch(BGM_AUDIO_PATH, { cache: "force-cache" });

    if (!response.ok) {
      throw new Error(`内置 BGM 加载失败：${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return audioContext.decodeAudioData(arrayBuffer.slice(0));
  };

  const recordTimeline = async (
    canvas: HTMLCanvasElement,
    timeline: PreparedTimeline,
    audioContext: AudioContext,
    bgmBuffer: AudioBuffer | null,
  ) => {
    canvas.width = outputSize.width;
    canvas.height = outputSize.height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法获取画布上下文。");

    const firstFrameState = getFrameState(timeline, 0);
    drawCanvasFrame(context, {
      ...firstFrameState,
      assetMap,
      chain: timeline.chain,
      imageCache: imageCacheRef.current,
      rows,
      subtitle,
      subtitlesEnabled,
      outputSize,
      tableAspectRatio,
      title,
    });

    const canvasStream = canvas.captureStream(FRAME_RATE);
    const audioDestination = audioContext.createMediaStreamDestination();
    const silentGain = audioContext.createGain();
    const oscillator = audioContext.createOscillator();
    silentGain.gain.value = 0;
    oscillator.connect(silentGain).connect(audioDestination);

    const delayMs = 250;
    const audioStartAt = audioContext.currentTime + delayMs / 1000;
    const timelineSeconds = timeline.totalDurationMs / 1000;
    const audioEndAt = audioStartAt + timelineSeconds;

    if (bgmBuffer) {
      const bgmSource = audioContext.createBufferSource();
      const bgmGain = audioContext.createGain();
      const fadeInSeconds = Math.min(BGM_FADE_SECONDS, timelineSeconds / 2);
      const fadeOutSeconds = Math.min(BGM_FADE_SECONDS, timelineSeconds / 2);
      const fadeInEndAt = audioStartAt + fadeInSeconds;
      const fadeOutStartAt = audioStartAt + Math.max(timelineSeconds - fadeOutSeconds, fadeInSeconds);

      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;
      bgmGain.gain.setValueAtTime(0, audioStartAt);
      bgmGain.gain.linearRampToValueAtTime(BGM_VOLUME, fadeInEndAt);
      if (fadeOutStartAt > fadeInEndAt) {
        bgmGain.gain.setValueAtTime(BGM_VOLUME, fadeOutStartAt);
      }
      bgmGain.gain.linearRampToValueAtTime(0, audioEndAt);
      bgmSource.connect(bgmGain).connect(audioDestination);
      bgmSource.start(audioStartAt);
      bgmSource.stop(audioEndAt + 0.35);
    }

    timeline.phases.forEach((phase) => {
      if (!phase.audioBuffer) return;

      const source = audioContext.createBufferSource();
      source.buffer = phase.audioBuffer;
      source.connect(audioDestination);
      source.start(audioStartAt + phase.startMs / 1000);
    });

    oscillator.start(audioStartAt);
    oscillator.stop(audioStartAt + timeline.totalDurationMs / 1000 + 0.5);

    const mediaStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);
    const mimeType = getRecorderMimeType();
    const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    const chunks: BlobPart[] = [];

    const completed = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => reject(new Error("视频录制失败。"));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
    });

    const startedAt = performance.now() + delayMs;
    recorder.start(1000);

    const drawFrame = (now: number) => {
      const elapsedMs = clamp(now - startedAt, 0, timeline.totalDurationMs);
      const frameState = getFrameState(timeline, elapsedMs);
      drawCanvasFrame(context, {
        ...frameState,
        assetMap,
        chain: timeline.chain,
        imageCache: imageCacheRef.current,
        rows,
        subtitle,
        subtitlesEnabled,
        outputSize,
        tableAspectRatio,
        title,
      });

      if (elapsedMs < timeline.totalDurationMs) {
        window.requestAnimationFrame(drawFrame);
        return;
      }

      window.setTimeout(() => recorder.stop(), 180);
    };

    window.requestAnimationFrame(drawFrame);
    const blob = await completed;
    mediaStream.getTracks().forEach((track) => track.stop());
    canvasStream.getTracks().forEach((track) => track.stop());
    await wait(100);
    return blob;
  };

  const loadFfmpeg = async () => {
    if (ffmpegRef.current && ffmpegToolsRef.current) {
      return { ffmpeg: ffmpegRef.current, fetchFile: ffmpegToolsRef.current.fetchFile };
    }

    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util"),
    ]);
    const ffmpeg = new FFmpeg();

    await ffmpeg.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });

    ffmpegRef.current = ffmpeg;
    ffmpegToolsRef.current = { fetchFile };

    return { ffmpeg, fetchFile };
  };

  const transcodeWebmToMp4 = async (
    ffmpeg: FFmpeg,
    fetchFile: FfmpegTools["fetchFile"],
    webmBlob: Blob,
  ) => {
    const inputName = "hangla-input.webm";
    const outputName = "hangla-output.mp4";

    await ffmpeg.writeFile(inputName, await fetchFile(webmBlob));
    await ffmpeg.exec([
      "-i",
      inputName,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "faststart",
      outputName,
    ]);

    const data = await ffmpeg.readFile(outputName);
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);

    if (typeof data === "string") {
      return new Blob([new TextEncoder().encode(data)], { type: "video/mp4" });
    }

    const arrayBuffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(arrayBuffer).set(data);
    return new Blob([arrayBuffer], { type: "video/mp4" });
  };

  return (
    <main className="app-shell">
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="product-import-dialog">
          <DialogHeader className="product-import-dialog-header">
            <DialogTitle>选择导入产品</DialogTitle>
            <DialogDescription>
              找到 {importCandidates.length} 个可导入产品
              {importSearchQuery.trim() ? `，当前显示 ${filteredImportCandidates.length} 个` : ""}，选择后会添加到素材列表。
            </DialogDescription>
          </DialogHeader>

          <div className="product-import-dialog-body">
            <div className="import-search-row">
              <label className="import-search-field">
                <Search size={16} />
                <Input
                  aria-label="搜索导入产品"
                  placeholder="搜索产品标题"
                  value={importSearchQuery}
                  onChange={(event) => setImportSearchQuery(event.target.value)}
                />
              </label>
              {importSearchQuery && (
                <Button type="button" size="sm" variant="outline" onClick={() => setImportSearchQuery("")}>
                  清除
                </Button>
              )}
            </div>

            <div className="import-selection-toolbar">
              <span>
                已选择 {selectedImportCount} / {importCandidates.length}
              </span>
              <div className="import-selection-actions">
                <Button type="button" size="sm" variant="outline" onClick={selectAllImportCandidates}>
                  全选
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={clearImportCandidates}>
                  清空
                </Button>
              </div>
            </div>

            {importWarnings.length > 0 && (
              <div className="import-warning" role="status">
                <AlertCircle size={16} />
                <span>{importWarnings.slice(0, 3).join("；")}</span>
              </div>
            )}

            <div className="import-candidate-list">
              {filteredImportCandidates.length === 0 ? (
                <div className="import-empty-result">
                  <Search size={18} />
                  <span>没有匹配的产品</span>
                </div>
              ) : (
                filteredImportCandidates.map((candidate) => {
                const checked = selectedImportIds.has(candidate.id);

                return (
                  <article className={`import-candidate-card ${checked ? "selected" : ""}`} key={candidate.id}>
                    <label className="import-candidate-main">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleImportCandidate(candidate.id)}
                      />
                      <img src={candidate.imageUrl} alt={candidate.title} />
                      <span className="import-candidate-copy">
                        <strong>{candidate.title}</strong>
                        {candidate.text && <span>{candidate.text}</span>}
                      </span>
                    </label>
                    <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="import-source-link">
                      来源
                      <ExternalLink size={13} />
                    </a>
                  </article>
                );
                })
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportDialogOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={addSelectedImportCandidates} disabled={selectedImportCount === 0}>
              添加选中
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet>
        <SheetTrigger asChild>
          <Button className="control-trigger left" size="lg">
            <PanelLeftOpen size={18} />
            控制台
          </Button>
        </SheetTrigger>
        <SheetContent className="control-sheet" side="left">
          <SheetHeader className="control-sheet-header">
            <SheetTitle>排行榜控制台</SheetTitle>
            <SheetDescription>调整行、素材和当前画面导出。</SheetDescription>
          </SheetHeader>

          <div className="control-panel" aria-label="排行榜控制台">
            <div className="panel-section">
              <Label htmlFor="rank-title">标题</Label>
              <Input id="rank-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Label htmlFor="rank-subtitle">视频副标题</Label>
              <Input id="rank-subtitle" value={subtitle} onChange={(event) => setSubtitle(event.target.value)} />
              <Label htmlFor="table-ratio-preset">生成表格比例</Label>
              <div className="table-ratio-control">
                <select
                  id="table-ratio-preset"
                  value={tableRatioPreset}
                  onChange={(event) => setTableRatioPreset(event.target.value as TableRatioPresetId)}
                >
                  {tableRatioPresets.map((preset) => (
                    <option value={preset.id} key={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                {tableRatioPreset === "custom" && (
                  <div className="custom-ratio-row">
                    <Input
                      aria-label="自定义表格比例宽"
                      min={1}
                      step={1}
                      type="number"
                      value={customTableRatioWidth}
                      onChange={(event) => setCustomTableRatioWidth(event.target.value)}
                    />
                    <span>:</span>
                    <Input
                      aria-label="自定义表格比例高"
                      min={1}
                      step={1}
                      type="number"
                      value={customTableRatioHeight}
                      onChange={(event) => setCustomTableRatioHeight(event.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="panel-section">
              <div className="section-heading">
                <h2>行设置</h2>
                <Button type="button" size="icon" title="新增一行" onClick={addRow}>
                  <Plus size={16} />
                </Button>
              </div>
              <div className="row-editor">
                {rows.map((row) => (
                  <div
                    className={`row-config ${row.id === selectedRowId ? "active" : ""} ${
                      row.id === draggingRowId ? "dragging" : ""
                    }`}
                    key={row.id}
                    onDragOver={handleRowDragOver}
                    onDrop={(event) => handleRowDrop(event, row.id)}
                  >
                    <Button
                      className="row-select"
                      draggable
                      size="icon"
                      title="拖动排序，点击选择"
                      type="button"
                      variant="outline"
                      onDragEnd={() => setDraggingRowId(null)}
                      onDragStart={(event) => handleRowDragStart(event, row.id)}
                      onClick={() => setSelectedRowId(row.id)}
                    >
                      <span style={{ background: row.color }} />
                      <GripVertical size={15} />
                    </Button>
                    <Input
                      aria-label="行名称"
                      value={row.label}
                      onChange={(event) => updateRow(row.id, { label: event.target.value })}
                    />
                    <div aria-label="选择行色" className="palette-menu" role="button" tabIndex={0} title="选择行色">
                      <Palette size={15} />
                      <div className="palette-swatches">
                        {rowPalette.map((color) => (
                          <Button
                            aria-label={`设置为 ${color}`}
                            className={row.color === color ? "selected" : ""}
                            key={color}
                            size="icon"
                            style={{ background: color, color: getRowTextColor(color) }}
                            type="button"
                            variant="outline"
                            onClick={() => updateRow(row.id, { color })}
                          />
                        ))}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      title="删除行"
                      variant="outline"
                      disabled={rows.length <= 1}
                      onClick={() => deleteRow(row.id)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-section">
              <div className="section-heading">
                <h2>素材管理</h2>
                <div className="asset-actions">
                  <Button asChild variant="outline">
                    <a href="/docs/import-product" target="_blank" rel="noreferrer" title="查看产品导入对接文档">
                      <ExternalLink size={16} />
                      对接文档
                    </a>
                  </Button>
                  <Button asChild>
                    <Label className="upload-button" htmlFor="asset-upload" title="导入图片素材">
                      <Upload size={18} />
                      导入
                    </Label>
                  </Button>
                </div>
                <input
                  id="asset-upload"
                  className="hidden-file-input"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFiles}
                />
              </div>

              <form className="product-import-form" onSubmit={importProducts}>
                <Label htmlFor="product-import-url">官网链接</Label>
                <div className="product-import-row">
                  <Input
                    id="product-import-url"
                    type="text"
                    inputMode="url"
                    placeholder="chargedb.cn"
                    value={importUrl}
                    onChange={(event) => setImportUrl(event.target.value)}
                    disabled={isImporting}
                  />
                  <Button type="submit" disabled={isImporting}>
                    {isImporting ? <Loader2 className="spin" size={17} /> : <Search size={17} />}
                    API 导入
                  </Button>
                </div>
                <p className={`field-hint ${importError ? "error" : ""}`}>
                  {importError || "输入官网域名后会弹出可选择的产品。"}
                </p>
              </form>

              <div className="asset-list">
                {assets.length === 0 ? (
                  <div className="empty-assets">
                    <ImageIcon size={24} />
                    <span>素材会显示在这里</span>
                  </div>
                ) : (
                  assets.map((asset) => {
                    const step = generationSteps.find((item) => item.assetId === asset.id);

                    return (
                      <article className="asset-card" key={asset.id}>
                        <img src={asset.url} alt={asset.name || "未命名素材"} />
                        <label className="asset-name-field">
                          <span>
                            <Pencil size={13} />
                            名称
                          </span>
                          <Input
                            aria-label={`重命名 ${asset.name || "未命名素材"}`}
                            className="asset-name-input"
                            value={asset.name}
                            onBlur={() => commitAssetName(asset.id)}
                            onChange={(event) => updateAssetName(asset.id, event.target.value)}
                          />
                        </label>
                        <div className="asset-row-picker" aria-label="素材目标行" role="radiogroup">
                          {rows.map((row) => {
                            const isSelected = (step?.targetRowId ?? selectedRow.id) === row.id;

                            return (
                              <button
                                aria-checked={isSelected}
                                aria-label={row.label || "未命名行"}
                                className={isSelected ? "selected" : ""}
                                disabled={!step}
                                key={row.id}
                                role="radio"
                                style={
                                  isSelected ? { background: row.color, color: getRowTextColor(row.color) } : undefined
                                }
                                type="button"
                                onClick={() => step && updateStep(step.id, { targetRowId: row.id })}
                              >
                                {getRowInitial(row.label)}
                              </button>
                            );
                          })}
                        </div>
                        <Button
                          size="icon-sm"
                          type="button"
                          title="移除素材"
                          variant="outline"
                          onClick={() => removeAsset(asset.id)}
                        >
                          <X size={16} />
                        </Button>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            <div className="panel-section export-section">
              <Button type="button" variant="outline" title="导出当前 4K 画面" onClick={exportImage}>
                <Download size={18} />
                导出 4K 图片
              </Button>
              <Button type="button" variant="outline" onClick={resetRows}>
                <RotateCcw size={16} />
                重置行
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet>
        <SheetTrigger asChild>
          <Button className="control-trigger right" size="lg">
            <PanelRightOpen size={18} />
            生成区域
          </Button>
        </SheetTrigger>
        <SheetContent className="control-sheet generator-sheet" side="right">
          <SheetHeader className="control-sheet-header">
            <SheetTitle>视频生成</SheetTitle>
            <SheetDescription>配置语音、动画步骤、字幕和 MP4 输出。</SheetDescription>
          </SheetHeader>

          <div className="control-panel" aria-label="视频生成区域">
            <div className="panel-section">
              <Label htmlFor="intro-text">视频开始前的文案（可选）</Label>
              <textarea
                id="intro-text"
                className="text-area"
                placeholder="这段文案会在第一张图片开始选择前播放，可配合字幕显示。"
                value={introText}
                onChange={(event) => setIntroText(event.target.value)}
              />
              <p className="field-hint">这段会作为开场语音单独生成，之后才进入下面的动画步骤。</p>
            </div>

            <div className="panel-section">
              <Label htmlFor="tts-provider">TTS 引擎</Label>
              <select
                id="tts-provider"
                value={ttsProvider}
                onChange={(event) => updateTtsProvider(event.target.value)}
              >
                {ttsProviderOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>

              {ttsProvider === DEFAULT_TTS_PROVIDER ? (
                <>
                  <Label>MiMo 声线</Label>
                  <div className="voice-option-list" id="mimo-voice" role="radiogroup" aria-label="MiMo 声线">
                    {mimoVoiceOptions.map((option) => (
                      <div className={`voice-option ${mimoVoice === option.id ? "selected" : ""}`} key={option.id}>
                        <label className="voice-option-label">
                          <input
                            type="radio"
                            checked={mimoVoice === option.id}
                            name="mimo-voice"
                            value={option.id}
                            onChange={(event) => updateMimoVoice(event.target.value)}
                          />
                          <span>{option.label}</span>
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          title={`试听 ${option.label}`}
                          variant="outline"
                          disabled={isGenerating || previewingMimoVoice !== null}
                          onClick={() => previewMimoVoice(option.id)}
                        >
                          {previewingMimoVoice === option.id ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
                          试听
                        </Button>
                      </div>
                    ))}
                  </div>
                  {mimoPreviewMessage && (
                    <p className={`field-hint ${mimoPreviewError ? "error" : ""}`}>{mimoPreviewMessage}</p>
                  )}

                  <Label htmlFor="mimo-style">MiMo 语气</Label>
                  <Input
                    id="mimo-style"
                    value={mimoStyle}
                    onChange={(event) => updateMimoStyle(event.target.value)}
                  />
                </>
              ) : (
                <>
                  <Label htmlFor="tts-api-template">TTS API 地址</Label>
                  <div className="tts-api-row">
                    <Input
                      id="tts-api-template"
                      spellCheck={false}
                      value={ttsApiTemplate}
                      onChange={(event) => updateTtsApiTemplate(event.target.value)}
                    />
                    <Button
                      type="button"
                      title="恢复默认 TTS API"
                      variant="outline"
                      onClick={() => updateTtsApiTemplate(DEFAULT_TTS_API_TEMPLATE)}
                    >
                      <RotateCcw size={16} />
                      默认
                    </Button>
                  </div>
                  <p className="field-hint">支持 {"{text}"} 占位符；不写占位符时会自动追加 text 参数。</p>
                </>
              )}
            </div>

            <div className="panel-section">
              <div className="toggle-row">
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={subtitlesEnabled}
                    onChange={(event) => setSubtitlesEnabled(event.target.checked)}
                  />
                  <span>
                    <Captions size={16} />
                    视频字幕
                  </span>
                </label>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={bgmEnabled}
                    onChange={(event) => setBgmEnabled(event.target.checked)}
                  />
                  <span>
                    <Music size={16} />
                    内置 BGM（网络来源）
                  </span>
                </label>
                <label className="pause-control">
                  默认停顿
                  <Input
                    min={0}
                    step={100}
                    type="number"
                    value={defaultPauseMs}
                    onChange={(event) => setDefaultPauseMs(Number(event.target.value))}
                  />
                  ms
                </label>
              </div>
            </div>

            <div className="panel-section">
              <div className="section-heading">
                <h2>动画步骤</h2>
                <span className="step-count">{generationSteps.length} 步</span>
              </div>

              <div className="step-list">
                {chainSteps.length === 0 ? (
                  <div className="empty-assets">
                    <ImageIcon size={24} />
                    <span>上传素材后自动生成步骤</span>
                  </div>
                ) : (
                  chainSteps.map((step, index) => {
                    const asset = assetMap.get(step.assetId);

                    return (
                      <article
                        className="step-card"
                        draggable
                        key={step.id}
                        onDragOver={(event) => event.preventDefault()}
                        onDragStart={(event) => handleStepDragStart(event, step.id)}
                        onDrop={(event) => handleStepDrop(event, step.id)}
                      >
                        <div className="step-card-header">
                          <span className="step-index">{index + 1}</span>
                          {asset ? <img src={asset.url} alt={asset.name || "未命名素材"} /> : <div className="asset-placeholder" />}
                          <div className="step-title">
                            <strong>{asset ? asset.name || "未命名素材" : "已删除素材"}</strong>
                            <span>下一步：{step.nextStepId ? index + 2 : "结束"}</span>
                          </div>
                          <div className="step-actions">
                            <Button
                              size="icon-xs"
                              type="button"
                              title="上移"
                              variant="outline"
                              disabled={index === 0}
                              onClick={() => moveStep(step.id, -1)}
                            >
                              <ArrowUp size={13} />
                            </Button>
                            <Button
                              size="icon-xs"
                              type="button"
                              title="下移"
                              variant="outline"
                              disabled={index === chainSteps.length - 1}
                              onClick={() => moveStep(step.id, 1)}
                            >
                              <ArrowDown size={13} />
                            </Button>
                          </div>
                        </div>

                        <Label htmlFor={`${step.id}-row`}>目标行</Label>
                        <select
                          id={`${step.id}-row`}
                          value={step.targetRowId}
                          onChange={(event) => updateStep(step.id, { targetRowId: event.target.value })}
                        >
                          {rows.map((row) => (
                            <option value={row.id} key={row.id}>
                              {row.label}
                            </option>
                          ))}
                        </select>

                        {(Object.keys(phaseLabels) as PhaseName[]).map((phase) => (
                          <label className="voice-field" key={phase}>
                            {phaseLabels[phase]}
                            <textarea
                              className="text-area small"
                              placeholder="可留空，留空时使用默认停顿时间。"
                              value={step.phaseVoiceText[phase]}
                              onChange={(event) => updateStepVoice(step.id, phase, event.target.value)}
                            />
                          </label>
                        ))}
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            <div className="panel-section generation-section">
              <Button type="button" title="生成 4K MP4 视频" onClick={generateVideo} disabled={isGenerating}>
                {isGenerating ? <Loader2 className="spin" size={18} /> : <FileVideo size={18} />}
                {isGenerating ? "生成中" : "生成 4K MP4"}
              </Button>

              <div className={`generation-status ${errorMessage ? "error" : videoUrl ? "success" : ""}`}>
                {errorMessage ? <AlertCircle size={17} /> : videoUrl ? <CheckCircle2 size={17} /> : <Loader2 size={17} />}
                <span>{errorMessage || statusMessage}</span>
              </div>

              {videoUrl && (
                <Button asChild variant="outline">
                  <a href={videoUrl} download="hangla-rank-4k.mp4">
                    <Download size={17} />
                    下载 MP4
                  </a>
                </Button>
              )}

              <div className="workspace-transfer-actions">
                <Button
                  type="button"
                  title="保存当前工作区 JSON"
                  variant="outline"
                  onClick={saveWorkspace}
                  disabled={isSavingWorkspace || isGenerating}
                >
                  {isSavingWorkspace ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
                  保存工作区
                </Button>
                <Button
                  type="button"
                  title="导入工作区 JSON"
                  variant="outline"
                  onClick={() => workspaceImportInputRef.current?.click()}
                  disabled={isSavingWorkspace || isGenerating}
                >
                  <Upload size={17} />
                  导入工作区
                </Button>
              </div>

              <input
                ref={workspaceImportInputRef}
                className="hidden-file-input"
                type="file"
                accept="application/json,.json"
                onChange={importWorkspace}
              />

              {workspaceTransferMessage && (
                <div className={`workspace-transfer-status ${workspaceTransferError ? "error" : ""}`} role="status">
                  {workspaceTransferError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                  <span>{workspaceTransferMessage}</span>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <section className="workspace" aria-label="动画画布">
        <div className="canvas-frame" style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }}>
          <canvas ref={canvasRef} className="render-canvas" width={outputSize.width} height={outputSize.height} />
        </div>
      </section>
    </main>
  );
}

function buildStepChain(steps: GenerationStep[]) {
  return steps.map((step, index) => ({
    ...step,
    nextStepId: steps[index + 1]?.id ?? null,
  }));
}

function reorderByDropPosition<T extends { id: string }>(
  items: T[],
  movingId: string,
  targetId: string,
  placement: "before" | "after",
) {
  const movingItem = items.find((item) => item.id === movingId);
  if (!movingItem) return items;

  const withoutMoving = items.filter((item) => item.id !== movingId);
  const targetIndex = withoutMoving.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) return items;

  const nextItems = [...withoutMoving];
  nextItems.splice(targetIndex + (placement === "after" ? 1 : 0), 0, movingItem);
  return nextItems;
}

function getFrameState(timeline: PreparedTimeline, timeMs: number) {
  const activePhase = timeline.phases.find((phase) => timeMs >= phase.startMs && timeMs < phase.endMs) ?? null;
  const placedAssetIds = new Set<string>();

  if (!activePhase) {
    timeline.chain.forEach((step) => placedAssetIds.add(step.assetId));
    return { activePhase, activeProgress: 0, placedAssetIds };
  }

  timeline.chain.slice(0, activePhase.stepIndex).forEach((step) => placedAssetIds.add(step.assetId));
  return {
    activePhase,
    activeProgress: clamp((timeMs - activePhase.startMs) / activePhase.animationMs),
    placedAssetIds,
  };
}

function drawCanvasFrame(
  context: CanvasRenderingContext2D,
  options: {
    activePhase: PreparedPhase | null;
    activeProgress?: number;
    assetMap: Map<string, RankAsset>;
    chain: GenerationStep[];
    imageCache: Map<string, HTMLImageElement>;
    outputSize: OutputSize;
    placedAssetIds: Set<string>;
    rows: RankRow[];
    subtitle: string;
    subtitlesEnabled: boolean;
    tableAspectRatio: number;
    title: string;
  },
) {
  const {
    activePhase,
    activeProgress = 0,
    assetMap,
    chain,
    imageCache,
    outputSize,
    placedAssetIds,
    rows,
    subtitle,
    subtitlesEnabled,
    tableAspectRatio,
    title,
  } = options;
  const { width, height } = outputSize;
  const rowRects = getRowRects(rows, chain, tableAspectRatio, outputSize);
  const shouldDimList = false;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  drawTitle(context, title, subtitle, outputSize);
  drawRankTable(context, {
    assetMap,
    chain,
    imageCache,
    placedAssetIds,
    rowRects,
    rows,
    dimmed: shouldDimList,
  });

  if (activePhase?.step) {
    drawActiveImageAtProgress(context, activePhase, rowRects, imageCache, assetMap, outputSize, activeProgress);
  }

  if (activePhase && subtitlesEnabled && activePhase.voiceText) {
    drawSubtitle(context, activePhase.voiceText, outputSize);
  }
}

function getRowRects(rows: RankRow[], chain: GenerationStep[], tableAspectRatio: number, outputSize: OutputSize) {
  const normalizedRatio = normalizeTableAspectRatio(tableAspectRatio);
  const scale = getLayoutScale(outputSize);
  const horizontalMargin = Math.max(48 * scale, outputSize.width * (TABLE_MARGIN_X / OUTPUT_LONG_EDGE));
  const tableRegionTop = Math.min(TABLE_TOP * scale, outputSize.height * 0.22);
  const tableRegionBottom = Math.max(48 * scale, outputSize.height * 0.05);
  const availableWidth = Math.max(320 * scale, outputSize.width - horizontalMargin * 2);
  const availableHeight = Math.max(240 * scale, outputSize.height - tableRegionTop - tableRegionBottom);
  const tableWidth = Math.min(availableWidth, availableHeight * normalizedRatio);
  const tableHeight = tableWidth / normalizedRatio;
  const tableX = (outputSize.width - tableWidth) / 2;
  const tableY = tableRegionTop + (availableHeight - tableHeight) / 2;
  const rowHeight = tableHeight / rows.length;
  const labelWidth = tableWidth * 0.2;
  const contentWidth = tableWidth - labelWidth;
  const innerPad = 38;
  const maxItemsInRow = Math.max(
    1,
    ...rows.map((row) => chain.filter((step) => step.targetRowId === row.id).length),
  );
  const idealGap = 30;
  const availableItemWidth = contentWidth - innerPad * 2 - (maxItemsInRow - 1) * idealGap;
  const verticalItemInset = Math.max(32 * scale, rowHeight * 0.12);
  const maxItemSize = rowHeight - verticalItemInset;
  const itemSize = Math.max(96, Math.min(maxItemSize, availableItemWidth / maxItemsInRow));
  const itemGap =
    maxItemsInRow > 1
      ? Math.max(14, Math.min(idealGap, (contentWidth - innerPad * 2 - itemSize * maxItemsInRow) / (maxItemsInRow - 1)))
      : idealGap;
  const assetRects = new Map<string, RenderRect>();

  rows.forEach((row, rowIndex) => {
    const rowSteps = chain.filter((step) => step.targetRowId === row.id);

    rowSteps.forEach((step, itemIndex) => {
      assetRects.set(step.assetId, {
        x: tableX + labelWidth + innerPad + itemIndex * (itemSize + itemGap),
        y: tableY + rowIndex * rowHeight + (rowHeight - itemSize) / 2,
        size: itemSize,
      });
    });
  });

  return {
    assetRects,
    itemSize,
    labelWidth,
    rowHeight,
    tableHeight,
    tableWidth,
    tableX,
    tableY,
  };
}

function drawTitle(context: CanvasRenderingContext2D, title: string, subtitle: string, outputSize: OutputSize) {
  const scale = getLayoutScale(outputSize);
  const titleSize = Math.max(42, 118 * scale);
  const subtitleSize = Math.max(18, 44 * scale);

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#000000";
  context.font = `800 ${titleSize}px Arial, "Microsoft YaHei", sans-serif`;
  context.fillText(title || "从夯到拉排行榜", outputSize.width / 2, 148 * scale);

  if (subtitle) {
    context.fillStyle = "#0057ff";
    context.font = `700 ${subtitleSize}px Arial, "Microsoft YaHei", sans-serif`;
    context.fillText(subtitle, outputSize.width / 2, 236 * scale);
  }
}

function drawRankTable(
  context: CanvasRenderingContext2D,
  options: {
    assetMap: Map<string, RankAsset>;
    chain: GenerationStep[];
    dimmed: boolean;
    imageCache: Map<string, HTMLImageElement>;
    placedAssetIds: Set<string>;
    rowRects: ReturnType<typeof getRowRects>;
    rows: RankRow[];
  },
) {
  const { assetMap, chain, dimmed, imageCache, placedAssetIds, rowRects, rows } = options;
  const { labelWidth, rowHeight, tableHeight, tableWidth, tableX, tableY } = rowRects;

  context.save();
  context.lineWidth = 18;
  context.strokeStyle = "#000000";
  context.strokeRect(tableX, tableY, tableWidth, tableHeight);

  rows.forEach((row, rowIndex) => {
    const y = tableY + rowIndex * rowHeight;

    context.save();
    context.globalAlpha = dimmed ? 0.42 : 1;
    context.fillStyle = row.color;
    context.fillRect(tableX, y, labelWidth, rowHeight);
    context.fillStyle = "#ffffff";
    context.fillRect(tableX + labelWidth, y, tableWidth - labelWidth, rowHeight);
    context.restore();

    context.strokeStyle = "#000000";
    context.lineWidth = 18;
    context.strokeRect(tableX, y, tableWidth, rowHeight);
    context.beginPath();
    context.moveTo(tableX + labelWidth, y);
    context.lineTo(tableX + labelWidth, y + rowHeight);
    context.stroke();

    context.fillStyle = getRowTextColor(row.color);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `800 ${fitText(context, row.label, labelWidth - 60, 128)}px Arial, "Microsoft YaHei", sans-serif`;
    context.fillText(row.label, tableX + labelWidth / 2, y + rowHeight / 2);
  });

  chain.forEach((step) => {
    if (!placedAssetIds.has(step.assetId)) return;

    const rect = rowRects.assetRects.get(step.assetId);
    const asset = assetMap.get(step.assetId);
    if (!rect || !asset) return;

    context.save();
    context.globalAlpha = dimmed ? 0.32 : 1;
    drawAssetTile(context, {
      image: imageCache.get(step.assetId) ?? null,
      rect,
    });
    context.restore();
  });

  context.restore();
}

function drawActiveImageAtProgress(
  context: CanvasRenderingContext2D,
  phase: PreparedPhase,
  rowRects: ReturnType<typeof getRowRects>,
  imageCache: Map<string, HTMLImageElement>,
  assetMap: Map<string, RankAsset>,
  outputSize: OutputSize,
  progress: number,
) {
  if (!phase.step) return;

  const targetRect = rowRects.assetRects.get(phase.step.assetId);
  const asset = assetMap.get(phase.step.assetId);
  if (!targetRect || !asset) return;

  const scale = getLayoutScale(outputSize);
  const centerSize = Math.max(260 * scale, Math.min(980 * scale, outputSize.width * 0.36, outputSize.height * 0.52));
  const centerRect: RenderRect = {
    x: (outputSize.width - centerSize) / 2,
    y: (outputSize.height - centerSize) / 2 + 54 * scale,
    size: centerSize,
  };
  const entrySize = centerSize * 0.84;
  const bottomEntryRect: RenderRect = {
    x: (outputSize.width - entrySize) / 2,
    y: outputSize.height + 48 * scale,
    size: entrySize,
  };
  const fromRect = phase.phase === "focus" ? bottomEntryRect : centerRect;
  const toRect = phase.phase === "focus" ? centerRect : targetRect;
  const eased = easeOutCubic(clamp(progress));
  const rect = interpolateRect(fromRect, toRect, eased);

  drawAssetTile(context, {
    image: imageCache.get(phase.step.assetId) ?? null,
    rect,
  });
}

function drawAssetTile(
  context: CanvasRenderingContext2D,
  options: {
    image: HTMLImageElement | null;
    rect: RenderRect;
  },
) {
  const { image, rect } = options;

  if (image?.complete && image.naturalWidth > 0) {
    drawImageCover(context, image, rect);
  } else {
    context.fillStyle = "#eaf2ff";
    context.fillRect(rect.x, rect.y, rect.size, rect.size);
    context.strokeStyle = "#0057ff";
    context.lineWidth = Math.max(8, rect.size * 0.04);
    context.strokeRect(rect.x + rect.size * 0.28, rect.y + rect.size * 0.32, rect.size * 0.44, rect.size * 0.36);
  }
}

function drawImageCover(context: CanvasRenderingContext2D, image: HTMLImageElement, rect: RenderRect) {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = 1;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;

  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    rect.x,
    rect.y,
    rect.size,
    rect.size,
  );
}

function drawSubtitle(context: CanvasRenderingContext2D, text: string, outputSize: OutputSize) {
  const scale = getLayoutScale(outputSize);
  const fontSize = Math.max(24, 64 * scale);
  const lineHeight = fontSize * 1.32;
  const horizontalPad = Math.max(36, 96 * scale);
  const maxWidth = Math.max(360, Math.min(outputSize.width - horizontalPad * 2, 2600 * scale));
  const lines = wrapText(context, text, maxWidth, `700 ${fontSize}px Arial, "Microsoft YaHei", sans-serif`);
  const blockPaddingY = 54 * scale;
  const blockHeight = lines.length * lineHeight + blockPaddingY;
  const blockWidth = Math.min(outputSize.width - horizontalPad * 2, maxWidth + 280 * scale);
  const x = outputSize.width / 2;
  const y = outputSize.height - 210 * scale - blockHeight / 2;

  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.72)";
  drawRoundedRect(context, x - blockWidth / 2, y - blockHeight / 2, blockWidth, blockHeight, 34 * scale);
  context.fill();

  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
  lines.forEach((line, index) => {
    context.fillText(line, x, y - ((lines.length - 1) * lineHeight) / 2 + index * lineHeight);
  });
  context.restore();
}

function interpolateRect(from: RenderRect, to: RenderRect, progress: number) {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    size: from.size + (to.size - from.size) * progress,
  };
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number) {
  let size = startSize;

  while (size > 28) {
    context.font = `800 ${size}px Arial, "Microsoft YaHei", sans-serif`;
    if (context.measureText(text).width <= maxWidth) return size;
    size -= 4;
  }

  return size;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, font: string) {
  context.font = font;
  const chars = Array.from(text);
  const lines: string[] = [];
  let currentLine = "";

  chars.forEach((char) => {
    const nextLine = currentLine + char;
    if (context.measureText(nextLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = char.trimStart();
      return;
    }
    currentLine = nextLine;
  });

  if (currentLine) lines.push(currentLine);
  return lines.slice(0, 3);
}
