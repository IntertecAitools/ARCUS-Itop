import { z } from 'zod';
import type { Tone } from '@/theme';
import type { TicketPriority } from './types';

export const ticketPriorities = ['1', '2', '3', '4'] as const satisfies readonly TicketPriority[];

const priorityTones: Record<TicketPriority, Tone> = {
  '1': 'priority-critical',
  '2': 'priority-high',
  '3': 'priority-medium',
  '4': 'priority-low',
};

export function priorityTone(priority: TicketPriority): Tone {
  return priorityTones[priority];
}

/** Tones for iTop ticket status codes (Problem, Incident, UserRequest share most codes). */
export function ticketStatusTone(status: string): Tone {
  switch (status) {
    case 'new':
      return 'status-new';
    case 'assigned':
    case 'escalated_tto':
    case 'escalated_ttr':
    case 'pending':
    case 'waiting_for_approval':
    case 'approved':
      return 'status-assigned';
    case 'resolved':
      return 'status-resolved';
    case 'closed':
    case 'rejected':
      return 'status-closed';
    default:
      return 'neutral';
  }
}

/** True when an HTML fragment has visible text */
export function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim().length > 0;
}

/** Case log note */
export const caseLogNoteSchema = z.object({
  message: z.string().refine(hasText, { message: 'validation.required' }),
});
