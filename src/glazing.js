import * as THREE from 'three';
import { loadQualityTexture } from './texture-quality.js';

let horizon, dirt;

// The distant yard is anchored outside the building. Head movement changes the
// view through each opening while stains stay fixed on the surface of the glass.
export function daylightGlazing(annex = false) {
  horizon ??= loadQualityTexture('architecture/roof-sky.jpg', {
    colorSpace: THREE.SRGBColorSpace, wrapS: THREE.RepeatWrapping
  });
  dirt ??= loadQualityTexture('architecture/glazing.jpg', {
    colorSpace: THREE.SRGBColorSpace, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping
  });
  const mat = new THREE.MeshBasicMaterial({map: dirt, toneMapped: false});
  mat.onBeforeCompile = shader => {
    shader.uniforms.yard = {value: horizon};
    shader.vertexShader = 'varying vec3 glassPosition;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>', '#include <worldpos_vertex>\nglassPosition=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = 'varying vec3 glassPosition; uniform sampler2D yard;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 direction = normalize(glassPosition-cameraPosition);
      vec3 look = normalize(direction*31.+glassPosition-vec3(12.,4.,-7.));
      vec2 pano = vec2(atan(-look.z,-look.x)*0.15915494+.5,asin(clamp(look.y,-1.,1.))*.31830989+.5);
      vec3 outside = textureLod(yard,pano,1.9).rgb;
      vec3 dirt = texture2D(map,vMapUv).rgb;
      float clarity = ${annex ? '.85' : '.43'};
      vec3 daylight = vec3(.94,1.01,1.07)*(${annex ? '.58' : '.99'}+clarity*(.21+3.6*outside));
      diffuseColor.rgb = daylight*mix(vec3(.58),vec3(1.12),smoothstep(vec3(.19),vec3(.95),dirt));
    `);
  };
  mat.customProgramCacheKey = () => 'daylit-glass-' + annex;
  return mat;
}
