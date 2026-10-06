/** Test helpers of the selection group: render counting via Preact's options.diffed hook, node counting. */
import { options } from 'preact';
import type { VNode } from 'preact';

export interface RenderCounter {
  count(component: unknown): number;
  total(): number;
  reset(): void;
  restore(): void;
}

/** Counts diffs (= renders) of the given component functions until restore(). */
export function countRenders(components: readonly unknown[]): RenderCounter {
  const prev = options.diffed;
  const counts = new Map<unknown, number>();
  options.diffed = (vnode: VNode) => {
    if (components.includes(vnode.type)) counts.set(vnode.type, (counts.get(vnode.type) ?? 0) + 1);
    prev?.(vnode);
  };
  return {
    count: (c) => counts.get(c) ?? 0,
    total: () => {
      let n = 0;
      for (const v of counts.values()) n += v;
      return n;
    },
    reset: () => counts.clear(),
    restore: () => {
      if (prev === undefined) delete options.diffed;
      else options.diffed = prev;
    },
  };
}

/**
 * DOM nodes of a subtree counted like the gallery layout check / shoot.mjs: every element counts once,
 * an <svg> counts as <svg><use> = 2 whatever its content.
 */
export function countNodes(root: Element): number {
  const all = root.querySelectorAll('*').length + 1;
  const svgs = root.querySelectorAll('svg').length;
  const svgInner = root.querySelectorAll('svg *').length;
  return all - svgInner + svgs;
}

/** Records childList/characterData/attribute mutations below `root`. */
export function watchMutations(root: Node): { readonly records: () => MutationRecord[]; readonly stop: () => void } {
  const records: MutationRecord[] = [];
  const mo = new MutationObserver((r) => records.push(...r));
  mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  return {
    records: () => {
      records.push(...mo.takeRecords());
      return records;
    },
    stop: () => mo.disconnect(),
  };
}
