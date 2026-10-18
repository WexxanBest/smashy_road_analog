import { Mesh, Scene, VertexData } from '@babylonjs/core';

type Point = [number, number, number];
/** Engine-local counterpart of the approved concept gallery geometry. Every face
 * owns its normals; there are no texture, network or glTF-loader dependencies. */
class FacetedGeometry {
  positions: number[] = [];
  indices: number[] = [];
  normals: number[] = [];
  face(points: Point[], outward: Point): void {
    let vertices = points.slice();
    const a = points[1].map((v, i) => v - points[0][i]), b = points[2].map((v, i) => v - points[0][i]);
    let normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const length = Math.hypot(...normal) || 1;
    normal = normal.map(v => v / length);
    if (normal.reduce((sum, v, i) => sum + v * outward[i], 0) < 0) { vertices.reverse(); normal = normal.map(v => -v); }
    const offset = this.positions.length / 3;
    for (const p of vertices) { this.positions.push(...p); this.normals.push(...normal); }
    for (let i = 1; i < vertices.length - 1; i++) this.indices.push(offset, offset + i, offset + i + 1);
  }
  mesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene), data = new VertexData();
    data.positions = this.positions; data.indices = this.indices; data.normals = this.normals;
    data.uvs = new Array(this.positions.length / 3 * 2).fill(0); data.applyToMesh(mesh);
    return mesh;
  }
}

export function conceptBox(scene: Scene, name: string, width: number, height: number, depth: number, bevel = .035): Mesh {
  const b = Math.min(bevel, width / 5, height / 5, depth / 5);
  const ring = (w: number, h: number, c: number, z: number): Point[] => {
    const x = w / 2, y = h / 2;
    return [[-x+c,-y,z],[x-c,-y,z],[x,-y+c,z],[x,y-c,z],[x-c,y,z],[-x+c,y,z],[-x,y-c,z],[-x,-y+c,z]];
  };
  const rings = [ring(width-2*b,height-2*b,b*.35,-depth/2),ring(width,height,b,-depth/2+b),ring(width,height,b,depth/2-b),ring(width-2*b,height-2*b,b*.35,depth/2)];
  const geo = new FacetedGeometry();geo.face(rings[0],[0,0,-1]);geo.face(rings[3],[0,0,1]);
  for(let r=0;r<3;r++)for(let i=0;i<8;i++) {
    const j=(i+1)%8, pts=[rings[r][i],rings[r][j],rings[r+1][j],rings[r+1][i]];
    geo.face(pts,pts[0].map((_,axis)=>pts.reduce((sum,p)=>sum+p[axis],0)/4) as Point);
  }
  return geo.mesh(name,scene);
}

export function conceptArch(scene: Scene, name: string, inner: number, outer: number, thickness: number): Mesh {
  const geo = new FacetedGeometry(), segments = 10;
  for (let i=0;i<segments;i++) {
    const a=-.08+(Math.PI+.16)*i/segments,b=-.08+(Math.PI+.16)*(i+1)/segments;
    const p=(x:number,r:number,t:number):Point=>[x,Math.sin(t)*r,Math.cos(t)*r];
    for(const side of [-1,1])geo.face([p(side*thickness/2,inner,a),p(side*thickness/2,inner,b),p(side*thickness/2,outer,b),p(side*thickness/2,outer,a)],[side,0,0]);
    geo.face([p(-thickness/2,outer,a),p(-thickness/2,outer,b),p(thickness/2,outer,b),p(thickness/2,outer,a)],[0,Math.sin((a+b)/2),Math.cos((a+b)/2)]);
    geo.face([p(-thickness/2,inner,a),p(-thickness/2,inner,b),p(thickness/2,inner,b),p(thickness/2,inner,a)],[0,-Math.sin((a+b)/2),-Math.cos((a+b)/2)]);
  }
  return geo.mesh(name,scene);
}

export function conceptWheelRing(scene: Scene, name: string, inner: number, outer: number, length: number, segments = 12): Mesh {
  const geo=new FacetedGeometry(),p=(x:number,r:number,t:number):Point=>[x,Math.cos(t)*r,Math.sin(t)*r];
  for(let i=0;i<segments;i++) {
    const a=2*Math.PI*i/segments,b=2*Math.PI*(i+1)/segments;
    for(const side of [-1,1])geo.face([p(side*length/2,inner,a),p(side*length/2,inner,b),p(side*length/2,outer,b),p(side*length/2,outer,a)],[side,0,0]);
    geo.face([p(-length/2,outer,a),p(-length/2,outer,b),p(length/2,outer,b),p(length/2,outer,a)],[0,Math.cos((a+b)/2),Math.sin((a+b)/2)]);
  }
  return geo.mesh(name,scene);
}
