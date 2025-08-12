#!/usr/bin/env node

import dotenv from 'dotenv'
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';

dotenv.config();
dotenv.config({ path: '.env.local' });

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [bearLink] [options]')
  .positional('bearLink', {
    describe: 'Bear note link to process',
    type: 'string'
  })
  .option('output', {
    alias: 'o',
    describe: 'Output file name',
    type: 'string'
  })
  .option('watch', {
    alias: 'w',
    describe: 'Watch for changes',
    type: 'boolean',
    default: false
  })
  .help()
  .argv;

function extractBearNoteId(bearLink) {
  try {
    const url = new URL(bearLink);
    const params = new URLSearchParams(url.search);
    return params.get('id');
  } catch (error) {
    throw new Error(`Invalid Bear link: ${bearLink}`);
  }
}

function queryBearNote(noteId) {
  return new Promise((resolve, reject) => {
    const dbPath = process.env.BEAR_SQLITE_PATH;
    if (!dbPath) {
      reject(new Error('BEAR_SQLITE_PATH environment variable not set'));
      return;
    }

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        reject(new Error(`Failed to open Bear database: ${err.message}`));
        return;
      }
    });

    db.get("SELECT * FROM `ZSFNOTE` WHERE `ZUNIQUEIDENTIFIER` = ?", [noteId], (err, row) => {
      if (err) {
        db.close();
        reject(new Error(`Database query failed: ${err.message}`));
        return;
      }
      
      if (!row) {
        db.close();
        reject(new Error(`Note with ID ${noteId} not found`));
        return;
      }

      db.close();
      resolve(row);
    });
  });
}

function processZText(content) {
  if (!content) return '';
  
  const lines = content.split('\n');
  let startIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      startIndex = i;
      break;
    }
  }
  
  return lines.slice(startIndex).join('\n');
}

function rewriteImageReferences(content) {
  const imagePath = process.env.BEAR_IMAGE_PATH;
  if (!imagePath) {
    return content;
  }

  return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, altText, imageSrc) => {
    if (imageSrc.startsWith('file://')) {
      const filename = path.basename(imageSrc);
      return `![${altText}](assets/${filename})`;
    }
    return match;
  });
}

function createTextBundle(outputPath, content, noteTitle) {
  const bundlePath = outputPath.endsWith('.textbundle') ? outputPath : `${outputPath}.textbundle`;
  
  if (!fs.existsSync(bundlePath)) {
    fs.mkdirSync(bundlePath, { recursive: true });
  }

  const assetsPath = path.join(bundlePath, 'assets');
  if (!fs.existsSync(assetsPath)) {
    fs.mkdirSync(assetsPath);
  }

  const info = {
    "version": 2,
    "type": "net.daringfireball.markdown",
    "transient": false,
    "displayName": noteTitle || "Bear Note"
  };

  fs.writeFileSync(path.join(bundlePath, 'info.json'), JSON.stringify(info, null, 2));
  fs.writeFileSync(path.join(bundlePath, 'text.md'), content);

  return bundlePath;
}

async function exportBearNote(bearLink, outputPath) {
  try {
    const noteId = extractBearNoteId(bearLink);
    const noteData = await queryBearNote(noteId);
    const processedContent = processZText(noteData.ZTEXT || '');
    const content = rewriteImageReferences(processedContent);
    const title = noteData.ZTITLE || 'Untitled Note';
    
    const bundlePath = createTextBundle(outputPath, content, title);
    console.log(`Note exported to: ${bundlePath}`);
    
    return { bundlePath, noteData };
  } catch (error) {
    console.error('Export failed:', error.message);
    throw error;
  }
}

function watchNote(noteId, outputPath, callback) {
  let lastModified = null;

  const checkForChanges = async () => {
    try {
      const noteData = await queryBearNote(noteId);
      const currentModified = noteData.ZMODIFICATIONDATE;
      
      if (lastModified !== null && currentModified !== lastModified) {
        console.log('Note changed, updating export...');
        const processedContent = processZText(noteData.ZTEXT || '');
        const content = rewriteImageReferences(processedContent);
        const title = noteData.ZTITLE || 'Untitled Note';
        createTextBundle(outputPath, content, title);
        if (callback) callback(noteData);
      }
      
      lastModified = currentModified;
    } catch (error) {
      console.error('Watch error:', error.message);
    }
  };

  console.log('Watching for changes...');
  const interval = setInterval(checkForChanges, 2000);
  
  return () => clearInterval(interval);
}

async function main() {
  try {
    const bearLink = argv._[0] || argv.bearLink;
    const outputPath = argv.output;
    const shouldWatch = argv.watch;

    if (!bearLink) {
      console.error('Error: Bear link is required');
      process.exit(1);
    }

    if (!outputPath) {
      console.error('Error: Output path is required (use -o or --output)');
      process.exit(1);
    }

    console.log('Processing Bear note...');
    const { bundlePath, noteData } = await exportBearNote(bearLink, outputPath);

    if (shouldWatch) {
      const noteId = extractBearNoteId(bearLink);
      const stopWatching = watchNote(noteId, outputPath, (updatedNoteData) => {
        console.log('Export updated');
      });

      process.on('SIGINT', () => {
        console.log('\nStopping watch mode...');
        stopWatching();
        process.exit(0);
      });

      console.log('Press Ctrl+C to stop watching');
    } else {
      console.log('Export completed successfully');
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();