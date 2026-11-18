import { readFileSync } from 'node:fs';
import { bugyo } from '../../eslint.js';

const { layers } = JSON.parse(readFileSync(new URL('./.bugyo/config.json', import.meta.url), 'utf8'));
export default bugyo({ root: import.meta.dirname, src: 'web', layers });
