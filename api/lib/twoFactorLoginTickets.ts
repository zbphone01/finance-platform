import { generateToken } from "./auth";

const TICKET_TTL_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

type TwoFactorTicket = {
  userId: number;
  expiresAt: number;
  attempts: number;
};

const tickets = new Map<string, TwoFactorTicket>();

function cleanup(now = Date.now()) {
  for (const [ticket, value] of tickets.entries()) {
    if (value.expiresAt <= now) tickets.delete(ticket);
  }
}

export function createTwoFactorLoginTicket(userId: number) {
  cleanup();
  const ticket = generateToken();
  tickets.set(ticket, {
    userId,
    expiresAt: Date.now() + TICKET_TTL_MS,
    attempts: 0,
  });
  return ticket;
}

export function getTwoFactorLoginTicket(ticket: string) {
  const value = tickets.get(ticket);
  if (!value || value.expiresAt <= Date.now()) {
    tickets.delete(ticket);
    return null;
  }
  return value;
}

export function recordTwoFactorLoginFailure(ticket: string) {
  const value = getTwoFactorLoginTicket(ticket);
  if (!value) return null;
  value.attempts += 1;
  if (value.attempts >= MAX_CODE_ATTEMPTS) {
    tickets.delete(ticket);
    return null;
  }
  return value;
}

export function consumeTwoFactorLoginTicket(ticket: string) {
  const value = getTwoFactorLoginTicket(ticket);
  if (value) tickets.delete(ticket);
  return value;
}
