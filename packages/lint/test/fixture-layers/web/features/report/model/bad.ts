import { label } from '~/app/ui/label';
import { load } from '../../../app/api/client';
import { add } from '~/features/calc/model/add';

export const text = `${label} ${String(add(1, 2))}`;
export const loader = load;
