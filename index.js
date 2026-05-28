import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';

export function createHyperSearchTool(options) {
  // Supports both direct API keys OR a Fornace proxy setup.
  const { 
    token, 
    fornaceHost, 
    serperApiKey, 
    spiderApiKey, 
    openAiApiKey, // fallback for fast generation if no model registry
    modelRegistry, 
    multiModel = false, 
    guard 
  } = options;
  
  return defineTool({
    name: 'hyper_search',
    label: 'Hyper Search',
    description: 'Ultra-fast, deep parallel search. Tunable intensity from 1 (fast, shallow) to 5 (deep, highly parallel).',
    promptSnippet: 'Use `hyper_search` to find deep information on a topic quickly. Pass `prompt` (the complex question or topic) and optional `intensity` (1-5, default 3).',
    parameters: Type.Object({
      prompt: Type.String({ description: 'The complex question or research topic to search for.' }),
      intensity: Type.Optional(Type.Number({ 
        minimum: 1, 
        maximum: 5, 
        description: "1 (5 queries/URLs), 3 (15 queries/20 URLs), 5 (30 queries/50 URLs)" 
      }))
    }),
    async execute(_id, params, signal) {
      const guarded = typeof guard === 'function' ? guard('hyper_search') : null;
      if (guarded) return guarded;

      // Graceful Config Check
      const hasProxy = !!(fornaceHost && token);
      const hasDirectKeys = !!(serperApiKey && spiderApiKey);
      if (!hasProxy && !hasDirectKeys) {
         return {
           content: [{ 
             type: 'text', 
             text: 'SYSTEM MESSAGE: Hyper-Search is not configured. Please inform the user that they need to provide Serper and Spider API keys to enable this capability.' 
           }]
         };
      }

      const { prompt } = params;
      const intensity = params.intensity || 3;

      let numQueries, numUrls, timeoutMs;
      if (intensity <= 1) {
        numQueries = 5; numUrls = 5; timeoutMs = 2000;
      } else if (intensity >= 5) {
        numQueries = 30; numUrls = 50; timeoutMs = 6000;
      } else {
        numQueries = 15; numUrls = 20; timeoutMs = 3500;
      }

      // Auto-select fastest model from registry
      let flashModelId = "gpt-5.4-mini"; // fallback
      if (modelRegistry) {
        const allProviders = modelRegistry.listProviders();
        let found = false;
        for (const p of allProviders) {
          const conf = modelRegistry.getProviderConfig(p);
          const models = conf?.models || [];
          for (const m of models) {
             const lowerId = String(m.id).toLowerCase();
             // look for qwen-flash, flash, lite tiers
             if (lowerId.includes('flash') || lowerId.includes('lite') || lowerId.includes('mini')) {
                flashModelId = m.id;
                found = true;
                break;
             }
          }
          if (found) break;
        }
      }

      const runSwarm = async (queryList, previousQueries = []) => {
        let queries = [];
        try {
          const sysPrompt = `Decompose the following research prompt into a JSON array of up to ${numQueries} highly specific, distinct Google search queries. Output ONLY the raw JSON array of strings. Do not use markdown blocks.` + 
            (previousQueries.length > 0 ? `\n\nDo NOT use these previous queries: ${JSON.stringify(previousQueries)}` : "");
          
          if (hasProxy) {
            const llmRes = await fetch(`${fornaceHost}/create/api/proxy/llm/v1/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({
                model: flashModelId,
                messages: [ { role: "system", content: sysPrompt }, { role: "user", content: `Prompt: ${prompt}` } ],
                temperature: 0.3
              }),
              signal
            });
            const llmData = await llmRes.json();
            const text = llmData.choices?.[0]?.message?.content || "";
            const match = text.match(/\[[\s\S]*\]/);
            if (match) queries = JSON.parse(match[0]);
            else queries = [prompt];
          } else if (openAiApiKey) {
            // Fallback for direct open-source package usage
            const llmRes = await fetch(`https://api.openai.com/v1/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiApiKey}` },
              body: JSON.stringify({
                model: flashModelId,
                messages: [ { role: "system", content: sysPrompt }, { role: "user", content: `Prompt: ${prompt}` } ],
                temperature: 0.3
              }),
              signal
            });
            const llmData = await llmRes.json();
            const text = llmData.choices?.[0]?.message?.content || "";
            const match = text.match(/\[[\s\S]*\]/);
            if (match) queries = JSON.parse(match[0]);
            else queries = [prompt];
          } else {
             // If no LLM configured to fan out, just use the prompt
             queries = [prompt];
          }
        } catch (err) {
          console.warn("[hyper_search] Decomposition failed", err);
          queries = [prompt];
        }

        queries = queries.slice(0, numQueries);

        let searchResultsRaw = [];
        try {
          const payload = queries.map(q => ({ q, num: 5 }));
          
          let res;
          if (hasProxy) {
            res = await fetch(`${fornaceHost}/create/api/proxy/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify(payload),
              signal,
            });
          } else {
            res = await fetch(`https://google.serper.dev/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperApiKey },
              body: JSON.stringify(payload),
              signal,
            });
          }
          
          if (res.status === 401 || res.status === 403 || res.status === 503) {
             throw new Error('API_UNCONFIGURED');
          }

          if (res.ok) {
            searchResultsRaw = await res.json();
            if (!Array.isArray(searchResultsRaw)) searchResultsRaw = [searchResultsRaw];
          }
        } catch (err) {
          if (err.message === 'API_UNCONFIGURED') throw err;
          console.warn("[hyper_search] Batch Serper search failed", err);
        }

        const uniqueUrls = new Set();
        const snippets = [];
        for (const result of searchResultsRaw) {
          if (result?.organic) {
            for (const item of result.organic) {
              snippets.push(`[${item.title}](${item.link}): ${item.snippet}`);
              if (uniqueUrls.size < numUrls) uniqueUrls.add(item.link);
            }
          }
        }

        const fetchPromises = Array.from(uniqueUrls).map(async (url) => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            if (signal) signal.addEventListener('abort', () => controller.abort());
            
            let res;
            if (hasProxy) {
               res = await fetch(`${fornaceHost}/create/api/proxy/fetch`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                 body: JSON.stringify({ url, mode: 'markdown', spider_mode: 'HTTP' }),
                 signal: controller.signal,
               });
            } else {
               res = await fetch(`https://api.spider.cloud/v1/crawl`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${spiderApiKey}` },
                 body: JSON.stringify({ url, return_format: 'markdown', limit: 1, depth: 0, mode: 'HTTP', anti_bot: true }),
                 signal: controller.signal,
               });
            }
            
            clearTimeout(timeout);
            
            if (res.status === 401 || res.status === 403 || res.status === 503) {
               throw new Error('API_UNCONFIGURED');
            }
            
            if (!res.ok) return null;
            const data = await res.json();
            return { url, text: data?.[0]?.content?.substring(0, 3000) || null };
          } catch (err) {
            if (err.message === 'API_UNCONFIGURED') throw err;
            return null;
          }
        });

        const fetchResults = await Promise.allSettled(fetchPromises);
        const pages = [];
        for (const r of fetchResults) {
           if (r.status === 'rejected' && r.reason?.message === 'API_UNCONFIGURED') throw r.reason;
           if (r.status === 'fulfilled' && r.value?.text) pages.push(r.value);
        }

        return { queries, snippets, pages };
      };

      try {
        let swarmResult = await runSwarm();
        let totalTextLength = swarmResult.pages.reduce((acc, p) => acc + p.text.length, 0);

        // Auto-Retry Logic (Self-Healing)
        if (intensity >= 3 && totalTextLength < 1000) {
           console.log(`[hyper_search] Low text volume (${totalTextLength} chars). Triggering auto-retry...`);
           const retryResult = await runSwarm(swarmResult.queries);
           swarmResult.queries.push(...retryResult.queries);
           swarmResult.snippets.push(...retryResult.snippets);
           swarmResult.pages.push(...retryResult.pages);
        }

        // Deduplicate before synthesis
        const finalSnippets = Array.from(new Set(swarmResult.snippets)).slice(0, numUrls);
        
        const finalOutput = `
# Hyper-Search Results for: "${prompt}"
Intensity: ${intensity}

## Decomposed Queries Used
${swarmResult.queries.map(q => `- ${q}`).join('\n')}

## Top Snippets (Serper)
${finalSnippets.join('\n')}

## Page Extractions (Spider HTTP, ${timeoutMs}ms limit)
${swarmResult.pages.map(p => `### Source: ${p.url}\n${p.text}`).join('\n\n...\n\n')}
        `.trim();

        return {
          content: [{ type: 'text', text: finalOutput.substring(0, 100000) }], 
        };
      } catch (err) {
         if (err.message === 'API_UNCONFIGURED') {
            return {
              content: [{ 
                type: 'text', 
                text: 'SYSTEM MESSAGE: Hyper-Search upstream APIs are not properly configured (Missing or invalid API keys). Please inform the user that they need to configure Serper and Spider API keys to use this feature.' 
              }]
            };
         }
         throw err;
      }
    },
  });
}

  export default function(pi) {
    const tool = createHyperSearchTool({
      token: process.env.FC_AUTH_TOKEN,
      fornaceHost: process.env.FORNACE_HOST || 'https://fornace.net',
      serperApiKey: process.env.SERPER_API_KEY,
      spiderApiKey: process.env.SPIDER_API_KEY,
      openAiApiKey: process.env.OPENAI_API_KEY,
      modelRegistry: pi.modelRegistry || pi.models // Try to pass available registry if exists
    });
    pi.registerTool(tool);
  }
