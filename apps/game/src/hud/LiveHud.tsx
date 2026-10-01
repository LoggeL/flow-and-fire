import { computed, effect } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { HudProvider, MainMenu, SkirmishSetup, Settings, ScoreScreen, bindUiSettings, autoScale, ResourceBar, MatchStatus, PauseBanner, CardCell, OrderButton, SelectionFilter, ControlGroups, TooltipLayer, GameMenu, IconSprite, StrategicIcon, Panel, PanelHead, cardSpec, useHud, useCommands, Num, Bar, Button, ORDER_DEFS, orderDef, keyLabel, nextFocusType, clickModsFromEvent, fmtDec, fmtPct, tn, t, type SkirmishMap, type SkirmishConfig } from '@faf/hud';
import '@faf/hud/styles.css';
import { GameHudController, type GameHudPorts, type MatchResult } from './live.ts';
import type { Game } from '../game.ts';
import './live.css';
import { simTypeId } from './type-ids.ts';
import { liveUnitText } from './unit-text.ts';
import { LiveNotices } from './LiveNotices.tsx';
import { LiveExtractorUpgrade } from './LiveExtractorUpgrade.tsx';
import { LiveCommanderUpgrade } from './LiveCommanderUpgrade.tsx';

const PRIMARY_ORDERS=['move','attack','patrol','stop','assist','reclaim'] as const;

function ControllerView({controller}: {controller:GameHudController}) {
  const root = useRef<HTMLDivElement>(null), m = controller.model;
  useEffect(() => { if (!root.current) return; return bindUiSettings(document.documentElement,m); },[controller,m]);
  useEffect(() => {
    const onKey = (event:KeyboardEvent) => { if(controller.handleKey(event)) {event.preventDefault();event.stopImmediatePropagation();} };
    window.addEventListener('keydown',onKey,true);
    const update=()=> { if(m.menus.settings.values.peek().uiScale==='auto') m.scale.value=autoScale(window.innerHeight); }; update(); window.addEventListener('resize',update);
    return ()=> {window.removeEventListener('keydown',onKey,true);window.removeEventListener('resize',update);};
  },[controller,m]);
  const screen=controller.screen.value, ghost=controller.ghost.value, queuedGhosts=controller.queuedGhosts.value, dragGhosts=controller.dragGhosts.value;
  return <div ref={root} class="live-hud" data-testid="live-hud" data-screen={screen}>
    <HudProvider model={m} commands={controller.commands}>
      {screen==='game'? <LivePresentation controller={controller}/>: screen==='main'?<MainMenu/>:screen==='skirmish'?<SkirmishSetup/>:screen==='settings'?<Settings/>:screen==='credits'?<div class="live-unavailable" data-testid="credits"><h2>Flow &amp; Fire</h2><p>{m.locale.value==='en'?'Interface: Preact. Development tools: TypeScript and Vite.':'Oberfläche: Preact. Entwicklungswerkzeuge: TypeScript und Vite.'}</p><p>{m.menus.main.build.value}</p><button onClick={()=>controller.commands.backToMenu()}>{m.locale.value==='en'?'Back':'Zurück'}</button></div>:screen==='score'?(controller.result.value?.verdict==='draw'?<div class="live-unavailable"><h2>{m.locale.value==='en'?'Draw':'Unentschieden'}</h2><p>{controller.result.value.durationS.toFixed(1)} s</p><button onClick={()=>controller.commands.quitToMenu()}>{m.locale.value==='en'?'Main menu':'Hauptmenü'}</button></div>:<ScoreScreen/>):<div class="live-unavailable"><p>{m.locale.value==='en'?'This screen is not available yet.':'Diese Ansicht ist noch nicht verfügbar.'}</p><button onClick={()=>controller.commands.backToMenu()}>{m.locale.value==='en'?'Back':'Zurück'}</button></div>}
    </HudProvider>
    {controller.error.value&&<div class="live-action-error" role="alert" data-testid="hud-action-error">{controller.error.value}<button type="button" aria-label="Close" onClick={()=>{controller.error.value=null;}}>×</button></div>}
    {screen==='game'&&queuedGhosts.length>0&&<svg class="live-queued-build-ghosts" data-testid="queued-build-ghosts" data-count={queuedGhosts.length} aria-hidden="true">{queuedGhosts.map(site=><polygon key={site.key} data-testid="queued-build-ghost" data-type={site.typeId} data-x={site.x} data-z={site.z} data-yaw={site.yaw} data-builders={site.builders.length} data-orders={site.orders.length} data-queue-index={site.queueIndex} data-verdict={site.verdict??'unknown'} class={site.verdict===null?'queued':'queued blocked'} points={site.corners.map(p=>`${p[0]},${p[1]}`).join(' ')}/>)}</svg>}
    {screen==='game'&&dragGhosts.length>0&&<svg class="live-build-ghost live-build-drag-ghosts" data-testid="build-drag-ghosts" data-count={dragGhosts.length} aria-hidden="true">{dragGhosts.map(site=><polygon key={`${site.x}:${site.z}`} data-testid="build-drag-ghost" data-type={site.typeId} data-x={site.x} data-z={site.z} data-verdict={site.verdict} points={site.corners.map(p=>`${p[0]},${p[1]}`).join(' ')} class={site.verdict===0?'valid':'invalid'}/>)}</svg>}
    {dragGhosts.length===0&&ghost&&ghost.corners.length===4&&<svg class="live-build-ghost" data-testid="build-ghost" data-verdict={ghost.verdict} data-type={ghost.typeId} data-x={ghost.x} data-z={ghost.z}><polygon points={ghost.corners.map(p=>`${p[0]},${p[1]}`).join(' ')} class={ghost.verdict===0?'valid':'invalid'}/><text x={ghost.corners[0]![0]} y={ghost.corners[0]![1]-8}>{ghost.verdict===0?(m.locale.value==='en'?'Place':'Bauen'):(m.locale.value==='en'?'Blocked':'Gesperrt')}</text></svg>}
  </div>;
}
export function LiveGameHud({game,ports,result}: {game:Game;ports?:GameHudPorts;result?:MatchResult}) {
  const controller=useMemo(()=>new GameHudController(game,ports),[game,ports]);
  useEffect(()=>{
    const unsubscribe=effect(()=>{void game.hud.value;controller.update();});
    let raf=0; const update=()=>{controller.update();raf=requestAnimationFrame(update);}; raf=requestAnimationFrame(update);
    return ()=>{unsubscribe();cancelAnimationFrame(raf);controller.dispose();};
  },[game,controller]);
  useEffect(()=>{if(result)controller.showResult(result);else if(game.replayMode){controller.result.value=null;if(controller.screen.peek()==='score')controller.screen.value='game';}},[controller,result,game]);
  return <ControllerView controller={controller}/>;
}
export interface FrontendMenusProps {readonly ports:GameHudPorts;readonly maps:readonly SkirmishMap[];readonly build?:string;readonly initialConfig?:SkirmishConfig}
export function FrontendMenus({ports,maps,build,initialConfig}:FrontendMenusProps) {
  const controller=useMemo(()=>{ const c=new GameHudController(null,ports); c.screen.value='main';c.model.menus.main.build.value=build??'';c.setMaps(maps,initialConfig);return c; },[ports,maps,build,initialConfig]);
  useEffect(()=>()=>controller.dispose(),[controller]);
  return <ControllerView controller={controller}/>;
}

function CompactFactoryQueue() {
  const m=useHud(),c=useCommands(),q=m.factory.queue.value,readOnly=m.match.replay.value;
  const remaining=useMemo(()=>computed(()=>{
    const seconds=m.factory.remainingS.value;
    return seconds===null?t('ui.factory.remainingUnavailable'):t('ui.factory.remaining',{value:fmtDec(seconds,1)});
  }),[m]);
  return <div class={`fq live-text-queue ${q?.paused?'is-paused':''}`} data-component="FactoryQueue" data-testid="factory-queue">
    {q?.current?<div class="fq__now"><b class="live-queue-product"><StrategicIcon typeId={q.current.typeId}/><span>{liveUnitText(q.current.typeId,'name',m.locale.value)}</span></b><Num value={m.factory.progress} format={fmtPct}/><Bar kind="build" value={m.factory.progress}/><span data-testid="factory-remaining">{remaining}</span></div>:<span>{t('ui.factory.idle')}</span>}
    {!!q?.blocks.length&&<div class="fq__list">{q.blocks.map((block,index)=><button class={`fqi ${q.repeat?'is-loop':''}`} key={index} disabled={readOnly} aria-label={t('ui.factory.block',{name:liveUnitText(block.typeId,'name',m.locale.value),n:block.count})} onClick={event=>c.queueAdd(block.typeId,event.shiftKey?5:1,event.ctrlKey||event.metaKey)} onContextMenu={event=>{event.preventDefault();if(!readOnly)c.queueRemove(block.typeId,event.shiftKey?5:1);}}><StrategicIcon typeId={block.typeId}/><span>{liveUnitText(block.typeId,'short',m.locale.value)}</span><b>{block.count}</b></button>)}</div>}
    <div class="fq__ctl"><Button size="sm" disabled={readOnly} class={q?.repeat?'is-on':''} onClick={()=>c.toggleRepeat()}>{t('ui.factory.ctl.repeat')}</Button><Button size="sm" disabled={readOnly} class={q?.paused?'is-on':''} onClick={()=>c.togglePauseProduction()}>{t('ui.factory.ctl.pause')}</Button><Button size="sm" disabled={readOnly} onClick={()=>c.armRally()}>{t('ui.factory.ctl.rally')}</Button><Button size="sm" disabled={readOnly} onClick={()=>c.clearQueue()}>{t('ui.factory.ctl.clear')}</Button></div>
  </div>;
}

function CompactSelection() {
  const m=useHud(),c=useCommands(),kind=m.selection.kind.value;
  const [detailsOpen,setDetailsOpen]=useState(false);
  const single=m.selection.single.value,multi=m.selection.multi.value,factory=m.factory.detail.value;
  if(kind==='none')return null;
  const name=(typeId:string)=>liveUnitText(typeId,'name',m.locale.value);
  const count=multi?.total??m.card.unitCount.value;
  const secondaryOrders=m.match.replay.value?[]:ORDER_DEFS.filter(order=>!PRIMARY_ORDERS.some(primary=>primary===order.id)&&m.orders.states.value[order.id]?.enabled===true);
  return <Panel class="live-selection-panel" panelId="selection" testId="selection-panel" component="SelectionPanel">
    <div class="live-selection-heading"><b>{single?name(single.typeId):tn('ui.common.units',count)}</b><button class="live-detail-toggle" type="button" aria-expanded={detailsOpen} aria-controls={kind==='factory'?'live-selection-details live-factory-details':'live-selection-details'} data-testid="selection-details-toggle" onClick={()=>setDetailsOpen(!detailsOpen)}>Details {detailsOpen?'−':'+'}</button></div>
    {single&&<div class="live-single-text" data-testid="unit-detail"><div class="live-hp"><span>HP</span><span>{single.hp} / {single.hpMax}</span></div><Bar kind="hp" value={single.hp/Math.max(1,single.hpMax)}/>{single.shield&&<div>{t('ui.selection.meter.shield')} {single.shield.hp} / {single.shield.hpMax}</div>}</div>}
    {multi&&<div class="live-type-groups" data-testid="selection-groups" onKeyDown={event=>{if(event.key==='Tab'){const next=nextFocusType(multi.groups,m.selection.focusTypeId.peek(),event.shiftKey);if(next){event.preventDefault();c.focusType(next);}}}}>{multi.groups.map(group=><button key={group.typeId} class={`live-type-group ${m.selection.focusTypeId.value===group.typeId?'is-focus':''}`} data-type={group.typeId} data-count={group.count} aria-label={t('ui.selection.tile',{name:name(group.typeId),n:group.count})} onClick={event=>{if(event.shiftKey)c.deselectType(group.typeId);else if(event.ctrlKey||event.metaKey)c.selectDamagedOfType(group.typeId);else c.selectType(group.typeId);}}><StrategicIcon typeId={group.typeId}/><span>{name(group.typeId)}</span><b>{group.count}</b></button>)}</div>}
    {kind==='factory'&&factory&&<div class="live-factory-text" data-testid="factory-detail"><CompactFactoryQueue/><div id="live-factory-details" hidden={!detailsOpen}><div>{t('ui.factory.rally')}: {t(`ui.factory.rally.${factory.rally}`)}</div><div>{t('ui.factory.bp')} {factory.bpOwn} + {factory.bpAssist} = {factory.bpOwn+factory.bpAssist}</div>{factory.helpers.length>0&&<div>{t('ui.factory.helpers')}: {factory.helpers.map(helper=>`${name(helper.typeId)} ×${helper.count}`).join(', ')}</div>}</div></div>}
    <div class="live-selection-details" id="live-selection-details" hidden={!detailsOpen}>
      {secondaryOrders.length>0&&<div class="live-secondary-orders" data-testid="secondary-order-bar">{secondaryOrders.map(order=><OrderButton key={order.id} id={order.id} compact/>)}</div>}
      {single&&<><div>{liveUnitText(single.typeId,'role',m.locale.value)}</div><div class="live-unit-stats">{(['dps','range','speed','vision','buildPower','regen'] as const).map(stat=><span key={stat}>{t(`ui.selection.stat.${stat==='buildPower'?'bp':stat}`)} {fmtDec(single.stats[stat],1)}</span>)}</div>{single.orders.length>0&&<div data-testid="order-queue">{single.orders.map((order,index)=><button key={index} onClick={()=>c.jumpToOrder(index)} onContextMenu={event=>{event.preventDefault();c.removeOrder(index);}}>{index+1}. {t(`ui.selection.order.${order.kind}`)}{order.typeId?` · ${name(order.typeId)}`:''}</button>)}</div>}</>}
      {multi&&<>{m.selection.multiStats.value&&<div>{t('ui.selection.sum.hp')} {fmtDec(m.selection.multiStats.value.avgHpPct,0)}%</div>}<div class="live-selection-unit-list" data-testid="selection-units">{multi.units.map((unit,index)=><button key={unit.handle} onClick={event=>c.selectUnit(unit.handle,clickModsFromEvent(event))} onContextMenu={event=>{event.preventDefault();c.selectUnit(unit.handle,clickModsFromEvent(event));}}>{name(unit.typeId)} · {index+1}</button>)}</div></>}
    </div>
  </Panel>;
}

function LivePresentation({controller}: {controller:GameHudController}) {
  const m=controller.model,spec=cardSpec(m.card).value,game=controller.game,selected=m.card.unitCount.value>0;
  const onGridKeyDown=(event:KeyboardEvent)=>{
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-5,ArrowDown:5}[event.key];
    if(delta===undefined||!(event.target instanceof HTMLElement))return;
    const grid=event.target.closest('.card__grid');
    if(!grid)return;
    const cells=[...grid.querySelectorAll<HTMLButtonElement>(':scope > button')].filter(cell=>cell.getClientRects().length>0);
    const index=cells.indexOf(event.target as HTMLButtonElement);
    if(index<0||cells.length===0)return;
    event.preventDefault();event.stopPropagation();
    cells[((index+delta)%cells.length+cells.length)%cells.length]?.focus();
  };
  const buildPage=spec.page==='build'||spec.page==='production';
  const buildCells=buildPage&&game?spec.cells.filter(cell=>{const bp=cell.typeId?game.bp.indexOf(simTypeId(cell.typeId)):-1;return !game.client.readOnlyCommands&&bp>=0&&cell.kind==='unit'&&game.bp.buildableByExpr(bp)>=0;}):[];
  const showOrders=selected&&!m.match.replay.value;
  const card=buildCells.length>0&&game?<Panel class="card" panelId="card" testId="command-card" component="CommandCard"><PanelHead title={t(spec.page==='build'?'ui.card.head.build':'ui.card.head.production',{name:spec.headTypeId?liveUnitText(spec.headTypeId,'name',m.locale.value):''})}/><div class="card__grid" role="grid">{buildCells.map(cell=>{
    const bp=game.bp.indexOf(simTypeId(cell.typeId!)),frame=game.client.lastFrame;let builderPower=0;
    if(frame)for(let i=0;i<frame.unitCount;i++)if(game.client.selection.has(frame.unitHandle(i))&&game.bp.canBuild(frame.unitVisual(i),bp))builderPower+=game.bp.buildPowerQ16PerTickCol[frame.unitVisual(i)]!*10/65536;
    return <CardCell key={cell.slot} builderPower={builderPower} buildCost={{mass:game.bp.massCostCol[bp]!,energy:game.bp.energyCostCol[bp]!,buildTime:game.bp.buildTimeCol[bp]!}} cell={cell}/>;
  })}</div></Panel>:null;
  const hasGroups=m.strip.groups.value.some(group=>group.count>0);
  return <div class="hud live-game-presentation" onKeyDownCapture={onGridKeyDown} data-testid="hud" data-hud-root="" data-selection-kind={m.selection.kind.value} data-card-page={spec.page}><IconSprite/><div class="hud-layer"><ResourceBar/><MatchStatus/><PauseBanner/><LiveNotices/>{(selected||hasGroups)&&<div class="live-bottom-context">{showOrders&&<div class="live-command-context">{card}<LiveCommanderUpgrade controller={controller}/><LiveExtractorUpgrade controller={controller}/><Panel class="live-primary-orders" panelId="orders" testId="order-bar" component="OrderBar"><div class="live-primary-order-row">{PRIMARY_ORDERS.map(id=><div class="live-primary-order" key={id} role="group" aria-label={t('ui.orders.label',{name:t(`ui.orders.${id}.name`),keys:`Alt+${keyLabel(orderDef(id).key!,m.keyboardLayout.value)}`})}><OrderButton id={id} compact/><span class="live-primary-order-caption" aria-hidden="true">{t(`ui.orders.${id}.short`)}</span></div>)}</div></Panel></div>}<div class="live-selection-context"><div class="live-selection-tools">{selected&&<SelectionFilter/>}<ControlGroups/></div>{selected&&<CompactSelection/>}</div></div>}<TooltipLayer/><GameMenu/></div></div>;
}
