const LOCAL_WEB_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
] as const;

export function allowedWebOrigins(configuredOrigin: string) {
  return LOCAL_WEB_ORIGINS.includes(configuredOrigin as (typeof LOCAL_WEB_ORIGINS)[number])
    ? [...LOCAL_WEB_ORIGINS]
    : [configuredOrigin];
}

export function isAllowedWebOrigin(origin: string | undefined, configuredOrigin: string) {
  return origin !== undefined && allowedWebOrigins(configuredOrigin).includes(origin);
}
