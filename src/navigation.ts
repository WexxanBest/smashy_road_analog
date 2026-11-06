export interface MapPoint { x:number; z:number; }

/** Sparse discovery, independent of loaded world chunks and render distance. */
export function createNavigation(cellSize=20, revealRadius=95) {
  const explored=new Set<string>();
  let destination:MapPoint|undefined;
  let lastX=Infinity,lastZ=Infinity,lastRadius=0;
  const key=(x:number,z:number)=>`${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`;
  return {
    cellSize, explored,
    get waypoint(){return destination;},
    isExplored(x:number,z:number){return explored.has(key(x,z));},
    discover(x:number,z:number,range=revealRadius){
      if(!Number.isFinite(x)||!Number.isFinite(z))return;
      if((x-lastX)**2+(z-lastZ)**2<4&&range<=lastRadius)return;
      lastX=x;lastZ=z;lastRadius=range;const radius=range+cellSize*.7;
      for(let iz=Math.floor((z-range)/cellSize);iz<=Math.floor((z+range)/cellSize);iz++)
        for(let ix=Math.floor((x-range)/cellSize);ix<=Math.floor((x+range)/cellSize);ix++)
          if(((ix+.5)*cellSize-x)**2+((iz+.5)*cellSize-z)**2<radius*radius)explored.add(`${ix},${iz}`);
    },
    setWaypoint(point:MapPoint|undefined){destination=point&&Number.isFinite(point.x)&&Number.isFinite(point.z)?{...point}:undefined;},
    distance(x:number,z:number){return destination?Math.hypot(destination.x-x,destination.z-z):Infinity;},
    arrive(x:number,z:number){if(destination&&Math.hypot(destination.x-x,destination.z-z)<7){destination=undefined;return true;}return false;}
  };
}
export type Navigation=ReturnType<typeof createNavigation>;
