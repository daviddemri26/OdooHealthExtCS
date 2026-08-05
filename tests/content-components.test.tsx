import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HealthControl, IndustryDrawer, StatusBar } from '../src/content/ContentApp';

describe('content controls', () => {
  it('communicates active health in text and clicking it requests a clear-capable selection', () => {
    const onSelect = vi.fn();
    render(
      <HealthControl
        context={{
          tags: { high: 1, medium: 2, low: 3 },
          snapshot: { tagIds: [1, 8], state: 'high', duplicate: false },
        }}
        loading={false}
        pending={false}
        error={null}
        onSelect={onSelect}
        anchor={{ top: 100, right: 20 }}
      />,
    );
    expect(screen.getByText('High')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear high health' }));
    expect(onSelect).toHaveBeenCalledWith('high');
  });

  it('filters industries and exposes a clearing choice', () => {
    const onToggle = vi.fn();
    render(
      <IndustryDrawer
        context={{
          partnerId: 81,
          partnerName: 'Demo Customer',
          currentIndustryId: 3,
          industries: [
            { id: 2, name: 'Education' },
            { id: 3, name: 'Technology' },
          ],
        }}
        open
        loading={false}
        pending={false}
        error={null}
        onToggle={onToggle}
        onSelect={vi.fn()}
      />,
    );
    const noIndustry = screen.getByRole('option', { name: /No industry/ });
    const search = screen.getByRole('searchbox');
    expect(noIndustry).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(noIndustry).toHaveFocus();
    fireEvent.keyDown(noIndustry, { key: 'Escape' });
    expect(onToggle).toHaveBeenCalledOnce();
    fireEvent.change(search, { target: { value: 'tech' } });
    expect(screen.getByRole('option', { name: /Technology/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Education/ })).not.toBeInTheDocument();
  });

  it('runs an undo action and allows dismissal', async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const dismiss = vi.fn();
    render(
      <StatusBar
        status={{
          id: 'status-1',
          kind: 'success',
          message: 'Saved.',
          action: { label: 'Undo', run: undo },
        }}
        onDismiss={dismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('automatically dismisses a temporary success message', () => {
    vi.useFakeTimers();
    try {
      const dismiss = vi.fn();
      render(
        <StatusBar
          status={{ id: 'status-2', kind: 'success', message: 'Saved.', dismissAfterMs: 7_000 }}
          onDismiss={dismiss}
        />,
      );
      act(() => vi.advanceTimersByTime(6_999));
      expect(dismiss).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(dismiss).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
