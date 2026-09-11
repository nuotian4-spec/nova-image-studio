export const NOVA_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || '/_nova').replace(/\/+$/, '') || '/_nova';

export function withBasePath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized === '/' || normalized === '') return `${NOVA_BASE_PATH}/`;
  return `${NOVA_BASE_PATH}${normalized}`;
}
