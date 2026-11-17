import { bugyo, common, structure } from '@bugyo/lint';
import { react } from '@bugyo/lint-react';

export default bugyo({ root: import.meta.dirname, parts: [common, structure, react] });
