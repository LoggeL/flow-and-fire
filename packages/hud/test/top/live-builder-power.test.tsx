// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { CardCell, UnitTooltip, createHudModel, resolveCardPage } from '../../src/index.ts';
import { renderWithHud, fireEvent } from '../support/index.tsx';
it('card tooltip uses active builder power and simulation costs instead of gallery defaults',()=>{
  const model=createHudModel();const cell=resolveCardPage(['core:cmd_commander']).cells.find(c=>c.slot==='KeyW')!;
  const r=renderWithHud(<CardCell cell={cell} builderPower={20} buildCost={{mass:75,energy:750,buildTime:125}}/>,{model});
  fireEvent.focus(r.getByTestId('card-KeyW'));
  const target=model.tooltip.target.value;expect(target?.kind).toBe('unit');if(target?.kind!=='unit')throw new Error('missing unit tooltip');
  expect(target.builderBp).toBe(20);expect(target.buildCost?.buildTime).toBe(125);
  const tip=renderWithHud(<UnitTooltip {...target}/>,{model});
  expect(tip.getByTestId('unit-tooltip').textContent).toContain('12');
  expect(tip.getByTestId('unit-tooltip').textContent).toContain('120');
  expect(tip.getByTestId('unit-tooltip').textContent).toContain('75');
  tip.unmount();r.unmount();
});
it('a card without an active builder does not invent a build rate',()=>{
  const model=createHudModel();const cell=resolveCardPage(['core:cmd_commander']).cells.find(c=>c.slot==='KeyW')!;
  const r=renderWithHud(<CardCell cell={cell} builderPower={0}/>,{model});fireEvent.focus(r.getByTestId('card-KeyW'));
  const target=model.tooltip.target.value;expect(target?.kind==='unit'?target.builderBp:null).toBeUndefined();r.unmount();
});
