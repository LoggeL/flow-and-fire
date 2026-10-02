import { computed, effect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { HudProvider, MainMenu, SkirmishSetup, Settings, ScoreScreen, bindUiSettings, autoScale, ResourceBar, MatchStatus, PauseBanner, CardCell, OrderButton, SelectionFilter, TooltipLayer, GameMenu, IconSprite, StrategicIcon, Panel, PanelHead, cardSpec, useHud, useCommands, Num, Bar, Button, ORDER_DEFS, orderDef, keyLabel, nextFocusType, clickModsFromEvent, fmtDec, fmtPct, tn, t, type SkirmishMap, type SkirmishConfig } from '@faf/hud';
import '@faf/hud/styles.css';
import { GameHudController, type GameHudPorts, type MatchResult } from './live.ts';
import type { Game } from '../game.ts';
import './live.css';
import './supcom.css';
import './main-menu.css';
import './menu-settings.css';
import { simTypeId } from './type-ids.ts';
import { liveUnitText } from './unit-text.ts';
import { LiveNotices } from './LiveNotices.tsx';
import { LiveExtractorUpgrade } from './LiveExtractorUpgrade.tsx';
import { LiveCommanderUpgrade } from './LiveCommanderUpgrade.tsx';
import { LiveFactoryUpgrade } from './LiveFactoryUpgrade.tsx';
import { BuildPortrait } from './BuildPortrait.tsx';
import { CommandArt } from './CommandArt.tsx';
import { LiveBriefing, LiveCredits } from './LiveInfoScreens.tsx';
import { BUILD_ROLE_COLORS, buildRole, type BuildRole } from './build-role.ts';
import { hudArmyTheme } from './faction-theme.ts';
import { RangeRings } from './RangeRings.tsx';
import { MenuBackdrop } from './MenuBackdrop.tsx';
import { chosenArmyColor } from '../army-colors.ts';
import { BrandLogo } from './BrandLogo.tsx';

const PRIMARY_ORDERS=['move','attack','patrol','stop','assist','reclaim'] as const;

function BuildVolume({corners,roof,valid,testId}: {corners:readonly (readonly [number,number])[];roof:readonly (readonly [number,number])[]|undefined;valid:boolean;testId:string}) {
  if(corners.length!==4||roof?.length!==4)return null;
  return <g class={`live-build-volume ${valid?'valid':'invalid'}`} data-testid={testId}>{[0,1,2,3].map(i=>{
    const a=corners[i]!,b=corners[(i+1)%4]!,c=roof[(i+1)%4]!,d=roof[i]!;
    return <polygon key={i} points={`${a[0]},${a[1]} ${b[0]},${b[1]} ${c[0]},${c[1]} ${d[0]},${d[1]}`}/>;
  })}<polygon class="roof" points={roof.map(p=>`${p[0]},${p[1]}`).join(' ')}/></g>;
}

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
  const menuHouse=screen==='main'?m.menus.skirmish.slots.value.find(slot=>!slot.ai)?.color:undefined;
  const menuAccent=menuHouse===undefined?undefined:chosenArmyColor(menuHouse);
  return <div ref={root} class="live-hud" data-testid="live-hud" data-screen={screen} data-menu-house-color={menuHouse} style={menuAccent===undefined?undefined:{'--menu-accent':`#${menuAccent.toString(16).padStart(6,'0')}`}}>
    <HudProvider model={m} commands={controller.commands}>
      {screen==='main'&&<MenuBackdrop/>}
      {screen==='game'? <LivePresentation controller={controller}/>: screen==='main'?<MainMenu logo={<BrandLogo/>}/>:screen==='skirmish'?<SkirmishSetup/>:screen==='settings'?<Settings/>:screen==='credits'?<LiveCredits build={m.menus.main.build.value}/>:screen==='tutorial'?<LiveBriefing/>:screen==='score'?<ScoreScreen/>:<div class="live-unavailable"><p>{m.locale.value==='en'?'This screen is not available yet.':'Diese Ansicht ist noch nicht verfügbar.'}</p><button onClick={()=>controller.commands.backToMenu()}>{m.locale.value==='en'?'Back':'Zurück'}</button></div>}
    </HudProvider>
    {controller.error.value&&<div class="live-action-error" role="alert" data-testid="hud-action-error">{controller.error.value}<button type="button" aria-label={m.locale.value==='en'?'Close':'Schließen'} onClick={()=>{controller.error.value=null;}}>×</button></div>}
    {screen==='game'&&<RangeRings rings={controller.rangeRings.value} locale={m.locale.value}/>}
    {screen==='game'&&queuedGhosts.length>0&&<svg class="live-queued-build-ghosts" data-testid="queued-build-ghosts" data-count={queuedGhosts.length} aria-hidden="true">{queuedGhosts.map(site=><g key={site.key} data-role={site.role} style={site.role?{'--ghost-role':BUILD_ROLE_COLORS[site.role]}:undefined}><polygon data-testid="queued-build-ghost" data-type={site.typeId} data-x={site.x} data-z={site.z} data-yaw={site.yaw} data-builders={site.builders.length} data-orders={site.orders.length} data-queue-index={site.queueIndex} data-verdict={site.verdict??'unknown'} class={site.verdict===null?'queued':'queued blocked'} points={site.corners.map(p=>`${p[0]},${p[1]}`).join(' ')}/><BuildVolume corners={site.corners} roof={site.roof} valid={site.verdict===null} testId="queued-build-ghost-volume"/></g>)}</svg>}
    {screen==='game'&&dragGhosts.length>0&&<svg class="live-build-ghost live-build-drag-ghosts" data-testid="build-drag-ghosts" data-count={dragGhosts.length} aria-hidden="true"><defs><pattern id="build-drag-blocked-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#c63f4433"/><path d="M 0 0 V 8" stroke="#ff555b" stroke-opacity=".65" stroke-width="2"/></pattern></defs>{dragGhosts.map(site=><g key={`${site.x}:${site.z}`} data-role={site.role} style={site.role?{'--ghost-role':BUILD_ROLE_COLORS[site.role]}:undefined}><polygon data-testid="build-drag-ghost" data-type={site.typeId} data-x={site.x} data-z={site.z} data-verdict={site.verdict} points={site.corners.map(p=>`${p[0]},${p[1]}`).join(' ')} class={site.verdict===0?'valid':'invalid'}/><BuildVolume corners={site.corners} roof={site.roof} valid={site.verdict===0} testId="build-drag-ghost-volume"/></g>)}</svg>}
    {dragGhosts.length===0&&ghost&&ghost.corners.length===4&&<svg class="live-build-ghost" data-testid="build-ghost" data-verdict={ghost.verdict} data-type={ghost.typeId} data-x={ghost.x} data-z={ghost.z} data-role={ghost.role} style={ghost.verdict===0&&ghost.role?{'--ghost-role':BUILD_ROLE_COLORS[ghost.role]}:undefined}><polygon points={ghost.corners.map(p=>`${p[0]},${p[1]}`).join(' ')} class={ghost.verdict===0?'valid':'invalid'}/><BuildVolume corners={ghost.corners} roof={ghost.roof} valid={ghost.verdict===0} testId="build-ghost-volume"/><text x={ghost.corners[0]![0]} y={ghost.corners[0]![1]-8}>{ghost.verdict===0?(m.locale.value==='en'?'Place':'Bauen'):(m.locale.value==='en'?'Blocked':'Gesperrt')}</text></svg>}
  </div>;
}
export function LiveGameHud({game,ports,result}: {game:Game;ports?:GameHudPorts;result?:MatchResult}) {
  const controller=useMemo(()=>new GameHudController(game,ports),[game,ports]);
  useEffect(()=>{
    const unsubscribe=effect(()=>{void game.hud.value;controller.update();});
    let raf=0; const update=()=>{controller.update();raf=requestAnimationFrame(update);}; raf=requestAnimationFrame(update);
    return ()=>{unsubscribe();cancelAnimationFrame(raf);controller.dispose();};
  },[game,controller]);
  // A replay keeps its battlefield, clock and controls at the recorded end; only live matches open the score screen.
  useEffect(()=>{if(result&&!game.replayMode)controller.showResult(result);else if(game.replayMode){controller.result.value=null;if(controller.screen.peek()==='score')controller.screen.value='game';}},[controller,result,game]);
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
    {q?.current?<div class="fq__now"><b class="live-queue-product"><StrategicIcon typeId={q.current.typeId}/><span>{liveUnitText(q.current.typeId,'name',m.locale.value)}</span></b><Num value={m.factory.progress} format={fmtPct}/><span data-testid="factory-remaining">{remaining}</span><Bar kind="build" value={m.factory.progress}/></div>:<div class="fq__now is-idle"><span>{t('ui.factory.idle')}</span></div>}
    <div class="fq__ctl"><Button size="sm" disabled={readOnly} class={q?.repeat?'is-on':''} onClick={()=>c.toggleRepeat()}>{t('ui.factory.ctl.repeat')}</Button><Button size="sm" disabled={readOnly} class={q?.paused?'is-on':''} onClick={()=>c.togglePauseProduction()}>{t('ui.factory.ctl.pause')}</Button><Button size="sm" disabled={readOnly} onClick={()=>c.armRally()}>{t('ui.factory.ctl.rally')}</Button><Button size="sm" disabled={readOnly} onClick={()=>c.clearQueue()}>{t('ui.factory.ctl.clear')}</Button></div>
    {!!q?.blocks.length&&<div class="fq__list">{q.blocks.map((block,index)=><button class={`fqi ${q.repeat?'is-loop':''}`} key={index} disabled={readOnly} aria-label={t('ui.factory.block',{name:liveUnitText(block.typeId,'name',m.locale.value),n:block.count})} onClick={event=>c.queueAdd(block.typeId,event.shiftKey?5:1,event.ctrlKey||event.metaKey)} onContextMenu={event=>{event.preventDefault();if(!readOnly)c.queueRemove(block.typeId,event.shiftKey?5:1);}}><StrategicIcon typeId={block.typeId}/><span>{liveUnitText(block.typeId,'short',m.locale.value)}</span><b>{block.count}</b></button>)}</div>}
  </div>;
}

/** Factory queue, controls and rally/build-power details sit directly above the production strip, also read-only in replays. */
function FactoryProduction({detailsOpen}: {detailsOpen:boolean}) {
  const m=useHud(),factory=m.factory.detail.value;
  if(m.selection.kind.value!=='factory'||!factory)return null;
  const name=(typeId:string)=>liveUnitText(typeId,'name',m.locale.value);
  return <div class="live-factory-text sc-frame" data-testid="factory-detail"><CompactFactoryQueue/><div class="live-factory-details" id="live-factory-details" hidden={!detailsOpen}><span>{t('ui.factory.rally')}: {t(`ui.factory.rally.${factory.rally}`)}</span><span>{t('ui.factory.bp')} {factory.bpOwn} + {factory.bpAssist} = {factory.bpOwn+factory.bpAssist}</span>{factory.helpers.length>0&&<span>{t('ui.factory.helpers')}: {factory.helpers.map(helper=>`${name(helper.typeId)} ×${helper.count}`).join(', ')}</span>}</div></div>;
}

/** One horizontal row of build tiles; it scrolls inside its frame and shows step arrows only while tiles are clipped. */
function BuildStrip({title,count,children}: {title:string;count:number;children:ComponentChildren}) {
  const m=useHud(),en=m.locale.value==='en',grid=useRef<HTMLDivElement>(null);
  const [clipped,setClipped]=useState({start:false,end:false});
  const measure=()=>{
    const el=grid.current;if(!el)return;
    const start=el.scrollLeft>1,end=el.scrollLeft+el.clientWidth<el.scrollWidth-1;
    setClipped(prev=>prev.start===start&&prev.end===end?prev:{start,end});
  };
  useEffect(()=>{
    const el=grid.current;if(!el)return;
    el.addEventListener('scroll',measure,{passive:true});
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(el);
    return ()=>{el.removeEventListener('scroll',measure);observer?.disconnect();};
  },[]);
  useEffect(measure,[count]);
  const step=(direction:number)=>{const el=grid.current;if(el)el.scrollBy({left:direction*Math.max(64,el.clientWidth*.8)});};
  return <Panel class="card live-build-strip sc-frame" panelId="card" testId="command-card" component="CommandCard"><PanelHead title={title}/>
    <div class="live-strip-viewport" data-clipped-start={clipped.start||undefined} data-clipped-end={clipped.end||undefined}>
      <button type="button" class="live-strip-nav is-prev" tabIndex={-1} hidden={!clipped.start} aria-label={en?'Scroll build list left':'Bauliste nach links blättern'} onClick={()=>step(-1)}>‹</button>
      <div ref={grid} class="card__grid" role="grid" aria-label={title}>{children}</div>
      <button type="button" class="live-strip-nav is-next" tabIndex={-1} hidden={!clipped.end} aria-label={en?'Scroll build list right':'Bauliste nach rechts blättern'} onClick={()=>step(1)}>›</button>
    </div>
  </Panel>;
}

/** Filled control groups only, with a visible caption and key/count chips that explain themselves. */
function LiveControlGroups() {
  const m=useHud(),c=useCommands(),groups=m.strip.groups.value,en=m.locale.value==='en';
  if(!groups.some(group=>group.count>0))return null;
  return <div class="live-groups" role="group" aria-label={t('ui.strip.groups')} data-testid="control-groups"><span class="live-groups-caption">{en?'Groups':'Gruppen'}</span>{groups.map((group,i)=>{
    if(group.count===0)return null;const key=(i+1)%10,label=t('ui.strip.group.filled',{key,units:tn('ui.common.units',group.count)});
    return <button key={i} type="button" class={`live-group ${m.strip.activeGroup.value===i?'is-active':''}`} data-testid={`control-group-${key}`} aria-label={label} title={label} onClick={event=>c.recallGroup(i,clickModsFromEvent(event))} onContextMenu={event=>{event.preventDefault();c.saveGroup(i,event.shiftKey);}}><kbd>{key}</kbd><span>{group.count}×</span></button>;
  })}</div>;
}

/** Visible without Details: own paused units in the selection and a labelled resume action. */
function PausedSelectionRow({controller}: {controller:GameHudController}) {
  const m=useHud(),paused=controller.pausedSelection.value;
  if(!paused)return null;
  const en=m.locale.value==='en',partial=paused.count<paused.total;
  const label=partial?(en?`${paused.count} of ${paused.total} paused`:`${paused.count} von ${paused.total} pausiert`):(en?'Paused':'Pausiert');
  return <div class="live-paused-row" data-testid="selection-paused" data-count={paused.count} role="status"><span>{label}</span>{paused.controllable&&<button type="button" data-testid="selection-resume" onClick={()=>controller.resumeSelection()}>{en?'Resume':'Fortsetzen'}</button>}</div>;
}

/** Compact summary above the order buttons; Details opens upward as its own scrolling frame with a close button. */
function CompactSelection({controller,detailsOpen,setDetailsOpen}: {controller:GameHudController;detailsOpen:boolean;setDetailsOpen:(open:boolean)=>void}) {
  const m=useHud(),c=useCommands(),kind=m.selection.kind.value;
  const single=m.selection.single.value,multi=m.selection.multi.value;
  if(kind==='none')return null;
  const en=m.locale.value==='en',name=(typeId:string)=>liveUnitText(typeId,'name',m.locale.value);
  const count=multi?.total??m.card.unitCount.value;
  const secondaryOrders=m.match.replay.value?[]:ORDER_DEFS.filter(order=>!PRIMARY_ORDERS.some(primary=>primary===order.id)&&m.orders.states.value[order.id]?.enabled===true);
  return <>
    <Panel class={`live-selection-panel sc-frame ${kind==='factory'?'is-factory':''}`} panelId="selection" testId="selection-panel" component="SelectionPanel">
      <div class="live-selection-heading"><b>{single?name(single.typeId):tn('ui.common.units',count)}</b><button class="live-detail-toggle" type="button" aria-expanded={detailsOpen} aria-controls={kind==='factory'?'live-selection-details live-factory-details':'live-selection-details'} data-testid="selection-details-toggle" onClick={()=>setDetailsOpen(!detailsOpen)}>Details {detailsOpen?'−':'+'}</button></div>
      <PausedSelectionRow controller={controller}/>
      {single&&<div class="live-single-text" data-testid="unit-detail"><div class="live-hp"><span>HP</span><span>{single.hp} / {single.hpMax}</span></div><Bar kind="hp" value={single.hp/Math.max(1,single.hpMax)}/>{single.shield&&<div>{t('ui.selection.meter.shield')} {single.shield.hp} / {single.shield.hpMax}</div>}</div>}
      {multi&&<div class="live-type-groups" data-testid="selection-groups" onKeyDown={event=>{if(event.key==='Tab'){const next=nextFocusType(multi.groups,m.selection.focusTypeId.peek(),event.shiftKey);if(next){event.preventDefault();c.focusType(next);}}}}>{multi.groups.map(group=><button key={group.typeId} class={`live-type-group ${m.selection.focusTypeId.value===group.typeId?'is-focus':''}`} data-type={group.typeId} data-count={group.count} aria-label={t('ui.selection.tile',{name:name(group.typeId),n:group.count})} title={name(group.typeId)} onClick={event=>{if(event.shiftKey)c.deselectType(group.typeId);else if(event.ctrlKey||event.metaKey)c.selectDamagedOfType(group.typeId);else c.selectType(group.typeId);}}><StrategicIcon typeId={group.typeId}/><span>{name(group.typeId)}</span><b>{group.count}</b></button>)}</div>}
    </Panel>
    <div class="live-selection-details sc-frame" id="live-selection-details" role="region" aria-label="Details" hidden={!detailsOpen}>
      <div class="live-details-head"><b>Details</b><button type="button" class="live-details-close" data-testid="selection-details-close" aria-label={en?'Close details':'Details schließen'} onClick={()=>setDetailsOpen(false)}>×</button></div>
      <div class="live-details-body">
        {secondaryOrders.length>0&&<div class="live-secondary-orders" data-testid="secondary-order-bar">{secondaryOrders.map(order=><OrderButton key={order.id} id={order.id} compact/>)}</div>}
        {single&&<><div>{liveUnitText(single.typeId,'role',m.locale.value)}</div><div class="live-unit-stats">{(['dps','range','speed','vision','buildPower','regen'] as const).map(stat=><span key={stat}>{t(`ui.selection.stat.${stat==='buildPower'?'bp':stat}`)} {fmtDec(single.stats[stat],1)}</span>)}</div>{single.orders.length>0&&<div data-testid="order-queue">{single.orders.map((order,index)=><button key={index} onClick={()=>c.jumpToOrder(index)} onContextMenu={event=>{event.preventDefault();c.removeOrder(index);}}>{index+1}. {t(`ui.selection.order.${order.kind}`)}{order.typeId?` · ${name(order.typeId)}`:''}</button>)}</div>}</>}
        {multi&&<>{m.selection.multiStats.value&&<div>{t('ui.selection.sum.hp')} {fmtDec(m.selection.multiStats.value.avgHpPct,0)}%</div>}<div class="live-selection-unit-list" data-testid="selection-units">{multi.units.map((unit,index)=><button key={unit.handle} onClick={event=>c.selectUnit(unit.handle,clickModsFromEvent(event))} onContextMenu={event=>{event.preventDefault();c.selectUnit(unit.handle,clickModsFromEvent(event));}}>{name(unit.typeId)} · {index+1}</button>)}</div></>}
      </div>
    </div>
  </>;
}

/** Actual model artwork with the semantic class glyph as a fallback for future content. */
function BuildTileArt({typeId,role,tier}: {typeId:string;role:BuildRole;tier:number}) {
  return <BuildPortrait typeId={typeId} role={role} tier={tier}/>;
}

function LivePresentation({controller}: {controller:GameHudController}) {
  const m=controller.model,spec=cardSpec(m.card).value,game=controller.game,selected=m.card.unitCount.value>0;
  const theme=hudArmyTheme(game);
  const [detailsOpen,setDetailsOpen]=useState(false);
  useEffect(()=>{if(!selected)setDetailsOpen(false);},[selected]);
  // The build strip is a single row: Left/Right step with wrap-around, Home/End jump; there is no row above or below.
  const onGridKeyDown=(event:KeyboardEvent)=>{
    if(!(event.target instanceof HTMLElement))return;
    const grid=event.target.closest('.card__grid');
    if(!grid)return;
    const cells=[...grid.querySelectorAll<HTMLButtonElement>(':scope > button')].filter(cell=>cell.getClientRects().length>0);
    const index=cells.indexOf(event.target as HTMLButtonElement);
    if(index<0||cells.length===0)return;
    const next=event.key==='ArrowLeft'?index-1:event.key==='ArrowRight'?index+1:event.key==='Home'?0:event.key==='End'?cells.length-1:null;
    if(next===null)return;
    event.preventDefault();event.stopPropagation();
    cells[(next%cells.length+cells.length)%cells.length]?.focus();
  };
  const buildPage=spec.page==='build'||spec.page==='production';
  const buildCells=buildPage&&game?controller.cardCells().filter(cell=>{const bp=cell.typeId?game.bp.indexOf(simTypeId(cell.typeId)):-1;return !game.client.readOnlyCommands&&bp>=0&&cell.kind==='unit'&&game.bp.buildableByExpr(bp)>=0;}):[];
  const showOrders=selected&&!m.match.replay.value;
  const card=buildCells.length>0&&game?<BuildStrip count={buildCells.length} title={t(spec.page==='build'?'ui.card.head.build':'ui.card.head.production',{name:spec.headTypeId?liveUnitText(spec.headTypeId,'name',m.locale.value):''})}>{buildCells.map(cell=>{
    const bp=game.bp.indexOf(simTypeId(cell.typeId!)),frame=game.client.lastFrame;let builderPower=0;
    if(frame)for(let i=0;i<frame.unitCount;i++)if(game.client.selection.has(frame.unitHandle(i))&&game.bp.canBuild(frame.unitVisual(i),bp))builderPower+=game.bp.buildPowerQ16PerTickCol[frame.unitVisual(i)]!*10/65536;
    const glyph=buildRole(game.bp,bp);
    return <CardCell key={cell.slot} builderPower={builderPower} buildCost={{mass:game.bp.massCostCol[bp]!,energy:game.bp.energyCostCol[bp]!,buildTime:game.bp.buildTimeCol[bp]!}} cell={cell} glyph={<BuildTileArt typeId={cell.typeId!} role={glyph.role} tier={glyph.tier}/>} name={liveUnitText(cell.typeId!,'short',m.locale.value)}/>;
  })}</BuildStrip>:null;
  const hasGroups=m.strip.groups.value.some(group=>group.count>0);
  // Dock: selection summary over the order buttons on the left; tools, factory queue and upgrades above the build strip, which runs to the right edge.
  const dock=(selected||hasGroups)&&<div class="live-bottom-context" data-strip={card?'':undefined}>
    <div class="live-dock-upper">
      {selected&&<div class="live-selection-context"><CompactSelection controller={controller} detailsOpen={detailsOpen} setDetailsOpen={setDetailsOpen}/></div>}
      <div class="live-dock-aux">
        <div class="live-selection-tools">{selected&&<SelectionFilter/>}<LiveControlGroups/></div>
        <FactoryProduction detailsOpen={detailsOpen}/>
        {showOrders&&<><LiveCommanderUpgrade controller={controller}/><LiveExtractorUpgrade controller={controller}/><LiveFactoryUpgrade controller={controller}/></>}
      </div>
    </div>
    {showOrders&&<div class="live-command-context"><Panel class="live-primary-orders sc-frame" panelId="orders" testId="order-bar" component="OrderBar"><div class="live-primary-order-row">{PRIMARY_ORDERS.map(id=><div class="live-primary-order" key={id} data-order={id} role="group" aria-label={t('ui.orders.label',{name:t(`ui.orders.${id}.name`),keys:`Alt+${keyLabel(orderDef(id).key!,m.keyboardLayout.value)}`})}><OrderButton id={id} compact glyph={<CommandArt order={id}/>}/><span class="live-primary-order-caption" aria-hidden="true">{t(`ui.orders.${id}.short`)}</span></div>)}</div></Panel>{card}</div>}
  </div>;
  return <div class="hud live-game-presentation" style={theme.style} data-hud-army={theme.army} data-hud-color={theme.color} onKeyDownCapture={onGridKeyDown} data-testid="hud" data-hud-root="" data-selection-kind={m.selection.kind.value} data-card-page={spec.page}><IconSprite/><div class="hud-layer">{controller.ecoAvailable.value&&<ResourceBar/>}<MatchStatus/><PauseBanner/><LiveNotices/>{dock}{m.menus.settings.values.value.tooltips!=='off'&&<TooltipLayer/>}<GameMenu logo={<BrandLogo compact/>}/></div></div>;
}
