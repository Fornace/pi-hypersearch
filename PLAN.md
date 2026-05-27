# Pi Hyper-Search 🚀

An open-source, ultra-fast, highly parallel search plugin for the Pi Agent Runtime.

## Vision

To provide Pi agents with the fastest possible mechanism to retrieve deep, synthesized knowledge from the web by bypassing sequential agent-turn latency.

## Architecture & Roadmap

### 1. Dynamic Intensity ("The Feeling Parameter")
The tool exposes an `intensity` parameter (1-5) to the main LLM. The model can choose how hard to search based on its own confidence or "feeling" about how much information is needed.
- **Intensity 1 (Quick check):** 5 generated queries, top 5 URLs, 2.0s timeout.
- **Intensity 3 (Standard):** 15 generated queries, top 20 URLs, 3.5s timeout.
- **Intensity 5 (Deep dive):** 30 generated queries, top 50 URLs, 6.0s timeout, automatic fallback/retry loop.

### 2. Auto-Retries (Self-Healing)
If the combined length of the scraped markdown is below a threshold (e.g., < 500 chars), or if Serper returns zero organic results, the tool automatically re-prompts the internal fast model for *different* queries and fires a second swarm before returning to the slow main LLM. This prevents "I searched but found nothing" turns from the main agent.

### 3. Spider Markdown vs. Local Parser
Spider's `mode: "HTTP"` with `return_format: "markdown"` is the optimal path. Spider's Rust-based backend is phenomenally fast at stripping boilerplate, navbars, and ads while bypassing anti-bot measures (Cloudflare, etc.). A purely local Node `fetch` + `cheerio` parser would be slightly faster on raw latency but would fail on 40% of modern sites due to bot protection and return massive amounts of garbage HTML. We will stick to Spider HTTP mode but expose a `use_local_fallback` option for sites known to be unprotected.

### 4. Smart Model Catalog Routing
Instead of hardcoding the decomposition model, the plugin will accept Pi's `ModelRegistry`. It will intelligently select the best model for the job based on available tiers:
1. Look for `tier: "flash"` or `tier: "lite"` (e.g., `qwen-flash`, `gemini-3.1-flash-lite`, `deepseek-v4-flash`).
2. Fall back to `base` tier if no fast models are registered.
This ensures the fan-out generation always uses the cheapest, lowest-latency model in the user's catalog.

### 5. Multi-Model Settings
A `multi_model: boolean` config flag. When enabled, the plugin not only uses a fast model for query generation but spawns parallel instances of *reasoning* models to score and rank the fetched chunks before combining them, acting as a mini-MoE (Mixture of Experts) search pipeline.
