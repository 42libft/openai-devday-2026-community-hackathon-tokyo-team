import {readFile,writeFile} from 'node:fs/promises';

// Local, synthetic acceptance pages. Deploy source files, never these fixtures.
const html = await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const mock = `window.speechFixture={instances:[],index:0};
class MockSpeech {
 constructor(){this.aborted=0;this.nextIndex=0;speechFixture.instances.push(this);}
 start(){this.onstart?.();}
 abort(){this.aborted++;this.onend?.();}
 emit(text,index,final=true){const r=[{transcript:text,confidence:0.99}];r.isFinal=final;const results=Array(index+1).fill(null);results[index]=r;this.onresult?.({resultIndex:index,results});if(final)this.onend?.();}
}
window.SpeechRecognition=MockSpeech;window.webkitSpeechRecognition=MockSpeech;
if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw new Error('Real sensors prohibited in fixture');};
window.fixtureSay=(text,final=true,replay=false)=>{const previous=replay?speechFixture.lastFinal:null;const r=previous?.recognition??speechFixture.instances.at(-1);if(!r)throw new Error('Start mock recognition first');const index=previous?.index??r.nextIndex;if(!final)speechFixture.lastPending={recognition:r,index};if(final&&!replay){speechFixture.lastFinal={recognition:r,index};r.nextIndex++;}r.emit(text,index,final);};`;
const controls=`<aside style="padding:16px;background:#fff4cb;color:#342c19" aria-label="模擬音声の検証専用">
 <strong>検証専用・模擬音声（実マイクは使いません）</strong>
 <button onclick="fixtureSay('次へ',false)">途中の次へ</button>
 <button onclick="fixtureSay('次へ')">次へ確定</button>
 <button onclick="fixtureSay('次へ',true,true)">重複結果</button>
 <button onclick="fixtureSay('前へ')">前へ確定</button>
 <button onclick="fixtureSay('3枚目へ')">寄り道候補</button>
 <button onclick="fixtureSay('確認')">寄り道確認</button>
 <button onclick="fixtureSay('続きへ')">続きへ確定</button>
 <button onclick="fixtureSay('取り消し')">取り消し確定</button>
 <button onclick="fixtureSay('次へと言います')">説明文</button>
 <button onclick="fixtureSay('停止')">発表停止</button>
 <button onclick="speechFixture.instances.at(-1).onerror({error:'not-allowed'})">マイク拒否</button>
 <button onclick="speechFixture.instances.at(-1).onend()">ブラウザ終了</button>
 <button onclick="speechFixture.instances.at(-1).onerror({error:'no-speech'})">無音通知</button>
 <button onclick="speechFixture.lastPending.recognition.emit('次へ',speechFixture.lastPending.index,true)">期限切れの確定結果</button>
 <button onclick="speechFixture.instances[0].emit('次へ',99,true)">遅い応答</button>
</aside>`;
await writeFile(new URL('../dist/_speech-check.html',import.meta.url),html.replace('</head>',`<script>${mock}</script></head>`).replace('<body>','<body>'+controls));
await writeFile(new URL('../dist/_speech-unsupported.html',import.meta.url),html.replace('</head>','<script>window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;</script></head>').replace('<body>','<body><aside>検証専用・音声非対応の模擬環境</aside>'));
console.log('Created local synthetic speech fixtures; no sensors or external requests used.');
