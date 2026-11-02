import type { ApplicationRole } from '../generated/prisma/client.js';

export function organizerRegistrationRoles(): ApplicationRole[] {
  return ['CUSTOMER', 'ORGANIZER'];
}

export function registrationCookies(headers: Headers): string[] {
  return headers.getSetCookie();
}
