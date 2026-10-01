import { ResourceMeter, FlowDetails, MatchStatus, PauseBanner, Alert, UnitTooltip, ResourceTooltip, seedHud, writeResource } from '@faf/hud';
import type { AlertType } from '@faf/hud';
import { defineStories } from '../story.ts';
import { REQUIRED_STATES } from '../required-states.ts';
export default defineStories(REQUIRED_STATES.filter(x => x.group === 'top').flatMap(x => x.states.map((state, i) => ({ id: `${x.component.toLowerCase()}--${i}`, component: x.component, state, title: `${x.component}: ${state}`, layout: 'component' as const, tags: i === 0 ? ['xbrowser'] as const : [], setup: ({ model: m }) => { seedHud(m); if (x.component === 'ResourceMeter') {
        if (state === 'Überlauf')
            writeResource(m.eco.mass, { stored: 1000, income: 30 });
        if (state === 'Stall droht')
            writeResource(m.eco.mass, { stored: 10, demand: 30 });
        if (state === 'Stall')
            writeResource(m.eco.mass, { stored: 0, demand: 30, flow: .8 });
    } if (x.component === 'FlowDetails') {
        m.eco.detailsOpen.value = state !== 'geschlossen';
        if (state === 'Zeile pausiert')
            m.eco.consumers.value = m.eco.consumers.value.map(s => ({ ...s, paused: true }));
        if (state === 'Engpass')
            m.eco.consumers.value = m.eco.consumers.value.map(s => ({ ...s, massGot: 1, energyGot: 1 }));
    } if (x.component === 'MatchStatus') {
        if (state === 'Tempo ≠ 1')
            m.match.speed.value = 2;
        if (state === 'Cap nah')
            m.match.units.value = 480;
        if (state === 'Cap erreicht')
            m.match.units.value = 500;
    } if (x.component === 'PauseBanner') {
        if (state === 'Pause')
            m.match.pause.value = 'user';
        if (state === 'Hintergrund-Pause')
            m.match.pause.value = 'background';
        if (state === 'Tempo')
            m.match.speed.value = 2;
        if (state === 'Sim-Lag')
            m.match.simLag.value = .7;
        if (state === 'Context-Loss')
            m.match.contextLost.value = true;
    } }, render: () => { if (x.component === 'ResourceMeter')
        return <ResourceMeter resource="mass"/>; if (x.component === 'FlowDetails')
        return <FlowDetails />; if (x.component === 'MatchStatus')
        return <MatchStatus />; if (x.component === 'PauseBanner')
        return <PauseBanner />; if (x.component === 'Alert') {
        const type: AlertType = i === 0 ? 'commanderDanger' : i === 1 ? 'baseAttacked' : i === 3 ? 'buildComplete' : 'enemyAir';
        return <Alert item={{ id: 1, type, count: state === 'zusammengefasst' ? 5 : 1, createdAtS: state === 'veraltet' ? 1 : 804, lastAtS: state === 'veraltet' ? 1 : 804, location: { x: 100, z: 100 } }} newest/>;
    } if (state === 'Ressource')
        return <ResourceTooltip resource="mass"/>; return <UnitTooltip typeId={state === 'Einheit' ? 'core:lnd_t1_tank' : state === 'ohne Nachbarschaft' ? 'core:cmd_commander' : 'core:str_t1_pgen'} builderBp={10}/>; } }))));
