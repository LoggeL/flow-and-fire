import type { JSX } from 'preact';
import type { UnitCatalog } from '../../data/catalog.ts';
import type { CardPageSpec } from '../../data/card-logic.ts';
import { t } from '../../i18n/t.ts';
import { isTechTier } from '../../model/card.ts';
import { useUnitCatalog } from '../../model/index.ts';
import type { TechTier } from '../../model/card.ts';
import type { DemoState } from '../../ui/Button.tsx';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { Tab, Tabs } from '../../ui/Tab.tsx';
import { boundedText, lockText } from './labels.ts';
import { isTabLocked } from './spec.ts';

export interface TechTabsProps {
  readonly spec: CardPageSpec;
  readonly onSelect: (tier: TechTier) => void;
  /** id of the grid the tabs control. */
  readonly controls?: string | undefined;
  /** Static demo state for one tab (gallery). */
  readonly demo?: { readonly tier: number; readonly state: DemoState } | undefined;
}

/** Prerequisite text of a locked tab: the same wording as locked cells (ui.md §5.6). */
export function tabLockReason(units: UnitCatalog, spec: CardPageSpec, tier: number): string {
  const reason = spec.page === 'production' ? 'needFactoryUpgrade' : 'needBuilderTech';
  return lockText(units, { reason, tier }, spec.headTypeId);
}

/**
 * Tech tabs T1…Tmax of the command card (ui.md §5.6): the highest directly buildable tier is preselected;
 * tabs above it are locked (lock icon, reason in the title) and show the same grid. Selecting a tab only
 * changes tiers, never positions.
 */
export function TechTabs({ spec, onSelect, controls, demo }: TechTabsProps): JSX.Element | null {
  const units = useUnitCatalog();
  if (spec.maxTab === 0) return null;
  const tiers = [1, 2, 3].filter((n) => n <= spec.maxTab);
  return (
    <Tabs label={t('ui.card.tabs')} class="card__tabs" testId="tech-tabs">
      {tiers.map((tier) => {
        const locked = isTabLocked(spec, tier);
        const reason = locked ? tabLockReason(units, spec, tier) : undefined;
        return (
          <Tab
            key={tier}
            selected={spec.tab === tier}
            disabled={locked}
            controls={controls}
            title={locked ? t('ui.card.tab.locked', { tier: t('ui.common.tier', { n: String(tier) }), reason: reason ?? '' }) : t('ui.card.tab.label', { tier: String(tier) })}
            demoState={demo !== undefined && demo.tier === tier ? demo.state : undefined}
            onSelect={() => {
              if (isTechTier(tier)) onSelect(tier);
            }}
            testId={`tech-tab-${tier}`}
          >
            {boundedText(t('ui.common.tier', { n: String(tier) }))}
            {locked ? <LineIcon name="lock" /> : null}
          </Tab>
        );
      })}
    </Tabs>
  );
}
