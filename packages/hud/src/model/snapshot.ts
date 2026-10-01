import type { ReadonlySignal } from '@preact/signals';
import type { EcoSection } from './eco.ts';
import type { MatchSection } from './status.ts';
import type { SelectionSection } from './selection.ts';
import type { FactorySection } from './factory.ts';
import type { CardSection } from './card.ts';
import type { OrdersSection } from './orders.ts';
import type { StripSection } from './strip.ts';
import type { AlertsSection } from './alerts.ts';
import type { MinimapSection } from './minimap.ts';

/** Plain presentation data. The producer owns buffers and publishes a new wrapper after mutation. */
export type SectionSnapshot<T> = { readonly [K in keyof T as T[K] extends ReadonlySignal<unknown> ? K : never]: T[K] extends ReadonlySignal<infer V> ? V : never };
export interface HudSnapshot {
  readonly versions: { readonly selection: number; readonly card: number; readonly alerts: number; readonly banners: number; readonly minimap: number; readonly queue: number };
  readonly eco: { readonly mass: SectionSnapshot<EcoSection['mass']>; readonly energy: SectionSnapshot<EcoSection['energy']>; readonly consumers: EcoSection['consumers']['value'] };
  readonly match: SectionSnapshot<MatchSection>;
  readonly selection: SectionSnapshot<SelectionSection>;
  readonly factory: SectionSnapshot<FactorySection>;
  readonly card: SectionSnapshot<CardSection>;
  readonly orders: SectionSnapshot<OrdersSection>;
  readonly strip: SectionSnapshot<StripSection>;
  readonly alerts: SectionSnapshot<AlertsSection>;
  readonly minimap: SectionSnapshot<MinimapSection>;
}
