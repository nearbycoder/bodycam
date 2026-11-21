import * as THREE from 'three';
import { getTextureQuality, onTextureQualityChange, loadQualityTexture, initializeTextureQualityRenderer } from './texture-quality.js';
import { prepareRoofDaylight } from './roof-daylight.js';
import { LENS_DISTORT, LENS_SCALE, weaponMotion } from './viewmodel.js';
import { weaponRigFragment } from './weapon-animation.js';
import { airborneDust, fullscreenVertex, makeContactPass, makeInteriorProbe } from './sensor.js';

function makeLensDirtTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  let seed = 419273;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

  // Soft greasy finger smudges & outer edge film near the lens dome rim.
  for (let i = 0; i < 42; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = (0.18 + Math.pow(rand(), 0.72) * 0.44) * size;
    const x = size * 0.5 + Math.cos(angle) * dist;
    const y = size * 0.5 + Math.sin(angle) * dist;
    const r = (0.06 + rand() * 0.14) * size;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const peak = 0.06 + rand() * 0.12;
    g.addColorStop(0, `rgba(255,255,255,${peak})`);
    g.addColorStop(0.65, `rgba(255,255,255,${peak * 0.35})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Dried mineral water spots (faint bright rims).
  for (let i = 0; i < 16; i++) {
    const x = rand() * size, y = rand() * size, r = 4 + rand() * 14;
    ctx.strokeStyle = `rgba(255,255,255,${0.08 + rand() * 0.14})`;
    ctx.lineWidth = 1.2 + rand() * 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Fine dust motes stuck on protective glass.
  for (let i = 0; i < 180; i++) {
    const x = rand() * size, y = rand() * size, r = 0.5 + rand() * 1.6;
    ctx.fillStyle = `rgba(255,255,255,${0.12 + rand() * 0.35})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Micro hairline scuffs across the polycarbonate dome.
  for (let i = 0; i < 24; i++) {
    const x = rand() * size, y = rand() * size;
    const len = 10 + rand() * 34, a = rand() * Math.PI * 2;
    ctx.strokeStyle = `rgba(255,255,255,${0.09 + rand() * 0.16})`;
    ctx.lineWidth = 0.6 + rand() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// The scene is captured in linear light. Wide-angle body-camera barrel optics,
// tactical LED fill, dirty glass glare, auto-exposure, 4:2:0 video sharpening,
// harsh CMOS tone mapping and high-ISO shadow noise are combined in one pass.
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
  const meterUniforms={feed:{value:target.texture}, previous:{value:null}, response:{value:1}, lod:{value:6}, flash:{value:0}};
  const meter=new THREE.Scene();
  meter.add(new THREE.Mesh(quad,new THREE.ShaderMaterial({
    uniforms:meterUniforms,depthTest:false,depthWrite:false,vertexShader:fullscreenVertex,
    fragmentShader:`
      uniform sampler2D feed, previous;
      uniform float lod,response,flash;
      float luminance(vec2 uv){return dot(textureLod(feed,uv,lod).rgb,vec3(.2126,.7152,.0722));}
      void main(){
        // Weighted center-field metering like a small-sensor bodycam AGC.
        float measured=log(.025+luminance(vec2(.34,.45)))+log(.025+luminance(vec2(.66,.45)))
                      +log(.025+luminance(vec2(.44,.62)))+log(.025+luminance(vec2(.56,.62)))
                      +1.2*log(.025+luminance(vec2(.50,.50)));
        float avg=exp(measured/5.2)+flash*.55;
        float ev=clamp(pow(.24/avg,.43),.62,2.10);
        float old=texture2D(previous,vec2(.5)).r;
        // Fast exposure duck on bright flashes/windows, slower ISO ramp-up in the dark.
        float rate=ev<old ? min(1.,response*2.3) : response;
        gl_FragColor=vec4(vec3(mix(old,ev,rate)),1.);
      }`
  })));
  const sleeve = loadQualityTexture('art/sleeve.webp');
  sleeve.colorSpace = THREE.SRGBColorSpace;
  const opening=loadQualityTexture('art/opening.webp');
  opening.colorSpace=THREE.SRGBColorSpace;
  const extended=loadQualityTexture('art/extended.webp');
  extended.colorSpace=THREE.SRGBColorSpace;
  const carbine=loadQualityTexture('art/carbine.webp',{colorSpace:THREE.SRGBColorSpace});
  const lensDirt=makeLensDirtTexture();
  const uniforms = {
    ...weapon.uniforms,carbine:{value:carbine},lensDirt:{value:lensDirt},
    openingPose:{value:0}, opening:{value:opening}, extended:{value:extended}, lift:{value:0},
    feed: {value: target.texture}, sceneDepth:{value:target.depthTexture},
    sleeve: {value:sleeve}, time: {value:0},
    ao:{value:contact.texture}, meter:{value:null}, texel:{value:new THREE.Vector2()},
    clipping:{value:new THREE.Vector2(.045,115)}, focal:{value:new THREE.Vector2(1,1)},
    playing:{value:0}, movement:{value:new THREE.Vector2()}, damage:{value:0},
    torch:{value:0}, jolt:{value:0},
    aspect: {value:1}, sway: {value:new THREE.Vector2()}, sleeveLight:{value:1}
  };
  const lens = new THREE.ShaderMaterial({
    uniforms, depthTest:false, depthWrite:false,
    vertexShader: fullscreenVertex,
    fragmentShader:`
      varying vec2 uv0;
      uniform sampler2D feed,sceneDepth,sleeve,extended,opening;
      uniform sampler2D ao,meter,carbine,lensDirt;
      uniform float discharge,rifle;
      uniform vec2 muzzleUv,clipping,focal;
      uniform float lift,openingPose,playing,damage,torch,jolt;
      uniform vec2 movement,texel;
      uniform float time,aspect,sleeveLight;
      uniform vec2 sway;
      ${weaponRigFragment}
      float hash12(vec2 p){
        vec3 q=fract(vec3(p.xyx)*.1031);
        q+=dot(q,q.yzx+33.33);
        return fract((q.x+q.y)*q.z);
      }
      vec3 viewPositionAt(vec2 uv){
        float d=texture2D(sceneDepth,uv).r;
        float z=clipping.x*clipping.y/(clipping.y+d*(clipping.x-clipping.y));
        return vec3((uv*2.-1.)*z/focal,-z);
      }
      void main(){
        vec2 p=uv0*2.-1.;
        float rr=dot(p,p);
        vec2 lensUV=.5+.5*p*(${LENS_SCALE.toFixed(4)}+${LENS_DISTORT.toFixed(4)}*rr);
        // Rolling-shutter vertical shear reacts to whip turns, strides and recoil jolts.
        lensUV+=movement*(uv0.y-.5)*.78;
        // Momentary CMOS horizontal scan-line tear on impact hits.
        float tearMask=0.;
        if(damage>.04){
          float row=floor(uv0.y*58.);
          float glitch=step(.84-damage*.22,hash12(vec2(row,floor(time*26.))));
          tearMask=glitch*damage;
          lensUV.x+=(hash12(vec2(row+17.,floor(time*26.)))-.5)*.024*tearMask;
        }
        vec2 shift=(.00225+jolt*.0014+tearMask*.0032)*p*rr;
        float softness=.03+1.65*smoothstep(.28,1.55,rr);
        vec3 c=vec3(
          textureLod(feed,lensUV+shift,softness).r,
          textureLod(feed,lensUV,softness).g,
          textureLod(feed,lensUV-shift,softness).b
        );
        // 4:2:0 bodycam codec feel + zero-extra-fetch ISP unsharp mask from hardware mip1.
        vec3 softChroma=textureLod(feed,lensUV,max(softness,1.05)).rgb;
        float lum=dot(c,vec3(.2126,.7152,.0722));
        float softLum=dot(softChroma,vec3(.2126,.7152,.0722));
        c=mix(c,softChroma*(lum/max(.001,softLum)),.38);
        float detail=clamp(lum-softLum,-.10,.10)*(1.-smoothstep(.45,1.55,rr));
        c=max(vec3(0.),c+detail*.65);

        // Integrate the sharpest subpixel edges in the central lens area.
        vec2 gradient=vec2(dFdx(lum),dFdy(lum));
        if(rr<.90 && length(gradient)>.044+.26*lum){
          vec2 axis=normalize(gradient)*texel*.45;
          vec3 filtered=.5*(textureLod(feed,lensUV-axis,0.).rgb+textureLod(feed,lensUV+axis,0.).rgb);
          c=mix(c,filtered,.28);
        }
        if(dot(movement,movement)>.0000002){
          c=c*.60+.24*texture2D(feed,lensUV+movement*.50).rgb+.16*texture2D(feed,lensUV+movement*1.05).rgb;
        }
        vec4 localLight=texture2D(ao,lensUV);
        float crease=localLight.a;
        c+=localLight.rgb;
        c*=vec3(crease,mix(crease,1.,.02),mix(crease,1.,.06));

        // Full-res depth-aware off-axis tactical LED illuminator (zero extra scene lights).
        if(torch>.01){
          vec3 vp=viewPositionAt(lensUV);
          vec3 rawN=cross(dFdx(vp),dFdy(vp));
          float nLen=length(rawN);
          vec3 vn=nLen>.000001 ? rawN/nLen : vec3(0.,0.,1.);
          float dist=-vp.z;
          if(dist<19.){
            vec3 lampPos=vec3(.085+sway.x*.18,-.135+sway.y*.16,.04);
            vec3 toFrag=vp-lampPos;
            float d=length(toFrag);
            vec3 dir=toFrag/max(.001,d);
            vec3 aim=normalize(vec3(-sway.x*.55,-sway.y*.42-.025,-1.));
            float cosA=dot(dir,aim);
            float hotspot=smoothstep(.928,.988,cosA);
            float spill=smoothstep(.76,.95,cosA);
            float bezelRing=smoothstep(.79,.83,cosA)*(1.-smoothstep(.83,.87,cosA))*.18;
            float facing=clamp(dot(vn,-dir)*.82+.18,0.,1.);
            float atten=1./(1.+.11*d*d)*(1.-smoothstep(11.,18.5,d));
            float beam=(hotspot*1.45+spill*.62+bezelRing)*facing*atten*crease*torch;
            // Scale existing surface reflectance so textures and grime stay rich,
            // tapering off cleanly on already-bright sunlit windows.
            float sceneLum=dot(c,vec3(.2126,.7152,.0722));
            float darkRoomGain=1./(1.+sceneLum*2.1);
            c*=1.+beam*darkRoomGain*vec3(2.35,2.45,2.62);
            c+=vec3(.011,.012,.0135)*beam*darkRoomGain*(.4+.6*hotspot);
          }
        }

        // Merged optical bloom / halation taps + backlit dirty lens dome glare.
        vec3 mip3=textureLod(feed,lensUV,3.).rgb;
        vec3 mip48=textureLod(feed,lensUV,4.8).rgb;
        vec3 mip63=textureLod(feed,lensUV,6.3).rgb;
        vec3 halo=.042*mip3+.075*mip48+.068*mip63;
        vec3 brightBloom=.38*max(mip48-.48,0.)+.22*max(mip63-.44,0.);
        float dirt=texture2D(lensDirt,uv0).r;
        vec3 glare=brightBloom*(1.+dirt*.85)+halo*dirt*.42;
        c=c*.96+halo*.95+glare;

        float ev=texture2D(meter,vec2(.5)).r;
        c*=ev;

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
          float edges=.50+.26*sin(angle*5.+floor(time*37.)*4.)+.19*cos(angle*7.-time*15.);
          float flare=exp(-radial*radial*9500.)+max(0.,1.-radial/(.038*edges));
          float streak=exp(-abs(d.y)*90.)*exp(-abs(d.x)*11.)*.32;
          c+=discharge*(vec3(4.9,2.45,.88)*flare+vec3(2.4,1.35,.55)*streak);
          // Muzzle flash lights up smudges on the bodycam dome.
          c+=discharge*dirt*vec3(.18,.11,.045)*exp(-radial*4.2);
          float shade=clamp(.60+.58*sqrt(max(.0,dot(halo,vec3(.25,.50,.25)))),.58,1.25)*sleeveLight*(.75+.25*ev);
          vec3 warm=discharge*vec3(.22,.115,.038)*exp(-14.*radial);
          c=compositeWeapon(c,shade,warm);
        }

        // Raw desaturated industrial bodycam CMOS response & split-tone shadow crush.
        float cLum=dot(c,vec3(.2126,.7152,.0722));
        c=mix(vec3(cLum),c,.68);
        // Subtle cold slate-olive shadows, bleached overcast highlights.
        vec3 shadowCast=vec3(.93,.985,.955);
        vec3 highCast=vec3(1.01,1.00,.975);
        c*=mix(shadowCast,highCast,smoothstep(.04,.55,cLum));
        c=max(c-.0085,0.);
        // Harsh small-sensor shoulder clipping (windows blow out starkly).
        c=c*(1.+c*.58)/(1.+c*.96);
        vec3 highlights=max(vec3(0.),c-.66);
        c=min(c,.66)+highlights/(1.+.72*highlights);
        c=clamp(pow(c,vec3(1./2.2)),0.,1.);
        // Gritty S-curve contrast with a slight murky digital black floor.
        c=mix(smoothstep(vec3(.055),vec3(.965),c),c,.16);
        c=c*.986+vec3(.012,.014,.013);

        // Wide-angle recessed bezel vignette (slightly organic & heavier in corners).
        vec2 vp2=p+vec2(.02,-.015);
        float vr=dot(vp2,vp2);
        c*=1.-.62*smoothstep(.40,1.88,vr);
        // Impact bruising + momentary exposure wash.
        c=mix(c,vec3(.44,.09,.04),damage*smoothstep(.24,1.85,vr)*.52);
        c+=tearMask*vec3(.08,.09,.07);

        // High-ISO shadow-weighted CMOS sensor noise (24fps video cadence, luma + chroma speckle + faint row banding).
        float frameTick=floor(time*24.);
        float isoGain=clamp((ev-.72)/.95,.25,1.45);
        float outLum=dot(c,vec3(.2126,.7152,.0722));
        float shadowNoise=mix(1.38,.28,smoothstep(.03,.58,outLum))*isoGain;
        vec2 px=mod(gl_FragCoord.xy,1024.);
        float lumaGrain=hash12(px+vec2(frameTick*19.1,frameTick*73.7))-.5;
        vec2 blockPx=floor(px*.5);
        vec3 chromaGrain=vec3(
          hash12(blockPx+vec2(frameTick*13.7,5.1)),
          hash12(blockPx+vec2(frameTick*29.3,19.7)),
          hash12(blockPx+vec2(frameTick*41.9,37.3))
        )-.5;
        float rowBand=(hash12(vec2(floor(gl_FragCoord.y*.5),frameTick*7.3))-.5)*.014*shadowNoise;
        vec3 sensorNoise=vec3(lumaGrain*.048*shadowNoise)+chromaGrain*.026*shadowNoise+vec3(rowBand);
        gl_FragColor=vec4(clamp(c+sensorNoise,0.,1.),1.);
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
  function render(scene,camera,t,x,y,light,lift,openingPose,gameState=null,torchLevel=0,jolt=0) {
    prepareRoofDaylight(renderer,scene,camera);
    if(!dust.points.parent){
      scene.add(dust.points,weapon.light);
      if(!scene.environment){
        scene.environment=probe.texture;
        scene.environmentIntensity=.14;
      }
    }
    const dt=previousTime<0?0:Math.max(0,t-previousTime);
    const yawDelta=THREE.MathUtils.euclideanModulo(camera.rotation.y-previousYaw+Math.PI,Math.PI*2)-Math.PI;
    const pitchDelta=camera.rotation.x-previousPitch;
    const validMotion=dt>0 && dt<.20 && Math.abs(yawDelta)+Math.abs(pitchDelta)<.38;
    uniforms.movement.value.set(
      validMotion?THREE.MathUtils.clamp(yawDelta*.25/camera.aspect,-.014,.014):0,
      validMotion?THREE.MathUtils.clamp(pitchDelta*.25,-.014,.014):0
    );
    uniforms.playing.value=gameState?1:gameState===false?2:0;
    uniforms.damage.value=gameState?.damage ?? 0;
    uniforms.openingPose.value=openingPose?1:0;
    uniforms.lift.value=lift;
    uniforms.time.value=t;
    uniforms.sway.value.set(x,y);
    uniforms.sleeveLight.value=light;
    uniforms.torch.value=torchLevel;
    uniforms.jolt.value=jolt;
    uniforms.clipping.value.set(camera.near,camera.far);
    uniforms.focal.value.set(camera.projectionMatrix.elements[0],camera.projectionMatrix.elements[5]);
    dust.uniforms.clock.value=t;
    weapon.update(camera,gameState,camera.aspect,x,y,t,dt);
    meterUniforms.flash.value=weapon.uniforms.discharge.value;

    renderer.autoClear=true;
    renderer.setRenderTarget(target);
    renderer.render(scene,camera);

    // Fullscreen passes overwrite every pixel; skip redundant clears.
    renderer.autoClear=false;
    contact.render(renderer,camera);
    const next=1-meterIndex;
    meterUniforms.previous.value=meterTargets[meterIndex].texture;
    meterUniforms.response.value=previousTime<0?1:1-Math.exp(-dt*2.4);
    renderer.setRenderTarget(meterTargets[next]);
    renderer.render(meter,flat);
    uniforms.meter.value=meterTargets[next].texture;
    meterIndex=next;
    renderer.setRenderTarget(null);
    renderer.render(screen,flat);
    renderer.autoClear=true;
    previousTime=t; previousYaw=camera.rotation.y; previousPitch=camera.rotation.x;
  }
  return {resize,render};
}
