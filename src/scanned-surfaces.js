import * as THREE from 'three';
import {loadQualityTexture} from './texture-quality.js';

const finishes = new Map();
const repeats = {floor: .34, wall: .26, bitumen: .10};
let sky;

// XY encodes the scan's tangent-space normal. Blue holds the matching measured
// roughness. The same two GPU textures serve the whole building at each tier.
function finish(surface) {
  if (!finishes.has(surface)) {
    const repeat = repeats[surface];
    const options = {wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, repeat: [repeat,repeat], anisotropy: 8};
    finishes.set(surface, {
      map: loadQualityTexture('surveys/'+surface+'.jpg', {...options, colorSpace: THREE.SRGBColorSpace}),
      normalMap: loadQualityTexture('surveys/'+surface+'-normal.jpg', options)
    });
  }
  return finishes.get(surface);
}

export function fitScannedSurface(material, type) {
  const scan=finish(type==='plaster' ? 'wall' : type);
  if(type!=='plaster')material.map=scan.map;
  material.normalMap=scan.normalMap;
  material.bumpMap=material.roughnessMap=null;
  material.normalScale.setScalar(type==='floor' ? .90 : .72);
  if(material.isMeshPhysicalMaterial){
    material.clearcoat=0;
    material.clearcoatRoughnessMap=null;
  }
}

const variation = `
  float jointNoise(vec2 p) {
    vec2 i=floor(p), f=fract(p);
    f=f*f*(3.-2.*f);
    vec4 corners=vec4(dot(i,vec2(127.1,311.7)))+vec4(0.,127.1,311.7,438.8);
    vec4 samples=fract(sin(corners)*43758.5453);
    return mix(mix(samples.x,samples.y,f.x),mix(samples.z,samples.w,f.x),f.y);
  }
`;

export function shadeScannedSurface(shader,type) {
  const plaster=type==='plaster', roof=type==='bitumen', deck=type==='floor'||roof;
  shader.fragmentShader=variation+shader.fragmentShader;
  if(plaster){
    shader.uniforms.exposedConcrete={value:finish('wall').map};
    shader.fragmentShader='uniform sampler2D exposedConcrete;\n'+shader.fragmentShader;
  }
  if(roof){
    sky??=loadQualityTexture('architecture/roof-sky.jpg',{
      colorSpace:THREE.SRGBColorSpace, wrapS:THREE.RepeatWrapping
    });
    shader.uniforms.cloudCover={value:sky};
    shader.fragmentShader='uniform sampler2D cloudCover;\n'+shader.fragmentShader;
  }
  shader.fragmentShader=shader.fragmentShader
    .replace('#include <roughnessmap_fragment>', `
      vec3 survey=texture2D(normalMap,vNormalMapUv).rgb;
      float roughnessFactor=clamp(.08+survey.b*.94,.18,1.);
      ${plaster ? `
        // Exposed substrate follows water damage and interrupts the painted band.
        vec2 wallUV=vec2(p.x+p.z*.91+storey*4.,height);
        float leak=jointNoise(vec2(wallUV.x*.63,13.2))*jointNoise(vec2(wallUV.x*2.6,storey));
        float water=.35*(1.-smoothstep(.08,.94,height))+.18*smoothstep(2.,2.92,height)+leak*.52;
        float loss=water+.35*jointNoise(wallUV*vec2(1.7,1.18))+.16*jointNoise(wallUV*12.)+.35*(survey.b-.5);
        float chipped=smoothstep(.62,.70,loss);
        vec3 substrate=texture2D(exposedConcrete,vNormalMapUv).rgb;
        diffuseColor.rgb=mix(diffuseColor.rgb,substrate*vec3(.77,.81,.83),chipped*.93);
        roughnessFactor=mix(.89,roughnessFactor,chipped);
      ` : ''}
      ${deck ? `
        vec2 uvWet=p.xz+vec2(storey*1.7,storey*.49);
        float water=.59*jointNoise(uvWet*.60)+.22*jointNoise(uvWet*1.73)+.11*jointNoise(uvWet*4.6);
        float wet=smoothstep(.49,.67,water+.46*(.52-survey.b))*step(abs(height),.045);
        diffuseColor.rgb*=1.-wet*.27;
        roughnessFactor=mix(roughnessFactor,.12,wet*.94);` : ''}
    `)
    .replace('#include <normal_fragment_maps>', `
      vec2 xy=(survey.rg*2.-1.)*normalScale${deck ? '*(1.-wet*.88)' : plaster ? '*(.46+.63*chipped)' : ''};
      normal=normalize(tbn*vec3(xy,sqrt(max(.001,1.-dot(xy,xy)))));
    `);
  if(deck)shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
    ${roof ? `
      vec3 nWorld=inverseTransformDirection(normal,viewMatrix);
      vec3 incident=normalize(p-cameraPosition);
      vec3 skyRay=reflect(incident,nWorld);
      vec2 skyUv=vec2(atan(-skyRay.z,-skyRay.x)*.15915494+.5,asin(clamp(skyRay.y,-1.,1.))*.31830989+.5);
      float fresnel=.045+.52*pow(1.-max(0.,dot(nWorld,-incident)),4.);
      outgoingLight+=wet*fresnel*textureLod(cloudCover,skyUv,2.+roughnessFactor*4.).rgb;
    ` : ''}
    #include <opaque_fragment>
    gl_FragColor.a=1.-wet*.88;
  `);
}
