import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createModels,exportModelGltf,modelStats} from './model-library.mjs';

const directory=fileURLToPath(new URL('./',import.meta.url));
await mkdir(directory,{recursive:true});
const manifest=[];
for(const model of createModels()) {
  const filename=model.id+'.gltf';
  const json=exportModelGltf(model);await writeFile(new URL(filename,import.meta.url),JSON.stringify(json));
  const stats=modelStats(model);
  manifest.push({id:model.id,title:model.title,file:filename,...stats,units:'metres',hasAnimation:!!json.animations,defaultColor:model.color});
  console.log(`${filename}: ${stats.triangles} triangles, ${stats.meshes} meshes`);
}
await writeFile(new URL('removable-turret.gltf',import.meta.url),JSON.stringify(exportModelGltf(createModels()[0],{turretOnly:true})));
await writeFile(new URL('manifest.json',import.meta.url),JSON.stringify(manifest,null,2));

// Structural verification of all generated assets, including buffer bounds,
// accessor counts, face winding, unit normals and the complete node graph.
for(const filename of [...manifest.map(m=>m.file),'removable-turret.gltf']) {
  const doc=JSON.parse(await readFile(new URL(filename,import.meta.url),'utf8'));
  const binary=Buffer.from(doc.buffers[0].uri.split(',')[1],'base64');
  if(binary.length!==doc.buffers[0].byteLength)throw new Error(`${filename}: buffer length`);
  for(const view of doc.bufferViews)if(view.byteOffset%4||view.byteOffset+view.byteLength>binary.length)throw new Error(`${filename}: invalid buffer view`);
  for(const mesh of doc.meshes)for(const p of mesh.primitives) {
    const positions=doc.accessors[p.attributes.POSITION], normals=doc.accessors[p.attributes.NORMAL], indices=doc.accessors[p.indices];
    if(positions.count!==normals.count||indices.count%3)throw new Error(`${filename}: invalid accessor count`);
    const iv=doc.bufferViews[indices.bufferView];
    for(let i=0;i<indices.count;i++)if(binary.readUInt16LE(iv.byteOffset+i*2)>=positions.count)throw new Error(`${filename}: index out of range`);
    const nv=doc.bufferViews[normals.bufferView];for(let i=0;i<normals.count;i++) {const length=Math.hypot(...[0,1,2].map(j=>binary.readFloatLE(nv.byteOffset+(i*3+j)*4)));if(Math.abs(length-1)>.001)throw new Error(`${filename}: invalid normal`);}
    const pv=doc.bufferViews[positions.bufferView];
    const getPosition=i=>[0,1,2].map(j=>binary.readFloatLE(pv.byteOffset+(i*3+j)*4));
    for(let i=0;i<indices.count;i+=3) {
      const face=[0,1,2].map(j=>binary.readUInt16LE(iv.byteOffset+(i+j)*2)),[a,b,c]=face.map(getPosition);
      const u=b.map((v,j)=>v-a[j]),v=c.map((value,j)=>value-a[j]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],normal=[0,1,2].map(j=>binary.readFloatLE(nv.byteOffset+(face[0]*3+j)*4));
      if(cross.reduce((s,value,j)=>s+value*normal[j],0)<=1e-12)throw new Error(`${filename}: degenerate face or winding mismatch`);
    }
  }
  const seen=new Set();const visit=i=>{if(seen.has(i)||!doc.nodes[i])throw new Error(`${filename}: invalid node graph`);seen.add(i);for(const child of doc.nodes[i].children??[])visit(child);};
  for(const root of doc.scenes[0].nodes)visit(root);if(seen.size!==doc.nodes.length)throw new Error(`${filename}: orphan nodes`);
  console.log(`Verified ${filename} (${Math.round(binary.length/1024)} KiB binary)`);
}
