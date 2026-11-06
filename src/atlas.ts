import type { MapData, RadarMarker } from './types';
import { BIOME_COLORS } from './types';
import type { MapPoint, Navigation } from './navigation';
import './map.css';

/** Canvas atlas has its own pause state; opening it never changes the active run. */
export function createAtlas(container:HTMLElement,map:MapData,nav:Navigation,onChange:()=>void,onOpen:()=>void) {
  const root=document.createElement('section');root.className='dl-atlas';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Карта изученной территории');
  root.innerHTML=`<header><div><span>ИЗУЧЕННАЯ ТЕРРИТОРИЯ</span><h1>КАРТА</h1></div><div class="dl-atlas-tools"><button data-map="center" aria-label="Найти машину">К МАШИНЕ</button><button data-map="out" aria-label="Отдалить карту">−</button><button data-map="in" aria-label="Приблизить карту">+</button><button data-map="close" aria-label="Закрыть карту">ЗАКРЫТЬ ×</button></div></header><canvas aria-label="Карта: нажми, чтобы поставить точку назначения"></canvas><footer><span>Клик — поставить точку · тяни карту — обзор · колесо — масштаб</span><strong data-map-distance>ВЫБЕРИ ТОЧКУ НАЗНАЧЕНИЯ</strong><button data-map="clear">УБРАТЬ ТОЧКУ</button><span class="dl-atlas-legend"><i></i> Вы <i></i> Гараж <i></i> Точка</span></footer>`;
  container.append(root);
  const canvas=root.querySelector('canvas')!,ctx=canvas.getContext('2d')!;
  const distance=root.querySelector<HTMLElement>('[data-map-distance]')!,clear=root.querySelector<HTMLButtonElement>('[data-map="clear"]')!;
  const mini=document.createElement('canvas');mini.className='dl-waypoint-radar';mini.setAttribute('aria-hidden','true');
  const miniBase=container.querySelector<HTMLCanvasElement>('[data-ui="minimap"]')!;miniBase.parentElement!.append(mini);
  const miniCtx=mini.getContext('2d')!;
  const bearing=document.createElement('span');bearing.className='dl-waypoint-distance';bearing.hidden=true;miniBase.parentElement!.append(bearing);
  let x=0,z=0,angle=0,centerX=0,centerZ=0,range=240,w=800,h=600,dpr=1,lastDraw=0;
  let markers:RadarMarker[]=[],drag:{x:number;y:number;cx:number;cz:number;moved:boolean}|undefined;
  let previousFocus:HTMLElement|null=null;
  let miniSizeDirty=true,miniVisible=false,miniWidth=0,miniHeight=0,miniRatio=1,radarRange=100;
  // Each discovered cell is sampled once; exploration survives chunk unloading.
  const tiles=new Map<string,string[]>();
  const terrain=BIOME_COLORS;
  function project(p:MapPoint){const scale=h/(range*2);return {x:w/2+(p.x-centerX)*scale,y:h/2-(p.z-centerZ)*scale};}
  function unproject(px:number,py:number){const scale=h/(range*2);return {x:centerX+(px-w/2)/scale,z:centerZ-(py-h/2)/scale};}
  function diamond(px:number,py:number,r:number,color:string){ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(px,py-r);ctx.lineTo(px+r,py);ctx.lineTo(px,py+r);ctx.lineTo(px-r,py);ctx.closePath();ctx.fill();}
  function resize(){miniSizeDirty=true;if(root.hidden)return;const rect=canvas.getBoundingClientRect();w=Math.max(1,rect.width);h=Math.max(1,rect.height);dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);draw();}
  function draw(){if(root.hidden)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#131b19';ctx.fillRect(0,0,w,h);
    const scale=h/(range*2),step=nav.cellSize/4;
    const min=unproject(0,h),max=unproject(w,0);
    for(let iz=Math.floor(min.z/nav.cellSize);iz<=Math.floor(max.z/nav.cellSize);iz++)for(let ix=Math.floor(min.x/nav.cellSize);ix<=Math.floor(max.x/nav.cellSize);ix++){
      const key=`${ix},${iz}`;if(!nav.explored.has(key))continue;
      let colors=tiles.get(key);if(!colors){colors=[];for(let dz=0;dz<4;dz++)for(let dx=0;dx<4;dx++){const wx=ix*nav.cellSize+(dx+.5)*step,wz=iz*nav.cellSize+(dz+.5)*step;colors.push(map.isRoad(wx,wz)?'#8c9389':terrain[map.biomeAt(wx,wz)]);}tiles.set(key,colors);if(tiles.size>4096)tiles.delete(tiles.keys().next().value!);}
      for(let dz=0;dz<4;dz++)for(let dx=0;dx<4;dx++){const p=project({x:ix*nav.cellSize+dx*step,z:iz*nav.cellSize+(dz+1)*step});ctx.fillStyle=colors[dz*4+dx];ctx.fillRect(p.x,p.y,step*scale+.5,step*scale+.5);}
    }
    ctx.strokeStyle='#e6ef6410';ctx.lineWidth=1;
    for(let gx=Math.floor(min.x/100)*100;gx<max.x;gx+=100){const p=project({x:gx,z:0});ctx.beginPath();ctx.moveTo(p.x,0);ctx.lineTo(p.x,h);ctx.stroke();}
    for(let gz=Math.floor(min.z/100)*100;gz<max.z;gz+=100){const p=project({x:0,z:gz});ctx.beginPath();ctx.moveTo(0,p.y);ctx.lineTo(w,p.y);ctx.stroke();}
    for(const g of map.garages){if(!nav.isExplored(g.x,g.z))continue;const p=project(g);ctx.fillStyle='#e6ef64';ctx.fillRect(p.x-9,p.y-9,18,18);ctx.fillStyle='#152119';ctx.font='bold 13px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('G',p.x,p.y+.5);}
    for(const m of markers){if(!nav.isExplored(m.x,m.z))continue;const p=project(m);if(m.type==='police'||m.type==='helicopter')diamond(p.x,p.y,4,m.type==='police'?'#f47765':'#c8a0ff');}
    if(nav.waypoint){const p=project(nav.waypoint),from=project({x,z});ctx.strokeStyle='#64d9ed';ctx.lineWidth=2;ctx.setLineDash([7,7]);ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.setLineDash([]);diamond(p.x,p.y,11,'#64d9ed');diamond(p.x,p.y,5,'#182a29');}
    const p=project({x,z});ctx.save();ctx.translate(p.x,p.y);ctx.rotate(angle);ctx.fillStyle='#e6ef64';ctx.strokeStyle='#14221a';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-11);ctx.lineTo(7,8);ctx.lineTo(0,4);ctx.lineTo(-7,8);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    ctx.fillStyle='#b7c9b4';ctx.font='12px Arial';ctx.textAlign='left';ctx.fillText(`N ↑   /   ${Math.round(range*2)} м`,18,26);
    distance.textContent=nav.waypoint?`ДО ТОЧКИ ${Math.round(nav.distance(x,z))} М`:'ВЫБЕРИ ТОЧКУ НАЗНАЧЕНИЯ';clear.disabled=!nav.waypoint;
  }
  function drawMini(){
    // Most frames have no waypoint; avoid forcing layout after the HUD updates.
    if(!nav.waypoint){if(miniVisible){mini.hidden=true;bearing.hidden=true;miniVisible=false;}return;}
    if(!miniVisible){mini.hidden=false;bearing.hidden=false;miniVisible=true;miniSizeDirty=true;}
    if(miniSizeDirty){miniWidth=miniBase.clientWidth;miniHeight=miniBase.clientHeight;miniRatio=Math.min(2,window.devicePixelRatio||1);mini.style.width=`${miniWidth}px`;mini.style.height=`${miniHeight}px`;mini.width=Math.round(miniWidth*miniRatio);mini.height=Math.round(miniHeight*miniRatio);miniSizeDirty=false;}
    const width=miniWidth,height=miniHeight;miniCtx.setTransform(miniRatio,0,0,miniRatio,0,0);miniCtx.clearRect(0,0,width,height);
    const label=`◆ ${Math.round(nav.distance(x,z))} м`;if(bearing.textContent!==label)bearing.textContent=label;
    const dx=(nav.waypoint.x-x)*width/(radarRange*2),dy=-(nav.waypoint.z-z)*height/(radarRange*2),clamp=Math.min(1,(width/2-12)/Math.max(.01,Math.abs(dx)),(height/2-12)/Math.max(.01,Math.abs(dy))),px=width/2+dx*clamp,py=height/2+dy*clamp;
    miniCtx.strokeStyle='#64d9ed';miniCtx.lineWidth=2;miniCtx.setLineDash([4,5]);miniCtx.beginPath();const length=Math.max(1,Math.hypot(dx,dy));miniCtx.moveTo(width/2+dx/length*12,height/2+dy/length*12);miniCtx.lineTo(px,py);miniCtx.stroke();miniCtx.setLineDash([]);
    miniCtx.save();miniCtx.translate(px,py);if(clamp<1){miniCtx.rotate(Math.atan2(dy,dx));miniCtx.fillStyle='#64d9ed';miniCtx.beginPath();miniCtx.moveTo(8,0);miniCtx.lineTo(-5,-6);miniCtx.lineTo(-2,0);miniCtx.lineTo(-5,6);miniCtx.closePath();miniCtx.fill();}else{miniCtx.fillStyle='#64d9ed';miniCtx.fillRect(-5,-5,10,10);}miniCtx.restore();
  }
  function close(){root.hidden=true;document.body.classList.remove('dl-map-open');previousFocus?.focus({preventScroll:true});}
  function open(){if(!root.hidden)return;onOpen();previousFocus=document.activeElement as HTMLElement;root.hidden=false;document.body.classList.add('dl-map-open');centerX=x;centerZ=z;resize();root.querySelector<HTMLButtonElement>('[data-map="close"]')!.focus({preventScroll:true});}
  root.addEventListener('click',event=>{const action=(event.target as Element).closest<HTMLElement>('[data-map]')?.dataset.map;if(action==='close')close();if(action==='center'){centerX=x;centerZ=z;draw();}if(action==='in'){range=Math.max(80,range/1.5);draw();}if(action==='out'){range=Math.min(3200,range*1.5);draw();}if(action==='clear'){nav.setWaypoint(undefined);onChange();draw();drawMini();}});
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;canvas.setPointerCapture(event.pointerId);drag={x:event.clientX,y:event.clientY,cx:centerX,cz:centerZ,moved:false};});
  canvas.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>5)drag.moved=true;if(drag.moved){centerX=drag.cx-dx*range*2/h;centerZ=drag.cz+dy*range*2/h;draw();}});
  canvas.addEventListener('pointerup',event=>{if(!drag)return;if(!drag.moved){const rect=canvas.getBoundingClientRect();nav.setWaypoint(unproject(event.clientX-rect.left,event.clientY-rect.top));onChange();draw();drawMini();}drag=undefined;});
  canvas.addEventListener('pointercancel',()=>drag=undefined);
  canvas.addEventListener('wheel',event=>{event.preventDefault();range=Math.max(80,Math.min(3200,range*Math.exp(event.deltaY*.001)));draw();},{passive:false});
  window.addEventListener('resize',resize);
  mini.hidden=true;
  return {get isOpen(){return !root.hidden;},open,close,toggle(){root.hidden?open():close();},update(px:number,pz:number,a:number,list:RadarMarker[],viewRange=100){x=px;z=pz;angle=a;markers=list;radarRange=Number.isFinite(viewRange)?Math.max(50,Math.min(250,viewRange)):100;drawMini();if(!root.hidden&&performance.now()-lastDraw>200){draw();lastDraw=performance.now();}},dispose(){close();window.removeEventListener('resize',resize);root.remove();mini.remove();bearing.remove();tiles.clear();}};
}
