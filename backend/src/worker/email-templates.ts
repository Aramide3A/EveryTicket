export type TransactionalEmail = { subject: string; text: string; html: string };

type Payload = Record<string, unknown>;

export function encodeEmailPayload(input: Payload): string {
  return JSON.stringify(input);
}

export function renderNotificationEmail({ type, content, publicAppUrl }: { type: string; content?: string | null; publicAppUrl: string }): TransactionalEmail {
  const payload = readPayload(content);
  const appUrl = publicAppUrl.replace(/\/$/, '');
  const name = text(payload.name) || text(payload.buyerName) || 'there';
  const eventTitle = text(payload.eventTitle) || text(payload.event) || 'your event';
  const orderReference = text(payload.orderReference) || text(payload.reference);
  const money = formatMoney(number(payload.totalKobo) ?? number(payload.amountKobo) ?? number(payload.requestedAmountKobo) ?? number(payload.approvedAmountKobo) ?? number(payload.refundedAmountKobo));
  const rows: Array<[string, string]> = [];
  let subject = 'An update from EveryTicket';
  let heading = 'There is an update';
  let intro = `Hi ${name}, there is an update to your EveryTicket account.`;
  let action = { label: 'Open EveryTicket', url: appUrl };
  let tone: Tone = 'info';
  let note: string | undefined;

  switch (type) {
    case 'WELCOME': {
      const organizer = text(payload.role).toUpperCase() === 'ORGANIZER';
      subject = 'Welcome to EveryTicket';
      heading = `You are all set, ${name}`;
      intro = organizer
        ? 'Your email is verified. Create your first experience, manage every detail, and bring people together with EveryTicket.'
        : 'Your email is verified. Discover experiences, keep tickets in one place, and make every plan count.';
      action = organizer ? { label: 'Create event', url: `${appUrl}/organizer/events/new` } : { label: 'Discover events', url: `${appUrl}/events` };
      rows.push(['Account', organizer ? 'Organizer' : 'Customer'], ['Next step', organizer ? 'Create your first event' : 'Find your next event']);
      tone = 'success';
      break;
    }
    case 'ORDER_CONFIRMATION':
      subject = `Your tickets for ${eventTitle} are ready`;
      heading = 'Your tickets are ready';
      intro = `Hi ${name}, payment is confirmed. Your ticket PDFs are attached and are always available in My Tickets.`;
      rows.push(['Event', eventTitle], ['Order', orderReference || '—'], ['Total', money]);
      for (const line of ticketLines(payload)) rows.push([line.name, `${line.quantity} ticket${line.quantity === 1 ? '' : 's'}`]);
      action = { label: 'Open My Tickets', url: `${appUrl}/my-tickets` };
      tone = 'success';
      note = 'Keep each QR code private until you arrive at the venue.';
      break;
    case 'PAYMENT_FAILED':
      subject = 'Your payment did not go through'; heading = 'Your tickets are still waiting';
      intro = `We could not confirm payment for ${eventTitle}. No tickets have been issued yet.`;
      rows.push(['Event', eventTitle], ['Order', orderReference || '—'], ['Amount', money], ['Status', text(payload.status) || 'Payment failed']);
      action = { label: 'Try payment again', url: text(payload.retryUrl) || `${appUrl}/orders/${encodeURIComponent(orderReference)}` };
      tone = 'danger'; note = 'Your ticket selection may be released if payment is not completed in time.';
      break;
    case 'REFUND_REQUEST_RECEIVED':
      subject = 'Your refund request has been received'; heading = 'Your refund request is in review';
      intro = `We have received your refund request for ${eventTitle}. An EveryTicket administrator will review it.`;
      rows.push(['Event', eventTitle], ['Order', orderReference || '—'], ['Requested', money], ['Reason', text(payload.reason) || '—']);
      action = { label: 'View refund request', url: text(payload.requestUrl) || `${appUrl}/organizer/refunds` }; tone = 'warning';
      break;
    case 'REFUND_DECISION': {
      const status = text(payload.status).toUpperCase();
      const labels: Record<string, { subject: string; heading: string; intro: string; tone: Tone }> = {
        APPROVED: { subject: 'Your refund request has been approved', heading: 'Your refund was approved', intro: `The refund request for ${eventTitle} has been approved for processing.`, tone: 'success' },
        PROCESSED: { subject: 'Your refund has been processed', heading: 'Your refund is on its way', intro: `The refund for ${eventTitle} has been processed. Your payment provider may take time to show it in your account.`, tone: 'success' },
        FAILED: { subject: 'Your refund needs attention', heading: 'We could not complete this refund', intro: `The refund attempt for ${eventTitle} needs review before it can continue.`, tone: 'danger' },
        REJECTED: { subject: 'Your refund request was not approved', heading: 'Your refund request was declined', intro: `The refund request for ${eventTitle} was not approved at this time.`, tone: 'danger' },
      };
      const state = labels[status] ?? labels.FAILED;
      ({ subject, heading, intro, tone } = state);
      rows.push(['Event', eventTitle], ['Order', orderReference || '—'], ['Amount', money], ['Review note', text(payload.reviewReason) || text(payload.reason) || '—']);
      if (text(payload.gatewayReference)) rows.push(['Provider reference', text(payload.gatewayReference)]);
      action = { label: status === 'FAILED' ? 'Contact support' : 'View refund request', url: text(payload.requestUrl) || `${appUrl}/organizer/refunds` };
      break;
    }
    case 'PAYOUT_REQUEST_RECEIVED':
      subject = 'Your payout request has been received'; heading = 'Your payout request is in review';
      intro = `We have received your payout request for ${eventTitle}.`;
      rows.push(['Event', eventTitle], ['Requested amount', money], ['Requested', text(payload.requestedAt) || 'Today']);
      action = { label: 'View payout request', url: text(payload.requestUrl) || `${appUrl}/organizer/payouts` }; tone = 'warning';
      break;
    case 'PAYOUT_DECISION': {
      const status = text(payload.status).toUpperCase();
      const labels: Record<string, { subject: string; heading: string; intro: string; tone: Tone }> = {
        APPROVED: { subject: 'Your payout request has been approved', heading: 'Your payout is approved', intro: `Your payout for ${eventTitle} has been approved and is being prepared.`, tone: 'success' },
        PAID: { subject: 'Your payout has been sent', heading: 'Your payout has been sent', intro: `The transfer for ${eventTitle} has been recorded as paid.`, tone: 'success' },
        REJECTED: { subject: 'Your payout request was not approved', heading: 'Your payout request was declined', intro: `Your payout request for ${eventTitle} was not approved at this time.`, tone: 'danger' },
      };
      const state = labels[status] ?? labels.REJECTED;
      ({ subject, heading, intro, tone } = state);
      rows.push(['Event', eventTitle], ['Amount', money], ['Review note', text(payload.reviewReason) || '—']);
      if (text(payload.transferReference)) rows.push(['Transfer reference', text(payload.transferReference)]);
      action = { label: 'View payout request', url: text(payload.requestUrl) || `${appUrl}/organizer/payouts` };
      break;
    }
    case 'EVENT_PUBLISHED':
      subject = 'Your event is live on EveryTicket'; heading = 'Your event is live';
      intro = `${eventTitle} is now published and available for discovery on EveryTicket.`;
      rows.push(['Event', eventTitle], ['Starts', text(payload.startAt) || '—'], ['Venue', text(payload.venue) || '—']);
      action = { label: 'View public event', url: text(payload.eventUrl) || `${appUrl}/events/${encodeURIComponent(text(payload.eventSlug))}` }; tone = 'success';
      break;
    case 'EVENT_CANCELLED':
      subject = `${eventTitle} has been cancelled`; heading = 'This event has been cancelled';
      intro = `We are sorry to let you know that ${eventTitle} will no longer take place.`;
      rows.push(['Original date', text(payload.startAt) || '—'], ['Order', orderReference || '—'], ['Refund status', text(payload.refundGuidance) || 'We will share the next steps shortly']);
      action = { label: 'Get event support', url: `${appUrl}/support` }; tone = 'danger'; note = 'Please do not travel to the venue. Our support team is here to help.';
      break;
    case 'RSVP_CONFIRMATION':
      subject = 'Your RSVP is confirmed'; heading = 'You are on the guest list';
      intro = `Hi ${name}, your RSVP for ${eventTitle} is confirmed. Save your admission credential for check-in.`;
      rows.push(['Event', eventTitle], ['Guest type', text(payload.category) || 'Guest'], ['Credential', text(payload.credential) || text(payload.legacyContent) || 'Available in your RSVP confirmation']);
      action = { label: 'View event details', url: text(payload.eventUrl) || `${appUrl}/events/${encodeURIComponent(text(payload.eventSlug))}` }; tone = 'success';
      break;
    case 'RSVP_DECLINED':
      subject = 'Your RSVP response has been recorded'; heading = 'We have recorded your response';
      intro = `Hi ${name}, you declined the invitation to ${eventTitle}.`;
      rows.push(['Event', eventTitle], ['Response', 'Declined']); action = { label: 'Discover events', url: `${appUrl}/events` }; break;
    case 'CHECK_IN_CONFIRMATION':
      subject = 'You are checked in'; heading = 'You are checked in';
      intro = `Welcome to ${eventTitle}. Your entry was recorded successfully.`;
      rows.push(['Checked in', text(payload.checkedInAt) || 'Just now'], ['Entry type', text(payload.entryType) || 'Admission'], ['Venue', text(payload.venue) || '—']);
      action = { label: 'View my tickets', url: `${appUrl}/my-tickets` }; tone = 'success'; break;
    case 'ACCOUNT_RESTRICTED':
      subject = 'Your EveryTicket account access has been restricted'; heading = 'Your account is temporarily restricted';
      intro = `Hi ${name}, access to your EveryTicket account has been restricted while we review an account matter.`;
      rows.push(['Account', text(payload.email) || '—'], ['Reason', text(payload.reason) || 'Policy review']); action = { label: 'Contact support', url: `${appUrl}/support` }; tone = 'danger'; break;
    case 'ACCOUNT_RESTORED':
      subject = 'Your EveryTicket account access has been restored'; heading = 'Your account access is restored';
      intro = `Hi ${name}, you can sign in again and continue using EveryTicket.`;
      rows.push(['Account', text(payload.email) || '—'], ['Status', 'Active']); action = { label: 'Sign in', url: `${appUrl}/sign-in` }; tone = 'success'; break;
  }
  return layout({ subject, heading, intro, rows, action, tone, note });
}

export function renderAuthEmail({ kind, name, url }: { kind: 'VERIFY' | 'RESET'; name?: string; url: string }): TransactionalEmail {
  const verification = kind === 'VERIFY';
  return layout({
    subject: verification ? 'Verify your EveryTicket email' : 'Reset your EveryTicket password',
    heading: verification ? 'Your account is almost ready' : 'Reset your password',
    intro: verification ? `Hi ${name ?? 'there'}, confirm your email to activate your EveryTicket account and keep your tickets secure.` : `Hi ${name ?? 'there'}, we received a request to reset your EveryTicket password.`,
    rows: [['Secure link', verification ? 'Expires in 24 hours' : 'Expires in 60 minutes']],
    action: { label: verification ? 'Verify email' : 'Reset password', url },
    tone: verification ? 'info' : 'warning',
    note: verification ? 'For your security, this link can only be used once.' : 'If you did not request this, you can safely ignore this email.',
  });
}

type Tone = 'success' | 'warning' | 'danger' | 'info';

function layout({ subject, heading, intro, rows, action, tone, note }: { subject: string; heading: string; intro: string; rows: Array<[string, string]>; action: { label: string; url: string }; tone: Tone; note?: string }): TransactionalEmail {
  const safeRows = rows.map(([label, value]) => `<tr><td style="padding:10px 0;color:#756c7c;font:13px Arial,sans-serif">${escape(label)}</td><td style="padding:10px 0;color:#21002f;font:700 13px Arial,sans-serif;text-align:right">${escape(value)}</td></tr>`).join('');
  const safeAction = safeUrl(action.url);
  const text = [heading, intro, ...rows.map(([label, value]) => `${label}: ${value}`), note, `${action.label}: ${safeAction}`].filter(Boolean).join('\n\n');
  const color = tone === 'danger' ? '#b42318' : tone === 'warning' ? '#9a5a00' : tone === 'success' ? '#18794e' : '#560078';
  const label = tone === 'danger' ? 'Important update' : tone === 'warning' ? 'Action needed' : tone === 'success' ? 'Confirmed' : 'EveryTicket update';
  return {
    subject,
    text,
    html: `<!doctype html><html><body style="margin:0;background:#fff8ea;color:#21002f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff8ea"><tr><td style="padding:32px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fffdf8;border:1px solid #eadfee;border-radius:20px;overflow:hidden"><tr><td style="padding:24px 28px;background:linear-gradient(115deg,#21002f,#560078 60%,#aa5707);color:#fff"><table role="presentation" width="100%"><tr><td style="font:700 20px Arial,sans-serif;letter-spacing:-.5px"><span style="color:#ff9700">▰</span> EveryTicket</td><td style="text-align:right;color:#ffc21a;font:700 10px Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase">${label}</td></tr></table></td></tr><tr><td style="padding:34px 34px 22px"><div style="display:inline-block;border-radius:14px;background:#f4eafb;color:${color};padding:12px 14px;font:700 18px Arial,sans-serif">${tone === 'danger' ? '!' : tone === 'warning' ? '↗' : '✓'}</div><h1 style="margin:18px 0 0;color:#21002f;font:700 30px/1.08 Arial,sans-serif;letter-spacing:-1px">${escape(heading)}</h1><p style="margin:14px 0 22px;color:#5f5367;font:15px/1.55 Arial,sans-serif">${escape(intro)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #eadfee;border-radius:14px;padding:0 14px">${safeRows}</table>${note ? `<p style="margin:16px 0;padding:13px 14px;border-radius:12px;background:#fff3d8;color:#593a00;font:13px/1.45 Arial,sans-serif">${escape(note)}</p>` : ''}<p style="margin:22px 0 4px"><a href="${escapeAttribute(safeAction)}" style="display:inline-block;border-radius:11px;background:#ff9700;color:#21002f;padding:13px 18px;text-decoration:none;font:700 13px Arial,sans-serif">${escape(action.label)} →</a></p></td></tr><tr><td style="padding:18px 34px 26px;color:#756c7c;font:11px/1.5 Arial,sans-serif">EveryTicket · Your ticket to unforgettable experiences.<br>Need help? <a href="${escapeAttribute(safeUrl(`${new URL(safeAction).origin}/support`))}" style="color:#560078">Contact support</a></td></tr></table></td></tr></table></body></html>`,
  };
}

function readPayload(content?: string | null): Payload {
  if (!content) return {};
  try { const value: unknown = JSON.parse(content); return value && typeof value === 'object' && !Array.isArray(value) ? value as Payload : {}; } catch { return { legacyContent: content }; }
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function ticketLines(payload: Payload): Array<{ name: string; quantity: number }> { return Array.isArray(payload.ticketLines) ? payload.ticketLines.flatMap((line) => line && typeof line === 'object' && typeof (line as Payload).name === 'string' && typeof (line as Payload).quantity === 'number' ? [{ name: (line as Payload).name as string, quantity: (line as Payload).quantity as number }] : []) : []; }
function formatMoney(amount?: number): string { return amount === undefined ? '—' : `NGN ${(amount / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function safeUrl(value: string): string { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : 'https://everyticket.vercel.app'; } catch { return 'https://everyticket.vercel.app'; } }
function escape(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] as string); }
function escapeAttribute(value: string): string { return escape(value); }
