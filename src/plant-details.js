import * as THREE from 'three';
import { getTextureQuality, onTextureQualityChange } from './texture-quality.js';

const tau = Math.PI * 2;
const up = new THREE.Vector3(0, 1, 0);
const collisionCube = new THREE.BoxGeometry(1, 1, 1);
const proxyMaterial = new THREE.MeshBasicMaterial({side: THREE.DoubleSide});
let graphicMaterial;

// Small printed parts share a single atlas and batch on each storey.
function instrumentAtlas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(size / 1024, size / 1024);
  let seed = 882;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  function text(value, x, y, size, color, weight = 'bold') {
    ctx.fillStyle = color;
    ctx.font = weight + ' ' + size + 'px Arial, sans-serif';
    ctx.fillText(value, x, y);
  }
  function line(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
  for (let i = 0; i < 16; i++) {
    ctx.save();ctx.translate((i % 4) * 256, Math.floor(i / 4) * 256);
    ctx.beginPath();ctx.rect(0, 0, 256, 256);ctx.clip();
    if (i === 0) {
      line(0, 0, 256, 256, '#c6c7ac');
      for (let t = 0; t <= 40; t++) {
        ctx.save();ctx.translate(128, 130);ctx.rotate((-2.34 + t * .117));
        line(-1, -108, t % 5 ? 2 : 4, t % 5 ? 9 : 22, t > 35 ? '#804a37' : '#30352e');
        if (!(t % 5)) {
          const n = t / 5;
          ctx.translate(0, -73);ctx.rotate(2.34 - t * .117);
          text(String(n), -7, 5, 19, '#31352e');
        }
        ctx.restore();
      }
      text('bar', 111, 174, 16, '#575b52');text('PRESSURE', 95, 198, 11, '#55584c');
      ctx.beginPath();ctx.moveTo(141, 145);ctx.lineTo(72, 62);ctx.lineTo(124, 139);ctx.fillStyle='#333931';ctx.fill();
      ctx.beginPath();ctx.arc(128,130,7,0,tau);ctx.fill();
    } else if (i === 1 || i === 2 || i === 3) {
      const titles = ['','PRESSURE VESSEL','AIR HANDLING','DISTRIBUTION'];
      line(0,0,256,256,'#bbbdb2');line(8,8,240,240,'#48534f');line(11,11,234,234,'#b4b6a9');
      line(16,17,224,42,'#333c37');text(titles[i],23,46,21,'#d4d2bd');
      text('WORKS  /  EQUIPMENT DIVISION',19,77,13,'#414840');
      for (const [j, value] of ['MODEL','LOT  NO.','TESTED','SERVICE'].entries()) {
        const top = 88 + j * 35;
        line(20, top + 29, 214, 2, '#72786e');text(value, 20, top+22, 14, '#494e43');
        text(['MK 14 / C','014   3827','09    1998','LOCAL'][j], 119, top+23, 16, '#3c453e');
      }
    } else if (i === 4) {
      line(0,0,256,256,'#aaa997');line(5,5,246,246,'#383e37');
      line(9,9,238,83,'#a78750');text('CAUTION',26,73,48,'#252923');
      text('ISOLATE SUPPLY',17,142,26,'#cbc9b6');text('BEFORE SERVICE',16,181,26,'#cbc9b6');
      line(17,201,217,3,'#a3a48f');text('ELECTRICAL PLANT',17,229,16,'#c1beab');
    } else if (i === 5) {
      line(0,0,256,256,'#363c39');
      for(let row=2; row<256; row+=6){
        line(0,row,256,1,'#6c7067');line(0,row+1,256,2,'#494e47');
        for(let col=(row%12?0:4);col<256;col+=9)line(col,row+1,1,4,'#252c29');
      }
    } else if (i === 6) {
      line(0,0,256,256,'#323b35');line(9,13,238,166,'#b5b5a0');
      ctx.strokeStyle='#606255';ctx.lineWidth=4;
      ctx.beginPath();ctx.arc(128,205,145,3.84,5.59);ctx.stroke();
      for(let n=0;n<21;n++){
        ctx.save();ctx.translate(128,205);ctx.rotate(-.88+n*.088);
        line(-1,-147,3,n%5?9:20,'#3d423b');ctx.restore();
      }
      ctx.beginPath();ctx.moveTo(123,176);ctx.lineTo(156,58);ctx.lineTo(126,176);ctx.fillStyle='#764233';ctx.fill();
      text('A',113,151,33,'#434a3d');text('LINE  CURRENT',26,227,25,'#a7ac9c');
    } else if (i >= 7 && i < 12) {
      const kraft=['#928572','#b1a385','#8f8066','#a79b83','#a49173','#9d917b'];
      line(0,0,256,256,kraft[i-7]);
      for(let p=0;p<1400;p++){
        ctx.fillStyle=random()<.5?'rgba(40,33,24,.14)':'rgba(239,230,204,.14)';
        ctx.fillRect(random()*256,random()*256,random()*13+1,.8);
      }
      line(0,0,256,6,'#6c6251');line(0,247,256,5,'rgba(52,46,33,.24)');
      const labelX = 15 + (i % 3) * 18;
      line(labelX,108,140,80,'#c8c5ae');line(labelX+4,112,132,19,'#62665a');
      text('RECORDS  /  EAST',labelX+8,127,14,'#d4d1b9');
      text('R' + (140+i*27) + ' – ' + (28+i),labelX+8,160,24,'#44483d');
      for(let bar=0;bar<96;bar+=3)line(labelX+8+bar,166,1+random()*2,14,'#5b5b4d');
      if(i%2){ctx.fillStyle='#625a48';ctx.beginPath();ctx.roundRect(86,40,84,20,10);ctx.fill();}
      text('↑ ↑',204,222,23,'#625f50');
    } else if(i === 12) {
      line(0,0,256,256,'#c4bfa7');
      ctx.strokeStyle='#657675';ctx.lineWidth=1.1;
      ctx.strokeRect(8,8,240,240);
      for(let room=0;room<8;room++){
        const xx=26+(room%4)*49,yy=42+Math.floor(room/4)*65;
        ctx.strokeRect(xx,yy,45,60);ctx.strokeRect(xx+2,yy+2,41,56);
        line(xx+19,yy+57,14,6,'#c4bfa7');ctx.beginPath();ctx.arc(xx+19,yy+58,13,-Math.PI/2,0);ctx.stroke();
      }
      for(const yy of [29,181]){
        line(24,yy,193,1,'#657675');
        for(let k=0;k<5;k++)line(24+k*49,yy-4,1,8,'#657675');
      }
      text('EAST WORKS',24,212,19,'#5e6c65');text('SERVICES   /   PLAN  08',25,232,11,'#5e6c65');
    } else {
      line(0,0,256,256,'#c3c2ac');line(7,7,242,242,'#969986');line(11,11,234,234,'#c7c5ac');
      text('EAST ARCHIVE',15,58,22,'#535747');
      text(['B – 089','E – 126','C – 311'][i-13],16,145,49,'#454a3c');
      line(14,168,227,3,'#858977');text('RECORD SERIES',16,216,20,'#6c715d');
    }
    // Deposited dirt and handling wear break up the ink at close range.
    for(let n=0;n<1250;n++){
      ctx.fillStyle=random()<.58?'rgba(43,39,31,.13)':'rgba(225,221,194,.19)';
      ctx.fillRect(random()*256,random()*256,1+random()*6,1+random()*1.4);
    }
    ctx.restore();
  }
  return canvas;
}

function graphics() {
  if (graphicMaterial) return graphicMaterial;
  const texture = new THREE.CanvasTexture(instrumentAtlas(getTextureQuality()));
  texture.name='Plant instruments and archive printing';
  texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  graphicMaterial = new THREE.MeshStandardMaterial({map:texture,roughness:.78,vertexColors:true});
  onTextureQualityChange(size=>{
    const previous=texture.image;
    if(previous.width===size)return;
    const replacement=instrumentAtlas(size);
    texture.dispose();texture.image=replacement;texture.needsUpdate=true;
    previous.width=previous.height=1;
  });
  return graphicMaterial;
}

// Constant-width folded corners retain a highlight even on long sheet-metal parts.
function foldedBox(w, h, d, radius) {
  const g = new THREE.BoxGeometry(1,1,1,3,3,3);
  const p = g.attributes.position, normal = g.attributes.normal;
  const half = new THREE.Vector3(w/2,h/2,d/2);
  const r = Math.min(radius,w*.45,h*.45,d*.45);
  const inner = half.clone().addScalar(-r);
  const core = new THREE.Vector3(), v = new THREE.Vector3(), delta = new THREE.Vector3();
  for(let i=0;i<p.count;i++) {
    v.fromBufferAttribute(p,i);
    for(const axis of ['x','y','z']) {
      v[axis] = Math.sign(v[axis])*(Math.abs(v[axis])>.4?half[axis]:inner[axis]);
      core[axis] = THREE.MathUtils.clamp(v[axis],-inner[axis],inner[axis]);
    }
    delta.subVectors(v,core).normalize();
    v.copy(core).addScaledVector(delta,r);
    p.setXYZ(i,v.x,v.y,v.z);normal.setXYZ(i,delta.x,delta.y,delta.z);
  }
  return g;
}

export function plantDetails({add,material}, occluders) {
  function frame(x,y,z,yaw=0) {
    function place(g, m, projected=true) {
      g.rotateY(yaw).translate(x,y,z);
      add(g,typeof m==='string'?material(m):m,projected);
    }
    function solid(px,py,pz,w,h,d,m,r=0,angle=0) {
      const g=r?foldedBox(w,h,d,r):new THREE.BoxGeometry(w,h,d);
      place(g.rotateY(angle).translate(px,py,pz),m);
    }
    function proxy(px,py,pz,w,h,d) {
      const mesh = new THREE.Mesh(collisionCube,proxyMaterial);
      mesh.position.set(px,py,pz).applyAxisAngle(up,yaw).add(new THREE.Vector3(x,y,z));
      mesh.rotation.y=yaw;mesh.scale.set(w,h,d);mesh.updateMatrixWorld();occluders.push(mesh);
    }
    function shaft(from,to,r,m,sides=12,endRadius=r) {
      const a=new THREE.Vector3(...from), b=new THREE.Vector3(...to), axis=b.clone().sub(a);
      const g=new THREE.CylinderGeometry(endRadius,r,axis.length(),sides);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up,axis.normalize()));
      a.lerp(b,.5);place(g.translate(a.x,a.y,a.z),m);
    }
    function ring(px,py,pz,r,thick,m,horizontal=false,segments=40) {
      const g=new THREE.TorusGeometry(r,thick,6,segments);
      if(horizontal)g.rotateX(Math.PI/2);
      place(g.translate(px,py,pz),m);
    }
    function decal(i,px,py,pz,w,h,angle=0,circular=false,horizontal=false) {
      const g=circular?new THREE.CircleGeometry(.5,36):new THREE.PlaneGeometry(1,1);
      const uv=g.attributes.uv;
      for(let k=0;k<uv.count;k++) {
        // Keep filtering inside each tile, including the lower mip levels.
        uv.setXY(k,((i%4)*256+4+uv.getX(k)*248)/1024,
          (768-Math.floor(i/4)*256+4+uv.getY(k)*248)/1024);
      }
      g.scale(w,h,1);
      if(horizontal)g.rotateX(-Math.PI/2);
      place(g.rotateY(angle).translate(px,py,pz),graphics(),false);
    }
    return {place,solid,proxy,shaft,ring,decal};
  }

  function vessel(x,y,z,r,h) {
    const {place,solid,shaft,ring,decal}=frame(x,y,z);
    const base=.13, shoulder=h*.145, radius=r;
    const profile=[[.001,0],[.56,.13],[.82,.35],[.96,.66],[1,1]];
    const points=profile.map(([a,b])=>new THREE.Vector2(radius*a,base+shoulder*b));
    for(const [a,b] of [...profile].reverse())points.push(new THREE.Vector2(radius*a,base+h-shoulder*b));
    const shell=new THREE.LatheGeometry(points,48);
    const uv=shell.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*tau*r,shell.attributes.position.getY(i));
    place(shell,'painted',false);
    for(const k of [.22,.70,.86])ring(0,base+h*k,0,r+.001,k===.70?.011:.007,'sheet',true,48);
    for(const dx of [-1,1])for(const dz of [-1,1]){
      const px=dx*r*.42,pz=dz*r*.42;
      solid(px,.098,pz,.118,.19,.118,'steel',.012);
      solid(px,.020,pz,.21,.035,.20,'sheet',.007);
    }
    // A swept elbow connects the neck to the common overhead run.
    const top=base+h;
    shaft([0,top-.02,0],[0,top+.13,0],.107,'duct',20);
    shaft([0,top+.08,0],[0,top+.12,0],.158,'steel',24);
    for(let n=0;n<6;n++){
      const a=n*tau/6,dx=Math.sin(a)*.134,dz=Math.cos(a)*.134;
      shaft([dx,top+.119,dz],[dx,top+.14,dz],.015,'duct',6);
    }
    shaft([0,top+.13,0],[0,2.56,0],.072,'pipework',20);
    const bend = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0,2.56,0),new THREE.Vector3(0,2.75,0),new THREE.Vector3(0,2.75,-.19));
    place(new THREE.TubeGeometry(bend,10,.072,16,false),'pipework');
    shaft([0,2.75,-.19],[0,2.75,-1.51],.072,'pipework',16);
    for(const dz of [-.35,-1.24])shaft([0,2.75,dz-.022],[0,2.75,dz+.022],.092,'duct',16);
    // Inspection cover, rolled lip and stud circle sit proud of the curved shell.
    const portZ=r*.94;
    shaft([0,1.04,portZ-.06],[0,1.04,portZ+.067],.224,'painted',32);
    shaft([0,1.04,portZ+.061],[0,1.04,portZ+.093],.218,'sheet',32);
    ring(0,1.04,portZ+.092,.175,.009,'steel');
    for(let n=0;n<8;n++){
      const a=n*tau/8,dx=Math.cos(a)*.190,dy=1.04+Math.sin(a)*.190;
      shaft([dx,dy,portZ+.09],[dx,dy,portZ+.106],.018,'steel',6);
    }
    shaft([0,.60,r-.04],[0,.60,r+.22],.058,'pipework',16);
    shaft([0,.60,r+.035],[0,.60,r+.077],.11,'steel',20);
    shaft([0,.60,r+.19],[0,.60,r+.29],.027,'sheet');
    ring(0,.60,r+.28,.135,.016,'valve');
    for(let n=0;n<5;n++){
      const a=n*tau/5;
      shaft([0,.60,r+.23],[Math.cos(a)*.132,.60+Math.sin(a)*.132,r+.28],.010,'valve',8);
    }
    shaft([-.21,1.38,r*.91],[-.21,1.52,r*.91],.027,'pipework');
    shaft([-.21,1.59,r*.91-.02],[-.21,1.59,r*.91+.081],.118,'steel',32);
    ring(-.21,1.59,r*.91+.083,.105,.01,'duct');
    decal(0,-.21,1.59,r*.91+.086,.202,.202,0,true);
    const bearing=.47, rr=r+.024;
    decal(1,Math.sin(bearing)*rr,1.48,Math.cos(bearing)*rr,.19,.145,bearing);
  }

  function condenser(x,y,z,w,d) {
    const {place,solid,proxy,ring,shaft,decal}=frame(x,y,z);
    solid(0,.77,0,w,1.12,d,'duct',.049);proxy(0,.69,0,w,1.29,d);
    for(const dz of [-1,1]) {
      solid(0,.151,dz*d*.36,w+.09,.14,.13,'steel',.012);
      for(const dx of [-1,0,1])solid(dx*w*.40,.065,dz*d*.36,.23,.13,.23,'rubber',.016);
    }
    solid(0,1.337,0,w+.047,.068,d+.044,'sheet',.016);
    const pw=(w-.56)/4;
    for(const side of [-1,1]){
      const faceZ=side*(d/2+.004);
      for(let k=0;k<4;k++){
        const cx=-w/2+.095+pw*(k+.5);
        solid(cx,.77,faceZ,pw-.025,.88,.035,'steel',.012);
        decal(5,cx,.78,faceZ+side*.02,pw-.075,.82,side<0?Math.PI:0);
        for(const div of [-1,0,1])solid(cx,.77+div*.28,faceZ+side*.029,pw-.045,.012,.012,'sheet');
      }
      const cx=w/2-.225;
      solid(cx,.77,faceZ,.378,1.00,.044,'duct',.018);
      decal(2,cx,.80,faceZ+side*.024,.21,.13,side<0?Math.PI:0);
      decal(4,cx,.98,faceZ+side*.024,.10,.087,side<0?Math.PI:0);
      for(const dy of [.39,1.15])for(const dx of [-.145,.145]){
        const zz=faceZ+side*.024;
        shaft([cx+dx,dy,zz],[cx+dx,dy,zz+side*.008],.013,'steel',6);
      }
    }
    for(const side of [-1,1]) {
      const xx=side*(w/2+.007);
      solid(xx,.77,0,.033,.91,d*.83,'steel',.009);
      decal(5,xx+side*.018,.77,0,d*.80,.855,side*Math.PI/2);
      for(let j=-2;j<=2;j++)solid(xx+side*.028,.77,j*d*.15,.014,.89,.017,'duct');
    }
    for(const sx of [-1,1]){
      const cx=sx*w*.246, r=Math.min(d*.389,w*.176);
      shaft([cx,1.352,0],[cx,1.416,0],r,'steel',40);
      shaft([cx,1.415,0],[cx,1.426,0],r*.91,'rubber',40);
      for(let n=0;n<6;n++){
        const a=n*tau/6;
        // Broad pitched blades sweep back between root and tip.
        const pts=[],uv=[],index=[];
        for(let j=0;j<=6;j++){
          const u=j/6,rad=r*(.14+.70*u),center=a-.47*u,span=.48-.20*u;
          for(const sign of [-1,1]){
            const theta=center+sign*span;
            pts.push(cx+Math.sin(theta)*rad,1.437+sign*.016*u,Math.cos(theta)*rad);
            uv.push(u,(sign+1)*.5);
          }
          if(j)index.push(j*2-2,j*2,j*2-1,j*2-1,j*2,j*2+1);
        }
        const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
        g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();place(g,'sheet');
      }
      shaft([cx,1.432,0],[cx,1.49,0],r*.17,'panel',24,r*.14);
      for(const frac of [.30,.45,.59,.72,.85,.97])ring(cx,1.489,0,r*frac,frac>.95?.014:.007,'steel',true,44);
      for(let n=0;n<6;n++){
        const a=n*tau/6,dx=Math.sin(a),dz=Math.cos(a);
        shaft([cx+dx*r*.19,1.49,dz*r*.19],[cx+dx*r*.98,1.489,dz*r*.98],.009,'duct',8);
        shaft([cx+dx*r*.97,1.485,dz*r*.97],[cx+dx*r*1.015,1.373,dz*r*1.015],.012,'steel',10);
        shaft([cx+dx*r*1.015,1.364,dz*r*1.015],[cx+dx*r*1.015,1.383,dz*r*1.015],.026,'duct',6);
      }
    }
  }

  function switchboard(x,y,z) {
    const {solid,shaft,decal,proxy}=frame(x,y,z,z>-5?Math.PI:0);
    for(let k=0;k<4;k++) {
      const px=(k-1.5)*.61;
      solid(px,1.14,0,.59,2.25,.60,'panel',.018);proxy(px,1.14,0,.59,2.25,.60);
      solid(px,1.16,.308,.542,2.08,.036,'filing',.018);
      solid(px,1.72,.33,.427,.36,.021,'steel',.012);
      decal(6,px,1.73,.346,.277,.196);
      for(const i of [-1,0,1]){
        shaft([px+i*.09,1.41,.324],[px+i*.09,1.41,.365],.037,'steel',16);
        shaft([px+i*.09,1.41,.36],[px+i*.09,1.41,.373],.026,i===0 && k!==1?'amber':'rubber',16);
      }
      for(const h of [.45,1.90])solid(px-.264,h,.33,.035,.116,.035,'duct',.009);
      solid(px+.196,1.23,.352,.031,.141,.043,'steel',.008);
      decal(k===0?4:3,px,1.08,.329,.165,.12);
      for(let j=0;j<7;j++)solid(px,.34+j*.033,.333,.31,.011,.016,'panel');
      shaft([px,2.23,0],[px,2.83,0],.052,'duct',16);
      shaft([px,2.24,0],[px,2.31,0],.081,'steel',8);
    }
  }

  function cabinet(x,y,z,count) {
    const {solid,shaft,decal,proxy}=frame(x,y,z,z>-5?Math.PI:0);
    for(let i=0;i<count;i++){
      const px=(i-(count-1)*.5)*.607;
      solid(px,1.02,0,.58,2.04,.54,'filing',.016);proxy(px,1.02,0,.58,2.04,.54);
      solid(px,1.02,.27,.54,1.92,.014,'panel');
      for(let j=0;j<4;j++){
        const dh=.29+j*.467,zz=.296;
        solid(px,dh,zz,.529,.439,.048,'painted',.012);
        solid(px,dh+.083,zz+.031,.143,.082,.019,'sheet',.005);
        decal(13+(i+j)%3,px,dh+.083,zz+.042,.12,.056);
        for(const s of [-1,1])shaft([px+s*.065,dh-.016,zz+.022],[px+s*.065,dh-.019,zz+.060],.013,'duct');
        shaft([px-.065,dh-.019,zz+.06],[px+.065,dh-.019,zz+.06],.014,'sheet',12);
      }
    }
  }

  function shelf(x,y,z,count) {
    const {solid,shaft,decal,proxy}=frame(x,y,z,z>-5?Math.PI:0);
    const w=count*1.79, d=.60;
    for(let k=0;k<=count;k++)for(const side of [-1,1]){
      const px=-w/2+k*1.79,dz=side*d*.5;
      solid(px,1.09,dz,.053,2.18,.033,'steel');
      solid(px-.018,1.09,dz-side*.024,.017,2.18,.044,'sheet');
      solid(px,.020,dz,.093,.037,.091,'steel');
    }
    for(let j=0;j<4;j++){
      const h=.19+j*.56;
      solid(0,h,0,w,.029,d,'sheet');proxy(0,h,0,w,.048,d);
      for(const side of [-1,1])solid(0,h-.025,side*(d/2-.008),w,.061,.02,'sheet');
      for(let k=0;k<count*3;k++){
        const pick=(j*11+k*7+Math.round(x*31+z*7)+1000)%29;
        if((j*7+k*3)%8===0)continue;
        const cx=-w/2+.28+k*1.79/3+.014*Math.sin(pick),hh=.24+.023*(pick%5);
        const cz=.036*Math.sin(k*5+j),cw=.39+.021*(pick%4),cd=.41+.012*(pick%3);
        const bottom=h+.016;
        solid(cx,bottom+hh*.5,cz,cw,hh,cd,'archive',.007);
        proxy(cx,bottom+hh*.5,cz,cw,hh,cd);
        const lid=bottom+hh-.009;
        solid(cx,lid,cz,cw+.017,.048,cd+.019,'archive',.006);
        for(const side of [-1,1]){
          decal(7+pick%5,cx,bottom+hh*.45,cz+side*(cd*.5+.0009),cw*.995,hh*.86,side<0?Math.PI:0);
        }
        solid(cx,lid+.025,cz,.039,.002,cd+.013,'archive');
      }
    }
    for(let k=0;k<count;k++){
      const a=-w/2+k*1.79+.028,b=a+1.734;
      shaft([a,.26,-.292],[b,1.82,-.292],.011,'duct',8);
      shaft([a,1.82,-.30],[b,.26,-.30],.011,'duct',8);
    }
  }
  function bench(x,y,z) {
    const {solid,shaft,ring,decal}=frame(x,y+.935,z,z>-5?Math.PI:0);
    if(y<0 || (y===0 && z< -5)) {
      // The fitters' vise overhangs the bench edge. Bolted cast feet support its body.
      const px=-.69;
      shaft([px,.002,.232],[px,.055,.232],.136,'steel',28,.122);
      solid(px,.132,.240,.158,.162,.272,'painted',.026);
      solid(px,.216,.165,.192,.082,.11,'painted',.017);
      solid(px,.226,.268,.193,.093,.061,'sheet',.009);
      solid(px,.206,.372,.190,.13,.073,'painted',.015);
      solid(px,.238,.338,.193,.058,.019,'sheet',.005);
      shaft([px,.156,.191],[px,.156,.437],.039,'duct',16);
      shaft([px-.076,.083,.437],[px+.06,.209,.437],.009,'sheet');
      for(const side of [-1,1]) {
        const dx=px+side*.114;
        shaft([dx,.002,.205],[dx,.030,.205],.028,'steel',6);
      }
      // Short service flanges have open bores and machined faces.
      for(const [dx,dz,r] of [[.25,.035,.109],[.53,.082,.085],[.77,-.10,.105]]){
        for(const height of [.017,.047])ring(dx,height,dz,r,.016,'sheet',true,28);
        ring(dx,.030,dz,r,.021,'pipework',true,28);
      }
    } else {
      const px=.42,angle=-.15;
      solid(px,.009,-.02,.74,.016,.54,'archive',.006,angle);
      decal(12,px,.021,-.02,.72,.52,angle,false,true);
      for(let k=0;k<2;k++){
        const dx=-.44+k*.07,dz=.10-k*.13,rr=.047-k*.006;
        shaft([dx-.24,rr,dz-.17],[dx+.24,rr,dz+.17],rr,'archive',22);
        shaft([dx+.239,rr,dz+.169],[dx+.244,rr,dz+.173],rr*.52,'panel',18);
      }
    }
  }
  return {vessel,condenser,switchboard,cabinet,shelf,bench};
}
