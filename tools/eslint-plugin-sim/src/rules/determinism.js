// @ts-check
/**
 * sim/determinism — enforces the determinism contract (PLAN §3.1, §3.12) in simulation packages.
 *
 * Reported constructs:
 *  - Math.* except imul/floor/trunc/min/max/abs/sign/clz32 (Math.sqrt only in `sqrtAllow` files)
 *  - Math.random, crypto (getRandomValues/randomUUID), Date, performance, timers
 *    (setTimeout/setInterval/setImmediate/queueMicrotask/requestAnimationFrame)
 *  - async functions, await, for await
 *  - for…in
 *  - `**` and `**=`
 *  - Map/Set/WeakMap/WeakSet/WeakRef/FinalizationRegistry (as values)
 *  - `.sort()` / `.toSorted()` without comparator
 *  - Float32Array, Float16Array; Float64Array outside `float64Allow` files
 *  - DataView float accessors (getFloat16/32/64, setFloat16/32/64) on any object outside
 *    `float64Allow` files
 *  - parseFloat / Number.parseFloat, Number(…) as a conversion function, unary `+` (except on a
 *    numeric literal) as a conversion operator
 *  - JSON.parse outside `jsonParseAllow` files (those must validate every number as an integer)
 *  - globalThis/self/window/global other than as `<global>.<name>` (aliases or computed access
 *    would bypass the checks of the forbidden globals)
 *  - `/` and `/=` unless the quotient is truncated right away: direct argument of Math.floor /
 *    Math.trunc, or operand of a bitwise operator (`| 0`, `>> 0`, `>>> 0`, `& m`, …)
 *  - non-integer numeric literals unless the direct argument of fx()/fxSmall()/deg()
 *  - localeCompare / toLocale* / Intl
 *  - imports of @faf/render, @faf/client, @faf/ai, @faf/sim-host; Node modules with clocks,
 *    timers or randomness (perf_hooks, crypto, timers, worker_threads, …)
 */

const ALLOWED_MATH = new Set(['imul', 'floor', 'trunc', 'min', 'max', 'abs', 'sign', 'clz32']);
const TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'requestAnimationFrame']);
const COLLECTIONS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry']);
const LITERAL_HELPERS = new Set(['fx', 'fxSmall', 'deg']);
const FORBIDDEN_IMPORTS = ['@faf/render', '@faf/client', '@faf/ai', '@faf/sim-host'];
/** Node built-ins that expose wall clocks, timers, randomness or threads (with and without `node:`). */
const FORBIDDEN_NODE_MODULES = new Set(['perf_hooks', 'crypto', 'timers', 'timers/promises', 'worker_threads', 'os', 'process', 'async_hooks']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window', 'global']);
const FLOAT_ACCESSORS = new Set(['getFloat16', 'getFloat32', 'getFloat64', 'setFloat16', 'setFloat32', 'setFloat64']);
/** Operators whose operands are converted with ToInt32/ToUint32 (a quotient is truncated). */
const TRUNCATING_BINARY = new Set(['|', '&', '^', '<<', '>>', '>>>']);
/** Wrapper nodes that do not change the value (TypeScript assertions, parentheses are not nodes). */
const TRANSPARENT = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSSatisfiesExpression']);

/** Globals whose value references are forbidden (the key is the message id). */
const FORBIDDEN_GLOBALS = /** @type {Record<string, string>} */ ({
  Date: 'date',
  performance: 'performance',
  Intl: 'intl',
  Float32Array: 'float32',
  Float16Array: 'float16',
  crypto: 'crypto',
  parseFloat: 'parseFloat',
  ...Object.fromEntries([...TIMERS].map((t) => [t, 'timer'])),
  ...Object.fromEntries([...COLLECTIONS].map((c) => [c, 'collection'])),
});

/**
 * @param {string} filename
 * @param {string} cwd
 * @param {readonly string[]} list
 */
function fileMatches(filename, cwd, list) {
  const abs = filename.replace(/\\/g, '/');
  const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = abs.startsWith(base + '/') ? abs.slice(base.length + 1) : abs;
  return list.some((entry) => {
    const e = entry.replace(/\\/g, '/').replace(/^\.\//, '');
    return rel === e || abs === e || abs.endsWith('/' + e);
  });
}

/** @param {any} node */
function propertyName(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value;
  }
  return null;
}

/** @param {string} source */
function isForbiddenImport(source) {
  if (FORBIDDEN_IMPORTS.some((p) => source === p || source.startsWith(p + '/'))) return true;
  return FORBIDDEN_NODE_MODULES.has(source.startsWith('node:') ? source.slice(5) : source);
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid non-deterministic constructs in simulation packages (PLAN §3.12).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          sqrtAllow: { type: 'array', items: { type: 'string' } },
          float64Allow: { type: 'array', items: { type: 'string' } },
          jsonParseAllow: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      mathMember: 'Math.{{name}} is not deterministic across engines; use @faf/fixed (fx*, isqrt, sinA/cosA/atan2A).',
      mathSqrt: 'Math.sqrt is only allowed in the isqrt implementation; use isqrt/fxSqrt/fxLen2D from @faf/fixed.',
      mathRandom: 'Math.random is forbidden in the simulation; use rng32(seed, tick, entityIdx, salt).',
      mathAlias: 'Math must only be used as Math.<allowed member>(…); aliasing or computed access is forbidden.',
      date: 'Date (wall clock) is forbidden in the simulation.',
      performance: 'performance (wall clock) is forbidden in the simulation.',
      timer: '{{name}} is forbidden in the simulation; state only changes via step(commands).',
      async: 'async functions are forbidden in the simulation (tick must be synchronous).',
      await: 'await is forbidden in the simulation (tick must be synchronous).',
      forIn: 'for…in iteration order is not part of the contract; iterate slots/dense arrays explicitly.',
      pow: 'The ** operator is forbidden (Math.pow semantics differ across engines); multiply explicitly.',
      collection:
        '{{name}} is forbidden as simulation state (not in the arena, iteration order/identity); use arena tables.',
      sortNoComparator: '.{{name}}() without comparator is forbidden; pass a total comparator.',
      float32: 'Float32Array is forbidden in the simulation.',
      float16: 'Float16Array is forbidden in the simulation.',
      floatAccessor: '{{name}} stores/reads floats; simulation state is integer (Fx) – use getInt32/setInt32 or SafeInt.',
      crypto: 'crypto is a non-deterministic random source; use rng32(seed, tick, entityIdx, salt).',
      parseFloat: '{{name}} yields non-integer numbers; numbers enter the simulation as Fx integers.',
      numberCall: 'Number(…) conversion can yield non-integer numbers; use explicit integer conversions.',
      unaryPlus: 'Unary + converts to a (possibly non-integer) number; use explicit integer conversions.',
      jsonParse:
        'JSON.parse yields arbitrary (non-integer) numbers; only allowed in jsonParseAllow files that check every number with Number.isInteger.',
      globalAlias:
        '{{name}} may only be used as {{name}}.<name>; aliasing or computed access bypasses the determinism checks.',
      division:
        'Division yields non-integers; truncate it right away (Math.floor/Math.trunc(a / b), (a / b) | 0) or use fxDiv from @faf/fixed.',
      float64: 'Float64Array is only allowed through SafeInt storage (packages/heap/src/safeint.ts).',
      floatLiteral:
        'Non-integer literal {{raw}} is forbidden; convert constants via fx(…), fxSmall(…) or deg(…).',
      intl: 'Intl is locale-dependent and forbidden in the simulation.',
      locale: '{{name}} is locale-dependent and forbidden in the simulation.',
      forbiddenImport: 'Simulation packages must not import {{source}} (dependency direction / non-deterministic Node module, PLAN §3.2, §3.12).',
    },
  },
  create(context) {
    const options = /** @type {{sqrtAllow?: string[], float64Allow?: string[], jsonParseAllow?: string[]}} */ (context.options[0] ?? {});
    const filename = context.filename;
    const cwd = context.cwd;
    const sqrtAllowed = fileMatches(filename, cwd, options.sqrtAllow ?? []);
    const float64Allowed = fileMatches(filename, cwd, options.float64Allow ?? []);
    const jsonParseAllowed = fileMatches(filename, cwd, options.jsonParseAllow ?? []);
    const sourceCode = context.sourceCode;

    /** @param {any} node @param {string} name */
    function checkMathMember(node, name) {
      if (name === 'random') context.report({ node, messageId: 'mathRandom' });
      else if (name === 'sqrt') {
        if (!sqrtAllowed) context.report({ node, messageId: 'mathSqrt' });
      } else if (!ALLOWED_MATH.has(name)) context.report({ node, messageId: 'mathMember', data: { name } });
    }

    /**
     * @param {any} identifier
     * @param {string} name
     */
    function checkGlobalReference(identifier, name) {
      if (GLOBAL_OBJECTS.has(name)) {
        // Only `<global>.<static name>` (through TS assertions) is allowed; the property is then
        // checked like a direct reference to that global.
        /** @type {any} */
        let child = identifier;
        let parent = identifier.parent;
        while (parent && TRANSPARENT.has(parent.type)) {
          child = parent;
          parent = parent.parent;
        }
        const prop = parent && parent.type === 'MemberExpression' && parent.object === child ? propertyName(parent) : null;
        if (prop === null) context.report({ node: identifier, messageId: 'globalAlias', data: { name } });
        else checkGlobalProperty(parent, prop);
        return;
      }
      if (name === 'Math') {
        const parent = identifier.parent;
        if (parent && parent.type === 'MemberExpression' && parent.object === identifier) {
          const prop = propertyName(parent);
          if (prop === null) context.report({ node: parent, messageId: 'mathAlias' });
          else checkMathMember(parent, prop);
        } else {
          context.report({ node: identifier, messageId: 'mathAlias' });
        }
        return;
      }
      if (name === 'Float64Array') {
        if (!float64Allowed) context.report({ node: identifier, messageId: 'float64' });
        return;
      }
      const messageId = FORBIDDEN_GLOBALS[name];
      if (messageId !== undefined) context.report({ node: identifier, messageId, data: { name } });
    }

    /**
     * `<global>.<prop>` (globalThis.Date, self.setTimeout, window.Math.random …): same rules as a
     * direct reference to `prop`.
     * @param {any} node MemberExpression
     * @param {string} prop
     */
    function checkGlobalProperty(node, prop) {
      if (prop === 'Math') {
        const outer = node.parent;
        if (outer && outer.type === 'MemberExpression' && outer.object === node) {
          const inner = propertyName(outer);
          if (inner === null) context.report({ node: outer, messageId: 'mathAlias' });
          else checkMathMember(outer, inner);
        } else context.report({ node, messageId: 'mathAlias' });
      } else if (prop === 'Float64Array') {
        if (!float64Allowed) context.report({ node, messageId: 'float64' });
      } else if (GLOBAL_OBJECTS.has(prop)) {
        // globalThis.self, window.globalThis … : treat like the alias it is.
        const outer = node.parent;
        if (!(outer && outer.type === 'MemberExpression' && outer.object === node && propertyName(outer) !== null)) {
          context.report({ node, messageId: 'globalAlias', data: { name: prop } });
        } else checkGlobalProperty(outer, /** @type {string} */ (propertyName(outer)));
      } else if (prop === 'JSON') {
        const outer = node.parent;
        if (!jsonParseAllowed && outer && outer.type === 'MemberExpression' && outer.object === node && propertyName(outer) === 'parse') {
          context.report({ node: outer, messageId: 'jsonParse' });
        }
      } else if (FORBIDDEN_GLOBALS[prop] !== undefined) {
        context.report({ node, messageId: /** @type {string} */ (FORBIDDEN_GLOBALS[prop]), data: { name: prop } });
      }
    }

    /**
     * True if `identifier` resolves to the global binding (not a local/param of the same name).
     * @param {any} identifier
     */
    function isGlobalRef(identifier) {
      let scope = sourceCode.getScope(identifier);
      while (scope) {
        const v = scope.set.get(identifier.name);
        if (v && v.defs.length > 0) return false;
        scope = scope.upper;
      }
      return true;
    }

    /**
     * True if the quotient `div` is truncated to an integer right away: it is (through TS
     * assertions) the only argument of Math.floor/Math.trunc or an operand of a bitwise operator.
     * @param {any} div
     */
    function isTruncated(div) {
      /** @type {any} */
      let child = div;
      let parent = div.parent;
      while (parent && TRANSPARENT.has(parent.type)) {
        child = parent;
        parent = parent.parent;
      }
      if (!parent) return false;
      if (parent.type === 'BinaryExpression' && TRUNCATING_BINARY.has(parent.operator)) return true;
      if (parent.type === 'CallExpression' && parent.arguments.length === 1 && parent.arguments[0] === child) {
        const c = parent.callee;
        if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'Math') {
          const name = propertyName(c);
          return name === 'floor' || name === 'trunc';
        }
      }
      return false;
    }

    /** @param {any} fn */
    function checkAsync(fn) {
      if (fn.async) context.report({ node: fn, messageId: 'async' });
    }

    return {
      'Program:exit'(program) {
        const scope = sourceCode.getScope(program);
        let globalScope = scope;
        while (globalScope.upper) globalScope = globalScope.upper;
        const seen = new Set();
        const names = ['Math', 'Float64Array', ...GLOBAL_OBJECTS, ...Object.keys(FORBIDDEN_GLOBALS)];
        for (const name of names) {
          const variable = globalScope.set.get(name);
          const refs = [
            ...(variable ? variable.references : []),
            ...globalScope.through.filter((r) => r.identifier.name === name),
          ];
          for (const ref of refs) {
            if (seen.has(ref.identifier)) continue;
            seen.add(ref.identifier);
            // typescript-eslint marks pure type references (e.g. `x: Float64Array`); only values matter.
            if (/** @type {any} */ (ref).isValueReference === false) continue;
            checkGlobalReference(ref.identifier, name);
          }
        }
      },
      MemberExpression(node) {
        const prop = propertyName(node);
        if (prop === null) return;
        // globalThis.X / self.X / window.X are checked with the global references (Program:exit).
        if (node.object.type === 'Identifier' && node.object.name === 'Number' && prop === 'parseFloat' && isGlobalRef(node.object)) {
          context.report({ node, messageId: 'parseFloat', data: { name: 'Number.parseFloat' } });
        }
        if (node.object.type === 'Identifier' && node.object.name === 'JSON' && prop === 'parse' && !jsonParseAllowed && isGlobalRef(node.object)) {
          context.report({ node, messageId: 'jsonParse' });
        }
        if (FLOAT_ACCESSORS.has(prop) && !float64Allowed) {
          context.report({ node: node.property, messageId: 'floatAccessor', data: { name: prop } });
        }
        if (prop === 'localeCompare' || prop.startsWith('toLocale')) {
          context.report({ node: node.property, messageId: 'locale', data: { name: prop } });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === 'Identifier' && callee.name === 'Number' && isGlobalRef(callee)) {
          context.report({ node, messageId: 'numberCall' });
        }
        if (callee.type === 'MemberExpression' && node.arguments.length === 0) {
          const prop = propertyName(callee);
          if (prop === 'sort' || prop === 'toSorted') {
            context.report({ node, messageId: 'sortNoComparator', data: { name: prop } });
          }
        }
      },
      FunctionDeclaration: checkAsync,
      FunctionExpression: checkAsync,
      ArrowFunctionExpression: checkAsync,
      UnaryExpression(node) {
        if (node.operator !== '+') return;
        const arg = /** @type {any} */ (node.argument);
        if (arg.type === 'Literal' && typeof arg.value === 'number') return;
        context.report({ node, messageId: 'unaryPlus' });
      },
      AwaitExpression(node) {
        context.report({ node, messageId: 'await' });
      },
      ForOfStatement(node) {
        if (node.await) context.report({ node, messageId: 'await' });
      },
      ForInStatement(node) {
        context.report({ node, messageId: 'forIn' });
      },
      BinaryExpression(node) {
        if (node.operator === '**') context.report({ node, messageId: 'pow' });
        else if (node.operator === '/' && !isTruncated(node)) context.report({ node, messageId: 'division' });
      },
      AssignmentExpression(node) {
        if (node.operator === '**=') context.report({ node, messageId: 'pow' });
        else if (node.operator === '/=') context.report({ node, messageId: 'division' });
      },
      Literal(node) {
        if (typeof node.value !== 'number' || Number.isInteger(node.value)) return;
        /** @type {any} */
        let arg = node;
        const parentAny = /** @type {any} */ (node).parent;
        if (parentAny && parentAny.type === 'UnaryExpression' && (parentAny.operator === '-' || parentAny.operator === '+')) {
          arg = parentAny;
        }
        const call = arg.parent;
        if (
          call &&
          call.type === 'CallExpression' &&
          call.callee.type === 'Identifier' &&
          LITERAL_HELPERS.has(call.callee.name) &&
          call.arguments.length === 1 &&
          call.arguments[0] === arg
        ) {
          return;
        }
        context.report({ node, messageId: 'floatLiteral', data: { raw: node.raw ?? String(node.value) } });
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source === 'string' && isForbiddenImport(source)) {
          context.report({ node, messageId: 'forbiddenImport', data: { source } });
        }
      },
      ExportNamedDeclaration(node) {
        const source = node.source?.value;
        if (typeof source === 'string' && isForbiddenImport(source)) {
          context.report({ node, messageId: 'forbiddenImport', data: { source } });
        }
      },
      ExportAllDeclaration(node) {
        const source = node.source.value;
        if (typeof source === 'string' && isForbiddenImport(source)) {
          context.report({ node, messageId: 'forbiddenImport', data: { source } });
        }
      },
      ImportExpression(node) {
        const src = /** @type {any} */ (node.source);
        if (src.type === 'Literal' && typeof src.value === 'string' && isForbiddenImport(src.value)) {
          context.report({ node, messageId: 'forbiddenImport', data: { source: src.value } });
        }
      },
    };
  },
};

export default rule;
