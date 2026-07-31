import { connect, type TLSSocket } from "node:tls";

type SmtpReply = {
  code: number;
  text: string;
};

type ReplyWaiter = {
  resolve: (reply: SmtpReply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class SmtpSession {
  private buffer = "";
  private lines: string[] = [];
  private replies: SmtpReply[] = [];
  private waiters: ReplyWaiter[] = [];
  private failure: Error | null = null;

  constructor(private readonly socket: TLSSocket) {
    socket.on("data", (chunk: Buffer | Uint8Array) => {
      this.buffer += Buffer.from(chunk).toString("utf8");
      const completeLines = this.buffer.split(/\r?\n/);
      this.buffer = completeLines.pop() ?? "";
      for (const line of completeLines) this.consumeLine(line);
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => {
      if (this.waiters.length) this.fail(new Error("SMTP connection closed unexpectedly"));
    });
  }

  private consumeLine(line: string) {
    if (!line) return;
    this.lines.push(line);
    const match = line.match(/^(\d{3})([ -])/);
    if (!match || match[2] !== " ") return;
    const reply = { code: Number(match[1]), text: this.lines.join("\n") };
    this.lines = [];
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(reply);
    } else {
      this.replies.push(reply);
    }
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  nextReply(timeoutMs = 15_000) {
    if (this.failure) return Promise.reject(this.failure);
    const queued = this.replies.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<SmtpReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item.timer !== timer);
        reject(new Error("SMTP response timed out"));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  async command(command: string, expectedCodes: number[]) {
    this.socket.write(`${command}\r\n`);
    const reply = await this.nextReply();
    if (!expectedCodes.includes(reply.code)) {
      throw new Error(`SMTP command rejected with ${reply.code}`);
    }
    return reply;
  }
}

function openTlsSocket() {
  return new Promise<TLSSocket>((resolve, reject) => {
    const socket = connect(
      {
        host: "smtp.gmail.com",
        port: 465,
        servername: "smtp.gmail.com",
        rejectUnauthorized: true,
      },
      () => {
        clearTimeout(timer);
        if (socket.authorized === false) {
          reject(new Error("SMTP TLS certificate could not be verified"));
          socket.destroy();
          return;
        }
        resolve(socket);
      },
    );
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP connection timed out"));
    }, 15_000);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sanitizeAddress(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Invalid email address");
  }
  return normalized;
}

function encodeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function dotStuff(value: string) {
  return value.replace(/^\./gm, "..");
}

export async function sendGmailMessage(options: {
  sender: string;
  appPassword: string;
  recipient: string;
  subject: string;
  text: string;
  html: string;
}) {
  const sender = sanitizeAddress(options.sender);
  const recipient = sanitizeAddress(options.recipient);
  const password = options.appPassword.replace(/\s+/g, "");
  if (!password) throw new Error("Missing SMTP app password");

  const boundary = `quantscope-${crypto.randomUUID()}`;
  const message = [
    `From: QuantScope <${sender}>`,
    `To: ${recipient}`,
    `Subject: ${encodeHeader(options.subject.replace(/[\r\n]+/g, " ").slice(0, 180))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@quantscope.app>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    options.text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    options.html,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const socket = await openTlsSocket();
  const session = new SmtpSession(socket);
  try {
    const greeting = await session.nextReply();
    if (greeting.code !== 220) throw new Error(`SMTP greeting failed with ${greeting.code}`);
    await session.command("EHLO quantscope.app", [250]);
    const credentials = Buffer.from(`\0${sender}\0${password}`, "utf8").toString("base64");
    await session.command(`AUTH PLAIN ${credentials}`, [235]);
    await session.command(`MAIL FROM:<${sender}>`, [250]);
    await session.command(`RCPT TO:<${recipient}>`, [250, 251]);
    await session.command("DATA", [354]);
    socket.write(`${dotStuff(message)}\r\n.\r\n`);
    const accepted = await session.nextReply();
    if (accepted.code !== 250) throw new Error(`SMTP message rejected with ${accepted.code}`);
    await session.command("QUIT", [221]);
  } finally {
    socket.destroy();
  }
}
