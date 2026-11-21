import * as THREE from 'three';

const registered = new WeakMap();

export function registerActorBounds(model, bounds, room = null) {
  let scene=model;
  while (scene.parent) scene=scene.parent;
  if (!scene.isScene) return;
  if (!registered.has(scene)) registered.set(scene, []);
  registered.get(scene).push({model, bounds, room});
}

// Every ray from the camera to the actor passes through this rectangle only
// if both projected coordinate intervals lie inside its edges. One complete
// opaque slab must pass the test; the unfilled portions of doors stay visible.
function coverage(eye, bounds, slab) {
  const {axis, across, up, plane} = slab;
  const depth = plane-eye[axis];
  if (Math.abs(depth)<(slab.clearance??.025)) return 0;
  const near = bounds.min[axis]-eye[axis], far = bounds.max[axis]-eye[axis];
  if (depth>0 ? near<=depth : far>=depth) return 0;
  const a=depth/near, b=depth/far;
  function inside(k) {
    const lo=bounds.min[k]-eye[k], hi=bounds.max[k]-eye[k];
    const lower=eye[k]+Math.min(lo*a,lo*b),upper=eye[k]+Math.max(hi*a,hi*b);
    if (lower>slab.min[k] && upper<slab.max[k]) return 2;
    return upper>slab.min[k] && lower<slab.max[k] ? 1 : 0;
  }
  const first=inside(across);
  return first ? Math.min(first,inside(up)) : 0;
}

export function cullHiddenActors(scene, proxies) {
  const slabs = [], eye = new THREE.Vector3(), actorBox = new THREE.Box3();
  for (const proxy of proxies) {
    if (!proxy.userData.solidSlab) continue;
    const size = proxy.scale;
    const axis = size.x<size.y && size.x<size.z ? 'x' : size.y<size.z ? 'y' : 'z';
    const across = axis==='x'?'y':'x', up = axis==='z'?'y':'z';
    if (size[axis]>.6 || size[across]<.72 || size[up]<.72) continue;
    const half = size.clone().multiplyScalar(.5).subScalar(.022);
    slabs.push({axis, across, up, plane:proxy.position[axis],clearance:size[axis]*.5+.10,
      min:proxy.position.clone().sub(half),max:proxy.position.clone().add(half)});
  }
  const previous = scene.onBeforeRender;
  scene.onBeforeRender = function(renderer, world, camera, target) {
    previous.call(this,renderer,world,camera,target);
    const actors = registered.get(scene);
    if (!actors) return;
    eye.setFromMatrixPosition(camera.matrixWorld);
    for (const {model,bounds,room} of actors) {
      // Skip actors whose parent hierarchy is already culled (e.g. distant drones or hidden encounter group).
      let parentVisible = true;
      for (let p = model.parent; p; p = p.parent) {
        if (!p.visible) { parentVisible = false; break; }
      }
      if (!parentVisible) continue;
      actorBox.copy(bounds);
      if (room) {
        if (!room.bounds.containsPoint(eye) && !room.portals.some(slab =>
          Math.abs(eye[slab.axis]-slab.plane)<.025 || coverage(eye,actorBox,slab)>0)) {
          model.visible=false;
          continue;
        }
      } else {
        actorBox.applyMatrix4(model.matrixWorld);
      }
      const rayMinX = Math.min(eye.x, actorBox.min.x), rayMaxX = Math.max(eye.x, actorBox.max.x);
      const rayMinY = Math.min(eye.y, actorBox.min.y), rayMaxY = Math.max(eye.y, actorBox.max.y);
      const rayMinZ = Math.min(eye.z, actorBox.min.z), rayMaxZ = Math.max(eye.z, actorBox.max.z);
      let hidden=false;
      for (let i = 0; i < slabs.length; i++) {
        const slab = slabs[i];
        if (slab.max.y < rayMinY || slab.min.y > rayMaxY ||
            slab.max.x < rayMinX || slab.min.x > rayMaxX ||
            slab.max.z < rayMinZ || slab.min.z > rayMaxZ) continue;
        if (coverage(eye,actorBox,slab)===2) {hidden=true;break;}
      }
      model.visible=!hidden;
    }
  };
}
