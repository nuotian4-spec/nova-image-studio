import { describe, expect, it } from 'vitest';
import { buildGifPrompt } from '@/lib/gif-prompt';

const BASE = {
  userPrompt: '一只虎斑猫缓慢眨眼',
  refImageCount: 0,
  loop: true,
  closedLoop: false,
} as const;

describe('buildGifPrompt', () => {
  it('openai/gpt-image-2 路径：有 customSize 时仍含 3264x2448 和 816x816', () => {
    const prompt = buildGifPrompt({
      ...BASE,
      customSize: '3264x2448',
      outputSize: '2K',
    });
    expect(prompt).toContain('3264x2448');
    expect(prompt).toContain('816x816');
    expect(prompt).toContain('4 columns');
    expect(prompt).toContain('3 rows');
    expect(prompt).toContain('4列3行');
    expect(prompt).toContain('exactly 3264x2448');
    expect(prompt).toContain('exactly 816x816');
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
