/**
 * All managers of the AI (ai.md §5) and their ManagerFactories. The default composition in
 * MANAGER_ORDER is `createDefaultBrain` (../default-brain.ts).
 */
export * from './intel/index.ts';
export * from './opening/index.ts';
export * from './economy/index.ts';
export * from './tech/index.ts';
export * from './defense/index.ts';
export * from './factory/index.ts';
export * from './engineer/index.ts';
export * from './platoon/index.ts';
