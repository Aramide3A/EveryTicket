export function guestCheckoutProfileId(profile: { id: string } | null): string | undefined {
  return profile?.id;
}

export function normalizeBuyerEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}
