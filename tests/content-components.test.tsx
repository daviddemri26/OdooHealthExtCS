import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HealthControl, IndustryField, StatusBar } from '../src/content/ContentApp';

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
      />,
    );
    expect(document.querySelector('.health-current')).toHaveTextContent('High');
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Set health to Low', 'Set health to Medium', 'Clear high health']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear high health' }));
    expect(onSelect).toHaveBeenCalledWith('high');
  });

  it('filters industries and exposes a clearing choice', () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    render(
      <IndustryField
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
        onSelect={onSelect}
      />,
    );
    const noIndustry = screen.getByRole('option', { name: /No industry/ });
    const search = screen.getByRole('searchbox');
    expect(noIndustry).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(noIndustry).toHaveFocus();
    fireEvent.keyDown(noIndustry, { key: 'ArrowDown' });
    const education = screen.getByRole('option', { name: /Education/ });
    expect(education).toHaveFocus();
    fireEvent.keyDown(education, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(2);
    fireEvent.keyDown(education, { key: 'Escape' });
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
          detail: 'The displayed value is current.',
          action: { label: 'Undo', run: undo },
        }}
        onDismiss={dismiss}
      />,
    );
    expect(screen.getByText('Saved.')).toHaveClass('status-title');
    expect(screen.getByText('The displayed value is current.')).toHaveClass('status-detail');
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

  it('automatically dismisses an error message', () => {
    vi.useFakeTimers();
    try {
      const dismiss = vi.fn();
      render(
        <StatusBar
          status={{ id: 'status-3', kind: 'error', message: 'Write failed.' }}
          onDismiss={dismiss}
        />,
      );
      act(() => vi.advanceTimersByTime(8_000));
      expect(dismiss).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('automatically dismisses a warning message', () => {
    vi.useFakeTimers();
    try {
      const dismiss = vi.fn();
      render(
        <StatusBar
          status={{ id: 'status-warning', kind: 'warning', message: 'Choose one value.' }}
          onDismiss={dismiss}
        />,
      );
      act(() => vi.advanceTimersByTime(7_999));
      expect(dismiss).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(dismiss).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses automatic dismissal while the pointer is over the message', () => {
    vi.useFakeTimers();
    try {
      const dismiss = vi.fn();
      const view = render(
        <StatusBar
          status={{ id: 'status-4', kind: 'success', message: 'Saved.', dismissAfterMs: 7_000 }}
          onDismiss={dismiss}
        />,
      );
      const status = view.container.querySelector<HTMLElement>('[role="status"]')!;
      act(() => vi.advanceTimersByTime(3_000));
      fireEvent.mouseEnter(status);
      act(() => vi.advanceTimersByTime(10_000));
      expect(dismiss).not.toHaveBeenCalled();
      fireEvent.mouseLeave(status);
      act(() => vi.advanceTimersByTime(3_999));
      expect(dismiss).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(dismiss).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
