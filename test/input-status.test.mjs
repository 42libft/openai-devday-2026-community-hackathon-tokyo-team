import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mountInputSettings} from '../src/ui/input-settings.js';
import {mountSpeechPanel} from '../src/ui/speech-panel.js';
const previousDocument=globalThis.document,previousWindow=globalThis.window;
afterEach(()=>{globalThis.document=previousDocument;globalThis.window=previousWindow;});
function harness() {
  const scrolls=[];
  class Element extends EventTarget {
    constructor(tag){super();this.tagName=tag;this.dataset={};this.queries=new Map();this.children=[];this.open=false;}
    setAttribute(name,value){this[name]=value;if(name==='open')this.open=true;}
    removeAttribute(name){delete this[name];if(name==='open')this.open=false;}
    querySelector(selector){if(!this.queries.has(selector))this.queries.set(selector,new Element('node'));return this.queries.get(selector);}
    append(...children){this.children.push(...children);}
    prepend(...children){this.children.unshift(...children);}
    showModal(){this.open=true;}
    close(){this.open=false;this.dispatchEvent(new Event('close'));}
    focus(options){document.activeElement=this;this.focusOptions=options;}
    click(){this.dispatchEvent(new Event('click'));}
    remove(){}
  }
  globalThis.document={createElement:tag=>new Element(tag),activeElement:new Element('button')};
  globalThis.window={scrollX:0,scrollY:360,scrollTo:position=>scrolls.push(position)};
  const root=new Element('main'),calls=[];
  const api=mountInputSettings(root,{onManual:()=>calls.push('manual'),onSpeechStart:()=>calls.push('speech'),onCameraStart:()=>calls.push('camera')});
  return {api,strip:root.children[0],dialog:root.children[1],calls,scrolls,Element};
}

test('closed details retain mode, transcript, operation, error text and explicit recovery',()=>{
  const h=harness();h.api.setMode('voice');h.api.setState({phase:'presenting'});
  h.api.setStatus('speech',{status:'listening',transcript:'次へ',message:'聞き取り中'});
  h.api.setResult('voice','次の工程へ移りました。');
  h.api.setStatus('speech',{status:'error',message:'接続できません。音声を開始し直してください。'});
  assert.equal(h.dialog.open,false);
  assert.match(h.strip.querySelector('[data-input-mode]').textContent,/音声/);
  assert.match(h.strip.querySelector('[data-input-result="speech"]').textContent,/次へ/);
  assert.match(h.strip.querySelector('[data-last-operation]').textContent,/次の工程/);
  assert.match(h.strip.querySelector('[data-input-message="speech"]').textContent,/開始し直して/);
  assert.equal(h.strip.querySelector('[data-input-recovery="speech"]').hidden,false);
  const start=h.strip.querySelector('[data-input-start="speech"]');assert.match(start.textContent,/同意して音声を再開/);start.click();
  assert.deepEqual(h.calls,['speech']);
  h.api.setStatus('speech',{status:'starting',transcript:''});
  assert.match(h.strip.querySelector('[data-input-result="speech"]').textContent,/次へ/);
  h.api.setStatus('camera',{status:'result',action:'NEXT'});
  assert.match(h.strip.querySelector('[data-input-result="camera"]').textContent,/次へ/);
});

test('unsupported and ended presentations cannot start from the inline controls',()=>{
  const h=harness();h.api.setStatus('speech',{status:'unsupported',message:'音声非対応です。手動で操作してください。'});
  h.api.setStatus('speech',{status:'stopped'});h.api.setMode('camera');
  const speech=h.strip.querySelector('[data-input-start="speech"]');
  assert.equal(speech.disabled,true);assert.match(h.strip.querySelector('[data-input-status="speech"]').textContent,/非対応/);speech.click();
  h.api.setState({phase:'stopped'});
  const camera=h.strip.querySelector('[data-input-start="camera"]');assert.equal(camera.disabled,true);camera.click();
  assert.match(h.strip.querySelector('[data-input-message="camera"]').textContent,/はじめから/);assert.deepEqual(h.calls,[]);
  h.strip.querySelector('[data-manual-input]').click();assert.deepEqual(h.calls,['manual']);
  h.api.setState({phase:'idle'});assert.equal(camera.disabled,false);assert.equal(speech.disabled,true);
});

test('dialog closes without scrolling away and restores the invoking focus',()=>{
  const h=harness(),opener=h.strip.querySelector('[data-input-settings]');opener.focus();opener.click();
  assert.equal(h.dialog.open,true);assert.equal(h.scrolls.length,0);
  h.dialog.querySelector('[data-close-settings]').click();assert.equal(h.dialog.open,false);
  assert.equal(document.activeElement,opener);assert.deepEqual(opener.focusOptions,{preventScroll:true});
  assert.equal(h.scrolls.at(-1).top,360);
  opener.click();h.dialog.close();assert.equal(h.scrolls.length,2);
});

test('detailed speech controls retain unsupported status after stop updates',()=>{
  const h=harness(),container=new h.Element('section');
  const panel=mountSpeechPanel(container,{onStart(){},onStop(){}});
  panel.setState({status:'unsupported',supported:false,message:'音声非対応'});
  panel.setState({status:'stopped'});
  assert.equal(container.dataset.speechStatus,'unsupported');
  assert.equal(container.querySelector('[data-speech-action="start"]').disabled,true);
  assert.equal(container.querySelector('[data-speech-action="start"]').textContent,'音声非対応');
});
