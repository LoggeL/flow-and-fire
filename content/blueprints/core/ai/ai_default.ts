// Default AI profile: category-based weights (MS3: schema + validation only; used from MS6/MS9).
import { defineAiProfile } from '../../../../packages/blueprints/src/define.ts';

export default defineAiProfile({
  id: 'core:ai_default',
  build: [
    { id: 'tanks', categories: 'MOBILE & LAND & DIRECTFIRE - SCOUT', weight: 0.6 },
    { id: 'artillery', categories: 'MOBILE & LAND & ARTILLERY', weight: 0.25 },
    { id: 'scouts', categories: 'MOBILE & LAND & SCOUT', weight: 0.15 },
  ],
  attack: [
    { id: 'army', categories: 'MOBILE & LAND', weight: 1 },
    { id: 'factories', categories: 'STRUCTURE & FACTORY', weight: 0.5 },
  ],
});
