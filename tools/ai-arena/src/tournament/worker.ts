import { serveJobs } from '../stats/pool-worker.ts';
import { playJob } from './index.ts';
serveJobs(playJob);
