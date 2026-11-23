import { Buffer } from 'node:buffer';
import { Resend } from 'resend';
import type { EmailSender } from './notification-delivery.js';

type ResendConfig = { apiKey: string; from: string };
type ResendClient = {
  emails: {
    send(message: { from: string; to: string; subject: string; text: string; html?: string; attachments?: Array<{ filename: string; content: Buffer; contentType: string }> }): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
  };
};

export function createResendEmailSender({ config, client }: { config: ResendConfig; client?: ResendClient }): EmailSender {
  const resend = client ?? new Resend(config.apiKey);
  return {
    async send(message): Promise<void> {
      const { attachments, ...body } = message;
      const result = await resend.emails.send({
        from: config.from,
        ...body,
        ...(attachments ? { attachments: attachments.map((attachment) => ({ ...attachment, content: Buffer.from(attachment.content) })) } : {}),
      });
      if (result.error) throw new Error(`Resend email delivery failed: ${result.error.message}`);
    },
  };
}
