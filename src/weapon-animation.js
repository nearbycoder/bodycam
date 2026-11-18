import * as THREE from 'three';
import { loadQualityTexture } from './texture-quality.js';

const clamp=THREE.MathUtils.clamp;
const sat=x=>clamp(x,0,1);
const smooth=(a,b,t)=>THREE.MathUtils.smootherstep(t,a,b);
const mix=THREE.MathUtils.lerp;
const ratio={pistol:620/700,carbine:1.5};

// The painted regions follow the silhouettes on the 1536 x 1024 plate. Red is
// the support arm, green the removable prop, blue the small metal area the
// glove normally hides. Vector outlines keep the contact edges at source scale.
function segmentation() {
  const canvas=document.createElement('canvas');
  canvas.width=1536;canvas.height=1024;
  const ctx=canvas.getContext('2d');
  ctx.scale(1536/600,1024/400);
  ctx.fillStyle='#000';ctx.fillRect(0,0,600,400);
  ctx.globalCompositeOperation='lighter';
  function shape(color,points){
    ctx.fillStyle=color;ctx.beginPath();
    for(let i=0;i<points.length;i+=2){
      if(i===0)ctx.moveTo(points[i],points[i+1]);else ctx.lineTo(points[i],points[i+1]);
    }
    ctx.closePath();ctx.fill();
  }
  shape('#f00',[-5,405,-5,86,95,94,127,103,140,104,147,95,148,89,148,82,152,75,156,67,164,61,171,61,178,64,183,69,184,77,182,85,187,94,188,103,194,112,198,124,203,134,205,143,204,151,208,164,207,180,210,196,208,203,198,218,195,237,193,251,186,277,187,306,182,342,177,406]);
  shape('#0f0',[208,201,219,210,229,216,242,220,247,224,245,247,242,266,238,296,236,327,238,348,205,350,184,316,187,296,191,274,196,247,201,224]);
  shape('#00f',[138,66,161,69,187,77,206,85,213,106,211,129,194,135,185,125,160,117,139,106,124,94]);
  const map=new THREE.CanvasTexture(canvas);
  map.generateMipmaps=true;map.anisotropy=4;
  return map;
}

// Screen coordinates are measured in viewport heights around the bottom centre.
// A parametric plate can turn about the grip without rotating the sleeve around
// a billboard corner. The two shear terms add foreshortening as the wrist rolls.
function pose(matrix,x,y,width,height,r,px,py,side=0) {
  const c=Math.cos(r),s=Math.sin(r);
  const ax=width*c,ay=width*s,bx=height*(side*c-s),by=height*(side*s+c);
  return matrix.set(ax,bx,x-px*ax-py*bx,ay,by,y-px*ay-py*by,0,0,1);
}
function afterRoot(out,root,fromU,fromV,dx,dy,angle,sx,sy) {
  const a=root.elements;
  const x=a[0]*fromU+a[3]*fromV+a[6],y=a[1]*fromU+a[4]*fromV+a[7];
  const c=Math.cos(angle),s=Math.sin(angle);
  return out.set(
    (a[0]*c-a[1]*s)*sx,(a[3]*c-a[4]*s)*sy,
    x+dx-(a[0]*c-a[1]*s)*sx*fromU-(a[3]*c-a[4]*s)*sy*fromV,
    (a[0]*s+a[1]*c)*sx,(a[3]*s+a[4]*c)*sy,
    y+dy-(a[0]*s+a[1]*c)*sx*fromU-(a[3]*s+a[4]*c)*sy*fromV,
    0,0,1);
}
function point(m,u,v,target) {
  const e=m.elements;return target.set(e[0]*u+e[3]*v+e[6],e[1]*u+e[4]*v+e[7]);
}
function uniformsMatrix(){return {value:new THREE.Matrix3()};}

export function createWeaponAnimation() {
  const lighting={colorSpace:THREE.SRGBColorSpace,anisotropy:8};
  const uniforms={
    heldInv:uniformsMatrix(), supportInv:uniformsMatrix(), loosedInv:uniformsMatrix(),
    spareInv:uniformsMatrix(), handInv:uniformsMatrix(),
    partsMap:{value:segmentation()},
    gripMap:{value:loadQualityTexture('art/left-grip.webp',lighting)},
    fingersMap:{value:loadQualityTexture('art/left-fingers.webp',lighting)},
    reloadPhase:{value:-1},wristBend:{value:0},
    rifle:{value:0},discharge:{value:0},muzzleUv:{value:new THREE.Vector2()}
  };
  const root=new THREE.Matrix3(),support=new THREE.Matrix3(),loosed=new THREE.Matrix3();
  const spare=new THREE.Matrix3(),hand=new THREE.Matrix3(),socket=new THREE.Vector2(),palm=new THREE.Vector2();
  const magU=.363,magV=.308;
  let horizontal=0,vertical=0,shoulder=0,elbow=0,previousWeapon='',draw=0;
  function update(camera,state,aspect,sway,bob,t,dt) {
    const long=state.weapon==='carbine', action=state.motion??{};
    const focus=sat(action.focus??((82-camera.fov)/22));
    const sprint=sat(action.sprint??0),turn=clamp(action.turn??0,-1,1);
    const side=clamp(action.tilt??0,-1,1),land=sat(action.landing??0);
    const acceleration=clamp(action.acceleration??0,-1,1);
    const kick=sat(state.recoil??state.flash??0),p=state.charging?sat(state.chargeProgress):0;
    const reframe=smooth(0,.22,p)*(1-smooth(.80,1,p));
    const grab=smooth(.10,.30,p)*(1-smooth(.84,.998,p));
    if(previousWeapon!==state.weapon){
      draw=(state.swapPhase==='draw'?0:1);
      previousWeapon=state.weapon;horizontal=vertical=shoulder=elbow=0;
    }
    draw=Math.max(0,draw-dt*4.5);
    const swap=state.swapPhase==='holster'?smooth(0,1,state.swapProgress):state.swapPhase==='draw'?1-smooth(0,1,state.swapProgress):draw;
    const damping=long?10:15;
    horizontal=THREE.MathUtils.damp(horizontal,sway*(1-focus*.67)+turn*.015,damping,dt);
    vertical=THREE.MathUtils.damp(vertical,bob*(1-focus*.72)-.014*land+.006*acceleration,damping,dt);
    shoulder=THREE.MathUtils.damp(shoulder,side*.027+horizontal*.58,8,dt);
    elbow=THREE.MathUtils.damp(elbow,turn*.020+vertical*.53,6,dt);

    const h=long?mix(.638,.68,focus):mix(.50,.515,focus);
    const px=long?.67:.42, py=long?.22:.32;
    const w=h*(long?ratio.carbine:ratio.pistol)*(1-(long?.13:.05)*focus);
    let x=long?mix(.001+px*.638*1.5,.49,focus):mix(-.035+px*.50*ratio.pistol,.035,focus);
    let y=long?mix(-.15+py*.638,.016,focus):mix(-.055+py*.50,.159,focus);
    let angle=long?-.061*focus:-.265*focus;
    x+=horizontal + (long?-.13:.085)*reframe + .044*sprint+.10*swap;
    y+=vertical + (long?.077:.033)*reframe - .071*sprint-.92*swap + (long?.021:.033)*kick;
    angle+=shoulder + (long?-.35:-.43)*reframe + (.085*sprint+.44*swap) - (long?.044:.082)*kick;
    const ready=1-.34*reframe;
    pose(root,x,y,w*(1-.09*reframe),h*(1+.025*reframe),angle,px,py,(long?-.075:.085)*reframe);
    uniforms.heldInv.value.copy(root).invert();

    // The original photo hand arcs out of sight. Its return leads the gun
    // slightly as the arms settle together. No colour crossfade is involved.
    afterRoot(support,root,.273,.76,-.16*grab,-.94*grab,grab*.52+elbow*ready,1,1);
    uniforms.supportInv.value.copy(support).invert();

    if(long)point(root,magU,magV,socket);else point(root,.19,.44,socket);
    const magWidth=long?w:.57,magHeight=long?h:.445;
    const magAngle=long?angle:angle-.21;
    const fall=sat((p-.40)/.24);
    const exposed=long?0:smooth(.32,.49,p)*.145;
    const fallX=-.065*fall-.07*fall*fall-exposed,fallY=-.04*fall-.87*fall*fall;
    if(long){
      afterRoot(loosed,root,magU,magV,fallX,fallY,fall*.81,1,1);
    }else{
      pose(loosed,socket.x+fallX,socket.y+fallY,magWidth,magHeight,magAngle+fall*.91,magU,magV);
    }
    uniforms.loosedInv.value.copy(loosed).invert();

    // Both props cross the lower boundary of the frame. The replacement comes
    // in on an independent curved path, carried between palm and fingertips.
    const rise=smooth(.56,.78,p);
    const approach=1-rise;
    const easeSide=Math.sin(Math.PI*rise);
    const shiftX=-.25*approach-(long?.10:.22)*easeSide,shiftY=-.80*approach+.024*easeSide;
    if(long){
      afterRoot(spare,root,magU,magV,shiftX,shiftY,.29*approach-.12*easeSide,1,1);
    }else{
      pose(spare,socket.x+shiftX,socket.y+shiftY,magWidth,magHeight,magAngle+.29*approach-.12*easeSide,magU,magV);
    }
    uniforms.spareInv.value.copy(spare).invert();
    // The independent glove enters twice, first catching the loose piece, then
    // bringing its replacement into frame. Between passes it is fully offscreen.
    const exit=smooth(.81,.95,p);
    if(p<.56){
      // Once released, the empty prop continues falling independently.
      palm.copy(socket);
      const lower=smooth(.405,.55,p);
      palm.x-=.23*lower;palm.y-=.74*lower;
      palm.x-=.012+exposed*.78;palm.y-=.030;
      const reach=1-smooth(.17,.37,p);
      palm.x-=.25*reach;palm.y-=.88*reach;
    } else {
      point(spare,magU,magV,palm);
      palm.x-=.015+.24*exit;palm.y-=.023+.85*exit;
    }
    const handSize=long?.265:.227;
    const wristAngle=long?.48:.60;
    const flick=p<.56?fall:approach;
    pose(hand,palm.x,palm.y,handSize*1.5,handSize,wristAngle+flick*.12-exit*.15,.80,.67);
    uniforms.handInv.value.copy(hand).invert();
    uniforms.wristBend.value=(Math.sin(Math.PI*rise)*.18+.16*exit+elbow)*grab;
    uniforms.reloadPhase.value=state.charging?p:-1;
    uniforms.rifle.value=long?1:0;
    uniforms.discharge.value=THREE.MathUtils.smoothstep(state.flash??0,.65,.99);
    point(root,long?.109:.303,long?.876:.956,uniforms.muzzleUv.value);
    uniforms.muzzleUv.value.x=.5+uniforms.muzzleUv.value.x/aspect;
  }
  return {uniforms,update};
}

// Sampling the original plate through independent inverse bone transforms keeps
// the photographic fabric grain attached to the wrist as it bends.
export const weaponRigFragment=`
uniform mat3 heldInv,supportInv,loosedInv,spareInv,handInv;
uniform sampler2D partsMap,gripMap,fingersMap;
uniform float reloadPhase,wristBend;
vec4 samplePlate(sampler2D photo,vec2 uv){
  vec4 p=texture2D(photo,clamp(uv,0.,1.));
  p.a*=step(0.,uv.x)*step(0.,uv.y)*step(uv.x,1.)*step(uv.y,1.);
  return p;
}
vec4 heldPlate(sampler2D tex,vec2 uv){
  if(uv.y>=0.)return samplePlate(tex,uv);
  float extension=-uv.y;
  uv.x-=extension*.62;
  if(rifle>.5 && uv.x<.54)return vec4(0.);
  uv.y=.15*(1.-exp(-extension*2.1));
  vec4 p=samplePlate(tex,uv);
  p.rgb*=1.-.14*smoothstep(0.,.5,extension);
  return p;
}
vec4 magPlate(vec2 uv){
  vec4 p=samplePlate(carbine,uv);
  p.a*=texture2D(partsMap,clamp(uv,0.,1.)).g;
  float detached=smoothstep(.355,.46,reloadPhase)*(1.-smoothstep(.78,.86,reloadPhase));
  p.rgb=mix(p.rgb,pow(max(p.rgb,vec3(0.)),vec3(.79))*1.2+vec3(.003,.004,.005),detached);
  return p;
}
vec4 glovePlate(sampler2D tex,vec2 uv){
  // Carry the short photographed cuff down to the edge of frame along the
  // forearm axis. A smooth wrist bend leaves the grasp undistorted.
  float bend=max(.0,.61-uv.x);
  uv.y-=wristBend*bend*bend;
  float tail=max(0.,max(-uv.x/.84,-uv.y/.86));
  uv+=tail*vec2(.84,.86);
  uv+=vec2(.84,.86)*.11*(1.-exp(-tail*1.5));
  vec4 p=samplePlate(tex,uv);
  p.rgb=pow(max(p.rgb,vec3(0.)),vec3(.91))*(1.-.20*smoothstep(.0,.65,tail));
  return p;
}
vec3 overPlate(vec3 behind,vec4 p,vec3 illum){
  return mix(behind,p.rgb*illum,p.a);
}
vec3 compositeWeapon(vec3 background,float shade,vec3 warmth){
  vec3 q=vec3((uv0.x-.5)*aspect,uv0.y,1.);
  vec2 huv=(heldInv*q).xy;
  bool longGun=rifle>.5, action=reloadPhase>=0.;
  vec3 tint=vec3(shade);
  vec4 base=longGun?heldPlate(carbine,huv):heldPlate(sleeve,huv);
  if(!action){return mix(background,base.rgb*shade+warmth,base.a);}
  bool inHand=reloadPhase>.13 && reloadPhase<.96;
  vec3 c=background;
  vec2 gripUV=(handInv*q).xy;
  vec4 hand=glovePlate(gripMap,gripUV), fingers=glovePlate(fingersMap,gripUV);
  vec4 empty=magPlate((loosedInv*q).xy);
  vec4 fresh=magPlate((spareInv*q).xy);
  vec4 passing=reloadPhase<.55?empty:fresh;
  if(!longGun){
    // The grip naturally occludes the prop when it settles into the silhouette.
    if(inHand)c=overPlate(c,hand,tint);
    c=overPlate(c,passing,tint);
    c=overPlate(c,base,tint);
    if(inHand)c=overPlate(c,fingers,tint);
    return c;
  }
  vec3 cut=texture2D(partsMap,clamp(huv,0.,1.)).rgb;
  vec4 under=samplePlate(carbine,huv+vec2(-.065,.031));
  under.a*=cut.b*smoothstep(.00,.14,reloadPhase)*(1.-smoothstep(.91,1.,reloadPhase));
  c=overPlate(c,under,tint);
  base.a*=1.-max(cut.r,cut.g);
  c=overPlate(c,base,tint);
  vec2 auv=(supportInv*q).xy;
  vec4 support=samplePlate(carbine,auv);
  support.a*=texture2D(partsMap,clamp(auv,0.,1.)).r;
  c=overPlate(c,support,tint);
  if(inHand)c=overPlate(c,hand,tint);
  c=overPlate(c,passing,tint);
  if(inHand)c=overPlate(c,fingers,tint);
  return c;
}
`;
