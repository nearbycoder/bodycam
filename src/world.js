import * as THREE from 'three';
import { daylightGlazing } from './glazing.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { construction, windowCenters } from './construction.js';
import { addDecor } from './decor.js';
import { intakeFixtures, radiator } from './intake-fixtures.js';
import { doorCutWidth, doorPhotoExtent, doorway, stairNosing, wallWear, windowSill } from './worn-masonry.js';
import { buildAnnex } from './expansion.js';
import { cullHiddenActors } from './actor-visibility.js';
import { motorCamera } from './vehicle.js';
import { buildOccluderGrid } from './occluder-grid.js';

function patchRectAreaEarlyOut() {
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (!chunk || chunk.includes('bodycam_rect_early_out')) return;
  const anchor = 'vec3 lightColor = rectAreaLight.color;';
  if (!chunk.includes(anchor)) return;
  THREE.ShaderChunk.lights_physical_pars_fragment = chunk.replace(
    anchor,
    `${anchor}\n\t\t/* bodycam_rect_early_out */ if ( max( lightColor.r, max( lightColor.g, lightColor.b ) ) <= 0.0001 ) return;`
  );
}

const eye = 1.58;
const doors = [-.55,-7.2];
const stairStart = -14.60;
const stairEnd = -17.85;
const steps = 10;
const rise = 1.60 / steps;
const run = (stairStart-stairEnd) / steps;
const lerp = THREE.MathUtils.lerp;

function originalGround(x,z,feet) {
  const inside = (x0,x1,z0,z1) => x>=x0 && x<=x1 && z>=z0 && z<=z1;
  const level = h => Math.abs(feet-h)<.32 ? h : null;
  // A narrow opening connects each room through the full wall thickness.
  if (feet>2.7 && (inside(-1.31,-.21,-13.02,-12.74) || inside(-2.75,1.25,-12.74,-9.67))) return level(3.20);
  if (inside(-1.45,1.45,-12.76,3.5) || inside(-1.26,1.26,-13.02,-12.76)) return level(0);
  for (const center of doors) {
    if (inside(1.45,1.70,center-.515,center+.515) ||
        inside(1.70,5.48,center-2.50,center+2.45)) return level(0);
  }
  if (!inside(-3.45,2.65,-19.35,-13.0)) return null;
  if (z>stairStart && feet>2.7) return level(3.2);
  if (x<=0 && z<stairEnd) return level(1.60);
  if (z>=stairEnd && z<=stairStart) {
    const fraction = (stairStart-z)/(stairStart-stairEnd);
    if (x<=-1.73) return level(1.60*fraction);
    if (x>=-1.55 && x<=0) {
      const upper = 3.20-1.60*fraction;
      if (feet>1.12 || upper<2.02) return level(upper);
    }
    if (x> -1.73 && x< -1.55 && z<stairStart-.2) return null;
  }
  return level(0);
}

function move(groundAt,position,dx,dz) {
  const pieces=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.10));
  if (!Number.isFinite(pieces)) return;
  function slide(x,z) {
    const feet=position.y-eye, floor=groundAt(x,z,feet);
    if (floor===null) return;
    const margin=.155;
    if (groundAt(x-margin,z,floor)===null || groundAt(x+margin,z,floor)===null ||
        groundAt(x,z-margin,floor)===null || groundAt(x,z+margin,floor)===null) return;
    position.set(x,floor+eye,z);
  }
  for(let i=0;i<pieces;i++) {
    slide(position.x+dx/pieces,position.z);
    slide(position.x,position.z+dz/pieces);
  }
}

export function buildWorld(scene) {
  patchRectAreaEarlyOut();
  RectAreaLightUniformsLib.init();
  scene.background=new THREE.Color(0x888a86);
  const fog=new THREE.FogExp2(0x1f2320, .026);
  scene.fog=fog;
  const hemi=new THREE.HemisphereLight(0xd6dbd4,0x64625a,.86);
  scene.add(hemi);
  const sky=new THREE.DirectionalLight(0xf3f5f0,.46);
  sky.position.set(-4,6,.7);
  scene.add(sky);
  const occluders=[];
  const areaDescriptors=[];
  function addAreaLight(desc) {
    areaDescriptors.push(desc);
  }
  const intakeGroup=new THREE.Group();
  intakeGroup.name='Intake wing and west stair';
  scene.add(intakeGroup);
  const build=construction(intakeGroup,{occluders});
  const {box,rod,add,material,finish}=build;

  // "plane" is the finished interior face. A wall extends outwards from it.
  const depth=.25;
  function slab(axis,plane,out,start,end,bottom,top,kind,thickness=depth) {
    if (top-bottom<.001 || end-start<.001) return;
    const mid=(start+end)/2, h=top-bottom, center=plane+out*thickness/2;
    if (axis==='x') box(center,(top+bottom)/2,mid,thickness,h,end-start,kind);
    else box(mid,(top+bottom)/2,center,end-start,h,thickness,kind);
  }
  function wall(axis,plane,out,from,to,bottom,top,holes=[],kind='plaster') {
    let edge=from;
    for(const [center,width,sill,head] of holes.slice().sort((a,b)=>a[0]-b[0])) {
      const left=center-width/2,right=center+width/2;
      slab(axis,plane,out,edge,left,bottom,top,kind);
      slab(axis,plane,out,left,right,bottom,sill,kind);
      slab(axis,plane,out,left,right,head,top,kind);
      edge=right;
    }
    slab(axis,plane,out,edge,to,bottom,top,kind);
  }

  const glass=daylightGlazing();
  function windowAt(axis,plane,out,center,width,low,high,rows=2,cols=3,power=4.25) {
    const h=high-low, mid=(low+high)/2;
    function placed(u,y,offset) {
      return axis==='x'?[plane+offset*out,y,u]:[u,y,plane+offset*out];
    }
    const frame=(a,b,c,d,offset,thick,kind) => slab(axis,plane+offset*out,out,a,b,c,d,kind,thick);
    const left=center-width/2, right=center+width/2;
    if (axis==='x' && plane===-1.45) windowSill(build,center,width,low);
    else {
      frame(left-.055,right+.055,low-.065,low+.008,-.045,.30,'stairs');
      frame(left-.045,right+.045,low-.081,low-.067,-.02,.27,'door');
    }
    frame(left+.007,left+.030,low+.01,high-.01,.145,.066,'door');
    frame(right-.030,right-.007,low+.01,high-.01,.145,.066,'door');
    frame(left+.012,right-.012,high-.032,high-.007,.145,.066,'door');
    frame(left,right,low,low+.034,.194,.036,'iron');
    frame(left,right,high-.037,high,.194,.036,'iron');
    for(let i=0;i<=cols;i++){
      const u=lerp(left,right,i/cols);
      frame(u-.012,u+.012,low,high,.196,.039,'iron');
    }
    let base=low;
    for(let r=0;r<rows;r++) {
      const frac = rows===2 && r===0 ? .59 : (r+1)/rows;
      const next=low+h*frac;
      for(let c=0;c<cols;c++) {
        const geo=new THREE.PlaneGeometry(width/cols,next-base);
        geo.rotateY(axis==='x'?-out*Math.PI/2:(out>0?Math.PI:0));
        geo.translate(...placed(left+width*(c+.5)/cols,(next+base)/2,.236));
        const uv = geo.attributes.uv;
        for(let i=0;i<uv.count;i++) {
          if((r+c)%2) uv.setX(i,1.-uv.getX(i));
          if(c%2) uv.setY(i,1.-uv.getY(i));
        }
        add(geo,glass);
      }
      if(next<high) frame(left,right,next-.014,next+.014,.197,.036,'iron');
      base=next;
    }
    addAreaLight({
      color:0xeef2fa, intensity:power, width, height:h,
      position:new THREE.Vector3(...placed(center,mid,-.065)),
      target:new THREE.Vector3(...placed(center,mid,-1)),
      minY:low-2.4, maxY:high+2.0, range:18
    });
  }

  // Three cast concrete bays with deep reveals and open, untrimmed doorways.
  const hallWindows=windowCenters.map(c=>[c===0?-.095:c,c===0?2.41:2.60,.93,2.84]);
  wall('x',-1.45,-1,-13,3.5,0,3.10,hallWindows);
  wall('x',1.45,1,-13,3.5,0,3.10,doors.map(c=>[c,doorCutWidth,0,2.23]));
  wall('z',3.5,1,-1.70,1.7,0,3.10);
  wall('z',-13,1,-3.45,2.65,0,3.10,[[0,2.52,0,2.62]],'stairwall');
  box(0,-.10,-4.75,2.9,.2,16.5,'floor');
  box(0,3.18,-4.75,2.90,.16,16.5,'ceiling');
  for(const [c,w,s,h] of hallWindows) windowAt('x',-1.45,-1,c,w,s,h);

  for(const [face,origin,zMin,zMax] of [
    ['entrywall',-.035,doorPhotoExtent(doors[0],1),3.50],
    ['redwall',-6.685,doorPhotoExtent(doors[1],1),doorPhotoExtent(doors[0],-1)]
  ]) {
    const geo=new THREE.PlaneGeometry(zMax-zMin,3.10,10,8);
    geo.rotateY(-Math.PI/2).translate(1.448,1.55,(zMin+zMax)/2);
    const uv=geo.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,geo.attributes.position.getZ(i)-origin,uv.getY(i)*3.1);
    add(geo,material(face));
  }
  for(const [i,z] of doors.entries()) doorway(build,z,4.2+i*9.6,occluders);

  hallWindows.forEach(([center])=>radiator(build,center));
  intakeFixtures(build);
  wallWear(build);

  for(const [i,center] of doors.entries()) {
    const rear = center - 2.5,front=center+2.45;
    box(3.59,-.11,center-.025,3.78,.22,4.95,'floor');
    box(3.59,3.18,center-.025,3.78,.16,4.95,'ceiling');
    for(const [z,out] of [[rear,-1],[front,1]]) wall('z',z,out,1.7,5.48,0,3.1,[],out<0?'stairwall':'plaster');
    const sideWindows=i===0?[[center-.78,1.11,1.01,2.48]]:[[center,1.66,0,2.42]];
    wall('x',5.48,1,rear,front,0,3.1,sideWindows,'plaster');
    if(i===0) windowAt('x',5.48,1,...sideWindows[0],2,2,4.25);
    addAreaLight({
      color:0xd8d3c8, intensity:2.65, width:1.0, height:2.21,
      position:new THREE.Vector3(1.62,1.13,center),
      target:new THREE.Vector3(3.8,1.0,center-.35),
      minY:-.5, maxY:3.4, range:13
    });
  }

  function pendant(x,y,z,drop,shade=true) {
    rod([x,y-.025,z],[x,y+.006,z],.050,'iron');
    rod([x,y-drop,z],[x,y-.015,z],.009,'wire');
    rod([x,y-drop-.045,z],[x,y-drop+.027,z],.03,'iron');
    if(shade) {
      const profile=[[.025,.018],[.05,.012],[.086,-.015],[.146,-.050],[.184,-.088],
        [.197,-.099],[.200,-.107],[.188,-.112],[.141,-.063],[.075,-.033],[.027,-.020]];
      const dome=new THREE.LatheGeometry(profile.map(([r,h])=>new THREE.Vector2(r,h)),32);
      dome.translate(x,y-drop,z);
      add(dome,material('enamel'));
    }
    const bulb=new THREE.SphereGeometry(.039,12,8);
    bulb.scale(1,1.30,1).translate(x,y-drop-.063,z);
    add(bulb,material('bulb'));
  }
  rod([1.26,3.015,3.45],[1.26,3.015,-13.0],.038,'pipe',.038,12);
  rod([1.14,3.045,3.45],[1.14,3.045,-13.0],.024,'pipe');
  rod([-.95,3.074,3.45],[-.95,3.074,-12.9],.010,'wire');
  for(let z=2.75;z> -13;z-=1.80){
    rod([1.26,3.015,z-.035],[1.26,3.015,z+.035],.049,'rust');
    box(1.28,3.059,z,.106,.083,.058,'iron');
    box(-.95,3.071,z,.036,.03,.04,'iron');
  }
  for(const [i,z] of [-.70,-6.12,-11.35].entries()){
    rod([-.95,3.074,z+.27],[-.95,3.063,z],.012,'wire');
    rod([-.95,3.063,z],[.02,3.063,z],.010,'wire');
    pendant(.02,3.10,z,i===2?.35:.405,i!==2);
  }

  // A two-flight open stair turns back over the ground-level access hall.
  const farHole=[-2.0,2.32,2.36,5.25], sideHole=[-15.42,2.15,3.55,5.80];
  wall('z',-19.35,-1,-3.70,2.90,0,6.40,[farHole],'stairwall');
  wall('x',-3.45,-1,-19.35,-13,0,6.40,[sideHole],'stairwall');
  wall('x',2.65,1,-19.35,-13,0,6.40,[],'stairwall');
  wall('z',-13,1,-3.45,2.65,3.1,6.4,[[-.76,1.10,3.2,5.43]],'stairwall');
  windowAt('z',-19.35,-1,...farHole,4,3,6.25);
  windowAt('x',-3.45,-1,...sideHole,2,3,7.25);
  box(-.4,-.115,-16.175,6.1,.23,6.35,'floor');
  box(-.4,6.51,-16.175,6.10,.22,6.35,'ceiling');
  box(-1.725,1.49,-18.60,3.45,.22,1.50,'stairs');
  box(-.4,3.075,-13.8,6.10,.25,1.6,'stairs');
  // Solid treads and a continuous sloping soffit leave real headroom below.
  for(let i=0;i<steps;i++) {
    const z=stairStart-run*(i+.5);
    for (const [x,y,width,dir] of [[-2.59,(i+1)*rise,1.72,1],[-.775,3.20-i*rise,1.55,-1]]) {
      box(x,y-.13,z-dir*.025,width,.26,run-.050,'stairs');
      stairNosing(build,x,y,z+dir*run*.5,width,dir,i+dir*.4);
    }
  }
  const rake=Math.atan2(1.60,stairStart-stairEnd);
  for(const [x,y,w,angle] of [[-2.59,.655,1.72,rake],[-.775,2.255,1.55,-rake]]) {
    const g=new THREE.BoxGeometry(w,.16,Math.hypot(1.6,stairStart-stairEnd));
    g.rotateX(angle).translate(x,y,(stairStart+stairEnd)/2);
    add(g,material('stairs'),true);
  }
  function rail(a,b,count=4) {
    for(let i=0;i<=count;i++){
      const x=lerp(a[0],b[0],i/count), y=lerp(a[1],b[1],i/count),z=lerp(a[2],b[2],i/count);
      box(x,y+.46,z,.035,.925,.035,'iron');
      box(x,y+.013,z,.085,.018,.103,'iron');
      for (const offset of [-.032,.032]) rod([x+.024,y+.016,z+offset],[x+.024,y+.028,z+offset],.008,'rust',.008,6);
    }
    for(const [y,r] of [[.92,.030],[.55,.015],[.24,.014]]) {
      rod([a[0],a[1]+y,a[2]],[b[0],b[1]+y,b[2]],r,'iron',r,14);
    }
  }
  rail([-1.76,.16,stairStart],[-1.76,1.6,stairEnd]);
  rail([-.035,3.2,stairStart],[-.035,1.64,stairEnd]);
  rail([-1.515,3.2,stairStart],[-1.515,1.64,stairEnd]);
  rail([-.035,1.6,stairEnd],[-.035,1.6,-19.31],2);
  rail([.03,3.2,stairStart],[2.61,3.2,stairStart],3);
  rail([-3.41,3.2,stairStart],[-1.56,3.2,stairStart],2);
  pendant(1.55,6.4,-16.52,1.22);
  // Room beyond the upper landing.
  box(-.75,3.106,-11.205,4,.188,3.07,'stairs');
  box(-.75,6.50,-11.205,4,.20,3.07,'ceiling');
  wall('z',-9.67,1,-2.75,1.25,3.2,6.4,[],'door');
  wall('x',-2.75,-1,-12.75,-9.67,3.2,6.4,[],'door');
  wall('x',1.25,1,-12.75,-9.67,3.2,6.4,[[-11.20,1.50,3.2,5.62]],'door');
  finish();
  addDecor(intakeGroup);
  const annex=buildAnnex(scene,occluders,addAreaLight);
  cullHiddenActors(scene,occluders);
  const occluderGrid=buildOccluderGrid(occluders);

  // Fixed pool of 4 RectAreaLights: eliminates 56%-100% of LTC fragment shader
  // evaluations without ever changing NUM_RECT_AREA_LIGHTS or recompiling shaders.
  const AREA_POOL=4;
  const areaPool=[];
  for(let i=0;i<AREA_POOL;i++){
    const l=new THREE.RectAreaLight(0xffffff,0,1,1);
    scene.add(l);
    areaPool.push(l);
  }
  const scored=areaDescriptors.map(desc=>({desc,score:Infinity,gain:0}));
  const [basementGroup,worksGroup,recordsGroup,roofGroup]=annex.groups.floors;
  const eastStairGroup=annex.groups.eastStair;

  const targetFogColor=new THREE.Color(), targetHemiSky=new THREE.Color(), targetHemiGround=new THREE.Color();
  const camPos=new THREE.Vector3();

  function updateVisibility(camera,dt=0,elapsed=0){
    camPos.setFromMatrixPosition(camera.matrixWorld);
    const {x,y,z}=camPos;

    // Conservative floor/wing culling: zero pop-in across every portal and stairwell.
    basementGroup.visible = y < 1.2 || (x > 21.0 && y < 2.6);
    roofGroup.visible = y > 4.4;
    recordsGroup.visible = (y > 1.4 && y < 6.45) || (x > 21.0 && y > 0.5) || (z < -12.4 && y > 0.8 && y < 6.45);
    worksGroup.visible = (y > -1.2 && y < 4.0) || (x > 21.0 && y < 4.6);
    intakeGroup.visible = y > -0.6 && (y < 6.0 || x < 12.5);
    eastStairGroup.visible = x > 4.5 || (Math.abs(z + 7.2) < 2.4 && y < 3.0);

    // Assign up to 4 nearest relevant area lights into the fixed pool.
    for(let i=0;i<scored.length;i++){
      const item=scored[i], d=item.desc;
      if(y<d.minY || y>d.maxY){
        item.score=Infinity; item.gain=0;
      }else{
        const dist=camPos.distanceTo(d.position);
        const fade=1-THREE.MathUtils.smoothstep(dist,d.range*.62,d.range);
        item.gain=fade;
        item.score=fade>0.005 ? dist : Infinity;
      }
    }
    scored.sort((a,b)=>a.score-b.score);
    for(let i=0;i<AREA_POOL;i++){
      const light=areaPool[i], item=scored[i];
      if(item && item.gain>0.005){
        const d=item.desc;
        light.color.setHex(d.color);
        light.intensity=d.intensity*item.gain;
        light.width=d.width; light.height=d.height;
        light.position.copy(d.position);
        light.lookAt(d.target);
      }else{
        light.intensity=0;
      }
    }

    // Zone-tuned gritty atmosphere, ambient fill, and industrial ballast flicker.
    let targetDensity=.026, targetHemiInt=.84, targetSkyInt=.44;
    if(y>6.0){
      targetFogColor.setHex(0x63696c); targetDensity=.017;
      targetHemiSky.setHex(0xcfd6db); targetHemiGround.setHex(0x52524c);
      targetHemiInt=1.06; targetSkyInt=.58;
    }else if(y<-0.4){
      targetFogColor.setHex(0x0c1210); targetDensity=.048;
      targetHemiSky.setHex(0x6e857c); targetHemiGround.setHex(0x212623);
      targetHemiInt=.36; targetSkyInt=.08;
    }else if(y>2.8){
      targetFogColor.setHex(0x1b2022); targetDensity=.031;
      targetHemiSky.setHex(0xb3bec2); targetHemiGround.setHex(0x474a48);
      targetHemiInt=.64; targetSkyInt=.26;
    }else if(x>5.4){
      targetFogColor.setHex(0x191d1a); targetDensity=.029;
      targetHemiSky.setHex(0xc2c7be); targetHemiGround.setHex(0x4c4c44);
      targetHemiInt=.68; targetSkyInt=.28;
    }else{
      targetFogColor.setHex(0x232622); targetDensity=.025;
      targetHemiSky.setHex(0xd4dad2); targetHemiGround.setHex(0x5e5c53);
      targetHemiInt=.84; targetSkyInt=.46;
    }
    const blend=dt>0 ? 1-Math.exp(-dt*3.5) : 1;
    fog.color.lerp(targetFogColor,blend);
    fog.density=THREE.MathUtils.lerp(fog.density,targetDensity,blend);
    hemi.color.lerp(targetHemiSky,blend);
    hemi.groundColor.lerp(targetHemiGround,blend);
    hemi.intensity=THREE.MathUtils.lerp(hemi.intensity,targetHemiInt,blend);
    sky.intensity=THREE.MathUtils.lerp(sky.intensity,targetSkyInt,blend);

    // Subtle dirty 50/60Hz fluorescent ballast hum + occasional failing-tube stutter.
    const hum=1+.018*Math.sin(elapsed*62.8)+.011*Math.sin(elapsed*119.3);
    const cycle=(elapsed*.37)%1;
    const stutter=(cycle>.91 && cycle<.97) ? (.74+.26*Math.sin(elapsed*88)) : 1;
    annex.setFixturePulse(hum*stutter);
  }

  const groundAt=(x,z,feet)=>annex.ground(x,z,feet) ?? originalGround(x,z,feet);
  return {
    spawn:new THREE.Vector3(.04,eye,2.85),yaw:0,occluders,groundAt,motorCamera,
    raycast:occluderGrid.raycast, isOccluded:occluderGrid.isOccluded, updateVisibility,
    targets:[{x:.55,y:0,z:-1.94},{x:3.8,y:0,z:-.80},{x:3.9,y:0,z:-7.2},...annex.targets],
    move:(position,dx,dz)=>move(groundAt,position,dx,dz),
    sector(position){
      return annex.sector(position) ?? (position.z < -12.8 ? 'West stair' :
        position.y > 4 ? 'Upper landing' : position.x > 1.45 ? 'Intake rooms' : 'Intake corridor');
    }
  };
}
