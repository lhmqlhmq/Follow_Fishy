export const audio = {
  context: null,
  masterGain: null,
  enabled: true,

  init() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 1.0; // Default
      this.masterGain.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.context.resume();
    return this.context;
  },

  setGain(val) {
    if (!this.masterGain) this.init();
    this.masterGain.gain.value = val;
  },

  playBubble() {
    if (!this.enabled) return;
    const ctx = this.init();
    const t = ctx.currentTime;

    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800 + Math.random() * 400;
    filter.Q.value = 10;

    const osc = ctx.createOscillator();
    osc.frequency.value = 600 + Math.random() * 300;

    const modOsc = ctx.createOscillator();
    modOsc.frequency.value = 8 + Math.random() * 4;
    const modGain = ctx.createGain();
    modGain.gain.value = 50;
    modOsc.connect(modGain);
    modGain.connect(osc.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.4, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);

    noise.connect(filter);
    filter.connect(gain);
    osc.connect(gain);
    gain.connect(this.masterGain);

    noise.start(t);
    noise.stop(t + 0.15);
    osc.start(t);
    osc.stop(t + 0.15);
    modOsc.start(t);
    modOsc.stop(t + 0.15);
  },

  playCollect() {
    if (!this.enabled) return;
    const ctx = this.init();
    const t = ctx.currentTime;

    const frequencies = [800, 1000, 1200, 1500];
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';

      const delay = i * 0.02;
      gain.gain.setValueAtTime(0, t + delay);
      gain.gain.linearRampToValueAtTime(0.2, t + delay + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.01, t + delay + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t + delay);
      osc.stop(t + delay + 0.25);
    });
  },

  playClick() {
    if (!this.enabled) return;
    const ctx = this.init();
    const t = ctx.currentTime;

    const bufferSize = ctx.sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / bufferSize * 5);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400 + Math.random() * 200;
    filter.Q.value = 1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(t);
    noise.stop(t + 0.08);
  },

  predatorVictory() {
    // Basic victory sound since it was missing but referenced
    if (!this.enabled) return;
    const ctx = this.init();
    const t = ctx.currentTime;
    
    [440, 554, 659, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.1);
      g.gain.linearRampToValueAtTime(0.2, t + i * 0.1 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.01, t + i * 0.1 + 0.5);
      o.connect(g);
      g.connect(this.masterGain);
      o.start(t + i * 0.1);
      o.stop(t + i * 0.1 + 0.5);
    });
  }
};
