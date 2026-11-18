import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surface } from './materials.js';

export const windowCenters = [0, -4.45, -8.9];
const clamp = THREE.MathUtils.clamp;
const up = new THREE.Vector3(0, 1, 0);

// A projected window pattern gives the dusty concrete a grazing reflection.
// The reflected image walks across the floor with the observer.
function illuminateFloor(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 slabPosition;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n slabPosition = (modelMatrix * vec4(transformed, 1.)).xyz;'
    );
    shader.fragmentShader = `
      varying vec3 slabPosition;
      float windowImage(vec2 wall, float blur) {
        float along = abs(mod(wall.x + 2.225,4.45)-2.225);
        float halfWidth=1.30;
        if(wall.x > -2.20) { along=abs(wall.x+.095); halfWidth=1.205; }
        float opening = 1. - smoothstep(halfWidth-blur, halfWidth+blur, along);
        opening *= smoothstep(.93-blur,.93+blur,wall.y) * (1.-smoothstep(2.84-blur,2.84+blur,wall.y));
        float sash = smoothstep(.013, .027+blur, abs(along-.433));
        sash *= smoothstep(.012,.022+blur,abs(wall.y-2.06));
        return opening * mix(.32,1.,sash) * smoothstep(-10.32,-10.16,wall.x) * (1.-smoothstep(1.30,1.46,wall.x));
      }
    ` + shader.fragmentShader.replace('#include <opaque_fragment>', `
      if (slabPosition.z > -13.01 && abs(slabPosition.x) < 1.46 && slabPosition.y < .075) {
        float distanceToGlass = slabPosition.x + 1.46;
        vec2 projectedWindow = vec2(slabPosition.z-distanceToGlass*.42,distanceToGlass*1.07);
        float sun = windowImage(projectedWindow,.035+distanceToGlass*.017);
        float aggregate = dot(diffuseColor.rgb,vec3(.3,.59,.11));
        // The last bay is sheltered by the stair enclosure.
        float exposure=mix(.47,1.,smoothstep(-10.0,-5.7,slabPosition.z));
        outgoingLight += sun*exposure*(diffuseColor.rgb*7.8+vec3(.078,.077,.071));
        vec3 bounce = reflect(normalize(slabPosition-cameraPosition),vec3(0.,1.,0.));
        if (bounce.x < -.01) {
          vec2 reflected = slabPosition.zy + bounce.zy * (-distanceToGlass/bounce.x);
          float glint = windowImage(reflected, .14 + .28*roughnessFactor);
          float wet = clamp((.51-roughnessFactor)*2.8+.10, .07, .92);
          outgoingLight += vec3(.91,.95,1.)*glint*wet*(.36+aggregate);
        }
      }
      #include <opaque_fragment>
      if(abs(slabPosition.y)<.045 && slabPosition.z> -13.01)
        gl_FragColor.a=1.-.85*(1.-smoothstep(.26,.56,roughnessFactor));
    `);
  };
}

function bounceLight(x, y, z) {
  let value = .86;
  if (z > -13 && z <= 3.6 && x < 1.64 && x > -1.65 && y < 3.26) {
    const longitudinal = Math.min(...windowCenters.map(center => Math.abs(center-z)));
    const windowDistance = Math.max(0, longitudinal-1.2);
    const aperture = Math.exp(-.44*windowDistance*windowDistance);
    value = .46+.55*aperture;
    const edge = Math.max(0,1.45-Math.abs(x));
    const base = Math.exp(-Math.max(0,y)*4.8) * Math.exp(-edge*3.8);
    const cornice = Math.exp(-Math.max(0,3.10-y)*3.9) * Math.exp(-edge*4.1);
    value *= 1.-.78*base-.61*cornice;
    value *= .73 + .27 * clamp((z+13)*.65,0,1);
  } else if (x > 1.52 && z > -13 && y < 3.27) {
    const toWindow = Math.exp(-.42*Math.pow((z+.75)/1.9,2));
    value = .084+.34*toWindow+.19*Math.max(0,1.-(x-1.5)/3.);
  } else if (z < -13) {
    const gloom = Math.exp(-Math.max(0,y)*.69) * clamp((x+2.9)/3.2, .25,1.);
    value = .89-.54*gloom;
    const corner = Math.max(0, Math.min(x+3.45,2.65-x,z+19.35,-13-z));
    value *= 1.-.38*Math.exp(-corner*4.0);
  } else if (y>=3.19 && z>=-13 && z<=-9.63) {
    value = .20+.34*Math.exp(-(z+13)*.95);
  }
  return value;
}

// Fine, uneven damp edges track the architectural joints on both adjoining faces.
function weatherSurface(mat) {
  const previous = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader,renderer) => {
    previous.call(mat,shader,renderer);
    shader.vertexShader = 'varying vec3 buildingPoint;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>', '#include <worldpos_vertex>\n buildingPoint=(modelMatrix*vec4(transformed,1.)).xyz;'
    );
    shader.fragmentShader = `
      varying vec3 buildingPoint;
      float weatherHash(vec2 p) {
        vec3 q=fract(p.xyx*vec3(.1031,.11369,.13787));
        q+=dot(q,q.yzx+19.19);
        return fract((q.x+q.y)*q.z);
      }
      float weatherNoise(vec2 pos) {
        vec2 p=floor(pos), f=fract(pos);
        f=f*f*(3.-2.*f);
        return mix(mix(weatherHash(p),weatherHash(p+vec2(1.,0.)),f.x),
                   mix(weatherHash(p+vec2(0.,1.)),weatherHash(p+1.),f.x),f.y);
      }
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 bp=buildingPoint;
      if(abs(bp.x)<1.71 && bp.z>=-13.01 && bp.z<3.6 && bp.y<3.21) {
        float wallDistance=max(0.,1.45-abs(bp.x));
        float seam=wallDistance+min(abs(bp.y),abs(3.1-bp.y));
        float bleed=.09+.32*weatherNoise(vec2(bp.z*1.8,2.))+.06*weatherNoise(vec2(bp.z*12.,.6));
        float soot=exp(-seam/bleed);
        vec2 stainUV=vec2(bp.z*2.8+bp.x*.41, bp.y*.8+bp.x*2.6);
        float stain=.55*weatherNoise(stainUV)+.30*weatherNoise(stainUV*3.2)+.15*weatherNoise(stainUV*13.);
        float damp=clamp(soot*(.2+1.48*stain),0.,.92);
        diffuseColor.rgb *= mix(vec3(1.),vec3(.18,.145,.105),damp);
        diffuseColor.rgb *= 1.-.83*smoothstep(.4,.88,stain)*exp(-max(0.,bp.y)*1.72)*exp(-wallDistance*1.65);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      if(buildingPoint.x < -1.22 && buildingPoint.x > -1.73 && buildingPoint.z > -13.0 && buildingPoint.z < 3.5 && buildingPoint.y < 3.18) {
        vec3 b=buildingPoint;
        float w=min(min(abs(b.z+8.90)-1.30,abs(b.z+4.45)-1.30),abs(b.z+.095)-1.205);
        float edge=length(max(vec2(w,abs(b.y-1.885)-.955),0.));
        vec3 face=normalize(cross(dFdx(b),dFdy(b)));
        float shelf=clamp(face.y+.28,.18,1.)*exp(-abs(b.y-.935)*31.)*(1.-smoothstep(-.014,.064,w));
        float wrap=exp(-edge*3.6);
        outgoingLight += (diffuseColor.rgb+vec3(.006)) * wrap * (1.25+shelf*9.80);
      }
      if(buildingPoint.z < -13.0 && buildingPoint.z > -19.64 && buildingPoint.x >= -3.71 && buildingPoint.x < 2.91) {
        vec3 b=buildingPoint;
        float fromRear=b.z+19.35, fromSide=b.x+3.45;
        vec3 face=normalize(cross(dFdx(b),dFdy(b)));
        vec2 rear=vec2(b.x+fromRear*.40+2., b.y+fromRear*.70-3.805);
        vec2 side=vec2(b.z-fromSide*.25+15.42, b.y+fromSide*.79-4.675);
        vec2 rearEdge=(1.-smoothstep(vec2(.97,1.29),vec2(1.32,1.61),abs(rear)));
        vec2 sideEdge=(1.-smoothstep(vec2(.94,.99),vec2(1.21,1.26),abs(side)));
        float bars=.63+.37*smoothstep(.008,.074,min(abs(abs(side.x)-.36),abs(side.y-.21)));
        float rearBeam=rearEdge.x*rearEdge.y*max(0.,dot(face,normalize(vec3(.40,.70,-1.))));
        float sideBeam=sideEdge.x*sideEdge.y*bars*max(0.,dot(face,normalize(vec3(-1.,.79,-.25))));
        float indirect=exp(-dot(rear*vec2(.38,.57),rear*vec2(.38,.57))-.23*max(fromRear,0.));
        indirect+=exp(-dot(side*vec2(.59,.68),side*vec2(.59,.68))-.23*max(fromSide,0.));
        outgoingLight += vec3(.91,.95,1.04)*diffuseColor.rgb*(rearBeam*12.8+sideBeam*18.5+indirect*2.22);
      }
      #include <opaque_fragment>
    `);
  };
  // The floor has a second shader hook for the projected window light.
  mat.customProgramCacheKey = () => mat.roughnessMap ? 'weathered-wet-slab' : 'weathered-masonry';
}

// Group transformed geometry by material so repeated stair posts, radiators,
// window jambs and lamp fittings render in a handful of draw calls.
const collisionCube = new THREE.BoxGeometry(1,1,1);
collisionCube.computeBoundingBox();
const collisionMaterial = new THREE.MeshBasicMaterial({side: THREE.DoubleSide});

// Collision proxies use simple boxes; the visible meshes can keep their surface subdivisions.
export function construction(scene, {occluders, light=bounceLight, spacing=.70, createMaterial} = {}) {
  const batches = new Map();
  const library = new Map();
  const shades = {
    pipe: [0x4c3e33,.86,.29], iron: [0x392f2b,.72,.42], wire: [0x221f1e,.87,.18],
    enamel: [0x6c6556,.84,.12], bulb: [0x9c9685,.45,.07], rust: [0x745440,.91,.23],
  };
  function material(kind) {
    if (!library.has(kind)) {
      const paint = shades[kind];
      const custom = createMaterial?.(kind);
      const mat = custom ?? (paint ? new THREE.MeshStandardMaterial({
        color:paint[0], roughness:paint[1], metalness:paint[2],
      }) : surface(kind==='heater'?'door':kind).clone());
      if (kind==='heater') mat.color.setHex(0xb8a992);
      mat.vertexColors = true;
      if (!custom && kind === 'floor') illuminateFloor(mat);
      if (!custom && !paint) weatherSurface(mat);
      library.set(kind,mat);
    }
    return library.get(kind);
  }

  function add(geo, mat, worldUV = false) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    const color = new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i), y=p.getY(i), z=p.getZ(i);
      if (worldUV) {
        const nx=n.getX(i), nz=n.getZ(i);
        if (Math.abs(nx)>.7) uv.setXY(i, -Math.sign(nx)*z, y);
        else if (Math.abs(nz)>.7) uv.setXY(i, Math.sign(nz)*x, y);
        else uv.setXY(i,x,-z);
      }
      const l=light(x,y,z);
      color.set([l,l,l],3*i);
    }
    geo.setAttribute('color',new THREE.BufferAttribute(color,3));
    geo.clearGroups();
    if (!batches.has(mat)) batches.set(mat,[]);
    batches.get(mat).push(geo);
  }
  function box(x,y,z,w,h,d,kind) {
    const surfaceMaterial=material(kind);
    if (occluders && w*h*d > .042) {
      const proxy = new THREE.Mesh(collisionCube, collisionMaterial);
      proxy.position.set(x,y,z);
      proxy.scale.set(w,h,d);
      proxy.userData.solidSlab = !surfaceMaterial.transparent && !surfaceMaterial.alphaTest;
      proxy.updateMatrixWorld();
      occluders.push(proxy);
    }
    const divisions = s => Math.max(1,Math.ceil(s/spacing));
    const geo=new THREE.BoxGeometry(w,h,d,divisions(w),divisions(h),divisions(d));
    geo.translate(x,y,z);
    add(geo,surfaceMaterial,true);
  }
  function rod(a,b,r,kind,rTop=r,sides=8) {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b);
    const dir=end.clone().sub(start);
    const geo=new THREE.CylinderGeometry(rTop,r,dir.length(),sides);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up,dir.normalize()));
    const p=start.lerp(end,.5);
    geo.translate(p.x,p.y,p.z);
    add(geo,material(kind));
  }
  function finish() {
    for(const [mat,geos] of batches) {
      const geometry = mergeGeometries(geos);
      const mesh = new THREE.Mesh(geometry,mat);
      mesh.receiveShadow = true;
      scene.add(mesh);
      for(const g of geos) g.dispose();
    }
  }
  return {box,rod,material,add,finish};
}
