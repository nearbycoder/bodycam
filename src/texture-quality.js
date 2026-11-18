import * as THREE from 'three';

export const textureLevels = [512, 1024, 2048, 4096];
const preferenceKey = 'bodycam.textureQuality';
const entries = new Map();
const paths = new WeakMap();
const observers = new Set();
let committed = 1024;
try {
  const saved = Number(localStorage.getItem(preferenceKey));
  if (textureLevels.includes(saved)) committed = saved;
} catch {}
let requested = committed, controller = new AbortController(), transition = null;
let displayDevice, decoderPromise;
const base = import.meta.env.BASE_URL;
const waiters = [];
let jobs = 0;

export function initializeTextureQualityRenderer(renderer) { displayDevice = renderer; }
export function getTextureQuality() { return requested; }
export function onTextureQualityChange(callback) {
  observers.add(callback);
  return () => observers.delete(callback);
}

async function limited(work) {
  if (jobs >= 2) await new Promise(resolve => waiters.push(resolve));
  else jobs++;
  try { return await work(); }
  finally {
    const next = waiters.shift();
    if (next) next(); else jobs--;
  }
}

async function decodePacked(bytes) {
  decoderPromise ??= import('three/addons/loaders/KTX2Loader.js').then(({ KTX2Loader }) =>
    new KTX2Loader().setWorkerLimit(2).detectSupport(displayDevice));
  const loader = await decoderPromise;
  return new Promise((resolve,reject) => loader.parse(bytes,resolve,reject));
}

// These authored maps have a GPU-compressed 4K mip chain. Other maps added by a
// level, including embedded vehicle maps, can use the same manager as raster data.
const packed = new Set([
  'textures/ceiling.jpg','textures/door.jpg','textures/entrywall.jpg','textures/redwall.jpg',
  'textures/stairs.jpg','textures/stairwall.jpg','textures/plaster.jpg','textures/floor.jpg',
  'textures/floor-roughness.jpg','textures/drone-finish.webp','architecture/glazing.jpg',
  ...['floor','floor-normal','wall','wall-normal','bitumen','bitumen-normal'].map(name=>'surveys/'+name+'.jpg'),
  'details/worn-plate.jpg',...['sleeve','opening','extended','carbine','left-grip','left-fingers'].map(k=>'art/'+k+'.webp'),
  ...['bubble','chalk','debris','loops','mural','oxblood','pencil','room-tag','upper'].map(k=>'decor/'+k+'.webp')
]);

async function decode(entry, level, signal) {
  const {path, flipY}=entry;
  // The renderer is created in the same startup tick as the initial materials.
  await Promise.resolve();
  // Keep the last committed encoded file for each surface until the next tier
  // succeeds. A failed transition can also roll back while the browser is offline.
  let file=entry.backup?.level===level ? entry.backup : null;
  if (!file) {
    const packedFile=Boolean(displayDevice && level===4096 && packed.has(path));
    const url=base+'quality/'+level+'/'+path+(packedFile?'.ktx2':'');
    const response=await fetch(url,{signal});
    if (!response.ok) throw new Error('Could not load '+path+' ('+response.status+')');
    file={level,blob:await response.blob(),packed:packedFile};
  }
  const {packed:compressed, blob}=file;
  if (compressed) {
    const texture = await decodePacked(await blob.arrayBuffer());
    return { file,image:texture.image, mipmaps:texture.mipmaps, format:texture.format,
      type:texture.type, compressed:texture.isCompressedTexture, flipY:false };
  }
  if (typeof createImageBitmap === 'function') {
    const image = await createImageBitmap(blob,{imageOrientation:flipY?'flipY':'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});
    return {file,image,flipY:false};
  }
  const urlObject = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src=urlObject; await image.decode();
    return {file,image,flipY};
  } finally { URL.revokeObjectURL(urlObject); }
}

function configure(texture, data) {
  texture.isCompressedTexture = Boolean(data.compressed);
  texture.format = data.format ?? THREE.RGBAFormat;
  texture.type = data.type ?? THREE.UnsignedByteType;
  texture.generateMipmaps = !data.mipmaps?.length;
  texture.mipmaps = data.mipmaps ?? [];
  texture.flipY = data.flipY;
  texture.needsUpdate = true;
}

async function load(entry, level, signal) {
  if (entry.level === level) return;
  if (entry.pending?.signal === signal) return entry.pending.promise;
  const promise = limited(async () => {
    signal.throwIfAborted();
    if (entry.level === level) return;
    const data = await decode(entry,level,signal);
    if (signal.aborted) { data.image.close?.(); signal.throwIfAborted(); }
    const old = entry.source.data;
    // Dispose before replacing the shared source so the renderer releases both
    // its sampler allocations and any converted environment map for this image.
    for (const texture of entry.textures) texture.dispose();
    entry.source.data = data.image;
    entry.data = data;
    for (const texture of entry.textures) configure(texture,data);
    old?.close?.();
    entry.level = level;
    if (level===committed) entry.backup=data.file;
  });
  entry.pending = {signal,promise};
  try { await promise; }
  finally { if (entry.pending?.promise===promise) entry.pending=null; }
}

export function loadQualityTexture(path, options={}) {
  const texture = new THREE.Texture();
  texture.name=path;
  texture.colorSpace=options.colorSpace ?? THREE.NoColorSpace;
  texture.wrapS=options.wrapS ?? THREE.ClampToEdgeWrapping;
  texture.wrapT=options.wrapT ?? THREE.ClampToEdgeWrapping;
  texture.anisotropy=options.anisotropy ?? 4;
  if (options.repeat) texture.repeat.set(...options.repeat);
  const flipY=options.flipY ?? true;
  const key=path+(flipY?'':'@gltf');
  let entry = entries.get(key);
  if (!entry) {
    entry={path,flipY,source:texture.source,textures:new Set(),data:null,level:0,pending:null};
    entries.set(key,entry);
  }
  texture.source=entry.source;
  entry.textures.add(texture);
  paths.set(texture,entry);
  if (entry.data) configure(texture,entry.data);
  if (!entry.pending && entry.level!==requested) {
    const manager=THREE.DefaultLoadingManager, key='surface:'+path;
    manager.itemStart(key);
    load(entry,requested,controller.signal).catch(error=>{
      if (error.name !== 'AbortError') {manager.itemError(key);console.error(error);}
    }).finally(()=>manager.itemEnd(key));
  }
  return texture;
}

export function cloneQualityTexture(original) {
  const copy=original.clone(),entry=paths.get(original);
  if (entry) {
    entry.textures.add(copy); paths.set(copy,entry);
    if (entry.data) configure(copy,entry.data);
  }
  return copy;
}

async function synchronize(level, signal) {
  const results=await Promise.allSettled([...entries.values()].map(entry=>load(entry,level,signal)));
  signal.throwIfAborted();
  const error=results.find(result=>result.status==='rejected');
  if (error) throw error.reason;
}

export function setTextureQuality(choice) {
  const level=Number(choice);
  if (!textureLevels.includes(level)) return Promise.reject(new RangeError('Unsupported texture size'));
  if (level===requested && transition) return transition;
  controller.abort();
  controller=new AbortController();
  const signal=controller.signal;
  requested=level;
  const promise=(async()=>{
    try {
      await synchronize(level,signal);
      committed=level;
      for (const entry of entries.values()) if (entry.level===level) entry.backup=entry.data.file;
      try {localStorage.setItem(preferenceKey,String(level));} catch {}
      for (const callback of observers) callback(level);
      return level;
    } catch (error) {
      if (signal.aborted) throw error;
      requested=committed;
      await synchronize(committed,signal);
      throw error;
    } finally {
      if (controller.signal===signal) transition=null;
    }
  })();
  transition=promise;
  return promise;
}
