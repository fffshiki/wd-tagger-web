import { test, expect } from '@playwright/test';

// A tiny synthetic ONNX Identity graph, encoded per ONNX IR v8 / opset 13.
// Real WASM execution is tested; this is not an inference mock or a WD model substitute.
function identityModel() {
  const integer = n => { const bytes=[];do{let b=n&127;n>>>=7;if(n)b|=128;bytes.push(b)}while(n);return bytes; };
  const number = (field,value) => [...integer(field*8),...integer(value)];
  const message = (field,value) => { const bytes=typeof value==='string'?[...Buffer.from(value)]:value;return [...integer(field*8+2),...integer(bytes.length),...bytes]; };
  const dimensions=[...message(1,number(1,1)),...message(1,number(1,3))];
  const valueInfo = name => [...message(1,name),...message(2,message(1,[...number(1,1),...message(2,dimensions)]))];
  const node=[...message(1,'x'),...message(2,'y'),...message(4,'Identity')];
  const graph=[...message(1,node),...message(2,'synthetic_identity'),...message(11,valueInfo('x')),...message(12,valueInfo('y'))];
  return [...number(1,8),...message(7,graph),...message(8,number(2,13))];
}

test('actual runtime JS, module and WASM load under a GitHub Pages project subpath', async ({page}) => {
  test.setTimeout(60000);
  const errors=[],external=[],responses=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.url().includes('/vendor/onnxruntime/'))responses.push({url:response.url(),status:response.status(),type:response.headers()['content-type']});});
  await page.route('**/*',route=>{if(route.request().url().startsWith('http://127.0.0.1:4174/'))return route.continue();external.push(route.request().url());return route.abort();});
  await page.goto('/wd-tagger-web/');
  const output=await page.evaluate(async model=>{
    const base=new URL('./vendor/onnxruntime/',document.baseURI).href;
    await loadScript(base+'ort.wasm.min.js');
    ort.env.wasm.wasmPaths=base;ort.env.wasm.numThreads=1;ort.env.wasm.simd=true;
    const session=await ort.InferenceSession.create(new Uint8Array(model),{executionProviders:['wasm']});
    const result=await session.run({x:new ort.Tensor('float32',new Float32Array([1.25,-2,3]),[1,3])});
    const values=Array.from(result.y.data);result.y.dispose();await session.release();
    return {values,version:ort.env.versions.web,crossOriginIsolated};
  },identityModel());
  expect(output.values).toEqual([1.25,-2,3]);expect(output.version).toBe('1.20.1');
  expect(output.crossOriginIsolated).toBe(false);
  for(const name of ['ort.wasm.min.js','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])expect(responses.some(r=>r.url.includes(name)&&r.status===200)).toBe(true);
  expect(responses.find(r=>r.url.endsWith('.wasm')).type).toContain('application/wasm');
  expect(external).toEqual([]);expect(errors).toEqual([]);
});

test('manual model and CSV selection remain available alongside pinned download links',async({page})=>{
  await page.goto('/wd-tagger-web/');
  await expect(page.locator('#model')).toHaveAttribute('type','file');
  await expect(page.locator('#csv')).toHaveAttribute('type','file');
  const hrefs=await page.locator('#modelSources .actions a').evaluateAll(nodes=>nodes.map(x=>x.href));
  expect(hrefs).toHaveLength(2);
  expect(hrefs.every(x=>x.includes('/627aef95638667ddcaa3ac8ae625e88ea5b02f51/'))).toBe(true);
  await expect(page.locator('#run')).toBeDisabled();
});
