import assert from 'node:assert/strict';
import test from 'node:test';
import { createStaticPptxViewer, isExternalRelationship } from '../src/slides/pptx-preview.js';
import { createUploadSession } from '../src/slides/upload.js';

// Simulate ancestor capture, descendant activation, then document bubbling.
function surface() {
  const listeners = new Map();
  return {
    addEventListener(type, callback, capture) { assert.equal(capture, true); listeners.set(type, callback); },
    removeEventListener(type, callback, capture) {
      assert.equal(capture, true);
      if (listeners.get(type) === callback) listeners.delete(type);
    },
    activate(type, key, descendant, documentHandler = () => {}) {
      const event = { type, key, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.stopped = true; } };
      listeners.get(type)?.(event);
      if (!event.stopped) { descendant(event); documentHandler(event); }
      return event;
    },
    get listenerCount() { return listeners.size; },
  };
}

test('external relationships reject whitespace around URL and TargetMode', () => {
  for (const [target, mode] of [
    [' https://example.invalid/image.png', ' External '],
    ['../media/image.png', '\tEXTERNAL\n'],
    [' \nhttps://example.invalid/image.png ', ''],
    ['  //example.invalid/image.png', ''],
  ]) assert.equal(isExternalRelationship(target, mode), true);
  assert.equal(isExternalRelationship('../media/image.png', 'Internal'), false);
  assert.equal(isExternalRelationship('../slides/slide3.xml', ''), false);
});

test('static preview blocks embedded link activation but retains document arrow navigation', () => {
  const host = surface();
  let embeddedPage = 1, documentPage = 1, destroyed = false;
  class Viewer {
    load() {}
    async renderSlide() {}
    destroy() { destroyed = true; }
  }
  const viewer = createStaticPptxViewer(host, Viewer);
  for (const [type, key] of [['click'], ['keydown', 'Enter'], ['keydown', ' ']]) {
    const event = host.activate(type, key, () => { embeddedPage = 3; });
    assert.equal(event.defaultPrevented, true);
    assert.equal(embeddedPage, 1);
  }
  const arrow = host.activate('keydown', 'ArrowRight', () => {}, () => { documentPage++; });
  assert.equal(arrow.defaultPrevented, false);
  assert.equal(documentPage, 2);
  viewer.destroy();
  assert.equal(destroyed, true);
  assert.equal(host.listenerCount, 0);
});

test('resolved first-page slideerror rejects import and preserves the working deck', async () => {
  const workingDeck = { name: 'working', destroyed: false };
  let currentDeck = workingDeck, disposed = false;
  const messages = [];
  const failure = new Error('damaged first page');
  class FailingViewer {
    constructor(_host, options) { this.options = options; }
    load() {}
    async renderSlide(index) { this.options.onSlideError(index, failure); }
    destroy() { disposed = true; }
  }
  const upload = createUploadSession({
    async load() {
      const viewer = createStaticPptxViewer(surface(), FailingViewer);
      try {
        viewer.load({});
        await viewer.renderSlide(0);
        return { steps: [{}], destroy() {} };
      } finally { viewer.destroy(); }
    },
    canApply: () => true, onBusy() {},
    onApply(deck) { currentDeck = deck; },
    onMessage(message) { messages.push(message); },
  });
  await upload.select({ name: 'damaged.pptx', size: 100, arrayBuffer() {} });
  assert.equal(currentDeck, workingDeck);
  assert.equal(workingDeck.destroyed, false);
  assert.equal(disposed, true);
  assert.equal(upload.busy, false);
  assert.equal(messages.at(-1), failure.message);
});
