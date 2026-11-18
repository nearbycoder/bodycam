import * as THREE from 'three';
import { buildDrone } from './drone.js';
import { makeImpactEffects } from './pulse-effects.js';

const loadouts={
  pistol:{capacity:12,interval:.25,reload:1.54,emptyReload:1.74,holster:.24,draw:.30,recover:.235},
  carbine:{capacity:24,interval:.14,reload:1.86,emptyReload:2.10,holster:.29,draw:.35,recover:.145}
};
const reach=40;
const detectionRange=13;
const droneRadius=.36;

export function createEncounters(scene,world,sound) {
  const group=new THREE.Group();
  group.name='Inspection drones and encounter effects';
  group.visible=false;
  scene.add(group);
  const drones=world.targets.map(({x,y,z},index)=>{
    const rig=buildDrone(group);
    rig.root.name=`Inspection drone ${index+1}`;
    return {rig, anchor:new THREE.Vector3(x,y,z),phase:index*2.39996,
      armor:index%4===3?3:2};
  });
  const effects=makeImpactEffects(group);
  const surfaceRay=new THREE.Raycaster();
  const contacts=[];
  const player=new THREE.Vector3(), origin=new THREE.Vector3(), heading=new THREE.Vector3();
  const aimPoint=new THREE.Vector3(), end=new THREE.Vector3(), normal=new THREE.Vector3();
  const shotFrom=new THREE.Vector3(),muzzle=new THREE.Vector3(),sphere=new THREE.Sphere();
  const sightLine=new THREE.Ray();
  const normalMatrix=new THREE.Matrix3();
  const state={};
  const weapons={};
  let time=0, cooldown=0, shieldDelay=0, grace=0, active=false;
  let queuedWeapon=null,swapElapsed=0,shotAge=Infinity;
  function syncWeapon(){
    const gun=weapons[state.weapon];
    state.ammo=gun.ammo;state.capacity=loadouts[state.weapon].capacity;
    state.charging=gun.remaining>0;
    state.emptyReload=state.charging && gun.empty;
    state.chargeProgress=gun.duration>0 ? 1-gun.remaining/gun.duration : 0;
  }
  function foley(name){
    sound?.effect?.(name,1,state.weapon);
  }
  function selectWeapon(name) {
    if(!active||state.won||state.down||state.swapPhase!=='idle'||
       !Object.hasOwn(loadouts,name)||name===state.weapon)return false;
    queuedWeapon=name;swapElapsed=0;
    state.swapPhase='holster';state.swapProgress=0;
    foley('holster');return true;
  }
  function switchWeapon(){return selectWeapon(state.weapon==='pistol'?'carbine':'pistol');}
  function clearPlayer(){
    for(const [name,spec] of Object.entries(loadouts)){
      weapons[name]={ammo:spec.capacity,remaining:0,duration:0,empty:false};
    }
    Object.assign(state,{weapon:'pistol',swapPhase:'idle',swapProgress:0,recoil:0,shotSerial:0,
      shield:100,flash:0,hit:0,damage:0,down:false});
    queuedWeapon=null;swapElapsed=0;shotAge=Infinity;
    syncWeapon();cooldown=0;shieldDelay=0;grace=1.6;
    effects.clear();
  }
  // The outgoing pose remains active until it is fully hidden. The incoming
  // pose starts at its hidden endpoint on that same simulation frame.
  function advanceSwitch(dt){
    const outgoing=state.swapPhase==='holster';
    const duration=loadouts[state.weapon][outgoing?'holster':'draw'];
    const consumed=Math.min(dt,duration-swapElapsed);
    swapElapsed+=consumed;
    state.swapProgress=Math.min(1,swapElapsed/duration);
    if(swapElapsed>=duration-1e-8){
      swapElapsed=0;
      if(outgoing){
        state.weapon=queuedWeapon;queuedWeapon=null;state.swapPhase='draw';state.swapProgress=0;
        state.flash=state.recoil=0;shotAge=Infinity;
        syncWeapon();foley('draw');
      }else{
        state.swapPhase='idle';state.swapProgress=0;
        cooldown=Math.max(cooldown,.025);
      }
    }
    return dt-consumed;
  }
  const reloadBeats=[[.20,'reach'],[.40,'release'],[.61,'shift'],[.77,'seat'],[.91,'settle']];
  function advanceHandling(dt){
    if(state.down)return;
    // A single frame may span the holster/draw boundary. Only leftover
    // simulation time can advance the equipped weapon's suspended reload.
    let remainingFrame=dt;
    while(remainingFrame>1e-8&&state.swapPhase!=='idle')remainingFrame=advanceSwitch(remainingFrame);
    const gun=weapons[state.weapon];
    if(!gun.remaining||remainingFrame<=0)return;
    const before=state.chargeProgress;
    gun.remaining=Math.max(0,gun.remaining-remainingFrame);
    if(gun.remaining<1e-8)gun.remaining=0;
    if(!gun.remaining){
      gun.ammo=loadouts[state.weapon].capacity;
      // Give the renderer one fully ready frame before a held trigger repeats.
      cooldown=Math.max(cooldown,.035);
    }
    syncWeapon();
    for(const [phase,cue] of reloadBeats){
      if(before<phase&&state.chargeProgress>=phase)foley(cue);
    }
  }
  function place(drone) {
    const {anchor,phase,rig}=drone;
    const t=time;
    const width=drone.patrolRadius;
    rig.root.position.set(anchor.x+width*Math.sin(.77*t+phase),
      anchor.y+1.30+.13*Math.sin(t*1.69+phase),anchor.z+width*.53*Math.cos(1.11*t+phase));
    rig.shadow.position.set(rig.root.position.x,anchor.y+.025,rig.root.position.z);
  }
  function reset() {
    time=0;
    Object.assign(state,{remaining:drones.length,total:drones.length,score:0,won:false});
    clearPlayer();
    drones.forEach((drone,i)=>{
      Object.assign(drone,{health:drone.armor,stagger:0,visibleToPlayer:false,scanIn:i*.031,
        wait:1.25+(i%4)*.24,warning:0,wreck:0});
      place(drone);
      drone.rig.root.rotation.y=drone.phase;
      drone.rig.animate(0,drone.phase,0,0,0);
    });
  }
  // Bound each orbit against the architecture once. Tight landings support a
  // smaller hover pattern than the patrols in the center of the large halls.
  for(const drone of drones){
    origin.copy(drone.anchor);origin.y+=1.30;
    let free=.85;
    for(let n=0;n<8;n++){
      const angle=n*Math.PI/4;
      heading.set(Math.cos(angle),0,Math.sin(angle));
      const obstruction=surfaceHit(origin,heading,1.36);
      if(obstruction)free=Math.min(free,Math.max(0,obstruction.distance-.51));
    }
    drone.patrolRadius=free;
  }
  reset();
  function preview(dt) {
    time+=dt;
    for(const drone of drones){
      place(drone);
      drone.rig.root.rotation.y=drone.phase+.28*Math.sin(time*.5);
      drone.rig.animate(time,drone.phase,0,0,0);
    }
  }
  function respawn() {
    if(!state.down)return false;
    clearPlayer();
    for(const drone of drones){
      drone.visibleToPlayer=false;drone.warning=0;drone.wait=1.25;
    }
    return true;
  }
  function surfaceHit(from,direction,length) {
    surfaceRay.set(from,direction);
    surfaceRay.near=.012;surfaceRay.far=length;
    contacts.length=0;
    surfaceRay.intersectObjects(world.occluders,false,contacts);
    return contacts[0];
  }
  function reload(){
    if(!active||state.down||state.won||state.swapPhase!=='idle'||state.charging)return false;
    const gun=weapons[state.weapon],spec=loadouts[state.weapon];
    gun.empty=gun.ammo===0;
    gun.duration=gun.empty ? spec.emptyReload : spec.reload;gun.remaining=gun.duration;
    syncWeapon();foley('reload');
    return true;
  }
  function fire(camera) {
    if(!active||state.down||state.won||state.swapPhase!=='idle'||state.charging||cooldown>0)return false;
    if(state.ammo<=0){reload();return false;}
    camera.getWorldPosition(origin);camera.getWorldDirection(heading);
    sightLine.set(origin,heading);
    const wall=surfaceHit(origin,heading,reach);
    let distance=wall?.distance??reach, picked=null;
    for(const drone of drones)if(drone.health>0){
      sphere.set(drone.rig.root.position,droneRadius);
      if(sightLine.intersectSphere(sphere,aimPoint)){
        const hitDistance=origin.distanceTo(aimPoint);
        if(hitDistance<distance){distance=hitDistance;picked=drone;}
      }
    }
    end.copy(origin).addScaledVector(heading,distance);
    if(camera.userData.pulseOutlet)muzzle.copy(camera.userData.pulseOutlet);
    else muzzle.set(.12,-.115,-.55);
    camera.localToWorld(muzzle);
    effects.shot(muzzle,end,heading,state.weapon);
    const gun=weapons[state.weapon];
    gun.ammo--;gun.duration=0;gun.empty=false;syncWeapon();
    cooldown=loadouts[state.weapon].interval;state.flash=1;state.recoil=1;state.shotSerial++;shotAge=0;
    sound?.effect?.(state.weapon);
    if(picked){
      picked.health--;
      state.hit=1;picked.stagger=1;
      normal.copy(heading).negate();
      if(!picked.health){
        state.remaining--;state.score+=picked.armor*65;
        effects.impact(picked.rig.root.position,normal,'metal',1.45);
        picked.fallStart=picked.rig.root.position.y;
        sound?.effect?.('break');
        if(!state.remaining){state.won=true;sound?.effect?.('clear');}
      }else{
        effects.impact(end,normal,'metal',.80);
        sound?.effect?.('hit');
      }
    }else if(wall){
      normal.copy(wall.face.normal).applyMatrix3(normalMatrix.getNormalMatrix(wall.object.matrixWorld)).normalize();
      effects.impact(end,normal,'plaster',.75);
    }
    if(state.ammo===0)reload();
    return true;
  }
  function hurt() {
    if(state.won||state.down||grace>0)return;
    shieldDelay=6.2;state.shield=Math.max(0,state.shield-22);state.damage=1;
    sound?.effect?.('shield');
    if(state.shield===0){
      state.down=true;state.charging=state.emptyReload=false;state.chargeProgress=0;
      state.swapPhase='idle';state.swapProgress=0;queuedWeapon=null;swapElapsed=0;
      state.recoil=state.flash=0;shotAge=Infinity;
    }
  }
  function updateDrone(drone,dt){
    const {rig,phase}=drone;
    const nearby=drone.anchor.distanceToSquared(player)<32*32;
    rig.root.visible=rig.shadow.visible=nearby;
    if(!nearby){
      drone.visibleToPlayer=false;drone.warning=0;return;
    }
    if(!drone.health){
      if(drone.wreck<1){
        drone.wreck=Math.min(1,drone.wreck+dt*1.75);
        rig.root.position.y=THREE.MathUtils.lerp(drone.fallStart,drone.anchor.y+.22,drone.wreck*drone.wreck);
        rig.animate(time,phase,0,0,drone.wreck);
      }
      return;
    }
    place(drone);
    drone.stagger=Math.max(0,drone.stagger-dt*4);
    drone.scanIn-=dt;
    if(drone.scanIn<=0){
      drone.scanIn=.22+.045*Math.sin(phase);
      heading.subVectors(player,rig.root.position);
      const distance=heading.length();
      drone.visibleToPlayer=distance<detectionRange && distance>.02 &&
        !surfaceHit(rig.root.position,heading.normalize(),Math.max(.012,distance-.08));
    }
    if(drone.visibleToPlayer&&!state.down&&!state.won){
      const targetYaw=Math.atan2(player.x-rig.root.position.x,player.z-rig.root.position.z);
      const yawError=targetYaw-rig.root.rotation.y;
      rig.root.rotation.y+=Math.atan2(Math.sin(yawError),Math.cos(yawError))*(1-Math.exp(-dt*5));
      if(drone.warning>0){
        drone.warning+=dt;
        if(drone.warning>=.86){
          heading.subVectors(player,rig.root.position).normalize();
          // Cover can be reached during the acquisition flash.
          shotFrom.copy(rig.root.position).addScaledVector(heading,.32);
          const hit=surfaceHit(shotFrom,heading,detectionRange+2);
          effects.launch(shotFrom,heading,hit?.distance??detectionRange+2);
          sound?.effect?.('orb',Math.min(.75,2/Math.max(1,player.distanceTo(shotFrom))));
          drone.warning=0;drone.wait=2.15+.4*Math.sin(phase);
        }
      }else if((drone.wait-=dt)<=0 && grace===0){
        drone.warning=.001;
        sound?.effect?.('alert',Math.min(.58,2/Math.max(1,player.distanceTo(rig.root.position))));
      }
    }else{
      drone.warning=0;
      drone.wait=Math.max(.65,drone.wait);
      rig.root.rotation.y+=dt*.20;
    }
    rig.animate(time,phase,drone.warning/.86,drone.stagger,0);
  }
  function update(dt,camera,position){
    if(!active||dt<=0)return;
    time+=dt;cooldown=Math.max(0,cooldown-dt);
    grace=Math.max(0,grace-dt);shieldDelay=Math.max(0,shieldDelay-dt);
    state.hit=Math.max(0,state.hit-dt/.23);
    state.damage=Math.max(0,state.damage-dt/.46);
    state.flash=Math.max(0,state.flash-dt/.12);
    shotAge+=dt;
    const recovery=loadouts[state.weapon].recover;
    state.recoil=Math.pow(Math.max(0,1-shotAge/recovery),1.7);
    advanceHandling(dt);
    if(!shieldDelay&&!state.down)state.shield=Math.min(100,state.shield+dt*8);
    player.copy(position??camera.position);player.y-=.16;
    for(const drone of drones)updateDrone(drone,dt);
    effects.update(dt,player,hurt);
  }
  function nearest(position) {
    let closest=null,best=Infinity;
    for(const drone of drones)if(drone.health>0){
      const at=drone.rig.root.position, d=at.distanceToSquared(position);
      if(d<best){best=d;closest=at;}
    }
    return closest;
  }
  function livePositions(){
    return drones.filter(drone=>drone.health>0).map(drone=>drone.rig.root.position);
  }
  return {get state(){return state;}, update,preview,fire,reload,reset,respawn,nearest,livePositions,switchWeapon,selectWeapon,
    setActive(value){active=Boolean(value);group.visible=active;}};
}
