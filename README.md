# Pi Hyper-Search 🚀

An open-source, ultra-fast, highly parallel search plugin for the Pi Agent Runtime.

## Features

- **Dynamic Intensity:** Exposes an `intensity` parameter (1-5) to the main LLM. Scales from 5 parallel queries up to 30 parallel queries and 50 URLs fetched in seconds.
- **Asynchronous Multiplexed Swarm:** Fires parallel Serper queries using native array batching.
- **In-flight Edge Filtering:** Fetches top URLs concurrently using Spider's high-speed HTTP mode, with strict early termination timeouts.
- **Smart Model Routing:** Integrates with Pi's `ModelRegistry` to automatically select the fastest available model (e.g. `qwen-flash`, `gemini-3.1-flash-lite`) for the query fan-out phase.
- **Self-Healing Retries:** Automatically monitors scraped text volume and re-prompts for different queries if the initial swarm returns insufficient data.

## Installation

```bash
npm install Fornace/pi-hypersearch
```

## Usage

Register the tool in your Pi runtime:

```javascript
import { createHyperSearchTool } from 'pi-hypersearch';

const hyperSearch = createHyperSearchTool({
  token: process.env.FC_AUTH_TOKEN, // If using Fornace Proxy
  fornaceHost: 'https://fornace.net',
  // OR provide direct keys:
  // serperApiKey: process.env.SERPER_API_KEY,
  // spiderApiKey: process.env.SPIDER_API_KEY,
  // openAiApiKey: process.env.OPENAI_API_KEY,
  modelRegistry: myModelRegistry, // For smart routing
});

// Add to your customTools array
```

## How It Works
1. **Flash Decomposition:** A fast model breaks the user's complex prompt into multiple specific Google queries.
2. **Batch Search:** All queries are sent to Serper in a single batched HTTP request.
3. **Concurrent Scrape:** The top unique URLs are scraped in parallel using Spider in `HTTP` mode to bypass Javascript rendering overhead.
4. **Synthesis:** The dense Markdown is returned to the main Pi agent.
