import * as THREE from 'three';

const MIN_T = 0.012;
const EPS = 1e-9;

// Fast 3D uniform-grid analytical raycaster for architectural boxes, rotated
// vehicle proxies, and cylindrical tanks. Eliminates Three.js triangle raycasts
// and per-ray GC allocations during combat and drone line-of-sight scans.
export function buildOccluderGrid(occluders, cellSize = 2.0) {
  const count = occluders.length;
  // Compact SoA storage: 8 floats per primitive + 1 byte type.
  // Type 0 (AABB):     [minX, minY, minZ, maxX, maxY, maxZ, 0, 0]
  // Type 1 (OBB_Y):    [cx, cy, cz, hx, hy, hz, cosY, sinY]
  // Type 2 (CYLINDER): [cx, minY, cz, maxY, rSq, 0, 0, 0]
  const types = new Uint8Array(count);
  const data = new Float32Array(count * 8);
  const bounds = new Float32Array(count * 6);

  const box3 = new THREE.Box3();
  let gMinX = Infinity, gMinY = Infinity, gMinZ = Infinity;
  let gMaxX = -Infinity, gMaxY = -Infinity, gMaxZ = -Infinity;

  for (let i = 0; i < count; i++) {
    const mesh = occluders[i];
    const geom = mesh.geometry;
    if (!geom.boundingBox) geom.computeBoundingBox();
    box3.copy(geom.boundingBox).applyMatrix4(mesh.matrixWorld);
    const bi = i * 6, di = i * 8;
    bounds[bi] = box3.min.x; bounds[bi + 1] = box3.min.y; bounds[bi + 2] = box3.min.z;
    bounds[bi + 3] = box3.max.x; bounds[bi + 4] = box3.max.y; bounds[bi + 5] = box3.max.z;
    if (box3.min.x < gMinX) gMinX = box3.min.x;
    if (box3.min.y < gMinY) gMinY = box3.min.y;
    if (box3.min.z < gMinZ) gMinZ = box3.min.z;
    if (box3.max.x > gMaxX) gMaxX = box3.max.x;
    if (box3.max.y > gMaxY) gMaxY = box3.max.y;
    if (box3.max.z > gMaxZ) gMaxZ = box3.max.z;

    if (geom.type === 'CylinderGeometry') {
      const r = (box3.max.x - box3.min.x) * 0.5;
      types[i] = 2;
      data[di] = (box3.min.x + box3.max.x) * 0.5;
      data[di + 1] = box3.min.y;
      data[di + 2] = (box3.min.z + box3.max.z) * 0.5;
      data[di + 3] = box3.max.y;
      data[di + 4] = r * r;
    } else {
      const yaw = mesh.rotation.y || 0;
      const sinY = Math.sin(yaw);
      if (Math.abs(sinY) > 1e-4) {
        const cosY = Math.cos(yaw);
        const bb = geom.boundingBox;
        const hx = (bb.max.x - bb.min.x) * 0.5 * Math.abs(mesh.scale.x);
        const hy = (bb.max.y - bb.min.y) * 0.5 * Math.abs(mesh.scale.y);
        const hz = (bb.max.z - bb.min.z) * 0.5 * Math.abs(mesh.scale.z);
        types[i] = 1;
        data[di] = mesh.position.x;
        data[di + 1] = mesh.position.y;
        data[di + 2] = mesh.position.z;
        data[di + 3] = hx;
        data[di + 4] = hy;
        data[di + 5] = hz;
        data[di + 6] = cosY;
        data[di + 7] = sinY;
      } else {
        types[i] = 0;
        data[di] = box3.min.x; data[di + 1] = box3.min.y; data[di + 2] = box3.min.z;
        data[di + 3] = box3.max.x; data[di + 4] = box3.max.y; data[di + 5] = box3.max.z;
      }
    }
  }

  gMinX -= 0.1; gMinY -= 0.1; gMinZ -= 0.1;
  gMaxX += 0.1; gMaxY += 0.1; gMaxZ += 0.1;
  const invCell = 1 / cellSize;
  const nx = Math.max(1, Math.ceil((gMaxX - gMinX) * invCell));
  const ny = Math.max(1, Math.ceil((gMaxY - gMinY) * invCell));
  const nz = Math.max(1, Math.ceil((gMaxZ - gMinZ) * invCell));
  const xy = nx * ny;
  const cellCount = xy * nz;

  const counts = new Int32Array(cellCount);
  let totalEntries = 0;
  for (let i = 0; i < count; i++) {
    const bi = i * 6;
    const x0 = Math.max(0, Math.min(nx - 1, Math.floor((bounds[bi] - gMinX) * invCell)));
    const y0 = Math.max(0, Math.min(ny - 1, Math.floor((bounds[bi + 1] - gMinY) * invCell)));
    const z0 = Math.max(0, Math.min(nz - 1, Math.floor((bounds[bi + 2] - gMinZ) * invCell)));
    const x1 = Math.max(0, Math.min(nx - 1, Math.floor((bounds[bi + 3] - gMinX) * invCell)));
    const y1 = Math.max(0, Math.min(ny - 1, Math.floor((bounds[bi + 4] - gMinY) * invCell)));
    const z1 = Math.max(0, Math.min(nz - 1, Math.floor((bounds[bi + 5] - gMinZ) * invCell)));
    for (let z = z0; z <= z1; z++) {
      const zOff = z * xy;
      for (let y = y0; y <= y1; y++) {
        const yOff = zOff + y * nx;
        for (let x = x0; x <= x1; x++) {
          counts[yOff + x]++;
          totalEntries++;
        }
      }
    }
  }

  const offsets = new Int32Array(cellCount + 1);
  for (let i = 0; i < cellCount; i++) offsets[i + 1] = offsets[i] + counts[i];
  const entries = new Int32Array(totalEntries);
  const cursor = offsets.slice(0, cellCount);
  for (let i = 0; i < count; i++) {
    const bi = i * 6;
    const x0 = Math.max(0, Math.min(nx - 1, Math.floor((bounds[bi] - gMinX) * invCell)));
    const y0 = Math.max(0, Math.min(ny - 1, Math.floor((bounds[bi + 1] - gMinY) * invCell)));
    const z0 = Math.max(0, Math.min(nz - 1, Math.floor((bounds[bi + 2] - gMinZ) * invCell)));
    const x1 = Math.max(0, Math.min(nx - 1, Math.floor((bounds[bi + 3] - gMinX) * invCell)));
    const y1 = Math.max(0, Math.min(ny - 1, Math.floor((bounds[bi + 4] - gMinY) * invCell)));
    const z1 = Math.max(0, Math.min(nz - 1, Math.floor((bounds[bi + 5] - gMinZ) * invCell)));
    for (let z = z0; z <= z1; z++) {
      const zOff = z * xy;
      for (let y = y0; y <= y1; y++) {
        const yOff = zOff + y * nx;
        for (let x = x0; x <= x1; x++) {
          entries[cursor[yOff + x]++] = i;
        }
      }
    }
  }

  const visited = new Int32Array(count);
  let rayId = 0;
  let hitNx = 0, hitNy = 1, hitNz = 0;

  function testAABB(di, ox, oy, oz, rx, ry, rz, maxT, needNormal) {
    let tx1 = (data[di] - ox) * rx, tx2 = (data[di + 3] - ox) * rx;
    let tMin = tx1 < tx2 ? tx1 : tx2;
    let tMax = tx1 > tx2 ? tx1 : tx2;
    let axis = 0;

    let ty1 = (data[di + 1] - oy) * ry, ty2 = (data[di + 4] - oy) * ry;
    const tyMin = ty1 < ty2 ? ty1 : ty2;
    const tyMax = ty1 > ty2 ? ty1 : ty2;
    if (tyMin > tMin) { tMin = tyMin; axis = 1; }
    if (tyMax < tMax) tMax = tyMax;
    if (tMin > tMax || tMax < MIN_T || tMin > maxT) return -1;

    let tz1 = (data[di + 2] - oz) * rz, tz2 = (data[di + 5] - oz) * rz;
    const tzMin = tz1 < tz2 ? tz1 : tz2;
    const tzMax = tz1 > tz2 ? tz1 : tz2;
    if (tzMin > tMin) { tMin = tzMin; axis = 2; }
    if (tzMax < tMax) tMax = tzMax;
    if (tMin > tMax || tMax < MIN_T || tMin > maxT) return -1;

    const t = tMin >= MIN_T ? tMin : tMax;
    if (t > maxT) return -1;
    if (needNormal) {
      if (tMin >= MIN_T) {
        hitNx = axis === 0 ? (rx < 0 ? 1 : -1) : 0;
        hitNy = axis === 1 ? (ry < 0 ? 1 : -1) : 0;
        hitNz = axis === 2 ? (rz < 0 ? 1 : -1) : 0;
      } else {
        // Exiting inside box (DoubleSide behavior)
        const exAxis = tx2 === tMax || tx1 === tMax ? 0 : (ty2 === tMax || ty1 === tMax ? 1 : 2);
        hitNx = exAxis === 0 ? (rx > 0 ? -1 : 1) : 0;
        hitNy = exAxis === 1 ? (ry > 0 ? -1 : 1) : 0;
        hitNz = exAxis === 2 ? (rz > 0 ? -1 : 1) : 0;
      }
    }
    return t;
  }

  function testOBB(di, ox, oy, oz, dx, dy, dz, maxT, needNormal) {
    const px = ox - data[di], py = oy - data[di + 1], pz = oz - data[di + 2];
    const hx = data[di + 3], hy = data[di + 4], hz = data[di + 5];
    const c = data[di + 6], s = data[di + 7];
    // Transform ray by inverse Y-rotation (-yaw): x' = c*x - s*z, z' = s*x + c*z
    const lox = c * px - s * pz, loz = s * px + c * pz;
    const ldx = c * dx - s * dz, ldz = s * dx + c * dz;
    const rlx = Math.abs(ldx) > EPS ? 1 / ldx : (ldx >= 0 ? 1e12 : -1e12);
    const rly = Math.abs(dy) > EPS ? 1 / dy : (dy >= 0 ? 1e12 : -1e12);
    const rlz = Math.abs(ldz) > EPS ? 1 / ldz : (ldz >= 0 ? 1e12 : -1e12);

    const tx1 = (-hx - lox) * rlx, tx2 = (hx - lox) * rlx;
    let tMin = tx1 < tx2 ? tx1 : tx2, tMax = tx1 > tx2 ? tx1 : tx2;
    let axis = 0;

    const ty1 = (-hy - py) * rly, ty2 = (hy - py) * rly;
    const tyMin = ty1 < ty2 ? ty1 : ty2, tyMax = ty1 > ty2 ? ty1 : ty2;
    if (tyMin > tMin) { tMin = tyMin; axis = 1; }
    if (tyMax < tMax) tMax = tyMax;
    if (tMin > tMax || tMax < MIN_T || tMin > maxT) return -1;

    const tz1 = (-hz - loz) * rlz, tz2 = (hz - loz) * rlz;
    const tzMin = tz1 < tz2 ? tz1 : tz2, tzMax = tz1 > tz2 ? tz1 : tz2;
    if (tzMin > tMin) { tMin = tzMin; axis = 2; }
    if (tzMax < tMax) tMax = tzMax;
    if (tMin > tMax || tMax < MIN_T || tMin > maxT) return -1;

    const t = tMin >= MIN_T ? tMin : tMax;
    if (t > maxT) return -1;
    if (needNormal) {
      let lnx, lny, lnz;
      if (tMin >= MIN_T) {
        lnx = axis === 0 ? (rlx < 0 ? 1 : -1) : 0;
        lny = axis === 1 ? (rly < 0 ? 1 : -1) : 0;
        lnz = axis === 2 ? (rlz < 0 ? 1 : -1) : 0;
      } else {
        const exAxis = tx2 === tMax || tx1 === tMax ? 0 : (ty2 === tMax || ty1 === tMax ? 1 : 2);
        lnx = exAxis === 0 ? (rlx > 0 ? -1 : 1) : 0;
        lny = exAxis === 1 ? (rly > 0 ? -1 : 1) : 0;
        lnz = exAxis === 2 ? (rlz > 0 ? -1 : 1) : 0;
      }
      // Rotate local normal back by +yaw: x = c*lx + s*lz, z = -s*lx + c*lz
      hitNx = c * lnx + s * lnz;
      hitNy = lny;
      hitNz = -s * lnx + c * lnz;
    }
    return t;
  }

  function testCylinder(di, ox, oy, oz, dx, dy, dz, maxT, needNormal) {
    const cx = data[di], minY = data[di + 1], cz = data[di + 2], maxY = data[di + 3], rSq = data[di + 4];
    const px = ox - cx, pz = oz - cz;
    const a = dx * dx + dz * dz;
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - rSq;
    let bestT = maxT + 1;
    let kind = -1;

    if (a > EPS) {
      const disc = b * b - a * c;
      if (disc < 0) return -1;
      const root = Math.sqrt(disc);
      const t0 = (-b - root) / a;
      const t1 = (-b + root) / a;
      if (t0 >= MIN_T && t0 < bestT) {
        const y = oy + dy * t0;
        if (y >= minY && y <= maxY) { bestT = t0; kind = 0; }
      }
      if (t1 >= MIN_T && t1 < bestT) {
        const y = oy + dy * t1;
        if (y >= minY && y <= maxY) { bestT = t1; kind = 0; }
      }
    } else if (c > 0) {
      return -1;
    }

    if (Math.abs(dy) > EPS) {
      const tBot = (minY - oy) / dy;
      if (tBot >= MIN_T && tBot < bestT) {
        const hx = px + dx * tBot, hz = pz + dz * tBot;
        if (hx * hx + hz * hz <= rSq) { bestT = tBot; kind = 1; }
      }
      const tTop = (maxY - oy) / dy;
      if (tTop >= MIN_T && tTop < bestT) {
        const hx = px + dx * tTop, hz = pz + dz * tTop;
        if (hx * hx + hz * hz <= rSq) { bestT = tTop; kind = 2; }
      }
    }
    if (kind < 0 || bestT > maxT) return -1;
    if (needNormal) {
      if (kind === 0) {
        const nx0 = px + dx * bestT, nz0 = pz + dz * bestT;
        const inv = 1 / Math.max(EPS, Math.hypot(nx0, nz0));
        hitNx = nx0 * inv; hitNy = 0; hitNz = nz0 * inv;
      } else {
        hitNx = 0; hitNy = kind === 2 ? 1 : -1; hitNz = 0;
      }
    }
    return bestT;
  }

  function trace(origin, dir, maxDist, outHit, anyHit) {
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const rx = Math.abs(dx) > EPS ? 1 / dx : (dx >= 0 ? 1e12 : -1e12);
    const ry = Math.abs(dy) > EPS ? 1 / dy : (dy >= 0 ? 1e12 : -1e12);
    const rz = Math.abs(dz) > EPS ? 1 / dz : (dz >= 0 ? 1e12 : -1e12);

    // Clip ray to global grid AABB.
    const gx1 = (gMinX - ox) * rx, gx2 = (gMaxX - ox) * rx;
    const gy1 = (gMinY - oy) * ry, gy2 = (gMaxY - oy) * ry;
    const gz1 = (gMinZ - oz) * rz, gz2 = (gMaxZ - oz) * rz;
    const tEnter = Math.max(0, Math.min(gx1, gx2), Math.min(gy1, gy2), Math.min(gz1, gz2));
    const tExit = Math.min(maxDist, Math.max(gx1, gx2), Math.max(gy1, gy2), Math.max(gz1, gz2));
    if (tEnter > tExit) return false;

    const startT = tEnter > 0 ? tEnter + 1e-4 : 0;
    const sx0 = ox + dx * startT, sy0 = oy + dy * startT, sz0 = oz + dz * startT;
    let ix = Math.max(0, Math.min(nx - 1, Math.floor((sx0 - gMinX) * invCell)));
    let iy = Math.max(0, Math.min(ny - 1, Math.floor((sy0 - gMinY) * invCell)));
    let iz = Math.max(0, Math.min(nz - 1, Math.floor((sz0 - gMinZ) * invCell)));

    const stepX = dx >= 0 ? 1 : -1;
    const stepY = dy >= 0 ? 1 : -1;
    const stepZ = dz >= 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > EPS ? Math.abs(cellSize * rx) : Infinity;
    const tDeltaY = Math.abs(dy) > EPS ? Math.abs(cellSize * ry) : Infinity;
    const tDeltaZ = Math.abs(dz) > EPS ? Math.abs(cellSize * rz) : Infinity;

    let tMaxX = Math.abs(dx) > EPS ? (gMinX + (ix + (dx > 0 ? 1 : 0)) * cellSize - ox) * rx : Infinity;
    let tMaxY = Math.abs(dy) > EPS ? (gMinY + (iy + (dy > 0 ? 1 : 0)) * cellSize - oy) * ry : Infinity;
    let tMaxZ = Math.abs(dz) > EPS ? (gMinZ + (iz + (dz > 0 ? 1 : 0)) * cellSize - oz) * rz : Infinity;

    let bestT = maxDist;
    let found = false;
    let bestNx = 0, bestNy = 1, bestNz = 0;

    if (++rayId >= 0x7fffffff) { visited.fill(0); rayId = 1; }
    const stamp = rayId;
    const needNormal = !anyHit;

    while (true) {
      const cellIdx = ix + iy * nx + iz * xy;
      const start = offsets[cellIdx], end = offsets[cellIdx + 1];
      for (let k = start; k < end; k++) {
        const id = entries[k];
        if (visited[id] === stamp) continue;
        visited[id] = stamp;
        const type = types[id], di = id * 8;
        let t;
        if (type === 0) t = testAABB(di, ox, oy, oz, rx, ry, rz, bestT, needNormal);
        else if (type === 1) t = testOBB(di, ox, oy, oz, dx, dy, dz, bestT, needNormal);
        else t = testCylinder(di, ox, oy, oz, dx, dy, dz, bestT, needNormal);
        if (t >= 0) {
          if (anyHit) return true;
          bestT = t;
          found = true;
          bestNx = hitNx; bestNy = hitNy; bestNz = hitNz;
        }
      }

      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > bestT || tMaxX > tExit) break;
        ix += stepX;
        if (ix < 0 || ix >= nx) break;
        tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > bestT || tMaxY > tExit) break;
        iy += stepY;
        if (iy < 0 || iy >= ny) break;
        tMaxY += tDeltaY;
      } else {
        if (tMaxZ > bestT || tMaxZ > tExit) break;
        iz += stepZ;
        if (iz < 0 || iz >= nz) break;
        tMaxZ += tDeltaZ;
      }
    }

    if (found && outHit) {
      outHit.distance = bestT;
      outHit.normal.set(bestNx, bestNy, bestNz);
    }
    return found;
  }

  return {
    raycast(origin, dir, maxDist, outHit) {
      return trace(origin, dir, maxDist, outHit, false) ? outHit : null;
    },
    isOccluded(origin, dir, maxDist) {
      return trace(origin, dir, maxDist, null, true);
    }
  };
}
