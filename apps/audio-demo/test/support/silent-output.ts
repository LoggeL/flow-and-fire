import type { Page } from '@playwright/test';

/** Keep the real graph and voice accounting active without sending audio to speakers. */
export async function installSilentOutput(page: Page): Promise<void> {
  // A string also works under tsx, whose class-name helpers cannot cross realms.
  await page.addInitScript(`(() => {
    const NativeAudioContext = window.AudioContext;
    class QuietAudioContext extends NativeAudioContext {
      constructor(options) {
        super(options);
        this.silentSink = this.createMediaStreamDestination();
        Object.defineProperty(this, 'destination', { value: this.silentSink });
      }
      async close() {
        for (const track of this.silentSink.stream.getTracks()) track.stop();
        await super.close();
      }
    }
    window.AudioContext = QuietAudioContext;
  })();`);
}
