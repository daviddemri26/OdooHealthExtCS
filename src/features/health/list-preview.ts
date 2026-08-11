import type { OdooGateway } from '../../shared/types';
import {
  loadSubscriptionListHealth,
  resolveHealthTags,
  type HealthTagMap,
  type ListHealthIndicatorState,
} from './service';

const CELL_CLASS = 'odoo-health-list-preview-cell';
const MARKER_CLASS = 'odoo-health-list-preview-marker';
const STYLE_ID = 'odoo-health-list-preview-styles';
const REQUIRED_FIELDS = ['name', 'partner_id', 'subscription_state'] as const;
const SUBSCRIPTION_FIELDS = ['plan_id', 'next_invoice_date', 'recurring_total'] as const;

export interface SubscriptionListView {
  view: HTMLElement;
  table: HTMLTableElement;
}

export interface SubscriptionListRow {
  row: HTMLTableRowElement;
  orderName: string;
  customerCell: HTMLTableCellElement;
}

function technicalFields(table: HTMLTableElement): Set<string> {
  return new Set(
    Array.from(table.querySelectorAll<HTMLElement>('thead th[data-name], tbody td[name]'))
      .map((element) => element.getAttribute('data-name') ?? element.getAttribute('name'))
      .filter((name): name is string => Boolean(name)),
  );
}

export function findSubscriptionListView(root: ParentNode = document): SubscriptionListView | null {
  const views = Array.from(
    root.querySelectorAll<HTMLElement>(
      '.o_action_manager > .o_list_view.o_view_controller.o_action',
    ),
  );
  for (const view of views) {
    const tables = Array.from(view.querySelectorAll<HTMLTableElement>('table.o_list_table'));
    for (const table of tables) {
      const fields = technicalFields(table);
      if (
        REQUIRED_FIELDS.every((field) => fields.has(field)) &&
        SUBSCRIPTION_FIELDS.some((field) => fields.has(field))
      ) {
        return { view, table };
      }
    }
  }
  return null;
}

export function collectSubscriptionListRows(table: HTMLTableElement): SubscriptionListRow[] {
  return Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr.o_data_row')).flatMap(
    (row) => {
      const orderCell = row.querySelector<HTMLTableCellElement>('td[name="name"]');
      const customerCell = row.querySelector<HTMLTableCellElement>('td[name="partner_id"]');
      const orderName = (orderCell?.dataset.tooltip ?? orderCell?.textContent ?? '').trim();
      return orderCell && customerCell && orderName ? [{ row, orderName, customerCell }] : [];
    },
  );
}

function indicatorLabel(state: ListHealthIndicatorState): string {
  if (state === 'not-set') return 'Account health: Not set';
  if (state === 'ambiguous') return 'Account health: Ambiguous';
  return `Account health: ${state[0]?.toUpperCase()}${state.slice(1)}`;
}

export class SubscriptionListHealthPreview {
  private sequence = 0;
  private lastTable: HTMLTableElement | null = null;
  private lastSignature = '';
  private lastCells: HTMLTableCellElement[] = [];
  private healthTagsPromise: Promise<HealthTagMap> | null = null;

  constructor(
    private readonly gateway: OdooGateway,
    private readonly documentRoot: Document = document,
  ) {}

  async sync(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.deactivate();
      return;
    }

    const list = findSubscriptionListView(this.documentRoot);
    if (!list) {
      this.deactivate();
      return;
    }

    const rows = collectSubscriptionListRows(list.table);
    const signature = rows.map((row) => row.orderName).join('\u0000');
    const sameCells =
      rows.length === this.lastCells.length &&
      rows.every(
        (row, index) =>
          row.customerCell === this.lastCells[index] &&
          Boolean(row.customerCell.querySelector(`.${MARKER_CLASS}`)),
      );
    if (list.table === this.lastTable && signature === this.lastSignature && sameCells) return;

    const sequence = ++this.sequence;
    this.cleanupMarkers();
    this.lastTable = list.table;
    this.lastSignature = signature;
    this.lastCells = rows.map((row) => row.customerCell);
    if (rows.length === 0) return;

    this.ensureStyles();
    for (const row of rows) {
      const marker = this.documentRoot.createElement('span');
      marker.className = MARKER_CLASS;
      marker.dataset.healthState = 'loading';
      marker.setAttribute('aria-hidden', 'true');
      row.customerCell.classList.add(CELL_CLASS);
      row.customerCell.prepend(marker);
    }

    try {
      const tags = await this.getHealthTags();
      const states = await loadSubscriptionListHealth(
        this.gateway,
        rows.map((row) => row.orderName),
        tags,
      );
      if (
        sequence !== this.sequence ||
        list.table !== this.lastTable ||
        rows.some((row) => !row.customerCell.isConnected)
      ) {
        return;
      }
      for (const row of rows) {
        const state = states.get(row.orderName) ?? 'ambiguous';
        const marker = row.customerCell.querySelector<HTMLSpanElement>(`.${MARKER_CLASS}`);
        if (!marker) continue;
        const label = indicatorLabel(state);
        marker.dataset.healthState = state;
        marker.removeAttribute('aria-hidden');
        marker.setAttribute('role', 'img');
        marker.setAttribute('aria-label', label);
        marker.title = label;
      }
    } catch {
      if (sequence !== this.sequence) return;
      this.cleanupMarkers();
      this.resetListIdentity();
    }
  }

  invalidate(): void {
    this.sequence += 1;
    this.cleanupMarkers();
    this.resetListIdentity();
  }

  destroy(): void {
    this.invalidate();
    this.documentRoot.getElementById(STYLE_ID)?.remove();
    this.healthTagsPromise = null;
  }

  private async getHealthTags(): Promise<HealthTagMap> {
    this.healthTagsPromise ??= resolveHealthTags(this.gateway);
    try {
      return await this.healthTagsPromise;
    } catch (error) {
      this.healthTagsPromise = null;
      throw error;
    }
  }

  private deactivate(): void {
    if (this.lastTable || this.lastCells.length > 0) this.sequence += 1;
    this.cleanupMarkers();
    this.resetListIdentity();
  }

  private resetListIdentity(): void {
    this.lastTable = null;
    this.lastSignature = '';
    this.lastCells = [];
  }

  private cleanupMarkers(): void {
    this.documentRoot.querySelectorAll(`.${MARKER_CLASS}`).forEach((marker) => marker.remove());
    this.documentRoot
      .querySelectorAll(`.${CELL_CLASS}`)
      .forEach((cell) => cell.classList.remove(CELL_CLASS));
  }

  private ensureStyles(): void {
    if (this.documentRoot.getElementById(STYLE_ID)) return;
    const style = this.documentRoot.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CELL_CLASS} {
        position: relative !important;
        padding-left: 7px !important;
      }
      .${MARKER_CLASS} {
        position: absolute;
        top: 12px;
        bottom: 12px;
        left: 0;
        width: 3px;
        background-color: rgba(142, 142, 147, 0.52);
        border-radius: 0 3px 3px 0;
        pointer-events: none;
        transform: translateY(-2px);
        transition: background-color 140ms ease-out;
      }
      .${MARKER_CLASS}[data-health-state="loading"] {
        background-color: rgba(142, 142, 147, 0.2);
      }
      .${MARKER_CLASS}[data-health-state="high"] { background-color: #28c840; }
      .${MARKER_CLASS}[data-health-state="medium"] { background-color: #febc2e; }
      .${MARKER_CLASS}[data-health-state="low"] { background-color: #ff5f57; }
    `;
    (this.documentRoot.head ?? this.documentRoot.documentElement).append(style);
  }
}
