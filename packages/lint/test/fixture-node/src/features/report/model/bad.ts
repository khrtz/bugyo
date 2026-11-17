import { add } from '../../calc/model/add.ts';

// 説明のコメント
export const loose: any = add(1, 2);
export const forced = loose as number;
export const sure = [1].at(0)!;
Promise.resolve(1);
