import { runInNewContext } from 'node:vm';
import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { installSilentOutput } from './support/silent-output.ts';

/** Models API wiring only. No native audio device or browser is instantiated by these tests. */
async function script(): Promise<string> {
  let source = '';
  await installSilentOutput({ addInitScript: (s: string) => { source = s; return Promise.resolve(); } } as unknown as Page);
  return source;
}

function realm(hasSink = true) {
  class Node {
    connections: Node[] = [];
    connect(destination: Node): Node { this.connections.push(destination); return destination; }
  }
  class Destination extends Node { constructor(readonly context: unknown) { super(); } }
  class StreamDestination extends Node {
    stopped = false;
    stream = { getTracks: () => [{ stop: () => { this.stopped = true; } }] };
  }
  const contexts: NativeContext[] = [];
  class NativeContext {
    destination = new Destination(this);
    closed = false;
    constructor() { contexts.push(this); }
    createMediaStreamDestination(): StreamDestination { if (!hasSink) throw new Error('no sink'); return new StreamDestination(); }
    close(): Promise<void> { this.closed = true; return Promise.resolve(); }
  }
  const window = { AudioContext: NativeContext, webkitAudioContext: NativeContext, AudioNode: Node } as Record<string, unknown>;
  return {
    window, contexts, Node,
    globals: { window, AudioNode: Node, AudioDestinationNode: Destination, MediaStreamAudioDestinationNode: StreamDestination },
  };
}

describe('automated silent output fails closed (mock graph only)', () => {
  it('redirects both realtime constructors, blocks prototype hardware routes and stops stream tracks', async () => {
    const r = realm();
    runInNewContext(await script(), r.globals);
    const Context = r.window['AudioContext'] as new () => { destination: { stopped: boolean }; close(): Promise<void> };
    expect(r.window['webkitAudioContext']).toBe(Context);
    const context = new Context();
    const node = new r.Node();
    node.connect(context.destination as unknown as InstanceType<typeof r.Node>);
    expect(node.connections[0]).toBe(context.destination);
    // Bypassing the wrapper through its native superclass still cannot wire the hardware node.
    const Native = Object.getPrototypeOf(Context) as new () => { destination: InstanceType<typeof r.Node> };
    const native = new Native();
    expect(() => node.connect(native.destination)).toThrow('Hardware audio destination forbidden');
    expect(node.connections).toHaveLength(1);
    await context.close();
    expect(context.destination.stopped).toBe(true);
    expect(r.contexts[0]?.closed).toBe(true);
  });

  it('closes the native context and rejects construction when a stream sink cannot be created', async () => {
    const r = realm(false);
    runInNewContext(await script(), r.globals);
    const Context = r.window['AudioContext'] as new () => unknown;
    expect(() => new Context()).toThrow('no sink');
    expect(r.contexts[0]?.closed).toBe(true);
  });

  it('leaves both constructor aliases blocked if init-script validation fails', async () => {
    const r = realm();
    delete r.window['AudioNode'];
    function attempted(name: string): void { const Ctor = r.window[name] as new () => unknown; new Ctor(); }
    // Executing the same captured source in this realm is required before checking its blockers.
    const source = await script();
    expect(() => runInNewContext(source, r.globals)).toThrow('Silent audio setup unavailable');
    expect(() => attempted('AudioContext')).toThrow('Silent audio setup incomplete');
    expect(() => attempted('webkitAudioContext')).toThrow('Silent audio setup incomplete');
    expect(r.contexts).toHaveLength(0);
  });
});
