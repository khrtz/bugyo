// server ではコメントを止めない
import { user } from '#/features/users';
import { user as internal } from '#/features/users/model/user';

user();
export const same = internal;
