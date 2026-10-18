import { Vector3 } from '@babylonjs/core';
import type { PhysicsBody, PhysicsShape } from '@babylonjs/core';

export type DisabledVehiclePhase = 'disabled' | 'wreck';

/** Switching off an engine must not erase the rigid body's existing momentum. */
export function configureWreckPhysics(body:PhysicsBody,shape:PhysicsShape,phase:DisabledVehiclePhase='wreck'):void {
 const wreck=phase==='wreck';
 body.setLinearDamping(wreck?.35:2);
 body.setAngularDamping(wreck?.65:3);
 shape.material={friction:wreck?.2:0,restitution:.08};
}

export function stepDisabledVehiclePhysics(body:PhysicsBody,dt:number,phase:DisabledVehiclePhase):void {
 // Wrecks coast, spin and respond to contacts through Havok. Applying the
 // disabled engine's active brake here would cancel both inertia and blasts.
 if(phase==='wreck')return;
 const v=body.getLinearVelocity(),yaw=body.getAngularVelocity().y,drag=Math.exp(-Math.max(0,dt)*4);
 let x=v.x*drag,z=v.z*drag;
 if(Math.hypot(x,z)<.2)x=z=0;
 body.setLinearVelocity(new Vector3(x,v.y,z));
 body.setAngularVelocity(new Vector3(0,Math.abs(yaw)<.03?0:yaw*Math.exp(-Math.max(0,dt)*7),0));
}
