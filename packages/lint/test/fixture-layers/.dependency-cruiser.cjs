const { layers } = require('./.bugyo/config.json');
module.exports = require('../../depcruise.cjs').config({ src: 'web', layers });
