import {readFile, writeFile} from 'node:fs/promises';

// Local-only visual check: generated frames, no physical camera or API request.
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const samples = [[640, 480], [640, 360], [360, 640]];
const cards = samples.map(([w, h]) => `<article style="width:270px;max-width:100%"><h2>${w}:${h}・四辺を表示</h2><div class="camera-preview"><video muted autoplay playsinline data-frame-width="${w}" data-frame-height="${h}"></video></div></article>`).join('');
const fixture = `<aside style="padding:20px;background:#fff4cb"><strong>検証専用・合成映像（実カメラは使いません）</strong><div style="display:flex;flex-wrap:wrap;gap:24px">${cards}</div></aside>`;
const setup = `<script>
if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw new Error('Real sensors prohibited in fixture');};
document.addEventListener('DOMContentLoaded',()=>{
 for(const video of document.querySelectorAll('video[data-frame-width]')){
  const canvas=document.createElement('canvas');canvas.width=Number(video.dataset.frameWidth);canvas.height=Number(video.dataset.frameHeight);
  const context=canvas.getContext('2d');context.fillStyle='#182c40';context.fillRect(0,0,canvas.width,canvas.height);
  for(const [color,x,y,w,h] of [['#ef4444',0,0,canvas.width,24],['#22c55e',0,canvas.height-24,canvas.width,24],['#3b82f6',0,24,24,canvas.height-48],['#facc15',canvas.width-24,24,24,canvas.height-48]]){context.fillStyle=color;context.fillRect(x,y,w,h);}
  video.srcObject=canvas.captureStream(1);video.play().catch(()=>{});
 }
});</script>`;
await writeFile(new URL('../dist/_issue-frames.html', import.meta.url), html.replace('</head>', setup+'</head>').replace('<body>', '<body>'+fixture));
console.log('Created local synthetic aspect-ratio fixture.');
