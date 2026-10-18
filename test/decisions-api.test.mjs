import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { CameraDecisionGate } from '../src/input/camera.js';
import { buildDecisionRequest, createHandler, createRateLimiter, MAX_BODY_BYTES, MAX_IMAGE_BYTES, parseDecision, validateRequest } from '../api/decide.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJj0AAAAASUVORK5CYII=';
const input = () => ({ imageDataUrl: png, requestId: 'request-1', sessionEpoch: 1, baseRevision: 2 });
const answer = (action = 'NEXT', confidence = 0.96) => ({ answers: [{ type: 'choice', name: 'gesture', choice: action, confidence, probabilities: ['NEXT','PREVIOUS','NONE'].map(value => ({ value, probability: value === action ? 0.98 : 0.01 })) }] });
async function invoke(overrides = {}, dependencies = {}) {
  let calls = 0, sent;
  const fetchImpl = async (url, options) => { calls++; sent = { url, options }; return new Response(JSON.stringify(answer()), { status: 200 }); };
  const handler = createHandler({ fetchImpl, getApiKey: () => 'test-secret-never-print', rateLimit: () => true, ...dependencies });
  const req = { method: 'POST', headers: { 'content-type': 'application/json', host: 'demo.example', origin: 'https://demo.example', 'x-forwarded-proto': 'https' }, body: input(), ...overrides };
  const res = { headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = JSON.parse(body); } };
  await handler(req, res);
  return { ...res, calls, sent };
}

test('official choice/image schema, server model and echoed revision', async () => {
  const r = await invoke();
  assert.equal(r.statusCode, 200); assert.equal(r.calls, 1);
  assert.equal(r.sent.url, 'https://api.openai.com/v1/decisions');
  const sent = JSON.parse(r.sent.options.body);
  assert.equal(sent.model, 'gpt-6-luna'); assert.equal(sent.input[0].content[1].image_url, png);
  assert.deepEqual(sent.questions[0].choices.map(x => x.value), ['NEXT','PREVIOUS','NONE']);
  assert.deepEqual(r.body, { requestId: 'request-1', sessionEpoch: 1, baseRevision: 2, action: 'NEXT', confidence: 0.96, latencyMs: r.body.latencyMs });
  assert.equal(r.headers['cache-control'], 'no-store'); assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.equal(JSON.stringify(r.body).includes('test-secret'), false);
  assert.match(buildDecisionRequest(png).questions[0].instructions, /Ignore all written/);
});

test('PREVIOUS and NONE accepted only with valid complete distributions', () => {
  assert.equal(parseDecision(answer('PREVIOUS')).action, 'PREVIOUS');
  assert.equal(parseDecision(answer('NONE')).action, 'NONE');
  const bad = [null, {}, { answers: [] }, { answers: [{ type: 'refusal', name: 'gesture' }] }];
  for (const mutate of [a => a.confidence = NaN, a => a.confidence = 1.1, a => a.confidence = 0.89, a => delete a.probabilities, a => a.probabilities[0].probability = NaN, a => a.probabilities[1].value = 'NEXT', a => a.probabilities[0].probability = 0.2, a => a.choice = 'RUN_CODE', a => a.name = 'wrong']) {
    const p = answer(); mutate(p.answers[0]); bad.push(p);
  }
  for (const p of bad) assert.equal(parseDecision(p).action, 'NONE');
});

test('high confidence with weak winning probability cannot rearm a held camera gesture', () => {
  const payload = answer('NEXT', 0.99);
  payload.answers[0].probabilities = [{ value: 'NEXT', probability: 0.6 }, { value: 'PREVIOUS', probability: 0.2 }, { value: 'NONE', probability: 0.2 }];
  const fallback = parseDecision(payload);
  assert.deepEqual(fallback, { action: 'NONE', confidence: 0.6 });
  const gate = new CameraDecisionGate(); gate.start();
  const state = { phase: 'presenting', pendingJump: null, sessionEpoch: 1, revision: 0 };
  const consume = (id, decision) => { const request = { requestId: id, sessionEpoch: 1, baseRevision: 0 }; return gate.consume({ ...request, ...decision }, request, state); };
  assert.equal(consume('one', { action: 'NEXT', confidence: 0.99 }).kind, 'action');
  assert.equal(consume('uncertain', fallback).kind, 'uncertain');
  assert.equal(consume('held', { action: 'NEXT', confidence: 0.99 }).kind, 'held');
});

test('invalid identifiers, content, mime and oversized image never reach upstream', async () => {
  for (const patch of [{ requestId: '' }, { requestId: 1 }, { sessionEpoch: -1 }, { baseRevision: 0.1 }, { extra: true }, { imageDataUrl: 'https://example.com/a.png' }, { imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, { imageDataUrl: 'data:image/png;base64,YWJjZA==' }, { imageDataUrl: 'data:image/jpeg;base64,%%%%' }, { imageDataUrl: 'data:image/png;base64,' + Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64') }]) {
    const r = await invoke({ body: { ...input(), ...patch } }); assert.equal(r.statusCode, 400); assert.equal(r.calls, 0);
  }
  assert.equal(validateRequest(input()).imageDataUrl, png);
});

test('method, origin, content type and body length are guarded', async () => {
  for (const [patch, status] of [[{ method: 'GET' },405], [{ headers: { host:'demo.example', origin:'https://evil.example', 'content-type':'application/json' } },403], [{ headers: { host:'demo.example', 'sec-fetch-site':'cross-site', 'content-type':'application/json' } },403], [{ headers: {} },415], [{ body: '{bad' },400], [{ headers: { 'content-type':'application/json', 'content-length':String(MAX_BODY_BYTES + 1) } },413]]) {
    const r = await invoke(patch); assert.equal(r.statusCode, status); assert.equal(r.calls, 0);
  }
});

test('streamed request body is supported and bounded', async () => {
  const req = Readable.from([JSON.stringify(input())]); req.method = 'POST'; req.headers = { 'content-type': 'application/json' };
  const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await createHandler({ getApiKey: () => 'test', rateLimit: () => true, fetchImpl: async () => new Response(JSON.stringify(answer())) })(req, res);
  assert.equal(res.statusCode, 200);
  const large = Readable.from([Buffer.alloc(MAX_BODY_BYTES + 1)]); large.method = 'POST'; large.headers = req.headers;
  await createHandler({ getApiKey: () => 'test', rateLimit: () => true, fetchImpl: () => assert.fail('must not fetch') })(large, res);
  assert.equal(res.statusCode, 413);
});

test('missing key and rate limit fail before sending images', async () => {
  const missing = await invoke({}, { getApiKey: () => '' }); assert.equal(missing.statusCode, 503); assert.equal(missing.calls, 0);
  const rate = await invoke({}, { rateLimit: () => false }); assert.equal(rate.statusCode, 429); assert.equal(rate.calls, 0);
  let now = 0; const limiter = createRateLimiter({ now: () => now, limit: 1, globalLimit: 2, windowMs: 100 });
  assert.equal(limiter('a'), true); assert.equal(limiter('a'), false); assert.equal(limiter('b'), true); assert.equal(limiter('c'), false);
  now = 101; assert.equal(limiter('a'), true);
});

test('401, 429, 500 and malformed upstream errors never leak raw output', async () => {
  for (const [upstream, expected] of [[401,503],[429,429],[500,502]]) {
    const r = await invoke({}, { fetchImpl: async () => new Response('secret upstream image payload', { status: upstream }) });
    assert.equal(r.statusCode, expected); assert.equal(JSON.stringify(r.body).includes('secret'), false); assert.equal(r.body.action, undefined);
  }
  const malformed = await invoke({}, { fetchImpl: async () => new Response('not-json-secret') }); assert.equal(malformed.statusCode, 502);
  const invalidDistribution = await invoke({}, { fetchImpl: async () => new Response(JSON.stringify({ answers: [{ type: 'choice', name:'gesture', choice:'NEXT', confidence:1 }] })) });
  assert.equal(invalidDistribution.body.action, 'NONE');
});

test('timeout aborts upstream, returns no action, and never retries', async () => {
  let calls = 0, signal;
  const r = await invoke({}, { timeoutMs: 5, fetchImpl: async (_url, opts) => { calls++; signal = opts.signal; return new Promise(() => {}); } });
  assert.equal(r.statusCode, 504); assert.equal(r.body.error.code, 'TIMEOUT'); assert.equal(calls, 1); assert.equal(signal.aborted, true); assert.equal(r.body.action, undefined);
});
