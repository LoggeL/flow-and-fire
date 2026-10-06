import { useComputed } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { fmtInt, fmtPct } from '../../format/index.ts';
import { locale } from '../../i18n/locale.ts';
import { t, tn } from '../../i18n/t.ts';
import { QUEUE_MAX_BLOCKS, queueClick, queueIsEmpty } from '../../model/factory.ts';
import type { FactoryQueueData } from '../../model/factory.ts';
import { useCommands, useHud, useUnitCatalog } from '../../model/index.ts';
import { visibleCount } from '../../model/selection.ts';
import { Bar } from '../../ui/Bar.tsx';
import { cx } from '../../ui/cx.ts';
import { Key } from '../../ui/Key.tsx';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { closestData, pointerMods } from './events.ts';
import { SEP, remainingText } from './labels.ts';
import { unitName } from '../../data/roster.ts';

/** State name of a queue (data-state; gallery/E2E hook). */
export function factoryQueueState(q: FactoryQueueData | null, factories: number): string {
  if (factories > 1) return 'multi';
  if (queueIsEmpty(q)) return 'empty';
  if (q!.paused) return 'paused';
  if (q!.repeat) return 'repeat';
  return 'running';
}

function NowBlock({ q }: { readonly q: FactoryQueueData | null }): JSX.Element {
  const { factory } = useHud();
  const loc = locale.value;
  const units = useUnitCatalog();
  const current = q?.current ?? null;
  const paused = q?.paused ?? false;
  const pct = useComputed(() => (factory.queue.value?.current ? fmtPct(factory.progress.value, 0, locale.value) : ''));
  const remaining = useComputed(() => remainingText(factory.remainingS.value, locale.value));
  const progress = useComputed(() => (factory.queue.value?.current ? factory.progress.value : 0));
  if (current === null) {
    return (
      <div class="fq__now is-idle" aria-label={t('ui.factory.now')} data-testid="factory-now">
        <LineIcon name="idle" />
        <div>
          <b>{t('ui.factory.idle')}</b>
          <span class="ff-lo">
            {SEP}
            {t('ui.factory.idleHint')}
          </span>
          <Bar kind="build" value={0} testId="factory-progress" />
        </div>
        <span class="num" />
      </div>
    );
  }
  return (
    <div class={cx('fq__now', paused && 'is-paused')} aria-label={t('ui.factory.now')} data-testid="factory-now">
      <StrategicIcon typeId={current.typeId} />
      <div>
        <b data-testid="factory-now-name">{unitName(units, current.typeId, loc)}</b>{' '}
        <span class="ff-lo" data-testid="factory-now-sub">
          {SEP}
          {paused ? t('ui.factory.paused') : remaining}
        </span>
        <Bar kind="build" value={progress} level="normal" testId="factory-progress" />
      </div>
      <span class="num fq__pct" data-testid="factory-pct">
        {pct}
      </span>
    </div>
  );
}

/**
 * Factory queue (ui.md §5.7 `FactoryQueue`, B3/B2/E13): item in production (icon, name, remaining time,
 * progress bar at 10 Hz via transform, percentage), merged blocks (≤ 10, then "+N") with loop marker,
 * controls repeat / pause / rally / clear. Block clicks: click +1, Shift +5, right click −1,
 * Shift+right click −5, Ctrl+click to the front (queueAdd / queueRemove). Several selected factories:
 * the list shows the sum and the head says "3 Fabriken · Aufträge reihum".
 * Re-renders on queue events only; progress and remaining time are bound.
 */
export function FactoryQueue(): JSX.Element {
  const { factory } = useHud();
  const commands = useCommands();
  const listRef = useRef<HTMLDivElement>(null);
  const factories = useComputed(() => factory.detail.value?.factoryCount ?? 1);
  const q = factory.queue.value;
  const count = factories.value;
  const loc = locale.value;
  const units = useUnitCatalog();
  const blocks = q?.blocks ?? [];
  const { shown, more } = visibleCount(blocks.length, QUEUE_MAX_BLOCKS);
  const repeat = q?.repeat ?? false;
  const paused = q?.paused ?? false;
  const empty = queueIsEmpty(q);

  const edit = (e: MouseEvent): void => {
    const root = listRef.current;
    const el = root ? closestData(e.target, root, 'block') : null;
    if (el === null) return;
    const typeId = el.dataset['block']!;
    const c = queueClick(pointerMods(e));
    if (c.op === 'add') commands.queueAdd(typeId, c.count, c.toFront);
    else commands.queueRemove(typeId, c.count);
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    edit(e);
  };

  const items: JSX.Element[] = [];
  for (let i = 0; i < shown; i++) {
    const b = blocks[i]!;
    const name = unitName(units, b.typeId, loc);
    items.push(
      <button
        key={i}
        type="button"
        class={cx('fqi', i === 0 && 'is-first', repeat && 'is-loop')}
        data-block={b.typeId}
        data-testid="factory-block"
        title={t('ui.factory.block', { name, n: fmtInt(b.count, loc) })}
      >
        <StrategicIcon typeId={b.typeId} />
        <b class="num">{fmtInt(b.count, loc)}</b>
      </button>,
    );
  }
  if (more > 0) {
    items.push(
      <span key="+" class={cx('fqi', 'is-more', repeat && 'is-loop')} role="img" aria-label={tn('ui.factory.moreBlocks', more)} data-testid="factory-block-more">
        {t('ui.common.more', { n: fmtInt(more, loc) })}
      </span>,
    );
  }
  const click = t('ui.common.key.click');
  const right = t('ui.common.key.rightClick');

  return (
    <div class="fq" data-component="FactoryQueue" data-testid="factory-queue" data-state={factoryQueueState(q, count)}>
      <div class="fq__h">
        <span>{t('ui.factory.queue')}</span>
        {count > 1 ? (
          <span class="fq__multi" data-testid="factory-multi">
            {t('ui.factory.roundRobin', { count: tn('ui.factory.count', count) })}
          </span>
        ) : null}
      </div>
      <NowBlock q={q} />
      <div
        ref={listRef}
        class="fq__list"
        role="group"
        aria-label={t('ui.factory.list')}
        data-testid="factory-blocks"
        onClick={edit}
        onContextMenu={onContextMenu}
      >
        {blocks.length === 0 ? (
          <span class="fq__empty" data-testid="factory-empty">
            {t('ui.factory.empty')}
          </span>
        ) : (
          items
        )}
      </div>
      <div class="fq__ctl" role="group" aria-label={t('ui.factory.controls')}>
        <button
          type="button"
          class={cx('ff-btn', 'ff-btn--sm', repeat && 'is-on')}
          aria-pressed={repeat}
          title={t('ui.factory.ctl.repeatHint')}
          data-testid="factory-repeat"
          onClick={() => commands.toggleRepeat()}
        >
          <LineIcon name="repeat" />
          {t('ui.factory.ctl.repeat')}
        </button>
        <button
          type="button"
          class={cx('ff-btn', 'ff-btn--sm', paused && 'is-on')}
          aria-pressed={paused}
          title={t('ui.factory.ctl.pauseHint')}
          data-testid="factory-pause"
          onClick={() => commands.togglePauseProduction()}
        >
          <LineIcon name="pause" />
          {t('ui.factory.ctl.pause')}
        </button>
        <button
          type="button"
          class="ff-btn ff-btn--sm"
          title={t('ui.factory.ctl.rallyHint')}
          data-testid="factory-rally"
          onClick={() => commands.armRally()}
        >
          <LineIcon name="rally" />
          {t('ui.factory.ctl.rally')}
        </button>
        <button
          type="button"
          class={cx('ff-btn', 'ff-btn--sm', empty && 'is-disabled')}
          disabled={empty}
          title={t('ui.factory.ctl.clearHint')}
          data-testid="factory-clear"
          onClick={() => commands.clearQueue()}
        >
          <LineIcon name="close" />
          {t('ui.factory.ctl.clear')}
        </button>
      </div>
      <div class="fq__help">
        <span>
          <Key>{click}</Key> +1
        </span>
        <span>
          <Key>⇧</Key>+<Key>{click}</Key> +5
        </span>
        <span>
          <Key>{right}</Key> −1 · <Key>⇧</Key>+<Key>{right}</Key> −5
        </span>
        <span>
          <Key>{t('ui.common.key.ctrl')}</Key>+<Key>{click}</Key> {t('ui.factory.help.front')}
        </span>
      </div>
    </div>
  );
}
