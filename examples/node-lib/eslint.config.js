import { bugyo, common, structure } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname, parts: [common, structure], explicitExtensions: true });
