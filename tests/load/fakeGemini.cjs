const {setTimeout: delay} = require('node:timers/promises');
function createFakeFetch(delayMs = 5000) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== 'https://generativelanguage.googleapis.com' ||
        !['/v1beta/openai/embeddings','/v1beta/openai/chat/completions'].includes(url.pathname))
      throw Error('Unexpected provider request in isolated test');
    const body = JSON.parse(init.body || '{}');
    const embedding = url.pathname.endsWith('/embeddings');
    if (!embedding && body.messages?.some(item=>item.role==='user' && String(item.content).includes('SCHAT_SYNTHETIC_FAILURE')))
      return Response.json({error:{code:400,message:'Synthetic test error',status:'INVALID_ARGUMENT'}},{status:400});
    await delay(embedding ? 20 : delayMs, null, {signal:init.signal});
    const usage = {prompt_tokens:100,completion_tokens:10,total_tokens:110};
    const bytes = Buffer.alloc(12);
    bytes.writeFloatLE(1, 0);
    const vector = body.encoding_format === 'base64' ? bytes.toString('base64') : [1,0,0];
    if (embedding) return Response.json({object:'list',model:body.model,
      data:(Array.isArray(body.input)?body.input:[body.input]).map((_,index)=>({object:'embedding',index,embedding:vector})),
      usage:{prompt_tokens:1,total_tokens:1}});
    const common = {id:'synthetic-response',created:1,model:body.model};
    if (!body.stream) return Response.json({...common,object:'chat.completion',usage,
      choices:[{index:0,message:{role:'assistant',content:'Synthetic fixed answer'},finish_reason:'stop'}]});
    const events = [
      {...common,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'Synthetic fixed answer'},finish_reason:null}]},
      {...common,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}],usage},
    ];
    return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n',
      {headers:{'Content-Type':'text/event-stream'}});
  };
}
module.exports = {createFakeFetch};
