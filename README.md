# Ollama Models Registry

# [(https://ollama.models.auditomatic.org/models.json)](https://ollama.models.auditomatic.org/models.json)

🤖 **Automated scraping and hosting of Ollama model registry data with intelligent tag classification**

This repository automatically scrapes the [Ollama Library](https://ollama.com/library) daily using advanced DOM analysis and provides structured JSON data that can be consumed by applications.

## 🎯 Key Features

- **🔍 Adaptive Tag Classification**: Auto-discovers model vs version tags using heuristic analysis
- **📊 Nested Data Structure**: Models with hierarchical version tags for easy consumption  
- **🏆 Popularity Rankings**: Top models ranked by community pull counts
- **🔄 Future-Proof**: Survives website redesigns through style pattern detection
- **⚡ Single-Page Scraping**: Extracts all 175+ models in one request

## 📊 Data Available

- **Complete Dataset**: 175+ models with nested version tags
- **Smart Classification**: Model-level tags (tools, vision) vs version tags (7b, 8b)
- **Community Insights**: Real pull counts and popularity rankings
- **JSON API**: Served via GitHub Pages CDN

## 📊 **Direct JSON Access**

### 🔗 **Live Data Endpoints**

- **[📄 Complete Dataset](https://ollama.models.auditomatic.org/models.json)** - All 175+ models with nested version tags
- **[📈 Summary Dataset](https://ollama.models.auditomatic.org/models-summary.json)** - Top models and statistics
- **[📅 Last Updated](https://ollama.models.auditomatic.org/last-updated.txt)** - Timestamp of last update

### API Usage

```javascript
// Get all models data
const data = await fetch('https://ollama-models.auditomatic.org/models.json')
  .then(r => r.json());

// Access nested structure  
const deepseekVersions = Object.keys(data.models["deepseek-r1"].tags);
// → ["1.5b", "7b", "8b", "14b", "32b", "70b", "671b"]

// Generate pull commands
const pullCommands = Object.keys(data.models["deepseek-r1"].tags)
  .map(tag => `ollama pull deepseek-r1:${tag}`);

// Get summary data only
const summary = await fetch('https://ollama-models.auditomatic.org/models-summary.json')
  .then(r => r.json());
```

### Nested Data Structure

```json
{
  "lastUpdated": "2025-07-16T21:29:22.933Z",
  "totalModels": 175,
  "totalTags": 319,
  "categories": ["tools", "thinking", "vision", "code", "chat"],
  "topModels": [
    {
      "name": "llama3.1", 
      "pullCount": "97.9M",
      "description": "Llama 3.1 is a new state-of-the-art model...",
      "tagCount": 3
    }
  ],
  "models": {
    "deepseek-r1": {
      "description": "DeepSeek-R1 is a family of open reasoning models...",
      "categories": ["tools", "thinking"],
      "pullCount": "53.4M",
      "tagCount": 35,
      "lastUpdated": "2 weeks ago",
      "tags": {
        "1.5b": {},
        "7b": {},  
        "8b": {},
        "14b": {},
        "32b": {},
        "70b": {},
        "671b": {}
      }
    }
  }
}
```

## 🔄 Automation

- **Daily Updates**: Runs automatically at 6 AM UTC
- **Manual Trigger**: Can be triggered manually via GitHub Actions
- **Change Detection**: Only commits when data actually changes
- **GitHub Pages**: Automatically deploys updated data

## 🛠️ Development

### Manually Run Job

```bash
gh workflow run "Scrape Ollama Models"
```

### Local Testing

```bash
# Install dependencies
npm install

# Run scraper in dry-run mode
npm test

# Run actual scraper
npm run scrape
```

### Technical Implementation

- `scripts/scrape.js` - Advanced scraping with adaptive tag classification
  - **DOM Analysis**: Inspects chip styling to auto-discover tag types
  - **Heuristic Classification**: Uses known model/version patterns for validation  
  - **Style Pattern Detection**: Future-proof against UI redesigns
  - **Puppeteer Integration**: Full browser rendering for JavaScript content
- `.github/workflows/scrape-models.yml` - GitHub Actions automation

### How It Works

1. **Load Page**: Puppeteer loads the Ollama library with full JavaScript rendering
2. **Analyze Chips**: Discovers tag styling patterns using known model/version tags
3. **Auto-Classify**: Distinguishes model tags (tools, vision) from version tags (7b, 8b)  
4. **Extract Data**: Scrapes all 175+ models with proper tag classification
5. **Structure Output**: Creates nested JSON with models containing version tags

## 📁 Data Files

- `data/models.json` - Complete dataset
- `data/models-summary.json` - Summary with top models and stats
- `data/last-updated.txt` - Last update timestamp
- `models.dev/api.json` - Mirror of `https://models.dev/api.json`
- `models.dev/models.json` - Mirror of `https://models.dev/models.json`
- `models.dev/catalog.json` - Mirror of `https://models.dev/catalog.json`

Refresh the models.dev mirror locally with `npm run mirror:models-dev`. The daily
workflow publishes these files at `/models.dev/api.json`, `/models.dev/models.json`,
and `/models.dev/catalog.json` on the GitHub Pages site.

## 🤝 Contributing

1. Fork the repository
2. Make improvements to the scraping logic
3. Test locally with `npm test`
4. Submit a pull request

## 📜 License

MIT License - Feel free to use this data in your projects!

## 🔗 Related Projects

- [Ollama](https://ollama.com/) - Run large language models locally
- [Ollama Library](https://ollama.com/library) - Source of the data

---

**🤖 This repository is fully automated - data updates happen without human intervention!** 
