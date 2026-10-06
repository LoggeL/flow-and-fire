import type { JSX } from 'preact';
import { modsFromEvent } from '../../commands/mods.ts';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { t, tn } from '../../i18n/t.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { CONTROL_GROUP_CODES } from '../../model/strip.ts';
import type { ControlGroupData } from '../../model/strip.ts';
import { demoClass } from '../../ui/Button.tsx';
import type { DemoState } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { keyLabel } from '../../ui/keys.ts';

export interface ControlGroupsProps {
  /** Static demo state of one group (gallery). */
  readonly demo?: { readonly index: number; readonly state: DemoState } | undefined;
  readonly testId?: string | undefined;
}

/** Accessible name/tooltip of a group (ui.md §5.10). */
export function groupLabel(g: ControlGroupData, key: string, active: boolean): string {
  if (g.count <= 0) return t('ui.strip.group.empty', { key });
  const text = t('ui.strip.group.filled', { key, units: tn('ui.common.units', g.count) });
  return active ? `${text} · ${t('ui.strip.group.active')}` : text;
}

function groupIndex(target: EventTarget | null, root: HTMLElement): number | null {
  const el = (target as Element | null)?.closest?.('[data-group]');
  if (el === null || el === undefined || !root.contains(el)) return null;
  const i = Number(el.getAttribute('data-group'));
  return Number.isInteger(i) ? i : null;
}

/**
 * Control groups 1–0 (ui.md §5.10, C7): 52 × 34 px each with key, icon of the most frequent type and count;
 * empty / filled / active (ember frame). Click = recallGroup(i, mods), right click = saveGroup(i, false),
 * Shift+right click = saveGroup(i, true) (mouse path R9). Fixed left position over the selection panel (R1).
 */
export function ControlGroups(props: ControlGroupsProps): JSX.Element {
  const model = useHud();
  const commands = useCommands();
  const groups = model.strip.groups.value;
  const active = model.strip.activeGroup.value;
  const layout = model.keyboardLayout.value;
  return (
    <div
      class="groups"
      role="toolbar"
      aria-label={t('ui.strip.groups')}
      data-component="ControlGroups"
      data-panel="groups"
      data-testid={props.testId ?? 'control-groups'}
      onClick={(e) => {
        const i = groupIndex(e.target, e.currentTarget);
        if (i !== null) commands.recallGroup(i, modsFromEvent(e));
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const i = groupIndex(e.target, e.currentTarget);
        if (i !== null) commands.saveGroup(i, e.shiftKey);
      }}
    >
      {groups.map((g, i) => {
        const code = CONTROL_GROUP_CODES[i] ?? 'Digit0';
        const key = keyLabel(code, layout);
        const filled = g.count > 0;
        const isActive = active === i && filled;
        const label = groupLabel(g, key, isActive);
        return (
          <button
            key={i}
            type="button"
            class={cx('grp', !filled && 'is-empty', isActive && 'is-active', props.demo?.index === i && demoClass(props.demo.state))}
            aria-label={label}
            aria-pressed={isActive ? 'true' : undefined}
            title={label}
            data-group={i}
            data-testid={`group-${i}`}
          >
            <span class="grp__k">{key}</span>
            {filled && g.iconTypeId !== null ? <StrategicIcon typeId={g.iconTypeId} /> : null}
            {filled ? <span class="grp__n num">{String(g.count)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
