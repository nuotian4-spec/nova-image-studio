import { describe, expect, it } from 'vitest';

import {
  canEditGalleryPrompt,
  DEFAULT_CATEGORIES,
  isLocalPrompt,
  LOCAL_CATEGORY,
  LOCAL_PROMPT_SOURCE,
  LOCAL_PROMPT_SOURCE_LABEL,
  mapLocalPromptRecords,
  mergePromptGalleryCategories,
  mergePromptGallerySources,
  pinLocalGalleryPrompts,
  type PromptWithKey,
} from '@/lib/prompt-gallery-data';

function remotePrompt(overrides: Partial<PromptWithKey> = {}): PromptWithKey {
  return {
    id: 'gpt-1',
    title: '远程海报',
    content: '生成一张海报',
    images: ['https://example.com/a.png'],
    tags: ['海报'],
    contributor: 'github',
    notes: '',
    source: 'nanobanana',
    sourceUrl: 'https://github.com/unknowlei/nanobanana-website',
    category: '海报',
    uniqueKey: 'nanobanana-1',
    ...overrides,
  };
}

describe('本站源 merge / 本地条目可编辑', () => {
  it('isLocalPrompt 只认本站来源', () => {
    expect(isLocalPrompt({ source: 'local' })).toBe(true);
    expect(isLocalPrompt({ source: '本站' })).toBe(true);
    expect(isLocalPrompt({ source: LOCAL_PROMPT_SOURCE })).toBe(true);
    expect(isLocalPrompt({ source: 'nanobanana', sourceUrl: 'https://github.com/foo/bar' })).toBe(false);
    expect(isLocalPrompt({ source: 'github' })).toBe(false);
    expect(isLocalPrompt(null)).toBe(false);
  });

  it('远程条目不可编辑，本站条目可编辑', () => {
    const local = mapLocalPromptRecords([
      { id: 'local-1', title: '去水印', content: '去掉水印', type: 2 },
    ]);
    expect(local).toHaveLength(1);
    expect(local[0].source).toBe(LOCAL_PROMPT_SOURCE);
    expect(local[0].category).toBe(LOCAL_CATEGORY);
    expect(local[0].contributor).toBe(LOCAL_PROMPT_SOURCE_LABEL);
    expect(local[0].localType).toBe(2);
    expect(canEditGalleryPrompt(local[0])).toBe(true);
    expect(canEditGalleryPrompt(remotePrompt())).toBe(false);
  });

  it('merge 本站源到广场列表，本站在前且与 GitHub 条目可区分', () => {
    const local = mapLocalPromptRecords([
      { id: 'local-new', title: '本站新词', content: '生成中文海报', type: 1 },
    ]);
    const merged = mergePromptGallerySources([remotePrompt(), ...local], local);

    expect(merged).toHaveLength(2);
    expect(isLocalPrompt(merged[0])).toBe(true);
    expect(merged[0].title).toBe('本站新词');
    expect(canEditGalleryPrompt(merged[0])).toBe(true);
    expect(merged[1].source).toBe('nanobanana');
    expect(canEditGalleryPrompt(merged[1])).toBe(false);
    expect(merged.filter(isLocalPrompt)).toHaveLength(1);
  });

  it('分类列表在有本站条目时插入「本站」，旧名 canonicalize 且不插入第 14 类', () => {
    const local = mapLocalPromptRecords([
      { title: '论转教授', content: '把论文变成板书', type: 1 },
    ]);
    const categories = mergePromptGalleryCategories(['全部', '海报', '其他', '幽灵分类'], local);
    expect(categories[0]).toBe('全部');
    expect(categories[1]).toBe(LOCAL_CATEGORY);
    expect(categories.slice(2)).toEqual([...DEFAULT_CATEGORIES.slice(1)]);
    expect(categories).toContain('海报与排版');
    expect(categories).toContain('其他应用场景');
    expect(categories).not.toContain('海报');
    expect(categories).not.toContain('其他');
    expect(categories).not.toContain('幽灵分类');
    expect(categories).toHaveLength(DEFAULT_CATEGORIES.length + 1);
  });

  it('无本站条目时分类固定为 全部 + 13 类', () => {
    expect(mergePromptGalleryCategories(['全部', '海报'], [])).toEqual(DEFAULT_CATEGORIES);
  });

  it('pinLocalGalleryPrompts 把本站条目钉在远程源前面', () => {
    const local = mapLocalPromptRecords([
      { id: 'local-2', title: '图生图模板', content: '替换主体', type: 2 },
    ]);
    const pinned = pinLocalGalleryPrompts([remotePrompt(), ...local, remotePrompt({ uniqueKey: 'r2', id: 'r2' })]);
    expect(isLocalPrompt(pinned[0])).toBe(true);
    expect(pinned.slice(1).every(item => !isLocalPrompt(item))).toBe(true);
  });

  it('mapLocalPromptRecords 跳过无标题/无正文的脏数据', () => {
    expect(mapLocalPromptRecords([
      { title: '', content: 'x', type: 1 },
      { title: '有标题', content: '', type: 1 },
      null,
      { title: '有效', content: '正文', type: 2 },
    ])).toHaveLength(1);
  });
});
