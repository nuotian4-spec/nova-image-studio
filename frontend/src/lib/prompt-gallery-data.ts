import type {
  LocalPromptRecord,
  LocalPromptType,
  PromptGalleryData,
  PromptGalleryItem,
  PromptGallerySection,
} from '@/lib/prompt-gallery-types';

export interface PromptDataSource {
  name: string;
  url: string;
  sourceUrl: string;
  type: string;
  baseUrl?: string;
  caseFiles?: string[];
  modelTag?: string;
}

export type PromptWithKey = PromptGalleryItem & { uniqueKey: string };

export const PROMPT_DATA_SOURCES: PromptDataSource[] = [
  {
    name: 'nanobanana',
    url: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/unknowlei/nanobanana-website/refs/heads/main/public/data.json',
    sourceUrl: 'https://github.com/unknowlei/nanobanana-website',
    type: 'nanobanana',
  },
  {
    name: 'canghe-gpt-image-2',
    url: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/cases.json',
    sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2',
    baseUrl: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data',
    type: 'canghe-cases-json',
  },
  {
    name: 'awesome-gpt-image',
    url: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main/README.zh-CN.md',
    sourceUrl: 'https://github.com/ZeroLu/awesome-gpt-image',
    baseUrl: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main',
    type: 'markdown-awesome',
  },
  {
    name: 'awesome-gpt4o-image-prompts',
    url: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main/README.zh-CN.md',
    sourceUrl: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts',
    baseUrl: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main',
    type: 'markdown-gpt4o',
  },
  {
    name: 'youmind-nano-banana-pro',
    url: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main/README_zh.md',
    sourceUrl: 'https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts',
    baseUrl: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main',
    type: 'markdown-youmind',
    modelTag: 'nano-banana-pro',
  },
];

/** 广场固定 13 类 taxonomy（不含「全部」），顺序即 UI 展示顺序 */
export const TAXONOMY_CATEGORIES = [
  'UI 与界面',
  '图表与信息可视化',
  '海报与排版',
  '商品与电商',
  '品牌与标志',
  '建筑与空间',
  '摄影与写实',
  '插画与艺术',
  '人物与角色',
  '场景与叙事',
  '历史与古风题材',
  '文档与出版物',
  '其他应用场景',
] as const;

export const DEFAULT_CATEGORIES = ['全部', ...TAXONOMY_CATEGORIES];

export const ALL_CATEGORY = '全部';

export const LOCAL_PROMPT_SOURCE = 'local';
export const LOCAL_PROMPT_SOURCE_LABEL = '本站';
export const LOCAL_CATEGORY = '本站';
export const LOCAL_PROMPT_WRITE_HEADER = 'x-prompt-gallery-password';

const TAXONOMY_SET: ReadonlySet<string> = new Set(TAXONOMY_CATEGORIES);

/** 苍何 / 官方英文 category → 13 类中文 */
const ENGLISH_CATEGORY_MAP: Record<string, string> = {
  'Architecture & Spaces': '建筑与空间',
  'Brand & Logos': '品牌与标志',
  'Characters & People': '人物与角色',
  'Charts & Infographics': '图表与信息可视化',
  'Documents & Publishing': '文档与出版物',
  'History & Classical Themes': '历史与古风题材',
  'History & Classical Chinese Themes': '历史与古风题材',
  'Illustration & Art': '插画与艺术',
  'Other Use Cases': '其他应用场景',
  'Photography & Realism': '摄影与写实',
  'Posters & Typography': '海报与排版',
  'Products & E-commerce': '商品与电商',
  'Scenes & Storytelling': '场景与叙事',
  'UI & Interfaces': 'UI 与界面',
};

/** 旧广场中文 / 模型名 → 13 类 */
const LEGACY_CATEGORY_MAP: Record<string, string> = {
  '海报': '海报与排版',
  '角色': '人物与角色',
  '电商': '商品与电商',
  'UI': 'UI 与界面',
  '风格转换': '插画与艺术',
  'gpt-image-2': '其他应用场景',
  'gpt4o': '其他应用场景',
  '其他': '其他应用场景',
};

/** styles 白名单：英文 → 中文 tag；不收录 Scenes / Other Use Cases / scene 轴 */
const STYLE_TAG_WHITELIST: Record<string, string> = {
  '3D': '3D',
  Architecture: '建筑',
  Brand: '品牌',
  Character: '角色',
  Characters: '角色',
  Charts: '图表',
  Classical: '古典',
  Documents: '文档',
  History: '历史',
  Illustration: '插画',
  Infographic: '信息图',
  Photography: '摄影',
  Poster: '海报',
  Product: '商品',
  Products: '商品',
  Realistic: '写实',
  UI: '界面',
};

export function canonicalizeCategory(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '其他应用场景';
  if (TAXONOMY_SET.has(value)) return value;
  if (ENGLISH_CATEGORY_MAP[value]) return ENGLISH_CATEGORY_MAP[value];
  if (LEGACY_CATEGORY_MAP[value]) return LEGACY_CATEGORY_MAP[value];
  return '其他应用场景';
}

function canonicalizeStyleTags(styles: unknown): string[] {
  if (!Array.isArray(styles)) return [];
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of styles) {
    const mapped = STYLE_TAG_WHITELIST[String(raw ?? '').trim()];
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    tags.push(mapped);
  }
  return tags;
}

function isXPostUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i.test(url);
}

/** 从 GitHub 来源链接推导展示名（owner/repo），用于来源列表展示 */
export function getPromptSourceLabel(sourceUrl: string, source?: string): string {
  if (isLocalPrompt({ source, sourceUrl })) return LOCAL_PROMPT_SOURCE_LABEL;
  return sourceUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
}

export function isLocalPrompt(prompt: { source?: string; sourceUrl?: string } | null | undefined): boolean {
  if (!prompt) return false;
  const source = String(prompt.source || '').trim();
  return source === LOCAL_PROMPT_SOURCE || source === LOCAL_PROMPT_SOURCE_LABEL;
}

export function canEditGalleryPrompt(prompt: { source?: string; sourceUrl?: string } | null | undefined): boolean {
  return isLocalPrompt(prompt);
}

function normalizeLocalPromptType(type: unknown): LocalPromptType {
  return Number(type) === 2 ? 2 : 1;
}

export function mapLocalPromptRecords(records: unknown): PromptWithKey[] {
  if (!Array.isArray(records)) return [];
  const prompts: PromptWithKey[] = [];
  records.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as LocalPromptRecord;
    const title = String(item.title || '').trim();
    const content = String(item.content || '').trim();
    if (!title || !content) return;
    const localType = normalizeLocalPromptType(item.type);
    const id = String(item.id || '').trim() || `local-${index}`;
    prompts.push({
      id,
      title,
      content,
      images: [],
      tags: [localType === 2 ? '图生图' : '文生图'],
      contributor: LOCAL_PROMPT_SOURCE_LABEL,
      notes: '',
      source: LOCAL_PROMPT_SOURCE,
      category: LOCAL_CATEGORY,
      uniqueKey: `local-${id}`,
      localType,
    });
  });
  return prompts;
}

export function mergePromptGallerySources(existing: PromptWithKey[], local: PromptWithKey[]): PromptWithKey[] {
  const remote = existing.filter(item => !isLocalPrompt(item));
  return [...local, ...remote];
}

export function mergePromptGalleryCategories(remoteCategories: string[], local: PromptWithKey[]): string[] {
  // 旧名 canonicalize，避免「海报」「其他」泄漏；发现的新名字也不得插入第 14 类
  for (const raw of remoteCategories) {
    if (raw === ALL_CATEGORY || raw === LOCAL_CATEGORY) continue;
    canonicalizeCategory(raw);
  }
  if (local.length === 0) return [...DEFAULT_CATEGORIES];
  return [ALL_CATEGORY, LOCAL_CATEGORY, ...TAXONOMY_CATEGORIES];
}

export function pinLocalGalleryPrompts(prompts: PromptWithKey[]): PromptWithKey[] {
  const local: PromptWithKey[] = [];
  const remote: PromptWithKey[] = [];
  for (const prompt of prompts) {
    if (isLocalPrompt(prompt)) local.push(prompt);
    else remote.push(prompt);
  }
  return [...local, ...remote];
}

export async function fetchLocalPromptRecords(): Promise<LocalPromptRecord[]> {
  const res = await fetch('/api/nova/prompts');
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data as LocalPromptRecord[] : [];
}

export async function writeLocalPrompt(options: {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  id?: string;
  title?: string;
  content?: string;
  type?: LocalPromptType;
  password: string;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = options.method === 'POST' || !options.id
    ? '/api/nova/prompts'
    : `/api/nova/prompts/${encodeURIComponent(options.id)}`;
  const res = await fetch(url, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      [LOCAL_PROMPT_WRITE_HEADER]: options.password,
    },
    body: JSON.stringify({
      title: options.title,
      content: options.content,
      type: options.type,
      password: options.password,
    }),
  });
  const data = await res.json().catch(() => ({} as { error?: string }));
  if (!res.ok) {
    return { ok: false, status: res.status, error: String(data?.error || '写入失败') };
  }
  return { ok: true, status: res.status };
}

// --- Parsing utilities ---

export function inferCategory(title: string, content: string, tags: string[]): string {
  const text = `${title} ${content} ${tags.join(' ')}`.toLowerCase();
  if (text.includes('海报') || text.includes('poster')) return '海报';
  if (text.includes('角色') || text.includes('character') || text.includes('oc')) return '角色';
  if (text.includes('电商') || text.includes('商品') || text.includes('product')) return '电商';
  if (text.includes('ui') || text.includes('界面') || text.includes('设计')) return 'UI';
  if (text.includes('风格') || text.includes('转换') || text.includes('style')) return '风格转换';
  if (text.includes('gpt4o')) return 'gpt4o';
  if (text.includes('gpt-image-2')) return 'gpt-image-2';
  return '其他';
}

function splitBeforeHeading(markdown: string, prefix: string): string[] {
  const blocks: string[] = [];
  const lines = markdown.split('\n');
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith(prefix) && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }
  return blocks;
}

function firstMatch(value: string, pattern: RegExp): string {
  const match = value.match(pattern);
  return match && match[1] ? match[1] : '';
}

function absoluteImage(baseURL: string, image: string): string {
  if (!image) return '';
  if (image.startsWith('http://') || image.startsWith('https://')) return image;
  return `${baseURL}/${image.replace(/^\./, '').replace(/^\//, '')}`;
}

function extractMarkdownImages(baseURL: string, block: string): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  const patterns = [/<img[^>]+src="([^"]+)"/g, /!\[[^\]]*\]\(([^)]+)\)/g];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(block)) !== null) {
      const image = absoluteImage(baseURL, match[1]);
      if (image && !seen.has(image)) {
        seen.add(image);
        images.push(image);
      }
    }
  }
  return images;
}

function tagsFromHeading(heading: string): string[] {
  if (!heading) return [];
  return heading.replace(/[^\p{L}\p{N}/&、与 ]/gu, '').split(/\s*(\/|&|、|与)\s*/).map(t => t.trim().toLowerCase()).filter(Boolean);
}

function youMindTags(title: string, modelTag: string): string[] {
  const tags = [modelTag];
  const parts = title.split(' - ', 2);
  if (parts.length > 1) {
    tags.push(...tagsFromHeading(parts[0]));
  }
  return tags;
}

// --- Source-specific parsers ---

function parseNanobanana(json: unknown, source: PromptDataSource): PromptWithKey[] {
  const results: PromptWithKey[] = [];
  const data = json as PromptGalleryData;
  data.sections.forEach((section: PromptGallerySection, sectionIdx: number) => {
    section.prompts.forEach((prompt: PromptGalleryItem, promptIdx: number) => {
      const category = canonicalizeCategory(inferCategory(prompt.title, prompt.content, prompt.tags));
      results.push({
        ...prompt,
        source: source.name,
        sourceUrl: source.sourceUrl,
        category,
        uniqueKey: `${source.name}-${section.id}-${prompt.id}-${sectionIdx}-${promptIdx}`
      });
    });
  });
  return results;
}

interface CangheCase {
  id?: string | number;
  title?: string;
  image?: string;
  imageAlt?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  prompt?: string;
  promptPreview?: string;
  category?: string;
  styles?: string[];
  scenes?: string[];
  featured?: boolean;
  githubUrl?: string;
}

export function parseCangheCases(json: unknown, source: PromptDataSource): PromptWithKey[] {
  if (!json || typeof json !== 'object') return [];
  const cases = (json as { cases?: unknown }).cases;
  if (!Array.isArray(cases)) return [];
  const baseURL = source.baseUrl || '';
  const prompts: PromptWithKey[] = [];
  for (const raw of cases) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as CangheCase;
    const title = String(item.title || '').trim();
    const prompt = String(item.prompt || '').trim();
    if (!title || !prompt) continue;
    const caseId = String(item.id ?? '').trim();
    if (!caseId) continue;
    const image = absoluteImage(baseURL, String(item.image || '').trim());
    const originUrl = String(item.sourceUrl || '').trim();
    const githubUrl = String(item.githubUrl || '').trim();
    const stableId = `${source.name}-${caseId}`;
    prompts.push({
      id: stableId,
      title,
      content: prompt,
      images: image ? [image] : [],
      tags: canonicalizeStyleTags(item.styles),
      contributor: String(item.sourceLabel || '').trim(),
      notes: isXPostUrl(originUrl) ? `原帖 ${originUrl}` : '',
      source: source.name,
      sourceUrl: githubUrl || undefined,
      category: canonicalizeCategory(item.category),
      uniqueKey: stableId,
    });
  }
  return prompts;
}

async function parseMarkdownAwesome(source: PromptDataSource): Promise<PromptWithKey[]> {
  const res = await fetch(source.url);
  if (!res.ok) return [];
  const markdown = await res.text();
  const baseURL = source.baseUrl || '';
  const prompts: PromptWithKey[] = [];
  const sections = splitBeforeHeading(markdown, '## ');
  for (const section of sections) {
    const sectionTags = tagsFromHeading(firstMatch(section, /^##\s+(.+)$/m));
    const blocks = splitBeforeHeading(section, '### ');
    for (const block of blocks) {
      let title = firstMatch(block, /^###\s+(.+)$/m);
      title = title.replace(/\[([^\]]+)]\([^)]+\)/g, '$1').trim();
      const prompt = firstMatch(block, /\*\*提示词:\*\*\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/);
      if (!title || !prompt) continue;
      const category = canonicalizeCategory(inferCategory(title, prompt, sectionTags));
      const idx = prompts.length;
      prompts.push({
        id: `${source.name}-${idx}`,
        title,
        content: prompt.trim(),
        images: extractMarkdownImages(baseURL, block),
        tags: sectionTags,
        contributor: '',
        notes: '',
        source: source.name,
        sourceUrl: source.sourceUrl,
        category,
        uniqueKey: `${source.name}-${idx}`,
      });
    }
  }
  return prompts;
}

export function parseMarkdownGpt4oContent(markdown: string, source: PromptDataSource): PromptWithKey[] {
  const baseURL = source.baseUrl || '';
  const prompts: PromptWithKey[] = [];
  const blocks = splitBeforeHeading(markdown, '### ');
  for (const block of blocks) {
    const title = firstMatch(block, /^###\s+(.+)$/m).trim();
    const prompt = firstMatch(block, /- \*\*提示词文本：\*\*\s*`([\s\S]*?)`/);
    if (!title || !prompt) continue;
    const tags = ['gpt4o'];
    const category = canonicalizeCategory(inferCategory(title, prompt, tags));
    const idx = prompts.length;
    prompts.push({
      id: `${source.name}-${idx}`,
      title,
      content: prompt.trim(),
      images: extractMarkdownImages(baseURL, block),
      tags,
      contributor: '',
      notes: '',
      source: source.name,
      sourceUrl: source.sourceUrl,
      category,
      uniqueKey: `${source.name}-${idx}`,
    });
  }
  return prompts;
}

async function parseMarkdownGpt4o(source: PromptDataSource): Promise<PromptWithKey[]> {
  const res = await fetch(source.url);
  if (!res.ok) return [];
  return parseMarkdownGpt4oContent(await res.text(), source);
}

async function parseMarkdownYouMind(source: PromptDataSource): Promise<PromptWithKey[]> {
  const res = await fetch(source.url);
  if (!res.ok) return [];
  const markdown = await res.text();
  const baseURL = source.baseUrl || '';
  const modelTag = source.modelTag || '';
  const prompts: PromptWithKey[] = [];
  const blocks = splitBeforeHeading(markdown, '### ');
  for (const block of blocks) {
    const title = firstMatch(block, /^###\s+No\.\s*\d+:\s*(.+)$/m).trim();
    const prompt = firstMatch(block, /#### .*?提示词\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/);
    if (!title || !prompt) continue;
    const tags = youMindTags(title, modelTag);
    const category = canonicalizeCategory(inferCategory(title, prompt, tags));
    const idx = prompts.length;
    prompts.push({
      id: `${source.name}-${idx}`,
      title,
      content: prompt.trim(),
      images: extractMarkdownImages(baseURL, block),
      tags,
      contributor: '',
      notes: '',
      source: source.name,
      sourceUrl: source.sourceUrl,
      category,
      uniqueKey: `${source.name}-${idx}`,
    });
  }
  return prompts;
}

// --- Fetch all sources in parallel ---

function fetchSource(source: PromptDataSource): Promise<PromptWithKey[]> {
  switch (source.type) {
    case 'nanobanana':
      return fetch(source.url)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(json => parseNanobanana(json, source));
    case 'canghe-cases-json':
      return fetch(source.url)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(json => parseCangheCases(json, source));
    case 'markdown-awesome':
      return parseMarkdownAwesome(source);
    case 'markdown-gpt4o':
      return parseMarkdownGpt4o(source);
    case 'markdown-youmind':
      return parseMarkdownYouMind(source);
    default:
      return Promise.resolve([]);
  }
}

export interface FetchResult {
  prompts: PromptWithKey[];
  categories: string[];
}

export async function fetchAllPromptSources(): Promise<FetchResult> {
  const settled = await Promise.allSettled(
    PROMPT_DATA_SOURCES.map(source => fetchSource(source))
  );

  const prompts: PromptWithKey[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      prompts.push(...result.value);
    }
  }

  return {
    prompts,
    categories: [...DEFAULT_CATEGORIES],
  };
}
