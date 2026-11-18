import { price } from '~/app/domain/price';
import { format } from '~/lib/format';
import { count } from '~/app/stores/count';

export const stored = `${price} ${format(count)}`;
