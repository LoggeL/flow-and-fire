import { useComputed } from '@preact/signals';
import type { JSX, Ref } from 'preact';
import { useRef } from 'preact/hooks';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { locale } from '../../i18n/locale.ts';
import { t, tn } from '../../i18n/t.ts';
import { ORDER_QUEUE_MAX_ROWS, orderChainKey } from '../../model/selection.ts';
import type { OrderEntry } from '../../model/selection.ts';
import { useCommands, useHud, useUnitCatalog } from '../../model/index.ts';
import { clamp01, useBindEffect } from '../../ui/bind.ts';
import { cx } from '../../ui/cx.ts';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { closestData, pointerMods } from './events.ts';
import { ORDER_ICONS, orderLabel, orderValue } from './labels.ts';

/** Rows shown for a chain of `n` orders: all when they fit, else ORDER_QUEUE_MAX_ROWS − 1 plus "+N more". */
export function orderRows(n: number): { readonly shown: number; readonly more: number } {
  if (n <= ORDER_QUEUE_MAX_ROWS) return { shown: n, more: 0 };
  return { shown: ORDER_QUEUE_MAX_ROWS - 1, more: n - (ORDER_QUEUE_MAX_ROWS - 1) };
}

function OrderRow({ o, i, runRef }: { readonly o: OrderEntry; readonly i: number; readonly runRef?: Ref<HTMLButtonElement> }): JSX.Element {
  const loc = locale.value;
  const units = useUnitCatalog();
  const label = orderLabel(units, o, loc);
  const running = i === 0;
  return (
    <button
      ref={runRef ?? null}
      type="button"
      class={cx('qi', running && 'is-now')}
      data-order-index={i}
      data-testid={`order-${i}`}
      aria-label={t('ui.selection.orders.entry', { i: String(i + 1), label })}
      style={running ? { '--v': String(clamp01(o.progress ?? 0)) } : undefined}
    >
      {running ? <LineIcon name={ORDER_ICONS[o.kind]} /> : <span class="n">{i + 1}</span>}
      {o.typeId !== undefined ? (
        <StrategicIcon typeId={o.typeId} />
      ) : running ? (
        // The running row already shows the order icon as its marker.
        <span />
      ) : (
        <LineIcon name={ORDER_ICONS[o.kind]} />
      )}
      <span class="qi__l">{label}</span>
      {running ? <RunningValue /> : <span class="ff-lo num">{orderValue(o, loc)}</span>}
    </button>
  );
}

/** Value of the running order, bound to the 4 Hz model (text binding, no re-render). */
function RunningValue(): JSX.Element {
  const { selection } = useHud();
  const text = useComputed(() => {
    const o = selection.single.value?.orders[0];
    return o === undefined ? '' : orderValue(o, locale.value);
  });
  return (
    <span class="qi__p num" data-testid="order-running-value">
      {text}
    </span>
  );
}

/**
 * Order chain of a single unit (ui.md §5.5 `OrderQueue`, C5): running order with ember edge and progress,
 * queued orders numbered, "+N" when longer than the panel; click → jumpToOrder(i), right click →
 * removeOrder(i). Re-renders only when the chain structure changes; the running progress is bound.
 */
export function OrderQueue(): JSX.Element {
  const { selection } = useHud();
  const commands = useCommands();
  const listRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<HTMLButtonElement>(null);
  const key = useComputed(() => {
    const s = selection.single.value;
    return s === null ? '' : orderChainKey(s.orders);
  });
  // Subscribe to the structure key only; the chain itself is read without subscribing.
  void key.value;
  const orders = selection.single.peek()?.orders ?? [];
  const { shown, more } = orderRows(orders.length);

  useBindEffect(() => {
    const o = selection.single.value?.orders[0];
    const el = runRef.current;
    if (el === null || o === undefined) return;
    el.style.setProperty('--v', String(clamp01(o.progress ?? 0)));
  }, [key.peek()]);

  const onClick = (e: MouseEvent): void => {
    const root = listRef.current;
    const row = root ? closestData(e.target, root, 'order-index') : null;
    if (row === null) return;
    commands.jumpToOrder(Number(row.dataset['orderIndex']));
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const root = listRef.current;
    const row = root ? closestData(e.target, root, 'order-index') : null;
    if (row === null) return;
    const index = Number(row.dataset['orderIndex']);
    if (pointerMods(e).button === 0) commands.jumpToOrder(index);
    else commands.removeOrder(index);
  };

  const rows: JSX.Element[] = [];
  for (let i = 0; i < shown; i++) {
    const o = orders[i]!;
    rows.push(i === 0 ? <OrderRow key={i} o={o} i={i} runRef={runRef} /> : <OrderRow key={i} o={o} i={i} />);
  }

  return (
    <div
      ref={listRef}
      class="qlist"
      role="group"
      aria-label={t('ui.selection.orders.title')}
      data-component="OrderQueue"
      data-testid="order-queue"
      data-state={orders.length === 0 ? 'empty' : orders.length > 1 ? 'queued' : 'running'}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div class="qlist__h">
        <span>{t('ui.selection.orders.title')}</span>
        <span class="ff-lo">⇧ {t('ui.selection.orders.append')}</span>
      </div>
      {orders.length === 0 ? (
        <div class="qi is-empty" data-testid="order-empty">
          <LineIcon name="idle" />
          <span />
          <span class="qi__l">{t('ui.selection.orders.empty')}</span>
        </div>
      ) : (
        rows
      )}
      {more > 0 ? (
        <div class="qi is-more" data-testid="order-more">
          <span />
          <span />
          <span class="qi__l">{tn('ui.selection.orders.more', more)}</span>
        </div>
      ) : null}
    </div>
  );
}
