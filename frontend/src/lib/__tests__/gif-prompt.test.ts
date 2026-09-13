import { describe, expect, it } from 'vitest';
import { buildGifPrompt } from '@/lib/gif-prompt';

const BASE = {
  userPrompt: '一只虎斑猫缓慢眨眼',
  refImageCount: 0,
  loop: true,
  closedLoop: false,
} as const;

describe('buildGifPrompt', () => {
  it('openai/gpt-image-2 路径：customSize 1536x1024 时不点名 3264/816，仍铺满 4×3', () => {
    const prompt = buildGifPrompt({
      ...BASE,
      customSize: '1536x1024',
      outputSize: '2K',
    });
    expect(prompt).not.toContain('3264');
    expect(prompt).not.toContain('816x816');
    expect(prompt).not.toContain('exactly 3264');
    expect(prompt).not.toContain('exactly 1536x1024');
    expect(prompt).toContain('4 columns');
    expect(prompt).toContain('3 rows');
    expect(prompt).toContain('4列3行');
    expect(prompt).toContain('2K');
  });

  it('误传 3264x2448 时仍走铺满画布，不把非法 size 写进提示词', () => {
    const prompt = buildGifPrompt({
      ...BASE,
      customSize: '3264x2448',
      outputSize: '2K',
    });
    expect(prompt).not.toContain('3264');
    expect(prompt).not.toContain('816x816');
    expect(prompt).toContain('4 columns');
    expect(prompt).toContain('3 rows');
  });

  it('grok 路径：无 customSize 时不含 3264/816x816，仍含 4 columns / 3 rows', () => {
    const prompt = buildGifPrompt({
      ...BASE,
      outputSize: '2K',
    });
    expect(prompt).not.toContain('3264');
    expect(prompt).not.toContain('816x816');
    expect(prompt).toContain('4 columns');
    expect(prompt).toContain('3 rows');
    expect(prompt).toContain('4列3行');
    expect(prompt).toContain('2K');
  });

  it('无 customSize 的 4K 输出同样不点名像素，只铺满 4×3', () => {
    const prompt = buildGifPrompt({
      ...BASE,
      outputSize: '4K',
    });
    expect(prompt).not.toContain('3264');
    expect(prompt).not.toContain('816x816');
    expect(prompt).toContain('4K');
    expect(prompt).toContain('4 columns');
    expect(prompt).toContain('3 rows');
  });
});
