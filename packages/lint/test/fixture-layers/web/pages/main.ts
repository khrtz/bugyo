import { add } from '~/features/calc';
import { add as rawAdd } from '~/features/calc/model/add';
import { text } from '../features/report';

export const page = `${String(add(1, 2) + rawAdd(3, 4))} ${text}`;
