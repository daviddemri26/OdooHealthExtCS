import type { StatusMessage } from '../shared/types';

export const STATUS_DURATIONS: Record<StatusMessage['kind'], number> = {
  success: 7_000,
  error: 0,
  warning: 0,
  info: 6_000,
};

export function createStatusMessage(
  kind: StatusMessage['kind'],
  message: string,
  options: Pick<StatusMessage, 'action' | 'detail' | 'dismissAfterMs' | 'suppressAction'> = {},
): StatusMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    kind,
    message,
    ...options,
    dismissAfterMs: options.dismissAfterMs ?? STATUS_DURATIONS[kind],
  };
}

type StatusListener = (status: StatusMessage | null) => void;

const DEFAULT_STATUS_PRIORITY: Record<StatusMessage['kind'], number> = {
  success: 0,
  info: 0,
  warning: 20,
  error: 20,
};

/** A single tab-scoped notification slot shared by every content feature. */
export class StatusStore {
  private status: StatusMessage | null = null;
  private priority = 0;
  private readonly listeners = new Set<StatusListener>();

  getSnapshot(): StatusMessage | null {
    return this.status;
  }

  notify(status: StatusMessage, priority = DEFAULT_STATUS_PRIORITY[status.kind]): boolean {
    if (this.status && priority < this.priority) return false;
    this.status = status;
    this.priority = priority;
    this.emit();
    return true;
  }

  dismiss(statusId?: string): void {
    if (statusId && this.status?.id !== statusId) return;
    if (!this.status) return;
    this.status = null;
    this.priority = 0;
    this.emit();
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.status);
  }
}
