import { format } from '~/lib/format';
import { count } from '~/app/stores/count';
import { label } from '~/app/ui/label';
import { total } from '~/features/billing';

export const price = `${format(count)} ${label} ${total}`;
