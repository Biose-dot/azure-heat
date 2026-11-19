// Azure Heat — audio.js: every sound is synthesised with WebAudio. No audio assets.
// Audio starts only after the first user gesture (browser policy), via AH.audio.init().
'use strict';
AH.audio = {
  ctx: null, master: null, engineOsc: null, engineGain: null, sirenOsc: null, sirenGain: null,
  musicTimer: 0, musicStep: 0, musicStyle: 0, musicOn: true,
  init: function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  },
  tone: function (freq, dur, type, vol, slideTo, delay) {
    if (!this.ctx) return;
    var t0 = this.ctx.currentTime + (delay || 0);
    var o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  noise: function (dur, vol, freq) {
    if (!this.ctx) return;
    var n = Math.floor(this.ctx.sampleRate * dur);
    var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = this.ctx.createBufferSource(); src.buffer = buf;
    var f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 1200;
    var g = this.ctx.createGain(); g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  },
  gunshot: function () { this.noise(0.16, 0.5, 2600); this.tone(140, 0.1, 'sawtooth', 0.25, 50); },
  thud: function () { this.noise(0.09, 0.3, 500); this.tone(80, 0.09, 'sine', 0.3, 40); },
  blip: function () { this.tone(880, 0.09, 'square', 0.16); this.tone(1320, 0.12, 'square', 0.16, null, 0.08); },
  reload: function () { this.tone(300, 0.05, 'square', 0.15); this.tone(200, 0.05, 'square', 0.15, null, 0.15); this.tone(420, 0.06, 'square', 0.18, null, 0.3); },
  door: function () { this.tone(180, 0.08, 'square', 0.14, 120); },
  crash: function () { this.noise(0.25, 0.45, 800); this.tone(60, 0.2, 'sine', 0.35, 30); },
  jingle: function () { // mission complete: a little rising arpeggio
    var notes = [523, 659, 784, 1047];
    for (var i = 0; i < notes.length; i++) this.tone(notes[i], 0.22, 'triangle', 0.22, null, i * 0.11);
  },
  fail: function () { this.tone(320, 0.3, 'sawtooth', 0.2, 160); this.tone(210, 0.4, 'sawtooth', 0.2, 110, 0.2); },
  // Continuous engine hum while driving; speed 0..1 shapes pitch and volume.
  setEngine: function (on, speed) {
    if (!this.ctx) return;
    if (on && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      this.engineOsc.type = 'sawtooth';
      this.engineGain.gain.value = 0.0;
      var f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      this.engineOsc.connect(f); f.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
    }
    if (this.engineOsc) {
      this.engineOsc.frequency.value = 55 + speed * 130;
      this.engineGain.gain.value = on ? 0.05 + speed * 0.08 : 0.0;
      if (!on) { var o = this.engineOsc, g = this.engineGain; this.engineOsc = null; this.engineGain = null;
        g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1); o.stop(this.ctx.currentTime + 0.15); }
    }
  },
  // Police siren: a wailing two-tone oscillator, on while any police car is near.
  setSiren: function (on) {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenGain = this.ctx.createGain();
      this.sirenOsc.type = 'triangle';
      this.sirenGain.gain.value = 0.035;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start();
    }
    if (this.sirenOsc) {
      this.sirenOsc.frequency.value = 660 + Math.sin(AH.state.time * 5.2) * 190;
      if (!on) { var o = this.sirenOsc; this.sirenOsc = null; this.sirenGain = null; o.stop(); }
    }
  },
  // Radio: two synth patterns ("channels") toggled with M in main.js. Channel 0 is a slow,
  // moody synthwave bass/pad loop; channel 1 is a brighter, faster beach-funk groove.
  toggleMusicStyle: function () {
    this.musicStyle = (this.musicStyle + 1) % 2;
    this.musicStep = 0; this.musicTimer = 0;
    return this.musicStyle;
  },
  updateMusic: function (dt) {
    if (!this.ctx || !this.musicOn || AH.state.mode !== 'play') return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    var step = this.musicStep++;
    if (this.musicStyle === 0) {
      this.musicTimer = 0.42;
      var bass = [55, 55, 65.4, 55, 49, 49, 73.4, 82.4]; // A A C A G G D E (Hz, A minor)
      this.tone(bass[step % bass.length], 0.4, 'triangle', 0.10);
      if (step % 4 === 0) this.tone(bass[step % bass.length] * 4, 0.9, 'sine', 0.045);
      if (step % 8 === 6) this.tone(440, 0.3, 'sine', 0.03);
    } else {
      this.musicTimer = 0.24;
      var funk = [82.4, 0, 82.4, 98, 0, 110, 0, 98, 73.4, 0, 73.4, 82.4, 0, 123.5, 0, 110]; // E minor groove
      var f = funk[step % funk.length];
      if (f) this.tone(f, 0.2, 'square', 0.06);
      if (step % 2 === 0) this.noise(0.03, 0.03, 6000); // hat tick
      if (step % 16 === 8) this.tone(659, 0.35, 'sine', 0.04);
    }
  },
};
