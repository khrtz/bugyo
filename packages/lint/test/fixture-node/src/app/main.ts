import { add } from '../features/calc/index.ts';
import { add as rawAdd } from '../features/calc/model/add.ts';

export const total = add(1, 2) + rawAdd(3, 4);
