import { audio } from './audio.js';

export function initSimulation(canvasId, config = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // ---------- Settings & State ----------
    let SPEED = config.speed || 0.4;
    let targetFishCount = config.fishCount || 1350;
    const settings = { gain: config.gain || 1.0 };

    audio.setGain(settings.gain);

    let W = innerWidth, H = innerHeight, DPR = 1;
    const pointer = { x: W * 0.5, y: H * 0.5, vx: 0, vy: 0, lastT: performance.now(), idle: 0 };
    const fish = [];
    const bubbles = [];
    let bubbleAcc = 0;
    const flowParticles = [];
    const godRays = [];
    const snow = [];
    const currentLines = [];
    let densityGlow = 0;

    // ---------- Utilities ----------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const randInt = (a, b) => Math.floor(rand(a, b + 1));
    const easeOut = t => 1 - Math.pow(1 - t, 3);

    function hash2(x, y) {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return s - Math.floor(s);
    }
    function smoothstep(t) { return t * t * (3 - 2 * t); }
    function valueNoise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const u = smoothstep(x - xi), v = smoothstep(y - yi);
        return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
    }
    function fbm(x, y) {
        let f = 0, amp = 0.5, freq = 1;
        for (let i = 0; i < 4; i++) { f += amp * valueNoise(x * freq, y * freq); amp *= 0.5; freq *= 2; }
        return f;
    }

    // ---------- HUD Controls ----------
    function bindButtons() {
        const spdMinus = document.getElementById('spdMinus');
        const spdPlus = document.getElementById('spdPlus');
        const cntMinus = document.getElementById('cntMinus');
        const cntPlus = document.getElementById('cntPlus');
        const sndBtn = document.getElementById('snd');

        if (spdMinus) spdMinus.onclick = () => { SPEED = clamp(SPEED / 1.12, 0.25, 4.0); };
        if (spdPlus) spdPlus.onclick = () => { SPEED = clamp(SPEED * 1.12, 0.25, 4.0); };
        if (cntMinus) cntMinus.onclick = () => { targetFishCount = clamp(targetFishCount - 150, 200, 2000); };
        if (cntPlus) cntPlus.onclick = () => { targetFishCount = clamp(targetFishCount + 150, 200, 2000); };
        if (sndBtn) {
            sndBtn.onclick = () => {
                audio.enabled = !audio.enabled;
                sndBtn.textContent = audio.enabled ? '🔊' : '🔇';
                audio.playClick();
            };
        }
    }
    bindButtons();

    // ---------- Resize & Spatial ----------
    const cellSize = 100;
    let gridW, gridH, grid;
    function initSpatial() {
        gridW = Math.ceil(W / cellSize); gridH = Math.ceil(H / cellSize);
        grid = new Array(gridW * gridH).fill(0).map(() => []);
    }
    function resize() {
        DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        W = innerWidth; H = innerHeight;
        canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        initSpatial(); initSnow(); initGodRays(); initSubSchools(); initCurrentLines();
    }
    window.addEventListener('resize', resize, { passive: true });

    // ---------- Interaction ----------
    const hint = document.getElementById('hint');
    window.addEventListener('pointermove', (e) => {
        const now = performance.now(), dt = Math.max(1, now - pointer.lastT);
        pointer.vx = (e.clientX - pointer.x) / dt; pointer.vy = (e.clientY - pointer.y) / dt;
        pointer.x = e.clientX; pointer.y = e.clientY; pointer.lastT = now; pointer.idle = 0;
        if (hint) hint.classList.add('off');
    }, { passive: true });

    // ---------- Fish System ----------
    function spawnFish(count) {
        const silverTypes = [{ h: 204, s: [6, 18] }, { h: 212, s: [8, 22] }, { h: 196, s: [4, 16] }];
        for (let i = 0; i < count; i++) {
            const roll = Math.random(), isCol = roll < 0.04, isLarge = roll >= 0.04 && roll < 0.11;
            const type = isCol ? { h: 35, s: [40, 60] } : silverTypes[randInt(0, 2)];
            const f = {
                x: Math.random() * W, y: Math.random() * H, vx: rand(-1, 1), vy: rand(-1, 1),
                sz: isLarge ? rand(5.0, 8.0) : rand(3.4, 5.2), isLarge, isCol,
                h: type.h + rand(-6, 6), sMin: type.s[0], sMax: type.s[1],
                ph: rand(0, 1000), tone: rand(-6, 6), ang: 0, bodyPh: Math.random() * Math.PI * 2,
                shm: rand(0.85, 1.15), breakout: 0, wander: rand(0.8, 1.2), hSeed: Math.random()
            };
            const r = Math.random();
            if (r < 0.15) { f.ly = 'fg'; f.lS = rand(1.18, 1.35); f.lA = 1.0; }
            else if (r < 0.85) { f.ly = 'mg'; f.lS = rand(0.92, 1.08); f.lA = rand(0.8, 1.0); }
            else { f.ly = 'bg'; f.lS = rand(0.65, 0.82); f.lA = rand(0.4, 0.62); }
            fish.push(f);
        }
    }

    function drawFish(f, t) {
        const d = Math.max(1, Math.hypot(f.x - pointer.x, f.y - pointer.y));
        const near = 1 - Math.min(1, d / (Math.min(W, H) * 0.65)), nearP = Math.pow(near, 0.6);
        const spd = Math.hypot(f.vx, f.vy), hue = f.h + f.tone + Math.sin(t * 0.0008 + f.ph) * 3;
        const sat = lerp(f.sMin, f.sMax + (f.isCol ? 25 : 10), nearP) + spd * 2.2;
        const flash = migration.flashIntensity * 22 * (0.5 + Math.random() * 0.5);
        const lit = lerp(36, 64, nearP) + flash + f.tone * 0.5 + (f.isCol ? 6 : 0);
        const alpha = lerp(0.25, 0.96, Math.pow(near, 0.5)) * f.lA;

        let targetA = Math.atan2(f.vy, f.vx), aDiff = targetA - f.ang;
        while (aDiff > Math.PI) aDiff -= Math.PI * 2; while (aDiff < -Math.PI) aDiff += Math.PI * 2;
        f.ang += aDiff * 0.05;

        f.bodyPh += 0.012 * (1 + spd * 0.45);
        const bW = Math.sin(f.bodyPh) * 0.09 * (1 + spd * 0.25), tS = Math.sin(f.bodyPh - 0.75) * (0.2 + spd * 0.15);
        const s = f.sz * f.lS;

        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang);
        const grad = ctx.createLinearGradient(0, -s, 0, s);
        grad.addColorStop(0, `hsla(${hue + 4},${sat + 4}%,${lit - 22}%,${alpha})`);
        grad.addColorStop(0.35, `hsla(${hue},${sat}%,${lit - 4}%,${alpha})`);
        grad.addColorStop(0.5, `hsla(${hue - 2},${sat}%,${lit + 12}%,${alpha})`);
        grad.addColorStop(1, `hsla(${hue - 6},${sat - 6}%,${lit + 6}%,${alpha * 0.9})`);
        ctx.fillStyle = grad; const w1 = bW * s * 0.5, w2 = bW * s * 0.82;
        ctx.beginPath(); ctx.moveTo(s * 2.3, 0);
        ctx.quadraticCurveTo(s * 1.25, -s * 0.78 + w1, -s * 0.85, -s * 0.62 + w2);
        ctx.quadraticCurveTo(-s * 2.1, -s * 0.12 + w2 * 0.4, -s * 2.35, w2 * 0.25);
        ctx.quadraticCurveTo(-s * 2.1, s * 0.12 + w2 * 0.4, -s * 0.85, s * 0.62 + w2);
        ctx.quadraticCurveTo(s * 1.25, s * 0.78 + w1, s * 2.3, 0); ctx.fill();

        ctx.fillStyle = `hsla(${hue},${sat}%,${lit - 10}%,${alpha * 0.85})`; ctx.beginPath();
        const tB = w2 * 0.3; ctx.moveTo(-s * 2.2, tB);
        ctx.quadraticCurveTo(-s * 2.6, -s * 0.35 + tS * s + tB, -s * 3.1, -s * 0.75 + tS * s + tB);
        ctx.quadraticCurveTo(-s * 2.7, tS * s * 0.2 + tB, -s * 3.1, s * 0.75 + tS * s + tB);
        ctx.quadraticCurveTo(-s * 2.6, s * 0.35 + tS * s + tB, -s * 2.2, tB); ctx.fill();

        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = alpha * (0.15 + nearP * 0.4) * f.shm;
        const shmG = ctx.createLinearGradient(-s * 1.6, 0, s * 1.9, 0); shmG.addColorStop(0, 'rgba(255,255,255,0)'); shmG.addColorStop(0.5, 'rgba(255,255,255,0.8)'); shmG.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = shmG; ctx.lineWidth = s * 0.15; ctx.beginPath(); ctx.moveTo(s * 1.85, -s * 0.05 + w1 * 0.25); ctx.quadraticCurveTo(s * 0.5, -s * 0.2 + w1 * 0.3, -s * 1.6, -s * 0.08 + w2 * 0.3); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';

        if (s > 3.0) {
            ctx.globalAlpha = alpha * 0.9; ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(s * 1.6, -s * 0.08, s * 0.12, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'black'; ctx.beginPath(); ctx.arc(s * 1.64, -s * 0.08, s * 0.06, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    // ---------- Migration & Systems ----------
    const migration = { angle: Math.random() * Math.PI * 2, targetAngle: Math.random() * Math.PI * 2, strength: 0.16, flashIntensity: 0, centerX: W * 0.5, centerY: H * 0.5 };
    function initSnow() { snow.length = 0; for (let i = 0; i < 150; i++) snow.push({ x: Math.random() * W, y: Math.random() * H, z: rand(0.3, 1), vx: rand(-0.1, 0.1), vy: rand(0.2, 0.5), r: rand(0.5, 2), a: rand(0.1, 0.2) }); }
    function initGodRays() { godRays.length = 0; for (let i = 0; i < 4; i++) godRays.push({ x: rand(W * 0.1, W * 0.9), width: rand(100, 200), alpha: rand(0.02, 0.04), phase: rand(0, 10) }); }
    function initCurrentLines() { currentLines.length = 0; for (let i = 0; i < 10; i++) currentLines.push({ y: rand(H * 0.1, H * 0.9), speed: rand(0.0001, 0.0002), phase: rand(0, 10) }); }

    // ---------- Core Step ----------
    function step(dt, t) {
        if (Math.random() < 0.001) migration.targetAngle = Math.random() * Math.PI * 2;
        let diff = migration.targetAngle - migration.angle; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        migration.angle += diff * 0.002 * dt * 0.06; migration.flashIntensity = Math.abs(diff) > 0.3 ? Math.min(1, migration.flashIntensity + dt * 0.002) : migration.flashIntensity * 0.98;

        rebuildGrid(fish);
        let nAcc = 0;
        for (let i = 0; i < fish.length; i++) {
            const f = fish[i]; if (f.breakout > 0) f.breakout -= dt; else if (Math.random() < 0.0005) f.breakout = rand(300, 800);
            let ax = 0, ay = 0, avx = 0, avy = 0, cox = 0, coy = 0, sepX = 0, sepY = 0, count = 0;
            const cx = clamp(Math.floor(f.x / cellSize), 0, gridW - 1), cy = clamp(Math.floor(f.y / cellSize), 0, gridH - 1);
            for (let oy = -1; oy <= 1; oy++) {
                const yy = cy + oy; if (yy < 0 || yy >= gridH) continue;
                for (let ox = -1; ox <= 1; ox++) {
                    const xx = cx + ox; if (xx < 0 || xx >= gridW) continue;
                    const cell = grid[yy * gridW + xx]; for (let k = 0; k < cell.length; k++) {
                        const j = cell[k]; if (j === i) continue; const o = fish[j], dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy;
                        if (d2 > 60 * 60) continue; const d = Math.sqrt(d2) + 0.1; avx += o.vx; avy += o.vy; cox += o.x; coy += o.y;
                        const sR = f.isLarge ? 45 : 28; if (d < sR) { const p = (sR - d) / sR; sepX -= (dx / d) * p; sepY -= (dy / d) * p; }
                        count++; if (count >= 15) break;
                    } if (count >= 15) break;
                } if (count >= 15) break;
            }
            if (count > 0) { const inv = 1 / count; ax += (avx * inv - f.vx) * 0.35 + (cox * inv - f.x) * 0.00015 + sepX * 1.0; ay += (avy * inv - f.vy) * 0.35 + (coy * inv - f.y) * 0.00015 + sepY * 1.0; }
            const pdx = pointer.x - f.x, pdy = pointer.y - f.y, dist = Math.max(1, Math.hypot(pdx, pdy));
            const heat = Math.exp(-dist / 600) * 0.7 + 0.35 * Math.max(0, 1 - dist / Math.max(W, H));
            ax += (pdx / dist) * heat * 4.5; ay += (pdy / dist) * heat * 4.5;
            ax += Math.cos(migration.angle) * migration.strength; ay += Math.sin(migration.angle) * migration.strength;
            const n = fbm(f.x * 0.004 + t * 0.00007, f.y * 0.004 + t * 0.00005);
            f.vx = (f.vx + ax * dt * 0.14 * SPEED) * 0.94; f.vy = (f.vy + ay * dt * 0.14 * SPEED) * 0.94;
            f.x += f.vx; f.y += f.vy;
            if (f.x < -60) f.x = W + 60; else if (f.x > W + 60) f.x = -60; if (f.y < -60) f.y = H + 60; else if (f.y > H + 60) f.y = -60;
            nAcc += count;
        }
        densityGlow = (nAcc / fish.length) / 10;
        if (fish.length !== targetFishCount) {
            const di = targetFishCount - fish.length;
            if (di > 0) spawnFish(Math.min(di, 40)); else fish.splice(0, Math.min(-di, 40));
        }
    }

    // ---------- Main Loop ----------
    resize(); spawnFish(targetFishCount);
    let lT = performance.now();
    function frame() {
        const t = performance.now(), dt = Math.min(60, t - lT); lT = t;
        ctx.fillStyle = '#061a28'; ctx.fillRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#061a28'); g.addColorStop(1, '#02070e'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

        ctx.save(); ctx.globalCompositeOperation = 'screen';
        for (const r of godRays) {
            ctx.globalAlpha = r.alpha * (0.8 + 0.2 * Math.sin(t * 0.001 + r.phase));
            ctx.fillStyle = 'rgba(215,240,255,0.3)'; ctx.fillRect(r.x, 0, r.width, H);
        }
        ctx.restore();

        step(dt, t);
        for (const s of snow) {
            s.x += s.vx; s.y += s.vy; if (s.y > H) s.y = 0; ctx.globalAlpha = s.a; ctx.fillStyle = 'white';
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.z, 0, Math.PI * 2); ctx.fill();
        }
        const lys = ['bg', 'mg', 'fg'];
        for (const ly of lys) {
            for (let p = 0; p < 2; p++) {
                for (const f of fish) if (f.ly === ly && f.isLarge === (p === 1)) drawFish(f, t);
            }
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
