const { sources } = require('./.bugyo/config.json');
module.exports = require('../../depcruise.cjs').config({ src: sources.server.src, layers: sources.server.layers, tsConfig: sources.server.tsconfig });
