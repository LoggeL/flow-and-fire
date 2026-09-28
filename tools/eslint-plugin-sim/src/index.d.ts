import type { ESLint, Rule } from 'eslint';

declare const plugin: ESLint.Plugin & { rules: { determinism: Rule.RuleModule } };
export default plugin;
