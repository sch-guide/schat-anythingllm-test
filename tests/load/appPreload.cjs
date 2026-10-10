// Explicit test preload only. Not imported by or copied into production code.
require('./appIsolation.cjs').assertIsolation();
// Never read the image's baked .env or any developer credentials.
require('/app/server/node_modules/dotenv').config = () => ({parsed: {}});
// Diagnostic metadata only, never query text, arguments, credentials or records.
if (process.env.SCHAT_TEST_DB_TRACE === '1') {
  let sequence = 0;
  require('/app/server/utils/prisma').$use(async (params, next) => {
    const id = ++sequence, started = Date.now();
    const write = !['findMany','findFirst','findUnique','count','aggregate'].includes(params.action);
    if (write) console.log(JSON.stringify({dbTrace:'start',id,model:params.model,action:params.action}));
    try {return await next(params);}
    finally {if(write)console.log(JSON.stringify({dbTrace:'end',id,ms:Date.now()-started}));}
  });
}
const originalFetch = globalThis.fetch;
const fakeDelay = Number(process.env.SCHAT_TEST_DELAY_SECONDS || 5);
if (![5,10,20].includes(fakeDelay)) throw Error('Unsupported isolated delay');
const fakeFetch = require('./fakeGemini.cjs').createFakeFetch(fakeDelay * 1000);
// SDK boundary only: production authentication, retrieval, queues and storage stay real.
const sdkPath = require.resolve('/app/server/node_modules/openai');
const Original = require(sdkPath);
class IsolatedOpenAI extends Original {
  constructor(options) { super({...options, fetch: options?.fetch || fakeFetch}); }
}
Object.assign(IsolatedOpenAI, Original);
IsolatedOpenAI.OpenAI = IsolatedOpenAI;
IsolatedOpenAI.default = IsolatedOpenAI;
require.cache[sdkPath].exports = IsolatedOpenAI;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === 'generativelanguage.googleapis.com') return fakeFetch(input, options);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    return Promise.reject(new Error('External fetch disabled in isolated smoke test'));
  return originalFetch(input, options);
};
