// Static occluders are indexed into the same lattice as the probes. Exact
// ray/box intersections inside occupied cells retain thin walls and shelf gaps.
export function bakeFixtureVolume({origin,size,cell,fixtures,boxes}) {
  const [nx,ny,nz]=size, [ox,oy,oz]=origin, xy=nx*ny, count=xy*nz;
  const heads=new Int32Array(count), next=[0], objects=[0];
  const visited=new Int32Array(boxes.length/6);
  let rayId=0;
  const coord=(v,o)=>Math.floor((v-o)/cell);
  const limit=(v,maximum)=>Math.max(0,Math.min(maximum-1,v));
  for(let b=0;b<boxes.length;b+=6){
    if(boxes[b+3]<ox || boxes[b]>ox+nx*cell || boxes[b+4]<oy || boxes[b+1]>oy+ny*cell || boxes[b+5]<oz || boxes[b+2]>oz+nz*cell)continue;
    const x0=limit(coord(boxes[b],ox),nx),x1=limit(coord(boxes[b+3],ox),nx);
    const y0=limit(coord(boxes[b+1],oy),ny),y1=limit(coord(boxes[b+4],oy),ny);
    const z0=limit(coord(boxes[b+2],oz),nz),z1=limit(coord(boxes[b+5],oz),nz);
    for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const index=x+nx*y+xy*z;
      next.push(heads[index]);objects.push(b);heads[index]=next.length-1;
    }
  }
  function visible(px,py,pz,ix,iy,iz,lx,ly,lz) {
    const dx=lx-px,dy=ly-py,dz=lz-pz;
    const rx=1/(dx||1e-10),ry=1/(dy||1e-10),rz=1/(dz||1e-10);
    const sx=dx>=0?1:-1,sy=dy>=0?1:-1,sz=dz>=0?1:-1;
    const ax=Math.abs(cell*rx),ay=Math.abs(cell*ry),az=Math.abs(cell*rz);
    // Every ray starts on a probe centre, half a cell from the first boundary.
    let tx=ax*.5,ty=ay*.5,tz=az*.5;
    let index=ix+iy*nx+iz*xy;
    rayId++;
    while(true){
      for(let n=heads[index];n;n=next[n]){
        const b=objects[n],id=b/6;
        if(visited[id]===rayId)continue;
        visited[id]=rayId;
        const xa=(boxes[b]-px)*rx,xb=(boxes[b+3]-px)*rx;
        const ya=(boxes[b+1]-py)*ry,yb=(boxes[b+4]-py)*ry;
        const za=(boxes[b+2]-pz)*rz,zb=(boxes[b+5]-pz)*rz;
        const near=Math.max(.003,Math.min(xa,xb),Math.min(ya,yb),Math.min(za,zb));
        const far=Math.min(.998,Math.max(xa,xb),Math.max(ya,yb),Math.max(za,zb));
        if(near<far)return false;
      }
      if(tx<ty && tx<tz){if(tx>=1)return true;index+=sx;tx+=ax;}
      else if(ty<tz){if(ty>=1)return true;index+=sy*nx;ty+=ay;}
      else{if(tz>=1)return true;index+=sz*xy;tz+=az;}
    }
  }

  // The first angular moment carries the energy-weighted direction. Three
  // positions across each tube make the shadow of a cabinet soften with distance.
  const light=new Float32Array(count*4);
  const radius=6.3, radius2=radius*radius;
  for(const [lx,ly,lz,length] of fixtures) {
    const x0=limit(coord(lx-radius,ox),nx),x1=limit(coord(lx+radius,ox),nx);
    const y0=limit(coord(ly-3.40,oy),ny),y1=limit(coord(ly+.38,oy),ny);
    const z0=limit(coord(lz-radius,oz),nz),z1=limit(coord(lz+radius,oz),nz);
    for(let iz=z0;iz<=z1;iz++){
      const pz=oz+(iz+.5)*cell,dz=lz-pz;
      for(let iy=y0;iy<=y1;iy++){
        const py=oy+(iy+.5)*cell,dy=ly-py;
        for(let ix=x0;ix<=x1;ix++){
          const px=ox+(ix+.5)*cell,dx=lx-px,d2=dx*dx+dy*dy+dz*dz;
          if(d2>=radius2)continue;
          const dest=4*(ix+iy*nx+iz*xy);
          // The squared cutoff reaches zero without a visible radius boundary.
          const edge=1-d2/radius2;
          const power=2.9*length*edge*edge/(1+.39*d2);
          for(const along of [-.37,0,.37]){
            const sx=lx+length*along;
            if(!visible(px,py,pz,ix,iy,iz,sx,ly,lz))continue;
            const ddx=sx-px;
            const invLength=1/Math.max(.16,Math.sqrt(ddx*ddx+dy*dy+dz*dz));
            const amount=power/3;
            light[dest]+=amount*ddx*invLength;light[dest+1]+=amount*dy*invLength;
            light[dest+2]+=amount*dz*invLength;light[dest+3]+=amount;
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
