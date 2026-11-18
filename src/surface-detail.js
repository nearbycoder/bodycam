import * as THREE from 'three';
import {loadQualityTexture} from './texture-quality.js';

let plate;
// Pack albedo variation, roughness and displacement into RGB. All painted
// cabinets, machinery and pipes share one GPU allocation per selected tier.
export function weatheredMetal(material) {
  plate ??= loadQualityTexture('details/worn-plate.jpg',{
    colorSpace:THREE.NoColorSpace,wrapS:THREE.RepeatWrapping,wrapT:THREE.RepeatWrapping,
    repeat:[.55,.55],anisotropy:4
  });
  material.map=material.roughnessMap=material.bumpMap=plate;
  material.bumpScale=.016;
  material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <map_fragment>',`
        vec3 coating=texture2D(map,vMapUv).rgb;
        diffuseColor.rgb*=mix(.64,1.45,coating.r);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.21,.19,.15),.30*smoothstep(.74,.96,coating.r));
      `)
      .replace('#include <roughnessmap_fragment>','float roughnessFactor=clamp(roughness*(.45+.84*coating.g),.14,1.);')
      .replace('#include <bumpmap_pars_fragment>',THREE.ShaderChunk.bumpmap_pars_fragment.replaceAll(').x',').b'));
  };
  material.customProgramCacheKey=()=> 'photographic-coating';
  return material;
}
