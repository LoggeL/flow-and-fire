/** Economy commands (ui.md §5.1). */
export interface EcoCommands {
  /** Click on a resource meter: open/close flow details. */
  toggleFlowDetails(): void;
  /** Pause/resume a consumer from flow details (E13, only when interactive). */
  pauseConsumer(id: number, paused: boolean): void;
}

export const ECO_COMMAND_NAMES = ['toggleFlowDetails', 'pauseConsumer'] as const satisfies readonly (keyof EcoCommands)[];
