import type { ButtonHTMLAttributes } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & { pressed?: boolean };

export function Button({ pressed, ...rest }: Props) {
  return <button type="button" aria-pressed={pressed} {...rest} />;
}
