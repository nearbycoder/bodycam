import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loadQualityTexture } from './texture-quality.js';
import { registerActorBounds } from './actor-visibility.js';

const tau = Math.PI * 2;
const up = new THREE.Vector3(0, 1, 0);
const metal = 0x515458, graphite = 0x2e3336, gasket = 0x1e2324;
const shell = 0xa4a49a, trim = 0x777b77, bare = 0x828480, oxide = 0xac693d;
const motors = [];
for (const side of [-1, 1]) {
  for (const end of [-1, 1]) motors.push(new THREE.Vector3(side * (end > 0 ? .335 : .282), end > 0 ? .072 : .105, end * .222));
}

function batch() {
  const groups = new Map();
  return {
    add(material, tint, geometry, x = 0, y = 0, z = 0) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      g.translate(x, y, z);
      g.clearGroups();
      const color = new THREE.Color(tint);
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      if (!groups.has(material)) groups.set(material, []);
      groups.get(material).push(g);
    },
    finish() {
      const group = new THREE.Group();
      for (const [material, pieces] of groups) group.add(new THREE.Mesh(mergeGeometries(pieces), material));
      return group;
    }
  };
}

function rounded(w, h, d, r) {
  return new RoundedBoxGeometry(w, h, d, 1, r);
}

function rod(a, b, r, tip = r, sides = 10) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const axis = end.clone().sub(start);
  const g = new THREE.CylinderGeometry(tip, r, axis.length(), sides);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.normalize()));
  const center = start.lerp(end, .5);
  return g.translate(center.x, center.y, center.z);
}

function turning(profile, sides = 32) {
  return new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), sides);
}

// Lofts follow the changing cross section from the battery door to the nose.
// Smooth across the UV seam as well, so light tracks the curves continuously.
function fairing(sections) {
  const points = [], uv = [], indices = [];
  const sides = 32, ring = sides + 1;
  for (let s = 0; s < sections.length; s++) {
    const [z, width, height, base] = sections[s];
    for (let i = 0; i <= sides; i++) {
      const t = i * tau / sides, x = Math.cos(t), y = Math.sin(t);
      points.push(width * Math.sign(x) * Math.pow(Math.abs(x), .69), base + height * Math.sign(y) * Math.pow(Math.abs(y), .69), z);
      uv.push(i / sides, s / (sections.length - 1));
      if (i < sides && s + 1 < sections.length) {
        const a = s * ring + i;
        indices.push(a, a + 1, a + ring, a + 1, a + ring + 1, a + ring);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const normals = g.attributes.normal, n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let s = 0; s < sections.length; s++) {
    const a = s * ring, b = a + sides;
    n.fromBufferAttribute(normals, a).add(m.fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, n.x, n.y, n.z); normals.setXYZ(b, n.x, n.y, n.z);
  }
  return g;
}

// The screen print follows the sloping nose and picks up its highlights.
function inventoryMark(sections) {
  const sheet = document.createElement('canvas');
  sheet.width=320;sheet.height=144;
  const ink=sheet.getContext('2d');
  ink.fillStyle='#e0d8b0';ink.fillRect(9,7,33,32);
  ink.fillStyle='#443f38';
  ink.beginPath();ink.moveTo(25,11);ink.lineTo(38,35);ink.lineTo(12,35);ink.fill();
  ink.fillStyle='#e0d8b0';ink.fillRect(24,19,3,8);ink.fillRect(24,30,3,2);
  ink.fillStyle='#333934';ink.font='bold 26px Arial';ink.fillText('INSPECTION',51,33);
  ink.fillRect(9,46,286,3);
  ink.font='bold 67px Arial';ink.fillText('Q4–18',6,109);
  ink.font='14px monospace';ink.fillText('AIRFRAME   04-28C',11,133);
  for(let x=230;x<293;x+=4) ink.fillRect(x,60,1+(x%3),46);
  const artwork = new THREE.CanvasTexture(sheet);
  artwork.colorSpace=THREE.SRGBColorSpace;artwork.anisotropy=4;
  const geometry = new THREE.PlaneGeometry(1,1,10,10);
  const p=geometry.attributes.position, uv=geometry.attributes.uv;
  for(let i=0;i<p.count;i++){
    const x=(uv.getX(i)-.5)*.108, z=.068+(1-uv.getY(i))*.085;
    const front=sections.findIndex(s=>s[0]>z), a=sections[front-1], b=sections[front];
    const t=(z-a[0])/(b[0]-a[0]);
    const width=THREE.MathUtils.lerp(a[1],b[1],t),height=THREE.MathUtils.lerp(a[2],b[2],t);
    const cross=Math.pow(1-Math.pow(Math.abs(x/width),2/.69),.69/2);
    p.setXYZ(i,x,THREE.MathUtils.lerp(a[3],b[3],t)+height*cross+.00065,z);
  }
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({
    map:artwork,roughness:.65,metalness:.12,alphaTest:.25,polygonOffset:true,polygonOffsetFactor:-1
  }));
}

function propeller() {
  // The blade changes pitch, chord and sweep along its span.
  const sections = [[.006,.009,0,.005],[.032,.018,.002,.006],[.062,.024,.004,.005],[.091,.026,.008,.003],[.123,.020,.015,.002],[.145,.011,.024,.001],[.151,.001,.028,0]];
  const rotor = [];
  for (let side = 0; side < 2; side++) {
    const points = [], uv = [], indices = [];
    for (let i = 0; i < sections.length; i++) {
      const [x, chord, sweep, pitch] = sections[i];
      points.push(x,pitch,sweep-chord*.5, x,.004,sweep, x,-pitch,sweep+chord*.5);
      uv.push(0,i/6, .5,i/6, 1,i/6);
      if (i > 0) for (let n = 0; n < 2; n++) {
        const k = (i - 1) * 3 + n;
        indices.push(k,k+1,k+3, k+1,k+4,k+3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(indices); g.computeVertexNormals();
    rotor.push(g.rotateY(side * Math.PI));
  }
  return mergeGeometries(rotor);
}

function buildCastings() {
  const wear = loadQualityTexture('textures/drone-finish.webp', {
    colorSpace: THREE.NoColorSpace, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: 4
  });
  const paint = new THREE.MeshStandardMaterial({vertexColors:true,map:wear,bumpMap:wear,bumpScale:.00048,metalness:.24,roughness:.53});
  const alloy = new THREE.MeshStandardMaterial({vertexColors:true,map:wear,roughnessMap:wear,roughness:.53,metalness:.58});
  const elastomer = new THREE.MeshStandardMaterial({vertexColors:true,map:wear,roughness:.8,metalness:.05});
  const glass = new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.105,metalness:.16,clearcoat:1,clearcoatRoughness:.06,envMapIntensity:1.45});
  const structure = batch();
  const fair = [
    [-.238,.002,.001,.036],[-.230,.075,.021,.037],[-.214,.113,.039,.040],[-.176,.135,.046,.043],
    [-.073,.151,.054,.044],[.042,.147,.051,.042],[.126,.127,.043,.039],[.170,.093,.031,.030],
    [.189,.065,.018,.027],[.195,.002,.002,.028]
  ];
  structure.add(elastomer, graphite, fairing(fair.map(([z,w,h,y]) => [z*.985,w*.986,h*.88,y-.033])));
  structure.add(elastomer, gasket, fairing(fair.map(([z,w,h,y]) => [z*.999,w*1.006,h*.84,y-.012])));
  structure.add(paint, shell, fairing(fair));
  structure.add(paint, trim, rounded(.135,.043,.208,.018), 0,.085,-.070);
  structure.add(elastomer, graphite, rounded(.119,.008,.190,.003), 0,.109,-.073);
  for (let i=0;i<9;i++) structure.add(alloy, metal, rounded(.113,.007,.006,.0025), 0,.114,-.15+i*.020);
  structure.add(paint, shell, rounded(.128,.017,.037,.006), 0,.101,.038);
  structure.add(paint, oxide, rounded(.035,.003,.008,.001), -.031,.110,.039);
  for (const side of [-1,1]) {
    const x=side*.108;
    for (const z of [-.141,.064]) {
      const bolt=new THREE.CylinderGeometry(.006,.006,.005,12);
      structure.add(alloy, metal, bolt, x,.081,z);
      structure.add(elastomer, gasket, new THREE.BoxGeometry(.006,.0008,.0018).rotateY(.6*side), x,.084,z);
    }
    // Twin obstacle sensors sit flush with the two slopes of the nose.
    const sensor = turning([[.001,0],[.025,0],[.026,.008],[.020,.012],[.015,.012]],24).rotateX(Math.PI/2).rotateY(side*.28);
    structure.add(alloy, graphite, sensor, side*.082,.037,.172);
    structure.add(glass,0x233538,new THREE.SphereGeometry(1,20,12).scale(.016,.016,.006).rotateY(side*.28),side*.085,.037,.184);
    const knee=[side*.127,-.169,-.121], front=[side*.124,-.163,.117];
    structure.add(alloy, graphite, rod([x,-.026,-.122],knee,.012,.008));
    structure.add(alloy, graphite, rod([x,-.025,.087],front,.011,.008));
    structure.add(elastomer, gasket, rod([knee[0],knee[1],-.158],[front[0],front[1],.142],.010));
    structure.add(elastomer, graphite, rod([front[0],front[1],.139],[front[0],front[1]+.012,.158],.010,.008));
    // Elastomer suspension and the articulated cheeks leave air around the lens.
    structure.add(elastomer, gasket, rod([side*.060,-.014,.118],[side*.079,-.066,.133],.012));
    structure.add(alloy, metal, rod([side*.078,-.064,.133],[side*.078,-.093,.159],.012));
    structure.add(alloy, bare, rod([side*.070,-.093,.159],[side*.085,-.093,.159],.018,.016,18));
  }

  for (const p of motors) {
    const side = Math.sign(p.x), end = Math.sign(p.z);
    const inner=[side*.11,.018,end*.103], pivot=[side*.167,.024,end*.125], hub=[p.x,p.y-.037,p.z];
    structure.add(alloy, graphite, rod(inner,pivot,.031,.029,14));
    structure.add(alloy, graphite, rod(pivot,hub,.027,.017,16));
    structure.add(paint, trim, rod([pivot[0],pivot[1]+.007,pivot[2]],[p.x*.93,p.y-.030,p.z*.95],.017,.012,14));
    structure.add(elastomer, gasket, rod([pivot[0],pivot[1]-.018,pivot[2]],[p.x,p.y-.050,p.z],.004));
    structure.add(elastomer, graphite, turning([[.011,-.058],[.024,-.055],[.029,-.038],[.027,-.030]],22),p.x,p.y,p.z);
    structure.add(alloy, metal, turning([[.025,-.031],[.031,-.029],[.032,-.011],[.029,-.005],[.018,.001],[.010,.001]],28),p.x,p.y,p.z);
    for (let n=0;n<8;n++) {
      const a=n*tau/8;
      structure.add(elastomer, gasket, new THREE.BoxGeometry(.008,.010,.001).rotateY(a),p.x+.032*Math.sin(a),p.y-.021,p.z+.032*Math.cos(a));
    }
    structure.add(alloy, bare, turning([[.003,.003],[.008,.004],[.009,.008],[.005,.011],[0,.011]],16),p.x,p.y,p.z);
    if (end>0) structure.add(paint,oxide,rod([side*.208,.033,end*.147],[side*.219,.034,end*.153],.021,.020,14));
  }

  const camera = batch();
  camera.add(paint,trim,new THREE.SphereGeometry(1,32,20).scale(.072,.069,.071));
  camera.add(elastomer,graphite,turning([[.047,.032],[.059,.043],[.060,.059],[.052,.073],[.044,.076]],36).rotateX(Math.PI/2));
  camera.add(alloy,metal,turning([[.043,.068],[.049,.070],[.050,.077],[.046,.080],[.042,.080]],36).rotateX(Math.PI/2));
  camera.add(elastomer,gasket,turning([[.042,.077],[.044,.080],[.042,.083],[.033,.083],[.031,.077]],36).rotateX(Math.PI/2));
  camera.add(glass,0x172d31,new THREE.SphereGeometry(1,32,16).scale(.035,.035,.009),0,0,.076);
  camera.add(glass,0x54828a,new THREE.SphereGeometry(1,16,8).scale(.007,.0025,.0008).rotateZ(-.37),-.010,.013,.084);
  camera.add(glass,0x566048,new THREE.SphereGeometry(1,12,6).scale(.003,.002,.0006),.010,-.008,.085);

  const indicators = [];
  for (const side of [-1,1]) {
    structure.add(elastomer, graphite, rounded(.043,.017,.013,.004),side*.111,.010,.144);
    indicators.push(rounded(.034,.008,.006,.0025).translate(side*.111,.010,.152));
  }
  const body=structure.finish();
  body.add(inventoryMark(fair));
  return {body,camera:camera.finish(),propeller:propeller(),
    blades:new THREE.MeshStandardMaterial({color:0x373a39,side:THREE.DoubleSide,map:wear,metalness:.19,roughness:.5}),
    indicators:mergeGeometries(indicators)};
}

const plane = new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
const blurSurface = new THREE.PlaneGeometry(.303,.303).rotateX(-Math.PI/2);
const rotorBlur = new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,
  uniforms:{speed:{value:1}},
  vertexShader:`varying vec2 st;void main(){st=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
  fragmentShader:`varying vec2 st;uniform float speed;void main(){
    vec2 p=st*2.-1.;float r=length(p),a=atan(p.y,p.x);
    float trail=pow(max(.0,cos(2.*(a+1.4*r))),2.5);
    float alpha=smoothstep(.11,.27,r)*(1.-smoothstep(.89,1.,r));
    gl_FragColor=vec4(.077,.082,.08,alpha*(.046+.24*trail)*speed);
    #include <colorspace_fragment>
  }`
});
const shadowMaterial = new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,
  vertexShader:`varying vec2 st;void main(){st=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`varying vec2 st;void main(){vec2 p=st*2.-1.;float s=exp(-3.9*dot(p*vec2(1.3,1.03),p*vec2(1.3,1.03)));
    gl_FragColor=vec4(.011,.012,.012,s*.27);
    #include <colorspace_fragment>
  }`
});
const amber = new THREE.Color(.85,.19,.035), warning = new THREE.Color(5.2,.88,.075), hit = new THREE.Color(5.8,3.1,1.2);
const off = new THREE.Color(.068,.037,.014);
const flyingBounds = new THREE.Box3(new THREE.Vector3(-.51,-.20,-.395),new THREE.Vector3(.51,.15,.395));
let castings;
export function buildDrone(parent) {
  castings ??= buildCastings();
  const root = new THREE.Group(), body = castings.body.clone(), gimbal = castings.camera.clone();
  gimbal.position.set(0,-.092,.155);
  const signal = new THREE.MeshBasicMaterial({color:amber});
  body.add(new THREE.Mesh(castings.indicators,signal),gimbal);
  const fans = new THREE.InstancedMesh(castings.propeller,castings.blades,4);
  const streak = new THREE.InstancedMesh(blurSurface,rotorBlur.clone(),4);
  const pivot = new THREE.Object3D();
  for (const mesh of [fans,streak]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(),.61);
  }
  body.add(fans,streak);root.add(body);
  const shadow = new THREE.Mesh(plane,shadowMaterial);
  shadow.scale.set(1.17,1,.85);shadow.renderOrder=1;
  parent.add(root,shadow);
  registerActorBounds(body,flyingBounds);
  let previous, angle=0;
  function animate(time,phase,charge,stagger,wreck) {
    const elapsed = previous === undefined ? 0 : Math.max(0,time-previous);
    previous=time;
    angle = (angle + elapsed*87*(1-wreck)) % tau;
    for (let i=0;i<motors.length;i++) {
      pivot.position.copy(motors[i]);
      pivot.rotation.y = (i === 0 || i === 3 ? angle : -angle) + i*1.27 + phase;
      pivot.updateMatrix();
      fans.setMatrixAt(i,pivot.matrix);streak.setMatrixAt(i,pivot.matrix);
    }
    fans.instanceMatrix.needsUpdate=true;streak.instanceMatrix.needsUpdate=true;
    streak.material.uniforms.speed.value = 1-wreck;
    streak.visible = wreck < .96;
    if (wreck > 0) {
      body.rotation.set(-.28*wreck,0,1.31*wreck);
      signal.color.copy(off);
      gimbal.rotation.set(.35*wreck,0,-.14*wreck);
    } else {
      body.rotation.set(Math.cos(time*1.21+phase)*.041,0,Math.sin(time*1.63+phase)*.075+.11*stagger);
      gimbal.rotation.set(-body.rotation.x+.035*Math.sin(time*.85+phase),.063*Math.sin(time*.72+phase),-body.rotation.z*.85);
      signal.color.copy(amber).lerp(warning,charge*(.72+.28*Math.sin(time*24))).lerp(hit,stagger);
    }
  }
  animate(0,0,0,0,0);
  return {root,shadow,animate};
}
