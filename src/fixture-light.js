import * as THREE from 'three';

// The vertical pitch divides each 3.2 m storey into twelve equal intervals.
const cell=3.2/12, origin=[1.0,-3.2-cell,-16.28], size=[114,50,71];
const inverseSize=new THREE.Vector3(...size.map(n=>1/(n*cell)));
const bindings=new WeakMap();

function lightMaterial(mat,texture) {
  if(!mat?.isMeshStandardMaterial)return;
  const bound=bindings.get(mat);
  if(bound){bound.value=texture;return;}
  const sampler={value:texture};
  bindings.set(mat,sampler);
  const compile=mat.onBeforeCompile;
  const key=mat.customProgramCacheKey();
  mat.onBeforeCompile=(shader,renderer)=>{
    compile.call(mat,shader,renderer);
    shader.uniforms.fixtureField=sampler;
    shader.uniforms.fixtureOrigin={value:new THREE.Vector3(...origin)};
    shader.uniforms.fixtureScale={value:inverseSize};
    shader.vertexShader='varying vec3 fixturePoint;\n'+shader.vertexShader.replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nfixturePoint=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader=`varying vec3 fixturePoint;
      uniform highp sampler3D fixtureField;
      uniform vec3 fixtureOrigin,fixtureScale;
    `+shader.fragmentShader.replace('#include <opaque_fragment>',`
      {
      vec3 geometricNormal=inverseTransformDirection(nonPerturbedNormal,viewMatrix);
      vec3 shadingNormal=inverseTransformDirection(normal,viewMatrix);
      vec3 probeUV=(fixturePoint+geometricNormal*.165-fixtureOrigin)*fixtureScale;
      vec4 field=texture(fixtureField,probeUV);
      vec3 incoming=(field.rgb*255.-128.)/127.;
      float energy=2.*field.a/max(.035,1.-field.a);
      if(any(lessThan(probeUV,vec3(0.))) || any(greaterThan(probeUV,vec3(1.))))energy=0.;
      vec3 lampColor=mix(vec3(.81,1.02,.94),vec3(1.01,1.03,.97),step(-.07,fixturePoint.y));
      float diffuseFlux=energy*(.16+.94*max(dot(shadingNormal,incoming),0.));
      outgoingLight+=lampColor*diffuseColor.rgb*(1.-.60*metalnessFactor)*diffuseFlux;
      // Broad highlights from the incident lobe follow polished curved panels.
      vec3 reflected=reflect(normalize(fixturePoint-cameraPosition),shadingNormal);
      vec3 delta=reflected-incoming;
      float breadth=.018+.36*roughnessFactor*roughnessFactor;
      float spec=exp(-dot(delta*vec3(.62,1.,1.),delta*vec3(.62,1.,1.))/breadth);
      outgoingLight+=lampColor*energy*spec*mix(vec3(.025),diffuseColor.rgb*.55,metalnessFactor);
      }
      #include <opaque_fragment>
    `);
  };
  mat.customProgramCacheKey=()=>key+'/fixture-field';
  mat.needsUpdate=true;
}

function gatherBoxes(occluders) {
  const bounds=new THREE.Box3(),boxes=[];
  for(const mesh of occluders){
    const geometry=mesh.geometry;
    if(!geometry.boundingBox)geometry.computeBoundingBox();
    bounds.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    const {min,max}=bounds;
    if(geometry.type==='CylinderGeometry'){
      // Five chords follow the tank shell closely at its rounded corners.
      const cx=(min.x+max.x)/2,cz=(min.z+max.z)/2,r=(max.x-min.x)/2;
      for(let j=0;j<5;j++){
        const a=-1+.4*j,b=a+.4,u=Math.min(Math.abs(a),Math.abs(b));
        const depth=(max.z-cz)*Math.sqrt(1-(a*b<=0?0:u*u));
        boxes.push(cx+r*a,min.y,cz-depth,cx+r*b,max.y,cz+depth);
      }
    } else boxes.push(min.x,min.y,min.z,max.x,max.y,max.z);
  }
  return new Float32Array(boxes);
}

export function fixtureLighting() {
  const fixtures=[];
  function finish(nodes,occluders){
    const empty=new Uint8Array([128,128,128,0]);
    const texture=new THREE.Data3DTexture(empty,1,1,1);
    texture.name='Annex fluorescent irradiance';
    texture.format=THREE.RGBAFormat;
    texture.minFilter=texture.magFilter=THREE.LinearFilter;
    texture.generateMipmaps=false;texture.needsUpdate=true;
    for(const node of nodes)node.traverse(object=>{
      const materials=object.material;
      if(Array.isArray(materials))materials.forEach(mat=>lightMaterial(mat,texture));
      else lightMaterial(materials,texture);
    });
    const params={origin,size,cell,fixtures,boxes:gatherBoxes(occluders)};
    const loading=THREE.DefaultLoadingManager,token='annex:fixture-light';
    loading.itemStart(token);
    function apply(pixels){
      texture.dispose();
      texture.image={data:pixels,width:size[0],height:size[1],depth:size[2]};
      texture.needsUpdate=true;
      loading.itemEnd(token);
    }
    // The one-time static bake has no cost in the animation loop.
    const fallback=()=>import('./fixture-bake.js')
      .then(({bakeFixtureVolume})=>apply(bakeFixtureVolume(params)))
      .catch(()=>{loading.itemError(token);loading.itemEnd(token);});
    try{
      const worker=new Worker(new URL('./fixture-bake.js',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{worker.terminate();apply(data);};
      worker.onerror=event=>{event.preventDefault();worker.terminate();fallback();};
      worker.postMessage(params);
    }catch{fallback();}
  }
  return {strip:(x,y,z,length)=>fixtures.push([x,y,z,length]),finish};
}
