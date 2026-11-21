// Static occluders are indexed into the same lattice as the probes. Exact
// ray/box intersections inside occupied cells retain thin walls and shelf gaps.
export function bakeFixtureVolume({origin,size,cell,fixtures,boxes}) {
  const [nx,ny,nz]=size, [ox,oy,oz]=origin, xy=nx*ny, count=xy*nz;
  const invCell=1/cell;
  const heads=new Int32Array(count);
  let capacity=131072, listSize=1;
  let next=new Int32Array(capacity), objects=new Int32Array(capacity);
  const visited=new Int32Array(boxes.length/6);
  let rayId=0;
  const maxX=ox+nx*cell, maxY=oy+ny*cell, maxZ=oz+nz*cell;
  for(let b=0;b<boxes.length;b+=6){
    if(boxes[b+3]<ox || boxes[b]>maxX || boxes[b+4]<oy || boxes[b+1]>maxY || boxes[b+5]<oz || boxes[b+2]>maxZ)continue;
    let x0=Math.floor((boxes[b]-ox)*invCell), x1=Math.floor((boxes[b+3]-ox)*invCell);
    let y0=Math.floor((boxes[b+1]-oy)*invCell), y1=Math.floor((boxes[b+4]-oy)*invCell);
    let z0=Math.floor((boxes[b+2]-oz)*invCell), z1=Math.floor((boxes[b+5]-oz)*invCell);
    if(x0<0)x0=0; if(x1>=nx)x1=nx-1;
    if(y0<0)y0=0; if(y1>=ny)y1=ny-1;
    if(z0<0)z0=0; if(z1>=nz)z1=nz-1;
    const needed=(x1-x0+1)*(y1-y0+1)*(z1-z0+1);
    if(listSize+needed>=capacity){
      while(listSize+needed>=capacity)capacity<<=1;
      const nNext=new Int32Array(capacity), nObj=new Int32Array(capacity);
      nNext.set(next); nObj.set(objects);
      next=nNext; objects=nObj;
    }
    const id=b/6;
    for(let z=z0;z<=z1;z++){
      const zOff=xy*z;
      for(let y=y0;y<=y1;y++){
        const yOff=zOff+nx*y;
        for(let x=x0;x<=x1;x++){
          const index=yOff+x;
          next[listSize]=heads[index];
          objects[listSize]=id;
          heads[index]=listSize++;
        }
      }
    }
  }

  function hitsBox(b,px,py,pz,rx,ry,rz){
    const xa=(boxes[b]-px)*rx,xb=(boxes[b+3]-px)*rx;
    const ya=(boxes[b+1]-py)*ry,yb=(boxes[b+4]-py)*ry;
    const za=(boxes[b+2]-pz)*rz,zb=(boxes[b+5]-pz)*rz;
    const near=Math.max(.003,xa<xb?xa:xb,ya<yb?ya:yb,za<zb?za:zb);
    const far=Math.min(.998,xa>xb?xa:xb,ya>yb?ya:yb,za>zb?za:zb);
    return near<far;
  }

  // Returns -1 when visible, or the blocking box byte offset when occluded.
  function findBlocker(px,py,pz,ix,iy,iz,lx,ly,lz,hintBox) {
    const dx=lx-px,dy=ly-py,dz=lz-pz;
    const rx=1/(dx||1e-10),ry=1/(dy||1e-10),rz=1/(dz||1e-10);
    if(hintBox>=0 && hitsBox(hintBox,px,py,pz,rx,ry,rz)) return hintBox;
    const sx=dx>=0?1:-1,sy=dy>=0?nx:-nx,sz=dz>=0?xy:-xy;
    const ax=Math.abs(cell*rx),ay=Math.abs(cell*ry),az=Math.abs(cell*rz);
    // Every ray starts on a probe centre, half a cell from the first boundary.
    let tx=ax*.5,ty=ay*.5,tz=az*.5;
    let index=ix+iy*nx+iz*xy;
    const stamp=++rayId;
    while(true){
      for(let n=heads[index];n;n=next[n]){
        const id=objects[n];
        if(visited[id]===stamp)continue;
        visited[id]=stamp;
        const b=id*6;
        if(hitsBox(b,px,py,pz,rx,ry,rz))return b;
      }
      if(tx<ty && tx<tz){if(tx>=1)return -1;index+=sx;tx+=ax;}
      else if(ty<tz){if(ty>=1)return -1;index+=sy;ty+=ay;}
      else{if(tz>=1)return -1;index+=sz;tz+=az;}
    }
  }

  // The first angular moment carries the energy-weighted direction. Three
  // positions across each tube make the shadow of a cabinet soften with distance.
  const light=new Float32Array(count*4);
  const radius=6.3, radius2=radius*radius, invRadius2=1/radius2;
  for(const [lx,ly,lz,length] of fixtures) {
    let x0=Math.floor((lx-radius-ox)*invCell), x1=Math.floor((lx+radius-ox)*invCell);
    let y0=Math.floor((ly-3.02-oy)*invCell), y1=Math.floor((ly+.24-oy)*invCell);
    let z0=Math.floor((lz-radius-oz)*invCell), z1=Math.floor((lz+radius-oz)*invCell);
    if(x0<0)x0=0; if(x1>=nx)x1=nx-1;
    if(y0<0)y0=0; if(y1>=ny)y1=ny-1;
    if(z0<0)z0=0; if(z1>=nz)z1=nz-1;
    const halfSpan=length*.37, basePower=2.9*length/3;
    for(let iz=z0;iz<=z1;iz++){
      const pz=oz+(iz+.5)*cell, dz=lz-pz, dz2=dz*dz;
      const zOff=iz*xy;
      for(let iy=y0;iy<=y1;iy++){
        const py=oy+(iy+.5)*cell, dy=ly-py, dyz2=dy*dy+dz2;
        if(dyz2>=radius2)continue;
        const yOff=zOff+iy*nx;
        for(let ix=x0;ix<=x1;ix++){
          const px=ox+(ix+.5)*cell, dx=lx-px, d2=dx*dx+dyz2;
          if(d2>=radius2)continue;
          // Test center first; any wall/floor blocking the center almost always
          // blocks both tube endpoints too, skipping 2 full DDA traversals.
          const centerBlocker=findBlocker(px,py,pz,ix,iy,iz,lx,ly,lz,-1);
          const leftBlocker=findBlocker(px,py,pz,ix,iy,iz,lx-halfSpan,ly,lz,centerBlocker);
          const rightBlocker=findBlocker(px,py,pz,ix,iy,iz,lx+halfSpan,ly,lz,centerBlocker>=0?centerBlocker:leftBlocker);
          if(centerBlocker>=0 && leftBlocker>=0 && rightBlocker>=0)continue;
          const dest=4*(yOff+ix);
          const edge=1-d2*invRadius2;
          const amount=basePower*edge*edge/(1+.39*d2);
          if(centerBlocker<0){
            const invL=1/Math.max(.16,Math.sqrt(d2));
            light[dest]+=amount*dx*invL; light[dest+1]+=amount*dy*invL;
            light[dest+2]+=amount*dz*invL; light[dest+3]+=amount;
          }
          if(leftBlocker<0){
            const ddx=dx-halfSpan;
            const invL=1/Math.max(.16,Math.sqrt(ddx*ddx+dyz2));
            light[dest]+=amount*ddx*invL; light[dest+1]+=amount*dy*invL;
            light[dest+2]+=amount*dz*invL; light[dest+3]+=amount;
          }
          if(rightBlocker<0){
            const ddx=dx+halfSpan;
            const invL=1/Math.max(.16,Math.sqrt(ddx*ddx+dyz2));
            light[dest]+=amount*ddx*invL; light[dest+1]+=amount*dy*invL;
            light[dest+2]+=amount*dz*invL; light[dest+3]+=amount;
          }
        }
      }
    }
  }
  const pixels=new Uint8Array(count*4);
  for(let i=0;i<pixels.length;i+=4){
    const energy=light[i+3],multiplier=energy>0?127/energy:0;
    pixels[i]=Math.round(128+light[i]*multiplier);pixels[i+1]=Math.round(128+light[i+1]*multiplier);
    pixels[i+2]=Math.round(128+light[i+2]*multiplier);pixels[i+3]=Math.round(255*energy/(2+energy));
  }
  return pixels;
}

if(typeof WorkerGlobalScope!=='undefined' && self instanceof WorkerGlobalScope){
  self.onmessage=({data})=>{
    const pixels=bakeFixtureVolume(data);
    self.postMessage(pixels,[pixels.buffer]);
  };
}
