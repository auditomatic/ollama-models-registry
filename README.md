# Ollama Models Registry

🤖 **Automated scraping and hosting of Ollama model registry data**

This repository automatically scrapes the [Ollama Library](https://ollama.com/library) daily and provides the data as JSON files that can be consumed by applications.

## 📊 Data Available

- **Full Dataset**: All models with complete metadata
- **Summary**: Condensed view with top models and statistics  
- **JSON API**: Served via GitHub Pages CDN

## 🚀 Usage

### Direct JSON Access

```javascript
// Get all models data
const models = await fetch('https://username.github.io/ollama-models-registry/models.json')
  .then(r => r.json());

// Get summary data only
const summary = await fetch('https://username.github.io/ollama-models-registry/models-summary.json')
  .then(r => r.json());
```

### Example Data Structure

```json
{
  "lastUpdated": "2025-01-16T06:00:00Z",
  "totalModels": 175,
  "totalTags": 1250,
  "categories": ["tools", "thinking", "vision", "code", "chat"],
  "topModels": [
    {
      "name": "llama3.1",
      "pullCount": "100M",
      "description": "Meta's latest language model..."
    }
  ],
  "models": [
    {
      "name": "deepseek-r1",
      "description": "DeepSeek-R1 is a family of open reasoning models...",
      "tags": ["1.5b", "7b", "8b", "14b", "32b", "70b", "671b"],
      "categories": ["tools", "thinking"],
      "pullCount": "53.4M",
      "tagCount": 35,
      "lastUpdated": "2 weeks ago"
    }
  ]
}
```

## 🔄 Automation

- **Daily Updates**: Runs automatically at 6 AM UTC
- **Manual Trigger**: Can be triggered manually via GitHub Actions
- **Change Detection**: Only commits when data actually changes
- **GitHub Pages**: Automatically deploys updated data

## 🛠️ Development

### Local Testing

```bash
# Install dependencies
npm install

# Run scraper in dry-run mode
npm test

# Run actual scraper
npm run scrape
```

### Scripts

- `scripts/scrape.js` - Main scraping logic using Puppeteer
- `.github/workflows/scrape-models.yml` - GitHub Actions automation

## 📁 Data Files

- `data/models.json` - Complete dataset
- `data/models-summary.json` - Summary with top models and stats
- `data/last-updated.txt` - Last update timestamp

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