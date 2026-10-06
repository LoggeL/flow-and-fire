/**
 * Tournament runner of the arena (ai.md §7, TRACK-AI tai-p6): suites and plans, one game per job
 * (run-game), worker-pool execution (run), aggregation with Wilson/Elo and gates (aggregate), JSON and
 * Markdown report (report), command line (cli). Entry script: tools/ai-arena/scripts/tournament.ts.
 */
export * from './types.ts';
export * from './suites.ts';
export * from './run-game.ts';
export * from './run.ts';
export * from './aggregate.ts';
export * from './report.ts';
export * from './cli.ts';
