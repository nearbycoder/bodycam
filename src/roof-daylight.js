import * as THREE from 'three';
import { getTextureQuality } from './texture-quality.js';

// The brightest break in the photographed cloud bank sits west of the roof.
const toSun = new THREE.Vector3(-.80,.98,.36).normalize();
const roofCenter = new THREE.Vector3(17.1,7.9,-7.08);
const deckBounds = new THREE.Vector4(5.51,-16.01,17.74,17.97);
const bakes = new WeakMap();
const softShadow = `
  uniform highp sampler2DShadow roofDepth;
  uniform mat4 roofProjection;
  float roofShadow(vec3 position,vec3 geometricNormal) {
    vec3 s=(roofProjection*vec4(position+geometricNormal*.019,1.)).xyz*.5+.5;
    if(any(lessThan(s,vec3(0.)))||any(greaterThan(s,vec3(1.)))) return 1.;
    // Move the depth test along the receiver plane with each filter tap.
    vec3 dx=dFdx(s),dy=dFdy(s);
    float det=dx.x*dy.y-dx.y*dy.x;
    vec2 slope=abs(det)>.0000000001 ? vec2(dy.y*dx.z-dx.y*dy.z,dx.x*dy.z-dy.x*dx.z)/det : vec2(0.);
    slope=clamp(slope,-1.75,1.75);
    float visibility=0.;
    const vec2 taps[8]=vec2[](vec2(-.64,-.39),vec2(.17,-.65),vec2(.73,-.33),vec2(-.20,-.15),
      vec2(.21,.18),vec2(-.71,.36),vec2(-.18,.78),vec2(.61,.56));
    for(int i=0;i<8;i++) {
      vec2 offset=taps[i]*.0038;
      visibility+=texture(roofDepth,vec3(s.xy+offset,s.z+dot(slope,offset)-.00042));
    }
    return visibility*.125;
  }
`;

function coat(material, sky, shared) {
  // The print atlas is also used on the interior floors. Its roof batch gets
  // its own material while sharing the tier-managed texture.
  const m=material.clone();
  const previous=material.onBeforeCompile;
  const program=material.customProgramCacheKey();
  m.envMap=sky;
  m.envMapRotation.y=Math.PI;
  m.envMapIntensity=m.metalness>.17 ? 2.15 : 1.24;
  m.onBeforeCompile=(shader,renderer)=>{
    previous.call(m,shader,renderer);
    Object.assign(shader.uniforms,shared);
    shader.vertexShader='varying vec3 roofPosition;\n'+shader.vertexShader.replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nroofPosition=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader=`
      varying vec3 roofPosition;
      uniform sampler2D roofSkyMask;
      uniform vec4 roofDeck;
      uniform vec3 roofSun;
      uniform float roofBaked;
      ${softShadow}
    `+shader.fragmentShader.replace('#include <opaque_fragment>',`
      // Beyond the parapet door, the top storey's stair remains under a lid.
      if(roofPosition.x<23.22 || roofPosition.y>9.55) {
        vec3 wn=inverseTransformDirection(normal,viewMatrix);
        vec3 gn=inverseTransformDirection(nonPerturbedNormal,viewMatrix);
        float direct=1., dome=1.;
        if(roofBaked>.5) {
          direct=roofShadow(roofPosition,gn);
          vec2 uv=(roofPosition.xz-roofDeck.xy)/roofDeck.zw;
          float groundSky=textureLod(roofSkyMask,clamp(uv,0.,1.),1.05).r;
          dome=mix(groundSky,1.,smoothstep(.035,1.65,roofPosition.y-6.40));
        }
        float facing=max(dot(wn,roofSun),0.);
        float overhead=clamp(wn.y*.5+.5,0.,1.);
        vec3 skyColor=mix(vec3(.27,.252,.226),vec3(.97,1.08,1.28),overhead);
        vec3 v=normalize(cameraPosition-roofPosition), h=normalize(v+roofSun);
        float exponent=mix(86.,8.,roughnessFactor);
        float lobe=pow(max(dot(wn,h),0.),exponent)*smoothstep(0.,.16,facing);
        vec3 f0=mix(vec3(.04),diffuseColor.rgb,metalnessFactor);
        // The cloudy dome remains visible in shade, except at true contact.
        outgoingLight*=mix(.52,1.,dome);
        outgoingLight+=diffuseColor.rgb*(skyColor*(.12+.84*dome)+
                       vec3(1.06,1.015,.93)*2.55*facing*direct)*(1.-.65*metalnessFactor);
        outgoingLight+=f0*(1.8+.08*exponent)*lobe*direct;
      }
      #include <opaque_fragment>
    `);
  };
  m.customProgramCacheKey=()=>program+'-roof-daylight';
  return m;
}

export function installRoofDaylight(scene, group, sky) {
  const uniforms={
    roofDepth:{value:null}, roofProjection:{value:new THREE.Matrix4()}, roofSkyMask:{value:null},
    roofDeck:{value:deckBounds}, roofSun:{value:toSun}, roofBaked:{value:0}
  };
  const casters=new THREE.Scene();
  const depthMaterial=new THREE.MeshBasicMaterial({colorWrite:false,side:THREE.DoubleSide});
  for(const mesh of group.children) {
    if(!mesh.isMesh || !mesh.material.isMeshStandardMaterial || mesh.material.transparent)continue;
    mesh.material=coat(mesh.material,sky,uniforms);
    // The batch vertices are already in world coordinates. Geometry storage is shared.
    casters.add(new THREE.Mesh(mesh.geometry,depthMaterial));
  }
  bakes.set(scene,{casters,uniforms,size:0});
}

function bake(renderer,state,low) {
  const {casters,uniforms}=state, size=low?768:1152;
  state.sun?.dispose();state.mask?.dispose();
  const depth=new THREE.DepthTexture(size,size,THREE.UnsignedIntType);
  depth.compareFunction=THREE.LessEqualCompare;
  depth.magFilter=depth.minFilter=THREE.LinearFilter;
  const sun=new THREE.WebGLRenderTarget(size,size,{
    format:THREE.RedFormat,depthTexture:depth,depthBuffer:true,generateMipmaps:false,
  });
  const dec=low?256:384;
  const mask=new THREE.WebGLRenderTarget(dec,dec,{
    depthBuffer:false,format:THREE.RGBAFormat,minFilter:THREE.LinearMipmapLinearFilter,generateMipmaps:false,
  });
  const light=new THREE.OrthographicCamera(-16.5,16.5,16.5,-16.5,.1,60);
  const lightMatrix=uniforms.roofProjection.value;
  function cast(direction) {
    light.position.copy(roofCenter).addScaledVector(direction,28);
    light.lookAt(roofCenter);light.updateMatrixWorld();
    lightMatrix.multiplyMatrices(light.projectionMatrix,light.matrixWorldInverse);
    renderer.setRenderTarget(sun);renderer.clearDepth();renderer.render(casters,light);
  }
  const samples=low?6:11;
  const visibility=new THREE.ShaderMaterial({
    uniforms:{roofDepth:{value:depth},roofProjection:{value:lightMatrix},deck:{value:deckBounds},contribution:{value:1/samples}},
    depthTest:false,depthWrite:false,transparent:true,
    blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,blendEquation:THREE.AddEquation,
    vertexShader:'varying vec2 loc;void main(){loc=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`varying vec2 loc; uniform vec4 deck; uniform float contribution;
      uniform highp sampler2DShadow roofDepth;uniform mat4 roofProjection;
      void main(){
        vec2 pt=deck.xy+loc*deck.zw;
        vec3 c=(roofProjection*vec4(pt.x,6.425,pt.y,1.)).xyz*.5+.5;
        vec3 dx=dFdx(c),dy=dFdy(c);
        float det=dx.x*dy.y-dx.y*dy.x;
        vec2 slope=vec2(dy.y*dx.z-dx.y*dy.z,dx.x*dy.z-dy.x*dx.z)/det;
        float sum=0.;
        for(int i=0;i<8;i++) {
          float a=float(i)*2.39996;
          vec2 offset=vec2(cos(a),sin(a))*sqrt((float(i)+.5)/8.)*.0079;
          sum+=texture(roofDepth,vec3(c.xy+offset,c.z+dot(offset,slope)-.00035));
        }
        gl_FragColor=vec4(vec3(sum*.125*contribution),contribution);
      }`
  });
  const flat=new THREE.Scene(),quad=new THREE.PlaneGeometry(2,2);
  flat.add(new THREE.Mesh(quad,visibility));
  const camera=new THREE.Camera();
  const old=renderer.getRenderTarget(), oldClear=renderer.autoClear;
  const oldColor=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha();
  renderer.autoClear=false;
  try{
    renderer.setRenderTarget(mask);renderer.setClearColor(0,0);renderer.clear(true,false,false);
    for(let i=0;i<samples;i++){
      // Cosine-weighted directions integrate the sky visible around the real
      // plant bases, beneath pipes and inside the parapet in a deck lightmap.
      const a=i*2.399963+.36, horizontal=Math.sqrt((i+.5)/samples);
      cast(new THREE.Vector3(horizontal*Math.cos(a),Math.sqrt(1-horizontal*horizontal),horizontal*Math.sin(a)));
      mask.texture.generateMipmaps=i===samples-1;
      renderer.setRenderTarget(mask);renderer.render(flat,camera);
    }
    cast(toSun);
    uniforms.roofDepth.value=depth;uniforms.roofSkyMask.value=mask.texture;uniforms.roofBaked.value=1;
    state.sun=sun;state.mask=mask;state.size=size;
  }finally{
    renderer.setRenderTarget(old);renderer.setClearColor(oldColor,oldAlpha);renderer.autoClear=oldClear;
    quad.dispose();visibility.dispose();
  }
}

export function prepareRoofDaylight(renderer, scene, camera) {
  const state=bakes.get(scene);
  if(!state || camera.position.y<6.02)return;
  if(state.renderer!==renderer){
    if(state.renderer)state.renderer.domElement.removeEventListener('webglcontextrestored',state.reset);
    state.size=0;state.renderer=renderer;
    state.reset=()=>{state.size=0;state.uniforms.roofBaked.value=0;};
    renderer.domElement.addEventListener('webglcontextrestored',state.reset);
  }
  const low=getTextureQuality()===512;
  if(state.size!==(low?768:1152)) bake(renderer,state,low);
}
