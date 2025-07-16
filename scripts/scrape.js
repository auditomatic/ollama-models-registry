#!/usr/bin/env node

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const OLLAMA_LIBRARY_URL = 'https://ollama.com/library';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DRY_RUN = process.argv.includes('--dry-run');

// Model extraction function (same as our browser console script)
const extractModelsScript = `
function extractOllamaModels() {
    const models = [];
    const modelItems = document.querySelectorAll('li[x-test-model]');
    
    modelItems.forEach(item => {
        const link = item.querySelector('a[href*="/library/"]');
        if (!link) return;
        
        const modelName = link.href.split('/library/')[1];
        const description = item.querySelector('p.text-neutral-800, p.text-md')?.textContent?.trim() || '';
        
        // Extract all text and look for version tags and metadata
        const fullText = item.textContent.replace(/\\s+/g, ' ').trim();
        const tags = [];
        const categories = [];
        
        // Look for size indicators like 1.5b, 7b, 32b, etc.
        const sizeMatches = fullText.match(/\\b\\d+\\.?\\d*[bmgt]b?\\b/gi);
        if (sizeMatches) {
            tags.push(...sizeMatches.map(s => s.toLowerCase()));
        }
        
        // Look for model categories/features
        const categoryMatches = fullText.match(/\\b(latest|instruct|chat|code|vision|tools|thinking|base|uncensored)\\b/gi);
        if (categoryMatches) {
            categories.push(...categoryMatches.map(c => c.toLowerCase()));
        }
        
        // Extract pull count
        const pullMatch = fullText.match(/(\\d+\\.?\\d*[KMB])\\s*Pulls?/i);
        const pullCount = pullMatch ? pullMatch[1] : null;
        
        // Extract tag count
        const tagMatch = fullText.match(/(\\d+)\\s*Tags?/i);
        const tagCount = tagMatch ? parseInt(tagMatch[1]) : null;
        
        // Extract last updated
        const updatedMatch = fullText.match(/Updated\\s+([^\\n]+)/i);
        const lastUpdated = updatedMatch ? updatedMatch[1].trim() : null;
        
        models.push({
            name: modelName,
            description: description,
            tags: [...new Set(tags)],
            categories: [...new Set(categories)],
            pullCount: pullCount,
            tagCount: tagCount,
            lastUpdated: lastUpdated,
            extractedAt: new Date().toISOString()
        });
    });
    
    return models;
}

return extractOllamaModels();
`;

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
        await page.waitForTimeout(2000);
        
        console.log('🔍 Extracting model data...');
        const models = await page.evaluate(extractModelsScript);
        
        console.log(`✅ Extracted ${models.length} models`);
        
        // Create summary data
        const summary = {
            lastUpdated: new Date().toISOString(),
            totalModels: models.length,
            totalTags: models.reduce((sum, m) => sum + (m.tagCount || 0), 0),
            categories: [...new Set(models.flatMap(m => m.categories))].sort(),
            topModels: models
                .filter(m => m.pullCount)
                .sort((a, b) => {
                    const aNum = parseFloat(a.pullCount);
                    const bNum = parseFloat(b.pullCount);
                    const aUnit = a.pullCount.slice(-1);
                    const bUnit = b.pullCount.slice(-1);
                    
                    const multiplier = { K: 1000, M: 1000000, B: 1000000000 };
                    const aValue = aNum * (multiplier[aUnit] || 1);
                    const bValue = bNum * (multiplier[bUnit] || 1);
                    
                    return bValue - aValue;
                })
                .slice(0, 20)
                .map(m => ({ name: m.name, pullCount: m.pullCount, description: m.description }))
        };
        
        const fullData = {
            ...summary,
            models: models
        };
        
        if (DRY_RUN) {
            console.log('🔍 DRY RUN - Would save:');
            console.log(`- ${models.length} total models`);
            console.log(`- Top 5 models: ${summary.topModels.slice(0, 5).map(m => m.name).join(', ')}`);
            console.log(`- Categories: ${summary.categories.join(', ')}`);
            return;
        }
        
        // Ensure data directory exists
        await fs.mkdir(DATA_DIR, { recursive: true });
        
        // Write files
        await Promise.all([
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
        ]);
        
        console.log('💾 Data saved successfully!');
        console.log(`📊 Summary: ${models.length} models, ${summary.categories.length} categories`);
        
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