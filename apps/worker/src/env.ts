import type { ApplicationDO } from './do/application-do';

export interface Env {
  DB: D1Database;
  APP_DO: DurableObjectNamespace<ApplicationDO>;
  ADMIN_SECRET?: string;
  CLERK_ISSUER?: string;
}
