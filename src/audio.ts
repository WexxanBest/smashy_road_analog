import type { AudioChannel } from './types';

type Soundtrack = 'garage' | 'calm' | 'chase' | 'escape';
type Volumes = Record<AudioChannel, number>;
/** Original layered procedural score with independent music, effects and motor buses. */
export class GameAudio {
 private context?: AudioContext;
 private master?: GainNode;
 private musicBus?: GainNode;
 private sfxBus?: GainNode;
 private engineBus?: GainNode;
 private motor?: OscillatorNode;
 private motorGain?: GainNode;
 private timer = 0;
 private step = 0;
 private next = 0;
 private enabled = true;
 private noise?: AudioBuffer;
 private volumes: Volumes = { music: .7, sfx: .8, engine: .55 };
 private requested: Soundtrack = 'garage';
 private soundtrack: Soundtrack = 'garage';
 private wanted = 0;
 private lastWanted = 0;
 private escapeUntil = 0;
 private intensity = 0;
 private tempo = 100;

 start(enabled: boolean) {
  this.enabled = enabled;
  if (!this.context) {
   const c = this.context = new AudioContext();
   this.master = c.createGain(); this.master.gain.value = .17; this.master.connect(c.destination);
   this.musicBus = c.createGain(); this.sfxBus = c.createGain(); this.engineBus = c.createGain();
   for (const bus of [this.musicBus, this.sfxBus, this.engineBus]) bus.connect(this.master);
   this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
   const samples = this.noise.getChannelData(0);
   for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
   this.motor = c.createOscillator(); this.motor.type = 'sawtooth'; this.motor.frequency.value = 35;
   const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 160;
   this.motorGain = c.createGain(); this.motorGain.gain.value = 0;
   this.motor.connect(filter); filter.connect(this.motorGain); this.motorGain.connect(this.engineBus); this.motor.start();
   this.next = c.currentTime + .05;
   this.timer = window.setInterval(() => this.schedule(), 35);
  }
  this.applyVolumes();
  void this.context.resume();
 }
 toggle(enabled: boolean) { this.enabled = enabled; this.applyVolumes(); }
 setVolumes(volumes: Volumes) {
  for (const key of ['music', 'sfx', 'engine'] as const) {
   const value = volumes[key];
   if (Number.isFinite(value)) this.volumes[key] = Math.max(0, Math.min(1, value));
  }
  this.applyVolumes();
 }
 private applyVolumes() {
  if (!this.context) return;
  const now = this.context.currentTime;
  this.musicBus!.gain.setTargetAtTime(this.enabled ? this.volumes.music : 0, now, .15);
  this.sfxBus!.gain.setTargetAtTime(this.volumes.sfx, now, .08);
  this.engineBus!.gain.setTargetAtTime(this.volumes.engine, now, .08);
 }
 update(wanted: number, speed: number, playing: boolean, mode = playing ? 'playing' : 'garage') {
  const now = this.context?.currentTime ?? 0;
  if (playing && this.lastWanted > 0 && wanted === 0) this.escapeUntil = now + 9;
  this.lastWanted = wanted;
  this.wanted = Math.max(0, Math.min(5, wanted));
  if (mode === 'garage') this.requested = 'garage';
  else if (this.wanted > 0) this.requested = 'chase';
  else this.requested = playing && now < this.escapeUntil ? 'escape' : 'calm';
  if (this.context) {
   this.motor!.frequency.setTargetAtTime(playing ? 35 + Math.abs(speed) * 1.2 : 28, now, .1);
   this.motorGain!.gain.setTargetAtTime(playing ? .055 : 0, now, .3);
  }
 }
 private tone(freq: number, time: number, length: number, volume: number, type: OscillatorType = 'triangle', bus = this.musicBus!) {
  const c = this.context!, oscillator = c.createOscillator(), gain = c.createGain();
  oscillator.type = type; oscillator.frequency.value = freq;
  gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(Math.max(.0001, volume), time + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, time + length);
  oscillator.connect(gain); gain.connect(bus); oscillator.start(time); oscillator.stop(time + length + .03);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
 }
 private drum(time: number, kind: 'kick' | 'hat' | 'snare', volume: number, bus = this.musicBus!) {
  const c = this.context!, gain = c.createGain(); gain.connect(bus);
  gain.gain.setValueAtTime(Math.max(.0001, volume), time);
  gain.gain.exponentialRampToValueAtTime(.0001, time + (kind === 'kick' ? .2 : .09));
  if (kind === 'kick') {
   const oscillator = c.createOscillator(); oscillator.frequency.setValueAtTime(130, time);
   oscillator.frequency.exponentialRampToValueAtTime(38, time + .14); oscillator.connect(gain); oscillator.start(time); oscillator.stop(time + .22);
   oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } else {
   const noise = c.createBufferSource(); noise.buffer = this.noise!;
   const filter = c.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = kind === 'hat' ? 7500 : 1300;
   noise.connect(filter); filter.connect(gain); noise.start(time); noise.stop(time + .11);
   noise.onended = () => { noise.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
 }
 private schedule() {
  const c = this.context!; if (c.state !== 'running') return;
  if (this.next < c.currentTime - .2) this.next = c.currentTime + .03;
  while (this.next < c.currentTime + .16) {
   const beat = this.step % 16, phrase = this.step % 32, time = this.next;
   if (beat === 0) {
    // Changes land on musical bars, then intensity and tempo approach their targets.
    this.soundtrack = this.requested;
    const target = this.soundtrack === 'chase' ? this.wanted : this.soundtrack === 'escape' ? .8 : 0;
    this.intensity += (target - this.intensity) * .65;
    const bpm = this.soundtrack === 'chase' ? 122 + this.wanted * 4 : this.soundtrack === 'escape' ? 114 : this.soundtrack === 'garage' ? 92 : 100;
    this.tempo += (bpm - this.tempo) * .55;
   }
   const root = [55, 55, 65.406, 49][Math.floor(this.step / 32) % 4];
   const calm = this.soundtrack === 'garage' || this.soundtrack === 'calm';
   if (phrase % 8 === 0) {
    this.tone(root * 4, time, 1.35, calm ? .11 : .055, 'sine');
    this.tone(root * 6, time + .04, 1.25, calm ? .045 : .025, 'sine');
   }
   if (beat % (calm ? 8 : 4) === 0) this.tone(root, time, .32, calm ? .13 : .27);
   if (!calm) {
    if (beat % 8 === 0 || this.intensity > 2 && beat === 14) this.drum(time, 'kick', .3 + this.intensity * .06);
    if (beat % 8 === 4) this.drum(time, 'snare', .13 + this.intensity * .025);
    if (beat % 2 === 0) this.drum(time, 'hat', .025 + this.intensity * .01);
    if (this.intensity > 1 && beat % 2 === 0) {
     const notes = [1, 1.5, 2, 2.378, 2, 1.5, 1.335, 1.5];
     this.tone(root * 4 * notes[(phrase / 2) % 8], time, .1, .025 + this.intensity * .012, 'square');
    }
    if (this.intensity > 3 && beat % 4 === 1) this.tone(root * 8, time, .1, .035, 'sawtooth');
   } else if (this.soundtrack === 'calm' && beat === 8) this.drum(time, 'hat', .018);
   this.next += 60 / this.tempo / 4; this.step++;
  }
 }
 effect(kind: 'shoot' | 'boom' | 'hit' | 'pickup') {
  if (!this.context) return;
  const time = this.context.currentTime, bus = this.sfxBus!;
  if (kind === 'boom') { this.drum(time, 'snare', .9, bus); this.drum(time, 'kick', 1.3, bus); this.tone(43, time, .4, .7, 'sawtooth', bus); }
  else if (kind === 'shoot') { this.drum(time, 'hat', .22, bus); this.tone(140, time, .035, .12, 'sawtooth', bus); }
  else if (kind === 'hit') this.drum(time, 'snare', .35, bus);
  else { this.tone(660, time, .13, .25, 'triangle', bus); this.tone(990, time + .09, .2, .2, 'triangle', bus); }
 }
 dispose() { window.clearInterval(this.timer); void this.context?.close(); }
}
