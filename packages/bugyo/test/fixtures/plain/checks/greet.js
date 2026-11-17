import { greet } from '../lib/greet/index.js';

const actual = greet('bugyo');
if (actual !== 'hello, bugyo') {
  console.error(`greet('bugyo') は "hello, bugyo" のはずが "${actual}" でした`);
  process.exit(1);
}
console.log('greet: ok');
