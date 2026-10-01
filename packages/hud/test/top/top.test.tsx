// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { ResourceMeter, FlowDetails, MatchStatus, createHudModel, seedHud } from '../../src/index.ts';
import { renderWithHud, fireEvent } from '../support/index.tsx';
it('resource, flow pause and speed controls forward exact commands', () => { const m = createHudModel(); seedHud(m); m.eco.detailsOpen.value = true; const r = renderWithHud(<><ResourceMeter resource="mass"/><FlowDetails /><MatchStatus /></>, { model: m }); fireEvent.click(r.getByTestId('resource-mass')); expect(r.log.at(-1)?.name).toBe('toggleFlowDetails'); fireEvent.click(r.getAllByRole('button', { name: /pausieren/i })[0]!); expect(r.log.at(-1)).toEqual({ name: 'pauseConsumer', args: [1, true] }); fireEvent.click(r.getByRole('button', { name: /erhöhen/i })); expect(r.log.at(-1)).toEqual({ name: 'changeSpeed', args: [1] }); });
