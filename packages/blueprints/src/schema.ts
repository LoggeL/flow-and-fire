/**
 * TypeBox schemas of the blueprint types (PLAN §2 "Daten und Schema", §3.9): `unit`, `weapon`,
 * `projectile`, `prop`, `effect`, `faction`, `aiProfile`. Unknown fields are rejected
 * (`additionalProperties: false` everywhere).
 *
 * The concrete schemas validate emitted blueprints after `extends`; abstract bases are validated
 * against the deep-partial variant (same fields, all optional at every object level, still strict).
 */
import { Kind, Type, type TObject, type TSchema } from '@sinclair/typebox';
import { MOTION_LAYER_NAMES } from '@faf/rules';
import type { BlueprintKind } from './define.ts';
import { ASSET_ID_PATTERN } from './asset-manifest.ts';

/** Namespaced blueprint id `ns:name`. */
export const BLUEPRINT_ID_PATTERN = '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$';
/** Category name. */
export const CATEGORY_NAME_PATTERN = '^[A-Z][A-Z0-9_]*$';
/** i18n key, e.g. `unit.core.cube.name`. */
export const I18N_KEY_PATTERN = '^[a-z0-9_]+(\\.[a-z0-9_]+)+$';
/** Local ids (weapon mounts, AI weight rules, effect slots). */
export const LOCAL_ID_PATTERN = '^[a-z][a-z0-9_]*$';

const strict = { additionalProperties: false } as const;

const BlueprintId = Type.String({ pattern: BLUEPRINT_ID_PATTERN, maxLength: 64 });
const LocalId = Type.String({ pattern: LOCAL_ID_PATTERN, maxLength: 32 });
const CategoryName = Type.String({ pattern: CATEGORY_NAME_PATTERN, maxLength: 64 });
/** Category expression source (syntax/names are checked by the compiler with a position). */
const CategoryExprSource = Type.String({ minLength: 1, maxLength: 1024 });
const LayerName = Type.Union(MOTION_LAYER_NAMES.map((n) => Type.Literal(n)));
const PositiveSize = Type.Number({ exclusiveMinimum: 0, maximum: 256 });
const Unit01 = Type.Number({ minimum: 0, maximum: 1 });
const FootprintCells = Type.Integer({ minimum: 1, maximum: 64 });
const I18nKey = Type.String({ pattern: I18N_KEY_PATTERN, maxLength: 128 });
const Rgb = Type.Tuple([Unit01, Unit01, Unit01]);
const Offset = Type.Number({ minimum: -256, maximum: 256 });
const AssetId = Type.String({ pattern: ASSET_ID_PATTERN, maxLength: 128 });
const Lod = Type.Tuple([Type.Number({ exclusiveMinimum: 0, maximum: 65536 }), Type.Number({ exclusiveMinimum: 0, maximum: 65536 })]);
/** Effect slots (`death`, `muzzle`, …) → effect ids. */
const FxSlots = Type.Record(Type.String({ pattern: LOCAL_ID_PATTERN }), BlueprintId, { additionalProperties: false });
const Hull = Type.Union([Type.Literal('box'), Type.Literal('cyl')]);
/** Reference or explicit "none" (merge semantics: `null` deletes an inherited value). */
const OptionalRef = Type.Optional(Type.Union([BlueprintId, Type.Null()]));

export const PlaceholderTurretSchema = Type.Object(
  {
    hull: Hull,
    size: Type.Tuple([PositiveSize, PositiveSize, PositiveSize]),
    offset: Type.Tuple([Offset, Offset, Offset]),
  },
  strict,
);

export const PlaceholderSchema = Type.Object(
  {
    hull: Hull,
    size: Type.Tuple([PositiveSize, PositiveSize, PositiveSize]),
    color: Type.Optional(Rgb),
    turret: Type.Optional(PlaceholderTurretSchema),
  },
  strict,
);

export const MotionSchema = Type.Object(
  {
    layer: LayerName,
    /** WU/s */
    speed: Type.Number({ minimum: 0, maximum: 100 }),
    /** WU/s² (> 0 when speed > 0; structures may use 0) */
    accel: Type.Number({ minimum: 0, maximum: 1000 }),
    /** °/s (> 0 when speed > 0; structures may use 0) */
    turnRateDeg: Type.Number({ minimum: 0, maximum: 3600 }),
    sizeClass: Type.Integer({ minimum: 0, maximum: 7 }),
    footprint: Type.Tuple([FootprintCells, FootprintCells]),
    maxSlope: Type.Number({ minimum: 0, maximum: 16 }),
    /** WU; default max(footprint) / 2 */
    radius: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 64 })),
    /** Collision mass/priority (integer); default from sizeClass. */
    mass: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
    /** Tracks turn in place (default true for land). */
    turnInPlace: Type.Optional(Type.Boolean()),
    /** WU/s² braking deceleration. */
    brake: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1000 })),
  },
  strict,
);

export const WeaponMountSchema = Type.Object(
  {
    id: LocalId,
    ref: BlueprintId,
    part: Type.Union([Type.Literal('hull'), Type.Literal('turret')]),
    arcDeg: Type.Number({ exclusiveMinimum: 0, maximum: 360 }),
    yawRateDeg: Type.Number({ exclusiveMinimum: 0, maximum: 3600 }),
    layers: Type.Array(LayerName, { minItems: 1, maxItems: 6, uniqueItems: true }),
    priorities: Type.Array(CategoryExprSource, { minItems: 1, maxItems: 16 }),
  },
  strict,
);

export const EconomySchema = Type.Object(
  {
    mass: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    energy: Type.Integer({ minimum: 0, maximum: 100_000_000 }),
    buildTime: Type.Integer({ minimum: 1, maximum: 100_000_000 }),
    buildableBy: Type.Optional(CategoryExprSource),
  },
  strict,
);

export const UnitSimSchema = Type.Object(
  {
    health: Type.Object({ max: Type.Integer({ minimum: 1, maximum: 10_000_000 }) }, strict),
    motion: MotionSchema,
    intel: Type.Optional(Type.Object({ vision: Type.Optional(Type.Number({ minimum: 0, maximum: 1024 })) }, strict)),
    economy: Type.Optional(EconomySchema),
    weapons: Type.Optional(Type.Array(WeaponMountSchema, { maxItems: 16 })),
    hitbox: Type.Optional(Type.Tuple([PositiveSize, PositiveSize, PositiveSize])),
    wreck: Type.Optional(Type.Object({ massFraction: Unit01, hpFraction: Unit01 }, strict)),
    deathWeapon: OptionalRef,
    veterancy: Type.Optional(Type.Union([Type.Literal('default'), Type.Literal('none')])),
    upgradesTo: OptionalRef,
    behaviors: Type.Optional(Type.Array(LocalId, { maxItems: 32, uniqueItems: true })),
    toggles: Type.Optional(Type.Array(LocalId, { maxItems: 16, uniqueItems: true })),
  },
  strict,
);

export const UnitViewSchema = Type.Object(
  {
    placeholder: PlaceholderSchema,
    /** Model asset id (view only). */
    mesh: Type.Optional(AssetId),
    /** LOD switch distances in WU (view only); the compiler checks lod[0] < lod[1]. */
    lod: Type.Optional(Lod),
    icon: Type.Optional(Type.String({ pattern: '^[a-z0-9_]+$', maxLength: 64 })),
    iconThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1024 })),
    selectionRadius: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 64 })),
    hotkeySlot: Type.Optional(Type.String({ pattern: '^[A-Z0-9]$' })),
    fx: Type.Optional(FxSlots),
    nameKey: Type.Optional(I18nKey),
    descKey: Type.Optional(I18nKey),
  },
  strict,
);

const Identity = {
  id: BlueprintId,
  extends: Type.Optional(BlueprintId),
  abstract: Type.Optional(Type.Boolean()),
};

export const UnitSchema = Type.Object(
  {
    ...Identity,
    categories: Type.Array(CategoryName, { minItems: 1, maxItems: 64, uniqueItems: true }),
    sim: UnitSimSchema,
    view: UnitViewSchema,
  },
  strict,
);

export const WeaponSchema = Type.Object(
  {
    ...Identity,
    sim: Type.Object(
      {
        range: Type.Number({ exclusiveMinimum: 0, maximum: 4096 }),
        minRange: Type.Optional(Type.Number({ minimum: 0, maximum: 4096 })),
        damage: Type.Integer({ minimum: 0, maximum: 10_000_000 }),
        damageRadius: Type.Optional(Type.Number({ minimum: 0, maximum: 256 })),
        reloadSec: Type.Number({ exclusiveMinimum: 0, maximum: 3600 }),
        muzzleVelocity: Type.Number({ exclusiveMinimum: 0, maximum: 1000 }),
        projectile: BlueprintId,
        salvo: Type.Integer({ minimum: 1, maximum: 256 }),
        salvoIntervalSec: Type.Optional(Type.Number({ minimum: 0, maximum: 60 })),
      },
      strict,
    ),
    view: Type.Optional(Type.Object({ fx: Type.Optional(FxSlots) }, strict)),
  },
  strict,
);

export const ProjectileSchema = Type.Object(
  {
    ...Identity,
    sim: Type.Object(
      {
        kind: Type.Union([Type.Literal('linear'), Type.Literal('ballistic'), Type.Literal('homing')]),
        speed: Type.Number({ exclusiveMinimum: 0, maximum: 1000 }),
        gravity: Type.Optional(Type.Number({ minimum: 0, maximum: 1000 })),
        lifetimeSec: Type.Number({ exclusiveMinimum: 0, maximum: 600 }),
        turnRateDeg: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 3600 })),
      },
      strict,
    ),
    view: Type.Optional(
      Type.Object(
        {
          shape: Type.Optional(Type.Union([Type.Literal('sphere'), Type.Literal('tracer')])),
          size: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 64 })),
          color: Type.Optional(Rgb),
          trailFx: Type.Optional(BlueprintId),
        },
        strict,
      ),
    ),
  },
  strict,
);

export const PropSchema = Type.Object(
  {
    ...Identity,
    sim: Type.Object(
      {
        reclaim: Type.Object(
          {
            mass: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
            energy: Type.Integer({ minimum: 0, maximum: 100_000_000 }),
            timeSec: Type.Number({ minimum: 0, maximum: 3600 }),
          },
          strict,
        ),
        blocksShots: Type.Boolean(),
        footprint: Type.Tuple([Type.Integer({ minimum: 0, maximum: 64 }), Type.Integer({ minimum: 0, maximum: 64 })]),
        health: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000_000 })),
      },
      strict,
    ),
    view: Type.Object({ placeholder: PlaceholderSchema, mesh: Type.Optional(AssetId), lod: Type.Optional(Lod) }, strict),
  },
  strict,
);

export const EffectSchema = Type.Object(
  {
    ...Identity,
    view: Type.Object(
      {
        kind: Type.Union([Type.Literal('flash'), Type.Literal('burst'), Type.Literal('trail'), Type.Literal('decal')]),
        color: Rgb,
        size: Type.Number({ exclusiveMinimum: 0, maximum: 256 }),
        durationSec: Type.Number({ exclusiveMinimum: 0, maximum: 60 }),
        count: Type.Optional(Type.Integer({ minimum: 1, maximum: 256 })),
      },
      strict,
    ),
  },
  strict,
);

export const FactionSchema = Type.Object(
  {
    ...Identity,
    units: Type.Array(BlueprintId, { minItems: 1, maxItems: 1024, uniqueItems: true }),
    startUnit: BlueprintId,
    color: Rgb,
    nameKey: Type.Optional(I18nKey),
  },
  strict,
);

const AiWeight = Type.Object(
  { id: LocalId, categories: CategoryExprSource, weight: Type.Number({ minimum: 0, maximum: 100 }) },
  strict,
);

export const AiProfileSchema = Type.Object(
  {
    ...Identity,
    build: Type.Array(AiWeight, { minItems: 1, maxItems: 64 }),
    attack: Type.Array(AiWeight, { minItems: 1, maxItems: 64 }),
    nameKey: Type.Optional(I18nKey),
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

/** Abstract bases: same shape as the concrete schema, every field optional (id stays required). */
function abstractOf(s: TObject): TObject {
  const p = deepPartial(s) as TObject;
  return Type.Object({ ...p.properties, id: BlueprintId }, strict);
}

export const AbstractUnitSchema = abstractOf(UnitSchema);

/** Concrete schema per blueprint kind. */
export const SCHEMAS: Readonly<Record<BlueprintKind, TObject>> = {
  unit: UnitSchema,
  weapon: WeaponSchema,
  projectile: ProjectileSchema,
  prop: PropSchema,
  effect: EffectSchema,
  faction: FactionSchema,
  aiProfile: AiProfileSchema,
};

/** Abstract (deep-partial) schema per blueprint kind. */
export const ABSTRACT_SCHEMAS: Readonly<Record<BlueprintKind, TObject>> = {
  unit: AbstractUnitSchema,
  weapon: abstractOf(WeaponSchema),
  projectile: abstractOf(ProjectileSchema),
  prop: abstractOf(PropSchema),
  effect: abstractOf(EffectSchema),
  faction: abstractOf(FactionSchema),
  aiProfile: abstractOf(AiProfileSchema),
};

/** Locale table (content/locales/<lang>.json): flat i18n key → non-empty string. */
export const LocaleTableSchema = Type.Record(Type.String({ pattern: I18N_KEY_PATTERN, maxLength: 128 }), Type.String({ minLength: 1, maxLength: 2048 }), {
  additionalProperties: false,
});
