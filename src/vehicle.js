import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadQualityTexture } from './texture-quality.js';
import { registerActorBounds } from './actor-visibility.js';

export const motorBay = {x:9.76,z:-12.63,yaw:.14,width:2.44,length:4.56};
export const motorCamera = {
  position:new THREE.Vector3(6.28,1.13,-9.80),
  target:new THREE.Vector3(9.08,.78,-13.76),fov:77,
};

// Keep the room interactive while the mesh and photographic light probe decode.
// The actor and shot collision bounds are registered with the architecture.
export function parkCoupe(scene,room){
  const base=import.meta.env.BASE_URL+'vehicles/';
  const hdr=new HDRLoader().load(base+'workshop.hdr');
  hdr.mapping=THREE.EquirectangularReflectionMapping;
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.load(base+'motor-coupe.glb',({scene:model})=>{
    const loadedMaps=new Map(),processed=new Set();
    function applyMaps(m){
      for(const key of ['map','normalMap','aoMap','roughnessMap','metalnessMap','emissiveMap','clearcoatNormalMap']){
        const old=m[key];
        if(!old)continue;
        if(!loadedMaps.has(old)){
          const map=loadQualityTexture('vehicles/'+old.name+'.webp',{
            colorSpace:old.colorSpace,wrapS:old.wrapS,wrapT:old.wrapT,anisotropy:8,
            repeat:old.repeat.toArray(),flipY:false
          });
          map.channel=old.channel;map.offset.copy(old.offset);map.center.copy(old.center);
          map.rotation=old.rotation;map.magFilter=old.magFilter;map.minFilter=old.minFilter;
          loadedMaps.set(old,map);
        }
        m[key]=loadedMaps.get(old);
      }
    }
    model.name='Motor bay coupe';
    const bounds=new THREE.Box3().setFromObject(model,true),size=bounds.getSize(new THREE.Vector3());
    const center=bounds.getCenter(new THREE.Vector3()),scale=motorBay.length/size.z;
    model.scale.setScalar(scale);
    model.position.set(-center.x*scale,-bounds.min.y*scale+.004,-center.z*scale);
    model.traverse(node=>{
      if(!node.isMesh)return;
      for(const material of Array.isArray(node.material)?node.material:[node.material]){
        if(processed.has(material))continue;
        processed.add(material);applyMaps(material);
        material.envMap=hdr;material.envMapIntensity=.91;
        if(material.name==='Glass'){
          // Thin laminated glass. Alpha preserves the seats and dash through the side windows.
          material.transmission=0;material.transparent=true;material.opacity=.24;
          material.color.setHex(0xb9cad0);material.roughness=.065;material.depthWrite=false;
        }
        if(material.name==='Paint 1 Carmine'){
          material.color.setHex(0x9d1821);material.clearcoat=1;material.clearcoatRoughness=.105;
        }
        if(material.emissiveIntensity>1)material.emissiveIntensity=.34;
      }
    });
    for(const old of loadedMaps.keys())old.dispose();
    const mount=new THREE.Group();mount.position.set(motorBay.x,0,motorBay.z);
    mount.rotation.y=motorBay.yaw;mount.add(model);scene.add(mount);
    mount.updateMatrixWorld(true);
    if(room){
      const portals=room.openings.map(([z,[x,width,low,high]])=>({
        axis:'z',across:'x',up:'y',plane:z,
        min:new THREE.Vector3(x-width/2-.035,low-.035,z),
        max:new THREE.Vector3(x+width/2+.035,high+.035,z)
      }));
      registerActorBounds(mount,new THREE.Box3().setFromObject(mount,true).expandByScalar(.045),
        {bounds:room.bounds,portals});
    }
    // Place a soft footprint at the actual lowest vertices of each tire.
    const tires=[[],[],[],[]],v=new THREE.Vector3();
    model.traverse(n=>{
      if(!n.isMesh||n.material.name!=='Tiretread')return;
      const attr=n.geometry.attributes.position;
      for(let i=0;i<attr.count;i++){
        v.fromBufferAttribute(attr,i).applyMatrix4(n.matrixWorld);
        if(v.y>.063)continue;
        const dx=v.x-motorBay.x,dz=v.z-motorBay.z,c=Math.cos(motorBay.yaw),s=Math.sin(motorBay.yaw);
        const bin=Number(dx*c-dz*s>0)+2*Number(dx*s+dz*c>0);
        tires[bin].push([v.x,v.z]);
      }
    });
    const shape=document.createElement('canvas');shape.width=shape.height=64;
    const ctx=shape.getContext('2d'),ink=ctx.createRadialGradient(32,32,2,32,32,32);
    ink.addColorStop(0,'rgba(2,3,3,.95)');ink.addColorStop(.48,'rgba(2,3,3,.68)');ink.addColorStop(1,'rgba(2,3,3,0)');
    ctx.fillStyle=ink;ctx.fillRect(0,0,64,64);
    const shadow=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shape),transparent:true,depthWrite:false});
    for(const patch of tires){
      if(!patch.length)continue;
      const [x,z]=patch.reduce(([x,z],p)=>[x+p[0]/patch.length,z+p[1]/patch.length],[0,0]);
      const plane=new THREE.Mesh(new THREE.PlaneGeometry(.56,.77),shadow);
      plane.rotation.order='YXZ';plane.rotation.set(-Math.PI/2,motorBay.yaw,0);plane.position.set(x,.007,z);scene.add(plane);
    }
  },undefined,error=>console.error('Motor bay asset failed to load',error));
}
