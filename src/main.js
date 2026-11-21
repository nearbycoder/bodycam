import * as THREE from 'three';
import { buildWorld } from './world.js';
import { makeOptics } from './optics.js';
import { routeAt, duration } from './route.js';
import { cameraAudio } from './audio.js';
import { createController } from './controller.js';
import { createEncounters } from './encounters.js';
import { createMenu } from './menu.js';
import {buildNavigation,drawFloorPlan,deckAt,decks} from './navigation.js';
import {getTextureQuality,setTextureQuality} from './texture-quality.js';
import {createBodyMotion} from './body-motion.js';
import './style.css';

const $ = id => document.getElementById(id);
const canvas=$('view'), film=$('film'), sound=cameraAudio(), controller=createController();
const dom={
  hud:$('hud'), archiveBar:$('archive-bar'), mapPanel:$('map-panel'), feed:$('feed'),
  touch:$('touch'), loading:$('loading'), time:$('time'), camClock:$('cam-clock'),
  torchBadge:$('torch-badge'), channel:$('channel'), playHint:$('play-hint'),
  weaponName:$('weapon-name'), remaining:$('remaining'), ammo:$('ammo'), capacity:$('capacity'),
  charge:$('charge'), shieldBar:$('shield').firstElementChild, shieldValue:$('shield-value'),
  cross:$('cross'), hitmark:$('hitmark'), tracker:$('tracker'), trackerText:$('tracker').querySelector('span')
};
const body=createBodyMotion();
const menu=createMenu(action), keys=new Set(), touches=new Map();
const touchMove={x:0,y:0};
const qualityLevels=[512,1024,2048,4096];
const qualityLabels=['512','1K','2K','4K'];
let selectedQuality=qualityLevels.indexOf(getTextureQuality()), qualityTimer,qualityRequest=0;
function qualityReadout(){
  const level=qualityLevels[selectedQuality];
  const input=$('texture-quality');input.value=selectedQuality;
  input.setAttribute('aria-valuetext',level+' pixels');
  $('quality-value').textContent=qualityLabels[selectedQuality];
  input.style.setProperty('--fill',(selectedQuality/3*100)+'%');
}
function selectQuality(index){
  selectedQuality=THREE.MathUtils.clamp(index,0,3);qualityReadout();
  const request=++qualityRequest, level=qualityLevels[selectedQuality];
  clearTimeout(qualityTimer);$('quality-status').textContent='Loading '+qualityLabels[selectedQuality]+' textures…';
  qualityTimer=setTimeout(async()=>{
    try{
      await setTextureQuality(level);
      if(request===qualityRequest)$('quality-status').textContent=level+' px maximum edge · Applied';
    }catch{
      if(request!==qualityRequest)return;
      selectedQuality=qualityLevels.indexOf(getTextureQuality());qualityReadout();
      $('quality-status').textContent='Texture download failed. Move the slider to retry.';
    }
  },220);
}
qualityReadout();$('quality-status').textContent=qualityLevels[selectedQuality]+' px maximum edge · Applied';
$('texture-quality').oninput=e=>selectQuality(Number(e.target.value));
const marker=new THREE.Vector3(), waypointVec=new THREE.Vector3();
const hudCache={};
let hintTime=0, torchEnabled=true, torchLevel=0, lastClockSec=-1;
let renderer, scene, camera, optics, world, position, encounters, ready=false;
let mode='home', started=false, manualParent='home', sourceTime=0, savedPose=null;
let elapsed=0, simTime=0, yaw=0, pitch=0, phase=0, walk=0, lean=0, lag=0, focus=0;
let trigger=false, touchFire=false, aiming=false, sprint=false, scan=0, lastFoot=0;
let padMode=false, connected=false, audioTouched=false, reason='', checkpoint=null, lastSector='';
let navigation, mapOpen=false, mapParent='', deck=1, path=[], routeClock=0, mapClock=0;
let lastSectorTime=0, stablePosition=null, inputPad={connected:false};
function setText(key,el,val){if(hudCache[key]!==val){hudCache[key]=val;el.textContent=val;}}
function toggleTorch(){
  torchEnabled=!torchEnabled;
  sound.effect('torch',.8);
}
function updateCamClock(seconds){
  const sec=Math.floor(seconds);
  if(sec===lastClockSec)return;
  lastClockSec=sec;
  dom.camClock.textContent=new Date(Date.UTC(2026,10,17,14,33,31+sec)).toISOString().slice(0,19).replace('T',' ');
}
function context(){
  return {started,audio:sound.enabled,reason,sector:world&&position?world.sector(position):'',
    total:encounters?.state.total||0,score:encounters?.state.score||0,archive:mode==='film'||mode==='guide'};
}
function clearInput(){
  keys.clear();touches.clear();touchMove.x=touchMove.y=0;trigger=touchFire=aiming=sprint=false;
}
function overlay(screen,selection=0){
  clearInput();
  menu.show(screen,context(),selection);
  dom.hud.hidden=!!screen || mode!=='play';
  dom.torchBadge.hidden=dom.hud.hidden;
  dom.archiveBar.hidden=!!screen || (mode!=='guide'&&mode!=='film');
  if(screen && document.pointerLockElement===canvas)document.exitPointerLock();
  sound.sync(sourceTime,!screen&&mode==='guide');
  sound.setAmbient(!screen&&mode==='play');
}
function useMouse(value){
  if(padMode===!value)return;
  padMode=!value;menu.setLayout(!value);
}
function lock(){
  if(padMode || matchMedia('(pointer: coarse)').matches || document.pointerLockElement===canvas)return;
  try{canvas.requestPointerLock?.()?.catch(()=>{});}catch{}
}
function restorePose(){
  if(!savedPose)return;
  position.copy(savedPose.position);yaw=savedPose.yaw;pitch=savedPose.pitch;savedPose=null;
}
function leaveArchive(){
  if(mode==='film'){film.pause();film.hidden=true;}
  restorePose();sourceTime=0;mode='home';sound.sync(0,false);
}
function begin(reset=false,revive=false){
  if(!ready)return;
  if(mode==='film'||mode==='guide')leaveArchive();
  if(!started || reset){
    encounters.reset();position.copy(world.spawn);yaw=world.yaw;pitch=0;
    checkpoint=world.spawn.clone();stablePosition=world.spawn.clone();lastSector=world.sector(position);lastSectorTime=0;
    body.reset(position,yaw,pitch);
    simTime=phase=lean=lag=focus=0;scan=5;hintTime=8;started=true;
  }else if(revive){
    encounters.respawn();position.copy(checkpoint||world.spawn);yaw=world.yaw;pitch=0;scan=3;body.reset(position,yaw,pitch);
  }
  if(!audioTouched){audioTouched=true;if(!sound.enabled)sound.toggle();}
  reason='';mode='play';encounters.setActive(true);overlay('');canvas.focus({preventScroll:true});lock();
}
function archive(kind){
  if(!ready && kind==='guide')return;
  if(position)savedPose={position:position.clone(),yaw,pitch};
  encounters?.setActive(false);mode=kind;sourceTime=0;
  if(kind==='guide'){position.copy(world.spawn);yaw=world.yaw;pitch=0;}
  else{film.hidden=false;film.currentTime=0;film.muted=!sound.enabled;film.loop=true;film.play().catch(()=>{});}
  overlay('');
}
function pause(message=''){
  if(mode!=='play'||menu.screen||mapOpen)return;
  reason=message;overlay('pause');
}
function back(){
  if(mode==='film'||mode==='guide'){leaveArchive();overlay('archive');return;}
  if(menu.screen==='controls'||menu.screen==='graphics'){overlay(manualParent);return;}
  if(menu.screen==='archive'){overlay('home');return;}
  if(menu.screen==='pause'){begin();return;}
  if(!menu.screen)pause();
}
function action(id){
  switch(id){
    case 'deploy': begin(false,encounters?.state.down); break;
    case 'respawn': begin(false,true); break;
    case 'restart': begin(true); break;
    case 'graphics': case 'controls': manualParent=menu.screen;overlay(id);break;
    case 'layout': menu.toggleLayout();break;
    case 'audio': audioTouched=true;sound.toggle();film.muted=!sound.enabled;menu.show(menu.screen,context(),menu.index);break;
    case 'map': toggleMap();break;
    case 'archive': overlay('archive');break;
    case 'film': case 'guide': archive(id);break;
    case 'back': back();break;
    case 'home':
      reason='';mode='home';if(encounters?.state.won)started=false;
      encounters?.setActive(false);overlay('home');break;
  }
}
function updateRoute(){
  path=navigation.route(position,encounters.livePositions());
  routeClock=.65;
}
function refreshMap(){
  $('deck-name').textContent=decks[deck];
  $('map-help').textContent=padMode?'D-PAD ← →  FLOOR     B  CLOSE':'← →  FLOOR     TAB  CLOSE';
  drawFloorPlan($('floor-plan'),deck,navigation,position,yaw,encounters.livePositions(),path);
}
function changeDeck(delta){
  deck=THREE.MathUtils.clamp(deck+delta,0,decks.length-1);refreshMap();
}
function toggleMap(){
  if(mode!=='play')return;
  if(mapOpen){
    mapOpen=false;$('map-panel').hidden=true;overlay(mapParent);
    if(!mapParent){canvas.focus({preventScroll:true});lock();}
  }else{
    mapParent=menu.screen;mapOpen=true;overlay('');
    dom.hud.hidden=true;dom.torchBadge.hidden=true;dom.mapPanel.hidden=false;dom.feed.dataset.screen='map';
    if(document.pointerLockElement===canvas)document.exitPointerLock();
    deck=deckAt(position.y-1.58);updateRoute();refreshMap();mapClock=0;
  }
}
function scanRoom(){if(mode==='play'&&!menu.screen){scan=6;updateRoute();}}
function look(dx,dy){
  const gain=1-focus*.52;
  yaw-=dx*.00225*gain;
  pitch=THREE.MathUtils.clamp(pitch-dy*.0021*gain,-1.25,1.18);
  lag=THREE.MathUtils.clamp(lag+dx*.00023,-.055,.055);
}
function padInput(now){
  const pad=controller.sample(now);inputPad=pad;
  if(pad.connected&&!connected){useMouse(false);}
  if(pad.disconnected){pause('Controller disconnected. Reconnect it or use the keyboard.');useMouse(true);}
  connected=pad.connected;
  if(!connected)return;
  if(pad.activity&&!padMode)useMouse(false);
  if(mapOpen){
    if(pad.nextDeck)changeDeck(1);if(pad.prevDeck)changeDeck(-1);
    if(pad.back||pad.map||pad.pause||pad.accept)toggleMap();
    return;
  }
  if(menu.screen){
    if(menu.screen==='graphics'&&(pad.nextDeck||pad.prevDeck))selectQuality(selectedQuality+(pad.nextDeck?1:-1));
    if(pad.navigate)menu.move(pad.navigate);
    if(pad.accept)menu.accept();
    else if(pad.pause&&menu.screen==='home')action('deploy');
    else if(pad.back || (pad.pause&&menu.screen==='pause'))back();
    return;
  }
  if(mode==='guide'||mode==='film'){if(pad.back||pad.pause)back();return;}
  if(pad.map){toggleMap();return;}
  if(pad.pause||pad.back){pause();return;}
  if(pad.weapon)encounters.switchWeapon();
  if(pad.torch)toggleTorch();
  if(pad.reload)encounters.reload();
  if(pad.scan)scanRoom();
  if(pad.sprint)sprint=!sprint;
}
window.addEventListener('keydown',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  if(mapOpen){
    e.preventDefault();
    if(e.code==='ArrowLeft')changeDeck(-1);
    if(e.code==='ArrowRight')changeDeck(1);
    if(!e.repeat&&['Escape','Tab','Enter'].includes(e.code))toggleMap();
    return;
  }
  if(e.code==='Tab'){
    if(mode==='play'&&!menu.screen){e.preventDefault();if(!e.repeat)toggleMap();}
    return;
  }
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  if(!e.repeat)useMouse(true);
  if(menu.screen){
    if(menu.screen==='graphics'&&['ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();selectQuality(selectedQuality+(e.code==='ArrowRight'?1:-1));}
    else if(e.code==='ArrowDown'||e.code==='KeyS')menu.move(1);
    else if(e.code==='ArrowUp'||e.code==='KeyW')menu.move(-1);
    else if(!e.repeat&&(e.code==='Enter'||e.code==='Space')){e.preventDefault();menu.accept();}
    else if(!e.repeat&&e.code==='Escape')back();
    return;
  }
  if(mode!=='play'){if(e.code==='Escape'||e.code==='KeyV')back();return;}
  keys.add(e.code);if(e.repeat)return;
  if(e.code==='Escape'||e.code==='KeyC')pause();
  if(e.code==='Digit1')encounters.selectWeapon('pistol');
  if(e.code==='Digit2')encounters.selectWeapon('carbine');
  if(e.code==='KeyR')encounters.reload();
  if(e.code==='KeyF')toggleTorch();
  if(e.code==='KeyQ')scanRoom();
  if(e.code==='KeyM'){audioTouched=true;sound.toggle();}
});
window.addEventListener('keyup',e=>keys.delete(e.code));
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  if(menu.screen||mapOpen||mode!=='play')return;
  useMouse(true);
  if(e.pointerType==='touch'){
    touches.set(e.pointerId,{walk:e.clientX<innerWidth*.45,x:e.clientX,y:e.clientY,sx:e.clientX,sy:e.clientY});
    canvas.setPointerCapture(e.pointerId);
  }else{
    if(e.button===0){trigger=true;lock();}
    if(e.button===2)aiming=true;
  }
});
window.addEventListener('pointermove',e=>{
  if(menu.screen||mapOpen||mode!=='play')return;
  const touch=touches.get(e.pointerId);
  if(touch){
    if(touch.walk){touchMove.x=THREE.MathUtils.clamp((e.clientX-touch.sx)/56,-1,1);touchMove.y=THREE.MathUtils.clamp((touch.sy-e.clientY)/56,-1,1);}
    else look(e.clientX-touch.x,e.clientY-touch.y);
    touch.x=e.clientX;touch.y=e.clientY;
  }else if(document.pointerLockElement===canvas||trigger||aiming){if(e.movementX||e.movementY)look(e.movementX,e.movementY);}
});
function release(e){
  if(touches.get(e.pointerId)?.walk)touchMove.x=touchMove.y=0;
  touches.delete(e.pointerId);
  if(e.button===0)trigger=false;
  if(e.button===2)aiming=false;
}
window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);
window.addEventListener('blur',()=>{clearInput();pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&!padMode)pause();});
$('map-close').onclick=toggleMap;$('prev-deck').onclick=()=>changeDeck(-1);$('next-deck').onclick=()=>changeDeck(1);
$('pause').onclick=()=>pause();$('archive-back').onclick=back;
$('touch').hidden=!matchMedia('(any-pointer:coarse)').matches;
$('touch-scan').onclick=scanRoom;$('touch-charge').onclick=()=>encounters.reload();$('touch-weapon').onclick=()=>encounters.switchWeapon();
$('touch-fire').onpointerdown=e=>{touchFire=true;e.target.setPointerCapture(e.pointerId);};
$('touch-fire').onpointerup=$('touch-fire').onpointercancel=()=>{touchFire=false;};
function resize(){
  const ratio=Math.min(devicePixelRatio||1,1.5,1800/innerWidth);
  renderer.setPixelRatio(ratio);renderer.setSize(innerWidth,innerHeight,false);
  optics.resize(Math.max(1,Math.floor(innerWidth*ratio)),Math.max(1,Math.floor(innerHeight*ratio)));
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
}
function player(dt){
  const pad=inputPad.connected?inputPad:{};
  const handling=encounters.state.charging||(encounters.state.swapPhase&&encounters.state.swapPhase!=='idle');
  const requestedFocus=handling?0:Math.max(aiming?1:0,pad.aim||0);
  focus=THREE.MathUtils.damp(focus,requestedFocus,encounters.state.weapon==='pistol'?14:10,dt);
  const turn=v=>Math.sign(v||0)*Math.pow(Math.abs(v||0),1.45);
  const turnSpeed=(1-focus*.57)*dt;
  yaw+=turnSpeed*(1.85*(Number(keys.has('ArrowLeft'))-Number(keys.has('ArrowRight')))-2.65*turn(pad.lookX));
  pitch=THREE.MathUtils.clamp(pitch+turnSpeed*(1.48*(Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown')))-1.87*turn(pad.lookY)),-1.25,1.18);
  const strafe=Number(keys.has('KeyD'))-Number(keys.has('KeyA'))+touchMove.x+(pad.x||0);
  const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS'))+touchMove.y-(pad.y||0);
  const wantsFire=trigger||touchFire||keys.has('Space')||pad.fire;
  if(forward<.1||wantsFire||requestedFocus||handling)sprint=false;
  const running=forward>.15&&!wantsFire&&!handling&&!requestedFocus&&(sprint||keys.has('ShiftLeft')||keys.has('ShiftRight'));
  const speed=body.travel(world,position,dt,strafe,forward,yaw,pitch,focus,running);
  const sector=world.sector(position);
  if(sector!==lastSector){
    // Record the approach so a restart does not place the player in the encounter.
    if(simTime-lastSectorTime>1.2 && encounters.state.shield>=65)checkpoint.copy(stablePosition);
    stablePosition.copy(position);lastSector=sector;lastSectorTime=simTime;
  }
  return speed;
}
function hud(dt){
  hintTime=Math.max(0,hintTime-dt);
  const hideHint=hintTime===0||!dom.touch.hidden;
  if(dom.playHint.hidden!==hideHint)dom.playHint.hidden=hideHint;
  if(hintTime>0)setText('hint',dom.playHint,padMode?'RT  FIRE   ·   X  RELOAD   ·   LB  LIGHT   ·   VIEW  MAP':'CLICK  FIRE   ·   R  RELOAD   ·   F  LIGHT   ·   TAB  MAP');
  const s=encounters.state;
  setText('channel',dom.channel,(lastSector||'FIELD CAMERA').toUpperCase());
  setText('weapon',dom.weaponName,s.weapon==='carbine'?'COMPACT CARBINE':'SERVICE PISTOL');
  setText('remaining',dom.remaining,String(s.remaining).padStart(2,'0'));
  setText('ammo',dom.ammo,String(s.ammo).padStart(2,'0'));
  setText('capacity',dom.capacity,'/ '+s.capacity);
  setText('charge',dom.charge,s.charging?'RELOADING':'');
  const torchStr=String(torchEnabled);
  if(hudCache.torch!==torchStr){hudCache.torch=torchStr;dom.torchBadge.dataset.on=torchStr;}
  const shieldPct=Math.round(s.shield*2)*.5;
  if(hudCache.shieldPct!==shieldPct){
    hudCache.shieldPct=shieldPct;
    dom.shieldBar.style.width=shieldPct+'%';
    dom.shieldValue.textContent=Math.ceil(s.shield);
  }
  const handling=s.charging||s.swapPhase!=='idle';
  const crossOp=Math.round((handling?.18:1-body.state.sprint*.74)*100)/100;
  if(hudCache.crossOp!==crossOp){hudCache.crossOp=crossOp;dom.cross.style.opacity=crossOp;}
  const spread=Math.round((7+(s.recoil||0)*9+body.state.gait*2.4-focus*3.2)*4)/4;
  if(hudCache.spread!==spread){hudCache.spread=spread;dom.cross.style.setProperty('--spread',spread+'px');}
  const hitOp=Math.round(s.hit*100)/100;
  if(hudCache.hitOp!==hitOp){hudCache.hitOp=hitOp;dom.hitmark.style.opacity=hitOp;}
  scan=Math.max(0,scan-dt);
  routeClock-=dt;
  if(scan>0&&routeClock<=0)updateRoute();
  const waypoint=scan>0&&path.length>8?path[7]:null;
  let target=null;
  if(scan>0){
    if(waypoint){waypointVec.set(waypoint.x,waypoint.y+1.28,waypoint.z);target=waypointVec;}
    else target=encounters.nearest(position);
  }
  const hideTracker=!target;
  if(dom.tracker.hidden!==hideTracker)dom.tracker.hidden=hideTracker;
  if(target){
    marker.copy(target).sub(camera.position);
    const distance=marker.length(),angle=THREE.MathUtils.euclideanModulo(Math.atan2(-marker.x,-marker.z)-yaw+Math.PI,2*Math.PI)-Math.PI;
    const height=marker.y>1.8?' ↑':marker.y< -1.8?' ↓':'';
    marker.copy(target).project(camera);
    const ndcX=Math.abs(angle)>Math.PI/2?-Math.sign(angle)*.85:THREE.MathUtils.clamp(marker.x/.88,-.85,.85);
    const ndcY=Math.abs(angle)>Math.PI/2?0:THREE.MathUtils.clamp(marker.y/.88,-.65,.65);
    dom.tracker.style.left=(50+ndcX*50)+'%';dom.tracker.style.top=(50-ndcY*50)+'%';
    setText('tracker',dom.trackerText,waypoint?'ROUTE · '+Math.round(path.length*.4)+' m':Math.round(distance)+' m'+height);
  }
}
function start(){
  renderer=new THREE.WebGLRenderer({canvas,powerPreference:'high-performance',antialias:false,alpha:false,depth:false,stencil:false});
  renderer.outputColorSpace=THREE.SRGBColorSpace;scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(84,1,.045,115);
  THREE.DefaultLoadingManager.onLoad=()=>{ready=true;dom.loading.hidden=true;};
  world=buildWorld(scene);position=world.spawn.clone();yaw=world.yaw;
  navigation=buildNavigation(world);
  encounters=createEncounters(scene,world,sound);encounters.setActive(false);
  optics=makeOptics(renderer);resize();window.addEventListener('resize',resize);
  let last=performance.now(),audioClock=0;
  function frame(now){
    requestAnimationFrame(frame);
    const dt=Math.min(Math.max((now-last)/1000,0),.06);last=now;
    if(document.hidden)return;
    padInput(now);
    if(!navigation.ready)navigation.advance(4);
    if(mapOpen&&(mapClock-=dt)<=0){updateRoute();refreshMap();mapClock=.45;}
    if(!ready||mode==='film')return;
    elapsed+=dt;
    const playing=mode==='play'&&!menu.screen&&!mapOpen, guided=mode==='guide';
    let speed=0;
    if(playing){simTime+=dt;speed=player(dt);}
    if(guided){
      sourceTime=Math.min(duration,sourceTime+dt);
      const [x,z,angle,tilt]=routeAt(sourceTime),px=position.x,pz=position.z;
      world.move(position,x-px,z-pz);speed=Math.min(3,Math.hypot(position.x-px,position.z-pz)/Math.max(.001,dt));
      lag=THREE.MathUtils.clamp(lag-(angle-yaw)*.11,-.07,.07);yaw=angle;pitch=tilt;
      if((audioClock+=dt)>.4){sound.sync(sourceTime,true);audioClock=0;}
      setText('time',dom.time,new Date(Date.UTC(2026,10,17,14,33,31+Math.floor(sourceTime))).toISOString().slice(0,19).replace('T',' ')+' +0100');
      if(sourceTime===duration){back();return;}
    }
    if(playing){
      walk=body.state.gait;phase=body.state.stride;encounters.state.motion=body.state;
    }else if(guided){
      walk=THREE.MathUtils.damp(walk,Math.min(1,speed/1.6),9,dt);phase+=dt*(5.2+speed*.75);
    }
    if(playing||guided)lag*=Math.exp(-dt*6);
    const foot=Math.floor(phase/Math.PI);
    if(playing&&foot!==lastFoot&&walk>.3){sound.step();body.step(foot);}
    lastFoot=foot;
    const sway=Math.sin(phase)*walk,rise=Math.sin(phase*2)*walk;
    if(playing||guided)lean=THREE.MathUtils.damp(lean,sway*.017-lag*.16,9,dt);
    const home=mode==='home'&&!started;
    const motorView=mode==='home'?world.motorCamera:null;
    if(home&&!motorView){encounters.setActive(true);encounters.preview(dt);}

    camera.rotation.order='YXZ';camera.rotation.set(pitch-.028+.005*rise,yaw+.006*sway+(home?.055*Math.sin(elapsed*.17):0),lean);
    if(mode==='play'){camera.rotation.x+=body.camera.pitch;camera.rotation.y+=body.camera.yaw;camera.rotation.z+=body.camera.bank;}
    camera.position.copy(position);
    camera.position.y+=rise*(mode==='play'?.016+body.state.sprint*.014:.018)+(mode==='play'?body.camera.lift:.003*Math.sin(elapsed*1.6));
    camera.position.x+=Math.cos(yaw)*sway*.023;camera.position.z-=Math.sin(yaw)*sway*.023;
    if(motorView){
      camera.position.copy(motorView.position);
      camera.position.x+=Math.sin(elapsed*.16)*.14;
      camera.lookAt(motorView.target);
    }
    const fov=motorView?(motorView.fov||59):84-(mode==='play'?focus*23:0);
    if(Math.abs(camera.fov-fov)>.02){camera.fov=fov;camera.updateProjectionMatrix();}
    camera.updateMatrixWorld();
    world.updateVisibility(camera,dt,elapsed);
    if(playing){
      const shield=encounters.state.shield;
      const charging=encounters.state.charging, reloadBefore=encounters.state.chargeProgress;
      encounters.update(dt,camera,position);
      if(padMode&&charging&&encounters.state.swapPhase==='idle'&&reloadBefore<.77&&encounters.state.chargeProgress>=.77)
        controller.vibrate(.13,.12,48);
      if(trigger||touchFire||keys.has('Space')||inputPad.fire){
        if(body.state.sprint<.5&&encounters.fire(camera)){
          body.shot(encounters.state.weapon);
          if(padMode)controller.vibrate(.08,.29,65);
        }
      }
      if(encounters.state.shield<shield){
        body.flinch();
        if(padMode)controller.vibrate(.5,.12,135);
      }
      hud(dt);
      if(encounters.state.down||encounters.state.won)overlay(encounters.state.down?'down':'won');
    }
    if(!playing&&!guided)setText('channel',dom.channel,'FIELD CAMERA');
    updateCamClock(guided?sourceTime:mode==='play'?simTime:elapsed);
    const targetTorch=(mode==='play'&&torchEnabled&&!motorView)?1:0;
    torchLevel=THREE.MathUtils.damp(torchLevel,targetTorch,18,dt);
    const light=.85+.25*Math.pow(.5+.5*Math.sin(position.z*1.48),3);
    const lift=guided?THREE.MathUtils.smoothstep(sourceTime,5.13,5.38)*(1-THREE.MathUtils.smoothstep(sourceTime,6.86,7.13)):0;
    const sensorTime=mode==='play'?simTime:elapsed;
    optics.render(scene,camera,sensorTime,.016*sway+lag,-.009*rise+.002*Math.sin(sensorTime*1.4),light,lift,sourceTime<6,motorView?false:guided?null:encounters.state,torchLevel,mode==='play'?body.state.jolt:0);
  }
  requestAnimationFrame(frame);
}
overlay('home');
try{start();}catch(error){console.error(error);$('loading').textContent='3D CAMERA UNAVAILABLE';}
