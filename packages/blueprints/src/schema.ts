/**
 * TypeBox schemas of the blueprint types (PLAN §2 "Daten und Schema", §3.9). MS1 subset:
 * `unit` with health, motion, intel and view placeholder. Unknown fields are rejected
 * (`additionalProperties: false` everywhere).
 *
 * `UnitSchema` validates concrete units after `extends`; abstract bases are validated against
 * `AbstractUnitSchema` (same fields, all optional at every level).
 */
import { Kind, Type, type TObject, type TSchema } from '@sinclair/typebox';
import { MOTION_LAYER_NAMES } from '@faf/rules';
import { ASSET_ID_PATTERN } from './asset-manifest.ts';

/** Namespaced blueprint id `ns:name`. */
export const BLUEPRINT_ID_PATTERN = '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$';
/** Category name. */
export const CATEGORY_NAME_PATTERN = '^[A-Z][A-Z0-9_]*$';
/** i18n key, e.g. `unit.core.cube.name`. */
export const I18N_KEY_PATTERN = '^[a-z0-9_]+(\\.[a-z0-9_]+)+$';

const strict = { additionalProperties: false } as const;

const BlueprintId = Type.String({ pattern: BLUEPRINT_ID_PATTERN, maxLength: 64 });
const CategoryName = Type.String({ pattern: CATEGORY_NAME_PATTERN, maxLength: 64 });
const LayerName = Type.Union(MOTION_LAYER_NAMES.map((n) => Type.Literal(n)));
const PositiveSize = Type.Number({ exclusiveMinimum: 0, maximum: 256 });
const Unit01 = Type.Number({ minimum: 0, maximum: 1 });
const FootprintCells = Type.Integer({ minimum: 1, maximum: 64 });

export const PlaceholderSchema = Type.Object(
  {
    hull: Type.Union([Type.Literal('box'), Type.Literal('cyl')]),
    size: Type.Tuple([PositiveSize, PositiveSize, PositiveSize]),
    color: Type.Optional(Type.Tuple([Unit01, Unit01, Unit01])),
  },
  strict,
);

export const MotionSchema = Type.Object(
  {
    layer: LayerName,
    /** WU/s */
    speed: Type.Number({ minimum: 0, maximum: 100 }),
    /** WU/s² */
    accel: Type.Number({ exclusiveMinimum: 0, maximum: 1000 }),
    /** °/s */
    turnRateDeg: Type.Number({ exclusiveMinimum: 0, maximum: 3600 }),
    sizeClass: Type.Integer({ minimum: 0, maximum: 7 }),
    footprint: Type.Tuple([FootprintCells, FootprintCells]),
    maxSlope: Type.Number({ minimum: 0, maximum: 16 }),
    /** WU; default max(footprint) / 2 */
    radius: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 64 })),
  },
  strict,
);

export const UnitSimSchema = Type.Object(
  {
    health: Type.Object({ max: Type.Integer({ minimum: 1, maximum: 10_000_000 }) }, strict),
    motion: MotionSchema,
    intel: Type.Optional(Type.Object({ vision: Type.Optional(Type.Number({ minimum: 0, maximum: 1024 })) }, strict)),
  },
  strict,
);

export const UnitViewSchema = Type.Object(
  {
    placeholder: PlaceholderSchema,
    /** Model asset id (view only). */
    mesh: Type.Optional(Type.String({ pattern: ASSET_ID_PATTERN, maxLength: 128 })),
    /** LOD switch distances in WU (view only); the compiler checks lod[0] < lod[1]. */
    lod: Type.Optional(Type.Tuple([Type.Number({ exclusiveMinimum: 0, maximum: 65536 }), Type.Number({ exclusiveMinimum: 0, maximum: 65536 })])),
    icon: Type.Optional(Type.String({ pattern: '^[a-z0-9_]+$', maxLength: 64 })),
    iconThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1024 })),
    nameKey: Type.Optional(Type.String({ pattern: I18N_KEY_PATTERN, maxLength: 128 })),
    descKey: Type.Optional(Type.String({ pattern: I18N_KEY_PATTERN, maxLength: 128 })),
  },
  strict,
);

export const UnitSchema = Type.Object(
  {
    id: BlueprintId,
    extends: Type.Optional(BlueprintId),
    abstract: Type.Optional(Type.Boolean()),
    categories: Type.Array(CategoryName, { minItems: 1, maxItems: 64, uniqueItems: true }),
    sim: UnitSimSchema,
    view: UnitViewSchema,
  },
  strict,
);

/** Makes every object property optional, recursively (objects stay strict). */
function deepPartial(s: TSchema): TSchema {
  if (s[Kind] !== 'Object') return s;
  const o = s as TObject;
  const props: Record<string, TSchema> = {};
  for (const k of Object.keys(o.properties)) props[k] = Type.Optional(deepPartial(o.properties[k]!));
  return Type.Object(props, strict);
}

/** Abstract bases: same shape as UnitSchema, every field optional (id stays required). */
export const AbstractUnitSchema = (() => {
  const p = deepPartial(UnitSchema) as TObject;
  return Type.Object({ ...p.properties, id: BlueprintId }, strict);
})();
