import { AI_PROVIDERS, type AiProviderId, type AiSettings } from './ai-settings';

export const LANGUAGES = {
  'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: '英语', ja: '日语',
  ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', pt: '葡萄牙语',
  it: '意大利语', ru: '俄语', ar: '阿拉伯语', hi: '印地语',
  vi: '越南语', th: '泰语', id: '印尼语', nl: '荷兰语', tr: '土耳其语',
} as const;

export type Language = keyof typeof LANGUAGES;
export type SourceLanguage = Language | 'auto';
export type ReadingRange = 'visible' | 'main';
export type PdfLookAhead = number | 'all';
export const DEFAULT_PDF_LOOK_AHEAD = 2;
export function isPdfLookAhead(value: unknown): value is PdfLookAhead {
  return value === 'all' || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}
export type ReaderMode = 'dual' | 'replace' | 'bilingual';
export type ReadingOptions = { source: SourceLanguage; target: Language; range: ReadingRange };
export type Preferences = ReadingOptions & {
  dualComments: boolean;
  replaceComments: boolean;
  ratio: number;
  syncScroll: boolean;
  highlight: boolean;
  cache: boolean;
  disabledSites: string[];
  authorized: boolean;
};
export const TRANSLATION_PROVIDERS = {
  google: { label: 'Google Cloud Translation Basic', origin: 'https://translation.googleapis.com/*' },
  youdao: { label: '有道智云', origin: 'https://openapi.youdao.com/*' },
  ...AI_PROVIDERS,
} as const;
export type ProviderId = keyof typeof TRANSLATION_PROVIDERS;
export const PROVIDER_IDS = Object.keys(TRANSLATION_PROVIDERS) as ProviderId[];
export type ProviderCheck = { checkedAt: number; error?: ErrorCode };
export type ProviderStatus = {
  configured: boolean;
  consent: boolean;
  hostPermission: boolean;
  lastCheck: ProviderCheck | null;
  appKeySuffix?: string;
};
export type PublicSettings = Omit<Preferences, 'authorized'> & {
  pdfLookAhead: PdfLookAhead;
  paragraphShortcut: string;
  provider: ProviderId;
  providers: Record<ProviderId, ProviderStatus>;
  aiServices: Record<AiProviderId, AiSettings | null>;
};
export type YoudaoCredentials = { appKey: string; appSecret: string };
export const MAX_YOUDAO_CREDENTIAL_LENGTH = 250;

export const defaults: Preferences = {
  dualComments: false, replaceComments: false,
  source: 'auto', target: 'zh-CN', range: 'visible', ratio: 0.5,
  syncScroll: true, highlight: true, cache: true, disabledSites: [], authorized: false,
};

export const LIMITS = { batchItems: 24, batchChars: 4500, minRatio: .35, maxRatio: .7 };

export const errors = {
  'unsupported-page': '此页面无法使用网页翻译。',
  'site-disabled': '此站点已在设置中禁用。',
  'sensitive-site': '此页面可能包含敏感内容。请确认可发送页面文本后再开启。',
  'not-configured': '请在设置中填写当前翻译服务的凭据。',
  'consent-required': '请在设置中确认文本外发并授予翻译服务访问权限。',
  'narrow': '窗口过窄，请扩大到至少 960 像素。',
  'reading-view-unavailable': '无法读取这个阅读窗口中的正文。请返回文章网页，再开启翻译。',
  'reading-view-changed': '阅读视图已切换，请在当前视图重新开启翻译。',
  'layout-start': '网页布局检查未通过，已恢复原网页。本次尚未发送网页文本进行翻译。',
  'incompatible': '双栏布局已失效，已恢复原网页。',
  'no-text': '未找到可翻译的可见文本。',
  'changed': '原网页内容已变化，请重新开启翻译。',
  'authentication': '翻译服务拒绝了请求，请检查凭据和 API 开通状态。',
  'quota': '翻译服务的配额或计费不可用。',
  'unsupported-language': '翻译服务不支持此语言设置。',
  'rate-limit': '翻译服务请求过多，请稍后重试。',
  'timeout': '翻译请求超时，可重试失败段落。',
  'ai-connect-timeout': '等待翻译服务首次响应超时，请检查网络或稍后重试。',
  'network': '无法连接翻译服务，请检查网络。',
  'invalid-response': '翻译服务返回了无法匹配的结果。',
  'ai-config': '请填写有效的 HTTPS Chat Completions 地址、模型和 API 密钥。',
  'ai-endpoint': 'AI 服务找不到接口或模型，请检查地址和模型名称。',
  'provider-error': '翻译服务暂时无法处理该请求。',
  'provider-changed': '当前翻译服务已切换，请重新开启翻译。',
  'config-changed': '翻译配置在测试期间发生变化，请重新测试。',
  'stale': '本次翻译已结束，请重新开启翻译。',
  'unavailable': '当前页面连接已中断，请刷新页面后重试。',
} as const;

export type ErrorCode = keyof typeof errors;
export type Failure = { ok: false; error: ErrorCode };
export type Result<T> = { ok: true; value: T } | Failure;
export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = (error: ErrorCode): Failure => ({ ok: false, error });

export type Session = ReadingOptions & {
  dualComments?: boolean;
  replaceComments?: boolean;
  id: string;
  mode?: ReaderMode;
  pageUrl?: string;
  ratio: number;
  syncScroll: boolean;
  highlight: boolean;
  cache: boolean;
};
export type TaskStatus = 'preparing' | 'translating' | 'paused' | 'partial' | 'ready' | 'error';
export type ReaderState = {
  status: TaskStatus; done: number; total: number; failed: number; error?: ErrorCode; cacheBytes?: number;
  mode?: ReaderMode;
  options?: ReadingOptions;
};
export type PageState = {
  settings: PublicSettings; reader: ReaderState | null; selectionEnabled: boolean; paragraphEnabled: boolean;
  hostname?: string; sensitive: boolean; error?: ErrorCode;
};
export type TranslationItem = { id: string; text: string };
export type BatchResult = { id: string; items: TranslationItem[] };

export type ReaderControl = 'pause' | 'resume' | 'retry' | 'stop';
type StartTranslation = { tabId: number; provider: ProviderId; options: ReadingOptions; confirmSensitive: boolean };
export type PopupMessage =
  | { type: 'page'; tabId: number }
  | { type: 'switch-provider'; tabId: number; provider: ProviderId }
  | (StartTranslation & { type: 'start'; mode?: ReaderMode })
  | (StartTranslation & { type: 'selection-start' | 'paragraph-start' })
  | { type: 'selection-stop' | 'paragraph-stop'; tabId: number }
  | { type: 'control'; tabId: number; command: ReaderControl };
export type OptionsMessage =
  | { type: 'settings' }
  | { type: 'save-pdf-range'; pdfLookAhead: PdfLookAhead }
  | { type: 'save-shortcut'; shortcut: string }
  | { type: 'save'; preferences: Omit<Preferences, 'authorized'>; scope?: 'reading' | 'sites' }
  | { type: 'save-google'; key?: string; authorized: boolean }
  | { type: 'save-youdao'; credentials?: YoudaoCredentials | null; authorized: boolean }
  | { type: 'save-ai'; provider: AiProviderId; config: (AiSettings & { apiKey?: string }) | null; authorized: boolean }
  | { type: 'test-provider'; provider: ProviderId }
  | { type: 'select-provider'; provider: ProviderId }
  | { type: 'clear-cache' | 'cache-usage' }
  | { type: 'reset' };
export type ReaderRequest =
  | { type: 'batch'; sessionId: string; batchId: string; items: TranslationItem[]; pageUrl?: string }
  | { type: 'cancel'; sessionId: string; batchId: string }
  | { type: 'switch-mode'; sessionId: string; mode: ReaderMode; pageUrl: string }
  | { type: 'closed'; sessionId: string }
  | { type: 'resize'; sessionId: string; ratio: number };
export type ReaderCommand =
  | { type: 'reader:state' | `reader:${ReaderControl}` }
  | { type: 'reader:clear-cache'; disable?: boolean }
  | { type: 'reader:switch-mode'; previousSessionId: string; session: Session }
  | { type: 'reader:start'; session: Session };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.hasOwn(TRANSLATION_PROVIDERS, value);
}

export function selectedProviderAccess(settings: PublicSettings) {
  const { configured, consent, hostPermission } = settings.providers[settings.provider];
  return { configured, authorized: consent && hostPermission };
}
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.hasOwn(LANGUAGES, value);
}
export function isReaderMode(value: unknown): value is ReaderMode {
  return value === 'dual' || value === 'replace' || value === 'bilingual';
}
export function isReadingOptions(value: unknown): value is ReadingOptions {
  return isRecord(value) && (value.source === 'auto' || isLanguage(value.source)) &&
    isLanguage(value.target) && (value.range === 'visible' || value.range === 'main');
}
export function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
export function isSensitive(hostname: string, pathname: string) {
  return /(^|[.\/-])(bank|banking|pay|payments?|admin|console|login|signin|vault|password)(?=$|[.\/-])/i
    .test(hostname + pathname);
}
export function clampRatio(ratio: number) {
  return Math.min(LIMITS.maxRatio, Math.max(LIMITS.minRatio, ratio));
}
