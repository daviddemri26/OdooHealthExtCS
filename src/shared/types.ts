export type HealthState = 'high' | 'medium' | 'low' | null;

export type AppearancePreference = 'auto' | 'light' | 'dark';

export type RenewalYear = 1 | 2 | 3 | 4 | 5;

export type RenewalDiscountTenthsByYears = Record<RenewalYear, number>;

export interface ExtensionSettings {
  schemaVersion: 4;
  enabled: boolean;
  healthListPreview: boolean;
  features: {
    health: boolean;
    industry: boolean;
    renewals: boolean;
  };
  successToasts: {
    health: boolean;
    industry: boolean;
    renewals: boolean;
  };
  renewalDefaults: {
    discountTenthsByYears: RenewalDiscountTenthsByYears;
  };
  appearance: AppearancePreference;
}

export type StatusKind = 'success' | 'error' | 'warning' | 'info';

export interface StatusAction {
  label: string;
  run: () => Promise<void> | void;
}

export interface StatusMessage {
  id: string;
  kind: StatusKind;
  message: string;
  detail?: string;
  action?: StatusAction;
  suppressAction?: StatusAction;
  dismissAfterMs?: number;
}

export interface SubscriptionRoute {
  model: 'sale.order';
  recordId: number;
  pathname: string;
}

export interface FeatureModule {
  id: keyof ExtensionSettings['features'];
  defaultEnabled: boolean;
  isEligible: (route: SubscriptionRoute | null) => boolean;
  mount: (route: SubscriptionRoute) => Promise<void> | void;
  unmount: () => Promise<void> | void;
}

export type OdooDomain = unknown[];

export interface OdooRecord {
  id: number;
  [field: string]: unknown;
}

export interface OdooFieldDefinition {
  type?: string;
  relation?: string;
  readonly?: boolean;
  string?: string;
}

export interface OdooGateway {
  read<T extends OdooRecord>(model: string, ids: number[], fields: string[]): Promise<T[]>;
  fieldsGet(
    model: string,
    fields: string[],
    attributes?: string[],
  ): Promise<Record<string, OdooFieldDefinition>>;
  searchRead<T extends OdooRecord>(
    model: string,
    domain: OdooDomain,
    fields: string[],
    options?: { limit?: number; order?: string },
  ): Promise<T[]>;
}

export type ConnectionCode =
  | 'ready'
  | 'bridge_unavailable'
  | 'timeout'
  | 'network'
  | 'session_expired'
  | 'access_denied'
  | 'incompatible_endpoint'
  | 'incompatible_response'
  | 'server_error';

export type CompatibilityCode = ConnectionCode | 'missing_health_tags' | 'missing_fields';

export interface CompatibilityStatus {
  ok: boolean;
  code: ConnectionCode;
  checkedAt: string;
}

export type Many2OneValue = false | [number, string];
