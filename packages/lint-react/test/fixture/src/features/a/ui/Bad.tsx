import React, { useEffect } from 'react';
import { m } from '@/features/b/model/impure';
import { App } from '@/app/App';

// memo
export async function load(id?: string) {
  React.useLayoutEffect(() => {}, []);
  useEffect(() => {}, []);
  setTimeout(() => {}, 1);
  fetch('/x');
  const n = id!;
  const v = n as unknown as number;
  return [m, App, v];
}
