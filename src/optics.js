import * as THREE from 'three';
import { getTextureQuality, onTextureQualityChange, loadQualityTexture, initializeTextureQualityRenderer } from './texture-quality.js';
import { prepareRoofDaylight } from './roof-daylight.js';
import { weaponMotion } from './viewmodel.js';
import { weaponRigFragment } from './weapon-animation.js';
import { airborneDust, fullscreenVertex, makeContactPass, makeInteriorProbe } from './sensor.js';

// The scene is captured in linear light. Sensor clipping, lens aberration,
// bloom and the foreground exposure are applied together in the final pass.
export function makeOptics(renderer) {
  initializeTextureQualityRenderer(renderer);
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    generateMipmaps: true,
    depthBuffer: true,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
  });
  // Multisample the actual silhouettes before distortion. Only allocate the
  // extra HDR/depth samples on higher tiers and on devices supporting both formats.
  const gl=renderer.getContext();
  const colorSamples=gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES);
  const depthSamples=gl.getInternalformatParameter(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,gl.SAMPLES);
  const sampleCount=[2,4].find(samples=>colorSamples.includes(samples)&&depthSamples.includes(samples)) || 0;
  function updateSamples(level){
    const samples=level>=2048 ? sampleCount : 0;
    if(target.samples===samples)return;
    target.dispose();
    target.samples=samples;
  }
  updateSamples(getTextureQuality());
  onTextureQualityChange(updateSamples);
  const probe=makeInteriorProbe(renderer);
  const weapon=weaponMotion();
  const dust=airborneDust();

  const contact=makeContactPass(target.depthTexture,target.texture);
  const flat=new THREE.Camera();
  const quad=new THREE.PlaneGeometry(2,2);
  const meterTargets=[0,1].map(()=>new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false}));
  const meterUniforms={feed:{value:target.texture}, previous:{value:null}, response:{value:1}, lod:{value:6}};
  const meter=new THREE.Scene();
  meter.add(new THREE.Mesh(quad,new THREE.ShaderMaterial({
    uniforms:meterUniforms,depthTest:false,depthWrite:false,vertexShader:fullscreenVertex,
    fragmentShader:`
      uniform sampler2D feed, previous;
      uniform float lod,response;
      float luminance(vec2 uv){return dot(textureLod(feed,uv,lod).rgb,vec3(.2126,.7152,.0722));}
      void main(){
        float measured=log(.035+luminance(vec2(.35,.45)))+log(.035+luminance(vec2(.65,.45)))
                      +log(.035+luminance(vec2(.43,.65)))+log(.035+luminance(vec2(.57,.65)));
        float ev=clamp(pow(.27/exp(measured*.25),.32),.76,1.65);
        float old=texture2D(previous,vec2(.5)).r;
        gl_FragColor=vec4(vec3(mix(old,ev,response)),1.);
      }`
  })));
  const sleeve = loadQualityTexture('art/sleeve.webp');
  sleeve.colorSpace = THREE.SRGBColorSpace;
  const opening=loadQualityTexture('art/opening.webp');
  opening.colorSpace=THREE.SRGBColorSpace;
  const extended=loadQualityTexture('art/extended.webp');
  extended.colorSpace=THREE.SRGBColorSpace;
  const carbine=loadQualityTexture('art/carbine.webp',{colorSpace:THREE.SRGBColorSpace});
  const uniforms = {
    ...weapon.uniforms,carbine:{value:carbine},
    openingPose:{value:0}, opening:{value:opening}, extended:{value:extended}, lift:{value:0}, feed: {value: target.texture}, sleeve: {value:sleeve}, time: {value:0},
    ao:{value:contact.texture}, meter:{value:null}, texel:{value:new THREE.Vector2()},
    playing:{value:0}, movement:{value:new THREE.Vector2()}, damage:{value:0},
    aspect: {value:1}, sway: {value:new THREE.Vector2()}, sleeveLight:{value:1}
  };
  const lens = new THREE.ShaderMaterial({
    uniforms, depthTest:false, depthWrite:false,
    vertexShader: fullscreenVertex,
    fragmentShader:`
      varying vec2 uv0;
      uniform sampler2D feed,sleeve,extended,opening;
      uniform sampler2D ao,meter,carbine;
      uniform float discharge,rifle;
      uniform vec2 muzzleUv;
      uniform float lift,openingPose,playing,damage;
      uniform vec2 movement,texel;
      uniform float time,aspect,sleeveLight;
      uniform vec2 sway;
      ${weaponRigFragment}
      void main(){
        vec2 p=uv0*2.-1.;
        float rr=dot(p,p);
        vec2 lensUV=.5+.5*p*(.865+.067*rr);
        lensUV+=movement*(uv0.y-.5)*.55;
        vec2 shift=.00145*p*rr;
        float softness=.035+1.40*smoothstep(.33,1.64,rr);
        vec3 c=vec3(textureLod(feed,lensUV+shift,softness).r,textureLod(feed,lensUV,softness).g,textureLod(feed,lensUV-shift,softness).b);
        // Integrate the sharpest subpixel edges in the central lens area.
        float lum=dot(c,vec3(.21,.72,.07));
        vec2 gradient=vec2(dFdx(lum),dFdy(lum));
        if(rr<.94 && length(gradient)>.038+.24*lum){
          vec2 axis=normalize(gradient)*texel*.47;
          vec3 filtered=.5*(textureLod(feed,lensUV-axis,0.).rgb+textureLod(feed,lensUV+axis,0.).rgb);
          c=mix(c,filtered,.34);
        }
        if(dot(movement,movement)>.0000002){
          c=c*.62+.23*texture2D(feed,lensUV+movement*.45).rgb+.15*texture2D(feed,lensUV+movement*.92).rgb;
        }
        vec4 localLight=texture2D(ao,lensUV);
        float crease=localLight.a;
        c+=localLight.rgb;
        c*=vec3(crease,mix(crease,1.,.025),mix(crease,1.,.07));
        vec3 halo=.04*textureLod(feed,lensUV,3.).rgb+.07*textureLod(feed,lensUV,5.).rgb+.065*textureLod(feed,lensUV,6.5).rgb;
        c=c*.97+halo+.35*max(textureLod(feed,lensUV,4.5).rgb-.55,0.)+.16*max(textureLod(feed,lensUV,6.25).rgb-.55,0.);
        c*=texture2D(meter,vec2(.5)).r;
        if(playing<.5){
          float sw=.47*620./700./aspect;
          vec2 spriteUV=(uv0-vec2(.5+sway.x/aspect,-.055+sway.y))/vec2(sw,.49);
          vec4 fg=texture2D(sleeve,clamp(spriteUV,0.,1.));
          fg.a*=step(0.,spriteUV.x)*step(0.,spriteUV.y)*step(spriteUV.x,1.)*step(spriteUV.y,1.);
          if(openingPose>.5){
            vec2 openingUV=(uv0-vec2(.5+(-.118+sway.x)/aspect,-.013+sway.y))/vec2(.55/aspect,.38);
            fg=texture2D(opening,clamp(openingUV,0.,1.));
            fg.a*=step(0.,openingUV.x)*step(0.,openingUV.y)*step(openingUV.x,1.)*step(openingUV.y,1.);
          }
          vec2 armUV=(uv0-vec2(.5-.332/aspect+sway.x*.4/aspect,-.016+sway.y*.38-.10*(1.-lift)))/vec2(.847/aspect,.514);
          vec4 arm=texture2D(extended,clamp(armUV,0.,1.));
          arm.a*=step(0.,armUV.x)*step(0.,armUV.y)*step(armUV.x,1.)*step(armUV.y,1.);
          fg.a*=1.-lift;
          c=mix(c,fg.rgb*sleeveLight+min(.015,dot(halo,vec3(.15)))*.3,fg.a);
          c=mix(c,arm.rgb*sleeveLight,arm.a*lift);
        }
        if(playing==1.){
          vec2 d=(uv0-muzzleUv)*vec2(aspect,1.);
          float radial=length(d),angle=atan(d.y,d.x);
          float edges=.52+.24*sin(angle*5.+floor(time*37.)*4.)+.17*cos(angle*7.-time*15.);
          float flare=exp(-radial*radial*11000.)+max(0.,1.-radial/(.032*edges));
          c+=discharge*vec3(4.2,2.15,.76)*flare;
          float shade=clamp(.68+.57*sqrt(max(.0,dot(halo,vec3(.25,.50,.25)))),.68,1.28)*sleeveLight;
          vec3 warm=discharge*vec3(.14,.078,.026)*exp(-20.*radial);
          c=compositeWeapon(c,shade,warm);
        }
        c=mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c,.77)*vec3(1.01,1.,.995);
        c=max(c-.006,0.);
        c=c*(1.+c*.45)/(1.+c);
        vec3 highlights=max(vec3(0.),c-.70);
        c=min(c,.70)+highlights/(1.+.83*highlights);
        c=clamp(pow(c,vec3(1./2.2)),0.,1.);
        c=mix(smoothstep(vec3(.043),vec3(.99),c),c,.14);
        c*=1.-.52*smoothstep(.52,1.95,rr);
        c=mix(c,vec3(.48,.13,.06),damage*smoothstep(.31,1.9,rr)*.45);
        float grain=fract(sin(dot(mod(gl_FragCoord.xy,1024.)+fract(time*13.)*97.,vec2(12.9898,78.233)))*43758.5453)-.5;
        gl_FragColor=vec4(c+grain*.034,1.);
      }`
  });
  const screen = new THREE.Scene();
  screen.add(new THREE.Mesh(quad,lens));
  let previousTime=-1, previousYaw=0, previousPitch=0, meterIndex=0;
  function resize(w,h) {
    target.setSize(w,h);
    contact.resize(w,h);
    uniforms.aspect.value=w/h;
    uniforms.texel.value.set(1/w,1/h);
    dust.uniforms.imageHeight.value=h;
    meterUniforms.lod.value=Math.max(0,Math.log2(Math.min(w,h))-2);
  }
  function render(scene,camera,t,x,y,light,lift,openingPose,gameState=null) {
    prepareRoofDaylight(renderer,scene,camera);
    if(!dust.points.parent){
      scene.add(dust.points,weapon.light);
      if(!scene.environment){
        scene.environment=probe.texture;
        scene.environmentIntensity=.16;
      }
    }
    const dt=previousTime<0?0:Math.max(0,t-previousTime);
    const yawDelta=THREE.MathUtils.euclideanModulo(camera.rotation.y-previousYaw+Math.PI,Math.PI*2)-Math.PI;
    const pitchDelta=camera.rotation.x-previousPitch;
    const validMotion=dt>0 && dt<.20 && Math.abs(yawDelta)+Math.abs(pitchDelta)<.35;
    uniforms.movement.value.set(
      validMotion?THREE.MathUtils.clamp(yawDelta*.22/camera.aspect,-.010,.010):0,
      validMotion?THREE.MathUtils.clamp(pitchDelta*.22,-.010,.010):0
    );
    uniforms.playing.value=gameState?1:gameState===false?2:0;
    uniforms.damage.value=gameState?.damage ?? 0;
    uniforms.openingPose.value=openingPose?1:0;
    uniforms.lift.value=lift;
    uniforms.time.value=t;
    uniforms.sway.value.set(x,y);
    uniforms.sleeveLight.value=light;
    dust.uniforms.clock.value=t;
    weapon.update(camera,gameState,camera.aspect,x,y,t,dt);
    renderer.setRenderTarget(target);
    renderer.render(scene,camera);
    contact.render(renderer,camera);
    const next=1-meterIndex;
    meterUniforms.previous.value=meterTargets[meterIndex].texture;
    meterUniforms.response.value=previousTime<0?1:1-Math.exp(-dt*2.6);
    renderer.setRenderTarget(meterTargets[next]);
    renderer.render(meter,flat);
    uniforms.meter.value=meterTargets[next].texture;
    meterIndex=next;
    renderer.setRenderTarget(null);
    renderer.render(screen,flat);
    previousTime=t; previousYaw=camera.rotation.y; previousPitch=camera.rotation.x;
  }
  return {resize,render};
}
