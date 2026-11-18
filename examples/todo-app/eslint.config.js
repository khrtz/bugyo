import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';
import { noUiTimers, noUseEffect, react } from '@bugyo/lint-react';

export default bugyo({
  root: import.meta.dirname,
  parts: [common, structure, react, noComments, fetchOnlyInApi, noUseEffect, noUiTimers],
});
