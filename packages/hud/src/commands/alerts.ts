/** Alert commands (ui.md §5.11). */
export interface AlertCommands {
  /** "Zum Ort" / Space: jump to the alert's target (unit, structure, sighting, flow details). */
  jumpToAlert(id: number): void;
  /** Shift+Space: cycle through older alerts. */
  cycleAlerts(): void;
}

export const ALERT_COMMAND_NAMES = ['jumpToAlert', 'cycleAlerts'] as const satisfies readonly (keyof AlertCommands)[];
