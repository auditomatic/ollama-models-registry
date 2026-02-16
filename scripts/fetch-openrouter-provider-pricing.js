#!/usr/bin/env node

/**
 * Harvest provider-specific endpoint pricing from OpenRouter.
 *
 * This script:
 * 1) Fetches the full OpenRouter model catalog (/api/v1/models)
 * 2) Fetches provider endpoints for each model (/api/v1/models/{id}/endpoints)
 * 3) Extracts rows for target providers (default: Mistral + Nebius)
 * 4) Writes raw + provider-grouped pricing snapshots
 */

const fs = require('fs').promises;
const path = require('path');

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_MODEL_ENDPOINTS_URL = (modelId) =>
  `https://openrouter.ai/api/v1/models/${encodeURI(modelId)}/endpoints`;

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_TARGET_PROVIDERS = ['mistral', 'nebius'];

function parseArgs(argv) {
  const args = {
    dryRun: false,
    limit: null,
    concurrency: DEFAULT_CONCURRENCY,
    retries: DEFAULT_RETRIES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outDir: path.join(__dirname, '..', 'data'),
    providers: [...DEFAULT_TARGET_PROVIDERS]
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (arg === '--limit') {
      args.limit = Number(argv[++i]);
      continue;
    }

    if (arg === '--concurrency') {
      args.concurrency = Number(argv[++i]);
      continue;
    }

    if (arg === '--retries') {
      args.retries = Number(argv[++i]);
      continue;
    }

    if (arg === '--timeout-ms') {
      args.timeoutMs = Number(argv[++i]);
      continue;
    }

    if (arg === '--out-dir') {
      args.outDir = path.resolve(argv[++i]);
      continue;
    }

    if (arg === '--providers') {
      const raw = String(argv[++i] || '');
      args.providers = raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error('--concurrency must be an integer >= 1');
  }

  if (!Number.isInteger(args.retries) || args.retries < 0) {
    throw new Error('--retries must be an integer >= 0');
  }

  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000) {
    throw new Error('--timeout-ms must be an integer >= 1000');
  }

  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error('--limit must be an integer >= 1');
  }

  if (!args.providers.length) {
    throw new Error('--providers must include at least one provider name');
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchJsonWithRetries(url, options, retries) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ollama-models-registry/openrouter-provider-pricing/1.0'
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` :: ${body.slice(0, 300)}` : ''}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      if (attempt < retries) {
        const backoff = 300 * Math.pow(2, attempt);
        await sleep(backoff);
      }
    }
  }

  throw lastError;
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (true) {
      const i = index;
      index += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

function pickSelectedVariant(variants) {
  const active = variants.filter((v) => v.status === 0);
  const ranked = (active.length ? active : variants)
    .filter((v) => v.promptCostPerToken !== null && v.completionCostPerToken !== null)
    .sort((a, b) => {
      const aTotal = a.promptCostPerToken + a.completionCostPerToken;
      const bTotal = b.promptCostPerToken + b.completionCostPerToken;
      if (aTotal !== bTotal) return aTotal - bTotal;
      if (a.promptCostPerToken !== b.promptCostPerToken) return a.promptCostPerToken - b.promptCostPerToken;
      return a.completionCostPerToken - b.completionCostPerToken;
    });

  return ranked.length ? ranked[0] : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = new Date().toISOString();

  console.log('Starting OpenRouter provider pricing harvest...');
  console.log(`Providers: ${args.providers.join(', ')}`);
  console.log(`Concurrency: ${args.concurrency}, Retries: ${args.retries}, Timeout: ${args.timeoutMs}ms`);

  const modelsPayload = await fetchJsonWithRetries(
    OPENROUTER_MODELS_URL,
    { timeoutMs: args.timeoutMs },
    args.retries
  );

  const allModels = Array.isArray(modelsPayload?.data) ? modelsPayload.data : [];
  let modelIds = allModels.map((m) => String(m.id)).filter(Boolean);

  if (args.limit) {
    modelIds = modelIds.slice(0, args.limit);
  }

  if (args.dryRun) {
    modelIds = modelIds.slice(0, Math.min(15, modelIds.length));
  }

  console.log(`Catalog size: ${allModels.length} models`);
  console.log(`Fetching endpoints for: ${modelIds.length} models`);

  const modelMeta = new Map(allModels.map((m) => [String(m.id), m]));

  let completed = 0;
  const progressEvery = Math.max(10, Math.floor(modelIds.length / 20));

  const endpointResults = await runPool(
    modelIds,
    async (modelId) => {
      try {
        const payload = await fetchJsonWithRetries(
          OPENROUTER_MODEL_ENDPOINTS_URL(modelId),
          { timeoutMs: args.timeoutMs },
          args.retries
        );

        completed += 1;
        if (completed % progressEvery === 0 || completed === modelIds.length) {
          console.log(`Progress: ${completed}/${modelIds.length}`);
        }

        return { modelId, ok: true, payload };
      } catch (error) {
        completed += 1;
        if (completed % progressEvery === 0 || completed === modelIds.length) {
          console.log(`Progress: ${completed}/${modelIds.length}`);
        }
        return { modelId, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    args.concurrency
  );

  const errors = endpointResults.filter((r) => !r.ok).map((r) => ({ modelId: r.modelId, error: r.error }));

  const targetProviders = new Set(args.providers.map((p) => p.toLowerCase()));
  const extracted = [];

  for (const result of endpointResults) {
    if (!result.ok) continue;

    const modelData = result.payload?.data;
    const endpoints = Array.isArray(modelData?.endpoints) ? modelData.endpoints : [];
    const modelId = String(modelData?.id || result.modelId);
    const modelInfo = modelMeta.get(modelId) || {};

    for (const endpoint of endpoints) {
      const providerName = String(endpoint?.provider_name || '').trim();
      if (!providerName) continue;
      if (!targetProviders.has(providerName.toLowerCase())) continue;

      const promptCostPerToken = toNumber(endpoint?.pricing?.prompt);
      const completionCostPerToken = toNumber(endpoint?.pricing?.completion);

      extracted.push({
        modelId,
        providerName,
        endpointName: endpoint?.name || null,
        tag: endpoint?.tag || null,
        status: toNumber(endpoint?.status),
        quantization: endpoint?.quantization || null,
        contextLength: toNumber(endpoint?.context_length),
        maxCompletionTokens: toNumber(endpoint?.max_completion_tokens),
        maxPromptTokens: toNumber(endpoint?.max_prompt_tokens),
        promptCostPerToken,
        completionCostPerToken,
        promptCostPer1M: promptCostPerToken === null ? null : promptCostPerToken * 1_000_000,
        completionCostPer1M: completionCostPerToken === null ? null : completionCostPerToken * 1_000_000,
        supportsImplicitCaching: Boolean(endpoint?.supports_implicit_caching),
        uptimeLast30m: toNumber(endpoint?.uptime_last_30m),
        sourceModelPricingPrompt: toNumber(modelInfo?.pricing?.prompt),
        sourceModelPricingCompletion: toNumber(modelInfo?.pricing?.completion),
        extractedAt: startedAt
      });
    }
  }

  const byProvider = {};
  for (const provider of args.providers) {
    byProvider[provider] = { providerName: provider, models: {} };
  }

  for (const row of extracted) {
    const providerKey = row.providerName.toLowerCase();
    if (!byProvider[providerKey]) {
      byProvider[providerKey] = { providerName: providerKey, models: {} };
    }

    const bucket = byProvider[providerKey].models;
    if (!bucket[row.modelId]) {
      bucket[row.modelId] = [];
    }
    bucket[row.modelId].push(row);
  }

  const providerSnapshots = {};
  for (const [providerKey, data] of Object.entries(byProvider)) {
    const models = {};
    let variantCount = 0;

    for (const [modelId, variants] of Object.entries(data.models)) {
      variantCount += variants.length;
      models[modelId] = {
        selected: pickSelectedVariant(variants),
        variants: variants.sort((a, b) => {
          const aStatus = a.status === 0 ? 0 : 1;
          const bStatus = b.status === 0 ? 0 : 1;
          if (aStatus !== bStatus) return aStatus - bStatus;

          const aTotal = (a.promptCostPerToken ?? 1e9) + (a.completionCostPerToken ?? 1e9);
          const bTotal = (b.promptCostPerToken ?? 1e9) + (b.completionCostPerToken ?? 1e9);
          if (aTotal !== bTotal) return aTotal - bTotal;

          return String(a.tag || '').localeCompare(String(b.tag || ''));
        })
      };
    }

    providerSnapshots[providerKey] = {
      generatedAt: new Date().toISOString(),
      source: 'openrouter-provider-endpoints',
      providerName: data.providerName,
      modelCount: Object.keys(models).length,
      variantCount,
      models
    };
  }

  const rawOutput = {
    generatedAt: new Date().toISOString(),
    source: 'openrouter-provider-endpoints',
    settings: {
      providers: args.providers,
      concurrency: args.concurrency,
      retries: args.retries,
      timeoutMs: args.timeoutMs,
      dryRun: args.dryRun,
      limit: args.limit
    },
    summary: {
      catalogModelCount: allModels.length,
      scannedModelCount: modelIds.length,
      successfulEndpointRequests: endpointResults.filter((r) => r.ok).length,
      failedEndpointRequests: errors.length,
      extractedEndpointRows: extracted.length
    },
    errors,
    rows: extracted
  };

  await fs.mkdir(args.outDir, { recursive: true });

  const rawPath = path.join(args.outDir, 'openrouter-provider-endpoints.raw.json');
  await fs.writeFile(rawPath, JSON.stringify(rawOutput, null, 2));

  for (const provider of args.providers) {
    const snapshot = providerSnapshots[provider] || {
      generatedAt: new Date().toISOString(),
      source: 'openrouter-provider-endpoints',
      providerName: provider,
      modelCount: 0,
      variantCount: 0,
      models: {}
    };

    const outputPath = path.join(args.outDir, `${provider}-provider-pricing.json`);
    await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2));
  }

  console.log('Done.');
  console.log(`Raw output: ${rawPath}`);
  for (const provider of args.providers) {
    console.log(`Provider output: ${path.join(args.outDir, `${provider}-provider-pricing.json`)}`);
  }
  console.log(`Extracted rows: ${extracted.length}, Errors: ${errors.length}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exitCode = 1;
});
