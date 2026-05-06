import nodemailer from 'nodemailer';

const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');

if (!user || !pass) {
  throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user, pass },
});

export async function sendMagicLink(toEmail: string, link: string): Promise<void> {
  const text = [
    `Hi,`,
    ``,
    `Click the link below to sign in to Paperstem. This link will expire in 15 minutes and can only be used once.`,
    ``,
    link,
    ``,
    `If you didn't request this, you can safely ignore this email.`,
    ``,
    `— Paperstem`,
  ].join('\n');

  const html = `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:520px;margin:0 auto;padding:24px;">
  <p>Hi,</p>
  <p>Click the button below to sign in to Paperstem. This link will expire in 15 minutes and can only be used once.</p>
  <p style="margin:28px 0;">
    <a href="${link}" style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">Sign in to Paperstem</a>
  </p>
  <p style="color:#666;font-size:13px;">Or paste this URL into your browser:<br><span style="word-break:break-all;">${link}</span></p>
  <p style="color:#888;font-size:13px;margin-top:32px;">If you didn't request this, you can safely ignore this email.</p>
  <p style="color:#888;font-size:13px;">— Paperstem</p>
</body>
</html>`;

  await transporter.sendMail({
    from: `"Paperstem" <${user}>`,
    to: toEmail,
    subject: 'Your Paperstem login link',
    text,
    html,
  });
}

export async function sendBandInvite(
  toEmail: string,
  bandName: string,
  link: string,
): Promise<void> {
  const text = [
    `Hi,`,
    ``,
    `You've been added to ${bandName} on Paperstem.`,
    ``,
    `Click the link below to sign in. This link will expire in 15 minutes and can only be used once.`,
    ``,
    link,
    ``,
    `If you weren't expecting this, you can safely ignore this email.`,
    ``,
    `— Paperstem`,
  ].join('\n');

  const html = `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:520px;margin:0 auto;padding:24px;">
  <p>Hi,</p>
  <p>You've been added to <strong>${bandName}</strong> on Paperstem.</p>
  <p>Click the button below to sign in. This link will expire in 15 minutes and can only be used once.</p>
  <p style="margin:28px 0;">
    <a href="${link}" style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">Sign in to Paperstem</a>
  </p>
  <p style="color:#666;font-size:13px;">Or paste this URL into your browser:<br><span style="word-break:break-all;">${link}</span></p>
  <p style="color:#888;font-size:13px;margin-top:32px;">If you weren't expecting this, you can safely ignore this email.</p>
  <p style="color:#888;font-size:13px;">— Paperstem</p>
</body>
</html>`;

  await transporter.sendMail({
    from: `"Paperstem" <${user}>`,
    to: toEmail,
    subject: `You've been added to ${bandName} on Paperstem`,
    text,
    html,
  });
}
