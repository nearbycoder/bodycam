import {Vector3} from 'three';

const spacing=.4, eye=1.58;
export const decks=['B1 · Utility basement','G · Works floor','01 · Records floor','02 · Roof plant'];
export const deckAt=foot=>Math.max(0,Math.min(3,Math.round(foot/3.2)+1));
const offsets=[[1,0],[-1,0],[0,1],[0,-1]];

// Trace the same collision volume the operator uses. Stacked walkable positions
// occupy separate cells, including the overlapping flights of a switchback.
export function buildNavigation(world){
  const nodes=[], columns=new Map(), start=world.spawn, probe=new Vector3();
  let cursor=0;
  function add(ix,iz,y){
    const key=ix+','+iz, column=columns.get(key)||[];
    const existing=column.find(n=>Math.abs(n.y-y)<.18);
    if(existing)return existing;
    const node={ix,iz,x:start.x+ix*spacing,z:start.z+iz*spacing,y,id:nodes.length,edges:[]};
    column.push(node);columns.set(key,column);nodes.push(node);return node;
  }
  add(0,0,start.y-eye);
  function advance(budget=4){
    const until=performance.now()+budget;
    while(cursor<nodes.length&&performance.now()<until){
      const n=nodes[cursor++];
      for(const [dx,dz] of offsets){
        probe.set(n.x,n.y+eye,n.z);
        world.move(probe,dx*spacing,dz*spacing);
        if(Math.abs(probe.x-n.x-dx*spacing)>.02 || Math.abs(probe.z-n.z-dz*spacing)>.02)continue;
        n.edges.push(add(n.ix+dx,n.iz+dz,probe.y-eye).id);
      }
    }
  }
  function snap(x,y,z){
    const ix=Math.round((x-start.x)/spacing),iz=Math.round((z-start.z)/spacing);
    let best=null,dist=Infinity;
    for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
      for(const n of columns.get((ix+dx)+','+(iz+dz))||[]){
        const d=(n.x-x)**2+(n.z-z)**2+4*(n.y-y)**2;
        if(d<dist){best=n;dist=d;}
      }
    }
    return best&&dist<2.6?best:null;
  }
  function labels(deck) {
    const groups=new Map();
    for(const node of nodes){
      if(deckAt(node.y)!==deck)continue;
      const sector=world.sector({x:node.x,y:node.y+eye,z:node.z});
      if(!groups.has(sector))groups.set(sector,[]);
      groups.get(sector).push(node);
    }
    const result=[];
    for(const [name,group] of groups){
      if(!name||group.length<32)continue;
      const cx=group.reduce((sum,n)=>sum+n.x,0)/group.length;
      const cz=group.reduce((sum,n)=>sum+n.z,0)/group.length;
      const n=group.reduce((best,n)=>Math.hypot(n.x-cx,n.z-cz)<Math.hypot(best.x-cx,best.z-cz)?n:best);
      result.push({name,x:n.x,z:n.z});
    }
    return result;
  }
  function route(position,targets){
    if(cursor<nodes.length||!targets.length)return [];
    const from=snap(position.x,position.y-eye,position.z);
    if(!from)return [];
    const goals=new Map();
    for(const t of targets){const n=snap(t.x,t.y-1.30,t.z);if(n)goals.set(n.id,t);}
    const queue=[from.id],parent=new Int32Array(nodes.length);parent.fill(-1);parent[from.id]=from.id;
    for(let head=0;head<queue.length;head++){
      let id=queue[head];
      if(goals.has(id)){
        const path=[];
        while(id!==from.id){path.push(nodes[id]);id=parent[id];}
        path.push(from);path.reverse();
        return path;
      }
      for(const next of nodes[id].edges)if(parent[next]===-1){parent[next]=id;queue.push(next);}
    }
    return [];
  }
  return {advance,route,labels,nodes,get ready(){return cursor===nodes.length;}};
}

const backgrounds=new Map();
export function drawFloorPlan(canvas,deck,nav,position,yaw,targets,path){
  const w=900,h=552, g=canvas.getContext('2d');
  if(canvas.width!==w){canvas.width=w;canvas.height=h;}
  const scale=23, px=x=>(x+4.85)*scale, pz=z=>(z+20.47)*scale;
  if(!backgrounds.has(deck)||!nav.ready){
    const layer=document.createElement('canvas');layer.width=w;layer.height=h;
    const bg=layer.getContext('2d');
    bg.fillStyle='#101814';bg.fillRect(0,0,w,h);
    bg.strokeStyle='#26332a';bg.lineWidth=1;bg.beginPath();
    for(let x=0;x<w;x+=scale){bg.moveTo(x,0);bg.lineTo(x,h);}
    for(let z=0;z<h;z+=scale){bg.moveTo(0,z);bg.lineTo(w,z);}bg.stroke();
    const step=spacing*scale;
    const floor=nav.nodes.filter(n=>deckAt(n.y)===deck);
    const occupied=new Set(floor.map(n=>n.ix+','+n.iz));
    bg.strokeStyle='#a2b29a';bg.lineWidth=1;bg.beginPath();
    for(const n of floor){
      const left=px(n.x)-step/2,top=pz(n.z)-step/2;
      bg.fillStyle=Math.abs(n.y-(deck-1)*3.2)>.15?'#718069':'#3a4a40';
      bg.fillRect(left,top,step+.35,step+.35);
      for(const [dx,dz] of offsets){
        if(occupied.has((n.ix+dx)+','+(n.iz+dz)))continue;
        const x=left+(dx>0?step:0),z=top+(dz>0?step:0);
        bg.moveTo(x,z);bg.lineTo(x+(dz?step:0),z+(dx?step:0));
      }
    }
    bg.stroke();
    const used=[];
    bg.font='bold 11px monospace';bg.textAlign='center';
    for(const {name,x,z} of nav.labels(deck)){
      const label=name.toUpperCase(),cx=px(x),cy=pz(z),width=bg.measureText(label).width;
      if(used.some(r=>Math.abs(r.x-cx)<(r.w+width)/2+4&&Math.abs(r.y-cy)<15))continue;
      used.push({x:cx,y:cy,w:width});bg.fillStyle='#26352de8';bg.fillRect(cx-width/2-3,cy-9,width+6,14);
      bg.fillStyle='#e6ecde';bg.fillText(label,cx,cy+2);
    }
    bg.textAlign='left';bg.fillStyle='#a4b19f';bg.fillRect(20,h-25,scale*3,2);
    bg.fillText('3 m',23,h-31);
    if(nav.ready)backgrounds.set(deck,layer);
    g.drawImage(layer,0,0);
  }else g.drawImage(backgrounds.get(deck),0,0);
  g.strokeStyle='#dcf976';g.lineWidth=2.7;g.setLineDash([4,5]);g.beginPath();
  let fresh=true;
  for(const n of path){if(deckAt(n.y)!==deck){fresh=true;continue;}
    if(fresh)g.moveTo(px(n.x),pz(n.z));else g.lineTo(px(n.x),pz(n.z));fresh=false;}
  g.stroke();g.setLineDash([]);
  for(const t of targets)if(deckAt(t.y-1.30)===deck){
    g.save();g.translate(px(t.x),pz(t.z));g.rotate(Math.PI/4);g.fillStyle='#ffa372';g.fillRect(-4,-4,8,8);g.restore();
  }
  if(deckAt(position.y-eye)===deck){
    g.save();g.translate(px(position.x),pz(position.z));g.rotate(-yaw);
    g.fillStyle='#e1ff80';g.beginPath();g.moveTo(0,-10);g.lineTo(6,6);g.lineTo(0,3);g.lineTo(-6,6);g.closePath();g.fill();g.restore();
  }
}
