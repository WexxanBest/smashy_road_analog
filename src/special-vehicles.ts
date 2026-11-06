import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import type { CarSpec, VehicleVisual } from './types';

type SpecialVisual = VehicleVisual & {setTurretEnabled(enabled:boolean):void};
type Point = [number,number,number];

/** Vertex colours let each articulated part use one draw call and one matte material. */
function builder(scene:Scene, name:string) {
  const root=new TransformNode(name,scene),chassis=new TransformNode(name+'-chassis',scene);chassis.parent=root;
  const material=new StandardMaterial(name+'-colors',scene);material.diffuseColor=Color3.White();material.specularColor=Color3.Black();material.backFaceCulling=false;
  function paint(mesh:Mesh,hex:string){const color=Color3.FromHexString(hex),colors=new Float32Array(mesh.getTotalVertices()*4);for(let i=0;i<colors.length;i+=4){colors[i]=color.r;colors[i+1]=color.g;colors[i+2]=color.b;colors[i+3]=1;}mesh.setVerticesData('color',colors);mesh.material=material;mesh.isPickable=false;return mesh;}
  function box(parts:Mesh[],w:number,h:number,d:number,x:number,y:number,z:number,hex:string){const mesh=MeshBuilder.CreateBox(name+'-detail',{width:w,height:h,depth:d},scene);mesh.position.set(x,y,z);parts.push(paint(mesh,hex));return mesh;}
  function cylinder(parts:Mesh[],diameter:number,height:number,x:number,y:number,z:number,hex:string,axis:'x'|'y'|'z'='y'){const mesh=MeshBuilder.CreateCylinder(name+'-round',{diameter,height,tessellation:10},scene);if(axis==='x')mesh.rotation.z=Math.PI/2;if(axis==='z')mesh.rotation.x=Math.PI/2;mesh.position.set(x,y,z);parts.push(paint(mesh,hex));return mesh;}
  function rod(parts:Mesh[],a:Point,b:Point,width:number,hex:string){const d=Vector3.FromArray(b).subtract(Vector3.FromArray(a)),mesh=box(parts,width,width,d.length(),(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,hex);mesh.rotation.set(-Math.atan2(d.y,Math.hypot(d.x,d.z)),Math.atan2(d.x,d.z),0);return mesh;}
  function poly(parts:Mesh[],faces:Point[][],hex:string){const positions:number[]=[],indices:number[]=[],normals:number[]=[];for(const f of faces){const at=positions.length/3;for(const p of f)positions.push(...p);for(let i=1;i<f.length-1;i++)indices.push(at,at+i,at+i+1);}VertexData.ComputeNormals(positions,indices,normals,{useRightHandedSystem:true});const data=new VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=new Float32Array(positions.length/3*2);const mesh=new Mesh(name+'-hull-part',scene);data.applyToMesh(mesh);parts.push(paint(mesh,hex));return mesh;}
  function merge(parts:Mesh[],label:string,parent:TransformNode=chassis){const mesh=Mesh.MergeMeshes(parts,true,true,undefined,false,false)!;mesh.name=label;mesh.material=material;mesh.parent=parent;mesh.isPickable=false;mesh.receiveShadows=true;return mesh;}
  return {root,chassis,material,box,cylinder,rod,poly,merge};
}

function finish(b:ReturnType<typeof builder>,body:Mesh,wheels:TransformNode[],panels:Mesh[],exhausts:TransformNode[]):SpecialVisual {
  const {root,chassis,material}=b,turret=new TransformNode('turret',root.getScene());turret.parent=chassis;turret.setEnabled(false);
  let stage=0,lastTires=1,disposed=false,compactRequested=false,compact:Mesh|undefined,debris:Mesh[]=[];
  const empty:Mesh[]=[];
  function full(){compact?.setEnabled(false);chassis.setEnabled(true);for(const wheel of wheels)wheel.parent?.setEnabled(true);}
  function invalidate(){full();compact?.dispose(false,false);compact=undefined;}
  function showCompact(){if(!compactRequested||disposed)return;if(!compact){full();root.computeWorldMatrix(true);const inverse=root.getWorldMatrix().clone().invert(),parts:VertexData[]=[];for(const mesh of root.getChildMeshes()){if(!(mesh instanceof Mesh)||!mesh.isEnabled()||!mesh.isVisible)continue;mesh.computeWorldMatrix(true);const data=VertexData.ExtractFromMesh(mesh,false,true);data.transform(mesh.getWorldMatrix().multiply(inverse));parts.push(data);}if(!parts.length)return;parts[0].merge(parts.slice(1),true,false,false,true);compact=new Mesh(root.name+'-compact',root.getScene());parts[0].applyToMesh(compact);compact.parent=root;compact.material=material;compact.isPickable=false;}chassis.setEnabled(false);for(const wheel of wheels)wheel.parent?.setEnabled(false);compact.setEnabled(true);}
  function detach(panel:Mesh){
    panel.computeWorldMatrix(true);const world=panel.getWorldMatrix().clone(),part=panel.clone('debris-'+panel.name,null,false,false);
    part.makeGeometryUnique();part.bakeTransformIntoVertices(world);const center=part.getBoundingInfo().boundingBox.center.clone();
    part.bakeTransformIntoVertices(Matrix.Translation(-center.x,-center.y,-center.z));part.position.copyFrom(center);part.rotation.setAll(0);part.rotationQuaternion=Quaternion.Identity();part.scaling.setAll(1);
    part.material=material.clone('debris-'+material.name);const owned=part.material;part.onDisposeObservable.addOnce(()=>owned.dispose());part.setEnabled(true);part.metadata={vehicleDebris:true,panel:panel.name};panel.setEnabled(false);debris.push(part);
  }
  return {root,chassis,body,turret,wheels,exhausts,
    setTurretEnabled(){},setColor(hex){material.diffuseColor=Color3.FromHexString(hex);},
    setCompact(enabled){if(enabled===compactRequested)return;compactRequested=enabled;if(enabled)showCompact();else full();},
    setDamage(health,tires){
      const next=health<=.25?2:health<=.55?1:0,tireRatio=Math.max(0,Math.min(1,tires));
      if(next!==stage||tireRatio!==lastTires)invalidate();
      if(next!==stage){if(next===0){panels.forEach(p=>p.setEnabled(true));material.diffuseColor=Color3.White();}else {if(next>stage)for(let i=stage;i<Math.min(next,panels.length);i++)detach(panels[i]);material.diffuseColor=new Color3(next===2?.32:.8,next===2?.35:.8,next===2?.34:.8);}stage=next;}
      lastTires=tireRatio;for(const wheel of wheels)wheel.scaling.y=.75+.25*tireRatio;showCompact();
    },
    popDebris(){if(!debris.length)return empty;const result=debris;debris=[];return result;},
    dispose(){if(disposed)return;disposed=true;for(const part of debris)part.dispose(false,true);debris=[];root.dispose(false,false);material.dispose();}
  };
}

/** Two true centreline wheels, touring fairing, panniers and a faceted officer. */
export function createMotorcycle(scene:Scene,spec:CarSpec):SpecialVisual {
  const b=builder(scene,'vehicle-police-'+spec.id),{box,cylinder,rod,merge}=b,parts:Mesh[]=[],panels:Mesh[]=[],wheels:TransformNode[]=[];
  const white='#e1e5dc',blue='#2d5266',dark='#263239',metal='#98aaa9';
  box(parts,.34,.28,1.48,0,.69,-.02,blue);box(parts,.37,.16,.94,0,1.02,-.25,dark);
  box(parts,.5,.35,.57,0,.95,.36,white).rotation.x=-.16;
  cylinder(parts,.4,.39,0,.65,.01,metal,'x');
  for(const side of[-1,1]){box(parts,.11,.36,.37,side*.24,.65,.01,dark);for(const y of[.53,.6,.67,.74])box(parts,.12,.025,.38,side*.25,y,.01,metal);rod(parts,[side*.13,.5,-.93],[side*.13,.79,-.25],.075,metal);rod(parts,[side*.13,.45,.99],[side*.13,1.16,.67],.065,metal);box(parts,.12,.12,.76,side*.33,.48,-.57,metal);box(parts,.28,.06,.21,side*.36,.58,-.04,dark);}
  box(parts,.51,.19,.46,0,1.17,.75,white);box(parts,.39,.15,.05,0,1.18,1.0,'#fff0b4');
  for(const side of[-1,1]){cylinder(parts,.1,.075,side*.24,1.18,.99,side<0?'#f45d52':'#69bdeb','z');rod(parts,[0,1.25,.63],[side*.43,1.27,.55],.06,dark);rod(parts,[side*.34,1.29,.57],[side*.42,1.5,.61],.035,metal);box(parts,.16,.11,.06,side*.43,1.51,.62,metal);}
  const windshield:Mesh[]=[];box(windshield,.43,.38,.045,0,1.45,.79,'#62848a').rotation.x=-.20;panels.push(merge(windshield,'detachable-bike-windscreen'));
  const panniers:Mesh[]=[];for(const side of[-1,1]){box(panniers,.27,.38,.61,side*.34,.85,-.8,white);box(panniers,.28,.08,.62,side*.34,1.06,-.8,blue);box(panniers,.025,.13,.35,side*.48,.88,-.8,blue);box(panniers,.09,.11,.02,side*.34,.91,-1.12,'#e65a4c');}panels.push(merge(panniers,'detachable-bike-panniers'));
  // One inexpensive articulated-looking rider is part of the chassis batch.
  box(parts,.46,.51,.31,0,1.44,-.28,blue).rotation.x=.15;box(parts,.38,.23,.08,0,1.48,-.48,'#c7d4ca');
  for(const side of[-1,1]){rod(parts,[side*.22,1.57,-.16],[side*.29,1.3,.26],.14,blue);rod(parts,[side*.29,1.3,.26],[side*.37,1.28,.55],.12,blue);rod(parts,[side*.19,1.19,-.39],[side*.32,.87,.02],.16,dark);rod(parts,[side*.32,.87,.02],[side*.35,.66,-.13],.14,dark);}
  cylinder(parts,.37,.31,0,1.85,-.2,white);box(parts,.32,.13,.12,0,1.86,-.03,'#183642');
  box(parts,.03,.55,.03,-.32,1.42,-1.03,dark);cylinder(parts,.10,.12,-.32,1.72,-1.03,'#70bdeb');
  for(const z of[.98,-.98]){const frame=new TransformNode('bike-wheel-frame',scene);frame.parent=b.root;frame.position.set(0,.36,z);const wheel=new TransformNode('wheel',scene);wheel.parent=frame;const pieces:Mesh[]=[];cylinder(pieces,.72,.17,0,0,0,dark,'x');cylinder(pieces,.46,.19,0,0,0,metal,'x');cylinder(pieces,.29,.20,0,0,0,blue,'x');for(let j=0;j<5;j++){const a=j*Math.PI*2/5,spoke=box(pieces,.21,.05,.40,0,0,0,metal);spoke.rotation.x=a;}merge(pieces,'bike-wheel',wheel);wheels.push(wheel);}
  const outlet=new TransformNode('exhaust-outlet',scene);outlet.parent=b.chassis;outlet.position.set(.34,.48,-1);outlet.rotation.y=Math.PI;
  const body=merge(parts,'motorcycle-body');return finish(b,body,wheels,panels,[outlet]);
}

/** Shallow draft police launch: one body draw plus detachable cabin and rail batch. */
export function createPatrolBoat(scene:Scene):SpecialVisual {
  const b=builder(scene,'police-patrol-boat'),{box,cylinder,rod,poly,merge}=b,parts:Mesh[]=[],cabin:Mesh[]=[],rails:Mesh[]=[];
  const ring:Point[]=[[-.9,.5,-2.25],[.9,.5,-2.25],[.95,.5,1.05],[.57,.5,1.92],[0,.5,2.6],[-.57,.5,1.92],[-.95,.5,1.05]],bottom=ring.map(([x,,z])=>[x*.66,-.02,z*.92] as Point),faces:Point[][]=[ring,bottom.slice().reverse()];
  for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;faces.push([bottom[i],bottom[j],ring[j],ring[i]]);}poly(parts,faces.map(face=>face.slice().reverse()),'#e2e4d7');
  box(parts,1.72,.13,3.3,0,.55,-.47,'#2b5264');box(parts,1.54,.07,2.5,0,.65,-.56,'#c8cbb4');
  for(const side of[-1,1]){box(parts,.09,.16,3.1,side*.93,.36,-.58,'#26373d');for(const z of[-1.35,-.65,.05])box(parts,.04,.16,.11,side*.99,.48,z,'#e1e6db');rod(rails,[side*.77,.66,1.1],[side*.42,.66,2.04],.07,'#748e91');rod(rails,[side*.77,.66,1.1],[side*.77,1,1.1],.05,'#748e91');rod(rails,[side*.77,1,1.1],[side*.42,1,2.04],.05,'#a3b6b2');}
  box(cabin,1.25,.85,1.52,0,1.08,-.17,'#d8e0d7');box(cabin,1.35,.10,1.65,0,1.57,-.17,'#2c4e61');box(cabin,1.02,.4,.03,0,1.25,.61,'#2c5360');box(cabin,.045,.43,.04,0,1.25,.64,'#d8e0d7');
  for(const side of[-1,1]){box(cabin,.03,.4,.95,side*.64,1.25,-.12,'#2c5360');box(cabin,.04,.43,.05,side*.66,1.25,-.18,'#d8e0d7');box(cabin,.04,.1,.22,side*.66,.82,-.34,'#34515b');}
  box(cabin,.90,.08,.20,0,1.66,-.17,'#283e48');box(cabin,.38,.12,.18,-.23,1.76,-.17,'#f06655');box(cabin,.38,.12,.18,.23,1.76,-.17,'#62bce5');
  rod(cabin,[.41,1.58,-.74],[.41,2.17,-.74],.035,'#3d565c');cylinder(cabin,.24,.13,-.39,1.65,-.61,'#d8e0d7');
  for(const side of[-1,1]){box(parts,.32,.62,.43,side*.44,.39,-2.35,'#2b3d44');box(parts,.33,.11,.44,side*.44,.75,-2.35,'#657d81');}
  cylinder(parts,.42,.1,0,.68,1.18,'#344f58');
  const body=merge(parts,'patrol-boat-hull'),panels=[merge(cabin,'detachable-boat-cabin'),merge(rails,'detachable-boat-rails')];return finish(b,body,[],panels,[]);
}
