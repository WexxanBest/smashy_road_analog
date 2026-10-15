/** Original procedural soundtrack. No downloaded tracks or audio assets. */
export class GameAudio {
 private context?:AudioContext; private master?:GainNode; private motor?:OscillatorNode; private motorGain?:GainNode;
 private timer=0; private step=0; private next=0; private intensity=0; private enabled=true; private noise?:AudioBuffer;
 start(enabled:boolean) {
  this.enabled=enabled;
  if(!this.context){
   this.context=new AudioContext(); this.master=this.context.createGain(); this.master.gain.value=0.17; this.master.connect(this.context.destination);
   this.noise=this.context.createBuffer(1,this.context.sampleRate,this.context.sampleRate);
   const d=this.noise.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
   this.motor=this.context.createOscillator();this.motor.type='sawtooth';this.motor.frequency.value=40;
   const filter=this.context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=160;
   this.motorGain=this.context.createGain();this.motorGain.gain.value=0.025;this.motor.connect(filter);filter.connect(this.motorGain);this.motorGain.connect(this.master);this.motor.start();
   this.next=this.context.currentTime+.05;this.timer=window.setInterval(()=>this.schedule(),35);
  }
  void this.context.resume();this.master!.gain.setTargetAtTime(enabled?.17:0,this.context.currentTime,.15);
 }
 toggle(enabled:boolean){this.enabled=enabled;if(this.context)this.master!.gain.setTargetAtTime(enabled?.17:0,this.context.currentTime,.15);}
 update(wanted:number,speed:number,playing:boolean){this.intensity=playing?wanted:0;if(this.context){this.motor!.frequency.setTargetAtTime(playing?35+Math.abs(speed)*1.2:28,this.context.currentTime,.1);this.motorGain!.gain.setTargetAtTime(playing?.055:.008,this.context.currentTime,.3);}}
 private tone(freq:number,time:number,length:number,volume:number,type:OscillatorType='triangle'){
  const c=this.context!;const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.value=freq;
  g.gain.setValueAtTime(0,time);g.gain.linearRampToValueAtTime(volume,time+.008);g.gain.exponentialRampToValueAtTime(.001,time+length);
  o.connect(g);g.connect(this.master!);o.start(time);o.stop(time+length+.03);
 }
 private drum(time:number,kind:'kick'|'hat'|'snare',volume:number){
  const c=this.context!,g=c.createGain();g.connect(this.master!);g.gain.setValueAtTime(volume,time);g.gain.exponentialRampToValueAtTime(.001,time+(kind==='kick'?.2:.09));
  if(kind==='kick'){const o=c.createOscillator();o.frequency.setValueAtTime(130,time);o.frequency.exponentialRampToValueAtTime(38,time+.14);o.connect(g);o.start(time);o.stop(time+.22);}
  else {const n=c.createBufferSource();n.buffer=this.noise!;const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=kind==='hat'?7500:1300;n.connect(f);f.connect(g);n.start(time);n.stop(time+.11);}
 }
 private schedule(){
  const c=this.context!;if(c.state!=='running')return;if(this.next<c.currentTime-.2)this.next=c.currentTime+.03;
  while(this.next<c.currentTime+.16){
   const s=this.step%32,t=this.next;const root=[55,55,65.406,49][Math.floor(this.step/32)%4];
   if(s%4===0)this.tone(root,t,.28,.32,'triangle');
   if(s%8===0||this.intensity>2&&s%8===6)this.drum(t,'kick',.65);
   if(s%8===4)this.drum(t,'snare',.2+this.intensity*.018);
   if(s%2===0)this.drum(t,'hat',.045+this.intensity*.012);
   if(this.intensity>0&&s%2===0){const notes=[1,1.5,2,2.378,2,1.5,1.335,1.5];this.tone(root*4*notes[(s/2)%8],t,.09,.085,'square');}
   if(this.intensity>3&&s%4===1)this.tone(root*8,t,.1,.035,'sawtooth');
   this.next+=60/138/4;this.step++;
  }
 }
 effect(kind:'shoot'|'boom'|'hit'|'pickup'){
  if(!this.context||!this.enabled)return;const t=this.context.currentTime;
  if(kind==='boom'){this.drum(t,'snare',.9);this.drum(t,'kick',1.3);this.tone(43,t,.4,.7,'sawtooth');}
  else if(kind==='shoot'){this.drum(t,'hat',.22);this.tone(140,t,.035,.12,'sawtooth');}
  else if(kind==='hit')this.drum(t,'snare',.35);
  else {this.tone(660,t,.13,.25);this.tone(990,t+.09,.2,.2);}
 }
 dispose(){window.clearInterval(this.timer);void this.context?.close();}
}
