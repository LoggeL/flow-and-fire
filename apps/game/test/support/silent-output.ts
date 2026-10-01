import type { Page } from '@playwright/test';
const installedPages = new WeakSet<Page>();

/**
 * Install before navigation. Real realtime graphs only connect to an unconsumed MediaStream.
 * An unavailable sink fails the context constructor; mute flags never substitute for this.
 */
export async function installSilentOutput(page: Page): Promise<void> {
  if (installedPages.has(page)) return;
  await page.addInitScript(`(() => {
    const Native = window.AudioContext || window.webkitAudioContext;
    const audit = { installed: false, contexts: 0, speakerConnections: 0, blockedConnections: 0, streamDestinations: 0 };
    Object.defineProperty(window, '__fafSilentAudio', { value: audit });
    // addInitScript errors do not halt page scripts: block both constructors before validation.
    const blocked = function() { throw new Error('Silent audio setup incomplete'); };
    Object.defineProperty(window, 'AudioContext', { value: blocked, configurable: true, writable: false });
    const hasWebkit = !!window.webkitAudioContext;
    if (hasWebkit) Object.defineProperty(window, 'webkitAudioContext', { value: blocked, configurable: true, writable: false });
    if (!Native || !window.AudioNode) throw new Error('Silent audio setup unavailable');
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination instanceof AudioDestinationNode && !(window.OfflineAudioContext && destination.context instanceof OfflineAudioContext)) {
        audit.blockedConnections++;
        throw new Error('Hardware audio destination forbidden in automated game runs');
      }
      return connect.call(this, destination, ...args);
    };
    class QuietAudioContext extends Native {
      constructor(options) {
        super(options);
        audit.contexts++;
        try {
          if (typeof this.createMediaStreamDestination !== 'function') throw new Error('MediaStream audio sink unavailable');
          const sink = this.createMediaStreamDestination();
          if (!(sink instanceof MediaStreamAudioDestinationNode)) throw new Error('Invalid silent audio sink');
          Object.defineProperty(this, 'destination', { value: sink });
          Object.defineProperty(this, '__silentSink', { value: sink });
          audit.streamDestinations++;
        } catch (error) {
          void super.close();
          throw error;
        }
      }
      async close() {
        for (const track of this.__silentSink.stream.getTracks()) track.stop();
        await super.close();
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: QuietAudioContext, configurable: false, writable: false });
    if (hasWebkit) Object.defineProperty(window, 'webkitAudioContext', { value: QuietAudioContext, configurable: false, writable: false });
    audit.installed = true;
  })();`);
  installedPages.add(page);
}

/** Fails a browser check if setup did not intercept every created realtime context. */
export async function assertSilentOutput(page: Page): Promise<void> {
  const safe = await page.evaluate(() => {
    const audit = (window as unknown as { __fafSilentAudio?: { installed: boolean; contexts: number; streamDestinations: number; speakerConnections: number; blockedConnections: number } }).__fafSilentAudio;
    return audit !== undefined && audit.installed && audit.contexts > 0 && audit.contexts === audit.streamDestinations && audit.speakerConnections === 0 && audit.blockedConnections === 0;
  });
  if (!safe) throw new Error('Silent realtime audio graph was not verified');
}
