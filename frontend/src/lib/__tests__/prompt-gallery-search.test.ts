import { describe, expect, it } from 'vitest';

import { matchesPromptGalleryQuery } from '@/lib/prompt-gallery-search';

function prompt(overrides: Record<string, unknown> = {}) {
  return {
    title: '海报标题',
    content: '生成一张产品海报',
    contributor: 'alice',
    notes: '适合电商主图',
    tags: ['电影感', 'cinematic'],
    ...overrides,
  };
}

describe('matchesPromptGalleryQuery', () => {
  it('query 匹配 tag 能命中', () => {
    expect(matchesPromptGalleryQuery(prompt(), 'cinematic')).toBe(true);
    expect(matchesPromptGalleryQuery(prompt(), '电影感')).toBe(true);
    expect(matchesPromptGalleryQuery(prompt(), 'CINEMATIC')).toBe(true);
  });

  it('只存在于 scene 式噪声、不在 title/content 时，按实际 tags 字段判定', () => {
    const withoutTag = prompt({
      title: '静物',
      content: '一只杯子',
      notes: '',
      tags: ['静物'],
      scene: 'cyberpunk-alley',
      style: 'cyberpunk',
    });
    expect(matchesPromptGalleryQuery(withoutTag, 'cyberpunk')).toBe(false);

    const withTag = prompt({
      title: '静物',
      content: '一只杯子',
      notes: '',
      tags: ['cyberpunk'],
      scene: 'office-desk',
      style: 'oil-painting',
    });
    expect(matchesPromptGalleryQuery(withTag, 'cyberpunk')).toBe(true);
  });

  it('也能匹配 title / content / contributor / notes', () => {
    expect(matchesPromptGalleryQuery(prompt(), '海报标题')).toBe(true);
    expect(matchesPromptGalleryQuery(prompt(), '产品海报')).toBe(true);
    expect(matchesPromptGalleryQuery(prompt(), 'alice')).toBe(true);
    expect(matchesPromptGalleryQuery(prompt(), '电商主图')).toBe(true);
  });
});
