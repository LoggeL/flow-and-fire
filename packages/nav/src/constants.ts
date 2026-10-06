/**
 * Constants of the navigation package (PLAN §3.8). All values are integers; costs are in
 * "cost units" (10 per orthogonal step on flat ground, 14 per diagonal step).
 */

/** Number of size classes. A request of class s needs clearance ≥ s at every cell it uses. */
export const NAV_CLASSES = 3;

/** Clearance cap (Chebyshev distance to the nearest blocked cell, u8). */
export const NAV_MAX_CLEARANCE = 15;

/** Sector edge (cells = WU) and its log2; sectors coincide with the 32×32 grid chunks (PLAN §3.1). */
export const NAV_SECTOR_SHIFT = 5;
export const NAV_SECTOR_SIZE = 32;

/** Smallest / largest supported map edge in WU (power of two). */
export const NAV_MIN_SIZE_WU = 64;
export const NAV_MAX_SIZE_WU = 4096;

/**
 * Steepest cell a land unit may enter: maximum height difference of the 4 corner samples of a cell
 * (Fx raw per WU). 3072 = 0.75 WU per WU (≈ 37°). Chosen on hollow-ridge: ramps (≤ 0.46 WU/WU plus
 * noise) stay passable, plateau and mesa cliffs (up to 4 WU/WU) are blocked.
 */
export const NAV_LAND_MAX_SLOPE_RAW = 3072;

/** Cost levels of a passable cell derived from its slope (0 = flat … 3 = near the slope limit). */
export const NAV_COST_LEVELS = 4;

/** Base step costs (octile). */
export const NAV_COST_ORTH = 10;
export const NAV_COST_DIAG = 14;
/** Surcharge per cost level of each of the two cells of a step (step cost = base + s·(ka + kb)). */
export const NAV_SURCHARGE_ORTH = 2;
export const NAV_SURCHARGE_DIAG = 3;

/** Path table capacity (slots). */
export const NAV_CAP_PATHS = 4096;
/** u32 words per sector in the sector → path bitset (NAV_CAP_PATHS / 32). */
export const NAV_BACK_WORDS = NAV_CAP_PATHS >> 5;

/** Path block slab: 64-byte records = 16 words: [next, count, 14 payload words]. */
export const NAV_BLOCK_WORDS = 16;
export const NAV_BLOCK_PAYLOAD = 14;
export const NAV_CAP_BLOCKS = 12288;

/** Portal nodes: at most 4 per sector edge and class ⇒ 16 node slots per (sector, class). */
export const NAV_PORTALS_PER_EDGE = 4;
export const NAV_NODE_SLOTS = 16;
/** Upper triangle of the 16×16 intra-sector cost matrix. */
export const NAV_EDGE_SLOTS = 120;
/** Runs longer than this get two portals (at 1/4 and 3/4 of the run). */
export const NAV_LONG_RUN = 16;
/** "No edge" in the intra-sector cost matrix (u16). */
export const NAV_NO_EDGE = 0xffff;

/**
 * Component labels per class: 1..NAV_MAX_COMPONENTS, ordered by the smallest cell index of the
 * component (canonical, independent of history). Components beyond the cap share the label
 * NAV_COMP_OVERFLOW ("unknown", never treated as connected to anything).
 */
export const NAV_MAX_COMPONENTS = 16383;
export const NAV_COMP_OVERFLOW = 0xffff;

/** Largest footprint edge accepted by stampFootprint (local updates use scratch windows). */
export const NAV_MAX_FOOTPRINT = 64;

/**
 * Expansion budget of PathService.serviceTick per sim tick (SPK3, docs/status/ms3-p0-nav.md):
 * 200 requests across a 1,024-WU map finish in ≤ 10 ticks with p95 ≤ 5 ms/tick (Node, M5 Pro).
 */
export const NAV_BUDGET_EXPANSIONS_PER_TICK = 20000;

// Path states (column `state` of the path table).
export const PATH_NONE = 0;
export const PATH_PENDING = 1;
export const PATH_READY = 2;
export const PATH_DIRECT = 3;
export const PATH_FAILED = 4;
export const PATH_CANCELLED = 5;

// Path flags (column `flags`).
/** The goal was unreachable/blocked; the path leads to the nearest cell of the start component. */
export const PATH_F_RETARGETED = 1;
/** A new footprint cut the remaining corridor (see docs/status/ms3-p0-nav.md "Korridorregel"). */
export const PATH_F_REPATH = 2;
/** HPA* found no abstract route; the path is a full-map fine A* (fully refined). */
export const PATH_F_FALLBACK = 4;
/** The start cell was not passable for the class; the path starts at the nearest passable cell. */
export const PATH_F_START_MOVED = 8;

// Results of Nav.waypoint().
/** A waypoint was written to `out`. */
export const WP_OK = 1;
/** pointAt(): the point written to `out` is the path's final point (the effective goal). */
export const WP_LAST = 2;
/** The refined waypoints are used up; call refineNext() for the next segment. */
export const WP_NEED_REFINE = 0;
/** The path is finished (every waypoint consumed). */
export const WP_END = -1;
/** The request is still waiting in the FIFO. */
export const WP_PENDING = -2;
/** Failed, cancelled or free slot. */
export const WP_NONE = -3;

// Counter words of the `nav.ctr` region.
export const CTR_FIFO_HEAD = 0;
export const CTR_FIFO_COUNT = 1;
export const CTR_REQUESTS_ISSUED = 2;
export const CTR_REQUESTS_DONE = 3;
export const CTR_REPATHS_TRIGGERED = 4;
export const CTR_EXPANSIONS_LAST_TICK = 5;
export const CTR_EXPANSIONS_TOTAL_LO = 6;
export const CTR_EXPANSIONS_TOTAL_HI = 7;
export const CTR_FAILED = 8;
export const CTR_RETARGETED = 9;
export const CTR_DIRECT = 10;
export const CTR_FALLBACK = 11;
export const CTR_STAMPS = 12;
export const CTR_REFINES = 13;
export const CTR_BLOCKS_EXHAUSTED = 14;
export const CTR_WORDS = 16;
