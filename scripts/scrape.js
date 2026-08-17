#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

// Configuration
const OLLAMA_LIBRARY_URL = 'https://ollama.com/library';
const LITELLM_PRICES_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/refs/heads/main/model_prices_and_context_window.json';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DRY_RUN = process.argv.includes('--dry-run');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Chip class markers (Ollama library page)
const CATEGORY_CHIP_CLASS = 'bg-indigo-50';   // capability chips: tools, thinking, vision, ...
const VERSION_CHIP_CLASS = 'bg-[#ddf4ff]';    // size/version chips: 8b, 70b, latest, ...
const OTHER_CHIP_CLASS = 'bg-cyan-50';        // deployment chips: cloud

function decodeHtmlEntities(str = '') {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Fetch a page as text with retries. Ollama's library + tags pages are fully
// server-rendered, so no browser is needed.
async function fetchText(url, { timeoutMs = 30000, retries = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

function parseLibraryPage(html) {
  const modelsMap = {};
  const itemRegex = /<li\s+class="flex items-baseline border-b border-neutral-200 py-6">([\s\S]*?)<\/li>/g;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(html)) !== null) {
    const item = itemMatch[1];

    const linkMatch = item.match(/<a[^>]*href="\/library\/([^"/]+)"[^>]*class="group w-full space-y-5"/);
    if (!linkMatch) continue;
    const modelName = linkMatch[1];

    const model = {};

    const descMatch = item.match(/<p class="max-w-lg break-words text-neutral-800 text-md">([\s\S]*?)<\/p>/);
    model.description = descMatch ? decodeHtmlEntities(descMatch[1].trim()) : '';

    // Parse chips: indigo = capabilities (categories), blue = version/size tags
    const categories = [];
    const versionTags = {};
    const chipRegex = /<span\s+class="inline-flex items-center rounded-md ([^"]*)">([\s\S]*?)<\/span>/g;
    let chipMatch;
    while ((chipMatch = chipRegex.exec(item)) !== null) {
      const cls = chipMatch[1];
      const text = decodeHtmlEntities(chipMatch[2].trim()).toLowerCase();
      if (!text) continue;
      if (cls.includes(CATEGORY_CHIP_CLASS) || cls.includes(OTHER_CHIP_CLASS)) {
        if (!categories.includes(text)) categories.push(text);
      } else if (cls.includes(VERSION_CHIP_CLASS)) {
        versionTags[text] = {};
      }
    }
    model.categories = categories;

    // Pull count: value span immediately before the "Pulls" label
    const pullsMatch = item.match(/([\d.,]+[KMB]?)\s*<\/span>\s*<span[^>]*>\s*&nbsp;Pulls/i);
    model.pullCount = pullsMatch ? pullsMatch[1].replace(/,/g, '') : null;

    // Tag count: number span immediately before the "Tags" label
    const tagsMatch = item.match(/([\d.]+)\s*<\/span>\s*<span[^>]*>\s*&nbsp;Tags/i);
    model.tagCount = tagsMatch ? parseInt(tagsMatch[1], 10) : null;

    // Last updated relative date
    const updatedMatch = item.match(/Updated&nbsp;<\/span>\s*<span[^>]*>([^<]+)<\/span>/i);
    model.lastUpdated = updatedMatch ? decodeHtmlEntities(updatedMatch[1].trim()) : null;

    model.tags = versionTags;
    model.extractedAt = new Date().toISOString();

    modelsMap[modelName] = model;
  }

  return modelsMap;
}

function parseTagsPage(pageHtml) {
  const detailedTags = {};
  // Each tag row is a sibling <div class="group px-4 py-3"> block.
  const segments = pageHtml.split('<div class="group px-4 py-3">').slice(1);

  for (const segment of segments) {
    const row = segment.split('<div class="group px-4 py-3">')[0];

    // Desktop tag link (mobile view duplicates the link, so target the desktop one)
    const linkMatch = row.match(/<a[^>]*href="\/library\/([^"]+:[^"]+)" class="group-hover:underline"/);
    if (!linkMatch) continue;
    const fullTag = linkMatch[1];
    const tagParts = fullTag.split(':');
    if (tagParts.length < 2) continue;
    const tagName = tagParts.slice(1).join(':');

    const sizeMatches = [...row.matchAll(/<p class="col-span-2 text-neutral-500 text-\[13px\]">([\s\S]*?)<\/p>/g)];
    const size = sizeMatches[0] ? decodeHtmlEntities(sizeMatches[0][1].trim()) : null;
    const contextWindow = sizeMatches[1] ? decodeHtmlEntities(sizeMatches[1][1].trim()) : null;

    // Capabilities block (Text / Vision / Image / ... comma-separated)
    const capMatch = row.match(/<div class="col-span-2 text-neutral-500 text-\[13px\]\s?">([\s\S]*?)<\/div>/);
    const capabilities = capMatch
      ? decodeHtmlEntities(capMatch[1].replace(/<[^>]+>/g, ' '))
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : [];

    const hashMatch = row.match(/<span class="font-mono text-\[11px\]">([0-9a-f]+)<\/span>/i);
    const modelHash = hashMatch ? hashMatch[1] : null;

    detailedTags[tagName] = {
      fullTag,
      size,
      contextWindow,
      modelHash,
      capabilities,
      extractedAt: new Date().toISOString()
    };
  }

  return detailedTags;
}

// Fetch detailed tags for a specific model
async function scrapeModelTags(modelName) {
  const tagsUrl = `${OLLAMA_LIBRARY_URL}/${encodeURIComponent(modelName)}/tags`;
  try {
    console.log(`  📋 Fetching detailed tags for ${modelName}...`);
    const html = await fetchText(tagsUrl, { timeoutMs: 20000 });
    return parseTagsPage(html, modelName);
  } catch (error) {
    console.log(`  ⚠️  Failed to fetch tags for ${modelName}: ${error.message}`);
    return {};
  }
}

// Function to fetch LiteLLM model prices data
async function fetchLiteLLMPrices() {
  console.log('📈 Fetching LiteLLM model prices...');

  try {
    const https = require('https');
    const http = require('http');

    return new Promise((resolve, reject) => {
      const client = LITELLM_PRICES_URL.startsWith('https') ? https : http;

      client.get(LITELLM_PRICES_URL, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            console.log('✅ LiteLLM prices data fetched successfully');
            resolve(jsonData);
          } catch (error) {
            reject(new Error(`JSON parse error: ${error.message}`));
          }
        });
      }).on('error', reject);
    });
  } catch (error) {
    console.log(`⚠️  Failed to fetch LiteLLM prices: ${error.message}`);
    return null;
  }
}

async function scrapeOllamaModels() {
  console.log('🚀 Starting Ollama models scrape...');

  try {
    console.log('📡 Loading Ollama library page...');
    const libraryHtml = await fetchText(OLLAMA_LIBRARY_URL);

    console.log('🔍 Extracting model data...');
    const modelsMap = parseLibraryPage(libraryHtml);

    const modelNames = Object.keys(modelsMap);
    console.log(`✅ Extracted ${modelNames.length} models`);

    // Scrape detailed tags for each model
    console.log('🔍 Fetching detailed quantization tags...');
    const maxModelsToDetail = DRY_RUN ? 3 : modelNames.length; // Pull ALL models

    for (let i = 0; i < maxModelsToDetail; i++) {
      const modelName = modelNames[i];
      const model = modelsMap[modelName];

      console.log(`📋 Processing ${i + 1}/${maxModelsToDetail}: ${modelName}`);

      // Fetch detailed tags
      const detailedTags = await scrapeModelTags(modelName);

      // Merge detailed tags with existing basic tags
      if (Object.keys(detailedTags).length > 0) {
        // Replace basic tags with detailed tags
        model.tags = detailedTags;
        model.tagCount = Object.keys(detailedTags).length;
      }

      // Pace requests to avoid hammering Ollama
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    console.log(`✅ Enhanced ${maxModelsToDetail} models with detailed tags`);

    // Fetch LiteLLM prices data
    const litellmPricesData = await fetchLiteLLMPrices();

    // Create summary data from nested structure
    const totalTags = Object.values(modelsMap).reduce((sum, model) => sum + Object.keys(model.tags).length, 0);
    const allCategories = [...new Set(Object.values(modelsMap).flatMap(m => m.categories))].sort();

    // Get top models by pull count
    const topModels = Object.entries(modelsMap)
      .filter(([name, model]) => model.pullCount)
      .sort(([nameA, modelA], [nameB, modelB]) => {
        const aNum = parseFloat(modelA.pullCount);
        const bNum = parseFloat(modelB.pullCount);
        const aUnit = modelA.pullCount.slice(-1);
        const bUnit = modelB.pullCount.slice(-1);

        const multiplier = { K: 1000, M: 1000000, B: 1000000000 };
        const aValue = aNum * (multiplier[aUnit] || 1);
        const bValue = bNum * (multiplier[bUnit] || 1);

        return bValue - aValue;
      })
      .slice(0, 20)
      .map(([name, model]) => ({
        name,
        pullCount: model.pullCount,
        description: model.description,
        tagCount: Object.keys(model.tags).length
      }));

    const summary = {
      lastUpdated: new Date().toISOString(),
      totalModels: modelNames.length,
      totalTags,
      categories: allCategories,
      topModels
    };

    const fullData = {
      ...summary,
      models: modelsMap
    };

    if (DRY_RUN) {
      console.log('🔍 DRY RUN - Would save:');
      console.log(`- ${modelNames.length} total models`);
      console.log(`- ${totalTags} total tags`);
      console.log(`- Top 5 models: ${summary.topModels.slice(0, 5).map(m => m.name).join(', ')}`);
      console.log(`- Categories: ${summary.categories.join(', ')}`);
      console.log(`- Sample model structure:`, Object.entries(modelsMap)[0]);
      return;
    }

    // Ensure data directory exists
    await fs.mkdir(DATA_DIR, { recursive: true });

    // Write files
    const writePromises = [
      fs.writeFile(
        path.join(DATA_DIR, 'models.json'),
        JSON.stringify(fullData, null, 2)
      ),
      fs.writeFile(
        path.join(DATA_DIR, 'models-summary.json'),
        JSON.stringify(summary, null, 2)
      ),
      fs.writeFile(
        path.join(DATA_DIR, 'last-updated.txt'),
        new Date().toISOString()
      )
    ];

    // Add LiteLLM prices data if available
    if (litellmPricesData) {
      writePromises.push(
        fs.writeFile(
          path.join(DATA_DIR, 'litellm_model_prices_and_context_window.json'),
          JSON.stringify(litellmPricesData, null, 2)
        )
      );
    }

    await Promise.all(writePromises);

    console.log('💾 Data saved successfully!');
    console.log(`📊 Summary: ${modelNames.length} models, ${summary.categories.length} categories`);

  } catch (error) {
    console.error('❌ Error during scraping:', error);
    process.exit(1);
  }
}

// Run the scraper
if (require.main === module) {
  scrapeOllamaModels().catch(console.error);
}

module.exports = { scrapeOllamaModels, parseLibraryPage, parseTagsPage, fetchText };
