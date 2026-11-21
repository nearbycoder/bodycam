import * as THREE from 'three';
import {getTextureQuality} from './texture-quality.js';

export const fullscreenVertex = 'varying vec2 uv0; void main(){uv0=uv; gl_Position=vec4(position.xy,0.,1.);}';

// Broad window strips in a dim interior give curved metal a coherent reflection.
// Float radiance preserves the highlight shape on brushed and polished surfaces.
export function makeInteriorProbe(renderer) {
  const w=128, h=64, data=new Float32Array(w*h*4);
  const window=(n,lo,hi,soft)=>THREE.MathUtils.smoothstep(n,lo-soft,lo)*(1-THREE.MathUtils.smoothstep(n,hi,hi+soft));
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const u=(x+.5)/w, v=(y+.5)/h, i=(y*w+x)*4;
    const strip=window(u,.15,.36,.015)*window(v,.46,.72,.02);
    const sash=window(u,.234,.241,.003)+window(v,.61,.619,.003);
    const daylight=strip*(1-.83*Math.min(1,sash));
    const panel=window(u,.64,.74,.016)*window(v,.58,.64,.025);
    const ceiling=.12+.44*THREE.MathUtils.smoothstep(v,.46,.88);
    data[i]=ceiling+daylight*5.4+panel*2.4;
    data[i+1]=ceiling*.98+daylight*5.9+panel*1.4;
    data[i+2]=ceiling*.88+daylight*6.3+panel*.62;
    data[i+3]=1;
  }
  const texture=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.FloatType);
  texture.mapping=THREE.EquirectangularReflectionMapping;
  texture.needsUpdate=true;
  const generator=new THREE.PMREMGenerator(renderer);
  const probe=generator.fromEquirectangular(texture);
  texture.dispose(); generator.dispose();
  return probe;
}

// Evaluate creases against linearised view positions, so the same radius applies
// to a stair tread underfoot and to an alcove at the far end of a corridor.
export function makeContactPass(depth, radiance) {
  const uniforms={
    sceneDepth:{value:depth}, clipping:{value:new THREE.Vector2()}, focal:{value:new THREE.Vector2()},
    invSize:{value:new THREE.Vector2()}, radiance:{value:radiance},
    worldUpInView:{value:new THREE.Vector3(0,1,0)}, reflections:{value:true}
  };
  const shader=new THREE.ShaderMaterial({
    uniforms,depthTest:false,depthWrite:false,vertexShader:fullscreenVertex,
    fragmentShader:`
      varying vec2 uv0;
      uniform sampler2D sceneDepth, radiance;
      uniform vec3 worldUpInView;
      uniform bool reflections;
      uniform vec2 clipping, focal, invSize;
      float depthZ(vec2 uv){
        float d=texture2D(sceneDepth,uv).r;
        return -clipping.x*clipping.y/(clipping.y+d*(clipping.x-clipping.y));
      }
      vec3 positionAt(vec2 uv){
        float z=-depthZ(uv);
        return vec3((uv*2.-1.)*z/focal,-z);
      }
      vec2 projectView(vec3 p) { return .5+.5*focal*p.xy/(-p.z); }
      float aoSample(vec3 p, vec3 n, vec2 radius, mat2 spin, vec2 offset) {
        vec2 tap=uv0+radius*(spin*offset);
        vec3 delta=positionAt(clamp(tap,invSize,1.-invSize))-p;
        float distanceToTap=length(delta);
        float rise=max(0.,dot(n,delta)-.011)/(distanceToTap+.028);
        return rise*(1.-smoothstep(.14,.88,distanceToTap));
      }
      // Reflect only the authored damp patches. A depth crossing locates the
      // surface in the camera image, then bisection refines its reflected edge.
      vec3 reflectedLight(vec3 p, vec3 normal) {
        float wet=1.-textureLod(radiance,uv0,0.).a;
        if(wet<.035 || !reflections || dot(worldUpInView,normal)<.93)return vec3(0.);
        vec3 eye=normalize(p);
        float facing=clamp(dot(-eye,normal),0.,1.);
        vec3 ray=reflect(eye,normal);
        vec3 start=p+normal*.036;
        float previous=.035, stride=.088;
        for(int i=0;i<24;i++){
          float travel=previous+stride;
          vec3 probe=start+ray*travel;
          if(probe.z>=-.09)break;
          vec2 uv=projectView(probe);
          if(any(lessThan(uv,vec2(.002))) || any(greaterThan(uv,vec2(.998))))break;
          float gap=depthZ(uv)-probe.z;
          if(gap>0.){
            float lo=previous,hi=travel;
            for(int j=0;j<4;j++){
              float mid=(lo+hi)*.5;
              vec3 m=start+ray*mid;
              if(depthZ(projectView(m))>m.z)hi=mid;else lo=mid;
            }
            probe=start+ray*hi;
            uv=projectView(probe);
            float error=abs(depthZ(uv)-probe.z);
            if(error>.18+hi*.025)break;
            vec2 border=min(uv,1.-uv);
            float fade=smoothstep(.004,.09,min(border.x,border.y))*(1.-smoothstep(6.,14.,hi));
            float fresnel=.065+.85*pow(1.-facing,4.);
            float blur=.85+1.7*(1.-wet)+.09*hi;
            return min(textureLod(radiance,uv,blur).rgb,vec3(4.))*wet*fade*fresnel;
          }
          previous=travel;
          stride*=1.17;
        }
        return vec3(0.);
      }
      void main(){
        vec3 p=positionAt(uv0);
        if(-p.z>38.){gl_FragColor=vec4(0.,0.,0.,1.);return;}
        vec3 dx=dFdx(p), dy=dFdy(p);
        vec3 rawN=cross(dx,dy);
        float nLen=length(rawN);
        vec3 n=nLen>.000001 ? rawN/nLen : vec3(0.,0.,1.);
        vec2 radius=min(vec2(.095),focal*.34/max(.35,-p.z));
        float rot=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))*6.2831853;
        float cr=cos(rot), sr=sin(rot);
        mat2 spin=mat2(cr,-sr,sr,cr);
        // Unrolled 8-tap Vogel disk (GLSL ES 1.00 / WebGL2 compatible, zero array indexing).
        float occupied=
          aoSample(p,n,radius,spin,vec2(.250,.000))+
          aoSample(p,n,radius,spin,vec2(-.318,.289))+
          aoSample(p,n,radius,spin,vec2(.048,-.556))+
          aoSample(p,n,radius,spin,vec2(.536,.392))+
          aoSample(p,n,radius,spin,vec2(-.747,.077))+
          aoSample(p,n,radius,spin,vec2(.446,-.697))+
          aoSample(p,n,radius,spin,vec2(.242,.866))+
          aoSample(p,n,radius,spin,vec2(-.881,-.402));
        gl_FragColor=vec4(reflectedLight(p,n),clamp(1.-occupied*.29,.40,1.));
      }`
  });
  const scene=new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),shader));
  const target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
  return {
    texture:target.texture,
    render(renderer,camera){
      uniforms.reflections.value=getTextureQuality()>512;
      const e=camera.matrixWorld.elements;
      // Row 1 of mat3(worldFromView) gives world Y component of view-space normal.
      uniforms.worldUpInView.value.set(e[1],e[5],e[9]);
      uniforms.clipping.value.set(camera.near,camera.far);
      uniforms.focal.value.set(camera.projectionMatrix.elements[0],camera.projectionMatrix.elements[5]);
      renderer.setRenderTarget(target);renderer.render(scene,newCamera);
    },
    resize(w,h){
      target.setSize(Math.max(1,Math.ceil(w*.5)),Math.max(1,Math.ceil(h*.5)));
      uniforms.invSize.value.set(1/w,1/h);
    }
  };
}
const newCamera=new THREE.Camera();

export function airborneDust() {
  const count=420, positions=new Float32Array(count*3), phase=new Float32Array(count);
  let seed=193824;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<count;i++){
    for(let j=0;j<3;j++)positions[i*3+j]=random()*8;
    phase[i]=random();
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('variation',new THREE.BufferAttribute(phase,1));
  const uniforms={clock:{value:0},imageHeight:{value:720}};
  const material=new THREE.ShaderMaterial({
    uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`
      attribute float variation;
      varying float alpha;
      uniform float clock, imageHeight;
      void main(){
        vec3 drift=vec3(sin(clock*.21+variation*33.)*.12,clock*(.016+variation*.018),cos(clock*.13+variation*15.)*.13);
        vec3 p=cameraPosition+mod(position+drift-cameraPosition,vec3(8.))-4.;
        vec4 view=viewMatrix*vec4(p,1.);
        gl_Position=projectionMatrix*view;
        float dist=-view.z;
        gl_PointSize=clamp(imageHeight*.0028/(dist+.15),1.,6.);
        float edge=smoothstep(0.,.42,3.97-max(max(abs(p.x-cameraPosition.x),abs(p.y-cameraPosition.y)),abs(p.z-cameraPosition.z)));
        float nearCatch=1.+.9*exp(-dist*.55);
        alpha=(.042+variation*.095)*nearCatch*smoothstep(.16,.55,dist)*edge;
      }`,
    fragmentShader:`
      varying float alpha;
      void main(){
        vec2 xy=gl_PointCoord*2.-1.;
        float radius=dot(xy,xy);
        gl_FragColor=vec4(.88,.87,.81,alpha*exp(-3.1*radius)*(1.-smoothstep(.52,1.,radius)));
      }`
  });
  const points=new THREE.Points(geometry,material);
  points.frustumCulled=false;
  points.name='Suspended dust';
  return {points, uniforms};
}
