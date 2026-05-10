import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============ 全局变量 ============
let craftType = 'polish';
let patternScale = 1.0;
let scene, camera, renderer, controls, currentModel, currentTexture;
let patternCanvas, heightImageData;
const container = document.getElementById('viewer3d');

let scaleFactor = 1.0;
let thickFactor = 1.0;
let displacementStrength = 0.3;
let patternColor = '#ffffff';
let uvOffsetU = 0;
let uvOffsetV = 0;

// ============ 初始化 3D 场景（无雾、纯白背景） ============
function initScene() {
  scene = new THREE.Scene();
  // *** 背景改为纯白色，无雾 ***
  scene.background = new THREE.Color(0xffffff);

  const w = container.clientWidth;
  const h = container.clientHeight;
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 20);
  camera.position.set(2.5, 1.2, 3.8);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  controls.update();

  // 明亮且稍暖的灯光
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.width = 1024;
  key.shadow.mapSize.height = 1024;
  scene.add(key);
  scene.add(new THREE.DirectionalLight(0xfff0e0, 1.8));
  scene.add(new THREE.DirectionalLight(0xffffff, 0.8));

  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
}

// ============ 工具：高度图采样 ============
function sampleHeight(imageData, w, h, u, v, maskFn = null) {
  if (maskFn && !maskFn(u, v)) return 0;
  let px = u * (w - 1);
  let py = (1 - v) * (h - 1);
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const dx = px - x0, dy = py - y0;
  const data = imageData.data;
  const get = (x, y) => data[(y * w + x) * 4] / 255;
  return get(x0, y0) * (1 - dx) * (1 - dy) +
         get(x1, y0) * dx * (1 - dy) +
         get(x0, y1) * (1 - dx) * dy +
         get(x1, y1) * dx * dy;
}

// ============ 创建几何体（按类型、scale、thick） ============
function createEmbossedGeometry(type, imageData, imgW, imgH, strength, scale, thick) {
  const bases = {
    earringRound:    { kind:'cylinder', radius:0.45, height:0.12 },
    earringStar:     { kind:'cylinder', radius:0.45, height:0.12 },
    earringHoop:     { kind:'torus',    radius:0.5,  tube:0.08 },
    pendantRound:    { kind:'cylinder', radius:0.75, height:0.12 },
    pendantStar:     { kind:'cylinder', radius:0.75, height:0.12 },
    ring:            { kind:'torus',    radius:1.6,  tube:0.45 },
    wideRing:        { kind:'torus',    radius:1.7,  tube:0.65 },
    bracelet:        { kind:'torus',    radius:1.8,  tube:0.55 }
  };
  const base = bases[type] || bases.ring;
  let geometry;

  if (base.kind === 'cylinder') {
    const r = base.radius * scale;
    const h = base.height * thick;
    geometry = new THREE.CylinderGeometry(r, r, h, 64);
  } else {
    const R = base.radius * scale;
    const T = base.tube * thick;
    geometry = new THREE.TorusGeometry(R, T, 80, 300);
  }

  const pos = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const uvs = geometry.attributes.uv;

  // 遮罩函数
  let maskFn = null;
  if (type === 'earringRound' || type === 'pendantRound') {
    maskFn = (u, v) => {
      const cx = u - 0.5, cy = v - 0.5;
      return (cx * cx + cy * cy) < 0.22;
    };
  } else if (type === 'earringStar' || type === 'pendantStar') {
    maskFn = (u, v) => {
      const cx = u - 0.5, cy = v - 0.5;
      const r = Math.sqrt(cx * cx + cy * cy);
      if (r > 0.45) return false;
      const angle = Math.atan2(cy, cx);
      const sector = Math.floor((angle + Math.PI / 8) / (Math.PI / 4));
      const baseAngle = sector * Math.PI / 4;
      const dx = cx - Math.cos(baseAngle) * 0.32;
      const dy = cy - Math.sin(baseAngle) * 0.32;
      return (dx * dx + dy * dy) < 0.13 * 0.13;
    };
  }

  for (let i = 0; i < pos.count; i++) {
    let u = 0, v = 0;
    if (base.kind === 'cylinder') {
      if (pos.getY(i) < 0.035) continue;
      u = (pos.getX(i) / (base.radius * scale * 2)) + 0.5;
      v = (pos.getZ(i) / (base.radius * scale * 2)) + 0.5;
      u = Math.min(Math.max(u, 0), 1);
      v = Math.min(Math.max(v, 0), 1);
    } else {
      if (uvs) {
        u = uvs.getX(i);
        v = uvs.getY(i);
      }
    }
    const disp = sampleHeight(imageData, imgW, imgH, u, v, maskFn) * strength;
    const nx = normals.getX(i), ny = normals.getY(i), nz = normals.getZ(i);
    pos.setXYZ(i,
      pos.getX(i) + nx * disp,
      pos.getY(i) + ny * disp,
      pos.getZ(i) + nz * disp
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

// ============ 彩色纹理 ============
function createColoredTexture(baseCanvas, colorHex) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(baseCanvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, size, size);
  const color = new THREE.Color(colorHex);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const gray = imageData.data[i] / 255;
    imageData.data[i] = gray * color.r * 255;
    imageData.data[i+1] = gray * color.g * 255;
    imageData.data[i+2] = gray * color.b * 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

// ============ 重建3D模型 ============
function rebuild3DModel() {
  if (!heightImageData || !patternCanvas) return;
  const type = document.getElementById('shapeSelect').value;
  const geometry = createEmbossedGeometry(type, heightImageData, 512, 512, displacementStrength, scaleFactor, thickFactor);

  const coloredTexture = createColoredTexture(patternCanvas, patternColor);
  coloredTexture.wrapS = coloredTexture.wrapT = THREE.RepeatWrapping;
  coloredTexture.offset.set(uvOffsetU, uvOffsetV);
  coloredTexture.colorSpace = THREE.SRGBColorSpace;

  const bumpTexture = new THREE.CanvasTexture(patternCanvas);
  bumpTexture.wrapS = bumpTexture.wrapT = THREE.RepeatWrapping;
  bumpTexture.offset.set(uvOffsetU, uvOffsetV);

  const material = new THREE.MeshPhongMaterial({
    map: coloredTexture,
    color: 0xd4af37,
    specular: 0xffeedd,
    shininess: 80,
    bumpMap: bumpTexture,
    bumpScale: 0.03,
  });

  if (currentModel) {
    scene.remove(currentModel);
    currentModel.geometry?.dispose();
    if (Array.isArray(currentModel.material)) {
      currentModel.material.forEach(m => m.dispose());
    } else {
      currentModel.material?.dispose();
    }
  }

  currentModel = new THREE.Mesh(geometry, material);
  currentModel.castShadow = true;
  currentModel.receiveShadow = true;
  scene.add(currentModel);
  currentTexture = coloredTexture;
  updateMaterialByCraft();
}

// 仅更新纹理（颜色/偏移变化时调用）
function updateTextureAppearance() {
  if (!currentTexture || !patternCanvas) return;
  const newTex = createColoredTexture(patternCanvas, patternColor);
  newTex.wrapS = newTex.wrapT = THREE.RepeatWrapping;
  newTex.offset.set(uvOffsetU, uvOffsetV);
newTex.repeat.set(patternScale, patternScale);
  newTex.colorSpace = THREE.SRGBColorSpace;
  currentModel.material.map = newTex;
  if (currentModel.material.bumpMap) {
    currentModel.material.bumpMap.offset.set(uvOffsetU, uvOffsetV);
  }
  currentTexture = newTex;
}
function updateMaterialByCraft() {
  if (!currentModel) return;
  const m = currentModel.material;

  switch (craftType) {
    case 'polish':
      m.specular.set(0xffffff);
      m.shininess = 120;
      break;
    case 'matte':
      m.specular.set(0x555555);
      m.shininess = 10;
      break;
    case 'brushed':
      m.specular.set(0xaaaaaa);
      m.shininess = 50;
      break;
  }
  m.needsUpdate = true;
}
// ============ STL 导出 ============
function exportSTL(geometry, filename = 'jewelry.stl') {
  let stl = `solid ${filename}\n`;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const write = (i1,i2,i3) => {
    const v1 = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    const v2 = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    const v3 = new THREE.Vector3(pos.getX(i3), pos.getY(i3), pos.getZ(i3));
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(v2, v1),
      new THREE.Vector3().subVectors(v3, v1)
    ).normalize();
    stl += `  facet normal ${n.x} ${n.y} ${n.z}\n    outer loop\n`;
    stl += `      vertex ${v1.x} ${v1.y} ${v1.z}\n`;
    stl += `      vertex ${v2.x} ${v2.y} ${v2.z}\n`;
    stl += `      vertex ${v3.x} ${v3.y} ${v3.z}\n`;
    stl += `    endloop\n  endfacet\n`;
  };
  if (index) {
    for (let i = 0; i < index.count; i += 3) write(index.getX(i), index.getX(i+1), index.getX(i+2));
  } else {
    for (let i = 0; i < pos.count; i += 3) write(i, i+1, i+2);
  }
  stl += `endsolid ${filename}\n`;
  const blob = new Blob([stl], { type: 'text/plain' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ============ 纹样处理 ============
function setPatternFromImage(img) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);

  const imageData = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const gray = imageData.data[i]*0.299 + imageData.data[i+1]*0.587 + imageData.data[i+2]*0.114;
    imageData.data[i] = imageData.data[i+1] = imageData.data[i+2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);

  const previewCtx = document.getElementById('patternCanvas').getContext('2d');
  previewCtx.clearRect(0, 0, 512, 512);
  previewCtx.drawImage(canvas, 0, 0);

  patternCanvas = canvas;
  heightImageData = canvas.getContext('2d').getImageData(0, 0, size, size);

  if (currentModel) rebuild3DModel();
}

function loadImageFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => setPatternFromImage(img);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ============ 预设纹样 ============
function drawPresetPattern(type) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#FFFFFF';
  const cx = size/2, cy = size/2;

  if (type === 'sun') {
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI*2/8)*i - Math.PI/2;
      const x1 = cx + Math.cos(angle)*200;
      const y1 = cy + Math.sin(angle)*200;
      const x2 = cx + Math.cos(angle+0.35)*120;
      const y2 = cy + Math.sin(angle+0.35)*120;
      const x3 = cx + Math.cos(angle-0.35)*120;
      const y3 = cy + Math.sin(angle-0.35)*120;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx,cy,30,0,Math.PI*2); ctx.fill();
  } else if (type === 'fire') {
    for (let i=0;i<6;i++) {
      const angle = (Math.PI*2/6)*i;
      ctx.save();
      ctx.translate(cx+Math.cos(angle)*140, cy+Math.sin(angle)*140);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0,-40); ctx.quadraticCurveTo(20,-10,15,20);
      ctx.quadraticCurveTo(5,30,0,45); ctx.quadraticCurveTo(-5,30,-15,20);
      ctx.quadraticCurveTo(-20,-10,0,-40); ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(cx,cy,25,0,Math.PI*2); ctx.fill();
  } else if (type === 'fu') {
    ctx.font = 'bold 280px "KaiTi","楷体","SimHei",sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('福', cx, cy-10);
  }
  const img = new Image();
  img.onload = () => setPatternFromImage(img);
  img.src = canvas.toDataURL();
}
function randomGenerate() {
  drawPresetPattern(['sun','fire','fu'][Math.floor(Math.random()*3)]);
}
async function aiGenerate() {
  const prompt = prompt('请输入纹样描述（如：彝族火纹 对称 黑白线条）');
  if(!prompt) return;
  try {
    const res = await fetch('http://127.0.0.1:7860/sdapi/v1/txt2img', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        prompt: prompt+", black and white, symmetrical, high contrast line art",
        negative_prompt: "color, blurry", steps:20, width:512, height:512, seed:-1, cfg_scale:7
      })
    });
    const data = await res.json();
    const img = new Image();
    img.onload = () => setPatternFromImage(img);
    img.src = 'data:image/png;base64,'+data.images[0];
  }catch(e){ alert('AI生成失败，请确认SD WebUI已启动(--api)，或改用导入纹样。'); }
}

// ============ 事件绑定 ============
function bindEvents() {
  const craftSelect = document.getElementById('craftSelect');
craftSelect.addEventListener('change', e => {
  craftType = e.target.value;
  if (currentModel) updateMaterialByCraft();
});
  document.getElementById('btnPreset1').addEventListener('click', ()=>drawPresetPattern('sun'));
  document.getElementById('btnPreset2').addEventListener('click', ()=>drawPresetPattern('fire'));
  document.getElementById('btnPreset3').addEventListener('click', ()=>drawPresetPattern('fu'));
  document.getElementById('btnGenerate').addEventListener('click', randomGenerate);
  document.getElementById('btnUpload').addEventListener('click', ()=>document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', (e)=>{
    if(e.target.files[0]) loadImageFromFile(e.target.files[0]);
  });
  document.getElementById('btnAIGenerate').addEventListener('click', aiGenerate);
  document.getElementById('btn3D').addEventListener('click', ()=>{
    if(!heightImageData) return alert('请先选择一个纹样！');
    rebuild3DModel();
  });
  document.getElementById('btnExport').addEventListener('click', ()=>{
    if(!currentModel) return alert('请先生成3D模型！');
    exportSTL(currentModel.geometry, `${document.getElementById('shapeSelect').value}.stl`);
  });

  // 滑块绑定
  const scaleSlider = document.getElementById('scaleSlider');
  const thickSlider = document.getElementById('thickSlider');
  const depthSlider = document.getElementById('depthSlider');
  const colorPicker = document.getElementById('patternColor');
  const uSlider = document.getElementById('uSlider');
  const vSlider = document.getElementById('vSlider');

  document.getElementById('scaleVal').textContent = scaleFactor.toFixed(2);
  document.getElementById('thickVal').textContent = thickFactor.toFixed(2);
  document.getElementById('depthVal').textContent = displacementStrength.toFixed(2);
  document.getElementById('uVal').textContent = uvOffsetU.toFixed(2);
  document.getElementById('vVal').textContent = uvOffsetV.toFixed(2);

  scaleSlider.addEventListener('input', e=>{
    scaleFactor = +e.target.value;
    document.getElementById('scaleVal').textContent = scaleFactor.toFixed(2);
    if(currentModel) rebuild3DModel();
  });
  thickSlider.addEventListener('input', e=>{
    thickFactor = +e.target.value;
    document.getElementById('thickVal').textContent = thickFactor.toFixed(2);
    if(currentModel) rebuild3DModel();
  });
  depthSlider.addEventListener('input', e=>{
    displacementStrength = +e.target.value;
    document.getElementById('depthVal').textContent = displacementStrength.toFixed(2);
    if(currentModel) rebuild3DModel();
  });
  colorPicker.addEventListener('input', e=>{
    patternColor = e.target.value;
    if(currentModel) updateTextureAppearance();
  });
  uSlider.addEventListener('input', e=>{
    uvOffsetU = +e.target.value;
    document.getElementById('uVal').textContent = uvOffsetU.toFixed(2);
    if(currentModel) updateTextureAppearance();
  });
  vSlider.addEventListener('input', e=>{
    uvOffsetV = +e.target.value;
    document.getElementById('vVal').textContent = uvOffsetV.toFixed(2);
    if(currentModel) updateTextureAppearance();
  });

  document.getElementById('shapeSelect').addEventListener('change', ()=>{
    if(currentModel) rebuild3DModel();
  });
   const patternScaleSlider = document.getElementById('patternScaleSlider');
document.getElementById('patternScaleVal').textContent = patternScale.toFixed(2);

patternScaleSlider.addEventListener('input', e => {
  patternScale = parseFloat(e.target.value);
  document.getElementById('patternScaleVal').textContent = patternScale.toFixed(2);
  if (currentModel) updateTextureAppearance();
});

// ======================
// 纹样库点击功能
// ======================
const patternItems = document.querySelectorAll('.pattern-item');
patternItems.forEach(item => {
  item.addEventListener('click', () => {
    // 取消所有选中
    patternItems.forEach(i => i.classList.remove('active'));
    // 当前选中
    item.classList.add('active');
    
    // 加载图片到3D系统
    const img = new Image();
    img.onload = () => {
      setPatternFromImage(img); // 你原有处理函数
    };
  img.onerror = () => {
      console.error('❌ 纹样图片加载失败！路径：', item.dataset.src);
      alert('图片加载失败！请检查：\n1. patterns 文件夹是否存在\n2. 图片名是否为 1.png~48.png');
    };
    
    // 最后设置图片路径
    img.src = item.dataset.src;
});
});
}



// ============ 动画 ============
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// ============ 启动 ============
function init() {
  initScene();
  bindEvents();
  animate();
  drawPresetPattern('sun');
}
init();
window.addEventListener('DOMContentLoaded', () => {
  const btns = document.querySelectorAll('button');
  const aiBtn = btns[5];

  const askBox = document.getElementById('askBox');
  const ansBox = document.getElementById('ansBox');
  const askInput = document.getElementById('askInput');
  const sendBtn = document.querySelector('.ai-send');
  const closeBtn = document.querySelector('.ai-close');
  const okBtn = document.querySelector('.ai-ok');
  const ansText = document.getElementById('ansText');

  //点开提问弹窗
  aiBtn.onclick = () => {
    askBox.style.display = 'flex';
  }

  //关闭提问
  closeBtn.onclick = () => {
    askBox.style.display = 'none';
    askInput.value = '';
  }

  //发送问题+弹出漂亮回答
  sendBtn.onclick = () => {
    const q = askInput.value.trim();
    if (!q) return;

    let ans = "彝族历史文化悠久，图腾纹样、民俗节日、传统工艺独具民族特色，是非物质文化珍贵遗产。";

    if(q.includes("太阳纹")) ans = "彝族八角太阳纹是民族核心古老图腾，象征光明永恒、祖先庇佑、日月轮转、五谷丰收、家族世代兴旺，寓意万物生生不息、平安吉祥绵长。";
    if(q.includes("火焰纹")) ans = "火焰纹是彝族灵魂图腾，彝族崇尚千年火信仰，寓意驱邪避凶、消灾纳福、生命力旺盛、阖家安康、家族香火永续不断。";
    if(q.includes("虎纹")) ans = "彝族自古自称虎族，虎是始祖守护图腾，象征威严霸气、辟邪镇宅、勇敢坚毅、福运常伴族人岁岁平安。";
    if(q.includes("火把节")) ans = "彝族火把节农历六月二十四举办，全民点火祈福、驱虫保收、歌舞欢庆团圆，传承千年火图腾民族信仰。";
    if(q.includes("彝族年")) ans = "彝族年是民族传统新年，祭祖感恩、阖家团圆、欢聚跳左脚舞，祈求来年风调雨顺、万事顺遂富足。";
    if(q.includes("漆器三色")) ans = "彝族非遗漆器经典黑红黄三色，黑色代表大地、红色代表火焰、黄色代表太阳，天地人和谐共生，工艺古朴精美。";

    askBox.style.display = 'none';
    ansText.innerHTML = ans;
    ansBox.style.display = 'flex';
  }

  //关闭回答
  okBtn.onclick = () => {
    ansBox.style.display = 'none';
    askInput.value = '';
  }
});