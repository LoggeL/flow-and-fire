// @ts-check
/**
 * sim/determinism — enforces the determinism contract (PLAN §3.1, §3.12) in simulation packages.
 *
 * Reported constructs:
 *  - Math.* except imul/floor/trunc/min/max/abs/sign/clz32 (Math.sqrt only in `sqrtAllow` files)
 *  - Math.random, Date, performance, timers (setTimeout/setInterval/setImmediate/queueMicrotask/requestAnimationFrame)
 *  - async functions, await, for await
 *  - for…in
 *  - `**` and `**=`
 *  - Map/Set/WeakMap/WeakSet/WeakRef/FinalizationRegistry (as values)
 *  - `.sort()` / `.toSorted()` without comparator
 *  - Float32Array; Float64Array outside `float64Allow` files
 *  - non-integer numeric literals unless the direct argument of fx()/fxSmall()/deg()
 *  - localeCompare / toLocale* / Intl
 *  - imports of @faf/render, @faf/client, @faf/ai, @faf/sim-host
 */

const ALLOWED_MATH = new Set(['imul', 'floor', 'trunc', 'min', 'max', 'abs', 'sign', 'clz32']);
const TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'requestAnimationFrame']);
const COLLECTIONS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry']);
const LITERAL_HELPERS = new Set(['fx', 'fxSmall', 'deg']);
const FORBIDDEN_IMPORTS = ['@faf/render', '@faf/client', '@faf/ai', '@faf/sim-host'];
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window', 'global']);

/** Globals whose value references are forbidden (the key is the message id). */
const FORBIDDEN_GLOBALS = /** @type {Record<string, string>} */ ({
  Date: 'date',
  performance: 'performance',
  Intl: 'intl',
  Float32Array: 'float32',
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
  return FORBIDDEN_IMPORTS.some((p) => source === p || source.startsWith(p + '/'));
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
      float64: 'Float64Array is only allowed through SafeInt storage (packages/heap/src/safeint.ts).',
      floatLiteral:
        'Non-integer literal {{raw}} is forbidden; convert constants via fx(…), fxSmall(…) or deg(…).',
      intl: 'Intl is locale-dependent and forbidden in the simulation.',
      locale: '{{name}} is locale-dependent and forbidden in the simulation.',
      forbiddenImport: 'Simulation packages must not import {{source}} (dependency direction, PLAN §3.2).',
    },
  },
  create(context) {
    const options = /** @type {{sqrtAllow?: string[], float64Allow?: string[]}} */ (context.options[0] ?? {});
    const filename = context.filename;
    const cwd = context.cwd;
    const sqrtAllowed = fileMatches(filename, cwd, options.sqrtAllow ?? []);
    const float64Allowed = fileMatches(filename, cwd, options.float64Allow ?? []);
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
        const names = ['Math', 'Float64Array', ...Object.keys(FORBIDDEN_GLOBALS)];
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
        // globalThis.Date, self.setTimeout, window.Math.random …
        if (node.object.type === 'Identifier' && GLOBAL_OBJECTS.has(node.object.name)) {
          if (prop === 'Math' || prop === 'Float64Array' || FORBIDDEN_GLOBALS[prop] !== undefined) {
            if (prop === 'Math') {
              const outer = node.parent;
              if (outer && outer.type === 'MemberExpression' && outer.object === node) {
                const inner = propertyName(outer);
                if (inner === null) context.report({ node: outer, messageId: 'mathAlias' });
                else checkMathMember(outer, inner);
              } else context.report({ node, messageId: 'mathAlias' });
            } else if (prop === 'Float64Array') {
              if (!float64Allowed) context.report({ node, messageId: 'float64' });
            } else {
              context.report({ node, messageId: /** @type {string} */ (FORBIDDEN_GLOBALS[prop]), data: { name: prop } });
            }
          }
        }
        if (prop === 'localeCompare' || prop.startsWith('toLocale')) {
          context.report({ node: node.property, messageId: 'locale', data: { name: prop } });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
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
      },
      AssignmentExpression(node) {
        if (node.operator === '**=') context.report({ node, messageId: 'pow' });
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
