#!/usr/bin/env node

import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

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

console.log('Arguments parsed:');
console.log('Bear Link:', argv._[0] || argv.bearLink);
console.log('Output:', argv.output);
console.log('Watch:', argv.watch);