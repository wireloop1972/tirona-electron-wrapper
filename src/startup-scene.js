import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

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

async function finishLaunch() {
  if (state === 'leaving') return;
  frozenTurn = lastTurnProgress;
  state = 'leaving'; audio.pause(); document.body.classList.add('leaving');
  await new Promise(resolve => setTimeout(resolve, reduced ? 100 : 850));
  await api.launchGame();
}
function requestFinish() {
  if (state === 'leaving') return;
  finishRequested = true; el('skip').disabled = true;
  setStatus('Loading…', '');
  if (!ready) settle();
}
function fail(reason) {
  if (state === 'leaving') return;
  state = 'failed'; finishRequested = false; audio.pause();
  diagnostics.push(reason); el('skip').disabled = false;
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
    setStatus('Loading voice…', '');
    try { await api.beginTtsCheck(); } catch (e) { fail(String(e)); }
  } else requestFinish();
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
api.onLog(p => diagnostics.push(p.line));
api.onProgress(p => {
  if (state !== 'loading') return;
  const messages = {gpu:['Loading voice…',''],spawn:['Loading voice…',''],load:['Loading voice…',''],generate:['Loading voice…','']};
  if (messages[p.phase]) setStatus(...messages[p.phase]);
});
api.onResult(async result => {
  if (state !== 'loading') return;
  if (!result.success) { fail(result.reason); return; }
  state = 'playing'; setStatus('Voice ready', '');
  el('skip').textContent = 'Enter the game'; audio.src = result.audioDataUrl;
  try { await audio.play(); } catch { await api.cancelTtsCheck(); fail('Voice playback failed.'); }
});
audio.onended = () => { if (state === 'playing') { api.reportAudioFinished(audio.duration*1000); requestFinish(); } };
audio.onerror = () => { if(state === 'playing'){api.cancelTtsCheck();fail('Voice playback failed.');} };
api.getInfo().then(info => {
  supported = info.ttsSupported;
  document.querySelector('input[value="spoken"]').disabled = !supported;
  el('availability').textContent = supported ? '' : 'Voice unavailable on this device.';
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
  const book=new THREE.Group();book.rotation.y=-.1;bookScene.add(book);
  const W=1.42,D=2.12;
  const box=(w,h,d,color,x,y)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.8}));m.position.set(x,y,0);m.castShadow=true;book.add(m);return m;};
  const leftBase=box(W+.09,.065,D+.12,'#3c2015',-W/2,-.08);
  box(W+.09,.065,D+.12,'#3c2015',W/2,-.08);
  const leftStack=box(W-.015,.075,D-.02,'#cbb999',-W/2,-.02);
  box(W-.015,.075,D-.02,'#cbb999',W/2,-.02);
  const pages=[];
  for (const x of [-W/2,W/2]) {
    const material=new THREE.MeshStandardMaterial({color:'#fff5df',roughness:1});
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(W,D),material);mesh.rotation.x=-Math.PI/2;mesh.position.set(x,.022,0);book.add(mesh);pages.push(mesh);
  }
  const paper=new THREE.PlaneGeometry(W,D,40,8);paper.rotateX(-Math.PI/2);paper.translate(W/2,0,0);
  const reverse=paper.clone();for(let i=0;i<reverse.attributes.uv.count;i++)reverse.attributes.uv.setX(i,1-reverse.attributes.uv.getX(i));
  const moving=new THREE.Group();moving.position.y=.027;book.add(moving);
  const fronts=[new THREE.MeshStandardMaterial({color:'#fff5df',roughness:1,side:THREE.FrontSide}),new THREE.MeshStandardMaterial({color:'#fff5df',roughness:1,side:THREE.BackSide})];
  moving.add(new THREE.Mesh(paper,fronts[0]),new THREE.Mesh(reverse,fronts[1]));moving.children.forEach(m=>m.castShadow=true);
  const cover=new THREE.Group();book.add(cover);
  const coverGeo=new THREE.PlaneGeometry(W+.08,D+.1);coverGeo.rotateX(-Math.PI/2);coverGeo.translate(W/2,.085,0);
  const coverTexture=await loadTexture('/launcher/cover.png');
  const coverMesh=new THREE.Mesh(coverGeo,new THREE.MeshStandardMaterial({map:coverTexture,roughness:.8,side:THREE.DoubleSide}));coverMesh.castShadow=true;cover.add(coverMesh);
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
    cover.rotation.z=smooth(opened)*Math.PI;cover.position.y=opened===1?-.1:0;
    leftBase.visible=leftStack.visible=pages[0].visible=opened>.1;
    moving.visible=active&&opened===1&&!reduced;
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
    const maps=[textures[spread%8],textures[(spread+(moving.visible?3:1))%8],textures[(spread+1)%8],textures[(spread+2)%8]];
    [pages[0].material,pages[1].material,...fronts].forEach((m,i)=>{if(!m.map)m.needsUpdate=true;m.map=maps[i];});
    const angle=smooth(t)*Math.PI;
    for(const g of [paper,reverse]){const p=g.attributes.position;for(let i=0;i<p.count;i++){const u=paper.attributes.uv.getX(i),x=W*u,curl=Math.sin(t*Math.PI)*Math.sin(u*Math.PI)*.18;p.setXYZ(i,x*Math.cos(angle)-curl*Math.sin(angle),x*Math.sin(angle)+curl*Math.cos(angle),(.5-paper.attributes.uv.getY(i))*D);}p.needsUpdate=true;g.computeVertexNormals();}
    renderer.setViewport(0,0,innerWidth,innerHeight);renderer.clear();renderer.render(scene,bookCamera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
createStudy().catch(error=>{diagnostics.push(String(error));console.error(error);if(finishRequested)finishLaunch();});
