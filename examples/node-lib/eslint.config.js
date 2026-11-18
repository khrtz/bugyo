import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname, explicitExtensions: true, parts: [common, structure, noComments, fetchOnlyInApi] });
