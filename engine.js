import { audio } from './audio.js';

export function initSimulation(canvasId, config = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // 1. 基础配置
    let SPEED = config.speed || 0.4;
    let targetFishCount = config.fishCount || 1350;
    const settings = { gain: config.gain || 1.0 };
    audio.setGain(settings.gain);

    // 2. 状态变量
    let W = window.innerWidth, H = window.innerHeight, DPR = 1;
    const pointer = { x: W * 0.5, y: H * 0.5, vx: 0, vy: 0, lastT: performance.now() };
    const fish = [];
    const snow = [];
    const godRays = [];
    const cellSize = 100;
    let gridW, gridH, grid = [];
    const migration = { angle: 0, targetAngle: 0, strength: 0.16, flashIntensity: 0 };

    // 3. 工具函数 (必须先定义)
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const hash2 = (x, y) => {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return s - Math.floor(s);
    };
    const valueNoise = (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
        const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
        return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
    };
    const fbm = (x, y) => {
        let f = 0, amp = 0.5, freq = 1;
        for (let i = 0; i < 4; i++) { f += amp * valueNoise(x * freq, y * freq); amp *= 0.5; freq *= 2; }
        return f;
    };

    // 4. 定义职能函数 (在使用前定义)
    const initSystems = () => {
        gridW = Math.ceil(W / cellSize);
        gridH = Math.ceil(H / cellSize);
        grid = new Array(gridW * gridH).fill(0).map(() => []);

        snow.length = 0;
        for (let i = 0; i < 120; i++) snow.push({ x: rand(0, W), y: rand(0, H), z: rand(0.4, 1), vy: rand(0.2, 0.5), a: rand(0.1, 0.2), r: rand(1, 2) });

        godRays.length = 0;
        for (let i = 0; i < 4; i++) godRays.push({ x: rand(0, W), w: rand(120, 240), a: rand(0.02, 0.05), p: rand(0, 100) });
    };

    const resize = () => {
        DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = Math.floor(W * DPR);
        canvas.height = Math.floor(H * DPR);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        initSystems();
    };

    const spawn = (count) => {
        const silvers = [{ h: 204, s: [6, 18] }, { h: 212, s: [8, 22] }];
        for (let i = 0; i < count; i++) {
            const roll = Math.random(), isCol = roll < 0.04, isLarge = roll >= 0.04 && roll < 0.11;
            const t = isCol ? { h: 35, s: [40, 60] } : silvers[Math.floor(Math.random() * silvers.length)];
            const f = {
                x: Math.random() * W, y: Math.random() * H, vx: Math.random() * 2 - 1, vy: Math.random() * 2 - 1,
                sz: isLarge ? rand(6, 8) : rand(3.5, 5), isLarge, isCol, h: t.h, sMin: t.s[0], sMax: t.s[1],
                ph: Math.random() * 1000, tone: Math.random() * 10 - 5, ang: 0, bodyPh: Math.random() * 10,
                shm: 0.9 + Math.random() * 0.2, lA: rand(0.5, 1)
            };
            const r = Math.random();
            if (r < 0.15) { f.ly = 'fg'; f.lS = 1.25; } else if (r < 0.85) { f.ly = 'mg'; f.lS = 1.0; } else { f.ly = 'bg'; f.lS = 0.75; }
            fish.push(f);
        }
    };

    const drawFish = (f, t) => {
        const d = Math.max(1, Math.hypot(f.x - pointer.x, f.y - pointer.y));
        const near = 1 - Math.min(1, d / (Math.min(W, H) * 0.65)), nearP = Math.pow(near, 0.6);
        const spd = Math.hypot(f.vx, f.vy), hue = f.h + f.tone + Math.sin(t * 0.0008 + f.ph) * 3;
        const sat = lerp(f.sMin, f.sMax + (f.isCol ? 24 : 10), nearP) + spd * 2;
        const lit = lerp(36, 64, nearP) + migration.flashIntensity * 15 + f.tone * 0.5;
        const alpha = lerp(0.3, 0.95, Math.pow(near, 0.5)) * f.lA;

        let targetA = Math.atan2(f.vy, f.vx), aDiff = targetA - f.ang;
        while (aDiff > Math.PI) aDiff -= Math.PI * 2; while (aDiff < -Math.PI) aDiff += Math.PI * 2;
        f.ang += aDiff * 0.06; f.bodyPh += 0.015 * (1 + spd * 0.4);

        const bW = Math.sin(f.bodyPh) * 0.1, s = f.sz * f.lS;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang);

        const grad = ctx.createLinearGradient(0, -s, 0, s);
        grad.addColorStop(0, `hsla(${hue + 5},${sat}%,${lit - 15}%,${alpha})`);
        grad.addColorStop(0.5, `hsla(${hue},${sat}%,${lit + 5}%,${alpha})`);
        grad.addColorStop(1, `hsla(${hue - 5},${sat}%,${lit - 5}%,${alpha})`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        const w1 = bW * s * 0.5, w2 = bW * s * 0.8;
        ctx.moveTo(s * 2.2, 0);
        ctx.quadraticCurveTo(s * 1.2, -s * 0.7 + w1, -s * 0.8, -s * 0.6 + w2);
        ctx.quadraticCurveTo(-s * 2, 0, -s * 0.8, s * 0.6 + w2);
        ctx.quadraticCurveTo(s * 1.2, s * 0.7 + w1, s * 2.2, 0);
        ctx.fill();

        // Eye
        if (s > 3) {
            ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(s * 1.5, -s * 0.1, s * 0.12, 0, 7); ctx.fill();
            ctx.fillStyle = 'black'; ctx.beginPath(); ctx.arc(s * 1.55, -s * 0.1, s * 0.06, 0, 7); ctx.fill();
        }
        ctx.restore();
    };

    const step = (t) => {
        if (Math.random() < 0.001) migration.targetAngle = Math.random() * 7;
        let diff = migration.targetAngle - migration.angle;
        while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        migration.angle += diff * 0.05;
        migration.flashIntensity = Math.abs(diff) > 0.4 ? 1 : migration.flashIntensity * 0.96;

        for (let i = 0; i < grid.length; i++) grid[i].length = 0;
        for (let i = 0; i < fish.length; i++) {
            const f = fish[i];
            const gx = clamp(Math.floor(f.x / cellSize), 0, gridW - 1);
            const gy = clamp(Math.floor(f.y / cellSize), 0, gridH - 1);
            grid[gy * gridW + gx].push(i);
        }

        for (let i = 0; i < fish.length; i++) {
            const f = fish[i]; let ax = 0, ay = 0;
            const gx = clamp(Math.floor(f.x / cellSize), 0, gridW - 1);
            const gy = clamp(Math.floor(f.y / cellSize), 0, gridH - 1);

            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    const yy = gy + oy, xx = gx + ox;
                    if (yy >= 0 && yy < gridH && xx >= 0 && xx < gridW) {
                        for (const idx of grid[yy * gridW + xx]) {
                            if (idx === i) continue;
                            const o = fish[idx], dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy;
                            if (d2 < 3600) {
                                ax += (o.vx - f.vx) * 0.35 + (o.x - f.x) * 0.0001;
                                ay += (o.vy - f.vy) * 0.35 + (o.y - f.y) * 0.0001;
                                if (d2 < 900) { const d = Math.sqrt(d2); ax -= dx / d * 0.8; ay -= dy / d * 0.8; }
                            }
                        }
                    }
                }
            }

            const dxP = pointer.x - f.x, dyP = pointer.y - f.y, distP = Math.max(1, Math.hypot(dxP, dyP));
            const heat = Math.exp(-distP / 600);
            ax += (dxP / distP) * heat * 5; ay += (dyP / distP) * heat * 5;
            ax += Math.cos(migration.angle) * 0.2; ay += Math.sin(migration.angle) * 0.2;

            f.vx = (f.vx + ax * 0.15 * SPEED) * 0.94;
            f.vy = (f.vy + ay * 0.15 * SPEED) * 0.94;
            f.x += f.vx; f.y += f.vy;

            if (f.x < -100) f.x = W + 100; if (f.x > W + 100) f.x = -100;
            if (f.y < -100) f.y = H + 100; if (f.y > H + 100) f.y = -100;
        }

        if (fish.length < targetFishCount) spawn(Math.min(20, targetFishCount - fish.length));
        else if (fish.length > targetFishCount) fish.splice(0, Math.min(20, fish.length - targetFishCount));
    };

    // 5. 事件绑定
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    bind('spdMinus', () => SPEED = clamp(SPEED / 1.2, 0.1, 4));
    bind('spdPlus', () => SPEED = clamp(SPEED * 1.2, 0.1, 4));
    bind('cntMinus', () => targetFishCount = clamp(targetFishCount - 200, 200, 2500));
    bind('cntPlus', () => targetFishCount = clamp(targetFishCount + 200, 200, 2500));
    bind('snd', () => {
        audio.enabled = !audio.enabled;
        const b = document.getElementById('snd'); if (b) b.textContent = audio.enabled ? '🔊' : '🔇';
        audio.playClick();
    });

    window.addEventListener('pointermove', (e) => {
        const now = performance.now(), dt = Math.max(1, now - pointer.lastT);
        pointer.vx = (e.clientX - pointer.x) / dt; pointer.vy = (e.clientY - pointer.y) / dt;
        pointer.x = e.clientX; pointer.y = e.clientY; pointer.lastT = now;
        const hint = document.getElementById('hint'); if (hint) hint.classList.add('off');
    });

    window.addEventListener('resize', resize);

    // 6. 启动循环
    const frame = () => {
        const t = performance.now();
        ctx.fillStyle = '#061a28'; ctx.fillRect(0, 0, W, H);

        ctx.save(); ctx.globalCompositeOperation = 'screen';
        for (const r of godRays) {
            ctx.globalAlpha = r.a * (0.8 + 0.2 * Math.sin(t * 0.001 + r.p));
            ctx.fillStyle = 'white'; ctx.fillRect(r.x, 0, r.w, H);
        }
        ctx.restore();

        step(t);

        for (const s of snow) {
            s.y += s.vy; if (s.y > H) s.y = -10;
            ctx.globalAlpha = s.a; ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.z, 0, 7); ctx.fill();
        }

        const lys = ['bg', 'mg', 'fg'];
        for (const ly of lys) for (const f of fish) if (f.ly === ly) drawFish(f, t);

        requestAnimationFrame(frame);
    };

    // 7. 正式运行
    resize();
    spawn(targetFishCount);
    requestAnimationFrame(frame);
}
