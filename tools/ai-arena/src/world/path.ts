import { cellCenter, nearestPassableCell, type AiStatic, type Vec2 } from '@faf/ai';

/** Deterministic A* with a bounded FIFO cache. No corner cutting. */
export class ArenaPaths {
  private readonly cache = new Map<string, readonly Vec2[]>();
  constructor(private readonly s: AiStatic) {}
  clear(): void { this.cache.clear(); }
  path(a: Vec2, b: Vec2): readonly Vec2[] {
    const { passLowRes: pass, passDim: dim, passCellWu: g } = this.s;
    const start = nearestPassableCell(pass, dim, g, a.x, a.z);
    const goal = nearestPassableCell(pass, dim, g, b.x, b.z);
    if (start < 0 || goal < 0) return [];
    const key = `${start}:${goal}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const distance = new Float64Array(pass.length).fill(Infinity);
    const previous = new Int32Array(pass.length).fill(-1);
    const closed = new Uint8Array(pass.length);
    const heap: { cell: number; score: number }[] = [];
    const less = (a: {cell:number;score:number}, b: {cell:number;score:number}): boolean => a.score < b.score || (a.score === b.score && a.cell < b.cell);
    const push = (cell: number, score: number): void => {
      const v = {cell, score}; heap.push(v); let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (!less(v, heap[p]!)) break; heap[i] = heap[p]!; i = p; } heap[i] = v;
    };
    const pop = (): number => {
      const first = heap[0]!.cell; const last = heap.pop()!;
      if (heap.length > 0) { let i = 0; while (2*i+1 < heap.length) { let c = 2*i+1; if(c+1<heap.length && less(heap[c+1]!,heap[c]!))c++; if(!less(heap[c]!,last))break; heap[i]=heap[c]!;i=c;} heap[i]=last; }
      return first;
    };
    const gx = goal % dim, gz = Math.floor(goal / dim);
    const heuristic = (x:number,z:number):number => { const dx = Math.abs(gx-x), dz=Math.abs(gz-z); return g*(Math.max(dx,dz)+(Math.sqrt(2)-1)*Math.min(dx,dz)); };
    distance[start]=0;push(start,0);
    while(heap.length>0) {
      const u=pop();if(closed[u]!==0)continue;closed[u]=1;if(u===goal)break;
      const x=u%dim,z=Math.floor(u/dim);
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++) {
        if(dx===0&&dz===0)continue;const nx=x+dx,nz=z+dz;
        if(nx<0||nz<0||nx>=dim||nz>=dim)continue;const v=nz*dim+nx;
        if(pass[v]===0||closed[v]!==0)continue;
        if(dx!==0&&dz!==0&&(pass[z*dim+nx]===0||pass[nz*dim+x]===0))continue;
        const d=distance[u]!+g*(dx!==0&&dz!==0?Math.sqrt(2):1);
        if(d<distance[v]!) {distance[v]=d;previous[v]=u;push(v,d+heuristic(nx,nz));}
      }
    }
    const path: Vec2[]=[];
    if(Number.isFinite(distance[goal])) {for(let p=goal;p!==start&&p>=0;p=previous[p]!)path.push(cellCenter(p,dim,g));path.reverse();path.push({x:b.x,z:b.z});}
    if(this.cache.size>=512)this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key,path);return path;
  }
}
