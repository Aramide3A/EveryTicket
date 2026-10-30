import nodemailer from 'nodemailer';
import type { EmailSender } from './notification-delivery.js';

type SmtpConfig = { host: string; port: number; user: string; password: string; from: string };
type MailTransport = { sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };

export function createSmtpEmailSender({ config, transport }: { config: SmtpConfig; transport?: MailTransport }): EmailSender {
  const client = transport ?? nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
  });
  return {
    async send(message): Promise<void> {
      await client.sendMail({ from: config.from, ...message });
    },
  };
}
