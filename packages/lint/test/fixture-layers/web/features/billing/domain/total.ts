import { label } from '~/app/ui/label';
import { view } from '../components/view';
import { amount } from '../services/amount';

export const total = `${label} ${view} ${String(amount)}`;
