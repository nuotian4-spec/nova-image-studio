import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CATEGORIES,
  PROMPT_DATA_SOURCES,
  canonicalizeCategory,
  parseCangheCases,
  parseMarkdownGpt4oContent,
  type PromptDataSource,
} from '@/lib/prompt-gallery-data';

const CANGHE_SOURCE: PromptDataSource = {
  name: 'canghe-gpt-image-2',
  url: 'https://example.invalid/cases.json',
  sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2',
  type: 'canghe-cases-json',
  baseUrl: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data',
};

const GPT4O_SOURCE: PromptDataSource = {
  name: 'awesome-gpt4o-image-prompts',
  url: 'https://example.invalid/README.zh-CN.md',
  sourceUrl: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts',
  type: 'markdown-gpt4o',
  baseUrl: 'https://example.invalid',
};

const CANGHE_FIXTURE = {
  totalCases: 4,
  categories: ['Characters & People', 'Products & E-commerce', 'Photography & Realism'],
  styles: ['Character', 'Characters', 'Product', 'Products'],
  scenes: ['Tech', 'Commerce'],
  cases: [
    {
      id: 544,
      title: '3D 角色卡片',
      image: '/images/case544.jpg',
      imageAlt: 'character card',
      sourceLabel: '@Naiknelofar788',
      sourceUrl: 'https://x.com/Naiknelofar788/status/123456',
      prompt: 'A 3D character collectible card of a fox knight',
      promptPreview: 'A 3D character…',
      category: 'Characters & People',
      styles: ['Character', 'Characters', '3D', 'Scenes'],
      scenes: ['Tech', 'Commerce'],
      featured: true,
      githubUrl: 'https://github.com/freestylefly/awesome-gpt-image-2#case-544',
    },
    {
      id: '12',
      title: '商品主图',
      image: 'images/case12.jpg',
      sourceLabel: '@shop',
      sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2',
      prompt: 'Product photo of sneakers on marble',
      promptPreview: 'should not be used',
      category: 'Products & E-commerce',
      styles: ['Product', 'Products', 'Photography', 'Realistic'],
      scenes: ['Commerce'],
      githubUrl: 'https://github.com/freestylefly/awesome-gpt-image-2#case-12',
    },
    {
      id: 7,
      title: '海报风写真',
      image: '/images/case7.jpg',
      sourceLabel: '@photo',
      sourceUrl: '',
      prompt: 'poster-like photography of a rainy street',
      promptPreview: 'preview only',
      category: 'Photography & Realism',
      styles: ['Photography', 'Other Use Cases'],
      scenes: ['Tech'],
      githubUrl: 'https://github.com/freestylefly/awesome-gpt-image-2#case-7',
    },
    {
      id: 99,
      title: '',
      prompt: 'missing title should drop',
      category: 'UI & Interfaces',
      githubUrl: 'https://github.com/freestylefly/awesome-gpt-image-2#case-99',
    },
    {
      id: 100,
      title: 'missing prompt should drop',
      prompt: '',
      category: 'UI & Interfaces',
      githubUrl: 'https://github.com/freestylefly/awesome-gpt-image-2#case-100',
    },
  ],
};

describe('PROMPT_DATA_SOURCES', () => {
  it('删除 3 个旧 GPT-Image-2 同源源，并接入苍何 cases.json', () => {
    const names = PROMPT_DATA_SOURCES.map(source => source.name);
    expect(names).toEqual([
      'nanobanana',
      'canghe-gpt-image-2',
      'awesome-gpt-image',
      'awesome-gpt4o-image-prompts',
      'youmind-nano-banana-pro',
    ]);
    expect(names).not.toContain('gpt-image-2-prompts');
    expect(names).not.toContain('youmind-gpt-image-2');
    expect(names).not.toContain('davidwu-gpt-image2-prompts');

    const canghe = PROMPT_DATA_SOURCES.find(source => source.name === 'canghe-gpt-image-2');
    expect(canghe).toMatchObject({
      type: 'canghe-cases-json',
      url: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/cases.json',
      sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2',
      baseUrl: 'https://proxy.ccode.vip/https/raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data',
    });
  });
});

describe('canonicalizeCategory', () => {
  it('英文官方 category 映射到 13 类中文', () => {
    expect(canonicalizeCategory('Architecture & Spaces')).toBe('建筑与空间');
    expect(canonicalizeCategory('Brand & Logos')).toBe('品牌与标志');
    expect(canonicalizeCategory('Characters & People')).toBe('人物与角色');
    expect(canonicalizeCategory('Charts & Infographics')).toBe('图表与信息可视化');
    expect(canonicalizeCategory('Documents & Publishing')).toBe('文档与出版物');
    expect(canonicalizeCategory('History & Classical Themes')).toBe('历史与古风题材');
    expect(canonicalizeCategory('Illustration & Art')).toBe('插画与艺术');
    expect(canonicalizeCategory('Other Use Cases')).toBe('其他应用场景');
    expect(canonicalizeCategory('Photography & Realism')).toBe('摄影与写实');
    expect(canonicalizeCategory('Posters & Typography')).toBe('海报与排版');
    expect(canonicalizeCategory('Products & E-commerce')).toBe('商品与电商');
    expect(canonicalizeCategory('Scenes & Storytelling')).toBe('场景与叙事');
    expect(canonicalizeCategory('UI & Interfaces')).toBe('UI 与界面');
  });

  it('旧中文 / 模型名映射到 13 类，已是 13 类则原样，未知进其他', () => {
    expect(canonicalizeCategory('海报')).toBe('海报与排版');
    expect(canonicalizeCategory('角色')).toBe('人物与角色');
    expect(canonicalizeCategory('电商')).toBe('商品与电商');
    expect(canonicalizeCategory('UI')).toBe('UI 与界面');
    expect(canonicalizeCategory('风格转换')).toBe('插画与艺术');
    expect(canonicalizeCategory('gpt-image-2')).toBe('其他应用场景');
    expect(canonicalizeCategory('gpt4o')).toBe('其他应用场景');
    expect(canonicalizeCategory('其他')).toBe('其他应用场景');
    expect(canonicalizeCategory('海报与排版')).toBe('海报与排版');
    expect(canonicalizeCategory('幽灵分类')).toBe('其他应用场景');
    expect(canonicalizeCategory('')).toBe('其他应用场景');
  });

  it('DEFAULT_CATEGORIES 固定为 全部 + 13 类，不允许第 14 类', () => {
    expect(DEFAULT_CATEGORIES).toEqual([
      '全部',
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
    ]);
  });
});

describe('parseCangheCases', () => {
  it('用 fixture 解析图 URL、中文分类、tag 去噪、原帖 notes 和 githubUrl', () => {
    const items = parseCangheCases(CANGHE_FIXTURE, CANGHE_SOURCE);
    expect(items).toHaveLength(3);

    const character = items[0];
    expect(character.id).toBe('canghe-gpt-image-2-544');
    expect(character.uniqueKey).toBe('canghe-gpt-image-2-544');
    expect(character.title).toBe('3D 角色卡片');
    expect(character.content).toBe('A 3D character collectible card of a fox knight');
    expect(character.content).not.toContain('A 3D character…');
    expect(character.images).toEqual([
      'https://proxy.ccode.vip/https/raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/images/case544.jpg',
    ]);
    expect(character.category).toBe('人物与角色');
    expect(character.tags).toEqual(['角色', '3D']);
    expect(character.tags).not.toContain('Scenes');
    expect(character.tags).not.toContain('Tech');
    expect(character.tags).not.toContain('Commerce');
    expect(character.contributor).toBe('@Naiknelofar788');
    expect(character.source).toBe('canghe-gpt-image-2');
    expect(character.sourceUrl).toBe('https://github.com/freestylefly/awesome-gpt-image-2#case-544');
    expect(character.notes).toBe('原帖 https://x.com/Naiknelofar788/status/123456');

    const product = items[1];
    expect(product.id).toBe('canghe-gpt-image-2-12');
    expect(product.category).toBe('商品与电商');
    expect(product.tags).toEqual(['商品', '摄影', '写实']);
    expect(product.notes).toBe('');
    expect(product.sourceUrl).toBe('https://github.com/freestylefly/awesome-gpt-image-2#case-12');
    expect(product.images).toEqual([
      'https://proxy.ccode.vip/https/raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/images/case12.jpg',
    ]);

    const photo = items[2];
    expect(photo.category).toBe('摄影与写实');
    expect(photo.category).not.toBe('海报与排版');
    expect(photo.tags).toEqual(['摄影']);
    expect(photo.tags).not.toContain('Other Use Cases');
    expect(photo.notes).toBe('');
  });

  it('缺 title 或 prompt 的条目丢弃，且不走 inferCategory', () => {
    const items = parseCangheCases(CANGHE_FIXTURE, CANGHE_SOURCE);
    expect(items.map(item => item.id)).toEqual([
      'canghe-gpt-image-2-544',
      'canghe-gpt-image-2-12',
      'canghe-gpt-image-2-7',
    ]);
  });
});

describe('parseMarkdownGpt4oContent', () => {
  it('不再写死 category=gpt4o，改为 infer+canonicalize，tags 仍含 gpt4o', () => {
    const markdown = [
      '### 城市夜景海报',
      '- **提示词文本：** `neon poster, night city`',
      '![img](/images/foo.jpg)',
      '',
      '### gpt4o 实验图',
      '- **提示词文本：** `a nice picture`',
    ].join('\n');

    const items = parseMarkdownGpt4oContent(markdown, GPT4O_SOURCE);
    expect(items).toHaveLength(2);
    expect(items[0].category).toBe('海报与排版');
    expect(items[0].category).not.toBe('gpt4o');
    expect(items[0].tags).toEqual(['gpt4o']);
    expect(items[0].images).toEqual(['https://example.invalid/images/foo.jpg']);
    expect(items[1].category).toBe('其他应用场景');
    expect(items[1].category).not.toBe('gpt4o');
    expect(items[1].tags).toContain('gpt4o');
  });
});
