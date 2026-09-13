import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useState } from 'react';

import { useWideMode, WIDE_MODE_MIN_WIDTH, WIDE_MODE_STORAGE_KEY } from '@/hooks/useWideMode';

function stubViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.matchMedia = ((query: string) => {
    const parsed = /max-width:\s*(\d+)px/.exec(query);
    const matches = parsed ? width <= Number(parsed[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    };
  }) as typeof window.matchMedia;
}

function WideModeProbe() {
  const { wideMode, setWideMode, toggleWideMode, mounted } = useWideMode();
  const [lastResult, setLastResult] = useState<string>('none');
  return (
    <div>
      <span data-testid="mounted">{String(mounted)}</span>
      <span data-testid="wide">{String(wideMode)}</span>
      <span data-testid="last">{lastResult}</span>
      <button type="button" onClick={() => setLastResult(String(setWideMode(true)))}>
        enable
      </button>
      <button type="button" onClick={() => setLastResult(String(toggleWideMode()))}>
        toggle
      </button>
    </div>
  );
}

describe('useWideMode 宽度不足必须可见失败', () => {
  beforeEach(() => {
    localStorage.clear();
    stubViewport(1100);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    stubViewport(1280);
  });

  it(`innerWidth 1100 时 setWideMode(true) / toggleWideMode 返回 false，不静默写成 ${WIDE_MODE_MIN_WIDTH}+`, async () => {
    render(<WideModeProbe />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('mounted').textContent).toBe('true');
    expect(screen.getByTestId('wide').textContent).toBe('false');

    await act(async () => {
      screen.getByRole('button', { name: 'enable' }).click();
    });
    expect(screen.getByTestId('last').textContent).toBe('false');
    expect(screen.getByTestId('wide').textContent).toBe('false');
    expect(localStorage.getItem(WIDE_MODE_STORAGE_KEY)).not.toBe('enabled');

    await act(async () => {
      screen.getByRole('button', { name: 'toggle' }).click();
    });
    expect(screen.getByTestId('last').textContent).toBe('false');
    expect(screen.getByTestId('wide').textContent).toBe('false');
  });

  it('宽度足够时 setWideMode(true) 返回 true', async () => {
    stubViewport(1400);
    render(<WideModeProbe />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'enable' }).click();
    });
    expect(screen.getByTestId('last').textContent).toBe('true');
    expect(screen.getByTestId('wide').textContent).toBe('true');
  });
});
