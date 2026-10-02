import type { OrderId } from '@faf/hud';
import './command-art.css';

export const COMMAND_ART_ORDERS = ['move', 'attack', 'patrol', 'stop', 'assist', 'reclaim'] as const satisfies readonly OrderId[];
export type CommandArtOrder = typeof COMMAND_ART_ORDERS[number];

/** Semantic colors belong to the action, independently of the army's HUD palette. */
export const COMMAND_ART_COLORS: Readonly<Record<CommandArtOrder, string>> = {
  move: '#63e6ff',
  attack: '#ff5146',
  patrol: '#63e6ff',
  stop: '#ff5146',
  assist: '#ffd34f',
  reclaim: '#ffd34f',
};

// Source PNGs are provenance only. Vite bundles just the six compiled alpha assets.
const images = import.meta.glob<string>('./assets/command-art/*-v1.webp', { eager: true, query: '?url', import: 'default' });

export function hasCommandArt(order: OrderId): order is CommandArtOrder {
  return (COMMAND_ART_ORDERS as readonly OrderId[]).includes(order);
}

/** Decorative glyph only. OrderButton retains its accessible name, shortcut, and events. */
export function CommandArt({ order }: { readonly order: CommandArtOrder }) {
  return <span class="live-command-art" data-command-art={order} style={{ '--command-color': COMMAND_ART_COLORS[order] }} aria-hidden="true">
    <img src={images[`./assets/command-art/${order}-v1.webp`]} alt="" draggable={false} width={128} height={128}/>
  </span>;
}
