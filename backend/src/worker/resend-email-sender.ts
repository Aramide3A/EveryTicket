import { Resend } from 'resend';
import type { EmailSender } from './notification-delivery.js';

type ResendConfig = { apiKey: string; from: string };
type ResendClient = {
  emails: {
    send(message: { from: string; to: string; subject: string; text: string }): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
  };
};

export function createResendEmailSender({ config, client }: { config: ResendConfig; client?: ResendClient }): EmailSender {
  const resend = client ?? new Resend(config.apiKey);
  return {
    async send(message): Promise<void> {
      const result = await resend.emails.send({ from: config.from, ...message });
      if (result.error) throw new Error(`Resend email delivery failed: ${result.error.message}`);
    },
  };
}
