#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

const MODELS_DEV_BASE_URL = 'https://models.dev';
const FILE_NAMES = ['api.json', 'models.json', 'catalog.json'];
const OUTPUT_DIR = path.join(__dirname, '..', 'models.dev');
const DRY_RUN = process.argv.includes('--dry-run');

async function fetchFile(fileName, { retries = 3, timeoutMs = 60000 } = {}) {
  const url = `${MODELS_DEV_BASE_URL}/${fileName}`;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      const contents = await response.text();
      JSON.parse(contents);
      return contents;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  throw lastError;
}

async function fetchModelsDev() {
  console.log('Fetching models.dev JSON files...');

  // Fetch and validate every file before changing any local mirror.
  const files = await Promise.all(
    FILE_NAMES.map(async fileName => {
      const contents = await fetchFile(fileName);
      console.log(`  ${fileName}: ${Buffer.byteLength(contents).toLocaleString()} bytes`);
      return { fileName, contents };
    })
  );

  if (DRY_RUN) {
    console.log('Dry run complete; no files written.');
    return;
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all(
    files.map(({ fileName, contents }) =>
      fs.writeFile(path.join(OUTPUT_DIR, fileName), contents)
    )
  );

  console.log(`Saved ${files.length} files to ${OUTPUT_DIR}`);
}

if (require.main === module) {
  fetchModelsDev().catch(error => {
    console.error(`Failed to mirror models.dev: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { FILE_NAMES, fetchFile, fetchModelsDev };
