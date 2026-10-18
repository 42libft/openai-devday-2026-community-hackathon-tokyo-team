import {readFile, writeFile} from 'node:fs/promises';

// Local-only sensor/permission fixtures. Generate after build; never deploy them.
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const setup=`
let recognizer, nextCamera='NONE';
class MockSpeech {
 start(){recognizer=this;this.onstart?.();this.timer=setTimeout(()=>{this.onnomatch?.();this.onend?.();},1000);}
 abort(){clearTimeout(this.timer);this.onend?.();}
 say(text){clearTimeout(this.timer);this.onspeechstart?.();const result=[{transcript:text}];result.isFinal=true;this.onresult?.({resultIndex:0,results:[result]});this.onend?.();}
}
window.SpeechRecognition=MockSpeech;window.webkitSpeechRecognition=MockSpeech;
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
 const c=canvas.getContext('2d');c.fillStyle='#204060';c.fillRect(0,0,320,240);
 return canvas.captureStream(1);
}});
const originalFetch=window.fetch.bind(window);
window.fetch=(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin)throw new Error('No external requests in fixture');
 if(url.pathname!=='/api/decide')return originalFetch(input,options);
 const body=JSON.parse(options.body),action=nextCamera;nextCamera='NONE';
 return Promise.resolve(new Response(JSON.stringify({requestId:body.requestId,sessionEpoch:body.sessionEpoch,baseRevision:body.baseRevision,action,confidence:1,latencyMs:1}),{headers:{'Content-Type':'application/json'}}));
};
document.addEventListener('keydown',event=>{
 if(event.target.closest?.('input,textarea'))return;
 const commands={v:'次へ',b:'前へ',j:'8枚目へ',k:'確認',r:'続きへ'};
 if(commands[event.key]){event.stopImmediatePropagation();recognizer?.say(commands[event.key]);}
 if(event.key==='c')nextCamera='NEXT';
},true);
`;
const fixtureFiles=[['PPTX','pptx',process.env.PROJECTION_PPTX],['縦長PDF','pdf',process.env.PROJECTION_PDF]];
let fileButtons='';
for(const [label,kind,source] of fixtureFiles){
 if(!source)continue;
 await writeFile(new URL('../dist/_projection-fixture.'+kind,import.meta.url),await readFile(source));
 fileButtons+=`<button type="button" onclick="fetch('./_projection-fixture.${kind}').then(r=>r.blob()).then(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'fixture.${kind}'));const input=document.querySelector('#deck-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})">${label}を読み込む（検証専用）</button>`;
}
const banner='<aside style="background:#fff1bb;padding:8px">投影検証専用・実センサー/APIは使わない。模擬音声: V次へ/B前へ/J8枚目/K確認/R続き。模擬カメラ: C次へ。'+fileButtons+'</aside>';
for(const [name,override] of [
 ['check',"const nativeFullscreen=Element.prototype.requestFullscreen;Element.prototype.requestFullscreen=function(...args){return nativeFullscreen.apply(this,args).catch(error=>{console.warn('Native fullscreen rejected:',error.name,error.message);throw error;});};"],
 ['denied',"Object.defineProperty(document,'fullscreenEnabled',{value:true});Element.prototype.requestFullscreen=()=>Promise.reject(new Error('Synthetic denial'));"],
 ['unsupported',"Object.defineProperty(document,'fullscreenEnabled',{value:false});Element.prototype.requestFullscreen=undefined;"],
]){
 await writeFile(new URL('../dist/_projection-'+name+'.html',import.meta.url),html.replace('</head>','<script>'+setup+override+'</script></head>').replace('<body>','<body>'+banner));
}
console.log('Created local-only projection fixtures. Never deploy _projection-*.html.');
