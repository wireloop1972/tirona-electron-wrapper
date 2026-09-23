import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { turnEase } from './startup-leaf.mjs';
import { createStartupBook } from './startup-book.mjs';

const el = id => document.getElementById(id);
const api = window.startupAPI;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let state = 'idle', finishRequested = false, opened = 0, elapsed = 0, spread = 0;
let lastTurnProgress = 0, frozenTurn = 0;
let supported = false, textures = [], renderer, ready = false, turning = false;
const diagnostics = [], audio = new Audio();
const url = p => 'tirona-local://assets' + p;
let settle = () => finishLaunch();
const setStatus = (title, detail) => { el('status').textContent = title; el('detail').textContent = detail; };

// While the voice loads, one line shows what is happening, how long it has
// taken and the engine's latest output. Model load can take a minute on a
// good GPU and longer on an old one; a status that never changes reads as a
// hang, so the seconds tick and the engine's own lines scroll through.
const VOICE_HINT = 'A good graphics card takes up to a minute. Older cards take longer.';
const PHASES = {
  gpu: 'Checking your graphics card',
  spawn: 'Starting the voice engine',
  load: 'Loading the voice model',
  generate: 'Making the first line of speech',
  play: 'Voice ready',
};
let voicePhase = 'gpu', voiceStartedAt = 0, voiceLine = '', voiceTimer = 0;
const cleanLine = line => line.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\s*\[?[\d:.T\-]+\]?\s*/, '').replace(/\s+/g, ' ').trim();
function renderProgress() {
  const seconds = Math.max(0, Math.round((performance.now() - voiceStartedAt) / 1000));
  const parts = [PHASES[voicePhase] || 'Loading', `${seconds} s`];
  if (voiceLine) parts.push(voiceLine);
  el('progress').textContent = parts.join(' · ');
}
function startProgress() {
  voicePhase = 'gpu'; voiceStartedAt = performance.now(); voiceLine = '';
  clearInterval(voiceTimer); voiceTimer = setInterval(renderProgress, 1000); renderProgress();
}
function stopProgress(text) {
  clearInterval(voiceTimer); voiceTimer = 0;
  if (text !== undefined) el('progress').textContent = text;
}

// Narrator choice, offered under the loading copy while the voice loads. A
// click chooses a voice and plays its sample; clicking the chosen voice again
// replays or stops it. Main applies the choice to every narrator line.
const sample = new Audio();
let narrator = '', sampling = '', sampleToken = 0;
function markSampling() {
  for (const row of document.querySelectorAll('.narrator')) {
    row.classList.toggle('playing', row.dataset.id === sampling);
    if (row.dataset.id !== sampling) row.style.setProperty('--heard', 0);
  }
}
function stopSample() { sampleToken++; sample.pause(); sampling = ''; markSampling(); }
function playSample(id) {
  if (sampling === id) { stopSample(); return; }
  // A sample interrupts the voice test; "Enter the game" still launches.
  if (state === 'playing') audio.pause();
  const token = ++sampleToken;
  sampling = id; sample.src = `../assets/narrators/${id}.mp3`; markSampling();
  sample.play().catch(() => { if (token === sampleToken) stopSample(); });
}
function chooseNarrator(id) {
  if (narrator !== id) { narrator = id; api.setNarrator(id); }
  playSample(id);
}
sample.ontimeupdate = () => {
  const row = document.querySelector(`.narrator[data-id="${sampling}"]`);
  if (row && sample.duration) row.style.setProperty('--heard', sample.currentTime / sample.duration);
};
sample.onended = stopSample;
sample.onerror = stopSample;
function buildNarrators(list, chosen) {
  narrator = chosen;
  el('narrator-list').replaceChildren(...list.map(n => {
    const row = document.createElement('label'); row.className = 'narrator'; row.dataset.id = n.id;
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'narrator'; input.checked = n.id === chosen;
    input.onclick = () => chooseNarrator(n.id);
    // Arrow keys may change the radio without a click.
    input.onchange = () => { if (narrator !== n.id) chooseNarrator(n.id); };
    const name = document.createElement('span'); name.className = 'name'; name.textContent = n.label;
    const listen = document.createElement('span'); listen.className = 'listen'; listen.setAttribute('aria-hidden', 'true');
    listen.append(...[0, 1, 2].map(() => document.createElement('i')));
    row.append(input, name, listen);
    return row;
  }));
}
function showNarrators(on) {
  const box = el('narrators');
  if (!on) { stopSample(); box.classList.remove('shown'); box.hidden = true; return; }
  if (el('narrator-list').children.length < 2) return;
  box.hidden = false; void box.offsetWidth; box.classList.add('shown');
}

async function finishLaunch() {
  if (state === 'leaving') return;
  frozenTurn = lastTurnProgress;
  state = 'leaving'; audio.pause(); stopSample(); document.body.classList.add('leaving');
  await new Promise(resolve => setTimeout(resolve, reduced ? 100 : 850));
  await api.launchGame();
}
function requestFinish() {
  if (state === 'leaving') return;
  finishRequested = true; el('skip').disabled = true;
  stopProgress(''); showNarrators(false);
  setStatus('Loading…', '');
  if (!ready) settle();
}
function fail(reason) {
  if (state === 'leaving') return;
  state = 'failed'; finishRequested = false; audio.pause();
  diagnostics.push(reason); el('skip').disabled = false;
  stopProgress(''); showNarrators(false);
  setStatus('Voice unavailable', 'Retry or continue without voice.');
  el('retry').hidden = false; el('diagnostics').hidden = false;
  el('skip').textContent = 'Continue without voice';
}
async function begin() {
  if (state !== 'idle' && state !== 'failed') return;
  state = 'loading'; finishRequested = false;
  el('choice').hidden = true; el('loading').hidden = false;
  el('retry').hidden = true; el('diagnostics').hidden = true;
  el('skip').textContent = 'Continue without voice'; el('skip').disabled = false;
  const voiced = supported && document.querySelector('input[value="spoken"]').checked;
  if (voiced) {
    setStatus('Loading voice…', VOICE_HINT);
    startProgress(); showNarrators(true);
    try { await api.beginTtsCheck(); } catch (e) { fail(String(e)); }
  } else { stopProgress(''); requestFinish(); }
}
el('begin').onclick = begin;
el('retry').onclick = () => { document.querySelector('input[value="spoken"]').checked = true; begin(); };
el('skip').onclick = async () => {
  if (state === 'playing') { audio.pause(); api.reportAudioFinished(audio.currentTime * 1000); requestFinish(); return; }
  state = 'finishing'; await api.cancelTtsCheck(); requestFinish();
};
el('diagnostics').onclick = () => { api.copyDiagnostics(diagnostics.join('\n')); el('diagnostics').textContent = 'Copied'; };
el('minimize').onclick = () => api.minimizeWindow();
el('close').onclick = () => api.closeWindow();
api.onLog(p => {
  diagnostics.push(p.line);
  if (state !== 'loading') return;
  const line = cleanLine(p.line);
  if (line) { voiceLine = line; renderProgress(); }
});
api.onProgress(p => {
  if (state !== 'loading') return;
  if (PHASES[p.phase]) { voicePhase = p.phase; voiceLine = ''; renderProgress(); }
});
api.onResult(async result => {
  if (state !== 'loading') return;
  if (!result.success) { fail(result.reason); return; }
  state = 'playing'; setStatus('Voice ready', '');
  stopProgress(`${PHASES.play} · ${Math.round((performance.now() - voiceStartedAt) / 1000)} s`);
  el('skip').textContent = 'Enter the game'; stopSample(); audio.src = result.audioDataUrl;
  try { await audio.play(); } catch { await api.cancelTtsCheck(); fail('Voice playback failed.'); }
});
audio.onended = () => { if (state === 'playing') { api.reportAudioFinished(audio.duration*1000); requestFinish(); } };
audio.onerror = () => { if(state === 'playing'){api.cancelTtsCheck();fail('Voice playback failed.');} };
api.getInfo().then(info => {
  supported = info.ttsSupported;
  document.querySelector('input[value="spoken"]').disabled = !supported;
  el('availability').textContent = supported ? '' : 'Voice unavailable on this device.';
  buildNarrators(info.narrators || [], info.narrator);
}).catch(() => { el('availability').textContent = 'Voice unavailable.'; });

async function createStudy() {
  renderer = new THREE.WebGLRenderer({canvas:el('study'),antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=.85;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.autoClear=false;
  const scene = new THREE.Scene(); scene.background=new THREE.Color('#100e0b');
  scene.add(new THREE.HemisphereLight('#ecd6b7','#36261b',.5));
  const key=new THREE.DirectionalLight('#ffe1ae',1.1);key.position.set(0,4,4);scene.add(key);
  const glow=new THREE.PointLight('#ffb967',60,15);glow.position.set(-1.65,.4,-2.5);scene.add(glow);
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const loadModel=async(p,position=[0,0,0],scale=.02)=>{
    const root=(await loader.loadAsync(url(p))).scene;root.scale.setScalar(scale);root.position.fromArray(position);
    root.traverse(o=>{if(o.isMesh){for(const m of [].concat(o.material)){m.color?.multiplyScalar(.4);m.roughness=Math.max(m.roughness??.8,.55);if(m.name==='Shadow walnut'||m.name==='Charcoal plaster')m.visible=false;}}});
    scene.add(root);return root;
  };
  const texLoader=new THREE.TextureLoader();
  const loadTexture=async p=>{const t=await texLoader.loadAsync(url(p));t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;};
  const roomPromise=Promise.allSettled([
    loadModel('/models/forest-clearing/room.glb'),
    loadModel('/models/study-room/shell.glb'),
    loadModel('/models/study-room/frame.glb',[-.84,-.22,-3.68],2.56),
    loadModel('/models/forest-clearing/chesterfield-desk.glb',[-2.24,-1.3448,-2.56],.97),
    loadModel('/models/forest-clearing/banker-lamp.glb',[-1.66,-.37,-2.56],.76),
    loadTexture('/launcher/map.jpg').then(t=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(3.1,2.262),new THREE.MeshStandardMaterial({map:t,color:'#bca279',roughness:.93}));m.position.set(-.84,1.06,-3.672);scene.add(m);}),
  ]);
  // The close-up is framed to the right, leaving the invitation in quiet space.
  const bookScene=new THREE.Scene();
  bookScene.add(new THREE.HemisphereLight('#fff0d3','#4b3423',2));
  const lamp=new THREE.DirectionalLight('#ffe3b9',3);lamp.position.set(-3,6,4);lamp.castShadow=true;lamp.shadow.mapSize.set(1024,1024);lamp.shadow.camera.left=-5;lamp.shadow.camera.right=5;lamp.shadow.camera.top=5;lamp.shadow.camera.bottom=-5;lamp.shadow.bias=-.0004;bookScene.add(lamp);
  const bookCamera=new THREE.PerspectiveCamera(34,1,.1,50);bookCamera.position.set(0,4.7,4.6);bookCamera.lookAt(0,0,0);
  scene.add(bookScene);
  const table=(await loader.loadAsync(url('/models/forest-clearing/table.glb'))).scene;
  const tableBounds=new THREE.Box3().setFromObject(table),tableSize=tableBounds.getSize(new THREE.Vector3());
  const tableScale=5.3/tableSize.x;table.scale.setScalar(tableScale);
  table.position.set(-(tableBounds.min.x+tableBounds.max.x)/2*tableScale,-.12-tableBounds.max.y*tableScale,-(tableBounds.min.z+tableBounds.max.z)/2*tableScale);
  table.traverse(o=>{if(o.isMesh){o.receiveShadow=true;for(const m of [].concat(o.material)){m.roughness=Math.max(m.roughness??.8,.8);}}});bookScene.add(table);
  // The same case binding as the in-game menu, a third its size. Its open
  // fold sits at the group's origin so the spread is centred where the old
  // two-plane book was.
  const W=1.42,D=2.12;
  const coverTexture=await loadTexture('/launcher/cover.png');
  const book=createStartupBook(THREE,{width:W,depth:D,coverTexture,RoundedBoxGeometry});
  book.group.rotation.y=-.1;book.group.position.set(-book.geometry.openFoldX,-.12,0);bookScene.add(book.group);
  const fronts=book.materials.slice(2);const pages=book.materials.slice(0,2);
  textures=await Promise.all(Array.from({length:8},(_,i)=>loadTexture(`/images/module-leaves/${i+1}.webp`)));
  for(const t of textures)renderer.initTexture(t);renderer.initTexture(coverTexture);
  await roomPromise;ready=true;document.body.classList.add('scene-ready');
  const resize=()=>{renderer.setSize(innerWidth,innerHeight,false);bookCamera.aspect=innerWidth/innerHeight;bookCamera.setViewOffset(innerWidth,innerHeight,-innerWidth*.18,0,innerWidth,innerHeight);bookCamera.updateProjectionMatrix();};
  resize();addEventListener('resize',resize);
  let last=performance.now();
  const smooth=t=>t*t*t*(t*(t*6-15)+10);
  function frame(now){
    if(now-last<1000/30){requestAnimationFrame(frame);return;}
    const dt=Math.min((now-last)/1000,.05);last=now;
    const active=state!=='idle';
    if(active)opened=Math.min(1,opened+dt/(reduced?.15:1.6));
    book.setOpen(smooth(opened));
    book.sheet.visible=!reduced;
    let t=0;
    if(opened===1&&active){
      if(finishRequested&&!turning){finishLaunch();}else{
        elapsed+=dt;
        t=reduced?0:THREE.MathUtils.clamp((elapsed-1.8)/2.4,0,1);
        turning=t>0&&elapsed<4.65;
        if(elapsed>=4.65){
          if(finishRequested)finishLaunch();else{elapsed=0;spread=(spread+2)%8;t=0;turning=false;}
        }
      }
    }
    if(state==='leaving')t=frozenTurn;else lastTurnProgress=t;
    const maps=[textures[spread%8],textures[(spread+(book.sheet.visible?3:1))%8],textures[(spread+1)%8],textures[(spread+2)%8]];
    [...pages,...fronts].forEach((m,i)=>{if(!m.map)m.needsUpdate=true;m.map=maps[i];});
    book.setTurn(Math.PI*turnEase(t));
    renderer.setViewport(0,0,innerWidth,innerHeight);renderer.clear();renderer.render(scene,bookCamera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
createStudy().catch(error=>{diagnostics.push(String(error));console.error(error);if(finishRequested)finishLaunch();});
