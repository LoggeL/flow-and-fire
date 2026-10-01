/** Stable 16-WU bucket index. Visitors receive insertion order within each cell. */
export class ArenaSpatial<T extends { x: number; z: number }> {
  private readonly cells = new Map<string, T[]>();
  rebuild(units: readonly T[]): void {this.cells.clear();for(const u of units){const k=`${Math.floor(u.x/16)}:${Math.floor(u.z/16)}`;const c=this.cells.get(k);if(c)c.push(u);else this.cells.set(k,[u]);}}
  query(x:number,z:number,r:number,visit:(u:T)=>void):void {
    const r2=r*r;
    for(let cz=Math.floor((z-r)/16);cz<=Math.floor((z+r)/16);cz++)for(let cx=Math.floor((x-r)/16);cx<=Math.floor((x+r)/16);cx++) {
      const cell=this.cells.get(`${cx}:${cz}`);if(!cell)continue;for(const u of cell){const dx=u.x-x,dz=u.z-z;if(dx*dx+dz*dz<=r2)visit(u);}
    }
  }
}
