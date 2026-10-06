/**
 * Pool worker of the tournament runner (runs inside a `runPool` worker thread through tsx): every
 * job is one arena game (`MatchJob`), answered with its `GameRecord`. `runGameJob` never throws, a
 * crash of the thread itself is turned into a crash record by the runner.
 */
import { serveJobs } from '../stats/pool-worker.ts';
import { runGameJob } from './run-game.ts';
import type { GameRecord, MatchJob } from './types.ts';

serveJobs<MatchJob, GameRecord>((job) => runGameJob(job));
