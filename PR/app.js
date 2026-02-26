const DEBUG = new URLSearchParams(location.search).has("debug");
const FORCE_BAD = new URLSearchParams(location.search).has("forceBad"); // ★追加：ショート用（常にbadへ）

const isRecord = new URLSearchParams(location.search).has("record");
if (isRecord) {
  document.querySelector(".stage")?.classList.add("record");
  document.body.classList.add("record");
}


let currentBgUrl = "";
let currentCgUrl = "";
let currentCgOffsetY = "-34%";

function setDebug(text) {
  const p = $("#debugPanel");
  if (!p) return;
  if (!DEBUG || !text) {
    p.style.display = "none";
    p.textContent = "";
    return;
  }
  p.style.display = "block";
  p.textContent = text;
}

function assetExists(ref) {
  return !!(ref && assets && assets[ref]);
}

function validateSteps(steps, where, errors) {
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push(`${where}: steps が空です`);
    return;
  }
  steps.forEach((s, i) => {
    if (!s || typeof s.t !== "string") errors.push(`${where}: steps[${i}].t がありません`);
    if (s?.voiceRef && !assetExists(s.voiceRef)) errors.push(`${where}: steps[${i}].voiceRef が assets にありません → ${s.voiceRef}`);
    if (s?.seRef && !assetExists(s.seRef)) errors.push(`${where}: steps[${i}].seRef が assets にありません → ${s.seRef}`);
  });
}

function validateEpisode(ep) {
  const errors = [];

  if (!ep?.id) errors.push("ep.id がありません");

  if (!ep?.backgroundRef) errors.push("backgroundRef がありません");
  else if (!assetExists(ep.backgroundRef)) errors.push(`backgroundRef が assets にありません → ${ep.backgroundRef}`);

  if (!ep?.mainCgRef) errors.push("mainCgRef がありません");
  else if (!assetExists(ep.mainCgRef)) errors.push(`mainCgRef が assets にありません → ${ep.mainCgRef}`);

  validateSteps(ep?.steps, "intro", errors);

  // choices
  if (!Array.isArray(ep?.choices) || ep.choices.length === 0) {
    errors.push("choices が空です");
  } else {
    // 3択固定ならここで縛れる
    if (ep.choices.length !== 3) errors.push(`choices が3択ではありません（${ep.choices.length}択）`);
    ep.choices.forEach((c, i) => {
      if (!c?.label) errors.push(`choices[${i}].label がありません`);
      if (!c?.to) errors.push(`choices[${i}].to がありません`);
    });
  }

  // nodes
  if (!ep?.nodes || typeof ep.nodes !== "object") {
    errors.push("nodes がありません");
  } else {
    // choices.to が nodes にあるか
    (ep.choices ?? []).forEach((c, i) => {
      if (c?.to && !ep.nodes[c.to]) errors.push(`choices[${i}].to の node がありません → ${c.to}`);
    });

    // node の中身
    Object.keys(ep.nodes).forEach((k) => {
      const n = ep.nodes[k];
      if (!n?.cgRef) errors.push(`nodes.${k}.cgRef がありません`);
      else if (!assetExists(n.cgRef)) errors.push(`nodes.${k}.cgRef が assets にありません → ${n.cgRef}`);

      validateSteps(n?.steps, `nodes.${k}`, errors);
    });
  }

  return errors;
}



const $ = (s) => document.querySelector(s);

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load: ${url} (${r.status})`);
  return r.json();
}

function resolveAsset(assets, ref) {
  const url = assets[ref];
  if (!url) throw new Error(`Asset ref not found: ${ref}`);
  return url;
}
function resolveAssetOrNull(assets, ref) {
  return (ref && assets && assets[ref]) ? assets[ref] : null;
}

function setBg(url) {
  currentBgUrl = url; // 追加
  document.documentElement.style.setProperty("--bg-image", `url("${url}")`);
}

function setCg(url) {
  currentCgUrl = url; // 追加
  const img = $("#cgImg");
  if (!img) throw new Error(`#cgImg が見つかりません（imgに id="cgImg" を付けてください）`);
  img.src = url;
}

function setCgOffsetY(v) {
  currentCgOffsetY = (v ?? "-34%");
  document.documentElement.style.setProperty("--cg-offset-y", currentCgOffsetY);
}


function applyUiByKind(kind) {
  const root = document.documentElement.style;

  const isBad = (kind === "bad");

  const bgY = assets["bg_yandere"];
  const tbN = assets["ui.textBoxFrame"];
  const cbN = assets["ui.choiceBtn"];
  const tbY = assets["textbox_frame_Yandere"];
  const cbY = assets["choice_btn_Yandere"];

  // UI枠/ボタン差し替え
  root.setProperty("--ui-textbox-frame", `url("${isBad && tbY ? tbY : tbN}")`);
  root.setProperty("--ui-choice-btn",   `url("${isBad && cbY ? cbY : cbN}")`);

  // 背景差し替え（badだけ）
  if (isBad && bgY) setBg(bgY);
}



/* ===== UI helpers ===== */
function setStoryText(text) {
  $("#storyText").textContent = text ?? "";
}



  function shuffleInPlace(arr) {
    // Fisher–Yates
    for (let i = arr.length - 1; i > 0; i--) {
      const r = (crypto?.getRandomValues)
        ? crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
        : Math.random();
      const j = Math.floor(r * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function showChoices(choices) {
    const wrap = $("#choices");
    if (!wrap) return;

    wrap.style.removeProperty("pointer-events");
    wrap.innerHTML = "";

    const nodes = currentEpisode?.nodes ?? {};

    // ★表示順は固定（JSONの並び順そのまま）
    const list = choices;

    // ★表示順をランダム化
    //const list = shuffleInPlace([...choices]);

    for (const c of list) {
      const btn = document.createElement("button");
      btn.className = "choiceBtn";
      btn.textContent = c.label ?? "(no label)";

      // ★あとでbad判定できるようにデータを付与
      const kind = nodes?.[c?.to]?.kind ?? "";
      btn.dataset.kind = kind;

      btn.addEventListener("click", () => onChoose(c, btn));
      wrap.appendChild(btn);
    }

    wrap.classList.add("show");
    scheduleAutoRandomChoice();
  }


  function hideChoices() {
    clearAutoChoice();
    hideGhostCursor(); // ★追加
    const wrap = $("#choices");
    if (!wrap) return;

    wrap.style.removeProperty("pointer-events"); // or: wrap.style.pointerEvents = "auto";
    wrap.classList.remove("show"); // ★display切替しない
    wrap.innerHTML = "";
  }

function getBadChoiceInfo(ep = currentEpisode) { // ★追加
  const choices = ep?.choices ?? [];
  const nodes = ep?.nodes ?? {};
  const idx = choices.findIndex(c => nodes?.[c?.to]?.kind === "bad");
  if (idx < 0) return null;
  return { idx, choice: choices[idx] };
}

// ===== Auto horror choice =====
const AUTO_RANDOM_CHOICE = true;         // ←ホラーON/OFF
const AUTO_CHOICE_MIN_MS = 700;          // 反応までの最短
const AUTO_CHOICE_MAX_MS = 1800;         // 反応までの最長
let autoChoiceTimer = null;

function clearAutoChoice() {
  if (autoChoiceTimer) clearTimeout(autoChoiceTimer);
  autoChoiceTimer = null;
}

function waitVoiceEndOnly(maxWaitMs = 12000) {
  const a = currentVoice;
  if (a && !a.paused) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      const t = setTimeout(finish, maxWaitMs);
      a.addEventListener("ended", () => {
        clearTimeout(t);
        finish();
      }, { once: true });
    });
  }
  return Promise.resolve();
}



function scheduleAutoRandomChoice() {
  clearAutoChoice();
  if (!AUTO_RANDOM_CHOICE) return;
  if (!autoEnabled) return;
  if (locked) return;
  if (mode !== "choice") return;

  const wrap = document.querySelector("#choices");
  if (!wrap || !wrap.classList.contains("show")) return;

  const btns = [...wrap.querySelectorAll(".choiceBtn")].filter(b => !b.disabled);
  if (btns.length === 0) return;

  spawnGhostNearCgTop(wrap); // ←「選択肢が出た瞬間」に上寄りで出す

  const delay = Math.floor(
    AUTO_CHOICE_MIN_MS + Math.random() * (AUTO_CHOICE_MAX_MS - AUTO_CHOICE_MIN_MS)
  );

  autoChoiceTimer = setTimeout(async () => {
    // 実行時にもう一度状態チェック（遷移中に暴発しないように）
    if (!autoEnabled || locked || mode !== "choice") return;

    // ✅ ボイスが鳴っているなら「終わってから」choice を押す
    await waitVoiceEndOnly();

    // ボイス待ちの間に状況が変わっていたら中止
    if (!autoEnabled || locked || mode !== "choice") return;

    const wrap2 = document.querySelector("#choices");
    if (!wrap2 || !wrap2.classList.contains("show")) return;

    const btns2 = [...wrap2.querySelectorAll(".choiceBtn")].filter(b => !b.disabled);
    if (btns2.length === 0) return;

    let pick = btns2[Math.floor(Math.random() * btns2.length)];

    if (FORCE_BAD) {
      const badBtn = btns2.find(b => b.dataset.kind === "bad");
      if (badBtn) pick = badBtn;
    }

    // ちょい“反応”を入れてからクリック（ホラー演出）
    const post = Math.floor(120 + Math.random() * 180);
    await new Promise((r) => setTimeout(r, post));

    if (!autoEnabled || locked || mode !== "choice") return;

    await creepGhostToElement(pick);   // ★追加：ズズズ…と寄る

    pick.classList.add("autoPicked");
    setTimeout(() => pick.click(), 120);
  }, delay);
}


function showNextEp(show) {
  const wrap = $("#nextWrap");
  if (!wrap) return;
  wrap.style.display = show ? "block" : "none";
}

/* ===== Ghost cursor (fake) ===== */
let ghostEl = null;
let ghostX = window.innerWidth * 0.5;
let ghostY = window.innerHeight * 0.5;
const GHOST_BASE_MS = 1000;     // ←現状 350 相当：ここを上げると全体が遅くなる
const GHOST_MS_PER_PX = 5.0;   // ←現状 1.25 相当：ここを上げると距離に応じて遅くなる

const GHOST_SPAWN = {
  xMin: 0.18, // 左端から18%
  xMax: 0.82, // 左端から82%
  yMin: 0.05, // 上端から5%   ← 上寄りにしたいほど小さく
  yMax: 0.38, // 上端から38%  ← 上寄りにしたいほど小さく
  padding: 12,
  minDist: 160, // 選択肢に近すぎるスポーンを避ける
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand  = (a, b) => a + Math.random() * (b - a);

function spawnGhostNearCgTop(avoidEl = null) {
  if (!ghostEl) return;

  const cg = document.querySelector(".cgFrame");
  const base = cg ? cg.getBoundingClientRect() : document.body.getBoundingClientRect();

  const avoid = avoidEl ? rectCenter(avoidEl) : null;

  for (let i = 0; i < 12; i++) {
    let x = base.left + base.width  * rand(GHOST_SPAWN.xMin, GHOST_SPAWN.xMax);
    let y = base.top  + base.height * rand(GHOST_SPAWN.yMin, GHOST_SPAWN.yMax);

    x = clamp(x, GHOST_SPAWN.padding, window.innerWidth  - GHOST_SPAWN.padding);
    y = clamp(y, GHOST_SPAWN.padding, window.innerHeight - GHOST_SPAWN.padding);

    if (avoid) {
      const d = Math.hypot(x - avoid.x, y - avoid.y);
      if (d < GHOST_SPAWN.minDist) continue; // 近すぎ → 引き直し
    }

    ghostX = x; ghostY = y;
    ghostEl.style.left = `${ghostX}px`;
    ghostEl.style.top  = `${ghostY}px`;

    showGhostCursor();
    return;
  }
}


function initGhostCursor() {
  ghostEl = document.querySelector("#ghostCursor");
  if (!ghostEl) return;

  // 初期位置：tapHint付近（それっぽい）
  const tb = document.querySelector("#textBox");
  if (tb) {
    const r = tb.getBoundingClientRect();
    // テキストボックス右下寄りからスタート（それっぽい）
    ghostX = r.right - 80;
    ghostY = r.bottom - 70;
  }

  ghostEl.style.left = `${ghostX}px`;
  ghostEl.style.top  = `${ghostY}px`;

  ghostEl.classList.remove("ghostShow");
}

function showGhostCursor() {
  if (!ghostEl) return;
  ghostEl.classList.add("ghostShow");
}

function hideGhostCursor() {
  if (!ghostEl) return;
  ghostEl.classList.remove("ghostShow");
}

// ★選択肢が出た瞬間に「一定範囲からランダム位置」に出現させる
const GHOST_SPAWN_RANGE_X = 360; // 横方向のランダム範囲（±）
const GHOST_SPAWN_RANGE_Y = 260; // 縦方向のランダム範囲（±）
const GHOST_SPAWN_MIN_DIST = 160; // 選択肢中心から最低この距離は離す

function spawnGhostForChoice(anchorEl) {
  if (!ghostEl || !anchorEl) return;

  const r = anchorEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top  + r.height / 2;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = cx, y = cy;

  for (let i = 0; i < 24; i++) {
    const tx = cx + (Math.random() * 2 - 1) * GHOST_SPAWN_RANGE_X;
    const ty = cy + (Math.random() * 2 - 1) * GHOST_SPAWN_RANGE_Y;

    // 画面内にクランプ（端すぎ防止）
    const px = Math.min(vw - 20, Math.max(20, tx));
    const py = Math.min(vh - 20, Math.max(20, ty));

    if (Math.hypot(px - cx, py - cy) >= GHOST_SPAWN_MIN_DIST) {
      x = px; y = py;
      break;
    }
  }

  ghostX = x; ghostY = y;
  ghostEl.style.left = `${ghostX}px`;
  ghostEl.style.top  = `${ghostY}px`;

  showGhostCursor();
}



function rectCenter(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
}

function easeInOutCubic(t){
  return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
}

function creepGhostTo(x1, y1, opts = {}) {
  if (!ghostEl) return Promise.resolve();
  const { minMs = 650, maxMs = 1800, noJitter = false } = opts;

  const x0 = ghostX, y0 = ghostY;
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const dur = Math.max(minMs, Math.min(maxMs, GHOST_BASE_MS + dist * GHOST_MS_PER_PX));

  return new Promise((resolve) => {
    const start = performance.now();
    const baseAmp = Math.min(18, 6 + dist / 120); // 揺れ幅

    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const e = easeInOutCubic(p);

      // “ズズズ”感：近づくほど揺れが減る
      const amp = baseAmp * (1 - p);
      const t = (now - start) / 1000;

      const jx = noJitter ? 0 : (Math.sin(t * 18) * amp + (Math.random() - 0.5) * amp * 0.7);
      const jy = noJitter ? 0 : (Math.cos(t * 16) * amp + (Math.random() - 0.5) * amp * 0.7);

      const x = x0 + (x1 - x0) * e + jx;
      const y = y0 + (y1 - y0) * e + jy;

      ghostEl.style.left = `${x}px`;
      ghostEl.style.top  = `${y}px`;

      if (p < 1) requestAnimationFrame(step);
      else {
        ghostX = x1; ghostY = y1;
        resolve();
      }
    };

    requestAnimationFrame(step);
  });
}

  const GHOST_PAUSE_BEFORE_MS = 350; // ←移動前の停止
  const GHOST_PAUSE_AFTER_MS  = 250; // ←到着後の停止

  async function creepGhostToElement(el) {
    if (!el) return;
    const c = rectCenter(el);

    await new Promise(r => setTimeout(r, GHOST_PAUSE_BEFORE_MS));

    // 揺れ無しで移動
    await creepGhostTo(c.x, c.y, { noJitter: true });

    await new Promise(r => setTimeout(r, GHOST_PAUSE_AFTER_MS));
  }



/* ===== Image preload (download + decode) ===== */
const imageCache = new Map(); // url -> Promise<void>
function preloadImage(url) {
  if (!url) return Promise.resolve();
  if (imageCache.has(url)) return imageCache.get(url);

  const p = (async () => {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.src = url;

    // decode() が使えるブラウザは decode を優先（“チラつき”に効く）
    if (img.decode) {
      try {
        await img.decode();
        return;
      } catch (_) {
        // decode失敗時はload待ちにフォールバック
      }
    }

    await new Promise((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve(); // プリロード失敗は致命にしない（表示時に再挑戦される）
    });
  })();

  imageCache.set(url, p);
  return p;
}

/* ===== Audio (mp3) ===== */
let audioUnlocked = false;          // iOS対策：ユーザー操作後のみ再生
let currentVoice = null;            // ボイス用（1ch）
let lastVoiceKey = "";              // 同じキーの連打防止

function unlockAudio() {
  // 初回ユーザー操作で audioUnlocked を true にする
  audioUnlocked = true;
}

function stopVoice() {
  if (!currentVoice) return;
  try {
    currentVoice.pause();
    currentVoice.currentTime = 0;
  } catch (_) {}
  currentVoice = null;
  lastVoiceKey = "";
}

function playSe(seRef) {
  if (!audioUnlocked || !seRef) return;
  const url = resolveAssetOrNull(assets, seRef);
  if (!url) return;

  // SEは重なってOKなので毎回新しいAudioで軽く鳴らす
  const a = new Audio(url);
  a.preload = "auto";
  a.volume = 0.9;
  a.play().catch(() => {});
}

function playVoice(voiceRef) {
  if (!audioUnlocked || !voiceRef) return;

  // assets参照 → URL
  const url = resolveAssetOrNull(assets, voiceRef);
  if (!url) {
    console.warn("Voice ref not found:", voiceRef);
    return;
  }

  // 同じ音を連打しても無駄に止め→再生しない
  if (voiceRef === lastVoiceKey && currentVoice && !currentVoice.paused) return;

  // 前のボイスは止める（重なり防止）
  stopVoice();

  const a = new Audio(url);
  a.preload = "auto";
  a.volume = 1.0;
  currentVoice = a;
  lastVoiceKey = voiceRef;

  a.play().catch((e) => {
    // ユーザー操作前に鳴らそうとするとここに来る（iOS等）
    console.warn("Voice play blocked:", e);
  });
}

// “いま表示している行”から voiceRef を拾って鳴らす
function playVoiceForStep(step) {
  if (!step) return;
  if (step.voiceRef) playVoice(step.voiceRef);
  // もし行ごとにSEも鳴らしたいなら step.seRef を用意してここで playSe(step.seRef)
}

/* ===== Audio preload (mp3) ===== */
const AUDIO_PRELOAD_AHEAD = 2; // 先読みする行数（2で十分軽い）
const audioPreloadCache = new Map(); // url -> Promise<void>

function preloadAudioUrl(url) {
  if (!url) return Promise.resolve();
  if (audioPreloadCache.has(url)) return audioPreloadCache.get(url);

  // “再生せずに取得”なので自動再生制限に引っかからない（キャッシュを温める）
  const p = fetch(url, { cache: "force-cache" })
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null)
    .then(() => {});
  audioPreloadCache.set(url, p);
  return p;
}

function preloadAudioRef(ref) {
  if (!ref || !assets) return Promise.resolve();
  const url = resolveAssetOrNull(assets, ref);
  return preloadAudioUrl(url);
}

function primeUpcomingAudio(steps, fromIndex) {
  if (!Array.isArray(steps)) return;
  for (let i = fromIndex + 1; i <= fromIndex + AUDIO_PRELOAD_AHEAD; i++) {
    const ref = steps[i]?.voiceRef;
    if (ref) preloadAudioRef(ref).catch(() => {});
  }
}

function primeNodeAudio(node, fromIndex = 0) {
  const steps = node?.steps ?? [];
  for (let i = fromIndex; i <= fromIndex + AUDIO_PRELOAD_AHEAD; i++) {
    const ref = steps[i]?.voiceRef;
    if (ref) preloadAudioRef(ref).catch(() => {});
  }
}

function primeEpisodeAudio(ep) {
  // よく使うSE（assetsにあれば温める）
  preloadAudioRef("se.tap").catch(() => {});
  preloadAudioRef("se.choice").catch(() => {});
  preloadAudioRef("se.pageTurn").catch(() => {}); // ★追加

  // intro：あなたの方針どおり1行目は無音想定なので、2行目から先読み
  const steps = ep?.steps ?? [];
  for (let i = 1; i <= AUDIO_PRELOAD_AHEAD; i++) {
    const ref = steps[i]?.voiceRef;
    if (ref) preloadAudioRef(ref).catch(() => {});
  }

  // 結果ノード：各ノードの先頭ボイスだけ先読み（軽い）
  const nodes = ep?.nodes ?? {};
  for (const k of Object.keys(nodes)) {
    const ref = nodes[k]?.steps?.[0]?.voiceRef;
    if (ref) preloadAudioRef(ref).catch(() => {});
  }
}

function primeChoiceRoutes(ep) {
  const choices = ep?.choices ?? [];
  const nodes = ep?.nodes ?? {};

  for (const c of choices) {
    const nodeKey = c?.to;
    const node = nodes[nodeKey];
    if (!node) continue;

    // 結果CGを先読み
    const cgUrl = resolveAssetOrNull(assets, node.cgRef);
    if (cgUrl) preloadImage(cgUrl).catch(() => {});

    // 結果ボイス（先頭〜数行）を先読み
    primeNodeAudio(node, 0);
  }
}

function collectEpisodeUrls(ep) {
  const urls = new Set();

  urls.add(resolveAssetOrNull(assets, ep.backgroundRef));
  urls.add(resolveAssetOrNull(assets, ep.mainCgRef));

  // nodes の結果CGも先読み対象
  if (ep.nodes) {
    for (const key of Object.keys(ep.nodes)) {
      const node = ep.nodes[key];
      urls.add(resolveAssetOrNull(assets, node.cgRef));
    }
  }

  // null除去して配列化
  return [...urls].filter(Boolean);
}

function primeEpisodeAssets(ep) {
  const urls = collectEpisodeUrls(ep);
  // 待たずに投げる（裏で温める）
  for (const u of urls) preloadImage(u).catch(() => {});
}


/* ===== Transition (暗転) ：“暗転中にロードを待って→暗転中に差し替え→開ける” ===== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function playTransitionFx(transitionRef, opts = {}) {
  const {
    waitPromise = null,
    apply = null,
    afterSwapMs = 80,
  } = opts;

  const cutinMs = getTransitionDurationMs(transitionRef, 260);

  const fx = $("#transitionFx");

  // 即表示（フェード無し）
  fx.style.transition = "none";
  fx.style.background = "#000";
  fx.style.opacity = "1";

  await sleep(cutinMs);

  // 暗転中にロード完了を待つ → 暗転中に差し替える
  if (waitPromise) {
    try { await waitPromise; } catch (_) {}
  }
  if (apply) apply();

  await sleep(afterSwapMs);

  // 即消し
  fx.style.opacity = "0";
  fx.style.background = "transparent";
}

// ===== Transitions =====
let transitions = null;

// 「ここを編集」：通常 / bad(エクストリーム) で使うトランジション候補
const TRANSITION_POOL = {
  normal: ["tr.paper001"],
  bad: ["tr.ink001", "tr.stamp001"],
};

function pickTransitionRef(kind) {
  const list = (kind === "bad") ? TRANSITION_POOL.bad : TRANSITION_POOL.normal;
  if (!list || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function getTransitionDurationMs(ref, fallback = 260) {
  return transitions?.[ref]?.durationMs ?? fallback;
}

function pickRandom(x) {
  if (!x) return null;
  return Array.isArray(x) ? x[Math.floor(Math.random() * x.length)] : x;
}

function getDefaultTransitionRef(kind) {
  if (!transitions?.defaults) return null;
  return kind === "bad" ? transitions.defaults.choice_bad : transitions.defaults.choice_normal;
}

function primeTransitionFxAssets() {
  if (!transitions || !assets) return;
  const refs = new Set();

  for (const [k, t] of Object.entries(transitions)) {
    if (k === "defaults") continue;
    if (!t?.frames) continue;
    for (const f of t.frames) {
      if (f?.assetRef) refs.add(f.assetRef);
    }
  }

  for (const ref of refs) {
    const url = resolveAssetOrNull(assets, ref);
    if (url) preloadImage(url).catch(() => {});
  }
}

async function runTransitionFx(refOrList, opts = {}) {
  // refOrList は "tr.xxx" でも ["tr.a","tr.b"] でもOK（ランダム）
  const pickedRef = pickRandom(refOrList);
  const t = pickedRef ? transitions?.[pickedRef] : null;

  // transitions が無い/見つからない時は従来にフォールバック
  if (!t) {
    return playTransitionFx(pickedRef, opts);
  }

  // さらに中で anyOf を持たせたい場合も対応（任意）
  if (t.anyOf) {
    return runTransitionFx(t.anyOf, opts);
  }

  // 方式A：frames があればそれを再生
  if (Array.isArray(t.frames)) {
    return playTransitionFrames(t, opts);
  }

  // 旧形式（durationMsだけ等）が来たら cutin に寄せてフォールバック
  return playTransitionFx(pickedRef, opts);
}

async function playTransitionFrames(t, opts = {}) {
  const {
    waitPromise = null,
    apply = null
  } = opts;

  const fx = $("#transitionFx");
  if (!fx) return;

    // ★追加：transitions.json に tilt があれば、ここで傾ける（維持）
    // 例: "tilt": { "deg": -6, "ms": 180 }
    if (t?.tilt != null) {
      const deg = (typeof t.tilt === "number") ? t.tilt : t.tilt.deg;
      const ms  = (typeof t.tilt === "object" && t.tilt.ms != null) ? t.tilt.ms : 160;
      setStageTilt(deg, ms);
    }

  // 表示初期化
  fx.style.transition = "none";
  fx.style.opacity = "1";
  fx.style.backgroundColor = "transparent";
  fx.style.backgroundImage = "none";

  // 事前に画像フレームを温める（ここは軽めに）
  const preload = [];
  for (const f of t.frames) {
    if (!f?.assetRef) continue;
    const url = resolveAssetOrNull(assets, f.assetRef);
    if (url) preload.push(preloadImage(url));
  }
  if (t.swapCgRef) {
    const su = resolveAssetOrNull(assets, t.swapCgRef);
    if (su) preload.push(preloadImage(su));
  }
  if (t.seStartRef) playSe(t.seStartRef);

  await Promise.allSettled(preload);

  let swapped = false;
  const swapAt = (t.swapAtFrame ?? t.swapAt ?? -1);

  for (let i = 0; i < t.frames.length; i++) {
    const f = t.frames[i];

    if (f?.seRef) playSe(f.seRef);

    if (f?.color != null) fx.style.backgroundColor = f.color;

    if (f?.assetRef) {
      const url = resolveAssetOrNull(assets, f.assetRef);
      fx.style.backgroundImage = url ? `url("${url}")` : "none";
      }
      else 
      {
      // assetRef が無いフレームは画像を消す（color だけを確実に見せる）
       fx.style.backgroundImage = "none";
      }

    if (!swapped && i === swapAt) {
      if (waitPromise) { try { await waitPromise; } catch (_) {} }
      if (apply) apply();
      swapped = true;
    }

    await sleep(f?.ms ?? 0);
  }

  // swapAtFrame 指定し忘れでも必ず差し替える
  if (!swapped) {
    if (waitPromise) { try { await waitPromise; } catch (_) {} }
    if (apply) apply();
  }

  // 消す（必要ならフェードアウト）
  const fadeOutMs = t.fadeOutMs ?? 0;
  if (fadeOutMs > 0) {
    fx.style.transition = `opacity ${fadeOutMs}ms ease`;
    fx.style.opacity = "0";
    await sleep(fadeOutMs);
  } else {
    fx.style.opacity = "0";
  }

  fx.style.backgroundColor = "transparent";
  fx.style.backgroundImage = "none";
}


/* ===== State ===== */
let assets = null;
let order = [];
let currentIndex = 0;

let currentEpisode = null; // ep json
let mode = "reading";      // reading | choice | result | end
let stepIndex = 0;
let resultNode = null;     // nodes[...]
let locked = false;

// JSONキャッシュ（同じepを何度もfetchしない）
const episodeCache = new Map(); // epId -> episodeJson
async function getEpisode(epId) {
  if (episodeCache.has(epId)) return episodeCache.get(epId);
  const ep = await fetchJson(`./data/episodes/${epId}.json`);
  episodeCache.set(epId, ep);
  return ep;
}


function setPfLayer(layerEl, bgUrl, cgUrl, offsetY) {
  layerEl.querySelector(".pfBg").style.backgroundImage = `url("${bgUrl}")`;
  layerEl.querySelector(".pfCg").src = cgUrl;
  layerEl.style.setProperty("--pf-offset-y", offsetY ?? "-34%");
}

  function waitTransitionEnd(el, propNames = ["--wipeX", "clip-path"]) {
    return new Promise((resolve) => {
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener("transitionend", onEnd);
        clearTimeout(t);
        resolve();
      };

      const onEnd = (e) => {
        // どのプロパティ名で来るかは環境差がある（--wipeX だったり clip-path だったり）
        if (e.propertyName && !propNames.includes(e.propertyName)) return;
        finish();
      };

      el.addEventListener("transitionend", onEnd, { passive: true });

      // 保険：transitionend が来ない環境向け（※ここでも必ず掃除する）
      const t = setTimeout(finish, 950);
    });
  }
  
async function playWipeLR({
  // 互換のため引数は残す（bg/offsetは無視してCGだけワイプ）
  prevBgUrl, prevCgUrl, prevOffsetY,
  nextBgUrl, nextCgUrl, nextOffsetY,
  dir = "ltr",
}) {
  const fx = $("#cgFx");
  if (!fx) return;

  const prevImg = fx.querySelector(".cgFxPrev");
  const nextImg = fx.querySelector(".cgFxNext");

  // 方向クラス
  fx.classList.toggle("dir-rtl", dir === "rtl");
  fx.classList.toggle("dir-ltr", dir === "ltr");

  // 画像セット（CGのみ）
  nextImg.src = nextCgUrl || "";
  prevImg.src = prevCgUrl || "";

  // 表示
  fx.classList.remove("hidden");

  // 初期位置を確実に作る（iOS/Safari対策：2フレーム）
  prevImg.style.transition = "none";
  prevImg.style.setProperty("--wipeX", dir === "rtl" ? "100%" : "0%");
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));

  // アニメ開始
  prevImg.style.transition = ""; // CSS側のtransition(--wipeX)を使う
  prevImg.style.setProperty("--wipeX", dir === "rtl" ? "0%" : "100%");

  await waitTransitionEnd(prevImg);

  // 掃除
  fx.classList.add("hidden");
  prevImg.style.removeProperty("--wipeX");
}



    async function playPageTurnLR({ prevBgUrl, prevCgUrl, prevOffsetY, nextBgUrl, nextCgUrl, nextOffsetY, curlUrl, dir = "rtl" }) {
      

      
      const fx = $("#pageFx");
      const prev = fx.querySelector(".pfPrev");
      const next = fx.querySelector(".pfNext");
      const curl = $("#pfCurl");

      // 方向クラス
      fx.classList.toggle("dir-rtl", dir === "rtl");
      fx.classList.toggle("dir-ltr", dir === "ltr");

      // 内容セット（下=次 / 上=前）
      setPfLayer(next, nextBgUrl, nextCgUrl, nextOffsetY);
      setPfLayer(prev, prevBgUrl, prevCgUrl, prevOffsetY);

      const prevImg = prev.querySelector(".pfCg");
      const nextImg = next.querySelector(".pfCg");

      // 先に表示（display:none 解除）
      fx.classList.remove("hidden");
      fx.classList.remove("turning");

       //curl.style.opacity = "0";



      // 画像を先に温める（※これは curl要素本体のload完了保証ではない）
      await Promise.allSettled([
        preloadImage(prevBgUrl),
        preloadImage(prevCgUrl),
        preloadImage(nextBgUrl),
        preloadImage(nextCgUrl),
        preloadImage(curlUrl),

        waitImgReady(prevImg),
        waitImgReady(nextImg),

        preloadImage(curlUrl),

      ]);

      // ここで改めて curl をセットして、#pfCurl 本体の load/decode を待つ
      curl.src = curlUrl;
      try {
        // decodeが使えるなら decode 優先（naturalWidthが安定しやすい）
        if (curl.decode) {
          await curl.decode();
        } else if (!curl.complete) {
          await new Promise((r) => curl.addEventListener("load", r, { once: true }));
        }
      } catch (_) {
        // decode失敗は無視（ただし complete なら続行）
      }

      const curlW = (curl.naturalWidth && curl.naturalHeight)
        ? (curl.naturalWidth / curl.naturalHeight) * fx.clientHeight
        : 300;


      // 位置：rtl は右→左、ltr は左→右
      const TUNE = {
        rtl: { startIn: 0.75, endIn: 0.75, out: 0.70, biasPx: 0 },
        ltr: { startIn: 0.5, endIn: 0.70, out: 0.70, biasPx: 180 }, // ←ここを右用に調整
      };
      const t = TUNE[dir];

      const startX = (dir === "rtl")
        ? (fx.clientWidth - curlW * t.startIn)
        : (-curlW * t.out);

      const endX = (dir === "rtl")
        ? (-curlW * t.out)
        : (fx.clientWidth - curlW * t.endIn);

      const curlTx = (x) => (dir === "ltr")
        ? `translateX(${x + t.biasPx}px) scaleX(-1)`
        : `translateX(${x + t.biasPx}px)`;

      // ★開始前リセット（ここが“2回目で途中から”防止）
      prev.style.transition = "none";
      curl.style.transition = "none";

      // （中略）
      prev.style.setProperty("--wipeX", (dir === "rtl") ? "100%" : "0%");
      curl.style.transform = curlTx(startX);

      await new Promise((r) => requestAnimationFrame(r));

      prev.style.transition = "";
      curl.style.transition = "";

      // ★ここ追加：transition有効化の1フレーム
      await new Promise((r) => requestAnimationFrame(r));

      // アニメ開始
      fx.classList.add("turning");
      curl.style.opacity = "1";
      curl.style.transform = curlTx(endX);

      // ★ここ追加：--wipeX の終点をJSで更新して clip を動かす
      prev.style.setProperty("--wipeX", (dir === "rtl") ? "0%" : "100%");

      await waitTransitionEnd(prev);

      fx.classList.add("hidden");
      fx.classList.remove("turning");
      
    }

    async function waitImgReady(imgEl) {
    if (!imgEl) return;
    try {
      if (imgEl.decode) {
        await imgEl.decode();
        return;
      }
    } catch (_) {
      // decode失敗時はload待ちへ
    }
    if (!imgEl.complete) {
      await new Promise((r) => imgEl.addEventListener("load", r, { once: true }));
    }
  }


/* ===== Episode loading ===== */
async function loadEpisodeByIndex(idx) {
  if (locked) return;
  locked = true;

  try {
    stopVoice(); // ←追加（重要）
    setStageTilt(0, 0);
    currentIndex = (idx + order.length) % order.length;
    const epId = order[currentIndex];

    const ep = await getEpisode(epId);
    currentEpisode = ep;

    // ✅ ep が定義された“後”でチェックする
    const errs = validateEpisode(ep);
    if (errs.length) {
      console.warn("Episode validation errors:", errs);
      setDebug(`EP: ${ep.id}\n` + errs.map((x) => "• " + x).join("\n"));
    } else {
      setDebug("");
    }

    // （以下、既存の処理はそのまま）
    primeEpisodeAssets(ep);
    primeEpisodeAudio(ep); // ←ここに入れるのが正解

    const nextId = order[(currentIndex + 1) % order.length];
    getEpisode(nextId)
      .then((nextEp) => {
        primeEpisodeAssets(nextEp);
        primeEpisodeAudio(nextEp); // ← 追加
      })
      .catch(() => {});

    const bgUrl = resolveAsset(assets, ep.backgroundRef);
    const mainUrl = resolveAsset(assets, ep.mainCgRef);
    await Promise.allSettled([preloadImage(bgUrl), preloadImage(mainUrl)]);
    setBg(bgUrl);
    applyUiByKind("normal");
    setCgOffsetY(ep.cgFrame?.offsetY);
    setCg(mainUrl);


    mode = "reading";
    stepIndex = 0;
    resultNode = null;
    hideChoices();
    showNextEp(false);

    const first = ep.steps?.[0]?.t ?? "";
    setStoryText(ep.steps?.[0]?.t ?? "");

  } catch (e) {
    console.error(e);
    alert(e.message);
  } finally {
    locked = false;
  }
}

/* ===== Navigation ===== */

async function flashCoverDo(action){
  const el = document.querySelector("#flashFx");
  if (!el) return await action();

  // 即ON（画面を覆う）
  el.classList.add("on");

  // 1フレームだけ待って、覆いが描画されてから切り替える（スマホ対策）
  await new Promise(r => requestAnimationFrame(r));

  // 覆われている間に切り替え
  const result = await action();

  // 即OFF（フェードなし）
  el.classList.remove("on");
  return result;
}

async function gotoEpisodeWithPageTurn(nextIndex, dir = "rtl") {
  if (locked) return;
  locked = true;

  try {
    stopVoice();
    setStageTilt(0, 0);

    // いま表示中（前シーン）
    const prevBgUrl = currentBgUrl;
    const prevCgUrl = currentCgUrl;
    const prevOffsetY = currentCgOffsetY;

    // 次エピ取得（この部分は loadEpisodeByIndex と同じ流れ）
    const idx = (nextIndex + order.length) % order.length;
    const epId = order[idx];
    const ep = await getEpisode(epId);

    const errs = validateEpisode(ep);
    if (errs.length) {
      console.warn("Episode validation errors:", errs);
      setDebug(`EP: ${ep.id}\n` + errs.join("\n"));
    } else {
      setDebug(`EP: ${ep.id}`);
    }

    primeEpisodeAssets(ep);
    primeEpisodeAudio(ep);

    const nextOffsetY = ep.cgFrame?.offsetY ?? "-34%";

    const bgUrl = resolveAsset(assets, ep.backgroundRef);
    const cgUrl = resolveAsset(assets, ep.mainCgRef);

    // 先読み（ちらつき防止）
    await Promise.allSettled([
      preloadImage(bgUrl),
      preloadImage(cgUrl),
    ]);

    // ▼ページめくれを“上に被せた状態”で開始
    // 先にFXを出してから、下（実画面）を次エピに切り替えるとチラつきに強い
    const fxPromise = playWipeLR({
      prevBgUrl: prevBgUrl || bgUrl,
      prevCgUrl: prevCgUrl || cgUrl,
      prevOffsetY,
      nextBgUrl: bgUrl,
      nextCgUrl: cgUrl,
      nextOffsetY,
      dir, // ★固定しない。引数のdirを使う
    });


    // ▼下の実画面を次エピに切り替え（FXが被ってるので見えない）
    currentIndex = idx;
    currentEpisode = ep;
    mode = "reading";
    stepIndex = 0;
    resultNode = null;

    hideChoices();
    showNextEp(false);

    setBg(bgUrl);
    applyUiByKind("normal");  // ★これを追加：枠/ボタンを通常へ戻す
    setCgOffsetY(ep.cgFrame?.offsetY);
    setCg(cgUrl);


    setStoryText(ep.steps?.[0]?.t ?? "");

    await fxPromise;

  } finally {
    locked = false;
  }
}


    function wireNavButtons() {
      stopAuto();

      const prev = $("#btnPrev");
      const next = $("#btnNext");



      const nav = (idx, dir) => {
        unlockAudio();          // iOS対策：これが無いとplaySeが即returnする
        playSe("se.pageTurn");  // ページめくりSE
        gotoEpisodeWithPageTurn(idx, dir);
      };

      if (prev) prev.addEventListener("click", () => nav(currentIndex - 1, "ltr"));
      if (next) next.addEventListener("click", () => nav(currentIndex + 1, "rtl"));




      window.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") nav(currentIndex - 1, "ltr");
        if (e.key === "ArrowRight") nav(currentIndex + 1, "rtl");
      });
    }

    /* ===== Auto play ===== */
    let autoEnabled = false;
    let autoTimer = null;
    let suppressTapSeOnce = false;

    // AUTOをONにしたら最初の1行も読めるように少し待ってから進める
    const AUTO_FIRST_DELAY_MS = 5000;

    // ボイスがない（or ブロックされて鳴らない）ときの固定ウェイト
    const AUTO_FALLBACK_DELAY_MS = 5000;

    // 長ボイス対策：最大でもこれ以上は待たない
    const AUTO_MAX_WAIT_MS = 12000;

    function setAuto(on) {
      autoEnabled = !!on;
      document.documentElement.classList.toggle("autoOn", autoEnabled);

      hideGhostCursor();

      const btn = $("#btnAuto");
      if (btn) btn.classList.toggle("on", autoEnabled);

      if (!autoEnabled) {
        if (autoTimer) clearTimeout(autoTimer);
        autoTimer = null;
        clearAutoChoice(); 
        clearAutoNext();   // ★追加：NEXT用も止める
        return;
      }

      // iOS対策：AUTOボタン押下もユーザー操作扱いにする
      unlockAudio();
      scheduleAuto(AUTO_FIRST_DELAY_MS);
    }

    function toggleAuto() { setAuto(!autoEnabled); }
    function stopAuto() { setAuto(false); }

    function scheduleAuto(ms) {
      if (autoTimer) clearTimeout(autoTimer);
      if (!autoEnabled) return;
      autoTimer = setTimeout(autoStep, ms);
    }

    function waitAutoDelay() {
      const a = currentVoice;

      // ボイスが鳴っているなら「終了」優先、保険でタイムアウト
      if (a && !a.paused) {
        return new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };

          const t = setTimeout(finish, AUTO_MAX_WAIT_MS);
          a.addEventListener("ended", () => {
            clearTimeout(t);
            finish();
          }, { once: true });
        });
      }

      // ボイスがない/鳴らないなら固定ウェイト
      return sleep(AUTO_FALLBACK_DELAY_MS);
    }

  /* ===== Auto NEXT episode (continuous autoplay) ===== */
  const AUTO_NEXT_EP_MIN_MS = 900;
  const AUTO_NEXT_EP_MAX_MS = 2200;
  let autoNextTimer = null;

  function clearAutoNext() {
    if (autoNextTimer) clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }

  function scheduleAutoNextEpisode() {
    clearAutoNext();
    if (!autoEnabled) return;
    if (locked) return;
    if (mode !== "end") return;

    const delay = Math.floor(
      AUTO_NEXT_EP_MIN_MS + Math.random() * (AUTO_NEXT_EP_MAX_MS - AUTO_NEXT_EP_MIN_MS)
    );

    autoNextTimer = setTimeout(async () => {
      autoNextTimer = null;

      if (!autoEnabled || locked || mode !== "end") return;

      // ✅ 終了音声が鳴っているなら「終わってから」NEXTへ
      await waitVoiceEndOnly(AUTO_MAX_WAIT_MS);
      if (!autoEnabled || locked || mode !== "end") return;

      showNextEp(false);
      await loadEpisodeByIndex(currentIndex + 1);

      // 次話に入ったらAUTOを継続
      if (autoEnabled) scheduleAuto(AUTO_FIRST_DELAY_MS);
    }, delay);
  }

    async function autoStep() {
      if (!autoEnabled) return;

      // 遷移中/ロード中は少し待つ
      if (locked || !currentEpisode) return scheduleAuto(200);

      // endだけ止める。choiceは「ランダム選択が走るのを待つ」
      if (mode === "end") { scheduleAutoNextEpisode(); return; }
      if (mode === "choice") return scheduleAuto(200);

      const steps = getActiveSteps();
      if (!steps.length) return stopAuto();

      const beforeStep = stepIndex;
      const beforeMode = mode;

      // 自動送りではtap SEを鳴らさない
      suppressTapSeOnce = true;
      onTap();

      // 進めなかった（最終行など）→無限ループ防止で停止
      if (stepIndex === beforeStep && mode === beforeMode) return stopAuto();

      // choice/end に入ったら止める
      if (mode === "end") { scheduleAutoNextEpisode(); return; }
      if (mode === "choice") return scheduleAuto(200);

      await waitAutoDelay();
      scheduleAuto(50);
    }


/* ===== Tap progress ===== */
function getActiveSteps() {
  if (mode === "reading") return currentEpisode?.steps ?? [];
  if (mode === "result") return resultNode?.steps ?? [];
  return [];
}

function onTap() {
  if (locked || !currentEpisode) return;
  if (mode === "choice") return;
  if (mode === "end") return;

  if (!suppressTapSeOnce) playSe("se.tap");
  suppressTapSeOnce = false;

  const steps = getActiveSteps();
  if (!steps.length) return;

  // 次の行へ
  const next = stepIndex + 1;

  // すでに最終行なら、これ以上進めない（同時表示にしたので追加タップ不要）
  if (next >= steps.length) return;
  stepIndex = next;

  // 行表示の直前に追加
  stopVoice();
  setStoryText(steps[stepIndex]?.t ?? "");
  playVoiceForStep(steps[stepIndex]);
  primeUpcomingAudio(steps, stepIndex); // ← 追加

  // ★ここがポイント：この行が最終行なら、その場で同時に出す
  const isLast = stepIndex === steps.length - 1;
  if (!isLast) return;

  if (mode === "reading") {
    mode = "choice";
    showChoices(currentEpisode.choices ?? []);
    primeChoiceRoutes(currentEpisode); // ←追加
    return;
  }

  if (mode === "result") {
    if (resultNode?.end === true) {
      mode = "end";
      showNextEp(true);
        if (autoEnabled) scheduleAutoNextEpisode(); // ★追加：AUTOならNEXTも進める
    } else {
      mode = "choice";
      showChoices(currentEpisode.choices ?? []);
      primeChoiceRoutes(currentEpisode); // ←追加
    }
  }
}

const CHOICE_MARK_WAIT_MS = 1000; // 0.18秒（好みで120〜220くらい）

async function onChoose(choice, pickedBtn) {
  stopVoice();
  hideGhostCursor();
  clearAutoChoice();
  playSe("se.choice");
  if (locked || !currentEpisode) return;
  locked = true;

  const wrap = $("#choices");

  if (FORCE_BAD) { // ★追加：手動クリックでも常にbadへ
    const info = getBadChoiceInfo();
    if (info) {
      choice = info.choice;
      if (wrap) {
        const btns = [...wrap.querySelectorAll(".choiceBtn")];
        if (btns[info.idx]) pickedBtn = btns[info.idx];
      }
    }
  }

  try {
    // ① 押した瞬間：赤×表示
    if (pickedBtn) pickedBtn.classList.add("picked");

    // 誤連打防止：選択肢全体を一旦クリック不可に
    if (wrap) wrap.style.pointerEvents = "none";

    // ② コンマ数秒待機（赤×を見せる時間）
    await sleep(CHOICE_MARK_WAIT_MS);

    // ③ ここで消して → カットイン開始
    hideChoices();
    showNextEp(false);

    const nodeKey = choice.to;
    const node = currentEpisode.nodes?.[nodeKey];
    if (!node) throw new Error(`Node not found: ${nodeKey}`);

    primeNodeAudio(node, 0); // あなたの現状のままでOK

    const cgUrl = resolveAsset(assets, node.cgRef);

    const trRef =
    choice.transitionRef
    ?? getDefaultTransitionRef(node.kind); // bad なら choice_bad, それ以外は choice_normal

    await runTransitionFx(trRef, {
      waitPromise: preloadImage(cgUrl),
      apply: () => {
        applyUiByKind(node.kind); // ★UI差し替えもここへ
        setCg(cgUrl);             // ★結果CGも同タイミング
      }
      });


    // 結果ストーリー開始
    resultNode = node;
    mode = "result";
    stepIndex = 0;
    setStoryText(node.steps?.[0]?.t ?? "");
    playVoiceForStep(node.steps?.[0]);

  } catch (e) {
    console.error(e);
    alert(e.message);

    // エラー時に操作不能のままにならないよう戻す
    if (wrap) wrap.style.pointerEvents = "auto";
  } finally {
    locked = false;
  }
}

  // ===== Stage transform (scale + tilt) =====
  let stageEl = null;
  let fitScale = 1;       // recordモードのscale
  let stageTiltDeg = 0;   // 維持される傾き

  function ensureStageEl() {
    if (!stageEl) stageEl = document.querySelector("#stage") ?? document.querySelector(".stage");
    return stageEl;
  }

  function applyStageTransform({ animateMs = 0 } = {}) {
    const stage = ensureStageEl();
    if (!stage) return;

    // transform を合成（scaleはrecord時のみ効かせる）
    const s = (stage.classList.contains("record") ? fitScale : 1);
    stage.style.transformOrigin = stage.classList.contains("record") ? "top left" : "center";
    stage.style.transition = animateMs > 0 ? `transform ${animateMs}ms ease` : "none";
    stage.style.transform = `scale(${s}) rotate(${stageTiltDeg}deg)`;
  }

  function setStageTilt(deg = 0, animateMs = 140) {
    stageTiltDeg = Number(deg) || 0;
    applyStageTransform({ animateMs });
  }


  function applyRecordFit() {
    const stage = document.querySelector(".stage");
    if (!stage) return;

    if (stage.classList.contains("record")) {

      document.body.classList.add("recordMode");

      stage.classList.add("fit");

      fitScale = 1;  // ← scaleしない
      applyStageTransform({ animateMs: 0 });

    } else {
      document.body.classList.remove("recordMode");
    }
  }

window.addEventListener("resize", applyRecordFit);
applyRecordFit();

/* ===== Init ===== */
async function main() {

  assets = await fetchJson("./data/assets.json");
  transitions = await fetchJson("./data/transitions.json"); // ←追加
  primeTransitionFxAssets();
  
  const markUrl = assets["ui.markX"];
  if (markUrl) {
    document.documentElement.style.setProperty("--mark-x-url", `url("${markUrl}")`);
    preloadImage(markUrl).catch(() => {}); // 初回表示のチラつき防止
  }

  applyUiByKind("normal"); // 初期は通常

    // ★追加：UI PNG（テキスト枠＆選択肢ボタン）
  const tbUrl = assets["ui.textBoxFrame"];
  if (tbUrl) {
    document.documentElement.style.setProperty("--ui-textbox-frame", `url("${tbUrl}")`);
    preloadImage(tbUrl).catch(() => {});
  }

  const cbUrl = assets["ui.choiceBtn"];
  if (cbUrl) {
    document.documentElement.style.setProperty("--ui-choice-btn", `url("${cbUrl}")`);
    preloadImage(cbUrl).catch(() => {});
  }

  const index = await fetchJson("./data/episodes/index.json");
  order = index.order ?? [];
  if (order.length === 0) throw new Error("data/episodes/index.json の order が空です");

  wireNavButtons();

  const btnNextEp = $("#btnNextEp");
  if (btnNextEp) {
    btnNextEp.addEventListener("click", async () => {
      clearAutoNext();
      stopVoice();
      showNextEp(false);

      await flashCoverDo(() => gotoEpisodeWithPageTurn(currentIndex + 1, "rtl"));
      playSe("se.pageTurn");  // ページめくりSE
      if (autoEnabled) scheduleAuto(AUTO_FIRST_DELAY_MS);
    });
  }

  const btnAuto = $("#btnAuto");
  if (btnAuto) {
    btnAuto.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleAuto();
    });
  }

  // Stage click → tap progress（ボタン類の上は無視）
  const stage = $("#stage") ?? document.querySelector(".stage");
  if (!stage) throw new Error(`.stage が見つかりません`);

  stage.addEventListener("click", (e) => {
    unlockAudio();
    if (e.target.closest("#btnPrev, #btnNext, #btnAuto, .autoBtn, .choiceBtn, #btnNextEp, .nextBtn")) return;
    if (autoEnabled) stopAuto();
    onTap();
  });

  initGhostCursor();
  await loadEpisodeByIndex(0);
}

main().catch((e) => {
  console.error(e);
  alert(e.message);
});

function dumpPageFx(tag) {
  const fx = document.querySelector("#pageFx");
  const prev = fx?.querySelector(".pfPrev");
  const next = fx?.querySelector(".pfNext");
  const curl = document.querySelector("#pfCurl");

  const csPrev = prev ? getComputedStyle(prev) : null;
  const wipeX = prev ? csPrev.getPropertyValue("--wipeX") : "(no prev)";
  const trans = prev ? csPrev.transition : "(no prev)";

  const prevImg = prev?.querySelector(".pfCg");
  const nextImg = next?.querySelector(".pfCg");

  console.log(`[pageFx] ${tag}`, {
    fxClass: fx?.className,
    wipeX,
    trans,
    prevImg: prevImg ? { src: prevImg.currentSrc || prevImg.src, complete: prevImg.complete, nw: prevImg.naturalWidth } : null,
    nextImg: nextImg ? { src: nextImg.currentSrc || nextImg.src, complete: nextImg.complete, nw: nextImg.naturalWidth } : null,
    curl: curl ? { src: curl.currentSrc || curl.src, complete: curl.complete, nw: curl.naturalWidth, op: getComputedStyle(curl).opacity } : null,
  });
}

