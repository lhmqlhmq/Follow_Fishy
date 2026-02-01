import { audio } from './audio.js';

export function initSimulation(canvasId, config = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    const settings = {
        fishCount: config.fishCount || 1300,
        speed: config.speed || 0.4,
        gain: config.gain || 1.0,
        ...config
    };

    audio.setGain(settings.gain);

    // ---------- Utilities ----------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const clamp01 = v => clamp(v, 0, 1);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const randInt = (a, b) => Math.floor(rand(a, b + 1));
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    function hash2(x, y) {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return s - Math.floor(s);
    }
    function smoothstep(t) { return t * t * (3 - 2 * t); }
    function valueNoise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const a = hash2(xi, yi), b = hash2(xi + 1, yi);
        const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
        const u = smoothstep(xf), v = smoothstep(yf);
        return lerp(lerp(a, b, u), lerp(c, d, u), v);
    }
    function fbm(x, y) {
        let f = 0, amp = 0.5, freq = 1;
        for (let i = 0; i < 4; i++) {
            f += amp * valueNoise(x * freq, y * freq);
            amp *= 0.5; freq *= 2;
        }
        return f;
    }

    // ---------- State ----------
    let W = innerWidth, H = innerHeight, DPR = 1;
    const pointer = { x: W * 0.5, y: H * 0.5, rawX: W * 0.5, rawY: H * 0.5, vx: 0, vy: 0, lastT: performance.now(), idle: 0 };
    const fish = [];
    const bubbles = [];
    let bubbleAcc = 0;
    const trail = [];
    const MAX_TRAIL = 20;

    // ---------- Resize / DPR ----------
    function resize() {
        DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        W = innerWidth; H = innerHeight;
        canvas.width = Math.floor(W * DPR);
        canvas.height = Math.floor(H * DPR);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        initSpatial();
        initGodRays();
        initSubSchools();
        initSnow();
    }
    addEventListener('resize', resize, { passive: true });

    // ---------- Pointer ----------
    const hint = document.getElementById('hint');
    addEventListener('pointermove', (e) => {
        pointer.rawX = e.clientX;
        pointer.rawY = e.clientY;
        pointer.idle = 0;
        if (hint) hint.classList.remove('visible');
        startHintTimer();
    }, { passive: true });

    function updatePointerSmoothing(dt) {
        const now = performance.now();
        const pdt = Math.max(1, now - pointer.lastT);
        const oldX = pointer.x, oldY = pointer.y;
        const lerpFactor = 1 - Math.pow(0.001, dt / 100);
        pointer.x = lerp(pointer.x, pointer.rawX, lerpFactor);
        pointer.y = lerp(pointer.y, pointer.rawY, lerpFactor);
        pointer.vx = (pointer.x - oldX) / pdt;
        pointer.vy = (pointer.y - oldY) / pdt;
        pointer.lastT = now;
    }

    addEventListener('pointerdown', (e) => {
        const cx = e.clientX, cy = e.clientY;
        for (let i = 0; i < 12; i++) spawnTrailParticle(cx, cy);

        let hitFish = null, hitDist = Infinity;
        for (const f of fish) {
            const d = Math.hypot(cx - f.x, cy - f.y);
            const hr = f.size * (f.depthScale || 1) * 3.2;
            if (d < hr && d < hitDist) { hitDist = d; hitFish = f; }
        }
        if (hitFish && !hitFish.response) {
            triggerFishResponse(hitFish, cx, cy);
            audio.playBubble();
        } else {
            triggerLocalScatter(cx, cy);
            audio.playClick();
        }
    });

    // ---------- Fish Response System ----------
    const FISH_RESPONSES = ['burst', 'spin', 'shimmer', 'bubbles', 'colorflash'];
    function triggerFishResponse(f, clickX, clickY) {
        const type = FISH_RESPONSES[Math.floor(Math.random() * FISH_RESPONSES.length)];
        const durations = { burst: 620, spin: 540, shimmer: 370, bubbles: 430, colorflash: 480 };
        f.response = { type, startTime: performance.now(), duration: durations[type] };
        if (type === 'burst') {
            const dx = f.x - clickX, dy = f.y - clickY, d = Math.hypot(dx, dy) || 1;
            f.vx += (dx / d) * 14; f.vy += (dy / d) * 14;
            f.heading = Math.atan2(f.vy, f.vx);
            spawnBubbleCluster(f.x, f.y);
        } else if (type === 'bubbles') {
            spawnBubbleCluster(f.x, f.y);
        }
    }

    function triggerLocalScatter(clickX, clickY) {
        const sr = 135;
        for (const f of fish) {
            const dx = f.x - clickX, dy = f.y - clickY, d = Math.hypot(dx, dy);
            if (d < sr && d > 0.5) {
                const force = ((sr - d) / sr) * 5;
                f.vx += (dx / d) * force; f.vy += (dy / d) * force;
                f.heading = Math.atan2(f.vy, f.vx);
            }
        }
        spawnBubbleCluster(clickX, clickY);
    }

    // ---------- HUD Controls ----------
    const spdMinus = document.getElementById('spdMinus');
    const spdPlus = document.getElementById('spdPlus');
    const cntMinus = document.getElementById('cntMinus');
    const cntPlus = document.getElementById('cntPlus');
    const snd = document.getElementById('snd');

    if (spdMinus) spdMinus.onclick = () => { settings.speed = clamp(settings.speed / 1.12, 0.25, 4.0); pressButton('spdMinus'); };
    if (spdPlus) spdPlus.onclick = () => { settings.speed = clamp(settings.speed * 1.12, 0.25, 4.0); pressButton('spdPlus'); };
    if (cntMinus) cntMinus.onclick = () => { settings.fishCount = clamp(settings.fishCount - 150, 200, 2000); pressButton('cntMinus'); reconcileFishCount(); };
    if (cntPlus) cntPlus.onclick = () => { settings.fishCount = clamp(settings.fishCount + 150, 200, 2000); pressButton('cntPlus'); reconcileFishCount(); };
    if (snd) {
        snd.onclick = () => {
            audio.enabled = !audio.enabled;
            snd.textContent = audio.enabled ? '🔊' : '🔇';
            pressButton('snd');
            audio.playClick();
        };
        snd.textContent = audio.enabled ? '🔊' : '🔇';
    }

    function pressButton(id) {
        const btn = document.getElementById(id);
        if (btn) {
            btn.classList.add('pressed');
            setTimeout(() => btn.classList.remove('pressed'), 300);
        }
    }

    function reconcileFishCount() {
        const diff = settings.fishCount - fish.length;
        if (diff > 0) spawnFish(Math.min(diff, 60));
        else if (diff < 0) fish.splice(Math.max(0, fish.length + diff), Math.min(-diff, 60));
    }

    // ---------- Hint auto-show ----------
    let hintTimer = null;
    function startHintTimer() {
        if (!hint) return;
        hint.classList.remove('visible');
        if (hintTimer) clearTimeout(hintTimer);
        hintTimer = setTimeout(() => hint.classList.add('visible'), 3000);
    }

    // ---------- Migration System ----------
    const migration = {
        angle: Math.random() * Math.PI * 2,
        targetAngle: Math.random() * Math.PI * 2,
        strength: 0.15,
        breathPhase: 0,
        breathSpeed: 0.0008,
        waveOrigin: { x: W * 0.5, y: H * 0.5 },
        waveTime: 0,
        speedPhase: 0,
        speedMod: 1.0,
        centerX: W * 0.5,
        centerY: H * 0.5,
        flashIntensity: 0,
        lastAngle: 0
    };

    const subSchools = [];
    function initSubSchools() {
        subSchools.length = 0;
        for (let i = 0; i < 4; i++) {
            subSchools.push({
                x: W * (0.25 + Math.random() * 0.5), y: H * (0.25 + Math.random() * 0.5),
                vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), radius: rand(150, 300), strength: rand(0.3, 0.6), phase: rand(0, Math.PI * 2)
            });
        }
    }

    function updateMigration(dt, t) {
        if (Math.random() < 0.001) migration.targetAngle = Math.random() * Math.PI * 2;
        let angleDiff = migration.targetAngle - migration.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        migration.angle += angleDiff * 0.002 * dt * 0.06;
        migration.flashIntensity = Math.abs(angleDiff) > 0.3 ? Math.min(1, migration.flashIntensity + dt * 0.002) : migration.flashIntensity * 0.98;
        migration.breathPhase += migration.breathSpeed * dt;
        migration.speedPhase += dt * 0.0003;
        migration.speedMod = 0.7 + 0.3 * Math.sin(migration.speedPhase) + 0.15 * Math.sin(migration.speedPhase * 2.3) + 0.1 * Math.sin(migration.speedPhase * 0.7);
        migration.waveTime += dt * 0.002;

        if (fish.length > 0) {
            let cx = 0, cy = 0;
            for (const f of fish) { cx += f.x; cy += f.y; }
            migration.centerX = lerp(migration.centerX, cx / fish.length, 0.02);
            migration.centerY = lerp(migration.centerY, cy / fish.length, 0.02);
            migration.waveOrigin.x = migration.centerX;
            migration.waveOrigin.y = migration.centerY;
        }

        for (const sub of subSchools) {
            sub.phase += dt * 0.001;
            sub.vx = (sub.vx + (Math.random() - 0.5) * 0.02 + Math.cos(migration.angle) * 0.01) * 0.99;
            sub.vy = (sub.vy + (Math.random() - 0.5) * 0.02 + Math.sin(migration.angle) * 0.01) * 0.99;
            sub.x += sub.vx * dt * 0.05; sub.y += sub.vy * dt * 0.05;
            if (sub.x < W * 0.1) sub.vx += 0.05; if (sub.x > W * 0.9) sub.vx -= 0.05;
            if (sub.y < H * 0.1) sub.vy += 0.05; if (sub.y > H * 0.9) sub.vy -= 0.05;
            sub.radius = (180 + 80 * Math.sin(sub.phase)) * (0.8 + 0.4 * Math.sin(migration.breathPhase + sub.phase));
        }
    }

    function getMigrationForce(f, t) {
        let fx = Math.cos(migration.angle) * migration.strength * 0.3;
        let fy = Math.sin(migration.angle) * migration.strength * 0.3;
        const distFromOrigin = Math.hypot(f.x - migration.waveOrigin.x, f.y - migration.waveOrigin.y);
        const waveEffect = Math.sin(distFromOrigin * 0.008 - migration.waveTime) * 0.06;
        fx += Math.cos(migration.angle + Math.PI * 0.5) * waveEffect;
        fy += Math.sin(migration.angle + Math.PI * 0.5) * waveEffect;
        const toCenterX = migration.centerX - f.x, toCenterY = migration.centerY - f.y;
        const distToCenter = Math.hypot(toCenterX, toCenterY) + 1;
        const breathEffect = Math.sin(migration.breathPhase) * 0.04;
        fx -= (toCenterX / distToCenter) * breathEffect;
        fy -= (toCenterY / distToCenter) * breathEffect;

        for (const sub of subSchools) {
            const d = Math.hypot(f.x - sub.x, f.y - sub.y);
            if (d < sub.radius) {
                const pull = (1 - d / sub.radius) * sub.strength * 0.1;
                fx += (sub.x - f.x) / (d + 1) * pull;
                fy += (sub.y - f.y) / (d + 1) * pull;
                break;
            }
        }
        const independence = Math.min(1, distToCenter / 250) * 0.05;
        fx += (Math.random() - 0.5) * independence; fy += (Math.random() - 0.5) * independence;
        return { fx, fy, speedMod: migration.speedMod };
    }

    // ---------- Megafauna System ----------
    const megafauna = [];
    let megafaunaTimer = 5000;
    const MEGAFAUNA_TYPES = { WHALE: 'whale', DOLPHIN: 'dolphin', TURTLE: 'turtle', MANTA: 'manta', WHALE_GIANT: 'whaleGiant' };

    function createMegafauna() {
        const isMassive = Math.random() < 0.15;
        const types = isMassive ? [{ type: MEGAFAUNA_TYPES.WHALE_GIANT, weight: 50, size: [1500, 2500], speed: [0.3, 0.6] }, { type: MEGAFAUNA_TYPES.MANTA, weight: 30, size: [1200, 1800], speed: [0.4, 0.75] }, { type: MEGAFAUNA_TYPES.WHALE, weight: 20, size: [1200, 1800], speed: [0.4, 0.7] }] : [{ type: MEGAFAUNA_TYPES.WHALE, weight: 25, size: [600, 1200], speed: [0.6, 1.1] }, { type: MEGAFAUNA_TYPES.DOLPHIN, weight: 35, size: [280, 550], speed: [1.25, 2.1] }, { type: MEGAFAUNA_TYPES.TURTLE, weight: 20, size: [220, 450], speed: [0.5, 0.9] }, { type: MEGAFAUNA_TYPES.MANTA, weight: 20, size: [450, 900], speed: [0.7, 1.3] }];
        let total = types.reduce((s, t) => s + t.weight, 0), r = Math.random() * total, selected = types[0];
        for (const t of types) { r -= t.weight; if (r <= 0) { selected = t; break; } }
        const side = Math.random() < 0.5 ? -1 : 1, sz = rand(selected.size[0], selected.size[1]);
        return { type: selected.type, x: side < 0 ? -sz : W + sz, y: rand(H * 0.15, H * 0.8), targetX: side < 0 ? W + sz : -sz, size: sz, speed: rand(selected.speed[0], selected.speed[1]), direction: -side, yDrift: rand(-0.25, 0.25), phase: rand(0, Math.PI * 2), alpha: isMassive ? rand(0.08, 0.15) : rand(0.12, 0.22), depth: rand(0.3, 0.5), isMassive, attractRadius: isMassive ? rand(500, 800) : rand(350, 550), attractStrength: isMassive ? rand(0.25, 0.45) : rand(0.18, 0.35) };
    }

    function updateMegafauna(dt) {
        megafaunaTimer -= dt;
        if (megafaunaTimer <= 0 && megafauna.length < 5) { megafauna.push(createMegafauna()); megafaunaTimer = rand(3000, 8000); }
        for (let i = megafauna.length - 1; i >= 0; i--) {
            const m = megafauna[i]; m.x += m.direction * m.speed * dt * 0.06; m.y += m.yDrift * dt * 0.02; m.phase += dt * 0.003;
            if (m.direction > 0 ? m.x > W + m.size * 2 : m.x < -m.size * 2) megafauna.splice(i, 1);
        }
    }

    function getMegafaunaForce(f) {
        let fx = 0, fy = 0;
        for (const m of megafauna) {
            const dx = m.x - f.x, dy = m.y - f.y, d = Math.hypot(dx, dy);
            if (d < m.attractRadius && d > 30) { const s = (1 - d / m.attractRadius) * m.attractStrength * 0.5; fx += (dx / d) * s; fy += (dy / d) * s; }
        }
        return { fx, fy };
    }

    // ---------- Predator System ----------
    const predator = { active: false, timer: rand(35000, 55000), shark: null, lightWaves: [], victoryFlash: 0 };
    function spawnPredator() {
        const side = randInt(0, 3); let sx, sy, dx, dy;
        if (side === 0) { sx = -150; sy = rand(H * 0.22, H * 0.78); dx = 1; dy = 0; }
        else if (side === 1) { sx = W + 150; sy = rand(H * 0.22, H * 0.78); dx = -1; dy = 0; }
        else if (side === 2) { sx = rand(W * 0.22, W * 0.78); sy = -110; dx = 0; dy = 1; }
        else { sx = rand(W * 0.22, W * 0.78); sy = H + 110; dx = 0; dy = -1; }
        const pen = rand(220, 400);
        predator.shark = { x: sx, y: sy, entryDx: dx, entryDy: dy, targetX: sx + dx * pen, targetY: sy + dy * pen, life: 0, maxLife: 8000, fleeMeter: 0, fleeing: false, fleeProgress: 0, phase: rand(0, Math.PI * 2), entryProgress: 0 };
        predator.active = true;
        events.flashTimer = 520;
        audio.playBubble();
    }

    function updatePredator(dt) {
        if (predator.victoryFlash > 0) predator.victoryFlash -= dt;
        if (!predator.active) { if (!events.active.length) { predator.timer -= dt; if (predator.timer <= 0) { spawnPredator(); predator.timer = rand(35000, 55000); } } return; }
        const s = predator.shark; s.life += dt; s.phase += dt * 0.005;
        if (s.entryProgress < 1) s.entryProgress = Math.min(1, s.entryProgress + dt / 1400);
        if (!s.fleeing) {
            const ddx = s.targetX - s.x, ddy = s.targetY - s.y, dd = Math.hypot(ddx, ddy);
            if (dd > 4) { const spd = 0.22 * s.entryProgress; s.x += (ddx / dd) * spd * dt * 0.06; s.y += (ddy / dd) * spd * dt * 0.06; }
            const curDist = Math.hypot(pointer.x - s.x, pointer.y - s.y), waveRange = 250;
            if (curDist < waveRange && s.entryProgress > 0.45) {
                if (Math.random() < dt * 0.0038) predator.lightWaves.push({ x: pointer.x, y: pointer.y, r: 0, life: 0, maxLife: 680 });
                s.fleeMeter += Math.pow(1 - curDist / waveRange, 2) * dt * 0.00042;
            }
            if (s.fleeMeter >= 1 || s.life >= s.maxLife) {
                s.fleeing = true; s.fleeProgress = 0;
                if (s.fleeMeter >= 1) { predator.victoryFlash = 720; audio.predatorVictory(); }
            }
        } else {
            s.fleeProgress = Math.min(1, s.fleeProgress + dt / 820);
            const acc = s.fleeProgress * s.fleeProgress;
            s.x -= s.entryDx * acc * 0.42 * dt * 0.06; s.y -= s.entryDy * acc * 0.42 * dt * 0.06;
            if (s.fleeProgress >= 1) { predator.active = false; predator.shark = null; }
        }
        for (let i = predator.lightWaves.length - 1; i >= 0; i--) {
            const w = predator.lightWaves[i]; w.life += dt; w.r = (w.life / w.maxLife) * 170;
            if (w.life >= w.maxLife) predator.lightWaves.splice(i, 1);
        }
    }

    function getPredatorForce(f) {
        if (!predator.active || !predator.shark) return { fx: 0, fy: 0 };
        const s = predator.shark; let fs = s.fleeing ? Math.max(0, 1 - s.fleeProgress * 2.6) : 1;
        if (fs <= 0) return { fx: 0, fy: 0 };
        const dx = f.x - s.x, dy = f.y - s.y, d = Math.hypot(dx, dy) || 1;
        const lF = Math.max(0, 1 - d / (Math.max(W, H) * 0.78)), sR = 400;
        const sS = d < sR ? Math.pow(1 - d / sR, 2) * 6.2 : 0;
        const str = (lF * 1.7 + sS) * fs;
        return { fx: (dx / d) * str + ((f.hueSeed * 7.13 + f.size) % 1 - 0.5) * 1.5 * fs, fy: (dy / d) * str + ((f.hueSeed * 4.67 + f.phase * 0.0002) % 1 - 0.5) * 1.5 * fs };
    }

    // ---------- Event Director ----------
    const events = { active: [], cooldown: 0, lastEventTime: 0, flashTimer: 0 };
    const EVENT_TYPES = { VORTEX: 'vortex', PRESSURE_WAVE: 'pressureWave', MIGRATION: 'migration', DEPTH_SHIFT: 'depthShift', SPLIT: 'split' };

    function createEvent(type) {
        const b = { type, life: 0, maxLife: 0, phase: 0, x: 0, y: 0 };
        if (type === EVENT_TYPES.VORTEX) return { ...b, x: rand(W * 0.2, W * 0.8), y: rand(H * 0.2, H * 0.8), maxLife: rand(4000, 7000), radius: rand(180, 320), strength: rand(0.6, 1.2), direction: Math.random() < 0.5 ? 1 : -1, riseTime: 800, fadeTime: 1200 };
        if (type === EVENT_TYPES.PRESSURE_WAVE) {
            const side = randInt(0, 3); let px, py, dx, dy;
            if (side === 0) { px = -100; py = rand(H * 0.2, H * 0.8); dx = 1; dy = 0; } else if (side === 1) { px = W + 100; py = rand(H * 0.2, H * 0.8); dx = -1; dy = 0; } else if (side === 2) { px = rand(W * 0.2, W * 0.8); py = -100; dx = 0; dy = 1; } else { px = rand(W * 0.2, W * 0.8); py = H + 100; dx = 0; dy = -1; }
            return { ...b, x: px, y: py, dx, dy, speed: rand(0.4, 0.7), maxLife: rand(3500, 5500), radius: rand(150, 250), strength: rand(1.5, 2.5), compressionPhase: 0 };
        }
        if (type === EVENT_TYPES.MIGRATION) { const a = rand(0, Math.PI * 2); return { ...b, maxLife: rand(2500, 4500), angle: a, dx: Math.cos(a), dy: Math.sin(a), strength: rand(0.4, 0.8), riseTime: 600, fadeTime: 800 }; }
        if (type === EVENT_TYPES.DEPTH_SHIFT) return { ...b, maxLife: rand(3000, 5000), direction: Math.random() < 0.5 ? -1 : 1, strength: rand(0.5, 0.9), riseTime: 500, fadeTime: 1000 };
        if (type === EVENT_TYPES.SPLIT) return { ...b, maxLife: rand(5000, 8000), centers: [{ x: W * 0.3 + rand(-80, 80), y: H * 0.4 + rand(-60, 60) }, { x: W * 0.7 + rand(-80, 80), y: H * 0.6 + rand(-60, 60) }], strength: rand(0.3, 0.6), riseTime: 1000, fadeTime: 1500 };
        return b;
    }

    function updateEventDirector(dt, t) {
        events.cooldown = Math.max(0, events.cooldown - dt); if (events.flashTimer > 0) events.flashTimer -= dt;
        pointer.idle += dt;
        if ((pointer.idle > 5000 && !events.active.length && events.cooldown <= 0 || (t - events.lastEventTime > rand(15000, 25000) && events.active.length < 2 && events.cooldown <= 0)) && !predator.active) {
            const weights = [{ type: EVENT_TYPES.VORTEX, w: 30 }, { type: EVENT_TYPES.PRESSURE_WAVE, w: 25 }, { type: EVENT_TYPES.MIGRATION, w: 20 }, { type: EVENT_TYPES.DEPTH_SHIFT, w: 15 }, { type: EVENT_TYPES.SPLIT, w: 10 }];
            let total = weights.reduce((s, w) => s + w.w, 0), r = Math.random() * total, chosen = EVENT_TYPES.VORTEX;
            for (const w of weights) { r -= w.w; if (r <= 0) { chosen = w.type; break; } }
            events.active.push(createEvent(chosen)); events.lastEventTime = t; events.cooldown = rand(6000, 10000); events.flashTimer = 800; pointer.idle = 0;
        }
        for (let i = events.active.length - 1; i >= 0; i--) {
            const ev = events.active[i]; ev.life += dt;
            const rT = ev.riseTime || 800, fT = ev.fadeTime || 1000, aT = ev.maxLife - rT - fT;
            if (ev.life < rT) { ev.phase = 0; ev.intensity = easeOut(ev.life / rT); } else if (ev.life < rT + aT) { ev.phase = 1; ev.intensity = 1; } else { ev.phase = 2; ev.intensity = 1 - easeInOut((ev.life - rT - aT) / fT); }
            if (ev.type === EVENT_TYPES.PRESSURE_WAVE) { ev.x += ev.dx * ev.speed * dt; ev.y += ev.dy * ev.speed * dt; ev.compressionPhase = clamp01(ev.life / (ev.maxLife * 0.4)); }
            if (ev.life >= ev.maxLife) events.active.splice(i, 1);
        }
    }

    function getEventForce(f, t) {
        let fx = 0, fy = 0;
        for (const ev of events.active) {
            const i = ev.intensity || 0;
            if (ev.type === EVENT_TYPES.VORTEX) { const dx = f.x - ev.x, dy = f.y - ev.y, d = Math.hypot(dx, dy); if (d < ev.radius && d > 10) { const fO = 1 - d / ev.radius, p = fO * 0.3 * i * ev.strength, s = fO * 0.7 * i * ev.strength; fx += (-dx / d) * p + (-dy / d) * s * ev.direction; fy += (-dy / d) * p + (dx / d) * s * ev.direction; } }
            else if (ev.type === EVENT_TYPES.PRESSURE_WAVE) { const dx = f.x - ev.x, dy = f.y - ev.y, d = Math.hypot(dx, dy); if (d < ev.radius && d > 1) { const fO = 1 - d / ev.radius, sC = ev.compressionPhase < 0.5 ? 1 : -0.6, force = fO * i * ev.strength * sC; fx += (dx / d) * force; fy += (dy / d) * force; } }
            else if (ev.type === EVENT_TYPES.MIGRATION) { fx += ev.dx * ev.strength * i; fy += ev.dy * ev.strength * i; }
            else if (ev.type === EVENT_TYPES.DEPTH_SHIFT) { fy += ev.direction * ev.strength * i; fx += Math.sin(f.x * 0.01 + t * 0.001) * 0.15 * i; }
            else if (ev.type === EVENT_TYPES.SPLIT) { let nD = Infinity, nX = 0, nY = 0; for (const c of ev.centers) { const dx = c.x - f.x, dy = c.y - f.y, d = Math.hypot(dx, dy); if (d < nD) { nD = d; nX = dx; nY = dy; } } if (nD > 20) { const p = Math.min(1, 200 / nD) * ev.strength * i; fx += (nX / nD) * p; fy += (nY / nD) * p; } }
        }
        return { fx, fy };
    }

    // ---------- Particles and Layers ----------
    const flowParticles = [];
    let flowSpawnAcc = 0;
    function spawnFlowParticle(x, y, vx, vy) {
        const p = flowParticles.length >= 120 ? flowParticles.shift() : {};
        p.x = x + rand(-15, 15); p.y = y + rand(-15, 15); p.vx = vx * 0.3 + rand(-0.02, 0.02); p.vy = vy * 0.3 + rand(-0.02, 0.02); p.life = 0; p.maxLife = rand(800, 1800); p.size = rand(1.5, 3.5); p.alpha = rand(0.15, 0.35);
        if (!flowParticles.includes(p)) flowParticles.push(p);
    }
    function updateFlowParticles(dt) {
        flowSpawnAcc += dt * Math.min(Math.hypot(pointer.vx, pointer.vy) * 180, 12) / 1000;
        while (flowSpawnAcc >= 1) { flowSpawnAcc -= 1; spawnFlowParticle(pointer.x, pointer.y, pointer.vx, pointer.vy); }
        for (let i = flowParticles.length - 1; i >= 0; i--) {
            const p = flowParticles[i]; p.life += dt; const dx = pointer.x - p.x, dy = pointer.y - p.y, dist = Math.hypot(dx, dy), heat = Math.exp(-dist / 300);
            p.vx = (p.vx + (dx / (dist + 1)) * heat * 0.0001 * dt + (fbm(p.x * 0.01, p.y * 0.01 + performance.now() * 0.0001) - 0.5) * 0.001 * dt) * 0.995; p.vy = (p.vy + (dy / (dist + 1)) * heat * 0.0001 * dt - 0.00008 * dt) * 0.995;
            p.x += p.vx * dt; p.y += p.vy * dt; if (p.life >= p.maxLife) flowParticles.splice(i, 1);
        }
    }

    const godRays = [];
    function initGodRays() { godRays.length = 0; for (let i = 0; i < 5; i++) godRays.push({ x: rand(W * 0.1, W * 0.9), width: rand(80, 200), speed: rand(0.008, 0.015), phase: rand(0, Math.PI * 2), alpha: rand(0.03, 0.07), drift: rand(-0.02, 0.02) }); }

    const snow = [];
    function initSnow() {
        snow.length = 0;
        const layers = [{ n: 100, z: 0.35, sp: 0.16, r: [0.5, 1.0], a: 0.10 }, { n: 80, z: 0.65, sp: 0.28, r: [0.7, 1.5], a: 0.14 }, { n: 60, z: 1.00, sp: 0.44, r: [1.0, 2.2], a: 0.18 }];
        for (const L of layers) for (let i = 0; i < L.n; i++) snow.push({ x: Math.random() * W, y: Math.random() * H, z: L.z, vy: L.sp * (0.8 + Math.random() * 0.6), vx: L.sp * 0.35 * (Math.random() * 2 - 1), r: rand(L.r[0], L.r[1]), a: L.a });
    }

    const cellSize = 100;
    let gridW, gridH, grid;
    function initSpatial() { gridW = Math.ceil(W / cellSize); gridH = Math.ceil(H / cellSize); grid = new Array(gridW * gridH).fill(0).map(() => []); }
    function rebuildGrid(fish) { for (let i = 0; i < grid.length; i++) grid[i].length = 0; for (let i = 0; i < fish.length; i++) { const f = fish[i], cx = clamp(Math.floor(f.x / cellSize), 0, gridW - 1), cy = clamp(Math.floor(f.y / cellSize), 0, gridH - 1); grid[cy * gridW + cx].push(i); } }

    function spawnFish(count) {
        const targetFishCount = count;
        const silverTypes = [
            { baseHue: 200, satRange: [5, 18] }, { baseHue: 210, satRange: [8, 22] }, { baseHue: 190, satRange: [6, 16] }, { baseHue: 220, satRange: [10, 25] }, { baseHue: 195, satRange: [4, 14] }
        ];
        const colorfulTypes = [
            { baseHue: 35, satRange: [40, 65] }, { baseHue: 15, satRange: [45, 70] }, { baseHue: 355, satRange: [40, 60] }, { baseHue: 50, satRange: [50, 75] }
        ];
        for (let i = 0; i < count; i++) {
            const roll = Math.random(), isColorful = roll < 0.05, isLarge = roll >= 0.05 && roll < 0.10;
            const colorType = isColorful ? colorfulTypes[randInt(0, colorfulTypes.length - 1)] : silverTypes[randInt(0, silverTypes.length - 1)];
            const f = { x: Math.random() * W, y: Math.random() * H, vx: rand(-1, 1), vy: rand(-1, 1), size: isLarge ? rand(5.2, 8.2) : rand(3.5, 5.5), isLarge, isColorful, baseHue: colorType.baseHue + rand(-8, 8), baseSatMin: colorType.satRange[0], baseSatMax: colorType.satRange[1], phase: rand(0, 1000), hueSeed: Math.random(), wander: rand(0.7, 1.3), breakout: 0, bodyPhase: rand(0, Math.PI * 2), bodyWaveSpeed: rand(0.008, 0.015), currentAngle: 0, angleSmoothing: rand(0.03, 0.08), scaleShimmer: rand(0.8, 1.2), bodyTone: rand(-5, 5) };
            assignDepthLayer(f);
            fish.push(f);
        }
    }

    function assignDepthLayer(f) {
        const r = Math.random();
        if (r < 0.15) { f.depthLayer = 'foreground'; f.depthScale = rand(1.15, 1.35); f.depthAlpha = 1.0; }
        else if (r < 0.85) { f.depthLayer = 'midground'; f.depthScale = rand(0.9, 1.1); f.depthAlpha = rand(0.85, 1.0); }
        else { f.depthLayer = 'background'; f.depthScale = rand(0.6, 0.8); f.depthAlpha = rand(0.4, 0.65); }
    }

    function drawBackground(t) {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#061a28'); g.addColorStop(0.45, '#04121d'); g.addColorStop(1, '#02070e');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.globalCompositeOperation = 'multiply';
        const vg = ctx.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.35, W * 0.5, H * 0.45, Math.max(W, H) * 0.78);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.72)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); ctx.restore();
    }

    function drawFish(f, t) {
        const dX = f.x - pointer.x, dY = f.y - pointer.y, dist = Math.hypot(dX, dY), near = 1 - Math.min(1, dist / (Math.min(W, H) * 0.65)), nearP = Math.pow(near, 0.6), spd = Math.hypot(f.vx, f.vy);
        const hue = f.baseHue + f.bodyTone + Math.sin(t * 0.0008 + f.phase) * 3, sat = lerp(f.baseSatMin, f.baseSatMax + (f.isColorful ? 20 : 8), nearP) + spd * 2.5, flash = migration.flashIntensity * 20 * (0.5 + Math.random() * 0.5), lit = lerp(38, 62, nearP) + flash + f.bodyTone * 0.5 + (f.isColorful ? 5 : 0), alpha = lerp(0.25, 0.95, Math.pow(near, 0.45)) * f.depthAlpha;
        const targetA = Math.atan2(f.vy, f.vx); let aDiff = targetA - f.currentAngle; while (aDiff > Math.PI) aDiff -= Math.PI * 2; while (aDiff < -Math.PI) aDiff += Math.PI * 2;
        f.currentAngle += aDiff * f.angleSmoothing; const ang = f.currentAngle, s = f.size * f.depthScale;
        f.bodyPhase += f.bodyWaveSpeed * (1 + spd * 0.5); const bodyW = Math.sin(f.bodyPhase) * 0.08 * (1 + spd * 0.3), tailS = Math.sin(f.bodyPhase - 0.8) * (0.18 + spd * 0.12);
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(ang);
        const bg = ctx.createLinearGradient(0, -s, 0, s);
        bg.addColorStop(0, `hsla(${hue + 5},${sat + 5}%,${lit - 22}%,${alpha})`); bg.addColorStop(0.35, `hsla(${hue},${sat}%,${lit - 5}%,${alpha})`); bg.addColorStop(0.5, `hsla(${hue - 3},${Math.max(0, sat - 2)}%,${lit + 12}%,${alpha})`); bg.addColorStop(1, `hsla(${hue - 8},${Math.max(0, sat - 8)}%,${lit + 8}%,${alpha * 0.9})`);
        ctx.fillStyle = bg; ctx.beginPath(); const w1 = bodyW * s * 0.5, w2 = bodyW * s * 0.8;
        ctx.moveTo(s * 2.3, 0); ctx.quadraticCurveTo(s * 1.2, -s * 0.75 + w1, -s * 0.8, -s * 0.6 + w2); ctx.quadraticCurveTo(-s * 2, -s * 0.12 + w2 * 0.5, -s * 2.3, w2 * 0.3); ctx.quadraticCurveTo(-s * 2, s * 0.12 + w2 * 0.5, -s * 0.8, s * 0.6 + w2); ctx.quadraticCurveTo(s * 1.2, s * 0.75 + w1, s * 2.3, 0); ctx.fill();
        ctx.fillStyle = `hsla(${hue + 3},${sat}%,${lit - 8}%,${alpha * 0.88})`; ctx.beginPath(); const tB = w2 * 0.3; ctx.moveTo(-s * 2.2, tB); ctx.quadraticCurveTo(-s * 2.6, -s * 0.3 + tailS * s * 0.5 + tB, -s * 3, -s * 0.7 + tailS * s + tB); ctx.quadraticCurveTo(-s * 2.7, tailS * s * 0.2 + tB, -s * 2.6, tailS * s * 0.15 + tB); ctx.quadraticCurveTo(-s * 2.7, tailS * s * 0.2 + tB, -s * 3, s * 0.7 + tailS * s + tB); ctx.quadraticCurveTo(-s * 2.6, s * 0.3 + tailS * s * 0.5 + tB, -s * 2.2, tB); ctx.fill();
        if (s > 3.2) { ctx.globalAlpha = alpha * 0.85; ctx.fillStyle = `rgba(220,235,245,${0.7 + nearP * 0.2})`; const eS = f.isLarge ? s * 0.09 : Math.max(0.9, s * 0.12); ctx.beginPath(); ctx.arc(s * 1.65, -s * 0.08, eS, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = `rgba(15,25,35,${0.8 + nearP * 0.15})`; ctx.beginPath(); ctx.arc(s * 1.68, -s * 0.08, eS * 0.55, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
    }

    function spawnBubbleCluster(x, y) {
        for (let i = 0; i < 5; i++) bubbles.push({ x: x + rand(-20, 20), y: y + rand(-20, 20), vx: rand(-0.5, 0.5), vy: rand(-1.5, -0.5), rad: rand(1, 4), life: 0, maxLife: rand(1000, 2500) });
    }

    function drawBubbles(dt) {
        for (let i = bubbles.length - 1; i >= 0; i--) {
            const b = bubbles[i]; b.life += dt; b.x += b.vx; b.y += b.vy; ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.rad, 0, Math.PI * 2); ctx.stroke(); if (b.life > b.maxLife) bubbles.splice(i, 1);
        }
    }

    function spawnTrailParticle(x, y) { trail.push({ x, y, life: 0, maxLife: 500 }); if (trail.length > 50) trail.shift(); }
    function updateTrail(dt) { for (let i = trail.length - 1; i >= 0; i--) { trail[i].life += dt; if (trail[i].life > trail[i].maxLife) trail.splice(i, 1); } }
    function drawTrail() { ctx.save(); ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i < trail.length; i++) { const p = trail[i]; if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); } ctx.stroke(); ctx.restore(); }

    function drawSnow(t) {
        for (const s of snow) {
            const dx = s.x - pointer.x, dy = s.y - pointer.y, d = Math.hypot(dx, dy), plume = Math.exp(-d / 260) * 0.2; s.x += (0.1 + s.vx) * s.z + (pointer.vx * 26) * plume * s.z; s.y += (0.18 + s.vy) * s.z + (pointer.vy * 26) * plume * s.z; s.x += Math.sin(t * 0.0007 + s.y * 0.01) * 0.1 * s.z;
            if (s.x < -20) s.x = W + 20; if (s.x > W + 20) s.x = -20; if (s.y < -20) s.y = H + 20; if (s.y > H + 20) s.y = -20;
            ctx.globalAlpha = s.a; ctx.fillStyle = 'rgba(200,240,255,1)'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.z, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawGodRays(t) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        for (const ray of godRays) {
            ray.x += ray.drift; if (ray.x < -ray.width) ray.x = W + ray.width; if (ray.x > W + ray.width) ray.x = -ray.width;
            const pulse = 0.7 + 0.3 * Math.sin(t * ray.speed + ray.phase), alpha = ray.alpha * pulse; ctx.globalAlpha = alpha;
            const g = ctx.createLinearGradient(ray.x, 0, ray.x, H); g.addColorStop(0, 'rgba(210, 230, 245, 0.4)'); g.addColorStop(1, 'rgba(160, 195, 225, 0)');
            ctx.fillStyle = g; ctx.beginPath(); const tw = ray.width * 0.6, bw = ray.width * 1.8; ctx.moveTo(ray.x - tw / 2, 0); ctx.lineTo(ray.x + tw / 2, 0); ctx.lineTo(ray.x + bw / 2, H); ctx.lineTo(ray.x - bw / 2, H); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
    }

    function step(dt, t) {
        updateMigration(dt, t); rebuildGrid(fish);
        const SPEED = settings.speed;
        const speedFactor = SPEED, accel = 0.14, baseDrag = 0.94, stepK = 0.1;
        for (let i = 0; i < fish.length; i++) {
            const f = fish[i]; if (f.breakout > 0) f.breakout -= dt; else if (Math.random() < 0.0005) f.breakout = rand(300, 800);
            let ax = 0, ay = 0, avx = 0, avy = 0, cox = 0, coy = 0, sepX = 0, sepY = 0, count = 0;
            const cx = clamp(Math.floor(f.x / cellSize), 0, gridW - 1), cy = clamp(Math.floor(f.y / cellSize), 0, gridH - 1);
            for (let oy = -1; oy <= 1; oy++) {
                const yy = cy + oy; if (yy < 0 || yy >= gridH) continue;
                for (let ox = -1; ox <= 1; ox++) {
                    const xx = cx + ox; if (xx < 0 || xx >= gridW) continue;
                    const cell = grid[yy * gridW + xx]; for (let k = 0; k < cell.length; k++) {
                        const j = cell[k]; if (j === i) continue; const o = fish[j], dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy; if (d2 > 60 * 60) continue; const d = Math.sqrt(d2) + 1e-6;
                        avx += o.vx; avy += o.vy; cox += o.x; coy += o.y; const sR = f.isLarge ? 45 : 25; if (d < sR) { const p = (sR - d) / sR; sepX -= (dx / d) * p; sepY -= (dy / d) * p; }
                        count++; if (count >= 18) break;
                    } if (count >= 18) break;
                } if (count >= 18) break;
            }
            if (count > 0) { const inv = 1 / count; ax += (avx * inv - f.vx) * 0.35 + (cox * inv - f.x) * 0.000135 + sepX * 0.95; ay += (avy * inv - f.vy) * 0.35 + (coy * inv - f.y) * 0.000135 + sepY * 0.95; }
            const pdx = pointer.x - f.x, pdy = pointer.y - f.y, dist = Math.max(1, Math.hypot(pdx, pdy)), ux = pdx / dist, uy = pdy / dist, heat = Math.exp(-dist / 600) * 0.7 + 0.35 * Math.max(0, 1 - dist / Math.max(W, H)), pB = dist < 250 ? (1 + (250 - dist) / 80) : 1;
            ax += ux * heat * 4.5 * pB; ay += uy * heat * 4.5 * pB; const n = fbm(f.x * 0.004 + t * 0.00007, f.y * 0.004 + t * 0.00005); f.phase += dt * 0.002; const wig = (Math.sin(f.phase + f.hueSeed * 6.28) + (n - 0.5)) * 0.18 * f.wander; ax += wig; ay -= wig * 0.6;
            const mF = getMigrationForce(f, t), pF = getPredatorForce(f), eF = getEventForce(f, t); ax += mF.fx + pF.fx + eF.fx; ay += mF.fy + pF.fy + eF.fy;
            const drag = baseDrag + (f.isLarge ? -0.005 : 0.01); f.vx = (f.vx + ax * dt * accel * speedFactor * migration.speedMod) * drag; f.vy = (f.vy + ay * dt * accel * speedFactor * migration.speedMod) * drag;
            const v = Math.hypot(f.vx, f.vy) || 1, vM = (f.isLarge ? 16 : 18) * speedFactor * (dist < 350 ? (1 + (350 - dist) / 150) : 1); if (v > vM) { f.vx = (f.vx / v) * vM; f.vy = (f.vy / v) * vM; } f.x += f.vx * dt * stepK; f.y += f.vy * dt * stepK;
            if (f.x < -60) f.x = W + 60; else if (f.x > W + 60) f.x = -60; if (f.y < -60) f.y = H + 60; else if (f.y > H + 60) f.y = -60;
        }
    }

    // ---------- Boot ----------
    resize(); spawnFish(settings.fishCount); startHintTimer();
    let lastT = performance.now(), accumulator = 0;
    function frame() {
        const t = performance.now(); let dt = Math.min(100, t - lastT); lastT = t; accumulator += dt;
        drawBackground(t); updatePointerSmoothing(dt); drawGodRays(t);
        while (accumulator >= 16.67) { step(16.67, t); updateMegafauna(16.67); updateEventDirector(16.67, t); updatePredator(16.67); accumulator -= 16.67; }
        drawSnow(t); drawTrail(); updateTrail(dt); drawBubbles(16.67);
        const depthOrder = ['background', 'midground', 'foreground'];
        for (const layer of depthOrder) for (let pass = 0; pass < 2; pass++) for (const f of fish) if ((f.depthLayer || 'midground') === layer && f.isLarge === (pass === 1)) drawFish(f, t);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
