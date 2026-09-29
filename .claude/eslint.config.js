// Orchestrator workflow scripts (not project code): they run in the workflow runtime with injected
// globals (args, phase, agent, log, parallel). ESLint 10 looks up the config from each file's
// directory, so this file keeps `eslint .` at the repo root from linting them.
export default [{ ignores: ['**/*'] }];
