import * as THREE from 'three';
import { loadQualityTexture } from './texture-quality.js';

// Dimensions describe the real-world area covered by each rectified photo tile.
const surfaces = {
  entrywall: { size: [3.535, 3.10], roughness: 0.95, bump: 0.025 },
  redwall:   { size: [5.62, 3.10], roughness: 0.95, bump: 0.025 },
  plaster:   { size: [2.8, 2.8], roughness: 0.95, bump: 0.030 },
  stairwall: { size: [2.5, 2.5], roughness: 0.94, bump: 0.038 },
  ceiling:   { size: [2.4, 3.9], roughness: 0.98, bump: 0.045 },
  floor:     { size: [2.2, 2.2], roughness: 0.80, bump: 0.017 },
  stairs:    { size: [1.6, 1.6], roughness: 0.88, bump: 0.018 },
  door:      { size: [1.3, 2.2], roughness: 0.92, bump: 0.024 },
};

const materials = new Map();
function tiledPhoto(name, repeatX, repeatY, colorSpace) {
  return loadQualityTexture('textures/'+name+'.jpg',{
    wrapS:THREE.RepeatWrapping, wrapT:THREE.RepeatWrapping,
    repeat:[repeatX,repeatY], colorSpace, anisotropy:8
  });
}

/** Use normalized geometry UVs with dimensions, or pass meter-scaled UVs directly. */
export function surface(kind, widthMeters = 1, heightMeters = 1) {
  const key = `${kind}|${widthMeters}|${heightMeters}`;
  if (materials.has(key)) return materials.get(key);

  const spec = surfaces[kind];
  if (!spec) throw new Error(`Unknown architectural surface "${kind}"`);
  const repeatX = widthMeters / spec.size[0];
  const repeatY = heightMeters / spec.size[1];
  const map = tiledPhoto(kind, repeatX, repeatY, THREE.SRGBColorSpace);
  const Material = kind === 'floor' ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const material = new Material({
    name: kind,
    map,
    bumpMap: map,
    bumpScale: spec.bump,
    roughness: spec.roughness,
    roughnessMap: kind === 'floor'
      ? tiledPhoto('floor-roughness', repeatX, repeatY, THREE.NoColorSpace)
      : null,
  });
  if (kind === 'floor') {
    // The roughness image places broken highlights in wet patches between rubble.
    material.clearcoat = .38;
    material.clearcoatRoughness = .24;
    material.clearcoatRoughnessMap = material.roughnessMap;
    material.ior = 1.38;
  }
  materials.set(key, material);
  return material;
}
