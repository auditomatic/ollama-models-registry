#!/usr/bin/env node

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const OLLAMA_LIBRARY_URL = 'https://ollama.com/library';
const LITELLM_PRICES_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/refs/heads/main/model_prices_and_context_window.json';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DRY_RUN = process.argv.includes('--dry-run');

// Model extraction function with proper nested structure
const extractModelsScript = `
function extractOllamaModels() {
    const modelsMap = {};
    const modelItems = document.querySelectorAll('li[x-test-model]');
    
    modelItems.forEach(item => {
        const link = item.querySelector('a[href*="/library/"]');
        if (!link) return;
        
        const modelName = link.href.split('/library/')[1];
        const description = item.querySelector('p.text-neutral-800, p.text-md')?.textContent?.trim() || '';
        
        // Extract all text for parsing
        const fullText = item.textContent.replace(/\\s+/g, ' ').trim();
        
        // Extract pull count
        const pullMatch = fullText.match(/(\\d+\\.?\\d*[KMB])\\s*Pulls?/i);
        const pullCount = pullMatch ? pullMatch[1] : null;
        
        // Extract tag count  
        const tagMatch = fullText.match(/(\\d+)\\s*Tags?/i);
        const tagCount = tagMatch ? parseInt(tagMatch[1]) : null;
        
        // Extract last updated
        const updatedMatch = fullText.match(/Updated\\s+([^\\n]+)/i);
        const lastUpdated = updatedMatch ? updatedMatch[1].trim() : null;
        
        // Extract categories (tools, thinking, vision, etc.)
        const categoryMatches = fullText.match(/\\b(latest|instruct|chat|code|vision|tools|thinking|base|uncensored)\\b/gi);
        const categories = categoryMatches ? [...new Set(categoryMatches.map(c => c.toLowerCase()))] : [];
        
        // Extract version tags more carefully
        // Look for patterns between description and pull count
        const descriptionEnd = fullText.indexOf(description) + description.length;
        const pullStart = pullCount ? fullText.indexOf(pullCount) : fullText.length;
        const tagSection = fullText.substring(descriptionEnd, pullStart).trim();
        
        // Extract size-based tags (1.5b, 7b, etc.) and other version identifiers
        const tags = {};
        const tagPatterns = [
            /\\b\\d+\\.?\\d*[bmgt]b?\\b/gi,     // Size tags: 1.5b, 7b, 32b, etc.
            /\\be\\d+[bmgt]?\\b/gi,            // E-series: e2b, e4b  
            /\\b(latest|base|instruct|chat|code)\\b/gi  // Common version tags
        ];
        
        tagPatterns.forEach(pattern => {
            const matches = tagSection.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    const cleanTag = match.toLowerCase().trim();
                    if (cleanTag && !categories.includes(cleanTag)) {
                        tags[cleanTag] = {};
                    }
                });
            }
        });
        
        // Store in nested structure
        modelsMap[modelName] = {
            description: description,
            categories: categories,
            pullCount: pullCount,
            tagCount: tagCount,
            lastUpdated: lastUpdated,
            tags: tags,
            extractedAt: new Date().toISOString()
        };
    });
    
    return modelsMap;
}

extractOllamaModels();
`;

// Function to extract detailed tags from model tags page
const extractDetailedTagsScript = `
function extractDetailedTags() {
    const detailedTags = {};
    const tagItems = document.querySelectorAll('.group.px-4.py-3');
    
    tagItems.forEach(item => {
        // Look for links with model:tag pattern
        const linkElement = item.querySelector('a[href*="/library/"]');
        if (!linkElement) return;
        
        const href = linkElement.getAttribute('href');
        const fullTag = href.split('/library/')[1];
        
        if (!fullTag || !fullTag.includes(':')) return;
        
        const [modelName, tagName] = fullTag.split(':');
        
        // Extract size information
        const sizeElement = item.querySelector('.col-span-2.text-neutral-500:first-of-type');
        const size = sizeElement ? sizeElement.textContent.trim() : null;
        
        // Extract context window
        const contextElement = item.querySelector('.col-span-2.text-neutral-500:nth-of-type(2)');
        const contextWindow = contextElement ? contextElement.textContent.trim() : null;
        
        // Extract model hash
        const hashElement = item.querySelector('.font-mono');
        const modelHash = hashElement ? hashElement.textContent.trim() : null;
        
        // Extract capabilities/type
        const capabilityElement = item.querySelector('.col-span-2.text-neutral-500:nth-of-type(3)');
        const capabilities = capabilityElement ? capabilityElement.textContent.trim().split(',').map(s => s.trim()) : [];
        
        detailedTags[tagName] = {
            fullTag: fullTag,
            size: size,
            contextWindow: contextWindow,
            modelHash: modelHash,
            capabilities: capabilities,
            extractedAt: new Date().toISOString()
        };
    });
    
    return detailedTags;
}

extractDetailedTags();
`;

// Function to scrape detailed tags for a specific model
async function scrapeModelTags(page, modelName) {
    try {
        const tagsUrl = `${OLLAMA_LIBRARY_URL}/${modelName}/tags`;
        console.log(`  📋 Fetching detailed tags for ${modelName}...`);
        
        await page.goto(tagsUrl, { 
            waitUntil: 'networkidle2',
            timeout: 15000 
        });
        
        // Wait for tags to load
        await page.waitForSelector('.group.px-4.py-3', { timeout: 5000 });
        
        // Extract detailed tags
        const detailedTags = await page.evaluate(extractDetailedTagsScript);
        
        return detailedTags;
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
    
    let browser;
    try {
        // Launch browser
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Set user agent to avoid bot detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('📡 Loading Ollama library page...');
        await page.goto(OLLAMA_LIBRARY_URL, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        // Wait for models to load
        console.log('⏳ Waiting for models to load...');
        await page.waitForSelector('li[x-test-model]', { timeout: 10000 });
        
        // Give a bit more time for any dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('🔍 Analyzing chip structure...');
        const chipAnalysis = await page.evaluate(() => {
            const modelItems = document.querySelectorAll('li[x-test-model]');
            const analysis = [];
            
            modelItems.forEach((item, index) => {
                if (index >= 5) return; // Only analyze first 5 for structure
                
                const link = item.querySelector('a[href*="/library/"]');
                if (!link) return;
                
                const modelName = link.href.split('/library/')[1];
                
                // Find all possible chip/tag elements
                const allElements = item.querySelectorAll('span, div');
                const chips = [];
                
                allElements.forEach(el => {
                    const text = el.textContent.trim();
                    const classes = el.className;
                    const styles = window.getComputedStyle(el);
                    const bgColor = styles.backgroundColor;
                    const color = styles.color;
                    
                    // Look for elements that could be tags/chips
                    if (text.length > 0 && text.length < 20 && 
                        !text.includes('Pull') && !text.includes('Tag') && 
                        !text.includes('Updated') && !text.includes('ago') &&
                        !text.includes('.') && !text.includes('M') && !text.includes('K') &&
                        text.match(/^[a-z0-9.-]+$/i)) {
                        
                        chips.push({
                            text: text,
                            classes: classes,
                            bgColor: bgColor,
                            color: color,
                            position: el.getBoundingClientRect(),
                            parent: el.parentElement?.className || '',
                            tagName: el.tagName
                        });
                    }
                });
                
                analysis.push({
                    model: modelName,
                    chips: chips
                });
            });
            
            return analysis;
        });
        
        console.log('📊 Chip structure analysis:', JSON.stringify(chipAnalysis, null, 2));
        
        // Discover styling patterns by analyzing known tag types
        console.log('🔍 Discovering tag styling patterns...');
        const styleDiscovery = await page.evaluate(() => {
            // Known model-level tags (capabilities/features)
            const knownModelTags = ['vision', 'tools', 'thinking', 'chat', 'code', 'instruct', 'uncensored'];
            // Known version tags (sizes/variants)  
            const knownVersionTags = ['1b', '3b', '7b', '8b', '14b', '30b', '32b', '70b', 'e2b', 'e4b', 'latest', 'base'];
            
            const styleGroups = {};
            
            // Collect all chips from all models
            document.querySelectorAll('li[x-test-model]').forEach(item => {
                const allElements = item.querySelectorAll('span');
                
                allElements.forEach(el => {
                    const text = el.textContent.trim().toLowerCase();
                    const classes = el.className;
                    const styles = window.getComputedStyle(el);
                    const bgColor = styles.backgroundColor;
                    
                    // Only look at chip-like elements
                    if (classes.includes('inline-flex') && classes.includes('rounded-md') && text.length < 20) {
                        const styleKey = classes + '|' + bgColor;
                        
                        if (!styleGroups[styleKey]) {
                            styleGroups[styleKey] = {
                                style: { classes: classes, bgColor: bgColor },
                                modelTags: [],
                                versionTags: [],
                                unknownTags: []
                            };
                        }
                        
                        if (knownModelTags.includes(text)) {
                            styleGroups[styleKey].modelTags.push(text);
                        } else if (knownVersionTags.includes(text)) {
                            styleGroups[styleKey].versionTags.push(text);
                        } else {
                            styleGroups[styleKey].unknownTags.push(text);
                        }
                    }
                });
            });
            
            // Find which style is model vs version based on majority
            let modelStyle = null;
            let versionStyle = null;
            let maxModelCount = 0;
            let maxVersionCount = 0;
            
            Object.entries(styleGroups).forEach(([styleKey, group]) => {
                const modelCount = group.modelTags.length;
                const versionCount = group.versionTags.length;
                
                if (modelCount > maxModelCount) {
                    maxModelCount = modelCount;
                    modelStyle = group.style;
                }
                if (versionCount > maxVersionCount) {
                    maxVersionCount = versionCount;
                    versionStyle = group.style;
                }
            });
            
            return {
                styleGroups: styleGroups,
                modelStyle: modelStyle,
                versionStyle: versionStyle,
                confidence: { modelCount: maxModelCount, versionCount: maxVersionCount }
            };
        });
        
        console.log('🎯 Auto-discovered styles:');
        console.log('Model style:', styleDiscovery.modelStyle);
        console.log('Version style:', styleDiscovery.versionStyle);
        console.log('Confidence:', styleDiscovery.confidence);
        console.log('All style groups:', styleDiscovery.styleGroups);
        
        console.log('🔍 Extracting model data...');
        const modelsMap = await page.evaluate(extractModelsScript);
        
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
            const detailedTags = await scrapeModelTags(page, modelName);
            
            // Merge detailed tags with existing basic tags
            if (Object.keys(detailedTags).length > 0) {
                // Replace basic tags with detailed tags
                model.tags = detailedTags;
                model.tagCount = Object.keys(detailedTags).length;
            }
            
            // No delay needed - GitHub Pages can handle the load
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
                name: name, 
                pullCount: model.pullCount, 
                description: model.description,
                tagCount: Object.keys(model.tags).length
            }));
        
        const summary = {
            lastUpdated: new Date().toISOString(),
            totalModels: modelNames.length,
            totalTags: totalTags,
            categories: allCategories,
            topModels: topModels
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
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Run the scraper
if (require.main === module) {
    scrapeOllamaModels().catch(console.error);
}

module.exports = { scrapeOllamaModels };