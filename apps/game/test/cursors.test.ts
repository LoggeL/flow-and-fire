import { describe, expect, it } from 'vitest';
import { CURSOR_ART, WorldCursor, gameCursor } from '../src/cursors.ts';

describe('game cursor ownership and hotspots', () => {
  it('keeps interaction ownership above armed orders, including all edge directions', () => {
    expect(gameCursor('idle', 0, 0, 'attack')).toBe('attack');
    expect(gameCursor('boxSelect', 0, 0, 'build')).toBe('box');
    expect(gameCursor('grabPan', 0, 0, 'blocked')).toBe('pan');
    expect(gameCursor('rotate', 0, 0, 'attack')).toBe('rotate');
    const expected = ['southWest','south','southEast','west','arrow','east','northWest','north','northEast'];
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      expect(gameCursor('edgePan', x, y, 'attack')).toBe(expected[(y+1)*3+x+1]);
      expect(gameCursor('confinedEdgePan', x, y, 'build')).toBe(expected[(y+1)*3+x+1]);
    }
  });
  it('uses the same selected art and hotspot on native and replacement fullscreen pointers', () => {
    const properties = new Map<string,string>();
    const virtual = () => ({ dataset: {} as Record<string,string>, style: { backgroundImage: '', marginLeft: '', marginTop: '' } });
    let node = virtual();
    const canvas = { dataset: {} as Record<string,string>, style: {
      setProperty(name: string, value: string) { properties.set(name,value); }, removeProperty(name:string) { properties.delete(name); },
    }, ownerDocument: { getElementById() { return node; } } } as unknown as HTMLCanvasElement;
    const cursor = new WorldCursor(canvas);
    cursor.present('build', false);
    expect(properties.get('--faf-world-cursor')).toBe(CURSOR_ART.build.css);
    expect(node.style.backgroundImage).toBe(CURSOR_ART.build.image);
    expect(node.style.marginLeft).toBe('-7px'); expect(node.style.marginTop).toBe('-3px');
    cursor.present('attack', true);
    expect(properties.get('--faf-world-cursor')).toBe('none');
    expect(node.dataset['gameCursor']).toBe('attack'); expect(node.style.marginLeft).toBe('-16px');
    node = virtual(); cursor.present('attack', true);
    expect(node.style.backgroundImage).toBe(CURSOR_ART.attack.image);
    cursor.dispose();
    expect(properties.size).toBe(0); expect(canvas.dataset['gameCursor']).toBeUndefined();
    expect(node.style.backgroundImage).toBe(''); expect(node.dataset['gameCursor']).toBeUndefined();
  });
});
